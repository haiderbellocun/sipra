import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 5 EPS · Mesa operativa.
 *
 * Métricas de negocio de la validación (cuándo llegó el certificado y cuándo lo
 * tomó una persona por primera vez) e índices de la bandeja. Solo agrega columnas
 * nulas y copia la fecha de carga del certificado a lo ya existente; no toca
 * decisiones, evidencias ni privilegios.
 */
export class MesaEps1756000015000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        ADD COLUMN IF NOT EXISTS recibida_en         timestamptz,
        ADD COLUMN IF NOT EXISTS primera_revision_en timestamptz`);
    await queryRunner.query(`
      UPDATE validaciones_eps v SET recibida_en = d.cargado_en
      FROM documentos d WHERE d.id = v.documento_id AND v.recibida_en IS NULL`);
    await queryRunner.query(`
      UPDATE validaciones_eps SET primera_revision_en = LEAST(reservado_en, decidido_en)
      WHERE primera_revision_en IS NULL AND (reservado_en IS NOT NULL OR decidido_en IS NOT NULL)`);
    // La bandeja filtra por decisión abierta y por reserva.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_veps_mesa ON validaciones_eps (recibida_en)
      WHERE decision IN ('pendiente','candidato_autoaprobacion')`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ix_veps_decididas ON validaciones_eps (decidido_por, decidido_en)
      WHERE decidido_en IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ix_veps_decididas');
    await queryRunner.query('DROP INDEX IF EXISTS ix_veps_mesa');
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        DROP COLUMN IF EXISTS primera_revision_en,
        DROP COLUMN IF EXISTS recibida_en`);
  }
}
