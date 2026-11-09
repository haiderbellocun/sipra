import { EstadoDocumento, TipoDocumento } from '../../entities/documento.entity';
import { ValidacionActa } from '../../entities/validacion-acta.entity';
import { ValidacionDocumentoEmpresarial } from '../../entities/validacion-documento-empresarial.entity';
import { ValidacionEps } from '../../entities/validacion-eps.entity';

/**
 * Lectura POR LOTES para la Mesa de Validación Documental. Es solo lectura: no reserva, no decide y no escribe. Devuelve, para un
 * conjunto de prácticas, sus documentos (todas las versiones) y las validaciones de cada motor especializado indexadas por
 * documento, en un número FIJO de consultas (sin N+1 por expediente ni por documento).
 */

export interface PracticaDeExpediente {
  id: string;
  estudianteId: string;
  estudianteNombre: string;
  estudianteDocumento: string | null;
  modalidad: string;
  periodoAcademico: string;
  escuelaId: string;
  empresaId: string | null;
  empresaRazonSocial: string | null;
  tutorId: string | null;
  tutorNombre: string | null;
  estado: string;
  fechaInicio: Date | null;
}

export interface DocumentoDeLectura {
  id: string;
  practicaId: string;
  tipo: TipoDocumento;
  version: number;
  estado: EstadoDocumento;
  nombreOriginal: string;
  cargadoEn: Date;
  actualizadoEn: Date;
  motivoDevolucion: string | null;
}

export interface FiltroExpedientes {
  /** `null` = sin restricción de alcance (administración, auxiliar, coordinación del Área). */
  alcance: { escuelas: readonly string[]; tutorId: string | null } | null;
  /** Una práctica concreta (el expediente abierto). */
  practicaId?: string;
  escuela?: string;
  modalidad?: string;
  /** Nombre del estudiante (parcial) o su documento (exacto). */
  buscar?: string;
  /** Incluye prácticas sin ningún documento cargado (por defecto, solo las que tienen algo). */
  incluirSinDocumentos?: boolean;
  limite: number;
}

export interface LecturaExpedientes {
  practicas: PracticaDeExpediente[];
  documentos: DocumentoDeLectura[];
  /** Validaciones por `documentoId`. */
  eps: Map<string, ValidacionEps>;
  actas: Map<string, ValidacionActa>;
  empresariales: Map<string, ValidacionDocumentoEmpresarial>;
  /** Nombres de las personas que aparecen en reservas y decisiones. */
  nombres: Map<string, string>;
}

export interface ExpedienteDocumentalLecturaPort {
  cargar(filtro: FiltroExpedientes): Promise<LecturaExpedientes>;
}
export const EXPEDIENTE_DOCUMENTAL_LECTURA = Symbol('EXPEDIENTE_DOCUMENTAL_LECTURA');
