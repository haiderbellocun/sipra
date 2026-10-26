import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { CLAVE_PUBLICO } from './roles.decorator';

/**
 * Permiso de solo consulta (SGP, gestión de usuarios).
 *
 * Un usuario administrativo creado con permiso «consulta» visualiza los
 * registros, pero no valida ni registra observaciones. La regla se aplica en
 * un solo lugar, sobre el método HTTP: cualquier operación que escriba
 * —POST, PUT, PATCH, DELETE— queda cerrada, sin depender de que cada
 * controlador lo recuerde.
 */
@Injectable()
export class PermisoEscrituraGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      contexto.getHandler(), contexto.getClass(),
    ]);
    if (publico) return true;

    const request = contexto.switchToHttp().getRequest<{ method: string; actor?: Actor }>();
    if (!request.actor || request.actor.permiso !== 'consulta') return true;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;

    throw new ForbiddenException(
      'Su usuario es de solo consulta: puede visualizar los registros, no modificarlos.',
    );
  }
}
