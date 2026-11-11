/** Respuesta de `GET /reportes/analitica` y de su detalle (solo lectura; cifras calculadas en el servidor). */
export type EstadoObligacion = 'sin_cargar' | 'en_proceso' | 'en_revision' | 'correccion' | 'rechazado' | 'aprobado';
export type SituacionExpediente = 'completo' | 'requiere_correccion' | 'sin_iniciar' | 'en_curso' | 'sin_matriz';

export interface Cobertura {
  estudiantes: number; practicas: number; exigidos: number; cargados: number; aprobados: number; correccion: number; completos: number;
  /** Obligaciones por estado de su última versión (suman `exigidos`). */
  obligaciones: Record<EstadoObligacion, number>;
  /** Historial: versiones, documentos (práctica·tipo) con versión, con reenvío, devoluciones y rechazos auditados. */
  versiones: number; documentos: number; conReenvio: number; devoluciones: number; rechazos: number;
}

/** Celda de un cruce: estudiantes únicos y prácticas. */
export interface Celda { fila: string; columna: string; estudiantes: number; practicas: number }
export type CruceAnalitica = 'programaModalidad' | 'programaNivel' | 'nivelModalidad' | 'periodoPrograma' | 'periodoModalidad' | 'periodoNivel'
  | 'semestreModalidad' | 'programaSemestre' | 'programaSector' | 'programaCiudad' | 'nivelSector' | 'modalidadSector'
  | 'receptorPrograma' | 'receptorNivel';
/** Interna CUN = modalidad articulada del dominio («escenario dentro de la institución»); externa = las demás. */
export type TipoReceptor = 'interna_cun' | 'externa';

export interface ReporteAnalitica {
  generadoEn: string;
  periodosDisponibles: string[];
  /** Todo lo que el perfil alcanza, sin filtros: denominador «en alcance». */
  universo: { estudiantes: number; practicas: number };
  /** Orden cronológico ascendente (fecha de inicio en `periodos_academicos`); los códigos sin fecha, al final. */
  ordenPeriodos: string[];
  /** Códigos que no están en `periodos_academicos`: su posición no es cronológica. */
  periodosSinFecha: string[];
  /** Semestre: `no_disponible` en producción (vive en SINU); `sintetica` solo en bases de prueba con el overlay. */
  /** `ubicacionInternacional`: solo en dev sintético se distingue «Internacional · sin DIVIPOLA» (clave `__internacional__`) de «Sin información». */
  dimensiones: { semestre: 'sintetica' | 'no_disponible'; nombrePrograma: 'sintetico' | 'no_disponible'; ubicacionInternacional: 'sintetica' | 'no_disponible' };
  /** Por semestre (vacío si no hay fuente); `semestre: null` = sin información. En cruces la clave es el número como texto o ''. */
  semestres: ({ semestre: number | null } & Cobertura)[];
  resumen: Cobertura;
  expedientes: Record<SituacionExpediente, number>;
  estadosPractica: { estado: string; practicas: number }[];
  documental: Record<EstadoObligacion, number>;
  porTipo: ({ tipo: string; exigidos: number } & Record<EstadoObligacion, number>)[];
  friccion: { tipo: string; documentos: number; versiones: number; conReenvio: number; devoluciones: number; rechazos: number; promedioVersiones: number }[];
  tiempos: { decisiones: number; medianaHoras: number | null; p90Horas: number | null; porTipo: { tipo: string; decisiones: number; medianaHoras: number | null }[] };
  semanas: { semana: string; cargas: number; aprobaciones: number; devoluciones: number; rechazos: number }[];
  periodos: ({ periodo: string } & Cobertura)[];
  modalidades: ({ modalidad: string } & Cobertura)[];
  escuelas: ({ escuela: string; nombre: string; programas: ({ programa: string } & Cobertura)[] } & Cobertura)[];
  /** Todas las empresas del filtro; `null` = sin empresa registrada. */
  empresas: { empresa: string | null; practicas: number; estudiantes: number; sector: string | null; ciudad: string | null; tipo: TipoReceptor | null }[];
  /** Sector = sección CIIU de la empresa (real); ciudad = municipio DIVIPOLA (real). null = sin dato (p. ej. exterior). */
  sectores: ({ sector: string | null; nombre: string | null } & Cobertura)[];
  ciudades: ({ ciudad: string | null; nombre: string | null } & Cobertura)[];
  receptores: ({ tipo: TipoReceptor | null } & Cobertura)[];
  etiquetas: { sectores: Record<string, string>; ciudades: Record<string, string> };
  /** Nivel de formación (`practicas.ciclo`). */
  niveles: ({ ciclo: string } & Cobertura)[];
  /** `nombre`: solo con el mapping sintético de dev; en producción null (se muestra el código). */
  programas: ({ programa: string; nombre: string | null; escuela: string; nombreEscuela: string; ciclos: string[] } & Cobertura)[];
  cruces: Record<CruceAnalitica, Celda[]>;
}

export interface FilaDetalleAnalitica {
  practicaId: string; estudiante: string; programa: string; programaNombre: string | null; escuela: string; ciclo: string; semestre: number | null; modalidad: string; empresa: string | null;
  tipoReceptor: TipoReceptor | null; sector: string | null; ciudad: string | null;
  periodo: string; estado: string; exigidos: number; cargados: number; aprobados: number; correccion: number;
  pendientes: number; devoluciones: number; situacion: SituacionExpediente; ultimoMovimiento: string | null;
}
export interface DetalleAnalitica { total: number; estudiantesUnicos: number; filas: FilaDetalleAnalitica[] }
