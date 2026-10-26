/** Estados del documento (M3). */
export enum EstadoDocumento {
  RECIBIDO = 'recibido',
  ANALIZANDO = 'analizando',
  AUTO_APROBADO = 'auto_aprobado',
  EN_REVISION = 'en_revision',
  ILEGIBLE = 'ilegible',
  DEVUELTO = 'devuelto',
  APROBADO = 'aprobado',
  RECHAZADO = 'rechazado',
}

/**
 * `ilegible` y `rechazado` son estados distintos: un documento ilegible se
 * devuelve para reenvío y NO constituye una decisión negativa sobre el
 * estudiante. La distinción es normativa, no cosmética.
 */
export const ESTADOS_TERMINALES: readonly EstadoDocumento[] = [
  EstadoDocumento.APROBADO,
  EstadoDocumento.RECHAZADO,
];

export enum TipoDocumento {
  CEDULA = 'cedula',
  /** Certificado de afiliación a EPS. No lo sustituyen ADRES, Sisbén ni planilla. */
  CERTIFICADO_EPS = 'certificado_eps',
  /** Acta de inicio de la práctica articulada. */
  ACTA_INICIO = 'acta_inicio',
  RUT_NATURAL = 'rut_natural',
  RUT_JURIDICO = 'rut_juridico',
  CAMARA_COMERCIO = 'camara_comercio',
  SOPORTE_RELACION_LABORAL = 'soporte_relacion_laboral',
  AUTORIZACION_FUNCIONES = 'autorizacion_funciones',
  CARTA_ACEPTACION = 'carta_aceptacion',
  CERTIFICADO_ARL = 'certificado_arl',
  CONVENIO_PRACTICA = 'convenio_practica',
  PLANILLA_HORAS = 'planilla_horas',
  PLAN_MEJORAMIENTO = 'plan_mejoramiento',
  CERTIFICADO_EXISTENCIA = 'certificado_existencia',
  CERTIFICACION_LABORAL = 'certificacion_laboral',
  PLANILLA_APORTES = 'planilla_aportes',
  CERTIFICADO_PRACTICA = 'certificado_practica',
  // ── Documentos del proceso SGP (manual del docente facilitador, cap. 3) ──
  /** Copia del contrato de aprendizaje firmado por ambas partes. */
  CONTRATO_APRENDIZAJE = 'contrato_aprendizaje',
  /** Certificado laboral con funciones, en membrete, firmado y sellado. */
  CERTIFICADO_LABORAL_FUNCIONES = 'certificado_laboral_funciones',
  /** Copia del contrato laboral vigente firmado por empleador y empleado. */
  CONTRATO_LABORAL = 'contrato_laboral',
  /** Formato Seguimiento Final de Prácticas PSO-F012, diligenciado por el jefe. */
  FORMATO_SEGUIMIENTO_FINAL = 'formato_seguimiento_final',
  /** Carta de la empresa que certifica el cumplimiento, con fechas de inicio y fin. */
  CARTA_FINALIZACION = 'carta_finalizacion',
  /** Segundo momento: avance del plan de mejoramiento (manual ARL §7.3). */
  AVANCE_PLAN_MEJORAMIENTO = 'avance_plan_mejoramiento',
  /** Semilleros: planteamiento inicial del artículo científico. */
  PROPUESTA_ARTICULO = 'propuesta_articulo',
  /** Semilleros: carta de finalización o constancia de publicación del artículo. */
  CONSTANCIA_PUBLICACION = 'constancia_publicacion',
  /** CUNbre: soporte de aceptación del emprendimiento en el acompañamiento. */
  SOPORTE_ACEPTACION_CUNBRE = 'soporte_aceptacion_cunbre',
  ENTREGABLE_MENTORIA_1 = 'entregable_mentoria_1',
  ENTREGABLE_MENTORIA_2 = 'entregable_mentoria_2',
  ENTREGABLE_MENTORIA_3 = 'entregable_mentoria_3',
  ENTREGABLE_MENTORIA_4 = 'entregable_mentoria_4',
  ENTREGABLE_MENTORIA_5 = 'entregable_mentoria_5',
  ENTREGABLE_MENTORIA_6 = 'entregable_mentoria_6',
  ENTREGABLE_MENTORIA_7 = 'entregable_mentoria_7',
  ENTREGABLE_MENTORIA_8 = 'entregable_mentoria_8',
  EVALUACION_FINAL_CUNBRE = 'evaluacion_final_cunbre',
  /** Monitoría: informes de avance y de cierre. */
  INFORME_1 = 'informe_1',
  INFORME_2 = 'informe_2',
  INFORME_FINAL = 'informe_final',
  // ── «Documentación a cargar para cada tipo de práctica» (Desarrollo Profesional) ──
  /** Semilleros, práctica técnica en investigación: lo revisa el docente de semilleros. */
  REPORTE_SEMILLEROS = 'reporte_semilleros',
  /** Práctica investigativa: artículo científico; lo revisa el docente de semilleros. */
  ARTICULO_CIENTIFICO = 'articulo_cientifico',
  /** Pasantía internacional: correo de aprobación de la modalidad. */
  CORREO_APROBACION_INTERNACIONAL = 'correo_aprobacion_internacional',
  /** Pasantía internacional: certificado del seguro médico internacional. */
  SEGURO_MEDICO_INTERNACIONAL = 'seguro_medico_internacional',
}

/** Banda del puntaje del pipeline (capa 5). Nunca hay rechazo automático. */
export enum BandaPuntaje {
  VERDE = 'verde',
  AMARILLO = 'amarillo',
  ROJO = 'rojo',
}

export enum SeveridadBandera {
  INFORMATIVA = 'informativa',
  MEDIA = 'media',
  ALTA = 'alta',
  CRITICA = 'critica',
}

export interface Bandera {
  codigo: string;
  capa: 0 | 1 | 2 | 3 | 4;
  severidad: SeveridadBandera;
  mensaje: string;
  /** Texto comprensible para el estudiante; nunca jerga forense. */
  mensajeUsuario?: string;
}

export interface MetricasCalidadCaptura {
  varianzaLaplaciano: number;
  luminanciaMedia: number;
  porcentajeSaturados: number;
  anchoPx: number;
  altoPx: number;
}

export interface DatosDocumento {
  id: string;
  practicaId: string;
  tipo: TipoDocumento;
  version: number;
  estado: EstadoDocumento;
  nombreOriginal: string;
  mimeReal: string;
  tamanoBytes: number;
  hashSha256: string;
  hashPerceptual: string | null;
  rutaAlmacenamiento: string;
  calidadCaptura: MetricasCalidadCaptura | null;
  banderas: Bandera[];
  puntaje: number | null;
  banda: BandaPuntaje | null;
  extraccion: Record<string, unknown> | null;
  decididoPor: string | null;
  justificacionDecision: string | null;
  motivoDevolucion: string | null;
  cargadoEn: Date;
  actualizadoEn: Date;
  purgarDespuesDe: Date | null;
}

export class DecisionSinJustificacionError extends Error {
  constructor() {
    super('Toda decisión sobre un documento exige justificación registrada');
    this.name = 'DecisionSinJustificacionError';
  }
}

/**
 * Umbrales de fábrica de la capa 5. La Dirección los mueve desde M12 y quien
 * llama pasa los vigentes; el dominio no consulta la base por su cuenta.
 */
export const UMBRALES_PUNTAJE = { verde: 85, amarillo: 60 } as const;

export interface UmbralesPuntaje { verde: number; amarillo: number }

export class Documento {
  private constructor(private datos: DatosDocumento) {}

  static desde(datos: DatosDocumento): Documento {
    return new Documento({ ...datos, banderas: [...datos.banderas] });
  }

  get id(): string { return this.datos.id; }
  get estado(): EstadoDocumento { return this.datos.estado; }
  get tipo(): TipoDocumento { return this.datos.tipo; }
  get practicaId(): string { return this.datos.practicaId; }
  get banderas(): readonly Bandera[] { return this.datos.banderas; }
  get puntaje(): number | null { return this.datos.puntaje; }
  get banda(): BandaPuntaje | null { return this.datos.banda; }

  instantanea(): DatosDocumento {
    return { ...this.datos, banderas: [...this.datos.banderas] };
  }

  static bandaDe(puntaje: number, umbrales: UmbralesPuntaje = UMBRALES_PUNTAJE): BandaPuntaje {
    if (puntaje >= umbrales.verde) return BandaPuntaje.VERDE;
    if (puntaje >= umbrales.amarillo) return BandaPuntaje.AMARILLO;
    return BandaPuntaje.ROJO;
  }

  agregarBandera(bandera: Bandera): void {
    this.datos.banderas.push(bandera);
    this.datos.actualizadoEn = new Date();
  }

  /**
   * Aplica el resultado del pipeline. La banda roja bloquea y escala a revisión
   * humana; jamás rechaza por sí sola.
   */
  aplicarResultadoPipeline(
    puntaje: number,
    banderas: Bandera[],
    extraccion: Record<string, unknown> | null,
    ahora: Date = new Date(),
    umbrales: UmbralesPuntaje = UMBRALES_PUNTAJE,
  ): void {
    this.datos.puntaje = puntaje;
    this.datos.banda = Documento.bandaDe(puntaje, umbrales);
    this.datos.banderas = [...this.datos.banderas, ...banderas];
    this.datos.extraccion = extraccion;
    this.datos.actualizadoEn = ahora;

    this.datos.estado =
      this.datos.banda === BandaPuntaje.VERDE
        ? EstadoDocumento.AUTO_APROBADO
        : EstadoDocumento.EN_REVISION;
  }

  /** Resultado distinto de aprobar o rechazar: el documento no se pudo leer. */
  marcarIlegible(mensajeUsuario: string, ahora: Date = new Date()): void {
    this.datos.estado = EstadoDocumento.ILEGIBLE;
    this.datos.motivoDevolucion = mensajeUsuario;
    this.datos.actualizadoEn = ahora;
  }

  devolver(mensajeUsuario: string, actorId: string, ahora: Date = new Date()): void {
    if (!mensajeUsuario?.trim()) throw new DecisionSinJustificacionError();
    this.datos.estado = EstadoDocumento.DEVUELTO;
    this.datos.motivoDevolucion = mensajeUsuario;
    this.datos.decididoPor = actorId;
    this.datos.actualizadoEn = ahora;
  }

  aprobar(actorId: string, justificacion: string, ahora: Date = new Date()): void {
    if (!justificacion?.trim()) throw new DecisionSinJustificacionError();
    this.datos.estado = EstadoDocumento.APROBADO;
    this.datos.decididoPor = actorId;
    this.datos.justificacionDecision = justificacion;
    this.datos.actualizadoEn = ahora;
  }

  rechazar(actorId: string, justificacion: string, ahora: Date = new Date()): void {
    if (!justificacion?.trim()) throw new DecisionSinJustificacionError();
    this.datos.estado = EstadoDocumento.RECHAZADO;
    this.datos.decididoPor = actorId;
    this.datos.justificacionDecision = justificacion;
    this.datos.actualizadoEn = ahora;
  }

  /** Minimización de datos: la imagen de la cédula se purga a los 30 días. */
  programarPurga(dias: number, ahora: Date = new Date()): void {
    const fecha = new Date(ahora);
    fecha.setUTCDate(fecha.getUTCDate() + dias);
    this.datos.purgarDespuesDe = fecha;
  }
}
