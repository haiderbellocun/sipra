import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Carta de presentación digital: referencia única verificable, estado, snapshot de emisión y PDF emitido con su
 * SHA-256 en el almacenamiento de SIPRA. Se EXTIENDE la tabla existente (`cartas_presentacion`); las cartas
 * anteriores quedan con referencia y archivo nulos, en estado `vigente`, y se siguen reimprimiendo desde `contenido`.
 *
 * Inmutabilidad en el motor (no solo en el código):
 *  - una carta con referencia no cambia de referencia, snapshot, archivo, hash, estudiante ni fecha;
 *  - solo cambia su estado (vigente → reemplazada | anulada), nunca de vuelta;
 *  - una carta con referencia no se borra.
 * Reversión: quita el disparador, las restricciones y las columnas nuevas (las cartas digitales pierden su
 * referencia): solo para bases desechables.
 */
export class CartaPresentacionDigital1756000024000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cartas_presentacion
        ADD COLUMN IF NOT EXISTS referencia varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS estado varchar(12) NOT NULL DEFAULT 'vigente',
        ADD COLUMN IF NOT EXISTS reemplazada_por uuid NULL REFERENCES cartas_presentacion (id) ON DELETE RESTRICT,
        ADD COLUMN IF NOT EXISTS ruta_archivo varchar(300) NULL,
        ADD COLUMN IF NOT EXISTS pdf_sha256 varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS snapshot jsonb NULL,
        ADD COLUMN IF NOT EXISTS modalidad varchar(40) NULL,
        ADD COLUMN IF NOT EXISTS anulada_en timestamptz NULL,
        ADD COLUMN IF NOT EXISTS motivo_anulacion text NULL
    `);
    await queryRunner.query(`ALTER TABLE cartas_presentacion ADD CONSTRAINT ck_cartas_estado
      CHECK (estado IN ('vigente', 'reemplazada', 'anulada'))`);
    await queryRunner.query(`ALTER TABLE cartas_presentacion ADD CONSTRAINT ck_cartas_reemplazo
      CHECK ((estado = 'reemplazada') = (reemplazada_por IS NOT NULL))`);
    await queryRunner.query(`ALTER TABLE cartas_presentacion ADD CONSTRAINT ck_cartas_anulacion
      CHECK ((estado = 'anulada') = (anulada_en IS NOT NULL AND motivo_anulacion IS NOT NULL))`);
    // Una carta digital lleva TODO junto: referencia, archivo, huella del PDF y snapshot.
    await queryRunner.query(`ALTER TABLE cartas_presentacion ADD CONSTRAINT ck_cartas_digital_completa
      CHECK ((referencia IS NULL AND ruta_archivo IS NULL AND pdf_sha256 IS NULL AND snapshot IS NULL)
          OR (referencia IS NOT NULL AND ruta_archivo IS NOT NULL AND pdf_sha256 IS NOT NULL AND pdf_sha256 ~ '^[0-9a-f]{64}$' AND snapshot IS NOT NULL))`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_cartas_referencia ON cartas_presentacion (referencia) WHERE referencia IS NOT NULL',
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION cartas_presentacion_inmutable() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.referencia IS NOT NULL THEN
            RAISE EXCEPTION 'Una carta de presentación emitida (%) no se borra', OLD.referencia;
          END IF;
          RETURN OLD;
        END IF;
        IF OLD.referencia IS NOT NULL AND (
             NEW.referencia IS DISTINCT FROM OLD.referencia OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
          OR NEW.ruta_archivo IS DISTINCT FROM OLD.ruta_archivo OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
          OR NEW.contenido IS DISTINCT FROM OLD.contenido OR NEW.estudiante_id IS DISTINCT FROM OLD.estudiante_id
          OR NEW.generada_en IS DISTINCT FROM OLD.generada_en OR NEW.empresa_razon_social IS DISTINCT FROM OLD.empresa_razon_social) THEN
          RAISE EXCEPTION 'La carta de presentación % es inmutable: solo cambia su estado', OLD.referencia;
        END IF;
        IF OLD.estado <> 'vigente' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
          RAISE EXCEPTION 'La carta de presentación % ya no está vigente: su estado no cambia', OLD.referencia;
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER tr_cartas_presentacion_inmutable BEFORE UPDATE OR DELETE ON cartas_presentacion
      FOR EACH ROW EXECUTE FUNCTION cartas_presentacion_inmutable()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS tr_cartas_presentacion_inmutable ON cartas_presentacion');
    await queryRunner.query('DROP FUNCTION IF EXISTS cartas_presentacion_inmutable()');
    await queryRunner.query('DROP INDEX IF EXISTS ux_cartas_referencia');
    for (const c of ['ck_cartas_digital_completa', 'ck_cartas_anulacion', 'ck_cartas_reemplazo', 'ck_cartas_estado']) {
      await queryRunner.query(`ALTER TABLE cartas_presentacion DROP CONSTRAINT IF EXISTS ${c}`);
    }
    await queryRunner.query(`
      ALTER TABLE cartas_presentacion
        DROP COLUMN IF EXISTS motivo_anulacion, DROP COLUMN IF EXISTS anulada_en, DROP COLUMN IF EXISTS modalidad,
        DROP COLUMN IF EXISTS snapshot, DROP COLUMN IF EXISTS pdf_sha256, DROP COLUMN IF EXISTS ruta_archivo,
        DROP COLUMN IF EXISTS reemplazada_por, DROP COLUMN IF EXISTS estado, DROP COLUMN IF EXISTS referencia
    `);
  }
}
