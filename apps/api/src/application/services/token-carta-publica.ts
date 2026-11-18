import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token de descarga PÚBLICA de una carta de presentación (mismo patrón que los enlaces firmados de documentos:
 * HMAC-SHA256 con una clave DERIVADA y exclusiva de este propósito; rotar o filtrar una no compromete la otra).
 *
 * Contenido: id interno de la carta (UUID aleatorio, no secuencial) y vencimiento. No lleva la cédula ni otros datos
 * personales. La firma cubre ambos: cambiar el id o el vencimiento invalida el token. Formato opaco base64url.
 */
const PROPOSITO = 'sipra:cartas-publicas:v1';
export const MINUTOS_TOKEN_CARTA = 10;

function firmar(secreto: string, cartaId: string, expira: number): Buffer {
  const clave = createHmac('sha256', secreto).update(PROPOSITO).digest();
  return createHmac('sha256', clave).update(`carta:${cartaId}|exp:${expira}`).digest();
}

export function emitirTokenCarta(secreto: string, cartaId: string, ahora: number = Date.now(), minutos = MINUTOS_TOKEN_CARTA): string {
  const expira = ahora + minutos * 60_000;
  return Buffer.from(`${cartaId}.${expira}.${firmar(secreto, cartaId, expira).toString('hex')}`).toString('base64url');
}

/** Id de la carta firmada, o `null` si el token es inválido, manipulado o vencido. */
export function verificarTokenCarta(secreto: string, token: unknown, ahora: number = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 400 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const partes = Buffer.from(token, 'base64url').toString('utf8').split('.');
  if (partes.length !== 3) return null;
  const [cartaId, exp, sig] = partes;
  if (!/^[0-9a-f-]{36}$/.test(cartaId) || !/^\d{1,16}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expira = Number(exp);
  if (expira < ahora) return null;
  const esperada = firmar(secreto, cartaId, expira);
  const recibida = Buffer.from(sig, 'hex');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  return cartaId;
}

/**
 * Normaliza el número de identificación de la consulta pública: quita espacios y separadores de miles (puntos), y
 * exige 4–20 caracteres alfanuméricos (cédula, T.I., C.E. o pasaporte). Coincidencia EXACTA: nunca búsquedas parciales.
 */
export function normalizarDocumento(bruto: unknown): string | null {
  if (typeof bruto !== 'string' || bruto.length > 40) return null;
  const limpio = bruto.replace(/[\s.]/g, '').toUpperCase();
  return /^[0-9A-Z]{4,20}$/.test(limpio) ? limpio : null;
}
