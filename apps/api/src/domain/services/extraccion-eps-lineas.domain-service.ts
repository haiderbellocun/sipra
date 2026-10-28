/**
 * Lectura del certificado de EPS POR LÍNEAS: complementa las reglas por frase de
 * `extraccion-eps-local` para los formatos que no escriben «Etiqueta: valor».
 *
 * Por qué hace falta. pdf.js entrega el texto en el orden en que el generador del PDF
 * dibujó cada fragmento, no en el orden de lectura, y el lector local deja cada
 * fragmento en su propia línea. En las tablas de los certificados reales las etiquetas
 * (TIPO Y NÚMERO DE IDENTIFICACIÓN, NOMBRES Y APELLIDOS…) quedan juntas en un bloque y
 * los valores en otro, así que el valor no está junto a su etiqueta. Además algunas
 * fuentes incrustadas traen mal el mapa de caracteres: la tilde sale como otro
 * carácter («AFILIACIYN», «generaci:n», «NZMERO»).
 *
 * Por eso aquí se reconoce el valor por SU FORMA (un tipo y un número de documento, un
 * nombre propio junto al documento, una palabra de estado, una fecha tras la etiqueta de
 * generación) y las etiquetas se buscan tolerando un carácter dañado donde iría una
 * tilde. Nada de esto depende de un emisor concreto. Lo que no se reconoce queda en
 * `null`; no se inventa.
 */

export interface HallazgoLinea {
  valor: string;
  evidencia: string;
}

export interface HallazgoDocumento extends HallazgoLinea {
  /** Línea donde está el documento: el nombre suele estar al lado. */
  indice: number;
}

export const FECHA_PATRON =
  '(\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+de\\s+[a-záéíóú]+\\s+de(?:l)?\\s+\\d{4})';

/** Minúsculas y sin tildes; conserva la longitud de cada línea. */
export const simple = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function limpias(crudas: readonly string[]): string[] {
  return crudas.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
}

/**
 * Líneas del texto. En el texto NATIVO que arma el lector, una línea vacía marca el final
 * de línea real del PDF y los fragmentos consecutivos sin línea vacía entre ellos
 * pertenecen a la misma línea visual (por ejemplo, palabra por palabra con un espacio
 * entre cada una). Si el texto no trae esa marca, o viene de OCR, cada línea es una línea.
 */
export function lineasVisuales(texto: string, nativo: boolean): string[] {
  const crudas = texto.split(/\r?\n/);
  if (!nativo || !crudas.includes('')) return limpias(crudas);
  const salida: string[] = [];
  let actual = '';
  for (const cruda of crudas) {
    if (cruda === '') {
      if (actual.trim()) salida.push(actual);
      actual = '';
    } else {
      actual += `${actual ? ' ' : ''}${cruda}`;
    }
  }
  if (actual.trim()) salida.push(actual);
  return limpias(salida);
}

const fechaRe = (): RegExp => new RegExp(FECHA_PATRON, 'i');

// ── Fecha de expedición / generación ────────────────────────────────────────

/** Solo etiquetas de EXPEDICIÓN: la fecha de ingreso a la EPS o de retiro no son la fecha del certificado. */
const ETIQUETA_GENERACION =
  /fecha\s+(?:y\s+hora\s+)?de\s+(?:generaci.n|expedici.n|emisi.n|impresi.n|elaboraci.n)|(?:generad[oa]|expedid[oa]|emitid[oa]|impres[oa])\s+(?:el|en)\b/;
const VENTANA_FECHA = 8;

export function fechaGeneracionPorLineas(lineas: readonly string[], norm: readonly string[]): HallazgoLinea | null {
  for (let i = 0; i < lineas.length; i += 1) {
    if (!ETIQUETA_GENERACION.test(norm[i])) continue;
    const mismaLinea = lineas[i].match(fechaRe());
    if (mismaLinea) return { valor: mismaLinea[1], evidencia: lineas[i].slice(0, 120) };
    for (let j = i + 1; j < Math.min(lineas.length, i + 1 + VENTANA_FECHA); j += 1) {
      // Otra fecha con su propia etiqueta (ingreso, retiro…): lo que sigue ya no es de esta etiqueta.
      if (/\bfecha\b/.test(norm[j]) && !ETIQUETA_GENERACION.test(norm[j])) break;
      const m = lineas[j].match(fechaRe());
      if (m) return { valor: m[1], evidencia: `${lineas[i]} … ${lineas[j]}`.slice(0, 120) };
    }
  }
  return null;
}

// ── Documento ───────────────────────────────────────────────────────────────

const TOKEN_DOCUMENTO = /^(c\.?\s?c\.?|t\.?\s?i\.?|c\.?\s?e\.?|r\.?\s?c\.?|p\.?\s?a\.?|nuip)\s*[:.#-]?\s*(\d[\d.\s]{3,14}\d)\s*[,.;]?$/i;
const FRASE_TIPO_DOCUMENTO =
  /^(?:c.dula(?:\s+de)?(?:\s+ciudadan.a)?|c.dula\s+de\s+extranjer.a|registro\s+civil(?:\s+de\s+nacimiento)?|tarjeta\s+de\s+identidad|pasaporte)\s*[:,]?$/;
const SOLO_NUMERO = /^(\d{1,3}(?:[.\s]\d{3}){1,3}|\d{5,12})\s*[,.;]?$/;
const ADYACENTES = [1, -1, 2, -2] as const;

const digitos = (s: string): number => s.replace(/\D/g, '').length;

export function documentoPorLineas(lineas: readonly string[], norm: readonly string[]): HallazgoDocumento | null {
  for (let i = 0; i < lineas.length; i += 1) {
    const m = lineas[i].match(TOKEN_DOCUMENTO);
    if (m && digitos(m[2]) >= 5 && digitos(m[2]) <= 12) {
      return { valor: `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim(), evidencia: lineas[i].slice(0, 120), indice: i };
    }
  }
  // El tipo escrito con palabras («REGISTRO CIVIL») en una línea cercana al número.
  for (let i = 0; i < lineas.length; i += 1) {
    const n = lineas[i].match(SOLO_NUMERO);
    if (!n || digitos(n[1]) < 5 || digitos(n[1]) > 12) continue;
    for (const d of ADYACENTES) {
      const k = i + d;
      if (k >= 0 && k < lineas.length && FRASE_TIPO_DOCUMENTO.test(norm[k])) {
        return { valor: `${lineas[k].replace(/[:,]$/, '')} ${n[1]}`, evidencia: `${lineas[k]} ${n[1]}`.slice(0, 120), indice: i };
      }
    }
  }
  return null;
}

// ── Nombre ──────────────────────────────────────────────────────────────────

const PARTICULAS_NOMBRE: ReadonlySet<string> = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'van', 'von', 'da']);
/** Vocabulario de etiquetas y de encabezados: si una línea lo contiene, no es el nombre de una persona. */
const NO_ES_NOMBRE = new RegExp(
  '\\b(?:certifica\\w*|afilia\\w*|eps|salud|plan|beneficio\\w*|entidad|documento|n.mero|identific\\w*|estado|tipo|fecha|r.gimen|'
  + 'cotizante|beneficiari[oa]|parentesco|cobertura|integral|vigente|activ[oa]|inactiv[oa]|c.dula|ciudadan.a|registro|civil|tarjeta|'
  + 'identidad|pasaporte|extranjer.a|empleador\\w*|semanas|direcci.n|generaci.n|ingreso|retiro|causa|derecho|medicina|prepagada|'
  + 'caja|compensaci.n|familiar|programa|ltda|nit|republica|colombia|ministerio|superintendencia|hijo|hija|conyuge)\\b|\\bs\\.?\\s?a\\.?s?\\b',
);

export function pareceNombre(linea: string): boolean {
  if (/[0-9@:;()/,_]/.test(linea)) return false;
  const tokens = linea.split(' ');
  if (tokens.length < 2 || tokens.length > 7) return false;
  if (!tokens.every((t) => /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+$/.test(t))) return false;
  const significativos = tokens.filter((t) => !PARTICULAS_NOMBRE.has(simple(t)));
  if (significativos.length < 2) return false;
  const todoMayusculas = linea === linea.toUpperCase();
  const tituloPropio = significativos.every((t) => /^[A-ZÁÉÍÓÚÑÜ]/.test(t));
  if (!todoMayusculas && !tituloPropio) return false;
  return !NO_ES_NOMBRE.test(simple(linea));
}

const ETIQUETA_NOMBRE =
  /^(?:nombres?\s+y\s+apellidos|apellidos\s+y\s+nombres|nombres?(?:\s+completos?)?(?:\s+del\s+(?:afiliad[oa]|usuari[oa]|cotizante|beneficiari[oa]|titular))?|afiliad[oa]|usuari[oa])\s*:?\s*(.*)$/;

export function nombrePorLineas(
  lineas: readonly string[], norm: readonly string[], indiceDocumento: number | null,
): HallazgoLinea | null {
  // 1. Etiqueta de nombre con su valor en la misma línea o en la siguiente.
  for (let i = 0; i < lineas.length; i += 1) {
    const m = norm[i].match(ETIQUETA_NOMBRE);
    if (!m) continue;
    const resto = m[1] ? lineas[i].slice(lineas[i].length - m[1].length).trim() : '';
    if (resto && pareceNombre(resto)) return { valor: resto, evidencia: lineas[i].slice(0, 120) };
    if (!resto && i + 1 < lineas.length && pareceNombre(lineas[i + 1])) {
      return { valor: lineas[i + 1], evidencia: `${lineas[i]} ${lineas[i + 1]}`.slice(0, 120) };
    }
  }
  // 2. Junto al documento: en las tablas y en los textos desordenados el nombre queda al lado del número.
  if (indiceDocumento !== null) {
    for (const d of [1, -1]) {
      const k = indiceDocumento + d;
      if (k >= 0 && k < lineas.length && pareceNombre(lineas[k])) {
        return { valor: lineas[k], evidencia: `${lineas[Math.min(k, indiceDocumento)]} ${lineas[Math.max(k, indiceDocumento)]}`.slice(0, 120) };
      }
    }
  }
  return null;
}

// ── Estado y tipo de afiliado ───────────────────────────────────────────────

const VALOR_ESTADO = /^(?:afiliad[oa]\s+)?(?:no\s+)?(?:vigente|activ[oa]|inactiv[oa]|suspendid[oa]|retirad[oa]|cancelad[oa]|terminad[oa])$/;
const ETIQUETA_ESTADO = /^estado(?:\s+de\s+(?:la\s+)?afiliaci.n)?\s*:?\s*(.*)$/;
const VALOR_TIPO_AFILIADO =
  /^(?:cotizante(?:\s+(?:dependiente|independiente|activo))?|beneficiari[oa]|adicional|pensionad[oa]|afiliad[oa]\s+(?:cotizante|beneficiari[oa]))$/;
const ETIQUETA_TIPO_AFILIADO = /^(?:tipo\s+(?:de\s+)?afiliad[oa]|tipo\s+de\s+afiliaci.n|calidad(?:\s+de\s+afiliad[oa])?)\s*:?\s*(.*)$/;

function valorEtiquetado(
  lineas: readonly string[], norm: readonly string[], etiqueta: RegExp, valor: RegExp,
): HallazgoLinea | null {
  for (let i = 0; i < lineas.length; i += 1) {
    const m = norm[i].match(etiqueta);
    if (!m) continue;
    if (m[1] && valor.test(m[1].trim())) {
      return { valor: lineas[i].slice(lineas[i].length - m[1].trim().length).trim(), evidencia: lineas[i].slice(0, 120) };
    }
    if (!m[1] && i + 1 < lineas.length && valor.test(norm[i + 1])) {
      return { valor: lineas[i + 1], evidencia: `${lineas[i]} ${lineas[i + 1]}`.slice(0, 120) };
    }
  }
  return null;
}

function valorSuelto(lineas: readonly string[], norm: readonly string[], valor: RegExp): HallazgoLinea | null {
  const i = norm.findIndex((l) => valor.test(l));
  return i >= 0 ? { valor: lineas[i], evidencia: lineas[i].slice(0, 120) } : null;
}

export function estadoPorLineas(lineas: readonly string[], norm: readonly string[]): HallazgoLinea | null {
  return valorEtiquetado(lineas, norm, ETIQUETA_ESTADO, VALOR_ESTADO) ?? valorSuelto(lineas, norm, VALOR_ESTADO);
}

export function tipoAfiliadoPorLineas(lineas: readonly string[], norm: readonly string[]): HallazgoLinea | null {
  return valorEtiquetado(lineas, norm, ETIQUETA_TIPO_AFILIADO, VALOR_TIPO_AFILIADO) ?? valorSuelto(lineas, norm, VALOR_TIPO_AFILIADO);
}
