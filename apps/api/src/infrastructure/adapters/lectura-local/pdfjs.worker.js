'use strict';
/**
 * Hilo de trabajo que ejecuta pdf.js sobre PDF NO CONFIABLES.
 *
 * Vive en su propio hilo (con límite de memoria de V8) por dos razones: un PDF
 * hostil puede monopolizar la CPU durante su análisis y, en el hilo principal,
 * eso congelaría a todas las peticiones de la instancia; y un hilo sí se puede
 * cancelar de verdad (`terminate()`), cosa que una promesa no permite.
 *
 * Es JavaScript plano (no TypeScript) para que Node lo cargue directamente, igual
 * en desarrollo, en Jest y en la imagen compilada (se copia como recurso).
 * pdf.js es ESM puro: se carga con el `require` nativo de Node (≥ 22.13), sin red.
 */
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

const requerir = createRequire(workerData.base);
const pdfjs = requerir('pdfjs-dist/legacy/build/pdf.mjs');
const { createCanvas } = requerir('@napi-rs/canvas');
const raiz = dirname(dirname(dirname(requerir.resolve('pdfjs-dist/legacy/build/pdf.mjs'))));
// Rutas locales con «/» final: pdf.js las lee del disco y no hace ninguna petición de red.
const RECURSOS = {
  standardFontDataUrl: `${join(raiz, 'standard_fonts')}/`,
  cMapUrl: `${join(raiz, 'cmaps')}/`,
  cMapPacked: true,
  wasmUrl: `${join(raiz, 'wasm')}/`,
  iccUrl: `${join(raiz, 'iccs')}/`,
};

/** Documento abierto en memoria: se conserva entre peticiones del mismo archivo. */
let abierto = null; // { id, doc, tarea }

async function cerrarAbierto() {
  const previo = abierto;
  abierto = null;
  if (previo) await previo.tarea.destroy().catch(() => undefined);
}

function falla(codigo) {
  const e = new Error(codigo);
  e.codigo = codigo;
  return e;
}

async function abrir(id, datos, limites) {
  if (abierto && abierto.id === id) return abierto.doc;
  await cerrarAbierto();
  if (!datos) throw falla('pdf_no_valido');
  let tarea;
  let doc;
  try {
    tarea = pdfjs.getDocument({
      data: new Uint8Array(datos),
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
      maxImageSize: limites.maxPixeles,
      ...RECURSOS,
    });
    doc = await tarea.promise;
  } catch {
    if (tarea) await tarea.destroy().catch(() => undefined);
    throw falla('pdf_no_valido');
  }
  if (doc.numPages > limites.maxPaginasDocumento) {
    await tarea.destroy().catch(() => undefined);
    throw falla('paginas');
  }
  abierto = { id, doc, tarea };
  return doc;
}

async function texto(doc, limites) {
  const porPagina = [];
  const hasta = Math.min(doc.numPages, limites.maxPaginas);
  for (let n = 1; n <= hasta; n += 1) {
    const pagina = await doc.getPage(n);
    const t = await pagina.getTextContent();
    porPagina.push({
      pagina: n,
      texto: t.items.map((i) => `${i.str || ''}${i.hasEOL ? '\n' : ''}`).join('\n').replace(/\n{3,}/g, '\n\n'),
    });
    pagina.cleanup();
  }
  return { paginas: doc.numPages, porPagina };
}

async function renderizar(doc, numero, limites) {
  if (!Number.isInteger(numero) || numero < 1 || numero > doc.numPages) throw falla('pagina_fuera_de_rango');
  const pagina = await doc.getPage(numero);
  const base = pagina.getViewport({ scale: 1 });
  // Si la página es enorme se reduce la escala; si ni así cabe en el tope, se rechaza.
  const escala = Math.min(limites.escalaRender, Math.sqrt(limites.maxPixeles / (base.width * base.height)));
  if (escala < 0.75) throw falla('pixeles');
  const viewport = pagina.getViewport({ scale: escala });
  const lienzo = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  await pagina.render({ canvasContext: ctx, viewport, canvas: lienzo }).promise;
  const imagen = lienzo.toBuffer('image/png');
  pagina.cleanup();
  return { pagina: numero, ancho: lienzo.width, alto: lienzo.height, imagen: new Uint8Array(imagen) };
}

parentPort.on('message', async (m) => {
  try {
    if (m.op === 'cerrar') {
      await cerrarAbierto();
      parentPort.postMessage({ id: m.pedido, ok: true, resultado: null });
      return;
    }
    const doc = await abrir(m.documento, m.datos, m.limites);
    const resultado = m.op === 'texto' ? await texto(doc, m.limites) : await renderizar(doc, m.pagina, m.limites);
    const transferibles = resultado.imagen ? [resultado.imagen.buffer] : [];
    parentPort.postMessage({ id: m.pedido, ok: true, resultado }, transferibles);
  } catch (error) {
    // Solo el tipo de excepción: nunca su mensaje, que podría citar contenido del documento.
    parentPort.postMessage({ id: m.pedido, ok: false, codigo: (error && error.codigo) || `error_${(error && error.name) || 'desconocido'}` });
  }
});
