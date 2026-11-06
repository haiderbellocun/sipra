import { ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona } from '../entities/documento-empresarial';
import { EstadoDocumento } from '../entities/documento.entity';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from './justificacion-decision';

/**
 * Reglas de la revisión humana del certificado de Cámara de Comercio (dominio puro): recomendación, justificación, motivos de
 * devolución, prioridad y cómo se le cuenta al estudiante. Independiente de las Mesas de EPS, Actas y RUT.
 *
 * El sistema RECOMIENDA y compara; la persona decide. Nunca se bloquea una decisión humana válida solo por la recomendación.
 */

/** Cuánto dura la reserva de un caso. Si la persona la abandona, vence sola. (Misma política que las demás mesas.) */
export const DURACION_RESERVA_CAMARA_MS = 15 * 60_000;

// ── Recomendación del sistema (una recomendación, no una decisión) ──────────

export enum RecomendacionCamara {
  /** Lectura confiable y todo lo crítico coincide con SIPRA. */
  CONSISTENTE = 'consistente',
  /** Algo crítico (NIT, DV, razón social o nombre) no coincide con SIPRA, con lectura confiable. */
  DISCREPANCIA_CRITICA = 'discrepancia_critica',
  /** El representante legal de SIPRA y el del certificado son distintos (importante, no crítico). */
  REPRESENTANTE_DIFERENTE = 'representante_diferente',
  /** El certificado declara explícitamente que la matrícula está cancelada. */
  MATRICULA_CANCELADA = 'matricula_cancelada',
  /** Lo leído no es un certificado de Cámara (otro documento). */
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  /** Es un documento válido de otra familia (p. ej. un RUT cargado como Cámara). */
  TIPO_CERTIFICADO_DIFERENTE = 'tipo_certificado_diferente',
  /** No se pudo determinar qué es o qué dice. */
  NO_DETERMINABLE = 'no_determinable',
  /** Es un certificado de la otra persona (natural o jurídica) de la que SIPRA espera. */
  PERSONA_DISTINTA = 'persona_distinta',
  /** Leído con poca certeza (típicamente OCR): hay que revisarlo contra el documento. */
  LECTURA_DUDOSA = 'lectura_dudosa',
  /** Hay datos críticos que no se pudieron comparar. */
  INFORMACION_INSUFICIENTE = 'informacion_insuficiente',
}

export interface EntradaRecomendacionCamara {
  tipoDetectado: C | null;
  expectativa: string | null;
  lecturaDudosa: boolean;
  comparacion: { veredicto?: string; hayDiscrepancia: boolean; discrepanciaImportante?: boolean; senales?: string[] } | null;
}

const esCamara = (t: C | null): boolean => t === C.CAMARA_MATRICULA_PERSONA_NATURAL || t === C.CAMARA_MATRICULA_SOCIEDAD || t === C.CAMARA_EXISTENCIA_REPRESENTACION;

export function recomendacionCamara(v: EntradaRecomendacionCamara): RecomendacionCamara {
  if (v.tipoDetectado === C.DOCUMENTO_INCORRECTO) return RecomendacionCamara.DOCUMENTO_INCORRECTO;
  if (v.tipoDetectado === C.RUT_PERSONA_NATURAL || v.tipoDetectado === C.RUT_PERSONA_JURIDICA) return RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE;
  if (!esCamara(v.tipoDetectado)) return RecomendacionCamara.NO_DETERMINABLE;
  if (v.expectativa === 'persona_distinta') return RecomendacionCamara.PERSONA_DISTINTA;
  if (v.comparacion?.senales?.includes('estado_registral_cancelado')) return RecomendacionCamara.MATRICULA_CANCELADA;
  if (v.comparacion?.hayDiscrepancia) return RecomendacionCamara.DISCREPANCIA_CRITICA;
  if (v.lecturaDudosa) return RecomendacionCamara.LECTURA_DUDOSA;
  if (v.comparacion?.discrepanciaImportante) return RecomendacionCamara.REPRESENTANTE_DIFERENTE;
  return v.comparacion?.veredicto === 'consistente' ? RecomendacionCamara.CONSISTENTE : RecomendacionCamara.INFORMACION_INSUFICIENTE;
}

/** Cómo se rotula lo que el sistema ve, para quien revisa (sin códigos internos). */
export interface ResumenHumanoCamara {
  etiqueta: string;
  /** `ok` solo con lo consistente; `atencion` pide mirar el documento; `alerta` es algo que no debe pasar inadvertido. */
  nivel: 'ok' | 'atencion' | 'alerta';
  /** El problema principal, en una frase (nunca un código). */
  problemaPrincipal: string | null;
}

const RESUMEN_HUMANO: Readonly<Record<RecomendacionCamara, ResumenHumanoCamara>> = {
  [RecomendacionCamara.CONSISTENTE]: { etiqueta: 'Consistente', nivel: 'ok', problemaPrincipal: null },
  [RecomendacionCamara.DISCREPANCIA_CRITICA]: { etiqueta: 'Revisión necesaria', nivel: 'alerta', problemaPrincipal: 'Un dato clave del certificado no coincide con SIPRA' },
  [RecomendacionCamara.REPRESENTANTE_DIFERENTE]: { etiqueta: 'Revisión necesaria', nivel: 'atencion', problemaPrincipal: 'El representante legal no coincide con el registrado en SIPRA' },
  [RecomendacionCamara.MATRICULA_CANCELADA]: { etiqueta: 'Revisión necesaria', nivel: 'alerta', problemaPrincipal: 'El certificado declara que la matrícula está cancelada' },
  [RecomendacionCamara.DOCUMENTO_INCORRECTO]: { etiqueta: 'Documento no corresponde', nivel: 'alerta', problemaPrincipal: 'El archivo parece no ser un certificado de la Cámara de Comercio' },
  [RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE]: { etiqueta: 'Tipo de certificado diferente', nivel: 'alerta', problemaPrincipal: 'El documento es de otro tipo (no es un certificado de Cámara)' },
  [RecomendacionCamara.NO_DETERMINABLE]: { etiqueta: 'No determinable', nivel: 'atencion', problemaPrincipal: 'No se pudo determinar qué documento es o qué dice' },
  [RecomendacionCamara.PERSONA_DISTINTA]: { etiqueta: 'Persona distinta', nivel: 'alerta', problemaPrincipal: 'El certificado es de una persona natural o jurídica distinta de la esperada' },
  [RecomendacionCamara.LECTURA_DUDOSA]: { etiqueta: 'Revisión necesaria', nivel: 'atencion', problemaPrincipal: 'La lectura es poco segura: revise contra el documento' },
  [RecomendacionCamara.INFORMACION_INSUFICIENTE]: { etiqueta: 'Información insuficiente', nivel: 'atencion', problemaPrincipal: 'Faltan datos para comparar con SIPRA' },
};

export function resumenHumanoCamara(r: RecomendacionCamara): ResumenHumanoCamara {
  return { ...RESUMEN_HUMANO[r] };
}

export type DecisionRevisionCamara = 'aprobar' | 'devolver' | 'rechazar';

/**
 * Apartarse de la recomendación exige la justificación REFORZADA (40 caracteres):
 *  · aprobar cuando el sistema NO ve el certificado consistente (discrepancia crítica, representante diferente, lectura dudosa,
 *    información insuficiente, matrícula cancelada, persona o tipo distinto, documento incorrecto o no determinable);
 *  · rechazar un certificado que el sistema ve consistente (justificación ampliada).
 * Aprobar uno consistente no exige justificación larga. Cualquier otro rechazo exige la mínima.
 */
export function evaluarApartamientoCamara(
  decision: DecisionRevisionCamara, recomendacion: RecomendacionCamara,
): { apartaDeRecomendacion: boolean; minimoJustificacion: number; motivo: string | null } {
  if (decision === 'aprobar' && recomendacion !== RecomendacionCamara.CONSISTENTE) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Aprueba aunque el sistema no ve el certificado consistente' };
  }
  if (decision === 'rechazar' && recomendacion === RecomendacionCamara.CONSISTENTE) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Rechaza un certificado que el sistema ve consistente' };
  }
  return { apartaDeRecomendacion: false, minimoJustificacion: JUSTIFICACION_MINIMA, motivo: null };
}

// ── Motivos de devolución (lo que lee el estudiante) ────────────────────────

export enum MotivoDevolucionCamara {
  DOCUMENTO_INCORRECTO = 'documento_incorrecto',
  TIPO_CERTIFICADO_INCORRECTO = 'tipo_certificado_incorrecto',
  PERSONA_NO_COINCIDE = 'persona_no_coincide',
  NIT_NO_COINCIDE = 'nit_no_coincide',
  DV_NO_COINCIDE = 'dv_no_coincide',
  RAZON_SOCIAL_NO_COINCIDE = 'razon_social_no_coincide',
  NOMBRE_NO_COINCIDE = 'nombre_no_coincide',
  REPRESENTANTE_NO_COINCIDE = 'representante_no_coincide',
  MATRICULA_CANCELADA = 'matricula_cancelada',
  ILEGIBLE = 'documento_ilegible',
  INFORMACION_INCOMPLETA = 'informacion_incompleta',
  OTRO = 'otro',
}

/** Qué ocurrió y qué debe hacer, en lenguaje de quien estudia. Sin códigos ni nombres internos. */
export const MENSAJES_DEVOLUCION_CAMARA: Readonly<Record<MotivoDevolucionCamara, { que: string; hacer: string }>> = {
  [MotivoDevolucionCamara.DOCUMENTO_INCORRECTO]: {
    que: 'El documento cargado no es un certificado de la Cámara de Comercio.',
    hacer: 'Descarga el certificado desde la Cámara de Comercio de tu ciudad (matrícula mercantil o existencia y representación legal) y cárgalo en PDF.',
  },
  [MotivoDevolucionCamara.TIPO_CERTIFICADO_INCORRECTO]: {
    que: 'El certificado cargado no es del tipo que se necesita para tu práctica.',
    hacer: 'Descarga el certificado correcto (matrícula mercantil o existencia y representación legal, según corresponda) y cárgalo de nuevo en PDF.',
  },
  [MotivoDevolucionCamara.PERSONA_NO_COINCIDE]: {
    que: 'El certificado es de una persona natural o jurídica distinta de la que corresponde a tu práctica.',
    hacer: 'Carga el certificado que corresponde: de persona natural si el escenario es un comerciante, o de persona jurídica si es una empresa.',
  },
  [MotivoDevolucionCamara.NIT_NO_COINCIDE]: {
    que: 'El NIT o la identificación del certificado no coincide con el registrado para el escenario de tu práctica.',
    hacer: 'Carga el certificado del escenario de tu práctica. Si el dato registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionCamara.DV_NO_COINCIDE]: {
    que: 'El dígito de verificación del certificado no coincide con el registrado.',
    hacer: 'Carga el certificado del escenario de tu práctica. Si el dato registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionCamara.RAZON_SOCIAL_NO_COINCIDE]: {
    que: 'La razón social del certificado no coincide con la de la empresa registrada en tu práctica.',
    hacer: 'Carga el certificado de la empresa de tu práctica. Si la razón social registrada está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionCamara.NOMBRE_NO_COINCIDE]: {
    que: 'El nombre del comerciante en el certificado no coincide con el registrado para el escenario de tu práctica.',
    hacer: 'Carga el certificado del comerciante correcto. Si el nombre registrado está mal, comunícate con coordinación.',
  },
  [MotivoDevolucionCamara.REPRESENTANTE_NO_COINCIDE]: {
    que: 'El representante legal del certificado no coincide con el registrado para la empresa de tu práctica.',
    hacer: 'Verifica que el certificado sea reciente y de la empresa correcta. Si el representante registrado está desactualizado, comunícate con coordinación.',
  },
  [MotivoDevolucionCamara.MATRICULA_CANCELADA]: {
    que: 'El certificado indica que la matrícula mercantil está cancelada.',
    hacer: 'Comunícate con coordinación: se necesita el certificado de un escenario con matrícula activa.',
  },
  [MotivoDevolucionCamara.ILEGIBLE]: {
    que: 'No pudimos leer tu certificado con claridad.',
    hacer: 'Cárgalo de nuevo en el PDF original descargado de la Cámara de Comercio, completo y sin fotos ni capturas.',
  },
  [MotivoDevolucionCamara.INFORMACION_INCOMPLETA]: {
    que: 'Al certificado le falta información necesaria.',
    hacer: 'Descarga el certificado completo (todas las páginas) desde la Cámara de Comercio y cárgalo de nuevo.',
  },
  [MotivoDevolucionCamara.OTRO]: {
    que: 'Tu certificado de Cámara de Comercio necesita una corrección.',
    hacer: 'Lee la indicación del equipo de prácticas y carga una nueva versión.',
  },
};

const AMBAS: readonly TipoPersona[] = [TipoPersona.NATURAL, TipoPersona.JURIDICA];

/** Cómo se rotula cada motivo para quien devuelve, en el orden en que se ofrecen, y a qué persona aplica. */
const TITULOS_MOTIVO_CAMARA: ReadonlyArray<readonly [MotivoDevolucionCamara, string, readonly TipoPersona[]]> = [
  [MotivoDevolucionCamara.NIT_NO_COINCIDE, 'El NIT o la identificación no coincide', AMBAS],
  [MotivoDevolucionCamara.DV_NO_COINCIDE, 'El dígito de verificación no coincide', AMBAS],
  [MotivoDevolucionCamara.RAZON_SOCIAL_NO_COINCIDE, 'La razón social no coincide', [TipoPersona.JURIDICA]],
  [MotivoDevolucionCamara.NOMBRE_NO_COINCIDE, 'El nombre del comerciante no coincide', [TipoPersona.NATURAL]],
  [MotivoDevolucionCamara.REPRESENTANTE_NO_COINCIDE, 'El representante legal no coincide', [TipoPersona.JURIDICA]],
  [MotivoDevolucionCamara.PERSONA_NO_COINCIDE, 'Es de persona natural/jurídica distinta a la esperada', AMBAS],
  [MotivoDevolucionCamara.TIPO_CERTIFICADO_INCORRECTO, 'Tipo de certificado incorrecto', AMBAS],
  [MotivoDevolucionCamara.MATRICULA_CANCELADA, 'La matrícula figura como cancelada', AMBAS],
  [MotivoDevolucionCamara.INFORMACION_INCOMPLETA, 'Falta información en el certificado', AMBAS],
  [MotivoDevolucionCamara.ILEGIBLE, 'Documento ilegible', AMBAS],
  [MotivoDevolucionCamara.DOCUMENTO_INCORRECTO, 'No es un certificado de Cámara de Comercio', AMBAS],
  [MotivoDevolucionCamara.OTRO, 'Otro motivo (explicar)', AMBAS],
];

/** Un motivo de devolución tal como lo ve quien revisa. Es la ÚNICA fuente: la pantalla no mantiene copia. */
export interface MotivoDevolucionCamaraCatalogo {
  codigo: MotivoDevolucionCamara;
  titulo: string;
  /** Lo que leerá el estudiante (qué ocurrió y qué hacer). Con «otro», el «qué» lo escribe quien devuelve. */
  mensajeEstudiante: { que: string; hacer: string };
  /** Hay que escribir qué corregir (con «otro»). */
  requiereDetalle: boolean;
  /** A qué certificado aplica (natural, jurídica o ambos). */
  aplicaA: readonly TipoPersona[];
}

export function catalogoMotivosDevolucionCamara(): MotivoDevolucionCamaraCatalogo[] {
  return TITULOS_MOTIVO_CAMARA.map(([codigo, titulo, aplicaA]) => ({
    codigo, titulo, mensajeEstudiante: { ...MENSAJES_DEVOLUCION_CAMARA[codigo] }, requiereDetalle: codigo === MotivoDevolucionCamara.OTRO, aplicaA,
  }));
}

export function esMotivoDevolucionCamara(valor: unknown): valor is MotivoDevolucionCamara {
  return typeof valor === 'string' && (Object.values(MotivoDevolucionCamara) as string[]).includes(valor);
}

/** ¿El motivo aplica a esa persona? Sin persona conocida (documento incorrecto, no determinable) se admite cualquiera. */
export function motivoCamaraAplicaA(motivo: MotivoDevolucionCamara, persona: TipoPersona | null): boolean {
  if (persona === null) return true;
  return TITULOS_MOTIVO_CAMARA.some(([c, , aplica]) => c === motivo && aplica.includes(persona));
}

/** Mensaje que queda en el documento (lo que lee el estudiante): qué ocurrió, más la explicación si el motivo es «otro». */
export function mensajeDevolucionCamara(motivo: MotivoDevolucionCamara, detalle: string | null): string {
  const base = MENSAJES_DEVOLUCION_CAMARA[motivo].que;
  const extra = detalle?.trim();
  if (motivo === MotivoDevolucionCamara.OTRO && extra) return extra;
  return extra ? `${base} ${extra}` : base;
}

// ── Prioridad (simple y explicable; no es una fórmula institucional) ─────────

export const PESOS_PRIORIDAD_CAMARA = {
  documentoIncorrecto: 40, tipoDiferente: 35, discrepanciaCritica: 30, matriculaCancelada: 30, personaDistinta: 25, representanteDiferente: 15,
  lecturaDudosa: 10, informacionInsuficiente: 5, reenvio: 10, porDiaEnBandeja: 2, topeDiasEnBandeja: 10, inicioYaPasado: 25,
  inicioEnUnaSemana: 20, inicioEnDosSemanas: 10,
} as const;

export interface PrioridadCamara { puntaje: number; razones: string[] }

const DIA_MS = 86_400_000;

export function calcularPrioridadCamara(
  e: { recomendacion: RecomendacionCamara; version: number; recibidaEn: Date | null; fechaInicio: Date | null }, ahora: Date,
): PrioridadCamara {
  const P = PESOS_PRIORIDAD_CAMARA;
  let puntaje = 0;
  const razones: string[] = [];
  const sumar = (puntos: number, razon: string): void => { puntaje += puntos; razones.push(razon); };
  const R = RecomendacionCamara;
  if (e.recomendacion === R.DOCUMENTO_INCORRECTO) sumar(P.documentoIncorrecto, 'Parece otro documento');
  if (e.recomendacion === R.TIPO_CERTIFICADO_DIFERENTE) sumar(P.tipoDiferente, 'Es un documento de otro tipo');
  if (e.recomendacion === R.DISCREPANCIA_CRITICA) sumar(P.discrepanciaCritica, 'Hay una discrepancia crítica');
  if (e.recomendacion === R.MATRICULA_CANCELADA) sumar(P.matriculaCancelada, 'La matrícula figura como cancelada');
  if (e.recomendacion === R.PERSONA_DISTINTA) sumar(P.personaDistinta, 'Es de otra persona natural/jurídica');
  if (e.recomendacion === R.REPRESENTANTE_DIFERENTE) sumar(P.representanteDiferente, 'El representante legal es distinto');
  if (e.recomendacion === R.LECTURA_DUDOSA) sumar(P.lecturaDudosa, 'Lectura dudosa');
  if (e.recomendacion === R.INFORMACION_INSUFICIENTE) sumar(P.informacionInsuficiente, 'Hay datos sin poder comparar');
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
 * Estados HUMANOS: lo único que el estudiante ve. Nunca nombres internos de estado, códigos de discrepancia, confianza, hashes,
 * banderas del pipeline (C0–C3), texto del OCR ni detalle técnico.
 */
export type EstadoCamaraParaEstudiante = 'pendiente' | 'en_procesamiento' | 'en_revision' | 'necesita_correccion' | 'aprobado' | 'rechazado';

export interface CamaraParaEstudiante {
  estado: EstadoCamaraParaEstudiante;
  etiqueta: string;
  /** ¿Qué pasó? */
  que: string;
  /** ¿Qué debo hacer? */
  hacer: string;
  /** Puede cargar una nueva versión. */
  puedeReenviar: boolean;
}

export interface EntradaEstadoCamara {
  documento: { estado: EstadoDocumento; motivoDevolucion: string | null } | null;
  validacion: { estado: Estado; motivoDecision: string | null } | null;
}

export function estadoCamaraParaEstudiante(e: EntradaEstadoCamara): CamaraParaEstudiante {
  if (!e.documento) {
    return { estado: 'pendiente', etiqueta: 'Pendiente de cargar', puedeReenviar: true, que: 'Todavía no has cargado tu certificado de Cámara de Comercio.', hacer: 'Descárgalo desde la Cámara de Comercio y cárgalo en PDF.' };
  }
  const v = e.validacion?.estado ?? null;
  if (v === Estado.APROBADO_MANUAL) {
    return { estado: 'aprobado', etiqueta: 'Aprobado', puedeReenviar: false, que: 'Tu certificado de Cámara de Comercio fue aprobado.', hacer: 'No necesitas hacer nada más con este documento.' };
  }
  if (v === Estado.DEVUELTO) {
    const motivo = e.validacion?.motivoDecision;
    const catalogo = esMotivoDevolucionCamara(motivo) ? MENSAJES_DEVOLUCION_CAMARA[motivo] : MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.OTRO];
    return {
      estado: 'necesita_correccion', etiqueta: 'Necesita corrección', puedeReenviar: true,
      // Con motivo «otro» (o sin catálogo) el mensaje es el que escribió quien revisó.
      que: !esMotivoDevolucionCamara(motivo) || motivo === MotivoDevolucionCamara.OTRO ? (e.documento.motivoDevolucion ?? catalogo.que) : catalogo.que,
      hacer: catalogo.hacer,
    };
  }
  if (v === Estado.RECHAZADO) {
    return { estado: 'rechazado', etiqueta: 'Rechazado', puedeReenviar: true, que: 'Tu certificado de Cámara de Comercio fue rechazado por el equipo de prácticas.', hacer: 'Comunícate con coordinación para definir cómo continuar.' };
  }
  if (e.documento.estado === EstadoDocumento.ILEGIBLE) {
    return { estado: 'necesita_correccion', etiqueta: 'Necesita corrección', puedeReenviar: true, que: 'No pudimos leer tu certificado con claridad.', hacer: 'Cárgalo de nuevo en el PDF original descargado de la Cámara de Comercio, completo y sin fotos ni capturas.' };
  }
  if (v === Estado.PROCESANDO) {
    return { estado: 'en_procesamiento', etiqueta: 'En procesamiento', puedeReenviar: false, que: 'Estamos leyendo tu certificado.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.' };
  }
  // Procesado (en revisión) o con un tropiezo técnico: una persona lo mira. El estudiante no ve el detalle técnico.
  if (v === Estado.REVISION || v === Estado.ERROR) {
    return { estado: 'en_revision', etiqueta: 'En revisión', puedeReenviar: false, que: 'Tu certificado de Cámara de Comercio está en revisión por el equipo de prácticas.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.' };
  }
  return { estado: 'pendiente', etiqueta: 'Pendiente', puedeReenviar: false, que: 'Recibimos tu certificado y está en cola para revisarse.', hacer: 'No necesitas hacer nada: te avisamos cuando haya novedades.' };
}
