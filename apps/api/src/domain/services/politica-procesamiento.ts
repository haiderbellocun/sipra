import { TIPOS_CON_DECISION_ESPECIALIZADA, TipoDocumento } from '../entities/documento.entity';

export { TIPOS_CON_DECISION_ESPECIALIZADA };

/**
 * Política de procesamiento por tipo documental.
 *
 *  · `procesamiento_local`: el documento se lee solo con extractores locales y
 *    determinísticos. Nunca sale a un proveedor externo de IA (OpenAI,
 *    Anthropic), y si no hay extractor local disponible NO se recurre a uno
 *    externo: el documento queda para revisión humana.
 *  · `configurado`: el extractor que fije la configuración (`IA_DRIVER`).
 *
 * El certificado de EPS es dato de salud con documento de identidad: se
 * procesa en local. El acta de iniciación lleva documento, dirección y teléfono
 * del estudiante y datos del representante de la empresa: también. El RUT trae cédula, dirección, correo y teléfono (persona
 * natural) o datos de la empresa: también se lee solo en local, y NUNCA se autoaprueba (consistente ≠ aprobado). El certificado de Cámara de Comercio también: trae
 el nombre y la identificación del comerciante o el representante de la empresa, se lee solo en local y la decisión es humana
 (tampoco hay verificación oficial todavía: la autenticidad es `no_verificable`). Cambiar esto
 * es una decisión institucional, no técnica.
 */
export enum ModoProcesamiento {
  LOCAL = 'procesamiento_local',
  CONFIGURADO = 'configurado',
}

const SOLO_LOCAL: readonly TipoDocumento[] = [
  TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO,
  TipoDocumento.CAMARA_COMERCIO,
];

export function modoProcesamientoDe(tipo: TipoDocumento): ModoProcesamiento {
  return SOLO_LOCAL.includes(tipo) ? ModoProcesamiento.LOCAL : ModoProcesamiento.CONFIGURADO;
}

/**
 * Tipos que el pipeline NUNCA autoaprueba: su autenticidad no la verifica el
 * pipeline común. Quedan en revisión humana aunque el puntaje sea verde.
 */
const SIN_AUTOAPROBACION_DEL_PIPELINE: readonly TipoDocumento[] = [
  TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO,
  TipoDocumento.CAMARA_COMERCIO,
];

/**
 * ¿El pipeline GENÉRICO puede autoaprobar este tipo por la banda verde? Nunca los tipos sin autoaprobación del pipeline
 * (arriba) ni los tipos con DECISIÓN ESPECIALIZADA (EPS, RUT, Cámara, ARL: §7.36), que solo aprueba su política
 * especializada. No depende de ningún interruptor: con el motor apagado, esos tipos quedan en revisión.
 */
export function permiteAutoAprobacionDelPipeline(tipo: TipoDocumento): boolean {
  return !SIN_AUTOAPROBACION_DEL_PIPELINE.includes(tipo) && !TIPOS_CON_DECISION_ESPECIALIZADA.includes(tipo);
}
