import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gobierno operativo · G2. Habilitación manual del cargue de documentos del estudiante, separada
 * de `activo` (que gobierna el periodo completo): el periodo puede seguir vigente y la dirección
 * cerrar temporalmente el cargue sin perder las fechas de la ventana.
 *
 * Los periodos existentes quedan en TRUE para no cerrar por accidente ninguna ventana ya
 * configurada. No se tocan fechas ni ventanas. La reversión solo quita la columna.
 */
export class CargueEstudiantePeriodo1756000023000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE periodos_academicos ADD COLUMN IF NOT EXISTS cargue_estudiante_habilitado boolean NOT NULL DEFAULT true',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE periodos_academicos DROP COLUMN IF EXISTS cargue_estudiante_habilitado');
  }
}
