/**
 * Lectura para la analítica de Reportes (solo lectura). El adaptador entrega filas mínimas; las reglas de avance documental
 * y las agregaciones viven en el caso de uso, que reutiliza el mismo servicio de dominio del expediente.
 */
export const REPORTES_ANALITICA = Symbol('REPORTES_ANALITICA');

/** Filtros que viajan a la base. `escuelaIds` ya trae el alcance del actor aplicado. */
export interface FiltroAnalitica {
  periodos?: readonly string[];
  escuelaIds?: readonly string[];
  programaId?: string;
  modalidad?: string;
  estado?: string;
}

export interface PracticaAnalitica {
  id: string;
  estudianteId: string;
  /** Solo el nombre (minimización): sin documento ni correo. */
  estudiante: string;
  programaId: string;
  escuelaId: string;
  /** Nombre de `cat_escuela` (o el código si falta). */
  escuela: string;
  periodoAcademico: string;
  modalidad: string;
  estado: string;
  empresa: string | null;
}

/** Una versión de documento con su decisión humana auditada (si la hubo). */
export interface VersionAnalitica {
  id: string;
  practicaId: string;
  tipo: string;
  version: number;
  estado: string;
  cargadoEn: Date;
  /** `auditoria.ocurrido_en` del último evento `decision_documento` de esta versión. */
  decididoEn: Date | null;
  decision: 'aprobar' | 'devolver' | 'rechazar' | null;
}

export interface ReportesAnaliticaPort {
  /** Periodos académicos con prácticas dentro del alcance (sin el resto de filtros). */
  periodos(escuelaIds?: readonly string[]): Promise<string[]>;
  practicas(filtro: FiltroAnalitica): Promise<PracticaAnalitica[]>;
  /** Todas las versiones de documentos de las prácticas que cumplen el filtro (una consulta, sin N+1). */
  versiones(filtro: FiltroAnalitica): Promise<VersionAnalitica[]>;
}
