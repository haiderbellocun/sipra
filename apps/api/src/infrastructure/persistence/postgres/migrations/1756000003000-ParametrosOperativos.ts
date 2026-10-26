import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M12 — Sobrescrituras de parámetros operativos.
 *
 * La tabla guarda solo lo que se apartó del valor por defecto: el catálogo con
 * los tipos, los rangos y la naturaleza de cada parámetro vive en el código, no
 * aquí. Así una fila huérfana o una clave inventada no pueden alterar el
 * comportamiento del sistema.
 *
 * `sipra_app` puede leer y escribir esta tabla, pero el historial de quién
 * cambió qué no vive aquí sino en `auditoria`, que es inmutable.
 */
export class ParametrosOperativos1756000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS parametros (
        clave           varchar(80) PRIMARY KEY,
        valor           jsonb       NOT NULL,
        motivo          text        NOT NULL,
        actualizado_por uuid        NOT NULL REFERENCES usuarios(id),
        actualizado_en  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_parametros_motivo CHECK (length(btrim(motivo)) >= 10)
      )`);

    await queryRunner.query(
      'COMMENT ON TABLE parametros IS ' +
        "'Sobrescrituras de parámetros operativos. El catálogo vive en el código.'",
    );
    await queryRunner.query(
      'COMMENT ON COLUMN parametros.motivo IS ' +
        "'Por qué se cambió. Un umbral movido sin razón escrita es un cambio que nadie puede revisar después.'",
    );

    await queryRunner.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE parametros TO sipra_app',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS parametros');
  }
}
