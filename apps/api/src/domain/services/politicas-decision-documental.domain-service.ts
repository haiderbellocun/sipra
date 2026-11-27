import { ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad } from '../entities/documento-empresarial';
import { TipoDocumento } from '../entities/documento.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DiscrepanciaEps, EstadoProcesamientoEps, VigenciaCertificado,
} from '../entities/validacion-eps.entity';
import { AnalisisCertificadoArl } from './clasificacion-documental-arl.domain-service';
import {
  DecisionAutomaticaDocumento, FuenteDato, MotivoDecision, aprobar, devolver, fuenteSostieneAprobacion, fuenteSostieneDevolucion,
  revision,
} from './decision-automatica-documental.domain-service';
import { RecomendacionCamara, recomendacionCamara } from './mesa-camara.domain-service';
import { RecomendacionRut, recomendacionRut } from './mesa-rut.domain-service';

/**
 * Políticas de decisión por tipo (subfase 1.6A, dominio puro). Cada una recibe HECHOS ya calculados por su motor
 * especializado (no los recalcula ni los sustituye) y PROPONE una decisión; `consolidarDecision` aplica después las guardas
 * comunes (IA nunca sostiene una devolución; interruptores). Ver DOCUMENTO-TECNICO §7.36.
 */

// ═══════════════════════════════ EPS ═══════════════════════════════════════

/** Campos de la comparación EPS. La procedencia viene de la extracción (incluida `rescateIa.fuentesFinales`). */
export type CampoCriticoEps = 'numero_documento' | 'nombre' | 'fecha_expedicion' | 'eps' | 'estado_reportado';

export interface HechosEps {
  /** Clasificación LOCAL por contenido. */
  clasificacion: 'certificado_eps_probable' | 'documento_incorrecto' | 'no_determinable' | null;
  subtipoIncorrecto: string | null;
  estadoProcesamiento: EstadoProcesamientoEps;
  autenticidad: AutenticidadEps;
  coincidencia: CoincidenciaEps;
  discrepancias: Pick<DiscrepanciaEps, 'campo' | 'comparacion'>[];
  afiliacion: AfiliacionEps;
  afiliacionFuente: 'verificador_oficial' | 'adres_bdua' | null;
  vigencia: VigenciaCertificado;
  hayBanderaCritica: boolean;
  procedencia: Partial<Record<CampoCriticoEps, FuenteDato>>;
}

const P = 'eps' as const;

/**
 * EPS. Base: la regla de candidatura existente (`evaluarCandidatoAutoaprobacion`: procesado, autenticidad, coincidencia,
 * afiliación activa, vigencia, sin críticas), con DOS rutas de confirmación oficial de la afiliación:
 *  · QR/verificador oficial: autenticidad verificada + afiliación activa por el verificador (no exige ADRES);
 *  · ADRES (asistido): afiliación ACTIVA contrastada en ADRES/BDUA.
 * OpenAI nunca confirma afiliación ni autenticidad.
 */
export function decidirEps(h: HechosEps): DecisionAutomaticaDocumento {
  const fuentesCriticas: Record<string, FuenteDato> = {};
  for (const [campo, fuente] of Object.entries(h.procedencia)) if (fuente) fuentesCriticas[campo] = fuente;
  const verificacionOficial = h.autenticidad === AutenticidadEps.VERIFICADA || h.afiliacionFuente !== null;
  const extra = { fuentesCriticas, verificacionOficial };
  const fuente = (c: CampoCriticoEps): FuenteDato | undefined => h.procedencia[c];

  // 1. Documento de otro tipo (clasificador local, ANTES de cualquier lectura externa).
  if (h.clasificacion === 'documento_incorrecto') {
    return devolver(P, TipoDocumento.CERTIFICADO_EPS, 'documento_incorrecto',
      ['tipo_documento_incorrecto', ...(h.subtipoIncorrecto ? [`subtipo_${h.subtipoIncorrecto}` as MotivoDecision] : [])],
      { verificacionOficial, fuentesCriticas: { clasificacion: 'local' } });
  }
  if (h.clasificacion !== 'certificado_eps_probable') return revision(P, ['clasificacion_no_determinable'], extra);
  if (h.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO) return revision(P, ['procesamiento_incompleto'], extra);
  if (h.autenticidad === AutenticidadEps.INVALIDA) return revision(P, ['autenticidad_invalida'], extra);

  // 2. Incumplimientos objetivos (solo con fuente que sostiene una devolución; si no, revisión).
  if (h.afiliacion === AfiliacionEps.INACTIVA && h.afiliacionFuente !== null) {
    return devolver(P, TipoDocumento.CERTIFICADO_EPS, 'incumplimiento', ['afiliacion_inactiva'],
      { verificacionOficial, fuentesCriticas: { afiliacion: 'oficial' } });
  }
  if (h.vigencia === 'vencido') {
    const f = fuente('fecha_expedicion');
    if (fuenteSostieneDevolucion(f)) {
      return devolver(P, TipoDocumento.CERTIFICADO_EPS, 'incumplimiento', ['certificado_vencido'],
        { verificacionOficial, fuentesCriticas: { fecha_expedicion: f as FuenteDato } });
    }
    return revision(P, ['certificado_vencido', f === 'ocr' ? 'lectura_ocr_no_concluyente' : 'fuente_ia_no_corroborada'], extra);
  }
  if (h.coincidencia === CoincidenciaEps.DISCREPANCIA) {
    const documento = h.discrepancias.find((d) => d.campo === 'numero_documento');
    if (documento) {
      // El documento OFICIAL (verificador/ADRES) o el certificado leído de forma inequívoca es de otra persona.
      const deOficial = documento.comparacion === 'oficial_vs_interno';
      const f = deOficial ? 'oficial' : fuente('numero_documento');
      if (fuenteSostieneDevolucion(f)) {
        return devolver(P, TipoDocumento.CERTIFICADO_EPS, 'incumplimiento', ['documento_otra_persona'],
          { verificacionOficial, fuentesCriticas: { numero_documento: f as FuenteDato } });
      }
      return revision(P, ['discrepancia_critica', f === 'ocr' ? 'lectura_ocr_no_concluyente' : 'fuente_ia_no_corroborada'], extra);
    }
    // Un nombre distinto no es inequívoco (abreviaturas, apellidos, IA): siempre lo mira una persona.
    const soloIa = h.discrepancias.some((d) => fuente(campoEpsDe(d.campo)) === 'ia_rescate');
    return revision(P, ['discrepancia_nombre', ...(soloIa ? ['fuente_ia_no_corroborada' as const] : [])], extra);
  }
  if (h.hayBanderaCritica) return revision(P, ['bandera_critica'], extra);

  // 3. Aprobación: todo a la vez.
  if (h.coincidencia !== CoincidenciaEps.COINCIDE) return revision(P, ['identidad_no_corroborada'], extra);
  if (h.vigencia !== 'vigente') return revision(P, ['vigencia_no_determinada'], extra);
  // La fecha que define la vigencia nunca puede venir solo de la IA: una fecha inventada haría «vigente» lo vencido.
  if (!fuenteSostieneAprobacion(fuente('fecha_expedicion'))) return revision(P, ['vigencia_no_determinada', 'fuente_ia_no_corroborada'], extra);
  const rutaQr = h.autenticidad === AutenticidadEps.VERIFICADA && h.afiliacion === AfiliacionEps.ACTIVA && h.afiliacionFuente === 'verificador_oficial';
  const rutaAdres = h.afiliacion === AfiliacionEps.ACTIVA && h.afiliacionFuente === 'adres_bdua';
  if (!rutaQr && !rutaAdres) return revision(P, ['afiliacion_no_confirmada'], extra);
  // Identidad leída por IA: solo vale si una fuente OFICIAL contrastó a la misma persona (QR/ADRES confirmaron por el documento de SIPRA).
  const identidadIa = (['numero_documento', 'nombre'] as const).some((c) => !fuenteSostieneAprobacion(fuente(c)));
  if (identidadIa && h.afiliacionFuente === null) return revision(P, ['identidad_no_corroborada', 'fuente_ia_no_corroborada'], extra);
  return aprobar(P, [rutaQr ? 'ruta_qr_oficial' : 'ruta_adres', 'identidad_coincide', 'certificado_vigente', 'afiliacion_activa'], extra);
}

function campoEpsDe(campo: DiscrepanciaEps['campo']): CampoCriticoEps {
  return campo === 'regimen' ? 'eps' : campo;
}

/** Campo de la comparación EPS → campo de la extracción (para leer su procedencia). */
export const CAMPO_EXTRACCION_EPS: Readonly<Record<CampoCriticoEps, string>> = {
  numero_documento: 'documento_afiliado',
  nombre: 'nombre_afiliado',
  fecha_expedicion: 'fecha_expedicion',
  eps: 'entidad_emisora',
  estado_reportado: 'estado_afiliacion',
};

// ═══════════════════════════════ RUT ═══════════════════════════════════════

export interface HechosDocumentoEmpresarial {
  /** La validación del motor terminó (`revision`); `pendiente`/`procesando`/`error` no se deciden. */
  procesada: boolean;
  tipoDetectado: C | null;
  expectativa: string | null;
  lecturaDudosa: boolean;
  metodoLectura: 'texto' | 'ocr' | 'hibrido' | null;
  comparacion: { veredicto?: string; hayDiscrepancia: boolean; discrepanciaImportante?: boolean; senales?: string[] } | null;
  controlNit: string | null;
  autenticidad: EstadoAutenticidad;
  hayBanderaCritica: boolean;
}

/** La lectura empresarial es LOCAL: texto nativo, OCR o ambos. Nunca IA. */
function fuenteEmpresarial(m: HechosDocumentoEmpresarial['metodoLectura']): FuenteDato {
  return m === 'texto' ? 'texto_nativo' : m === 'ocr' ? 'ocr' : 'local';
}

/**
 * RUT natural y jurídico. Base: `recomendacionRut` (la misma de la Mesa). NO impone «año en curso»: esa regla vive solo en el
 * flujo ARL/CUNbre que ya la exige. Autoaprobar: RUT de la variante esperada, comparación consistente, NIT y DV confiables.
 */
export function decidirRut(tipo: TipoDocumento.RUT_NATURAL | TipoDocumento.RUT_JURIDICO, h: HechosDocumentoEmpresarial): DecisionAutomaticaDocumento {
  const f = fuenteEmpresarial(h.metodoLectura);
  const extra = { fuentesCriticas: { clasificacion: f, nit: f } as Record<string, FuenteDato>, verificacionOficial: false };
  if (!h.procesada) return revision('rut', ['procesamiento_incompleto'], extra);
  const r = recomendacionRut(h);
  switch (r) {
    case RecomendacionRut.DOCUMENTO_INCORRECTO:
      return devolver('rut', tipo, 'documento_incorrecto',
        ['tipo_documento_incorrecto', ...(h.tipoDetectado?.startsWith('camara_') ? ['subtipo_camara_comercio' as const] : [])],
        { ...extra, fuentesCriticas: { clasificacion: f } });
    case RecomendacionRut.NO_DETERMINABLE: return revision('rut', ['clasificacion_no_determinable'], extra);
    case RecomendacionRut.PERSONA_DISTINTA:
      return h.lecturaDudosa
        ? revision('rut', ['lectura_dudosa'], extra)
        : devolver('rut', tipo, 'documento_incorrecto', ['variante_persona_incompatible'], { ...extra, fuentesCriticas: { clasificacion: f } });
    default: break;
  }
  // NIT/DV objetivamente inválido: solo con texto nativo y lectura segura (un OCR puede leer mal un dígito).
  if ((h.controlNit === 'dv_no_coincide' || h.controlNit === 'nit_invalido') && h.metodoLectura === 'texto' && !h.lecturaDudosa) {
    return devolver('rut', tipo, 'incumplimiento', ['nit_invalido'], { ...extra, fuentesCriticas: { nit: 'texto_nativo' } });
  }
  if (r === RecomendacionRut.DISCREPANCIA_CRITICA) return revision('rut', ['discrepancia_critica'], extra);
  if (r === RecomendacionRut.LECTURA_DUDOSA) return revision('rut', ['lectura_dudosa'], extra);
  if (r !== RecomendacionRut.CONSISTENTE) return revision('rut', ['datos_insuficientes'], extra);
  if (h.controlNit !== 'confiable') return revision('rut', ['datos_insuficientes'], extra);
  if (h.autenticidad === EstadoAutenticidad.INVALIDA) return revision('rut', ['autenticidad_invalida'], extra);
  if (h.hayBanderaCritica) return revision('rut', ['bandera_critica'], extra);
  return aprobar('rut', ['consistente', 'nit_dv_valido', 'sin_verificacion_oficial'], extra);
}

// ═══════════════════════════════ CÁMARA ════════════════════════════════════

/**
 * Cámara de Comercio. Base: `recomendacionCamara`. Sin integración RUES: una aprobación significa «documentalmente
 * consistente según los controles disponibles» y lo dice (`sin_verificacion_rues`, `verificacionOficial: false`). No hay
 * política de antigüedad del certificado en el proceso actual: no se inventa una.
 */
export function decidirCamara(h: HechosDocumentoEmpresarial): DecisionAutomaticaDocumento {
  const f = fuenteEmpresarial(h.metodoLectura);
  const extra = { fuentesCriticas: { clasificacion: f, nit: f, razon_social: f } as Record<string, FuenteDato>, verificacionOficial: false };
  if (!h.procesada) return revision('camara', ['procesamiento_incompleto'], extra);
  const r = recomendacionCamara(h);
  switch (r) {
    case RecomendacionCamara.DOCUMENTO_INCORRECTO:
      return devolver('camara', TipoDocumento.CAMARA_COMERCIO, 'documento_incorrecto', ['tipo_documento_incorrecto'],
        { ...extra, fuentesCriticas: { clasificacion: f } });
    case RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE:
      return devolver('camara', TipoDocumento.CAMARA_COMERCIO, 'documento_incorrecto', ['tipo_documento_incorrecto', 'subtipo_rut'],
        { ...extra, fuentesCriticas: { clasificacion: f } });
    case RecomendacionCamara.PERSONA_DISTINTA:
      return h.lecturaDudosa
        ? revision('camara', ['lectura_dudosa'], extra)
        : devolver('camara', TipoDocumento.CAMARA_COMERCIO, 'documento_incorrecto', ['variante_persona_incompatible'],
          { ...extra, fuentesCriticas: { clasificacion: f } });
    case RecomendacionCamara.NO_DETERMINABLE: return revision('camara', ['clasificacion_no_determinable'], extra);
    case RecomendacionCamara.MATRICULA_CANCELADA: return revision('camara', ['matricula_cancelada'], extra);
    case RecomendacionCamara.DISCREPANCIA_CRITICA: return revision('camara', ['discrepancia_critica'], extra);
    case RecomendacionCamara.REPRESENTANTE_DIFERENTE: return revision('camara', ['representante_diferente'], extra);
    case RecomendacionCamara.LECTURA_DUDOSA: return revision('camara', ['lectura_dudosa'], extra);
    case RecomendacionCamara.INFORMACION_INSUFICIENTE: return revision('camara', ['datos_insuficientes'], extra);
    case RecomendacionCamara.CONSISTENTE: break;
  }
  if (h.autenticidad === EstadoAutenticidad.INVALIDA) return revision('camara', ['autenticidad_invalida'], extra);
  if (h.hayBanderaCritica) return revision('camara', ['bandera_critica'], extra);
  return aprobar('camara', ['consistente', 'sin_verificacion_rues'], extra);
}

// ═══════════════════════════════ ARL ═══════════════════════════════════════

export interface HechosArl {
  /** null = no hubo texto local que analizar (imagen o PDF escaneado): revisión. */
  analisis: AnalisisCertificadoArl | null;
  fechaInicioPractica: string | null;
  /** ¿SIPRA conoce el NIT de la empresa? Si no, la coherencia de empresa no aplica. */
  empresaConocida: boolean;
  hayBanderaCritica: boolean;
}

/**
 * Certificado de ARL. Sin fuente oficial: una aprobación es «documentalmente consistente», y todos los datos críticos se
 * corroboran contra el TEXTO LOCAL (el documento del estudiante y el NIT de la empresa deben aparecer en el certificado; la
 * fecha de afiliación se lee localmente junto a su etiqueta y no puede ser posterior al inicio de la práctica).
 */
export function decidirArl(h: HechosArl): DecisionAutomaticaDocumento {
  const extra = { fuentesCriticas: { clasificacion: 'texto_nativo' } as Record<string, FuenteDato>, verificacionOficial: false };
  const a = h.analisis;
  if (!a) return revision('arl', ['clasificacion_no_determinable'], extra);
  if (a.clasificacion.tipo === 'documento_incorrecto') {
    return devolver('arl', TipoDocumento.CERTIFICADO_ARL, 'documento_incorrecto',
      ['tipo_documento_incorrecto', ...(a.clasificacion.subtipoIncorrecto ? [`subtipo_${a.clasificacion.subtipoIncorrecto}` as MotivoDecision] : [])],
      extra);
  }
  if (a.clasificacion.tipo !== 'certificado_arl_probable') return revision('arl', ['clasificacion_no_determinable'], extra);
  if (h.hayBanderaCritica) return revision('arl', ['bandera_critica'], extra);
  const criticas: Record<string, FuenteDato> = { clasificacion: 'texto_nativo', documento: 'texto_nativo', arl: 'texto_nativo', fecha_afiliacion: 'texto_nativo' };
  if (a.documentoEncontrado !== true) return revision('arl', ['identidad_no_corroborada'], extra);
  if (h.empresaConocida && a.nitEncontrado !== true) return revision('arl', ['empresa_no_corroborada'], extra);
  if (!a.arlReconocida) return revision('arl', ['arl_no_reconocida'], extra);
  if (!a.fechaAfiliacion || !h.fechaInicioPractica) return revision('arl', ['vigencia_no_determinada'], extra);
  if (a.fechaAfiliacion > h.fechaInicioPractica) return revision('arl', ['fecha_afiliacion_incompatible'], extra);
  if (h.empresaConocida) criticas.nit_empresa = 'texto_nativo';
  return aprobar('arl', [
    'consistente', 'identidad_coincide', ...(h.empresaConocida ? ['empresa_coincide' as const] : []), 'arl_reconocida',
    'fecha_afiliacion_compatible', 'sin_verificacion_oficial',
  ], { fuentesCriticas: criticas, verificacionOficial: false });
}
