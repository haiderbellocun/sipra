import { MedicionZona, RectRelativo } from '../../../domain/ports/out/geometria-documento.port';
import { LimiteLecturaLocalError, LimitesLecturaLocal } from '../../../domain/ports/out/lector-documento-local.port';
import { canvas } from './imagen-local';

/**
 * Medición de la tinta «de más» en una zona de firma, sobre la página rasterizada. Solo píxeles en memoria.
 *
 * Qué se descarta, en este orden, para quedarse únicamente con trazos que NO son del formulario:
 *  1. el texto impreso que el llamador ya conoce (`exclusiones`);
 *  2. las líneas largas (la de firma, bordes de tabla), aunque estén inclinadas o las cruce un trazo;
 *  3. los bordes verticales;
 *  4. las motas: componentes diminutos (ruido de escaneo, polvo, compresión).
 *
 * Si la zona no se puede analizar con fiabilidad (fuera de la página, muy chica, oscura o dominada por el ruido) NO se
 * mide: `legible: false`, y el dominio la deja `no_determinable`. No distingue de quién es un trazo ni si es válido.
 */

const MIN_ALTO_PX = 24;
const MIN_ANCHO_PX = 40;
/** Fracción mínima de la zona que debe caer dentro de la imagen. */
const MIN_VISIBLE = 0.75;
/** Un fondo más oscuro que esto (mediana) es una zona quemada o sombreada: no hay contraste fiable. */
const MIN_FONDO = 120;
/** Un píxel es tinta si es al menos esto más oscuro que el fondo. */
const CONTRASTE_TINTA = 50;
/** Racha de tinta, en la fila, que ya es una línea (fracción del ancho de la zona). */
const RACHA_LINEA = 0.3;
/** Un componente más ancho que esto y casi plano es una línea inclinada. */
const ANCHO_LINEA = 0.25;
const ALTO_LINEA = 0.1;
/** Un componente casi tan alto como la zona y delgado es un borde vertical. */
const ALTO_BORDE = 0.6;
const ANCHO_BORDE = 0.03;
/** Área mínima de un componente para no ser una mota (fracción de la zona, con piso en píxeles). */
const AREA_MOTA = 0.0002;
const MIN_AREA_MOTA_PX = 4;
/** Fracción de la zona cubierta por motas a partir de la cual el ruido domina y no se mide. */
const RUIDO_MAXIMO = 0.01;
const MARGEN_EXCLUSION_PX = 2;

const NO_LEGIBLE: MedicionZona = { legible: false, densidadTinta: 0, alturaRelativaTrazo: 0 };

export function medirZonaEnGris(
  gris: Uint8Array, anchoImagen: number, altoImagen: number, zona: RectRelativo, exclusiones: readonly RectRelativo[],
): MedicionZona {
  const x0 = Math.floor(zona.x * anchoImagen);
  const y0 = Math.floor(zona.y * altoImagen);
  const x1 = Math.ceil((zona.x + zona.ancho) * anchoImagen);
  const y1 = Math.ceil((zona.y + zona.alto) * altoImagen);
  const zw = x1 - x0;
  const zh = y1 - y0;
  if (zw <= 0 || zh <= 0) return NO_LEGIBLE;
  const cx0 = Math.max(0, x0); const cx1 = Math.min(anchoImagen, x1);
  const cy0 = Math.max(0, y0); const cy1 = Math.min(altoImagen, y1);
  const w = cx1 - cx0;
  const h = cy1 - cy0;
  if (w <= 0 || h <= 0 || (w * h) / (zw * zh) < MIN_VISIBLE || h < MIN_ALTO_PX || w < MIN_ANCHO_PX) return NO_LEGIBLE;

  // Fondo = mediana de grises de la zona.
  const histograma = new Uint32Array(256);
  for (let y = 0; y < h; y += 1) {
    const fila = (cy0 + y) * anchoImagen + cx0;
    for (let x = 0; x < w; x += 1) histograma[gris[fila + x]] += 1;
  }
  let acumulado = 0;
  let fondo = 255;
  for (let g = 0; g < 256; g += 1) { acumulado += histograma[g]; if (acumulado >= (w * h) / 2) { fondo = g; break; } }
  if (fondo < MIN_FONDO) return NO_LEGIBLE;

  const umbral = fondo - CONTRASTE_TINTA;
  const tinta = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const fila = (cy0 + y) * anchoImagen + cx0;
    for (let x = 0; x < w; x += 1) tinta[y * w + x] = gris[fila + x] < umbral ? 1 : 0;
  }

  // 1. Texto impreso conocido.
  for (const e of exclusiones) {
    const ex0 = Math.max(0, Math.floor(e.x * anchoImagen) - MARGEN_EXCLUSION_PX - cx0);
    const ex1 = Math.min(w, Math.ceil((e.x + e.ancho) * anchoImagen) + MARGEN_EXCLUSION_PX - cx0);
    const ey0 = Math.max(0, Math.floor(e.y * altoImagen) - MARGEN_EXCLUSION_PX - cy0);
    const ey1 = Math.min(h, Math.ceil((e.y + e.alto) * altoImagen) + MARGEN_EXCLUSION_PX - cy0);
    for (let y = ey0; y < ey1; y += 1) for (let x = ex0; x < ex1; x += 1) tinta[y * w + x] = 0;
  }

  // 2a. Rachas largas por fila: la línea del formulario, aunque la cruce un trazo.
  const racha = Math.max(8, Math.floor(w * RACHA_LINEA));
  for (let y = 0; y < h; y += 1) {
    let x = 0;
    while (x < w) {
      if (!tinta[y * w + x]) { x += 1; continue; }
      let fin = x;
      while (fin < w && tinta[y * w + fin]) fin += 1;
      if (fin - x >= racha) tinta.fill(0, y * w + x, y * w + fin);
      x = fin;
    }
  }

  // Componentes conexos (8 vecinos).
  const etiqueta = new Int32Array(w * h);
  const pila = new Int32Array(w * h);
  const componentes: { area: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (let i = 0; i < w * h; i += 1) {
    if (!tinta[i] || etiqueta[i]) continue;
    const id = componentes.length + 1;
    const c = { area: 0, minX: w, maxX: 0, minY: h, maxY: 0 };
    let tope = 0;
    pila[tope++] = i;
    etiqueta[i] = id;
    while (tope > 0) {
      const p = pila[--tope];
      const py = Math.floor(p / w);
      const px = p - py * w;
      c.area += 1;
      if (px < c.minX) c.minX = px; if (px > c.maxX) c.maxX = px;
      if (py < c.minY) c.minY = py; if (py > c.maxY) c.maxY = py;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (tinta[q] && !etiqueta[q]) { etiqueta[q] = id; pila[tope++] = q; }
        }
      }
    }
    componentes.push(c);
  }

  // 2b–4. Líneas inclinadas, bordes y motas.
  const areaMota = Math.max(MIN_AREA_MOTA_PX, Math.round(AREA_MOTA * w * h));
  let motas = 0;
  let tintaFirma = 0;
  let minY = h; let maxY = -1;
  for (const c of componentes) {
    const ancho = c.maxX - c.minX + 1;
    const alto = c.maxY - c.minY + 1;
    if (ancho >= ANCHO_LINEA * w && alto <= Math.max(4, ALTO_LINEA * h)) continue; // línea
    if (alto >= ALTO_BORDE * h && ancho <= Math.max(4, ANCHO_BORDE * w)) continue; // borde vertical
    if (c.area < areaMota) { motas += c.area; continue; }
    tintaFirma += c.area;
    if (c.minY < minY) minY = c.minY;
    if (c.maxY > maxY) maxY = c.maxY;
  }
  if (motas / (w * h) > RUIDO_MAXIMO) return NO_LEGIBLE;

  return {
    legible: true,
    densidadTinta: tintaFirma / (w * h),
    alturaRelativaTrazo: maxY >= minY ? (maxY - minY + 1) / h : 0,
  };
}

/** Decodifica la página (PNG) en memoria y mide la zona. Respeta el tope de píxeles. */
export async function medirZonaFirmaEnPng(
  png: Buffer, zona: RectRelativo, exclusiones: readonly RectRelativo[], limites: LimitesLecturaLocal,
): Promise<MedicionZona> {
  const imagen = await canvas().loadImage(png);
  if (imagen.width * imagen.height > limites.maxPixeles * 2) {
    throw new LimiteLecturaLocalError('pixeles', 'La página excede los píxeles admitidos');
  }
  const lienzo = canvas().createCanvas(imagen.width, imagen.height);
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, imagen.width, imagen.height);
  ctx.drawImage(imagen, 0, 0);
  const { data } = ctx.getImageData(0, 0, imagen.width, imagen.height);
  const gris = new Uint8Array(imagen.width * imagen.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    gris[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return medirZonaEnGris(gris, imagen.width, imagen.height, zona, exclusiones);
}
