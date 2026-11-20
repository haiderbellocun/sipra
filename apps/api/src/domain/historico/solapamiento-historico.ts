import { EstadoOperativo } from '../entities/practica.entity';
import { CalendarioPeriodo } from '../entities/periodo.entity';
import { parsearPeriodoSgp } from './periodo-sgp.parser';

/**
 * Solapamiento entre el histórico del SGP y la operación de SIPRA (§25.14 y §27.5). Funciones PURAS: no escriben
 * relaciones; clasifican y deciden qué se contaría, para que la futura `analytics.practicas` no cuente dos veces el
 * mismo proceso.
 *
 * Un «proceso» es (estudiante, periodo, ciclo) no anulado. Clasificación de cada registro:
 *  - `confirmed_overlap`: la práctica de SIPRA guarda el `#` del SGP (fuente fiable; hoy NO existe: P-42);
 *  - `candidate_overlap`: exactamente un registro de cada lado con la misma clave de proceso (solo candidato);
 *  - `ambiguous_overlap`: la misma clave con más de un registro en algún lado;
 *  - `historical_only` / `current_only`.
 */
export type PoliticaSolapamiento = 'CUTOFF_DATE' | 'IDENTIFIER' | 'COMBINED';
export const POLITICAS_SOLAPAMIENTO: readonly PoliticaSolapamiento[] = ['CUTOFF_DATE', 'IDENTIFIER', 'COMBINED'];
export const POLITICA_RECOMENDADA: PoliticaSolapamiento = 'COMBINED';

export type CategoriaSolapamiento = 'historical_only' | 'current_only' | 'candidate_overlap' | 'confirmed_overlap' | 'ambiguous_overlap';

export interface PracticaComparable {
  id: string;
  studentKey: string | null;
  /** Código de periodo normalizado (mismo formato en ambos sistemas) o `null`. */
  periodo: string | null;
  ciclo: string | null;
  modalidad: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  estado: EstadoOperativo | null;
  /** Instante de creación ISO (para la política por fecha de corte). */
  creadaEn: string | null;
  /** Actual: `#` del SGP si la práctica lo conserva (P-42). Histórico: su propio `source_record_id`. */
  sgpId: string | null;
}

export interface ParSolapamiento {
  historicoId: string;
  actualId: string;
  categoria: 'candidate_overlap' | 'confirmed_overlap' | 'ambiguous_overlap';
  /** Solo informativa: modalidad igual y fechas que se cruzan. Nunca convierte un candidato en confirmado. */
  fuerza: 'alta' | 'media' | null;
}

export interface MatrizSolapamiento {
  conteos: Record<CategoriaSolapamiento, number>;
  categoriaHistorico: Map<string, CategoriaSolapamiento>;
  categoriaActual: Map<string, CategoriaSolapamiento>;
  pares: ParSolapamiento[];
}

const claveProceso = (p: PracticaComparable): string | null =>
  p.studentKey && p.periodo && p.ciclo && p.estado !== 'anulado' ? `${p.studentKey}|${p.periodo}|${p.ciclo}` : null;

function fechasSeCruzan(a: PracticaComparable, b: PracticaComparable): boolean {
  if (!a.fechaInicio || !b.fechaInicio) return false;
  const finA = a.fechaFin ?? a.fechaInicio;
  const finB = b.fechaFin ?? b.fechaInicio;
  return a.fechaInicio <= finB && b.fechaInicio <= finA;
}

export function matrizSolapamiento(historicas: readonly PracticaComparable[], actuales: readonly PracticaComparable[]): MatrizSolapamiento {
  const categoriaHistorico = new Map<string, CategoriaSolapamiento>();
  const categoriaActual = new Map<string, CategoriaSolapamiento>();
  const pares: ParSolapamiento[] = [];
  // 1. Confirmados: solo por identificador del SGP conservado en SIPRA.
  const historicoPorId = new Map(historicas.map((h) => [h.sgpId ?? h.id, h]));
  for (const a of actuales) {
    const h = a.sgpId ? historicoPorId.get(a.sgpId) : undefined;
    if (h && !categoriaHistorico.has(h.id)) {
      categoriaHistorico.set(h.id, 'confirmed_overlap');
      categoriaActual.set(a.id, 'confirmed_overlap');
      pares.push({ historicoId: h.id, actualId: a.id, categoria: 'confirmed_overlap', fuerza: null });
    }
  }
  // 2. Candidatos y ambiguos por clave de proceso.
  const grupos = new Map<string, { h: PracticaComparable[]; a: PracticaComparable[] }>();
  for (const h of historicas) {
    const k = claveProceso(h);
    if (!k || categoriaHistorico.has(h.id)) continue;
    if (!grupos.has(k)) grupos.set(k, { h: [], a: [] });
    grupos.get(k)!.h.push(h);
  }
  for (const a of actuales) {
    const k = claveProceso(a);
    if (!k || categoriaActual.has(a.id) || !grupos.has(k)) continue;
    grupos.get(k)!.a.push(a);
  }
  for (const { h, a } of grupos.values()) {
    if (!a.length) continue;
    if (h.length === 1 && a.length === 1) {
      categoriaHistorico.set(h[0].id, 'candidate_overlap');
      categoriaActual.set(a[0].id, 'candidate_overlap');
      const alta = h[0].modalidad !== null && h[0].modalidad === a[0].modalidad && fechasSeCruzan(h[0], a[0]);
      pares.push({ historicoId: h[0].id, actualId: a[0].id, categoria: 'candidate_overlap', fuerza: alta ? 'alta' : 'media' });
    } else {
      for (const x of h) categoriaHistorico.set(x.id, 'ambiguous_overlap');
      for (const y of a) categoriaActual.set(y.id, 'ambiguous_overlap');
      for (const x of h) for (const y of a) pares.push({ historicoId: x.id, actualId: y.id, categoria: 'ambiguous_overlap', fuerza: null });
    }
  }
  for (const h of historicas) if (!categoriaHistorico.has(h.id)) categoriaHistorico.set(h.id, 'historical_only');
  for (const a of actuales) if (!categoriaActual.has(a.id)) categoriaActual.set(a.id, 'current_only');
  const conteos: Record<CategoriaSolapamiento, number> = { historical_only: 0, current_only: 0, candidate_overlap: 0, confirmed_overlap: 0, ambiguous_overlap: 0 };
  // Los solapes se cuentan por PROCESO (par/grupo), no por fila de cada lado.
  for (const c of categoriaHistorico.values()) if (c === 'historical_only') conteos.historical_only += 1;
  for (const c of categoriaActual.values()) if (c === 'current_only') conteos.current_only += 1;
  conteos.confirmed_overlap = pares.filter((p) => p.categoria === 'confirmed_overlap').length;
  conteos.candidate_overlap = pares.filter((p) => p.categoria === 'candidate_overlap').length;
  conteos.ambiguous_overlap = new Set(pares.filter((p) => p.categoria === 'ambiguous_overlap').map((p) => p.historicoId)).size;
  return { conteos, categoriaHistorico, categoriaActual, pares };
}

/** Frontera por calendario: el primer periodo que SIPRA «posee»; `null` = no definida (decisión institucional). */
export type FronterasPeriodo = Partial<Record<CalendarioPeriodo, string | null>>;

export interface OpcionesConteo {
  /** Fecha de corte del archivo SGP (ISO). */
  fechaCorte: string | null;
  fronteras?: FronterasPeriodo;
}

export interface SeleccionConteo {
  historicos: Set<string>;
  actuales: Set<string>;
  excluidos: { id: string; fuente: 'historical' | 'current'; motivo: string }[];
}

function despuesDeFrontera(periodo: string | null, fronteras?: FronterasPeriodo): boolean {
  if (!periodo || !fronteras) return false;
  const p = parsearPeriodoSgp(periodo);
  const cal = p.formato === 'presencial' || p.formato === 'virtual' || p.formato === '335' ? p.formato : null;
  const f = cal ? fronteras[cal] : null;
  if (!f || p.anio === null) return false;
  const fr = parsearPeriodoSgp(f);
  if (fr.anio === null) return false;
  return p.anio > fr.anio || (p.anio === fr.anio && (p.ordinal ?? '') >= (fr.ordinal ?? ''));
}

/**
 * Qué registros contaría una métrica unificada según la política:
 *  - CUTOFF_DATE: todo el histórico; de SIPRA solo lo creado después del corte. Falla si un proceso del SGP continuó
 *    en SIPRA (se cuenta dos veces) — por eso no es la recomendada.
 *  - IDENTIFIER: todo SIPRA; del histórico se excluye lo confirmado por `#` del SGP. Sin P-42 no excluye nada.
 *  - COMBINED (recomendada): SIPRA gana en confirmados, candidatos y ambiguos (el histórico de esos procesos se
 *    excluye: conservador, nunca doble conteo) y, si hay frontera, el histórico desde la frontera también se excluye.
 */
export function seleccionarParaConteo(
  historicas: readonly PracticaComparable[], actuales: readonly PracticaComparable[], politica: PoliticaSolapamiento, op: OpcionesConteo,
): SeleccionConteo {
  const sel: SeleccionConteo = { historicos: new Set(), actuales: new Set(), excluidos: [] };
  const matriz = matrizSolapamiento(historicas, actuales);
  for (const a of actuales) {
    if (politica === 'CUTOFF_DATE' && op.fechaCorte && a.creadaEn && a.creadaEn <= op.fechaCorte) {
      sel.excluidos.push({ id: a.id, fuente: 'current', motivo: 'CREADA_ANTES_DEL_CORTE' });
    } else sel.actuales.add(a.id);
  }
  // Red de seguridad de COMBINED: un proceso que ya cuenta desde SIPRA nunca vuelve a contar desde el histórico,
  // aunque la práctica de SIPRA esté confirmada contra OTRO registro del SGP.
  const procesosActuales = new Set(actuales.filter((a) => sel.actuales.has(a.id)).map(claveProceso).filter((k): k is string => k !== null));
  for (const h of historicas) {
    const cat = matriz.categoriaHistorico.get(h.id)!;
    let motivo: string | null = null;
    if (politica === 'IDENTIFIER' || politica === 'COMBINED') if (cat === 'confirmed_overlap') motivo = 'CONFIRMADO_EN_SIPRA';
    if (politica === 'COMBINED' && !motivo) {
      if (cat === 'candidate_overlap') motivo = 'CANDIDATO_EN_SIPRA';
      else if (cat === 'ambiguous_overlap') motivo = 'AMBIGUO_CON_SIPRA';
      else if (despuesDeFrontera(h.periodo, op.fronteras)) motivo = 'DESPUES_DE_LA_FRONTERA';
      else { const k = claveProceso(h); if (k && procesosActuales.has(k)) motivo = 'PROCESO_PRESENTE_EN_SIPRA'; }
    }
    if (motivo) sel.excluidos.push({ id: h.id, fuente: 'historical', motivo });
    else sel.historicos.add(h.id);
  }
  return sel;
}

/** Procesos (estudiante, periodo, ciclo, no anulado) contados desde las dos fuentes a la vez: debe ser 0. */
export function procesosContadosDosVeces(historicas: readonly PracticaComparable[], actuales: readonly PracticaComparable[], sel: SeleccionConteo): number {
  const deHistorico = new Set(historicas.filter((h) => sel.historicos.has(h.id)).map(claveProceso).filter((k): k is string => k !== null));
  const deActual = new Set(actuales.filter((a) => sel.actuales.has(a.id)).map(claveProceso).filter((k): k is string => k !== null));
  let n = 0;
  for (const k of deActual) if (deHistorico.has(k)) n += 1;
  return n;
}
