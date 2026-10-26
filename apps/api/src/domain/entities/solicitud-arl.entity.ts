import { EstadoDocumento, TipoDocumento } from './documento.entity';
import { ModalidadPractica, ResponsableArl, definicionModalidad } from './modalidad.entity';

/**
 * Solicitud de afiliación a ARL para prácticas articuladas (portal de gestión
 * de ARL del área de Desarrollo Profesional, §5, §8 y §9 del manual).
 *
 * La CUN cubre la ARL de las prácticas dentro de la institución, del tercer
 * sector y de las organizaciones con cobertura pactada. El estudiante radica
 * la solicitud con sus soportes; el auxiliar de prácticas la valida y, si
 * aprueba, remite el certificado al correo institucional para que quede en el
 * expediente. Aquí SIPRA lo deja en el expediente directamente.
 */
export enum EstadoSolicitudArl {
  RADICADA = 'radicada',
  APROBADA = 'aprobada',
  RECHAZADA = 'rechazada',
  CERTIFICADO_ENVIADO = 'certificado_enviado',
  ANULADA = 'anulada',
}

/** Motivos de rechazo del manual (§8.3 y §9.6). */
export enum MotivoRechazoArl {
  DOCUMENTO_BORROSO = 'documento_borroso',
  DOCUMENTO_CON_CONTRASENA = 'documento_con_contrasena',
  CERTIFICADO_SISBEN = 'certificado_sisben',
  CERTIFICADO_ADRES = 'certificado_adres',
  CERTIFICADO_VENCIDO = 'certificado_vencido',
  SOPORTE_APORTES_EPS = 'soporte_aportes_eps',
  CERTIFICADO_FALSIFICADO = 'certificado_falsificado',
  PLANILLA_PAGOS = 'planilla_pagos',
  SOPORTE_NOVEDADES = 'soporte_novedades',
  IDENTIFICACION_NO_LEGIBLE = 'identificacion_no_legible',
  IDENTIFICACION_NO_CORRESPONDE = 'identificacion_no_corresponde',
  FECHAS_FUERA_DEL_PERIODO = 'fechas_fuera_del_periodo',
  JEFE_NO_COINCIDE_FIRMA = 'jefe_no_coincide_firma',
  RUT_NO_VIGENTE = 'rut_no_vigente',
  CAMARA_NO_VIGENTE = 'camara_no_vigente',
  DOCUMENTO_FALTANTE = 'documento_faltante',
  ANTICIPACION_INSUFICIENTE = 'anticipacion_insuficiente',
  MODALIDAD_NO_CUBIERTA = 'modalidad_no_cubierta',
  OTRO = 'otro',
}

export const ETIQUETA_MOTIVO_RECHAZO: Readonly<Record<MotivoRechazoArl, string>> = {
  [MotivoRechazoArl.DOCUMENTO_BORROSO]: 'Documento borroso o ilegible',
  [MotivoRechazoArl.DOCUMENTO_CON_CONTRASENA]: 'Documento con contraseña',
  [MotivoRechazoArl.CERTIFICADO_SISBEN]: 'Se cargó certificado del Sisbén en lugar del de la EPS',
  [MotivoRechazoArl.CERTIFICADO_ADRES]: 'Se cargó consulta de ADRES en lugar del certificado de la EPS',
  [MotivoRechazoArl.CERTIFICADO_VENCIDO]: 'Certificado de EPS con más de 30 días de expedición',
  [MotivoRechazoArl.SOPORTE_APORTES_EPS]: 'Se cargó soporte de aportes a EPS',
  [MotivoRechazoArl.CERTIFICADO_FALSIFICADO]: 'Certificado con indicios de alteración',
  [MotivoRechazoArl.PLANILLA_PAGOS]: 'Se cargó planilla de pagos',
  [MotivoRechazoArl.SOPORTE_NOVEDADES]: 'Se cargó soporte de novedades',
  [MotivoRechazoArl.IDENTIFICACION_NO_LEGIBLE]: 'Documento de identificación no legible',
  [MotivoRechazoArl.IDENTIFICACION_NO_CORRESPONDE]: 'El documento de identificación no corresponde al estudiante',
  [MotivoRechazoArl.FECHAS_FUERA_DEL_PERIODO]: 'Las fechas de inicio y fin no corresponden al periodo de prácticas',
  [MotivoRechazoArl.JEFE_NO_COINCIDE_FIRMA]: 'El jefe inmediato del acta no coincide con la firma de la empresa',
  [MotivoRechazoArl.RUT_NO_VIGENTE]: 'El RUT no es del año en curso',
  [MotivoRechazoArl.CAMARA_NO_VIGENTE]: 'La Cámara de Comercio no es del año en curso',
  [MotivoRechazoArl.DOCUMENTO_FALTANTE]: 'Falta un documento exigido para la solicitud',
  [MotivoRechazoArl.ANTICIPACION_INSUFICIENTE]: 'La solicitud no se radicó con cinco días hábiles de anticipación',
  [MotivoRechazoArl.MODALIDAD_NO_CUBIERTA]: 'La modalidad no está cubierta por la ARL de la CUN',
  [MotivoRechazoArl.OTRO]: 'Otro motivo (ver observación)',
};

export type RegimenEps = 'convencional' | 'regimen_especial' | 'fomag' | 'epsi';
export const REGIMENES_EPS: readonly RegimenEps[] = ['convencional', 'regimen_especial', 'fomag', 'epsi'];
/** Afiliaciones que ADRES no registra como vigentes: las verifica el auxiliar a mano (§5.1.1). */
export const REGIMENES_VERIFICACION_MANUAL: readonly RegimenEps[] = ['regimen_especial', 'fomag'];

export type TipoIdentificacion = 'CC' | 'TI' | 'CE' | 'PA';
export const TIPOS_IDENTIFICACION: readonly TipoIdentificacion[] = ['CC', 'TI', 'CE', 'PA'];

export interface DocumentoAportadoArl {
  tipo: TipoDocumento;
  documentoId: string;
  estado: EstadoDocumento;
}

export type ResultadoCriterio = 'cumple' | 'no_cumple' | 'revision_manual';

export interface CriterioEvaluado {
  criterio: string;
  resultado: ResultadoCriterio;
  detalle: string;
  motivo: MotivoRechazoArl | null;
}

export type Recomendacion = 'aprobar' | 'rechazar' | 'revision_manual';

export interface ValidacionAutomaticaArl {
  evaluadaEn: string; // ISO
  recomendacion: Recomendacion;
  criterios: readonly CriterioEvaluado[];
  motivos: readonly MotivoRechazoArl[];
}

export interface DatosSolicitudArl {
  id: string;
  /** Consecutivo que asigna la base. */
  consecutivo: number | null;
  practicaId: string;
  estudianteId: string;
  periodoAcademico: string;
  modalidad: ModalidadPractica;
  tipoIdentificacion: TipoIdentificacion;
  numeroIdentificacion: string;
  fechaInicio: Date;
  fechaFin: Date;
  epsNombre: string;
  epsRegimen: RegimenEps;
  /** Fechas de expedición que el estudiante declara (§9.1 y §9.4). */
  fechaExpedicionEps: Date | null;
  fechaExpedicionRut: Date | null;
  fechaExpedicionCamara: Date | null;
  documentos: readonly DocumentoAportadoArl[];
  validacion: ValidacionAutomaticaArl | null;
  estado: EstadoSolicitudArl;
  motivosRechazo: readonly MotivoRechazoArl[];
  observacion: string | null;
  decididaPor: string | null;
  decididaEn: Date | null;
  certificadoDocumentoId: string | null;
  certificadoEnviadoEn: Date | null;
  radicadaEn: Date;
  actualizadaEn: Date;
}

export class SolicitudArlError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'SolicitudArlError';
  }
}

/** ¿La ARL de esta modalidad la gestiona la CUN por el portal? */
export function aplicaSolicitudArl(modalidad: ModalidadPractica): 'si' | 'no' | 'segun_cobertura' {
  const definicion = definicionModalidad(modalidad);
  if (definicion.articulada || definicion.responsableArlPorDefecto === ResponsableArl.CUN) return 'si';
  // Tercer sector (§2.2): una pasantía en fundación, ONG o entidad sin ánimo de
  // lucro la cubre la CUN; en una empresa, la empresa. Lo decide el auxiliar.
  if (definicion.responsableArlPorDefecto === ResponsableArl.SEGUN_COBERTURA
    || modalidad === ModalidadPractica.PASANTIA) return 'segun_cobertura';
  return 'no';
}

/** Soportes de la solicitud según la modalidad (§5.1 y §9). */
export function documentosExigidosArl(modalidad: ModalidadPractica): readonly TipoDocumento[] {
  const base = [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.CEDULA];
  switch (modalidad) {
    case ModalidadPractica.CUNBRE_NACIENTE:
      return [...base, TipoDocumento.RUT_NATURAL];
    case ModalidadPractica.CUNBRE_CONSOLIDADO:
      return [...base, TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO];
    default:
      return [...base, TipoDocumento.ACTA_INICIO];
  }
}

export class SolicitudArl {
  private constructor(private readonly datos: DatosSolicitudArl) {}

  static desde(datos: DatosSolicitudArl): SolicitudArl {
    return new SolicitudArl({ ...datos, documentos: [...datos.documentos], motivosRechazo: [...datos.motivosRechazo] });
  }

  get id(): string { return this.datos.id; }
  get practicaId(): string { return this.datos.practicaId; }
  get estudianteId(): string { return this.datos.estudianteId; }
  get estado(): EstadoSolicitudArl { return this.datos.estado; }
  get modalidad(): ModalidadPractica { return this.datos.modalidad; }
  get fechaInicio(): Date { return this.datos.fechaInicio; }
  get esVigente(): boolean {
    return [EstadoSolicitudArl.RADICADA, EstadoSolicitudArl.APROBADA].includes(this.datos.estado);
  }

  instantanea(): DatosSolicitudArl {
    return { ...this.datos, documentos: [...this.datos.documentos], motivosRechazo: [...this.datos.motivosRechazo] };
  }

  registrarValidacion(validacion: ValidacionAutomaticaArl, ahora: Date = new Date()): void {
    this.datos.validacion = validacion;
    this.datos.actualizadaEn = ahora;
  }

  /** El auxiliar aprueba; también puede revertir un rechazo (§9.7). */
  aprobar(actorId: string, observacion: string | null, ahora: Date = new Date()): void {
    if (![EstadoSolicitudArl.RADICADA, EstadoSolicitudArl.RECHAZADA].includes(this.datos.estado)) {
      throw new SolicitudArlError(`Una solicitud en estado ${this.datos.estado} no se aprueba`);
    }
    this.datos.estado = EstadoSolicitudArl.APROBADA;
    this.datos.motivosRechazo = [];
    this.datos.observacion = observacion;
    this.datos.decididaPor = actorId;
    this.datos.decididaEn = ahora;
    this.datos.actualizadaEn = ahora;
  }

  /** Rechazo con motivos del catálogo; sin motivo no hay rechazo. */
  rechazar(actorId: string, motivos: readonly MotivoRechazoArl[], observacion: string | null, ahora: Date = new Date()): void {
    if (![EstadoSolicitudArl.RADICADA, EstadoSolicitudArl.APROBADA].includes(this.datos.estado)) {
      throw new SolicitudArlError(`Una solicitud en estado ${this.datos.estado} no se rechaza`);
    }
    if (motivos.length === 0) throw new SolicitudArlError('El rechazo exige al menos un motivo');
    if (motivos.includes(MotivoRechazoArl.OTRO) && !observacion?.trim()) {
      throw new SolicitudArlError('El motivo «otro» exige una observación');
    }
    this.datos.estado = EstadoSolicitudArl.RECHAZADA;
    this.datos.motivosRechazo = [...new Set(motivos)];
    this.datos.observacion = observacion;
    this.datos.decididaPor = actorId;
    this.datos.decididaEn = ahora;
    this.datos.actualizadaEn = ahora;
  }

  registrarCertificado(documentoId: string, ahora: Date = new Date()): void {
    if (this.datos.estado !== EstadoSolicitudArl.APROBADA) {
      throw new SolicitudArlError('El certificado solo se remite para una solicitud aprobada');
    }
    this.datos.estado = EstadoSolicitudArl.CERTIFICADO_ENVIADO;
    this.datos.certificadoDocumentoId = documentoId;
    this.datos.certificadoEnviadoEn = ahora;
    this.datos.actualizadaEn = ahora;
  }

  /** El estudiante retira una solicitud que aún no se decidió. */
  anular(ahora: Date = new Date()): void {
    if (this.datos.estado !== EstadoSolicitudArl.RADICADA) {
      throw new SolicitudArlError('Solo se anula una solicitud radicada y sin decisión');
    }
    this.datos.estado = EstadoSolicitudArl.ANULADA;
    this.datos.actualizadaEn = ahora;
  }
}
