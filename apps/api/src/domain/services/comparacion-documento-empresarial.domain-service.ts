import { DatosCamaraExtraidos, DatosRutExtraidos, TipoPersona } from '../entities/documento-empresarial';
import { controlarNitLeido } from './control-nit.domain-service';
import { compararDocumentos, compararNombres, normalizarTexto } from './normalizacion-identidad';

/**
 * Comparación del documento empresarial con lo que SIPRA sabe. Bloque 1: la ESTRUCTURA y las reglas básicas.
 *
 *  · Solo decide con campos cuya fuente en SIPRA es confiable: identificación/NIT, DV, nombre o razón social y
 *    representante legal. CIIU, DIVIPOLA y dirección NO deciden (los catálogos de CIIU y DIVIPOLA están incompletos):
 *    se informan como `informativo`.
 *  · Un NIT cuyo DV no corresponde NO es lectura confiable: no se compara (`informacion_insuficiente`); nunca se corrige.
 *  · No se guardan valores: solo el resultado por campo (los datos ya están en `datos_extraidos`).
 */

export type ResultadoCampoEmpresarial = 'coincide' | 'igual' | 'compatible' | 'diferente' | 'informacion_insuficiente' | 'no_aplica' | 'informativo';

export interface CampoComparadoEmpresarial {
  campo: string;
  resultado: ResultadoCampoEmpresarial;
  /** Código de la causa (no texto del documento). */
  nota?: string;
}

export interface ComparacionDocumentoEmpresarial {
  campos: CampoComparadoEmpresarial[];
  /** Hay al menos un campo `diferente`. */
  hayDiscrepancia: boolean;
}

export interface SipraPersonaNatural { documento: string | null; nombre: string | null }
export interface SipraEmpresa {
  nitNumero: string | null;
  nitDv: number | null;
  razonSocial: string | null;
  representanteLegal: string | null;
}

/** Formas jurídicas que el RUT y la Cámara escriben distinto de como se captura la razón social. */
const FORMAS_JURIDICAS = /\b(S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|LTDA\.?|LIMITADA|E\.?\s?U\.?|S\.?\s?C\.?\s?A\.?|SOCIEDAD POR ACCIONES SIMPLIFICADA)\b/g;

export function sinFormaJuridica(razon: string | null | undefined): string {
  return normalizarTexto(razon).replace(FORMAS_JURIDICAS, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function campo(campoNombre: string, resultado: ResultadoCampoEmpresarial, nota?: string): CampoComparadoEmpresarial {
  return nota ? { campo: campoNombre, resultado, nota } : { campo: campoNombre, resultado };
}

function porNombre(nombre: string, esperado: string | null, observado: string | null): CampoComparadoEmpresarial {
  const r = compararNombres(esperado, observado);
  return r === 'insuficiente' ? campo(nombre, 'informacion_insuficiente', 'dato_ausente') : campo(nombre, r);
}

function porRazonSocial(esperado: string | null, observado: string | null): CampoComparadoEmpresarial {
  const a = sinFormaJuridica(esperado); const b = sinFormaJuridica(observado);
  if (!a || !b) return campo('razon_social', 'informacion_insuficiente', 'dato_ausente');
  const r = compararNombres(a, b);
  // Una razón social de una sola palabra («ACME») no admite «compatible»: o es igual o es diferente.
  return r === 'insuficiente' ? campo('razon_social', 'informacion_insuficiente') : campo('razon_social', r);
}

function nitYDv(sipra: SipraEmpresa, nit: string | null, dv: string | null): CampoComparadoEmpresarial[] {
  const control = controlarNitLeido(nit, dv);
  if (!control.confiable) {
    const nota = `lectura_no_confiable_${control.estado}`;
    return [campo('nit', 'informacion_insuficiente', nota), campo('dv', 'informacion_insuficiente', nota)];
  }
  const nitSipra = (sipra.nitNumero ?? '').replace(/\D/g, '');
  if (!nitSipra) return [campo('nit', 'informacion_insuficiente', 'sipra_sin_nit'), campo('dv', 'informacion_insuficiente', 'sipra_sin_nit')];
  return [
    campo('nit', nitSipra === (nit ?? '').replace(/\D/g, '') ? 'coincide' : 'diferente'),
    sipra.nitDv === null ? campo('dv', 'informacion_insuficiente', 'sipra_sin_dv') : campo('dv', sipra.nitDv === Number(dv) ? 'coincide' : 'diferente'),
  ];
}

function cerrar(campos: CampoComparadoEmpresarial[]): ComparacionDocumentoEmpresarial {
  return { campos, hayDiscrepancia: campos.some((c) => c.resultado === 'diferente') };
}

const informativos = (ciiu: string | null | undefined, divipola: string | null | undefined): CampoComparadoEmpresarial[] => [
  ...(ciiu ? [campo('ciiu', 'informativo', 'catalogo_incompleto')] : []),
  ...(divipola ? [campo('divipola_municipio', 'informativo', 'catalogo_incompleto')] : []),
];

// ── RUT ─────────────────────────────────────────────────────────────────────

export function compararRutPersonaNatural(datos: DatosRutExtraidos, usuario: SipraPersonaNatural): ComparacionDocumentoEmpresarial {
  if (datos.tipoPersona !== TipoPersona.NATURAL) throw new Error('compararRutPersonaNatural exige un RUT de persona natural');
  const doc = compararDocumentos(usuario.documento, datos.numeroDocumento ?? null);
  const nombreObservado = [datos.nombres, datos.apellidos].filter(Boolean).join(' ') || null;
  return cerrar([
    doc === 'insuficiente' ? campo('documento', 'informacion_insuficiente', 'dato_ausente') : campo('documento', doc === 'igual' ? 'coincide' : 'diferente'),
    porNombre('nombre', usuario.nombre, nombreObservado),
    ...informativos(datos.ciiuPrincipal, datos.divipolaMunicipio),
  ]);
}

export function compararRutPersonaJuridica(datos: DatosRutExtraidos, empresa: SipraEmpresa): ComparacionDocumentoEmpresarial {
  if (datos.tipoPersona !== TipoPersona.JURIDICA) throw new Error('compararRutPersonaJuridica exige un RUT de persona jurídica');
  return cerrar([
    ...nitYDv(empresa, datos.nit, datos.dv),
    porRazonSocial(empresa.razonSocial, datos.razonSocial ?? null),
    ...informativos(datos.ciiuPrincipal, datos.divipolaMunicipio),
  ]);
}

// ── Cámara ──────────────────────────────────────────────────────────────────

export function compararCamara(datos: DatosCamaraExtraidos, empresa: SipraEmpresa): ComparacionDocumentoEmpresarial {
  const esNatural = datos.tipoPersona === TipoPersona.NATURAL;
  return cerrar([
    ...nitYDv(empresa, datos.nit, datos.dv),
    esNatural ? porNombre('nombre', empresa.razonSocial, datos.nombreORazonSocial) : porRazonSocial(empresa.razonSocial, datos.nombreORazonSocial),
    // Una persona natural comerciante no tiene representante legal: no se le exige.
    esNatural
      ? campo('representante_legal', 'no_aplica', 'persona_natural')
      : (empresa.representanteLegal && datos.representanteLegal
        ? porNombre('representante_legal', empresa.representanteLegal, datos.representanteLegal)
        : campo('representante_legal', 'informacion_insuficiente', 'dato_ausente')),
    ...informativos(datos.ciiu, null),
  ]);
}
