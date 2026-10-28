/**
 * Validación del certificado de afiliación a EPS.
 *
 * Es un modelo SEPARADO del documento. Un certificado tiene cuatro cosas que no
 * deben mezclarse, cada una en su propio eje:
 *
 *   1. AUTENTICIDAD del certificado       — ¿lo emitió quien dice?
 *   2. COINCIDENCIA de datos              — ¿corresponde a este estudiante?
 *   3. AFILIACIÓN                         — ¿la persona está afiliada hoy?
 *   4. DECISIÓN                           — ¿qué se resolvió con el documento?
 *
 * Reglas que este modelo no negocia:
 *   · Un QR encontrado NO es autenticidad verificada.
 *   · Un certificado auténtico NO es una afiliación vigente.
 *   · Lo que el certificado DICE (`datosExtraidos`) no es lo que una fuente
 *     oficial CONFIRMA (`datosVerificados`).
 *   · Nada se autoaprueba: en esta fase `candidato_autoaprobacion` es solo una
 *     etiqueta de candidatura; no cambia el estado del documento.
 *
 * POLÍTICA DE RETENCIÓN EPS: PENDIENTE DE DEFINICIÓN INSTITUCIONAL. El campo
 * `retencionHasta` existe vacío para una política futura; ningún proceso lo
 * llena ni purga nada.
 */

import {
  ComparacionTripleCampo, DatosAdres, EstadoAdres, EstadoAdresValidacion, OrigenTipoDocumento, RecomendacionEps, adresInicial,
} from './adres';

export enum EstadoProcesamientoEps {
  PENDIENTE = 'pendiente',
  PROCESANDO = 'procesando',
  PROCESADO = 'procesado',
  ERROR = 'error',
}

export enum AutenticidadEps {
  NO_EVALUADA = 'no_evaluada',
  VERIFICADA = 'verificada',
  NO_VERIFICABLE = 'no_verificable',
  INVALIDA = 'invalida',
}

export enum CoincidenciaEps {
  NO_EVALUADA = 'no_evaluada',
  COINCIDE = 'coincide',
  DISCREPANCIA = 'discrepancia',
  INSUFICIENTE = 'insuficiente',
}

export enum AfiliacionEps {
  NO_CONTRASTADA = 'no_contrastada',
  ACTIVA = 'activa',
  INACTIVA = 'inactiva',
  NO_DETERMINABLE = 'no_determinable',
}

export enum RutaValidacionEps {
  SIN_DETERMINAR = 'sin_determinar',
  QR = 'qr',
  ADRES_ASISTIDO = 'adres_asistido',
  REVISION_MANUAL = 'revision_manual',
}

export enum DecisionEps {
  PENDIENTE = 'pendiente',
  CANDIDATO_AUTOAPROBACION = 'candidato_autoaprobacion',
  /** Reservado: ningún código de esta fase lo asigna (hay un CHECK en la base). */
  APROBADO_AUTOMATICO = 'aprobado_automatico',
  APROBADO_MANUAL = 'aprobado_manual',
  DEVUELTO = 'devuelto',
  RECHAZADO = 'rechazado',
}

/** Decisiones que toma una persona. */
export const DECISIONES_HUMANAS: readonly DecisionEps[] = [
  DecisionEps.APROBADO_MANUAL,
  DecisionEps.DEVUELTO,
  DecisionEps.RECHAZADO,
];

/** Vigencia institucional del certificado (por su fecha de expedición). */
export type VigenciaCertificado = 'vigente' | 'vencido' | 'no_determinada';

/** Lo que el certificado DICE, normalizado para poder compararlo. */
export interface DatosExtraidosEps {
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  nombre: string | null;
  /** Nombre de la EPS tal como aparece, con espacios normalizados. */
  eps: string | null;
  /** Clave canónica para comparar EPS (alias futuros). */
  epsClave: string | null;
  regimen: string | null;
  tipoAfiliado: string | null;
  /** Estado que el CERTIFICADO reporta; no es el estado real de la afiliación. */
  estadoReportadoCertificado: string | null;
  /** AAAA-MM-DD. */
  fechaExpedicion: string | null;
  /** De qué fuente salió cada dato (`texto_nativo`, `ocr`, `qr`), por nombre de campo del certificado. */
  fuentes?: Record<string, 'texto_nativo' | 'ocr' | 'qr'>;
  /**
   * Qué tipo de documento parece ser por su CONTENIDO (clasificación local previa a ADRES). Ausente en validaciones anteriores a la
   * clasificación. `no_determinable` = no se pudo leer o no alcanza; NO equivale a «incorrecto».
   */
  tipoDocumentoDetectado?: 'certificado_eps_probable' | 'documento_incorrecto' | 'no_determinable';
  /** Códigos de motivo de la clasificación (sin texto del documento). */
  motivosClasificacion?: string[];
}

/**
 * Lo que una fuente oficial CONFIRMÓ. Vacío mientras no haya un verificador
 * habilitado. Cada campo es opcional: solo viene lo que esa fuente devuelve.
 */
export interface DatosVerificadosEps {
  fuente: string;
  verificadoEn: string;
  eps: string | null;
  regimen: string | null;
  /** Estado de afiliación que la FUENTE confirma (no el que imprime el certificado). */
  estadoAfiliacion: string | null;
  tipoDocumento?: string | null;
  numeroDocumento?: string | null;
  nombre?: string | null;
  /** AAAA-MM-DD. */
  fechaExpedicion?: string | null;
}

export interface DiscrepanciaEps {
  campo: 'numero_documento' | 'nombre' | 'fecha_expedicion' | 'eps' | 'regimen' | 'estado_reportado';
  /** Lo que dice el certificado frente a lo que SIPRA esperaba (comparación interna). */
  esperado: string | null;
  observado: string | null;
  /** Comparación con la fuente oficial: de quién es cada valor. Ausente en la comparación interna. */
  comparacion?: 'certificado_vs_interno' | 'oficial_vs_certificado' | 'oficial_vs_interno';
  interno?: string | null;
  certificado?: string | null;
  oficial?: string | null;
  /** `fuentes_distintas`: el texto digital y el OCR leyeron valores diferentes; no se escogió ninguno. */
  resultado: 'diferente' | 'insuficiente' | 'vencido' | 'ausente' | 'no_reconocido' | 'fuentes_distintas';
}

export interface DatosValidacionEps {
  id: string;
  documentoId: string;
  practicaId: string;
  estudianteId: string;
  estadoProcesamiento: EstadoProcesamientoEps;
  autenticidad: AutenticidadEps;
  coincidencia: CoincidenciaEps;
  afiliacion: AfiliacionEps;
  ruta: RutaValidacionEps;
  decision: DecisionEps;
  vigenciaCertificado: VigenciaCertificado;
  hayBanderaCritica: boolean;
  datosExtraidos: DatosExtraidosEps | null;
  datosVerificados: DatosVerificadosEps | null;
  discrepancias: DiscrepanciaEps[];
  errorCodigo: string | null;
  // ── Verificación oficial (Fase 3): un verificador autoriza o no, y deja su huella ──
  /** Verificador oficial que establece la autenticidad (o la afiliación). Nulo mientras no hay. */
  verificadorCodigo: string | null;
  /** Reclamo de la verificación en curso: un solo proceso consulta a la vez. */
  verificacionIniciadaEn: Date | null;
  /** Cuándo se obtuvo el último resultado DEFINITIVO de un verificador. */
  verificadoEn: Date | null;
  /** Código del último intento que no llegó a un resultado definitivo (portal caído, tiempo…). */
  verificacionError: string | null;
  // ── Reserva: un caso, un funcionario a la vez ──
  asignadoA: string | null;
  reservadoEn: Date | null;
  reservaHasta: Date | null;
  decididoPor: string | null;
  decididoEn: Date | null;
  /** POLÍTICA DE RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL: siempre nulo por ahora. */
  retencionHasta: Date | null;
  /**
   * Quién estableció la afiliación (activa/inactiva): un verificador oficial del certificado o una
   * consulta ADRES aportada por una persona. Nulo mientras la afiliación no está contrastada.
   */
  afiliacionFuente: 'verificador_oficial' | 'adres_bdua' | null;
  /** Consulta ADRES asistida: estado propio, separado de autenticidad, coincidencia, afiliación y decisión. */
  adres: EstadoAdresValidacion;
  /** Métricas de negocio: cuándo llegó el certificado y cuándo lo tomó una persona por primera vez. */
  recibidaEn: Date | null;
  primeraRevisionEn: Date | null;
  /** Versión optimista: cada escritura la incrementa y exige la que se leyó. */
  version: number;
  creadaEn: Date;
  actualizadaEn: Date;
}

export class ValidacionEpsYaDecididaError extends Error {
  constructor() {
    super('La validación de EPS ya tiene una decisión y no admite otra');
    this.name = 'ValidacionEpsYaDecididaError';
  }
}

/** El caso está reservado por otro funcionario y la reserva sigue vigente. */
export class ReservaAjenaError extends Error {
  constructor() {
    super('El caso está reservado por otro funcionario');
    this.name = 'ReservaAjenaError';
  }
}

export class DecisionEpsInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'DecisionEpsInvalidaError';
  }
}

export interface EntradaCandidatura {
  estadoProcesamiento: EstadoProcesamientoEps;
  autenticidad: AutenticidadEps;
  coincidencia: CoincidenciaEps;
  afiliacion: AfiliacionEps;
  vigencia: VigenciaCertificado;
  hayBanderaCritica: boolean;
}

/**
 * ¿Es candidata a autoaprobación? Exige TODO a la vez:
 *   autenticidad verificada Y coincidencia de datos Y afiliación activa Y
 *   certificado dentro de la vigencia institucional Y ninguna bandera crítica.
 * Cada criterio faltante se devuelve por su nombre para poder explicarlo.
 *
 * Es solo una evaluación: NO aprueba nada ni toca el estado del documento. La
 * aprobación automática real se habilitará cuando existan verificadores
 * probados.
 */
export function evaluarCandidatoAutoaprobacion(entrada: EntradaCandidatura): {
  candidato: boolean;
  faltantes: string[];
} {
  const faltantes: string[] = [];
  if (entrada.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO) faltantes.push('procesamiento');
  if (entrada.autenticidad !== AutenticidadEps.VERIFICADA) faltantes.push('autenticidad');
  if (entrada.coincidencia !== CoincidenciaEps.COINCIDE) faltantes.push('coincidencia');
  if (entrada.afiliacion !== AfiliacionEps.ACTIVA) faltantes.push('afiliacion');
  if (entrada.vigencia !== 'vigente') faltantes.push('vigencia');
  if (entrada.hayBanderaCritica) faltantes.push('banderas_criticas');
  return { candidato: faltantes.length === 0, faltantes };
}

function copiarAdres(a: EstadoAdresValidacion): EstadoAdresValidacion {
  return { ...a, datos: a.datos ? { ...a.datos } : null, comparacion: a.comparacion.map((c) => ({ ...c, conflictos: [...c.conflictos] })) };
}

export class ConsultaAdresInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ConsultaAdresInvalidaError';
  }
}

export class ValidacionEps {
  private constructor(private datos: DatosValidacionEps) {}

  static desde(datos: DatosValidacionEps): ValidacionEps {
    return new ValidacionEps({
      ...datos,
      discrepancias: [...datos.discrepancias],
      datosExtraidos: datos.datosExtraidos ? { ...datos.datosExtraidos } : null,
      datosVerificados: datos.datosVerificados ? { ...datos.datosVerificados } : null,
      adres: copiarAdres(datos.adres),
    });
  }

  /** Validación recién creada: nada evaluado, nada decidido. */
  static pendiente(entrada: {
    id: string; documentoId: string; practicaId: string; estudianteId: string; ahora: Date;
    /** Cuándo se cargó el certificado; si no se sabe, el momento de crear la validación. */
    recibidaEn?: Date;
  }): ValidacionEps {
    return new ValidacionEps({
      id: entrada.id,
      documentoId: entrada.documentoId,
      practicaId: entrada.practicaId,
      estudianteId: entrada.estudianteId,
      estadoProcesamiento: EstadoProcesamientoEps.PENDIENTE,
      autenticidad: AutenticidadEps.NO_EVALUADA,
      coincidencia: CoincidenciaEps.NO_EVALUADA,
      afiliacion: AfiliacionEps.NO_CONTRASTADA,
      ruta: RutaValidacionEps.SIN_DETERMINAR,
      decision: DecisionEps.PENDIENTE,
      vigenciaCertificado: 'no_determinada',
      hayBanderaCritica: false,
      datosExtraidos: null,
      datosVerificados: null,
      discrepancias: [],
      errorCodigo: null,
      verificadorCodigo: null,
      verificacionIniciadaEn: null,
      verificadoEn: null,
      verificacionError: null,
      asignadoA: null,
      reservadoEn: null,
      reservaHasta: null,
      decididoPor: null,
      decididoEn: null,
      retencionHasta: null,
      afiliacionFuente: null,
      adres: adresInicial(),
      recibidaEn: entrada.recibidaEn ?? entrada.ahora,
      primeraRevisionEn: null,
      version: 1,
      creadaEn: entrada.ahora,
      actualizadaEn: entrada.ahora,
    });
  }

  get id(): string { return this.datos.id; }
  get documentoId(): string { return this.datos.documentoId; }
  get practicaId(): string { return this.datos.practicaId; }
  get estudianteId(): string { return this.datos.estudianteId; }
  get estadoProcesamiento(): EstadoProcesamientoEps { return this.datos.estadoProcesamiento; }
  get autenticidad(): AutenticidadEps { return this.datos.autenticidad; }
  get coincidencia(): CoincidenciaEps { return this.datos.coincidencia; }
  get afiliacion(): AfiliacionEps { return this.datos.afiliacion; }
  get ruta(): RutaValidacionEps { return this.datos.ruta; }
  get decision(): DecisionEps { return this.datos.decision; }
  get version(): number { return this.datos.version; }
  get asignadoA(): string | null { return this.datos.asignadoA; }
  get estaDecidida(): boolean { return DECISIONES_HUMANAS.includes(this.datos.decision); }

  instantanea(): DatosValidacionEps {
    return {
      ...this.datos,
      discrepancias: [...this.datos.discrepancias],
      datosExtraidos: this.datos.datosExtraidos ? { ...this.datos.datosExtraidos } : null,
      datosVerificados: this.datos.datosVerificados ? { ...this.datos.datosVerificados } : null,
      adres: copiarAdres(this.datos.adres),
    };
  }

  iniciarProcesamiento(ahora: Date): void {
    this.exigirNoDecidida();
    this.datos.estadoProcesamiento = EstadoProcesamientoEps.PROCESANDO;
    this.datos.errorCodigo = null;
    this.datos.actualizadaEn = ahora;
  }

  /**
   * Registra el resultado del procesamiento LOCAL del certificado: lo que dice,
   * cómo se compara con el estudiante y qué tan vigente es. No evalúa
   * autenticidad ni afiliación: sin QR ni consulta externa siguen sin evaluar.
   */
  registrarProcesamiento(
    resultado: {
      datosExtraidos: DatosExtraidosEps;
      coincidencia: CoincidenciaEps;
      discrepancias: DiscrepanciaEps[];
      vigencia: VigenciaCertificado;
      hayBanderaCritica: boolean;
    },
    ahora: Date,
  ): void {
    this.exigirNoDecidida();
    this.datos.estadoProcesamiento = EstadoProcesamientoEps.PROCESADO;
    this.datos.datosExtraidos = { ...resultado.datosExtraidos };
    this.datos.coincidencia = resultado.coincidencia;
    this.datos.discrepancias = [...resultado.discrepancias];
    this.datos.vigenciaCertificado = resultado.vigencia;
    this.datos.hayBanderaCritica = resultado.hayBanderaCritica;
    this.datos.errorCodigo = null;
    // Sin QR ni ADRES disponibles, la única ruta honesta es la revisión de una persona.
    if (this.datos.ruta === RutaValidacionEps.SIN_DETERMINAR) this.datos.ruta = RutaValidacionEps.REVISION_MANUAL;
    this.datos.actualizadaEn = ahora;
    this.recalcularCandidatura();
  }

  /** Para verificadores futuros (QR, respuesta de la EPS, ADRES). */
  registrarVerificacion(
    verificacion: {
      autenticidad?: AutenticidadEps;
      afiliacion?: AfiliacionEps;
      ruta?: RutaValidacionEps;
      datosVerificados?: DatosVerificadosEps;
    },
    ahora: Date,
  ): void {
    this.exigirNoDecidida();
    if (verificacion.autenticidad !== undefined) this.datos.autenticidad = verificacion.autenticidad;
    if (verificacion.afiliacion !== undefined) this.datos.afiliacion = verificacion.afiliacion;
    if (verificacion.ruta !== undefined) this.datos.ruta = verificacion.ruta;
    if (verificacion.datosVerificados !== undefined) this.datos.datosVerificados = { ...verificacion.datosVerificados };
    this.datos.actualizadaEn = ahora;
    this.recalcularCandidatura();
  }

  // ── Verificación oficial ─────────────────────────────────────────────────

  get verificadorCodigo(): string | null { return this.datos.verificadorCodigo; }
  get verificacionIniciadaEn(): Date | null { return this.datos.verificacionIniciadaEn; }
  get verificadoEn(): Date | null { return this.datos.verificadoEn; }
  get verificacionError(): string | null { return this.datos.verificacionError; }

  /** ¿Hay un resultado definitivo de un verificador? (autenticidad o afiliación ya establecidas). */
  get tieneVerificacionDefinitiva(): boolean {
    return this.datos.verificadorCodigo !== null && this.datos.verificadoEn !== null;
  }

  /** ¿Otro proceso tiene reclamada la verificación y su reclamo sigue vigente? */
  verificacionEnCurso(ahora: Date, caducidadMs: number): boolean {
    const inicio = this.datos.verificacionIniciadaEn;
    return inicio !== null && ahora.getTime() - inicio.getTime() < caducidadMs;
  }

  /** Reclama la verificación. Se guarda con compare-and-set por versión: de varios, uno solo gana. */
  iniciarVerificacion(ahora: Date): void {
    this.exigirNoDecidida();
    this.datos.verificacionIniciadaEn = ahora;
    this.datos.actualizadaEn = ahora;
  }

  /**
   * Resultado DEFINITIVO de un verificador oficial. La autenticidad y la
   * afiliación se establecen aquí y solo aquí, con el verificador que las
   * respalda. `afiliacion` omitido = ese verificador no la confirma: se conserva
   * `no_contrastada` aunque el certificado diga «ACTIVO».
   */
  registrarVerificacionOficial(
    r: {
      verificador: string;
      autenticidad: AutenticidadEps;
      afiliacion?: AfiliacionEps;
      ruta: RutaValidacionEps;
      datosVerificados: DatosVerificadosEps | null;
      discrepancias: DiscrepanciaEps[];
      coincidencia?: CoincidenciaEps;
    },
    ahora: Date,
  ): void {
    this.exigirNoDecidida();
    this.datos.verificadorCodigo = r.verificador;
    this.datos.verificadoEn = ahora;
    this.datos.verificacionIniciadaEn = null;
    this.datos.verificacionError = null;
    this.datos.autenticidad = r.autenticidad;
    if (r.afiliacion !== undefined) {
      this.datos.afiliacion = r.afiliacion;
      if (r.afiliacion === AfiliacionEps.ACTIVA || r.afiliacion === AfiliacionEps.INACTIVA) this.datos.afiliacionFuente = 'verificador_oficial';
    }
    this.datos.ruta = r.ruta;
    this.datos.datosVerificados = r.datosVerificados ? { ...r.datosVerificados } : null;
    if (r.coincidencia !== undefined) this.datos.coincidencia = r.coincidencia;
    // Las discrepancias de la verificación se suman a las ya registradas, sin repetir las suyas.
    const previas = this.datos.discrepancias.filter((d) => d.comparacion === undefined || d.comparacion === 'certificado_vs_interno');
    this.datos.discrepancias = [...previas, ...r.discrepancias];
    this.datos.actualizadaEn = ahora;
    this.recalcularCandidatura();
  }

  /**
   * La verificación no pudo establecer nada (QR sin verificador, portal caído,
   * respuesta inválida): se anota el código y se libera el reclamo. NO toca la
   * autenticidad: un error de red no vuelve falso a un certificado.
   */
  registrarVerificacionNoConcluyente(codigo: string, ahora: Date, autenticidad?: AutenticidadEps): void {
    this.exigirNoDecidida();
    this.datos.verificacionIniciadaEn = null;
    this.datos.verificacionError = codigo.slice(0, 40);
    if (autenticidad !== undefined) this.datos.autenticidad = autenticidad;
    this.datos.actualizadaEn = ahora;
    this.recalcularCandidatura();
  }

  // ── Consulta ADRES asistida ───────────────────────────────────────────────

  get adresEstado(): EstadoAdres { return this.datos.adres.estado; }

  adresInstantanea(): EstadoAdresValidacion { return copiarAdres(this.datos.adres); }

  /** ¿La consulta preparada sigue vigente y es de esta persona? (un solo uso, vida corta). */
  consultaAdresVigente(consultaId: string, actorId: string, ahora: Date): boolean {
    const a = this.datos.adres;
    return a.estado === EstadoAdres.EN_CONSULTA && a.consultaId !== null && a.consultaId === consultaId
      && a.preparadaPor === actorId && a.consultaVenceEn !== null && a.consultaVenceEn.getTime() > ahora.getTime();
  }

  /** SIPRA prepara la consulta; no llama a ADRES. Emite un identificador de un solo uso. */
  prepararConsultaAdres(p: {
    consultaId: string; actorId: string; ahora: Date; venceEn: Date; tipoDocumento: string;
    origenTipoDocumento: OrigenTipoDocumento; confirmadoPor: string | null;
  }): void {
    this.exigirNoDecidida();
    const a = this.datos.adres;
    if (![EstadoAdres.PENDIENTE, EstadoAdres.EN_CONSULTA, EstadoAdres.ERROR, EstadoAdres.NO_DETERMINABLE].includes(a.estado)) {
      throw new ConsultaAdresInvalidaError('Esta validación no necesita una consulta ADRES en su estado actual');
    }
    a.estado = EstadoAdres.EN_CONSULTA;
    a.consultaId = p.consultaId;
    a.consultaVenceEn = p.venceEn;
    a.preparadaPor = p.actorId;
    a.preparadaEn = p.ahora;
    a.tipoDocumento = p.tipoDocumento;
    a.tipoDocumentoOrigen = p.origenTipoDocumento;
    a.tipoDocumentoConfirmadoPor = p.confirmadoPor;
    a.error = null;
    this.datos.actualizadaEn = p.ahora;
  }

  /** La persona aportó el resultado (PDF). El identificador de la consulta se consume: no se reutiliza. */
  recibirEvidenciaAdres(p: { hash: string; referenciaArchivo: string; actorId: string; ahora: Date; consultadoEn: Date | null }): void {
    this.exigirNoDecidida();
    const a = this.datos.adres;
    if (a.estado !== EstadoAdres.EN_CONSULTA) throw new ConsultaAdresInvalidaError('No hay una consulta ADRES en curso');
    a.estado = EstadoAdres.EVIDENCIA_RECIBIDA;
    a.evidenciaHash = p.hash;
    a.referenciaArchivo = p.referenciaArchivo;
    a.cargadaPor = p.actorId;
    a.cargadaEn = p.ahora;
    a.consultadoEn = p.consultadoEn;
    a.consultaId = null;
    a.consultaVenceEn = null;
    a.error = null;
    this.datos.actualizadaEn = p.ahora;
  }

  /**
   * Incorpora lo que dice ADRES. SOLO el eje de afiliación puede cambiar (y solo si el resultado
   * quedó atado al estudiante). La autenticidad del certificado NO se toca: ADRES no lo expide.
   */
  registrarResultadoAdres(r: {
    estado: EstadoAdres.PROCESADO | EstadoAdres.NO_DETERMINABLE; error: string | null; datos: DatosAdres;
    comparacion: ComparacionTripleCampo[]; afiliacion: AfiliacionEps | null; recomendacion: RecomendacionEps;
    consultadoEn: Date | null; fuenteActualizadaEn: Date | null;
  }, ahora: Date): void {
    this.exigirNoDecidida();
    const a = this.datos.adres;
    if (a.estado !== EstadoAdres.EVIDENCIA_RECIBIDA && a.estado !== EstadoAdres.ERROR) {
      throw new ConsultaAdresInvalidaError('No hay un resultado ADRES por procesar');
    }
    a.estado = r.estado;
    a.error = r.error;
    a.datos = { ...r.datos };
    a.comparacion = r.comparacion.map((c) => ({ ...c, conflictos: [...c.conflictos] }));
    a.recomendacion = r.recomendacion;
    if (r.consultadoEn) a.consultadoEn = r.consultadoEn;
    a.fuenteActualizadaEn = r.fuenteActualizadaEn;
    if (r.afiliacion === AfiliacionEps.ACTIVA || r.afiliacion === AfiliacionEps.INACTIVA) {
      this.datos.afiliacion = r.afiliacion;
      this.datos.afiliacionFuente = 'adres_bdua';
    } else if (r.afiliacion === AfiliacionEps.NO_DETERMINABLE && this.datos.afiliacionFuente === null) {
      this.datos.afiliacion = AfiliacionEps.NO_DETERMINABLE;
    }
    this.datos.actualizadaEn = ahora;
    this.recalcularCandidatura();
  }

  /** El resultado no se pudo leer: queda en error y se puede volver a procesar o cargar otro. */
  marcarErrorAdres(codigo: string, ahora: Date): void {
    this.exigirNoDecidida();
    const a = this.datos.adres;
    if (a.estado !== EstadoAdres.EVIDENCIA_RECIBIDA && a.estado !== EstadoAdres.ERROR) {
      throw new ConsultaAdresInvalidaError('No hay un resultado ADRES por procesar');
    }
    a.estado = EstadoAdres.ERROR;
    a.error = codigo.slice(0, 40);
    this.datos.actualizadaEn = ahora;
  }

  marcarError(codigo: string, ahora: Date): void {
    this.exigirNoDecidida();
    this.datos.estadoProcesamiento = EstadoProcesamientoEps.ERROR;
    this.datos.errorCodigo = codigo.slice(0, 60);
    this.datos.actualizadaEn = ahora;
    this.recalcularCandidatura();
  }

  // ── Reserva ───────────────────────────────────────────────────────────────

  reservaVigente(ahora: Date): boolean {
    return this.datos.asignadoA !== null && this.datos.reservaHasta !== null
      && this.datos.reservaHasta.getTime() > ahora.getTime();
  }

  reservadaPorOtro(actorId: string, ahora: Date): boolean {
    return this.reservaVigente(ahora) && this.datos.asignadoA !== actorId;
  }

  reservar(actorId: string, ahora: Date, duracionMs: number): void {
    this.exigirNoDecidida();
    if (this.reservadaPorOtro(actorId, ahora)) throw new ReservaAjenaError();
    this.datos.asignadoA = actorId;
    this.datos.primeraRevisionEn ??= ahora;
    this.datos.reservadoEn = ahora;
    this.datos.reservaHasta = new Date(ahora.getTime() + duracionMs);
    this.datos.actualizadaEn = ahora;
  }

  liberar(actorId: string, ahora: Date, esSupervisor: boolean): void {
    if (this.reservadaPorOtro(actorId, ahora) && !esSupervisor) throw new ReservaAjenaError();
    this.limpiarReserva();
    this.datos.actualizadaEn = ahora;
  }

  // ── Decisión ──────────────────────────────────────────────────────────────

  /** Decisión de una persona. Solo desde `pendiente` o `candidato_autoaprobacion`; no se repite. */
  registrarDecisionHumana(decision: DecisionEps, actorId: string, ahora: Date): void {
    if (!DECISIONES_HUMANAS.includes(decision)) {
      throw new DecisionEpsInvalidaError(`«${decision}» no es una decisión humana`);
    }
    this.exigirNoDecidida();
    if (this.datos.decision === DecisionEps.APROBADO_AUTOMATICO) throw new ValidacionEpsYaDecididaError();
    this.datos.decision = decision;
    this.datos.decididoPor = actorId;
    this.datos.decididoEn = ahora;
    this.limpiarReserva();
    this.datos.actualizadaEn = ahora;
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private exigirNoDecidida(): void {
    if (this.estaDecidida || this.datos.decision === DecisionEps.APROBADO_AUTOMATICO) {
      throw new ValidacionEpsYaDecididaError();
    }
  }

  private limpiarReserva(): void {
    this.datos.asignadoA = null;
    this.datos.reservadoEn = null;
    this.datos.reservaHasta = null;
  }

  /** Candidata o pendiente: solo etiqueta; el documento no cambia. */
  private recalcularCandidatura(): void {
    const { candidato } = evaluarCandidatoAutoaprobacion({
      estadoProcesamiento: this.datos.estadoProcesamiento,
      autenticidad: this.datos.autenticidad,
      coincidencia: this.datos.coincidencia,
      afiliacion: this.datos.afiliacion,
      vigencia: this.datos.vigenciaCertificado,
      hayBanderaCritica: this.datos.hayBanderaCritica,
    });
    this.datos.decision = candidato ? DecisionEps.CANDIDATO_AUTOAPROBACION : DecisionEps.PENDIENTE;
    this.evaluarNecesidadAdres();
  }

  /** ¿Falta contrastar la afiliación con ADRES? Solo alterna entre «no requerido» y «pendiente». */
  private evaluarNecesidadAdres(): void {
    const a = this.datos.adres;
    const necesita = this.datos.estadoProcesamiento === EstadoProcesamientoEps.PROCESADO && !this.estaDecidida
      && this.datos.afiliacionFuente === null
      // ADRES solo tiene sentido para un certificado de afiliación EPS probable (o anterior a la clasificación): un documento
      // incorrecto o no determinable no queda «pendiente de ADRES» ni se consulta hasta que una persona lo revise.
      && [undefined, 'certificado_eps_probable'].includes(this.datos.datosExtraidos?.tipoDocumentoDetectado)
      && [AfiliacionEps.NO_CONTRASTADA, AfiliacionEps.NO_DETERMINABLE].includes(this.datos.afiliacion);
    if (necesita && a.estado === EstadoAdres.NO_REQUERIDO) a.estado = EstadoAdres.PENDIENTE;
    if (!necesita && a.estado === EstadoAdres.PENDIENTE) a.estado = EstadoAdres.NO_REQUERIDO;
  }
}
