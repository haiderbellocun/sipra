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
  /** Nivel de formación (`practicas.ciclo`). */
  ciclo?: string;
  /** Razón social registrada; `__sin_empresa__` = sin empresa (NULL en la base). */
  empresa?: string;
  /** Solo con semestre sintético habilitado (bases de prueba en `dev`). */
  semestre?: number;
  /** Modalidades permitidas (p. ej. las articuladas = práctica interna CUN, según el dominio). */
  modalidades?: readonly string[];
  /** Sección CIIU de la empresa (`cat_ciiu.seccion`), o `__sin_dato__`. */
  sector?: string;
  /** Municipio DIVIPOLA de la empresa (`empresas.divipola_municipio`), `__sin_dato__` o `__internacional__` (solo dev sintético). */
  ciudad?: string;
}

/** Periodo presente en las prácticas, con su fecha de inicio en `periodos_academicos` (null si el código no está allí). */
export interface PeriodoAnalitica {
  codigo: string;
  inicio: string | null;
}

export interface PracticaAnalitica {
  id: string;
  estudianteId: string;
  /** Solo el nombre (minimización): sin documento ni correo. */
  estudiante: string;
  programaId: string;
  /** Nombre del programa: SIPRA no lo persiste (vive en SINU). Solo trae valor con el mapping sintético de pruebas en `dev`. */
  programaNombre: string | null;
  escuelaId: string;
  /** Nombre de `cat_escuela` (o el código si falta). */
  escuela: string;
  periodoAcademico: string;
  /** Nivel de formación real de la práctica: `practicas.ciclo` (NOT NULL; técnico, tecnólogo, profesional). */
  ciclo: string;
  modalidad: string;
  estado: string;
  empresa: string | null;
  /** Sector económico real: sección CIIU de `empresas.ciiu` (código y nombre de `cat_ciiu`). Null sin empresa o sin CIIU. */
  sector: string | null;
  sectorNombre: string | null;
  /** Ciudad real: `empresas.divipola_municipio` y su nombre en `cat_divipola`. Null sin empresa o sin municipio. */
  ciudad: string | null;
  ciudadNombre: string | null;
  /** Receptora en el exterior: SIPRA no lo persiste; solo `true` con la ubicación sintética de pruebas en `dev`. */
  internacional: boolean;
  /** Semestre: SIPRA no lo persiste (vive en SINU). Solo trae valor en bases sintéticas con el overlay habilitado. */
  semestre: number | null;
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
  periodos(escuelaIds?: readonly string[]): Promise<PeriodoAnalitica[]>;
  /** ¿Hay una fuente de semestre? Solo `true` con el overlay sintético en `dev`; en producción, siempre `false`. */
  semestreSintetico(): boolean;
  /** ¿Hay nombres de programa? Solo `true` con el mapping sintético en `dev`; en producción, siempre `false`. */
  programasSinteticos(): boolean;
  /** ¿Se distingue «internacional» de «sin información»? Solo con la ubicación sintética en `dev`. */
  ubicacionSintetica(): boolean;
  /** Estudiantes únicos y prácticas del alcance, sin filtros (denominador «en alcance»). */
  universo(escuelaIds?: readonly string[]): Promise<{ estudiantes: number; practicas: number }>;
  practicas(filtro: FiltroAnalitica): Promise<PracticaAnalitica[]>;
  /** Todas las versiones de documentos de las prácticas que cumplen el filtro (una consulta, sin N+1). */
  versiones(filtro: FiltroAnalitica): Promise<VersionAnalitica[]>;
}
