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

export function decidirRescateIa(
  tipo: TipoDocumento,
  interruptores: Readonly<Partial<InterruptoresRescateIa>>,
  suficiencia: SuficienciaLectura,
): DecisionRescateIa {
  if (!encendido(interruptores, 'habilitado')) return rechazo('rescate_deshabilitado');
  if (suficiencia.estado === 'no_aplica') return rechazo('tipo_sin_campos');
  if (suficiencia.estado === 'suficiente' || suficiencia.faltantes.length === 0) return rechazo('lectura_suficiente');

  if (modoProcesamientoDe(tipo) === ModoProcesamiento.LOCAL) {
    const clave = INTERRUPTOR_POR_TIPO_SENSIBLE[tipo];
    if (!clave || !encendido(interruptores, clave)) return rechazo('tipo_sensible_no_autorizado');
  }

  return {
    permitido: true,
    motivo: 'permitido',
    camposSolicitados: [...new Set(suficiencia.faltantes.map((f) => f.campo))],
  };
}
