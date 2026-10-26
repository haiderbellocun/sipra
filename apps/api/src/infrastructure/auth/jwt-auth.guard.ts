import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Permiso, Rol } from '../../domain/value-objects/rol.vo';
import { CLAVE_PUBLICO } from './roles.decorator';

export interface CargaUtilJwt {
  sub: string;
  correo: string;
  rol: Rol;
  permiso?: Permiso;
  escuelas: string[];
  empresaId: string | null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico) return true;

    const request = contexto.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      ip?: string;
      actor?: Actor;
    }>();

    const cabecera = request.headers.authorization ?? '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
    if (!token) throw new UnauthorizedException('Sesión requerida');

    let carga: CargaUtilJwt;
    try {
      carga = await this.jwt.verifyAsync<CargaUtilJwt>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    // El actor se construye exclusivamente desde el token.
    request.actor = {
      id: carga.sub,
      correo: carga.correo,
      rol: carga.rol,
      permiso: carga.permiso ?? 'escritura',
      escuelas: carga.escuelas ?? [],
      empresaId: carga.empresaId ?? null,
      ip: request.ip ?? null,
      agenteUsuario: request.headers['user-agent'] ?? null,
    };
    return true;
  }
}
