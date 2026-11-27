import { TipoDocumento } from '../entities/documento.entity';
import { ModoProcesamiento, modoProcesamientoDe } from './politica-procesamiento';
import { SuficienciaLectura } from './suficiencia-lectura';

/**
 * Política de IA de rescate (subfase 1.1, dominio puro).
 *
 * Decide si se PUEDE intentar una lectura de rescate y de qué campos. No la ejecuta, no conoce
 * proveedores ni configuración: los interruptores llegan como valores. Fallo cerrado: todo lo que
 * no esté explícitamente encendido (`=== true`) se trata como apagado.
 *
 * Lo que esta política NO hace, a propósito:
 *  · no toca la autoaprobación: `permiteAutoAprobacionDelPipeline` es independiente y ningún
 *    interruptor de rescate la cambia (EPS, Acta, RUT y Cámara siguen sin autoaprobación);
 *  · no habla de autenticidad ni de afiliación: el rescate solo aporta datos de lectura;
 *  · no hace que un documento sensible salga del proceso: en esta subfase no hay conexión con
 *    ningún proveedor.
 */

/** Interruptores del rescate. Todos nacen apagados. */
export interface InterruptoresRescateIa {
  /** Interruptor general (`IA_RESCATE_HABILITADO`). */
  habilitado: boolean;
  /** Certificado de EPS (`IA_RESCATE_EPS`). */
  eps: boolean;
  /** RUT persona natural y jurídica (`IA_RESCATE_RUT`). */
  rut: boolean;
  /** Certificado de Cámara de Comercio (`IA_RESCATE_CAMARA`). */
  camara: boolean;
  /** Acta de iniciación (`IA_RESCATE_ACTA`). */
  acta: boolean;
}

export const INTERRUPTORES_RESCATE_POR_DEFECTO: Readonly<InterruptoresRescateIa> = Object.freeze({
  habilitado: false, eps: false, rut: false, camara: false, acta: false,
});

type InterruptorSensible = Exclude<keyof InterruptoresRescateIa, 'habilitado'>;

/**
 * Interruptor específico de cada tipo de procesamiento local. Un tipo `SOLO_LOCAL` que no esté
 * aquí (uno que se agregue en el futuro) queda bloqueado siempre: no hay interruptor que lo abra.
 */
const INTERRUPTOR_POR_TIPO_SENSIBLE: Readonly<Partial<Record<TipoDocumento, InterruptorSensible>>> = {
  [TipoDocumento.CERTIFICADO_EPS]: 'eps',
  [TipoDocumento.ACTA_INICIO]: 'acta',
  [TipoDocumento.RUT_NATURAL]: 'rut',
  [TipoDocumento.RUT_JURIDICO]: 'rut',
  [TipoDocumento.CAMARA_COMERCIO]: 'camara',
};

export type MotivoPoliticaRescate =
  | 'rescate_deshabilitado'
  | 'tipo_sin_campos'
  | 'lectura_suficiente'
  | 'tipo_sensible_no_autorizado'
  | 'permitido';

export interface DecisionRescateIa {
  permitido: boolean;
  motivo: MotivoPoliticaRescate;
  /** Solo los campos faltantes, sin repetir; vacío cuando no se permite. */
  camposSolicitados: string[];
}

function encendido(interruptores: Readonly<Partial<InterruptoresRescateIa>>, clave: keyof InterruptoresRescateIa): boolean {
  return interruptores[clave] === true;
}

function rechazo(motivo: Exclude<MotivoPoliticaRescate, 'permitido'>): DecisionRescateIa {
  return { permitido: false, motivo, camposSolicitados: [] };
}

/**
 * ¿Está encendido el interruptor propio del tipo? Un tipo de procesamiento local (sensible) lo necesita; uno que
 * no lo es no tiene interruptor propio. Un tipo `SOLO_LOCAL` sin interruptor asignado queda bloqueado siempre.
 * Se deriva de `modoProcesamientoDe`: no hay una segunda lista de tipos sensibles.
 */
function interruptorDelTipoEncendido(tipo: TipoDocumento, interruptores: Readonly<Partial<InterruptoresRescateIa>>): boolean {
  if (modoProcesamientoDe(tipo) !== ModoProcesamiento.LOCAL) return true;
  const clave = INTERRUPTOR_POR_TIPO_SENSIBLE[tipo];
  return clave !== undefined && encendido(interruptores, clave);
}

/** Ambiente en el que un tipo sensible puede salir a un proveedor externo. Comparación estricta: ausente bloquea. */
const AMBIENTE_DE_SENSIBLES = 'dev';

export type MotivoAutorizacionRescate = 'rescate_deshabilitado' | 'tipo_sensible_no_autorizado' | 'ambiente_no_permitido';

export interface AutorizacionRescateIa {
  autorizado: boolean;
  motivo: MotivoAutorizacionRescate | null;
}

/**
 * Compuerta de configuración del rescate, independiente de la lectura: general encendido, interruptor del tipo
 * (si es sensible) y, para los sensibles, ambiente `dev` EXACTO. La usan el pipeline y el proveedor protegido
 * (defensa en profundidad): ninguno confía en que el otro ya la haya comprobado.
 */
export function autorizarRescateIa(
  tipo: TipoDocumento,
  interruptores: Readonly<Partial<InterruptoresRescateIa>>,
  ambiente: string | null | undefined,
): AutorizacionRescateIa {
  if (!encendido(interruptores, 'habilitado')) return { autorizado: false, motivo: 'rescate_deshabilitado' };
  if (!interruptorDelTipoEncendido(tipo, interruptores)) return { autorizado: false, motivo: 'tipo_sensible_no_autorizado' };
  if (modoProcesamientoDe(tipo) === ModoProcesamiento.LOCAL && ambiente !== AMBIENTE_DE_SENSIBLES) {
    return { autorizado: false, motivo: 'ambiente_no_permitido' };
  }
  return { autorizado: true, motivo: null };
}

/** Un rescate rechazado por la compuerta del proveedor: NO es una invocación ni un fallo del proveedor. */
export class RescateIaNoAutorizadoError extends Error {
  constructor(readonly motivo: MotivoAutorizacionRescate | 'sin_campos' | 'destino_no_permitido') {
    super(`Rescate con IA no autorizado: ${motivo}`);
    this.name = 'RescateIaNoAutorizadoError';
  }
}

export function decidirRescateIa(
  tipo: TipoDocumento,
  interruptores: Readonly<Partial<InterruptoresRescateIa>>,
  suficiencia: SuficienciaLectura,
): DecisionRescateIa {
  if (!encendido(interruptores, 'habilitado')) return rechazo('rescate_deshabilitado');
  if (suficiencia.estado === 'no_aplica') return rechazo('tipo_sin_campos');
  if (suficiencia.estado === 'suficiente' || suficiencia.faltantes.length === 0) return rechazo('lectura_suficiente');

  if (!interruptorDelTipoEncendido(tipo, interruptores)) return rechazo('tipo_sensible_no_autorizado');

  return {
    permitido: true,
    motivo: 'permitido',
    camposSolicitados: [...new Set(suficiencia.faltantes.map((f) => f.campo))],
  };
}
