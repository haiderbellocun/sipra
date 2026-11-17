import { ForbiddenException } from '@nestjs/common';
import { Rol, escuelasDeCoordinacion } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

/** Perfiles que generan reportes (SGP y analítica). */
export const ROLES_REPORTES: readonly Rol[] = [Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR, Rol.TUTOR];

export function exigirReportes(actor: Actor): void {
  if (!ROLES_REPORTES.includes(actor.rol)) throw new ForbiddenException('Su perfil no genera reportes del SGP');
}

/**
 * Alcance de los reportes, el mismo para todos: el docente ve las escuelas a las que pertenece y la coordinación de escuela
 * las suyas (la coordinación general, sin escuelas, ve todo). Se aplica acotando la consulta, igual que en la bandeja.
 */
export function escuelasDeReportes(actor: Actor): readonly string[] | undefined {
  switch (actor.rol) {
    case Rol.TUTOR:
      return actor.escuelas;
    case Rol.COORDINADOR:
    case Rol.ANALISTA:
    case Rol.DIRECTOR:
      return escuelasDeCoordinacion(actor) ?? undefined;
    default:
      return undefined;
  }
}
