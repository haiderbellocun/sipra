import { ClasificacionDocumentoEmpresarial as C, DatosCamaraExtraidos, EstadoRegistral, TipoPersona, TipoCertificadoCamara } from '../entities/documento-empresarial';
import { clasificarDocumentoEmpresarial, ResultadoClasificacionEmpresarial } from './clasificacion-documento-empresarial.domain-service';
import { controlarNitLeido } from './control-nit.domain-service';
import { minimizarDatosCamara, sanearUrlVerificacion } from './minimizacion-documento-empresarial.domain-service';
import { estadoRegistralDesdeEtiqueta } from './vigencia-documento-empresarial.domain-service';

/**
 * Interpretación del texto de un certificado de Cámara de Comercio (ya extraído: texto nativo de pdf.js u OCR). Puro: no lee
 * archivos ni abre URLs.
 *
 * No supone un orden lineal ETIQUETA → VALOR en todo el documento: cada campo se ancla a SU etiqueta («Matrícula No.»,
 * «Fecha de renovación»…) y el valor se corta en la siguiente etiqueta conocida. Los certificados repiten encabezados en cada
 * página, parten datos en columnas y cambian de formato según la Cámara y el año; por eso se toma la PRIMERA aparición de cada
 * etiqueta y la tabla de representantes se lee por su encabezado («CARGO NOMBRE IDENTIFICACIÓN»), no por posición.
 *
 * Reglas que NO se negocian:
 *  · un valor dudoso es `null`, nunca un valor falso (en OCR, el NIT cuyo DV no cuadra se DESCARTA);
 *  · el estado registral solo sale de una etiqueta explícita («Estado de la matrícula: ACTIVA»); sin ella, `no_determinable`;
 *  · la persona natural no tiene representante legal;
 *  · la dirección, el correo, el teléfono y el texto completo se pueden leer, pero NO salen de aquí.
 */

export type FuentePaginaCamara = 'texto' | 'ocr';

export interface PaginaTextoCamara {
  texto: string;
  fuente: FuentePaginaCamara;
  /** Solo OCR: confianza media de la página (0–100). */
  confianzaOcr: number | null;
  /**
   * Solo OCR, si el motor da las palabras con su confianza (0–100): con ellas, un campo cuyas palabras son poco seguras se
   * descarta. Si se entregan, el texto de la página es esas palabras separadas por un espacio (`texto` se ignora).
   */
  palabras?: readonly { texto: string; confianza: number }[];
}

export type CampoCamara =
  | 'nombre' | 'nit' | 'dv' | 'matricula' | 'camara' | 'fechaMatricula' | 'ultimoAnioRenovado' | 'fechaRenovacion' | 'domicilio'
  | 'ciiu' | 'representante' | 'fechaExpedicion' | 'codigoVerificacion' | 'urlVerificacion' | 'diasVerificacion' | 'estadoRegistral';

export interface InterpretacionCamara {
  clasificacion: ResultadoClasificacionEmpresarial;
  /** Datos ya MINIMIZADOS (lista blanca); `null` si el documento no es un certificado de Cámara. */
  datos: DatosCamaraExtraidos | null;
  /** Fuente de cada campo hallado (la página la dio el texto nativo o el OCR). Sirve para decidir la duda y para las métricas. */
  fuentes: Partial<Record<CampoCamara, FuentePaginaCamara>>;
  /** Confianza (0–100) de cada campo leído por OCR (la de su palabra menos segura); `null` = texto digital. */
  confianzas: Partial<Record<CampoCamara, number | null>>;
  /** Hay una señal de que se debe revisar con más cuidado (OCR, NIT sin DV que cuadre, campo crítico ausente). */
  lecturaDudosa: boolean;
  /** 0–1: proporción de campos críticos hallados, atenuada por la confianza del OCR si algún crítico salió de él. */
  confianzaDocumento: number | null;
  /** Presencia (no validez) de las señales de verificación. */
  senales: { codigoVerificacion: boolean; urlVerificacion: boolean };
  /** Códigos de motivo; nunca fragmentos del texto. */
  motivos: string[];
}

const CRITICOS: readonly CampoCamara[] = ['nombre', 'nit', 'dv', 'matricula'];
/** En OCR, por debajo de esta confianza media de página la lectura se declara dudosa. */
const CONFIANZA_OCR_MINIMA = 80;
/** En OCR, un campo cuya palabra menos segura baja de esto se descarta (0–100). */
const UMBRAL_PALABRA_OCR = 75;

// ── Texto ───────────────────────────────────────────────────────────────────

const MESES: Readonly<Record<string, number>> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function fechaValida(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > dias ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** «15 de agosto de 2023» o «15/08/2023» (día/mes/año). Cualquier otra cosa o una fecha imposible → `null`. */
export function fechaDeCertificado(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const larga = t.match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/);
  if (larga && MESES[larga[2]]) return fechaValida(Number(larga[3]), MESES[larga[2]], Number(larga[1]));
  const corta = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  return corta ? fechaValida(Number(corta[3]), Number(corta[2]), Number(corta[1])) : null;
}

const FECHA = String.raw`(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})`;

/** Texto plano (conserva tildes y mayúsculas para los valores) y su versión plegada (misma longitud) para anclar etiquetas. */
interface Texto {
  plano: string;
  plegado: string;
  /** Inicio (en el texto plano) de cada página, para saber de qué página salió un hallazgo. */
  inicios: number[];
  paginas: PaginaTextoCamara[];
  /** Palabras de OCR con su confianza, en posiciones del texto plano. */
  palabras: { inicio: number; fin: number; confianza: number }[];
}

function construirTexto(paginas: readonly PaginaTextoCamara[]): Texto {
  const inicios: number[] = [];
  const palabras: Texto['palabras'] = [];
  let plano = '';
  for (const p of paginas) {
    inicios.push(plano.length);
    if (p.palabras) {
      for (const w of p.palabras) {
        const limpia = w.texto.normalize('NFC').replace(/\s+/g, ' ').trim();
        if (!limpia) continue;
        palabras.push({ inicio: plano.length, fin: plano.length + limpia.length, confianza: w.confianza });
        plano += `${limpia} `;
      }
    } else {
      plano += `${p.texto.normalize('NFC').replace(/\s+/g, ' ').trim()} `;
    }
  }
  // Plegar tildes conserva la longitud: cada letra con tilde (1 carácter NFC) pasa a su letra base (1 carácter).
  const plegado = plano.replace(/[ÁÀÄ]/g, 'A').replace(/[áàä]/g, 'a').replace(/[ÉÈË]/g, 'E').replace(/[éèë]/g, 'e').replace(/[ÍÌÏ]/g, 'I').replace(/[íìï]/g, 'i')
    .replace(/[ÓÒÖ]/g, 'O').replace(/[óòö]/g, 'o').replace(/[ÚÙÜ]/g, 'U').replace(/[úùü]/g, 'u').replace(/Ñ/g, 'N').replace(/ñ/g, 'n');
  return { plano, plegado, inicios, paginas: [...paginas], palabras };
}

interface Hallazgo {
  valor: string;
  indice: number;
  fuente: FuentePaginaCamara;
  /** OCR con palabras: la confianza MÍNIMA de las palabras que forman el valor (0–100). `null` = texto digital o sin dato. */
  confianza: number | null;
  /** Todos los grupos del patrón (0 = coincidencia completa), tomados del texto plano. */
  grupos: (string | null)[];
}

/** Primera aparición del patrón (sobre el texto plegado, sin distinguir mayúsculas); el valor es el grupo, tomado del texto plano. */
function buscar(t: Texto, patron: RegExp, grupo = 1, desde = 0): Hallazgo | null {
  const re = new RegExp(patron.source, `${patron.flags.replace(/[gdi]/g, '')}id`);
  re.lastIndex = 0;
  const trozo = t.plegado.slice(desde);
  const m = re.exec(trozo);
  const rango = m?.indices?.[grupo];
  if (!m || !rango) return null;
  const inicio = rango[0] + desde;
  const fin = rango[1] + desde;
  let pagina = 0;
  for (let i = 0; i < t.inicios.length; i += 1) if (t.inicios[i] <= inicio) pagina = i;
  const grupos = (m.indices ?? []).map((r) => (r ? t.plano.slice(r[0] + desde, r[1] + desde) : null));
  const cubiertas = t.palabras.filter((w) => w.inicio < fin && w.fin > inicio);
  const confianza = cubiertas.length > 0 ? Math.min(...cubiertas.map((w) => w.confianza)) : null;
  return { valor: t.plano.slice(inicio, fin).trim(), indice: inicio, fuente: t.paginas[pagina]?.fuente ?? 'texto', confianza, grupos };
}

const soloDigitos = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** Un nombre de persona o razón social: letras, espacios y signos corrientes; sin dígitos; entre 3 y 100 caracteres. */
function nombrePlausible(v: string | null | undefined, minTokens: number): string | null {
  if (!v) return null;
  // Se quitan los separadores del final, pero no el punto: «S.A.S.» lo lleva.
  const s = v.replace(/\s+/g, ' ').trim().replace(/[\s:,;-]+$/, '');
  if (s.length < 3 || s.length > 100 || /\d/.test(s)) return null;
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ&'.,\- ]+$/.test(s)) return null;
  return s.split(' ').filter(Boolean).length >= minTokens ? s : null;
}

// ── Cargos (tabla de representantes) ────────────────────────────────────────

const PALABRAS_CARGO = new Set([
  'REPRESENTANTE', 'REPRESENTANTES', 'LEGAL', 'LEGALES', 'GERENTE', 'GENERAL', 'PRESIDENTE', 'SUPLENTE', 'PRINCIPAL', 'PRIMER', 'SEGUNDO', 'TERCER',
  'JUDICIAL', 'SUBGERENTE', 'DIRECTOR', 'DIRECTORA', 'ADMINISTRADOR', 'APODERADO', 'APODERADA',
]);
// El tipo de documento viene como «C.C.» o como «CC» según la Cámara.
const TIPO_ID = String.raw`(?:C\.\s?C\.|C\.\s?E\.|P\.\s?P\.|T\.\s?I\.|CC|CE|PP|TI|NIT|PASAPORTE|CEDULA)`;
const FIN_NOMBRE = new RegExp(String.raw`\s${TIPO_ID}(?=[\s.:]|$)`, 'i');
const ID_DEL_REPRESENTANTE = new RegExp(String.raw`^\s*${TIPO_ID}[^0-9]{0,12}[\d.]{4,16}`, 'i');

interface Representante { nombre: string; suplente: boolean }

/** Lee las filas «cargo, nombre, identificación» que siguen al encabezado de la tabla. Devuelve el primer representante PRINCIPAL. */
function leerRepresentante(t: Texto): Hallazgo | null {
  const enc = buscar(t, /(CARGO\s*\/?\s*NOMBRE\s+IDENTIFICACION)/);
  if (!enc) return null;
  let pos = enc.indice + enc.valor.length;
  let resto = t.plano.slice(pos, pos + 600);
  const filas: (Representante & { confianza: number | null })[] = [];
  for (let i = 0; i < 4; i += 1) {
    const corte = FIN_NOMBRE.exec(resto);
    if (!corte) break;
    const antes = resto.slice(0, corte.index).trim();
    const tras = resto.slice(corte.index);
    const id = ID_DEL_REPRESENTANTE.exec(tras);
    if (!id) break;
    const tokens = antes.split(/\s+/).filter(Boolean);
    const cargo: string[] = [];
    while (tokens.length > 0 && PALABRAS_CARGO.has(tokens[0].toUpperCase())) cargo.push(tokens.shift()!);
    // Algunos formatos parten «Representante Legal» alrededor del nombre: la palabra suelta que sobra del cargo no es del nombre.
    while (tokens.length > 0 && PALABRAS_CARGO.has(tokens[tokens.length - 1].toUpperCase())) cargo.push(tokens.pop()!);
    const nombre = nombrePlausible(tokens.join(' '), 2);
    // Confianza (OCR): la mínima de las palabras de la fila, del cargo al nombre.
    const filaIni = pos;
    const filaFin = pos + corte.index;
    const cubiertas = t.palabras.filter((w) => w.inicio < filaFin && w.fin > filaIni);
    if (nombre) filas.push({ nombre, suplente: cargo.some((c) => c.toUpperCase() === 'SUPLENTE'), confianza: cubiertas.length ? Math.min(...cubiertas.map((w) => w.confianza)) : null });
    const avance = corte.index + id[0].length;
    const sobra = tras.slice(id[0].length);
    const sinLegal = sobra.replace(/^\s*(?:Legal|LEGAL)\b/, '');
    pos += avance + (sobra.length - sinLegal.length);
    resto = sinLegal;
    if (!/^\s*(?:Representante|REPRESENTANTE|Gerente|GERENTE|Presidente|PRESIDENTE|Suplente|SUPLENTE|Principal|PRINCIPAL)/.test(resto)) break;
  }
  const principal = filas.find((f) => !f.suplente);
  return principal ? { valor: principal.nombre, indice: enc.indice, fuente: enc.fuente, confianza: principal.confianza, grupos: [] } : null;
}

/** Un código real mezcla letras y dígitos (o, sin dígitos, mayúsculas y minúsculas alternadas): una palabra suelta como «Verifique» no lo es. */
function esCodigoVerificacion(v: string): boolean {
  const limpio = v.replace(/-/g, '');
  if (limpio.length < 6) return false;
  if (/\d/.test(limpio)) return true;
  return /[a-z]/.test(limpio) && (limpio.match(/[A-Z]/g) ?? []).length >= 2;
}

// ── Cámara expedidora ───────────────────────────────────────────────────────

const PARAR_EN = new Set(['SEDE', 'VIRTUAL', 'CERTIFICADO', 'FECHA', 'CERTIFICA', 'RECIBO', 'PARA', 'CODIGO', 'EL', 'LA', 'LOS', 'CAMARA', 'COMERCIO']);

function camaraExpedidora(t: Texto): Hallazgo | null {
  // La primera palabra después de «Cámara de Comercio de» no puede ser otra vez «Cámara»/«Comercio» (el OCR duplica encabezados).
  const h = buscar(t.plegado.length > 900 ? { ...t, plegado: t.plegado.slice(0, 900) } : t, /CAMARA\s+DE\s+COMERCIO\s+(?:DEL?\s+|DE\s+LA\s+)?(?!CAMARA\b|COMERCIO\b)((?:[A-Z][A-Za-z.]*)(?:\s+(?:[A-Z][A-Za-z.]*|DE|DEL|LA|Y))*)/);
  if (!h) return null;
  const palabras: string[] = [];
  for (const w of h.valor.split(/\s+/)) {
    if (PARAR_EN.has(w.toUpperCase()) && palabras.length > 0) break;
    if (palabras.length >= 4) break;
    // Un nombre que se repite («Bogotá de Bogotá») es un encabezado duplicado: se corta en la repetición.
    if (!['DE', 'DEL', 'LA', 'Y'].includes(w.toUpperCase()) && palabras.some((p) => p.toUpperCase() === w.toUpperCase())) break;
    palabras.push(w);
  }
  while (palabras.length > 0 && ['DE', 'DEL', 'LA', 'Y'].includes(palabras[palabras.length - 1].toUpperCase())) palabras.pop();
  const valor = palabras.join(' ').trim();
  return valor.length >= 3 && !/\d/.test(valor) ? { ...h, valor } : null;
}

// ── Interpretación ──────────────────────────────────────────────────────────

const clasesCamara: readonly C[] = [C.CAMARA_MATRICULA_PERSONA_NATURAL, C.CAMARA_MATRICULA_SOCIEDAD, C.CAMARA_EXISTENCIA_REPRESENTACION];

export function interpretarCamara(paginas: readonly PaginaTextoCamara[]): InterpretacionCamara {
  const conjunto = construirTexto(paginas);
  let clasificacion = clasificarDocumentoEmpresarial(conjunto.plano);
  // «Es otro documento» es una afirmación fuerte: con OCR y SIN una señal positiva de otro tipo (una factura, p. ej.) el texto
  // ruidoso puede ser un certificado mal leído. Se queda en no determinable y lo revisa una persona.
  if (
    clasificacion.clasificacion === C.DOCUMENTO_INCORRECTO && paginas.some((p) => p.fuente === 'ocr')
    && !clasificacion.motivos.some((m) => m.startsWith('factura_'))
  ) {
    clasificacion = { clasificacion: C.NO_DETERMINABLE, familia: null, tipoPersona: null, motivos: [...clasificacion.motivos, 'ocr_sin_rasgos_de_certificado'] };
  }
  const vacio = (): InterpretacionCamara => ({
    clasificacion, datos: null, fuentes: {}, confianzas: {}, lecturaDudosa: clasificacion.clasificacion === C.NO_DETERMINABLE, confianzaDocumento: null,
    senales: { codigoVerificacion: false, urlVerificacion: false }, motivos: [],
  });
  if (!clasesCamara.includes(clasificacion.clasificacion)) return vacio();

  const esNatural = clasificacion.clasificacion === C.CAMARA_MATRICULA_PERSONA_NATURAL;
  const tipoCertificado: TipoCertificadoCamara = clasificacion.clasificacion === C.CAMARA_EXISTENCIA_REPRESENTACION ? 'existencia_representacion' : 'matricula_mercantil';
  const persona = esNatural ? TipoPersona.NATURAL : TipoPersona.JURIDICA;
  const motivos: string[] = [];
  const fuentes: Partial<Record<CampoCamara, FuentePaginaCamara>> = {};
  const confianzas: Partial<Record<CampoCamara, number | null>> = {};
  const pocoSeguro = (h: Hallazgo): boolean => h.fuente === 'ocr' && h.confianza !== null && h.confianza < UMBRAL_PALABRA_OCR;
  const hallar = (campo: CampoCamara, h: Hallazgo | null): string | null => {
    if (!h) return null;
    // OCR: un campo cuyas palabras se leyeron con poca seguridad se descarta; un valor nulo es mejor que uno falso.
    if (pocoSeguro(h)) { motivos.push(`${campo}_descartado_ocr_baja_confianza`); return null; }
    fuentes[campo] = h.fuente;
    confianzas[campo] = h.confianza;
    return h.valor;
  };

  // Nombre o razón social.
  const nombre = esNatural
    ? hallar('nombre', (() => {
      // «apellidos» tolera una letra mal leída por el OCR («apeliidos»); un valor ruidoso se descarta más abajo.
      const h = buscar(conjunto, /NOMBRES?\s+Y\s+A[A-Z]{5,9}\s*:\s*(.+?)\s+(?:IDENTIFICACION|IDENT[A-Z]{4,10}|NIT)\b/) ?? buscar(conjunto, /\bNOMBRE\s*:\s*(.+?)\s+(?:C\.\s?C\.|C\.\s?E\.|P\.\s?P\.|T\.\s?I\.|NIT|IDENTIFICACION)/);
      return h && nombrePlausible(h.valor, 2) ? { ...h, valor: nombrePlausible(h.valor, 2)! } : null;
    })())
    : hallar('nombre', (() => {
      const h = buscar(conjunto, /RAZON\s+SOCIAL\s*:\s*(.+?)\s+(?:SIGLA|NIT|IDENTIFICACION|ADMINISTRACION|DOMICILIO)\b/);
      return h && nombrePlausible(h.valor, 1) ? { ...h, valor: nombrePlausible(h.valor, 1)! } : null;
    })());

  // NIT y DV por separado.
  const hNitCrudo = buscar(conjunto, /\bN\.?\s?I\.?\s?T\.?\s*:?\s*(\d[\d.]{4,14})(?:\s*-\s*|\s+)(\d)\b/) ?? buscar(conjunto, /\bN\.?\s?I\.?\s?T\.?\s*:?\s*(\d[\d.]{4,14})(?![\d.])/);
  if (hNitCrudo && pocoSeguro(hNitCrudo)) motivos.push('nit_descartado_ocr_baja_confianza');
  const hNit = hNitCrudo && !pocoSeguro(hNitCrudo) ? hNitCrudo : null;
  let nit: string | null = hNit ? soloDigitos(hNit.valor) : null;
  let dv: string | null = hNit?.grupos[2] ?? null;
  // La persona natural sin etiqueta NIT: la identificación («C.C. 123…») hace de número; sin DV no hay con qué validarla.
  if (nit === null && esNatural && !hNitCrudo) {
    const h = buscar(conjunto, /IDENTIFICACION\s*:\s*(?:C\.?\s?C\.?|C\.?\s?E\.?|PA|TI)\s*[.\-:]*\s*(\d[\d.]{4,14})/) ?? buscar(conjunto, /\bC\.\s?C\.\s*(?:No\.?\s*)?(\d[\d.]{4,14})/);
    if (h && !pocoSeguro(h)) { nit = soloDigitos(h.valor); fuentes.nit = h.fuente; confianzas.nit = h.confianza; }
  } else if (hNit) { fuentes.nit = hNit.fuente; confianzas.nit = hNit.confianza; }
  const control = controlarNitLeido(nit, dv);
  const origenNit = fuentes.nit ?? 'texto';
  if (origenNit === 'ocr' && !control.confiable) {
    // OCR: un NIT cuyo DV no cuadra (o sin DV) puede ser un dígito mal leído: se descarta antes que guardar un valor falso.
    nit = null; dv = null; delete fuentes.nit;
    motivos.push('nit_descartado_ocr');
  } else if (nit !== null && dv !== null) { fuentes.dv = origenNit; confianzas.dv = confianzas.nit ?? null; }
  else if (nit !== null) motivos.push(`nit_${control.estado}`);
  if (nit !== null && dv !== null && !control.confiable) motivos.push('nit_dv_no_coincide');

  // Matrícula (cadena normalizada: solo se quitan los puntos de presentación; los ceros se conservan).
  // Los puntos son presentación («12.345»); el guion se conserva («20-123456-02»: puede ser parte del número).
  const hMat = buscar(conjunto, /\bMATRICULA\s*(?:NO|N°|NRO|NUMERO)\.?\s*:?\s*([A-Z]{0,2}\d+(?:[.-]\d+)*)(?![\d])/);
  const matricula = hallar('matricula', hMat && hMat.valor.replace(/\./g, '').length <= 30 ? { ...hMat, valor: hMat.valor.replace(/\./g, '').toUpperCase() } : null);

  const camara = hallar('camara', camaraExpedidora(conjunto));
  const fechaMatricula = fechaDeCertificado(hallar('fechaMatricula',
    buscar(conjunto, new RegExp(String.raw`FECHA\s+DE\s+MATRICULA(?:\s+EN\s+ESTA\s+CAMARA\s+DE\s+COMERCIO)?\s*:\s*${FECHA}`))
    ?? buscar(conjunto, new RegExp(String.raw`MATRICULA\s+NO\s*:?\s*\S+\s+DEL\s+${FECHA}`))));
  // «año» tolera la «ñ» mal leída por el OCR («ano», «afio»).
  const hAnio = buscar(conjunto, /ULTIMO\s+A[A-Z]{1,2}O\s+RENOVADO\s*:?\s*(\d{4})\b/);
  const ultimoAnioRenovado = hallar('ultimoAnioRenovado', hAnio) ? Number(hAnio!.valor) : null;
  const fechaRenovacion = fechaDeCertificado(hallar('fechaRenovacion',
    buscar(conjunto, new RegExp(String.raw`FECHA\s+DE\s+RENOVACION(?:\s+DE\s+LA\s+MATRICULA)?\s*:?\s*${FECHA}`))));
  const fechaExpedicion = fechaDeCertificado(hallar('fechaExpedicion',
    buscar(conjunto, new RegExp(String.raw`FECHA\s+(?:DE\s+)?EXPEDICION\s*:?\s*${FECHA}`))
    // Formato antiguo (todo en mayúsculas): la fecha va sin etiqueta, antes de «HORA hh:mm».
    ?? buscar(conjunto, new RegExp(String.raw`(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})\s+HORA\s+\d{1,2}:\d{2}`))));

  // Domicilio (solo municipio): primera aparición de «Domicilio:», que no sea «de la dirección del domicilio principal».
  const hDom = buscar(conjunto, /(?<!DEL\s)(?<!NOTIFICACION\s)\bDOMICILIO(?:\s+PRINCIPAL)?\s*:\s*(.+?)\s+(?:MATRICULA|UBICACION)\b/)
    ?? buscar(conjunto, /\bMUNICIPIO\s*:\s*(.+?)\s+(?:CORREO|EMAIL|TELEFONO)\b/);
  const domicilio = hallar('domicilio', hDom && !/\d/.test(hDom.valor) && hDom.valor.length <= 80 ? hDom : null);

  const hCiiu = buscar(conjunto, /ACTIVIDAD\s+PRINCIPAL\s*(?:CODIGO\s+CIIU)?\s*:?\s*[A-Z]?(\d{4})\b/) ?? buscar(conjunto, /\bCODIGO\s+CIIU\s*:?\s*[A-Z]?(\d{4})\b/)
    ?? buscar(conjunto, /ACTIVIDAD\s+ECONOMICA\s*:\s*(\d{4})\b/);
  const ciiu = hallar('ciiu', hCiiu);

  // Estado registral: solo con una etiqueta explícita.
  const hEstado = buscar(conjunto, /\bESTADO\s+(?:DE\s+LA\s+)?MATRICULA\s*:\s*([A-Za-z]+)/);
  const estadoRegistral = hEstado ? estadoRegistralDesdeEtiqueta(hallar('estadoRegistral', hEstado)) : EstadoRegistral.NO_DETERMINABLE;

  // Representante: solo persona jurídica. En OCR, un nombre con ruido no se acepta.
  let representanteLegal: string | null = null;
  if (!esNatural) {
    const h = leerRepresentante(conjunto);
    if (h && (h.fuente === 'texto' || h.valor.split(' ').length <= 6)) representanteLegal = hallar('representante', h);
    if (!representanteLegal) motivos.push('representante_no_legible');
  }

  // Verificación: código, URL y ventana. Solo se REGISTRAN; nada se abre ni se afirma como auténtico.
  const hCodigo = buscar(conjunto, /\bCODIGO\s+(?:DE\s+)?VERIFICACION\s*:?\s*([A-Za-z0-9]{3,20}(?:-[A-Za-z0-9]{2,20}){0,3})(?![A-Za-z0-9])/);
  const codigoPlausible = hCodigo && esCodigoVerificacion(hCodigo.valor) ? hCodigo : null;
  const codigoVerificacion = hallar('codigoVerificacion', codigoPlausible);
  const hUrl = buscar(conjunto, /INGRESANDO\s+A\s+((?:HTTPS?:\/\/)?[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}[^\s*]*)/);
  const urlCruda = hUrl ? hUrl.valor.replace(/[.,;]+$/, '') : null;
  const urlSaneada = urlCruda ? sanearUrlVerificacion(urlCruda) : null;
  // Con OCR una letra mal leída da una URL que parece válida y no lo es: se registra que la URL EXISTE, pero no se conserva.
  const urlVerificacion = urlSaneada && hUrl?.fuente === 'texto' ? urlSaneada : null;
  if (urlVerificacion && hUrl) fuentes.urlVerificacion = hUrl.fuente;
  if (urlSaneada && !urlVerificacion) motivos.push('url_no_conservada_ocr');
  // La ventana la DECLARA el certificado («…durante 60 días calendario»); si no lo dice, no se supone ningún plazo.
  const hDias = buscar(conjunto, /\b(?:VERIFIC\w*|VALIDAD\w*)[^.]{0,140}?\bDURANTE\s+(\d{1,4})\s+DIAS\b/);
  const diasVerificacion = hallar('diasVerificacion', hDias) ? Number(hDias!.valor) : null;

  const datos = minimizarDatosCamara({
    nombreORazonSocial: nombre, nit, dv, matricula, camara, fechaMatricula, ultimoAnioRenovado, fechaRenovacion, estadoRegistral,
    domicilioMunicipio: domicilio, ciiu: ciiu ? soloDigitos(ciiu) : null, representanteLegal, fechaExpedicion, codigoVerificacion, urlVerificacion,
    diasVerificacionDocumento: diasVerificacion, firmaPdfPresente: null,
  }, tipoCertificado, persona);

  // Confianza y duda.
  const hallados = CRITICOS.filter((c) => (c === 'nombre' ? nombre : c === 'nit' ? nit : c === 'dv' ? dv : matricula) !== null);
  const criticosDeOcr = CRITICOS.some((c) => fuentes[c] === 'ocr');
  const confOcr = paginas.filter((p) => p.fuente === 'ocr' && p.confianzaOcr !== null).map((p) => p.confianzaOcr as number);
  const confOcrMedia = confOcr.length ? confOcr.reduce((a, b) => a + b, 0) / confOcr.length : null;
  const proporcion = hallados.length / CRITICOS.length;
  const confianzaDocumento = Math.round(proporcion * (criticosDeOcr && confOcrMedia !== null ? Math.min(1, confOcrMedia / 100) : 1) * 1000) / 1000;
  const nitNoConfiable = nit !== null && !control.confiable;
  const lecturaDudosa = hallados.length < CRITICOS.length || nitNoConfiable || criticosDeOcr || (confOcrMedia !== null && confOcrMedia < CONFIANZA_OCR_MINIMA);
  if (criticosDeOcr) motivos.push('campos_criticos_por_ocr');

  return {
    clasificacion, datos, fuentes, confianzas, lecturaDudosa, confianzaDocumento,
    senales: { codigoVerificacion: codigoVerificacion !== null, urlVerificacion: urlSaneada !== null }, motivos,
  };
}
