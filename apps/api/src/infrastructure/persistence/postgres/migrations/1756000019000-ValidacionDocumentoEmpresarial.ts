import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloque 1 de documentos empresariales (RUT y Cámara de Comercio) · persistencia de la validación y de sus evidencias.
 *
 * Aditiva: crea dos tablas y un índice. No toca `documentos` (salvo el índice de duplicados) ni ningún dato existente,
 * y NO rellena clasificaciones: un documento histórico no tiene fila hasta que se procese (clasificación = nula).
 *
 * Lo que la base impone:
 *  · una sola validación por documento (el reintento no duplica);
 *  · familia y persona derivan de la clasificación detectada: no pueden contradecirla;
 *  · un documento incorrecto o no determinable no trae datos extraídos ni comparación;
 *  · una matrícula de persona natural no trae representante legal;
 *  · los datos extraídos no admiten dirección, correo, teléfono, responsabilidades, texto ni imágenes (primer nivel),
 *    ni una bandera de «vigencia» (la vigencia del RUT es indefinida y la de la Cámara son ejes separados);
 *  · la autenticidad es `no_verificable` por defecto y «verificada» exige una fuente: un QR, un código, una URL o una
 *    firma de PDF presentes no bastan;
 *  · las evidencias son de SOLO inserción (disparador + permisos) e idempotentes por (validación, intento, tipo).
 *
 * Mínimo privilegio: la aplicación no borra nada. La retención no está definida: no hay purga.
 */
export class ValidacionDocumentoEmpresarial1756000019000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS validaciones_documento_empresarial (
        id                          uuid PRIMARY KEY,
        documento_id                uuid        NOT NULL REFERENCES documentos(id),
        practica_id                 uuid        NOT NULL REFERENCES practicas(id),
        estudiante_id               uuid        NOT NULL REFERENCES usuarios(id),
        tipo_esperado               varchar(30),
        familia_documento           varchar(10),
        tipo_detectado              varchar(40),
        tipo_persona                varchar(10),
        expectativa                 varchar(25),
        estado                      varchar(20) NOT NULL DEFAULT 'pendiente',
        intentos                    integer     NOT NULL DEFAULT 0,
        error_codigo                varchar(60),
        metodo_lectura              varchar(10),
        confianza                   numeric(4,3),
        lectura_dudosa              boolean     NOT NULL DEFAULT false,
        hash_documento              char(64),
        duplicado_de_documento_id   uuid        REFERENCES documentos(id),
        datos_extraidos             jsonb,
        comparacion                 jsonb,
        autenticidad_estado         varchar(20) NOT NULL DEFAULT 'no_verificable',
        autenticidad                jsonb       NOT NULL DEFAULT '{"estado":"no_verificable","fuente":null}',
        recibida_en                 timestamptz,
        procesada_en                timestamptz,
        version                     integer     NOT NULL DEFAULT 1,
        creada_en                   timestamptz NOT NULL DEFAULT now(),
        actualizada_en              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ux_vdemp_documento UNIQUE (documento_id),
        CONSTRAINT ck_vdemp_estado CHECK (estado IN ('pendiente','procesando','revision','error')),
        CONSTRAINT ck_vdemp_tipo_esperado CHECK (tipo_esperado IS NULL OR tipo_esperado IN ('rut_natural','rut_juridico','camara_comercio')),
        CONSTRAINT ck_vdemp_familia CHECK (familia_documento IS NULL OR familia_documento IN ('rut','camara')),
        CONSTRAINT ck_vdemp_persona CHECK (tipo_persona IS NULL OR tipo_persona IN ('natural','juridica')),
        CONSTRAINT ck_vdemp_tipo_detectado CHECK (tipo_detectado IS NULL OR tipo_detectado IN (
          'rut_persona_natural','rut_persona_juridica','camara_matricula_persona_natural','camara_matricula_sociedad',
          'camara_existencia_representacion','documento_incorrecto','no_determinable')),
        CONSTRAINT ck_vdemp_expectativa CHECK (expectativa IS NULL OR expectativa IN (
          'coincide','persona_distinta','familia_distinta','documento_incorrecto','no_determinable')),
        CONSTRAINT ck_vdemp_metodo CHECK (metodo_lectura IS NULL OR metodo_lectura IN ('texto','ocr','hibrido')),
        CONSTRAINT ck_vdemp_confianza CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 1)),
        CONSTRAINT ck_vdemp_version CHECK (version >= 1),
        CONSTRAINT ck_vdemp_intentos CHECK (intentos >= 0),
        CONSTRAINT ck_vdemp_hash CHECK (hash_documento IS NULL OR hash_documento ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_vdemp_error CHECK ((estado = 'error') = (error_codigo IS NOT NULL)),
        -- Un documento sin procesar no tiene clasificación (los históricos tampoco: no hay backfill).
        CONSTRAINT ck_vdemp_pendiente_sin_clasificar CHECK (estado <> 'pendiente' OR (tipo_detectado IS NULL AND datos_extraidos IS NULL)),
        CONSTRAINT ck_vdemp_revision_completa CHECK (estado <> 'revision' OR (tipo_detectado IS NOT NULL AND procesada_en IS NOT NULL AND hash_documento IS NOT NULL)),
        -- La familia y la persona SALEN de la clasificación detectada.
        CONSTRAINT ck_vdemp_familia_coherente CHECK (
          CASE
            WHEN tipo_detectado IS NULL THEN familia_documento IS NULL AND tipo_persona IS NULL
            WHEN tipo_detectado LIKE 'rut\\_%' THEN familia_documento IS NOT DISTINCT FROM 'rut'
            WHEN tipo_detectado LIKE 'camara\\_%' THEN familia_documento IS NOT DISTINCT FROM 'camara'
            ELSE familia_documento IS NULL
          END),
        CONSTRAINT ck_vdemp_persona_coherente CHECK (
          CASE tipo_detectado
            WHEN 'rut_persona_natural' THEN tipo_persona IS NOT DISTINCT FROM 'natural'
            WHEN 'rut_persona_juridica' THEN tipo_persona IS NOT DISTINCT FROM 'juridica'
            WHEN 'camara_matricula_persona_natural' THEN tipo_persona IS NOT DISTINCT FROM 'natural'
            WHEN 'camara_matricula_sociedad' THEN tipo_persona IS NOT DISTINCT FROM 'juridica'
            WHEN 'camara_existencia_representacion' THEN tipo_persona IS NOT DISTINCT FROM 'juridica'
            ELSE tipo_persona IS NULL
          END),
        CONSTRAINT ck_vdemp_sin_contenido CHECK (
          tipo_detectado IS NULL OR tipo_detectado NOT IN ('documento_incorrecto','no_determinable')
          OR (datos_extraidos IS NULL AND comparacion IS NULL)),
        CONSTRAINT ck_vdemp_datos CHECK (datos_extraidos IS NULL OR (jsonb_typeof(datos_extraidos) = 'object'
          AND NOT (datos_extraidos ?| ARRAY['texto','texto_ocr','texto_nativo','textoOcr','textoNativo','ocr','imagen','imagenes',
            'direccion','direccion_completa','direccionCompleta','correo','correo_electronico','correoElectronico','email',
            'telefono','telefonos','responsabilidades','token','password','secreto','cookie','authorization',
            'vigente','vigencia','vencido','rutNoVigente']))),
        CONSTRAINT ck_vdemp_datos_persona CHECK (datos_extraidos IS NULL OR tipo_persona IS NULL
          OR datos_extraidos->>'tipoPersona' IS NULL OR datos_extraidos->>'tipoPersona' = tipo_persona),
        -- Una matrícula de persona natural no tiene representante legal.
        CONSTRAINT ck_vdemp_pn_sin_representante CHECK (
          tipo_detectado IS DISTINCT FROM 'camara_matricula_persona_natural'
          OR datos_extraidos IS NULL OR COALESCE(datos_extraidos->>'representanteLegal', '') = ''),
        CONSTRAINT ck_vdemp_comparacion CHECK (comparacion IS NULL OR (jsonb_typeof(comparacion) = 'object'
          AND NOT (comparacion ?| ARRAY['texto','texto_ocr','texto_nativo','ocr','imagen','imagenes']))),
        CONSTRAINT ck_vdemp_autenticidad_estado CHECK (autenticidad_estado IN ('verificada','no_verificable','invalida','no_determinable')),
        CONSTRAINT ck_vdemp_autenticidad_json CHECK (jsonb_typeof(autenticidad) = 'object' AND autenticidad->>'estado' = autenticidad_estado),
        -- «verificada» exige la fuente de la verificación; firmaPdfValida también. Nada pasivo (QR, código, URL, firma presente) la eleva.
        CONSTRAINT ck_vdemp_verificada_con_fuente CHECK (
          (autenticidad_estado <> 'verificada' AND autenticidad->>'firmaPdfValida' IS DISTINCT FROM 'true')
          OR autenticidad->>'fuente' IS NOT NULL)
      )`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vdemp_practica ON validaciones_documento_empresarial (practica_id)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_vdemp_estudiante ON validaciones_documento_empresarial (estudiante_id)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS evidencias_validacion_doc_empresarial (
        id                uuid PRIMARY KEY,
        validacion_id     uuid         NOT NULL REFERENCES validaciones_documento_empresarial(id),
        intento           integer      NOT NULL,
        tipo              varchar(30)  NOT NULL,
        resultado         varchar(40)  NOT NULL,
        metodo            varchar(60)  NOT NULL,
        fecha             timestamptz  NOT NULL,
        actor_id          uuid         REFERENCES usuarios(id),
        hash_documento    char(64),
        datos             jsonb        NOT NULL DEFAULT '{}',
        error_codigo      varchar(60),
        creado_en         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ux_edemp_idempotencia UNIQUE (validacion_id, intento, tipo),
        CONSTRAINT ck_edemp_tipo CHECK (tipo IN ('lectura_documento','clasificacion','comparacion','verificacion','decision_humana')),
        CONSTRAINT ck_edemp_intento CHECK (intento >= 0),
        CONSTRAINT ck_edemp_hash CHECK (hash_documento IS NULL OR hash_documento ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_edemp_decision CHECK (tipo <> 'decision_humana' OR actor_id IS NOT NULL),
        CONSTRAINT ck_edemp_datos CHECK (jsonb_typeof(datos) = 'object'
          AND NOT (datos ?| ARRAY['texto','texto_ocr','texto_nativo','textoOcr','textoNativo','ocr','imagen','imagenes',
            'direccion','direccion_completa','direccionCompleta','correo','correo_electronico','correoElectronico','email',
            'telefono','telefonos','responsabilidades','token','password','secreto','cookie','authorization',
            'url_con_credenciales','credenciales']))
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_edemp_validacion ON evidencias_validacion_doc_empresarial (validacion_id, creado_en)',
    );
    // Las evidencias no se actualizan ni se borran: el mismo disparador que la auditoría.
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_evidencias_doc_empresarial_inmutable ON evidencias_validacion_doc_empresarial');
    await queryRunner.query(`
      CREATE TRIGGER tg_evidencias_doc_empresarial_inmutable
      BEFORE UPDATE OR DELETE ON evidencias_validacion_doc_empresarial
      FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable()`);

    // Detección de duplicados (misma práctica, mismo tipo, mismo SHA-256): solo un índice sobre `documentos`.
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_documentos_practica_tipo_hash ON documentos (practica_id, tipo, hash_sha256)',
    );

    // Mínimo privilegio. Sin DELETE en ninguna: la retención no está definida y nada se purga.
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE ON TABLE validaciones_documento_empresarial TO sipra_app');
    await queryRunner.query('GRANT SELECT, INSERT ON TABLE evidencias_validacion_doc_empresarial TO sipra_app');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // La evidencia es de solo inserción: revertir esta migración no puede borrarla en silencio.
    const filas = (await queryRunner.query('SELECT count(*)::int AS n FROM evidencias_validacion_doc_empresarial')) as { n: number }[];
    if (filas[0].n > 0) {
      throw new Error('No se revierte: hay evidencias de validación de documentos empresariales, que son de solo inserción');
    }
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_evidencias_doc_empresarial_inmutable ON evidencias_validacion_doc_empresarial');
    await queryRunner.query('DROP TABLE IF EXISTS evidencias_validacion_doc_empresarial');
    await queryRunner.query('DROP TABLE IF EXISTS validaciones_documento_empresarial');
    await queryRunner.query('DROP INDEX IF EXISTS ix_documentos_practica_tipo_hash');
    // `auditoria_es_inmutable()` pertenece a la migración inicial: no se toca.
  }
}
