import {
  FECHA_PATRON, documentoPorLineas, estadoPorLineas, fechaGeneracionPorLineas, lineasVisuales, nombrePorLineas, simple,
  tipoAfiliadoPorLineas,
} from './extraccion-eps-lineas.domain-service';
import {
  compararDocumentos, compararNombres, mismaEps, normalizarTexto,
} from './normalizacion-identidad';

/**
 * Extracción estructurada del certificado de EPS a partir de TEXTO (nativo u
 * OCR), con reglas locales. Sin IA, sin red. Lo que no se encuentra queda en
 * `null`: no se inventa. Cada campo conserva de qué fuente salió.
 */

export type FuenteCampo = 'texto_nativo' | 'ocr' | 'qr';

export interface CampoEpsLeido {
  valor: string | null;
  confianza: number;
  evidencia: string | null;
  fuente: FuenteCampo | null;
}

export type CamposEpsLeidos = Record<string, CampoEpsLeido>;

export const CAMPOS_EPS = [
  'entidad_emisora', 'nombre_afiliado', 'documento_afiliado',
  'fecha_expedicion', 'estado_afiliacion', 'regimen', 'tipo_afiliado',
] as const;

/** Sin estos no hay comparación de identidad: si faltan en el texto nativo, se intenta OCR en páginas sin texto. */
export const CAMPOS_CLAVE_EPS: readonly string[] = ['nombre_afiliado', 'documento_afiliado', 'entidad_emisora', 'fecha_expedicion'];

export const CONFIANZA_TEXTO_NATIVO = 0.92;
/** Techo de la confianza de un campo leído por OCR: nunca iguala al texto digital. */
export const CONFIANZA_MAXIMA_OCR = 0.85;

const NOMBRE = "[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'.]*(?:\\s+[A-ZÁÉÍÓÚÑÜa-záéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü'.]*){1,6}";
const FECHA = FECHA_PATRON;

const sinValor = (): CampoEpsLeido => ({ valor: null, confianza: 0, evidencia: null, fuente: null });

function limpiar(valor: string): string {
  return valor.replace(/\s+/g, ' ').replace(/^[\s:.\-–]+|[\s:.\-–,;]+$/g, '').trim();
}

/** Corta el valor donde empieza otra etiqueta en la misma línea («… Documento: …»). */
function hastaOtraEtiqueta(valor: string): string {
  return valor.split(/\s{2,}|\s(?=[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}(?:\s+[a-záéíóúñ]+){0,3}\s*:)/)[0];
}

function lineasDe(texto: string): string[] {
  return texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
}

function primera(texto: string, patrones: readonly RegExp[], grupo = 1): { valor: string; evidencia: string } | null {
  for (const patron of patrones) {
    const m = texto.match(patron);
    if (m?.[grupo]) return { valor: m[grupo], evidencia: m[0].slice(0, 120) };
  }
  return null;
}

function documentoDe(texto: string): { valor: string; evidencia: string } | null {
  const TIPO = '(?:(?:c\\.?\\s?c\\.?|t\\.?\\s?i\\.?|c\\.?\\s?e\\.?|r\\.?\\s?c\\.?|p\\.?\\s?a\\.?|c[ée]dula(?:\\s+(?:de\\s+)?(?:ciudadan[ií]a|extranjer[ií]a))?|registro\\s+civil|tarjeta\\s+de\\s+identidad|pasaporte)[\\s.:°ºno]*)?';
  // El número puede ir precedido de «No.», «N°», «Nro.» o «número».
  const NUM = '(?:(?:n[úu]mero|n[°º]|nro\\.?|no\\.)\\s*:?\\s*)?(\\d[\\d.,\\s]{4,16}\\d)';
  const hallado = primera(texto, [
    new RegExp(`identificad[oa]\\s*\\(?a?\\)?\\s*con\\s+(${TIPO}${NUM})`, 'i'),
    new RegExp(`(?:n[úu]mero\\s+(?:de\\s+)?(?:documento|identificaci[oó]n|c[ée]dula)|documento(?:\\s+de\\s+identidad)?|identificaci[oó]n|c[ée]dula(?:\\s+de\\s+ciudadan[ií]a)?)\\s*[:\\-]?\\s*(${TIPO}${NUM})`, 'i'),
    new RegExp(`\\b(c\\.?\\s?c\\.?\\s*[:.]?\\s*${NUM})`, 'i'),
  ]);
  // Los saltos de línea entre fragmentos de un mismo valor («Cedula» / «Ciudadania» / «123») no separan campos.
  return hallado ? { valor: limpiar(hastaOtraEtiqueta(hallado.valor.replace(/\s*\n\s*/g, ' '))), evidencia: hallado.evidencia } : null;
}

/** Tratamientos que preceden al nombre en «Que el(la) señor(a) …»; el OCR a veces los deja con un paréntesis suelto. */
const TRATAMIENTO = /[()]|^(?:el|la|se[ñn]or(?:a)?|sr\.?a?|usuari[oa]|afiliad[oa]|\W+)$/i;

function sinTratamiento(nombre: string): string {
  const palabras = nombre.split(/\s+/);
  while (palabras.length > 2 && TRATAMIENTO.test(palabras[0])) palabras.shift();
  return palabras.join(' ');
}

function nombreDe(texto: string): { valor: string; evidencia: string } | null {
  const frase = texto.match(new RegExp(
    `que\\s*:?\\s*(?:el(?:\\s*\\(la\\))?|la)?\\s*(?:se[ñn]or(?:\\s*\\(a\\)|a)?|sr\\.?a?|usuari[oa]|afiliad[oa])?\\s*\\(?a?\\)?\\s*(${NOMBRE})\\s*,?\\s*identificad[oa]`, 'i'));
  if (frase?.[1] && !/\d/.test(frase[1])) return { valor: limpiar(sinTratamiento(frase[1])), evidencia: frase[0].slice(0, 120) };
  // «… CERTIFICA QUE:\nEl(La) Señor(a) NOMBRE identificado(a) con CC …»: lo que antecede a «identificado», sin el tratamiento.
  const previo = texto.match(new RegExp(`certifica[^\\n]{0,8}\\n?\\s*([^\\n]{0,40}?)(${NOMBRE})\\s*,?\\s*identificad[oa]`, 'i'));
  if (previo?.[2]) {
    const valor = limpiar(sinTratamiento(`${previo[1] ?? ''}${previo[2]}`.replace(/\s+/g, ' ')));
    if (!/\d/.test(valor) && valor.split(' ').length >= 2) return { valor, evidencia: previo[0].replace(/\s+/g, ' ').slice(0, 120) };
  }
  const etiquetado = texto.match(new RegExp(
    `(?:apellidos\\s+y\\s+nombres|nombres?\\s+y\\s+apellidos|nombre(?:s)?(?:\\s+completo)?(?:\\s+del\\s+(?:afiliado|usuario|cotizante|beneficiario|titular))?|afiliado|usuario|cotizante|titular)\\s*[:\\-]\\s*([^\\n:]{5,90})`, 'i'));
  if (etiquetado?.[1]) {
    const valor = limpiar(hastaOtraEtiqueta(etiquetado[1]));
    if (!/\d/.test(valor) && valor.split(' ').length >= 2) return { valor, evidencia: etiquetado[0].slice(0, 120) };
  }
  return null;
}

function entidadDe(texto: string): { valor: string; evidencia: string } | null {
  const etiquetada = texto.match(/(?:entidad(?:\s+promotora\s+de\s+salud)?|eps)\s*[:-]\s*([^\n:]{3,80})/i);
  if (etiquetada?.[1]) {
    const valor = limpiar(hastaOtraEtiqueta(etiquetada[1]));
    if (valor.length >= 3) return { valor, evidencia: etiquetada[0].slice(0, 120) };
  }
  // Encabezado: la primera línea corta que nombra una EPS. Una línea que es SOLO «EPS» es el final del logotipo partido
  // en dos («Alian Salud» / «EPS»): se une con la anterior en lugar de devolver «eps».
  const cabecera = lineasDe(texto).slice(0, 15);
  for (const [i, linea] of cabecera.entries()) {
    // Una frase («se encuentra afiliado(a) a nuestra EPS») no es el nombre de la entidad.
    if (linea.length > 90 || linea.includes(':') || /^certific/i.test(linea) || /\b(?:se\s+encuentra|afiliad[oa]|nuestr[oa]|solicitud)\b/i.test(linea)) continue;
    if (/^e\.?p\.?s\.?$/i.test(linea)) {
      const anterior = cabecera[i - 1];
      if (anterior && /^[A-Za-zÁÉÍÓÚÑáéíóúñ ]{4,40}$/.test(anterior) && !/^certific/i.test(anterior)) {
        return { valor: `${limpiar(anterior)} EPS`, evidencia: `${anterior} ${linea}`.slice(0, 120) };
      }
      continue;
    }
    if (/\b(?:E\.?P\.?S\.?|entidad\s+promotora\s+de\s+salud)\b/i.test(linea)) return { valor: limpiar(linea), evidencia: linea.slice(0, 120) };
  }
  // Firma o pie: «ALIAN SALUD EPS.» en una línea sola.
  const firma = lineasDe(texto).find((l) => /^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,40}\sEPS\.?$/.test(l) && !/^certific/i.test(l));
  if (firma) return { valor: limpiar(firma), evidencia: firma.slice(0, 120) };
  const frase = texto.match(/afiliad[oa]\s+a\s+(?:la\s+)?((?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.&]*\s+){0,5}(?:EPS|E\.P\.S\.?)(?:\s+S\.?A\.?S?\.?)?)/);
  return frase?.[1] ? { valor: limpiar(frase[1]), evidencia: frase[0].slice(0, 120) } : null;
}

function fechaExpedicionDe(texto: string): { valor: string; evidencia: string } | null {
  const hallada = primera(texto, [
    new RegExp(`fecha\\s+(?:y\\s+hora\\s+)?(?:de\\s+)?(?:expedici[oó]n|impresi[oó]n|generaci[oó]n|consulta)\\s*[:\\-]?\\s*${FECHA}`, 'i'),
    new RegExp(`(?:expedid[oa]|generad[oa]|impres[oa])\\s+(?:el|en)[^\\n\\d]{0,40}${FECHA}`, 'i'),
  ]);
  if (hallada) return hallada;
  // «a los 26 días del mes de octubre de 2.026»: algunos sistemas escriben el año con separador de miles.
  const dias = texto.match(/a\s+los\s+(\d{1,2})\s+d[ií]as\s+del\s+mes\s+de\s+([a-záéíóú]+)\s+de(?:l)?\s+(?:a[ñn]o\s+)?(\d)[.,]?(\d{3})/i);
  return dias ? { valor: `${dias[1]} de ${dias[2]} de ${dias[3]}${dias[4]}`, evidencia: dias[0].slice(0, 120) } : null;
}

function estadoDe(texto: string): { valor: string; evidencia: string } | null {
  const etiquetado = texto.match(/estado(?:\s+de(?:\s+la)?\s+afiliaci[oó]n)?\s*[:-]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,20})/i);
  if (etiquetado?.[1]) return { valor: etiquetado[1], evidencia: etiquetado[0].slice(0, 120) };
  const frase = texto.match(/(?:se\s+encuentra|figura|aparece)\s+(?:en\s+estado\s+)?(activ[oa]|inactiv[oa]|suspendid[oa]|retirad[oa]|cancelad[oa])/i)
    ?? texto.match(/afiliad[oa]\s+(activ[oa]|inactiv[oa]|suspendid[oa])/i);
  return frase?.[1] ? { valor: frase[1], evidencia: frase[0].slice(0, 120) } : null;
}

function regimenDe(texto: string): { valor: string; evidencia: string } | null {
  const m = texto.match(/r[eé]gimen(?:\s+de\s+(?:salud|afiliaci[oó]n))?\s*[:-]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ \-–]{2,50})/i);
  if (!m?.[1]) return null;
  let valor = limpiar(hastaOtraEtiqueta(m[1]));
  if (!/cotizante|beneficiario/i.test(valor)) {
    const tipo = texto.match(/(?:tipo\s+de\s+(?:afiliado|afiliaci[oó]n)|calidad)\s*[:-]\s*(cotizante|beneficiari[oa])/i);
    if (tipo?.[1]) valor = `${valor} - ${tipo[1]}`;
  }
  return { valor, evidencia: m[0].slice(0, 120) };
}

function tipoAfiliadoDe(texto: string): { valor: string; evidencia: string } | null {
  const m = texto.match(/(?:tipo\s+(?:de\s+)?afiliad[oa]|tipo\s+de\s+afiliaci[oó]n|calidad)\s*[:-]\s*(cotizante|beneficiari[oa]|adicional|pensionad[oa])/i)
    // Etiqueta dañada por el OCR («Tipc de Aniado:», «Taper de Añíumdo:»): empieza por «T…», es corta y su valor es una palabra
    // de tipo de afiliado. No cualquier etiqueta: «Régimen: Contributivo - Beneficiario» no entra por aquí.
    ?? texto.match(/\bt[a-z]{2,4}\s+de\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,10}\s*:\s*(cotizante|beneficiari[oa]|adicional|pensionad[oa])\b/i);
  return m?.[1] ? { valor: m[1], evidencia: m[0].slice(0, 120) } : null;
}

/** «Régimen: Contributivo - Beneficiario»: el tipo de afiliado viaja a veces dentro del régimen. */
function tipoAfiliadoEnRegimen(texto: string): { valor: string; evidencia: string } | null {
  const regimen = regimenDe(texto);
  const m = regimen?.valor.match(/cotizante|beneficiari[oa]/i);
  return regimen && m ? { valor: m[0], evidencia: regimen.evidencia } : null;
}

/**
 * Lee los campos del certificado de EPS de un texto. `confianzaBase` es la
 * confianza de la fuente (texto digital alto; OCR, derivada de la del motor).
 */
export function extraerCamposEps(texto: string, fuente: FuenteCampo, confianzaBase: number): CamposEpsLeidos {
  // Primero las reglas por frase («Etiqueta: valor», cartas); si no sirven, la lectura por líneas
  // (tablas con etiquetas y valores separados, texto desordenado o con tildes dañadas).
  const lineas = lineasVisuales(texto, fuente === 'texto_nativo');
  const norm = lineas.map(simple);
  const documentoLineas = documentoPorLineas(lineas, norm);
  const buscadores: Record<(typeof CAMPOS_EPS)[number], (t: string) => { valor: string; evidencia: string } | null> = {
    entidad_emisora: entidadDe,
    nombre_afiliado: (t) => nombreDe(t) ?? nombrePorLineas(lineas, norm, documentoLineas?.indice ?? null),
    documento_afiliado: (t) => documentoDe(t) ?? documentoLineas,
    fecha_expedicion: (t) => fechaExpedicionDe(t) ?? fechaGeneracionPorLineas(lineas, norm),
    estado_afiliacion: (t) => estadoDe(t) ?? estadoPorLineas(lineas, norm),
    regimen: regimenDe,
    tipo_afiliado: (t) => tipoAfiliadoDe(t) ?? tipoAfiliadoPorLineas(lineas, norm) ?? tipoAfiliadoEnRegimen(t),
  };
  const salida: CamposEpsLeidos = {};
  for (const campo of CAMPOS_EPS) {
    const hallado = buscadores[campo](texto);
    salida[campo] = hallado && hallado.valor.length > 0
      ? { valor: hallado.valor, confianza: Math.max(0, Math.min(1, confianzaBase)), evidencia: hallado.evidencia, fuente }
      : sinValor();
  }
  return salida;
}

// ── Combinación de fuentes ──────────────────────────────────────────────────

export interface DiscrepanciaFuentes {
  campo: string;
  /** Fuentes que leyeron un valor distinto. No se guardan los valores aquí. */
  fuentes: FuenteCampo[];
}

function mismoValor(campo: string, a: string, b: string): boolean {
  if (campo === 'documento_afiliado') return compararDocumentos(a, b) === 'igual';
  if (campo === 'nombre_afiliado') return ['igual', 'compatible'].includes(compararNombres(a, b));
  // La misma EPS escrita distinto por el texto digital y por el OCR («EPS SURA» / «EPS |SUra =») no es un conflicto.
  if (campo === 'entidad_emisora' && mismaEps(a, b) === true) return true;
  return normalizarTexto(a) === normalizarTexto(b);
}

/**
 * Une lecturas de distintas fuentes sobre los mismos campos. Orden de
 * prioridad: el que venga primero en `lecturas`. Si dos fuentes leen valores
 * DISTINTOS no se escoge ninguno: el campo queda sin valor y se registra la
 * discrepancia para que una persona decida.
 */
export function combinarLecturas(lecturas: readonly CamposEpsLeidos[]): {
  campos: CamposEpsLeidos;
  discrepancias: DiscrepanciaFuentes[];
} {
  const campos: CamposEpsLeidos = {};
  const discrepancias: DiscrepanciaFuentes[] = [];
  for (const nombre of CAMPOS_EPS) {
    const candidatos = lecturas.map((l) => l[nombre]).filter((c): c is CampoEpsLeido => !!c && c.valor !== null);
    if (candidatos.length === 0) { campos[nombre] = sinValor(); continue; }
    const [primero, ...resto] = candidatos;
    const distintos = resto.filter((c) => !mismoValor(nombre, primero.valor as string, c.valor as string));
    if (distintos.length > 0) {
      discrepancias.push({
        campo: nombre,
        fuentes: [primero, ...distintos].map((c) => c.fuente).filter((f): f is FuenteCampo => f !== null),
      });
      campos[nombre] = sinValor();
    } else {
      campos[nombre] = primero;
    }
  }
  return { campos, discrepancias };
}

/** Los cinco campos con los que se puede revisar un certificado a ojo y comparar con el estudiante. */
export const CAMPOS_SUFICIENCIA_EPS = ['nombre_afiliado', 'documento_afiliado', 'entidad_emisora', 'estado_afiliacion', 'fecha_expedicion'] as const;

export type SuficienciaLectura = 'insuficiente' | 'debil' | 'procesable';

/** Cuántos campos clave tiene la lectura (no «cuánto texto salió»): 0–1 insuficiente, 2 débil, 3 o más procesable. */
export function evaluarSuficienciaEps(campos: Readonly<CamposEpsLeidos>): { campos: number; suficiencia: SuficienciaLectura } {
  const n = CAMPOS_SUFICIENCIA_EPS.filter((c) => campos[c]?.valor != null).length;
  return { campos: n, suficiencia: n >= 3 ? 'procesable' : n === 2 ? 'debil' : 'insuficiente' };
}

export function faltanCamposClave(campos: Readonly<CamposEpsLeidos>): boolean {
  return CAMPOS_CLAVE_EPS.some((c) => !campos[c] || campos[c].valor === null);
}
