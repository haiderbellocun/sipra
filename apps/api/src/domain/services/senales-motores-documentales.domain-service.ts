import { RecomendacionEps } from '../entities/adres';
import { EstadoDocumento } from '../entities/documento.entity';
import { EstadoValidacionDocumentoEmpresarial as EstadoEmp } from '../entities/documento-empresarial';
import { DatosValidacionActa, EstadoValidacionActa } from '../entities/validacion-acta.entity';
import { DatosValidacionDocumentoEmpresarial } from '../entities/validacion-documento-empresarial.entity';
import { DatosValidacionEps, DecisionEps, EstadoProcesamientoEps } from '../entities/validacion-eps.entity';
import { FaseDocumento, SENAL_NORMAL, SenalDocumento } from './expediente-documental.domain-service';
import { RecomendacionActa, recomendacionActa } from './mesa-acta.domain-service';
import { RecomendacionCamara, recomendacionCamara, resumenHumanoCamara } from './mesa-camara.domain-service';
import { recomendacionActual, tieneDiscrepanciaCriticaPersistida } from './mesa-eps.domain-service';
import { RecomendacionRut, recomendacionRut } from './mesa-rut.domain-service';

/**
 * ADAPTADORES de cada motor hacia la presentación común de la Mesa Documental. No contienen reglas de negocio: llaman a la
 * recomendación DEL PROPIO MOTOR (la misma que muestra su Mesa) y la traducen a una fase y a una señal normalizadas. Si un motor
 * cambia sus reglas, estos adaptadores no se tocan; solo si cambia su vocabulario.
 */

// ── Fase (estado interno → fase normalizada) ────────────────────────────────

/** Sin validación del motor todavía: el documento existe pero se está procesando (o devuelto/rechazado antes de que hubiera motor). */
function faseDelDocumento(estado: EstadoDocumento): FaseDocumento {
  switch (estado) {
    case EstadoDocumento.APROBADO:
    case EstadoDocumento.AUTO_APROBADO: return 'aprobado';
    case EstadoDocumento.DEVUELTO:
    case EstadoDocumento.ILEGIBLE: return 'devuelto';
    case EstadoDocumento.RECHAZADO: return 'rechazado';
    case EstadoDocumento.EN_REVISION: return 'listo_para_revisar';
    case EstadoDocumento.RECIBIDO:
    case EstadoDocumento.ANALIZANDO: return 'procesando';
  }
}

/** Documento general (sin motor): su estado ES el del documento. */
export function faseGeneral(estado: EstadoDocumento): FaseDocumento {
  return faseDelDocumento(estado);
}

/** Un documento ilegible vuelve al estudiante aunque el motor no haya llegado a registrar una decisión. */
const vuelveAlEstudiante = (estado: EstadoDocumento): boolean => estado === EstadoDocumento.ILEGIBLE || estado === EstadoDocumento.DEVUELTO;

export function faseEps(estadoDocumento: EstadoDocumento, v: DatosValidacionEps | null): FaseDocumento {
  if (vuelveAlEstudiante(estadoDocumento) && (!v || v.decision !== DecisionEps.DEVUELTO)) return 'devuelto';
  if (!v) return estadoDocumento === EstadoDocumento.APROBADO ? 'aprobado' : 'procesando';
  switch (v.decision) {
    case DecisionEps.APROBADO_MANUAL:
    case DecisionEps.APROBADO_AUTOMATICO: return 'aprobado';
    case DecisionEps.DEVUELTO: return 'devuelto';
    case DecisionEps.RECHAZADO: return 'rechazado';
    default: break;
  }
  if (v.estadoProcesamiento === EstadoProcesamientoEps.ERROR) return 'error';
  return v.estadoProcesamiento === EstadoProcesamientoEps.PROCESADO ? 'listo_para_revisar' : 'procesando';
}

export function faseActa(estadoDocumento: EstadoDocumento, v: DatosValidacionActa | null): FaseDocumento {
  if (vuelveAlEstudiante(estadoDocumento) && (!v || v.estado !== EstadoValidacionActa.DEVUELTO)) return 'devuelto';
  if (!v) return 'procesando';
  switch (v.estado) {
    case EstadoValidacionActa.APROBADO_MANUAL: return 'aprobado';
    case EstadoValidacionActa.DEVUELTO: return 'devuelto';
    case EstadoValidacionActa.RECHAZADO: return 'rechazado';
    case EstadoValidacionActa.ERROR: return 'error';
    case EstadoValidacionActa.REVISION: return 'listo_para_revisar';
    default: return 'procesando';
  }
}

/** RUT y Cámara comparten la validación genérica de documentos empresariales. */
export function faseEmpresarial(estadoDocumento: EstadoDocumento, v: DatosValidacionDocumentoEmpresarial | null): FaseDocumento {
  if (vuelveAlEstudiante(estadoDocumento) && (!v || v.estado !== EstadoEmp.DEVUELTO)) return 'devuelto';
  if (!v) return 'procesando';
  switch (v.estado) {
    case EstadoEmp.APROBADO_MANUAL: return 'aprobado';
    case EstadoEmp.DEVUELTO: return 'devuelto';
    case EstadoEmp.RECHAZADO: return 'rechazado';
    case EstadoEmp.ERROR: return 'error';
    case EstadoEmp.REVISION: return 'listo_para_revisar';
    default: return 'procesando';
  }
}

// ── Señales (recomendación del motor → criticidad / insuficiente / problema) ─

const senal = (criticidad: SenalDocumento['criticidad'], problemaPrincipal: string | null, informacionInsuficiente = false): SenalDocumento =>
  ({ criticidad, informacionInsuficiente, problemaPrincipal });

export function senalRut(v: DatosValidacionDocumentoEmpresarial): SenalDocumento {
  const c = v.comparacion as { veredicto?: string; hayDiscrepancia: boolean } | null;
  const r = recomendacionRut({
    tipoDetectado: v.tipoDetectado, expectativa: v.expectativa, lecturaDudosa: v.lecturaDudosa,
    comparacion: c ? { veredicto: c.veredicto, hayDiscrepancia: c.hayDiscrepancia } : null,
  });
  switch (r) {
    case RecomendacionRut.CONSISTENTE: return SENAL_NORMAL;
    case RecomendacionRut.DISCREPANCIA_CRITICA: return senal('critico', 'Un dato clave del RUT no coincide con SIPRA');
    case RecomendacionRut.DOCUMENTO_INCORRECTO: return senal('critico', 'El archivo parece no ser un RUT');
    case RecomendacionRut.PERSONA_DISTINTA: return senal('critico', 'El RUT es de una persona natural o jurídica distinta de la esperada');
    case RecomendacionRut.LECTURA_DUDOSA: return senal('atencion', 'La lectura es poco segura: revise contra el documento', true);
    case RecomendacionRut.NO_DETERMINABLE: return senal('atencion', 'No se pudo determinar qué documento es o qué dice', true);
    case RecomendacionRut.INFORMACION_INSUFICIENTE: return senal('atencion', 'Faltan datos para comparar con SIPRA', true);
  }
}

export function senalCamara(v: DatosValidacionDocumentoEmpresarial): SenalDocumento {
  const c = v.comparacion as { veredicto?: string; hayDiscrepancia: boolean; discrepanciaImportante?: boolean; senales?: string[] } | null;
  const r = recomendacionCamara({
    tipoDetectado: v.tipoDetectado, expectativa: v.expectativa, lecturaDudosa: v.lecturaDudosa,
    comparacion: c ? { veredicto: c.veredicto, hayDiscrepancia: c.hayDiscrepancia, discrepanciaImportante: c.discrepanciaImportante ?? false, senales: c.senales ?? [] } : null,
  });
  // El texto lo da el propio motor (su resumen humano); aquí solo se decide cuánto pesa en el expediente.
  const problema = resumenHumanoCamara(r).problemaPrincipal;
  switch (r) {
    case RecomendacionCamara.CONSISTENTE: return SENAL_NORMAL;
    case RecomendacionCamara.DISCREPANCIA_CRITICA:
    case RecomendacionCamara.MATRICULA_CANCELADA:
    case RecomendacionCamara.DOCUMENTO_INCORRECTO:
    case RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE:
    case RecomendacionCamara.PERSONA_DISTINTA: return senal('critico', problema);
    case RecomendacionCamara.REPRESENTANTE_DIFERENTE: return senal('atencion', problema);
    case RecomendacionCamara.LECTURA_DUDOSA:
    case RecomendacionCamara.NO_DETERMINABLE:
    case RecomendacionCamara.INFORMACION_INSUFICIENTE: return senal('atencion', problema, true);
  }
}

export function senalActa(v: DatosValidacionActa): SenalDocumento {
  const r = recomendacionActa(v);
  const dudosa = v.datosExtraidos?.lecturaDudosa === true;
  switch (r) {
    case RecomendacionActa.CONSISTENTE: return dudosa ? senal('atencion', 'La lectura es poco segura: revise contra el documento', true) : SENAL_NORMAL;
    case RecomendacionActa.DISCREPANCIA_CRITICA: return senal('critico', 'Un dato clave del acta no coincide con SIPRA');
    case RecomendacionActa.DOCUMENTO_INCORRECTO: return senal('critico', 'El archivo parece no ser un acta de iniciación');
    case RecomendacionActa.FIRMA_FALTANTE: return senal('critico', 'Falta la firma de la empresa o del practicante');
    case RecomendacionActa.NO_DETERMINABLE: return senal('atencion', 'No se pudo determinar qué documento es o qué dice', true);
    case RecomendacionActa.REVISAR: return senal('atencion', dudosa ? 'La lectura es poco segura: revise contra el documento' : 'Hay diferencias o datos sin poder comparar', true);
  }
}

/**
 * EPS: la Mesa de EPS recalcula la recomendación con la comparación triple (SIPRA, certificado y ADRES). Aquí se usa la misma
 * función del motor con la discrepancia crítica que él mismo PERSISTE, sin recalcular nada: el detalle del motor muestra lo vivo.
 */
export function senalEps(v: DatosValidacionEps): SenalDocumento {
  const r = recomendacionActual(v, tieneDiscrepanciaCriticaPersistida(v));
  switch (r) {
    case RecomendacionEps.CANDIDATO_AUTOAPROBACION: return SENAL_NORMAL;
    case RecomendacionEps.DISCREPANCIA_CRITICA: return senal('critico', 'Los datos del certificado no coinciden con SIPRA o con ADRES');
    case RecomendacionEps.DOCUMENTO_INCORRECTO: return senal('critico', 'El archivo parece no ser un certificado de afiliación a EPS');
    case RecomendacionEps.REVISION_RECHAZO: return senal('critico', 'La afiliación o el certificado no son válidos: revise');
    case RecomendacionEps.CERTIFICADO_VENCIDO: return senal('atencion', 'El certificado supera la vigencia institucional');
    case RecomendacionEps.INFORMACION_INSUFICIENTE: return senal('atencion', 'Faltan datos clave del certificado', true);
    case RecomendacionEps.PENDIENTE_ADRES: return senal('atencion', 'Falta contrastar la afiliación en ADRES');
    case RecomendacionEps.REVISION_DOCUMENTAL: return senal('atencion', 'Revise el documento: su autenticidad no está verificada');
    default: return senal('atencion', null);
  }
}
