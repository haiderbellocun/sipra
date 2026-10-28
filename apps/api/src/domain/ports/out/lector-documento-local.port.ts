/**
 * Lectura documental LOCAL: texto nativo, rasterización, códigos QR y OCR.
 *
 * El dominio y la aplicación dependen de este puerto, no de pdf.js, ZXing ni
 * Tesseract. Todo se ejecuta dentro del proceso: ninguna operación de este
 * puerto hace llamadas de red ni envía el documento a un tercero.
 */

/** Cota de recursos de una lectura. Los valores por tipo documental viven en el dominio. */
export interface LimitesLecturaLocal {
  /** Páginas que se leen (texto, QR y OCR). Lo demás se ignora y se avisa. */
  maxPaginas: number;
  /** Un PDF con más páginas que esto ni se abre para leer: pasa a revisión humana. */
  maxPaginasDocumento: number;
  /** Píxeles máximos de una página rasterizada o de una imagen de entrada. */
  maxPixeles: number;
  /** Factor de rasterización (1 = 72 dpi). */
  escalaRender: number;
  /** Tiempo máximo de cada operación pesada (render u OCR de una página), en ms. */
  timeoutMs: number;
}

export interface TextoNativoPagina {
  /** Número de página, desde 1. */
  pagina: number;
  texto: string;
}

export interface ResultadoTextoNativo {
  /** Páginas del documento (todas, no solo las leídas). */
  paginas: number;
  /** Texto de las páginas leídas, en orden. */
  porPagina: TextoNativoPagina[];
}

export interface PaginaRenderizada {
  pagina: number;
  ancho: number;
  alto: number;
  /** PNG en memoria. No se persiste. */
  imagen: Buffer;
}

export interface HallazgoQrCrudo {
  formato: string;
  /** DATO NO CONFIABLE: se clasifica, no se sigue. */
  contenido: string;
  /** Página (PDF) o null (imagen). */
  pagina: number | null;
  /** Esquina superior izquierda y tamaño aproximado dentro de la imagen, si se conoce. */
  posicion: { x: number; y: number; ancho: number; alto: number } | null;
}

export interface ResultadoOcrPagina {
  pagina: number | null;
  texto: string;
  /** Confianza media reportada por el motor, 0-100. */
  confianza: number;
  /** Giro aplicado a la imagen para poder leerla (0, 90, 180, 270). */
  giro: number;
}

export type OrigenImagen = 'imagen' | 'pdf';

/**
 * Estrategia de OCR, de la más barata a la más costosa (determinística: siempre en este orden):
 * - `automatica`: la imagen tal cual, segmentación automática (con su respaldo de contraste y giros si sale muy pobre).
 * - `bloque`: la misma imagen como un bloque uniforme de texto (cartas con párrafos y datos sueltos).
 * - `reforzada`: grises con contraste, ampliada 1,5× y segmentación por columnas.
 */
export type VarianteOcr = 'automatica' | 'bloque' | 'reforzada';
export const VARIANTES_OCR: readonly VarianteOcr[] = ['automatica', 'bloque', 'reforzada'];

export interface LectorDocumentoLocalPort {
  /** Texto de la capa nativa de un PDF. Lanza `DocumentoLocalIlegibleError` si el archivo no se puede abrir. */
  extraerTextoNativo(contenido: Buffer, limites: LimitesLecturaLocal): Promise<ResultadoTextoNativo>;

  /** Rasteriza UNA página de un PDF con las cotas indicadas (sin conservarla). */
  renderizarPagina(contenido: Buffer, pagina: number, limites: LimitesLecturaLocal): Promise<PaginaRenderizada>;

  /** Imagen de entrada (PNG/JPEG), validada y normalizada a PNG dentro de las cotas. */
  prepararImagen(contenido: Buffer, mime: string, limites: LimitesLecturaLocal): Promise<PaginaRenderizada>;

  /** QR de una imagen rasterizada. NO abre ni resuelve su contenido. */
  detectarQr(imagen: Buffer, pagina: number | null): Promise<HallazgoQrCrudo[]>;

  /** OCR local de una imagen, con modelo de idioma empaquetado. Sin `variante`, la automática. */
  ejecutarOcr(imagen: Buffer, pagina: number | null, limites: LimitesLecturaLocal, variante?: VarianteOcr): Promise<ResultadoOcrPagina>;
}
export const LECTOR_DOCUMENTO_LOCAL = Symbol('LECTOR_DOCUMENTO_LOCAL');

/** El archivo no se puede abrir como lo que dice ser (PDF truncado, imagen corrupta). */
export class DocumentoLocalIlegibleError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'DocumentoLocalIlegibleError';
  }
}

/** La lectura excede una cota (páginas, píxeles, tiempo). Falla cerrado: revisión humana. */
export class LimiteLecturaLocalError extends Error {
  constructor(public readonly limite: 'paginas' | 'pixeles' | 'tiempo', motivo: string) {
    super(motivo);
    this.name = 'LimiteLecturaLocalError';
  }
}

// ── Resumen de una lectura (se guarda junto a la extracción) ────────────────

/** Un QR hallado, ya clasificado. Nunca incluye el contenido completo ni parámetros de URL. */
export interface HallazgoQrRegistrado {
  formato: string;
  pagina: number | null;
  posicion: { x: number; y: number; ancho: number; alto: number } | null;
  tipo: 'url' | 'texto' | 'otro';
  longitud: number;
  /** SHA-256 del contenido completo. */
  hash: string;
  /** Solo URL: protocolo, host y ruta sin usuario, parámetros ni fragmento. */
  origenSanitizado: string | null;
  host: string | null;
  tieneParametros: boolean;
  senales: string[];
}

/**
 * Qué hizo la lectura local, sin el contenido del documento: métricas, QR
 * clasificados, discrepancias entre fuentes y límites aplicados.
 */
export interface ResumenLecturaLocal {
  textoNativo: {
    paginas: number;
    paginasLeidas: number;
    paginasConTexto: number;
    caracteres: number;
    utilizable: boolean;
  } | null;
  ocr: {
    ejecutado: boolean; paginas: number[]; confianzaMedia: number | null; giros: number[];
    /** Cuántas pasadas de OCR hizo falta dar (1 = la primera bastó). */
    intentos?: number;
    /** Cuántos campos clave salieron del OCR: 0–1 insuficiente, 2 débil, 3 o más procesable. */
    suficiencia?: 'insuficiente' | 'debil' | 'procesable';
  };
  qr: { paginasEscaneadas: number; hallazgos: HallazgoQrRegistrado[] };
  /**
   * ¿Qué tipo de documento parece ser, por su CONTENIDO? Solo el veredicto y códigos de motivo, nunca texto del documento.
   * `no_determinable` = no se pudo leer o no alcanza; NO significa «no es un certificado de EPS».
   */
  clasificacion?: {
    tipo: 'certificado_eps_probable' | 'documento_incorrecto' | 'no_determinable';
    motivos: string[]; puntajeEps: number; puntajeOtro: number;
  };
  /** Campos cuyo valor difiere entre fuentes (texto nativo vs OCR). Sin los valores. */
  discrepanciasFuentes: { campo: string; fuentes: string[] }[];
  /** `paginas_omitidas`, `documento_excede_paginas`, `pagina_excede_pixeles`, `tiempo_agotado`… */
  limitesAplicados: string[];
  /** Fallos parciales (código, sin mensaje del documento). */
  errores: string[];
  duracionMs: number;
}
