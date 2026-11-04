import { CajaTexto, GeometriaDocumentoPort } from '../src/domain/ports/out/geometria-documento.port';
import { LectorDocumentoLocalPort, LimitesLecturaLocal } from '../src/domain/ports/out/lector-documento-local.port';
import { Nit } from '../src/domain/value-objects/nit.vo';

/**
 * RUT SINTÉTICO en cajas de texto (coordenadas relativas, como las entrega pdf.js o el OCR).
 *
 * Reproduce solo la DISPOSICIÓN pública del formulario (dónde van las etiquetas numeradas y que los valores van debajo,
 * dígito por dígito); todos los valores —nombres, números, razón social— son inventados. Nunca copia datos de un
 * documento real.
 */

const W = 612;
const H = 792;
const TAM = 7;

/** Etiqueta del formulario: número, texto, posición x (pt) y línea base (pt, desde abajo). */
const ETIQUETAS: readonly [number, string, number, number][] = [
  [5, 'Número de Identificación Tributaria (NIT)', 27, 616], [6, 'DV', 185, 616], [12, 'Dirección seccional', 206, 616],
  [14, 'Buzón electrónico', 481, 616],
  [24, 'Tipo de contribuyente', 27, 581], [25, 'Tipo de documento', 186, 581], [26, 'Número de Identificación', 308, 581],
  [28, 'País', 114, 557], [29, 'Departamento', 218, 556], [30, 'Ciudad/Municipio', 407, 556],
  [31, 'Primer apellido', 27, 532], [32, 'Segundo apellido', 156, 532], [33, 'Primer nombre', 282, 532], [34, 'Otros nombres', 407, 532],
  [35, 'Razón social', 27, 508], [36, 'Nombre comercial', 27, 484], [37, 'Sigla', 346, 484],
  [38, 'País', 27, 448], [39, 'Departamento', 200, 447], [40, 'Ciudad/Municipio', 392, 448],
  [41, 'Dirección principal', 27, 424], [42, 'Correo electrónico', 27, 400], [43, 'Código postal', 27, 388],
  [44, 'Teléfono 1', 201, 388], [45, 'Teléfono 2', 398, 388],
  [46, 'Código', 37, 342], [47, 'Fecha inicio actividad', 83, 342], [48, 'Código', 171, 342], [49, 'Fecha inicio actividad', 217, 342],
];

export function caja(texto: string, xPt: number, basePt: number, confianza = 100, anchoPt?: number): CajaTexto {
  return {
    texto, x: xPt / W, y: (H - (basePt + TAM)) / H, ancho: (anchoPt ?? Math.max(4, texto.length * 3.6)) / W, alto: (TAM * 1.2) / H, confianza,
  };
}

export const digitosDe = (nit: string): string => `${nit}${Nit.calcularDigitoVerificacion(nit)}`;

export interface OpcionesRut {
  persona: 'natural' | 'juridica';
  fuente?: 'texto' | 'ocr';
  nit?: string;
  /** Sobrescribe el DV (para probar un DV incorrecto). */
  dv?: string;
  numeroDocumento?: string;
  apellidos?: [string, string];
  nombres?: [string, string];
  razonSocial?: string;
  dep?: string;
  mun?: string;
  ciiu?: string;
  /** dd-mm-aaaa */
  fecha?: string;
  /** Confianza de las palabras de nombre/razón social y de los dígitos (solo OCR). */
  confTexto?: number;
  confDigitos?: number;
  /** Confianza de las palabras de las etiquetas impresas (solo OCR); mueve la confianza media del documento. */
  confEtiquetas?: number;
  /** Etiquetas que «no se leyeron» (OCR) — se omiten. */
  sinEtiquetas?: number[];
  /** Rellena razón social en un RUT natural, o nombres en uno jurídico (señales contradictorias). */
  contradiccion?: boolean;
  /** Texto de la persona del campo 24; por defecto el que corresponde. */
  valor24?: string | null;
  /** Agrega dirección, correo y teléfono (que NO deben persistirse). */
  conContacto?: boolean;
}

export function rutSintetico(o: OpcionesRut): CajaTexto[] {
  const ocr = o.fuente === 'ocr';
  const cT = o.confTexto ?? 100;
  const cD = o.confDigitos ?? 100;
  const cE = o.confEtiquetas ?? 90;
  const natural = o.persona === 'natural';
  const nit = o.nit ?? (natural ? '1000000001' : '900123456');
  const dv = o.dv ?? String(Nit.calcularDigitoVerificacion(nit));
  const cajas: CajaTexto[] = [];
  const omitidas = new Set(o.sinEtiquetas ?? []);

  for (const [n, texto, x, base] of ETIQUETAS) {
    if (omitidas.has(n)) continue;
    if (ocr) {
      // El OCR entrega «24.» y cada palabra por separado.
      cajas.push(caja(`${n}.`, x, base, cE));
      texto.split(' ').forEach((p, i) => cajas.push(caja(p, x + 12 + i * 22, base, cE)));
    } else {
      cajas.push(caja(`${n}. ${texto}`, x, base, 100, 120));
    }
  }
  const dígitos = (valor: string, x0: number, base: number, paso = 11, conf = cD): void => {
    [...valor].forEach((d, i) => cajas.push(caja(d, x0 + i * paso, base, conf, 6)));
  };
  const palabras = (texto: string, x0: number, base: number, conf = cT): void => {
    let x = x0;
    for (const p of texto.split(' ')) {
      cajas.push(caja(p, x, base, conf));
      x += p.length * 5.4 + 6;
    }
  };

  // 5 y 6: NIT dígito a dígito (alineado a la derecha) y su DV.
  dígitos(nit, 185 - 8 - nit.length * 11 + 11, 604);
  dígitos(dv, 193, 604);

  const valor24 = o.valor24 === undefined ? (natural ? 'Persona natural o sucesión ilíquida' : 'Persona jurídica') : o.valor24;
  if (valor24) palabras(valor24, 27, 569);
  if (natural) {
    palabras('Cédula de Ciudadanía', 190, 569);
    dígitos('13', 260, 569);
    dígitos(o.numeroDocumento ?? nit, 340, 569);
  }
  if (natural || o.contradiccion) {
    palabras((o.apellidos ?? ['PEREZ', 'GOMEZ'])[0], 27, 520);
    palabras((o.apellidos ?? ['PEREZ', 'GOMEZ'])[1], 156, 520);
    palabras((o.nombres ?? ['MARIA', 'FERNANDA'])[0], 282, 520);
    palabras((o.nombres ?? ['MARIA', 'FERNANDA'])[1], 407, 520);
  }
  if (!natural || o.contradiccion) palabras(o.razonSocial ?? 'ACME DEMOSTRACION S.A.S.', 27, 496);
  // Nombre comercial (36) y sigla (37): campos que se dejan pasar sin leer.
  palabras('TIENDA DE PRUEBA', 27, 472);

  // 39/40: nombre y código del departamento y del municipio (UBICACIÓN).
  palabras('Departamento Demo', 205, 436);
  dígitos(o.dep ?? '25', 300, 436, 10);
  palabras('Municipio Demo', 397, 436);
  dígitos(o.mun ?? '290', 500, 436, 10);

  // 46: código de actividad (4 dígitos) y fecha de inicio de actividad, que comparten caja.
  dígitos(o.ciiu ?? '4711', 33, 330, 10.7);
  dígitos('20210101', 79, 330, 10);

  if (o.conContacto) {
    palabras('CALLE FALSA 123 SUR', 27, 412);
    palabras('persona.demo@ejemplo.test', 120, 388);
    dígitos('3000000000', 201, 376, 8);
  }
  // Pie: «Fecha generación documento PDF: dd-mm-aaaa hh:mm».
  const fecha = o.fecha ?? '15-03-2024';
  if (ocr) {
    ['Fecha', 'generación', 'documento', 'PDF:', fecha, '10:58:19AM'].forEach((t, i) => cajas.push(caja(t, 320 + i * 42, 18, /\d/.test(t) ? cD : cE)));
  } else {
    cajas.push(caja(`Fecha generación documento PDF: ${fecha} 10:58:19AM`, 320, 18, 100, 250));
  }
  return cajas;
}

/** Texto plano de unas cajas, solo para depurar una prueba. */
export const textoDe = (cajas: CajaTexto[]): string => cajas.map((c) => c.texto).join(' ');

// ── Puertos de lectura FALSOS (sin pdf.js, Tesseract ni ZXing): sirven cajas sintéticas y QR configurados ──


export function puertosRutSinteticos(paginas: { nativo: CajaTexto[] | null; ocr?: CajaTexto[] }[], qr: Record<number, string[]> = {}) {
  const renders: LimitesLecturaLocal[] = [];
  const lector: LectorDocumentoLocalPort = {
    extraerTextoNativo: async () => ({
      paginas: paginas.length,
      porPagina: paginas.map((p, i) => ({ pagina: i + 1, texto: p.nativo ? p.nativo.map((c) => c.texto).join(' ') : '' })),
    }),
    renderizarPagina: async (_c, pagina, limites) => { renders.push(limites); return { pagina, ancho: 10, alto: 10, imagen: Buffer.from([pagina]) }; },
    prepararImagen: async (_c, _m, limites) => { renders.push(limites); return { pagina: 1, ancho: 10, alto: 10, imagen: Buffer.from([1]) }; },
    detectarQr: async (imagen, pagina) => (qr[pagina ?? imagen[0]] ?? []).map((contenido) => ({ formato: 'QRCode', contenido, pagina, posicion: null })),
    ejecutarOcr: async () => ({ pagina: 1, texto: '', confianza: 0, giro: 0 }),
  };
  const geometria: GeometriaDocumentoPort = {
    cajasTextoNativo: async (_c, pagina) => paginas[pagina - 1].nativo ?? [],
    cajasOcr: async (imagen) => paginas[imagen[0] - 1]?.ocr ?? [],
    medirZonaFirma: async () => ({ legible: false, densidadTinta: 0, alturaRelativaTrazo: 0 }),
  };
  return { lector, geometria, renders };
}
