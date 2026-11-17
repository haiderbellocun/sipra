import { Rol } from '../models/modelos';

/**
 * Roles en la interfaz (G1, corregido en 0.39.1). El backend es la fuente de verdad; esto solo decide
 * qué se muestra. NO hay expansión de grupos: una lista significa exactamente los roles que nombra, igual
 * que `@Roles(...)` en la API. Gobierno = administrador + director; operación de prácticas = coordinador +
 * analista (`ROLES_OPERACION_PRACTICAS`), que se declaran explícitamente donde corresponden.
 */
export const ROLES_OPERACION_PRACTICAS: readonly Rol[] = ['coordinador', 'analista'];

/** ¿El rol de la sesión está entre `roles`? Comparación exacta. */
export function tieneRol(roles: readonly string[], rol: Rol | null | undefined): boolean {
  return rol != null && roles.includes(rol);
}
