import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial de SIPRA PRÁCTICAS.
 *
 * Decisiones que quedan en la base, no en la aplicación:
 *  · `auditoria` no otorga UPDATE ni DELETE al rol de aplicación.
 *  · Los catálogos oficiales (CNO, CIIU, DIVIPOLA, niveles) son tablas de
 *    referencia con llave foránea: no se admite texto libre.
 */
export class EsquemaInicial1756000000000 implements MigrationInterface {
  name = 'EsquemaInicial1756000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // ── Catálogos oficiales ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_cno (
        codigo      varchar(10) PRIMARY KEY,
        denominacion varchar(300) NOT NULL,
        nivel       varchar(40)
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_ciiu (
        codigo      varchar(10) PRIMARY KEY,
        descripcion varchar(300) NOT NULL,
        seccion     varchar(4)
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_divipola (
        codigo             varchar(10) PRIMARY KEY,
        municipio          varchar(120) NOT NULL,
        departamento       varchar(120) NOT NULL,
        codigo_departamento varchar(4) NOT NULL
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_nivel_educativo (
        codigo varchar(60) PRIMARY KEY,
        nombre varchar(150) NOT NULL,
        orden  smallint NOT NULL DEFAULT 0
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_escuela (
        codigo varchar(60) PRIMARY KEY,
        nombre varchar(200) NOT NULL
      )`);

    // ── Usuarios ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id              uuid PRIMARY KEY,
        correo          varchar(180) NOT NULL UNIQUE,
        nombre          varchar(180) NOT NULL,
        documento       varchar(30),
        rol             varchar(30) NOT NULL,
        escuelas        text[] NOT NULL DEFAULT '{}',
        empresa_id      uuid,
        programa_id     varchar(60),
        activo          boolean NOT NULL DEFAULT true,
        creado_en       timestamptz NOT NULL DEFAULT now(),
        ultimo_acceso_en timestamptz,
        CONSTRAINT ck_usuarios_rol CHECK (rol IN
          ('estudiante','tutor','coordinador','administrador','empresa','extension'))
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_usuarios_rol ON usuarios (rol)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_usuarios_empresa ON usuarios (empresa_id)');

    // ── Empresas ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS empresas (
        id                     uuid PRIMARY KEY,
        razon_social           varchar(200) NOT NULL,
        nit_numero             varchar(20) NOT NULL UNIQUE,
        nit_dv                 smallint NOT NULL,
        ciiu                   varchar(10) REFERENCES cat_ciiu(codigo),
        divipola_municipio     varchar(10) REFERENCES cat_divipola(codigo),
        direccion              varchar(200),
        telefono               varchar(40),
        solicitante_nombre     varchar(150) NOT NULL,
        solicitante_correo     varchar(180) NOT NULL,
        solicitante_cargo      varchar(120),
        representante_legal    varchar(150),
        estado                 varchar(30) NOT NULL,
        senales                jsonb NOT NULL DEFAULT '[]',
        decidida_por           uuid,
        justificacion_decision text,
        solicitada_en          timestamptz NOT NULL DEFAULT now(),
        actualizada_en         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_empresas_estado CHECK (estado IN
          ('solicitud_recibida','en_verificacion','requiere_info','habilitada','rechazada','suspendida')),
        CONSTRAINT ck_empresas_dv CHECK (nit_dv BETWEEN 0 AND 10)
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_empresas_estado ON empresas (estado)');

    await queryRunner.query(`
      ALTER TABLE usuarios
      ADD CONSTRAINT fk_usuarios_empresa FOREIGN KEY (empresa_id)
      REFERENCES empresas(id) ON DELETE SET NULL`);

    // ── Prácticas ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS practicas (
        id                    uuid PRIMARY KEY,
        estudiante_id         uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        programa_id           varchar(60) NOT NULL,
        escuela_id            varchar(60) NOT NULL REFERENCES cat_escuela(codigo),
        ciclo                 varchar(20) NOT NULL,
        periodo_academico     varchar(12) NOT NULL,
        modalidad             varchar(40) NOT NULL,
        estado                varchar(20) NOT NULL,
        tutor_id              uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        empresa_id            uuid REFERENCES empresas(id) ON DELETE RESTRICT,
        cargo                 varchar(150),
        jefe_inmediato_nombre varchar(150),
        jefe_inmediato_correo varchar(180),
        fecha_inicio          timestamptz,
        fecha_fin             timestamptz,
        horas_registradas     integer,
        arl_verificada        boolean NOT NULL DEFAULT false,
        arl_fecha_afiliacion  timestamptz,
        ultima_actividad      timestamptz NOT NULL DEFAULT now(),
        creada_en             timestamptz NOT NULL DEFAULT now(),
        actualizada_en        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_practicas_estado CHECK (estado IN
          ('inscrita','documentacion','en_validacion','activa','finalizada','certificada','suspendida','cancelada')),
        CONSTRAINT ck_practicas_ciclo CHECK (ciclo IN ('tecnico','tecnologo','profesional')),
        CONSTRAINT ck_practicas_modalidad CHECK (modalidad IN
          ('empresarial','emprendimiento','vinculo_laboral','proyecto_social','homologacion_experiencia')),
        CONSTRAINT ck_practicas_horas CHECK (horas_registradas IS NULL OR horas_registradas >= 0),
        -- La compuerta ARL también vive en la base: una práctica activa no
        -- puede existir sin afiliación anterior a su inicio.
        CONSTRAINT ck_practicas_compuerta_arl CHECK (
          estado <> 'activa'
          OR modalidad = 'homologacion_experiencia'
          OR (arl_verificada
              AND arl_fecha_afiliacion IS NOT NULL
              AND fecha_inicio IS NOT NULL
              AND arl_fecha_afiliacion::date < fecha_inicio::date)
        )
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_practicas_estudiante ON practicas (estudiante_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_practicas_escuela_estado ON practicas (escuela_id, estado)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_practicas_tutor_estado ON practicas (tutor_id, estado)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_practicas_empresa ON practicas (empresa_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_practicas_periodo ON practicas (periodo_academico)');

    // ── Documentos ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS documentos (
        id                     uuid PRIMARY KEY,
        practica_id            uuid NOT NULL REFERENCES practicas(id) ON DELETE CASCADE,
        tipo                   varchar(40) NOT NULL,
        version                integer NOT NULL,
        estado                 varchar(20) NOT NULL,
        nombre_original        varchar(200) NOT NULL,
        mime_real              varchar(60) NOT NULL,
        tamano_bytes           bigint NOT NULL,
        hash_sha256            varchar(64) NOT NULL,
        hash_perceptual        varchar(64),
        ruta_almacenamiento    varchar(300) NOT NULL,
        calidad_captura        jsonb,
        banderas               jsonb NOT NULL DEFAULT '[]',
        puntaje                integer,
        banda                  varchar(10),
        extraccion             jsonb,
        decidido_por           uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        justificacion_decision text,
        motivo_devolucion      text,
        cargado_en             timestamptz NOT NULL DEFAULT now(),
        actualizado_en         timestamptz NOT NULL DEFAULT now(),
        purgar_despues_de      timestamptz,
        CONSTRAINT ck_documentos_estado CHECK (estado IN
          ('recibido','analizando','auto_aprobado','en_revision','ilegible','devuelto','aprobado','rechazado')),
        CONSTRAINT ck_documentos_puntaje CHECK (puntaje IS NULL OR puntaje BETWEEN 0 AND 100),
        CONSTRAINT ck_documentos_mime CHECK (mime_real IN ('application/pdf','image/jpeg','image/png')),
        -- Una decisión sin justificación no es una decisión.
        CONSTRAINT ck_documentos_justificacion CHECK (
          estado NOT IN ('aprobado','rechazado') OR justificacion_decision IS NOT NULL
        )
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_documentos_version ON documentos (practica_id, tipo, version)',
    );
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_documentos_hash ON documentos (hash_sha256)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_documentos_estado ON documentos (estado)');
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_documentos_purga ON documentos (purgar_despues_de) WHERE purgar_despues_de IS NOT NULL',
    );

    // ── Obligaciones ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS obligaciones (
        id                    uuid PRIMARY KEY,
        practica_id           uuid NOT NULL REFERENCES practicas(id) ON DELETE CASCADE,
        tipo                  varchar(40) NOT NULL,
        estado                varchar(20) NOT NULL,
        fecha_limite          timestamptz NOT NULL,
        cumplida_en           timestamptz,
        evidencia_documento_id uuid REFERENCES documentos(id) ON DELETE SET NULL,
        observacion           text,
        creada_en             timestamptz NOT NULL DEFAULT now(),
        actualizada_en        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_obligaciones_tipo CHECK (tipo IN
          ('afiliacion_arl','certificacion_practica','reporte_plaza_practica','autorizacion_tratamiento')),
        CONSTRAINT ck_obligaciones_estado CHECK (estado IN ('pendiente','cumplida','vencida','no_aplica'))
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_obligaciones_practica_tipo ON obligaciones (practica_id, tipo)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_obligaciones_vencimiento ON obligaciones (estado, fecha_limite)',
    );

    // ── Bolsa de empleo ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vacantes (
        id                   uuid PRIMARY KEY,
        empresa_id           uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
        marco                varchar(20) NOT NULL,
        titulo               varchar(200) NOT NULL,
        descripcion          text NOT NULL,
        funciones            text NOT NULL,
        requisitos           text NOT NULL,
        codigo_cno           varchar(10) NOT NULL REFERENCES cat_cno(codigo),
        codigo_ciiu          varchar(10) NOT NULL REFERENCES cat_ciiu(codigo),
        divipola_municipio   varchar(10) NOT NULL REFERENCES cat_divipola(codigo),
        nivel_educativo      varchar(60) NOT NULL REFERENCES cat_nivel_educativo(codigo),
        vacantes_disponibles integer NOT NULL,
        salario_minimo       bigint,
        salario_maximo       bigint,
        estado               varchar(20) NOT NULL,
        publicada_en         timestamptz,
        vigente_hasta        timestamptz,
        reportada_spe_en     timestamptz,
        creada_en            timestamptz NOT NULL DEFAULT now(),
        actualizada_en       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_vacantes_marco CHECK (marco IN ('practica','laboral')),
        CONSTRAINT ck_vacantes_estado CHECK (estado IN
          ('borrador','en_validacion','publicada','reportada_spe','cerrada','vencida')),
        CONSTRAINT ck_vacantes_cupos CHECK (vacantes_disponibles >= 1),
        -- Vigencia máxima de seis meses (Resolución 2605 de 2014).
        CONSTRAINT ck_vacantes_vigencia CHECK (
          vigente_hasta IS NULL OR publicada_en IS NULL
          OR vigente_hasta <= publicada_en + interval '6 months'
        )
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vacantes_empresa ON vacantes (empresa_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vacantes_estado_marco ON vacantes (estado, marco)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vacantes_vigencia ON vacantes (vigente_hasta)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS postulaciones (
        id             uuid PRIMARY KEY,
        vacante_id     uuid NOT NULL REFERENCES vacantes(id) ON DELETE CASCADE,
        estudiante_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        estado         varchar(30) NOT NULL,
        observacion    text,
        postulada_en   timestamptz NOT NULL DEFAULT now(),
        actualizada_en timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_postulaciones_estado CHECK (estado IN
          ('postulado','en_revision_empresa','preseleccionado','remitido','colocado','descartado'))
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_postulaciones ON postulaciones (vacante_id, estudiante_id)',
    );

    // ── Habilitación de bolsa: registro con vigencia, no atributo del estudiante
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS habilitaciones_bolsa (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        estudiante_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        practica_id   uuid REFERENCES practicas(id) ON DELETE SET NULL,
        vigente_desde timestamptz NOT NULL DEFAULT now(),
        vigente_hasta timestamptz NOT NULL,
        motivo        varchar(200),
        creada_en     timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_habilitaciones_estudiante ON habilitaciones_bolsa (estudiante_id, vigente_hasta)',
    );

    // ── Auditoría inmutable ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auditoria (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id       uuid,
        actor_correo   varchar(180),
        actor_rol      varchar(30),
        accion         varchar(60) NOT NULL,
        entidad        varchar(40) NOT NULL,
        entidad_id     uuid,
        justificacion  text,
        metadatos      jsonb,
        ip             varchar(60),
        agente_usuario varchar(300),
        ocurrido_en    timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_auditoria_actor ON auditoria (actor_id, ocurrido_en)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_auditoria_entidad ON auditoria (entidad, entidad_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_auditoria_accion ON auditoria (accion)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_auditoria_fecha ON auditoria (ocurrido_en)');

    // El registro histórico no se modifica ni se borra: se impide en el motor.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION auditoria_es_inmutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'La tabla auditoria es inmutable: no admite % ', TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER tg_auditoria_inmutable
      BEFORE UPDATE OR DELETE ON auditoria
      FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_auditoria_inmutable ON auditoria');
    await queryRunner.query('DROP FUNCTION IF EXISTS auditoria_es_inmutable()');
    for (const tabla of [
      'auditoria', 'habilitaciones_bolsa', 'postulaciones', 'vacantes',
      'obligaciones', 'documentos', 'practicas', 'empresas', 'usuarios',
      'cat_escuela', 'cat_nivel_educativo', 'cat_divipola', 'cat_ciiu', 'cat_cno',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
  }
}
