import {
  CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL, DatosCamaraExtraidos, DatosRutExtraidos, EstadoRegistral, TipoPersona,
  TipoCertificadoCamara,
} from '../entities/documento-empresarial';
import { clasificarContenidoQr } from './lectura-local.domain-service';

/**
 * Minimización: de lo que un lector devuelve («bruto») solo se conserva una lista blanca. Dirección completa, correo,
 * teléfono, responsabilidades, texto y OCR pueden existir mientras se procesa, pero NO salen de aquí.
 */

type Bruto = Readonly<Record<string, unknown>>;

const texto = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const limpio = v.replace(/\s+/g, ' ').trim();
  return limpio ? limpio.slice(0, max) : null;
};
const soloDigitos = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = String(v).replace(/\D/g, '');
  return d.length >= min && d.length <= max ? d : null;
};
const fechaIso = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const entero = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

export function minimizarDatosRut(bruto: Bruto, tipoPersona: TipoPersona): DatosRutExtraidos {
  const comunes: DatosRutExtraidos = {
    tipoPersona,
    nit: soloDigitos(bruto['nit'], 5, 15),
    dv: soloDigitos(bruto['dv'], 1, 1),
    fechaGeneracion: fechaIso(bruto['fechaGeneracion']),
    ciiuPrincipal: soloDigitos(bruto['ciiuPrincipal'], 4, 4),
    // DIVIPOLA: 2 dígitos de departamento + 3 de municipio.
    divipolaMunicipio: soloDigitos(bruto['divipolaMunicipio'], 5, 5),
  };
  return tipoPersona === TipoPersona.NATURAL
    ? {
      ...comunes,
      tipoDocumento: texto(bruto['tipoDocumento'], 30),
      numeroDocumento: soloDigitos(bruto['numeroDocumento'], 4, 15),
      nombres: texto(bruto['nombres']),
      apellidos: texto(bruto['apellidos']),
    }
    : { ...comunes, razonSocial: texto(bruto['razonSocial']) };
}

const ESTADOS_REGISTRALES: readonly string[] = Object.values(EstadoRegistral);

/** URL de verificación sin credenciales, parámetros ni fragmento; si no es una URL http(s), se descarta. */
export function sanearUrlVerificacion(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const candidata = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  const c = clasificarContenidoQr(candidata);
  if (c.tipo !== 'url' || c.senales.includes('credenciales_en_url')) return null;
  return c.origenSanitizado;
}

export function minimizarDatosCamara(
  bruto: Bruto, tipoCertificado: TipoCertificadoCamara, tipoPersona: TipoPersona,
): DatosCamaraExtraidos {
  const estado = typeof bruto['estadoRegistral'] === 'string' && ESTADOS_REGISTRALES.includes(bruto['estadoRegistral'])
    ? (bruto['estadoRegistral'] as EstadoRegistral)
    : EstadoRegistral.NO_DETERMINABLE;
  return {
    tipoCertificado,
    tipoPersona,
    nombreORazonSocial: texto(bruto['nombreORazonSocial']),
    nit: soloDigitos(bruto['nit'], 5, 15),
    dv: soloDigitos(bruto['dv'], 1, 1),
    matricula: texto(bruto['matricula'], 30),
    camara: texto(bruto['camara'], 80),
    fechaMatricula: fechaIso(bruto['fechaMatricula']),
    ultimoAnioRenovado: entero(bruto['ultimoAnioRenovado'], 1900, 2200),
    fechaRenovacion: fechaIso(bruto['fechaRenovacion']),
    estadoRegistral: estado,
    domicilioMunicipio: texto(bruto['domicilioMunicipio'], 80),
    ciiu: soloDigitos(bruto['ciiu'], 4, 4),
    // La persona natural no tiene representante legal: nunca se conserva uno.
    representanteLegal: tipoPersona === TipoPersona.JURIDICA ? texto(bruto['representanteLegal']) : null,
    fechaExpedicion: fechaIso(bruto['fechaExpedicion']),
    codigoVerificacion: texto(bruto['codigoVerificacion'], 40),
    urlVerificacion: sanearUrlVerificacion(bruto['urlVerificacion']),
    diasVerificacionDocumento: entero(bruto['diasVerificacionDocumento'], 1, 3650),
    firmaPdfPresente: typeof bruto['firmaPdfPresente'] === 'boolean' ? bruto['firmaPdfPresente'] : null,
  };
}

/** Claves prohibidas en cualquier nivel de un objeto (vacío = limpio). */
export function clavesProhibidasEn(valor: unknown, ruta = ''): string[] {
  if (valor === null || typeof valor !== 'object') return [];
  if (Array.isArray(valor)) return valor.flatMap((v, i) => clavesProhibidasEn(v, `${ruta}[${i}]`));
  return Object.entries(valor as Record<string, unknown>).flatMap(([k, v]) => [
    ...(CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL.includes(k) ? [ruta ? `${ruta}.${k}` : k] : []),
    ...clavesProhibidasEn(v, ruta ? `${ruta}.${k}` : k),
  ]);
}
