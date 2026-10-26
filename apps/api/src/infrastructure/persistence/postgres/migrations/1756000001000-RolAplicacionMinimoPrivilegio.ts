import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Principio de mínimo privilegio (sección 6.3 del manual de la Fábrica).
 *
 * El rol de aplicación `sipra_app` recibe SELECT/INSERT/UPDATE/DELETE sobre las
 * tablas operativas, solo SELECT sobre los catálogos y solo INSERT sobre
 * `auditoria`. Sin UPDATE ni DELETE: el histórico es inmutable por permisos,
 * además de por el trigger de la migración anterior.
 *
 * El rol se crea únicamente si no existe, para no interferir con la gestión de
 * usuarios que haga la Dirección de Tecnología en Cloud SQL.
 */
export class RolAplicacionMinimoPrivilegio1756000001000 implements MigrationInterface {
  name = 'RolAplicacionMinimoPrivilegio1756000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sipra_app') THEN
          CREATE ROLE sipra_app NOLOGIN;
        END IF;
      END
      $$`);

    await queryRunner.query('GRANT USAGE ON SCHEMA public TO sipra_app');

    const operativas = [
      'usuarios', 'empresas', 'practicas', 'documentos', 'obligaciones',
      'vacantes', 'postulaciones', 'habilitaciones_bolsa',
    ];
    for (const tabla of operativas) {
      await queryRunner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tabla} TO sipra_app`,
      );
    }

    const catalogos = ['cat_cno', 'cat_ciiu', 'cat_divipola', 'cat_nivel_educativo', 'cat_escuela'];
    for (const tabla of catalogos) {
      await queryRunner.query(`GRANT SELECT ON TABLE ${tabla} TO sipra_app`);
    }

    // Auditoría: solo se escribe hacia adelante.
    await queryRunner.query('GRANT SELECT, INSERT ON TABLE auditoria TO sipra_app');
    await queryRunner.query('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE auditoria FROM sipra_app');

    await queryRunner.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sipra_app');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sipra_app');
    await queryRunner.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM sipra_app');
    await queryRunner.query('REVOKE USAGE ON SCHEMA public FROM sipra_app');
  }
}
