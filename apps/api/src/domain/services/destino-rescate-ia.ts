/**
 * Destino permitido de la IA de rescate (subfase 1.5, dominio puro).
 *
 * El extractor principal puede apuntar a una pasarela https propia (`OPENAI_URL_BASE`); el rescate NO: solo envía
 * documentos a `api.openai.com`, o a la propia máquina cuando el ambiente es `dev` (simulador local de pruebas).
 *
 * Se analiza con `URL` (no con expresiones regulares ni `startsWith`): `https://api.openai.com@otro.host` tiene
 * host `otro.host` y `https://api.openai.com.otro.host` es otro dominio. Nunca devuelve ni registra la URL: puede
 * traer credenciales.
 */

export type MotivoDestinoRescate =
  | 'url_invalida'
  | 'credenciales_en_url'
  | 'protocolo_no_permitido'
  | 'puerto_no_permitido'
  | 'host_no_permitido'
  | 'local_solo_en_dev';

export interface DestinoRescate {
  permitido: boolean;
  motivo: MotivoDestinoRescate | null;
}

const HOST_OPENAI = 'api.openai.com';
const HOSTS_LOCALES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

const permitido: DestinoRescate = { permitido: true, motivo: null };
const bloqueado = (motivo: MotivoDestinoRescate): DestinoRescate => ({ permitido: false, motivo });

export function evaluarDestinoRescate(urlBase: string | null | undefined, ambiente: string | null | undefined): DestinoRescate {
  let url: URL;
  try {
    url = new URL((urlBase ?? '').trim());
  } catch {
    return bloqueado('url_invalida');
  }
  if (url.username !== '' || url.password !== '') return bloqueado('credenciales_en_url');

  if (url.hostname === HOST_OPENAI) {
    if (url.protocol !== 'https:') return bloqueado('protocolo_no_permitido');
    // Puerto por defecto de https: `URL` lo deja vacío; cualquier otro (incluso 443 explícito distinto) se rechaza.
    if (url.port !== '') return bloqueado('puerto_no_permitido');
    return permitido;
  }
  if (HOSTS_LOCALES.has(url.hostname)) {
    if (ambiente !== 'dev') return bloqueado('local_solo_en_dev');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return bloqueado('protocolo_no_permitido');
    return permitido;
  }
  return bloqueado('host_no_permitido');
}
