/** Respuesta de `GET /reportes/analitica` y de su detalle (solo lectura; cifras calculadas en el servidor). */
export type EstadoObligacion = 'sin_cargar' | 'en_proceso' | 'en_revision' | 'correccion' | 'rechazado' | 'aprobado';
export type SituacionExpediente = 'completo' | 'requiere_correccion' | 'sin_iniciar' | 'en_curso' | 'sin_matriz';

export interface Cobertura { estudiantes: number; practicas: number; exigidos: number; cargados: number; aprobados: number; correccion: number; completos: number }

export interface ReporteAnalitica {
  generadoEn: string;
  periodosDisponibles: string[];
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
  empresas: { empresa: string; practicas: number; estudiantes: number }[];
}

export interface FilaDetalleAnalitica {
  practicaId: string; estudiante: string; programa: string; escuela: string; modalidad: string; empresa: string | null;
  periodo: string; estado: string; exigidos: number; cargados: number; aprobados: number; correccion: number;
  situacion: SituacionExpediente; ultimoMovimiento: string | null;
}
export interface DetalleAnalitica { total: number; estudiantesUnicos: number; filas: FilaDetalleAnalitica[] }
