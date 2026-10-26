import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogos oficiales: departamentos, jerarquía y — sobre todo — el ESTADO
 * de cada catálogo.
 *
 * `cat_estado` no es metadata decorativa. El módulo de reportes regulatorios
 * la consulta antes de emitir un archivo para la Unidad del SPE y se niega a
 * producirlo en preproducción o producción mientras un catálogo requerido siga
 * declarado como parcial. Un reporte construido sobre un catálogo incompleto se
 * radica, queda en firme, y luego hay que corregirlo ante la entidad.
 */
export class CatalogosYEstado1756000002000 implements MigrationInterface {
  name = 'CatalogosYEstado1756000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_departamento (
        codigo varchar(4) PRIMARY KEY,
        nombre varchar(150) NOT NULL,
        region varchar(40),
        CONSTRAINT ck_departamento_codigo CHECK (codigo ~ '^[0-9]{2}$')
      )`);

    // Se siembran los departamentos ya implicados por los municipios existentes
    // antes de imponer la llave foránea: de otro modo la migración fallaría
    // sobre una base que ya tiene datos.
    await queryRunner.query(`
      INSERT INTO cat_departamento (codigo, nombre)
      SELECT DISTINCT codigo_departamento, departamento
      FROM cat_divipola
      WHERE codigo_departamento ~ '^[0-9]{2}$'
      ON CONFLICT (codigo) DO NOTHING`);

    // El municipio cuelga del departamento y su código debe empezar por él.
    await queryRunner.query(`
      ALTER TABLE cat_divipola
      ADD CONSTRAINT fk_divipola_departamento
      FOREIGN KEY (codigo_departamento) REFERENCES cat_departamento(codigo)`);
    await queryRunner.query(`
      ALTER TABLE cat_divipola
      ADD CONSTRAINT ck_divipola_codigo
      CHECK (codigo ~ '^[0-9]{5}$' AND left(codigo, 2) = codigo_departamento)`);

    // Jerarquía de los catálogos de ocupación y actividad económica.
    // `cat_cno.nivel` ya significaba nivel ocupacional (directivo, profesional,
    // técnico). La jerarquía del catálogo va en columna propia: un mismo nombre
    // con dos sentidos es una fuente segura de error de lectura.
    await queryRunner.query(`ALTER TABLE cat_cno ADD COLUMN IF NOT EXISTS gran_grupo varchar(2)`);
    await queryRunner.query(`ALTER TABLE cat_cno ADD COLUMN IF NOT EXISTS jerarquia varchar(20)`);
    await queryRunner.query(`
      ALTER TABLE cat_cno ADD CONSTRAINT ck_cno_jerarquia
      CHECK (jerarquia IS NULL OR jerarquia IN ('gran_grupo','subgrupo','ocupacion'))`);
    await queryRunner.query(`ALTER TABLE cat_ciiu ADD COLUMN IF NOT EXISTS jerarquia varchar(20)`);
    await queryRunner.query(`
      ALTER TABLE cat_ciiu ADD CONSTRAINT ck_ciiu_jerarquia
      CHECK (jerarquia IS NULL OR jerarquia IN ('seccion','division','grupo','clase'))`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cat_estado (
        nombre           varchar(60) PRIMARY KEY,
        tabla            varchar(60) NOT NULL,
        estado           varchar(20) NOT NULL,
        filas_cargadas   integer NOT NULL DEFAULT 0,
        filas_esperadas  integer,
        detalle          jsonb,
        fuente           varchar(300),
        url_oficial      varchar(500),
        justificacion    text,
        hash_archivo     varchar(64),
        cargado_en       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_cat_estado CHECK (estado IN ('completo','parcial','ausente'))
      )`);

    // Los catálogos arrancan declarados como ausentes: hasta que el ingestor
    // corra, el sistema no puede afirmar que tenga nomenclatura oficial.
    for (const [nombre, tabla] of [
      ['divipola_departamento', 'cat_departamento'],
      ['divipola_municipio', 'cat_divipola'],
      ['ciiu', 'cat_ciiu'],
      ['cno', 'cat_cno'],
      ['nivel_educativo', 'cat_nivel_educativo'],
    ]) {
      await queryRunner.query(
        `INSERT INTO cat_estado (nombre, tabla, estado) VALUES ($1, $2, 'ausente')
         ON CONFLICT (nombre) DO NOTHING`,
        [nombre, tabla],
      );
    }

    await queryRunner.query('GRANT SELECT ON TABLE cat_departamento, cat_estado TO sipra_app');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS cat_estado');
    await queryRunner.query('ALTER TABLE cat_ciiu DROP CONSTRAINT IF EXISTS ck_ciiu_jerarquia');
    await queryRunner.query('ALTER TABLE cat_ciiu DROP COLUMN IF EXISTS jerarquia');
    await queryRunner.query('ALTER TABLE cat_cno DROP CONSTRAINT IF EXISTS ck_cno_jerarquia');
    await queryRunner.query('ALTER TABLE cat_cno DROP COLUMN IF EXISTS jerarquia');
    await queryRunner.query('ALTER TABLE cat_cno DROP COLUMN IF EXISTS gran_grupo');
    await queryRunner.query('ALTER TABLE cat_divipola DROP CONSTRAINT IF EXISTS ck_divipola_codigo');
    await queryRunner.query('ALTER TABLE cat_divipola DROP CONSTRAINT IF EXISTS fk_divipola_departamento');
    await queryRunner.query('DROP TABLE IF EXISTS cat_departamento');
  }
}
