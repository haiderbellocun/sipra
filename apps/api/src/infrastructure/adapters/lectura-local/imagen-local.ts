import { createRequire } from 'node:module';
import {
  DocumentoLocalIlegibleError, LimiteLecturaLocalError, LimitesLecturaLocal,
} from '../../../domain/ports/out/lector-documento-local.port';

/**
 * Operaciones de imagen en memoria con `@napi-rs/canvas` (prebuilds nativos,
 * sin procesos externos). Nada de esto se escribe a disco.
 */
interface ModuloCanvas {
  createCanvas(ancho: number, alto: number): {
    getContext(tipo: '2d'): CanvasContext;
    toBuffer(mime: 'image/png'): Buffer;
    width: number;
    height: number;
  };
  loadImage(contenido: Buffer): Promise<{ width: number; height: number }>;
}
interface CanvasContext {
  fillStyle: string;
  fillRect(x: number, y: number, ancho: number, alto: number): void;
  drawImage(imagen: unknown, ...args: number[]): void;
  translate(x: number, y: number): void;
  rotate(radianes: number): void;
  getImageData(x: number, y: number, ancho: number, alto: number): { data: Uint8ClampedArray };
  putImageData(datos: unknown, x: number, y: number): void;
  imageSmoothingQuality: string;
}

let modulo: ModuloCanvas | null = null;
export function canvas(): ModuloCanvas {
  modulo ??= createRequire(__filename)('@napi-rs/canvas') as ModuloCanvas;
  return modulo;
}

/** Píxeles de entrada máximos antes de decodificar: protege de imágenes «bomba». */
export function maxPixelesEntrada(limites: LimitesLecturaLocal): number {
  return limites.maxPixeles * 6;
}

/** Dimensiones leídas del encabezado, sin decodificar la imagen. */
export function dimensionesDeEncabezado(contenido: Buffer, mime: string): { ancho: number; alto: number } | null {
  if (mime === 'image/png' && contenido.length > 24 && contenido.toString('latin1', 1, 4) === 'PNG') {
    return { ancho: contenido.readUInt32BE(16), alto: contenido.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg' && contenido.length > 4 && contenido[0] === 0xff && contenido[1] === 0xd8) {
    let i = 2;
    while (i + 9 < contenido.length) {
      if (contenido[i] !== 0xff) { i += 1; continue; }
      const marcador = contenido[i + 1];
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        return { alto: contenido.readUInt16BE(i + 5), ancho: contenido.readUInt16BE(i + 7) };
      }
      i += 2 + contenido.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Valida y normaliza una imagen de entrada a PNG: respeta el tope de píxeles
 * (reduce las muy grandes), amplía las de baja resolución y deja fondo blanco.
 */
export async function normalizarImagen(
  contenido: Buffer, mime: string, limites: LimitesLecturaLocal,
): Promise<{ ancho: number; alto: number; png: Buffer }> {
  const dims = dimensionesDeEncabezado(contenido, mime);
  if (!dims || dims.ancho < 1 || dims.alto < 1) throw new DocumentoLocalIlegibleError('imagen_sin_encabezado_valido');
  if (dims.ancho * dims.alto > maxPixelesEntrada(limites)) {
    throw new LimiteLecturaLocalError('pixeles', 'La imagen excede los píxeles admitidos para su lectura');
  }
  let origen: { width: number; height: number };
  try {
    origen = await canvas().loadImage(contenido);
  } catch {
    throw new DocumentoLocalIlegibleError('imagen_no_decodificable');
  }
  // Escala: reducir si excede el tope; ampliar si es de baja resolución (OCR y QR lo agradecen).
  const pixeles = origen.width * origen.height;
  let factor = 1;
  if (pixeles > limites.maxPixeles) factor = Math.sqrt(limites.maxPixeles / pixeles);
  else if (origen.width < 1000 && origen.height < 1000) factor = Math.min(2, Math.sqrt(limites.maxPixeles / pixeles));
  const ancho = Math.max(1, Math.round(origen.width * factor));
  const alto = Math.max(1, Math.round(origen.height * factor));
  const lienzo = canvas().createCanvas(ancho, alto);
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(origen, 0, 0, ancho, alto);
  return { ancho, alto, png: lienzo.toBuffer('image/png') };
}

/** Gira la imagen en múltiplos de 90° (OCR de fotos tomadas de lado o al revés). */
export async function girarImagen(png: Buffer, grados: 90 | 180 | 270): Promise<Buffer> {
  const origen = await canvas().loadImage(png);
  const vertical = grados !== 180;
  const lienzo = canvas().createCanvas(vertical ? origen.height : origen.width, vertical ? origen.width : origen.height);
  const ctx = lienzo.getContext('2d');
  ctx.translate(lienzo.width / 2, lienzo.height / 2);
  ctx.rotate((grados * Math.PI) / 180);
  ctx.drawImage(origen, -origen.width / 2, -origen.height / 2);
  return lienzo.toBuffer('image/png');
}

/** Escala de grises con estiramiento de contraste. Reorganiza valores existentes; no inventa información. */
export async function mejorarParaOcr(png: Buffer): Promise<Buffer> {
  const origen = await canvas().loadImage(png);
  const lienzo = canvas().createCanvas(origen.width, origen.height);
  const ctx = lienzo.getContext('2d');
  ctx.drawImage(origen, 0, 0);
  const imagen = ctx.getImageData(0, 0, origen.width, origen.height);
  const d = imagen.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const rango = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(((d[i] - min) * 255) / rango);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imagen, 0, 0);
  return lienzo.toBuffer('image/png');
}
