import { generateKeyPairSync, sign } from 'node:crypto';

/**
 * Certificado TLS AUTOFIRMADO generado en memoria, SOLO para las pruebas de los
 * servidores HTTPS sintéticos del verificador de EPS. No se guarda ninguna clave
 * en el repositorio ni se usa fuera de las pruebas.
 */

const largo = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, ...partes: Buffer[]): Buffer => {
  const cuerpo = Buffer.concat(partes);
  return Buffer.concat([Buffer.from([tag]), largo(cuerpo.length), cuerpo]);
};
const secuencia = (...p: Buffer[]): Buffer => tlv(0x30, ...p);
const oid = (valor: string): Buffer => {
  const n = valor.split('.').map(Number);
  const bytes: number[] = [n[0] * 40 + n[1]];
  for (const x of n.slice(2)) {
    const grupo = [x & 0x7f];
    for (let r = x >> 7; r > 0; r >>= 7) grupo.unshift((r & 0x7f) | 0x80);
    bytes.push(...grupo);
  }
  return tlv(0x06, Buffer.from(bytes));
};
const entero = (n: number): Buffer => tlv(0x02, Buffer.from([n]));
const utf8 = (t: string): Buffer => tlv(0x0c, Buffer.from(t, 'utf8'));
const fecha = (d: string): Buffer => tlv(0x17, Buffer.from(d, 'ascii'));
const ECDSA_SHA256 = secuencia(oid('1.2.840.10045.4.3.2'));

function nombre(cn: string): Buffer {
  return secuencia(tlv(0x31, secuencia(oid('2.5.4.3'), utf8(cn))));
}

export function crearCertificadoAutofirmado(dnsNames: readonly string[]): { clave: string; certificado: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const san = secuencia(
    oid('2.5.29.17'),
    tlv(0x04, secuencia(...dnsNames.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))))),
  );
  const tbs = secuencia(
    tlv(0xa0, entero(2)), // versión 3
    entero(1),
    ECDSA_SHA256,
    nombre(dnsNames[0]),
    secuencia(fecha('250101000000Z'), fecha('491231235959Z')),
    nombre(dnsNames[0]),
    spki,
    tlv(0xa3, secuencia(san)),
  );
  const firma = sign('sha256', tbs, privateKey);
  const cert = secuencia(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), firma])));
  const pem = (etiqueta: string, der: Buffer): string =>
    `-----BEGIN ${etiqueta}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${etiqueta}-----\n`;
  return {
    certificado: pem('CERTIFICATE', cert),
    clave: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}
