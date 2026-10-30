import { CampoComparadoActa, ItemBandejaActa, MotivoDevolucionActa } from '@core/models/modelos';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from '../eps/eps.util';
import type { Rotulo } from '../eps/eps.util';

/**
 * Textos y reglas visuales de la Mesa de Actas de Iniciación. Funciones puras: las reglas y la decisión viven en la API; aquí
 * solo se rotulan y se explican las cosas. Ningún estado se comunica solo con color (icono + texto) y al estudiante nunca le
 * llega un nombre interno, un código o la lectura del documento.
 */

export { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA };
export type { Rotulo };

// ── Resultado principal (lo primero que lee quien revisa) ───────────────────

export interface ResultadoActa extends Rotulo {
  /** Título corto, en mayúsculas visuales. */
  titulo: string;
  /** Una frase que dice qué significa. */
  frase: string;
  /** Lo que se señala en la bandeja (sin repetir el título). */
  problema: string | null;
}

const REVISION: Omit<ResultadoActa, 'problema' | 'tono' | 'icono'> = {
  titulo: 'Revisión necesaria', texto: 'Revisión necesaria', frase: 'Encontramos diferencias que requieren revisión.',
};

export const RESULTADO_ACTA: Record<string, ResultadoActa> = {
  consistente: {
    titulo: 'Consistente', texto: 'Consistente', icono: '✓', tono: 'ok',
    frase: 'Los datos principales del Acta coinciden con la práctica.', problema: null,
  },
  discrepancia_critica: { ...REVISION, icono: '!', tono: 'peligro', problema: 'Diferencias críticas con la práctica' },
  revisar: { ...REVISION, icono: '?', tono: 'aviso', problema: 'Hay diferencias por revisar' },
  firma_faltante: {
    titulo: 'Falta una firma', texto: 'Falta una firma', icono: '!', tono: 'aviso',
    frase: 'No encontramos una de las firmas del Acta. Revise el documento.', problema: 'Falta una firma',
  },
  documento_incorrecto: {
    titulo: 'Documento incorrecto', texto: 'Documento incorrecto', icono: '!', tono: 'peligro',
    frase: 'El archivo cargado no parece ser un Acta de Iniciación.', problema: 'Parece ser otro documento',
  },
  no_determinable: {
    titulo: 'No determinable', texto: 'No determinable', icono: '?', tono: 'neutra',
    frase: 'No pudimos verificar con suficiente confianza algunos datos del documento.', problema: 'No se pudo leer con certeza',
  },
};

export function resultadoActa(codigo: string): ResultadoActa {
  return RESULTADO_ACTA[codigo] ?? RESULTADO_ACTA['no_determinable'];
}

/** El problema principal de un caso en la bandeja: una sola línea. `null` = nada que señalar. */
export function problemaPrincipal(f: Pick<ItemBandejaActa, 'recomendacion' | 'firmaEmpresa' | 'firmaPracticante' | 'inconsistenciaOperativa'>): { texto: string; icono: string; tono: Rotulo['tono'] } | null {
  if (f.inconsistenciaOperativa) return { texto: 'Requiere revisión administrativa', icono: '!', tono: 'peligro' };
  const r = resultadoActa(f.recomendacion);
  if (f.recomendacion === 'firma_faltante') {
    const empresa = f.firmaEmpresa === 'no';
    const practicante = f.firmaPracticante === 'no';
    const texto = empresa && practicante ? 'Faltan las firmas de la empresa y del practicante'
      : empresa ? 'Falta la firma de la empresa' : practicante ? 'Falta la firma del practicante' : 'Falta una firma';
    return { texto, icono: r.icono, tono: r.tono };
  }
  return r.problema ? { texto: r.problema, icono: r.icono, tono: r.tono } : null;
}

// ── Firmas ──────────────────────────────────────────────────────────────────

export const PRESENCIA_FIRMA: Record<string, Rotulo> = {
  si: { texto: 'Detectada', icono: '✓', tono: 'ok' },
  no: { texto: 'No detectada', icono: '✗', tono: 'peligro' },
  no_determinable: { texto: 'No se pudo determinar', icono: '?', tono: 'aviso' },
};
export const AYUDA_FIRMAS = 'SIPRA detecta presencia probable de firma; no valida su autenticidad.';
export function presenciaFirma(valor: string | null): Rotulo {
  return (valor && PRESENCIA_FIRMA[valor]) || { texto: 'Sin revisar', icono: '–', tono: 'neutra' };
}

// ── Comparación SIPRA ↔ Acta ────────────────────────────────────────────────

/** Orden de lectura pedido para revisar: primero quién y dónde, luego las condiciones, al final lo accesorio. */
export const ORDEN_CAMPOS = [
  'estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'modalidad', 'remuneracion', 'responsable_arl',
  'programa', 'jefe_inmediato', 'funciones',
] as const;

export function ordenarCampos(campos: readonly CampoComparadoActa[]): CampoComparadoActa[] {
  const posicion = (c: string): number => { const i = (ORDEN_CAMPOS as readonly string[]).indexOf(c); return i < 0 ? ORDEN_CAMPOS.length : i; };
  return [...campos].sort((a, b) => posicion(a.campo) - posicion(b.campo));
}

export interface ResultadoCampo extends Rotulo { critico: boolean }

export function resultadoCampo(c: Pick<CampoComparadoActa, 'resultado' | 'criticidad'>): ResultadoCampo {
  const critico = c.criticidad === 'critica';
  if (c.resultado === 'coincide') return { texto: 'Coincide', icono: '✓', tono: 'ok', critico: false };
  if (c.resultado === 'diferente') return { texto: 'No coincide', icono: '✗', tono: critico ? 'peligro' : 'aviso', critico };
  return { texto: 'Sin información suficiente', icono: '?', tono: 'aviso', critico: false };
}

/** Lo que dice la fila para quien usa lector de pantalla (la fila lleva icono y texto, no solo color). */
export function descripcionCampo(c: CampoComparadoActa): string {
  const r = resultadoCampo(c);
  return `${c.etiqueta}: SIPRA ${c.sipra ?? 'sin dato'}, Acta ${c.acta ?? 'sin dato'}. ${r.texto}${r.critico ? ', crítico' : ''}.`;
}

// ── Reserva ─────────────────────────────────────────────────────────────────

export function textoReserva(r: { estado: string; por: string | null }): Rotulo {
  switch (r.estado) {
    case 'mia': return { texto: 'Tomado por usted', icono: '●', tono: 'ok' };
    case 'otro': return { texto: r.por ? `Tomado por ${r.por}` : 'Tomado por otra persona', icono: '●', tono: 'aviso' };
    case 'vencida': return { texto: 'Disponible', icono: '○', tono: 'neutra' };
    default: return { texto: 'Disponible', icono: '○', tono: 'neutra' };
  }
}

// ── Estado de la versión (para quien opera) ─────────────────────────────────

export const ESTADO_VERSION: Record<string, Rotulo> = {
  sin_validacion: { texto: 'Sin validación', icono: '–', tono: 'neutra' },
  pendiente: { texto: 'Pendiente de procesar', icono: '○', tono: 'neutra' },
  procesando: { texto: 'Leyendo', icono: '…', tono: 'info' },
  revision: { texto: 'En revisión', icono: '●', tono: 'aviso' },
  aprobado_manual: { texto: 'Aprobada', icono: '✓', tono: 'ok' },
  devuelto: { texto: 'Devuelta', icono: '↩', tono: 'aviso' },
  rechazado: { texto: 'Rechazada', icono: '✗', tono: 'peligro' },
  error: { texto: 'No se pudo leer', icono: '!', tono: 'peligro' },
};
export function estadoVersion(estado: string): Rotulo {
  return ESTADO_VERSION[estado] ?? { texto: estado.replace(/_/g, ' '), icono: '–', tono: 'neutra' };
}

const RESULTADO_EVENTO: Record<string, string> = {
  aprobado_manual: 'aprobada', devuelto: 'devuelta', rechazado: 'rechazada', consistente: 'consistente', revision_necesaria: 'revisión necesaria',
  iniciacion_practicas: 'acta de iniciación', documento_incorrecto: 'otro documento', no_determinable: 'no se pudo determinar',
  posterior_a_decision: 'posterior a la decisión', recalculada: 'recalculada', leido: 'leído', sin_texto: 'sin texto digital',
};
export function resultadoEvento(resultado: string): string { return RESULTADO_EVENTO[resultado] ?? resultado.replace(/_/g, ' '); }

export const TEXTO_CLASIFICACION: Record<string, string> = {
  iniciacion_practicas: 'Acta de iniciación', documento_incorrecto: 'Otro tipo de documento', no_determinable: 'No determinable',
};

// ── Decisión ────────────────────────────────────────────────────────────────

export type DecisionActa = 'aprobar' | 'devolver' | 'rechazar';

/** Espejo de `evaluarApartamientoActa` (API): aquí solo se anticipa al funcionario; el servidor decide y revalida. */
export function apartaDeRecomendacionActa(decision: DecisionActa, recomendacion: string): boolean {
  if (decision === 'aprobar') return ['discrepancia_critica', 'documento_incorrecto', 'firma_faltante', 'no_determinable'].includes(recomendacion);
  if (decision === 'rechazar') return recomendacion === 'consistente';
  return false;
}

export function minimoJustificacion(decision: DecisionActa, recomendacion: string): number {
  return apartaDeRecomendacionActa(decision, recomendacion) ? JUSTIFICACION_REFORZADA : JUSTIFICACION_MINIMA;
}

/**
 * Motivos del catálogo de la API con el mensaje que recibe el estudiante. El servidor es la fuente de verdad (el estudiante
 * siempre lee lo suyo); esta copia solo permite que quien devuelve VEA lo que va a leer. Se mantiene igual a
 * `MENSAJES_DEVOLUCION_ACTA` (mesa-acta.domain-service.ts).
 */
export const MOTIVOS_DEVOLUCION_ACTA: ReadonlyArray<{ valor: MotivoDevolucionActa; texto: string; que: string; hacer: string }> = [
  { valor: 'falta_firma_empresa', texto: 'Falta la firma de la empresa', que: 'Al acta le falta la firma de la empresa.', hacer: 'Pide a la empresa que la firme y cárgala de nuevo.' },
  { valor: 'falta_firma_practicante', texto: 'Falta la firma del practicante', que: 'Al acta le falta tu firma.', hacer: 'Fírmala y cárgala de nuevo.' },
  { valor: 'arl_no_coincide', texto: 'El responsable de la ARL no coincide', que: 'El responsable de la ARL indicado en el acta no coincide con la información registrada en tu práctica.', hacer: 'Contacta a coordinación o carga el documento correcto, según corresponda.' },
  { valor: 'remuneracion_no_coincide', texto: 'La remuneración no coincide', que: 'El tipo de práctica del acta (remunerada o no remunerada) no coincide con la información registrada en tu práctica.', hacer: 'Contacta a coordinación o carga el documento correcto, según corresponda.' },
  { valor: 'informacion_no_coincide', texto: 'La información no coincide con la práctica', que: 'La información del acta no coincide con la registrada en tu práctica.', hacer: 'Revisa que los datos del acta (estudiante, documento, empresa, NIT y fechas) sean los de tu práctica y cárgala de nuevo. Si el dato registrado es el equivocado, comunícate con coordinación.' },
  { valor: 'informacion_incompleta', texto: 'Falta información en el acta', que: 'Al acta le falta información necesaria.', hacer: 'Completa todos los campos del formato y cárgala de nuevo.' },
  { valor: 'documento_ilegible', texto: 'Documento ilegible', que: 'No pudimos leer tu acta con claridad.', hacer: 'Cárgala de nuevo completa, enfocada y con buena luz, o usa el PDF original.' },
  { valor: 'documento_incorrecto', texto: 'No es el Acta de Iniciación', que: 'El documento cargado no es el acta de iniciación de prácticas.', hacer: 'Descarga el formato de acta de iniciación, diligéncialo, fírmalo y cárgalo de nuevo.' },
  { valor: 'otro', texto: 'Otro motivo (explicar)', que: 'Tu acta de iniciación necesita una corrección.', hacer: 'Lee la indicación del equipo de prácticas y carga una nueva versión.' },
];

/** Lo que leerá el estudiante (misma regla que `mensajeDevolucionActa` en la API). */
export function previsualizarDevolucion(motivo: MotivoDevolucionActa | '', detalle: string): { que: string; hacer: string } | null {
  const m = MOTIVOS_DEVOLUCION_ACTA.find((x) => x.valor === motivo);
  if (!m) return null;
  const extra = detalle.trim();
  const que = m.valor === 'otro' ? (extra || m.que) : extra ? `${m.que} ${extra}` : m.que;
  return { que, hacer: m.hacer };
}

export function devolucionValida(motivo: MotivoDevolucionActa | '', detalle: string): boolean {
  return motivo !== '' && (motivo !== 'otro' || detalle.trim().length >= JUSTIFICACION_MINIMA);
}

// ── Corrección controlada de los datos de la práctica ───────────────────────

export const OPCIONES_REMUNERACION: ReadonlyArray<{ valor: 'remunerada' | 'no_remunerada'; texto: string }> = [
  { valor: 'remunerada', texto: 'Remunerada' }, { valor: 'no_remunerada', texto: 'No remunerada' },
];
export const OPCIONES_ARL: ReadonlyArray<{ valor: 'empresa' | 'cun'; texto: string }> = [
  { valor: 'empresa', texto: 'Empresa' }, { valor: 'cun', texto: 'CUN' },
];

/** El detalle trae el texto («Remunerada», «CUN»); la corrección necesita el valor. */
export function valorDeTexto(opciones: ReadonlyArray<{ valor: string; texto: string }>, texto: string | null): string {
  return opciones.find((o) => o.texto === texto)?.valor ?? '';
}

export const TEXTO_RESULTADO_CORRECCION: Record<string, string> = {
  recalculada: 'La comparación del Acta se recalculó con los datos nuevos.',
  marcada_posterior_a_decision: 'La decisión histórica se conservó: corresponde a los datos registrados en ese momento. El caso quedó marcado como «datos cambiaron después de la decisión».',
  sin_acta: 'La práctica todavía no tiene un Acta cargada: no había comparación que recalcular.',
  sin_calculo: 'El Acta aún no se procesa: usará los datos nuevos cuando se procese.',
  sin_cambios: 'Los datos ya eran esos: no hubo cambios.',
};

// ── Estudiante ──────────────────────────────────────────────────────────────

export const TONO_ESTADO_ESTUDIANTE: Record<string, Rotulo['tono']> = {
  sin_cargar: 'neutra', en_cola: 'info', leyendo: 'info', con_el_equipo: 'aviso', por_corregir: 'aviso', validada: 'ok',
  rechazada: 'peligro', por_revisar: 'aviso',
};
export function tonoEstudiante(estado: string): Rotulo['tono'] { return TONO_ESTADO_ESTUDIANTE[estado] ?? 'neutra'; }
