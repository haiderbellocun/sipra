import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Validación del certificado de afiliación a EPS (Fase 1).
 *
 *  · `validaciones_eps`: un registro por documento, con los ejes SEPARADOS
 *    (procesamiento, autenticidad, coincidencia, afiliación, ruta, decisión), lo
 *    que el certificado dice (`datos_extraidos`) aparte de lo que una fuente
 *    oficial confirma (`datos_verificados`), reserva por funcionario y versión
 *    optimista. Los CHECK impiden declarar candidatura o aprobación automática
 *    sin autenticidad verificada, coincidencia y afiliación activa.
 *  · `evidencias_validacion_eps`: hechos observados, SOLO INSERCIÓN (mismo
 *    disparador que `auditoria`). Sin secretos, sin respuestas a CAPTCHA y sin
 *    URLs con parámetros o credenciales.
 *
 * POLÍTICA DE RETENCIÓN EPS: PENDIENTE DE DEFINICIÓN INSTITUCIONAL. Por eso
 * `retencion_hasta` queda nulo, no hay purga y `sipra_app` no recibe DELETE.
 */
export class ValidacionEps1756000011000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS validaciones_eps (
        id                    uuid PRIMARY KEY,
        documento_id          uuid        NOT NULL REFERENCES documentos(id),
        practica_id           uuid        NOT NULL REFERENCES practicas(id),
        estudiante_id         uuid        NOT NULL REFERENCES usuarios(id),
        estado_procesamiento  varchar(12) NOT NULL DEFAULT 'pendiente',
        autenticidad          varchar(20) NOT NULL DEFAULT 'no_evaluada',
        coincidencia          varchar(15) NOT NULL DEFAULT 'no_evaluada',
        afiliacion            varchar(20) NOT NULL DEFAULT 'no_contrastada',
        ruta                  varchar(20) NOT NULL DEFAULT 'sin_determinar',
        decision              varchar(30) NOT NULL DEFAULT 'pendiente',
        vigencia_certificado  varchar(15) NOT NULL DEFAULT 'no_determinada',
        hay_bandera_critica   boolean     NOT NULL DEFAULT false,
        datos_extraidos       jsonb,
        datos_verificados     jsonb,
        discrepancias         jsonb       NOT NULL DEFAULT '[]',
        error_codigo          varchar(60),
        asignado_a            uuid        REFERENCES usuarios(id),
        reservado_en          timestamptz,
        reserva_hasta         timestamptz,
        decidido_por          uuid        REFERENCES usuarios(id),
        decidido_en           timestamptz,
        retencion_hasta       timestamptz,
        version               integer     NOT NULL DEFAULT 1,
        creada_en             timestamptz NOT NULL DEFAULT now(),
        actualizada_en        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ux_validaciones_eps_documento UNIQUE (documento_id),
        CONSTRAINT ck_veps_estado_procesamiento CHECK (estado_procesamiento IN
          ('pendiente','procesando','procesado','error')),
        CONSTRAINT ck_veps_autenticidad CHECK (autenticidad IN
          ('no_evaluada','verificada','no_verificable','invalida')),
        CONSTRAINT ck_veps_coincidencia CHECK (coincidencia IN
          ('no_evaluada','coincide','discrepancia','insuficiente')),
        CONSTRAINT ck_veps_afiliacion CHECK (afiliacion IN
          ('no_contrastada','activa','inactiva','no_determinable')),
        CONSTRAINT ck_veps_ruta CHECK (ruta IN
          ('sin_determinar','qr','adres_asistido','revision_manual')),
        CONSTRAINT ck_veps_decision CHECK (decision IN
          ('pendiente','candidato_autoaprobacion','aprobado_automatico','aprobado_manual','devuelto','rechazado')),
        CONSTRAINT ck_veps_vigencia CHECK (vigencia_certificado IN ('vigente','vencido','no_determinada')),
        CONSTRAINT ck_veps_version CHECK (version >= 1),
        CONSTRAINT ck_veps_discrepancias CHECK (jsonb_typeof(discrepancias) = 'array'),
        CONSTRAINT ck_veps_error CHECK ((estado_procesamiento = 'error') = (error_codigo IS NOT NULL)),
        CONSTRAINT ck_veps_reserva CHECK (
          (asignado_a IS NULL AND reservado_en IS NULL AND reserva_hasta IS NULL)
          OR (asignado_a IS NOT NULL AND reservado_en IS NOT NULL AND reserva_hasta IS NOT NULL
              AND reserva_hasta > reservado_en)),
        CONSTRAINT ck_veps_decision_humana CHECK (
          decision NOT IN ('aprobado_manual','devuelto','rechazado')
          OR (decidido_por IS NOT NULL AND decidido_en IS NOT NULL)),
        CONSTRAINT ck_veps_candidatura CHECK (
          decision NOT IN ('candidato_autoaprobacion','aprobado_automatico')
          OR (estado_procesamiento = 'procesado' AND autenticidad = 'verificada'
              AND coincidencia = 'coincide' AND afiliacion = 'activa'))
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_veps_practica ON validaciones_eps (practica_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_veps_estudiante ON validaciones_eps (estudiante_id)');
    // Bandeja futura: casos abiertos por decisión y procesamiento.
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_veps_bandeja ON validaciones_eps (decision, estado_procesamiento)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_veps_asignado ON validaciones_eps (asignado_a) WHERE asignado_a IS NOT NULL',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS evidencias_validacion_eps (
        id                 uuid PRIMARY KEY,
        validacion_eps_id  uuid         NOT NULL REFERENCES validaciones_eps(id),
        tipo               varchar(20)  NOT NULL,
        fuente             varchar(20)  NOT NULL,
        metodo             varchar(60)  NOT NULL,
        resultado          varchar(30)  NOT NULL,
        fecha_verificacion timestamptz  NOT NULL,
        hash_evidencia     char(64),
        origen             varchar(300),
        datos_obtenidos    jsonb        NOT NULL DEFAULT '{}',
        error_codigo       varchar(60),
        verificado_por     uuid         REFERENCES usuarios(id),
        creado_en          timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ck_evidencias_eps_tipo CHECK (tipo IN
          ('texto_pdf','qr','respuesta_eps','adres','revision_humana')),
        CONSTRAINT ck_evidencias_eps_fuente CHECK (fuente IN
          ('certificado','qr_oficial','eps_oficial','adres','revision_humana')),
        CONSTRAINT ck_evidencias_eps_tipo_fuente CHECK (
          (tipo = 'texto_pdf' AND fuente = 'certificado')
          OR (tipo = 'qr' AND fuente IN ('certificado','qr_oficial'))
          OR (tipo = 'respuesta_eps' AND fuente IN ('eps_oficial','qr_oficial'))
          OR (tipo = 'adres' AND fuente = 'adres')
          OR (tipo = 'revision_humana' AND fuente = 'revision_humana')),
        CONSTRAINT ck_evidencias_eps_revision CHECK (tipo <> 'revision_humana' OR verificado_por IS NOT NULL),
        CONSTRAINT ck_evidencias_eps_hash CHECK (hash_evidencia IS NULL OR hash_evidencia ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_evidencias_eps_origen CHECK (
          origen IS NULL OR (origen !~ '[?#]' AND origen !~ '//[^/]*@')),
        CONSTRAINT ck_evidencias_eps_datos CHECK (
          jsonb_typeof(datos_obtenidos) = 'object'
          AND NOT (datos_obtenidos ?| ARRAY['captcha','token','password','secreto','cookie','url_firmada','authorization']))
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_evidencias_eps_validacion ON evidencias_validacion_eps (validacion_eps_id, creado_en)',
    );

    // Las evidencias no se actualizan ni se borran: mismo disparador que la auditoría.
    await queryRunner.query(`
      CREATE TRIGGER tg_evidencias_eps_inmutable
      BEFORE UPDATE OR DELETE ON evidencias_validacion_eps
      FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable()`);

    // Mínimo privilegio. Sin DELETE: la retención no está definida y nada se purga.
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE ON TABLE validaciones_eps TO sipra_app');
    await queryRunner.query('GRANT SELECT, INSERT ON TABLE evidencias_validacion_eps TO sipra_app');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_evidencias_eps_inmutable ON evidencias_validacion_eps');
    await queryRunner.query('DROP TABLE IF EXISTS evidencias_validacion_eps');
    await queryRunner.query('DROP TABLE IF EXISTS validaciones_eps');
    // `auditoria_es_inmutable()` pertenece a la migración inicial: no se toca.
  }
}
