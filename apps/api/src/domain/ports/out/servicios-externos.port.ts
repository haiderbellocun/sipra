import { Bandera } from '../../entities/documento.entity';
import { TipoDocumento } from '../../entities/documento.entity';

/** Almacenamiento de documentos (Cloud Storage en GCP, disco en local). */
export interface AlmacenamientoPort {
  /** Guarda el archivo en una ruta NO adivinable y devuelve esa ruta. */
  guardar(ruta: string, contenido: Buffer, mime: string): Promise<string>;
  leer(ruta: string): Promise<Buffer>;
  eliminar(ruta: string): Promise<void>;
  /**
   * Enlace de descarga de vigencia corta, firmado para un documento y para quien
   * lo pidió. La descarga pasa siempre por la API, que es la que la audita.
   */
  enlaceFirmado(contexto: ContextoEnlaceDocumento, minutos: number): Promise<string>;
}
export interface ContextoEnlaceDocumento {
  documentoId: string;
  /** Usuario al que se le emitió el enlace. */
  solicitanteId: string;
}
export const ALMACENAMIENTO = Symbol('ALMACENAMIENTO');

/** Extracción asistida por IA (capa 2). NUNCA emite juicio de autenticidad. */
export interface CampoExtraido {
  valor: string | null;
  confianza: number;
  /** Dónde se encontró el dato en el documento. */
  evidencia: string | null;
}

/** Respuesta del modelo a un criterio del manual (base de conocimiento documental). */
export interface HallazgoCriterio {
  codigo: string;
  enunciado: string;
  /** «no» solo por lo que se ve; nunca por sospecha. */
  cumple: 'si' | 'no' | 'no_determinable';
  detalle: string | null;
  /** El manual lo enuncia como causal de devolución explícita. */
  causalDevolucion: boolean;
}

export interface ResultadoExtraccion {
  tipoDetectado: TipoDocumento | null;
  campos: Record<string, CampoExtraido>;
  /** true cuando la confianza global no alcanza para decidir: resultado `ilegible`. */
  ilegible: boolean;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  /** Criterios del manual respondidos por el modelo; vacío en el simulado. */
  hallazgos?: HallazgoCriterio[];
  motivoIlegible?: string | null;
  /** Una frase del modelo sobre qué es el documento; la ve el revisor, no el estudiante. */
  resumen?: string | null;
  /** Proveedor que produjo la lectura (`openai`, `anthropic`, `simulado`, `pdf417`). */
  proveedor?: string;
  /** Tokens de entrada servidos desde caché del proveedor (subconjunto de tokensEntrada). */
  tokensCache?: number;
  /** Tokens de razonamiento (subconjunto de tokensSalida). */
  tokensRazonamiento?: number;
  duracionMs?: number;
  /** El modelo no estaba en la tabla de tarifas: costo con tarifa de respaldo. */
  tarifaDesconocida?: boolean;
}

export interface ExtraccionIaPort {
  extraer(
    contenido: Buffer,
    mime: string,
    tipoEsperado: TipoDocumento,
  ): Promise<ResultadoExtraccion>;
}
export const EXTRACCION_IA = Symbol('EXTRACCION_IA');

/** Coherencia cruzada entre documentos de una misma práctica (capa 3). */
export interface CoherenciaCruzadaPort {
  evaluar(
    extracciones: Record<string, ResultadoExtraccion>,
    contexto: {
      nitEmpresa: string | null;
      fechaInicio: Date | null;
      nombreEstudiante: string;
      /** Documento del estudiante en SIPRA; permite comparar el del certificado de EPS. */
      documentoEstudiante?: string | null;
      /** Vigencia institucional del certificado de EPS, en días. */
      diasVigenciaEps?: number;
    },
  ): Promise<Bandera[]>;
}
export const COHERENCIA_CRUZADA = Symbol('COHERENCIA_CRUZADA');

/** Verificación externa (capa 4): RUES por NIT. Única prueba concluyente. */
export interface ResultadoRues {
  encontrado: boolean;
  razonSocial: string | null;
  estadoMatricula: string | null;
  fechaMatricula: Date | null;
  representanteLegal: string | null;
}

export interface RuesPort {
  consultarPorNit(nitNumero: string): Promise<ResultadoRues>;
}
export const RUES = Symbol('RUES');

/** Lectura de matrícula académica. SINU es la fuente única de verdad; no se escribe. */
export interface MatriculaSinu {
  documentoEstudiante: string;
  nombreEstudiante: string;
  correoInstitucional: string;
  programaId: string;
  programaNombre: string;
  escuelaId: string;
  ciclo: string;
  periodoAcademico: string;
  asignaturaPractica: string;
  /** Campos que el reporte de prácticas del SGP toma de SINU cuando existen. */
  codigoAsignatura?: string | null;
  regional?: string | null;
  telefono?: string | null;
  semestre?: number | null;
  pensum?: string | null;
}

/** Asignación del docente facilitador a la asignatura de práctica, registrada en SINU. */
export interface AsignacionDocenteSinu {
  documentoEstudiante: string;
  periodoAcademico: string;
  asignaturaPractica: string;
  documentoDocente: string;
  nombreDocente: string;
  correoDocente: string;
}

export interface SinuPort {
  listarMatriculasPractica(periodoAcademico: string): Promise<MatriculaSinu[]>;
  buscarPorDocumento(documento: string): Promise<MatriculaSinu | null>;
  /** Sincronizador prácticas–docente (SGP, apartado Vistas). */
  listarAsignacionesDocentes(periodoAcademico: string): Promise<AsignacionDocenteSinu[]>;
}
export const SINU = Symbol('SINU');

/** Notificaciones (M10). Toda devolución explica en lenguaje comprensible qué corregir. */
export interface MensajeNotificacion {
  destinatario: string;
  asunto: string;
  cuerpo: string;
  /** Cuerpo alternativo en HTML, cuando la plantilla lo produce. */
  html?: string;
  plantilla?: string;
  datos?: Record<string, unknown>;
}

export interface ResultadoEnvio {
  enviado: boolean;
  /** Identificador del mensaje en el proveedor, para poder rastrearlo. */
  referencia: string | null;
  motivo?: string;
}

export interface NotificacionPort {
  enviar(mensaje: MensajeNotificacion): Promise<ResultadoEnvio>;
}
export const NOTIFICACION = Symbol('NOTIFICACION');

/**
 * Cola de trabajo (M4 · dimensionamiento por pico).
 *
 * El sistema no se dimensiona por promedio sino por pico: la carga se concentra
 * en las últimas dos semanas del periodo, con 40.000 a 50.000 documentos.
 *
 * La prioridad no es un adorno. Un estudiante que carga su documento el último
 * día no puede quedar detrás de miles de trabajos nocturnos: `interactiva`
 * atiende el cargue en curso y `lote` el procesamiento diferido.
 */
export type PrioridadTrabajo = 'interactiva' | 'lote';

export interface Trabajo {
  tipo: 'validar_documento' | 'reporte_spe' | 'purga_documento';
  /** Identificador del objeto sobre el que se opera. */
  referencia: string;
  prioridad: PrioridadTrabajo;
  intentos?: number;
  datos?: Record<string, unknown>;
}

export interface ResultadoEncolado {
  id: string;
  prioridad: PrioridadTrabajo;
  /** true cuando el adaptador ejecutó el trabajo en línea en vez de encolarlo. */
  ejecutadoEnLinea: boolean;
}

export interface ColaPort {
  encolar(trabajo: Trabajo): Promise<ResultadoEncolado>;
  /** Profundidad por prioridad; alimenta el escalado y las métricas. */
  profundidad(): Promise<Record<PrioridadTrabajo, number>>;
}
export const COLA = Symbol('COLA');

/**
 * Extractor LOCAL y determinístico, sin proveedor externo. Es el único que usan
 * los tipos con `procesamiento_local` (certificado de EPS).
 */
export const EXTRACCION_LOCAL = Symbol('EXTRACCION_LOCAL');

/**
 * Lectura de códigos de barras bidimensionales (M4, capa 0).
 *
 * El PDF417 del reverso de la cédula lleva corrección de errores: o los datos
 * se leen bien o la lectura falla. No hay valores inventados, a diferencia del
 * OCR sobre la misma imagen.
 */
export interface ResultadoCodigoBarras {
  encontrado: boolean;
  formato: string | null;
  contenido: string;
}

export interface LectorCodigoBarrasPort {
  leerPdf417(contenido: Buffer, mime: string): Promise<ResultadoCodigoBarras>;
}
export const LECTOR_CODIGO_BARRAS = Symbol('LECTOR_CODIGO_BARRAS');

/**
 * Generación de documentos PDF institucionales (carta de presentación,
 * certificados). El dominio compone el texto; el adaptador lo dibuja.
 */
export interface DocumentoPdf {
  titulo: string;
  /** Líneas del encabezado institucional. */
  encabezado: readonly string[];
  /** Fecha y lugar, ya formateados. */
  fechaLugar: string;
  parrafos: readonly string[];
  /** Bloque de firma: nombre, cargo, dependencia. */
  firma: readonly string[];
  /** Consecutivo o código de verificación al pie. */
  pie: readonly string[];
}

export interface GeneradorPdfPort {
  generar(documento: DocumentoPdf): Promise<Buffer>;
}
export const GENERADOR_PDF = Symbol('GENERADOR_PDF');

/**
 * Libros de hoja de cálculo (reportes del SGP en Excel). El dominio arma las
 * filas y las columnas; el adaptador las dibuja en el formato.
 */
export interface ColumnaHoja {
  clave: string;
  encabezado: string;
  ancho?: number;
}

export type CeldaHoja = string | number | boolean | Date | null;

export interface HojaCalculo {
  nombre: string;
  columnas: readonly ColumnaHoja[];
  filas: readonly Record<string, CeldaHoja>[];
}

export interface LibroCalculo {
  titulo: string;
  hojas: readonly HojaCalculo[];
}

export interface GeneradorHojaCalculoPort {
  generar(libro: LibroCalculo): Promise<Buffer>;
}
export const GENERADOR_HOJA_CALCULO = Symbol('GENERADOR_HOJA_CALCULO');
