import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, DatosVerificadosEps, DiscrepanciaEps,
  RutaValidacionEps,
} from '../entities/validacion-eps.entity';
import { CodigoErrorVerificacion, ResultadoVerificacionEps } from '../ports/out/verificador-certificado-eps.port';
import { IdentidadEsperada } from './comparacion-eps.domain-service';
import {
  claveEps, compararDocumentos, compararNombres, fechaIsoDe, mismaEps, normalizarDocumento,
  normalizarEstadoReportado, normalizarRegimen, normalizarTexto,
} from './normalizacion-identidad';
import { VerificadorEpsDefinicion } from './registro-verificadores-eps';

/**
 * Qué se concluye de la respuesta de un verificador oficial.
 *
 * Principios (no negociables):
 *  · AUTENTICIDAD solo si el verificador declara `autenticaCertificado` y la
 *    fuente confirmó el certificado; la afiliación NO se infiere de ella.
 *  · AFILIACIÓN solo si el verificador declara `confirmaAfiliacion` y su respuesta
 *    trae un estado vigente explícito.
 *  · Un fallo de red o una respuesta no entendida nunca vuelve «falso» a un certificado.
 *  · Comparaciones SEPARADAS: certificado ↔ SIPRA, fuente ↔ certificado y fuente ↔ SIPRA.
 */

/** Mapa de aliases de EPS (clave → clave canónica) construido solo con los alias aprobados de los verificadores. */
export function aliasesAprobados(verificadores: readonly VerificadorEpsDefinicion[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const v of verificadores) {
    const canonica = claveEps(v.emisor);
    if (!canonica) continue;
    for (const alias of v.aliasesEmisor) {
      const clave = claveEps(alias);
      if (clave && clave !== canonica) mapa[clave] = canonica;
    }
  }
  return mapa;
}

export interface ComparacionOficial {
  discrepancias: DiscrepanciaEps[];
  /** La fuente contradice lo que dice el certificado (identidad, EPS o fecha): posible adulteración. */
  certificadoContradichoPorFuente: boolean;
  /** La fuente contradice la identidad que SIPRA esperaba: es un certificado auténtico, pero de otra persona. */
  internoContradichoPorFuente: boolean;
}

function discrepancia(
  campo: DiscrepanciaEps['campo'], comparacion: NonNullable<DiscrepanciaEps['comparacion']>,
  v: { interno?: string | null; certificado?: string | null; oficial?: string | null },
): DiscrepanciaEps {
  return {
    campo, comparacion, esperado: v.interno ?? null, observado: v.certificado ?? v.oficial ?? null,
    interno: v.interno ?? null, certificado: v.certificado ?? null, oficial: v.oficial ?? null, resultado: 'diferente',
  };
}

/**
 * Compara lo que CONFIRMA la fuente oficial con el certificado y con SIPRA.
 * Solo se contrastan los campos que la fuente trae; ausencia no es discrepancia.
 */
export function compararConFuenteOficial(
  oficial: DatosVerificadosEps,
  certificado: DatosExtraidosEps | null,
  interno: IdentidadEsperada,
  aliasEps: Readonly<Record<string, string>> = {},
): ComparacionOficial {
  const discrepancias: DiscrepanciaEps[] = [];
  let certificadoContradicho = false;
  let internoContradicho = false;

  // Número de documento
  if (oficial.numeroDocumento) {
    const num = normalizarDocumento(oficial.numeroDocumento).numero ?? oficial.numeroDocumento;
    if (certificado?.numeroDocumento && compararDocumentos(oficial.numeroDocumento, certificado.numeroDocumento) === 'diferente') {
      discrepancias.push(discrepancia('numero_documento', 'oficial_vs_certificado', { certificado: certificado.numeroDocumento, oficial: num }));
      certificadoContradicho = true;
    }
    if (interno.numeroDocumento && compararDocumentos(oficial.numeroDocumento, interno.numeroDocumento) === 'diferente') {
      discrepancias.push(discrepancia('numero_documento', 'oficial_vs_interno', { interno: interno.numeroDocumento, oficial: num }));
      internoContradicho = true;
    }
  }
  // Nombre
  if (oficial.nombre) {
    if (certificado?.nombre && compararNombres(oficial.nombre, certificado.nombre) === 'diferente') {
      discrepancias.push(discrepancia('nombre', 'oficial_vs_certificado', { certificado: certificado.nombre, oficial: oficial.nombre }));
      certificadoContradicho = true;
    }
    if (interno.nombre && compararNombres(oficial.nombre, interno.nombre) === 'diferente') {
      discrepancias.push(discrepancia('nombre', 'oficial_vs_interno', { interno: interno.nombre, oficial: oficial.nombre }));
      internoContradicho = true;
    }
  }
  // EPS: solo igualdad de clave canónica o alias APROBADO; nunca por parecido de texto.
  if (oficial.eps && certificado?.eps && mismaEps(oficial.eps, certificado.eps, aliasEps) === false) {
    discrepancias.push(discrepancia('eps', 'oficial_vs_certificado', { certificado: certificado.eps, oficial: oficial.eps }));
    certificadoContradicho = true;
  }
  // Régimen y estado: se señalan, pero no prueban adulteración por sí solos.
  if (oficial.regimen && certificado?.regimen) {
    const r = normalizarRegimen(oficial.regimen).regimen;
    if (r && r !== certificado.regimen) {
      discrepancias.push(discrepancia('regimen', 'oficial_vs_certificado', { certificado: certificado.regimen, oficial: r }));
    }
  }
  if (oficial.estadoAfiliacion && certificado?.estadoReportadoCertificado) {
    const e = normalizarEstadoReportado(oficial.estadoAfiliacion);
    if (e && e !== certificado.estadoReportadoCertificado) {
      discrepancias.push(discrepancia('estado_reportado', 'oficial_vs_certificado', { certificado: certificado.estadoReportadoCertificado, oficial: e }));
    }
  }
  // Fecha de expedición
  if (oficial.fechaExpedicion && certificado?.fechaExpedicion) {
    const f = fechaIsoDe(oficial.fechaExpedicion);
    if (f && f !== certificado.fechaExpedicion) {
      discrepancias.push(discrepancia('fecha_expedicion', 'oficial_vs_certificado', { certificado: certificado.fechaExpedicion, oficial: f }));
      certificadoContradicho = true;
    }
  }
  return { discrepancias, certificadoContradichoPorFuente: certificadoContradicho, internoContradichoPorFuente: internoContradicho };
}

/** Estado de afiliación que la FUENTE confirma → eje de afiliación. Solo estados explícitos. */
export function afiliacionDeFuente(estado: string | null | undefined): AfiliacionEps {
  const e = normalizarEstadoReportado(estado);
  if (e === 'ACTIVO') return AfiliacionEps.ACTIVA;
  if (e === 'INACTIVO' || e === 'SUSPENDIDO' || e === 'RETIRADO') return AfiliacionEps.INACTIVA;
  return AfiliacionEps.NO_DETERMINABLE;
}

export interface ConclusionVerificacion {
  /** `true` = resultado definitivo que se guarda como verificación (verificador + fecha). */
  definitiva: boolean;
  autenticidad: AutenticidadEps;
  /** Solo si el verificador la confirma; ausente = se conserva `no_contrastada`. */
  afiliacion?: AfiliacionEps;
  coincidencia?: CoincidenciaEps;
  ruta: RutaValidacionEps;
  discrepancias: DiscrepanciaEps[];
  datosVerificados: DatosVerificadosEps | null;
  errorCodigo: CodigoErrorVerificacion | null;
}

/**
 * Traduce el resultado del verificador a los ejes de la validación, aplicando
 * las capacidades DECLARADAS del verificador (no lo que diga la respuesta).
 */
export function concluirVerificacion(
  r: ResultadoVerificacionEps,
  verificador: VerificadorEpsDefinicion,
  certificado: DatosExtraidosEps | null,
  interno: IdentidadEsperada,
  aliasEps: Readonly<Record<string, string>> = {},
): ConclusionVerificacion {
  if (r.estado === 'no_verificable') {
    return {
      definitiva: false, autenticidad: AutenticidadEps.NO_VERIFICABLE, ruta: RutaValidacionEps.REVISION_MANUAL,
      discrepancias: [], datosVerificados: null, errorCodigo: r.errorCodigo,
    };
  }
  if (r.estado === 'rechazado') {
    // La fuente afirmó, de forma explícita, que no existe o no es válido. Solo si es un verificador de autenticidad.
    if (!verificador.autenticaCertificado) {
      return {
        definitiva: false, autenticidad: AutenticidadEps.NO_VERIFICABLE, ruta: RutaValidacionEps.REVISION_MANUAL,
        discrepancias: [], datosVerificados: null, errorCodigo: 'respuesta_invalida',
      };
    }
    return {
      definitiva: true, autenticidad: AutenticidadEps.INVALIDA, ruta: RutaValidacionEps.QR,
      discrepancias: [], datosVerificados: null, errorCodigo: r.errorCodigo,
    };
  }

  const comparacion = compararConFuenteOficial(r.datosVerificados, certificado, interno, aliasEps);
  const afiliacion = verificador.confirmaAfiliacion && r.datosVerificados.estadoAfiliacion
    ? afiliacionDeFuente(r.datosVerificados.estadoAfiliacion)
    : undefined;

  // La fuente contradice al certificado: el contenido no corresponde al registro oficial.
  if (verificador.autenticaCertificado && comparacion.certificadoContradichoPorFuente) {
    return {
      definitiva: true, autenticidad: AutenticidadEps.INVALIDA, ruta: RutaValidacionEps.QR,
      discrepancias: comparacion.discrepancias, datosVerificados: r.datosVerificados, errorCodigo: 'datos_inconsistentes',
    };
  }
  return {
    definitiva: true,
    autenticidad: verificador.autenticaCertificado ? AutenticidadEps.VERIFICADA : AutenticidadEps.NO_VERIFICABLE,
    afiliacion,
    // Certificado real pero de otra persona: la identidad no coincide con la que SIPRA esperaba.
    coincidencia: comparacion.internoContradichoPorFuente ? CoincidenciaEps.DISCREPANCIA : undefined,
    ruta: RutaValidacionEps.QR,
    discrepancias: comparacion.discrepancias,
    datosVerificados: r.datosVerificados,
    errorCodigo: null,
  };
}

/** Alias solo para pruebas y diagnóstico: igualdad exacta de texto normalizado (sin comparación aproximada). */
export function mismoTexto(a: string | null, b: string | null): boolean {
  return normalizarTexto(a) === normalizarTexto(b) && normalizarTexto(a) !== '';
}
