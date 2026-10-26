import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * ¿La cabecera `Authorization: Bearer <token>` coincide con el token de
 * métricas? Se comparan resúmenes SHA-256 en tiempo constante, de modo que ni el
 * contenido ni la longitud del secreto se deducen por el tiempo de respuesta.
 */
export function tokenMetricasValido(cabecera: string | undefined, esperado: string): boolean {
  if (!esperado || typeof cabecera !== 'string' || !cabecera.startsWith('Bearer ')) return false;
  const presentado = createHash('sha256').update(cabecera.slice(7)).digest();
  const secreto = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(presentado, secreto);
}
