import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';

/**
 * Inyecta el actor resuelto por el guard. La identidad viene SIEMPRE del token,
 * nunca de un parámetro del cliente: no hay forma de pedir "actuar como otro".
 */
export const ActorActual = createParamDecorator((_datos: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) {
    throw new Error('No hay actor en la petición: falta JwtAuthGuard');
  }
  return request.actor;
});
