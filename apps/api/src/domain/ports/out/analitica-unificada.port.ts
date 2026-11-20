import { SistemaOrigen } from '../../historico/registro-historico';

/**
 * Puertos de la capa analítica unificada (H4). Solo LECTURA: ningún adaptador de estos puertos escribe, ni en `public`
 * ni en `historico`.
 */
export const LECTURA_ANALITICA_UNIFICADA = Symbol('LECTURA_ANALITICA_UNIFICADA');

/** Práctica de SIPRA proyectada para la analítica. `documento` solo viaja si hay identidad analítica (y nunca sale). */
export interface FilaActualCruda {
  id: string;
  estudianteId: string;
  documento: string | null;
  periodo: string;
  programaId: string;
  ciclo: string;
  regional: string | null;
  modalidad: string;
  estado: string;
  empresaId: string | null;
  empresa: string | null;
  ciudadCodigo: string | null;
  ciudadNombre: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  creadaEn: string;
}

/** Versión VIGENTE de una importación `completed` del histórico (nunca `processing`, `failed` ni `reverted`). */
export interface FilaHistoricaCruda {
  sourceSystem: SistemaOrigen;
  sourceRecordId: string;
  version: number;
  hmacKeyVersion: string;
  studentKey: string | null;
  periodoOriginal: string | null;
  periodoNormalizado: string | null;
  programaNormalizado: string | null;
  codigoSinu: string | null;
  nivelInferido: string | null;
  regional: string | null;
  modalidadEstudio: string | null;
  modalidadPracticaNormalizada: string | null;
  modalidadPracticaOriginal: string | null;
  estadoAnalitico: string | null;
  esEstadoDeCorte: boolean;
  estadoFechaCorte: string | null;
  /** `historico.organizaciones.id` (uuid seguro, no la clave HMAC). */
  organizacionId: string | null;
  /** Empresa de SIPRA con correspondencia CONFIRMADA (si existe). */
  empresaConfirmadaId: string | null;
  empresaConfirmadaNombre: string | null;
  ciudadNormalizada: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  duracionDias: number | null;
  documentosSubidosRatio: number | null;
  documentosAprobadosRatio: number | null;
  bitacoraCount: number | null;
  qualityFlags: string[];
  organizationFlags: string[];
  duplicadoDe: string | null;
  fechaCreacion: string | null;
}

export interface CorrespondenciaPracticaConfirmada { sourceRecordId: string; practicaId: string }

export interface LecturaAnaliticaUnificadaPort {
  practicasActuales(f: { periodos?: readonly string[]; escuelaIds?: readonly string[]; conDocumento: boolean }): Promise<FilaActualCruda[]>;
  practicasHistoricas(f: { sistema: SistemaOrigen; periodos?: readonly string[] }): Promise<FilaHistoricaCruda[]>;
  /** Correspondencias SGP ↔ SIPRA CONFIRMADAS (`historico.practica_correspondencia`). */
  correspondenciasConfirmadas(sistema: SistemaOrigen): Promise<CorrespondenciaPracticaConfirmada[]>;
}

/**
 * Identidad analítica del estudiante actual comparable con `student_key` histórica: la clave HMAC del documento,
 * calculada SOLO en el backend analítico, en memoria, con la versión de clave pedida. Nunca se persiste ni se expone.
 */
export interface IdentidadAnaliticaPort {
  /** Versiones de clave disponibles en este proceso (vacío = sin secreto: la identidad entre fuentes no es comparable). */
  versiones(): readonly string[];
  claveEstudiante(version: string, documento: string | null): string | null;
}
