import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { CLAVE_AUTENTICADO, CLAVE_PUBLICO, CLAVE_ROLES } from './roles.decorator';

/**
 * Autorización por rol, con política obligatoria: cada ruta debe declarar
 * `@Publico`, `@Autenticado` o `@Roles`. Una ruta que no declara nada se
 * rechaza (falla cerrada) en lugar de quedar abierta a cualquier sesión.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly log = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const objetivos = [contexto.getHandler(), contexto.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, objetivos)) return true;

    const requeridos = this.reflector.getAllAndOverride<Rol[]>(CLAVE_ROLES, objetivos);
    const autenticado = this.reflector.getAllAndOverride<boolean>(CLAVE_AUTENTICADO, objetivos);

    if (!requeridos?.length && !autenticado) {
      this.log.error(
        `Ruta sin política de acceso declarada: ${contexto.getClass().name}.${contexto.getHandler().name}`,
      );
      throw new ForbiddenException('Su perfil no tiene acceso a esta operación');
    }
    if (!requeridos?.length) return true;

    const request = contexto.switchToHttp().getRequest<{ actor?: Actor }>();
    if (!request.actor || !requeridos.includes(request.actor.rol)) {
      throw new ForbiddenException('Su perfil no tiene acceso a esta operación');
    }
    return true;
  }
}
