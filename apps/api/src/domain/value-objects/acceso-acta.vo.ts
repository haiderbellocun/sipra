import { Rol } from './rol.vo';

/**
 * Autorización de la Mesa de Actas de Iniciación (independiente de la de EPS).
 *
 *  · Operan (ver bandeja, tomar, revisar, decidir, liberar lo propio): auxiliar, coordinación y administración.
 *  · Supervisan (ver supervisión, liberar la reserva de otra persona): coordinación y administración.
 *  · Corrigen los datos de la práctica que gobiernan la comparación (remuneración, responsable de la ARL) cuando ya
 *    hay un acta cargada: coordinación y administración, con justificación y auditoría.
 *  · Estudiante: solo el estado de su propia acta. Docente, empresa y extensión: ninguna operación.
 */
const OPERAN_MESA_ACTAS: readonly Rol[] = [Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR];

export function puedeOperarMesaActas(rol: Rol): boolean {
  return OPERAN_MESA_ACTAS.includes(rol);
}

export function esSupervisorMesaActas(rol: Rol): boolean {
  return rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR;
}

export function puedeCorregirDatosConActa(rol: Rol): boolean {
  return rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR;
}

export function puedeVerEstadoActaPropio(rol: Rol): boolean {
  return rol === Rol.ESTUDIANTE;
}
