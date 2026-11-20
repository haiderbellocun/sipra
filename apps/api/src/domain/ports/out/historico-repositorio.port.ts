import { MarcaCalidad } from '../../historico/calidad-historico';
import { FilaFuente, RegistroHistorico, SistemaOrigen, VersionVigente } from '../../historico/registro-historico';

/**
 * Puertos del histórico del SGP (esquema `historico`, separado de la operación). Ningún adaptador de estos puertos
 * escribe en tablas operativas (`practicas`, `usuarios`, `empresas`, `documentos`, `obligaciones`, `auditoria`…).
 */

export interface MetadatosArchivo {
  nombre: string;
  sha256: string;
  tamanoBytes: number;
}

export interface EstadisticasLectura {
  /** Filas de datos con al menos una celda (sin la cabecera): lo que `pandas` reporta como `shape[0]`. */
  filasFisicas: number;
  /** Filas con `#` no vacío: los registros reales. */
  filasReales: number;
  /** Filas descartadas por no tener `#` (p. ej. el relleno accidental de `Nombre Asignatura`). */
  filasDescartadas: number;
  ultimaFilaConDatos: number;
}

/** Fuente de filas del SGP (el Excel). Solo entrega filas REALES y solo las columnas que la minimización permite. */
export interface FuenteSgp {
  metadatos(): Promise<MetadatosArchivo>;
  filasReales(alProgreso?: (estadisticas: EstadisticasLectura) => void): AsyncIterable<FilaFuente>;
  estadisticas(): EstadisticasLectura;
}

export type EstadoImportacion = 'processing' | 'completed' | 'failed' | 'reverted';

export interface SolicitudAplicacion {
  sourceSystem: SistemaOrigen;
  archivo: MetadatosArchivo;
  fechaCorte: string | null;
  hmacKeyVersion: string;
  importerVersion: string;
  estadisticas: EstadisticasLectura;
  registros: readonly RegistroHistorico[];
  /** Resumen agregado SIN datos personales para `metadata`. */
  metadata: Record<string, unknown>;
  /**
   * `single`: una transacción. `batched`: lotes confirmados como versiones NO vigentes bajo un bloqueo de sesión y una
   * finalización atómica; nada es vigente ni `completed` hasta el final, y un fallo deja la importación `failed` y
   * purga sus versiones. Por omisión, `batched`.
   */
  modoCarga?: 'single' | 'batched';
}

export type ResultadoAplicacion =
  | { resultado: 'ALREADY_IMPORTED'; importacionId: string }
  | {
    resultado: 'COMPLETED';
    importacionId: string;
    nuevos: number;
    versionados: number;
    sinCambios: number;
    observados: number;
    ausentes: number;
  };

export interface ResultadoReversion {
  importacionId: string;
  versionesRetiradas: number;
  vigentesRestituidas: number;
}

export interface ConteoMarcas { marca: MarcaCalidad; filas: number }

/** Práctica actual de SIPRA para el cruce de solapamiento (solo lectura; el documento solo vive en memoria). */
export interface PracticaActualCruda {
  id: string;
  documento: string | null;
  periodo: string;
  ciclo: string;
  modalidad: string;
  estado: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  creadaEn: string;
  /** `#` del SGP si la práctica lo conservara. Hoy no existe ese dato (P-42): siempre `null`. */
  sgpId: string | null;
}

export interface ResultadoPropuestas {
  /** Organizaciones jurídicas con NIT y DV válidos sin correspondencia previa. */
  evaluadas: number;
  /** Con exactamente una empresa de SIPRA de mismo NIT base y DV compatible. */
  conCandidatoUnico: number;
  /** Escritas como `propuesta` (solo si se pidió aplicar). */
  propuestasCreadas: number;
}

export interface HistoricoRepositorio {
  /** Lectura pura: id de la importación `completed` del mismo archivo, si existe. */
  importacionCompletada(sourceSystem: SistemaOrigen, sha256: string): Promise<string | null>;
  /** Lectura pura: versión vigente por `source_record_id`. */
  vigentes(sourceSystem: SistemaOrigen): Promise<Map<string, VersionVigente>>;
  /**
   * Atómica: bloqueo consultivo por sistema de origen, re-chequeo de idempotencia, planificación dentro del bloqueo,
   * escritura por lotes y refresco de organizaciones, todo en UNA transacción. Si falla, no queda nada a medias.
   */
  aplicar(solicitud: SolicitudAplicacion): Promise<ResultadoAplicacion>;
  /** Deja constancia de una importación fallida (sin datos personales). Nunca escribe registros. */
  registrarFallo(solicitud: Omit<SolicitudAplicacion, 'registros'>, motivo: string): Promise<string>;
  /** La unidad de reversión es la IMPORTACIÓN (nunca un `source_record_id` suelto). */
  revertir(importacionId: string): Promise<ResultadoReversion>;
  /** Lectura pura de las prácticas de SIPRA para el cruce de solapamiento. */
  practicasActuales(): Promise<PracticaActualCruda[]>;
  /**
   * Correspondencia SEGURA organización histórica → empresa de SIPRA: NIT base exacto, DV compatible y candidato
   * único. Nunca por nombre. Con `aplicar = false` solo cuenta; con `true` escribe propuestas (status `propuesta`),
   * nunca confirmadas. No escribe en `public`.
   */
  proponerCorrespondencias(sourceSystem: SistemaOrigen, aplicar: boolean): Promise<ResultadoPropuestas>;
}

/** El repositorio ya dejó constancia `failed` (y purgó las versiones): quien llama no debe registrar otra. */
export class ImportacionFallidaError extends Error {
  constructor(public readonly importacionId: string, public readonly causa: Error) {
    super(`La importación ${importacionId} falló y quedó «failed» sin versiones vigentes: ${causa.name}: ${causa.message}`.slice(0, 600));
    this.name = 'ImportacionFallidaError';
  }
}

export class ImportacionEnCursoError extends Error {
  constructor(sistema: string) {
    super(`IMPORT_IN_PROGRESS: ya hay una importación aplicándose para ${sistema}; no se permiten dos simultáneas`);
    this.name = 'ImportacionEnCursoError';
  }
}

export class ReversionNoPermitidaError extends Error {
  constructor(motivo: string) {
    super(`Reversión no permitida: ${motivo}`);
    this.name = 'ReversionNoPermitidaError';
  }
}

export class VersionClaveIncompatibleError extends Error {
  constructor(existente: string, nueva: string) {
    super(`Los registros vigentes usan la versión de clave ${existente} y esta importación usa ${nueva}: la rotación de clave no está implementada (H2)`);
    this.name = 'VersionClaveIncompatibleError';
  }
}
