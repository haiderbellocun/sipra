import {
  CategoriaUnion, ConteoFuente, DimensionFuente, EstadoAnalitico, FuenteReporte, ReporteFuentes, TasaFuente,
} from '@core/models/reportes-fuentes.model';
import { ItemBarra, nivel } from './reportes-analitica.util';

export type { CategoriaUnion, ConteoFuente, DimensionFuente, EstadoAnalitico, FuenteReporte, ReporteFuentes, TasaFuente };

/**
 * Reportes V3 por fuente (H5). «Actual» es la vista operativa de siempre (expediente de SIPRA, sin cambios); «Histórico» y
 * «Todos» leen el serving analítico del SGP por `GET /reportes/analitica/unificada`. Todo lo que se calcula aquí es
 * presentación: las cifras, la deduplicación y el alcance los resuelve el servidor.
 */

/** Rótulos humanos del selector (nunca los códigos técnicos). */
export const FUENTES_REPORTE: readonly { id: FuenteReporte; texto: string; ayuda: string }[] = [
  { id: 'current', texto: 'Actual', ayuda: 'Prácticas registradas en SIPRA, en vivo' },
  { id: 'historical', texto: 'Histórico', ayuda: 'Archivo del SGP anterior a SIPRA, con fecha de corte' },
  { id: 'all', texto: 'Todos', ayuda: 'Actual e Histórico juntos; un mismo proceso solo se cuenta una vez si está confirmado' },
];
export const rotuloFuente = (f: FuenteReporte): string => FUENTES_REPORTE.find((x) => x.id === f)?.texto ?? f;

/** Filtros de la vista por fuente: claves seguras del modelo común (las de la operación no aplican al SGP). */
export interface FiltrosFuente {
  periodos: string[]; programa: string; nivel: string; regional: string; modalidadEstudio: string;
  modalidadPractica: string; estado: '' | EstadoAnalitico; organizacion: string; ciudad: string;
}
export const FILTROS_FUENTE_VACIOS: FiltrosFuente = {
  periodos: [], programa: '', nivel: '', regional: '', modalidadEstudio: '', modalidadPractica: '', estado: '', organizacion: '', ciudad: '',
};

/** Parámetros HTTP: la fuente siempre explícita; vacíos fuera. La escuela solo viaja si el usuario la eligió. */
export function parametrosFuente(fuente: FuenteReporte, f: FiltrosFuente, escuela = ''): Record<string, string> {
  const p: Record<string, string> = { source: fuente };
  if (f.periodos.length) p['periodos'] = f.periodos.join(',');
  if (escuela) p['escuela'] = escuela;
  for (const k of ['programa', 'nivel', 'regional', 'modalidadEstudio', 'modalidadPractica', 'estado', 'organizacion', 'ciudad'] as const) if (f[k]) p[k] = f[k];
  return p;
}
export const cantidadFiltrosFuente = (f: FiltrosFuente): number =>
  (f.periodos.length ? 1 : 0) + (['programa', 'nivel', 'regional', 'modalidadEstudio', 'modalidadPractica', 'estado', 'organizacion', 'ciudad'] as const).filter((k) => !!f[k]).length;

/**
 * Pestañas en Histórico/Todos. General, Organizaciones y Períodos tienen una lectura común; Estudiantes y Documentos se
 * basan en el expediente de SIPRA (obligaciones, versiones, revisores), que el SGP no tiene: se dice, no se rellena con
 * ceros. Exportaciones son regulatorias y siempre de la operación actual.
 */
export type CompatibilidadVista = 'comun' | 'solo_actual' | 'regulatoria';
export const COMPATIBILIDAD_VISTA: Record<'general' | 'estudiantes' | 'organizaciones' | 'documentos' | 'periodos' | 'exportaciones', CompatibilidadVista> = {
  general: 'comun', organizaciones: 'comun', periodos: 'comun', estudiantes: 'solo_actual', documentos: 'solo_actual', exportaciones: 'regulatoria',
};

const ESTADOS: Record<EstadoAnalitico, string> = { inscrito: 'Inscrito', en_practica: 'En práctica', cerrado: 'Cerrado', reprobado: 'Reprobado', anulado: 'Anulado' };
export const etiquetaEstado = (e: string): string => ESTADOS[e as EstadoAnalitico] ?? e;
export const ORIGEN_TEXTO: Record<ConteoFuente['origen'], string> = { comun: 'Actual e Histórico', current: 'Solo Actual', historical: 'Solo Histórico (SGP)' };
export const ORG_SIN_CORRESPONDENCIA = 'Organización histórica sin correspondencia';
const PREFIJO_ORG_HISTORICA = 'org-historica:';
export const CLAVE_ORG_SIN_CORRESPONDENCIA = 'org-historica:*';

/**
 * Una dimensión como barras. Las organizaciones del SGP sin correspondencia confirmada con una empresa de SIPRA se agrupan
 * en UNA barra no filtrable: su nombre no se muestra ni se infiere, solo cuántas son.
 */
export function barrasDimension(r: ReporteFuentes, d: DimensionFuente, rotular: (codigo: string) => string = (c) => c): ItemBarra[] {
  const lista = r.dimensiones[d] ?? [];
  // Las claves de SIPRA traen el código operativo (`modalidad:pasantia`): se muestra con el mismo rótulo de la vista Actual.
  const texto = (c: ConteoFuente): string => (d === 'estado' ? etiquetaEstado(c.clave) : d === 'nivel' ? nivel(c.clave)
    : c.clave.startsWith('modalidad:') ? rotular(c.etiqueta) : c.etiqueta);
  const detalle = (c: ConteoFuente): string[] => (r.fuente === 'all' ? [ORIGEN_TEXTO[c.origen]] : []);
  if (d !== 'organizacion') return [...lista].sort((a, b) => b.valor - a.valor).map((c) => ({ clave: c.clave, texto: texto(c), n: c.valor, detalle: detalle(c) }));
  const sinCorr = lista.filter((c) => c.clave.startsWith(PREFIJO_ORG_HISTORICA));
  const items: ItemBarra[] = lista.filter((c) => !c.clave.startsWith(PREFIJO_ORG_HISTORICA)).map((c) => ({ clave: c.clave, texto: c.etiqueta, n: c.valor, detalle: detalle(c) }));
  if (sinCorr.length) {
    items.push({ clave: CLAVE_ORG_SIN_CORRESPONDENCIA, texto: ORG_SIN_CORRESPONDENCIA, n: sinCorr.reduce((n, c) => n + c.valor, 0),
      detalle: [`${sinCorr.length} organizacion${sinCorr.length === 1 ? '' : 'es'} del SGP aún sin correspondencia confirmada`], tono: 'muted' });
  }
  return items.sort((a, b) => b.n - a.n);
}

/** Periodos en orden académico (año y luego código), no por volumen. */
export function periodosOrdenados(r: ReporteFuentes): ItemBarra[] {
  return [...(r.dimensiones.periodo ?? [])].sort((a, b) => a.clave.localeCompare(b.clave, 'es', { numeric: true }))
    .map((c) => ({ clave: c.clave, texto: c.etiqueta, n: c.valor, detalle: r.fuente === 'all' ? [ORIGEN_TEXTO[c.origen]] : [] }));
}

export const fecha = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  // Una fecha sin hora (AAAA-MM-DD) es un día calendario: no se desplaza a la hora de Colombia (sería el día anterior).
  const zona = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : 'America/Bogota';
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', timeZone: zona });
};

/** Rango temporal visible de cada fuente presente en la respuesta. */
export function rangos(r: ReporteFuentes): { fuente: string; texto: string; ayuda: string }[] {
  const out: { fuente: string; texto: string; ayuda: string }[] = [];
  const a = r.cobertura.actual, h = r.cobertura.historico;
  if (a) out.push({ fuente: 'Actual', texto: [fecha(a.desde), fecha(a.hasta) ?? 'hoy'].filter(Boolean).join(' – ') || 'sin prácticas', ayuda: 'Estado vigente en SIPRA al momento del cálculo.' });
  if (h) {
    out.push({
      fuente: 'Histórico',
      texto: `${fecha(h.desde) ?? 'sin fecha'} – corte ${fecha(h.corte) ?? 'sin fecha'}`,
      ayuda: `Estado al corte del archivo SGP${h.corte ? ` (${fecha(h.corte)})` : ''}: una práctica abierta en ese momento puede haber cambiado después y no entra en las tasas.`,
    });
  }
  return out;
}

/** Avisos del servidor en lenguaje claro (los códigos técnicos no se muestran). */
export function avisosFuente(r: ReporteFuentes): string[] {
  const out: string[] = [];
  if (r.cobertura.historicoFueraDeAlcance > 0) {
    out.push(`${r.cobertura.historicoFueraDeAlcance.toLocaleString('es-CO')} registros históricos no se atribuyen a su alcance: el SGP no registra escuela y aún no tienen equivalencia académica confirmada.`);
  }
  if (r.cobertura.historicoSinEquivalenciaPrograma > 0 && r.fuente !== 'current') {
    out.push(`${r.cobertura.historicoSinEquivalenciaPrograma.toLocaleString('es-CO')} registros históricos se muestran con el programa del SGP: aún no tienen equivalencia confirmada con SINU.`);
  }
  if (r.totales.precisionEstudiantes === 'cota_superior') {
    out.push('Estudiantes únicos en Todos es una cota superior: sin la identidad común configurada, un estudiante presente en ambas fuentes puede contarse dos veces.');
  }
  return out;
}

/** Cómo se unieron las fuentes (solo Todos). */
export function lecturaSolape(r: ReporteFuentes): { clave: CategoriaUnion; texto: string; n: number; ayuda: string }[] {
  const c = r.solapamiento?.categorias;
  if (!c) return [];
  return [
    { clave: 'current_only', texto: 'Solo Actual', n: c.current_only, ayuda: 'Prácticas de SIPRA sin registro equivalente en el SGP.' },
    { clave: 'historical_only', texto: 'Solo Histórico', n: c.historical_only, ayuda: 'Registros del SGP sin práctica equivalente en SIPRA.' },
    { clave: 'matched', texto: 'Unidas (confirmadas)', n: c.matched, ayuda: 'Mismo proceso con correspondencia confirmada por una persona: se cuenta una vez, con el dato de SIPRA.' },
    { clave: 'candidate_overlap', texto: 'Posibles coincidencias', n: c.candidate_overlap, ayuda: 'Parecen el mismo proceso pero no están confirmadas: se cuentan en ambas fuentes.' },
    { clave: 'ambiguous_overlap', texto: 'Ambiguas', n: c.ambiguous_overlap, ayuda: 'Más de un candidato posible: se cuentan en ambas fuentes hasta una revisión.' },
  ];
}

/** Error del servidor en lenguaje claro: un 503 del histórico no es una falla de la vista Actual. */
export function mensajeErrorFuente(estado: number | null, texto: string): string {
  if (estado === 503 || /SERVING_HISTORICO_NO_DISPONIBLE/.test(texto)) return 'El histórico no está disponible en este momento. La vista Actual sigue funcionando.';
  if (estado === 403) return 'Su perfil no tiene acceso a esta vista.';
  return texto || 'No fue posible calcular el reporte.';
}

export const pctTasa = (t: TasaFuente): string => (t.valor === null ? 'Sin base' : `${(t.valor * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);
export const pctRatio = (v: number | null): string => (v === null ? 'Sin base' : `${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);
