import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gobierno operativo · G1 (roles). El CHECK de `usuarios.rol` admite dos perfiles nuevos:
 *   - `director`: gobierno operativo institucional;
 *   - `analista`: Área de Prácticas, independiente de `coordinador`.
 *
 * Solo amplía la restricción: no toca filas. Los usuarios con rol `coordinador` siguen siéndolo
 * (no se infiere ningún perfil nuevo). La reversión se NIEGA si ya existen usuarios con alguno de
 * los roles nuevos: preferible un fallo explícito a dejar filas que el esquema anterior rechaza o a
 * reasignar perfiles en silencio.
 */
const ROLES_ANTERIORES = ['estudiante', 'tutor', 'coordinador', 'administrador', 'empresa', 'extension', 'auxiliar'];
const ROLES_NUEVOS = ['director', 'analista'];

const lista = (roles: readonly string[]): string => roles.map((r) => `'${r}'`).join(',');

export class RolesGobiernoOperativo1756000022000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol');
    await queryRunner.query(
      `ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN (${lista([...ROLES_ANTERIORES, ...ROLES_NUEVOS])}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usados = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM usuarios WHERE rol IN (${lista(ROLES_NUEVOS)})`,
    )) as { n: number }[];
    if (usados[0].n > 0) throw new Error('No se revierte: hay usuarios con rol director o analista que el esquema anterior no admite');
    await queryRunner.query('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol');
    await queryRunner.query(`ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN (${lista(ROLES_ANTERIORES)}))`);
  }
}
