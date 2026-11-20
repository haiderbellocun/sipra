/**
 * Fechas del SGP (§25.11). Siempre se conserva el texto original no sensible; la fecha normalizada es `null` cuando
 * el valor no es una fecha real. Ninguna fecha imposible se convierte en una fecha falsa, y nada lanza.
 *
 *  - `0000-00-00` (fecha cero de MySQL), `0001-01-01`, años como `0020`, `0202` o `2223` → `invalida`, fecha `null`.
 *  - Años fuera de [1900, 2100] → `invalida`.
 *  - Fecha real pero fuera de la ventana razonable del proceso [2000, 2030] → se conserva y se informa
 *    `fuera_de_rango` (la experiencia validada puede ser antigua; no se borra).
 *
 * Las celdas de fecha que entrega Excel son «hora de pared» sin zona; el lector las entrega como `Date` en UTC con esa
 * hora de pared. Para las marcas de tiempo se interpreta la hora de pared de Colombia (UTC−5, sin horario de verano).
 */
export type Celda = string | number | boolean | Date | null;

export type EstadoFecha = 'valida' | 'fuera_de_rango' | 'invalida' | 'vacia';

export interface FechaSgp {
  /** Texto de origen: `YYYY-MM-DD` si vino como fecha de Excel, o la cadena tal cual (recortada, máx. 40). */
  original: string | null;
  /** `YYYY-MM-DD` o `null`. */
  fecha: string | null;
  estado: EstadoFecha;
}

export interface MarcaTiempoSgp {
  original: string | null;
  /** ISO 8601 en UTC o `null`. */
  instante: string | null;
  estado: EstadoFecha;
}

const ANIO_MINIMO = 1900;
const ANIO_MAXIMO = 2100;
const RANGO_DESDE = 2000;
const RANGO_HASTA = 2030;
const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;

const pad = (n: number, l = 2): string => String(n).padStart(l, '0');

function clasificarAnio(anio: number): EstadoFecha {
  if (anio < ANIO_MINIMO || anio > ANIO_MAXIMO) return 'invalida';
  if (anio < RANGO_DESDE || anio > RANGO_HASTA) return 'fuera_de_rango';
  return 'valida';
}

interface Partes { anio: number; mes: number; dia: number; hora: number; minuto: number; segundo: number }

function partesDeTexto(t: string): Partes | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (!m) return null;
  const p: Partes = {
    anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]),
    hora: Number(m[4] ?? 0), minuto: Number(m[5] ?? 0), segundo: Number(m[6] ?? 0),
  };
  // Calendario real: 2023-02-30 no existe. Date.UTC normaliza; si la vuelta no coincide, la fecha no es real.
  if (p.mes < 1 || p.mes > 12 || p.dia < 1 || p.hora > 23 || p.minuto > 59 || p.segundo > 59) return null;
  const d = new Date(Date.UTC(p.anio, p.mes - 1, p.dia));
  d.setUTCFullYear(p.anio); // años < 100 no se desplazan a 19xx
  if (d.getUTCFullYear() !== p.anio || d.getUTCMonth() !== p.mes - 1 || d.getUTCDate() !== p.dia) return null;
  return p;
}

function partesDeDate(d: Date): Partes | null {
  if (Number.isNaN(d.getTime())) return null;
  return {
    anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
    hora: d.getUTCHours(), minuto: d.getUTCMinutes(), segundo: d.getUTCSeconds(),
  };
}

const textoFecha = (p: Partes): string => `${pad(p.anio, 4)}-${pad(p.mes)}-${pad(p.dia)}`;

function leerPartes(celda: Celda): { original: string | null; partes: Partes | null } {
  if (celda === null || celda === undefined) return { original: null, partes: null };
  if (celda instanceof Date) {
    const partes = partesDeDate(celda);
    return { original: partes ? textoFecha(partes) : 'fecha-no-legible', partes };
  }
  if (typeof celda === 'string') {
    const t = celda.trim();
    if (!t) return { original: null, partes: null };
    return { original: t.slice(0, 40), partes: partesDeTexto(t) };
  }
  // Un número sin formato de fecha es ambiguo (¿serial de Excel?, ¿otra cosa?): no se inventa una fecha.
  return { original: String(celda).slice(0, 40), partes: null };
}

export function parsearFechaSgp(celda: Celda): FechaSgp {
  const { original, partes } = leerPartes(celda);
  if (original === null) return { original: null, fecha: null, estado: 'vacia' };
  if (!partes) return { original, fecha: null, estado: 'invalida' };
  const estado = clasificarAnio(partes.anio);
  return { original, fecha: estado === 'invalida' ? null : textoFecha(partes), estado };
}

export function parsearMarcaTiempoSgp(celda: Celda): MarcaTiempoSgp {
  const { original, partes: p } = leerPartes(celda);
  if (original === null) return { original: null, instante: null, estado: 'vacia' };
  if (!p) return { original, instante: null, estado: 'invalida' };
  const estado = clasificarAnio(p.anio);
  if (estado === 'invalida') return { original, instante: null, estado };
  const pared = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return { original: `${textoFecha(p)} ${pad(p.hora)}:${pad(p.minuto)}:${pad(p.segundo)}`, instante: new Date(pared + DESFASE_BOGOTA_MS).toISOString(), estado };
}

/** Días entre dos fechas `YYYY-MM-DD` (fin − inicio). */
export function diasEntre(inicio: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000);
}
