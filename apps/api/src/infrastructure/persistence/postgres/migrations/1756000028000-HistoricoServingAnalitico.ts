import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico del SGP · H5 (serving analítico para Reportes V3). §29 de `docs/HISTORICO-PRACTICAS-AUDITORIA.md`.
 *
 * `historico.serving_practicas`: proyección DERIVADA de las versiones vigentes del SGP al modelo común de la capa
 * analítica (H4), con la elegibilidad por métrica ya resuelta con la política de calidad H3. Nunca es fuente de verdad:
 * se reconstruye completa al publicar una importación (construir → validar → publicar) y se puede borrar sin perder nada.
 *
 * `historico.serving_publicacion`: puntero de la versión publicada por sistema. Reportes lee SOLO la versión del puntero
 * en la misma sentencia, así que nunca ve un refresco a medias.
 *
 * Mínimo privilegio para la API (`sipra_app`): USAGE del esquema y SELECT únicamente sobre el serving, su puntero y las
 * correspondencias confirmadas. Nada sobre `historico.practicas`, `importaciones` ni organizaciones; ningún
 * INSERT/UPDATE/DELETE. La construcción la hace el rol de carga (CLI), no la API.
 *
 * Sin columnas personales: identidad solo como clave seudónima (para estudiantes únicos), etiquetas de catálogo.
 * Reversión: elimina las dos tablas (son derivadas) y los permisos.
 */
export class HistoricoServingAnalitico1756000028000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.serving_publicacion (
        sistema       varchar(20) PRIMARY KEY,
        version       uuid NOT NULL,
        filas         integer NOT NULL,
        corte         timestamptz NULL,
        desde         date NULL,
        publicado_en  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_hspub_sistema CHECK (sistema IN ('SGP', 'SGP_SINTETICO')),
        CONSTRAINT ck_hspub_filas CHECK (filas >= 0)
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.serving_practicas (
        version                   uuid NOT NULL,
        sistema                   varchar(20) NOT NULL,
        analytics_id              varchar(120) NOT NULL,
        source_record_id          varchar(40) NOT NULL,
        student_key               char(64) NULL,
        hmac_key_version          varchar(10) NOT NULL,
        escuela_id                varchar(60) NULL,
        periodo_clave             varchar(60) NULL,
        periodo_etiqueta          varchar(80) NULL,
        periodo_codigo            varchar(12) NULL,
        programa_clave            varchar(220) NULL,
        programa_etiqueta         varchar(220) NULL,
        programa_mapeado          boolean NOT NULL,
        nivel                     varchar(20) NULL,
        regional_clave            varchar(140) NULL,
        regional_etiqueta         varchar(140) NULL,
        modalidad_estudio_clave   varchar(40) NULL,
        modalidad_estudio_etiqueta varchar(40) NULL,
        modalidad_practica_clave  varchar(140) NULL,
        modalidad_practica_etiqueta varchar(160) NULL,
        modalidad_codigo          varchar(40) NULL,
        estado                    varchar(20) NULL,
        es_estado_de_corte        boolean NOT NULL,
        estado_al                 timestamptz NULL,
        organizacion_clave        varchar(80) NULL,
        organizacion_etiqueta     varchar(200) NULL,
        ciudad_clave              varchar(220) NULL,
        ciudad_etiqueta           varchar(200) NULL,
        fecha_inicio              date NULL,
        fecha_fin                 date NULL,
        fecha_creacion            date NULL,
        duracion_dias             integer NULL,
        documentos_subidos_ratio  numeric(4,3) NULL,
        documentos_aprobados_ratio numeric(4,3) NULL,
        e_practicas    boolean NOT NULL,
        e_estudiantes  boolean NOT NULL,
        e_periodo      boolean NOT NULL,
        e_programa     boolean NOT NULL,
        e_nivel        boolean NOT NULL,
        e_regional     boolean NOT NULL,
        e_mod_estudio  boolean NOT NULL,
        e_mod_practica boolean NOT NULL,
        e_estado       boolean NOT NULL,
        e_tasa         boolean NOT NULL,
        e_organizacion boolean NOT NULL,
        e_ciudad       boolean NOT NULL,
        e_duracion     boolean NOT NULL,
        e_doc_sgp      boolean NOT NULL,
        PRIMARY KEY (version, analytics_id),
        CONSTRAINT ck_hserv_sistema CHECK (sistema IN ('SGP', 'SGP_SINTETICO')),
        CONSTRAINT ck_hserv_clave CHECK (student_key IS NULL OR student_key ~ '^[0-9a-f]{64}$')
      )`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sipra_app') THEN
          GRANT USAGE ON SCHEMA historico TO sipra_app;
          GRANT SELECT ON TABLE historico.serving_practicas, historico.serving_publicacion, historico.practica_correspondencia TO sipra_app;
        END IF;
      END $$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sipra_app') THEN
          REVOKE ALL ON TABLE historico.practica_correspondencia FROM sipra_app;
          REVOKE ALL ON SCHEMA historico FROM sipra_app;
        END IF;
      END $$`);
    await queryRunner.query('DROP TABLE IF EXISTS historico.serving_practicas');
    await queryRunner.query('DROP TABLE IF EXISTS historico.serving_publicacion');
  }
}
