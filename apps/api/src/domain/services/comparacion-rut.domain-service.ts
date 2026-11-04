import { createHash } from 'node:crypto';
import {
  ClasificacionDocumentoEmpresarial as C, DatosRutExtraidos, TipoPersona,
} from '../entities/documento-empresarial';
import type { ComparacionDocumentoEmpresarial } from './comparacion-documento-empresarial.domain-service';
import { sinFormaJuridica } from './comparacion-documento-empresarial.domain-service';
import { controlarNitLeido } from './control-nit.domain-service';
import { compararDocumentos, compararNombres, normalizarDocumento, tokensDeNombre } from './normalizacion-identidad';

/**
 * Comparación RUT ↔ SIPRA. NO decide aprobación: informa, por campo, si lo que dice el RUT coincide con lo que SIPRA
 * sabe, y una persona decide después.
 *
 * Reglas:
 *  · Solo se compara automáticamente con una lectura confiable. Con `lecturaDudosa`, o con un NIT cuyo DV no valida, los
 *    campos críticos quedan `informacion_insuficiente`: jamás «coincide» ni «diferente» por una lectura dudosa.
 *  · Persona natural: críticos = documento e identidad (nombre). Persona jurídica: críticos = NIT, DV y razón social.
 *  · CIIU, DIVIPOLA y fecha de generación son INFORMATIVOS: no se comparan ni causan discrepancias (catálogos incompletos,
 *    datos no canónicos en SIPRA, y la fecha del RUT no es vigencia).
 *  · Persona distinta a la esperada ⇒ no se compara «como si fuera» la otra: `no_aplica`.
 *  · Documento incorrecto o no determinable ⇒ no se compara nada (no hay comparación).
 *  · La comparación guarda campo, resultado y criticidad: nunca los valores. Una huella de lo que SIPRA decía permite
 *    detectar después que sus datos cambiaron, sin tocar lo ya guardado.
 */

export type ResultadoCampoRut = 'coincide' | 'diferente' | 'informacion_insuficiente' | 'no_aplica';
export type CriticidadCampoRut = 'critico' | 'informativo';
export type CampoRut = 'documento' | 'nombre' | 'nit' | 'dv' | 'razon_social' | 'ciiu' | 'divipola' | 'fecha_generacion';

/** Veredicto de la comparación (no es una decisión). */
export type VeredictoComparacionRut = 'consistente' | 'discrepancia' | 'revision_necesaria' | 'no_aplica';

export interface CampoComparacionRut {
  campo: CampoRut;
  resultado: ResultadoCampoRut;
  criticidad: CriticidadCampoRut;
  /** Código de la causa (nunca texto del documento). */
  nota?: string;
}

export interface ComparacionRut extends ComparacionDocumentoEmpresarial {
  version: 1;
  veredicto: VeredictoComparacionRut;
  campos: CampoComparacionRut[];
  /** Hay al menos un campo CRÍTICO `diferente`. */
  hayDiscrepancia: boolean;
  /** SHA-256 de lo que SIPRA decía al comparar (no los valores): permite saber si cambió después. */
  huellaSipra: string;
  calculadaEn: string;
}

/** Lo que SIPRA sabe y contra lo que se compara (datos canónicos). */
export interface SipraParaRut {
  /** Persona natural: el estudiante. */
  usuario: { documento: string | null; nombre: string | null };
  /** Persona jurídica: la empresa de la práctica (o, sin empresa registrada, lo que dice el formulario FUR). */
  empresa: { nitNumero: string | null; nitDv: number | null; razonSocial: string | null } | null;
}

/** Lo ya leído y guardado de un RUT (no se vuelve a leer el PDF). */
export interface LecturaRutParaComparar {
  tipoDetectado: C | null;
  datos: DatosRutExtraidos | null;
  lecturaDudosa: boolean;
  /** Resultado de contrastar lo esperado con lo detectado (`coincide`, `persona_distinta`…). */
  expectativa: string | null;
}

const CRITICOS_PN: readonly CampoRut[] = ['documento', 'nombre'];
const CRITICOS_PJ: readonly CampoRut[] = ['nit', 'dv', 'razon_social'];
const INFORMATIVOS: readonly CampoRut[] = ['ciiu', 'divipola', 'fecha_generacion'];

const campo = (c: CampoRut, resultado: ResultadoCampoRut, criticidad: CriticidadCampoRut, nota?: string): CampoComparacionRut =>
  (nota ? { campo: c, resultado, criticidad, nota } : { campo: c, resultado, criticidad });

// ── Huella de lo que SIPRA decía ────────────────────────────────────────────

/** Huella estable de los datos de SIPRA relevantes (normalizados). No contiene los valores. */
export function huellaSipraRut(sipra: SipraParaRut): string {
  const forma = {
    d: normalizarDocumento(sipra.usuario.documento).numero,
    n: [...new Set(tokensDeNombre(sipra.usuario.nombre))].sort(),
    e: sipra.empresa
      ? {
        n: (sipra.empresa.nitNumero ?? '').replace(/\D/g, '') || null,
        v: sipra.empresa.nitDv,
        r: sinFormaJuridica(sipra.empresa.razonSocial) || null,
      }
      : null,
  };
  return createHash('sha256').update(JSON.stringify(forma)).digest('hex');
}

/** ¿Lo que SIPRA dice hoy es distinto de lo que decía cuando se comparó? (Para avisar a una futura Mesa.) */
export function sipraCambioDespues(comparacion: Pick<ComparacionRut, 'huellaSipra'>, sipraActual: SipraParaRut): boolean {
  return comparacion.huellaSipra !== huellaSipraRut(sipraActual);
}

// ── Comparación ─────────────────────────────────────────────────────────────

function veredictoDe(campos: readonly CampoComparacionRut[]): VeredictoComparacionRut {
  const criticos = campos.filter((c) => c.criticidad === 'critico');
  if (criticos.length === 0 || criticos.every((c) => c.resultado === 'no_aplica')) return 'no_aplica';
  if (criticos.some((c) => c.resultado === 'diferente')) return 'discrepancia';
  if (criticos.some((c) => c.resultado === 'informacion_insuficiente')) return 'revision_necesaria';
  return 'consistente';
}

function cerrar(campos: CampoComparacionRut[], sipra: SipraParaRut, ahora: Date): ComparacionRut {
  return {
    version: 1, veredicto: veredictoDe(campos), campos,
    hayDiscrepancia: campos.some((c) => c.criticidad === 'critico' && c.resultado === 'diferente'),
    huellaSipra: huellaSipraRut(sipra), calculadaEn: ahora.toISOString(),
  };
}

const informativos = (nota = 'informativo_sin_decision'): CampoComparacionRut[] =>
  INFORMATIVOS.map((c) => campo(c, 'no_aplica', 'informativo', nota));

/** Todos los críticos del tipo, con el mismo resultado y causa. */
function todosCriticos(persona: TipoPersona, resultado: ResultadoCampoRut, nota: string): CampoComparacionRut[] {
  return (persona === TipoPersona.NATURAL ? CRITICOS_PN : CRITICOS_PJ).map((c) => campo(c, resultado, 'critico', nota));
}

/**
 * `null` = no hay comparación (documento incorrecto o no determinable, o sin lectura): la base exige que esos casos no
 * traigan comparación, y una persona los revisa.
 */
export function compararRut(lectura: LecturaRutParaComparar, sipra: SipraParaRut, ahora: Date): ComparacionRut | null {
  const tipo = lectura.tipoDetectado;
  if (tipo !== C.RUT_PERSONA_NATURAL && tipo !== C.RUT_PERSONA_JURIDICA) return null;
  const persona = tipo === C.RUT_PERSONA_NATURAL ? TipoPersona.NATURAL : TipoPersona.JURIDICA;

  // Persona distinta a la esperada: no se compara como si fuera la otra.
  if (lectura.expectativa === 'persona_distinta') {
    return cerrar([...todosCriticos(persona, 'no_aplica', 'persona_distinta'), ...informativos('persona_distinta')], sipra, ahora);
  }
  const datos = lectura.datos;
  // Sin datos o con lectura dudosa: nada se decide automáticamente.
  if (!datos || lectura.lecturaDudosa) {
    return cerrar([...todosCriticos(persona, 'informacion_insuficiente', datos ? 'lectura_dudosa' : 'sin_datos_leidos'), ...informativos()], sipra, ahora);
  }
  return cerrar(
    [...(persona === TipoPersona.NATURAL ? compararPersonaNatural(datos, sipra) : compararPersonaJuridica(datos, sipra)), ...informativos()],
    sipra, ahora,
  );
}

function compararPersonaNatural(d: DatosRutExtraidos, sipra: SipraParaRut): CampoComparacionRut[] {
  // Documento: el número de documento del RUT (o, sin él, el NIT si su DV valida: en persona natural es la cédula).
  const nitConfiable = controlarNitLeido(d.nit, d.dv).confiable;
  const leido = d.numeroDocumento ?? (nitConfiable ? d.nit : null) ?? null;
  const doc = compararDocumentos(sipra.usuario.documento, leido);
  const documento = doc === 'insuficiente'
    ? campo('documento', 'informacion_insuficiente', 'critico', leido === null ? 'dato_ausente_en_rut' : 'sipra_sin_documento')
    : campo('documento', doc === 'igual' ? 'coincide' : 'diferente', 'critico');

  const nombreRut = [d.nombres, d.apellidos].filter(Boolean).join(' ') || null;
  const n = compararNombres(sipra.usuario.nombre, nombreRut);
  // «compatible» = todos los tokens del nombre más corto (al menos dos) están en el más largo: se acepta como coincidencia.
  const nombre = n === 'insuficiente'
    ? campo('nombre', 'informacion_insuficiente', 'critico', nombreRut === null ? 'dato_ausente_en_rut' : 'sipra_sin_nombre')
    : n === 'diferente' ? campo('nombre', 'diferente', 'critico')
      : campo('nombre', 'coincide', 'critico', n === 'compatible' ? 'nombre_parcial' : undefined);
  return [documento, nombre];
}

function compararPersonaJuridica(d: DatosRutExtraidos, sipra: SipraParaRut): CampoComparacionRut[] {
  const e = sipra.empresa;
  const sinEmpresa = (c: CampoRut): CampoComparacionRut => campo(c, 'informacion_insuficiente', 'critico', 'sipra_sin_empresa');
  const control = controlarNitLeido(d.nit, d.dv);

  // NIT y DV: solo con una lectura cuyo DV valida. Un NIT inválido jamás se cuenta como «diferente».
  let nit: CampoComparacionRut; let dv: CampoComparacionRut;
  if (!e) { nit = sinEmpresa('nit'); dv = sinEmpresa('dv'); }
  else if (!control.confiable) {
    const nota = `nit_no_confiable_${control.estado}`;
    nit = campo('nit', 'informacion_insuficiente', 'critico', nota); dv = campo('dv', 'informacion_insuficiente', 'critico', nota);
  } else {
    const nitSipra = (e.nitNumero ?? '').replace(/\D/g, '');
    nit = nitSipra ? campo('nit', nitSipra === d.nit ? 'coincide' : 'diferente', 'critico') : campo('nit', 'informacion_insuficiente', 'critico', 'sipra_sin_nit');
    dv = e.nitDv === null ? campo('dv', 'informacion_insuficiente', 'critico', 'sipra_sin_dv') : campo('dv', e.nitDv === Number(d.dv) ? 'coincide' : 'diferente', 'critico');
  }

  // Razón social: conservadora. Solo la identidad de tokens (sin forma jurídica) coincide; un nombre más corto o más largo
  // NO es la misma empresa.
  let razon: CampoComparacionRut;
  if (!e) razon = sinEmpresa('razon_social');
  else {
    const a = sinFormaJuridica(e.razonSocial); const b = sinFormaJuridica(d.razonSocial);
    if (!a || !b) razon = campo('razon_social', 'informacion_insuficiente', 'critico', !b ? 'dato_ausente_en_rut' : 'sipra_sin_razon_social');
    else razon = compararNombres(a, b) === 'igual' ? campo('razon_social', 'coincide', 'critico') : campo('razon_social', 'diferente', 'critico');
  }
  return [nit, dv, razon];
}

// ── Datos de SIPRA ──────────────────────────────────────────────────────────

/** Arma lo que SIPRA sabe a partir de la práctica, el estudiante y la empresa. Nunca consulta nada externo. */
export function datosSipraParaRut(entrada: {
  estudiante: { nombre: string | null; documento: string | null };
  empresa: { nitNumero: string; nitDv: number; razonSocial: string } | null;
  /** Lo que dice el formulario FUR de la práctica cuando no hay empresa registrada. */
  formulario: { razonSocial: string | null; nit: string | null } | null;
}): SipraParaRut {
  let empresa: SipraParaRut['empresa'] = null;
  if (entrada.empresa) {
    empresa = { nitNumero: entrada.empresa.nitNumero, nitDv: entrada.empresa.nitDv, razonSocial: entrada.empresa.razonSocial };
  } else if (entrada.formulario && (entrada.formulario.razonSocial || entrada.formulario.nit)) {
    // «901458772-2» → número y DV; sin guion, solo el número (el DV queda sin dato, no se inventa).
    const m = (entrada.formulario.nit ?? '').trim().match(/^(\d[\d.]*)\s*-\s*(\d)$/);
    const numero = m ? m[1].replace(/\D/g, '') : (entrada.formulario.nit ?? '').replace(/\D/g, '') || null;
    empresa = { nitNumero: numero, nitDv: m ? Number(m[2]) : null, razonSocial: entrada.formulario.razonSocial };
  }
  return { usuario: { documento: entrada.estudiante.documento, nombre: entrada.estudiante.nombre }, empresa };
}
