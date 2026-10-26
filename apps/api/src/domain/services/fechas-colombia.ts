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
