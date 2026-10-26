import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { canvas } from '../src/infrastructure/adapters/lectura-local/imagen-local';

/**
 * Corpus SINTÉTICO de certificados de EPS para las pruebas de lectura local.
 * Se genera en memoria: nombres, cédulas y direcciones son inventados y no hay
 * ningún documento real versionado.
 */

export const LINEAS_EPS = [
  'Entidad Promotora de Salud NUEVA EPS S.A.',
  'CERTIFICADO DE AFILIACION',
  'Nombre: LAURA SOFIA RAMIREZ ORTIZ',
  'Documento: CC 1.032.456.786',
  'Régimen: Contributivo - Beneficiario',
  'Estado: ACTIVO',
  'Fecha de expedición: 20/10/2026',
];

// ── QR ──────────────────────────────────────────────────────────────────────

interface ModuloEscritor {
  writeBarcode(texto: string, opciones: Record<string, unknown>): Promise<{ image: Blob | null; error: string }>;
  prepareZXingModule(o: Record<string, unknown>): Promise<unknown>;
}
let escritor: Promise<ModuloEscritor> | null = null;

async function cargarEscritor(): Promise<ModuloEscritor> {
  escritor ??= (async () => {
    const requerir = createRequire(__filename);
    const modulo = requerir('zxing-wasm/writer') as ModuloEscritor;
    const binario = readFileSync(requerir.resolve('zxing-wasm/writer/zxing_writer.wasm'));
    await modulo.prepareZXingModule({
      overrides: {
        instantiateWasm: (imp: WebAssembly.Imports, listo: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) =>
          WebAssembly.instantiate(binario, imp).then((r) => listo(r.instance, r.module)),
      },
      fireImmediately: true,
    });
    return modulo;
  })();
  return escritor;
}

/** PNG de un QR con el texto indicado. */
export async function pngQr(texto: string, tamano = 260): Promise<Buffer> {
  const escritor = await cargarEscritor();
  const r = await escritor.writeBarcode(texto, { format: 'QRCode', scale: 4, withQuietZones: true, ecLevel: 'M', width: tamano, height: tamano });
  if (!r.image) throw new Error(`no se pudo generar el QR: ${r.error}`);
  return Buffer.from(await r.image.arrayBuffer());
}

// ── PDF digital ─────────────────────────────────────────────────────────────

export interface OpcionesPdf {
  qrs?: Buffer[];
  paginas?: number;
  /** Añade un enlace (anotación URI) sobre el texto. */
  enlace?: string;
}

export function pdfDigital(lineas: readonly string[] = LINEAS_EPS, opciones: OpcionesPdf = {}): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    for (const l of lineas) {
      doc.fontSize(13).text(l, opciones.enlace && l === lineas[0] ? { link: opciones.enlace } : {});
      doc.moveDown(0.4);
    }
    let y = 420;
    for (const qr of opciones.qrs ?? []) {
      doc.image(qr, 60, y, { width: 130 });
      y += 140;
    }
    for (let i = 1; i < (opciones.paginas ?? 1); i += 1) {
      doc.addPage();
      doc.fontSize(13).text(`Hoja adicional ${i + 1} sin datos del afiliado.`);
    }
    doc.end();
  });
}

// ── Imágenes del certificado (escaneo / foto) ───────────────────────────────

export interface OpcionesImagen {
  ancho?: number;
  alto?: number;
  fuente?: number;
  grados?: 0 | 90 | 180 | 270;
  qr?: Buffer;
  jpeg?: boolean;
}

/** Dibuja el certificado como imagen (sin capa de texto): lo que produce un escáner. */
export async function imagenCertificado(lineas: readonly string[] = LINEAS_EPS, o: OpcionesImagen = {}): Promise<Buffer> {
  const ancho = o.ancho ?? 1240;
  const alto = o.alto ?? 1000;
  const lienzo = canvas().createCanvas(ancho, alto);
  const ctx = lienzo.getContext('2d') as unknown as Record<string, unknown> & {
    fillStyle: string; font: string; fillRect(...a: number[]): void; fillText(t: string, x: number, y: number): void;
    drawImage(i: unknown, ...a: number[]): void; translate(x: number, y: number): void; rotate(r: number): void;
  };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.fillStyle = '#000000';
  const px = o.fuente ?? 34;
  ctx.font = `${px}px sans-serif`;
  lineas.forEach((l, i) => ctx.fillText(l, 60, 90 + i * (px * 1.7)));
  if (o.qr) {
    const img = await canvas().loadImage(o.qr);
    ctx.drawImage(img, 60, 90 + lineas.length * (px * 1.7) + 30, 260, 260);
  }
  let resultado = lienzo;
  if (o.grados) {
    const vertical = o.grados !== 180;
    const girado = canvas().createCanvas(vertical ? alto : ancho, vertical ? ancho : alto);
    const g = girado.getContext('2d') as unknown as typeof ctx;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, girado.width, girado.height);
    g.translate(girado.width / 2, girado.height / 2);
    g.rotate((o.grados * Math.PI) / 180);
    g.drawImage(lienzo, -ancho / 2, -alto / 2);
    resultado = girado;
  }
  return (resultado as unknown as { toBuffer(m: string): Buffer }).toBuffer(o.jpeg ? 'image/jpeg' : 'image/png');
}

/** PDF escaneado: una página por imagen, sin ninguna capa de texto. */
export function pdfEscaneado(imagenes: readonly Buffer[]): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    imagenes.forEach((img, i) => {
      if (i > 0) doc.addPage();
      doc.image(img, 0, 0, { fit: [595, 842] });
    });
    doc.end();
  });
}

/** Imagen con un QR al que se le tapó una banda: ya no es decodificable. */
export async function pngQrCorrupto(texto: string): Promise<Buffer> {
  const limpio = await pngQr(texto);
  const img = await canvas().loadImage(limpio);
  const lienzo = canvas().createCanvas(img.width, img.height);
  const ctx = lienzo.getContext('2d') as unknown as { drawImage(i: unknown, x: number, y: number): void; fillStyle: string; fillRect(...a: number[]): void };
  ctx.drawImage(img, 0, 0);
  // Se ensucia el centro y las esquinas con ruido en bloques: el código deja de ser legible.
  let semilla = 7;
  for (let i = 0; i < 400; i += 1) {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
    ctx.fillStyle = semilla % 2 ? '#000000' : '#ffffff';
    ctx.fillRect(20 + (semilla % (img.width - 40)), 20 + ((semilla >> 8) % (img.height - 40)), 12, 12);
  }
  return (lienzo as unknown as { toBuffer(m: string): Buffer }).toBuffer('image/png');
}
