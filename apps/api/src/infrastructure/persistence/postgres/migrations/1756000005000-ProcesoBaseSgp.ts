import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proceso base del Sistema de Gestión de Prácticas (SGP), tramo A.
 *
 * Lo que los manuales de la plataforma actual fijan y SIPRA no tenía:
 *  - el perfil de auxiliar de prácticas y el permiso de solo consulta;
 *  - los estados «anulado» y «reprueba»;
 *  - las quince modalidades del selector y los documentos que cada una exige,
 *    con un segundo momento de avance entre el inicio y el cierre;
 *  - los periodos académicos con sus ventanas de habilitación.
 *
 * De paso se corrige la compuerta ARL de la base: seguía nombrando la
 * modalidad antigua `homologacion_experiencia`, con lo que una validación de
 * experiencia activa habría violado la restricción aunque el dominio la exime.
 */
export class ProcesoBaseSgp1756000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Usuarios: auxiliar y permiso ────────────────────────────────────────
    await queryRunner.query('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol');
    await queryRunner.query(`
      ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN
        ('estudiante','tutor','coordinador','administrador','empresa','extension','auxiliar'))`);
    await queryRunner.query(`
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permiso varchar(12) NOT NULL DEFAULT 'escritura'`);
    await queryRunner.query(`
      ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_permiso CHECK (permiso IN ('consulta','escritura'))`);

    // ── Prácticas: estados y modalidades del SGP ───────────────────────────
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_estado');
    await queryRunner.query(`
      ALTER TABLE practicas ADD CONSTRAINT ck_practicas_estado CHECK (estado IN
        ('inscrita','documentacion','en_validacion','activa','finalizada','certificada',
         'suspendida','cancelada','anulada','reprobada'))`);
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_modalidad');
    await queryRunner.query(`
      ALTER TABLE practicas ADD CONSTRAINT ck_practicas_modalidad CHECK (modalidad IN
        ('monitoria','social','investigacion','practica_tecnica_investigacion',
         'pasantia_investigativa','cunbre_naciente','cunbre_consolidado',
         'contrato_aprendizaje','validacion_experiencia','combinacion_funciones',
         'pasantia','pasantia_internacional','estado_joven','asesoria_asistencia_tecnica'))`);

    // La compuerta de la base debe eximir a las mismas modalidades que el
    // dominio: donde ya hay vínculo laboral, la cobertura viene de ese vínculo.
    await queryRunner.query('ALTER TABLE practicas DROP CONSTRAINT IF EXISTS ck_practicas_compuerta_arl');
    await queryRunner.query(`
      ALTER TABLE practicas ADD CONSTRAINT ck_practicas_compuerta_arl CHECK (
        estado <> 'activa'
        OR modalidad IN ('validacion_experiencia','combinacion_funciones')
        OR (arl_verificada
            AND arl_fecha_afiliacion IS NOT NULL
            AND fecha_inicio IS NOT NULL
            AND arl_fecha_afiliacion::date < fecha_inicio::date))`);

    // ── Documentos: tipos del SGP y segundo momento ────────────────────────
    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_tipo');
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_tipo CHECK (tipo IN
        ('cedula','certificado_eps','acta_inicio','rut_natural','rut_juridico',
         'camara_comercio','soporte_relacion_laboral','autorizacion_funciones',
         'carta_aceptacion','certificado_arl','convenio_practica','planilla_horas',
         'plan_mejoramiento','certificado_existencia','certificacion_laboral',
         'planilla_aportes','certificado_practica',
         'contrato_aprendizaje','certificado_laboral_funciones','contrato_laboral',
         'formato_seguimiento_final','carta_finalizacion','avance_plan_mejoramiento',
         'propuesta_articulo','constancia_publicacion','soporte_aceptacion_cunbre',
         'entregable_mentoria_1','entregable_mentoria_2','entregable_mentoria_3',
         'entregable_mentoria_4','entregable_mentoria_5','entregable_mentoria_6',
         'entregable_mentoria_7','entregable_mentoria_8','evaluacion_final_cunbre',
         'informe_1','informe_2','informe_final'))`);
    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_etapa');
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_etapa CHECK (etapa IN
        ('pre_postulacion','formalizacion','inicio','avance','cierre'))`);

    // ── Periodos académicos ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS periodos_academicos (
        codigo                   varchar(12) PRIMARY KEY,
        nombre                   varchar(80) NOT NULL,
        calendario               varchar(12) NOT NULL,
        fecha_inicio             date NOT NULL,
        fecha_fin                date NOT NULL,
        ventanas                 jsonb NOT NULL DEFAULT '{}',
        sincronizacion_docentes  boolean NOT NULL DEFAULT true,
        modalidades_habilitadas  text[] NOT NULL DEFAULT '{}',
        activo                   boolean NOT NULL DEFAULT true,
        creado_en                timestamptz NOT NULL DEFAULT now(),
        actualizado_en           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_periodos_calendario CHECK (calendario IN ('presencial','virtual')),
        CONSTRAINT ck_periodos_fechas CHECK (fecha_fin > fecha_inicio)
      )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_periodos_calendario ON periodos_academicos (calendario)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS ix_periodos_activo ON periodos_academicos (activo)',
    );
    await queryRunner.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE periodos_academicos TO sipra_app',
    );
    await queryRunner.query(
      "COMMENT ON TABLE periodos_academicos IS " +
        "'Periodos de prácticas con sus ventanas de habilitación (gestión de periodos del SGP).'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS periodos_academicos');
    await queryRunner.query('ALTER TABLE documentos DROP CONSTRAINT IF EXISTS ck_documentos_etapa');
    await queryRunner.query(`
      ALTER TABLE documentos ADD CONSTRAINT ck_documentos_etapa CHECK (etapa IN
        ('pre_postulacion','formalizacion','inicio','cierre'))`);
    await queryRunner.query('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_permiso');
    await queryRunner.query('ALTER TABLE usuarios DROP COLUMN IF EXISTS permiso');
    await queryRunner.query('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol');
    await queryRunner.query(`
      ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN
        ('estudiante','tutor','coordinador','administrador','empresa','extension'))`);
    // Los CHECK ampliados de prácticas y documentos se conservan: estrecharlos
    // fallaría en cuanto exista una fila con los valores nuevos.
  }
}
