import PDFDocument from 'pdfkit';
import { canvas } from '../src/infrastructure/adapters/lectura-local/imagen-local';
import { pdfEscaneado } from './soporte-lectura-local';
import { OpcionesActa, actaSintetica } from './soporte-acta';

/**
 * PDF e imágenes SINTÉTICOS de actas de iniciación, generados en memoria. Reproducen la ESTRUCTURA de los formatos
 * (título, rótulos, secciones de obligaciones y zona de firmas con línea y rótulo debajo) con contenido inventado.
 * No hay ningún documento real ni binario versionado.
 */

export type Firma = 'ninguna' | 'trazo' | 'pequeno' | 'linea_cruzada';

export interface OpcionesPdfActa extends OpcionesActa {
  /** Qué páginas incluye el archivo. */
  paginas?: 'completo' | 'primera' | 'segunda';
  firmaEmpresa?: Firma;
  firmaPracticante?: Firma;
}

interface Lienzo {
  beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  stroke(): void; lineTo(x: number, y: number): void;
}

/** pdfkit no tiene `beginPath`: cada `stroke` cierra el trazo anterior. */
function lienzoPdfkit(doc: PDFKit.PDFDocument): Lienzo {
  return {
    beginPath: () => undefined,
    moveTo: (x, y) => { doc.moveTo(x, y); },
    lineTo: (x, y) => { doc.lineTo(x, y); },
    bezierCurveTo: (a, b, c, d, e, f) => { doc.bezierCurveTo(a, b, c, d, e, f); },
    stroke: () => { doc.stroke(); },
  };
}

/** Garabato de firma: unas curvas dentro de (x, y, ancho, alto). */
function trazarFirma(l: Lienzo, tipo: Firma, x: number, y: number, ancho: number, alto: number): void {
  if (tipo === 'ninguna') return;
  l.beginPath();
  if (tipo === 'pequeno') {
    // Una marca corta: hay tinta, pero no alcanza a ser una firma clara.
    l.moveTo(x + ancho * 0.35, y + alto * 0.75);
    l.lineTo(x + ancho * 0.65, y + alto * 0.55);
    l.stroke();
    return;
  }
  const p = (u: number, v: number): [number, number] => [x + ancho * u, y + alto * v];
  l.moveTo(...p(0.1, 0.8));
  l.bezierCurveTo(...p(0.15, 0.1), ...p(0.25, 0.1), ...p(0.3, 0.7));
  l.bezierCurveTo(...p(0.35, 1.0), ...p(0.4, 0.2), ...p(0.5, 0.4));
  l.bezierCurveTo(...p(0.6, 0.7), ...p(0.65, 0.05), ...p(0.75, 0.5));
  l.bezierCurveTo(...p(0.8, 0.8), ...p(0.9, 0.3), ...p(0.95, 0.6));
  l.stroke();
  if (tipo === 'linea_cruzada') {
    // El trazo final baja y cruza la línea de firma.
    l.beginPath();
    l.moveTo(...p(0.55, 0.3));
    l.bezierCurveTo(...p(0.57, 0.8), ...p(0.58, 1.1), ...p(0.6, 1.35));
    l.stroke();
  }
}

/** Páginas de texto del acta sintético: la 2.ª empieza donde se repite el título del encabezado. */
function paginasDeTexto(o: OpcionesActa): { primera: string[]; segunda: string[] } {
  const lineas = actaSintetica({ ...o, sinRotulosFirma: true }).split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const titulo = lineas[0];
  const segundaInicio = lineas.findIndex((l, i) => i > 0 && l === titulo);
  const corte = segundaInicio > 0 ? segundaInicio : lineas.length;
  return { primera: lineas.slice(0, corte), segunda: lineas.slice(corte) };
}

/** PDF con capa de texto digital (lo que produce un procesador de texto). */
export function pdfActaDigital(o: OpcionesPdfActa = {}): Promise<Buffer> {
  const { primera, segunda } = paginasDeTexto(o);
  const paginas = o.paginas ?? 'completo';
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    const escribir = (lineas: string[]): void => {
      for (const l of lineas) { doc.fontSize(9.5).text(l, 50, undefined, { width: 495 }); doc.moveDown(0.15); }
    };
    if (paginas !== 'segunda') escribir(primera);
    if (paginas === 'completo') doc.addPage();
    if (paginas !== 'primera') {
      escribir(segunda);
      if (!o.sinRotulosFirma) {
        // Zona de firmas: línea de cada firma y el rótulo debajo, como en el formato.
        const yLinea = 560;
        doc.lineWidth(0.8);
        doc.moveTo(60, yLinea).lineTo(280, yLinea).stroke();
        doc.moveTo(320, yLinea).lineTo(540, yLinea).stroke();
        doc.font('Helvetica-Bold').fontSize(9.5);
        doc.text('FIRMA DE LA EMPRESA', 60, yLinea + 6, { width: 220, align: 'center', lineBreak: false });
        doc.text('FIRMA DEL PRÁCTICANTE', 320, yLinea + 6, { width: 220, align: 'center', lineBreak: false });
        doc.font('Helvetica');
        doc.lineWidth(1.6);
        const pluma = lienzoPdfkit(doc);
        trazarFirma(pluma, o.firmaEmpresa ?? 'ninguna', 90, yLinea - 55, 160, 52);
        trazarFirma(pluma, o.firmaPracticante ?? 'ninguna', 350, yLinea - 55, 160, 52);
      }
    }
    doc.end();
  });
}

// ── Escaneo ─────────────────────────────────────────────────────────────────

export interface OpcionesEscaneo {
  /** Fuente en px sobre una página de 1240×1754. */
  fuente?: number;
  /** Escaneo de mala calidad: texto gris sobre fondo sucio, motas y una leve inclinación. */
  degradar?: boolean;
}

interface Ctx extends Lienzo {
  fillStyle: string; strokeStyle: string; lineWidth: number; font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  translate(x: number, y: number): void; rotate(r: number): void;
}

function envolver(ctx: Ctx, texto: string, ancho: number): string[] {
  const salida: string[] = [];
  let actual = '';
  for (const palabra of texto.split(' ')) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > ancho && actual) { salida.push(actual); actual = palabra; } else actual = prueba;
  }
  if (actual) salida.push(actual);
  return salida;
}

function paginaEscaneada(lineas: string[], o: OpcionesPdfActa & OpcionesEscaneo, conFirmas: boolean): Buffer {
  const ancho = 1240;
  const alto = 1754;
  const lienzo = canvas().createCanvas(ancho, alto);
  const ctx = lienzo.getContext('2d') as unknown as Ctx;
  ctx.fillStyle = o.degradar ? '#d9d6cf' : '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.fillStyle = o.degradar ? '#6a6a6a' : '#000000';
  const px = o.fuente ?? (o.degradar ? 22 : 28);
  ctx.font = `${px}px sans-serif`;
  if (o.degradar) { ctx.translate(30, 10); ctx.rotate(0.012); }
  let y = 90;
  for (const l of lineas) {
    for (const parte of envolver(ctx, l, ancho - 160)) { ctx.fillText(parte, 80, y); y += px * 1.45; }
    y += px * 0.2;
  }
  if (conFirmas) {
    const yLinea = Math.max(y + 140, 1300);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ctx.fillStyle;
    for (const [x0, x1] of [[110, 560], [660, 1110]]) { ctx.beginPath(); ctx.moveTo(x0, yLinea); ctx.lineTo(x1, yLinea); ctx.stroke(); }
    ctx.font = `bold ${px}px sans-serif`;
    ctx.fillText('FIRMA DE LA EMPRESA', 215, yLinea + px * 1.4);
    ctx.fillText('FIRMA DEL PRÁCTICANTE', 735, yLinea + px * 1.4);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1a2a6c';
    trazarFirma(ctx, o.firmaEmpresa ?? 'ninguna', 150, yLinea - 110, 360, 105);
    trazarFirma(ctx, o.firmaPracticante ?? 'ninguna', 700, yLinea - 110, 360, 105);
  }
  if (o.degradar) {
    // Motas de escaneo: puntos sueltos dispersos (ruido de sal y pimienta moderado).
    ctx.fillStyle = '#555555';
    let semilla = 7;
    for (let i = 0; i < 1500; i += 1) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      const x = semilla % ancho;
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      ctx.fillRect(x, semilla % alto, 2, 2);
    }
  }
  return (lienzo as unknown as { toBuffer(m: string): Buffer }).toBuffer('image/png');
}

/** Páginas del acta como imágenes (sin capa de texto): lo que produce un escáner. */
export function imagenesActaEscaneada(o: OpcionesPdfActa & OpcionesEscaneo = {}): Buffer[] {
  const { primera, segunda } = paginasDeTexto(o);
  const paginas = o.paginas ?? 'completo';
  const salida: Buffer[] = [];
  if (paginas !== 'segunda') salida.push(paginaEscaneada(primera, o, false));
  if (paginas !== 'primera') salida.push(paginaEscaneada(segunda, o, !o.sinRotulosFirma));
  return salida;
}

/** PDF escaneado: una imagen por página, sin ninguna capa de texto. */
export function pdfActaEscaneada(o: OpcionesPdfActa & OpcionesEscaneo = {}): Promise<Buffer> {
  return pdfEscaneado(imagenesActaEscaneada(o));
}

/** Un PDF «vacío»: páginas sin nada impreso. */
export function pdfVacio(paginas = 1): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4' });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    for (let i = 1; i < paginas; i += 1) doc.addPage();
    doc.end();
  });
}

/** PDF digital con las líneas dadas (para «documento diferente»). */
export function pdfDeLineas(lineas: readonly string[]): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    for (const l of lineas) { doc.fontSize(11).text(l, { width: 495 }); doc.moveDown(0.3); }
    doc.end();
  });
}
