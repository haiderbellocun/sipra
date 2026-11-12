import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  FiltroAnalitica, PeriodoAnalitica, PracticaAnalitica, ReportesAnaliticaPort, VersionAnalitica,
} from '../../../../domain/ports/out/reportes-analitica.port';

/**
 * Filtro común de prácticas, parametrizado. `escuelaIds` vacío (alcance sin escuelas) no devuelve nada; ausente, no acota.
 * Solo lectura: ninguna consulta de este adaptador escribe.
 */
const DONDE = `
  ($1::text[] IS NULL OR p.periodo_academico = ANY($1::text[]))
  AND ($2::text[] IS NULL OR p.escuela_id = ANY($2::text[]))
  AND ($3::text IS NULL OR p.programa_id = $3)
  AND ($4::text IS NULL OR p.modalidad = $4)
  AND ($5::text IS NULL OR p.estado = $5)
  AND ($6::text IS NULL OR p.ciclo = $6)
  AND ($7::text IS NULL
    OR ($7 = '__sin_empresa__' AND p.empresa_id IS NULL AND p.empresa_razon_social IS NULL)
    OR COALESCE((SELECT e.razon_social FROM empresas e WHERE e.id = p.empresa_id), p.empresa_razon_social) = $7)
  AND ($8::text[] IS NULL OR p.modalidad = ANY($8::text[]))
  AND ($9::text IS NULL
    OR ($9 = '__sin_dato__' AND (SELECT cc.seccion FROM empresas e9 JOIN cat_ciiu cc ON cc.codigo = e9.ciiu WHERE e9.id = p.empresa_id) IS NULL)
    OR (SELECT cc.seccion FROM empresas e9 JOIN cat_ciiu cc ON cc.codigo = e9.ciiu WHERE e9.id = p.empresa_id) = $9)
  AND /*CIUDAD*/`;

/** Ciudad: municipio DIVIPOLA; «sin dato» = NULL. Es la regla de producción. */
const CIUDAD_REAL = `($10::text IS NULL
    OR ($10 = '__sin_dato__' AND (SELECT e10.divipola_municipio FROM empresas e10 WHERE e10.id = p.empresa_id) IS NULL)
    OR (SELECT e10.divipola_municipio FROM empresas e10 WHERE e10.id = p.empresa_id) = $10)`;
/** Solo con ubicación sintética: «internacional» sale de la tabla auxiliar y deja de contarse como «sin dato». */
const CIUDAD_SINTETICA = `($10::text IS NULL
    OR ($10 = '__internacional__' AND EXISTS (SELECT 1 FROM sintetico_empresa_ubicacion u10 WHERE u10.empresa_id = p.empresa_id AND u10.ambito = 'internacional'))
    OR ($10 = '__sin_dato__' AND (SELECT e10.divipola_municipio FROM empresas e10 WHERE e10.id = p.empresa_id) IS NULL
        AND NOT EXISTS (SELECT 1 FROM sintetico_empresa_ubicacion u10 WHERE u10.empresa_id = p.empresa_id))
    OR (SELECT e10.divipola_municipio FROM empresas e10 WHERE e10.id = p.empresa_id) = $10)`;

/**
 * Tabla auxiliar EXCLUSIVA de bases sintéticas (la crea `herramientas/seed-reportes-1000.ts`, no una migración). Solo se
 * nombra en SQL cuando `REPORTES_SEMESTRE_SINTETICO=true`, que la configuración rechaza fuera de `dev`: en qa, pre y prod
 * las consultas no la mencionan y el semestre es siempre NULL.
 */
const TABLA_SEMESTRE_SINTETICO = 'sintetico_semestre_practica';
/** Mismo aislamiento: mapping código → nombre de programa, solo en bases sintéticas con `REPORTES_PROGRAMAS_SINTETICOS=true`. */
const TABLA_PROGRAMA_SINTETICO = 'sintetico_programa';

@Injectable()
export class ReportesAnaliticaAdapter implements ReportesAnaliticaPort {
  private readonly conSemestre: boolean;
  private readonly conProgramas: boolean;
  private readonly conUbicacion: boolean;

  constructor(@InjectDataSource() private readonly datos: DataSource, config: ConfigService) {
    this.conSemestre = config.get<boolean>('REPORTES_SEMESTRE_SINTETICO') === true;
    this.conProgramas = config.get<boolean>('REPORTES_PROGRAMAS_SINTETICOS') === true;
    this.conUbicacion = config.get<boolean>('REPORTES_UBICACION_SINTETICA') === true;
  }

  semestreSintetico(): boolean {
    return this.conSemestre;
  }

  ubicacionSintetica(): boolean {
    return this.conUbicacion;
  }

  programasSinteticos(): boolean {
    return this.conProgramas;
  }

  /** Periodos con prácticas en el alcance y su fecha de inicio en `periodos_academicos` (null si el código no está). */
  async periodos(escuelaIds?: readonly string[]): Promise<PeriodoAnalitica[]> {
    const filas: { periodo: string; inicio: string | null }[] = await this.datos.query(
      `SELECT x.periodo, to_char(pa.fecha_inicio, 'YYYY-MM-DD') AS inicio
       FROM (SELECT DISTINCT p.periodo_academico AS periodo FROM practicas p
             WHERE ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))) x
       LEFT JOIN periodos_academicos pa ON pa.codigo = x.periodo`,
      [escuelaIds ? [...escuelaIds] : null],
    );
    return filas.map((f) => ({ codigo: f.periodo, inicio: f.inicio }));
  }

  async periodosSinteticos(escuelaIds?: readonly string[]): Promise<string[]> {
    if (!this.conSemestre) return [];
    const filas: { periodo: string }[] = await this.datos.query(
      `SELECT DISTINCT p.periodo_academico AS periodo FROM practicas p
       JOIN ${TABLA_SEMESTRE_SINTETICO} ss ON ss.practica_id = p.id
       WHERE ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))`,
      [escuelaIds ? [...escuelaIds] : null],
    );
    return filas.map((f) => f.periodo);
  }

  async universo(escuelaIds?: readonly string[]): Promise<{ estudiantes: number; practicas: number }> {
    const [fila]: { estudiantes: string; practicas: string }[] = await this.datos.query(
      `SELECT COUNT(DISTINCT p.estudiante_id) AS estudiantes, COUNT(*) AS practicas FROM practicas p
       WHERE ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))`,
      [escuelaIds ? [...escuelaIds] : null],
    );
    return { estudiantes: Number(fila?.estudiantes ?? 0), practicas: Number(fila?.practicas ?? 0) };
  }

  async practicas(filtro: FiltroAnalitica): Promise<PracticaAnalitica[]> {
    interface Fila {
      id: string; estudiante_id: string; estudiante: string; programa_id: string; escuela_id: string; escuela: string;
      periodo_academico: string; ciclo: string; modalidad: string; estado: string; empresa: string | null; semestre: number | null;
      programa_nombre: string | null; sector: string | null; sector_nombre: string | null; ciudad: string | null; ciudad_nombre: string | null;
      internacional: boolean;
    }
    const filas: Fila[] = await this.datos.query(
      `SELECT p.id, p.estudiante_id, u.nombre AS estudiante, p.programa_id, p.escuela_id,
              COALESCE(ce.nombre, p.escuela_id) AS escuela, p.periodo_academico, p.ciclo, p.modalidad, p.estado,
              COALESCE(e.razon_social, p.empresa_razon_social) AS empresa,
              NULLIF(cc.seccion, '') AS sector, cs.descripcion AS sector_nombre, e.divipola_municipio AS ciudad, dv.municipio AS ciudad_nombre,
              ${this.conSemestre ? 'ss.semestre' : 'NULL::smallint'} AS semestre,
              ${this.conProgramas ? 'sp.nombre' : 'NULL::text'} AS programa_nombre,
              ${this.conUbicacion ? 'su.empresa_id IS NOT NULL' : 'false'} AS internacional
       FROM practicas p
       JOIN usuarios u ON u.id = p.estudiante_id
       LEFT JOIN cat_escuela ce ON ce.codigo = p.escuela_id
       LEFT JOIN empresas e ON e.id = p.empresa_id
       LEFT JOIN cat_ciiu cc ON cc.codigo = e.ciiu
       LEFT JOIN cat_ciiu cs ON cs.codigo = cc.seccion
       LEFT JOIN cat_divipola dv ON dv.codigo = e.divipola_municipio
       ${this.conUbicacion ? "LEFT JOIN sintetico_empresa_ubicacion su ON su.empresa_id = e.id AND su.ambito = 'internacional'" : ''}
       ${this.conSemestre ? `LEFT JOIN ${TABLA_SEMESTRE_SINTETICO} ss ON ss.practica_id = p.id` : ''}
       ${this.conProgramas ? `LEFT JOIN ${TABLA_PROGRAMA_SINTETICO} sp ON sp.codigo = p.programa_id` : ''}
       WHERE ${this.donde()}`,
      this.parametros(filtro),
    );
    return filas.map((f) => ({
      id: f.id, estudianteId: f.estudiante_id, estudiante: f.estudiante, programaId: f.programa_id, escuelaId: f.escuela_id,
      escuela: f.escuela, periodoAcademico: f.periodo_academico, ciclo: f.ciclo, modalidad: f.modalidad, estado: f.estado, empresa: f.empresa,
      semestre: f.semestre === null ? null : Number(f.semestre), programaNombre: f.programa_nombre,
      sector: f.sector, sectorNombre: f.sector_nombre, ciudad: f.ciudad, ciudadNombre: f.ciudad_nombre, internacional: f.internacional === true,
    }));
  }

  /** Una sola consulta: versiones de las prácticas filtradas con la última decisión humana auditada de cada una. */
  async versiones(filtro: FiltroAnalitica): Promise<VersionAnalitica[]> {
    interface Fila {
      id: string; practica_id: string; tipo: string; version: number; estado: string; cargado_en: Date;
      decidido_en: Date | null; decision: string | null;
    }
    const filas: Fila[] = await this.datos.query(
      `WITH docs AS (
         SELECT d.id, d.practica_id, d.tipo, d.version, d.estado, d.cargado_en
         FROM documentos d JOIN practicas p ON p.id = d.practica_id
         WHERE ${this.donde()}
       ), decisiones AS (
         SELECT DISTINCT ON (a.entidad_id) a.entidad_id, a.ocurrido_en, a.metadatos->>'decision' AS decision
         FROM auditoria a JOIN docs ON docs.id = a.entidad_id
         WHERE a.accion = 'decision_documento'
         ORDER BY a.entidad_id, a.ocurrido_en DESC
       )
       SELECT docs.*, de.ocurrido_en AS decidido_en, de.decision
       FROM docs LEFT JOIN decisiones de ON de.entidad_id = docs.id`,
      this.parametros(filtro),
    );
    return filas.map((f) => ({
      id: f.id, practicaId: f.practica_id, tipo: f.tipo, version: Number(f.version), estado: f.estado,
      cargadoEn: new Date(f.cargado_en), decididoEn: f.decidido_en ? new Date(f.decidido_en) : null,
      decision: f.decision === 'aprobar' || f.decision === 'devolver' || f.decision === 'rechazar' ? f.decision : null,
    }));
  }

  /** Con semestre sintético, el filtro de semestre se suma como `$11`; sin él, la tabla auxiliar no se nombra. */
  private donde(): string {
    const base = DONDE.replace('/*CIUDAD*/', this.conUbicacion ? CIUDAD_SINTETICA : CIUDAD_REAL);
    return this.conSemestre
      ? `${base}
  AND ($11::int IS NULL OR EXISTS (SELECT 1 FROM ${TABLA_SEMESTRE_SINTETICO} s11 WHERE s11.practica_id = p.id AND s11.semestre = $11))`
      : base;
  }


  private parametros(f: FiltroAnalitica): unknown[] {
    const base = [f.periodos ? [...f.periodos] : null, f.escuelaIds ? [...f.escuelaIds] : null, f.programaId ?? null, f.modalidad ?? null,
      f.estado ?? null, f.ciclo ?? null, f.empresa ?? null, f.modalidades ? [...f.modalidades] : null, f.sector ?? null, f.ciudad ?? null];
    return this.conSemestre ? [...base, f.semestre ?? null] : base;
  }
}
