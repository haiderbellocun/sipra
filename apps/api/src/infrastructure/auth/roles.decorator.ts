import { SetMetadata } from '@nestjs/common';
import { Rol } from '../../domain/value-objects/rol.vo';

export const CLAVE_ROLES = 'sipra_roles';
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

export const CLAVE_PUBLICO = 'sipra_publico';
/** Marca un endpoint accesible sin sesión (formulario público de empresas, salud). */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

export const CLAVE_AUTENTICADO = 'sipra_autenticado';
/**
 * Endpoint abierto a cualquier usuario con sesión, sin distinguir rol. Es una
 * decisión que se declara: un endpoint sin `@Publico`, `@Autenticado` ni
 * `@Roles` se rechaza, de modo que olvidar la política nunca abre el acceso.
 */
export const Autenticado = () => SetMetadata(CLAVE_AUTENTICADO, true);
