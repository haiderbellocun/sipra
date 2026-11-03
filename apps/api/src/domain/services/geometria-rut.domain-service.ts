import { CajaTexto } from '../ports/out/geometria-documento.port';
import { normalizarTexto } from './normalizacion-identidad';

/**
 * Lectura del formulario RUT por GEOMETRÍA (posiciones), no por orden de texto.
 *
 * El RUT trae etiquetas numeradas en posiciones fijas («24. Tipo de contribuyente»), los valores debajo de cada
 * etiqueta y los números dígito por dígito. Leerlo como texto lineal desordena todo; aquí cada campo se busca en la
 * región que le corresponde: bajo su etiqueta, entre su columna y la siguiente de la misma fila, y por encima de la
 * fila siguiente. La estrategia «etiqueta → valor siguiente» NO se usa.
 *
 * Funciona sobre cajas de texto nativo (pdf.js) y de OCR (Tesseract): el mismo anclaje, con umbrales más estrictos
 * para el OCR. Coordenadas relativas a la página (0–1, origen arriba a la izquierda). Función pura, sin red.
 *
 * Nada de lo que se lee aquí es una decisión: el consumidor valida (DV, estructura) y decide qué conserva.
 */

export type FuenteCajas = 'texto' | 'ocr';

/** Número de etiqueta del formulario → primera palabra esperada (descarta números sueltos que no son etiquetas). */
const PRIMERA_PALABRA: Readonly<Record<number, string>> = {
  // Campos que se leen:
  5: 'NUMERO', 6: 'DV', 24: 'TIPO', 25: 'TIPO', 26: 'NUMERO', 31: 'PRIMER', 32: 'SEGUNDO', 33: 'PRIMER',
  34: 'OTROS', 35: 'RAZON', 39: 'DEPARTAMENTO', 40: 'CIUDAD', 46: 'CODIGO', 47: 'FECHA', 48: 'CODIGO', 49: 'FECHA',
  // Campos que NO se leen, pero delimitan las filas (sin ellos sus valores se colarían en la región de los de arriba):
  12: 'DIRECCION', 14: 'BUZON', 27: 'FECHA', 28: 'PAIS', 29: 'DEPARTAMENTO', 30: 'CIUDAD', 36: 'NOMBRE', 37: 'SIGLA',
  38: 'PAIS', 41: 'DIRECCION', 42: 'CORREO', 43: 'CODIGO', 44: 'TELEFONO', 45: 'TELEFONO',
};

const CAMPOS_LEIDOS: ReadonlySet<number> = new Set([5, 6, 24, 25, 26, 31, 32, 33, 34, 35, 39, 40, 46]);

const PX = 1 / 612; // un punto tipográfico en ancho de página
const PY = 1 / 792; // …y en alto

/** Margen izquierdo de la región de un valor respecto de su etiqueta (los dígitos arrancan un poco antes). */
const MARGEN_IZQ = 6 * PX;
/** Margen derecho (antes de la etiqueta siguiente de la fila). Código y fecha de actividad comparten caja: 5 pt. */
const MARGEN_DER: Readonly<Record<number, number>> = { 46: 5 * PX, 48: 5 * PX };
const MARGEN_DER_DEFECTO = 2 * PX;
/** Los valores quedan al menos esto por encima de la línea base de la etiqueta de la fila siguiente. */
const SEPARACION_FILA = 9 * PY;

interface Etiqueta {
  n: number;
  x: number;
  /** Línea base estimada. */
  base: number;
}

export interface CampoGeometrico {
  /** Cajas del valor, en orden de lectura (arriba→abajo, izquierda→derecha). */
  cajas: readonly CajaTexto[];
  texto: string;
  /** Solo los dígitos, en orden. */
  digitos: string;
  /** Confianza mínima de las cajas (0–1). Texto digital = 1. */
  confianza: number;
}

export interface CamposRutGeometricos {
  /** Números de etiqueta localizados (diagnóstico; el consumidor decide si alcanzan). */
  etiquetas: number[];
  campos: Partial<Record<number, CampoGeometrico>>;
}

const baseDe = (c: CajaTexto): number => c.y + c.alto * 0.83;

function palabraInicial(texto: string): string {
  return normalizarTexto(texto).replace(/^[^A-Z0-9]+/, '').split(/[^A-Z0-9]/)[0] ?? '';
}

function localizarEtiquetas(cajas: readonly CajaTexto[], fuente: FuenteCajas): Etiqueta[] {
  const etiquetas: Etiqueta[] = [];
  const tolFila = fuente === 'texto' ? 3 * PY : 8 * PY;
  for (const c of cajas) {
    const texto = c.texto.trim();
    // Nativo: «24. Tipo de contribuyente» en una caja. OCR: «24.» (o «24») y la palabra siguiente aparte.
    const m = texto.match(/^(\d{1,2})\.\s*(.*)$/) ?? (fuente === 'ocr' ? texto.match(/^(\d{1,2})()$/) : null);
    if (!m) continue;
    const n = Number(m[1]);
    const esperada = PRIMERA_PALABRA[n];
    if (!esperada) continue;
    let siguiente = m[2] ? palabraInicial(m[2]) : '';
    if (!siguiente) {
      const vecina = cajas
        .filter((o) => o !== c && Math.abs(baseDe(o) - baseDe(c)) <= tolFila && o.x >= c.x && o.x - (c.x + c.ancho) < 0.05)
        .sort((a, b) => a.x - b.x)[0];
      siguiente = vecina ? palabraInicial(vecina.texto) : '';
    }
    if (siguiente !== esperada) continue;
    etiquetas.push({ n, x: c.x, base: baseDe(c) });
  }
  // Una misma etiqueta no debe aparecer dos veces: se conserva la más alta de la página.
  const unicas = new Map<number, Etiqueta>();
  for (const e of etiquetas.sort((a, b) => a.base - b.base)) if (!unicas.has(e.n)) unicas.set(e.n, e);
  return [...unicas.values()];
}

/** Región de cada campo: debajo de su etiqueta, en su columna y por encima de la fila siguiente. */
export function leerCamposRutPorGeometria(cajas: readonly CajaTexto[], fuente: FuenteCajas): CamposRutGeometricos {
  const etiquetas = localizarEtiquetas(cajas, fuente);
  const tolFila = fuente === 'texto' ? 3 * PY : 8 * PY;
  // El OCR lee las palabras de la etiqueta con la línea base algo corrida: el valor empieza claramente más abajo.
  const minDebajo = fuente === 'texto' ? 1 * PY : 5 * PY;
  const esNumeroDeEtiqueta = (c: CajaTexto): boolean =>
    /^\d{1,2}\.\s*\S/.test(c.texto.trim())
    || (fuente === 'ocr' && /^\d{1,2}\.?$/.test(c.texto.trim()) && etiquetas.some((e) => Math.abs(e.x - c.x) < 0.004 && Math.abs(e.base - baseDe(c)) < 0.004));
  const campos: Partial<Record<number, CampoGeometrico>> = {};

  for (const L of etiquetas) {
    // Dirección, correo y teléfono delimitan filas, pero su valor NO se arma ni se conserva.
    if (!CAMPOS_LEIDOS.has(L.n)) continue;
    const enLaFila = etiquetas.filter((o) => o !== L && Math.abs(o.base - L.base) <= tolFila && o.x > L.x + 5 * PX).sort((a, b) => a.x - b.x);
    const xMin = L.n === 6 ? L.x + 3 * PX : L.x - MARGEN_IZQ;
    const xMax = enLaFila.length ? enLaFila[0].x - (MARGEN_DER[L.n] ?? MARGEN_DER_DEFECTO) : 1;
    const siguiente = etiquetas.filter((o) => o.base > L.base + 4 * PY).sort((a, b) => a.base - b.base)[0];
    const cajasValor = cajas.filter((c) => {
      if (esNumeroDeEtiqueta(c)) return false;
      const base = baseDe(c);
      if (!(base > L.base + minDebajo)) return false;
      if (siguiente && !(base <= siguiente.base - SEPARACION_FILA)) return false;
      if (!siguiente && base > L.base + 30 * PY) return false;
      return c.x >= xMin && c.x < xMax;
    }).sort((a, b) => (Math.abs(baseDe(a) - baseDe(b)) > tolFila ? baseDe(a) - baseDe(b) : a.x - b.x));
    if (cajasValor.length === 0) continue;
    const texto = cajasValor.map((c) => c.texto.trim()).join(' ').replace(/\s+/g, ' ').trim();
    campos[L.n] = {
      cajas: cajasValor, texto, digitos: texto.replace(/\D/g, ''),
      confianza: Math.min(...cajasValor.map((c) => Math.max(0, Math.min(1, c.confianza / 100)))),
    };
  }
  return { etiquetas: etiquetas.map((e) => e.n).sort((a, b) => a - b), campos };
}

// ── Fecha de generación (texto de toda la página, no una región) ───────────────

/**
 * «Fecha generación documento PDF: dd-mm-aaaa hh:mm». Se arma el texto por filas. Devuelve AAAA-MM-DD o `null`.
 * Es un dato INFORMATIVO: no implica vigencia ni vencimiento.
 */
export function leerFechaGeneracionRut(cajas: readonly CajaTexto[]): { fecha: string; confianza: number } | null {
  const ordenadas = [...cajas].sort((a, b) => (Math.abs(baseDe(a) - baseDe(b)) > 4 * PY ? baseDe(a) - baseDe(b) : a.x - b.x));
  const texto = normalizarTexto(ordenadas.map((c) => c.texto).join(' '));
  const m = texto.match(/FECHA GENERACION DOCUMENTO PDF\s*:?\s*(\d{2})\s*[-/]\s*(\d{2})\s*[-/]\s*(\d{4})/);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && a >= 2000 && a <= 2100)) return null;
  const fecha = new Date(Date.UTC(a, mes - 1, d));
  if (fecha.getUTCDate() !== d || fecha.getUTCMonth() !== mes - 1) return null; // 31 de febrero, etc.
  // Confianza = la de las cajas que contienen LOS DÍGITOS DE LA FECHA (no la hora ni el resto de la línea).
  const digitosFecha = `${m[1]}${m[2]}${m[3]}`;
  const iEtiqueta = Math.max(0, ordenadas.findIndex((c) => /GENERACION/.test(normalizarTexto(c.texto))));
  const involucradas = ordenadas.slice(iEtiqueta).filter((c) => {
    const d = c.texto.replace(/\D/g, '');
    // OCR: la fecha repartida en palabras (cada una contiene parte de sus dígitos). Texto digital: una sola caja que la contiene.
    return d.length >= 2 && (digitosFecha.includes(d) || d.includes(digitosFecha));
  });
  const conf = involucradas.length ? Math.min(...involucradas.slice(0, 3).map((c) => c.confianza / 100)) : 0;
  return { fecha: `${String(a).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, confianza: Math.max(0, Math.min(1, conf)) };
}
