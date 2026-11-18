/**
 * G6 · Distribución homogénea de estudiantes por docente facilitador (dominio puro, sin SQL ni Nest).
 *
 * Reglas:
 *  - Solo se reparten prácticas SIN docente (las asignadas no se mueven: no hay rebalanceo).
 *  - Un docente es elegible si es docente facilitador (`tutor`), está activo, tiene permiso de escritura y
 *    al menos una escuela en su alcance. Alcance vacío NO es institucional para el docente: significa «solo
 *    sus asignados» (G1/G4), así que no recibe estudiantes automáticamente.
 *  - Una práctica solo va a un docente cuyo alcance incluye la escuela de la práctica.
 *  - «Menos cargado primero»: la carga inicial es la que el docente YA tiene en el periodo (prácticas no
 *    terminales) dentro de las escuelas de su alcance; se actualiza en memoria con cada asignación.
 *  - Determinismo total: prácticas ordenadas por (escuela, programa, estudiante, id); empates de carga por
 *    (nombre normalizado, id). El orden de entrada no influye y no hay azar.
 *
 * Dos pasos: (1) voraz en orden estable; (2) mejora por caminos de reasignación entre docentes (solo prácticas
 * nuevas) hasta que ningún docente pueda ceder a otro con 2 o más de diferencia respetando el alcance. Así la
 * diferencia es ≤ 1 cuando las restricciones lo permiten, también con docentes de varias escuelas.
 *
 * Complejidad: O(P log P) para ordenar y O(P · Dₑ) para el voraz (Dₑ = docentes de la escuela, decenas); cada
 * mejora es una búsqueda en anchura sobre los docentes (O(D² · S)), y el voraz deja pocas. Con 10.000 prácticas y
 * decenas de docentes se resuelve en memoria en milisegundos a pocas décimas de segundo.
 */

export interface PracticaPorDistribuir {
  readonly id: string;
  readonly escuelaId: string;
  readonly programaId: string;
  readonly estudianteId: string;
}

export interface DocenteCandidato {
  readonly id: string;
  readonly nombre: string;
  readonly rol: string;
  readonly activo: boolean;
  readonly permiso: 'consulta' | 'escritura';
  readonly escuelas: readonly string[];
}

/** Prácticas no terminales del periodo YA asignadas, agregadas por docente y escuela. */
export interface CargaDocenteEscuela {
  readonly tutorId: string;
  readonly escuelaId: string;
  readonly cantidad: number;
}

export interface FilaDocenteDistribucion {
  readonly id: string;
  readonly nombre: string;
  readonly escuelas: readonly string[];
  readonly actual: number;
  readonly nuevos: number;
  readonly final: number;
}

export interface GrupoNoAsignable {
  readonly escuelaId: string;
  readonly cantidad: number;
  readonly motivo: string;
  readonly practicaIds: readonly string[];
}

export type MotivoExclusionDocente = 'inactivo' | 'solo_consulta' | 'sin_escuelas';

export interface DocenteExcluido {
  readonly id: string;
  readonly nombre: string;
  readonly motivo: MotivoExclusionDocente;
}

export interface ResultadoDistribucion {
  readonly asignaciones: readonly { readonly practicaId: string; readonly tutorId: string }[];
  readonly docentes: readonly FilaDocenteDistribucion[];
  readonly noAsignables: readonly GrupoNoAsignable[];
  readonly excluidos: readonly DocenteExcluido[];
}

export const MOTIVO_SIN_DOCENTE = 'No hay docentes activos con alcance compatible.';
export const ETIQUETA_EXCLUSION: Readonly<Record<MotivoExclusionDocente, string>> = {
  inactivo: 'Inhabilitado: no recibe nuevas asignaciones.',
  solo_consulta: 'Permiso de solo consulta: no acompaña prácticas.',
  sin_escuelas: 'Sin escuelas en su alcance (solo ve sus asignados).',
};

const ROL_DOCENTE = 'tutor';

export function normalizarNombre(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const agregar = (m: Map<string, string[]>, clave: string, valor: string): void => {
  const lista = m.get(clave);
  if (lista) lista.push(valor); else m.set(clave, [valor]);
};

export function ordenarPracticas(practicas: readonly PracticaPorDistribuir[]): PracticaPorDistribuir[] {
  return [...practicas].sort((a, b) =>
    comparar(a.escuelaId, b.escuelaId) || comparar(a.programaId, b.programaId)
    || comparar(a.estudianteId, b.estudianteId) || comparar(a.id, b.id));
}

function motivoExclusion(d: DocenteCandidato): MotivoExclusionDocente | null {
  if (!d.activo) return 'inactivo';
  if (d.permiso !== 'escritura') return 'solo_consulta';
  if (d.escuelas.length === 0) return 'sin_escuelas';
  return null;
}

/**
 * @param alcance escuelas del universo a distribuir; `null` = todas (coordinación institucional). Se usa para
 *   decidir qué docentes se muestran: los que tienen al menos una escuela del universo.
 */
export function distribuirDocentes(entrada: {
  practicas: readonly PracticaPorDistribuir[];
  docentes: readonly DocenteCandidato[];
  cargas: readonly CargaDocenteEscuela[];
  alcance: readonly string[] | null;
}): ResultadoDistribucion {
  const docentesOrdenados = entrada.docentes
    .filter((d) => d.rol === ROL_DOCENTE)
    .map((d) => ({ d, clave: normalizarNombre(d.nombre) }))
    .sort((a, b) => comparar(a.clave, b.clave) || comparar(a.d.id, b.d.id));

  const excluidos: DocenteExcluido[] = [];
  const elegibles: { id: string; nombre: string; clave: string; escuelas: Set<string>; actual: number; carga: number }[] = [];
  for (const { d, clave } of docentesOrdenados) {
    const relevante = entrada.alcance === null || d.escuelas.length === 0 || d.escuelas.some((e) => entrada.alcance!.includes(e));
    const motivo = motivoExclusion(d);
    if (motivo) { if (relevante) excluidos.push({ id: d.id, nombre: d.nombre, motivo }); continue; }
    const escuelas = new Set(d.escuelas);
    const actual = entrada.cargas
      .filter((c) => c.tutorId === d.id && escuelas.has(c.escuelaId))
      .reduce((s, c) => s + c.cantidad, 0);
    elegibles.push({ id: d.id, nombre: d.nombre, clave, escuelas, actual, carga: actual });
  }

  // Candidatos por escuela, en orden estable de desempate.
  const porEscuela = new Map<string, typeof elegibles>();
  const candidatosDe = (escuela: string) => {
    let lista = porEscuela.get(escuela);
    if (!lista) { lista = elegibles.filter((e) => e.escuelas.has(escuela)); porEscuela.set(escuela, lista); }
    return lista;
  };

  // 1. Voraz «menos cargado primero» en orden estable.
  const indice = new Map(elegibles.map((e, i) => [e.id, i]));
  /** nuevas[i]: escuela → prácticas NUEVAS del docente i (las existentes nunca se mueven). */
  const nuevas = elegibles.map(() => new Map<string, string[]>());
  const sinDocente = new Map<string, string[]>();
  for (const p of ordenarPracticas(entrada.practicas)) {
    const candidatos = candidatosDe(p.escuelaId);
    if (candidatos.length === 0) {
      const ids = sinDocente.get(p.escuelaId) ?? [];
      ids.push(p.id); sinDocente.set(p.escuelaId, ids);
      continue;
    }
    let mejor = candidatos[0];
    for (const c of candidatos) if (c.carga < mejor.carga) mejor = c; // empate: se queda el primero (nombre, id)
    mejor.carga += 1;
    agregar(nuevas[indice.get(mejor.id)!], p.escuelaId, p.id);
  }

  // 2. Mejora hasta el óptimo (semi-matching): mientras exista un camino de reasignación —solo de prácticas NUEVAS y
  //    respetando el alcance— desde un docente con carga L hasta otro con carga ≤ L−2, se mueve una práctica por cada
  //    tramo del camino. Cada movimiento reduce estrictamente la suma de cuadrados (termina) y, sin caminos, el reparto
  //    es óptimo para la carga máxima y la dispersión. Recorridos en orden estable: determinístico.
  const escuelasOrdenadas = (i: number) => [...nuevas[i].keys()].filter((s) => (nuevas[i].get(s)?.length ?? 0) > 0).sort();
  const buscarCamino = (origen: number): { previo: Map<number, [number, string]>; destino: number } | null => {
    const limite = elegibles[origen].carga - 2;
    const previo = new Map<number, [number, string]>();
    const visitado = new Set<number>([origen]);
    const cola = [origen];
    while (cola.length > 0) {
      const x = cola.shift()!;
      for (const s of escuelasOrdenadas(x)) {
        for (const v of candidatosDe(s)) {
          const iv = indice.get(v.id)!;
          if (visitado.has(iv)) continue;
          visitado.add(iv); previo.set(iv, [x, s]);
          if (v.carga <= limite) return { previo, destino: iv };
          cola.push(iv);
        }
      }
    }
    return null;
  };
  for (;;) {
    const origenes = elegibles.map((_, i) => i).filter((i) => nuevas[i].size > 0)
      .sort((a, b) => elegibles[b].carga - elegibles[a].carga || a - b);
    let movio = false;
    for (const o of origenes) {
      const camino = buscarCamino(o);
      if (!camino) continue;
      for (let v = camino.destino; v !== o;) {
        const [x, s] = camino.previo.get(v)!;
        const lista = nuevas[x].get(s)!;
        const practica = lista.pop()!;
        agregar(nuevas[v], s, practica);
        v = x;
      }
      elegibles[o].carga -= 1;
      elegibles[camino.destino].carga += 1;
      movio = true;
      break;
    }
    if (!movio) break;
  }

  const asignaciones: { practicaId: string; tutorId: string }[] = [];
  nuevas.forEach((m, i) => { for (const ids of m.values()) for (const id of ids) asignaciones.push({ practicaId: id, tutorId: elegibles[i].id }); });
  asignaciones.sort((a, b) => comparar(a.practicaId, b.practicaId));

  const relevantes = elegibles.filter((e) => entrada.alcance === null || [...e.escuelas].some((s) => entrada.alcance!.includes(s)));
  return {
    asignaciones,
    docentes: relevantes.map((e) => ({
      id: e.id, nombre: e.nombre, escuelas: [...e.escuelas].sort(), actual: e.actual, nuevos: e.carga - e.actual, final: e.carga,
    })),
    noAsignables: [...sinDocente.entries()].sort((a, b) => comparar(a[0], b[0]))
      .map(([escuelaId, practicaIds]) => ({ escuelaId, cantidad: practicaIds.length, motivo: MOTIVO_SIN_DOCENTE, practicaIds })),
    excluidos,
  };
}

/**
 * Texto canónico de TODO lo que decide la distribución (prácticas pendientes, docentes y su estado/alcance,
 * cargas). Si cambia cualquier dato entre la vista previa y la aplicación, cambia la huella.
 */
export function firmaCanonica(entrada: {
  periodoAcademico: string;
  alcance: readonly string[] | null;
  practicas: readonly PracticaPorDistribuir[];
  docentes: readonly DocenteCandidato[];
  cargas: readonly CargaDocenteEscuela[];
}): string {
  const p = ordenarPracticas(entrada.practicas).map((x) => `${x.id}:${x.escuelaId}`).join(',');
  const d = entrada.docentes.filter((x) => x.rol === ROL_DOCENTE).map((x) => `${x.id}:${x.activo ? 1 : 0}:${x.permiso}:${[...x.escuelas].sort().join('+')}`)
    .sort().join(',');
  const c = entrada.cargas.map((x) => `${x.tutorId}:${x.escuelaId}:${x.cantidad}`).sort().join(',');
  const a = entrada.alcance === null ? '*' : [...entrada.alcance].sort().join('+');
  return `v1|${entrada.periodoAcademico}|${a}|${p}|${d}|${c}`;
}
