import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SesionService } from '../auth/sesion.service';

/** Adjunta el token y cierra la sesión cuando el servidor la rechaza. */
export const sesionInterceptor: HttpInterceptorFn = (peticion, siguiente) => {
  const sesion = inject(SesionService);
  const token = sesion.token();

  const conAutorizacion = token
    ? peticion.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : peticion;

  return siguiente(conAutorizacion).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && sesion.autenticado()) sesion.salir();
      return throwError(() => error);
    }),
  );
};
