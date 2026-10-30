import { Presencia, Remuneracion, ResponsableArlActa, TipoActaDetectada } from '../../entities/acta-iniciacion';
import {
  DatosEvidenciaActa, DatosValidacionActa, EstadoValidacionActa, EvidenciaActa, ValidacionActa,
} from '../../entities/validacion-acta.entity';

/** Un caso de la Mesa de Actas con lo necesario para la bandeja (un solo viaje a la base). Solo la versión vigente del acta. */
export interface FilaMesaActa {
  validacionId: string;
  documentoId: string;
  practicaId: string;
  estudianteId: string;
  estudianteNombre: string;
  escuelaId: string;
  empresaRazonSocial: string | null;
  modalidad: string;
  fechaInicio: Date | null;
  /** Versión del documento (v1, v2…). */
  version: number;
  cargadoEn: Date;
  estado: EstadoValidacionActa;
  tipoActaDetectada: TipoActaDetectada | null;
  remuneracionDetectada: Remuneracion | null;
  responsableArlDetectado: ResponsableArlActa | null;
  firmaEmpresa: Presencia | null;
  firmaPracticante: Presencia | null;
  hayDiscrepanciaCritica: boolean;
  /** Veredicto de la comparación guardada (`consistente` / `revision_necesaria`), si se comparó. */
  veredicto: string | null;
  asignadoA: string | null;
  asignadoNombre: string | null;
  reservaHasta: Date | null;
  recibidaEn: Date | null;
  procesadaEn: Date | null;
  datosPracticaCambiaronEn: Date | null;
  /** Estado del documento. Un documento terminal con la validación en `revision` es una inconsistencia operativa heredada. */
  estadoDocumento: string;
}

export interface FiltroMesaActa {
  /** Estados a listar. La bandeja operativa usa `revision`; supervisión puede pedir más. */
  estados: readonly EstadoValidacionActa[];
  /** Escuelas del alcance del actor (`null` = sin restricción). */
  escuelas: readonly string[] | null;
}

export interface ResumenSupervisionActa {
  /** Casos en revisión (versión vigente). */
  abiertas: number;
  libres: number;
  tomadas: number;
  /** Reservas vigentes que vencen en los próximos minutos. */
  porVencer: number;
  /** Reservas ya vencidas (el caso vuelve a estar disponible). */
  vencidas: number;
  porEstado: Record<string, number>;
  /** Casos «Documento decidido + Validación en revisión» (estado heredado de antes de la decisión atómica). Solo se detectan: no se corrigen solos. */
  inconsistentes: number;
  /** Hasta `TOPE_INCONSISTENCIAS_ACTA` casos, para la reconciliación controlada. */
  inconsistencias: { validacionId: string; documentoId: string; estadoDocumento: string; version: number }[];
  conDiscrepanciaCritica: number;
  documentoIncorrecto: number;
  funcionarios: {
    funcionarioId: string; nombre: string; rol: string; reservasVigentes: number; reservasPorVencer: number;
    decididas7Dias: number;
  }[];
}

/** Cuántos minutos faltan para que se considere «por vencer» una reserva. */
export const MINUTOS_RESERVA_POR_VENCER = 5;

export interface ValidacionActaRepositoryPort {
  buscarPorId(id: string): Promise<ValidacionActa | null>;
  /** Una validación por documento, y un documento por versión del acta: una versión nueva tiene la suya. */
  buscarPorDocumento(documentoId: string): Promise<ValidacionActa | null>;
  listarPorPractica(practicaId: string): Promise<ValidacionActa[]>;
  /**
   * Crea la validación del documento si aún no existe (`ON CONFLICT DO NOTHING` sobre `documento_id`): dos procesos
   * simultáneos terminan con UNA sola fila.
   */
  crearSiNoExiste(datos: DatosValidacionActa): Promise<{ validacion: ValidacionActa; creada: boolean }>;
  /**
   * Compare-and-set por versión: actualiza solo si la fila sigue en `versionEsperada` y la incrementa. `false` =
   * otro proceso la modificó antes.
   */
  guardarSiVersion(datos: DatosValidacionActa, versionEsperada: number): Promise<boolean>;
  /**
   * Solo inserta (las evidencias son append-only) y es idempotente por (validación, intento, tipo): `false` = esa
   * evidencia ya existía y no se duplicó.
   */
  agregarEvidencia(datos: DatosEvidenciaActa): Promise<boolean>;
  listarEvidencias(validacionActaId: string): Promise<EvidenciaActa[]>;
  /**
   * Reserva atómica: una sola sentencia condicional que tiene éxito solo si el caso está en `revision` y nadie más tiene una
   * reserva vigente. `false` = otra persona lo tiene (o ya no es revisable).
   */
  reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean>;
  /** Libera la reserva propia (o cualquiera si es supervisor, o una vencida). */
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean): Promise<boolean>;
  /** Casos de la versión vigente de cada acta, los más antiguos primero. Tope de seguridad: 2000. */
  listarMesa(filtro: FiltroMesaActa): Promise<FilaMesaActa[]>;
  supervisionMesa(ahora: Date, escuelas: readonly string[] | null): Promise<ResumenSupervisionActa>;
}
export const TOPE_LISTADO_MESA_ACTA = 2000;
export const TOPE_INCONSISTENCIAS_ACTA = 50;
/** Estados terminales del documento: si la validación sigue en `revision`, el caso está inconsistente. */
export const ESTADOS_DOCUMENTO_TERMINALES = ['aprobado', 'devuelto', 'rechazado'] as const;
export const VALIDACION_ACTA_REPOSITORY = Symbol('VALIDACION_ACTA_REPOSITORY');
