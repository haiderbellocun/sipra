import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Rol } from '../models/modelos';
import { SesionService } from '../auth/sesion.service';

export const sesionGuard: CanActivateFn = () => {
  const sesion = inject(SesionService);
  const router = inject(Router);
  return sesion.autenticado() ? true : router.createUrlTree(['/ingreso']);
};

/**
 * Guard de rol. Es una comodidad de navegación, NO un control de seguridad:
 * la autorización real la aplica el servidor en cada petición.
 */
export const rolGuard = (...permitidos: Rol[]): CanActivateFn => {
  return () => {
    const sesion = inject(SesionService);
    const router = inject(Router);
    const rol = sesion.rol();
    if (!rol) return router.createUrlTree(['/ingreso']);
    return permitidos.includes(rol) ? true : router.createUrlTree(['/inicio']);
  };
};
