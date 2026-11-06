import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cámara de Comercio · Bloque 4 (decisión humana). La infraestructura de la migración 20 (estados de decisión, decisor, reserva,
 * huella de SIPRA, evidencias) ya cubre la Cámara: NO se crea ninguna tabla ni columna. El único hueco demostrado es el CHECK del
 * motivo de devolución, que solo admitía los del RUT: aquí se amplía con los motivos propios de la Cámara.
 *
 * La reversión se NIEGA si ya hay devoluciones con alguno de esos motivos (preferible un fallo explícito a dejar filas que el
 * esquema anterior rechaza o a borrar trazabilidad).
 */
const MOTIVOS_RUT = [
  'documento_incorrecto', 'persona_no_coincide', 'rut_no_corresponde', 'documento_no_coincide', 'nombre_no_coincide',
  'nit_no_coincide', 'dv_no_coincide', 'razon_social_no_coincide', 'documento_ilegible', 'informacion_incompleta', 'otro',
];
const MOTIVOS_CAMARA = ['tipo_certificado_incorrecto', 'representante_no_coincide', 'matricula_cancelada'];

const lista = (motivos: readonly string[]): string => motivos.map((m) => `'${m}'`).join(',');

export class MotivosDecisionCamara1756000021000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE validaciones_documento_empresarial DROP CONSTRAINT IF EXISTS ck_vdemp_motivo');
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial ADD CONSTRAINT ck_vdemp_motivo CHECK (
        motivo_decision IS NULL OR motivo_decision IN (${lista([...MOTIVOS_RUT, ...MOTIVOS_CAMARA])}))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usados = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE motivo_decision IN (${lista(MOTIVOS_CAMARA)})`,
    )) as { n: number }[];
    if (usados[0].n > 0) throw new Error('No se revierte: hay devoluciones de Cámara con motivos que el esquema anterior no admite');
    await queryRunner.query('ALTER TABLE validaciones_documento_empresarial DROP CONSTRAINT IF EXISTS ck_vdemp_motivo');
    await queryRunner.query(`
      ALTER TABLE validaciones_documento_empresarial ADD CONSTRAINT ck_vdemp_motivo CHECK (
        motivo_decision IS NULL OR motivo_decision IN (${lista(MOTIVOS_RUT)}))`);
  }
}
