import { DataSource } from 'typeorm';
import { SistemaOrigen } from '../../../../domain/historico/registro-historico';
import {
  CorrespondenciaPracticaConfirmada, FilaActualCruda, FilaHistoricaCruda, LecturaAnaliticaUnificadaPort,
} from '../../../../domain/ports/out/analitica-unificada.port';

interface FilaActualSql {
  id: string; estudiante_id: string; documento: string | null; periodo_academico: string; programa_id: string; ciclo: string;
  regional: string | null; modalidad: string; estado: string; empresa_id: string | null; empresa: string | null;
  ciudad_codigo: string | null; ciudad_nombre: string | null; fecha_inicio: string | null; fecha_fin: string | null; creada_en: string;
}

interface FilaHistoricaSql {
  source_record_id: string; version: number; hmac_key_version: string; student_key: string | null; periodo_original: string | null;
  periodo_normalizado: string | null; programa_normalizado: string | null; codigo_sinu: string | null; nivel_inferido: string | null;
  regional: string | null; modalidad_estudio_normalizada: string | null; modalidad_practica_normalizada: string | null;
  modalidad_practica_original: string | null; estado_analitico: string | null; es_estado_de_corte: boolean; estado_fecha_corte: string | null;
  organization_key: string | null; ciudad_normalizada: string | null;
  fecha_inicio: string | null; fecha_fin: string | null; duracion_dias: number | null; documentos_subidos_ratio: number | null;
  documentos_aprobados_ratio: number | null; bitacora_count: number | null; quality_flags: string[]; organization_flags: string[];
  duplicado_de: string | null; fecha_creacion: string | null;
}

/**
 * Lectura de la capa analítica unificada (H4). SOLO LECTURA, consultas planas (sin N+1, sin subconsultas por fila):
 * SIPRA, versiones del SGP, catálogo de organizaciones del SGP y correspondencias confirmadas. El periodo y el alcance viajan a
 * la base; el resto de filtros se aplica sobre el modelo común (misma semántica para las dos fuentes).
 *
 * El histórico se lee solo desde versiones VIGENTES de importaciones `completed`: una importación `processing`,
 * `failed` o `reverted` nunca aporta filas.
 */
export class AnaliticaUnificadaPostgresAdapter implements LecturaAnaliticaUnificadaPort {
  constructor(private readonly ds: DataSource) {}

  async practicasActuales(f: { periodos?: readonly string[]; escuelaIds?: readonly string[]; conDocumento: boolean }): Promise<FilaActualCruda[]> {
    const filas = await this.ds.query<FilaActualSql[]>(
      `SELECT p.id, p.estudiante_id, ${f.conDocumento ? 'u.documento' : 'NULL::text AS documento'}, p.periodo_academico, p.programa_id, p.ciclo, p.regional,
              p.modalidad, p.estado, p.empresa_id, COALESCE(e.razon_social, p.empresa_razon_social) AS empresa,
              e.divipola_municipio AS ciudad_codigo, dv.municipio AS ciudad_nombre,
              to_char(p.fecha_inicio AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha_inicio,
              to_char(p.fecha_fin AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha_fin,
              to_char(p.creada_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS creada_en
         FROM practicas p
         ${f.conDocumento ? 'JOIN usuarios u ON u.id = p.estudiante_id' : ''}
         LEFT JOIN empresas e ON e.id = p.empresa_id
         LEFT JOIN cat_divipola dv ON dv.codigo = e.divipola_municipio
        WHERE ($1::text[] IS NULL OR p.periodo_academico = ANY($1::text[]))
          AND ($2::text[] IS NULL OR p.escuela_id = ANY($2::text[]))`,
      [f.periodos ? [...f.periodos] : null, f.escuelaIds ? [...f.escuelaIds] : null]);
    return filas.map((r) => ({
      id: r.id, estudianteId: r.estudiante_id, documento: r.documento, periodo: r.periodo_academico, programaId: r.programa_id,
      ciclo: r.ciclo, regional: r.regional, modalidad: r.modalidad, estado: r.estado, empresaId: r.empresa_id, empresa: r.empresa,
      ciudadCodigo: r.ciudad_codigo, ciudadNombre: r.ciudad_nombre, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin, creadaEn: r.creada_en,
    }));
  }

  async practicasHistoricas(f: { sistema: SistemaOrigen; periodos?: readonly string[] }): Promise<FilaHistoricaCruda[]> {
    const filas = await this.ds.query<FilaHistoricaSql[]>(
      `SELECT p.source_record_id, p.version, p.hmac_key_version, p.student_key, p.periodo_original, p.periodo_normalizado,
              p.programa_normalizado, p.codigo_sinu, p.nivel_inferido, p.regional, p.modalidad_estudio_normalizada,
              p.modalidad_practica_normalizada, p.modalidad_practica_original, p.estado_analitico, p.es_estado_de_corte,
              to_char(p.estado_fecha_corte AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS estado_fecha_corte,
              p.organization_key, p.ciudad_normalizada, to_char(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(p.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
              p.duracion_dias, p.documentos_subidos_ratio::float8 AS documentos_subidos_ratio,
              p.documentos_aprobados_ratio::float8 AS documentos_aprobados_ratio, p.bitacora_count,
              p.quality_flags, p.organization_flags, p.duplicado_de, to_char(p.fecha_creacion, 'YYYY-MM-DD') AS fecha_creacion
         FROM historico.practicas p
         JOIN historico.importaciones i ON i.id = p.importacion_id AND i.status = 'completed'
        WHERE p.is_current AND p.source_system = $1
          AND ($2::text[] IS NULL OR coalesce(p.periodo_normalizado, p.periodo_original) = ANY($2::text[]))`,
      [f.sistema, f.periodos ? [...f.periodos] : null]);
    // Catálogo de organizaciones (con su correspondencia CONFIRMADA) en una segunda consulta plana y unión en memoria:
    // O(n + m) siempre, sin depender de las estadísticas del planificador (una tabla recién cargada sin ANALYZE llevó
    // a un nested loop de 10.000 × 500 en la verificación PG).
    const orgs = await this.ds.query<{ organization_key: string; hmac_key_version: string; id: string; empresa_id: string | null; razon_social: string | null }[]>(
      `SELECT o.organization_key, o.hmac_key_version, o.id, m.empresa_id, e.razon_social
         FROM historico.organizaciones o
         LEFT JOIN historico.organizacion_mapping m ON m.organizacion_id = o.id AND m.status = 'confirmada'
         LEFT JOIN empresas e ON e.id = m.empresa_id
        WHERE o.source_system = $1`, [f.sistema]);
    const porClave = new Map(orgs.map((o) => [`${o.hmac_key_version}:${o.organization_key.trim()}`, o]));
    return filas.map((r) => {
      const o = r.organization_key ? porClave.get(`${r.hmac_key_version}:${r.organization_key.trim()}`) : undefined;
      return {
      sourceSystem: f.sistema, sourceRecordId: r.source_record_id, version: Number(r.version), hmacKeyVersion: r.hmac_key_version,
      studentKey: r.student_key ? r.student_key.trim() : null, periodoOriginal: r.periodo_original, periodoNormalizado: r.periodo_normalizado,
      programaNormalizado: r.programa_normalizado, codigoSinu: r.codigo_sinu, nivelInferido: r.nivel_inferido, regional: r.regional,
      modalidadEstudio: r.modalidad_estudio_normalizada, modalidadPracticaNormalizada: r.modalidad_practica_normalizada,
      modalidadPracticaOriginal: r.modalidad_practica_original, estadoAnalitico: r.estado_analitico, esEstadoDeCorte: r.es_estado_de_corte,
      estadoFechaCorte: r.estado_fecha_corte, organizacionId: o?.id ?? null, empresaConfirmadaId: o?.empresa_id ?? null,
      empresaConfirmadaNombre: o?.razon_social ?? null, ciudadNormalizada: r.ciudad_normalizada, fechaInicio: r.fecha_inicio,
      fechaFin: r.fecha_fin, duracionDias: r.duracion_dias === null ? null : Number(r.duracion_dias),
      documentosSubidosRatio: r.documentos_subidos_ratio, documentosAprobadosRatio: r.documentos_aprobados_ratio,
      bitacoraCount: r.bitacora_count === null ? null : Number(r.bitacora_count), qualityFlags: r.quality_flags ?? [],
      organizationFlags: r.organization_flags ?? [], duplicadoDe: r.duplicado_de, fechaCreacion: r.fecha_creacion,
      };
    });
  }

  async correspondenciasConfirmadas(sistema: SistemaOrigen): Promise<CorrespondenciaPracticaConfirmada[]> {
    const filas = await this.ds.query<{ source_record_id: string; practica_id: string }[]>(
      `SELECT source_record_id, practica_id FROM historico.practica_correspondencia WHERE source_system = $1 AND status = 'confirmada'`,
      [sistema]);
    return filas.map((r) => ({ sourceRecordId: r.source_record_id, practicaId: r.practica_id }));
  }
}
