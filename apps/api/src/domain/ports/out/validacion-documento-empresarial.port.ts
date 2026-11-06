import {
  DatosEvidenciaDocumentoEmpresarial, DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial,
  ValidacionDocumentoEmpresarial,
} from '../../entities/validacion-documento-empresarial.entity';

export interface DocumentoConHuella {
  documentoId: string;
  validacionId: string;
  version: number;
  hashDocumento: string;
}

/** Una fila de la bandeja de RUT: lo mínimo para priorizar y mostrar; el detalle se pide aparte. */
export interface FilaMesaRut {
  validacionId: string;
  documentoId: string;
  practicaId: string;
  estudianteId: string;
  estudianteNombre: string;
  escuelaId: string;
  empresaRazonSocial: string | null;
  tipoDocumento: string;
  fechaInicio: Date | null;
  version: number;
  cargadoEn: Date;
  estado: string;
  tipoDetectado: string | null;
  tipoPersona: string | null;
  expectativa: string | null;
  lecturaDudosa: boolean;
  veredicto: string | null;
  hayDiscrepancia: boolean;
  asignadoA: string | null;
  asignadoNombre: string | null;
  reservaHasta: Date | null;
  recibidaEn: Date | null;
  procesadaEn: Date | null;
  datosSipraCambiaronEn: Date | null;
  estadoDocumento: string;
  /** Solo las llena la consulta de la bandeja (la Mesa de Cámara las usa; las del RUT las ignoran). */
  modalidad?: string | null;
  metodoLectura?: string | null;
  /** Hay una discrepancia IMPORTANTE (representante legal distinto), no crítica. */
  discrepanciaImportante?: boolean;
  /** El certificado declara la matrícula cancelada. */
  estadoCancelado?: boolean;
}

export interface FiltroMesaRut {
  /** Tipos documentales de la bandeja; por defecto, los del RUT. La Mesa de Cámara pide `camara_comercio`. */
  tipos?: readonly string[];
  estados: readonly string[];
  /** `null` = sin restricción de escuela. */
  escuelas: readonly string[] | null;
}

export interface ResumenSupervisionRut {
  abiertas: number;
  libres: number;
  tomadas: number;
  porVencer: number;
  vencidas: number;
  conDiscrepancia: number;
  documentoIncorrecto: number;
  lecturaDudosa: number;
  personaDistinta: number;
  porEstado: Record<string, number>;
  funcionarios: { funcionarioId: string; nombre: string; rol: string; reservasVigentes: number; reservasPorVencer: number; decididas7Dias: number }[];
}

export interface ValidacionDocumentoEmpresarialRepositoryPort {
  /**
   * Reserva atómica en SQL: solo si el caso está en `revision` y está libre, vencido o ya es de quien lo pide. `false` = lo tiene otra
   * persona (o ya no es revisable). Bajo concurrencia hay UN ganador.
   */
  reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean>;
  /** Libera la reserva: quien la tiene, un supervisor, o cualquiera si ya venció. `false` = no había nada que liberar. */
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean): Promise<boolean>;
  /** Solo la ÚLTIMA versión de cada (práctica, tipo de RUT); una versión vieja es histórica y no entra a la bandeja. */
  listarMesaRut(filtro: FiltroMesaRut): Promise<FilaMesaRut[]>;
  supervisionRut(ahora: Date, escuelas: readonly string[] | null, tipos?: readonly string[]): Promise<ResumenSupervisionRut>;
  /** Mayor versión documental del tipo dado en la práctica (0 si no hay). */
  versionMaximaDocumento(practicaId: string, tipoDocumento: string): Promise<number>;
  buscarPorId(id: string): Promise<ValidacionDocumentoEmpresarial | null>;
  /** Una validación por documento (por versión): una versión nueva tiene la suya. */
  buscarPorDocumento(documentoId: string): Promise<ValidacionDocumentoEmpresarial | null>;
  listarPorPractica(practicaId: string): Promise<ValidacionDocumentoEmpresarial[]>;
  /** `ON CONFLICT DO NOTHING` sobre `documento_id`: dos procesos simultáneos terminan con UNA fila. */
  crearSiNoExiste(datos: DatosValidacionDocumentoEmpresarial): Promise<{ validacion: ValidacionDocumentoEmpresarial; creada: boolean }>;
  /** Compare-and-set por versión. `false` = otro proceso la modificó antes. */
  guardarSiVersion(datos: DatosValidacionDocumentoEmpresarial, versionEsperada: number): Promise<boolean>;
  /** Solo inserta y es idempotente por (validación, intento, tipo): `false` = ya existía. */
  agregarEvidencia(datos: DatosEvidenciaDocumentoEmpresarial): Promise<boolean>;
  listarEvidencias(validacionId: string): Promise<EvidenciaDocumentoEmpresarial[]>;
  /**
   * Otros documentos de la MISMA práctica y el MISMO tipo documental con el mismo SHA-256 (duplicados). Se reportan;
   * no se borran ni se descartan.
   */
  buscarDuplicados(practicaId: string, tipoDocumento: string, hashDocumento: string, excluirDocumentoId: string): Promise<DocumentoConHuella[]>;
}
export const VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY = Symbol('VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY');
