import { HttpErrorResponse } from '@angular/common/http';
import { EstadoAdres, EstadoReservaMesa, MotivoDevolucionEps, ReservaMesa } from '@core/models/modelos';

/**
 * Textos y reglas visuales de la Mesa de EPS. Son funciones puras: no hay lógica de
 * negocio nueva (las reglas y la decisión viven en la API), solo cómo se rotulan y se
 * explican las cosas. Ningún estado se comunica solo con color: todo lleva icono y texto.
 */

export type Tono = 'ok' | 'aviso' | 'peligro' | 'info' | 'neutra';

export interface Rotulo { texto: string; icono: string; tono: Tono }

export const AUTENTICIDAD: Record<string, Rotulo> = {
  no_evaluada: { texto: 'No evaluada', icono: '○', tono: 'neutra' },
  verificada: { texto: 'Verificada', icono: '✓', tono: 'ok' },
  no_verificable: { texto: 'No verificable', icono: '?', tono: 'aviso' },
  invalida: { texto: 'Inválida', icono: '✗', tono: 'peligro' },
};

export const AFILIACION: Record<string, Rotulo> = {
  activa: { texto: 'Activa', icono: '✓', tono: 'ok' },
  inactiva: { texto: 'Inactiva', icono: '✗', tono: 'peligro' },
  no_contrastada: { texto: 'No contrastada', icono: '○', tono: 'neutra' },
  no_determinable: { texto: 'No determinable', icono: '?', tono: 'aviso' },
};

export const ESTADO_ADRES: Record<EstadoAdres, Rotulo> = {
  no_requerido: { texto: 'No requerido', icono: '–', tono: 'neutra' },
  pendiente: { texto: 'Pendiente de ADRES', icono: '○', tono: 'aviso' },
  en_consulta: { texto: 'En consulta', icono: '…', tono: 'info' },
  evidencia_recibida: { texto: 'Resultado recibido', icono: '↓', tono: 'info' },
  procesado: { texto: 'Procesado', icono: '✓', tono: 'ok' },
  error: { texto: 'Con error', icono: '!', tono: 'peligro' },
  no_determinable: { texto: 'No determinable', icono: '?', tono: 'aviso' },
};

export const RECOMENDACION: Record<string, Rotulo> = {
  candidato_autoaprobacion: { texto: 'Candidato: cumple los criterios', icono: '✓', tono: 'ok' },
  recomendar_revision_documental: { texto: 'Revisar el documento', icono: '?', tono: 'aviso' },
  recomendar_revision_rechazo: { texto: 'Revisar: posible rechazo', icono: '!', tono: 'peligro' },
  discrepancia_critica: { texto: 'Discrepancia crítica', icono: '!', tono: 'peligro' },
  documento_incorrecto: { texto: 'Documento incorrecto', icono: '!', tono: 'peligro' },
  certificado_vencido: { texto: 'Certificado vencido', icono: '!', tono: 'aviso' },
  pendiente_adres: { texto: 'Falta ADRES', icono: '○', tono: 'info' },
  informacion_insuficiente: { texto: 'Información insuficiente', icono: '?', tono: 'neutra' },
};

/** Certificado frente a SIPRA: un dato que falta es «información insuficiente», nunca «coincide». */
export const CERTIFICADO_VS_SIPRA: Record<string, Rotulo> = {
  coincide: { texto: 'Coincide', icono: '✓', tono: 'ok' },
  diferente: { texto: 'Diferente', icono: '✗', tono: 'peligro' },
  insuficiente: { texto: 'Información insuficiente', icono: '?', tono: 'aviso' },
};

export const RESULTADO_COMPARACION: Record<string, Rotulo> = {
  coincide: { texto: 'Coincide', icono: '✓', tono: 'ok' },
  diferente: { texto: 'Diferente', icono: '✗', tono: 'peligro' },
  no_disponible: { texto: 'Sin información', icono: '–', tono: 'neutra' },
};

export const FUENTE_CAMPO: Record<string, string> = { texto_nativo: 'Texto del PDF', ocr: 'OCR', qr: 'QR' };
export const FUENTE_AFILIACION: Record<string, string> = {
  adres_bdua: 'ADRES (BDUA)', verificador_oficial: 'Verificador oficial', ninguna: 'Ninguna todavía',
};
export const METODO_EXTRACCION: Record<string, string> = {
  texto_nativo: 'Texto del PDF', ocr: 'OCR', mixto: 'Texto del PDF y OCR', desconocido: 'Sin determinar',
};
export const CAMPO_COMPARACION: Record<string, string> = {
  numero_documento: 'Documento', tipo_documento: 'Tipo de documento', nombre: 'Nombre', eps: 'EPS', regimen: 'Régimen', estado: 'Estado',
};

export const MOTIVOS_DEVOLUCION: ReadonlyArray<{ valor: MotivoDevolucionEps; texto: string }> = [
  { valor: 'documento_ilegible', texto: 'Documento ilegible' },
  { valor: 'certificado_vencido', texto: 'Certificado vencido' },
  { valor: 'datos_no_coinciden', texto: 'Los datos no coinciden' },
  { valor: 'certificado_incorrecto', texto: 'No es el certificado de EPS' },
  { valor: 'falta_informacion', texto: 'Falta información' },
  { valor: 'otro', texto: 'Otro motivo (explicar)' },
];

export const ESTADO_RESERVA: Record<EstadoReservaMesa, Rotulo> = {
  libre: { texto: 'Disponible', icono: '○', tono: 'neutra' },
  mia: { texto: 'Tomado por usted', icono: '●', tono: 'ok' },
  ajena: { texto: 'Tomado por otra persona', icono: '●', tono: 'aviso' },
  vencida: { texto: 'Reserva vencida: disponible', icono: '○', tono: 'info' },
};

export const JUSTIFICACION_MINIMA = 10;
export const JUSTIFICACION_REFORZADA = 40;

/** Ver `evaluarApartamiento` en la API: aquí solo se anticipa al funcionario; el servidor decide. */
export function apartaDeRecomendacion(decision: 'aprobar' | 'devolver' | 'rechazar', recomendacion: string): boolean {
  if (decision === 'aprobar') {
    return recomendacion === 'discrepancia_critica' || recomendacion === 'recomendar_revision_rechazo' || recomendacion === 'documento_incorrecto';
  }
  if (decision === 'rechazar') return recomendacion === 'candidato_autoaprobacion';
  return false;
}

/** Cuánto falta para que venza una reserva, en texto. Pasada la hora: «venció». */
export function textoRestante(hasta: string | null, ahora: number): string {
  if (!hasta) return '';
  const ms = new Date(hasta).getTime() - ahora;
  if (ms <= 0) return 'venció';
  const min = Math.floor(ms / 60_000);
  const seg = Math.floor((ms % 60_000) / 1000);
  return min >= 1 ? `${min} min` : `${seg} s`;
}

export function reservaVencidaAhora(reserva: ReservaMesa, ahora: number): boolean {
  return reserva.estado === 'mia' && reserva.hasta !== null && new Date(reserva.hasta).getTime() <= ahora;
}

/**
 * Errores de la API en lenguaje claro. Se usa el mensaje del servidor cuando es
 * comprensible (viene en español y sin detalles internos); si no, uno por código.
 */
export function traducirErrorEps(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'No fue posible completar la operación. Inténtelo de nuevo.';
  const cuerpo = error.error as { message?: string | string[]; mensaje?: string } | null;
  const servidor = cuerpo?.mensaje ?? (Array.isArray(cuerpo?.message) ? cuerpo?.message.join('. ') : cuerpo?.message);
  const util = typeof servidor === 'string' && servidor.length > 0 && servidor.length < 300 && !/at .*\(|stack|exception/i.test(servidor);
  switch (error.status) {
    case 0: return 'No hay conexión con el servidor. Revise su conexión e inténtelo de nuevo.';
    case 400: case 422: return util ? servidor : 'Los datos enviados no son válidos.';
    case 401: return 'Su sesión venció. Ingrese de nuevo.';
    case 403: return 'Su perfil no tiene permiso para esta acción.';
    case 404: return 'El caso ya no existe o no está dentro de su alcance.';
    case 409: return util ? servidor : 'El caso cambió o lo tiene otra persona. Actualice la bandeja.';
    case 410: return 'La consulta de ADRES venció o ya se usó: prepárela de nuevo.';
    case 415: return 'El archivo debe ser un PDF.';
    default: return error.status >= 500 ? 'El servidor tuvo un problema. Inténtelo de nuevo en un momento.' : 'No fue posible completar la operación.';
  }
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** «2014-01-13» → «13/01/2014». Una fecha sin hora no pasa por `Date`: así no se corre un día por la zona horaria. */
export function fechaIso(iso: string | null): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

export const SEVERIDAD_DISCREPANCIA: Record<string, Rotulo> = {
  critica: { texto: 'Crítica', icono: '!', tono: 'peligro' },
  informativa: { texto: 'Informativa', icono: 'i', tono: 'info' },
  insuficiente: { texto: 'Información insuficiente', icono: '?', tono: 'aviso' },
};

export function diaCorto(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Evidencia registrada: lo que ve quien revisa, sin los códigos internos ──

const TIPO_EVIDENCIA: Record<string, string> = {
  texto_pdf: 'Texto del PDF', ocr: 'Lectura por OCR', qr: 'Código QR', adres: 'Resultado de ADRES', revision_humana: 'Decisión de una persona', respuesta_eps: 'Respuesta de la EPS',
};
const FUENTE_EVIDENCIA: Record<string, string> = {
  certificado: 'Certificado', qr_oficial: 'QR oficial', eps_oficial: 'EPS (fuente oficial)', adres: 'ADRES', revision_humana: 'Revisión humana',
};
const RESULTADO_EVIDENCIA: Record<string, string> = {
  leido: 'leído', sin_texto: 'sin texto digital', sin_lectura: 'no se leyó ningún dato', no_encontrado: 'no se encontró', detectado: 'detectado', cargada: 'cargada',
  procesada: 'procesada', procesado: 'procesada', error: 'con error', aprobado_manual: 'aprobado', rechazado: 'rechazado', devuelto: 'devuelto',
};
export function tipoEvidencia(tipo: string): string { return TIPO_EVIDENCIA[tipo] ?? tipo.replace(/_/g, ' '); }
export function fuenteEvidencia(fuente: string): string { return FUENTE_EVIDENCIA[fuente] ?? fuente.replace(/_/g, ' '); }
export function resultadoEvidencia(resultado: string): string { return RESULTADO_EVIDENCIA[resultado] ?? resultado.replace(/_/g, ' '); }
