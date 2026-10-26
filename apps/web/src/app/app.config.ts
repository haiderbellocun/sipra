import {
  ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { rutas } from './app.routes';
import { sesionInterceptor } from './core/interceptors/sesion.interceptor';

export const configuracionAplicacion: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(rutas, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch(), withInterceptors([sesionInterceptor])),
  ],
};
