/**
 * Fechas en la zona horaria institucional. Colombia (America/Bogota) está en
 * UTC−5 todo el año, sin horario de verano, así que basta un desfase fijo.
 */
const DESFASE_COLOMBIA_MS = 5 * 60 * 60 * 1000;

/** Medianoche de hoy en Colombia, expresada en UTC. */
export function inicioDelDiaEnColombia(ahora: Date): Date {
  const local = new Date(ahora.getTime() - DESFASE_COLOMBIA_MS);
  const medianoche = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(medianoche + DESFASE_COLOMBIA_MS);
}

/**
 * Día académico en Colombia como `Date.UTC(año, mes, día)`: el mismo formato con que se guardan las
 * fechas académicas (columnas DATE leídas a medianoche UTC). Así «hoy» no cambia de día a las 7 p. m.
 * hora de Colombia, como ocurriría al tomar el día UTC.
 */
export function diaAcademicoColombia(ahora: Date): number {
  const local = new Date(ahora.getTime() - DESFASE_COLOMBIA_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}
