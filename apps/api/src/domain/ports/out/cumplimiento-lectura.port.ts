import { EstadoObligacion } from '../../entities/obligacion.entity';

/**
 * Cumplimiento V3 · lectura agregada de obligaciones en el ALCANCE del actor, en UNA consulta (sin N+1).
 * El alcance se aplica en la base, no filtrando resultados en memoria.
 */
export interface AlcanceCumplimiento {
  /** true = toda la institución (administración, dirección, extensión, coordinación/analista sin escuelas). */
  todas: boolean;
  /** Escuelas visibles (coordinación/analista con escuelas; docente con escuelas). */
  escuelas: readonly string[];
  /** Docente facilitador: además, sus prácticas asignadas (aunque no tenga escuelas). */
  tutorId: string | null;
}

export interface FiltroCumplimiento {
  periodo?: string;
  escuela?: string;
  programa?: string;
  tipo?: string;
  /** Ids de estudiantes de la búsqueda por nombre/documento (resuelta con la búsqueda existente de usuarios). */
  estudianteIds?: readonly string[];
}

/** Una obligación con lo mínimo de su práctica y su estudiante. */
export interface FilaObligacionAlcance {
  obligacionId: string;
  tipo: string;
  estado: EstadoObligacion;
  fechaLimite: Date;
  practicaId: string;
  practicaEstado: string;
  periodo: string;
  escuelaId: string;
  escuelaNombre: string | null;
  programaId: string;
  estudianteNombre: string;
}

export interface OpcionesCumplimiento {
  periodos: string[];
  escuelas: { codigo: string; nombre: string }[];
  programas: string[];
}

export interface CumplimientoLecturaPort {
  obligaciones(alcance: AlcanceCumplimiento, filtro: FiltroCumplimiento): Promise<FilaObligacionAlcance[]>;
  /** Valores de los filtros que EXISTEN en el alcance (sin aplicar los demás filtros). */
  opciones(alcance: AlcanceCumplimiento): Promise<OpcionesCumplimiento>;
}

export const CUMPLIMIENTO_LECTURA = Symbol('CUMPLIMIENTO_LECTURA');
