import { MetricaHistorica } from '../historico/politica-calidad-historico';
import { elegibleAnalitica } from './analitica-unificada.service';
import { CategoriaUnion, ConteoDimension, FilaAnalitica, FuenteAnalitica, ResultadoAnaliticoUnificado, ValorDimension } from './modelo-analitico';

/**
 * Serving analítico (H5, §29). El histórico del SGP solo cambia al publicar una importación: se PRECOMPUTA su
 * proyección (con la elegibilidad por métrica ya resuelta) y Reportes lo agrega en SQL. La operación de SIPRA se
 * consulta en vivo. Ambas mitades producen el mismo `Agregados` y se fusionan aquí, con las reglas de H4:
 *  - las dimensiones se suman por clave segura (misma clave = misma categoría; programas sin código SINU confirmado
 *    tienen otra clave y NO se fusionan);
 *  - las tasas suman numeradores y denominadores; la duración combina histogramas (percentiles exactos);
 *  - el «Indicador documental SGP» solo viene del histórico y nunca se combina con Cumplimiento.
 */
export type DimensionAnalitica = keyof ResultadoAnaliticoUnificado['dimensiones'];
export const DIMENSIONES: readonly DimensionAnalitica[] = ['periodo', 'programa', 'nivel', 'regional', 'modalidadEstudio', 'modalidadPractica', 'estado', 'organizacion', 'ciudad'];

/** Métrica de elegibilidad de cada dimensión (la misma política H3 que usa la capa H4). */
export const METRICA_DE_DIMENSION: Readonly<Record<DimensionAnalitica, MetricaHistorica>> = {
  periodo: 'practicas_por_periodo', programa: 'programa', nivel: 'nivel', regional: 'regional', modalidadEstudio: 'modalidad_estudio',
  modalidadPractica: 'modalidad_practica', estado: 'estado', organizacion: 'organizacion', ciudad: 'ciudad',
};

/** Métricas que el serving materializa como columnas booleanas `e_*`. */
export const METRICAS_SERVING: readonly MetricaHistorica[] = [
  'practicas', 'estudiantes_unicos', 'practicas_por_periodo', 'programa', 'nivel', 'regional', 'modalidad_estudio', 'modalidad_practica',
  'estado', 'tasa_cierre', 'organizacion', 'ciudad', 'duracion', 'indicador_documental_sgp',
];

const VALOR: Readonly<Record<DimensionAnalitica, (f: FilaAnalitica) => ValorDimension | null>> = {
  periodo: (f) => f.periodo, programa: (f) => f.programa, nivel: (f) => f.nivel, regional: (f) => f.regional,
  modalidadEstudio: (f) => f.modalidadEstudio, modalidadPractica: (f) => f.modalidadPractica,
  estado: (f) => (f.estado ? { clave: f.estado, etiqueta: f.estado } : null), organizacion: (f) => f.organizacion, ciudad: (f) => f.ciudad,
};
export const valorDimension = (f: FilaAnalitica, d: DimensionAnalitica): ValorDimension | null => VALOR[d](f);

/**
 * Cruces comparables entre fuentes (§32, paridad visual de Reportes V3): los mismos que la vista Actual dibuja como
 * series temporales, bandas y composición, medidos en PRÁCTICAS (el SGP no permite estudiantes únicos por celda sin
 * una identidad común). Cada celda exige la elegibilidad de sus DOS dimensiones (misma política H3).
 */
export const CRUCES = {
  periodoPrograma: ['periodo', 'programa'],
  periodoModalidad: ['periodo', 'modalidadPractica'],
  modalidadEstado: ['modalidadPractica', 'estado'],
} as const satisfies Record<string, readonly [DimensionAnalitica, DimensionAnalitica]>;
export type CruceAnalitico = keyof typeof CRUCES;
export const NOMBRES_CRUCES = Object.keys(CRUCES) as CruceAnalitico[];

export interface CeldaCruce { fila: string; filaEtiqueta: string; columna: string; columnaEtiqueta: string; valor: number }

export interface Agregados {
  filas: number;
  practicas: number;
  estudiantes: number;
  dimensiones: Record<DimensionAnalitica, { clave: string; etiqueta: string; valor: number }[]>;
  cruces: Record<CruceAnalitico, CeldaCruce[]>;
  tasas: { denominador: number; cerrado: number; reprobado: number; anulado: number };
  /** [días, casos] */
  duracion: [number, number][];
  documentos: { casos: number; sumaSubido: number; sumaAprobado: number };
  elegibles: Partial<Record<MetricaHistorica, number>>;
}

/** Agregados de un conjunto de filas analíticas (la parte en vivo de SIPRA, y la validación del serving). */
export function agregarFilas(filas: readonly FilaAnalitica[]): Agregados & { identidades: Set<string> } {
  const dims = Object.fromEntries(DIMENSIONES.map((d) => [d, new Map<string, { etiqueta: string; valor: number }>()])) as Record<DimensionAnalitica, Map<string, { etiqueta: string; valor: number }>>;
  const elegibles: Partial<Record<MetricaHistorica, number>> = {};
  const identidades = new Set<string>();
  const duracion = new Map<number, number>();
  const tasas = { denominador: 0, cerrado: 0, reprobado: 0, anulado: 0 };
  const documentos = { casos: 0, sumaSubido: 0, sumaAprobado: 0 };
  const cruces = Object.fromEntries(NOMBRES_CRUCES.map((c) => [c, new Map<string, CeldaCruce>()])) as Record<CruceAnalitico, Map<string, CeldaCruce>>;
  let practicas = 0;
  for (const f of filas) {
    for (const c of NOMBRES_CRUCES) {
      const [dA, dB] = CRUCES[c];
      if (!elegibleAnalitica(f, METRICA_DE_DIMENSION[dA]) || !elegibleAnalitica(f, METRICA_DE_DIMENSION[dB])) continue;
      const a = VALOR[dA](f), b = VALOR[dB](f);
      if (!a || !b) continue;
      const k = `${a.clave}\u0000${b.clave}`;
      const e = cruces[c].get(k) ?? { fila: a.clave, filaEtiqueta: a.etiqueta, columna: b.clave, columnaEtiqueta: b.etiqueta, valor: 0 };
      e.valor += 1;
      cruces[c].set(k, e);
    }
    for (const m of METRICAS_SERVING) if (elegibleAnalitica(f, m)) elegibles[m] = (elegibles[m] ?? 0) + 1;
    if (elegibleAnalitica(f, 'practicas')) practicas += 1;
    if (elegibleAnalitica(f, 'estudiantes_unicos')) identidades.add(f.identidadEstudiante!);
    for (const d of DIMENSIONES) {
      if (!elegibleAnalitica(f, METRICA_DE_DIMENSION[d])) continue;
      const v = VALOR[d](f);
      if (!v) continue;
      const e = dims[d].get(v.clave) ?? { etiqueta: v.etiqueta, valor: 0 };
      e.valor += 1;
      dims[d].set(v.clave, e);
    }
    if (elegibleAnalitica(f, 'tasa_cierre')) {
      tasas.denominador += 1;
      if (f.estado === 'cerrado') tasas.cerrado += 1;
      if (f.estado === 'reprobado') tasas.reprobado += 1;
      if (f.estado === 'anulado') tasas.anulado += 1;
    }
    if (elegibleAnalitica(f, 'duracion')) duracion.set(f.duracionDias!, (duracion.get(f.duracionDias!) ?? 0) + 1);
    if (elegibleAnalitica(f, 'indicador_documental_sgp')) {
      documentos.casos += 1;
      documentos.sumaSubido += f.documentosSubidosRatio!;
      documentos.sumaAprobado += f.documentosAprobadosRatio!;
    }
  }
  return {
    filas: filas.length, practicas, estudiantes: identidades.size, identidades,
    dimensiones: Object.fromEntries(DIMENSIONES.map((d) => [d, [...dims[d]].map(([clave, e]) => ({ clave, etiqueta: e.etiqueta, valor: e.valor }))])) as Agregados['dimensiones'],
    cruces: Object.fromEntries(NOMBRES_CRUCES.map((c) => [c, [...cruces[c].values()]])) as Agregados['cruces'],
    tasas, duracion: [...duracion], documentos, elegibles,
  };
}

/** Celda de un cruce en el contrato: con la fuente de la que proviene (`comun` si ambas aportan a la misma celda). */
export interface CeldaCruceFuente extends CeldaCruce { origen: 'current' | 'historical' | 'comun' }
/** Prácticas por periodo de cada fuente (Todos: dos series sobre el mismo eje temporal). */
export interface PeriodoPorFuente { clave: string; etiqueta: string; current: number; historical: number }

/**
 * Fusión de los cruces con la misma regla que las dimensiones: se suman por par de claves seguras. Va aparte de
 * `fusionarAgregados` porque el contrato H4 (y su equivalencia exacta con H5) no los incluye.
 */
export function fusionarCruces(actual: Agregados | null, historico: Agregados | null): { cruces: Record<CruceAnalitico, CeldaCruceFuente[]>; periodoPorFuente: PeriodoPorFuente[] } {
  const cruces = {} as Record<CruceAnalitico, CeldaCruceFuente[]>;
  for (const c of NOMBRES_CRUCES) {
    const m = new Map<string, CeldaCruceFuente>();
    for (const [origen, a] of [['current', actual], ['historical', historico]] as const) {
      for (const v of a?.cruces[c] ?? []) {
        const k = `${v.fila}\u0000${v.columna}`;
        const e = m.get(k);
        if (e) { e.valor += v.valor; e.origen = e.origen === origen ? origen : 'comun'; } else m.set(k, { ...v, origen });
      }
    }
    cruces[c] = [...m.values()].filter((x) => x.valor > 0).sort((a, b) => a.fila.localeCompare(b.fila) || b.valor - a.valor || a.columna.localeCompare(b.columna));
  }
  const periodos = new Map<string, PeriodoPorFuente>();
  for (const [origen, a] of [['current', actual], ['historical', historico]] as const) {
    for (const v of a?.dimensiones.periodo ?? []) {
      const e = periodos.get(v.clave) ?? { clave: v.clave, etiqueta: v.etiqueta, current: 0, historical: 0 };
      e[origen] += v.valor;
      periodos.set(v.clave, e);
    }
  }
  return { cruces, periodoPorFuente: [...periodos.values()].sort((a, b) => a.clave.localeCompare(b.clave, 'es', { numeric: true })) };
}

function percentilHistograma(h: readonly [number, number][], p: number): number | null {
  const total = h.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  const orden = [...h].sort((a, b) => a[0] - b[0]);
  const valorEn = (k: number): number => { let acum = 0; for (const [d, n] of orden) { acum += n; if (k < acum) return d; } return orden[orden.length - 1][0]; };
  const i = (total - 1) * p;
  const a = valorEn(Math.floor(i));
  const b = valorEn(Math.ceil(i));
  return Math.round((a + (b - a) * (i - Math.floor(i))) * 10) / 10;
}

const tasa = (num: number, den: number) => ({ numerador: num, denominador: den, valor: den ? Math.round((num / den) * 10_000) / 10_000 : null });

export interface ContextoFusion {
  estudiantesUnicos: number;
  precisionEstudiantes: 'exacta' | 'cota_superior';
  estadoAl: ResultadoAnaliticoUnificado['estadoAl'];
  solapamiento: { categorias: Record<CategoriaUnion, number>; excluidosDeAll: Record<string, number> } | null;
  advertencias: string[];
}

/** Contrato final a partir de los agregados de cada fuente (cualquiera puede faltar). */
export function fusionarAgregados(fuente: FuenteAnalitica, actual: Agregados | null, historico: Agregados | null, ctx: ContextoFusion): ResultadoAnaliticoUnificado {
  const dimensiones = {} as ResultadoAnaliticoUnificado['dimensiones'];
  for (const d of DIMENSIONES) {
    const m = new Map<string, ConteoDimension>();
    for (const [origen, a] of [['current', actual], ['historical', historico]] as const) {
      for (const v of a?.dimensiones[d] ?? []) {
        const e = m.get(v.clave);
        if (e) { e.valor += v.valor; e.origen = e.origen === origen ? origen : 'comun'; } else m.set(v.clave, { clave: v.clave, etiqueta: v.etiqueta, origen, valor: v.valor });
      }
    }
    dimensiones[d] = [...m.values()].filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor || a.clave.localeCompare(b.clave));
  }
  const suma = (f: (a: Agregados) => number): number => (actual ? f(actual) : 0) + (historico ? f(historico) : 0);
  const den = suma((a) => a.tasas.denominador);
  const histo = [...(actual?.duracion ?? []), ...(historico?.duracion ?? [])];
  const docs = historico?.documentos;
  const elegibilidad: ResultadoAnaliticoUnificado['elegibilidad'] = {};
  const filas = suma((a) => a.filas);
  for (const m of METRICAS_SERVING) {
    const si = (actual?.elegibles[m] ?? 0) + (historico?.elegibles[m] ?? 0);
    elegibilidad[m] = { elegibles: si, excluidos: filas - si };
  }
  return {
    fuente,
    estadoAl: ctx.estadoAl,
    totales: { practicas: suma((a) => a.practicas), estudiantesUnicos: ctx.estudiantesUnicos, precisionEstudiantes: ctx.precisionEstudiantes },
    dimensiones,
    tasas: {
      cierre: tasa(suma((a) => a.tasas.cerrado), den),
      reprobacion: tasa(suma((a) => a.tasas.reprobado), den),
      anulacion: tasa(suma((a) => a.tasas.anulado), den),
    },
    duracion: {
      casos: histo.reduce((s, [, n]) => s + n, 0),
      p25: percentilHistograma(histo, 0.25), mediana: percentilHistograma(histo, 0.5), p75: percentilHistograma(histo, 0.75),
    },
    // Misma regla que H4: el indicador existe solo si el universo filtrado tiene alguna fila del SGP.
    indicadorDocumentalSgp: historico && historico.filas > 0 ? {
      casos: docs!.casos,
      subidoPromedio: docs!.casos ? Math.round((docs!.sumaSubido / docs!.casos) * 1000) / 1000 : null,
      aprobadoPromedio: docs!.casos ? Math.round((docs!.sumaAprobado / docs!.casos) * 1000) / 1000 : null,
    } : null,
    solapamiento: ctx.solapamiento,
    elegibilidad,
    advertencias: ctx.advertencias,
  };
}
