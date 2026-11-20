import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico del SGP · H2 (infraestructura de importación). §26 de `docs/HISTORICO-PRACTICAS-AUDITORIA.md`.
 *
 * Crea el esquema `historico`, COMPLETAMENTE separado de la operación: no altera ni referencia ninguna tabla de
 * `public` (ni `practicas`, ni `usuarios`, ni `empresas`). Variante MINIMIZADA: no existe ninguna columna para nombre,
 * correo o teléfono del estudiante, nombre del docente, datos del jefe inmediato ni funciones; tampoco una copia JSON
 * de la fila. Estudiante, docente y organización viven como claves HMAC con su versión de clave.
 *
 * Garantías en el motor (no solo en el código):
 *  - una sola versión vigente por (source_system, source_record_id): índice único parcial;
 *  - una versión no se edita: solo puede cambiar `is_current` (disparador);
 *  - una versión solo se borra dentro de una reversión de importación (`historico.reversion` en la transacción);
 *  - una importación no se borra; solo una `completed` por archivo y sistema; solo una `processing` por sistema;
 *  - `quality_status` coherente con las marcas: `observed` si y solo si hay marcas; no existe `invalid`;
 *  - `organizacion_mapping` nunca por nombre y nunca confirmada sin revisor; no hay FK a `public.empresas` para que
 *    la desaparición de una organización operativa no borre ni bloquee el histórico.
 *  - el rol de aplicación (`sipra_app`) no tiene ningún privilegio sobre el esquema: la API no lo lee (H3/H4).
 *
 * Reversión: solo si el esquema está vacío. Con datos importados se NIEGA (una base con histórico no se baja a
 * ciegas: primero se revierten las importaciones).
 */
export class HistoricoSgp1756000025000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS historico');
    await queryRunner.query('REVOKE ALL ON SCHEMA historico FROM PUBLIC');
    await queryRunner.query(`COMMENT ON SCHEMA historico IS
      'Histórico del SGP (sistema anterior). Solo analítica; separado de la operación. Variante minimizada: sin datos personales directos.'`);

    // ── Importaciones ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.importaciones (
        id                  uuid PRIMARY KEY,
        source_system       varchar(20) NOT NULL,
        file_name           varchar(255) NOT NULL,
        file_sha256         char(64) NOT NULL,
        file_size_bytes     bigint NULL,
        source_cutoff_date  timestamptz NULL,
        hmac_key_version    varchar(10) NOT NULL,
        importer_version    varchar(40) NOT NULL,
        started_at          timestamptz NOT NULL DEFAULT now(),
        finished_at         timestamptz NULL,
        status              varchar(12) NOT NULL,
        row_count_file      integer NOT NULL DEFAULT 0,
        row_count_real      integer NOT NULL DEFAULT 0,
        row_count_imported  integer NOT NULL DEFAULT 0,
        row_count_unchanged integer NOT NULL DEFAULT 0,
        row_count_versioned integer NOT NULL DEFAULT 0,
        row_count_observed  integer NOT NULL DEFAULT 0,
        row_count_missing   integer NULL,
        reverted_at         timestamptz NULL,
        metadata            jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT ck_himp_source_system CHECK (source_system IN ('SGP', 'SGP_SINTETICO')),
        CONSTRAINT ck_himp_sha256 CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_himp_key_version CHECK (hmac_key_version ~ '^v[0-9]{1,4}$'),
        CONSTRAINT ck_himp_status CHECK (status IN ('processing', 'completed', 'failed', 'reverted')),
        CONSTRAINT ck_himp_conteos CHECK (row_count_file >= 0 AND row_count_real >= 0 AND row_count_imported >= 0
          AND row_count_unchanged >= 0 AND row_count_versioned >= 0 AND row_count_observed >= 0
          AND (row_count_missing IS NULL OR row_count_missing >= 0) AND row_count_real <= row_count_file),
        CONSTRAINT ck_himp_fin CHECK ((status = 'processing') = (finished_at IS NULL)),
        CONSTRAINT ck_himp_revertida CHECK ((status = 'reverted') = (reverted_at IS NOT NULL)),
        CONSTRAINT ck_himp_metadata CHECK (jsonb_typeof(metadata) = 'object')
      )`);
    // Idempotencia por archivo: una sola importación vigente del mismo SHA-256 en el mismo sistema.
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_himp_archivo_completado
      ON historico.importaciones (source_system, file_sha256) WHERE status = 'completed'`);
    // Segunda barrera (además del bloqueo consultivo): una sola importación en curso por sistema.
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_himp_una_en_curso
      ON historico.importaciones (source_system) WHERE status = 'processing'`);

    // ── Prácticas históricas (una fila = una VERSIÓN de un registro SGP) ─────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.practicas (
        id                              uuid PRIMARY KEY,
        importacion_id                  uuid NOT NULL REFERENCES historico.importaciones (id) ON DELETE RESTRICT,
        source_system                   varchar(20) NOT NULL,
        source_record_id                varchar(40) NOT NULL,
        source_row                      integer NOT NULL,
        version                         integer NOT NULL,
        is_current                      boolean NOT NULL,
        content_hash                    char(64) NOT NULL,
        hmac_key_version                varchar(10) NOT NULL,
        student_key                     char(64) NULL,
        teacher_key                     char(64) NULL,

        programa_original               varchar(200) NULL,
        programa_normalizado            varchar(200) NULL,
        codigo_sinu                     varchar(60) NULL,
        programa_mapping_status         varchar(32) NOT NULL,
        regional_original               varchar(120) NULL,
        regional                        varchar(120) NULL,
        nivel_original                  varchar(60) NULL,
        nivel_inferido                  varchar(20) NULL,
        nivel_fuente                    varchar(20) NOT NULL,
        asignatura_original             varchar(200) NULL,
        codigo_asignatura               varchar(40) NULL,
        semestre_creditos               smallint NULL,
        modalidad_estudio_original      varchar(60) NULL,
        modalidad_estudio_normalizada   varchar(20) NULL,
        pensum                          varchar(40) NULL,

        periodo_original                varchar(40) NULL,
        periodo_normalizado             varchar(12) NULL,
        periodo_formato                 varchar(24) NOT NULL,
        periodo_anio                    smallint NULL,
        periodo_ordinal                 varchar(4) NULL,
        periodo_mapping_status          varchar(32) NOT NULL,

        modalidad_practica_original     varchar(120) NULL,
        modalidad_practica_normalizada  varchar(40) NULL,
        modalidad_mapping_status        varchar(32) NOT NULL,
        estado_original                 varchar(60) NULL,
        estado_analitico                varchar(20) NULL,
        estado_mapping_status           varchar(32) NOT NULL,
        es_estado_de_corte              boolean NOT NULL,
        estado_fecha_corte              timestamptz NULL,

        organization_key                char(64) NULL,
        organization_identifier_kind    varchar(20) NOT NULL,
        nit_dv_valid                    boolean NULL,
        nit_juridica                    varchar(15) NULL,
        empresa_alias_hash              char(64) NULL,

        area                            varchar(120) NULL,
        cargo_estudiante                varchar(300) NULL,
        horario                         varchar(300) NULL,
        ciudad_original                 varchar(200) NULL,
        ciudad_normalizada              varchar(200) NULL,

        fecha_inicio_original           varchar(40) NULL,
        fecha_inicio                    date NULL,
        fecha_fin_original              varchar(40) NULL,
        fecha_fin                       date NULL,
        duracion_dias                   integer NULL,
        fecha_creacion                  date NULL,
        ultimo_movimiento_estudiante    timestamptz NULL,
        ultimo_movimiento_docente       timestamptz NULL,

        salario_original                varchar(40) NULL,
        salario_normalizado             bigint NULL,
        salario_calidad                 varchar(20) NOT NULL,

        documentos_subidos_ratio        numeric(4,3) NULL,
        documentos_aprobados_ratio      numeric(4,3) NULL,
        bitacora_count                  integer NULL,

        quality_status                  varchar(10) NOT NULL,
        quality_flags                   text[] NOT NULL DEFAULT '{}',
        created_at                      timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT ck_hprac_source_system CHECK (source_system IN ('SGP', 'SGP_SINTETICO')),
        CONSTRAINT ck_hprac_version CHECK (version >= 1),
        CONSTRAINT ck_hprac_source_row CHECK (source_row >= 2),
        CONSTRAINT ck_hprac_hashes CHECK (content_hash ~ '^[0-9a-f]{64}$'
          AND (student_key IS NULL OR student_key ~ '^[0-9a-f]{64}$')
          AND (teacher_key IS NULL OR teacher_key ~ '^[0-9a-f]{64}$')
          AND (organization_key IS NULL OR organization_key ~ '^[0-9a-f]{64}$')
          AND (empresa_alias_hash IS NULL OR empresa_alias_hash ~ '^[0-9a-f]{64}$')),
        CONSTRAINT ck_hprac_key_version CHECK (hmac_key_version ~ '^v[0-9]{1,4}$'),
        CONSTRAINT ck_hprac_quality CHECK (quality_status IN ('clean', 'observed')
          AND (quality_status = 'observed') = (cardinality(quality_flags) > 0)),
        CONSTRAINT ck_hprac_nivel CHECK ((nivel_inferido IS NULL OR nivel_inferido IN ('tecnico', 'tecnologo', 'profesional'))
          AND nivel_fuente IN ('nivel_formacion', 'nombre_asignatura', 'unknown')),
        CONSTRAINT ck_hprac_modalidad_estudio CHECK (modalidad_estudio_normalizada IS NULL
          OR modalidad_estudio_normalizada IN ('virtual', 'presencial', 'a_distancia')),
        CONSTRAINT ck_hprac_periodo CHECK (periodo_formato IN ('presencial', 'virtual', '335', 'intersemestral_legacy', 'trimestral_legacy', 'unknown')
          AND periodo_mapping_status IN ('FORMAT_COMPATIBLE', 'LEGACY', 'UNPARSEABLE', 'MISSING')
          AND ((periodo_mapping_status = 'FORMAT_COMPATIBLE') = (periodo_normalizado IS NOT NULL))),
        CONSTRAINT ck_hprac_mapeos CHECK (
          programa_mapping_status IN ('MAPPED', 'PENDING_INSTITUTIONAL_MAPPING', 'UNMAPPED', 'MISSING')
          AND modalidad_mapping_status IN ('MAPPED', 'PENDING_INSTITUTIONAL_MAPPING', 'UNMAPPED', 'MISSING')
          AND estado_mapping_status IN ('MAPPED', 'PENDING_INSTITUTIONAL_MAPPING', 'UNMAPPED', 'MISSING')
          AND ((modalidad_mapping_status = 'MAPPED') = (modalidad_practica_normalizada IS NOT NULL))
          AND ((estado_mapping_status = 'MAPPED') = (estado_analitico IS NOT NULL))
          AND (codigo_sinu IS NULL OR programa_mapping_status = 'MAPPED')),
        CONSTRAINT ck_hprac_estado CHECK ((estado_analitico IS NULL OR estado_analitico IN ('inscrito', 'en_practica', 'anulado', 'reprobado', 'cerrado'))
          AND (NOT es_estado_de_corte OR estado_analitico IN ('inscrito', 'en_practica'))),
        CONSTRAINT ck_hprac_organizacion CHECK (organization_identifier_kind IN ('juridica', 'persona_natural', 'indeterminado', 'no_estandar', 'invalido', 'ausente')
          AND (nit_juridica IS NULL OR (organization_identifier_kind = 'juridica' AND nit_dv_valid AND nit_juridica ~ '^[89][0-9]{8}$'))
          AND ((organization_key IS NULL) = (organization_identifier_kind IN ('invalido', 'ausente')))),
        CONSTRAINT ck_hprac_fechas CHECK (duracion_dias IS NULL OR (duracion_dias >= 0 AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL)),
        CONSTRAINT ck_hprac_salario CHECK (salario_calidad IN ('exacto', 'no_remunerado', 'referencia_smmlv', 'atipico', 'no_interpretable', 'ausente')
          AND (salario_calidad <> 'exacto' OR (salario_normalizado IS NOT NULL AND salario_normalizado > 0))),
        CONSTRAINT ck_hprac_seguimiento CHECK ((documentos_subidos_ratio IS NULL OR documentos_subidos_ratio BETWEEN 0 AND 1)
          AND (documentos_aprobados_ratio IS NULL OR documentos_aprobados_ratio BETWEEN 0 AND 1)
          AND (bitacora_count IS NULL OR bitacora_count >= 0)
          AND (semestre_creditos IS NULL OR semestre_creditos BETWEEN 1 AND 12))
      )`);
    // Identidad del registro y lectura de su historia (también sirve de búsqueda por id de origen).
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hprac_version
      ON historico.practicas (source_system, source_record_id, version)`);
    // Una sola versión vigente por registro, garantizada por el motor.
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hprac_vigente
      ON historico.practicas (source_system, source_record_id) WHERE is_current`);
    // Reversión por importación y FK sin índice → borrado lento: se indexa.
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_hprac_importacion ON historico.practicas (importacion_id)');
    // Consultas analíticas futuras siempre sobre lo vigente: índices parciales, más pequeños.
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_hprac_estudiante ON historico.practicas (student_key) WHERE is_current');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_hprac_docente ON historico.practicas (teacher_key) WHERE is_current');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_hprac_periodo ON historico.practicas (periodo_normalizado) WHERE is_current');
    // Refresco del catálogo de organizaciones (GROUP BY por sistema y clave).
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_hprac_organizacion
      ON historico.practicas (source_system, organization_key) WHERE is_current`);

    // Una versión no se edita (solo cambia cuál es la vigente) y solo se borra dentro de una reversión.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION historico.fn_practicas_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF coalesce(current_setting('historico.reversion', true), '') <> 'on' THEN
            RAISE EXCEPTION 'historico.practicas: una versión solo se retira revirtiendo su importación';
          END IF;
          RETURN OLD;
        END IF;
        IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
          RAISE EXCEPTION 'historico.practicas: una versión es inmutable (solo cambia is_current)';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_hprac_inmutable ON historico.practicas');
    await queryRunner.query(`CREATE TRIGGER tg_hprac_inmutable BEFORE UPDATE OR DELETE ON historico.practicas
      FOR EACH ROW EXECUTE FUNCTION historico.fn_practicas_inmutable()`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION historico.fn_importaciones_sin_borrado() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'historico.importaciones: una importación no se borra (se revierte)';
      END $$`);
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_himp_sin_borrado ON historico.importaciones');
    await queryRunner.query(`CREATE TRIGGER tg_himp_sin_borrado BEFORE DELETE ON historico.importaciones
      FOR EACH ROW EXECUTE FUNCTION historico.fn_importaciones_sin_borrado()`);

    // ── Organizaciones históricas (catálogo derivado de lo vigente) ────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.organizaciones (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_system       varchar(20) NOT NULL,
        organization_key    char(64) NOT NULL,
        hmac_key_version    varchar(10) NOT NULL,
        identifier_kind     varchar(20) NOT NULL,
        nit_juridica        varchar(15) NULL,
        nit_dv_valid        boolean NULL,
        record_count        integer NOT NULL DEFAULT 0,
        alias_count         integer NOT NULL DEFAULT 0,
        quality_flags       text[] NOT NULL DEFAULT '{}',
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ux_horg_clave UNIQUE (source_system, organization_key, hmac_key_version),
        CONSTRAINT ck_horg_source_system CHECK (source_system IN ('SGP', 'SGP_SINTETICO')),
        CONSTRAINT ck_horg_clave CHECK (organization_key ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_horg_kind CHECK (identifier_kind IN ('juridica', 'persona_natural', 'indeterminado', 'no_estandar')),
        CONSTRAINT ck_horg_nit CHECK (nit_juridica IS NULL OR (identifier_kind = 'juridica' AND nit_juridica ~ '^[89][0-9]{8}$')),
        CONSTRAINT ck_horg_conteos CHECK (record_count >= 0 AND alias_count >= 0)
      )`);
    // Alias seudónimos: detectan «un identificador con varios nombres» sin guardar el nombre (podría ser una persona).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.organizacion_alias (
        source_system          varchar(20) NOT NULL,
        organization_key       char(64) NOT NULL,
        hmac_key_version       varchar(10) NOT NULL,
        alias_hash             char(64) NOT NULL,
        normalization_version  varchar(10) NOT NULL,
        frecuencia             integer NOT NULL,
        PRIMARY KEY (source_system, organization_key, hmac_key_version, alias_hash),
        FOREIGN KEY (source_system, organization_key, hmac_key_version)
          REFERENCES historico.organizaciones (source_system, organization_key, hmac_key_version) ON DELETE CASCADE,
        CONSTRAINT ck_halias_hash CHECK (alias_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_halias_frecuencia CHECK (frecuencia > 0)
      )`);
    // Correspondencia futura con la organización de SIPRA. H2 no crea ninguna; nunca por nombre.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.organizacion_mapping (
        id                  uuid PRIMARY KEY,
        organizacion_id     uuid NOT NULL REFERENCES historico.organizaciones (id) ON DELETE RESTRICT,
        empresa_id          uuid NULL,
        method              varchar(20) NOT NULL,
        status              varchar(12) NOT NULL,
        confidence          numeric(3,2) NULL,
        reviewed_by         uuid NULL,
        reviewed_at         timestamptz NULL,
        notes               varchar(500) NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_hmap_method CHECK (method IN ('nit_exacto', 'nit_base_dv', 'manual')),
        CONSTRAINT ck_hmap_status CHECK (status IN ('propuesta', 'confirmada', 'rechazada')),
        CONSTRAINT ck_hmap_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
        CONSTRAINT ck_hmap_revision CHECK (status = 'propuesta' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
        CONSTRAINT ck_hmap_confirmada CHECK (status <> 'confirmada' OR empresa_id IS NOT NULL)
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hmap_confirmada
      ON historico.organizacion_mapping (organizacion_id) WHERE status = 'confirmada'`);

    // Mínimo privilegio: el rol de la aplicación no ve el esquema (la API no lo lee en H2).
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sipra_app') THEN
          REVOKE ALL ON ALL TABLES IN SCHEMA historico FROM sipra_app;
          REVOKE ALL ON SCHEMA historico FROM sipra_app;
        END IF;
      END $$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const existe = await queryRunner.query(`SELECT to_regclass('historico.importaciones') IS NOT NULL AS hay`) as { hay: boolean }[];
    if (existe?.[0]?.hay) {
      const filas = await queryRunner.query('SELECT count(*)::int AS n FROM historico.importaciones') as { n: number }[];
      if ((filas?.[0]?.n ?? 0) > 0) {
        throw new Error('HistoricoSgp: hay importaciones registradas en historico.importaciones; revierta y archive el histórico antes de bajar esta migración');
      }
    }
    await queryRunner.query('DROP TABLE IF EXISTS historico.organizacion_mapping');
    await queryRunner.query('DROP TABLE IF EXISTS historico.organizacion_alias');
    await queryRunner.query('DROP TABLE IF EXISTS historico.organizaciones');
    await queryRunner.query('DROP TABLE IF EXISTS historico.practicas');
    await queryRunner.query('DROP TABLE IF EXISTS historico.importaciones');
    await queryRunner.query('DROP FUNCTION IF EXISTS historico.fn_practicas_inmutable()');
    await queryRunner.query('DROP FUNCTION IF EXISTS historico.fn_importaciones_sin_borrado()');
    await queryRunner.query('DROP SCHEMA IF EXISTS historico');
  }
}
