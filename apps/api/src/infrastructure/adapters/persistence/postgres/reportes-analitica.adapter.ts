import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  FiltroAnalitica, PracticaAnalitica, ReportesAnaliticaPort, VersionAnalitica,
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
  AND ($5::text IS NULL OR p.estado = $5)`;

function parametros(f: FiltroAnalitica): unknown[] {
  return [f.periodos ? [...f.periodos] : null, f.escuelaIds ? [...f.escuelaIds] : null, f.programaId ?? null, f.modalidad ?? null, f.estado ?? null];
}

@Injectable()
export class ReportesAnaliticaAdapter implements ReportesAnaliticaPort {
  constructor(@InjectDataSource() private readonly datos: DataSource) {}

  async periodos(escuelaIds?: readonly string[]): Promise<string[]> {
    const filas: { periodo: string }[] = await this.datos.query(
      `SELECT DISTINCT p.periodo_academico AS periodo FROM practicas p
       WHERE ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))`,
      [escuelaIds ? [...escuelaIds] : null],
    );
    return filas.map((f) => f.periodo);
  }

  async practicas(filtro: FiltroAnalitica): Promise<PracticaAnalitica[]> {
    interface Fila {
      id: string; estudiante_id: string; estudiante: string; programa_id: string; escuela_id: string; escuela: string;
      periodo_academico: string; modalidad: string; estado: string; empresa: string | null;
    }
    const filas: Fila[] = await this.datos.query(
      `SELECT p.id, p.estudiante_id, u.nombre AS estudiante, p.programa_id, p.escuela_id,
              COALESCE(ce.nombre, p.escuela_id) AS escuela, p.periodo_academico, p.modalidad, p.estado,
              COALESCE(e.razon_social, p.empresa_razon_social) AS empresa
       FROM practicas p
       JOIN usuarios u ON u.id = p.estudiante_id
       LEFT JOIN cat_escuela ce ON ce.codigo = p.escuela_id
       LEFT JOIN empresas e ON e.id = p.empresa_id
       WHERE ${DONDE}`,
      parametros(filtro),
    );
    return filas.map((f) => ({
      id: f.id, estudianteId: f.estudiante_id, estudiante: f.estudiante, programaId: f.programa_id, escuelaId: f.escuela_id,
      escuela: f.escuela, periodoAcademico: f.periodo_academico, modalidad: f.modalidad, estado: f.estado, empresa: f.empresa,
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
         WHERE ${DONDE}
       ), decisiones AS (
         SELECT DISTINCT ON (a.entidad_id) a.entidad_id, a.ocurrido_en, a.metadatos->>'decision' AS decision
         FROM auditoria a JOIN docs ON docs.id = a.entidad_id
         WHERE a.accion = 'decision_documento'
         ORDER BY a.entidad_id, a.ocurrido_en DESC
       )
       SELECT docs.*, de.ocurrido_en AS decidido_en, de.decision
       FROM docs LEFT JOIN decisiones de ON de.entidad_id = docs.id`,
      parametros(filtro),
    );
    return filas.map((f) => ({
      id: f.id, practicaId: f.practica_id, tipo: f.tipo, version: Number(f.version), estado: f.estado,
      cargadoEn: new Date(f.cargado_en), decididoEn: f.decidido_en ? new Date(f.decidido_en) : null,
      decision: f.decision === 'aprobar' || f.decision === 'devolver' || f.decision === 'rechazar' ? f.decision : null,
    }));
  }
}
