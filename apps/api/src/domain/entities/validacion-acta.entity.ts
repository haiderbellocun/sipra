import {
  CampoActa, CampoLeidoActa, ComparacionActaPersistida, Presencia, Remuneracion, ResponsableArlActa, TipoActaDetectada,
} from './acta-iniciacion';

/**
 * Validación de un acta de iniciación: lo que se INTERPRETÓ de un documento (una por documento, es decir, por
 * versión del acta). El documento sigue siendo el archivo y su versión; esto es el resultado.
 *
 * Nada aquí aprueba un acta. `revision` significa «lista para que una persona la decida»; las decisiones humanas
 * (`aprobado_manual`, `devuelto`, `rechazado`) las registra la Mesa o la decisión general del documento, y el
 * acta NUNCA modifica a SIPRA: confirma o contradice lo que la práctica ya dice.
 */

export enum EstadoValidacionActa {
  PENDIENTE = 'pendiente',
  PROCESANDO = 'procesando',
  /** Leída y comparada: espera a una persona. También es el estado de un documento incorrecto o no determinable. */
  REVISION = 'revision',
  APROBADO_MANUAL = 'aprobado_manual',
  DEVUELTO = 'devuelto',
  RECHAZADO = 'rechazado',
  /** El procesamiento falló; un reintento lo reanuda. */
  ERROR = 'error',
}

export const ESTADOS_DECIDIDOS_ACTA: readonly EstadoValidacionActa[] = [
  EstadoValidacionActa.APROBADO_MANUAL, EstadoValidacionActa.DEVUELTO, EstadoValidacionActa.RECHAZADO,
];

export type DecisionActa = 'aprobar' | 'devolver' | 'rechazar';
const ESTADO_POR_DECISION: Readonly<Record<DecisionActa, EstadoValidacionActa>> = {
  aprobar: EstadoValidacionActa.APROBADO_MANUAL,
  devolver: EstadoValidacionActa.DEVUELTO,
  rechazar: EstadoValidacionActa.RECHAZADO,
};

export class ValidacionActaYaDecididaError extends Error {
  constructor(estado: EstadoValidacionActa) {
    super(`La validación del acta ya fue decidida (${estado}) y no admite otro procesamiento`);
    this.name = 'ValidacionActaYaDecididaError';
  }
}

export interface DatosValidacionActa {
  id: string;
  documentoId: string;
  practicaId: string;
  estudianteId: string;
  estado: EstadoValidacionActa;
  /** Cuántas veces entró a «procesando» desde pendiente/error. Identifica la ronda de evidencias. */
  intentos: number;
  errorCodigo: string | null;
  tipoActaDetectada: TipoActaDetectada | null;
  remuneracionDetectada: Remuneracion | null;
  responsableArlDetectado: ResponsableArlActa | null;
  firmaEmpresa: Presencia | null;
  firmaPracticante: Presencia | null;
  metodoLectura: 'texto' | 'ocr' | null;
  /** 0–1. */
  confianza: number | null;
  motivosClasificacion: string[];
  /** Campos leídos que se conservan (lista blanca). Nunca el texto del documento. */
  datosExtraidos: { campos: Partial<Record<CampoActa, CampoLeidoActa>> } | null;
  comparacion: ComparacionActaPersistida | null;
  hayDiscrepanciaCritica: boolean;
  recibidaEn: Date | null;
  procesadaEn: Date | null;
  decididoPor: string | null;
  decididoEn: Date | null;
  version: number;
  creadaEn: Date;
  actualizadaEn: Date;
}

/** Lo que fija un procesamiento terminado. */
export interface ResultadoProcesamientoActa {
  tipoActaDetectada: TipoActaDetectada;
  remuneracionDetectada: Remuneracion;
  responsableArlDetectado: ResponsableArlActa;
  firmaEmpresa: Presencia;
  firmaPracticante: Presencia;
  metodoLectura: 'texto' | 'ocr' | null;
  confianza: number | null;
  motivosClasificacion: string[];
  datosExtraidos: DatosValidacionActa['datosExtraidos'];
  comparacion: ComparacionActaPersistida | null;
  hayDiscrepanciaCritica: boolean;
}

export class ValidacionActa {
  private constructor(private datos: DatosValidacionActa) {}

  static desde(datos: DatosValidacionActa): ValidacionActa {
    return new ValidacionActa({ ...datos, motivosClasificacion: [...datos.motivosClasificacion] });
  }

  static pendiente(base: {
    id: string; documentoId: string; practicaId: string; estudianteId: string; recibidaEn: Date | null; ahora: Date;
  }): ValidacionActa {
    return new ValidacionActa({
      id: base.id, documentoId: base.documentoId, practicaId: base.practicaId, estudianteId: base.estudianteId,
      estado: EstadoValidacionActa.PENDIENTE, intentos: 0, errorCodigo: null,
      tipoActaDetectada: null, remuneracionDetectada: null, responsableArlDetectado: null,
      firmaEmpresa: null, firmaPracticante: null, metodoLectura: null, confianza: null,
      motivosClasificacion: [], datosExtraidos: null, comparacion: null, hayDiscrepanciaCritica: false,
      recibidaEn: base.recibidaEn, procesadaEn: null, decididoPor: null, decididoEn: null,
      version: 1, creadaEn: base.ahora, actualizadaEn: base.ahora,
    });
  }

  get id(): string { return this.datos.id; }
  get documentoId(): string { return this.datos.documentoId; }
  get estado(): EstadoValidacionActa { return this.datos.estado; }
  get version(): number { return this.datos.version; }
  get intentos(): number { return this.datos.intentos; }
  get estaDecidida(): boolean { return ESTADOS_DECIDIDOS_ACTA.includes(this.datos.estado); }
  /** Ya tiene un resultado de lectura (en revisión o decidida). Reprocesarla no hace falta ni se hace. */
  get estaProcesada(): boolean { return this.datos.estado === EstadoValidacionActa.REVISION || this.estaDecidida; }

  instantanea(): DatosValidacionActa { return { ...this.datos, motivosClasificacion: [...this.datos.motivosClasificacion] }; }

  /**
   * Empieza (o reanuda) el procesamiento. Desde pendiente o error abre una ronda nueva (`intentos + 1`); si ya estaba
   * «procesando» (un intento interrumpido) conserva su ronda, de modo que repetirlo no duplica evidencias.
   */
  iniciarProcesamiento(ahora: Date): void {
    if (this.estaProcesada) throw new ValidacionActaYaDecididaError(this.datos.estado);
    if (this.datos.estado !== EstadoValidacionActa.PROCESANDO) this.datos.intentos += 1;
    this.datos.estado = EstadoValidacionActa.PROCESANDO;
    this.datos.errorCodigo = null;
    this.datos.actualizadaEn = ahora;
  }

  registrarResultado(r: ResultadoProcesamientoActa, ahora: Date): void {
    if (this.estaProcesada) throw new ValidacionActaYaDecididaError(this.datos.estado);
    this.datos = {
      ...this.datos, ...r, motivosClasificacion: [...r.motivosClasificacion],
      estado: EstadoValidacionActa.REVISION, errorCodigo: null, procesadaEn: ahora, actualizadaEn: ahora,
    };
  }

  marcarError(codigo: string, ahora: Date): void {
    if (this.estaProcesada) throw new ValidacionActaYaDecididaError(this.datos.estado);
    this.datos.estado = EstadoValidacionActa.ERROR;
    this.datos.errorCodigo = codigo;
    this.datos.actualizadaEn = ahora;
  }

  /** Refleja una decisión humana. No cambia ningún resultado de lectura. */
  registrarDecision(decision: DecisionActa, actorId: string, ahora: Date): void {
    if (this.estaDecidida) throw new ValidacionActaYaDecididaError(this.datos.estado);
    this.datos.estado = ESTADO_POR_DECISION[decision];
    this.datos.errorCodigo = null;
    this.datos.decididoPor = actorId;
    this.datos.decididoEn = ahora;
    this.datos.actualizadaEn = ahora;
  }
}

// ── Evidencias (solo inserción) ─────────────────────────────────────────────

export enum TipoEvidenciaActa {
  LECTURA_DOCUMENTO = 'lectura_documento',
  CLASIFICACION_DOCUMENTAL = 'clasificacion_documental',
  COMPARACION = 'comparacion',
  MEDICION_FIRMAS = 'medicion_firmas',
  PROCESAMIENTO = 'procesamiento',
  DECISION_HUMANA = 'decision_humana',
}

/** Claves que nunca van en una evidencia (la base también las rechaza): texto del documento e imágenes de firma. */
export const CLAVES_PROHIBIDAS_EVIDENCIA_ACTA: readonly string[] = [
  'texto', 'texto_ocr', 'texto_nativo', 'ocr', 'imagen', 'imagen_firma', 'firma_imagen',
  'token', 'password', 'secreto', 'cookie', 'authorization',
];

export class EvidenciaActaInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Evidencia del acta no válida: ${motivo}`);
    this.name = 'EvidenciaActaInvalidaError';
  }
}

export interface DatosEvidenciaActa {
  id: string;
  validacionActaId: string;
  /** Ronda de procesamiento de la validación; junto con el tipo identifica la evidencia (idempotencia). */
  intento: number;
  tipo: TipoEvidenciaActa;
  resultado: string;
  metodo: string;
  fecha: Date;
  /** `null` = el sistema; con valor, la persona que actuó. */
  actorId: string | null;
  hashDocumento: string | null;
  datos: Record<string, unknown>;
  errorCodigo: string | null;
  creadoEn: Date;
}

export class EvidenciaActa {
  private constructor(private readonly datos: DatosEvidenciaActa) {}

  static crear(datos: DatosEvidenciaActa): EvidenciaActa {
    if (datos.tipo === TipoEvidenciaActa.DECISION_HUMANA && !datos.actorId) {
      throw new EvidenciaActaInvalidaError('una decisión humana dice quién la tomó');
    }
    const prohibidas = Object.keys(datos.datos).filter((k) => CLAVES_PROHIBIDAS_EVIDENCIA_ACTA.includes(k));
    if (prohibidas.length > 0) throw new EvidenciaActaInvalidaError(`claves no admitidas: ${prohibidas.join(', ')}`);
    if (datos.hashDocumento !== null && !/^[0-9a-f]{64}$/.test(datos.hashDocumento)) {
      throw new EvidenciaActaInvalidaError('el hash del documento no es un SHA-256');
    }
    return new EvidenciaActa({ ...datos, datos: { ...datos.datos } });
  }

  static desde(datos: DatosEvidenciaActa): EvidenciaActa { return new EvidenciaActa({ ...datos, datos: { ...datos.datos } }); }
  instantanea(): DatosEvidenciaActa { return { ...this.datos, datos: { ...this.datos.datos } }; }
}
