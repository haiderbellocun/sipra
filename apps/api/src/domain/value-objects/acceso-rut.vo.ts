import { Rol } from './rol.vo';

/**
 * Autorización de la revisión del RUT (Bloque 4). NO amplía permisos: reproduce a quien YA decide el RUT en el sistema
 * (`puedeDecidirDocumento`: docente, coordinación y administración deciden cualquier documento de su alcance; el auxiliar
 * decide únicamente el certificado de EPS y el acta de iniciación, no el RUT).
 *
 *  · Operan (ver bandeja, tomar, revisar, decidir, liberar lo propio): docente (tutor), coordinación y administración.
 *  · Supervisan (ver supervisión, liberar la reserva de otra persona): coordinación y administración.
 *  · Estudiante: solo el estado de su propio RUT y cargar/reemplazar. Auxiliar (que ve el RUT como soporte de la ARL),
 *    empresa y extensión: no deciden.
 */
const OPERAN_REVISION_RUT: readonly Rol[] = [Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR];

export function puedeOperarRevisionRut(rol: Rol): boolean {
  return OPERAN_REVISION_RUT.includes(rol);
}

export function esSupervisorRevisionRut(rol: Rol): boolean {
  return rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR;
}

/** El estudiante consulta únicamente el estado humano de SU propio RUT. */
export function puedeVerEstadoRutPropio(rol: Rol): boolean {
  return rol === Rol.ESTUDIANTE;
}
