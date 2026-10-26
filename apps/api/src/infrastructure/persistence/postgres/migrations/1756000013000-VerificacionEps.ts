import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3 EPS · verificación oficial.
 *
 * Agrega a `validaciones_eps` la huella de la verificación (qué verificador, cuándo,
 * último error y el reclamo en curso) y dos restricciones que impiden afirmar
 * autenticidad (`verificada`/`invalida`) o afiliación (`activa`/`inactiva`) sin un
 * verificador y una fecha. Solo agrega columnas nulas: no toca datos ni privilegios.
 */
export class VerificacionEps1756000013000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        ADD COLUMN IF NOT EXISTS verificador_codigo        varchar(60),
        ADD COLUMN IF NOT EXISTS verificacion_iniciada_en  timestamptz,
        ADD COLUMN IF NOT EXISTS verificado_en             timestamptz,
        ADD COLUMN IF NOT EXISTS verificacion_error        varchar(40)`);
    await queryRunner.query(`
      ALTER TABLE validaciones_eps ADD CONSTRAINT ck_veps_verificacion_coherente CHECK (
        (verificador_codigo IS NULL) = (verificado_en IS NULL))`);
    await queryRunner.query(`
      ALTER TABLE validaciones_eps ADD CONSTRAINT ck_veps_requiere_verificador CHECK (
        (autenticidad NOT IN ('verificada','invalida') AND afiliacion NOT IN ('activa','inactiva'))
        OR (verificador_codigo IS NOT NULL AND verificado_en IS NOT NULL))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE validaciones_eps DROP CONSTRAINT IF EXISTS ck_veps_requiere_verificador');
    await queryRunner.query('ALTER TABLE validaciones_eps DROP CONSTRAINT IF EXISTS ck_veps_verificacion_coherente');
    await queryRunner.query(`
      ALTER TABLE validaciones_eps
        DROP COLUMN IF EXISTS verificacion_error,
        DROP COLUMN IF EXISTS verificado_en,
        DROP COLUMN IF EXISTS verificacion_iniciada_en,
        DROP COLUMN IF EXISTS verificador_codigo`);
  }
}
