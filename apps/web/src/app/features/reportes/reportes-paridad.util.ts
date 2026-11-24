import { CruceFuente, ReporteFuentes } from '@core/models/reportes-fuentes.model';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { Celda, compararNiveles, nivel, pct1 } from './reportes-analitica.util';
import { SerieBump } from './reportes-bump.component';
import { GrupoBarras } from './reportes-grupos.component';
import { ParteGrafico, TonoGrafico, num } from './reportes-graficos.util';
import { SerieLinea } from './reportes-lineas.component';
import { ORG_SIN_CORRESPONDENCIA, etiquetaEstado, pctTasa, rotuloFuente } from './reportes-fuentes.util';

/**
 * Paridad visual de Reportes V3 (§32). Histórico y Todos usan las MISMAS gráficas y la misma rejilla que Actual siempre
 * que la métrica sea comparable; cambia el dato, no el diseño. Aquí solo se traduce el contrato por fuente a los insumos
 * de esos componentes. La medida de los cruces es PRÁCTICAS (el SGP no permite estudiantes únicos por celda).
 *
 * Lo que solo existe en el expediente de SIPRA (situación del expediente, interna CUN/externa, sector CIIU, cobertura y
 * aprobación documental) no se rellena: se declara «No disponible para información histórica».
 */

/** Qué gráfica usa cada métrica en Actual; Histórico y Todos deben usar la misma (o declararla no disponible). */
export type GraficaV3 = 'kpis' | 'composicion' | 'barras' | 'dona' | 'proporcion' | 'lineas' | 'bump' | 'stream' | 'grupos' | 'pack' | 'matriz' | 'no-disponible';
export const GRAFICA_POR_METRICA: Readonly<Record<string, { actual: GraficaV3; fuente: GraficaV3 }>> = {
  resumen: { actual: 'kpis', fuente: 'kpis' },
  composicionModalidad: { actual: 'composicion', fuente: 'composicion' },
  programa: { actual: 'barras', fuente: 'barras' },
  nivel: { actual: 'dona', fuente: 'dona' },
  internaExterna: { actual: 'proporcion', fuente: 'no-disponible' },
  practicasPorPeriodo: { actual: 'lineas', fuente: 'lineas' },
  programaPorPeriodo: { actual: 'lineas', fuente: 'lineas' },
  rankingProgramas: { actual: 'bump', fuente: 'bump' },
  modalidadPorPeriodo: { actual: 'stream', fuente: 'stream' },
  periodoAB: { actual: 'grupos', fuente: 'grupos' },
  sectoresOrganizaciones: { actual: 'pack', fuente: 'no-disponible' },
  organizaciones: { actual: 'barras', fuente: 'barras' },
  programaSector: { actual: 'matriz', fuente: 'no-disponible' },
  ciudad: { actual: 'barras', fuente: 'barras' },
  internaExternaOrg: { actual: 'dona', fuente: 'no-disponible' },
  sectores: { actual: 'barras', fuente: 'no-disponible' },
};

export const NO_DISPONIBLE_HISTORICO = 'No disponible para información histórica';

/** Celdas en la forma que esperan composición, bandas y matriz (la medida va en ambos campos: son prácticas). */
export function celdasCruce(r: ReporteFuentes, cruce: CruceFuente): Celda[] {
  return (r.cruces?.[cruce] ?? []).map((c) => ({ fila: c.fila, columna: c.columna, estudiantes: c.valor, practicas: c.valor }));
}

/** Etiqueta legible de una clave de un cruce (fila o columna), con la misma regla de rótulos que las barras. */
export function rotulador(r: ReporteFuentes, cruce: CruceFuente, lado: 'fila' | 'columna', rotular: (codigo: string) => string = (c) => c): (clave: string) => string {
  const m = new Map<string, string>();
  for (const c of r.cruces?.[cruce] ?? []) m.set(lado === 'fila' ? c.fila : c.columna, lado === 'fila' ? c.filaEtiqueta : c.columnaEtiqueta);
  return (clave) => {
    const e = m.get(clave) ?? clave;
    if (clave.startsWith('modalidad:')) return rotular(e);
    if (['inscrito', 'en_practica', 'cerrado', 'reprobado', 'anulado'].includes(clave)) return etiquetaEstado(clave);
    return e;
  };
}

/** Estados de la práctica como segmentos de la composición, en orden semántico y con color fijo. */
const ORDEN_ESTADOS: readonly [string, TonoGrafico][] = [['inscrito', 'info-suave'], ['en_practica', 'info'], ['cerrado', 'ok'], ['reprobado', 'riesgo'], ['anulado', 'muted']];
export function categoriasEstado(): ParteGrafico[] {
  return ORDEN_ESTADOS.map(([clave, tono]) => ({ clave, texto: etiquetaEstado(clave), n: 0, pct: '', tono }));
}

/** Nivel de formación como dona (misma rampa fría y mismo orden que Actual). */
export const TONOS_NIVEL_FUENTE: readonly TonoGrafico[] = ['c8', 'info', 'c0'];
export function partesNivel(r: ReporteFuentes): ParteGrafico[] {
  const lista = [...(r.dimensiones.nivel ?? [])].sort((a, b) => compararNiveles(a.clave, b.clave));
  const total = lista.reduce((n, x) => n + x.valor, 0);
  return lista.map((x, k) => ({ clave: x.clave, texto: nivel(x.clave), n: x.valor, pct: pct1(x.valor, total), tono: TONOS_NIVEL_FUENTE[k % TONOS_NIVEL_FUENTE.length] }));
}

/**
 * Año académico de un código de periodo: «2024A», «2020I» (cuatro dígitos) o «24V03», «26G06», «21T04» (dos dígitos y
 * letra). Sin año reconocible, al final. No se inventa la posición dentro del año: dentro del mismo año se ordena por
 * el código. Así la línea temporal no retrocede (el orden alfabético pondría todos los virtuales antes que los presenciales).
 */
export function anioPeriodo(clave: string): number {
  const largo = /^(\d{4})/.exec(clave);
  if (largo) return Number(largo[1]);
  const corto = /^(\d{2})[A-Za-z]/.exec(clave);
  return corto ? 2000 + Number(corto[1]) : Number.MAX_SAFE_INTEGER;
}
export function periodosCronologicos(r: ReporteFuentes): ReporteFuentes['periodoPorFuente'] {
  return [...(r.periodoPorFuente ?? [])].sort((a, b) => anioPeriodo(a.clave) - anioPeriodo(b.clave) || a.clave.localeCompare(b.clave, 'es', { numeric: true }));
}

/** Eje temporal: periodos en orden cronológico por año. */
export function ejePeriodos(r: ReporteFuentes): string[] {
  return periodosCronologicos(r).map((p) => p.clave);
}

/** Prácticas por periodo: una serie en Histórico; Actual e Histórico como dos series en Todos (mismo eje, misma gráfica). */
export function seriesPeriodo(r: ReporteFuentes): SerieLinea[] {
  const p = periodosCronologicos(r);
  if (r.fuente === 'all') {
    return [
      { clave: 'current', texto: 'Actual', valores: p.map((x) => x.current), tono: 'principal' },
      { clave: 'historical', texto: 'Histórico', valores: p.map((x) => x.historical), tono: 'comparacion' },
    ];
  }
  return [{ clave: r.fuente, texto: `Prácticas · ${rotuloFuente(r.fuente)}`, valores: p.map((x) => (r.fuente === 'current' ? x.current : x.historical)), tono: 'principal' }];
}

/** Series por programa en el eje temporal (todas: el ranking se calcula entre todos los programas). */
export function seriesProgramas(r: ReporteFuentes): SerieBump[] {
  const eje = ejePeriodos(r);
  const celdas = r.cruces?.periodoPrograma ?? [];
  const texto = rotulador(r, 'periodoPrograma', 'columna');
  const idx = new Map(celdas.map((c) => [`${c.fila}\u0000${c.columna}`, c.valor]));
  return [...new Set(celdas.map((c) => c.columna))].map((prog) => ({ clave: prog, texto: texto(prog), valores: eje.map((p) => idx.get(`${p}\u0000${prog}`) ?? 0) }));
}

/** Periodo A frente a B por programa (prácticas de cada periodo), ordenado por el mayor de los dos. */
export function gruposAB(r: ReporteFuentes, a: string, b: string): GrupoBarras[] {
  const celdas = (r.cruces?.periodoPrograma ?? []).filter((c) => c.fila === a || c.fila === b);
  const texto = rotulador(r, 'periodoPrograma', 'columna');
  const v = (p: string, prog: string): number => celdas.find((c) => c.fila === p && c.columna === prog)?.valor ?? 0;
  return [...new Set(celdas.map((c) => c.columna))].map((prog) => ({ clave: prog, texto: texto(prog), a: v(a, prog), b: v(b, prog) }))
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || x.texto.localeCompare(y.texto));
}

/** Filas comparables de A frente a B; las del expediente se declaran no disponibles (nunca cero). */
export interface FilaAB { texto: string; va: string; vb: string; delta: number | null; deltaTexto: string; definicion: string }
export function comparacionAB(r: ReporteFuentes, a: string, b: string): FilaAB[] {
  const practicas = (p: string): number => (r.periodoPorFuente ?? []).find((x) => x.clave === p)?.[r.fuente === 'current' ? 'current' : 'historical'] ?? 0;
  const totalP = (p: string): number => { const x = (r.periodoPorFuente ?? []).find((y) => y.clave === p); return x ? x.current + x.historical : 0; };
  const cuenta = (c: CruceFuente, p: string): number => new Set((r.cruces?.[c] ?? []).filter((x) => x.fila === p).map((x) => x.columna)).size;
  const n = (texto: string, va: number, vb: number, definicion = ''): FilaAB => ({ texto, definicion, va: num(va), vb: num(vb), delta: vb - va, deltaTexto: num(vb - va) });
  const nd = (texto: string, definicion: string): FilaAB => ({ texto, definicion, va: '—', vb: '—', delta: null, deltaTexto: NO_DISPONIBLE_HISTORICO });
  return [
    n('Prácticas', r.fuente === 'all' ? totalP(a) : practicas(a), r.fuente === 'all' ? totalP(b) : practicas(b)),
    n('Programas con prácticas', cuenta('periodoPrograma', a), cuenta('periodoPrograma', b)),
    n('Modalidades usadas', cuenta('periodoModalidad', a), cuenta('periodoModalidad', b)),
    nd('Cobertura cargada', 'obligaciones cargadas / exigidas: expediente de SIPRA'),
    nd('Aprobación documental', 'obligaciones aprobadas / exigidas: expediente de SIPRA'),
  ];
}

/**
 * Franja ejecutiva por fuente: misma tira agrupada que Actual (seis cifras en tres grupos), con las cifras que ambas
 * fuentes sostienen. Las tasas excluyen los estados «al corte» del SGP (la política decide el denominador).
 */
export const GRUPOS_FUENTE = [{ titulo: 'Operación', n: 2 }, { titulo: 'Desenlace', n: 3 }, { titulo: 'Tiempo', n: 1 }] as const;
export const ACENTOS_FUENTE: readonly TonoGrafico[] = ['c0', 'c8', 'ok', 'riesgo', 'muted', 'c4'];
export function metricasFuenteV3(r: ReporteFuentes): MetricaV3[] {
  const cota = r.totales.precisionEstudiantes === 'cota_superior';
  const tasa = (k: 'cierre' | 'reprobacion' | 'anulacion') => (r.tasas[k].valor === null ? 0 : Math.round(r.tasas[k].valor! * 1000) / 10);
  const ctx = (k: 'cierre' | 'reprobacion' | 'anulacion') => (r.tasas[k].valor === null ? 'sin base' : `${num(r.tasas[k].numerador)} / ${num(r.tasas[k].denominador)} finalizadas`);
  return [
    { n: r.totales.practicas, t: 'Prácticas', tono: 'neutra', contexto: r.fuente === 'all' ? 'confirmadas cuentan una vez' : rotuloFuente(r.fuente).toLowerCase() },
    { n: r.totales.estudiantesUnicos, t: 'Estudiantes únicos', tono: cota ? 'aviso' : 'info', contexto: cota ? 'cota superior (sin identidad común)' : 'una vez por persona' },
    { n: tasa('cierre'), t: 'Cierre %', tono: 'ok', contexto: ctx('cierre') },
    { n: tasa('reprobacion'), t: 'Reprobación %', tono: 'aviso', contexto: ctx('reprobacion') },
    { n: tasa('anulacion'), t: 'Anulación %', tono: 'neutra', contexto: ctx('anulacion') },
    { n: r.duracion.mediana ?? 0, t: 'Duración mediana', tono: 'neutra', contexto: r.duracion.mediana === null ? 'sin base' : `días · p25 ${num(r.duracion.p25 ?? 0)} · p75 ${num(r.duracion.p75 ?? 0)}` },
  ];
}

/** KPI de Organizaciones por fuente: solo lo que el SGP sostiene (sin sectores CIIU ni interna CUN). */
export function metricasOrganizacionesFuente(r: ReporteFuentes): MetricaV3[] {
  const orgs = r.dimensiones.organizacion ?? [];
  const sinCorr = orgs.filter((o) => o.clave.startsWith('org-historica:'));
  const conCorr = orgs.length - sinCorr.length;
  return [
    { n: orgs.length, t: 'Organizaciones receptoras', tono: 'info', contexto: 'con prácticas en el filtro' },
    { n: conCorr, t: 'Con empresa de SIPRA', tono: 'info', contexto: sinCorr.length ? `${num(sinCorr.length)} del SGP sin correspondencia` : 'todas identificadas' },
    { n: (r.dimensiones.ciudad ?? []).length, t: 'Ciudades', tono: 'neutra', contexto: 'texto de origen (SGP) o DIVIPOLA' },
    { n: (r.dimensiones.regional ?? []).length, t: 'Regionales', tono: 'neutra', contexto: 'con prácticas en el filtro' },
  ];
}

/** Hasta tres lecturas deterministas por fuente (sin conclusiones causales), cada una solo si su base existe. */
export function lecturasFuente(r: ReporteFuentes, rotular: (codigo: string) => string = (c) => c): string[] {
  const out: string[] = [];
  const total = r.totales.practicas;
  const top = (d: 'programa' | 'modalidadPractica' | 'ciudad') => [...(r.dimensiones[d] ?? [])].sort((a, b) => b.valor - a.valor)[0];
  const p = top('programa');
  if (p && total) out.push(`${p.etiqueta} concentra el ${pct1(p.valor, total)} de las prácticas.`);
  const m = top('modalidadPractica');
  if (m && total) out.push(`La modalidad más frecuente es ${m.clave.startsWith('modalidad:') ? rotular(m.etiqueta) : m.etiqueta} (${pct1(m.valor, total)}).`);
  if (r.tasas.cierre.valor !== null) out.push(`Cierra el ${pctTasa(r.tasas.cierre)} de las prácticas finalizadas; reprueba el ${pctTasa(r.tasas.reprobacion)}.`);
  return out.slice(0, 3);
}

export function lecturasOrganizacionesFuente(r: ReporteFuentes): string[] {
  const out: string[] = [];
  const ciudades = [...(r.dimensiones.ciudad ?? [])].sort((a, b) => b.valor - a.valor);
  const total = ciudades.reduce((n, c) => n + c.valor, 0);
  if (ciudades[0] && total) out.push(`${ciudades[0].etiqueta} concentra el ${pct1(ciudades[0].valor, total)} de las prácticas con ciudad registrada.`);
  const orgs = r.dimensiones.organizacion ?? [];
  const sin = orgs.filter((o) => o.clave.startsWith('org-historica:')).reduce((n, o) => n + o.valor, 0);
  const tot = orgs.reduce((n, o) => n + o.valor, 0);
  if (sin && tot) out.push(`El ${pct1(sin, tot)} de las prácticas va a una «${ORG_SIN_CORRESPONDENCIA.toLowerCase()}».`);
  return out;
}
