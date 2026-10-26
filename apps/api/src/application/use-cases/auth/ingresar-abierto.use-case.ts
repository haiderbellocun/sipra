import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Usuario } from '../../../domain/entities/usuario.entity';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  USUARIO_REPOSITORY,
  UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { perfilPredeterminado } from './perfil-predeterminado';

/**
 * Ingreso sin contraseña por selección de perfil.
 *
 * Disponible ÚNICAMENTE cuando `AUTH_MODO=abierto`, que la validación de
 * configuración prohíbe en los ambientes `pre` y `prod`. Emite exactamente el
 * mismo token que el flujo OIDC, de modo que el resto del sistema no distingue
 * entre ambos y activar OIDC no exige tocar una sola línea de negocio.
 */
@Injectable()
export class IngresarAbiertoUseCase {
  constructor(
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
  ) {}

  async ejecutar(rol: Rol, correo?: string): Promise<Usuario> {
    const usuario = correo
      ? await this.usuarios.buscarPorCorreo(correo)
      : perfilPredeterminado(await this.usuarios.listarPorRol(rol));

    if (!usuario) {
      throw new UnauthorizedException(
        `No hay un usuario de prueba con el perfil "${rol}". Ejecute las semillas: npm run seed`,
      );
    }
    if (correo && usuario.rol !== rol) {
      throw new UnauthorizedException('El correo indicado no corresponde al perfil seleccionado');
    }
    if (!usuario.activo) {
      throw new UnauthorizedException('El usuario está inactivo');
    }

    usuario.registrarAcceso();
    await this.usuarios.guardar(usuario.instantanea());
    return usuario;
  }
}
