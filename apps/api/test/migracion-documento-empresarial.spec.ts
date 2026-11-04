import { QueryRunner } from 'typeorm';
import { ValidacionDocumentoEmpresarial1756000019000 } from '../src/infrastructure/persistence/postgres/migrations/1756000019000-ValidacionDocumentoEmpresarial';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-documento-empresarial.orm-entity';
import { ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import { CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL } from '../src/domain/entities/documento-empresarial';

/**
 * La migración NO se ejecuta aquí: se captura el SQL que emitiría y se verifican las garantías. Su ejecución real
 * contra un PostgreSQL desechable (incluida la violación de cada restricción) la hace
 * `herramientas/verificar-documento-empresarial-pg.ts`.
 */
async function sqlDe(metodo: 'up' | 'down', filasEvidencia = 0): Promise<{ sql: string[]; error?: Error }> {
  const emitido: string[] = [];
  const corredor = {
    query: (sql: string) => {
      emitido.push(sql.replace(/\s+/g, ' ').trim());
      return Promise.resolve(/count\(\*\)/.test(sql) ? [{ n: filasEvidencia }] : undefined);
    },
  };
  try {
    await new ValidacionDocumentoEmpresarial1756000019000()[metodo](corredor as unknown as QueryRunner);
    return { sql: emitido };
  } catch (e) {
    return { sql: emitido, error: e as Error };
  }
}

describe('Migración de validación de documentos empresariales (sin ejecutar)', () => {
  let todo: string;
  beforeAll(async () => { todo = (await sqlDe('up')).sql.join('\n'); });

  it('está registrada DESPUÉS de la Mesa de Actas, y sus entidades en el ORM', () => {
    const i = MIGRACIONES.indexOf(ValidacionDocumentoEmpresarial1756000019000);
    expect(i).toBeGreaterThan(0);
    expect(MIGRACIONES[i - 1].name).toBe('MesaActas1756000018000');
    // La decisión humana (Bloque 4) va justo después: la 19 sigue siendo la base de las validaciones empresariales.
    expect(MIGRACIONES[i + 1].name).toBe('DecisionHumanaDocumentoEmpresarial1756000020000');
    expect(ENTIDADES_ORM).toEqual(expect.arrayContaining([ValidacionDocumentoEmpresarialOrm, EvidenciaValidacionDocEmpresarialOrm]));
  });

  it('es aditiva: solo CREA tablas e índices, no toca datos ni tablas existentes (salvo un índice)', () => {
    expect(todo).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(todo).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(todo).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(todo).not.toMatch(/\bALTER\s+TABLE\b/i);
    // El único DROP es el del disparador propio, para que la migración sea repetible.
    expect(todo.replace('DROP TRIGGER IF EXISTS tg_evidencias_doc_empresarial_inmutable ON evidencias_validacion_doc_empresarial', '')).not.toMatch(/\bDROP\b/i);
    const indices = [...todo.matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)/g)].map((m) => `${m[1]}@${m[2]}`);
    expect(indices).toContain('ix_documentos_practica_tipo_hash@documentos');
  });

  it('una sola validación por documento y claves foráneas a documento, práctica y usuarios', () => {
    expect(todo).toMatch(/CONSTRAINT ux_vdemp_documento UNIQUE \(documento_id\)/);
    expect(todo).toMatch(/documento_id uuid NOT NULL REFERENCES documentos\(id\)/);
    expect(todo).toMatch(/practica_id uuid NOT NULL REFERENCES practicas\(id\)/);
    expect(todo).toMatch(/estudiante_id uuid NOT NULL REFERENCES usuarios\(id\)/);
  });

  it('el estado es de procesamiento: pendiente, procesando, revision o error', () => {
    expect(todo).toMatch(/ck_vdemp_estado CHECK \(estado IN \('pendiente','procesando','revision','error'\)\)/);
  });

  it('la clasificación admite las siete categorías y la familia y la persona salen de ella', () => {
    for (const c of ['rut_persona_natural', 'rut_persona_juridica', 'camara_matricula_persona_natural', 'camara_matricula_sociedad', 'camara_existencia_representacion', 'documento_incorrecto', 'no_determinable']) {
      expect(todo).toContain(`'${c}'`);
    }
    expect(todo).toContain('ck_vdemp_familia_coherente');
    expect(todo).toContain('ck_vdemp_persona_coherente');
    expect(todo).toMatch(/ck_vdemp_sin_contenido/);
    expect(todo).toMatch(/ck_vdemp_pn_sin_representante/);
  });

  it('los datos extraídos rechazan las claves que no se persisten y cualquier bandera de «vigencia»', () => {
    for (const k of CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL) expect(todo).toContain(`'${k}'`);
    for (const k of ['vigente', 'vigencia', 'vencido', 'rutNoVigente']) expect(todo).toContain(`'${k}'`);
    expect(todo).not.toMatch(/\bvigente\s+(boolean|varchar)/i);
  });

  it('la autenticidad es no_verificable por defecto y «verificada» exige una fuente', () => {
    expect(todo).toMatch(/autenticidad_estado varchar\(20\) NOT NULL DEFAULT 'no_verificable'/);
    expect(todo).toMatch(/ck_vdemp_autenticidad_estado CHECK \(autenticidad_estado IN \('verificada','no_verificable','invalida','no_determinable'\)\)/);
    expect(todo).toMatch(/ck_vdemp_verificada_con_fuente[\s\S]*autenticidad->>'fuente' IS NOT NULL/);
  });

  it('el hash es un SHA-256 de 64 hexadecimales', () => {
    expect(todo).toMatch(/ck_vdemp_hash CHECK \(hash_documento IS NULL OR hash_documento ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(todo).toMatch(/ck_edemp_hash/);
  });

  it('no guarda texto OCR completo ni imágenes: no hay columna para ellos', () => {
    expect(todo).not.toMatch(/ (texto|texto_ocr|texto_nativo|imagen|imagenes|ocr) (text|bytea|jsonb|varchar|char)/i);
  });

  it('las evidencias son de solo inserción, idempotentes y sin DELETE para la aplicación', () => {
    expect(todo).toMatch(/CONSTRAINT ux_edemp_idempotencia UNIQUE \(validacion_id, intento, tipo\)/);
    expect(todo).toMatch(/CREATE TRIGGER tg_evidencias_doc_empresarial_inmutable BEFORE UPDATE OR DELETE ON evidencias_validacion_doc_empresarial/);
    expect(todo).toMatch(/GRANT SELECT, INSERT ON TABLE evidencias_validacion_doc_empresarial TO sipra_app/);
    expect(todo).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE validaciones_documento_empresarial TO sipra_app/);
    expect(todo).not.toMatch(/GRANT[^;]*DELETE/);
    expect(todo).toMatch(/ck_edemp_tipo CHECK \(tipo IN \('lectura_documento','clasificacion','comparacion','verificacion','decision_humana'\)\)/);
  });

  it('revertir: bloquea si hay evidencias; sin ellas, elimina solo lo que creó', async () => {
    const conEvidencias = await sqlDe('down', 3);
    expect(conEvidencias.error?.message).toMatch(/solo inserción/);
    expect(conEvidencias.sql.some((s) => /DROP TABLE/.test(s))).toBe(false);
    const limpio = await sqlDe('down', 0);
    expect(limpio.error).toBeUndefined();
    expect(limpio.sql.join('\n')).toMatch(/DROP TABLE IF EXISTS validaciones_documento_empresarial/);
    expect(limpio.sql.join('\n')).not.toMatch(/DROP TABLE IF EXISTS (documentos|usuarios|practicas|empresas|auditoria)/);
  });
});
