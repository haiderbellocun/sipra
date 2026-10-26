import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consentimiento de tratamiento de datos, versionado y trazable (Ley 1581).
 *
 *  · `politicas_consentimiento`: el texto versionado que aporta la institución.
 *    Una versión publicada no se edita (disparador): solo se puede retirar
 *    (`activa`, `vigente_hasta`). Cambiar el texto es publicar otra versión.
 *    Una sola activa por tipo (índice único parcial).
 *  · `consentimientos`: eventos de aceptación o revocación, SOLO INSERCIÓN. Se
 *    protege con el mismo disparador que `auditoria` (`auditoria_es_inmutable`)
 *    y con permisos mínimos (sin UPDATE ni DELETE para `sipra_app`).
 *
 * No contiene texto jurídico: las políticas las publica el responsable
 * institucional por la API.
 */
export class ConsentimientoVersionado1756000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS politicas_consentimiento (
        id             uuid PRIMARY KEY,
        tipo           varchar(40)  NOT NULL,
        version        integer      NOT NULL,
        titulo         varchar(200) NOT NULL,
        finalidad      varchar(500) NOT NULL,
        contenido      text         NOT NULL,
        texto_sha256   char(64)     NOT NULL,
        vigente_desde  timestamptz  NOT NULL,
        vigente_hasta  timestamptz,
        activa         boolean      NOT NULL DEFAULT false,
        publicada_por  uuid         NOT NULL REFERENCES usuarios(id),
        creada_en      timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ck_politicas_tipo CHECK (tipo IN ('tratamiento_datos')),
        CONSTRAINT ck_politicas_version CHECK (version >= 1),
        CONSTRAINT ck_politicas_contenido CHECK (length(btrim(contenido)) > 0),
        CONSTRAINT ck_politicas_hash CHECK (
          texto_sha256 = encode(sha256(convert_to(contenido, 'UTF8')), 'hex')),
        CONSTRAINT ck_politicas_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
        CONSTRAINT ck_politicas_activa CHECK (NOT activa OR vigente_hasta IS NULL),
        CONSTRAINT ux_politicas_tipo_version UNIQUE (tipo, version),
        CONSTRAINT ux_politicas_id_tipo UNIQUE (id, tipo)
      )`);
    // A lo sumo una política activa por tipo.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_politicas_activa_por_tipo
        ON politicas_consentimiento (tipo) WHERE activa`);

    // Una versión publicada es inmutable: solo puede retirarse. Nunca se elimina.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION politicas_consentimiento_protegida() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Las políticas de consentimiento no se eliminan: publique una versión nueva'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF (NEW.id, NEW.tipo, NEW.version, NEW.titulo, NEW.finalidad, NEW.contenido,
            NEW.texto_sha256, NEW.vigente_desde, NEW.publicada_por, NEW.creada_en)
           IS DISTINCT FROM
           (OLD.id, OLD.tipo, OLD.version, OLD.titulo, OLD.finalidad, OLD.contenido,
            OLD.texto_sha256, OLD.vigente_desde, OLD.publicada_por, OLD.creada_en) THEN
          RAISE EXCEPTION 'El contenido de una versión publicada no se modifica: publique una versión nueva'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER tg_politicas_consentimiento_protegida
      BEFORE UPDATE OR DELETE ON politicas_consentimiento
      FOR EACH ROW EXECUTE FUNCTION politicas_consentimiento_protegida()`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS consentimientos (
        id              uuid PRIMARY KEY,
        usuario_id      uuid         NOT NULL REFERENCES usuarios(id),
        practica_id     uuid         REFERENCES practicas(id),
        tipo            varchar(40)  NOT NULL,
        finalidad       varchar(500) NOT NULL,
        politica_id     uuid         NOT NULL,
        aceptado        boolean      NOT NULL,
        canal           varchar(20)  NOT NULL,
        registrado_por  uuid         NOT NULL REFERENCES usuarios(id),
        ip              varchar(60),
        agente_usuario  varchar(300),
        creado_en       timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT ck_consentimientos_tipo CHECK (tipo IN ('tratamiento_datos')),
        CONSTRAINT ck_consentimientos_canal CHECK (canal IN ('web','asistido')),
        CONSTRAINT fk_consentimientos_politica FOREIGN KEY (politica_id, tipo)
          REFERENCES politicas_consentimiento (id, tipo)
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_consentimientos_usuario ON consentimientos (usuario_id, tipo, creado_en DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_consentimientos_practica ON consentimientos (practica_id) WHERE practica_id IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_consentimientos_politica ON consentimientos (politica_id)',
    );

    // Solo inserción: se reutiliza el disparador de la auditoría (migración inicial).
    await queryRunner.query(`
      CREATE TRIGGER tg_consentimientos_inmutable
      BEFORE UPDATE OR DELETE ON consentimientos
      FOR EACH ROW EXECUTE FUNCTION auditoria_es_inmutable()`);

    // Mínimo privilegio: el historial no se actualiza ni se borra; las políticas no se borran.
    await queryRunner.query('GRANT SELECT, INSERT ON TABLE consentimientos TO sipra_app');
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE ON TABLE politicas_consentimiento TO sipra_app');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_consentimientos_inmutable ON consentimientos');
    await queryRunner.query('DROP TABLE IF EXISTS consentimientos');
    await queryRunner.query('DROP TRIGGER IF EXISTS tg_politicas_consentimiento_protegida ON politicas_consentimiento');
    await queryRunner.query('DROP FUNCTION IF EXISTS politicas_consentimiento_protegida()');
    await queryRunner.query('DROP TABLE IF EXISTS politicas_consentimiento');
    // `auditoria_es_inmutable()` pertenece a la migración inicial: no se toca.
  }
}
