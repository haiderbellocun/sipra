import type { MotorDocumental } from '../services/expediente-documental.domain-service';
import { esSupervisorMesaActas, puedeOperarMesaActas } from './acceso-acta.vo';
import { esSupervisorRevisionCamara, puedeOperarRevisionCamara } from './acceso-camara.vo';
import { esSupervisorEps, puedeOperarValidacionEps } from './acceso-eps.vo';
import { esSupervisorRevisionRut, puedeOperarRevisionRut } from './acceso-rut.vo';
import { Rol } from './rol.vo';

/**
 * Autorización de la Mesa de Validación Documental. NO define permisos propios: DELEGA en los de cada motor, así que una persona
 * no gana acceso a un documento por poder ver el expediente. Entra a la Mesa quien opera al menos un motor; dentro, cada documento
 * se opera solo si su rol opera el motor de ese documento.
 */

export function puedeOperarMotor(motor: Exclude<MotorDocumental, 'general'>, rol: Rol): boolean {
  switch (motor) {
    case 'eps': return puedeOperarValidacionEps(rol);
    case 'acta': return puedeOperarMesaActas(rol);
    case 'rut': return puedeOperarRevisionRut(rol);
    case 'camara': return puedeOperarRevisionCamara(rol);
  }
}

const MOTORES: readonly Exclude<MotorDocumental, 'general'>[] = ['eps', 'acta', 'rut', 'camara'];

/** Entra quien opera algún motor (docente, auxiliar, coordinación o administración). */
export function puedeUsarValidacionDocumental(rol: Rol): boolean {
  return MOTORES.some((m) => puedeOperarMotor(m, rol));
}

/** Supervisa quien supervisa los motores (coordinación y administración). */
export function esSupervisorValidacionDocumental(rol: Rol): boolean {
  return esSupervisorEps(rol) || esSupervisorMesaActas(rol) || esSupervisorRevisionRut(rol) || esSupervisorRevisionCamara(rol);
}
