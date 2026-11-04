import { QueryRunner } from 'typeorm';
import { DecisionHumanaDocumentoEmpresarial1756000020000 } from '../src/infrastructure/persistence/postgres/migrations/1756000020000-DecisionHumanaDocumentoEmpresarial';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { MotivoDevolucionRut } from '../src/domain/services/mesa-rut.domain-service';

/**
 * La migración NO se ejecuta aquí: se captura el SQL que emitiría. Su ejecución real contra un PostgreSQL desechable (incluida
 * la violación de cada restricción) la hace `herramientas/verificar-decision-rut-pg.ts`.
 */
async function sqlDe(metodo: 'up' | 'down', filas = 0): Promise<{ sql: string[]; error?: Error }> {
  const emitido: string[] = [];
  const corredor = {
    query: (sql: string) => {
      emitido.push(sql.replace(/\s+/g, ' ').trim());
      return Promise.resolve(/count\(\*\)/.test(sql) ? [{ n: filas }] : undefined);
    },
  };
  try {
    await new DecisionHumanaDocumentoEmpresarial1756000020000()[metodo](corredor as unknown as QueryRunner);
    return { sql: emitido };
  } catch (e) {
    return { sql: emitido, error: e as Error };
  }
}

describe('Migración de decisión humana del RUT (sin ejecutar)', () => {
  let up: string;
  beforeAll(async () => { up = (await sqlDe('up')).sql.join('\n'); });

  it('está registrada al final, después de la validación empresarial', () => {
    expect(MIGRACIONES[MIGRACIONES.length - 1]).toBe(DecisionHumanaDocumentoEmpresarial1756000020000);
    expect(MIGRACIONES[MIGRACIONES.length - 2].name).toBe('ValidacionDocumentoEmpresarial1756000019000');
  });

  it('es aditiva: no toca datos ni borra tablas', () => {
    expect(up).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(up).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(up).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(up).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(up).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('agrega quién y cuándo decidió, el motivo, la reserva y la constancia de cambio de datos de SIPRA', () => {
    for (const c of ['decidido_por', 'decidido_en', 'motivo_decision', 'asignado_a', 'reservado_en', 'reserva_hasta', 'datos_sipra_cambiaron_en']) {
      expect(up).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
  });

  it('admite los siete estados y exige quién y cuándo en cada decisión', () => {
    expect(up).toMatch(/ck_vdemp_estado CHECK \(estado IN \('pendiente','procesando','revision','aprobado_manual','devuelto','rechazado','error'\)\)/);
    expect(up).toMatch(/ck_vdemp_decision_humana CHECK \( estado NOT IN \('aprobado_manual','devuelto','rechazado'\) OR \(decidido_por IS NOT NULL AND decidido_en IS NOT NULL\)\)/);
    expect(up).toContain('ck_vdemp_decidido_solo_terminal');
  });

  it('la reserva es coherente y solo existe en un caso en revisión (decidido ⇒ sin reserva)', () => {
    expect(up).toContain('ck_vdemp_reserva CHECK');
    expect(up).toContain('reserva_hasta > reservado_en');
    expect(up).toContain("ck_vdemp_reserva_solo_revision CHECK (asignado_a IS NULL OR estado = 'revision')");
  });

  it('el motivo es del catálogo del dominio, solo existe al devolver y toda devolución lo trae', () => {
    for (const m of Object.values(MotivoDevolucionRut)) expect(up).toContain(`'${m}'`);
    expect(up).toContain("ck_vdemp_motivo_solo_devuelto CHECK (motivo_decision IS NULL OR estado = 'devuelto')");
    expect(up).toContain("ck_vdemp_devuelto_con_motivo CHECK (estado <> 'devuelto' OR motivo_decision IS NOT NULL)");
  });

  it('un caso decidido conserva su lectura y la constancia de cambio solo existe en un caso decidido', () => {
    expect(up).toContain('ck_vdemp_decidida_completa');
    expect(up).toContain('ck_vdemp_cambio_solo_decidida');
  });

  it('agrega el tipo de evidencia cambio_datos_sipra sin quitar ninguno', () => {
    expect(up).toMatch(/ck_edemp_tipo CHECK \(tipo IN \('lectura_documento','clasificacion','comparacion','verificacion','decision_humana','cambio_datos_sipra'\)\)/);
  });

  it('crea los índices de la bandeja y de las reservas', () => {
    expect(up).toContain("ix_vdemp_mesa ON validaciones_documento_empresarial (recibida_en) WHERE estado = 'revision'");
    expect(up).toContain('ix_vdemp_asignado');
  });

  it('la reversión se NIEGA si ya hay decisiones o constancias (evidencias de solo inserción)', async () => {
    const r = await sqlDe('down', 1);
    expect(r.error?.message).toMatch(/No se revierte/);
    expect(r.sql.join('\n')).not.toMatch(/DROP COLUMN/);
  });

  it('sin decisiones la reversión restituye los estados y el tipo de evidencia anteriores', async () => {
    const r = await sqlDe('down', 0);
    expect(r.error).toBeUndefined();
    const sql = r.sql.join('\n');
    expect(sql).toContain("ck_vdemp_estado CHECK (estado IN ('pendiente','procesando','revision','error'))");
    expect(sql).toContain("'verificacion','decision_humana'))");
    expect(sql).toContain('DROP COLUMN IF EXISTS decidido_por');
  });
});
