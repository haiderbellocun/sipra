import {
  ClasificacionDocumentoEmpresarial as C, ControlNitRut, DatosRutExtraidos, FamiliaDocumentoEmpresarial, TipoPersona, familiaDe, personaDe,
} from '../entities/documento-empresarial';
import { CajaTexto } from '../ports/out/geometria-documento.port';
import {
  ResultadoClasificacionEmpresarial, clasificarDocumentoEmpresarial,
} from './clasificacion-documento-empresarial.domain-service';
import { controlarNitLeido } from './control-nit.domain-service';
import {
  CampoGeometrico, CamposRutGeometricos, FuenteCajas, leerCamposRutPorGeometria, leerFechaGeneracionRut,
} from './geometria-rut.domain-service';
import { normalizarTexto } from './normalizacion-identidad';

/**
 * Interpretación del RUT a partir de las cajas de texto (digital u OCR): clasifica por contenido, lee por geometría,
 * valida (DV, estructura) y decide qué se conserva. Función pura: el I/O (pdf.js, Tesseract, ZXing) lo hace
 * `lectura-local-rut.domain-service.ts`.
 *
 * Principios:
 *  · Un valor dudoso no se inventa: mejor `null` (información insuficiente) que un dato falso.
 *  · El DV valida el NIT. Si no cuadra, la lectura NO es confiable; el NIT nunca se corrige. En un RUT leído por OCR
 *    un NIT sin DV que cuadre se DESCARTA (no se conserva como dato).
 *  · La fecha de generación es informativa: nada de vigencia, «año en curso» ni 30/60/90 días.
 *  · No se conservan dirección, correo, teléfono ni responsabilidades (se leen solo lo necesario).
 *  · La confianza se informa POR CAMPO; la del documento no certifica ningún campo.
 */

export interface PaginaCajas {
  cajas: readonly CajaTexto[];
}

export interface InterpretacionRut {
  clasificacion: ResultadoClasificacionEmpresarial;
  /** `null` si el documento no es un RUT identificable o la persona no se pudo determinar. */
  datos: DatosRutExtraidos | null;
  /** Confianza del documento (0–1): texto digital 1; OCR, la media de sus palabras. No certifica los campos. */
  confianzaDocumento: number | null;
  lecturaDudosa: boolean;
  /** Códigos de lo ocurrido (descartes, contradicciones, formulario no localizado). Nunca texto del documento. */
  motivos: string[];
  etiquetasLocalizadas: number;
}

/** Con menos etiquetas localizadas que estas, no se puede afirmar que se leyó el formulario completo. */
export const MIN_ETIQUETAS_FORMULARIO = 6;
/** Por debajo de esta confianza media de OCR, la lectura se marca dudosa. */
export const CONFIANZA_OCR_DUDOSA_RUT = 0.88;
/** Una palabra de nombre o razón social con menos confianza que esto es ruido evidente. */
/** Con OCR, un nombre solo se conserva si TODAS sus palabras se leyeron con alta confianza (no hay otro validador). */
const NOMBRE_OCR_MIN_PALABRA = 0.85;
const NOMBRE_OCR_MEDIA = 0.9;
/** Dígitos leídos por OCR (CIIU, DIVIPOLA, fecha): solo estructura los valida, así que se exige confianza alta. */
const DIGITOS_OCR_MIN = 0.75;

const MAYUSCULAS = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ.'-]*$/;

// ── Campos ──────────────────────────────────────────────────────────────────

/** Nombres de persona: palabras en mayúsculas. Con OCR, sin ruido (palabras de una letra, símbolos, baja confianza). */
function nombreLimpio(partes: (CampoGeometrico | undefined)[], fuente: FuenteCajas): { valor: string | null; confianza: number | null; ruido: boolean } {
  const cajas = partes.flatMap((p) => (p ? [...p.cajas] : []));
  const tokens = cajas.map((c) => c.texto.trim()).filter(Boolean);
  if (tokens.length === 0) return { valor: null, confianza: null, ruido: false };
  const confs = cajas.map((c) => Math.max(0, Math.min(1, c.confianza / 100)));
  const confianza = Math.min(...confs);
  const forma = tokens.every((t) => MAYUSCULAS.test(t) && (fuente === 'texto' || t.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length >= 2));
  if (!forma) return { valor: null, confianza, ruido: true };
  if (fuente === 'ocr') {
    const media = confs.reduce((a, b) => a + b, 0) / confs.length;
    if (confianza < NOMBRE_OCR_MIN_PALABRA || media < NOMBRE_OCR_MEDIA) return { valor: null, confianza, ruido: true };
  }
  return { valor: tokens.join(' ').replace(/\s+/g, ' '), confianza, ruido: false };
}

function razonSocialLimpia(campo: CampoGeometrico | undefined, fuente: FuenteCajas): { valor: string | null; confianza: number | null; ruido: boolean } {
  if (!campo || campo.cajas.length === 0) return { valor: null, confianza: null, ruido: false };
  const confs = campo.cajas.map((c) => Math.max(0, Math.min(1, c.confianza / 100)));
  const confianza = Math.min(...confs);
  const texto = campo.texto;
  const letras = texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '').length;
  const proporcion = letras / Math.max(1, texto.replace(/\s/g, '').length);
  if (fuente === 'ocr') {
    const media = confs.reduce((a, b) => a + b, 0) / confs.length;
    if (confianza < NOMBRE_OCR_MIN_PALABRA || media < NOMBRE_OCR_MEDIA || proporcion < 0.7 || letras < 3) return { valor: null, confianza, ruido: true };
  } else if (letras < 2) {
    return { valor: null, confianza, ruido: true };
  }
  return { valor: texto, confianza, ruido: false };
}

const CODIGO_TIPO_DOCUMENTO: Readonly<Record<string, string>> = { '13': 'CC', '22': 'CE', '31': 'NIT', '12': 'TI', '41': 'PA', '11': 'RC' };

/** Confianza mínima de las cajas que traen dígitos (el resto de la región puede ser ruido de OCR). */
function confianzaDeDigitos(campo: CampoGeometrico | undefined): number {
  const cajas = campo?.cajas.filter((c) => /\d/.test(c.texto)) ?? [];
  return cajas.length ? Math.min(...cajas.map((c) => Math.max(0, Math.min(1, c.confianza / 100)))) : 0;
}

/** `soloTexto`: ignora el código numérico (con OCR un par de dígitos sueltos no prueba nada). */
function tipoDocumentoDe(campo: CampoGeometrico | undefined, soloTexto = false): string | null {
  if (!campo) return null;
  const t = normalizarTexto(campo.texto);
  if (/CEDULA DE CIUDADANIA/.test(t)) return 'CC';
  if (/CEDULA DE EXTRANJERIA/.test(t)) return 'CE';
  if (/TARJETA DE IDENTIDAD/.test(t)) return 'TI';
  if (/PASAPORTE/.test(t)) return 'PA';
  if (/REGISTRO CIVIL/.test(t)) return 'RC';
  if (/^NIT\b/.test(t)) return 'NIT';
  // Sin texto legible, el código numérico del formulario (2 dígitos) dice el tipo.
  return soloTexto ? null : CODIGO_TIPO_DOCUMENTO[campo.digitos] ?? null;
}

function personaDeCampo24(campo: CampoGeometrico | undefined): TipoPersona | null {
  if (!campo) return null;
  const t = normalizarTexto(campo.texto);
  const natural = /NATURAL/.test(t);
  const juridica = /JURIDICA/.test(t);
  if (natural === juridica) return null;
  return natural ? TipoPersona.NATURAL : TipoPersona.JURIDICA;
}

/** Texto de todas las páginas por filas (para clasificar y para la fecha). */
function textoDePaginas(paginas: readonly PaginaCajas[]): string {
  return paginas
    .map((p) => [...p.cajas].sort((a, b) => (Math.abs(a.y - b.y) > 0.004 ? a.y - b.y : a.x - b.x)).map((c) => c.texto).join(' '))
    .join('\n');
}

const nulos = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function interpretarRut(paginas: readonly PaginaCajas[], fuente: FuenteCajas): InterpretacionRut {
  const motivos: string[] = [];
  const todas = paginas.flatMap((p) => [...p.cajas]);
  const clasificacionTexto = clasificarDocumentoEmpresarial(textoDePaginas(paginas));

  const sinDatos = (clasificacion: ResultadoClasificacionEmpresarial, extra: string[] = []): InterpretacionRut => ({
    clasificacion: { ...clasificacion, motivos: [...clasificacion.motivos, ...extra] }, datos: null, confianzaDocumento: null,
    lecturaDudosa: false, motivos: [...motivos, ...extra], etiquetasLocalizadas: 0,
  });

  const esRut = familiaDe(clasificacionTexto.clasificacion) === FamiliaDocumentoEmpresarial.RUT;
  const rutSinPersona = clasificacionTexto.clasificacion === C.NO_DETERMINABLE
    && clasificacionTexto.motivos.some((m) => m === 'rut_sin_tipo_contribuyente');
  // Un documento que no es RUT (factura, certificado de cámara, otro): se informa su clasificación y no se extrae nada.
  if (!esRut && !(rutSinPersona && fuente === 'ocr')) return sinDatos(clasificacionTexto);

  const pagina1 = paginas[0]?.cajas ?? [];
  const geo: CamposRutGeometricos = leerCamposRutPorGeometria(pagina1, fuente);
  const c = geo.campos;
  const formularioLocalizado = geo.etiquetas.length >= MIN_ETIQUETAS_FORMULARIO;
  if (!formularioLocalizado) motivos.push('formulario_no_localizado');

  // ── Nombre / razón social (señales de contenido de la persona) ──
  // Sin las cuatro etiquetas (apellidos y nombres) no se sabe si una parte vacía lo está de verdad o no se leyó: con OCR
  // el nombre incompleto se descarta en vez de presentarlo como completo.
  const etiquetasNombreCompletas = [31, 32, 33, 34].every((n) => geo.etiquetas.includes(n));
  const sinNombreCompleto = fuente === 'ocr' && !etiquetasNombreCompletas;
  const nombres = sinNombreCompleto ? { valor: null, confianza: null, ruido: false } : nombreLimpio([c[33], c[34]], fuente);
  const apellidos = sinNombreCompleto ? { valor: null, confianza: null, ruido: false } : nombreLimpio([c[31], c[32]], fuente);
  if (sinNombreCompleto) motivos.push('nombre_etiquetas_incompletas');
  const razon = razonSocialLimpia(c[35], fuente);
  const tieneNombres = apellidos.valor !== null && nombres.valor !== null;
  // Rasgo propio de la persona natural: el tipo de documento de identidad escrito (cédula, pasaporte…).
  const tieneTipoDocumentoEscrito = tipoDocumentoDe(c[25], true) !== null;
  const respaldoNatural = tieneNombres || tieneTipoDocumentoEscrito;
  const tieneRazon = razon.valor !== null;
  if (nombres.ruido || apellidos.ruido) motivos.push('nombre_ruido_ocr');
  if (razon.ruido) motivos.push('razon_social_ruido_ocr');

  // ── Persona: la clasificación por texto, corroborada por la geometría; contradicciones ⇒ no determinable ──
  const personaCampo24 = personaDeCampo24(c[24]);
  let persona: TipoPersona | null = personaDe(clasificacionTexto.clasificacion);
  let corroborada = false;
  if (persona === null && rutSinPersona) {
    // OCR: la frase completa del campo 24 se pierde con frecuencia. Se acepta la persona solo si el contenido la respalda.
    const textoGeneral = normalizarTexto(textoDePaginas(paginas));
    const natural = /PERSONA NATURAL/.test(textoGeneral);
    const juridica = /PERSONA JURIDICA/.test(textoGeneral);
    if (natural !== juridica) {
      const candidata = natural ? TipoPersona.NATURAL : TipoPersona.JURIDICA;
      if (candidata === TipoPersona.NATURAL ? respaldoNatural && !tieneRazon : tieneRazon && !respaldoNatural) {
        persona = candidata;
        corroborada = true;
        motivos.push('persona_por_corroboracion_ocr');
      }
    }
  }
  if (persona === null) return sinDatos({ clasificacion: C.NO_DETERMINABLE, familia: null, tipoPersona: null, motivos: [...clasificacionTexto.motivos] }, motivos);

  const contradice = (persona === TipoPersona.NATURAL && (tieneRazon || personaCampo24 === TipoPersona.JURIDICA))
    || (persona === TipoPersona.JURIDICA && (respaldoNatural || personaCampo24 === TipoPersona.NATURAL));
  if (contradice) {
    return sinDatos({ clasificacion: C.NO_DETERMINABLE, familia: null, tipoPersona: null, motivos: [...clasificacionTexto.motivos, 'rut_senales_contradictorias'] }, ['rut_senales_contradictorias']);
  }
  if (!corroborada) {
    corroborada = persona === TipoPersona.NATURAL ? respaldoNatural : tieneRazon;
    if (!corroborada) motivos.push('persona_sin_corroborar');
  }
  const clasificacion: ResultadoClasificacionEmpresarial = persona === TipoPersona.NATURAL
    ? { clasificacion: C.RUT_PERSONA_NATURAL, familia: familiaDe(C.RUT_PERSONA_NATURAL), tipoPersona: persona, motivos: [...clasificacionTexto.motivos, ...(corroborada ? ['persona_corroborada_por_campos'] : [])] }
    : { clasificacion: C.RUT_PERSONA_JURIDICA, familia: familiaDe(C.RUT_PERSONA_JURIDICA), tipoPersona: persona, motivos: [...clasificacionTexto.motivos, ...(corroborada ? ['persona_corroborada_por_campos'] : [])] };

  // ── NIT + DV: el DV valida; el NIT no se corrige ──
  const confianzaCampos: NonNullable<DatosRutExtraidos['confianzaCampos']> = {};
  const nitCampo = c[5];
  const dvCampo = c[6];
  const docCampo = persona === TipoPersona.NATURAL ? c[26] : undefined;
  const limpiarNumero = (campo: CampoGeometrico | undefined, min: number, max: number): string | null =>
    campo && campo.digitos.length >= min && campo.digitos.length <= max ? campo.digitos : null;
  const nitLeido = limpiarNumero(nitCampo, 6, 11);
  const dvLeido = dvCampo && dvCampo.digitos.length === 1 ? dvCampo.digitos : null;
  const documentoLeido = limpiarNumero(docCampo, 4, 15);

  // En persona natural el NIT es la cédula y se imprime dos veces (campos 5 y 26): son dos lecturas independientes.
  const candidatos = [nitLeido, ...(persona === TipoPersona.NATURAL && documentoLeido && documentoLeido !== nitLeido ? [documentoLeido] : [])]
    .filter((x): x is string => x !== null);
  let nit: string | null = nitLeido;
  let dv: string | null = dvLeido;
  let confianzaNit: number | null = nitCampo ? confianzaDeDigitos(nitCampo) : null;
  const control = controlarNitLeido(nitLeido, dvLeido);
  let controlNit: ControlNitRut = control.estado;
  if (!control.confiable && candidatos.length > 1) {
    // La otra lectura del mismo número puede ser la buena (p. ej. una cifra mal leída en el campo 5).
    const alterno = candidatos.find((x) => x !== nitLeido && controlarNitLeido(x, dvLeido).confiable);
    if (alterno) { nit = alterno; controlNit = 'confiable'; confianzaNit = docCampo ? confianzaDeDigitos(docCampo) : confianzaNit; motivos.push('nit_recuperado_del_campo_documento'); }
  }
  const nitConfiable = controlNit === 'confiable';
  if (fuente === 'ocr' && !nitConfiable) {
    // Una lectura OCR sin DV que cuadre no es un NIT: se descarta en lugar de presentarla como dato.
    if (nit !== null || dv !== null) motivos.push('nit_descartado_dv_no_cuadra');
    nit = null; dv = null; controlNit = 'descartado_ocr'; confianzaNit = null;
  } else if (!nitConfiable) {
    motivos.push(`nit_no_confiable_${controlNit}`);
  }
  confianzaCampos.nit = nit === null ? null : confianzaNit;
  confianzaCampos.dv = dv === null ? null : dvCampo?.confianza ?? null;

  // PN: el documento debe coincidir con el NIT (misma cédula impresa dos veces); si difiere, no se afirma.
  let numeroDocumento = persona === TipoPersona.NATURAL ? documentoLeido : null;
  if (persona === TipoPersona.NATURAL && numeroDocumento && nit && numeroDocumento !== nit) {
    motivos.push('documento_distinto_del_nit');
    if (fuente === 'ocr') numeroDocumento = null;
  }
  // Con OCR el número de documento solo se conserva si respalda un NIT que el DV ya validó: no hay otro control.
  if (fuente === 'ocr' && numeroDocumento !== null && !(nit !== null && numeroDocumento === nit)) {
    numeroDocumento = null;
    motivos.push('documento_ocr_sin_nit_validado');
  }

  // ── DIVIPOLA = departamento (2) + municipio (3): solo estructura, sin consultar catálogos ──
  const dep = c[39]?.digitos ?? '';
  const mun = c[40]?.digitos ?? '';
  const minConfDivipola = Math.min(confianzaDeDigitos(c[39]), confianzaDeDigitos(c[40]));
  let divipola: string | null = dep.length === 2 && mun.length === 3 ? `${dep}${mun}` : null;
  if (divipola && fuente === 'ocr' && minConfDivipola < DIGITOS_OCR_MIN) { divipola = null; motivos.push('divipola_baja_confianza_ocr'); }
  confianzaCampos.divipola = divipola === null ? null : minConfDivipola;

  // ── CIIU principal: cuatro dígitos exactos ──
  const ciiuDigitos = c[46]?.digitos ?? '';
  let ciiu: string | null = ciiuDigitos.length === 4 ? ciiuDigitos : null;
  if (ciiu && fuente === 'ocr' && confianzaDeDigitos(c[46]) < DIGITOS_OCR_MIN) ciiu = null;

  // ── Fecha de generación (informativa) ──
  let fecha = leerFechaGeneracionRut(todas);
  if (fecha && fuente === 'ocr' && fecha.confianza < DIGITOS_OCR_MIN) { fecha = null; motivos.push('fecha_baja_confianza_ocr'); }
  confianzaCampos.fechaGeneracion = fecha ? fecha.confianza : null;

  // ── Documento de identidad (persona natural) ──
  const tipoDocumento = persona === TipoPersona.NATURAL ? tipoDocumentoDe(c[25]) : null;

  const nombreConfianza = persona === TipoPersona.NATURAL
    ? (tieneNombres ? Math.min(nombres.confianza ?? 1, apellidos.confianza ?? 1) : null)
    : razon.confianza;
  confianzaCampos.nombre = (persona === TipoPersona.NATURAL ? tieneNombres : tieneRazon) ? nombreConfianza : null;
  confianzaCampos.tipoPersona = fuente === 'texto' ? 1 : Math.min(...[c[24]?.confianza, nombreConfianza].filter((x): x is number => typeof x === 'number'), 1);

  const datos: DatosRutExtraidos = {
    tipoPersona: persona,
    nit, dv,
    fechaGeneracion: fecha?.fecha ?? null,
    ciiuPrincipal: nulos(ciiu),
    divipolaMunicipio: nulos(divipola),
    ...(persona === TipoPersona.NATURAL
      ? { tipoDocumento, numeroDocumento, nombres: nombres.valor, apellidos: apellidos.valor }
      : { razonSocial: razon.valor }),
    confianzaCampos,
    controlNit,
  };

  // ── Confianza y lectura dudosa ──
  const confsOcr = todas.map((x) => x.confianza).filter((x) => x < 100);
  const confianzaDocumento = fuente === 'texto'
    ? (nitConfiable && formularioLocalizado ? 1 : 0.8)
    : confsOcr.length ? Math.round((confsOcr.reduce((a, b) => a + b, 0) / confsOcr.length)) / 100 : null;
  const criticoPerdido = (persona === TipoPersona.NATURAL ? !tieneNombres : !tieneRazon) || nit === null;
  const lecturaDudosa = fuente === 'ocr'
    ? (confianzaDocumento === null || confianzaDocumento < CONFIANZA_OCR_DUDOSA_RUT || criticoPerdido || !corroborada || !formularioLocalizado)
    : (!nitConfiable || !corroborada || !formularioLocalizado);

  return { clasificacion, datos, confianzaDocumento, lecturaDudosa, motivos, etiquetasLocalizadas: geo.etiquetas.length };
}
