import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 EPS · consulta ADRES asistida.
 *
 * Agrega a `validaciones_eps` el estado de la consulta ADRES (separado de
 * autenticidad, coincidencia, afiliación y decisión), el tipo de documento
 * confirmado con su origen, la evidencia aportada (hash, quién, cuándo), la
 * comparación triple y la recomendación, y la FUENTE de la afiliación.
 *
 * Los `CHECK` impiden: una consulta sin su identificador, evidencia sin hash o
 * sin quién la aportó, un tipo de documento «confirmado» sin persona, y afirmar
 * una afiliación (`activa`/`inactiva`) sin fuente (un verificador oficial o una
 * consulta ADRES procesada). No se guardan CAPTCHA, cookies ni sesiones.
 */
export class ConsultaAdres1756000014000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        ADD COLUMN IF NOT EXISTS afiliacion_fuente             varchar(20),
        ADD COLUMN IF NOT EXISTS adres_estado                  varchar(20) NOT NULL DEFAULT 'no_requerido',
        ADD COLUMN IF NOT EXISTS adres_consulta_id             uuid,
        ADD COLUMN IF NOT EXISTS adres_consulta_vence_en       timestamptz,
        ADD COLUMN IF NOT EXISTS adres_preparada_por           uuid REFERENCES usuarios(id),
        ADD COLUMN IF NOT EXISTS adres_preparada_en            timestamptz,
        ADD COLUMN IF NOT EXISTS tipo_documento                varchar(4),
        ADD COLUMN IF NOT EXISTS tipo_documento_origen         varchar(25),
        ADD COLUMN IF NOT EXISTS tipo_documento_confirmado_por uuid REFERENCES usuarios(id),
        ADD COLUMN IF NOT EXISTS adres_consultado_en           timestamptz,
        ADD COLUMN IF NOT EXISTS adres_fuente_actualizada_en   timestamptz,
        ADD COLUMN IF NOT EXISTS adres_evidencia_hash          char(64),
        ADD COLUMN IF NOT EXISTS adres_cargada_por             uuid REFERENCES usuarios(id),
        ADD COLUMN IF NOT EXISTS adres_cargada_en              timestamptz,
        ADD COLUMN IF NOT EXISTS adres_referencia_archivo      varchar(300),
        ADD COLUMN IF NOT EXISTS adres_error                   varchar(40),
        ADD COLUMN IF NOT EXISTS adres_datos                   jsonb,
        ADD COLUMN IF NOT EXISTS adres_comparacion             jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS adres_recomendacion           varchar(40)`);

    // Datos existentes: la afiliación que ya estableció un verificador conserva su fuente; y lo que
    // sigue sin contrastar pasa a «pendiente de ADRES».
    await queryRunner.query(`
      UPDATE validaciones_eps SET afiliacion_fuente = 'verificador_oficial'
      WHERE afiliacion IN ('activa','inactiva') AND verificador_codigo IS NOT NULL`);
    await queryRunner.query(`
      UPDATE validaciones_eps SET adres_estado = 'pendiente'
      WHERE estado_procesamiento = 'procesado' AND afiliacion IN ('no_contrastada','no_determinable')
        AND decision NOT IN ('aprobado_manual','devuelto','rechazado')`);

    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        ADD CONSTRAINT ck_veps_adres_estado CHECK (adres_estado IN
          ('no_requerido','pendiente','en_consulta','evidencia_recibida','procesado','error','no_determinable')),
        ADD CONSTRAINT ck_veps_adres_recomendacion CHECK (adres_recomendacion IS NULL OR adres_recomendacion IN
          ('candidato_autoaprobacion','recomendar_revision_documental','recomendar_revision_rechazo','discrepancia_critica',
           'pendiente_adres','informacion_insuficiente')),
        ADD CONSTRAINT ck_veps_tipo_documento CHECK (tipo_documento IS NULL OR tipo_documento IN ('CC','TI','CE','PA')),
        ADD CONSTRAINT ck_veps_tipo_documento_origen CHECK (tipo_documento_origen IS NULL OR tipo_documento_origen IN
          ('sinu','institucional','solicitud_arl','confirmacion_humana')),
        ADD CONSTRAINT ck_veps_tipo_confirmacion CHECK (
          tipo_documento_origen IS DISTINCT FROM 'confirmacion_humana' OR tipo_documento_confirmado_por IS NOT NULL),
        ADD CONSTRAINT ck_veps_adres_consulta CHECK (
          adres_estado <> 'en_consulta'
          OR (adres_consulta_id IS NOT NULL AND adres_consulta_vence_en IS NOT NULL
              AND adres_preparada_por IS NOT NULL AND tipo_documento IS NOT NULL)),
        ADD CONSTRAINT ck_veps_adres_evidencia CHECK (
          adres_estado NOT IN ('evidencia_recibida','procesado')
          OR (adres_evidencia_hash IS NOT NULL AND adres_cargada_por IS NOT NULL AND adres_cargada_en IS NOT NULL)),
        ADD CONSTRAINT ck_veps_afiliacion_fuente_valor CHECK (afiliacion_fuente IS NULL OR afiliacion_fuente IN
          ('verificador_oficial','adres_bdua'))`);

    // La afiliación establecida exige una fuente: un verificador oficial o una consulta ADRES procesada.
    await queryRunner.query('ALTER TABLE validaciones_eps DROP CONSTRAINT IF EXISTS ck_veps_requiere_verificador');
    await queryRunner.query(`
      ALTER TABLE validaciones_eps ADD CONSTRAINT ck_veps_requiere_verificador CHECK (
        (autenticidad NOT IN ('verificada','invalida') OR (verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL))
        AND (afiliacion NOT IN ('activa','inactiva') OR afiliacion_fuente IS NOT NULL)
        AND (afiliacion_fuente IS DISTINCT FROM 'verificador_oficial' OR (verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL))
        AND (afiliacion_fuente IS DISTINCT FROM 'adres_bdua' OR adres_estado = 'procesado'))`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_veps_adres ON validaciones_eps (adres_estado, actualizada_en)
      WHERE adres_estado <> 'no_requerido'`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_evidencias_eps_hash ON evidencias_validacion_eps (hash_evidencia)
      WHERE tipo = 'adres'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ix_evidencias_eps_hash');
    await queryRunner.query('DROP INDEX IF EXISTS ix_veps_adres');
    await queryRunner.query('ALTER TABLE validaciones_eps DROP CONSTRAINT IF EXISTS ck_veps_requiere_verificador');
    await queryRunner.query(`
      ALTER TABLE validaciones_eps ADD CONSTRAINT ck_veps_requiere_verificador CHECK (
        (autenticidad NOT IN ('verificada','invalida') AND afiliacion NOT IN ('activa','inactiva'))
        OR (verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL))`);
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        DROP CONSTRAINT IF EXISTS ck_veps_afiliacion_fuente_valor,
        DROP CONSTRAINT IF EXISTS ck_veps_adres_evidencia,
        DROP CONSTRAINT IF EXISTS ck_veps_adres_consulta,
        DROP CONSTRAINT IF EXISTS ck_veps_tipo_confirmacion,
        DROP CONSTRAINT IF EXISTS ck_veps_tipo_documento_origen,
        DROP CONSTRAINT IF EXISTS ck_veps_tipo_documento,
        DROP CONSTRAINT IF EXISTS ck_veps_adres_recomendacion,
        DROP CONSTRAINT IF EXISTS ck_veps_adres_estado`);
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        DROP COLUMN IF EXISTS adres_recomendacion, DROP COLUMN IF EXISTS adres_comparacion, DROP COLUMN IF EXISTS adres_datos,
        DROP COLUMN IF EXISTS adres_error, DROP COLUMN IF EXISTS adres_referencia_archivo, DROP COLUMN IF EXISTS adres_cargada_en,
        DROP COLUMN IF EXISTS adres_cargada_por, DROP COLUMN IF EXISTS adres_evidencia_hash,
        DROP COLUMN IF EXISTS adres_fuente_actualizada_en, DROP COLUMN IF EXISTS adres_consultado_en,
        DROP COLUMN IF EXISTS tipo_documento_confirmado_por, DROP COLUMN IF EXISTS tipo_documento_origen,
        DROP COLUMN IF EXISTS tipo_documento, DROP COLUMN IF EXISTS adres_preparada_en, DROP COLUMN IF EXISTS adres_preparada_por,
        DROP COLUMN IF EXISTS adres_consulta_vence_en, DROP COLUMN IF EXISTS adres_consulta_id, DROP COLUMN IF EXISTS adres_estado,
        DROP COLUMN IF EXISTS afiliacion_fuente`);
  }
}
