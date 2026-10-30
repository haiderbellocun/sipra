/**
 * Modelo del Acta de Iniciación de Prácticas (dominio puro).
 *
 * Tres conceptos que NO se combinan en un solo enum: qué documento parece ser,
 * si la práctica es remunerada y quién asume la ARL. Los tres formatos
 * institucionales conocidos son combinaciones de los dos últimos, pero el
 * dominio los mantiene independientes.
 *
 * Nada de esto aprueba un acta: describe lo que el documento DICE y en qué
 * difiere de SIPRA, para que una persona decida.
 */

export type TipoActaDetectada = 'iniciacion_practicas' | 'documento_incorrecto' | 'no_determinable';

export type Remuneracion = 'remunerada' | 'no_remunerada' | 'no_determinable';

export type ResponsableArlActa = 'empresa' | 'cun' | 'no_determinable';

/** Presencia PROBABLE de una firma. Nunca autenticidad ni identidad del firmante. */
export type Presencia = 'si' | 'no' | 'no_determinable';

export type ResultadoCampoActa = 'coincide' | 'diferente' | 'informacion_insuficiente';

export type ConfianzaActa = 'alta' | 'media' | 'baja';

export type CriticidadActa = 'critica' | 'alta' | 'media' | 'baja';

/** Qué parece ser un documento que se leyó y NO es un acta de iniciación. */
export type TipoDocumentoAjeno =
  | 'certificado_eps' | 'cedula' | 'carta_laboral' | 'certificado_arl' | 'contrato' | 'otro';

export type FuenteLecturaActa = 'texto_nativo' | 'ocr';

/** Campos que se extraen del acta, con la etiqueta de dominio (no la del formato). */
export const CAMPOS_ACTA = [
  // Estudiante
  'nombre_estudiante', 'documento_estudiante', 'lugar_expedicion', 'direccion_estudiante', 'barrio',
  'telefono_estudiante', 'semestre', 'programa',
  // Práctica («Tipo de Práctica» y «Modalidad de Práctica» son el mismo concepto)
  'modalidad_practica', 'fecha_inicio', 'fecha_fin', 'funciones', 'docente_monitor',
  // Empresa
  'empresa', 'nit', 'representante_legal', 'documento_representante', 'direccion_practica',
  'ciudad', 'departamento', 'telefono_empresa', 'jefe_inmediato', 'documento_jefe',
  // Formato
  'codigo_formato', 'version_formato', 'fecha_formato',
] as const;

export type CampoActa = (typeof CAMPOS_ACTA)[number];

export interface CampoLeidoActa {
  /** Valor tal como lo trae el documento (espacios colapsados); `null` si no se leyó. */
  valor: string | null;
  /** 0–1. Una lectura por debajo del mínimo se trata como «no leída» al comparar. */
  confianza: number;
  fuente: FuenteLecturaActa | null;
}

export type CamposActaLeidos = Readonly<Record<CampoActa, CampoLeidoActa>>;

/** Discrepancia que nace del propio documento (no de comparar con SIPRA). */
export interface DiscrepanciaDocumentoActa {
  codigo:
    | 'ARL_ENCABEZADO_VS_OBLIGACIONES' | 'ARL_ENCABEZADO_AMBIGUO' | 'ARL_OBLIGACIONES_AMBIGUAS'
    | 'REMUNERACION_AMBIGUA' | 'TIPO_ACTA_NO_CONFIRMADO';
  severidad: 'critica';
  mensaje: string;
}

export type SenalFuente = 'empresa' | 'cun' | 'ninguna' | 'contradictoria';

export interface ClasificacionActa {
  tipoActaDetectada: TipoActaDetectada;
  /** Solo si `tipoActaDetectada = documento_incorrecto` y se reconoce qué es. */
  documentoAjeno: TipoDocumentoAjeno | null;
  remuneracion: Remuneracion;
  responsableArl: ResponsableArlActa;
  confianzaRemuneracion: ConfianzaActa | null;
  confianzaResponsableArl: ConfianzaActa | null;
  /** Las dos fuentes independientes de la ARL y la de la remuneración, tal como se leyeron. */
  senales: {
    remuneracionEncabezado: Remuneracion | 'contradictoria';
    arlEncabezado: SenalFuente;
    arlObligaciones: SenalFuente;
  };
  puntajeActa: number;
  puntajeAjeno: number;
  /** Códigos no sensibles; nunca fragmentos del documento. */
  motivos: string[];
  discrepanciasDocumento: DiscrepanciaDocumentoActa[];
}

export interface FirmasActa {
  firmaEmpresaPresente: Presencia;
  firmaPracticantePresente: Presencia;
  motivos: string[];
}

/** Lo que SIPRA sabe de la práctica. El acta NO lo modifica. */
export interface DatosSipraActa {
  estudianteNombre: string | null;
  estudianteDocumento: string | null;
  programa: string | null;
  empresaRazonSocial: string | null;
  empresaNit: string | null;
  /** Valor de `ModalidadPractica`; se tipa como texto para no acoplar este modelo al catálogo. */
  modalidad: string | null;
  remuneracionEsperada: 'remunerada' | 'no_remunerada' | null;
  responsableArlEsperado: 'empresa' | 'cun' | null;
  fechaInicio: Date | string | null;
  fechaFin: Date | string | null;
  jefeInmediatoNombre: string | null;
  funciones: string | null;
}

export type CampoComparableActa =
  | 'estudiante' | 'documento' | 'empresa' | 'nit' | 'fecha_inicio' | 'fecha_fin' | 'modalidad'
  | 'remuneracion' | 'responsable_arl' | 'programa' | 'jefe_inmediato' | 'funciones';

export interface CampoComparadoActa {
  campo: CampoComparableActa;
  etiqueta: string;
  /** Lo que dice SIPRA, listo para mostrar; `null` si SIPRA no lo tiene. */
  sipra: string | null;
  /** Lo que dice el acta, listo para mostrar; `null` si no se pudo leer. */
  acta: string | null;
  resultado: ResultadoCampoActa;
  criticidad: CriticidadActa;
  orden: number;
  nota: string | null;
}

export interface DiscrepanciaActa {
  campo: CampoComparableActa | 'documento_acta';
  codigo: string;
  severidad: CriticidadActa;
  mensaje: string;
}

export interface ComparacionActa {
  campos: CampoComparadoActa[];
  discrepancias: DiscrepanciaActa[];
  resumen: { coinciden: number; diferentes: number; insuficientes: number; criticas: number };
  /** `consistente` NO es una aprobación: solo dice que no hay nada que señalar a la persona. */
  veredicto: 'consistente' | 'revision_necesaria';
}

// ── Lo que se conserva de una lectura (minimización) ───────────────────────

/**
 * Campos del acta que se conservan tras leerla: los que sirven a la comparación y a la revisión. NO se conservan
 * dirección, barrio, teléfonos, lugar de expedición, semestre, departamento ni los documentos del representante o
 * del jefe: el formulario los trae, pero ninguna regla de SIPRA los usa y ya hay un archivo para quien deba verlos.
 */
export const CAMPOS_ACTA_PERSISTIBLES: readonly CampoActa[] = [
  'nombre_estudiante', 'documento_estudiante', 'programa', 'modalidad_practica', 'fecha_inicio', 'fecha_fin',
  'funciones', 'empresa', 'nit', 'jefe_inmediato', 'representante_legal', 'docente_monitor',
  'codigo_formato', 'version_formato', 'fecha_formato',
];

/** Tope de la descripción de funciones que se conserva (texto libre del estudiante). */
export const MAX_CARACTERES_FUNCIONES_PERSISTIDAS = 500;

/** Qué hizo la lectura, en códigos y conteos. Nunca el texto del documento ni imágenes. */
export interface ResumenLecturaActaPersistible {
  metodoLectura: 'texto' | 'ocr';
  paginas: number;
  paginasLeidas: number;
  paginasOcr: number[];
  intentosOcr: number;
  /** 0–100, o `null` si no hubo OCR. */
  confianzaOcrMedia: number | null;
  suficiencia: { paraClasificar: boolean; paraComparar: boolean; senalesLeidas: number; camposClaveLeidos: number };
  firmasUbicadas: { pagina: number | null; empresaLocalizada: boolean; practicanteLocalizada: boolean };
  limitesAplicados: string[];
  errores: string[];
}

/** Resultado de leer un acta, ya minimizado: lo único que viaja del lector al resto del sistema. */
export interface LecturaActaPersistible {
  clasificacion: ClasificacionActa;
  /** Vacío si el documento no es un acta: lo «extraído» de otro documento no se conserva. */
  campos: Partial<Record<CampoActa, CampoLeidoActa>>;
  firmas: FirmasActa;
  lectura: ResumenLecturaActaPersistible;
  /** Letra a mano o foto/escaneo dudoso leído por OCR: sus datos críticos no deciden coincidencias automáticas. */
  lecturaDudosa?: boolean;
}

/**
 * Comparación tal como se conserva: el veredicto de cada campo. SIN el valor de SIPRA (es canónico en Usuario/Práctica/
 * Empresa), SIN el valor leído del acta (está en `datos_extraidos` y en las columnas detectadas) y sin mensajes con valores.
 */
export interface ComparacionActaPersistida {
  veredicto: ComparacionActa['veredicto'];
  comparadaEn: string;
  resumen: ComparacionActa['resumen'];
  campos: { campo: CampoComparableActa; resultado: ResultadoCampoActa; criticidad: CriticidadActa; nota: string | null }[];
  discrepancias: { campo: DiscrepanciaActa['campo']; codigo: string; severidad: CriticidadActa }[];
}
