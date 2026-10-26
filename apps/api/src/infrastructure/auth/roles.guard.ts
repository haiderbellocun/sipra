import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { CLAVE_PUBLICO, CLAVE_ROLES } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      contexto.getHandler(), contexto.getClass(),
    ]);
    if (publico) return true;

    const requeridos = this.reflector.getAllAndOverride<Rol[]>(CLAVE_ROLES, [
      contexto.getHandler(), contexto.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const request = contexto.switchToHttp().getRequest<{ actor?: Actor }>();
    if (!request.actor || !requeridos.includes(request.actor.rol)) {
      throw new ForbiddenException('Su perfil no tiene acceso a esta operación');
    }
    return true;
  }
}
