import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloque 3 del acta de iniciación · persistencia de la validación y de sus evidencias.
 *
 * DOCUMENTO = el archivo y su versión (`documentos`). VALIDACIÓN = lo que se interpretó de él: una por documento
 * (por tanto, por versión del acta). Una versión nueva del acta tiene su propia validación y evidencias; nada se
 * copia de la anterior.
 *
 * Lo que la base impone:
 *  · una sola validación por documento (el reintento no duplica);
 *  · un documento que NO es un acta, o que no se pudo determinar, no puede traer remuneración, ARL ni firmas «válidas»;
 *  · una decisión humana siempre dice quién y cuándo;
 *  · ni el texto del documento (OCR o nativo) ni imágenes de firma caben en los JSON (claves prohibidas);
 *  · las evidencias son de SOLO inserción (disparador + permisos) y se identifican por (validación, intento, tipo),
 *    de modo que repetir un procesamiento no las duplica.
 *
 * Mínimo privilegio: la aplicación no borra nada. La retención no está definida: no hay purga.
 */
export class ValidacionActaIniciacion1756000017000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS validaciones_acta_iniciacion (
        id                          uuid PRIMARY KEY,
        documento_id                uuid        NOT NULL REFERENCES documentos(id),
        practica_id                 uuid        NOT NULL REFERENCES practicas(id),
        estudiante_id               uuid        NOT NULL REFERENCES usuarios(id),
        estado                      varchar(20) NOT NULL DEFAULT 'pendiente',
        intentos                    integer     NOT NULL DEFAULT 0,
        error_codigo                varchar(60),
        tipo_acta_detectada         varchar(25),
        remuneracion_detectada      varchar(20),
        responsable_arl_detectado   varchar(20),
        firma_empresa               varchar(20),
        firma_practicante           varchar(20),
        metodo_lectura              varchar(10),
        confianza                   numeric(4,3),
        motivos_clasificacion       jsonb       NOT NULL DEFAULT '[]',
        datos_extraidos             jsonb,
        comparacion                 jsonb,
        hay_discrepancia_critica    boolean     NOT NULL DEFAULT false,
        recibida_en                 timestamptz,
        procesada_en                timestamptz,
        decidido_por                uuid        REFERENCES usuarios(id),
        decidido_en                 timestamptz,
        version                     integer     NOT NULL DEFAULT 1,
        creada_en                   timestamptz NOT NULL DEFAULT now(),
        actualizada_en              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ux_vacta_documento UNIQUE (documento_id),
        CONSTRAINT ck_vacta_estado CHECK (estado IN
          ('pendiente','procesando','revision','aprobado_manual','devuelto','rechazado','error')),
        CONSTRAINT ck_vacta_tipo CHECK (tipo_acta_detectada IS NULL OR tipo_acta_detectada IN
          ('iniciacion_practicas','documento_incorrecto','no_determinable')),
        CONSTRAINT ck_vacta_remuneracion CHECK (remuneracion_detectada IS NULL OR remuneracion_detectada IN
          ('remunerada','no_remunerada','no_determinable')),
        CONSTRAINT ck_vacta_arl CHECK (responsable_arl_detectado IS NULL OR responsable_arl_detectado IN
          ('empresa','cun','no_determinable')),
        CONSTRAINT ck_vacta_firma_empresa CHECK (firma_empresa IS NULL OR firma_empresa IN ('si','no','no_determinable')),
        CONSTRAINT ck_vacta_firma_practicante CHECK (firma_practicante IS NULL OR firma_practicante IN ('si','no','no_determinable')),
        CONSTRAINT ck_vacta_metodo CHECK (metodo_lectura IS NULL OR metodo_lectura IN ('texto','ocr')),
        CONSTRAINT ck_vacta_confianza CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 1)),
        CONSTRAINT ck_vacta_version CHECK (version >= 1),
        CONSTRAINT ck_vacta_intentos CHECK (intentos >= 0),
        CONSTRAINT ck_vacta_motivos CHECK (jsonb_typeof(motivos_clasificacion) = 'array'),
        CONSTRAINT ck_vacta_datos CHECK (datos_extraidos IS NULL OR (jsonb_typeof(datos_extraidos) = 'object'
          AND NOT (datos_extraidos ?| ARRAY['texto','texto_ocr','texto_nativo','ocr','imagen','imagen_firma','firma_imagen']))),
        CONSTRAINT ck_vacta_comparacion CHECK (comparacion IS NULL OR (jsonb_typeof(comparacion) = 'object'
          AND NOT (comparacion ?| ARRAY['texto','texto_ocr','texto_nativo','ocr','imagen','imagen_firma','firma_imagen']))),
        CONSTRAINT ck_vacta_error CHECK ((estado = 'error') = (error_codigo IS NOT NULL)),
        CONSTRAINT ck_vacta_decision_humana CHECK (
          estado NOT IN ('aprobado_manual','devuelto','rechazado')
          OR (decidido_por IS NOT NULL AND decidido_en IS NOT NULL)),
        -- Lo que no es un acta (o no se pudo determinar) no trae remuneración, ARL ni firmas como si fueran válidas.
        CONSTRAINT ck_vacta_solo_acta CHECK (
          tipo_acta_detectada IS NULL OR tipo_acta_detectada = 'iniciacion_practicas'
          OR (COALESCE(remuneracion_detectada, 'no_determinable') = 'no_determinable'
              AND COALESCE(responsable_arl_detectado, 'no_determinable') = 'no_determinable'
              AND COALESCE(firma_empresa, 'no_determinable') = 'no_determinable'
              AND COALESCE(firma_practicante, 'no_determinable') = 'no_determinable'))
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vacta_practica ON validaciones_acta_iniciacion (practica_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vacta_estudiante ON validaciones_acta_iniciacion (estudiante_id)');
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_vacta_abiertas ON validaciones_acta_iniciacion (recibida_en)
      WHERE estado IN ('pendiente','procesando','revision','error')`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS evidencias_validacion_acta (
        id                    uuid PRIMARY KEY,
        validacion_acta_id    uuid         NOT NULL REFERENCES validaciones_acta_iniciacion(id),
        intento               integer      NOT NULL,
        tipo                  varchar(30)  NOT NULL,
        resultado             varchar(30)  NOT NULL,
        metodo                varchar(60)  NOT NULL,
        fecha                 timestamptz  NOT NULL,
        actor_id              uuid         REFERENCES usuarios(id),
        hash_documento        char(64),
        datos                 jsonb        NOT NULL DEFAULT '{}',
        error_codigo          varchar(60),
        creado_en             timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ux_eacta_idempotencia UNIQUE (validacion_acta_id, intento, tipo),
        CONSTRAINT ck_eacta_tipo CHECK (tipo IN
          ('lectura_documento','clasificacion_documental','comparacion','medicion_firmas','procesamiento','decision_humana')),
        CONSTRAINT ck_eacta_intento CHECK (intento >= 0),
        CONSTRAINT ck_eacta_hash CHECK (hash_documento IS NULL OR hash_documento ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_eacta_decision CHECK (tipo <> 'decision_humana' OR actor_id IS NOT NULL),
        CONSTRAINT ck_eacta_datos CHECK (jsonb_typeof(datos) = 'object'
          AND NOT (datos ?| ARRAY['texto','texto_ocr','texto_nativo','ocr','imagen','imagen_firma','firma_imagen',
                                  'token','password','secreto','cookie','authorization']))
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_eacta_validacion ON evidencias_validacion_acta (validacion_acta_id, creado_en)',
    );
    // Las evidencias no se actualizan ni se borran: el mismo disparador que la auditoría.
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_evidencias_acta_inmutable ON evidencias_validacion_acta');
    await queryRunner.query(`
      CREATE TRIGGER tg_evidencias_acta_inmutable
      BEFORE UPDATE OR DELETE ON evidencias_validacion_acta
      FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable()`);

    // Mínimo privilegio. Sin DELETE en ninguna: la retención no está definida y nada se purga.
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE ON TABLE validaciones_acta_iniciacion TO sipra_app');
    await queryRunner.query('GRANT SELECT, INSERT ON TABLE evidencias_validacion_acta TO sipra_app');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // La evidencia es de solo inserción: revertir esta migración no puede borrarla en silencio.
    const filas = (await queryRunner.query('SELECT count(*)::int AS n FROM evidencias_validacion_acta')) as { n: number }[];
    if (filas[0].n > 0) {
      throw new Error('No se revierte: hay evidencias de validación de actas, que son de solo inserción');
    }
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_evidencias_acta_inmutable ON evidencias_validacion_acta');
    await queryRunner.query('DROP TABLE IF EXISTS evidencias_validacion_acta');
    await queryRunner.query('DROP TABLE IF EXISTS validaciones_acta_iniciacion');
    // `auditoria_es_inmutable()` pertenece a la migración inicial: no se toca.
  }
}
