import { TipoDocumento } from '../entities/documento.entity';
import { Rol } from './rol.vo';

/**
 * Autorización específica de la validación del certificado de EPS.
 *
 * El auxiliar participa en esta validación SOLO sobre `certificado_eps`: no
 * gana ninguna capacidad genérica sobre otros tipos documentales. Coordinación
 * y administración también operan. El docente conserva lo que ya hacía con los
 * documentos (decidirlos), pero no se le amplían las funciones operativas nuevas
 * de EPS. Estudiante: solo ve el resultado que le corresponde. Empresa y
 * extensión: ninguno.
 */

const OPERAN_VALIDACION_EPS: readonly Rol[] = [Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR];

/** Quién consulta evidencia, toma casos (reserva) y los opera. */
export function puedeOperarValidacionEps(rol: Rol): boolean {
  return OPERAN_VALIDACION_EPS.includes(rol);
}

/** Supervisores: pueden liberar la reserva de otro funcionario. */
export function esSupervisorEps(rol: Rol): boolean {
  return rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR;
}

/** Quién ve el resultado de la validación (el estudiante, el suyo y reducido). */
export function puedeVerResultadoEps(rol: Rol): boolean {
  return rol === Rol.ESTUDIANTE || puedeOperarValidacionEps(rol);
}

/**
 * ¿Puede decidir (aprobar, devolver, rechazar) un documento de este tipo?
 * Docente, coordinación y administración: cualquiera. Auxiliar: únicamente el
 * certificado de EPS.
 */
export function puedeDecidirDocumento(rol: Rol, tipo: TipoDocumento): boolean {
  if (rol === Rol.TUTOR || rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR) return true;
  // El auxiliar decide el certificado de EPS y el acta de iniciación (esta última solo desde la Mesa de Actas).
  return rol === Rol.AUXILIAR && (tipo === TipoDocumento.CERTIFICADO_EPS || tipo === TipoDocumento.ACTA_INICIO);
}

/** Puntaje, banderas y lectura asistida del documento: los ve quien revisa ese tipo. */
export function puedeVerLecturaInterna(rol: Rol, tipo: TipoDocumento): boolean {
  if (rol === Rol.TUTOR || rol === Rol.COORDINADOR || rol === Rol.ADMINISTRADOR) return true;
  return rol === Rol.AUXILIAR && tipo === TipoDocumento.CERTIFICADO_EPS;
}
