import { isIP } from 'node:net';

/**
 * ¿Es una dirección que NO debe alcanzarse desde el servidor? (SSRF)
 * Cubre loopback, redes privadas (RFC 1918), CGNAT, enlace local (incluida la
 * metadata de la nube, 169.254.169.254), documentación, multicast, reservadas,
 * y los equivalentes IPv6 (ULA, enlace local, mapeadas a IPv4, NAT64).
 * Ante cualquier duda —una dirección que no se puede interpretar— es «privada».
 */

function ipv4aBytes(texto: string): number[] | null {
  const partes = texto.split('.');
  if (partes.length !== 4) return null;
  const bytes = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function esIpv4Privada(b: number[]): boolean {
  const [a, c, d] = b;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && c >= 64 && c <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 127) return true; // loopback
  if (a === 169 && c === 254) return true; // enlace local y metadata
  if (a === 172 && c >= 16 && c <= 31) return true; // 172.16/12
  if (a === 192 && c === 0 && d === 0) return true; // 192.0.0/24
  if (a === 192 && c === 0 && d === 2) return true; // documentación
  if (a === 192 && c === 168) return true; // 192.168/16
  if (a === 198 && (c === 18 || c === 19)) return true; // 198.18/15
  if (a === 198 && c === 51 && d === 100) return true; // documentación
  if (a === 203 && c === 0 && d === 113) return true; // documentación
  if (a >= 224) return true; // multicast, reservadas y broadcast
  return false;
}

/** IPv6 → 16 bytes (admite «::» y un sufijo IPv4). `null` si no se puede interpretar. */
function ipv6aBytes(texto: string): number[] | null {
  let t = texto.toLowerCase();
  const zona = t.indexOf('%');
  if (zona >= 0) t = t.slice(0, zona);
  let sufijo: number[] = [];
  const ultimoDosPuntos = t.lastIndexOf(':');
  if (t.includes('.')) {
    const v4 = ipv4aBytes(t.slice(ultimoDosPuntos + 1));
    if (!v4) return null;
    sufijo = v4;
    t = t.slice(0, ultimoDosPuntos + 1) + '0:0';
  }
  const dobles = t.split('::');
  if (dobles.length > 2) return null;
  const aGrupos = (s: string): number[] | null => {
    if (s === '') return [];
    const g = s.split(':');
    if (!g.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
    return g.map((x) => parseInt(x, 16));
  };
  const izq = aGrupos(dobles[0]);
  const der = dobles.length === 2 ? aGrupos(dobles[1]) : [];
  if (!izq || !der) return null;
  let grupos: number[];
  if (dobles.length === 2) {
    const faltan = 8 - izq.length - der.length;
    if (faltan < 1) return null;
    grupos = [...izq, ...new Array<number>(faltan).fill(0), ...der];
  } else {
    grupos = izq;
  }
  if (grupos.length !== 8) return null;
  const bytes = grupos.flatMap((g) => [g >> 8, g & 0xff]);
  if (sufijo.length === 4) { bytes[12] = sufijo[0]; bytes[13] = sufijo[1]; bytes[14] = sufijo[2]; bytes[15] = sufijo[3]; }
  return bytes;
}

function esIpv6Privada(b: number[]): boolean {
  const todosCero = (desde: number, hasta: number): boolean => b.slice(desde, hasta).every((x) => x === 0);
  if (todosCero(0, 16)) return true; // ::
  if (todosCero(0, 15) && b[15] === 1) return true; // ::1
  if (todosCero(0, 10) && b[10] === 0xff && b[11] === 0xff) return esIpv4Privada(b.slice(12)); // ::ffff:a.b.c.d
  if (todosCero(0, 12)) return true; // ::a.b.c.d (compatible IPv4, obsoleta)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && todosCero(4, 12)) return esIpv4Privada(b.slice(12)); // NAT64
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 (ULA)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 (site-local)
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentación
  return false;
}

export function esDireccionPrivada(direccion: string): boolean {
  const limpia = direccion.startsWith('[') && direccion.endsWith(']') ? direccion.slice(1, -1) : direccion;
  const version = isIP(limpia);
  if (version === 4) {
    const b = ipv4aBytes(limpia);
    return b === null || esIpv4Privada(b);
  }
  if (version === 6) {
    const b = ipv6aBytes(limpia);
    return b === null || esIpv6Privada(b);
  }
  return true; // no es una IP interpretable: no se confía
}

/** ¿El «host» es una IP literal (en cualquier notación, incluida la decimal u octal)? */
export function esHostIpLiteral(host: string): boolean {
  const h = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(h) !== 0) return true;
  // Notaciones que algunos resolutores aceptan: 2130706433, 0x7f.1, 017700000001…
  return /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/i.test(h);
}

/** Nombres de host que nunca se consultan, aunque alguien los registrara por error. */
export function esNombreInterno(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
    || h.endsWith('.localdomain') || h === 'metadata' || h === 'metadata.google.internal' || !h.includes('.');
}
