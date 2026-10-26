/**
 * Consulta ADRES ASISTIDA (Fase 4 EPS).
 *
 * El resultado de ADRES/BDUA es evidencia INDEPENDIENTE para contrastar la
 * AFILIACIÓN. No es el certificado de EPS (ADRES no lo expide) y no dice nada
 * de la autenticidad de ese certificado. Lo consulta una PERSONA en el portal
 * oficial, resuelve ella misma el CAPTCHA y aporta el resultado (PDF); SIPRA no
 * automatiza el portal, no resuelve ni evade CAPTCHA y no usa endpoints privados.
 */

/** Estado de la consulta ADRES de una validación; separado de autenticidad, coincidencia, afiliación y decisión. */
export enum EstadoAdres {
  /** No hace falta contrastar con ADRES (la afiliación ya la estableció una fuente o aún no se procesó). */
  NO_REQUERIDO = 'no_requerido',
  /** La afiliación está sin contrastar: falta consultar ADRES. */
  PENDIENTE = 'pendiente',
  /** SIPRA preparó la consulta; la persona la está haciendo en el portal. */
  EN_CONSULTA = 'en_consulta',
  /** El resultado (PDF) ya se cargó; falta procesarlo. */
  EVIDENCIA_RECIBIDA = 'evidencia_recibida',
  /** El resultado se leyó y quedó atado al estudiante. */
  PROCESADO = 'procesado',
  /** No se pudo leer o procesar el resultado; se puede reintentar. */
  ERROR = 'error',
  /** Se leyó, pero no permite concluir (estado ilegible, documento que no corresponde…). */
  NO_DETERMINABLE = 'no_determinable',
}

/** Qué recomienda el motor determinístico a la persona que decide. NUNCA aprueba por sí mismo. */
export enum RecomendacionEps {
  /** Autenticidad verificada + datos coinciden + ADRES activa + vigencia (solo etiqueta). */
  CANDIDATO_AUTOAPROBACION = 'candidato_autoaprobacion',
  /** ADRES activa y el certificado coincide, pero su autenticidad no está verificada: revisar el documento. */
  REVISION_DOCUMENTAL = 'recomendar_revision_documental',
  /** ADRES inactiva o certificado inválido: revisar; rechazo según política futura. */
  REVISION_RECHAZO = 'recomendar_revision_rechazo',
  /** EPS, documento o nombre en conflicto entre fuentes. */
  DISCREPANCIA_CRITICA = 'discrepancia_critica',
  /** Falta el resultado ADRES. */
  PENDIENTE_ADRES = 'pendiente_adres',
  /** Hay resultado, pero no se pudo interpretar con seguridad. */
  INFORMACION_INSUFICIENTE = 'informacion_insuficiente',
}

/** Tipos de documento que SIPRA sabe normalizar y que el trámite acepta como confirmación. */
export const TIPOS_DOCUMENTO_ADRES = ['CC', 'TI', 'CE', 'PA'] as const;
export type TipoDocumentoAdres = (typeof TIPOS_DOCUMENTO_ADRES)[number];

export function esTipoDocumentoAdres(valor: unknown): valor is TipoDocumentoAdres {
  return typeof valor === 'string' && (TIPOS_DOCUMENTO_ADRES as readonly string[]).includes(valor);
}

/** De dónde sale el tipo de documento que se consulta. Nunca se infiere del número. */
export type OrigenTipoDocumento = 'sinu' | 'institucional' | 'solicitud_arl' | 'confirmacion_humana';

/** Lo que dice el resultado de ADRES, leído localmente. Cada campo ausente es `null`: no se inventa. */
export interface DatosAdres {
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  nombre: string | null;
  eps: string | null;
  regimen: string | null;
  /** Estado TAL COMO lo muestra la fuente. */
  estadoAfiliacion: string | null;
  /** AAAA-MM-DD */
  fechaAfiliacion: string | null;
  /** Fecha de finalización de la afiliación, si la trae (AAAA-MM-DD). */
  fechaFinalizacion: string | null;
  /** Fecha/hora de la CONSULTA que muestra el resultado (AAAA-MM-DD), si la trae. */
  fechaConsulta: string | null;
  /** Fecha hasta la cual la BDUA estaba actualizada (corte), si la trae. No es la fecha de consulta. */
  fuenteActualizadaEn: string | null;
}

export type ResultadoCampoTriple = 'coincide' | 'diferente' | 'no_disponible';

/** Un campo comparado entre SIPRA/SINU, el certificado y ADRES. */
export interface ComparacionTripleCampo {
  campo: 'numero_documento' | 'tipo_documento' | 'nombre' | 'eps' | 'regimen' | 'estado';
  sipra: string | null;
  certificado: string | null;
  adres: string | null;
  /** Veredicto de la comparación (ADRES contra lo demás). */
  resultado: ResultadoCampoTriple;
  /** Entre qué pares hay conflicto. */
  conflictos: Array<'sipra_vs_adres' | 'certificado_vs_adres' | 'sipra_vs_certificado'>;
  /** Un conflicto en un campo de identidad o de entidad es crítico. */
  critico: boolean;
}

export interface EstadoAdresValidacion {
  estado: EstadoAdres;
  /** Identificador de un solo uso de la consulta preparada (anti-reutilización). */
  consultaId: string | null;
  consultaVenceEn: Date | null;
  preparadaPor: string | null;
  preparadaEn: Date | null;
  tipoDocumento: string | null;
  tipoDocumentoOrigen: OrigenTipoDocumento | null;
  tipoDocumentoConfirmadoPor: string | null;
  /** Cuándo se hizo la consulta (declarada por quien cargó, o leída del resultado). */
  consultadoEn: Date | null;
  /** Hasta cuándo estaba actualizada la fuente, si el resultado lo dice. NO es la fecha de consulta. */
  fuenteActualizadaEn: Date | null;
  evidenciaHash: string | null;
  cargadaPor: string | null;
  cargadaEn: Date | null;
  /** Ruta de almacenamiento PRIVADO del resultado (nunca una URL). */
  referenciaArchivo: string | null;
  error: string | null;
  datos: DatosAdres | null;
  comparacion: ComparacionTripleCampo[];
  recomendacion: RecomendacionEps | null;
}

export function adresInicial(): EstadoAdresValidacion {
  return {
    estado: EstadoAdres.NO_REQUERIDO, consultaId: null, consultaVenceEn: null, preparadaPor: null, preparadaEn: null,
    tipoDocumento: null, tipoDocumentoOrigen: null, tipoDocumentoConfirmadoPor: null, consultadoEn: null,
    fuenteActualizadaEn: null, evidenciaHash: null, cargadaPor: null, cargadaEn: null, referenciaArchivo: null,
    error: null, datos: null, comparacion: [], recomendacion: null,
  };
}

/** Códigos de error del procesamiento del resultado (sin datos del documento). */
export type CodigoErrorAdres =
  | 'pdf_ilegible' | 'sin_texto' | 'no_es_resultado_adres' | 'documento_no_corresponde' | 'tipo_documento_no_corresponde'
  | 'sin_documento_en_resultado' | 'nombre_no_corresponde' | 'archivo_no_disponible' | 'lectura_fallida';
