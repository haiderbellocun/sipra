import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bloque 3 del acta de iniciación · quién asume la ARL en cada práctica.
 *
 * Dato EXPLÍCITO de la práctica, distinto de dos cosas con las que no se confunde:
 *  · el valor por defecto de la modalidad (catálogo; solo sugiere en el formulario de registro);
 *  · lo que diga el acta de iniciación (fuente documental independiente: confirma o contradice, nunca establece).
 *
 * La columna es nula: las prácticas anteriores quedan «no informado». NO se rellenan —ni derivándolo de la
 * modalidad— y esta migración no modifica ninguna fila existente. La remuneración no se toca: ya existe como
 * `tipo_remuneracion`.
 */
export class ResponsableArlPractica1756000016000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE practicas ADD COLUMN IF NOT EXISTS responsable_arl varchar(10)');
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_responsable_arl');
    await queryRunner.query(`
      ALTER TABLE practicas ADD CONSTRAINT ck_practicas_responsable_arl
        CHECK (responsable_arl IS NULL OR responsable_arl IN ('empresa','cun'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_responsable_arl');
    await queryRunner.query('ALTER TABLE practicas DROP COLUMN IF EXISTS responsable_arl');
  }
}
