import { LimitesLecturaLocal } from './lector-documento-local.port';

/**
 * Geometría LOCAL de una página: dónde está el texto y cuánta tinta hay en una zona.
 * Complementa a `LectorDocumentoLocalPort` sin cambiarlo (EPS no lo usa). Todo ocurre dentro del
 * proceso, sobre imágenes en memoria: ningún documento sale a un tercero.
 */

/** Rectángulo en coordenadas RELATIVAS a la página (0–1), origen arriba a la izquierda. */
export interface RectRelativo {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface CajaTexto extends RectRelativo {
  texto: string;
  /** 0–100. El texto digital es 100; el OCR reporta la confianza de su motor. */
  confianza: number;
}

/** Medición de una zona de firma sobre la página rasterizada (la interpreta el dominio). */
export interface MedicionZona {
  /** La zona se pudo analizar de forma fiable (dentro de la página, resolución y contraste suficientes, sin ruido dominante). */
  legible: boolean;
  /** Proporción de tinta de la zona, sin la línea del formulario, el texto impreso ni el ruido. 0–1. */
  densidadTinta: number;
  /** Alto del trazo respecto del alto de la zona. Una línea recta mide cerca de 0. 0–1. */
  alturaRelativaTrazo: number;
}

export interface GeometriaDocumentoPort {
  /** Cajas del texto digital de UNA página. Página rotada o sin texto: lista vacía. */
  cajasTextoNativo(contenido: Buffer, pagina: number, limites: LimitesLecturaLocal): Promise<CajaTexto[]>;

  /** Cajas de las palabras que el OCR reconoce en una imagen de página (PNG). Sin OCR disponible: lista vacía. */
  cajasOcr(imagen: Buffer, limites: LimitesLecturaLocal): Promise<CajaTexto[]>;

  /**
   * Tinta «de más» en `zona`: descarta líneas rectas del formulario, bordes, las `exclusiones` (texto impreso) y el
   * ruido de motas. No distingue de quién es un trazo ni si es válido.
   */
  medirZonaFirma(
    imagen: Buffer, zona: RectRelativo, exclusiones: readonly RectRelativo[], limites: LimitesLecturaLocal,
  ): Promise<MedicionZona>;
}
export const GEOMETRIA_DOCUMENTO = Symbol('GEOMETRIA_DOCUMENTO');
