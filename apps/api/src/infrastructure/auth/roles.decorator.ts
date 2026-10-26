import { SetMetadata } from '@nestjs/common';
import { Rol } from '../../domain/value-objects/rol.vo';

export const CLAVE_ROLES = 'sipra_roles';
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

export const CLAVE_PUBLICO = 'sipra_publico';
/** Marca un endpoint accesible sin sesión (formulario público de empresas, salud). */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);
