import { QueryRunner } from 'typeorm';
import { HistoricoSgp1756000025000 } from '../src/infrastructure/persistence/postgres/migrations/1756000025000-HistoricoSgp';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { HistoricoPreparacionCarga1756000026000 } from '../src/infrastructure/persistence/postgres/migrations/1756000026000-HistoricoPreparacionCarga';

/**
 * La migración NO se ejecuta aquí: se captura su SQL y se verifican las garantías. La ejecución real (índice único
 * parcial, disparadores, bloqueo, reversión) la hace `herramientas/verificar-historico-pg.ts` contra PostgreSQL.
 */
async function sqlDe(metodo: 'up' | 'down', importaciones = 0): Promise<{ sql: string[]; error?: Error }> {
  const emitido: string[] = [];
  const corredor = {
    query: (sql: string) => {
      emitido.push(sql.replace(/\s+/g, ' ').trim());
      if (/to_regclass/.test(sql)) return Promise.resolve([{ hay: true }]);
      return Promise.resolve(/count\(\*\)/.test(sql) ? [{ n: importaciones }] : undefined);
    },
  };
  try {
    await new HistoricoSgp1756000025000()[metodo](corredor as unknown as QueryRunner);
    return { sql: emitido };
  } catch (e) {
    return { sql: emitido, error: e as Error };
  }
}

describe('Migración del histórico del SGP (sin ejecutar)', () => {
  let todo: string;
  beforeAll(async () => { todo = (await sqlDe('up')).sql.join('\n'); });

  it('va justo después de la carta digital y antes de la preparación de carga (H3)', () => {
    const i = MIGRACIONES.indexOf(HistoricoSgp1756000025000);
    expect(MIGRACIONES[i - 1].name).toBe('CartaPresentacionDigital1756000024000');
    expect(MIGRACIONES[i + 1]).toBe(HistoricoPreparacionCarga1756000026000);
  });

  it('no toca ninguna tabla operativa: todo vive en el esquema historico', () => {
    for (const m of todo.matchAll(/\b(?:CREATE TABLE IF NOT EXISTS|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+ ON|ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|REFERENCES|TRIGGER \w+ BEFORE [A-Z ]+ ON)\s+([a-z_."]+)/g)) {
      expect(m[1]).toMatch(/^historico\./);
    }
    expect(todo).not.toMatch(/\bpublic\./);
    expect(todo).not.toMatch(/(?<!historico\.)\b(practicas|usuarios|empresas|documentos|obligaciones|auditoria)\s*\(/);
  });

  it('variante minimizada: ninguna columna de dato personal directo ni copia de la fila', () => {
    const prohibidas = /\b(nombre_estudiante|student_name|email|correo|telefono|phone|nombre_docente|teacher_name|jefe|boss|funciones|functions_text|documento|nit_original|nombre_empresa|empresa_nombre|raw_row|fila_original|registro_origen)\b/i;
    const ddl = todo.split('\n').filter((l) => l.startsWith('CREATE TABLE')).join('\n');
    expect(ddl).not.toMatch(prohibidas);
  });

  it('una sola versión vigente por registro: índice único PARCIAL en el motor', () => {
    expect(todo).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_hprac_vigente ON historico.practicas (source_system, source_record_id) WHERE is_current');
    expect(todo).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_hprac_version ON historico.practicas (source_system, source_record_id, version)');
  });

  it('idempotencia y una sola en curso por sistema, garantizadas por índices', () => {
    expect(todo).toMatch(/ux_himp_archivo_completado ON historico\.importaciones \(source_system, file_sha256\) WHERE status = 'completed'/);
    expect(todo).toMatch(/ux_himp_una_en_curso ON historico\.importaciones \(source_system\) WHERE status = 'processing'/);
  });

  it('calidad: solo clean/observed, coherente con las marcas (no existe invalid)', () => {
    expect(todo).toMatch(/quality_status IN \('clean', 'observed'\) AND \(quality_status = 'observed'\) = \(cardinality\(quality_flags\) > 0\)/);
    expect(todo).not.toMatch(/'invalid'/);
  });

  it('versiones inmutables y borrado solo dentro de una reversión; importaciones sin borrado', () => {
    expect(todo).toMatch(/historico\.reversion/);
    expect(todo).toMatch(/solo cambia is_current/);
    expect(todo).toMatch(/tg_himp_sin_borrado BEFORE DELETE ON historico\.importaciones/);
  });

  it('mapping: nunca por nombre, no confirmada sin revisor y SIN FK hacia public.empresas', () => {
    expect(todo).toMatch(/ck_hmap_method CHECK \(method IN \('nit_exacto', 'nit_base_dv', 'manual'\)\)/);
    expect(todo).toMatch(/ck_hmap_revision/);
    expect(todo).not.toMatch(/empresa_id uuid NULL REFERENCES/);
  });

  it('mínimo privilegio: sipra_app sin acceso al esquema', () => {
    expect(todo).toMatch(/REVOKE ALL ON SCHEMA historico FROM PUBLIC/);
    expect(todo).toMatch(/REVOKE ALL ON SCHEMA historico FROM sipra_app/);
    expect(todo).not.toMatch(/GRANT [^;]*historico[^;]*TO sipra_app/);
  });

  it('down se NIEGA con importaciones registradas; sin ellas elimina solo el esquema historico', async () => {
    const conDatos = await sqlDe('down', 3);
    expect(conDatos.error?.message).toMatch(/hay importaciones registradas/);
    expect(conDatos.sql.some((s) => /DROP/.test(s))).toBe(false);
    const vacio = await sqlDe('down', 0);
    expect(vacio.error).toBeUndefined();
    for (const s of vacio.sql.filter((x) => /DROP/.test(x))) expect(s).toMatch(/historico/);
  });
});

describe('Migración de preparación de la carga del histórico · H3 (sin ejecutar)', () => {
  async function sql26(metodo: 'up' | 'down', versiones = 0): Promise<{ sql: string; error?: Error }> {
    const emitido: string[] = [];
    const corredor = { query: (q: string) => { emitido.push(q.replace(/\s+/g, ' ').trim()); return Promise.resolve(/count\(\*\)/.test(q) ? [{ n: versiones }] : undefined); } };
    try {
      await new HistoricoPreparacionCarga1756000026000()[metodo](corredor as unknown as QueryRunner);
      return { sql: emitido.join('\n') };
    } catch (e) {
      return { sql: emitido.join('\n'), error: e as Error };
    }
  }

  it('es la última migración y solo altera tablas del esquema historico', async () => {
    expect(MIGRACIONES[MIGRACIONES.length - 1]).toBe(HistoricoPreparacionCarga1756000026000);
    const { sql } = await sql26('up');
    for (const m of sql.matchAll(/ALTER TABLE\s+([a-z_."]+)/g)) expect(m[1]).toMatch(/^historico\./);
    expect(sql).not.toMatch(/\bpublic\.|UPDATE |INSERT |DELETE /);
  });

  it('separa la calidad de organización y no agrega columnas personales', async () => {
    const { sql } = await sql26('up');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS organization_flags text\[\]/);
    expect(sql).toMatch(/organization_type_hint IN \('LEGAL_ENTITY', 'NATURAL_PERSON', 'UNKNOWN'\)/);
    expect(sql).toMatch(/mapping_status IN \('sin_correspondencia', 'propuesta', 'confirmada', 'rechazada'\)/);
    expect(sql).toMatch(/load_mode IN \('single', 'batched'\)/);
    expect(sql).not.toMatch(/\b(email|correo|telefono|nombre_empresa|jefe|funciones)\b/i);
  });

  it('las versiones H2 existentes (sin pista) siguen siendo válidas: la restricción admite NULL', async () => {
    const { sql } = await sql26('up');
    expect(sql).toMatch(/organization_type_hint IS NULL OR organization_key IS NOT NULL/);
    expect(sql).not.toMatch(/NOT VALID/);
  });

  it('down se NIEGA con versiones; sin ellas quita solo lo que agregó', async () => {
    expect((await sql26('down', 5)).error?.message).toMatch(/hay versiones/);
    const vacio = await sql26('down', 0);
    expect(vacio.error).toBeUndefined();
    expect(vacio.sql).toMatch(/DROP COLUMN IF EXISTS organization_flags/);
    expect(vacio.sql).not.toMatch(/DROP TABLE|DROP SCHEMA/);
  });
});
