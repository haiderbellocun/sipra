import {
  Cobertura, DetalleAnalitica, EstadoObligacion, FilaDetalleAnalitica, ReporteAnalitica, SituacionExpediente,
} from '@core/models/reportes-analitica.model';
import { TonoV3 } from '@shared/components/senal-estado.component';

/**
 * Contrato y lógica pura de la analítica de Reportes. Las cifras vienen calculadas del servidor
 * (`GET /reportes/analitica`); aquí solo se etiquetan, se convierten a proporciones y se arma la consulta.
 */
export type { Cobertura, DetalleAnalitica, EstadoObligacion, FilaDetalleAnalitica, ReporteAnalitica, SituacionExpediente };

export interface FiltrosAnalitica { periodos: string[]; escuela: string; programa: string; modalidad: string; estado: string }
export interface SegmentoAnalitica { situacion?: SituacionExpediente; tipo?: string; estadoDocumental?: EstadoObligacion; escuela?: string; programa?: string; modalidad?: string; periodo?: string }

export const FILTROS_VACIOS: FiltrosAnalitica = { periodos: [], escuela: '', programa: '', modalidad: '', estado: '' };

/** `clase` distingue dos categorías del mismo tono en las barras (p. ej. recibido frente a en revisión). */
export interface Categoria<K extends string> { clave: K; texto: string; tono: TonoV3; clase?: string }

/** Orden de lectura de las obligaciones: de lo resuelto a lo que no ha empezado. */
export const CATEGORIAS_OBLIGACION: readonly Categoria<EstadoObligacion>[] = [
  { clave: 'aprobado', texto: 'Aprobado', tono: 'ok' },
  { clave: 'en_revision', texto: 'En revisión', tono: 'info' },
  { clave: 'en_proceso', texto: 'Recibido / en análisis', tono: 'info', clase: 'info-suave' },
  { clave: 'correccion', texto: 'En corrección', tono: 'aviso' },
  { clave: 'rechazado', texto: 'Rechazado', tono: 'peligro' },
  { clave: 'sin_cargar', texto: 'Sin cargar', tono: 'neutra' },
];

export const CATEGORIAS_EXPEDIENTE: readonly Categoria<SituacionExpediente>[] = [
  { clave: 'completo', texto: 'Completo', tono: 'ok' },
  { clave: 'en_curso', texto: 'En curso', tono: 'info' },
  { clave: 'requiere_correccion', texto: 'Requiere corrección', tono: 'aviso' },
  { clave: 'sin_iniciar', texto: 'Sin iniciar', tono: 'neutra' },
  { clave: 'sin_matriz', texto: 'Modalidad sin matriz', tono: 'peligro' },
];

export interface Segmento<K extends string> extends Categoria<K> { n: number; pct: number }

/** Partes de un total con su porcentaje (enteros que suman 100 por el método del mayor residuo). Omite las vacías. */
export function partes<K extends string>(categorias: readonly Categoria<K>[], conteo: Record<K, number>): Segmento<K>[] {
  const total = categorias.reduce((n, c) => n + (conteo[c.clave] ?? 0), 0);
  if (total === 0) return [];
  const crudos = categorias.map((c) => ({ ...c, n: conteo[c.clave] ?? 0, exacto: ((conteo[c.clave] ?? 0) * 100) / total }));
  const base = crudos.map((c) => ({ ...c, pct: Math.floor(c.exacto) }));
  let resto = 100 - base.reduce((n, c) => n + c.pct, 0);
  for (const c of [...base].sort((a, b) => (b.exacto - Math.floor(b.exacto)) - (a.exacto - Math.floor(a.exacto)))) {
    if (resto <= 0) break;
    if (c.n > 0) { c.pct += 1; resto -= 1; }
  }
  return base.filter((c) => c.n > 0).map(({ clave, texto, tono, clase, n, pct }) => ({ clave, texto, tono, clase, n, pct }));
}

/** Porcentaje entero; «—» se decide en la vista cuando el denominador es 0. */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte * 100) / total) : null;
}

export function horas(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toLocaleString('es-CO', { maximumFractionDigits: 1 })} h`;
  return `${(h / 24).toLocaleString('es-CO', { maximumFractionDigits: 1 })} d`;
}

/** «2026-09-14» → «14 sep». La semana ya viene calculada en hora de Bogotá; se lee como fecha civil. */
export function semanaCorta(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1] ?? ''}`;
}
/** Abreviaturas fijas: no dependen de los datos de idioma del navegador. */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function cantidadFiltros(f: FiltrosAnalitica): number {
  return (f.periodos.length ? 1 : 0) + [f.escuela, f.programa, f.modalidad, f.estado].filter(Boolean).length;
}

/** Parámetros de la consulta: solo los filtros con valor (los vacíos no viajan). */
export function parametros(f: FiltrosAnalitica, s: SegmentoAnalitica = {}): Record<string, string> {
  const p: Record<string, string> = {};
  const periodos = s.periodo ? [s.periodo] : f.periodos;
  if (periodos.length) p['periodos'] = periodos.join(',');
  const valores: [string, string | undefined][] = [
    ['escuela', s.escuela ?? f.escuela], ['programa', s.programa ?? f.programa], ['modalidad', s.modalidad ?? f.modalidad], ['estado', f.estado],
    ['situacion', s.situacion], ['tipo', s.tipo], ['estadoDocumental', s.estadoDocumental],
  ];
  for (const [k, v] of valores) if (v) p[k] = v;
  return p;
}

/** Título legible de un recorte del detalle. */
export function tituloSegmento(s: SegmentoAnalitica, etiqueta: (v: string) => string, escuela: (codigo: string) => string = (c) => c): string {
  const partesTitulo: string[] = [];
  if (s.situacion) partesTitulo.push(`Expedientes · ${CATEGORIAS_EXPEDIENTE.find((c) => c.clave === s.situacion)?.texto ?? s.situacion}`);
  if (s.tipo) partesTitulo.push(etiqueta(s.tipo));
  if (s.estadoDocumental) partesTitulo.push(CATEGORIAS_OBLIGACION.find((c) => c.clave === s.estadoDocumental)?.texto ?? s.estadoDocumental);
  if (s.escuela) partesTitulo.push(escuela(s.escuela));
  if (s.programa) partesTitulo.push(`Programa ${s.programa}`);
  if (s.modalidad) partesTitulo.push(etiqueta(s.modalidad));
  if (s.periodo) partesTitulo.push(`Periodo ${s.periodo}`);
  return partesTitulo.length ? partesTitulo.join(' · ') : 'Todas las prácticas del filtro';
}

/** Altura relativa (0–100) de cada semana respecto al máximo de la serie; 0 si la serie está vacía. */
export function escalaSemanas(semanas: ReporteAnalitica['semanas']): number {
  return Math.max(0, ...semanas.map((s) => Math.max(s.cargas, s.aprobaciones + s.devoluciones + s.rechazos)));
}

export function hayDatos(r: ReporteAnalitica | null): boolean {
  return !!r && r.resumen.practicas > 0;
}
