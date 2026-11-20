/**
 * Parser explícito del «Periodo Inscripción Asignatura» del SGP (§25.10).
 *
 * Reconoce los siete esquemas observados en el histórico. Los tres vigentes usan EXACTAMENTE el mismo código que hoy
 * guarda `periodos_academicos` (presencial `2026A…2026D`, virtual `26V01…26V06`, 335 `26P01…26P06`), así que el
 * normalizado es el mismo código en mayúsculas: no se reinterpreta ni se fusiona nada.
 *
 *  - `B` (hasta 2024) y `C` (desde 2025) se conservan tal cual: decir que son el mismo ordinal es una decisión
 *    institucional pendiente, no del parser.
 *  - `AAAAI` (intersemestral) y `AATNN` (residual) son de legado: se conservan sin normalizado.
 *  - Cualquier otra cosa se marca como no interpretable; nunca lanza.
 */
export type FormatoPeriodo = 'presencial' | 'virtual' | '335' | 'intersemestral_legacy' | 'trimestral_legacy' | 'unknown';
export type EstadoMapeoPeriodo = 'FORMAT_COMPATIBLE' | 'LEGACY' | 'UNPARSEABLE' | 'MISSING';

export interface PeriodoSgp {
  original: string | null;
  normalizado: string | null;
  formato: FormatoPeriodo;
  anio: number | null;
  /** Letra (`A`–`D`, `I`) o número de bloque (`01`–`06`) tal como viene. */
  ordinal: string | null;
  estadoMapeo: EstadoMapeoPeriodo;
}

const SIGLO = 2000;

export function parsearPeriodoSgp(valor: string | null | undefined): PeriodoSgp {
  const original = valor === null || valor === undefined ? null : String(valor).trim() || null;
  if (original === null) {
    return { original: null, normalizado: null, formato: 'unknown', anio: null, ordinal: null, estadoMapeo: 'MISSING' };
  }
  const v = original.toUpperCase().replace(/\s+/g, '');
  let m = /^(\d{4})([A-D])$/.exec(v);
  if (m) return vigente(original, v, 'presencial', Number(m[1]), m[2]);
  m = /^(\d{2})V(0[1-6])$/.exec(v);
  if (m) return vigente(original, v, 'virtual', SIGLO + Number(m[1]), m[2]);
  m = /^(\d{2})P(0[1-6])$/.exec(v);
  if (m) return vigente(original, v, '335', SIGLO + Number(m[1]), m[2]);
  m = /^(\d{4})I$/.exec(v);
  if (m) return { original, normalizado: null, formato: 'intersemestral_legacy', anio: Number(m[1]), ordinal: 'I', estadoMapeo: 'LEGACY' };
  m = /^(\d{2})T(\d{2})$/.exec(v);
  if (m) return { original, normalizado: null, formato: 'trimestral_legacy', anio: SIGLO + Number(m[1]), ordinal: m[2], estadoMapeo: 'LEGACY' };
  return { original, normalizado: null, formato: 'unknown', anio: null, ordinal: null, estadoMapeo: 'UNPARSEABLE' };
}

function vigente(original: string, codigo: string, formato: FormatoPeriodo, anio: number, ordinal: string): PeriodoSgp {
  return { original, normalizado: codigo, formato, anio, ordinal, estadoMapeo: 'FORMAT_COMPATIBLE' };
}
