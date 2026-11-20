import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico del SGP · H4 (capa analítica unificada). §28 de `docs/HISTORICO-PRACTICAS-AUDITORIA.md`.
 *
 * `historico.practica_correspondencia`: registro de correspondencias entre un registro del SGP y una práctica de
 * SIPRA. SIPRA no conserva el `#` del SGP (P-42), así que un solapamiento CONFIRMADO necesita dónde quedar escrito. Es
 * la única fuente que la capa analítica usa para deduplicar ALL (la práctica de SIPRA gana); candidatos y ambiguos
 * nunca se deduplican.
 *
 *  - Sin FK hacia `public.practicas` (el histórico no depende de la operación ni la bloquea).
 *  - `confirmada` exige revisor y fecha; método `sgp_id` (el `#` del SGP conservado) o `manual` (revisión humana);
 *    nunca por parecido.
 *  - Una sola confirmada por registro del SGP y por práctica de SIPRA.
 *  - H4 no crea ninguna fila: es un registro de decisiones.
 *  - El rol de aplicación no tiene acceso (la API todavía no lee el histórico; H5).
 *
 * Reversión: solo sin filas.
 */
export class HistoricoCorrespondenciaPracticas1756000027000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS historico.practica_correspondencia (
        id                uuid PRIMARY KEY,
        source_system     varchar(20) NOT NULL,
        source_record_id  varchar(40) NOT NULL,
        practica_id       uuid NOT NULL,
        method            varchar(10) NOT NULL,
        status            varchar(12) NOT NULL,
        reviewed_by       uuid NULL,
        reviewed_at       timestamptz NULL,
        notes             varchar(500) NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_hcorr_source_system CHECK (source_system IN ('SGP', 'SGP_SINTETICO')),
        CONSTRAINT ck_hcorr_method CHECK (method IN ('sgp_id', 'manual')),
        CONSTRAINT ck_hcorr_status CHECK (status IN ('propuesta', 'confirmada', 'rechazada')),
        CONSTRAINT ck_hcorr_revision CHECK (status = 'propuesta' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hcorr_registro_confirmado
      ON historico.practica_correspondencia (source_system, source_record_id) WHERE status = 'confirmada'`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hcorr_practica_confirmada
      ON historico.practica_correspondencia (practica_id) WHERE status = 'confirmada'`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sipra_app') THEN
          REVOKE ALL ON TABLE historico.practica_correspondencia FROM sipra_app;
        END IF;
      END $$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = await queryRunner.query('SELECT count(*)::int AS n FROM historico.practica_correspondencia') as { n: number }[];
    if (n > 0) throw new Error('HistoricoCorrespondenciaPracticas: hay correspondencias registradas; no se borran al bajar la migración');
    await queryRunner.query('DROP TABLE IF EXISTS historico.practica_correspondencia');
  }
}
