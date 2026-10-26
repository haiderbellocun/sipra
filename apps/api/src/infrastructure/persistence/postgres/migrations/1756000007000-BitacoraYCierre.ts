import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bitácora y cierre (SGP, capítulos 4.3 y 5).
 *
 * La bitácora es la trazabilidad del acompañamiento: el rol de aplicación
 * solo puede leerla y agregar entradas. «Evalúa tu proceso» se responde una
 * sola vez por práctica; lo garantiza un índice parcial, no la aplicación.
 */
export class BitacoraYCierre1756000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bitacora_entradas (
        id           uuid PRIMARY KEY,
        practica_id  uuid NOT NULL REFERENCES practicas(id) ON DELETE CASCADE,
        tipo         varchar(30) NOT NULL,
        autor        varchar(15) NOT NULL,
        autor_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        mensaje      text NOT NULL,
        detalle      jsonb,
        vence_el     timestamptz,
        creada_en    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_bitacora_tipo CHECK (tipo IN (
          'mensaje_libre','seguimiento','evaluacion_final','evalua_tu_proceso',
          'calificacion_docente','plazo_subsanacion','sistema')),
        CONSTRAINT ck_bitacora_autor CHECK (autor IN ('estudiante','docente','coordinacion','sistema'))
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_bitacora_practica_fecha ON bitacora_entradas (practica_id, creada_en)',
    );
    await queryRunner.query('CREATE INDEX IF NOT EXISTS ix_bitacora_creada ON bitacora_entradas (creada_en)');
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_bitacora_evalua_tu_proceso
        ON bitacora_entradas (practica_id) WHERE tipo = 'evalua_tu_proceso'`);
    // Trazabilidad: se agrega, no se corrige.
    await queryRunner.query('GRANT SELECT, INSERT ON TABLE bitacora_entradas TO sipra_app');
    // Cierre coherente: una práctica cerrada o reprobada lleva nota y fecha de cierre.
    await queryRunner.query(`
      ALTER TABLE practicas ADD CONSTRAINT ck_practicas_cierre CHECK (
        estado NOT IN ('certificada','reprobada') OR (nota IS NOT NULL AND cerrada_en IS NOT NULL)
        OR registrada_por = 'coordinacion')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_cierre');
    await queryRunner.query('DROP TABLE IF EXISTS bitacora_entradas');
  }
}
