import {
  DocumentoDeExpediente, EstadoHumanoDocumento, PrioridadExpediente, ProgresoExpediente,
} from '../../domain/services/expediente-documental.domain-service';

/**
 * Contratos de la Mesa de Validación Documental. Son de PRESENTACIÓN y de orquestación: nada aquí decide ni valida. Para ver el
 * resultado de un motor (comparación, visor, evidencia) o decidir, se usa el endpoint del propio motor con `validacionId`.
 */

export type { DocumentoDeExpediente, ProgresoExpediente, PrioridadExpediente };

export interface EncabezadoExpedienteDto {
  practicaId: string;
  estudiante: { id: string; nombre: string; documentoEnmascarado: string };
  modalidad: string;
  modalidadEtiqueta: string;
  periodo: string;
  escuelaId: string;
  docente: string | null;
  empresa: string | null;
  estadoPractica: string;
  fechaInicio: string | null;
}

/** Una chip de documento dentro de una fila de la cola (el detalle trae el contrato completo). */
export interface ResumenDocumentoDto {
  tipoDocumento: string;
  nombreHumano: string;
  motor: string;
  estadoHumano: EstadoHumanoDocumento;
  estadoHumanoEtiqueta: string;
  /** Solo si alguien lo tiene reservado: «Tomado por Juan · 8 min». */
  reserva: { estado: 'libre' | 'mia' | 'otro' | 'vencida'; por: string | null; minutosRestantes: number | null };
  obligatorio: boolean;
}

export interface ItemExpedienteDto extends EncabezadoExpedienteDto {
  progreso: ProgresoExpediente;
  indicadores: { criticos: number; informacionInsuficiente: number; reenvios: number; conDiscrepancias: number; misDocumentos: number; reservasPorVencer: number };
  documentos: ResumenDocumentoDto[];
  /** Quién trabaja documentos de este expediente ahora (reservas vigentes), con cuántos. */
  funcionariosTrabajando: { nombre: string; documentos: number; esUsted: boolean }[];
  prioridad: PrioridadExpediente;
  /** Desde cuándo espera el documento más antiguo por revisar (ISO). */
  esperandoDesde: string | null;
  diasEsperando: number;
}

export interface ListadoExpedientesDto {
  kpis: {
    expedientes: number; conPendientes: number; conProblemas: number; misDocumentos: number; reservasPorVencer: number;
    /** Documentos que una persona puede revisar ahora (disponibles o en revisión). */
    documentosPorRevisar: number;
  };
  total: number;
  /** Hubo más expedientes que el tope de la consulta. */
  truncado: boolean;
  items: ItemExpedienteDto[];
}

export interface ExpedienteDto {
  encabezado: EncabezadoExpedienteDto;
  progreso: ProgresoExpediente;
  documentos: DocumentoDeExpediente[];
  /** Orden de navegación (anterior / siguiente / siguiente pendiente). */
  ordenNavegacion: string[];
  /** Primer documento que esta persona puede revisar (para abrirlo por defecto), o `null`. */
  siguientePendiente: string | null;
  prioridad: PrioridadExpediente;
}

export interface VersionDocumentoDto {
  documentoId: string;
  version: number;
  vigente: boolean;
  estadoHumano: EstadoHumanoDocumento;
  estadoHumanoEtiqueta: string;
  estadoInterno: string;
  cargadaEn: string;
  /** Lo que se le dijo al estudiante al devolverla, si aplica. */
  motivoDevolucion: string | null;
}

export interface SupervisionDocumentalDto {
  expedientesAbiertos: number;
  documentosPorRevisar: number;
  documentosSinCargar: number;
  aprobadosHoy: number;
  devueltos: number;
  rechazados: number;
  informacionInsuficiente: number;
  discrepancias: number;
  reservasActivas: number;
  reservasPorVencer: number;
  reservasVencidas: number;
  porMotor: Record<string, { porRevisar: number; aprobados: number; devueltos: number; rechazados: number }>;
  funcionarios: {
    funcionarioId: string; nombre: string; reservasVigentes: number; reservasPorVencer: number;
    documentos: { practicaId: string; estudiante: string; tipoDocumento: string; nombreHumano: string; motor: string; hasta: string; vencida: boolean }[];
  }[];
  /** Expedientes con una reserva vencida (para abrirlos desde aquí). */
  conReservaVencida: { practicaId: string; estudiante: string; documentos: number }[];
}
