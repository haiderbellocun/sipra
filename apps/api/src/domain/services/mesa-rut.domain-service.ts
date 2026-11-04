import { ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona } from '../entities/documento-empresarial';
import { EstadoDocumento } from '../entities/documento.entity';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from './justificacion-decision';

/**
 * Reglas de la revisión humana del RUT (dominio puro): recomendación, justificación, motivos de devolución, prioridad y
 * cómo se le cuenta al estudiante. Independiente de las Mesas de EPS y de Actas (comparte solo las longitudes de justificación).
 *
 * El sistema RECOMIENDA y compara; la persona decide. Nunca se bloquea una decisión humana válida solo por la recomendación.
 */

/** Cuánto dura la reserva de un caso. Si la persona la abandona, vence sola. (Misma política que las demás mesas.) */
export const DURACION_RESERVA_RUT_MS = 15 * 60_000;

// ── Recomendación del sistema (una recomendación, no una decisión) ──────────

export enum RecomendacionRut {
  /** Lectura confiable y todo lo crítico coincide con SIPRA. */
  CONSISTENTE = 'consistente',
  /** Algo crítico no coincide con SIPRA (lectura confiable). */
  DISCREPANCIA_CRITICA = 'discrepancia_critica',
  /** Lo leído dice que no es un RUT (otro documento, p. ej. un certificado de cámara). */
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  /** No se pudo determinar qué es o qué dice: lo decide la lectura de una persona. */
  NO_DETERMINABLE = 'no_determinable',
  /** Es un RUT, pero de la otra persona (natural o jurídica) de la que el estudiante indicó. */
  PERSONA_DISTINTA = 'persona_distinta',
  /** Leído con poca certeza (típicamente OCR): hay que revisarlo contra el documento. */
  LECTURA_DUDOSA = 'lectura_dudosa',
  /** Hay datos que no se pudieron comparar (SIPRA o el RUT no los tienen). */
  INFORMACION_INSUFICIENTE = 'informacion_insuficiente',
}

export interface EntradaRecomendacionRut {
  tipoDetectado: C | null;
  expectativa: string | null;
  lecturaDudosa: boolean;
  comparacion: { veredicto?: string; hayDiscrepancia: boolean } | null;
}

export function recomendacionRut(v: EntradaRecomendacionRut): RecomendacionRut {
  if (v.tipoDetectado === C.DOCUMENTO_INCORRECTO || v.tipoDetectado?.startsWith('camara_')) return RecomendacionRut.DOCUMENTO_INCORRECTO;
  if (v.tipoDetectado !== C.RUT_PERSONA_NATURAL && v.tipoDetectado !== C.RUT_PERSONA_JURIDICA) return RecomendacionRut.NO_DETERMINABLE;
  if (v.expectativa === 'persona_distinta') return RecomendacionRut.PERSONA_DISTINTA;
  if (v.comparacion?.hayDiscrepancia) return RecomendacionRut.DISCREPANCIA_CRITICA;
  if (v.lecturaDudosa) return RecomendacionRut.LECTURA_DUDOSA;
  return v.comparacion?.veredicto === 'consistente' ? RecomendacionRut.CONSISTENTE : RecomendacionRut.INFORMACION_INSUFICIENTE;
}

export type DecisionRevisionRut = 'aprobar' | 'devolver' | 'rechazar';

/**
 * Apartarse de la recomendación exige la justificación REFORZADA (40 caracteres):
 *  · aprobar cuando el sistema NO ve el RUT consistente (discrepancia crítica, persona distinta, lectura dudosa, información
 *    insuficiente, documento incorrecto o no determinable);
 *  · rechazar un RUT que el sistema ve consistente (justificación ampliada).
 * Aprobar un RUT consistente no exige justificación larga. Cualquier otro rechazo exige la mínima.
 */
export function evaluarApartamientoRut(
  decision: DecisionRevisionRut, recomendacion: RecomendacionRut,
): { apartaDeRecomendacion: boolean; minimoJustificacion: number; motivo: string | null } {
  if (decision === 'aprobar' && recomendacion !== RecomendacionRut.CONSISTENTE) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Aprueba aunque el sistema no ve el RUT consistente' };
  }
  if (decision === 'rechazar' && recomendacion === RecomendacionRut.CONSISTENTE) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Rechaza un RUT que el sistema ve consistente' };
  }
  return { apartaDeRecomendacion: false, minimoJustificacion: JUSTIFICACION_MINIMA, motivo: null };
}

// ── Motivos de devolución (lo que lee el estudiante) ────────────────────────

export enum MotivoDevolucionRut {
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  PERSONA_NO_COINCIDE = 'persona_no_coincide',
  RUT_NO_CORRESPONDE = 'rut_no_corresponde',
  DOCUMENTO_NO_COINCIDE = 'documento_no_coincide',
  NOMBRE_NO_COINCIDE = 'nombre_no_coincide',
  NIT_NO_COINCIDE = 'nit_no_coincide',
  DV_NO_COINCIDE = 'dv_no_coincide',
  RAZON_SOCIAL_NO_COINCIDE = 'razon_social_no_coincide',
  ILEGIBLE = 'documento_ilegible',
  INFORMACION_INCOMPLETA = 'informacion_incompleta',
  OTRO = 'otro',
}

/** Qué ocurrió y qué debe hacer, en lenguaje de quien estudia. Sin códigos ni nombres internos. */
export const MENSAJES_DEVOLUCION_RUT: Readonly<Record<MotivoDevolucionRut, { que: string; hacer: string }>> = {
  [MotivoDevolucionRut.DOCUMENTO_INCORRECTO]: {
    que: 'El documento cargado no es el RUT.',
    hacer: 'Descarga tu RUT actualizado desde el portal de la DIAN y cárgalo de nuevo en PDF.',
  },
  [MotivoDevolucionRut.PERSONA_NO_COINCIDE]: {
    que: 'El RUT cargado es de una persona natural o jurídica distinta de la que corresponde a tu práctica.',
    hacer: 'Carga el RUT que corresponde: de persona natural si es el tuyo, o de persona jurídica si es el de la empresa.',
  },
  [MotivoDevolucionRut.RUT_NO_CORRESPONDE]: {
    que: 'El RUT cargado no corresponde al titular o a la empresa de tu práctica.',
    hacer: 'Carga el RUT del titular correcto. Si el dato registrado en tu práctica es el equivocado, comunícate con coordinación.',
  },
  [MotivoDevolucionRut.DOCUMENTO_NO_COINCIDE]: {
    que: 'El número de documento del RUT no coincide con el registrado para ti.',
    hacer: 'Verifica que el RUT sea el tuyo y cárgalo de nuevo. Si tu número registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionRut.NOMBRE_NO_COINCIDE]: {
    que: 'El nombre del RUT no coincide con el registrado para ti.',
    hacer: 'Verifica que el RUT sea el tuyo y cárgalo de nuevo. Si tu nombre registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionRut.NIT_NO_COINCIDE]: {
    que: 'El NIT del RUT no coincide con el de la empresa registrada en tu práctica.',
    hacer: 'Carga el RUT de la empresa de tu práctica. Si el NIT registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionRut.DV_NO_COINCIDE]: {
    que: 'El dígito de verificación del NIT del RUT no coincide con el registrado para la empresa.',
    hacer: 'Carga el RUT de la empresa de tu práctica. Si el dato registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionRut.RAZON_SOCIAL_NO_COINCIDE]: {
    que: 'La razón social del RUT no coincide con la de la empresa registrada en tu práctica.',
    hacer: 'Carga el RUT de la empresa de tu práctica. Si la razón social registrada está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionRut.ILEGIBLE]: {
    que: 'No pudimos leer tu RUT con claridad.',
    hacer: 'Cárgalo de nuevo en el PDF original descargado de la DIAN, completo y sin fotos ni capturas.',
  },
  [MotivoDevolucionRut.INFORMACION_INCOMPLETA]: {
    que: 'Al RUT le falta información necesaria.',
    hacer: 'Descarga el RUT completo (todas las páginas) desde el portal de la DIAN y cárgalo de nuevo.',
  },
  [MotivoDevolucionRut.OTRO]: {
    que: 'Tu RUT necesita una corrección.',
    hacer: 'Lee la indicación del equipo de prácticas y carga una nueva versión.',
  },
};

/** Cómo se rotula cada motivo para quien devuelve, en el orden en que se ofrecen, y a qué persona aplica. */
const TITULOS_MOTIVO_RUT: ReadonlyArray<readonly [MotivoDevolucionRut, string, readonly TipoPersona[]]> = [
  [MotivoDevolucionRut.DOCUMENTO_NO_COINCIDE, 'El número de documento no coincide', [TipoPersona.NATURAL]],
  [MotivoDevolucionRut.NOMBRE_NO_COINCIDE, 'El nombre no coincide', [TipoPersona.NATURAL]],
  [MotivoDevolucionRut.NIT_NO_COINCIDE, 'El NIT no coincide', [TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.DV_NO_COINCIDE, 'El dígito de verificación no coincide', [TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.RAZON_SOCIAL_NO_COINCIDE, 'La razón social no coincide', [TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.PERSONA_NO_COINCIDE, 'Es de persona natural/jurídica distinta a la esperada', [TipoPersona.NATURAL, TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.RUT_NO_CORRESPONDE, 'El RUT no corresponde al titular o a la empresa', [TipoPersona.NATURAL, TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.INFORMACION_INCOMPLETA, 'Falta información en el RUT', [TipoPersona.NATURAL, TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.ILEGIBLE, 'Documento ilegible', [TipoPersona.NATURAL, TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.DOCUMENTO_INCORRECTO, 'No es el RUT', [TipoPersona.NATURAL, TipoPersona.JURIDICA]],
  [MotivoDevolucionRut.OTRO, 'Otro motivo (explicar)', [TipoPersona.NATURAL, TipoPersona.JURIDICA]],
];

/** Un motivo de devolución tal como lo ve quien revisa. Es la ÚNICA fuente: la pantalla no mantiene copia. */
export interface MotivoDevolucionRutCatalogo {
  codigo: MotivoDevolucionRut;
  titulo: string;
  /** Lo que leerá el estudiante (qué ocurrió y qué hacer). Con «otro», el «qué» lo escribe quien devuelve. */
  mensajeEstudiante: { que: string; hacer: string };
  /** Hay que escribir qué corregir (con «otro»). */
  requiereDetalle: boolean;
  /** A qué RUT aplica (natural, jurídica o ambos). */
  aplicaA: readonly TipoPersona[];
}

export function catalogoMotivosDevolucionRut(): MotivoDevolucionRutCatalogo[] {
  return TITULOS_MOTIVO_RUT.map(([codigo, titulo, aplicaA]) => ({
    codigo, titulo, mensajeEstudiante: { ...MENSAJES_DEVOLUCION_RUT[codigo] }, requiereDetalle: codigo === MotivoDevolucionRut.OTRO, aplicaA,
  }));
}

export function esMotivoDevolucionRut(valor: unknown): valor is MotivoDevolucionRut {
  return typeof valor === 'string' && (Object.values(MotivoDevolucionRut) as string[]).includes(valor);
}

/** ¿El motivo aplica a esa persona? Sin persona conocida (documento incorrecto, no determinable) se admite cualquiera. */
export function motivoAplicaA(motivo: MotivoDevolucionRut, persona: TipoPersona | null): boolean {
  if (persona === null) return true;
  return TITULOS_MOTIVO_RUT.some(([c, , aplica]) => c === motivo && aplica.includes(persona));
}

/** Mensaje que queda en el documento (lo que lee el estudiante): qué ocurrió, más la explicación si el motivo es «otro». */
export function mensajeDevolucionRut(motivo: MotivoDevolucionRut, detalle: string | null): string {
  const base = MENSAJES_DEVOLUCION_RUT[motivo].que;
  const extra = detalle?.trim();
  if (motivo === MotivoDevolucionRut.OTRO && extra) return extra;
  return extra ? `${base} ${extra}` : base;
}

// ── Prioridad (simple y explicable; no es una fórmula institucional) ─────────

export const PESOS_PRIORIDAD_RUT = {
  documentoIncorrecto: 40, discrepanciaCritica: 30, personaDistinta: 25, lecturaDudosa: 10, informacionInsuficiente: 5, reenvio: 10,
  porDiaEnBandeja: 2, topeDiasEnBandeja: 10, inicioYaPasado: 25, inicioEnUnaSemana: 20, inicioEnDosSemanas: 10,
} as const;

export interface PrioridadRut { puntaje: number; razones: string[] }

const DIA_MS = 86_400_000;

export function calcularPrioridadRut(
  e: { recomendacion: RecomendacionRut; version: number; recibidaEn: Date | null; fechaInicio: Date | null }, ahora: Date,
): PrioridadRut {
  const P = PESOS_PRIORIDAD_RUT;
  let puntaje = 0;
  const razones: string[] = [];
  const sumar = (puntos: number, razon: string): void => { puntaje += puntos; razones.push(razon); };
  if (e.recomendacion === RecomendacionRut.DOCUMENTO_INCORRECTO) sumar(P.documentoIncorrecto, 'Parece otro documento');
  if (e.recomendacion === RecomendacionRut.DISCREPANCIA_CRITICA) sumar(P.discrepanciaCritica, 'Hay una discrepancia crítica');
  if (e.recomendacion === RecomendacionRut.PERSONA_DISTINTA) sumar(P.personaDistinta, 'Es de otra persona natural/jurídica');
  if (e.recomendacion === RecomendacionRut.LECTURA_DUDOSA) sumar(P.lecturaDudosa, 'Lectura dudosa');
  if (e.recomendacion === RecomendacionRut.INFORMACION_INSUFICIENTE) sumar(P.informacionInsuficiente, 'Hay datos sin poder comparar');
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
 * Estados HUMANOS: lo único que el estudiante ve. Nunca nombres internos de estado, códigos de discrepancia, confianza,
 * hashes, banderas del pipeline (C0–C3) ni detalle técnico del OCR.
 */
export type EstadoRutParaEstudiante = 'pendiente' | 'en_procesamiento' | 'en_revision' | 'necesita_correccion' | 'aprobado' | 'rechazado';

export interface RutParaEstudiante {
  estado: EstadoRutParaEstudiante;
  etiqueta: string;
  /** ¿Qué pasó? */
  que: string;
  /** ¿Qué debo hacer? */
  hacer: string;
  /** Puede cargar una nueva versión. */
  puedeReenviar: boolean;
}

export interface EntradaEstadoRut {
  documento: { estado: EstadoDocumento; motivoDevolucion: string | null } | null;
  validacion: { estado: Estado; motivoDecision: string | null } | null;
}

export function estadoRutParaEstudiante(e: EntradaEstadoRut): RutParaEstudiante {
  if (!e.documento) {
    return { estado: 'pendiente', etiqueta: 'Pendiente de cargar', puedeReenviar: true, que: 'Todavía no has cargado tu RUT.', hacer: 'Descárgalo desde el portal de la DIAN y cárgalo en PDF.' };
  }
  const v = e.validacion?.estado ?? null;
  if (v === Estado.APROBADO_MANUAL) {
    return { estado: 'aprobado', etiqueta: 'Aprobado', puedeReenviar: false, que: 'Tu RUT fue aprobado.', hacer: 'No necesitas hacer nada más con este documento.' };
  }
  if (v === Estado.DEVUELTO) {
    const motivo = e.validacion?.motivoDecision;
    const catalogo = esMotivoDevolucionRut(motivo) ? MENSAJES_DEVOLUCION_RUT[motivo] : MENSAJES_DEVOLUCION_RUT[MotivoDevolucionRut.OTRO];
    return {
      estado: 'necesita_correccion', etiqueta: 'Necesita corrección', puedeReenviar: true,
      // Con motivo «otro» (o sin catálogo) el mensaje es el que escribió quien revisó.
      que: !esMotivoDevolucionRut(motivo) || motivo === MotivoDevolucionRut.OTRO ? (e.documento.motivoDevolucion ?? catalogo.que) : catalogo.que,
      hacer: catalogo.hacer,
    };
  }
  if (v === Estado.RECHAZADO) {
    return { estado: 'rechazado', etiqueta: 'Rechazado', puedeReenviar: true, que: 'Tu RUT fue rechazado por el equipo de prácticas.', hacer: 'Comunícate con coordinación para definir cómo continuar.' };
  }
  if (e.documento.estado === EstadoDocumento.ILEGIBLE) {
    return { estado: 'necesita_correccion', etiqueta: 'Necesita corrección', puedeReenviar: true, que: 'No pudimos leer tu RUT con claridad.', hacer: 'Cárgalo de nuevo en el PDF original descargado de la DIAN, completo y sin fotos ni capturas.' };
  }
  if (v === Estado.PROCESANDO) {
    return { estado: 'en_procesamiento', etiqueta: 'En procesamiento', puedeReenviar: false, que: 'Estamos leyendo tu RUT.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.' };
  }
  // Procesado (en revisión) o con un tropiezo técnico: una persona lo mira. El estudiante no ve el detalle técnico.
  if (v === Estado.REVISION || v === Estado.ERROR) {
    return { estado: 'en_revision', etiqueta: 'En revisión', puedeReenviar: false, que: 'Tu RUT está en revisión por el equipo de prácticas.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.' };
  }
  return { estado: 'pendiente', etiqueta: 'Pendiente', puedeReenviar: false, que: 'Recibimos tu RUT y está en cola para revisarse.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.' };
}
