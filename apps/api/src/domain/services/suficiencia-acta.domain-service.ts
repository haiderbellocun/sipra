import { CampoActa, CamposActaLeidos, ClasificacionActa } from '../entities/acta-iniciacion';
import { CONFIANZA_MINIMA_ACTA } from './extraccion-acta.domain-service';

/**
 * Suficiencia de la lectura del ACTA. No se reutiliza la del certificado de EPS: aquel se mide por
 * tres campos clave de una persona; el acta es un formato con estructura propia, y un acta puede
 * estar perfectamente leída y aun así en blanco.
 *
 * Dos preguntas distintas:
 *  · `paraClasificar`: ¿lo leído alcanza para decir qué es el documento? (acta, o claramente otra cosa).
 *    Un texto vacío o que no alcanza NO es «no es un acta»: es «no pude leerlo».
 *  · `paraComparar`: ¿es un acta y se leyeron datos suficientes para contrastarla con SIPRA?
 *
 * No se exige que estén todas las señales: un acta sin firmar, sin NIT o con la fecha ilegible se
 * lee igual; lo que falte lo señala la comparación, no la lectura.
 */

export interface SuficienciaActa {
  paraClasificar: boolean;
  paraComparar: boolean;
  /** Señales principales presentes en lo leído (informativo). */
  senales: {
    titulo: boolean;
    estudiante: boolean;
    empresa: boolean;
    fechaInicio: boolean;
    remuneracion: boolean;
    responsableArl: boolean;
  };
  /** Cuántas de las señales principales se leyeron. */
  senalesLeidas: number;
  camposClaveLeidos: number;
}

/** Campos con los que se identifica a quien y dónde: sin al menos tres, no hay con qué comparar. */
export const CAMPOS_CLAVE_COMPARACION: readonly CampoActa[] = [
  'nombre_estudiante', 'documento_estudiante', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin',
];
export const MIN_CAMPOS_CLAVE_PARA_COMPARAR = 3;

const leido = (campos: CamposActaLeidos, nombre: CampoActa): boolean =>
  campos[nombre].valor !== null && campos[nombre].confianza >= CONFIANZA_MINIMA_ACTA;

export function evaluarSuficienciaActa(clasificacion: ClasificacionActa, campos: CamposActaLeidos): SuficienciaActa {
  const esActa = clasificacion.tipoActaDetectada === 'iniciacion_practicas';
  const decisiva = esActa || clasificacion.tipoActaDetectada === 'documento_incorrecto';
  const camposClaveLeidos = CAMPOS_CLAVE_COMPARACION.filter((c) => leido(campos, c)).length;
  const senales = {
    titulo: clasificacion.motivos.includes('titulo_reconocido'),
    estudiante: leido(campos, 'nombre_estudiante') || leido(campos, 'documento_estudiante'),
    empresa: leido(campos, 'empresa') || leido(campos, 'nit'),
    fechaInicio: leido(campos, 'fecha_inicio'),
    remuneracion: clasificacion.remuneracion !== 'no_determinable',
    responsableArl: clasificacion.responsableArl !== 'no_determinable',
  };
  return {
    paraClasificar: decisiva,
    paraComparar: esActa && camposClaveLeidos >= MIN_CAMPOS_CLAVE_PARA_COMPARAR,
    senales,
    senalesLeidas: Object.values(senales).filter(Boolean).length,
    camposClaveLeidos,
  };
}
