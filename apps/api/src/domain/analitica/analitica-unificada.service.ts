import { EstadoOperativo } from '../entities/practica.entity';
import { MetricaHistorica, POLITICA_CALIDAD } from '../historico/politica-calidad-historico';
import { PracticaComparable, matrizSolapamiento } from '../historico/solapamiento-historico';
import {
  CategoriaUnion, ConteoDimension, FilaAnalitica, FiltroAnaliticoUnificado, FuenteAnalitica, OrigenFila, ResultadoAnaliticoUnificado, Tasa,
  ValorDimension,
} from './modelo-analitico';

/**
 * Reglas de la capa analítica unificada (H4). Todo puro y determinístico.
 *
 *  - CURRENT = solo SIPRA; HISTORICAL = solo SGP (vigente, `completed`); ALL = unión deduplicada.
 *  - En ALL solo se deduplica lo CONFIRMADO (correspondencia humana o por `#` del SGP): la fila de SIPRA gana y la
 *    histórica sale de ALL con motivo, aunque sigue disponible en HISTORICAL. Un candidato o un ambiguo NO es un
 *    duplicado confirmado: se cuenta en ambos lados y se informa.
 *  - Si hay frontera institucional configurada, el histórico desde la frontera sale de ALL (con motivo).
 *  - La calidad: las exclusiones de cada métrica salen de `POLITICA_CALIDAD` (H3), la única definición.
 */

// ── Elegibilidad por métrica sobre la fila analítica ────────────────────────

const ESTADOS_FINALES: readonly EstadoOperativo[] = ['cerrado', 'reprobado', 'anulado'];

/** Dato que cada métrica necesita en la FILA ANALÍTICA (la política H3 aporta las exclusiones por marca). */
const REQUISITO: Readonly<Record<MetricaHistorica, (f: FilaAnalitica) => boolean>> = {
  practicas_por_periodo: (f) => f.periodo !== null,
  practicas: () => true,
  estudiantes_unicos: (f) => f.identidadEstudiante !== null,
  programa: (f) => f.programa !== null,
  nivel: (f) => f.nivel !== null,
  regional: (f) => f.regional !== null,
  modalidad_estudio: (f) => f.modalidadEstudio !== null,
  modalidad_practica: (f) => f.modalidadPractica !== null,
  estado: (f) => f.estado !== null,
  // Tasas de resultado: SOLO estados finales (en SIPRA y en el SGP): `inscrito`/`en_practica` no son un resultado.
  tasa_cierre: (f) => f.estado !== null && ESTADOS_FINALES.includes(f.estado),
  tasa_reprobacion: (f) => f.estado !== null && ESTADOS_FINALES.includes(f.estado),
  tasa_anulacion: (f) => f.estado !== null && ESTADOS_FINALES.includes(f.estado),
  organizacion: (f) => f.organizacion !== null,
  ciudad: (f) => f.ciudad !== null,
  duracion: (f) => f.duracionDias !== null,
  salario: () => false, // fuera del contrato de H4
  indicador_documental_sgp: (f) => f.origen === 'historical' && f.documentosSubidosRatio !== null && f.documentosAprobadosRatio !== null,
  actividad: () => false, // fuera del contrato de H4
};

export function elegibleAnalitica(f: FilaAnalitica, metrica: MetricaHistorica): boolean {
  const regla = POLITICA_CALIDAD[metrica];
  if (f.origen === 'historical') {
    for (const m of regla.excluyePractica) {
      if (m === 'IDENTICAL_CONTENT') { if (f.duplicadoDe) return false; continue; }
      if (f.qualityFlags.includes(m)) return false;
    }
    for (const m of regla.excluyeOrganizacion) if (f.organizationFlags.includes(m)) return false;
    if (regla.excluyeEstadoDeCorte && f.esEstadoDeCorte) return false;
  }
  return REQUISITO[metrica](f);
}

// ── Filtros ─────────────────────────────────────────────────────────────────

export function cumpleFiltro(f: FilaAnalitica, filtro: FiltroAnaliticoUnificado): boolean {
  const igual = (v: { clave: string } | null, esperado?: string): boolean => esperado === undefined || v?.clave === esperado;
  if (filtro.periodos && !(f.periodo && (filtro.periodos.includes(f.periodo.clave) || (f.periodoCodigo !== null && filtro.periodos.includes(f.periodoCodigo))))) return false;
  return igual(f.programa, filtro.programa) && igual(f.nivel, filtro.nivel) && igual(f.regional, filtro.regional)
    && igual(f.modalidadEstudio, filtro.modalidadEstudio) && igual(f.modalidadPractica, filtro.modalidadPractica)
    && (filtro.estado === undefined || f.estado === filtro.estado)
    && igual(f.organizacion, filtro.organizacion) && igual(f.ciudad, filtro.ciudad);
}

// ── Unión de fuentes ────────────────────────────────────────────────────────

export interface CorrespondenciaConfirmada { historicoAnalyticsId: string; actualAnalyticsId: string }

export interface UnionAnalitica {
  filas: FilaAnalitica[];
  categorias: Record<CategoriaUnion, number>;
  excluidosDeAll: Record<string, number>;
}

/**
 * Une CURRENT e HISTORICAL para ALL. Excluye de ALL únicamente: (1) históricos con correspondencia CONFIRMADA hacia una
 * práctica actual presente (SIPRA gana) y (2) históricos desde la frontera institucional, si existe. Candidatos y
 * ambiguos se diagnostican con la matriz H3, sin excluirse.
 */
export function unirFuentes(
  actuales: readonly FilaAnalitica[], historicas: readonly FilaAnalitica[], confirmadas: readonly CorrespondenciaConfirmada[],
  opciones: { despuesDeFrontera?: (f: FilaAnalitica) => boolean } = {},
): UnionAnalitica {
  const idsActuales = new Set(actuales.map((a) => a.analyticsId));
  const confirmadoPara = new Map<string, string>();
  for (const c of confirmadas) if (idsActuales.has(c.actualAnalyticsId)) confirmadoPara.set(c.historicoAnalyticsId, c.actualAnalyticsId);
  const comparable = (f: FilaAnalitica, sgpId: string | null): PracticaComparable => ({
    id: f.analyticsId, studentKey: f.identidadEstudiante, periodo: f.periodoCodigo, ciclo: f.ciclo, modalidad: f.modalidadCodigo,
    fechaInicio: f.fechaInicio, fechaFin: f.fechaFin, estado: f.estado, creadaEn: f.creadaEn, sgpId,
  });
  // Para la matriz: la confirmada se expresa como «sgpId» compartido entre los dos lados.
  const sgpDeActual = new Map<string, string>();
  for (const [h, a] of confirmadoPara) sgpDeActual.set(a, h);
  const matriz = matrizSolapamiento(
    historicas.map((h) => comparable(h, h.analyticsId)),
    actuales.map((a) => comparable(a, sgpDeActual.get(a.analyticsId) ?? null)),
  );
  const categorias: Record<CategoriaUnion, number> = { historical_only: 0, current_only: 0, matched: 0, candidate_overlap: 0, ambiguous_overlap: 0 };
  categorias.historical_only = matriz.conteos.historical_only;
  categorias.current_only = matriz.conteos.current_only;
  categorias.matched = matriz.conteos.confirmed_overlap;
  categorias.candidate_overlap = matriz.conteos.candidate_overlap;
  categorias.ambiguous_overlap = matriz.conteos.ambiguous_overlap;

  const excluidosDeAll: Record<string, number> = {};
  const filas: FilaAnalitica[] = [...actuales];
  for (const h of historicas) {
    let motivo: string | null = null;
    if (confirmadoPara.has(h.analyticsId)) motivo = 'CORRESPONDENCIA_CONFIRMADA_CON_SIPRA';
    else if (opciones.despuesDeFrontera?.(h)) motivo = 'DESPUES_DE_LA_FRONTERA';
    if (motivo) excluidosDeAll[motivo] = (excluidosDeAll[motivo] ?? 0) + 1;
    else filas.push(h);
  }
  return { filas, categorias, excluidosDeAll };
}

// ── Métricas ────────────────────────────────────────────────────────────────

function percentil(ordenados: readonly number[], p: number): number | null {
  if (!ordenados.length) return null;
  const i = (ordenados.length - 1) * p;
  const a = Math.floor(i);
  const b = Math.ceil(i);
  return Math.round((ordenados[a] + (ordenados[b] - ordenados[a]) * (i - a)) * 10) / 10;
}

function contarDimension(filas: readonly FilaAnalitica[], extraer: (f: FilaAnalitica) => ValorDimension | null, metrica: MetricaHistorica): ConteoDimension[] {
  const m = new Map<string, { etiqueta: string; origenes: Set<OrigenFila>; valor: number }>();
  for (const f of filas) {
    if (!elegibleAnalitica(f, metrica)) continue;
    const v = extraer(f);
    if (!v) continue;
    const e = m.get(v.clave) ?? { etiqueta: v.etiqueta, origenes: new Set<OrigenFila>(), valor: 0 };
    e.origenes.add(f.origen);
    e.valor += 1;
    m.set(v.clave, e);
  }
  return [...m.entries()]
    .map(([clave, e]) => ({ clave, etiqueta: e.etiqueta, origen: e.origenes.size > 1 ? 'comun' as const : [...e.origenes][0], valor: e.valor }))
    .sort((a, b) => b.valor - a.valor || a.clave.localeCompare(b.clave));
}

function tasa(filas: readonly FilaAnalitica[], metrica: MetricaHistorica, estado: EstadoOperativo): Tasa {
  let den = 0;
  let num = 0;
  for (const f of filas) {
    if (!elegibleAnalitica(f, metrica)) continue;
    den += 1;
    if (f.estado === estado) num += 1;
  }
  return { numerador: num, denominador: den, valor: den ? Math.round((num / den) * 10_000) / 10_000 : null };
}

const ESTADO_DIM = (f: FilaAnalitica): ValorDimension | null => (f.estado ? { clave: f.estado, etiqueta: f.estado } : null);

export function calcularMetricas(
  filas: readonly FilaAnalitica[], fuente: FuenteAnalitica,
  contexto: { identidadComparable: boolean; estadoAlActual: string | null; corteHistorico: string | null; union?: UnionAnalitica; advertencias?: string[] },
): ResultadoAnaliticoUnificado {
  const practicas = filas.filter((f) => elegibleAnalitica(f, 'practicas'));
  const identidades = new Set<string>();
  for (const f of filas) if (elegibleAnalitica(f, 'estudiantes_unicos')) identidades.add(f.identidadEstudiante!);
  const duraciones = filas.filter((f) => elegibleAnalitica(f, 'duracion')).map((f) => f.duracionDias!).sort((a, b) => a - b);
  const docs = filas.filter((f) => elegibleAnalitica(f, 'indicador_documental_sgp'));
  const promedio = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);
  const elegibilidad: ResultadoAnaliticoUnificado['elegibilidad'] = {};
  for (const m of ['practicas', 'estudiantes_unicos', 'practicas_por_periodo', 'programa', 'nivel', 'regional', 'modalidad_estudio', 'modalidad_practica', 'estado',
    'tasa_cierre', 'tasa_reprobacion', 'tasa_anulacion', 'organizacion', 'ciudad', 'duracion', 'indicador_documental_sgp'] as MetricaHistorica[]) {
    const si = filas.filter((f) => elegibleAnalitica(f, m)).length;
    elegibilidad[m] = { elegibles: si, excluidos: filas.length - si };
  }
  const hayHistorico = filas.some((f) => f.origen === 'historical');
  return {
    fuente,
    estadoAl: { current: fuente === 'historical' ? null : contexto.estadoAlActual, historical: fuente === 'current' ? null : contexto.corteHistorico },
    totales: {
      practicas: practicas.length,
      estudiantesUnicos: identidades.size,
      precisionEstudiantes: fuente === 'all' && !contexto.identidadComparable ? 'cota_superior' : 'exacta',
    },
    dimensiones: {
      periodo: contarDimension(filas, (f) => f.periodo, 'practicas_por_periodo'),
      programa: contarDimension(filas, (f) => f.programa, 'programa'),
      nivel: contarDimension(filas, (f) => f.nivel, 'nivel'),
      regional: contarDimension(filas, (f) => f.regional, 'regional'),
      modalidadEstudio: contarDimension(filas, (f) => f.modalidadEstudio, 'modalidad_estudio'),
      modalidadPractica: contarDimension(filas, (f) => f.modalidadPractica, 'modalidad_practica'),
      estado: contarDimension(filas, ESTADO_DIM, 'estado'),
      organizacion: contarDimension(filas, (f) => f.organizacion, 'organizacion'),
      ciudad: contarDimension(filas, (f) => f.ciudad, 'ciudad'),
    },
    tasas: {
      cierre: tasa(filas, 'tasa_cierre', 'cerrado'),
      reprobacion: tasa(filas, 'tasa_reprobacion', 'reprobado'),
      anulacion: tasa(filas, 'tasa_anulacion', 'anulado'),
    },
    duracion: { casos: duraciones.length, p25: percentil(duraciones, 0.25), mediana: percentil(duraciones, 0.5), p75: percentil(duraciones, 0.75) },
    indicadorDocumentalSgp: hayHistorico ? {
      casos: docs.length,
      subidoPromedio: promedio(docs.map((f) => f.documentosSubidosRatio!)),
      aprobadoPromedio: promedio(docs.map((f) => f.documentosAprobadosRatio!)),
    } : null,
    solapamiento: contexto.union ? { categorias: contexto.union.categorias, excluidosDeAll: contexto.union.excluidosDeAll } : null,
    elegibilidad,
    advertencias: contexto.advertencias ?? [],
  };
}

// ── Identidad analítica de estudiantes ──────────────────────────────────────

/**
 * Resuelve la identidad del estudiante entre fuentes SIN exponer claves: cada estudiante actual tiene su identidad
 * `current:<usuario>`; si para la versión de clave de un histórico existe la clave calculada del documento actual,
 * el histórico adopta la identidad del actual (misma persona). Si no, conserva una identidad histórica propia.
 * Diseñado para varias versiones de clave (v1, v2…): el mapa se indexa por `versión:clave`.
 */
export function resolverIdentidades(
  actuales: { usuarioId: string; clavesPorVersion: ReadonlyMap<string, string> }[],
): (version: string, studentKey: string | null) => string | null {
  const porClave = new Map<string, string>();
  for (const a of actuales) for (const [v, k] of a.clavesPorVersion) porClave.set(`${v}:${k}`, `current:${a.usuarioId}`);
  return (version, studentKey) => (studentKey ? (porClave.get(`${version}:${studentKey}`) ?? `historical:${version}:${studentKey}`) : null);
}
