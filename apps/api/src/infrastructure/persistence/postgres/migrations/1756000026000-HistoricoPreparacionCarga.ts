import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Histórico del SGP · H3 (preparación de la carga real). §27 de `docs/HISTORICO-PRACTICAS-AUDITORIA.md`.
 *
 * Solo toca el esquema `historico` (nunca `public`):
 *  - `practicas.organization_flags`: calidad de la ORGANIZACIÓN en la fila, separada de `quality_flags` (la calidad
 *    de la práctica). Un empleador con varios nombres ya no vuelve «observada» la práctica.
 *  - `practicas.organization_type_hint` y `organizaciones.organization_type_hint`: LEGAL_ENTITY / NATURAL_PERSON /
 *    UNKNOWN, solo cuando el identificador lo sustenta. Las versiones de H2 (inmutables) quedan con la pista en NULL:
 *    la restricción lo admite y no se reescriben.
 *  - `practicas.duplicado_de`: en un grupo de filas idénticas con `#` distinto, el `#` del representante; las
 *    métricas cuentan cada práctica una vez sin borrar filas.
 *  - `organizaciones.mapping_status`: estado de la correspondencia con `public.empresas` (derivado de
 *    `organizacion_mapping`; H3 no crea correspondencias masivas).
 *  - `importaciones.load_mode`: `single` (una transacción) o `batched` (lotes confirmados como versiones NO vigentes y
 *    una finalización atómica; si falla, la importación queda `failed` y sus versiones se purgan).
 *
 * Reversión: solo sin versiones históricas (se perdería la calidad de organización ya calculada).
 */
export class HistoricoPreparacionCarga1756000026000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE historico.practicas
        ADD COLUMN IF NOT EXISTS organization_flags text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS organization_type_hint varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS duplicado_de varchar(40) NULL`);
    await queryRunner.query(`ALTER TABLE historico.practicas ADD CONSTRAINT ck_hprac_org_hint
      CHECK (organization_type_hint IS NULL OR organization_type_hint IN ('LEGAL_ENTITY', 'NATURAL_PERSON', 'UNKNOWN'))`);
    await queryRunner.query(`ALTER TABLE historico.practicas ADD CONSTRAINT ck_hprac_hint_coherente
      CHECK ((organization_type_hint IS NULL OR organization_key IS NOT NULL)
        AND (organization_type_hint IS DISTINCT FROM 'LEGAL_ENTITY' OR organization_identifier_kind = 'juridica')
        AND (organization_type_hint IS DISTINCT FROM 'NATURAL_PERSON' OR organization_identifier_kind = 'persona_natural'))`);
    await queryRunner.query(`ALTER TABLE historico.practicas ADD CONSTRAINT ck_hprac_duplicado
      CHECK (duplicado_de IS NULL OR (duplicado_de <> source_record_id AND 'IDENTICAL_CONTENT' = ANY (quality_flags)))`);
    await queryRunner.query(`
      ALTER TABLE historico.organizaciones
        ADD COLUMN IF NOT EXISTS organization_type_hint varchar(16) NOT NULL DEFAULT 'UNKNOWN',
        ADD COLUMN IF NOT EXISTS mapping_status varchar(20) NOT NULL DEFAULT 'sin_correspondencia'`);
    await queryRunner.query(`ALTER TABLE historico.organizaciones ADD CONSTRAINT ck_horg_hint
      CHECK (organization_type_hint IN ('LEGAL_ENTITY', 'NATURAL_PERSON', 'UNKNOWN'))`);
    await queryRunner.query(`ALTER TABLE historico.organizaciones ADD CONSTRAINT ck_horg_mapping_status
      CHECK (mapping_status IN ('sin_correspondencia', 'propuesta', 'confirmada', 'rechazada'))`);

    await queryRunner.query(`ALTER TABLE historico.importaciones ADD COLUMN IF NOT EXISTS load_mode varchar(10) NOT NULL DEFAULT 'single'`);
    await queryRunner.query(`ALTER TABLE historico.importaciones ADD CONSTRAINT ck_himp_load_mode CHECK (load_mode IN ('single', 'batched'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = await queryRunner.query('SELECT count(*)::int AS n FROM historico.practicas') as { n: number }[];
    if (n > 0) throw new Error('HistoricoPreparacionCarga: hay versiones en historico.practicas; revierta las importaciones antes de bajar esta migración');
    await queryRunner.query('ALTER TABLE historico.importaciones DROP CONSTRAINT IF EXISTS ck_himp_load_mode');
    await queryRunner.query('ALTER TABLE historico.importaciones DROP COLUMN IF EXISTS load_mode');
    await queryRunner.query('ALTER TABLE historico.organizaciones DROP CONSTRAINT IF EXISTS ck_horg_mapping_status');
    await queryRunner.query('ALTER TABLE historico.organizaciones DROP CONSTRAINT IF EXISTS ck_horg_hint');
    await queryRunner.query('ALTER TABLE historico.organizaciones DROP COLUMN IF EXISTS mapping_status');
    await queryRunner.query('ALTER TABLE historico.organizaciones DROP COLUMN IF EXISTS organization_type_hint');
    for (const c of ['ck_hprac_duplicado', 'ck_hprac_hint_coherente', 'ck_hprac_org_hint']) {
      await queryRunner.query(`ALTER TABLE historico.practicas DROP CONSTRAINT IF EXISTS ${c}`);
    }
    for (const c of ['duplicado_de', 'organization_type_hint', 'organization_flags']) {
      await queryRunner.query(`ALTER TABLE historico.practicas DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
