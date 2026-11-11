import {
  Celda, Cobertura, DetalleAnalitica, EstadoObligacion, FilaDetalleAnalitica, ReporteAnalitica, SituacionExpediente, TipoReceptor,
} from '@core/models/reportes-analitica.model';
import { TonoV3 } from '@shared/components/senal-estado.component';

/**
 * Contrato y lógica pura de la analítica de Reportes. Las cifras vienen calculadas del servidor
 * (`GET /reportes/analitica`); aquí solo se etiquetan, se convierten a proporciones y se arma la consulta.
 */
export type { Celda, Cobertura, DetalleAnalitica, EstadoObligacion, FilaDetalleAnalitica, ReporteAnalitica, SituacionExpediente, TipoReceptor };

/**
 * Contexto único de filtros (REPORT FILTER CONTEXT): todas las vistas, el detalle y el CSV usan este mismo objeto.
 * Solo dimensiones que SIPRA guarda en la práctica. El semestre NO existe en la base (vive en SINU, por estudiante).
 */
export interface FiltrosAnalitica {
  periodos: string[]; escuela: string; programa: string; ciclo: string; semestre: string; modalidad: string; estado: string; empresa: string;
  situacion: '' | SituacionExpediente; tipoReceptor: '' | TipoReceptor; sector: string; ciudad: string;
}
/** Recorte documental del detalle (tipo de documento × estado de su última versión); no cambia los agregados. */
export interface SegmentoAnalitica { tipo?: string; estadoDocumental?: EstadoObligacion }

export const FILTROS_VACIOS: FiltrosAnalitica = {
  periodos: [], escuela: '', programa: '', ciclo: '', semestre: '', modalidad: '', estado: '', empresa: '', situacion: '', tipoReceptor: '', sector: '', ciudad: '',
};
/** Valor de filtro de «sin dato» en sector o ciudad (NULL en la base; p. ej. receptoras en el exterior no tienen DIVIPOLA). */
export const SIN_DATO = '__sin_dato__';
export const RECEPTORES: Readonly<Record<TipoReceptor, string>> = { interna_cun: 'Interna CUN', externa: 'Externa' };
/** Valor de filtro de «sin empresa registrada» (NULL en la base; el servidor usa la misma constante). */
export const SIN_EMPRESA = '__sin_empresa__';
export const SIN_INFORMACION = 'Sin información';

/** Orden del breadcrumb analítico: de lo institucional a lo granular. */
export const ORDEN_CONTEXTO: readonly (keyof FiltrosAnalitica)[] = [
  'periodos', 'escuela', 'programa', 'ciclo', 'semestre', 'modalidad', 'tipoReceptor', 'sector', 'ciudad', 'empresa', 'estado', 'situacion',
];
export const ROTULOS_CONTEXTO: Readonly<Record<keyof FiltrosAnalitica, string>> = {
  periodos: 'Periodo', escuela: 'Escuela', programa: 'Programa', ciclo: 'Nivel', semestre: 'Semestre', modalidad: 'Modalidad', estado: 'Estado', empresa: 'Empresa', situacion: 'Expediente',
  tipoReceptor: 'Receptor', sector: 'Sector', ciudad: 'Ciudad',
};

/** Nivel de formación: valores reales de `practicas.ciclo`. */
export const NIVELES: Readonly<Record<string, string>> = { tecnico: 'Técnico', tecnologo: 'Tecnólogo', profesional: 'Profesional' };
export const nivel = (ciclo: string | null | undefined): string => (ciclo ? NIVELES[ciclo] ?? ciclo : SIN_INFORMACION);
/** Semestre (solo con el overlay sintético de pruebas). '' o null = sin información; nunca se deduce del periodo. */
export const semestre = (s: string | number | null | undefined): string => (s === null || s === undefined || s === '' ? SIN_INFORMACION : `Semestre ${s}`);
/** Orden numérico de semestres (4, 5, …, 10; nunca 10 antes que 4); sin información al final. */
export function compararSemestres(a: string, b: string): number {
  return (a === '' ? 999 : Number(a)) - (b === '' ? 999 : Number(b));
}

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

/** Porcentaje con un decimal y coma decimal (13,8 %), para tooltips y tasas. */
export function pct1(parte: number, total: number): string {
  return total > 0 ? `${((parte * 100) / total).toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %` : '—';
}

/**
 * Tasas documentales con numerador, denominador y definición explícitos (sin porcentajes ambiguos). La devolución es
 * una razón (devoluciones por documento), no un porcentaje: un documento puede devolverse más de una vez.
 */
export const TASAS = {
  aprobacion: { texto: 'Aprobación documental', definicion: 'obligaciones aprobadas / obligaciones exigidas' },
  devolucion: { texto: 'Devoluciones por documento', definicion: 'devoluciones auditadas / documentos cargados (práctica·tipo)' },
  versiones: { texto: 'Versiones por documento', definicion: 'versiones cargadas / documentos cargados (práctica·tipo)' },
} as const;
export function razon(parte: number, total: number): string {
  return total > 0 ? (parte / total).toLocaleString('es-CO', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '—';
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
  return ORDEN_CONTEXTO.filter((k) => (k === 'periodos' ? f.periodos.length > 0 : !!f[k])).length;
}

/** Parámetros de la consulta: solo los filtros con valor (los vacíos no viajan). */
export function parametros(f: FiltrosAnalitica, s: SegmentoAnalitica = {}, buscar = ''): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.periodos.length) p['periodos'] = f.periodos.join(',');
  const valores: [string, string | undefined][] = [
    ['escuela', f.escuela], ['programa', f.programa], ['ciclo', f.ciclo], ['semestre', f.semestre], ['modalidad', f.modalidad], ['estado', f.estado],
    ['empresa', f.empresa], ['situacion', f.situacion], ['tipoReceptor', f.tipoReceptor], ['sector', f.sector], ['ciudad', f.ciudad], ['tipo', s.tipo], ['estadoDocumental', s.estadoDocumental], ['buscar', buscar.trim()],
  ];
  for (const [k, v] of valores) if (v) p[k] = v;
  return p;
}

export interface MigaContexto { clave: keyof FiltrosAnalitica; rotulo: string; valor: string }

/** Breadcrumb analítico: los filtros activos, en el orden institución → expediente. */
export function migas(f: FiltrosAnalitica, nombres: {
  escuela: (c: string) => string; etiqueta: (v: string) => string; programa?: (c: string) => string; sector?: (c: string) => string; ciudad?: (c: string) => string;
}): MigaContexto[] {
  const valor = (k: keyof FiltrosAnalitica): string => {
    switch (k) {
      case 'periodos': return f.periodos.join(', ');
      case 'escuela': return nombres.escuela(f.escuela);
      case 'programa': return nombres.programa ? nombres.programa(f.programa) : f.programa;
      case 'ciclo': return nivel(f.ciclo);
      case 'semestre': return semestre(f.semestre);
      case 'modalidad': case 'estado': return nombres.etiqueta(f[k]);
      case 'empresa': return f.empresa === SIN_EMPRESA ? 'Sin empresa registrada' : f.empresa;
      case 'tipoReceptor': return f.tipoReceptor ? RECEPTORES[f.tipoReceptor] : '';
      case 'sector': return f.sector === SIN_DATO ? SIN_INFORMACION : nombres.sector ? nombres.sector(f.sector) : f.sector;
      case 'ciudad': return f.ciudad === SIN_DATO ? 'Sin municipio registrado' : nombres.ciudad ? nombres.ciudad(f.ciudad) : f.ciudad;
      case 'situacion': return CATEGORIAS_EXPEDIENTE.find((c) => c.clave === f.situacion)?.texto ?? f.situacion;
      default: return String(f[k]);
    }
  };
  return ORDEN_CONTEXTO.filter((k) => (k === 'periodos' ? f.periodos.length > 0 : !!f[k])).map((k) => ({ clave: k, rotulo: ROTULOS_CONTEXTO[k], valor: valor(k) }));
}

/** Quita un nivel del contexto: sin escuela tampoco queda su programa. */
export function quitar(f: FiltrosAnalitica, clave: keyof FiltrosAnalitica): FiltrosAnalitica {
  const nuevo = { ...f, [clave]: clave === 'periodos' ? [] : '' } as FiltrosAnalitica;
  if (clave === 'escuela') nuevo.programa = '';
  return nuevo;
}

/** Título legible de un recorte documental del detalle. */
export function tituloSegmento(s: SegmentoAnalitica, etiqueta: (v: string) => string): string {
  const t: string[] = [];
  if (s.tipo) t.push(etiqueta(s.tipo));
  if (s.estadoDocumental) t.push(CATEGORIAS_OBLIGACION.find((c) => c.clave === s.estadoDocumental)?.texto ?? s.estadoDocumental);
  return t.length ? t.join(' · ') : 'Prácticas del contexto';
}

/** Altura relativa (0–100) de cada semana respecto al máximo de la serie; 0 si la serie está vacía. */
export function escalaSemanas(semanas: ReporteAnalitica['semanas']): number {
  return Math.max(0, ...semanas.map((s) => Math.max(s.cargas, s.aprobaciones + s.devoluciones + s.rechazos)));
}

export function hayDatos(r: ReporteAnalitica | null): boolean {
  return !!r && r.resumen.practicas > 0;
}

/** Barra ordenable y seleccionable (una fila por categoría de una dimensión). */
export interface ItemBarra { clave: string; texto: string; n: number; sub?: string }

/** Paleta de categorías: pocas clases estables (sin arcoíris). Las categorías más allá de la quinta comparten «otras». */
export const CLASES_SERIE = ['s0', 's1', 's2', 's3', 's4'] as const;
export const CLASE_OTRAS = 's-otras';
export function claseSerie(orden: readonly string[], clave: string): string {
  const i = orden.indexOf(clave);
  return i >= 0 && i < CLASES_SERIE.length ? CLASES_SERIE[i] : CLASE_OTRAS;
}

export interface FilaApilada { clave: string; texto: string; total: number; partes: { columna: string; n: number }[] }

/**
 * Matriz de un cruce lista para barras apiladas: filas ordenadas por total (desc) y columnas ordenadas por su total global.
 * El valor es estudiantes únicos por celda; el total de la fila es la SUMA de celdas (una persona en dos columnas cuenta en ambas).
 */
export function apilar(celdas: readonly Celda[], ordenFilas?: (a: string, b: string) => number): { filas: FilaApilada[]; columnas: string[] } {
  const porColumna = new Map<string, number>();
  const porFila = new Map<string, FilaApilada>();
  for (const c of celdas) {
    porColumna.set(c.columna, (porColumna.get(c.columna) ?? 0) + c.estudiantes);
    const f = porFila.get(c.fila) ?? { clave: c.fila, texto: c.fila, total: 0, partes: [] };
    f.total += c.estudiantes;
    f.partes.push({ columna: c.columna, n: c.estudiantes });
    porFila.set(c.fila, f);
  }
  const columnas = [...porColumna.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  for (const f of porFila.values()) f.partes.sort((a, b) => columnas.indexOf(a.columna) - columnas.indexOf(b.columna));
  const filas = [...porFila.values()].sort(ordenFilas ? (a, b) => ordenFilas(a.clave, b.clave) : (a, b) => b.total - a.total || a.clave.localeCompare(b.clave));
  return { filas, columnas };
}

/** Orden académico de los niveles (técnico → tecnólogo → profesional); desconocidos al final. */
export function compararNiveles(a: string, b: string): number {
  const orden = Object.keys(NIVELES);
  const ia = orden.indexOf(a), ib = orden.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

/** Comparador según un orden dado (p. ej. `ordenPeriodos` del servidor, cronológico por la entidad real); lo ausente al final. */
export function segunOrden(orden: readonly string[]): (a: string, b: string) => number {
  const pos = new Map(orden.map((x, i) => [x, i]));
  return (a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9) || compararPeriodos(a, b);
}

/** Respaldo de texto para periodos sin fecha: por año y sufijo numérico si lo tienen (nunca «10» antes que «2»). */
export function compararPeriodos(a: string, b: string): number {
  const ma = /^(\d{4})-?(\w*)$/.exec(a), mb = /^(\d{4})-?(\w*)$/.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]) || ma[2].localeCompare(mb[2], 'es', { numeric: true });
  return ma ? -1 : mb ? 1 : a.localeCompare(b);
}
