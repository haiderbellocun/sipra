import { CampoComparadoRut, ItemBandejaRut, MotivoDevolucionRut } from '@core/models/modelos';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from '../eps/eps.util';
import type { Rotulo } from '../eps/eps.util';

/**
 * Textos y reglas visuales de la Mesa de RUT. Funciones puras: las reglas y la decisión viven en la API; aquí solo se rotulan y
 * se explican las cosas. Ningún estado se comunica solo con color (icono + texto). Al estudiante nunca le llega un nombre
 * interno, un código, la confianza ni lo que el sistema leyó del documento. NUNCA se dice que un RUT es «auténtico».
 */

export { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA };
export type { Rotulo };

// ── Resultado principal (lo primero que lee quien revisa) ───────────────────

export interface ResultadoRut extends Rotulo {
  titulo: string;
  frase: string;
  /** Lo que se señala en la bandeja (sin repetir el título). */
  problema: string | null;
}

export const FRASE_PERSONA_DISTINTA = 'El documento es un RUT válido, pero corresponde a un tipo de persona diferente al esperado.';
export const FRASE_DOCUMENTO_INCORRECTO = 'El archivo no corresponde al tipo de documento esperado.';
export const AVISO_OCR = 'Leído por OCR · revisar contra el documento';
export const AVISO_LECTURA_DUDOSA = 'Texto digital · lectura poco segura, revisar contra el documento';
export const AVISO_DATOS_SIPRA = 'Los datos de SIPRA cambiaron después de esta validación.';

export const RESULTADO_RUT: Record<string, ResultadoRut> = {
  consistente: {
    titulo: 'Consistente', texto: 'Consistente', icono: '✓', tono: 'ok',
    frase: 'Los datos principales del RUT coinciden con SIPRA.', problema: null,
  },
  discrepancia_critica: {
    titulo: 'Revisión necesaria', texto: 'Revisión necesaria', icono: '!', tono: 'peligro',
    frase: 'Encontramos diferencias con SIPRA que requieren revisión.', problema: 'Diferencias críticas con SIPRA',
  },
  persona_distinta: {
    titulo: 'Persona distinta', texto: 'Persona distinta', icono: '!', tono: 'aviso',
    frase: FRASE_PERSONA_DISTINTA, problema: 'Tipo de persona distinto al esperado',
  },
  documento_incorrecto: {
    titulo: 'Documento no corresponde', texto: 'Documento no corresponde', icono: '!', tono: 'peligro',
    frase: FRASE_DOCUMENTO_INCORRECTO, problema: 'Parece ser otro documento',
  },
  lectura_dudosa: {
    titulo: 'Leído por OCR', texto: 'Leído por OCR', icono: '?', tono: 'aviso',
    frase: 'La lectura es poco segura: compare los datos con el documento antes de decidir.', problema: 'Leído por OCR · revisar',
  },
  informacion_insuficiente: {
    titulo: 'Información insuficiente', texto: 'Información insuficiente', icono: '?', tono: 'aviso',
    frase: 'Faltan datos, en SIPRA o en el RUT, para compararlos todos.', problema: 'Información insuficiente',
  },
  no_determinable: {
    titulo: 'No determinable', texto: 'No determinable', icono: '?', tono: 'neutra',
    frase: 'No pudimos determinar qué documento es o qué dice. Revíselo directamente.', problema: 'No se pudo leer con certeza',
  },
};

export function resultadoRut(codigo: string): ResultadoRut {
  return RESULTADO_RUT[codigo] ?? RESULTADO_RUT['no_determinable'];
}

/** El problema principal de un caso en la bandeja: una sola línea. `null` = nada que señalar. */
export function problemaPrincipal(f: Pick<ItemBandejaRut, 'recomendacion' | 'inconsistenciaOperativa'>): { texto: string; icono: string; tono: Rotulo['tono'] } | null {
  if (f.inconsistenciaOperativa) return { texto: 'Requiere revisión administrativa', icono: '!', tono: 'peligro' };
  const r = resultadoRut(f.recomendacion);
  return r.problema ? { texto: r.problema, icono: r.icono, tono: r.tono } : null;
}

// ── Tipos de documento y de persona ─────────────────────────────────────────

const TIPO_ESPERADO: Record<string, string> = { rut_natural: 'RUT persona natural', rut_juridico: 'RUT persona jurídica' };
const TIPO_DETECTADO: Record<string, string> = {
  rut_persona_natural: 'RUT persona natural', rut_persona_juridica: 'RUT persona jurídica',
  camara_matricula_persona_natural: 'Certificado de Cámara de Comercio', camara_matricula_sociedad: 'Certificado de Cámara de Comercio',
  camara_existencia_representacion: 'Certificado de Cámara de Comercio', documento_incorrecto: 'Otro tipo de documento', no_determinable: 'No determinable',
};
export const textoTipoEsperado = (t: string | null): string => (t && TIPO_ESPERADO[t]) || 'RUT';
export const textoTipoDetectado = (t: string | null): string => (t && TIPO_DETECTADO[t]) || 'No determinable';
export const textoPersona = (p: string | null): string => (p === 'natural' ? 'Persona natural' : p === 'juridica' ? 'Persona jurídica' : 'No determinada');

// ── Método de lectura ───────────────────────────────────────────────────────

/** «Texto digital» o el aviso de OCR; la confianza técnica nunca se muestra como certeza. «OCR» solo si lo fue. */
export function textoMetodo(metodo: 'texto' | 'ocr' | null, dudosa: boolean): string | null {
  if (metodo === 'ocr') return AVISO_OCR;
  if (dudosa) return AVISO_LECTURA_DUDOSA;
  if (metodo === 'texto') return 'Texto digital';
  return null;
}

// ── Comparación SIPRA ↔ RUT ─────────────────────────────────────────────────

export interface ResultadoCampoRut extends Rotulo { critico: boolean }

/** Un campo crítico que no coincide dice «No coincide · CRÍTICO»; uno que no se pudo comparar NUNCA se muestra como «diferente». */
export function resultadoCampo(c: Pick<CampoComparadoRut, 'resultado' | 'criticidad'>): ResultadoCampoRut {
  const critico = c.criticidad === 'critico';
  switch (c.resultado) {
    case 'coincide': return { texto: 'Coincide', icono: '✓', tono: 'ok', critico: false };
    case 'diferente': return { texto: 'No coincide', icono: '✗', tono: critico ? 'peligro' : 'aviso', critico };
    case 'no_aplica': return { texto: 'No aplica', icono: '–', tono: 'neutra', critico: false };
    case 'informativo': return { texto: 'Informativo', icono: 'i', tono: 'info', critico: false };
    default: return { texto: 'Información insuficiente', icono: '?', tono: 'aviso', critico: false };
  }
}

export function descripcionCampo(c: CampoComparadoRut): string {
  const r = resultadoCampo(c);
  return `${c.etiqueta}: SIPRA ${c.sipra ?? 'sin dato'}, RUT ${c.rut ?? 'sin dato'}. ${r.texto}${r.critico ? ', crítico' : ''}.`;
}

const ORDEN_CRITICOS = ['documento', 'nombre', 'nit', 'dv', 'razon_social'];
const ORDEN_INFORMATIVOS = ['ciiu', 'divipola', 'fecha_generacion'];
const posicion = (orden: readonly string[], c: string): number => { const i = orden.indexOf(c); return i < 0 ? orden.length : i; };

/** Críticos e informativos se muestran por separado: no se mezclan. */
export function separarCampos(campos: readonly CampoComparadoRut[]): { criticos: CampoComparadoRut[]; informativos: CampoComparadoRut[] } {
  return {
    criticos: campos.filter((c) => c.criticidad === 'critico').sort((a, b) => posicion(ORDEN_CRITICOS, a.campo) - posicion(ORDEN_CRITICOS, b.campo)),
    informativos: campos.filter((c) => c.criticidad !== 'critico').sort((a, b) => posicion(ORDEN_INFORMATIVOS, a.campo) - posicion(ORDEN_INFORMATIVOS, b.campo)),
  };
}

// ── QR y autenticidad ───────────────────────────────────────────────────────

/** Solo señales de presencia. La autenticidad NO se verifica: jamás se muestra «RUT auténtico». */
export function textosQr(a: { qr: 'detectado' | 'no_determinado'; destinoOficialDian: boolean }): string[] {
  const t = [a.qr === 'detectado' ? 'QR detectado' : 'QR no determinado'];
  if (a.destinoOficialDian) t.push('Destino DIAN detectado');
  return t;
}
export const TEXTO_AUTENTICIDAD = 'Autenticidad: no verificada';

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
  rut_persona_natural: 'RUT persona natural', rut_persona_juridica: 'RUT persona jurídica', documento_incorrecto: 'otro documento', no_determinable: 'no se pudo determinar',
};
export function resultadoEvento(resultado: string): string { return RESULTADO_EVENTO[resultado] ?? resultado.replace(/_/g, ' '); }

/** Evidencia = lo que el sistema leyó y calculó; historial = lo que ocurrió con el caso. */
export const TIPOS_EVIDENCIA = ['lectura_documento', 'clasificacion', 'comparacion', 'verificacion'];

// ── Decisión ────────────────────────────────────────────────────────────────

export type DecisionRevision = 'aprobar' | 'devolver' | 'rechazar';

/** Espejo de `evaluarApartamientoRut` (API): aquí solo se anticipa; el servidor decide y revalida. */
export function apartaDeRecomendacionRut(decision: DecisionRevision, recomendacion: string): boolean {
  if (decision === 'aprobar') return recomendacion !== 'consistente';
  if (decision === 'rechazar') return recomendacion === 'consistente';
  return false;
}

export function minimoJustificacion(decision: DecisionRevision, recomendacion: string): number {
  return apartaDeRecomendacionRut(decision, recomendacion) ? JUSTIFICACION_REFORZADA : JUSTIFICACION_MINIMA;
}

/** Motivos que aplican a este tipo de RUT (los del catálogo de la API; sin persona determinable, todos). */
export function motivosParaPersona(motivos: readonly MotivoDevolucionRut[], persona: string | null): MotivoDevolucionRut[] {
  return motivos.filter((m) => persona === null || m.aplicaA.includes(persona));
}

/** Lo que leerá el estudiante al devolver, con el catálogo de la API (misma regla que `mensajeDevolucionRut`). */
export function previsualizarDevolucion(motivos: readonly MotivoDevolucionRut[], motivo: string, detalle: string): { que: string; hacer: string } | null {
  const m = motivos.find((x) => x.codigo === motivo);
  if (!m) return null;
  const extra = detalle.trim();
  const que = m.requiereDetalle ? (extra || m.mensajeEstudiante.que) : extra ? `${m.mensajeEstudiante.que} ${extra}` : m.mensajeEstudiante.que;
  return { que, hacer: m.mensajeEstudiante.hacer };
}

export function devolucionValida(motivos: readonly MotivoDevolucionRut[], motivo: string, detalle: string): boolean {
  const m = motivos.find((x) => x.codigo === motivo);
  return !!m && (!m.requiereDetalle || detalle.trim().length >= JUSTIFICACION_MINIMA);
}

// ── Estudiante ──────────────────────────────────────────────────────────────

export const TONO_ESTADO_ESTUDIANTE: Record<string, Rotulo['tono']> = {
  pendiente: 'neutra', en_procesamiento: 'info', en_revision: 'aviso', necesita_correccion: 'aviso', aprobado: 'ok', rechazado: 'peligro',
};
export function tonoEstudiante(estado: string): Rotulo['tono'] { return TONO_ESTADO_ESTUDIANTE[estado] ?? 'neutra'; }
