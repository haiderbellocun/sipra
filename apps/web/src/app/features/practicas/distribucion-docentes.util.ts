import { Periodo, ResultadoDistribucion, Rol, VistaPreviaDistribucion } from '@core/models/modelos';

/**
 * G6 · Presentación de la distribución de estudiantes por docente facilitador. El servidor autoriza (coordinación y
 * analista), calcula y aplica; aquí solo se arma lo que se muestra.
 */

/** Solo coordinación y analista distribuyen (administración y dirección no). */
export function puedeDistribuir(rol: Rol | null): boolean {
  return rol === 'coordinador' || rol === 'analista';
}

/** El periodo del filtro si lo hay; si no, el vigente; si no, el primer periodo activo. Nunca «todos». */
export function periodoPorDefecto(periodos: readonly Periodo[], filtro: string): string {
  if (filtro && periodos.some((p) => p.codigo === filtro)) return filtro;
  return periodos.find((p) => p.vigente)?.codigo ?? periodos.find((p) => p.activo)?.codigo ?? periodos[0]?.codigo ?? '';
}

/** Escuelas que el actor puede elegir: las de su alcance o, sin escuelas (institucional), todas las del catálogo. */
export function escuelasElegibles<T extends { codigo: string }>(catalogo: readonly T[], propias: readonly string[]): T[] {
  return propias.length === 0 ? [...catalogo] : catalogo.filter((e) => propias.includes(e.codigo));
}

export function textoConfirmacion(v: Pick<VistaPreviaDistribucion, 'asignables' | 'docentes'>): string {
  const docentes = v.docentes.filter((d) => d.nuevos > 0).length;
  const est = v.asignables === 1 ? '1 estudiante' : `${v.asignables} estudiantes`;
  const doc = docentes === 1 ? '1 docente facilitador' : `${docentes} docentes facilitadores`;
  return `Se asignarán ${est} a ${doc}. Las asignaciones existentes no serán modificadas.`;
}

export function textoResultado(r: ResultadoDistribucion): string {
  return `Distribución completada: ${r.asignados} asignado(s) a ${r.docentes} docente(s)` +
    (r.sinDocenteCompatible > 0 ? `; ${r.sinDocenteCompatible} sin docente compatible.` : '.');
}

export const MENSAJE_OBSOLETA = 'Las asignaciones cambiaron desde la vista previa. Genera una nueva distribución.';

/** 409 del servidor: la vista previa quedó obsoleta. */
export function esPreviaObsoleta(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 409;
}

/** Diferencia de carga final entre docentes (para mostrar el equilibrio logrado). */
export function diferenciaFinal(v: Pick<VistaPreviaDistribucion, 'docentes'>): number {
  const f = v.docentes.map((d) => d.final);
  return f.length === 0 ? 0 : Math.max(...f) - Math.min(...f);
}
