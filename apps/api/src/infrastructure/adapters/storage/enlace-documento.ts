import { createHmac, timingSafeEqual } from 'node:crypto';
import { ContextoEnlaceDocumento } from '../../../domain/ports/out/servicios-externos.port';

/**
 * Enlace de descarga de un documento, firmado por la propia API.
 *
 * La firma cubre el DOCUMENTO, quién pidió el enlace y el vencimiento; la ruta
 * de almacenamiento no viaja en la URL (la API la resuelve desde el documento).
 * Se firma con una clave derivada y exclusiva de este propósito, no con
 * `JWT_SECRETO` directamente: rotar o filtrar una no compromete la otra.
 */
const PROPOSITO = 'sipra:enlaces-documentos:v1';

export interface ParametrosEnlace {
  doc?: unknown;
  usr?: unknown;
  exp?: unknown;
  sig?: unknown;
}

function firmar(secreto: string, documentoId: string, solicitanteId: string, expira: number): Buffer {
  const clave = createHmac('sha256', secreto).update(PROPOSITO).digest();
  return createHmac('sha256', clave)
    .update(`doc:${documentoId}|usr:${solicitanteId}|exp:${expira}`)
    .digest();
}

export function firmarEnlaceDocumento(
  secreto: string,
  contexto: ContextoEnlaceDocumento,
  minutos: number,
  ahora: number = Date.now(),
): string {
  const expira = ahora + minutos * 60_000;
  const firma = firmar(secreto, contexto.documentoId, contexto.solicitanteId, expira);
  const params = new URLSearchParams({
    doc: contexto.documentoId,
    usr: contexto.solicitanteId,
    exp: String(expira),
    sig: firma.toString('hex'),
  });
  return `/api/v1/documentos/descarga?${params.toString()}`;
}

/** Devuelve el contexto firmado, o `null` si el enlace es inválido, manipulado o vencido. */
export function verificarEnlaceDocumento(
  secreto: string,
  parametros: ParametrosEnlace,
  ahora: number = Date.now(),
): ContextoEnlaceDocumento | null {
  const { doc, usr, exp, sig } = parametros;
  if (typeof doc !== 'string' || typeof usr !== 'string' || typeof exp !== 'string' || typeof sig !== 'string') {
    return null;
  }
  if (!/^\d{1,16}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return null;

  const expira = Number(exp);
  if (expira < ahora) return null;

  const esperada = firmar(secreto, doc, usr, expira);
  const recibida = Buffer.from(sig, 'hex');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;

  return { documentoId: doc, solicitanteId: usr };
}
