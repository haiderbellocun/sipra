import { Rol } from './rol.vo';

/**
 * Autorización de la revisión del certificado de Cámara de Comercio. NO amplía permisos: reproduce a quien YA decidía la Cámara
 * (`puedeDecidirDocumento`: docente, coordinación y administración deciden cualquier documento de su alcance; el auxiliar decide
 * únicamente el certificado de EPS y el acta de iniciación) y es idéntica a la del RUT.
 *
 *  · Operan (ver bandeja, tomar, revisar, decidir, liberar lo propio): docente (tutor), coordinación y administración.
 *  · Supervisan (ver supervisión, liberar la reserva de otra persona): coordinación y administración.
 *  · Estudiante: solo el estado de su propia Cámara y cargar/reemplazar. El auxiliar ve la Cámara como soporte de la ARL, pero no la
 *    decide (política vigente, sin cambios); empresa y extensión no entran.
 */
const OPERAN_REVISION_CAMARA: readonly Rol[] = [Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR];

export function puedeOperarRevisionCamara(rol: Rol): boolean {
  return OPERAN_REVISION_CAMARA.includes(rol);
}

export function esSupervisorRevisionCamara(rol: Rol): boolean {
  return rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR;
}

/** El estudiante consulta únicamente el estado humano de SU propia Cámara. */
export function puedeVerEstadoCamaraPropio(rol: Rol): boolean {
  return rol === Rol.ESTUDIANTE;
}
