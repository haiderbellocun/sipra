import { EstadoObligacion, SemaforoObligacion, diasRestantesHasta, semaforoObligacion } from '../entities/obligacion.entity';

/**
 * Cumplimiento V3 · agregación pura (sin SQL, sin Nest). Todas las reglas salen del dominio existente:
 * el semáforo de la obligación (`semaforoObligacion`) y sus estados. Aquí solo se agrupa y se ordena.
 *
 * Universo: obligaciones de prácticas no anuladas ni canceladas, en el alcance del actor. `no_aplica` NO entra en el
 * universo de «aplicables»: se informa aparte.
 * Categorías (desde el semáforo): cumplida | vencida | próxima (crítica ≤ 3 días o alerta ≤ 10 días) | en plazo
 * (más de 10 días).
 */
export type CategoriaCumplimiento = 'cumplida' | 'vencida' | 'proxima' | 'en_plazo';

export function categoriaDe(semaforo: SemaforoObligacion): CategoriaCumplimiento {
  switch (semaforo) {
    case 'cumplida': return 'cumplida';
    case 'vencida': return 'vencida';
    case 'critica': case 'alerta': return 'proxima';
    default: return 'en_plazo';
  }
}

export interface ObligacionClasificada<T> {
  fila: T;
  semaforo: SemaforoObligacion;
  categoria: CategoriaCumplimiento;
  diasRestantes: number;
}

export function clasificar<T extends { estado: EstadoObligacion; fechaLimite: Date }>(filas: readonly T[], ahora: Date): {
  aplicables: ObligacionClasificada<T>[]; noAplica: number;
} {
  const aplicables: ObligacionClasificada<T>[] = [];
  let noAplica = 0;
  for (const fila of filas) {
    if (fila.estado === EstadoObligacion.NO_APLICA) { noAplica += 1; continue; }
    const semaforo = semaforoObligacion(fila.estado, fila.fechaLimite, ahora);
    aplicables.push({ fila, semaforo, categoria: categoriaDe(semaforo), diasRestantes: diasRestantesHasta(fila.fechaLimite, ahora) });
  }
  return { aplicables, noAplica };
}

export interface ResumenCumplimiento {
  aplicables: number;
  cumplidas: number;
  enPlazo: number;
  proximas: number;
  vencidas: number;
  noAplica: number;
}

export function resumir(aplicables: readonly { categoria: CategoriaCumplimiento }[], noAplica: number): ResumenCumplimiento {
  const r: ResumenCumplimiento = { aplicables: aplicables.length, cumplidas: 0, enPlazo: 0, proximas: 0, vencidas: 0, noAplica };
  for (const o of aplicables) {
    if (o.categoria === 'cumplida') r.cumplidas += 1;
    else if (o.categoria === 'vencida') r.vencidas += 1;
    else if (o.categoria === 'proxima') r.proximas += 1;
    else r.enPlazo += 1;
  }
  return r;
}

/** Desglose por tipo de obligación (mismas categorías). Orden: más vencidas primero; luego por tipo. */
export function porTipo<T extends { tipo: string }>(aplicables: readonly ObligacionClasificada<T>[]): (Omit<ResumenCumplimiento, 'noAplica'> & { tipo: string })[] {
  const mapa = new Map<string, ObligacionClasificada<T>[]>();
  for (const o of aplicables) {
    const lista = mapa.get(o.fila.tipo);
    if (lista) lista.push(o); else mapa.set(o.fila.tipo, [o]);
  }
  return [...mapa.entries()]
    .map(([tipo, lista]) => { const r = resumir(lista, 0); return { tipo, aplicables: r.aplicables, cumplidas: r.cumplidas, enPlazo: r.enPlazo, proximas: r.proximas, vencidas: r.vencidas }; })
    .sort((a, b) => b.vencidas - a.vencidas || b.proximas - a.proximas || (a.tipo < b.tipo ? -1 : 1));
}

const PRIORIDAD: Readonly<Record<CategoriaCumplimiento, number>> = { vencida: 0, proxima: 1, en_plazo: 2, cumplida: 3 };

/**
 * Orden operativo: vencidas (la más antigua primero) → próximas (la más cercana primero) → en plazo → cumplidas;
 * desempate estable por id de obligación.
 */
export function ordenOperativo<T extends { obligacionId: string; fechaLimite: Date }>(a: ObligacionClasificada<T>, b: ObligacionClasificada<T>): number {
  return PRIORIDAD[a.categoria] - PRIORIDAD[b.categoria]
    || a.fila.fechaLimite.getTime() - b.fila.fechaLimite.getTime()
    || (a.fila.obligacionId < b.fila.obligacionId ? -1 : a.fila.obligacionId > b.fila.obligacionId ? 1 : 0);
}

/** «Requiere atención»: vencidas y próximas a vencer (≤ 10 días). Las pendientes en plazo y las cumplidas no. */
export function requiereAtencion(c: CategoriaCumplimiento): boolean {
  return c === 'vencida' || c === 'proxima';
}
