import { TipoDocumento } from '../entities/documento.entity';

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
 * del estudiante y datos del representante de la empresa: también. Cambiar esto
 * es una decisión institucional, no técnica.
 */
export enum ModoProcesamiento {
  LOCAL = 'procesamiento_local',
  CONFIGURADO = 'configurado',
}

const SOLO_LOCAL: readonly TipoDocumento[] = [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO];

export function modoProcesamientoDe(tipo: TipoDocumento): ModoProcesamiento {
  return SOLO_LOCAL.includes(tipo) ? ModoProcesamiento.LOCAL : ModoProcesamiento.CONFIGURADO;
}

/**
 * Tipos que el pipeline NUNCA autoaprueba: su autenticidad no la verifica el
 * pipeline común. Quedan en revisión humana aunque el puntaje sea verde.
 */
const SIN_AUTOAPROBACION_DEL_PIPELINE: readonly TipoDocumento[] = [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO];

export function permiteAutoAprobacionDelPipeline(tipo: TipoDocumento): boolean {
  return !SIN_AUTOAPROBACION_DEL_PIPELINE.includes(tipo);
}
