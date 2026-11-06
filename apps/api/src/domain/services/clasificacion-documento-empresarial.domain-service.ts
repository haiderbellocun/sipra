import {
  ClasificacionDocumentoEmpresarial as C, ExpectativaDocumento, FamiliaDocumentoEmpresarial, TipoPersona,
  familiaDe, personaDe,
} from '../entities/documento-empresarial';
import { normalizarTexto } from './normalizacion-identidad';

/**
 * Clasificación de un documento empresarial por su CONTENIDO (texto ya extraído; no lee archivos).
 *
 * Reglas determinísticas, sin red. El tipo que eligió el estudiante NO entra aquí: se contrasta después con
 * `evaluarExpectativa`, que informa la diferencia y NUNCA reclasifica en silencio.
 *
 * Solo códigos de motivo, nunca fragmentos del texto.
 */

export interface ResultadoClasificacionEmpresarial {
  clasificacion: C;
  familia: FamiliaDocumentoEmpresarial | null;
  tipoPersona: TipoPersona | null;
  /** Códigos de las señales que decidieron (sin texto del documento). */
  motivos: string[];
}

/** Texto utilizable mínimo para afirmar que un documento NO es lo esperado (menos = no determinable). */
export const MIN_CARACTERES_CLASIFICABLE = 120;

const SENALES_RUT: readonly [string, string][] = [
  ['rut_titulo', 'REGISTRO UNICO TRIBUTARIO'],
  ['rut_tipo_contribuyente', 'TIPO DE CONTRIBUYENTE'],
  ['rut_responsabilidades', 'RESPONSABILIDADES, CALIDADES Y ATRIBUTOS'],
  ['rut_numero_formulario', 'NUMERO DE FORMULARIO'],
  ['rut_direccion_seccional', 'DIRECCION SECCIONAL'],
  ['rut_fecha_generacion', 'FECHA GENERACION DOCUMENTO PDF'],
];
/** Con al menos estas señales distintas el documento es un formulario RUT. */
const MIN_SENALES_RUT = 3;

function contar(texto: string, senales: readonly [string, string][]): string[] {
  return senales.filter(([, frase]) => texto.includes(frase)).map(([codigo]) => codigo);
}

function resultado(clasificacion: C, motivos: string[]): ResultadoClasificacionEmpresarial {
  return { clasificacion, familia: familiaDe(clasificacion), tipoPersona: personaDe(clasificacion), motivos };
}

function clasificarRut(t: string, senales: string[]): ResultadoClasificacionEmpresarial {
  const natural = /PERSONA NATURAL O SUCESION ILIQUIDA/.test(t);
  const juridica = /PERSONA JURIDICA/.test(t);
  if (natural && juridica) return resultado(C.NO_DETERMINABLE, [...senales, 'rut_persona_ambigua']);
  if (natural) return resultado(C.RUT_PERSONA_NATURAL, [...senales, 'rut_valor_persona_natural']);
  if (juridica) return resultado(C.RUT_PERSONA_JURIDICA, [...senales, 'rut_valor_persona_juridica']);
  return resultado(C.NO_DETERMINABLE, [...senales, 'rut_sin_tipo_contribuyente']);
}

function clasificarCamara(t: string): ResultadoClasificacionEmpresarial | null {
  const existencia = /CERTIFICADO DE EXISTENCIA Y REPRESENTACION LEGAL/.test(t);
  const matriculaPn = /CERTIFICADO DE MATRICULA(?: MERCANTIL)? DE PERSONA NATURAL/.test(t);
  const matriculaGenerica = /CERTIFICADO DE MATRICULA MERCANTIL/.test(t);
  if (existencia && matriculaPn) return resultado(C.NO_DETERMINABLE, ['camara_titulos_contradictorios']);
  if (existencia) return resultado(C.CAMARA_EXISTENCIA_REPRESENTACION, ['camara_titulo_existencia_representacion']);
  if (matriculaPn) {
    // El título dice «persona natural» pero el contenido trae la identificación de una SOCIEDAD (razón social, sin nombre y
    // apellidos del comerciante): señales fuertes incompatibles; no se elige a la fuerza.
    const sociedad = /RAZON SOCIAL\s*:/.test(t);
    const comerciante = /NOMBRES? Y APELLIDOS\s*:|\bNOMBRE\s*:/.test(t);
    if (sociedad && !comerciante) return resultado(C.NO_DETERMINABLE, ['camara_titulo_persona_natural_con_contenido_de_sociedad']);
    return resultado(C.CAMARA_MATRICULA_PERSONA_NATURAL, ['camara_titulo_matricula_persona_natural']);
  }
  if (matriculaGenerica) {
    // El título no dice la persona: la dicen las etiquetas de identificación.
    const sociedad = /RAZON SOCIAL\s*:/.test(t);
    const comerciante = /NOMBRES? Y APELLIDOS\s*:/.test(t);
    if (sociedad && !comerciante) return resultado(C.CAMARA_MATRICULA_SOCIEDAD, ['camara_titulo_matricula', 'camara_etiqueta_razon_social']);
    if (comerciante && !sociedad) return resultado(C.CAMARA_MATRICULA_PERSONA_NATURAL, ['camara_titulo_matricula', 'camara_etiqueta_nombres_apellidos']);
    return resultado(C.NO_DETERMINABLE, ['camara_titulo_matricula', 'camara_persona_no_distinguible']);
  }
  return null;
}

/**
 * Rasgos de una factura o documento comercial. Una Cámara de Comercio también EMITE facturas (y cobra certificados):
 * que un documento nombre a una Cámara, un NIT, una ciudad o el RUES no lo vuelve un certificado.
 */
const SENALES_FACTURA: readonly [string, string][] = [
  ['factura_titulo', 'FACTURA ELECTRONICA'],
  ['factura_venta', 'FACTURA DE VENTA'],
  ['factura_cufe', 'CUFE'],
  ['factura_forma_pago', 'FORMA DE PAGO'],
  ['factura_medio_pago', 'MEDIO DE PAGO'],
  ['factura_subtotal', 'SUBTOTAL'],
  ['factura_total_pagar', 'TOTAL A PAGAR'],
];
/** Con al menos estas señales distintas el documento es una factura (una sola frase suelta no basta). */
const MIN_SENALES_FACTURA = 2;

/** La estructura propia de un certificado de Cámara (no el nombre del certificado): la fórmula de certificación o el código de verificación. */
function estructuraDeCertificado(t: string): boolean {
  return /\bCODIGO DE VERIFICACION\b/.test(t) || /(?:CAMARA DE COMERCIO|CAMARA)[^.]{0,30}\bCERTIFICA\s*:/.test(t) || /\bCERTIFICA QUE\b/.test(t);
}

export function clasificarDocumentoEmpresarial(textoCrudo: string | null | undefined): ResultadoClasificacionEmpresarial {
  const t = normalizarTexto(textoCrudo);
  if (t.length < MIN_CARACTERES_CLASIFICABLE) return resultado(C.NO_DETERMINABLE, ['texto_insuficiente']);

  const senalesRut = contar(t, SENALES_RUT);
  const rut = senalesRut.length >= MIN_SENALES_RUT;
  const camara = clasificarCamara(t);
  const senalesFactura = contar(t, SENALES_FACTURA);
  const factura = senalesFactura.length >= MIN_SENALES_FACTURA;

  // Un RUT y un certificado de Cámara a la vez no es una lectura que se pueda sostener.
  if (rut && camara && camara.clasificacion !== C.NO_DETERMINABLE) return resultado(C.NO_DETERMINABLE, ['rut_y_camara_a_la_vez']);
  // Una factura que COBRA un certificado lo nombra como concepto («CERTIFICADO DE MATRICULA MERCANTIL $…»): eso no lo vuelve
  // certificado. Solo si además trae la ESTRUCTURA de un certificado (la fórmula «la Cámara certifica» o el código de
  // verificación) o un RUT, hay señales fuertes de tipos incompatibles: no se elige a la fuerza, lo decide una persona.
  if (factura && (rut || estructuraDeCertificado(t))) return resultado(C.NO_DETERMINABLE, [...senalesFactura, 'factura_y_certificado_a_la_vez']);
  if (factura) {
    // Distingue «documento emitido por una Cámara» de «certificado de Cámara»: el emisor no cambia lo que el documento ES.
    return resultado(C.DOCUMENTO_INCORRECTO, [
      ...senalesFactura, ...(camara ? ['certificado_solo_como_concepto_de_factura'] : []),
      ...(t.includes('CAMARA DE COMERCIO') ? ['emitido_por_camara_no_es_certificado'] : []),
    ]);
  }
  if (rut) return clasificarRut(t, senalesRut);
  if (camara) return camara;

  // Texto suficiente, sin rasgos de RUT ni de certificado: es otro documento.
  return resultado(C.DOCUMENTO_INCORRECTO, [
    'sin_rasgos_de_rut_ni_certificado_de_camara', ...(t.includes('CAMARA DE COMERCIO') ? ['emitido_por_camara_no_es_certificado'] : []),
  ]);
}

// ── Expectativa ─────────────────────────────────────────────────────────────

export type ResultadoExpectativa =
  | 'coincide'
  | 'persona_distinta'
  | 'familia_distinta'
  | 'documento_incorrecto'
  | 'no_determinable';

export interface EvaluacionExpectativa {
  resultado: ResultadoExpectativa;
  /** ¿Sirve como documento de esa familia (RUT / Cámara) aunque la persona no coincida? */
  validoComoFamilia: boolean;
  esperada: ExpectativaDocumento;
  /** Lo detectado, tal cual: nunca se sustituye por lo esperado. */
  detectada: { clasificacion: C; familia: FamiliaDocumentoEmpresarial | null; tipoPersona: TipoPersona | null };
}

/**
 * Contrasta lo que eligió el estudiante con lo que el documento ES. No modifica la clasificación.
 * RUT de persona jurídica subido como «RUT persona natural» → `persona_distinta` y `validoComoFamilia = true`.
 */
export function evaluarExpectativa(esperada: ExpectativaDocumento, detectado: ResultadoClasificacionEmpresarial): EvaluacionExpectativa {
  const detectada = { clasificacion: detectado.clasificacion, familia: detectado.familia, tipoPersona: detectado.tipoPersona };
  const base = { esperada, detectada };
  if (detectado.clasificacion === C.NO_DETERMINABLE) return { ...base, resultado: 'no_determinable', validoComoFamilia: false };
  if (detectado.clasificacion === C.DOCUMENTO_INCORRECTO) return { ...base, resultado: 'documento_incorrecto', validoComoFamilia: false };
  if (detectado.familia !== esperada.familia) return { ...base, resultado: 'familia_distinta', validoComoFamilia: false };
  if (esperada.persona !== null && detectado.tipoPersona !== esperada.persona) {
    return { ...base, resultado: 'persona_distinta', validoComoFamilia: true };
  }
  return { ...base, resultado: 'coincide', validoComoFamilia: true };
}
