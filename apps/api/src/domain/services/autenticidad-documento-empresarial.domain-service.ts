import { AutenticidadDocumento, EstadoAutenticidad, autenticidadPorDefecto } from '../entities/documento-empresarial';
import { ContenidoQrClasificado } from './lectura-local.domain-service';

/**
 * Autenticidad de un documento empresarial.
 *
 * Aquí solo se REGISTRAN señales (QR, código, URL, firma de PDF). Ninguna eleva el estado: seguirá `no_verificable`
 * hasta que exista una verificación oficial (bloques posteriores), y entonces vendrá con su `fuente`. No hay
 * solicitudes de red en este módulo: un QR se clasifica, no se abre.
 */

/** Dominios oficiales a los que apunta el QR del RUT (DIAN). Coincidencia exacta o subdominio, nunca «contiene». */
export const DOMINIOS_OFICIALES_QR_RUT: readonly string[] = ['dian.gov.co'];

export function esDestinoOficialDian(host: string | null | undefined): boolean {
  const h = (host ?? '').toLowerCase().replace(/\.$/, '');
  return DOMINIOS_OFICIALES_QR_RUT.some((d) => h === d || h.endsWith(`.${d}`));
}

export interface SenalesAutenticidad {
  /** QR de la página(s) leídas, ya clasificados (sin contenido). `null` = no se buscó. */
  qr?: readonly Pick<ContenidoQrClasificado, 'tipo' | 'host'>[] | null;
  /** `true` si el QR se ve pero no se pudo decodificar (escaneado). */
  qrVisibleSinDecodificar?: boolean;
  firmaPdfPresente?: boolean | null;
  codigoVerificacion?: string | null;
  urlVerificacion?: string | null;
}

export function registrarSenalesAutenticidad(s: SenalesAutenticidad): AutenticidadDocumento {
  const base = autenticidadPorDefecto();
  const qr = s.qr ?? null;
  const decodificados = qr !== null && qr.length > 0;
  return {
    ...base,
    // Las señales se anotan; el estado NO cambia: sigue `no_verificable`.
    qrPresente: qr === null && !s.qrVisibleSinDecodificar ? null : decodificados || s.qrVisibleSinDecodificar === true,
    qrDecodificado: qr === null ? null : decodificados,
    qrDestinoOficial: decodificados ? qr.some((q) => q.tipo === 'url' && esDestinoOficialDian(q.host)) : qr === null ? null : false,
    firmaPdfPresente: s.firmaPdfPresente ?? null,
    firmaPdfValida: null,
    codigoVerificacionPresente: s.codigoVerificacion === undefined ? null : !!s.codigoVerificacion,
    urlVerificacionPresente: s.urlVerificacion === undefined ? null : !!s.urlVerificacion,
  };
}

export class AutenticidadInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Autenticidad no válida: ${motivo}`);
    this.name = 'AutenticidadInvalidaError';
  }
}

/** `verificada` exige una fuente; ninguna señal pasiva (QR, código, URL, firma presente) la justifica sola. */
export function validarAutenticidad(a: AutenticidadDocumento): AutenticidadDocumento {
  if (a.estado === EstadoAutenticidad.VERIFICADA && !a.fuente) throw new AutenticidadInvalidaError('«verificada» exige la fuente de la verificación');
  if (a.firmaPdfValida === true && !a.fuente) throw new AutenticidadInvalidaError('una firma de PDF «válida» exige la fuente de la validación');
  return a;
}
