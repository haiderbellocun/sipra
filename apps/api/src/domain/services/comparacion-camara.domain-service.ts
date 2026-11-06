import { createHash } from 'node:crypto';
import {
  ClasificacionDocumentoEmpresarial as C, DatosCamaraExtraidos, EstadoRegistral, TipoPersona,
} from '../entities/documento-empresarial';
import type { ComparacionDocumentoEmpresarial } from './comparacion-documento-empresarial.domain-service';
import { sinFormaJuridica } from './comparacion-documento-empresarial.domain-service';
import { datosSipraParaRut } from './comparacion-rut.domain-service';
import { controlarNitLeido } from './control-nit.domain-service';
import { compararNombres, tokensDeNombre } from './normalizacion-identidad';

/**
 * Comparación Cámara de Comercio ↔ SIPRA. NO aprueba, NO rechaza y NO devuelve: informa, por campo, si lo que dice el
 * certificado coincide con lo que SIPRA sabe, y una persona decide después.
 *
 * Reglas:
 *  · Con `lecturaDudosa` los campos críticos quedan `informacion_insuficiente`: una lectura dudosa jamás produce «coincide»
 *    ni «diferente». Lo mismo con un NIT cuyo DV no valida (nunca se corrige el NIT para que coincida).
 *  · Críticos: persona natural → identificación (`nit`), `dv` y `nombre`; persona jurídica → `nit`, `dv` y `razon_social`.
 *    El representante legal es IMPORTANTE (no crítico) en existencia y representación, informativo en matrícula de sociedad y no
 *    aplica a la persona natural. Su ausencia (en SIPRA o en el certificado) es `informacion_insuficiente` y NO frena el veredicto: se
 *    muestra como dato pendiente de contraste humano. Solo si ambos lados lo tienen y son distintos es una discrepancia IMPORTANTE:
 *    veredicto `revision_necesaria` y `discrepanciaImportante`, sin llegar al nivel de NIT/DV.
 *  · Sin DV en el certificado, el número se compara igual y el DV queda `informacion_insuficiente` (no bloquea la comparación).
 *  · Matrícula, Cámara, fechas, renovación, domicilio, CIIU, código de verificación, firma PDF y ventana de verificación son
 *    INFORMATIVOS: no tienen contraparte canónica en SIPRA y no causan discrepancias. La renovación y el estado «activo» no
 *    significan vigencia ni aprobación; la antigüedad no se evalúa mientras `camaraMaxDiasExpedicion` sea `null`.
 *  · El código, la URL y la firma PDF NO son criterio de coincidencia (la autenticidad sigue `no_verificable`).
 *  · Persona distinta a la esperada ⇒ no se compara «como si fuera» la otra: los críticos son `no_aplica`.
 *  · Documento incorrecto o no determinable ⇒ no hay comparación (`null`): la base lo exige y una persona lo revisa.
 *  · La comparación guarda campo, resultado, criticidad y causa: nunca los valores. Una huella de lo que SIPRA decía permite
 *    detectar después que sus datos cambiaron, sin tocar lo ya guardado.
 */

export type ResultadoCampoCamara = 'coincide' | 'diferente' | 'informacion_insuficiente' | 'no_aplica' | 'informativo';
export type CriticidadCampoCamara = 'critico' | 'importante' | 'informativo';
export type CampoCamara =
  | 'nit' | 'dv' | 'nombre' | 'razon_social' | 'representante_legal'
  | 'matricula' | 'camara' | 'fecha_matricula' | 'ultimo_anio_renovado' | 'fecha_renovacion' | 'domicilio' | 'ciiu'
  | 'fecha_expedicion' | 'codigo_verificacion' | 'firma_pdf' | 'ventana_verificacion' | 'estado_registral';

/** Veredicto de la comparación (no es una decisión). */
export type VeredictoComparacionCamara = 'consistente' | 'discrepancia' | 'revision_necesaria' | 'no_aplica';

export interface CampoComparacionCamara {
  campo: CampoCamara;
  resultado: ResultadoCampoCamara;
  criticidad: CriticidadCampoCamara;
  /** Código de la causa (nunca texto del documento). */
  nota?: string;
}

export interface ComparacionCamara extends ComparacionDocumentoEmpresarial {
  version: 1;
  veredicto: VeredictoComparacionCamara;
  campos: CampoComparacionCamara[];
  /** Hay al menos un campo CRÍTICO `diferente` (NIT, DV, razón social o nombre). */
  hayDiscrepancia: boolean;
  /** Un campo IMPORTANTE (el representante legal) es `diferente`: pide revisión, pero no es crítica. */
  discrepanciaImportante: boolean;
  /** Señales separadas que una persona debe ver (p. ej. `estado_registral_cancelado`). No son una decisión. */
  senales: string[];
  /** SHA-256 de lo que SIPRA decía al comparar (no los valores): permite saber si cambió después. */
  huellaSipra: string;
  calculadaEn: string;
}

/** Lo que SIPRA sabe y contra lo que se compara (datos canónicos). */
export interface SipraParaCamara {
  /** Persona que SIPRA espera del comerciante o la empresa; `null` si no se puede afirmar con seguridad. */
  personaEsperada: TipoPersona | null;
  /** La empresa de la práctica (o, sin empresa registrada, lo que dice el formulario FUR). En persona natural es el titular. */
  empresa: { nitNumero: string | null; nitDv: number | null; razonSocial: string | null; representanteLegal: string | null } | null;
}

/** Lo ya leído y guardado de una Cámara (no se vuelve a leer el PDF). */
export interface LecturaCamaraParaComparar {
  tipoDetectado: C | null;
  datos: DatosCamaraExtraidos | null;
  lecturaDudosa: boolean;
}

const INFORMATIVOS: readonly CampoCamara[] = [
  'matricula', 'camara', 'fecha_matricula', 'ultimo_anio_renovado', 'fecha_renovacion', 'domicilio', 'ciiu',
  'fecha_expedicion', 'codigo_verificacion', 'firma_pdf', 'ventana_verificacion',
];

const campo = (c: CampoCamara, resultado: ResultadoCampoCamara, criticidad: CriticidadCampoCamara, nota?: string): CampoComparacionCamara =>
  (nota ? { campo: c, resultado, criticidad, nota } : { campo: c, resultado, criticidad });

// ── Datos de SIPRA ──────────────────────────────────────────────────────────

/**
 * Persona esperada por la FORMA del NIT en SIPRA, solo cuando es inequívoca: 9 dígitos que empiezan por 8 o 9 son una
 * persona jurídica; una cédula (6 a 8 dígitos, o 10 dígitos que empiezan por 1) es una persona natural. Cualquier otra forma
 * no permite afirmar nada (`null`): no se inventa una expectativa.
 */
export function personaEsperadaPorNit(nitNumero: string | null | undefined): TipoPersona | null {
  const n = (nitNumero ?? '').replace(/\D/g, '');
  if (/^[89]\d{8}$/.test(n)) return TipoPersona.JURIDICA;
  if (/^\d{6,8}$/.test(n) || /^1\d{9}$/.test(n)) return TipoPersona.NATURAL;
  return null;
}

/** Arma lo que SIPRA sabe a partir de la empresa de la práctica (o del FUR). Nunca consulta nada externo. */
export function datosSipraParaCamara(entrada: {
  empresa: { nitNumero: string; nitDv: number; razonSocial: string; representanteLegal?: string | null } | null;
  /** Lo que dice el formulario FUR de la práctica cuando no hay empresa registrada. */
  formulario: { razonSocial: string | null; nit: string | null } | null;
}): SipraParaCamara {
  const base = datosSipraParaRut({ estudiante: { nombre: null, documento: null }, empresa: entrada.empresa, formulario: entrada.formulario }).empresa;
  if (!base) return { personaEsperada: null, empresa: null };
  return {
    personaEsperada: personaEsperadaPorNit(base.nitNumero),
    empresa: { ...base, representanteLegal: entrada.empresa?.representanteLegal ?? null },
  };
}

// ── Huella de lo que SIPRA decía ────────────────────────────────────────────

const tokensOrdenados = (valor: string | null | undefined): string[] => [...new Set(tokensDeNombre(valor))].sort();

/** Huella estable de los datos de SIPRA relevantes (normalizados). No contiene los valores. */
export function huellaSipraCamara(sipra: SipraParaCamara): string {
  const e = sipra.empresa;
  const forma = {
    p: sipra.personaEsperada,
    e: e
      ? {
        n: (e.nitNumero ?? '').replace(/\D/g, '') || null,
        v: e.nitDv,
        r: tokensOrdenados(sinFormaJuridica(e.razonSocial)),
        g: tokensOrdenados(e.representanteLegal),
      }
      : null,
  };
  return createHash('sha256').update(JSON.stringify(forma)).digest('hex');
}

/** ¿Lo que SIPRA dice hoy es distinto de lo que decía cuando se comparó? (Para avisar a una futura Mesa.) */
export function sipraCambioDespuesCamara(comparacion: Pick<ComparacionCamara, 'huellaSipra'>, sipraActual: SipraParaCamara): boolean {
  return comparacion.huellaSipra !== huellaSipraCamara(sipraActual);
}

// ── Comparación ─────────────────────────────────────────────────────────────

const criticosDe = (campos: readonly CampoComparacionCamara[]): CampoComparacionCamara[] => campos.filter((c) => c.criticidad === 'critico');
const importantesDe = (campos: readonly CampoComparacionCamara[]): CampoComparacionCamara[] => campos.filter((c) => c.criticidad === 'importante');

/** Solo lo CRÍTICO decide discrepancia o falta de información; lo importante solo pide revisión cuando es distinto en ambos lados. */
function veredictoDe(campos: readonly CampoComparacionCamara[]): VeredictoComparacionCamara {
  const criticos = criticosDe(campos);
  if (criticos.length === 0 || criticos.every((c) => c.resultado === 'no_aplica')) return 'no_aplica';
  if (criticos.some((c) => c.resultado === 'diferente')) return 'discrepancia';
  if (criticos.some((c) => c.resultado === 'informacion_insuficiente')) return 'revision_necesaria';
  if (importantesDe(campos).some((c) => c.resultado === 'diferente')) return 'revision_necesaria';
  return 'consistente';
}

function cerrar(campos: CampoComparacionCamara[], sipra: SipraParaCamara, ahora: Date): ComparacionCamara {
  const senales = campos.filter((c) => c.campo === 'estado_registral' && c.resultado === 'diferente').map(() => 'estado_registral_cancelado');
  return {
    version: 1, veredicto: veredictoDe(campos), campos,
    hayDiscrepancia: criticosDe(campos).some((c) => c.resultado === 'diferente'),
    discrepanciaImportante: importantesDe(campos).some((c) => c.resultado === 'diferente'),
    senales, huellaSipra: huellaSipraCamara(sipra), calculadaEn: ahora.toISOString(),
  };
}

/** Persona que corresponde a la clasificación de una Cámara; `null` si no es un certificado de Cámara interpretable. */
export function personaDeCamara(tipo: C | null): TipoPersona | null {
  if (tipo === C.CAMARA_MATRICULA_PERSONA_NATURAL) return TipoPersona.NATURAL;
  if (tipo === C.CAMARA_MATRICULA_SOCIEDAD || tipo === C.CAMARA_EXISTENCIA_REPRESENTACION) return TipoPersona.JURIDICA;
  return null;
}

/** Veredicto que ve la persona cuando no hay comparación: un documento incorrecto o no determinable siempre se revisa. */
export function veredictoSinComparacionCamara(tipo: C | null): VeredictoComparacionCamara | null {
  return tipo === C.DOCUMENTO_INCORRECTO || tipo === C.NO_DETERMINABLE ? 'revision_necesaria' : null;
}

/** Campos relevantes del tipo, con el mismo resultado y causa. */
function relevantes(tipo: C, resultado: ResultadoCampoCamara, nota: string): CampoComparacionCamara[] {
  const base: CampoComparacionCamara[] = tipo === C.CAMARA_MATRICULA_PERSONA_NATURAL
    ? [campo('nit', resultado, 'critico', nota), campo('dv', resultado, 'critico', nota), campo('nombre', resultado, 'critico', nota)]
    : [campo('nit', resultado, 'critico', nota), campo('dv', resultado, 'critico', nota), campo('razon_social', resultado, 'critico', nota)];
  if (tipo === C.CAMARA_EXISTENCIA_REPRESENTACION) base.push(campo('representante_legal', resultado, 'importante', nota));
  if (resultado !== 'no_aplica') base.push(campo('estado_registral', resultado, 'critico', nota));
  return base;
}

/** `null` = no hay comparación (documento incorrecto o no determinable): una persona los revisa. */
export function compararCamaraConSipra(lectura: LecturaCamaraParaComparar, sipra: SipraParaCamara, ahora: Date): ComparacionCamara | null {
  const tipo = lectura.tipoDetectado;
  const persona = personaDeCamara(tipo);
  if (tipo === null || persona === null) return null;
  const datos = lectura.datos;

  // Persona distinta a la esperada: es un certificado real de otro tipo, no un documento inválido; no se compara como el otro.
  if (sipra.personaEsperada !== null && sipra.personaEsperada !== persona) {
    return cerrar([...relevantes(tipo, 'no_aplica', 'persona_distinta'), ...informativos(datos, 'persona_distinta')], sipra, ahora);
  }
  // Sin datos o con lectura dudosa: nada se decide automáticamente.
  if (!datos || lectura.lecturaDudosa) {
    return cerrar([...relevantes(tipo, 'informacion_insuficiente', datos ? 'lectura_dudosa' : 'sin_datos_leidos'), ...informativos(datos)], sipra, ahora);
  }
  if (!sipra.empresa) {
    return cerrar([...relevantes(tipo, 'informacion_insuficiente', 'sipra_sin_empresa'), ...informativos(datos)], sipra, ahora);
  }
  const e = sipra.empresa;
  const nombre = persona === TipoPersona.NATURAL ? nombreComerciante(datos, e.razonSocial) : razonSocial(datos, e.razonSocial);
  return cerrar([
    ...nitYDv(datos, e.nitNumero, e.nitDv, persona), nombre, representante(tipo, datos, e.representanteLegal),
    estadoRegistral(datos), ...informativos(datos),
  ], sipra, ahora);
}

/**
 * NIT y DV. Solo con un DV que valida (o sin DV: el número se compara igual y el DV queda sin determinar). Un DV que no
 * corresponde al número NO es lectura confiable: jamás se cuenta como «diferente» ni se corrige el NIT. En la persona natural el
 * DV solo es crítico «si existe y aplica»: sin DV (en el certificado o en SIPRA) queda sin determinar y no bloquea el veredicto.
 */
function nitYDv(d: DatosCamaraExtraidos, nitSipra: string | null, dvSipra: number | null, persona: TipoPersona): CampoComparacionCamara[] {
  const control = controlarNitLeido(d.nit, d.dv);
  if (control.estado !== 'confiable' && control.estado !== 'dv_ausente') {
    const nota = `nit_no_confiable_${control.estado}`;
    return [campo('nit', 'informacion_insuficiente', 'critico', nota), campo('dv', 'informacion_insuficiente', 'critico', nota)];
  }
  const numeroSipra = (nitSipra ?? '').replace(/\D/g, '');
  const nit = numeroSipra
    ? campo('nit', numeroSipra === (d.nit ?? '').replace(/\D/g, '') ? 'coincide' : 'diferente', 'critico')
    : campo('nit', 'informacion_insuficiente', 'critico', 'sipra_sin_nit');
  const criticidadSinDv: CriticidadCampoCamara = persona === TipoPersona.NATURAL ? 'informativo' : 'critico';
  const dv = control.estado === 'dv_ausente' ? campo('dv', 'informacion_insuficiente', criticidadSinDv, 'dv_ausente_en_certificado')
    : dvSipra === null ? campo('dv', 'informacion_insuficiente', criticidadSinDv, 'sipra_sin_dv')
      : campo('dv', dvSipra === Number(d.dv) ? 'coincide' : 'diferente', 'critico');
  return [nit, dv];
}

/** Razón social: conservadora. Solo la identidad de tokens (sin forma jurídica) coincide; más corto o más largo NO es la misma empresa. */
function razonSocial(d: DatosCamaraExtraidos, esperada: string | null): CampoComparacionCamara {
  const a = sinFormaJuridica(esperada); const b = sinFormaJuridica(d.nombreORazonSocial);
  if (!a || !b) return campo('razon_social', 'informacion_insuficiente', 'critico', !b ? 'dato_ausente_en_certificado' : 'sipra_sin_razon_social');
  return compararNombres(a, b) === 'igual' ? campo('razon_social', 'coincide', 'critico') : campo('razon_social', 'diferente', 'critico');
}

/** Nombre del comerciante: tokens normalizados en cualquier orden; «compatible» (falta un apellido) se acepta como coincidencia parcial. */
function nombreComerciante(d: DatosCamaraExtraidos, esperado: string | null): CampoComparacionCamara {
  const r = compararNombres(esperado, d.nombreORazonSocial);
  if (r === 'insuficiente') return campo('nombre', 'informacion_insuficiente', 'critico', !d.nombreORazonSocial ? 'dato_ausente_en_certificado' : 'sipra_sin_nombre');
  if (r === 'diferente') return campo('nombre', 'diferente', 'critico');
  return campo('nombre', 'coincide', 'critico', r === 'compatible' ? 'nombre_parcial' : undefined);
}

/**
 * Representante legal. Existencia y representación: IMPORTANTE. Matrícula de sociedad: informativo y opcional. Persona natural:
 * no aplica. Si falta una parte del nombre es `informacion_insuficiente` antes que una coincidencia dudosa.
 */
function representante(tipo: C, d: DatosCamaraExtraidos, esperado: string | null): CampoComparacionCamara {
  if (tipo === C.CAMARA_MATRICULA_PERSONA_NATURAL) return campo('representante_legal', 'no_aplica', 'informativo', 'persona_natural');
  const criticidad: CriticidadCampoCamara = tipo === C.CAMARA_EXISTENCIA_REPRESENTACION ? 'importante' : 'informativo';
  const leido = d.representanteLegal;
  if (!leido && !esperado) {
    return tipo === C.CAMARA_EXISTENCIA_REPRESENTACION
      ? campo('representante_legal', 'informacion_insuficiente', criticidad, 'representante_ausente_en_ambos')
      : campo('representante_legal', 'no_aplica', criticidad, 'opcional_en_matricula');
  }
  if (!leido) {
    return tipo === C.CAMARA_EXISTENCIA_REPRESENTACION
      ? campo('representante_legal', 'informacion_insuficiente', criticidad, 'representante_no_leido_en_certificado')
      : campo('representante_legal', 'no_aplica', criticidad, 'opcional_en_matricula');
  }
  if (!esperado) return campo('representante_legal', 'informacion_insuficiente', criticidad, 'sipra_sin_representante');
  const r = compararNombres(esperado, leido);
  if (r === 'igual') return campo('representante_legal', 'coincide', criticidad);
  if (r === 'compatible') return campo('representante_legal', 'informacion_insuficiente', criticidad, 'nombre_parcial');
  return r === 'diferente' ? campo('representante_legal', 'diferente', criticidad) : campo('representante_legal', 'informacion_insuficiente', criticidad, 'dato_ausente');
}

/** Solo un estado «cancelado» que el documento declara EXPLÍCITAMENTE es una señal crítica; «activo» no aprueba el documento. */
function estadoRegistral(d: DatosCamaraExtraidos): CampoComparacionCamara {
  switch (d.estadoRegistral) {
    case EstadoRegistral.CANCELADO: return campo('estado_registral', 'diferente', 'critico', 'estado_registral_cancelado');
    case EstadoRegistral.ACTIVO: return campo('estado_registral', 'informativo', 'informativo', 'activo_no_aprueba_el_documento');
    case EstadoRegistral.OTRO: return campo('estado_registral', 'informativo', 'informativo', 'estado_distinto_de_activo_y_cancelado');
    default: return campo('estado_registral', 'informacion_insuficiente', 'informativo', 'estado_no_determinable');
  }
}

/** Dato presente → `informativo`; ausente → `informacion_insuficiente`. Ninguno tiene contraparte canónica ni genera discrepancia. */
function informativo(c: CampoCamara, presente: boolean, nota: string): CampoComparacionCamara {
  return presente ? campo(c, 'informativo', 'informativo', nota) : campo(c, 'informacion_insuficiente', 'informativo', 'dato_no_leido');
}

function informativos(d: DatosCamaraExtraidos | null, causa?: string): CampoComparacionCamara[] {
  if (!d) return INFORMATIVOS.map((c) => campo(c, 'informacion_insuficiente', 'informativo', 'sin_datos_leidos'));
  const sinContraparte = causa ?? 'sin_contraparte_en_sipra';
  return [
    informativo('matricula', !!d.matricula, sinContraparte),
    informativo('camara', !!d.camara, sinContraparte),
    informativo('fecha_matricula', !!d.fechaMatricula, sinContraparte),
    informativo('ultimo_anio_renovado', d.ultimoAnioRenovado !== null, 'no_deduce_vigencia'),
    informativo('fecha_renovacion', !!d.fechaRenovacion, 'no_deduce_vigencia'),
    informativo('domicilio', !!d.domicilioMunicipio, sinContraparte),
    informativo('ciiu', !!d.ciiu, 'catalogo_incompleto'),
    informativo('fecha_expedicion', !!d.fechaExpedicion, 'sin_politica_de_antiguedad'),
    informativo('codigo_verificacion', !!d.codigoVerificacion, 'no_es_criterio_de_coincidencia'),
    d.firmaPdfPresente === null || d.firmaPdfPresente === undefined
      ? campo('firma_pdf', 'no_aplica', 'informativo', 'sin_estructura_pdf')
      : campo('firma_pdf', 'informativo', 'informativo', d.firmaPdfPresente ? 'presente_no_es_criterio' : 'ausente_no_es_criterio'),
    informativo('ventana_verificacion', !!d.verificacionDisponibleHasta, 'declarada_por_el_certificado'),
  ];
}
