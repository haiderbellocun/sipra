import { EstadoMapeo, claveTexto } from './normalizacion-sgp';

/**
 * Equivalencia programa SGP → código SINU (§27.4). Es una decisión INSTITUCIONAL: se declara en un archivo
 * versionable sin datos personales (`config/historico/programas-sgp.json`) y solo cuenta cuando está `confirmado`.
 * Nunca se asigna un código por similitud de texto: la similitud solo produce SUGERENCIAS para quien decide.
 */
export type EstadoEquivalencia = 'pendiente' | 'confirmado';

export interface EquivalenciaPrograma {
  /** Nombre normalizado (`claveTexto`) tal como lo produce el importador. */
  programaSgp: string;
  codigoSinu: string | null;
  estado: EstadoEquivalencia;
  /** Quién y cuándo lo aprobó (sin datos personales: un rol o una referencia de acta). */
  aprobadoPor?: string | null;
  notas?: string | null;
}

export interface EquivalenciasProgramas {
  version: string;
  programas: ReadonlyMap<string, EquivalenciaPrograma>;
}

export class EquivalenciasProgramasInvalidasError extends Error {
  constructor(motivo: string) {
    super(`Equivalencias de programas no válidas: ${motivo}`);
    this.name = 'EquivalenciasProgramasInvalidasError';
  }
}

const CODIGO_SINU = /^[A-Z0-9][A-Z0-9-]{1,29}$/;

/** Valida la configuración: claves canónicas, sin duplicados, y código obligatorio (y bien formado) si está confirmado. */
export function validarEquivalenciasProgramas(datos: unknown): EquivalenciasProgramas {
  if (!datos || typeof datos !== 'object') throw new EquivalenciasProgramasInvalidasError('no es un objeto');
  const d = datos as { version?: unknown; programas?: unknown };
  if (typeof d.version !== 'string' || !d.version.trim()) throw new EquivalenciasProgramasInvalidasError('falta «version»');
  if (!Array.isArray(d.programas)) throw new EquivalenciasProgramasInvalidasError('«programas» debe ser una lista');
  const mapa = new Map<string, EquivalenciaPrograma>();
  for (const [n, e] of (d.programas as Record<string, unknown>[]).entries()) {
    const nombre = typeof e.programaSgp === 'string' ? e.programaSgp : '';
    const canonico = claveTexto(nombre);
    if (!canonico || canonico !== nombre) throw new EquivalenciasProgramasInvalidasError(`entrada ${n}: «programaSgp» debe estar normalizado (${canonico ?? 'vacío'})`);
    if (mapa.has(canonico)) throw new EquivalenciasProgramasInvalidasError(`entrada ${n}: programa repetido «${canonico}»`);
    const estado = e.estado;
    if (estado !== 'pendiente' && estado !== 'confirmado') throw new EquivalenciasProgramasInvalidasError(`entrada ${n}: estado debe ser «pendiente» o «confirmado»`);
    if (e.codigoSinu !== null && e.codigoSinu !== undefined && typeof e.codigoSinu !== 'string') {
      throw new EquivalenciasProgramasInvalidasError(`entrada ${n}: «codigoSinu» debe ser texto o null`);
    }
    const codigo = typeof e.codigoSinu === 'string' ? e.codigoSinu : null;
    if (estado === 'confirmado' && (!codigo || !CODIGO_SINU.test(codigo))) {
      throw new EquivalenciasProgramasInvalidasError(`entrada ${n}: un programa confirmado exige un código SINU válido`);
    }
    if (estado === 'pendiente' && codigo) throw new EquivalenciasProgramasInvalidasError(`entrada ${n}: un programa pendiente no lleva código`);
    mapa.set(canonico, {
      programaSgp: canonico, codigoSinu: codigo, estado,
      aprobadoPor: typeof e.aprobadoPor === 'string' ? e.aprobadoPor : null, notas: typeof e.notas === 'string' ? e.notas : null,
    });
  }
  return { version: d.version, programas: mapa };
}

/** Código SINU solo si la equivalencia está confirmada; en otro caso, pendiente institucional (nunca adivinado). */
export function resolverPrograma(programaNormalizado: string | null, eq?: EquivalenciasProgramas): { codigoSinu: string | null; estado: EstadoMapeo } {
  if (!programaNormalizado) return { codigoSinu: null, estado: 'MISSING' };
  const e = eq?.programas.get(programaNormalizado);
  if (e?.estado === 'confirmado' && e.codigoSinu) return { codigoSinu: e.codigoSinu, estado: 'MAPPED' };
  return { codigoSinu: null, estado: 'PENDING_INSTITUTIONAL_MAPPING' };
}

const tokens = (s: string): Set<string> => new Set(s.split(' ').filter((t) => t.length > 2 && !['DE', 'DEL', 'LA', 'LOS', 'LAS', 'Y', 'EN'].includes(t)));

/** Similitud de Jaccard sobre palabras: SOLO para sugerir. */
export function similitudProgramas(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}

export interface EntradaInventarioPrograma {
  programaSgp: string;
  frecuencia: number;
  niveles: Record<string, number>;
  regionales: number;
  pensums: string[];
  estadoEquivalencia: EstadoEquivalencia | 'sin_entrada';
  codigoSinu: string | null;
  /** Otros nombres del inventario que se le parecen: para revisar posibles renombramientos. Nunca se aplican. */
  sugerencias: { programaSgp: string; similitud: number }[];
}

export function inventarioProgramas(
  filas: readonly { programaNormalizado: string | null; nivelInferido: string | null; regional: string | null; pensum: string | null }[],
  eq?: EquivalenciasProgramas,
): EntradaInventarioPrograma[] {
  const acc = new Map<string, { n: number; niveles: Map<string, number>; regionales: Set<string>; pensums: Map<string, number> }>();
  for (const f of filas) {
    if (!f.programaNormalizado) continue;
    if (!acc.has(f.programaNormalizado)) acc.set(f.programaNormalizado, { n: 0, niveles: new Map(), regionales: new Set(), pensums: new Map() });
    const a = acc.get(f.programaNormalizado)!;
    a.n += 1;
    const nivel = f.nivelInferido ?? 'desconocido';
    a.niveles.set(nivel, (a.niveles.get(nivel) ?? 0) + 1);
    if (f.regional) a.regionales.add(f.regional);
    if (f.pensum) a.pensums.set(f.pensum, (a.pensums.get(f.pensum) ?? 0) + 1);
  }
  const nombres = [...acc.keys()];
  return [...acc.entries()].sort((x, y) => y[1].n - x[1].n).map(([nombre, a]) => {
    const e = eq?.programas.get(nombre);
    return {
      programaSgp: nombre,
      frecuencia: a.n,
      niveles: Object.fromEntries(a.niveles),
      regionales: a.regionales.size,
      pensums: [...a.pensums.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => p),
      estadoEquivalencia: e?.estado ?? 'sin_entrada',
      codigoSinu: e?.estado === 'confirmado' ? e.codigoSinu : null,
      sugerencias: nombres.filter((o) => o !== nombre).map((o) => ({ programaSgp: o, similitud: Math.round(similitudProgramas(nombre, o) * 100) / 100 }))
        .filter((s) => s.similitud >= 0.5).sort((x, y) => y.similitud - x.similitud),
    };
  });
}
