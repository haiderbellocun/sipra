/**
 * Solicitudes PQRS de Desarrollo Profesional (peticiones, quejas, reclamos y
 * sugerencias del estudiante sobre su proceso de prácticas).
 *
 * El documento de preguntas y respuestas fija dos reglas del trámite: las
 * categorías son las mismas de la ayuda, y cuando hay más de un requerimiento
 * sobre el mismo tema el sistema **unifica** el trámite para conservar la
 * trazabilidad —la respuesta oficial va en el radicado inicial—.
 */
export type CategoriaPqrs =
  | 'inicio_y_requisitos_de_practicas' | 'modalidades_y_duracion_de_practicas' | 'carta_de_presentacion'
  | 'registro_y_documentos_en_sgp' | 'afiliacion_y_cobertura_de_arl_y_eps' | 'acta_de_inicio_y_fechas'
  | 'acompanamiento_y_seguimiento_de_practicas' | 'plan_de_mejoramiento' | 'notas_y_situacion_academica'
  | 'contrato_de_aprendizaje_y_cadena_de_formacion' | 'certificados_y_experiencia_profesional'
  | 'soporte_tecnico_del_sgp' | 'fechas_y_cronograma' | 'tickets_y_seguimiento_de_solicitudes'
  | 'apoyo_laboral' | 'convenios';

export const CATEGORIAS_PQRS: readonly CategoriaPqrs[] = [
  'inicio_y_requisitos_de_practicas', 'modalidades_y_duracion_de_practicas', 'carta_de_presentacion',
  'registro_y_documentos_en_sgp', 'afiliacion_y_cobertura_de_arl_y_eps', 'acta_de_inicio_y_fechas',
  'acompanamiento_y_seguimiento_de_practicas', 'plan_de_mejoramiento', 'notas_y_situacion_academica',
  'contrato_de_aprendizaje_y_cadena_de_formacion', 'certificados_y_experiencia_profesional',
  'soporte_tecnico_del_sgp', 'fechas_y_cronograma', 'tickets_y_seguimiento_de_solicitudes',
  'apoyo_laboral', 'convenios',
];

export type TipoPqrs = 'peticion' | 'queja' | 'reclamo' | 'sugerencia';
export const TIPOS_PQRS: readonly TipoPqrs[] = ['peticion', 'queja', 'reclamo', 'sugerencia'];

export enum EstadoPqrs {
  RADICADA = 'radicada',
  EN_TRAMITE = 'en_tramite',
  RESPONDIDA = 'respondida',
  CERRADA = 'cerrada',
  /** Duplicada: se unificó con el radicado inicial, que lleva la respuesta oficial. */
  UNIFICADA = 'unificada',
}

export interface DatosPqrs {
  id: string;
  /** Radicado que asigna la base. */
  radicado: number | null;
  estudianteId: string;
  practicaId: string | null;
  tipo: TipoPqrs;
  categoria: CategoriaPqrs;
  asunto: string;
  descripcion: string;
  estado: EstadoPqrs;
  respuesta: string | null;
  respondidaPor: string | null;
  respondidaEn: Date | null;
  /** Radicado inicial con el que se unificó, si fue duplicada. */
  unificadaConId: string | null;
  radicadaEn: Date;
  actualizadaEn: Date;
}

export class PqrsError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'PqrsError';
  }
}

export class SolicitudPqrs {
  private constructor(private readonly datos: DatosPqrs) {}

  static desde(datos: DatosPqrs): SolicitudPqrs { return new SolicitudPqrs({ ...datos }); }

  static nueva(datos: DatosPqrs): SolicitudPqrs {
    if (!CATEGORIAS_PQRS.includes(datos.categoria)) throw new PqrsError('Categoría de consulta no reconocida');
    if (!TIPOS_PQRS.includes(datos.tipo)) throw new PqrsError('Tipo de solicitud no reconocido');
    if (datos.asunto.trim().length < 5) throw new PqrsError('El asunto debe describir la solicitud (mínimo 5 caracteres)');
    if (datos.descripcion.trim().length < 20) {
      throw new PqrsError('Explique claramente el inconveniente (mínimo 20 caracteres): facilita la orientación');
    }
    return new SolicitudPqrs({ ...datos, asunto: datos.asunto.trim(), descripcion: datos.descripcion.trim() });
  }

  get id(): string { return this.datos.id; }
  get estudianteId(): string { return this.datos.estudianteId; }
  get categoria(): CategoriaPqrs { return this.datos.categoria; }
  get estado(): EstadoPqrs { return this.datos.estado; }
  get abierta(): boolean { return [EstadoPqrs.RADICADA, EstadoPqrs.EN_TRAMITE].includes(this.datos.estado); }

  instantanea(): DatosPqrs { return { ...this.datos }; }

  tomar(ahora: Date = new Date()): void {
    if (this.datos.estado !== EstadoPqrs.RADICADA) return;
    this.datos.estado = EstadoPqrs.EN_TRAMITE;
    this.datos.actualizadaEn = ahora;
  }

  /** Toda respuesta queda en el radicado; se puede complementar mientras no cierre. */
  responder(actorId: string, respuesta: string, ahora: Date = new Date()): void {
    if (!this.abierta && this.datos.estado !== EstadoPqrs.RESPONDIDA) {
      throw new PqrsError(`Una solicitud ${this.datos.estado} no admite respuesta`);
    }
    if (respuesta.trim().length < 10) throw new PqrsError('La respuesta debe orientar al estudiante (mínimo 10 caracteres)');
    this.datos.respuesta = respuesta.trim();
    this.datos.respondidaPor = actorId;
    this.datos.respondidaEn = ahora;
    this.datos.estado = EstadoPqrs.RESPONDIDA;
    this.datos.actualizadaEn = ahora;
  }

  cerrar(ahora: Date = new Date()): void {
    if (this.datos.estado === EstadoPqrs.UNIFICADA) throw new PqrsError('Una solicitud unificada ya está cerrada en su radicado inicial');
    if (this.datos.estado !== EstadoPqrs.RESPONDIDA) throw new PqrsError('Solo se cierra una solicitud respondida');
    this.datos.estado = EstadoPqrs.CERRADA;
    this.datos.actualizadaEn = ahora;
  }

  /** Duplicidad: el trámite sigue en el radicado inicial. */
  unificarCon(inicial: SolicitudPqrs, ahora: Date = new Date()): void {
    if (inicial.id === this.datos.id) throw new PqrsError('Una solicitud no se unifica consigo misma');
    this.datos.estado = EstadoPqrs.UNIFICADA;
    this.datos.unificadaConId = inicial.id;
    this.datos.respuesta = `Su caso fue unificado con el radicado n.º ${inicial.instantanea().radicado ?? '—'} sobre el mismo tema; ` +
      'la respuesta oficial se emite allí.';
    this.datos.respondidaEn = ahora;
    this.datos.actualizadaEn = ahora;
  }
}
