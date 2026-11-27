import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motor de decisión documental automática (subfase 1.6A, §7.36) · estado `auto_devuelto`.
 *
 * `devuelto` es una DECISIÓN HUMANA (lleva `decidido_por`, es terminal para la persona y la auditoría la atribuye a un
 * actor). Una devolución del motor automático es otra cosa: no tiene actor, no es un rechazo y, como `ilegible`, permite que
 * el estudiante cargue una nueva versión. Por eso no se reutiliza `devuelto`: se agrega `auto_devuelto` al CHECK.
 *
 * Retrocompatible: solo AMPLÍA los valores permitidos; ninguna fila cambia. La reversión se NIEGA si ya existe algún
 * documento `auto_devuelto` (preferible un fallo explícito a borrar o reescribir una decisión registrada).
 */
export class DocumentoAutoDevuelto1756000029000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_estado');
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_estado CHECK (estado IN
        ('recibido','analizando','auto_aprobado','en_revision','ilegible','devuelto','auto_devuelto','aprobado','rechazado'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = (await queryRunner.query(`SELECT count(*)::int AS n FROM documentos WHERE estado = 'auto_devuelto'`)) as { n: number }[];
    if (n > 0) {
      throw new Error(`No se revierte: hay ${n} documento(s) en estado auto_devuelto. Resuélvalos antes de revertir.`);
    }
    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_estado');
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_estado CHECK (estado IN
        ('recibido','analizando','auto_aprobado','en_revision','ilegible','devuelto','aprobado','rechazado'))`);
  }
}
