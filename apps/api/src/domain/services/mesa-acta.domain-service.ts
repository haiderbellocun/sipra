import { EstadoDocumento } from '../entities/documento.entity';
import { DatosValidacionActa, EstadoValidacionActa } from '../entities/validacion-acta.entity';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from './justificacion-decision';

/**
 * Reglas de la Mesa de Actas de Iniciación (dominio puro): recomendación, justificación, motivos de devolución,
 * prioridad y cómo se le cuenta al estudiante. Sin dependencia de la Mesa de EPS.
 */

/** Cuánto dura la reserva de un caso. Si la persona la abandona, vence sola. (Misma política que la Mesa de EPS.) */
export const DURACION_RESERVA_ACTA_MS = 15 * 60_000;

// ── Recomendación del sistema (una recomendación, no una decisión) ──────────

export enum RecomendacionActa {
  /** Todo lo principal coincide y las firmas no faltan. */
  CONSISTENTE = 'consistente',
  /** Algo crítico no coincide (estudiante, documento, empresa, NIT, remuneración, responsable de la ARL). */
  DISCREPANCIA_CRITICA = 'discrepancia_critica',
  /** Lo leído dice que no es un acta de iniciación. */
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  /** No se pudo determinar qué es o qué dice: lo decide la lectura de una persona. */
  NO_DETERMINABLE = 'no_determinable',
  /** Falta (con trazo medido) la firma de la empresa o del practicante. */
  FIRMA_FALTANTE = 'firma_faltante',
  /** Hay diferencias no críticas o datos sin poder comparar. */
  REVISAR = 'revisar',
}

export function recomendacionActa(v: Pick<DatosValidacionActa,
  'tipoActaDetectada' | 'hayDiscrepanciaCritica' | 'firmaEmpresa' | 'firmaPracticante' | 'comparacion'>): RecomendacionActa {
  if (v.tipoActaDetectada === 'documento_incorrecto') return RecomendacionActa.DOCUMENTO_INCORRECTO;
  if (v.tipoActaDetectada !== 'iniciacion_practicas') return RecomendacionActa.NO_DETERMINABLE;
  if (v.hayDiscrepanciaCritica) return RecomendacionActa.DISCREPANCIA_CRITICA;
  if (v.firmaEmpresa === 'no' || v.firmaPracticante === 'no') return RecomendacionActa.FIRMA_FALTANTE;
  return v.comparacion?.veredicto === 'consistente' ? RecomendacionActa.CONSISTENTE : RecomendacionActa.REVISAR;
}

export type DecisionMesaActa = 'aprobar' | 'devolver' | 'rechazar';

/**
 * Apartarse de la recomendación exige la justificación REFORZADA (la misma de la Mesa de EPS, definida una sola vez):
 *  · aprobar cuando el sistema ve una discrepancia crítica, un documento incorrecto, una firma faltante o no pudo
 *    determinar qué es;
 *  · rechazar un acta que el sistema ve consistente.
 * Cualquier otra decisión que exige justificación pide la mínima.
 */
export function evaluarApartamientoActa(
  decision: DecisionMesaActa, recomendacion: RecomendacionActa,
): { apartaDeRecomendacion: boolean; minimoJustificacion: number; motivo: string | null } {
  const negativa = [
    RecomendacionActa.DISCREPANCIA_CRITICA, RecomendacionActa.DOCUMENTO_INCORRECTO,
    RecomendacionActa.FIRMA_FALTANTE, RecomendacionActa.NO_DETERMINABLE,
  ].includes(recomendacion);
  if (decision === 'aprobar' && negativa) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Aprueba aunque el sistema recomienda revisar o devolver' };
  }
  if (decision === 'rechazar' && recomendacion === RecomendacionActa.CONSISTENTE) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Rechaza un acta que el sistema ve consistente' };
  }
  return { apartaDeRecomendacion: false, minimoJustificacion: JUSTIFICACION_MINIMA, motivo: null };
}

// ── Motivos de devolución (lo que lee el estudiante) ────────────────────────

export enum MotivoDevolucionActa {
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  INFORMACION_NO_COINCIDE = 'informacion_no_coincide',
  ARL_NO_COINCIDE = 'arl_no_coincide',
  REMUNERACION_NO_COINCIDE = 'remuneracion_no_coincide',
  FALTA_FIRMA_EMPRESA = 'falta_firma_empresa',
  FALTA_FIRMA_PRACTICANTE = 'falta_firma_practicante',
  ILEGIBLE = 'documento_ilegible',
  INFORMACION_INCOMPLETA = 'informacion_incompleta',
  OTRO = 'otro',
}

const CONTACTAR = 'Contacta a coordinación o carga el documento correcto, según corresponda.';

/** Qué ocurrió y qué debe hacer, en lenguaje de quien estudia. Sin códigos ni nombres internos. */
export const MENSAJES_DEVOLUCION_ACTA: Readonly<Record<MotivoDevolucionActa, { que: string; hacer: string }>> = {
  [MotivoDevolucionActa.DOCUMENTO_INCORRECTO]: {
    que: 'El documento cargado no es el acta de iniciación de prácticas.',
    hacer: 'Descarga el formato de acta de iniciación, diligéncialo, fírmalo y cárgalo de nuevo.',
  },
  [MotivoDevolucionActa.INFORMACION_NO_COINCIDE]: {
    que: 'La información del acta no coincide con la registrada en tu práctica.',
    hacer: 'Revisa que los datos del acta (estudiante, documento, empresa, NIT y fechas) sean los de tu práctica y cárgala de nuevo. Si el dato registrado es el equivocado, comunícate con coordinación.',
  },
  [MotivoDevolucionActa.ARL_NO_COINCIDE]: {
    que: 'El responsable de la ARL indicado en el acta no coincide con la información registrada en tu práctica.',
    hacer: CONTACTAR,
  },
  [MotivoDevolucionActa.REMUNERACION_NO_COINCIDE]: {
    que: 'El tipo de práctica del acta (remunerada o no remunerada) no coincide con la información registrada en tu práctica.',
    hacer: CONTACTAR,
  },
  [MotivoDevolucionActa.FALTA_FIRMA_EMPRESA]: {
    que: 'Al acta le falta la firma de la empresa.',
    hacer: 'Pide a la empresa que la firme y cárgala de nuevo.',
  },
  [MotivoDevolucionActa.FALTA_FIRMA_PRACTICANTE]: {
    que: 'Al acta le falta tu firma.',
    hacer: 'Fírmala y cárgala de nuevo.',
  },
  [MotivoDevolucionActa.ILEGIBLE]: {
    que: 'No pudimos leer tu acta con claridad.',
    hacer: 'Cárgala de nuevo completa, enfocada y con buena luz, o usa el PDF original.',
  },
  [MotivoDevolucionActa.INFORMACION_INCOMPLETA]: {
    que: 'Al acta le falta información necesaria.',
    hacer: 'Completa todos los campos del formato y cárgala de nuevo.',
  },
  [MotivoDevolucionActa.OTRO]: {
    que: 'Tu acta de iniciación necesita una corrección.',
    hacer: 'Lee la indicación del equipo de prácticas y carga una nueva versión.',
  },
};

/** Mensaje que queda en el documento (lo que lee el estudiante): qué ocurrió, más la explicación si el motivo es «otro». */
export function mensajeDevolucionActa(motivo: MotivoDevolucionActa, detalle: string | null): string {
  const base = MENSAJES_DEVOLUCION_ACTA[motivo].que;
  const extra = detalle?.trim();
  if (motivo === MotivoDevolucionActa.OTRO && extra) return extra;
  return extra ? `${base} ${extra}` : base;
}

// ── Prioridad (simple y explicable; no es una fórmula institucional) ─────────

/**
 * No hay una fórmula institucional para las actas: la prioridad es una suma de señales visibles, cada una con su peso y su
 * razón, y se puede recalcular a mano. No usa IA. Un mayor puntaje se atiende antes; el empate lo rompe la antigüedad.
 */
export const PESOS_PRIORIDAD_ACTA = {
  documentoIncorrecto: 40,
  discrepanciaCritica: 30,
  firmaFaltante: 15,
  firmaSinDeterminar: 5,
  reenvio: 10,
  /** Por cada día en bandeja, hasta el tope. */
  porDiaEnBandeja: 2,
  topeDiasEnBandeja: 10,
  inicioYaPasado: 25,
  inicioEnUnaSemana: 20,
  inicioEnDosSemanas: 10,
} as const;

export interface EntradaPrioridadActa {
  tipoActaDetectada: DatosValidacionActa['tipoActaDetectada'];
  hayDiscrepanciaCritica: boolean;
  firmaEmpresa: DatosValidacionActa['firmaEmpresa'];
  firmaPracticante: DatosValidacionActa['firmaPracticante'];
  /** Versión del documento: mayor que 1 = reenvío. */
  version: number;
  recibidaEn: Date | null;
  fechaInicio: Date | null;
}

export interface PrioridadActa { puntaje: number; razones: string[] }

const DIA_MS = 86_400_000;

export function calcularPrioridadActa(e: EntradaPrioridadActa, ahora: Date): PrioridadActa {
  const P = PESOS_PRIORIDAD_ACTA;
  let puntaje = 0;
  const razones: string[] = [];
  const sumar = (puntos: number, razon: string): void => { puntaje += puntos; razones.push(razon); };

  if (e.tipoActaDetectada === 'documento_incorrecto') sumar(P.documentoIncorrecto, 'Parece otro documento');
  if (e.hayDiscrepanciaCritica) sumar(P.discrepanciaCritica, 'Hay una discrepancia crítica');
  if (e.firmaEmpresa === 'no' || e.firmaPracticante === 'no') sumar(P.firmaFaltante, 'Falta una firma');
  else if (e.tipoActaDetectada === 'iniciacion_practicas' && (e.firmaEmpresa === 'no_determinable' || e.firmaPracticante === 'no_determinable')) {
    sumar(P.firmaSinDeterminar, 'Una firma no se pudo determinar');
  }
  if (e.version > 1) sumar(P.reenvio, `Reenvío (versión ${e.version})`);
  if (e.recibidaEn) {
    const dias = Math.max(0, Math.floor((ahora.getTime() - e.recibidaEn.getTime()) / DIA_MS));
    if (dias > 0) sumar(Math.min(dias, P.topeDiasEnBandeja) * P.porDiaEnBandeja, `${dias} día(s) en bandeja`);
  }
  if (e.fechaInicio) {
    const dias = Math.floor((e.fechaInicio.getTime() - ahora.getTime()) / DIA_MS);
    if (dias < 0) sumar(P.inicioYaPasado, 'La práctica ya inició');
    else if (dias <= 7) sumar(P.inicioEnUnaSemana, 'La práctica inicia en una semana o menos');
    else if (dias <= 14) sumar(P.inicioEnDosSemanas, 'La práctica inicia en dos semanas o menos');
  }
  return { puntaje, razones };
}

// ── Cómo se le cuenta al estudiante ─────────────────────────────────────────

/**
 * Estados HUMANOS: lo único que el estudiante ve. Nunca nombres internos de estado, códigos de discrepancia, códigos de
 * capas del pipeline ni la lectura del documento.
 */
export type EstadoActaParaEstudiante =
  | 'sin_cargar' | 'en_cola' | 'leyendo' | 'con_el_equipo'
  | 'por_corregir' | 'validada' | 'rechazada' | 'por_revisar';

export interface ActaParaEstudiante {
  estado: EstadoActaParaEstudiante;
  etiqueta: string;
  /** Qué ocurrió. */
  que: string;
  /** Qué puede o debe hacer. */
  hacer: string;
  /** Puede subir una nueva versión del acta. */
  puedeReenviar: boolean;
}

export interface EntradaEstadoActa {
  documento: { estado: EstadoDocumento; motivoDevolucion: string | null } | null;
  validacion: { estado: EstadoValidacionActa; motivoDecision: string | null } | null;
}

export function estadoActaParaEstudiante(e: EntradaEstadoActa): ActaParaEstudiante {
  if (!e.documento) {
    return {
      estado: 'sin_cargar', etiqueta: 'Acta pendiente de cargar', puedeReenviar: true,
      que: 'Todavía no has cargado el acta de iniciación de tu práctica.',
      hacer: 'Descarga el formato, diligéncialo, fírmalo y cárgalo.',
    };
  }
  const v = e.validacion?.estado ?? null;
  if (v === EstadoValidacionActa.APROBADO_MANUAL) {
    return { estado: 'validada', etiqueta: 'Acta validada', que: 'Tu acta de iniciación fue validada.', hacer: 'No necesitas hacer nada más con este documento.', puedeReenviar: false };
  }
  if (v === EstadoValidacionActa.DEVUELTO) {
    const motivo = e.validacion?.motivoDecision as MotivoDevolucionActa | null;
    const catalogo = motivo && MENSAJES_DEVOLUCION_ACTA[motivo] ? MENSAJES_DEVOLUCION_ACTA[motivo] : MENSAJES_DEVOLUCION_ACTA[MotivoDevolucionActa.OTRO];
    return {
      estado: 'por_corregir', etiqueta: 'Necesita corrección', puedeReenviar: true,
      // Con motivo «otro» (o sin catálogo) el mensaje es el que escribió quien revisó.
      que: motivo === MotivoDevolucionActa.OTRO || !motivo ? (e.documento.motivoDevolucion ?? catalogo.que) : catalogo.que,
      hacer: catalogo.hacer,
    };
  }
  if (v === EstadoValidacionActa.RECHAZADO) {
    return {
      estado: 'rechazada', etiqueta: 'Acta rechazada', puedeReenviar: true,
      que: 'Tu acta de iniciación fue rechazada por el equipo de prácticas.',
      hacer: 'Comunícate con coordinación para definir cómo continuar.',
    };
  }
  if (e.documento.estado === EstadoDocumento.ILEGIBLE || v === EstadoValidacionActa.ERROR) {
    return {
      estado: 'por_revisar', etiqueta: 'Necesita revisión', puedeReenviar: true,
      que: 'No pudimos leer tu acta con claridad.',
      hacer: 'Cárgala de nuevo completa, enfocada y con buena luz, o usa el PDF original.',
    };
  }
  if (v === EstadoValidacionActa.PROCESANDO) {
    return { estado: 'leyendo', etiqueta: 'Estamos revisando tu acta', que: 'Estamos leyendo tu acta de iniciación.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.', puedeReenviar: false };
  }
  if (v === EstadoValidacionActa.REVISION) {
    return { estado: 'con_el_equipo', etiqueta: 'Acta en revisión', que: 'Tu acta de iniciación está en revisión por el equipo de prácticas.', hacer: 'No necesitas hacer nada: te avisamos cuando haya una decisión.', puedeReenviar: false };
  }
  // Cargada, todavía sin procesar.
  return { estado: 'en_cola', etiqueta: 'Acta pendiente de procesar', que: 'Recibimos tu acta de iniciación y está en cola para revisarse.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.', puedeReenviar: false };
}
