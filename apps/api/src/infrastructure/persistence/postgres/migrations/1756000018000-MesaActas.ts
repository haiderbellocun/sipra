import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloque 4 del acta de iniciación · Mesa operativa.
 *
 * Reserva atómica del caso (quién lo tiene y hasta cuándo), motivo de la devolución y constancia de que los datos de la
 * práctica cambiaron DESPUÉS de una decisión humana. Solo agrega columnas nulas y restricciones: no toca filas ni
 * evidencias existentes.
 *
 * Lo que la base impone:
 *  · la reserva es coherente (los tres campos juntos o ninguno, y vence después de empezar);
 *  · solo un caso en `revision` puede estar reservado: decidido, no queda reservado;
 *  · el motivo solo existe en una devolución y es del catálogo.
 *
 * La reversión se NIEGA si ya hay evidencias de cambio de datos de la práctica (son de solo inserción): preferible un
 * fallo explícito a borrar trazabilidad.
 */
export class MesaActas1756000018000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE validaciones_acta_iniciacion
        ADD COLUMN IF NOT EXISTS asignado_a                  uuid REFERENCES usuarios(id),
        ADD COLUMN IF NOT EXISTS reservado_en                timestamptz,
        ADD COLUMN IF NOT EXISTS reserva_hasta               timestamptz,
        ADD COLUMN IF NOT EXISTS motivo_decision             varchar(40),
        ADD COLUMN IF NOT EXISTS datos_practica_cambiaron_en timestamptz`);
    for (const c of ['ck_vacta_reserva', 'ck_vacta_reserva_solo_revision', 'ck_vacta_motivo', 'ck_vacta_motivo_solo_devuelto']) {
      await queryRunner.query(`ALTER TABLE validaciones_acta_iniciacion DROP CONSTRAINT IF EXISTS ${c}`);
    }
    await queryRunner.query(`
      ALTER TABLE validaciones_acta_iniciacion
        ADD CONSTRAINT ck_vacta_reserva CHECK (
          (asignado_a IS NULL AND reservado_en IS NULL AND reserva_hasta IS NULL)
          OR (asignado_a IS NOT NULL AND reservado_en IS NOT NULL AND reserva_hasta IS NOT NULL
              AND reserva_hasta > reservado_en)),
        ADD CONSTRAINT ck_vacta_reserva_solo_revision CHECK (asignado_a IS NULL OR estado = 'revision'),
        ADD CONSTRAINT ck_vacta_motivo CHECK (motivo_decision IS NULL OR motivo_decision IN
          ('documento_incorrecto','informacion_no_coincide','arl_no_coincide','remuneracion_no_coincide',
           'falta_firma_empresa','falta_firma_practicante','documento_ilegible','informacion_incompleta','otro')),
        ADD CONSTRAINT ck_vacta_motivo_solo_devuelto CHECK (motivo_decision IS NULL OR estado = 'devuelto')`);
    // La bandeja filtra por estado abierto y por reserva.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_vacta_mesa ON validaciones_acta_iniciacion (recibida_en)
      WHERE estado = 'revision'`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_vacta_asignado ON validaciones_acta_iniciacion (asignado_a)
      WHERE asignado_a IS NOT NULL`);

    // Nuevo tipo de evidencia: cambio de datos de la práctica con un acta ya cargada.
    await queryRunner.query('ALTER TABLE evidencias_validacion_acta DROP CONSTRAINT IF EXISTS ck_eacta_tipo');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_acta ADD CONSTRAINT ck_eacta_tipo CHECK (tipo IN
        ('lectura_documento','clasificacion_documental','comparacion','medicion_firmas','procesamiento',
         'decision_humana','cambio_datos_practica'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const filas = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM evidencias_validacion_acta WHERE tipo = 'cambio_datos_practica'`,
    )) as { n: number }[];
    if (filas[0].n > 0) {
      throw new Error('No se revierte: hay evidencias de cambio de datos de la práctica, que son de solo inserción');
    }
    await queryRunner.query('ALTER TABLE evidencias_validacion_acta DROP CONSTRAINT IF EXISTS ck_eacta_tipo');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_acta ADD CONSTRAINT ck_eacta_tipo CHECK (tipo IN
        ('lectura_documento','clasificacion_documental','comparacion','medicion_firmas','procesamiento','decision_humana'))`);
    await queryRunner.query('DROP INDEX IF EXISTS ix_vacta_asignado');
    await queryRunner.query('DROP INDEX IF EXISTS ix_vacta_mesa');
    await queryRunner.query(`
      ALTER TABLE validaciones_acta_iniciacion
        DROP CONSTRAINT IF EXISTS ck_vacta_motivo_solo_devuelto,
        DROP CONSTRAINT IF EXISTS ck_vacta_motivo,
        DROP CONSTRAINT IF EXISTS ck_vacta_reserva_solo_revision,
        DROP CONSTRAINT IF EXISTS ck_vacta_reserva`);
    await queryRunner.query(`
      ALTER TABLE validaciones_acta_iniciacion
        DROP COLUMN IF EXISTS datos_practica_cambiaron_en,
        DROP COLUMN IF EXISTS motivo_decision,
        DROP COLUMN IF EXISTS reserva_hasta,
        DROP COLUMN IF EXISTS reservado_en,
        DROP COLUMN IF EXISTS asignado_a`);
  }
}
