import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Modalidades reales de práctica de la CUN y los documentos que exigen.
 *
 * Las cinco modalidades genéricas anteriores se reemplazan por las nueve del
 * diseño funcional. La correspondencia se aplica a los datos existentes antes
 * de estrechar la restricción: dejar filas fuera del catálogo nuevo haría
 * fallar la migración justo donde hay datos reales.
 *
 * `documentos.etapa` entra aquí y no como tabla aparte porque es un atributo
 * del documento dentro del expediente, no una entidad con vida propia.
 */
export class ModalidadesRealesYEtapas1756000004000 implements MigrationInterface {
  private readonly correspondencia: readonly [string, string][] = [
    ['empresarial', 'pasantia'],
    ['proyecto_social', 'social'],
    ['emprendimiento', 'cunbre_naciente'],
    ['vinculo_laboral', 'combinacion_funciones'],
    ['homologacion_experiencia', 'validacion_experiencia'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_modalidad');
    for (const [antes, ahora] of this.correspondencia) {
      await queryRunner.query('UPDATE practicas SET modalidad = $1 WHERE modalidad = $2',
        [ahora, antes]);
    }
    await queryRunner.query(`
      ALTER TABLE practicas ADD CONSTRAINT ck_practicas_modalidad CHECK (modalidad IN
        ('monitoria','social','investigacion','pasantia','cunbre_naciente',
         'cunbre_consolidado','contrato_aprendizaje','validacion_experiencia',
         'combinacion_funciones'))`);

    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_tipo');
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_tipo CHECK (tipo IN
        ('cedula','certificado_eps','acta_inicio','rut_natural','rut_juridico',
         'camara_comercio','soporte_relacion_laboral','autorizacion_funciones',
         'carta_aceptacion','certificado_arl','convenio_practica','planilla_horas',
         'plan_mejoramiento','certificado_existencia','certificacion_laboral',
         'planilla_aportes','certificado_practica'))`);

    // La etapa se deduce del tipo para lo ya cargado; de ahí en adelante la
    // fija la aplicación al recibir el documento.
    await queryRunner.query(`
      ALTER TABLE documentos ADD COLUMN IF NOT EXISTS etapa varchar(20)
        NOT NULL DEFAULT 'pre_postulacion'`);
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_etapa CHECK (etapa IN
        ('pre_postulacion','formalizacion','inicio','cierre'))`);
    await queryRunner.query(`
      UPDATE documentos SET etapa = CASE
        WHEN tipo IN ('cedula','certificado_eps','rut_natural','rut_juridico',
                      'camara_comercio','soporte_relacion_laboral','autorizacion_funciones')
          THEN 'pre_postulacion'
        WHEN tipo IN ('acta_inicio','carta_aceptacion','convenio_practica') THEN 'formalizacion'
        WHEN tipo IN ('certificado_arl') THEN 'inicio'
        ELSE 'cierre' END`);

    // Quién afilia se resuelve por convenio con la organización, nunca por el
    // nombre de la empresa ni por la modalidad sola.
    await queryRunner.query(`
      ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cobertura_arl varchar(20)`);
    await queryRunner.query(`
      ALTER TABLE empresas ADD CONSTRAINT ck_empresas_cobertura_arl CHECK
        (cobertura_arl IS NULL OR cobertura_arl IN ('cun','empresa','segun_cobertura'))`);
    await queryRunner.query(`
      ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cobertura_arl_vigente_hasta date`);
    await queryRunner.query(
      "COMMENT ON COLUMN empresas.cobertura_arl IS " +
        "'Convenio de cobertura registrado. NULL = rige el valor por defecto de la modalidad.'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE empresas DROP CONSTRAINT IF EXISTS ck_empresas_cobertura_arl');
    await queryRunner.query('ALTER TABLE empresas DROP COLUMN IF EXISTS cobertura_arl_vigente_hasta');
    await queryRunner.query('ALTER TABLE empresas DROP COLUMN IF EXISTS cobertura_arl');
    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_etapa');
    await queryRunner.query('ALTER TABLE documentos DROP COLUMN IF EXISTS etapa');
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_modalidad');
    for (const [antes, ahora] of this.correspondencia) {
      await queryRunner.query('UPDATE practicas SET modalidad = $1 WHERE modalidad = $2',
        [antes, ahora]);
    }
  }
}
