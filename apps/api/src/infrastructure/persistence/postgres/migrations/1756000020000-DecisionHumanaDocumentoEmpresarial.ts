import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloque 4 de documentos empresariales (RUT) · decisión humana y reserva operativa.
 *
 * Amplía `validaciones_documento_empresarial` con los estados de decisión (`aprobado_manual`, `devuelto`, `rechazado`), quién y
 * cuándo decidió, el motivo de la devolución, la reserva del caso (quién lo tiene y hasta cuándo) y la constancia de que los
 * datos de SIPRA cambiaron DESPUÉS de una decisión. Solo agrega columnas nulas y restricciones: no toca filas ni evidencias.
 *
 * Lo que la base impone:
 *  · una decisión humana siempre dice quién y cuándo, y solo un estado terminal los trae;
 *  · la reserva es coherente (los tres campos juntos o ninguno) y solo un caso en `revision` puede estar reservado: decidido, no
 *    queda reservado;
 *  · el motivo solo existe en una devolución y es del catálogo; toda devolución trae motivo;
 *  · un caso decidido sigue teniendo su lectura (tipo detectado, hash y fecha de procesamiento);
 *  · la constancia de «datos de SIPRA cambiaron» solo existe en un caso decidido.
 *
 * La reversión se NIEGA si ya hay decisiones o constancias (las evidencias son de solo inserción): preferible un fallo
 * explícito a borrar trazabilidad o a dejar estados que el esquema anterior no admite.
 */
export class DecisionHumanaDocumentoEmpresarial1756000020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial
        ADD COLUMN IF NOT EXISTS decidido_por               uuid REFERENCES usuarios(id),
        ADD COLUMN IF NOT EXISTS decidido_en                timestamptz,
        ADD COLUMN IF NOT EXISTS motivo_decision            varchar(40),
        ADD COLUMN IF NOT EXISTS asignado_a                 uuid REFERENCES usuarios(id),
        ADD COLUMN IF NOT EXISTS reservado_en               timestamptz,
        ADD COLUMN IF NOT EXISTS reserva_hasta              timestamptz,
        ADD COLUMN IF NOT EXISTS datos_sipra_cambiaron_en   timestamptz`);
    for (const c of [
      'ck_vdemp_estado', 'ck_vdemp_decision_humana', 'ck_vdemp_decidido_solo_terminal', 'ck_vdemp_reserva', 'ck_vdemp_reserva_solo_revision',
      'ck_vdemp_motivo', 'ck_vdemp_motivo_solo_devuelto', 'ck_vdemp_devuelto_con_motivo', 'ck_vdemp_decidida_completa', 'ck_vdemp_cambio_solo_decidida',
    ]) {
      await queryRunner.query(`ALTER TABLE validaciones_documento_empresarial DROP CONSTRAINT IF EXISTS ${c}`);
    }
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial
        ADD CONSTRAINT ck_vdemp_estado CHECK (estado IN
          ('pendiente','procesando','revision','aprobado_manual','devuelto','rechazado','error')),
        ADD CONSTRAINT ck_vdemp_decision_humana CHECK (
          estado NOT IN ('aprobado_manual','devuelto','rechazado') OR (decidido_por IS NOT NULL AND decidido_en IS NOT NULL)),
        ADD CONSTRAINT ck_vdemp_decidido_solo_terminal CHECK (
          (decidido_por IS NULL AND decidido_en IS NULL) OR estado IN ('aprobado_manual','devuelto','rechazado')),
        ADD CONSTRAINT ck_vdemp_reserva CHECK (
          (asignado_a IS NULL AND reservado_en IS NULL AND reserva_hasta IS NULL)
          OR (asignado_a IS NOT NULL AND reservado_en IS NOT NULL AND reserva_hasta IS NOT NULL AND reserva_hasta > reservado_en)),
        ADD CONSTRAINT ck_vdemp_reserva_solo_revision CHECK (asignado_a IS NULL OR estado = 'revision'),
        ADD CONSTRAINT ck_vdemp_motivo CHECK (motivo_decision IS NULL OR motivo_decision IN
          ('documento_incorrecto','persona_no_coincide','rut_no_corresponde','documento_no_coincide','nombre_no_coincide',
           'nit_no_coincide','dv_no_coincide','razon_social_no_coincide','documento_ilegible','informacion_incompleta','otro')),
        ADD CONSTRAINT ck_vdemp_motivo_solo_devuelto CHECK (motivo_decision IS NULL OR estado = 'devuelto'),
        ADD CONSTRAINT ck_vdemp_devuelto_con_motivo CHECK (estado <> 'devuelto' OR motivo_decision IS NOT NULL),
        ADD CONSTRAINT ck_vdemp_decidida_completa CHECK (
          estado NOT IN ('aprobado_manual','devuelto','rechazado')
          OR (tipo_detectado IS NOT NULL AND procesada_en IS NOT NULL AND hash_documento IS NOT NULL)),
        ADD CONSTRAINT ck_vdemp_cambio_solo_decidida CHECK (
          datos_sipra_cambiaron_en IS NULL OR estado IN ('aprobado_manual','devuelto','rechazado'))`);
    // La bandeja filtra por estado abierto y por reserva.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_vdemp_mesa ON validaciones_documento_empresarial (recibida_en) WHERE estado = 'revision'`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_vdemp_asignado ON validaciones_documento_empresarial (asignado_a) WHERE asignado_a IS NOT NULL`);

    // Nuevo tipo de evidencia: los datos de SIPRA cambiaron después de una decisión (constancia; la decisión no se toca).
    await queryRunner.query('ALTER TABLE evidencias_validacion_doc_empresarial DROP CONSTRAINT IF EXISTS ck_edemp_tipo');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_doc_empresarial ADD CONSTRAINT ck_edemp_tipo CHECK (tipo IN
        ('lectura_documento','clasificacion','comparacion','verificacion','decision_humana','cambio_datos_sipra'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const decididas = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE estado IN ('aprobado_manual','devuelto','rechazado')`,
    )) as { n: number }[];
    const evidencias = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM evidencias_validacion_doc_empresarial WHERE tipo IN ('decision_humana','cambio_datos_sipra')`,
    )) as { n: number }[];
    if (decididas[0].n > 0 || evidencias[0].n > 0) {
      throw new Error('No se revierte: hay decisiones humanas o constancias sobre RUT, cuyas evidencias son de solo inserción');
    }
    await queryRunner.query('ALTER TABLE evidencias_validacion_doc_empresarial DROP CONSTRAINT IF EXISTS ck_edemp_tipo');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_doc_empresarial ADD CONSTRAINT ck_edemp_tipo CHECK (tipo IN
        ('lectura_documento','clasificacion','comparacion','verificacion','decision_humana'))`);
    await queryRunner.query('DROP INDEX IF EXISTS ix_vdemp_asignado');
    await queryRunner.query('DROP INDEX IF EXISTS ix_vdemp_mesa');
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial
        DROP CONSTRAINT IF EXISTS ck_vdemp_cambio_solo_decidida,
        DROP CONSTRAINT IF EXISTS ck_vdemp_decidida_completa,
        DROP CONSTRAINT IF EXISTS ck_vdemp_devuelto_con_motivo,
        DROP CONSTRAINT IF EXISTS ck_vdemp_motivo_solo_devuelto,
        DROP CONSTRAINT IF EXISTS ck_vdemp_motivo,
        DROP CONSTRAINT IF EXISTS ck_vdemp_reserva_solo_revision,
        DROP CONSTRAINT IF EXISTS ck_vdemp_reserva,
        DROP CONSTRAINT IF EXISTS ck_vdemp_decidido_solo_terminal,
        DROP CONSTRAINT IF EXISTS ck_vdemp_decision_humana,
        DROP CONSTRAINT IF EXISTS ck_vdemp_estado`);
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial
        ADD CONSTRAINT ck_vdemp_estado CHECK (estado IN ('pendiente','procesando','revision','error'))`);
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial
        DROP COLUMN IF EXISTS datos_sipra_cambiaron_en,
        DROP COLUMN IF EXISTS reserva_hasta,
        DROP COLUMN IF EXISTS reservado_en,
        DROP COLUMN IF EXISTS asignado_a,
        DROP COLUMN IF EXISTS motivo_decision,
        DROP COLUMN IF EXISTS decidido_en,
        DROP COLUMN IF EXISTS decidido_por`);
  }
}
