import { CampoComparadoCamara, DetalleCamara, ItemBandejaCamara, MotivoDevolucionCamara } from '@core/models/modelos';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from '../eps/eps.util';
import type { Rotulo } from '../eps/eps.util';

/**
 * Textos y reglas visuales de la Mesa de Cámara de Comercio. Funciones puras: las reglas y la decisión viven en la API; aquí solo se
 * rotulan y se explican las cosas. Ningún estado se comunica solo con color (icono + texto). Al estudiante nunca le llega un nombre
 * interno, un código, la confianza ni lo que el sistema leyó del documento. NUNCA se dice que un certificado es «auténtico» ni «vigente»
 * por su renovación o su fecha, y NUNCA «vencido» por antigüedad (no hay política institucional).
 */

export { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA };
export type { Rotulo };

// ── Resultado principal (lo primero que lee quien revisa) ───────────────────

export interface ResultadoCamara extends Rotulo {
  titulo: string;
  frase: string;
  /** Lo que se señala en la bandeja (sin repetir el título). */
  problema: string | null;
}

export const AVISO_OCR = 'Leído por OCR · revisar contra el documento';
export const AVISO_LECTURA_DUDOSA = 'Lectura poco segura · revisar contra el documento';
export const AVISO_DATOS_SIPRA = 'Los datos de SIPRA cambiaron después de esta validación.';
export const ALERTA_CANCELADA = 'El certificado declara que la matrícula está cancelada.';
export const TEXTO_AUTENTICIDAD = 'Autenticidad: no verificada';

/** Los rótulos coinciden con los que entrega la API (`resumen`); aquí se añade la frase explicativa y el tono visual. */
export const RESULTADO_CAMARA: Record<string, ResultadoCamara> = {
  consistente: {
    titulo: 'Consistente', texto: 'Consistente', icono: '✓', tono: 'ok',
    frase: 'Los datos principales del certificado coinciden con SIPRA.', problema: null,
  },
  discrepancia_critica: {
    titulo: 'Revisión necesaria', texto: 'Revisión necesaria', icono: '!', tono: 'peligro',
    frase: 'Un dato clave (NIT, dígito de verificación, razón social o nombre) no coincide con SIPRA.', problema: 'Un dato clave no coincide con SIPRA',
  },
  representante_diferente: {
    titulo: 'Revisión necesaria', texto: 'Revisión necesaria', icono: '!', tono: 'aviso',
    frase: 'El representante legal del certificado es distinto del registrado en SIPRA. Revíselo antes de decidir.', problema: 'Representante legal distinto',
  },
  matricula_cancelada: {
    titulo: 'Revisión necesaria', texto: 'Revisión necesaria', icono: '!', tono: 'peligro',
    frase: ALERTA_CANCELADA, problema: 'Matrícula declarada como cancelada',
  },
  persona_distinta: {
    titulo: 'Persona distinta', texto: 'Persona distinta', icono: '!', tono: 'aviso',
    frase: 'Es un certificado válido, pero de una persona natural o jurídica distinta de la esperada. No se compara como si fuera la otra.',
    problema: 'Persona distinta a la esperada',
  },
  tipo_certificado_diferente: {
    titulo: 'Tipo de certificado diferente', texto: 'Tipo de certificado diferente', icono: '!', tono: 'peligro',
    frase: 'El documento es de otro tipo (no es un certificado de Cámara de Comercio).', problema: 'Documento de otro tipo',
  },
  documento_incorrecto: {
    titulo: 'Documento no corresponde', texto: 'Documento no corresponde', icono: '!', tono: 'peligro',
    frase: 'El archivo no parece un certificado de la Cámara de Comercio.', problema: 'Parece ser otro documento',
  },
  lectura_dudosa: {
    titulo: 'Revisión necesaria', texto: 'Revisión necesaria', icono: '?', tono: 'aviso',
    frase: 'La lectura es poco segura: compare los datos con el documento antes de decidir.', problema: 'Lectura poco segura · revisar',
  },
  informacion_insuficiente: {
    titulo: 'Información insuficiente', texto: 'Información insuficiente', icono: '?', tono: 'aviso',
    frase: 'Faltan datos, en SIPRA o en el certificado, para compararlos todos.', problema: 'Información insuficiente',
  },
  no_determinable: {
    titulo: 'No determinable', texto: 'No determinable', icono: '?', tono: 'neutra',
    frase: 'No pudimos determinar qué documento es o qué dice. Revíselo directamente.', problema: 'No se pudo leer con certeza',
  },
};

export function resultadoCamara(codigo: string): ResultadoCamara {
  return RESULTADO_CAMARA[codigo] ?? RESULTADO_CAMARA['no_determinable'];
}

/** El problema principal de un caso en la bandeja: una sola línea. `null` = nada que señalar. */
export function problemaPrincipal(f: Pick<ItemBandejaCamara, 'recomendacion' | 'inconsistenciaOperativa' | 'problemaPrincipal'>): { texto: string; icono: string; tono: Rotulo['tono'] } | null {
  if (f.inconsistenciaOperativa) return { texto: 'Requiere revisión administrativa', icono: '!', tono: 'peligro' };
  const r = resultadoCamara(f.recomendacion);
  return r.problema ? { texto: f.problemaPrincipal ?? r.problema, icono: r.icono, tono: r.tono } : null;
}

// ── Tipos de documento y de persona ─────────────────────────────────────────

const TIPO_DETECTADO: Record<string, string> = {
  camara_matricula_persona_natural: 'Matrícula mercantil · persona natural', camara_matricula_sociedad: 'Matrícula mercantil · sociedad',
  camara_existencia_representacion: 'Existencia y representación legal', rut_persona_natural: 'RUT', rut_persona_juridica: 'RUT',
  documento_incorrecto: 'Otro tipo de documento', no_determinable: 'No determinable',
};
export const textoTipoEsperado = (t: string | null): string => (t === 'camara_comercio' || t === null ? 'Certificado de Cámara de Comercio' : t.replace(/_/g, ' '));
export const textoTipoDetectado = (t: string | null): string => (t && TIPO_DETECTADO[t]) || 'No determinable';
export const textoPersona = (p: string | null): string =>
  (p === 'persona_natural' || p === 'natural' ? 'Persona natural' : p === 'persona_juridica' || p === 'juridica' ? 'Persona jurídica' : 'No determinada');
/** El catálogo de la API habla de `natural` / `juridica`; el caso, de `persona_natural` / `persona_juridica`. */
export const personaDeCertificado = (t: string | null): 'natural' | 'juridica' | null => (t === 'persona_natural' ? 'natural' : t === 'persona_juridica' ? 'juridica' : null);

// ── Método de lectura ───────────────────────────────────────────────────────

/** El aviso del servidor cuando la lectura es dudosa (OCR o texto poco seguro); «Texto digital» si no. La confianza técnica nunca se muestra. */
export function textoMetodo(l: { metodo: 'texto' | 'ocr' | null; dudosa: boolean; aviso: string | null }): string | null {
  if (l.aviso) return l.aviso;
  if (l.metodo === 'ocr') return AVISO_OCR;
  if (l.dudosa) return AVISO_LECTURA_DUDOSA;
  return l.metodo === 'texto' ? 'Texto digital' : null;
}

// ── Comparación SIPRA ↔ Cámara ──────────────────────────────────────────────

export interface ResultadoCampoCamara extends Rotulo { critico: boolean }

/**
 * Un campo CRÍTICO que no coincide dice «No coincide · CRÍTICO»; el representante (importante) dice «No coincide» sin la marca crítica;
 * uno que no se pudo comparar NUNCA se muestra como «No coincide» (con lectura dudosa, tampoco).
 */
export function resultadoCampo(c: Pick<CampoComparadoCamara, 'resultado' | 'criticidad'>): ResultadoCampoCamara {
  const critico = c.criticidad === 'critico';
  switch (c.resultado) {
    case 'coincide': return { texto: 'Coincide', icono: '✓', tono: 'ok', critico: false };
    case 'diferente': return { texto: 'No coincide', icono: '✗', tono: critico ? 'peligro' : 'aviso', critico };
    case 'no_aplica': return { texto: 'No aplica', icono: '–', tono: 'neutra', critico: false };
    case 'informativo': return { texto: 'Informativo', icono: 'i', tono: 'info', critico: false };
    default: return { texto: 'Información insuficiente', icono: '?', tono: 'aviso', critico: false };
  }
}

export function descripcionCampo(c: CampoComparadoCamara): string {
  const r = resultadoCampo(c);
  return `${c.etiqueta}: SIPRA ${c.sipra ?? 'sin dato'}, Cámara ${c.camara ?? 'sin dato'}. ${r.texto}${r.critico ? ', crítico' : c.criticidad === 'importante' ? ', importante' : ''}.`;
}

// ── Estado registral, renovación, expedición, verificación ──────────────────

export function textoRenovacion(r: { ultimoAnioRenovado: number | null; fechaRenovacion: string | null }): string {
  const partes = [`Último año renovado: ${r.ultimoAnioRenovado ?? 'sin dato'}`, `Fecha de renovación: ${r.fechaRenovacion ?? 'sin dato'}`];
  return partes.join(' · ');
}

/**
 * La fecha de expedición se muestra como dato. Solo si la API informa que NO cumple una política institucional configurada se avisa;
 * mientras no haya política, jamás «vencido», «no vigente» ni «expirado».
 */
export function textoExpedicion(e: { fecha: string | null; diasDesdeExpedicion: number | null; politicaDias: number | null; cumplePolitica: boolean | null }): { texto: string; aviso: string | null } {
  if (!e.fecha) return { texto: 'Fecha de expedición: sin dato', aviso: null };
  const dias = e.diasDesdeExpedicion !== null ? ` (hace ${e.diasDesdeExpedicion} ${e.diasDesdeExpedicion === 1 ? 'día' : 'días'})` : '';
  return {
    texto: `Fecha de expedición: ${e.fecha}${dias}`,
    aviso: e.cumplePolitica === false && e.politicaDias !== null ? `Supera los ${e.politicaDias} días que define la política institucional.` : null,
  };
}

/** Es la ventana para verificar el código en línea: NO la vigencia del certificado. */
export function textoVentana(hasta: string | null): string | null {
  return hasta ? `Código de verificación disponible hasta ${hasta}` : null;
}

const si = (v: boolean | null, afirmativo: string, negativo: string, desconocido: string): string => (v === true ? afirmativo : v === false ? negativo : desconocido);

/** Solo señales de presencia. La autenticidad NO se verifica: jamás se muestra «auténtico». */
export function textosVerificacion(v: DetalleCamara['verificacion']): string[] {
  return [
    si(v.codigoDetectado, 'Código de verificación detectado', 'Código de verificación no detectado', 'Código de verificación no determinado'),
    si(v.urlDetectada, 'URL oficial detectada', 'URL oficial no detectada', 'URL oficial no determinada'),
    si(v.firmaPdfPresente, 'Firma PDF presente', 'Firma PDF no presente', 'Firma PDF no determinada'),
  ];
}

// ── Reserva ─────────────────────────────────────────────────────────────────

export function textoReserva(r: { estado: string; por: string | null }): Rotulo {
  switch (r.estado) {
    case 'mia': return { texto: 'Tomado por usted', icono: '●', tono: 'ok' };
    case 'otro': return { texto: r.por ? `Tomado por ${r.por}` : 'Tomado por otra persona', icono: '●', tono: 'aviso' };
    default: return { texto: 'Disponible', icono: '○', tono: 'neutra' };
  }
}

// ── Estado de la versión (para quien opera) ─────────────────────────────────

export const ESTADO_VERSION: Record<string, Rotulo> = {
  sin_validacion: { texto: 'Sin validación', icono: '–', tono: 'neutra' },
  pendiente: { texto: 'Pendiente de procesar', icono: '○', tono: 'neutra' },
  procesando: { texto: 'Leyendo', icono: '…', tono: 'info' },
  revision: { texto: 'En revisión', icono: '●', tono: 'aviso' },
  aprobado_manual: { texto: 'Aprobado', icono: '✓', tono: 'ok' },
  devuelto: { texto: 'Devuelto', icono: '↩', tono: 'aviso' },
  rechazado: { texto: 'Rechazado', icono: '✗', tono: 'peligro' },
  error: { texto: 'No se pudo leer', icono: '!', tono: 'peligro' },
};
export function estadoVersion(estado: string): Rotulo {
  return ESTADO_VERSION[estado] ?? { texto: estado.replace(/_/g, ' '), icono: '–', tono: 'neutra' };
}

const RESULTADO_EVENTO: Record<string, string> = {
  aprobar: 'aprobado', devolver: 'devuelto', rechazar: 'rechazado', consistente: 'consistente', discrepancia: 'revisión necesaria',
  revision_necesaria: 'revisión necesaria', no_aplica: 'no aplica', dudosa: 'lectura dudosa', legible: 'leído', datos_sipra_cambiaron: 'los datos de SIPRA cambiaron',
  camara_matricula_persona_natural: 'matrícula · persona natural', camara_matricula_sociedad: 'matrícula · sociedad',
  camara_existencia_representacion: 'existencia y representación', rut_persona_natural: 'RUT', rut_persona_juridica: 'RUT',
  documento_incorrecto: 'otro documento', no_determinable: 'no se pudo determinar',
};
export function resultadoEvento(resultado: string): string { return RESULTADO_EVENTO[resultado] ?? resultado.replace(/_/g, ' '); }

/** Evidencia = lo que el sistema leyó y calculó; historial = lo que ocurrió con el caso. */
export const TIPOS_EVIDENCIA = ['lectura_documento', 'clasificacion', 'comparacion', 'verificacion'];

// ── Decisión ────────────────────────────────────────────────────────────────

export type DecisionRevision = 'aprobar' | 'devolver' | 'rechazar';

/** Espejo de `evaluarApartamientoCamara` (API): aquí solo se anticipa; el servidor decide y revalida. */
export function apartaDeRecomendacionCamara(decision: DecisionRevision, recomendacion: string): boolean {
  if (decision === 'aprobar') return recomendacion !== 'consistente';
  if (decision === 'rechazar') return recomendacion === 'consistente';
  return false;
}

export function minimoJustificacion(decision: DecisionRevision, recomendacion: string): number {
  return apartaDeRecomendacionCamara(decision, recomendacion) ? JUSTIFICACION_REFORZADA : JUSTIFICACION_MINIMA;
}

/** Motivos que aplican a este certificado (los del catálogo de la API; sin persona determinable, todos). */
export function motivosParaPersona(motivos: readonly MotivoDevolucionCamara[], persona: string | null): MotivoDevolucionCamara[] {
  return motivos.filter((m) => persona === null || m.aplicaA.includes(persona));
}

/** Lo que leerá el estudiante al devolver, con el catálogo de la API (misma regla que `mensajeDevolucionCamara`). */
export function previsualizarDevolucion(motivos: readonly MotivoDevolucionCamara[], motivo: string, detalle: string): { que: string; hacer: string } | null {
  const m = motivos.find((x) => x.codigo === motivo);
  if (!m) return null;
  const extra = detalle.trim();
  const que = m.requiereDetalle ? (extra || m.mensajeEstudiante.que) : extra ? `${m.mensajeEstudiante.que} ${extra}` : m.mensajeEstudiante.que;
  return { que, hacer: m.mensajeEstudiante.hacer };
}

export function devolucionValida(motivos: readonly MotivoDevolucionCamara[], motivo: string, detalle: string): boolean {
  const m = motivos.find((x) => x.codigo === motivo);
  return !!m && (!m.requiereDetalle || detalle.trim().length >= JUSTIFICACION_MINIMA);
}

// ── Estudiante ──────────────────────────────────────────────────────────────

export const TONO_ESTADO_ESTUDIANTE: Record<string, Rotulo['tono']> = {
  pendiente: 'neutra', en_procesamiento: 'info', en_revision: 'aviso', necesita_correccion: 'aviso', aprobado: 'ok', rechazado: 'peligro',
};
export function tonoEstudiante(estado: string): Rotulo['tono'] { return TONO_ESTADO_ESTUDIANTE[estado] ?? 'neutra'; }
