import { TipoDocumento } from './documento.entity';

/**
 * Bitácora del SGP: el canal de comunicación entre el estudiante y el docente
 * facilitador y, a la vez, la trazabilidad del acompañamiento. El manual del
 * docente la hace obligatoria: toda observación, retroalimentación, seguimiento,
 * novedad y actuación queda aquí. Por eso las entradas no se editan ni se
 * borran: se agregan.
 */
export enum TipoEntradaBitacora {
  /** Comunicación específica del proceso; la escriben ambas partes. */
  MENSAJE_LIBRE = 'mensaje_libre',
  /** Visita o contacto del docente con la organización. */
  SEGUIMIENTO = 'seguimiento',
  /** Desempeño y satisfacción desde la perspectiva del jefe inmediato. */
  EVALUACION_FINAL = 'evaluacion_final',
  /** Evaluación del docente y del proceso que hace el estudiante; condición de cierre. */
  EVALUA_TU_PROCESO = 'evalua_tu_proceso',
  /** Nota definitiva de 0,0 a 5,0; condición de cierre. */
  CALIFICACION_DOCENTE = 'calificacion_docente',
  /** Documentación pendiente: plazo de subsanación (ocho días calendario). */
  PLAZO_SUBSANACION = 'plazo_subsanacion',
  /** Anotaciones que deja la plataforma: devoluciones, cierre del proceso. */
  SISTEMA = 'sistema',
}

export type AutorBitacora = 'estudiante' | 'docente' | 'coordinacion' | 'sistema';

export type ModalidadVisita = 'presencial' | 'virtual' | 'telefonica';

export interface DetalleSeguimiento {
  fechaVisita: string;         // ISO (fecha y hora)
  modalidadVisita: ModalidadVisita;
  contactoNombre: string;
  contactoCargo: string | null;
  contactoArea: string | null;
  sugerenciasPlanMejoramiento: string | null;
  evaluacionJefeInmediato: string | null;
}

export interface DetalleEvaluacionFinal {
  desempeno: string;
  satisfaccionEmpresa: string;
  retroalimentacionPlanMejoramiento: string | null;
}

export interface RespuestaEvaluaTuProceso {
  pregunta: string;
  /** Escala de 1 (en desacuerdo) a 5 (totalmente de acuerdo). */
  valor: number;
}

export interface DetalleEvaluaTuProceso {
  respuestas: readonly RespuestaEvaluaTuProceso[];
  comentario: string | null;
}

export interface DetalleCalificacion {
  nota: number;
  aprobada: boolean;
}

export interface DetalleSubsanacion {
  documentos: readonly TipoDocumento[];
  venceEl: string; // ISO
}

export type DetalleEntrada =
  | DetalleSeguimiento
  | DetalleEvaluacionFinal
  | DetalleEvaluaTuProceso
  | DetalleCalificacion
  | DetalleSubsanacion
  | Record<string, never>;

export interface DatosEntradaBitacora {
  id: string;
  practicaId: string;
  tipo: TipoEntradaBitacora;
  autor: AutorBitacora;
  /** Nulo cuando la escribe la plataforma. */
  autorId: string | null;
  mensaje: string;
  detalle: DetalleEntrada | null;
  /** Fecha límite asociada (plazo de subsanación). */
  venceEl: Date | null;
  creadaEn: Date;
}

/**
 * Las cuatro preguntas del «Evalúa tu proceso». El SGP las presenta al
 * estudiante desde la bitácora y el cierre depende de que las responda.
 */
export const PREGUNTAS_EVALUA_TU_PROCESO: readonly string[] = [
  'El docente facilitador me acompañó y retroalimentó oportunamente durante la práctica.',
  'La información sobre el proceso, los documentos y los plazos fue clara.',
  'Las actividades desarrolladas en la práctica fueron pertinentes para mi formación.',
  'En general, estoy satisfecho(a) con mi proceso de práctica.',
];

export const MODALIDADES_VISITA: readonly ModalidadVisita[] = ['presencial', 'virtual', 'telefonica'];

export const ETIQUETA_ENTRADA: Readonly<Record<TipoEntradaBitacora, string>> = {
  [TipoEntradaBitacora.MENSAJE_LIBRE]: 'Mensaje libre',
  [TipoEntradaBitacora.SEGUIMIENTO]: 'Bitácora de seguimiento',
  [TipoEntradaBitacora.EVALUACION_FINAL]: 'Evaluación final',
  [TipoEntradaBitacora.EVALUA_TU_PROCESO]: 'Evalúa tu proceso',
  [TipoEntradaBitacora.CALIFICACION_DOCENTE]: 'Calificación docente',
  [TipoEntradaBitacora.PLAZO_SUBSANACION]: 'Plazo de subsanación',
  [TipoEntradaBitacora.SISTEMA]: 'Plataforma',
};

/** Quién puede escribir cada tipo de entrada. */
export const TIPOS_POR_AUTOR: Readonly<Record<Exclude<AutorBitacora, 'sistema'>, readonly TipoEntradaBitacora[]>> = {
  estudiante: [TipoEntradaBitacora.MENSAJE_LIBRE, TipoEntradaBitacora.EVALUA_TU_PROCESO],
  docente: [
    TipoEntradaBitacora.MENSAJE_LIBRE, TipoEntradaBitacora.SEGUIMIENTO,
    TipoEntradaBitacora.EVALUACION_FINAL, TipoEntradaBitacora.PLAZO_SUBSANACION,
    TipoEntradaBitacora.CALIFICACION_DOCENTE,
  ],
  coordinacion: [
    TipoEntradaBitacora.MENSAJE_LIBRE, TipoEntradaBitacora.PLAZO_SUBSANACION,
    TipoEntradaBitacora.CALIFICACION_DOCENTE,
  ],
};

export class EntradaBitacoraInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'EntradaBitacoraInvalidaError';
  }
}

export class EntradaBitacora {
  private constructor(private readonly datos: DatosEntradaBitacora) {}

  static desde(datos: DatosEntradaBitacora): EntradaBitacora {
    return new EntradaBitacora({ ...datos });
  }

  /** Construye una entrada validando su detalle según el tipo. */
  static nueva(datos: DatosEntradaBitacora): EntradaBitacora {
    const mensaje = datos.mensaje.trim();
    if (!mensaje && datos.tipo !== TipoEntradaBitacora.EVALUA_TU_PROCESO
      && datos.tipo !== TipoEntradaBitacora.CALIFICACION_DOCENTE) {
      throw new EntradaBitacoraInvalidaError('El mensaje no puede estar vacío');
    }
    if (datos.autor !== 'sistema' && !TIPOS_POR_AUTOR[datos.autor].includes(datos.tipo)) {
      throw new EntradaBitacoraInvalidaError(
        `Un perfil de ${datos.autor} no registra entradas de tipo «${ETIQUETA_ENTRADA[datos.tipo]}»`,
      );
    }
    EntradaBitacora.validarDetalle(datos.tipo, datos.detalle);
    return new EntradaBitacora({ ...datos, mensaje });
  }

  private static validarDetalle(tipo: TipoEntradaBitacora, detalle: DetalleEntrada | null): void {
    switch (tipo) {
      case TipoEntradaBitacora.SEGUIMIENTO: {
        const d = detalle as DetalleSeguimiento | null;
        if (!d?.fechaVisita || Number.isNaN(Date.parse(d.fechaVisita))) {
          throw new EntradaBitacoraInvalidaError('El seguimiento exige fecha y hora de la visita');
        }
        if (!MODALIDADES_VISITA.includes(d.modalidadVisita)) {
          throw new EntradaBitacoraInvalidaError('La modalidad de la visita es presencial, virtual o telefónica');
        }
        if (!d.contactoNombre?.trim()) {
          throw new EntradaBitacoraInvalidaError('Indique con quién se desarrolló la visita');
        }
        return;
      }
      case TipoEntradaBitacora.EVALUACION_FINAL: {
        const d = detalle as DetalleEvaluacionFinal | null;
        if (!d?.desempeno?.trim() || !d.satisfaccionEmpresa?.trim()) {
          throw new EntradaBitacoraInvalidaError(
            'La evaluación final exige el desempeño del estudiante y la satisfacción de la empresa',
          );
        }
        return;
      }
      case TipoEntradaBitacora.EVALUA_TU_PROCESO: {
        const d = detalle as DetalleEvaluaTuProceso | null;
        const respuestas = d?.respuestas ?? [];
        if (respuestas.length !== PREGUNTAS_EVALUA_TU_PROCESO.length) {
          throw new EntradaBitacoraInvalidaError(
            `«Evalúa tu proceso» tiene ${PREGUNTAS_EVALUA_TU_PROCESO.length} preguntas y todas se responden`,
          );
        }
        for (const r of respuestas) {
          if (!Number.isInteger(r.valor) || r.valor < 1 || r.valor > 5) {
            throw new EntradaBitacoraInvalidaError('Cada respuesta va de 1 a 5');
          }
        }
        return;
      }
      case TipoEntradaBitacora.CALIFICACION_DOCENTE: {
        const d = detalle as DetalleCalificacion | null;
        if (d === null || typeof d.nota !== 'number') {
          throw new EntradaBitacoraInvalidaError('La calificación exige la nota');
        }
        return;
      }
      case TipoEntradaBitacora.PLAZO_SUBSANACION: {
        const d = detalle as DetalleSubsanacion | null;
        if (!d?.venceEl || Number.isNaN(Date.parse(d.venceEl))) {
          throw new EntradaBitacoraInvalidaError('El plazo de subsanación exige fecha límite');
        }
        return;
      }
      default:
        return;
    }
  }

  get id(): string { return this.datos.id; }
  get practicaId(): string { return this.datos.practicaId; }
  get tipo(): TipoEntradaBitacora { return this.datos.tipo; }
  get autor(): AutorBitacora { return this.datos.autor; }
  get autorId(): string | null { return this.datos.autorId; }
  get creadaEn(): Date { return this.datos.creadaEn; }

  instantanea(): DatosEntradaBitacora { return { ...this.datos }; }
}

/** Promedio de las respuestas del «Evalúa tu proceso», con un decimal. */
export function promedioEvaluaTuProceso(detalle: DetalleEvaluaTuProceso): number {
  if (detalle.respuestas.length === 0) return 0;
  const suma = detalle.respuestas.reduce((n, r) => n + r.valor, 0);
  return Math.round((10 * suma) / detalle.respuestas.length) / 10;
}
