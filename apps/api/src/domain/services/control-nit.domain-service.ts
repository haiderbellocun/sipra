import { Nit } from '../value-objects/nit.vo';

/**
 * El DV como control determinístico de un NIT leído (texto nativo u OCR).
 *
 * Si el DV leído no es el que corresponde al número, la lectura NO es confiable. Jamás se corrige el NIT para que
 * coincida: se informa el DV esperado y el valor leído se conserva tal cual para la revisión humana.
 */

export type EstadoControlNit = 'confiable' | 'dv_no_coincide' | 'dv_ausente' | 'nit_ausente' | 'nit_invalido';

export interface ControlNit {
  estado: EstadoControlNit;
  /** Solo informativo; no sustituye a lo leído. */
  dvEsperado: number | null;
  /** ¿Se puede apoyar una decisión (o una comparación) en este NIT? */
  confiable: boolean;
}

export function controlarNitLeido(nit: string | null | undefined, dv: string | number | null | undefined): ControlNit {
  const numero = (nit ?? '').replace(/\D/g, '');
  if (!numero) return { estado: 'nit_ausente', dvEsperado: null, confiable: false };
  let esperado: number;
  try {
    esperado = Nit.calcularDigitoVerificacion(numero);
  } catch {
    return { estado: 'nit_invalido', dvEsperado: null, confiable: false };
  }
  const leido = dv === null || dv === undefined || String(dv).trim() === '' ? null : String(dv).trim();
  if (leido === null) return { estado: 'dv_ausente', dvEsperado: esperado, confiable: false };
  if (!/^\d$/.test(leido)) return { estado: 'dv_no_coincide', dvEsperado: esperado, confiable: false };
  return Number(leido) === esperado
    ? { estado: 'confiable', dvEsperado: esperado, confiable: true }
    : { estado: 'dv_no_coincide', dvEsperado: esperado, confiable: false };
}
