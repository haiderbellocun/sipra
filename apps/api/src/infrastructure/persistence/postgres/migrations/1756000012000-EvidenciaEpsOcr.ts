import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 EPS · lectura local: la evidencia puede ser de tipo `ocr`.
 *
 * Solo se ajustan las restricciones de `evidencias_validacion_eps` (tipo y
 * coherencia tipo-fuente). No se toca ningún dato, el disparador de
 * inmutabilidad ni los privilegios: la tabla sigue siendo de solo inserción.
 */
export class EvidenciaEpsOcr1756000012000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE evidencias_validacion_eps DROP CONSTRAINT IF EXISTS ck_evidencias_eps_tipo');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_eps ADD CONSTRAINT ck_evidencias_eps_tipo CHECK (tipo IN
        ('texto_pdf','ocr','qr','respuesta_eps','adres','revision_humana'))`);
    await queryRunner.query('ALTER TABLE evidencias_validacion_eps DROP CONSTRAINT IF EXISTS ck_evidencias_eps_tipo_fuente');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_eps ADD CONSTRAINT ck_evidencias_eps_tipo_fuente CHECK (
        (tipo = 'texto_pdf' AND fuente = 'certificado')
        OR (tipo = 'ocr' AND fuente = 'certificado')
        OR (tipo = 'qr' AND fuente IN ('certificado','qr_oficial'))
        OR (tipo = 'respuesta_eps' AND fuente IN ('eps_oficial','qr_oficial'))
        OR (tipo = 'adres' AND fuente = 'adres')
        OR (tipo = 'revision_humana' AND fuente = 'revision_humana'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Las evidencias de tipo `ocr` ya registradas no se borran (la tabla es de solo inserción):
    // si existen, volver a la restricción anterior fallará a propósito.
    await queryRunner.query('ALTER TABLE evidencias_validacion_eps DROP CONSTRAINT IF EXISTS ck_evidencias_eps_tipo_fuente');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_eps ADD CONSTRAINT ck_evidencias_eps_tipo_fuente CHECK (
        (tipo = 'texto_pdf' AND fuente = 'certificado')
        OR (tipo = 'qr' AND fuente IN ('certificado','qr_oficial'))
        OR (tipo = 'respuesta_eps' AND fuente IN ('eps_oficial','qr_oficial'))
        OR (tipo = 'adres' AND fuente = 'adres')
        OR (tipo = 'revision_humana' AND fuente = 'revision_humana'))`);
    await queryRunner.query('ALTER TABLE evidencias_validacion_eps DROP CONSTRAINT IF EXISTS ck_evidencias_eps_tipo');
    await queryRunner.query(`
      ALTER TABLE evidencias_validacion_eps ADD CONSTRAINT ck_evidencias_eps_tipo CHECK (tipo IN
        ('texto_pdf','qr','respuesta_eps','adres','revision_humana'))`);
  }
}
