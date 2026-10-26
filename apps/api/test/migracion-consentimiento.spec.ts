import { QueryRunner } from 'typeorm';
import { ConsentimientoVersionado1756000010000 } from '../src/infrastructure/persistence/postgres/migrations/1756000010000-ConsentimientoVersionado';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import {
  ConsentimientoOrm, PoliticaConsentimientoOrm,
} from '../src/infrastructure/persistence/postgres/entities/consentimiento.orm-entity';
import { ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';

/**
 * La migración NO se ejecuta aquí ni contra ninguna base: se captura el SQL que
 * emitiría y se verifican las garantías que debe dar (versión única, una activa
 * por tipo, inmutabilidad, solo inserción y mínimo privilegio).
 */

async function sqlDe(metodo: 'up' | 'down'): Promise<string[]> {
  const emitido: string[] = [];
  const corredor = { query: (sql: string) => { emitido.push(sql.replace(/\s+/g, ' ').trim()); return Promise.resolve(); } };
  await new ConsentimientoVersionado1756000010000()[metodo](corredor as unknown as QueryRunner);
  return emitido;
}

describe('Migración de consentimiento versionado (sin ejecutar)', () => {
  let up: string[];
  let todo: string;
  beforeAll(async () => { up = await sqlDe('up'); todo = up.join('\n'); });

  it('está registrada en la lista de migraciones y sus entidades en el ORM', () => {
    // Está registrada, después de la migración 9 y antes de cualquier posterior (p. ej. EPS).
    const posicion = MIGRACIONES.indexOf(ConsentimientoVersionado1756000010000);
    expect(posicion).toBeGreaterThan(0);
    expect(MIGRACIONES[posicion - 1].name).toBe('CronogramaYPqrs1756000009000');
    expect(ENTIDADES_ORM).toEqual(expect.arrayContaining([ConsentimientoOrm, PoliticaConsentimientoOrm]));
  });

  it('políticas: (tipo, versión) único y a lo sumo UNA activa por tipo', () => {
    expect(todo).toMatch(/CONSTRAINT ux_politicas_tipo_version UNIQUE \(tipo, version\)/);
    expect(todo).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ux_politicas_activa_por_tipo ON politicas_consentimiento \(tipo\) WHERE activa/);
  });

  it('políticas: el hash debe corresponder al contenido y una activa no puede estar cerrada', () => {
    expect(todo).toMatch(/texto_sha256 = encode\(sha256\(convert_to\(contenido, 'UTF8'\)\), 'hex'\)/);
    expect(todo).toMatch(/CHECK \(NOT activa OR vigente_hasta IS NULL\)/);
    expect(todo).toMatch(/CHECK \(version >= 1\)/);
  });

  it('políticas: una versión publicada no se edita ni se elimina (solo activa y vigente_hasta cambian)', () => {
    const funcion = up.find((s) => s.includes('politicas_consentimiento_protegida() RETURNS trigger')) ?? '';
    expect(funcion).toMatch(/TG_OP = 'DELETE' THEN RAISE EXCEPTION/);
    for (const columna of ['contenido', 'texto_sha256', 'titulo', 'finalidad', 'version', 'tipo', 'vigente_desde']) {
      expect(funcion).toContain(`NEW.${columna}`);
    }
    // `activa` y `vigente_hasta` quedan fuera de la comparación: son lo único modificable.
    expect(funcion).not.toContain('NEW.activa');
    expect(funcion).not.toContain('NEW.vigente_hasta');
    expect(todo).toMatch(/CREATE TRIGGER tg_politicas_consentimiento_protegida BEFORE UPDATE OR DELETE ON politicas_consentimiento FOR EACH ROW/);
  });

  it('consentimientos: solo inserción, reutilizando el disparador de la auditoría', () => {
    expect(todo).toMatch(/CREATE TRIGGER tg_consentimientos_inmutable BEFORE UPDATE OR DELETE ON consentimientos FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable\(\)/);
    // No se crea una segunda función genérica de inmutabilidad.
    expect(todo).not.toMatch(/CREATE (OR REPLACE )?FUNCTION auditoria_es_inmutable/);
  });

  it('consentimientos: claves foráneas, coherencia de tipo con la política y restricciones', () => {
    expect(todo).toMatch(/usuario_id uuid NOT NULL REFERENCES usuarios\(id\)/);
    expect(todo).toMatch(/registrado_por uuid NOT NULL REFERENCES usuarios\(id\)/);
    expect(todo).toMatch(/practica_id uuid REFERENCES practicas\(id\)/);
    expect(todo).toMatch(/FOREIGN KEY \(politica_id, tipo\) REFERENCES politicas_consentimiento \(id, tipo\)/);
    expect(todo).toMatch(/CONSTRAINT ux_politicas_id_tipo UNIQUE \(id, tipo\)/);
    expect(todo).toMatch(/CHECK \(canal IN \('web','asistido'\)\)/);
    expect(todo).toMatch(/aceptado boolean NOT NULL/);
  });

  it('índices de consulta del historial', () => {
    expect(todo).toMatch(/ix_consentimientos_usuario ON consentimientos \(usuario_id, tipo, creado_en DESC\)/);
    expect(todo).toMatch(/ix_consentimientos_politica ON consentimientos \(politica_id\)/);
  });

  it('mínimo privilegio: el historial sin UPDATE ni DELETE; las políticas sin DELETE', () => {
    const grants = up.filter((s) => s.startsWith('GRANT'));
    expect(grants).toEqual([
      'GRANT SELECT, INSERT ON TABLE consentimientos TO sipra_app',
      'GRANT SELECT, INSERT, UPDATE ON TABLE politicas_consentimiento TO sipra_app',
    ]);
    expect(grants.join(' ')).not.toMatch(/DELETE|TRUNCATE/);
  });

  it('no contiene texto jurídico ni datos de prueba', () => {
    expect(todo).not.toMatch(/INSERT INTO/i);
  });

  it('down revierte lo creado y no toca la función de la auditoría', async () => {
    const down = (await sqlDe('down')).join('\n');
    expect(down).toMatch(/DROP TABLE IF EXISTS consentimientos/);
    expect(down).toMatch(/DROP TABLE IF EXISTS politicas_consentimiento/);
    expect(down).not.toMatch(/DROP FUNCTION IF EXISTS auditoria_es_inmutable/);
  });
});
