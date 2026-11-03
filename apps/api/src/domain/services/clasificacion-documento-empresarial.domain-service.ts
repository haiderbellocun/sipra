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
  if (matriculaPn) return resultado(C.CAMARA_MATRICULA_PERSONA_NATURAL, ['camara_titulo_matricula_persona_natural']);
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

export function clasificarDocumentoEmpresarial(textoCrudo: string | null | undefined): ResultadoClasificacionEmpresarial {
  const t = normalizarTexto(textoCrudo);
  if (t.length < MIN_CARACTERES_CLASIFICABLE) return resultado(C.NO_DETERMINABLE, ['texto_insuficiente']);

  const senalesRut = contar(t, SENALES_RUT);
  const rut = senalesRut.length >= MIN_SENALES_RUT;
  const camara = clasificarCamara(t);

  // Un RUT y un certificado de Cámara a la vez no es una lectura que se pueda sostener.
  if (rut && camara && camara.clasificacion !== C.NO_DETERMINABLE) return resultado(C.NO_DETERMINABLE, ['rut_y_camara_a_la_vez']);
  if (rut) return clasificarRut(t, senalesRut);
  if (camara) return camara;

  // Texto suficiente, sin rasgos de RUT ni de certificado: es otro documento (p. ej. una factura de una Cámara).
  return resultado(C.DOCUMENTO_INCORRECTO, ['sin_rasgos_de_rut_ni_certificado_de_camara']);
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
