import { Periodo } from '@core/models/modelos';

/**
 * Filtro por año de la lista de periodos (solo navegación). El año sale SIEMPRE de `fechaInicio`, nunca del código
 * (hay códigos como «26V06», «26P06» o «2026C»): un periodo que empieza en octubre de 2026 y termina en febrero de 2027
 * pertenece a 2026. Se usa el año UTC de la fecha ISO, que es el día calendario con el que se guarda.
 */
export type FiltroAnio = number | 'todos';

export function anioDe(p: Pick<Periodo, 'fechaInicio'>): number | null {
  const t = Date.parse(p.fechaInicio);
  return Number.isNaN(t) ? null : new Date(t).getUTCFullYear();
}

/** Años con al menos un periodo, del más reciente al más antiguo (sin valores fijos: 2028 aparece si existe). */
export function aniosDisponibles(periodos: readonly Pick<Periodo, 'fechaInicio'>[]): number[] {
  return [...new Set(periodos.map(anioDe).filter((a): a is number => a !== null))].sort((a, b) => b - a);
}

/** El año actual si tiene periodos; si no, el más reciente; sin periodos, «todos». */
export function anioInicial(periodos: readonly Pick<Periodo, 'fechaInicio'>[], hoy: Date = new Date()): FiltroAnio {
  const anios = aniosDisponibles(periodos);
  const actual = hoy.getFullYear();
  return anios.includes(actual) ? actual : anios[0] ?? 'todos';
}

export function filtrarPorAnio<T extends Pick<Periodo, 'fechaInicio'>>(periodos: readonly T[], anio: FiltroAnio): T[] {
  return anio === 'todos' ? [...periodos] : periodos.filter((p) => anioDe(p) === anio);
}

/** El periodo de inicio más reciente (desempate por código, para que sea estable). */
export function masReciente<T extends Pick<Periodo, 'fechaInicio' | 'codigo'>>(periodos: readonly T[]): T | null {
  return [...periodos].sort((a, b) => Date.parse(b.fechaInicio) - Date.parse(a.fechaInicio) || (a.codigo < b.codigo ? -1 : 1))[0] ?? null;
}

/** Tras cambiar el filtro: se conserva la selección si sigue visible; si no, el más reciente del año; sin periodos, null. */
export function seleccionTrasFiltro<T extends Pick<Periodo, 'fechaInicio' | 'codigo'>>(visibles: readonly T[], seleccion: string | null): string | null {
  if (seleccion && visibles.some((p) => p.codigo === seleccion)) return seleccion;
  return masReciente(visibles)?.codigo ?? null;
}

/** Tras crear: si el periodo nuevo no entra en el filtro actual, el filtro pasa a su año (para verlo de inmediato). */
export function filtroTrasCrear(filtro: FiltroAnio, creado: Pick<Periodo, 'fechaInicio'>): FiltroAnio {
  const anio = anioDe(creado);
  return filtro === 'todos' || anio === null || anio === filtro ? filtro : anio;
}
