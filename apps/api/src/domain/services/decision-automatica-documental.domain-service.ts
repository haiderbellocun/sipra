import { TIPOS_CON_DECISION_ESPECIALIZADA, TipoDocumento } from '../entities/documento.entity';

/**
 * Motor de DECISIÓN DOCUMENTAL AUTOMÁTICA (subfase 1.6A, dominio puro). Ver DOCUMENTO-TECNICO §7.36.
 *
 * Tres resultados, nunca un cuarto:
 *  · `auto_aprobar`: TODO lo crítico se cumple con fuentes de autoridad suficiente;
 *  · `auto_devolver`: un hecho OBJETIVO y confiable (documento de otro tipo, vencido, afiliación inactiva, otra persona,
 *    NIT inválido) — el estudiante puede cargar una nueva versión; NO es un rechazo;
 *  · `revision`: todo lo demás. Una persona decide.
 *
 * No hay rechazo automático: `RECHAZADO` es siempre una decisión humana.
 *
 * La IA solo LEE. Un valor `ia_rescate` puede completar datos, pero:
 *  · nunca sostiene por sí solo un `auto_devolver` (guarda común en `consolidarDecision`);
 *  · su confianza declarada no es autoridad: para aprobar, un dato crítico leído por IA debe estar corroborado por una
 *    fuente oficial (la decide cada política).
 *
 * Los `motivos` son CÓDIGOS (nunca valores ni datos personales). El mensaje al estudiante es genérico.
 */

export type ResultadoDecisionAutomatica = 'auto_aprobar' | 'auto_devolver' | 'revision';

/** Política (motor) que produjo la decisión. `acta` queda reservado: la arquitectura lo admite, 1.6A no lo implementa. */
export type PoliticaDecision = 'eps' | 'rut' | 'camara' | 'arl' | 'acta';

export type TipoDevolucion = 'documento_incorrecto' | 'incumplimiento';

export type MotivoDecision =
  // Aprobación
  | 'consistente' | 'ruta_qr_oficial' | 'ruta_adres' | 'identidad_coincide' | 'certificado_vigente' | 'afiliacion_activa'
  | 'nit_dv_valido' | 'sin_verificacion_rues' | 'sin_verificacion_oficial' | 'arl_reconocida' | 'fecha_afiliacion_compatible'
  | 'empresa_coincide'
  // Devolución
  | 'tipo_documento_incorrecto' | 'variante_persona_incompatible' | 'certificado_vencido' | 'afiliacion_inactiva'
  | 'documento_otra_persona' | 'nit_invalido'
  // Revisión
  | 'clasificacion_no_determinable' | 'datos_insuficientes' | 'identidad_no_corroborada' | 'discrepancia_critica'
  | 'discrepancia_nombre' | 'afiliacion_no_confirmada' | 'fuente_ia_no_corroborada' | 'lectura_dudosa'
  | 'lectura_ocr_no_concluyente' | 'bandera_critica' | 'autenticidad_invalida' | 'matricula_cancelada'
  | 'representante_diferente' | 'vigencia_no_determinada' | 'empresa_no_corroborada' | 'fecha_afiliacion_incompatible'
  | 'arl_no_reconocida' | 'procesamiento_incompleto'
  // Interruptores (la propuesta existía, pero no está habilitada)
  | 'autoaprobacion_deshabilitada' | 'autodevolucion_deshabilitada'
  // Subtipos de documento incorrecto detectados localmente (no son tipos del sistema)
  | `subtipo_${string}`;

/**
 * De dónde salió un dato crítico. `oficial`: verificador oficial o ADRES. `local`: lectura local cuyo método no distingue
 * texto/OCR (documentos empresariales). `lectura_base`: extractor configurado sin fuente declarada.
 */
export type FuenteDato = 'oficial' | 'qr' | 'texto_nativo' | 'ocr' | 'local' | 'lectura_base' | 'ia_rescate' | 'sin_valor';

/** Fuentes que sostienen una DEVOLUCIÓN automática: lectura determinística inequívoca u oficial. Ni OCR ni IA. */
const FUENTES_PARA_DEVOLVER: ReadonlySet<FuenteDato> = new Set(['oficial', 'qr', 'texto_nativo']);
/** Fuentes que sostienen una APROBACIÓN (además de las anteriores, OCR local confiable). Nunca IA sin corroborar. */
const FUENTES_PARA_APROBAR: ReadonlySet<FuenteDato> = new Set(['oficial', 'qr', 'texto_nativo', 'ocr', 'local']);

export const fuenteSostieneDevolucion = (f: FuenteDato | undefined): boolean => f !== undefined && FUENTES_PARA_DEVOLVER.has(f);
export const fuenteSostieneAprobacion = (f: FuenteDato | undefined): boolean => f !== undefined && FUENTES_PARA_APROBAR.has(f);

interface BaseDecision {
  politica: PoliticaDecision;
  motivos: MotivoDecision[];
  /** ¿Hubo verificación por una fuente OFICIAL (QR oficial verificado, ADRES, verificador)? Nunca se finge. */
  verificacionOficial: boolean;
  /** Procedencia de los datos críticos usados (solo nombres y fuentes, sin valores). */
  fuentesCriticas: Record<string, FuenteDato>;
}

export type DecisionAutomaticaDocumento =
  | (BaseDecision & { resultado: 'auto_aprobar' })
  | (BaseDecision & { resultado: 'auto_devolver'; tipoDevolucion: TipoDevolucion; mensajeUsuario: string })
  | (BaseDecision & { resultado: 'revision' });

// ── Mensajes al estudiante (genéricos: sin puntajes, banderas, razonamiento de IA ni valores) ─────────────────

const NOMBRE_ESPERADO: Readonly<Partial<Record<TipoDocumento, string>>> = {
  [TipoDocumento.CERTIFICADO_EPS]: 'certificado de afiliación a EPS',
  [TipoDocumento.RUT_NATURAL]: 'RUT de persona natural',
  [TipoDocumento.RUT_JURIDICO]: 'RUT de persona jurídica',
  [TipoDocumento.CAMARA_COMERCIO]: 'certificado de Cámara de Comercio',
  [TipoDocumento.CERTIFICADO_ARL]: 'certificado de afiliación a la ARL',
  [TipoDocumento.ACTA_INICIO]: 'acta de inicio',
};

export function nombreDocumentoEsperado(tipo: TipoDocumento): string {
  return NOMBRE_ESPERADO[tipo] ?? 'documento solicitado';
}

export const MENSAJE_AUTO_APROBADO = 'Documento validado automáticamente.';
export const MENSAJE_EN_REVISION = 'Necesitamos que una persona revise este documento.';

export function mensajeDevolucion(tipo: TipoDocumento, motivo: MotivoDecision): string {
  const nombre = nombreDocumentoEsperado(tipo);
  switch (motivo) {
    case 'tipo_documento_incorrecto':
    case 'variante_persona_incompatible':
      return `Este archivo no corresponde al ${nombre}. Cargue el ${nombre} correcto.`;
    case 'certificado_vencido':
      return 'El certificado está fuera de la vigencia permitida. Cargue uno actualizado.';
    case 'afiliacion_inactiva':
      return 'La afiliación no figura activa. Verifique su afiliación y cargue un certificado vigente.';
    case 'documento_otra_persona':
      return `El ${nombre} cargado no corresponde a sus datos. Cargue el documento a su nombre.`;
    case 'nit_invalido':
      return `El ${nombre} tiene un número de identificación tributaria inválido. Descárguelo de nuevo de la fuente oficial y cárguelo.`;
    default:
      return `Este archivo no corresponde al ${nombre}. Cargue el ${nombre} correcto.`;
  }
}

// ── Constructores ───────────────────────────────────────────────────────────

export function revision(politica: PoliticaDecision, motivos: MotivoDecision[], extra: Partial<BaseDecision> = {}): DecisionAutomaticaDocumento {
  return { resultado: 'revision', politica, motivos, verificacionOficial: false, fuentesCriticas: {}, ...extra };
}

export function aprobar(politica: PoliticaDecision, motivos: MotivoDecision[], extra: Partial<BaseDecision> = {}): DecisionAutomaticaDocumento {
  return { resultado: 'auto_aprobar', politica, motivos, verificacionOficial: false, fuentesCriticas: {}, ...extra };
}

export function devolver(
  politica: PoliticaDecision, tipo: TipoDocumento, tipoDevolucion: TipoDevolucion, motivos: MotivoDecision[],
  extra: Partial<BaseDecision> = {},
): DecisionAutomaticaDocumento {
  return {
    resultado: 'auto_devolver', politica, tipoDevolucion, motivos, mensajeUsuario: mensajeDevolucion(tipo, motivos[0]),
    verificacionOficial: false, fuentesCriticas: {}, ...extra,
  };
}

// ── Interruptores ───────────────────────────────────────────────────────────

/** Interruptores del motor. Todos apagados de fábrica; solo `dev` en esta fase (lo impone también la configuración). */
export interface InterruptoresDecisionAutomatica {
  habilitado: boolean;
  aprobacionEps: boolean;
  aprobacionRut: boolean;
  aprobacionCamara: boolean;
  aprobacionArl: boolean;
  devolucionDocumentoIncorrecto: boolean;
  devolucionIncumplimiento: boolean;
}

export const INTERRUPTORES_DECISION_POR_DEFECTO: Readonly<InterruptoresDecisionAutomatica> = Object.freeze({
  habilitado: false, aprobacionEps: false, aprobacionRut: false, aprobacionCamara: false, aprobacionArl: false,
  devolucionDocumentoIncorrecto: false, devolucionIncumplimiento: false,
});

/** Tipos con motor de decisión propio: la MISMA lista que impide al pipeline genérico autoaprobarlos (una sola fuente). */
export const TIPOS_CON_MOTOR_DE_DECISION: readonly TipoDocumento[] = TIPOS_CON_DECISION_ESPECIALIZADA;

const AMBIENTE_PERMITIDO = 'dev';

/** ¿El motor puede actuar? General encendido (`true` estricto) y ambiente `dev` EXACTO. Fallo cerrado. */
export function motorDecisionAutorizado(i: Readonly<Partial<InterruptoresDecisionAutomatica>>, ambiente: string | null | undefined): boolean {
  return i.habilitado === true && ambiente === AMBIENTE_PERMITIDO;
}

const CLAVE_APROBACION: Readonly<Partial<Record<TipoDocumento, keyof InterruptoresDecisionAutomatica>>> = {
  [TipoDocumento.CERTIFICADO_EPS]: 'aprobacionEps',
  [TipoDocumento.RUT_NATURAL]: 'aprobacionRut',
  [TipoDocumento.RUT_JURIDICO]: 'aprobacionRut',
  [TipoDocumento.CAMARA_COMERCIO]: 'aprobacionCamara',
  [TipoDocumento.CERTIFICADO_ARL]: 'aprobacionArl',
};

/**
 * Aplica las guardas comunes a la PROPUESTA de una política y devuelve la decisión que se ejecuta:
 *  1. una devolución que se apoya en un dato crítico leído por IA (o por una lectura sin fuente) → revisión;
 *  2. sin el interruptor correspondiente → revisión (se conserva el motivo con `*_deshabilitada`).
 * Nunca convierte una revisión en otra cosa.
 */
export function consolidarDecision(
  tipo: TipoDocumento,
  propuesta: DecisionAutomaticaDocumento,
  interruptores: Readonly<Partial<InterruptoresDecisionAutomatica>>,
): DecisionAutomaticaDocumento {
  const comun = { verificacionOficial: propuesta.verificacionOficial, fuentesCriticas: propuesta.fuentesCriticas };
  if (propuesta.resultado === 'auto_devolver') {
    const fuentes = Object.values(propuesta.fuentesCriticas);
    if (fuentes.some((f) => f === 'ia_rescate' || f === 'lectura_base')) {
      return revision(propuesta.politica, [...propuesta.motivos, 'fuente_ia_no_corroborada'], comun);
    }
    const clave = propuesta.tipoDevolucion === 'documento_incorrecto' ? 'devolucionDocumentoIncorrecto' : 'devolucionIncumplimiento';
    if (interruptores[clave] !== true) return revision(propuesta.politica, [...propuesta.motivos, 'autodevolucion_deshabilitada'], comun);
    return propuesta;
  }
  if (propuesta.resultado === 'auto_aprobar') {
    const clave = CLAVE_APROBACION[tipo];
    if (!clave || interruptores[clave] !== true) {
      return revision(propuesta.politica, [...propuesta.motivos, 'autoaprobacion_deshabilitada'], comun);
    }
    return propuesta;
  }
  return propuesta;
}
