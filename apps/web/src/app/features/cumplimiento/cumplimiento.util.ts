import { CategoriaCumplimiento, ConteoCumplimiento, FiltrosCumplimiento, TableroCumplimiento } from '@core/models/modelos';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { TonoV3 } from '@shared/components/senal-estado.component';

/**
 * Cumplimiento V3 · presentación pura. NO calcula reglas: la categoría, los días y el orden vienen del servidor.
 * Aquí solo se redacta (texto de días, fracción, rótulos) y se proporciona el ancho visual de las barras.
 */
export const FILTROS_VACIOS: FiltrosCumplimiento = { periodo: '', escuela: '', programa: '', tipo: '', estado: '', busqueda: '', pagina: 1 };

export const CATEGORIAS: readonly { valor: CategoriaCumplimiento; etiqueta: string; tono: TonoV3 }[] = [
  { valor: 'vencida', etiqueta: 'Vencida', tono: 'peligro' },
  { valor: 'proxima', etiqueta: 'Próxima a vencer', tono: 'aviso' },
  { valor: 'en_plazo', etiqueta: 'En plazo', tono: 'info' },
  { valor: 'cumplida', etiqueta: 'Cumplida', tono: 'ok' },
];

export function etiquetaCategoria(c: CategoriaCumplimiento): string {
  return CATEGORIAS.find((x) => x.valor === c)?.etiqueta ?? c;
}
export function tonoCategoria(c: CategoriaCumplimiento): TonoV3 {
  return CATEGORIAS.find((x) => x.valor === c)?.tono ?? 'neutra';
}

/** Texto de los días que entrega el servidor. La categoría manda: una cumplida no «vence». */
export function textoDias(dias: number, categoria: CategoriaCumplimiento): string {
  if (categoria === 'cumplida') return 'Cumplida';
  if (dias < 0) { const n = -dias; return `Vencida hace ${n} ${n === 1 ? 'día' : 'días'}`; }
  if (dias === 0) return 'Vence hoy';
  return `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** «X de Y obligaciones cumplidas» (sin porcentaje: el universo puede ser pequeño o mezclar fechas futuras). */
export function fraccionCumplidas(c: Pick<ConteoCumplimiento, 'cumplidas' | 'aplicables'>): string {
  return `${c.cumplidas} de ${c.aplicables} ${c.aplicables === 1 ? 'obligación cumplida' : 'obligaciones cumplidas'}`;
}

export function metricasCumplimiento(t: TableroCumplimiento): MetricaV3[] {
  const i = t.indicadores;
  return [
    { n: i.cumplidas, t: 'Cumplidas', tono: 'ok', contexto: `de ${i.aplicables} aplicables` },
    { n: i.vencidas, t: 'Vencidas', tono: i.vencidas > 0 ? 'peligro' : 'neutra', contexto: 'fecha límite superada' },
    { n: i.proximas, t: 'Próximas a vencer', tono: i.proximas > 0 ? 'aviso' : 'neutra', contexto: 'en 10 días o menos' },
    { n: i.enPlazo, t: 'En plazo', tono: 'info', contexto: 'más de 10 días' },
    { n: t.practicasBloqueadas, t: 'Prácticas detenidas', tono: t.practicasBloqueadas > 0 ? 'peligro' : 'neutra', contexto: 'compuerta ARL' },
  ];
}

export interface Segmento { categoria: CategoriaCumplimiento; etiqueta: string; n: number; ancho: number }

/** Segmentos de una barra apilada en el orden de lectura vencida → próxima → en plazo → cumplida. */
export function segmentos(c: ConteoCumplimiento): Segmento[] {
  const n: Record<CategoriaCumplimiento, number> = { vencida: c.vencidas, proxima: c.proximas, en_plazo: c.enPlazo, cumplida: c.cumplidas };
  return CATEGORIAS.map((x) => ({
    categoria: x.valor, etiqueta: x.etiqueta, n: n[x.valor], ancho: c.aplicables > 0 ? (n[x.valor] / c.aplicables) * 100 : 0,
  })).filter((s) => s.n > 0);
}

/** Lectura completa de una barra para lectores de pantalla (el color nunca va solo). */
export function descripcionBarra(rotulo: string, c: ConteoCumplimiento): string {
  return `${rotulo}: ${fraccionCumplidas(c)}; ${c.vencidas} vencidas, ${c.proximas} próximas a vencer, ${c.enPlazo} en plazo.`;
}

export function textoAlcance(a: TableroCumplimiento['alcance']): string {
  if (a.tipo === 'institucional') return 'Institucional';
  if (a.tipo === 'asignados') return a.escuelas.length ? `Mis prácticas asignadas y ${a.escuelas.join(', ')}` : 'Mis prácticas asignadas';
  return a.escuelas.length === 1 ? `Escuela ${a.escuelas[0]}` : `Escuelas ${a.escuelas.join(', ')}`;
}

const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
const FORMATO_HORA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
export function fecha(iso: string): string { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : FORMATO_FECHA.format(d); }
export function fechaHora(iso: string): string { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : FORMATO_HORA.format(d); }

/** Filtros activos (sin contar la página). */
export function filtrosActivos(f: FiltrosCumplimiento): number {
  return (['periodo', 'escuela', 'programa', 'tipo', 'estado', 'busqueda'] as const).filter((k) => String(f[k]).trim() !== '').length;
}
