import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { entorno } from '../../../environments/environment';
import { ModoAutenticacion, PerfilDisponible, Rol, Sesion } from '../models/modelos';

const CLAVE_SESION = 'sipra.sesion';
const CLAVE_STATE = 'sipra.oidc.state';

/**
 * Estado de sesión con signals.
 *
 * El modo de autenticación lo decide el SERVIDOR, no el cliente. En dev y qa
 * responde `abierto` y la aplicación muestra el selector de perfil; en pre y
 * prod responde `oidc` y muestra el ingreso con Google Workspace. El resto de
 * la aplicación no distingue entre ambos: el token es el mismo.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _sesion = signal<Sesion | null>(this.recuperar());
  private readonly _modo = signal<ModoAutenticacion | null>(null);

  readonly sesion = this._sesion.asReadonly();
  readonly modo = this._modo.asReadonly();

  readonly autenticado = computed(() => this._sesion() !== null);
  readonly rol = computed<Rol | null>(() => this._sesion()?.rol ?? null);
  readonly token = computed(() => this._sesion()?.accessToken ?? null);
  readonly esInterno = computed(() => {
    const rol = this.rol();
    return rol !== null && ['tutor', 'coordinador', 'administrador', 'extension', 'auxiliar'].includes(rol);
  });

  async cargarModo(): Promise<ModoAutenticacion> {
    const modo = await firstValueFrom(
      this.http.get<ModoAutenticacion>(`${entorno.apiBase}/auth/modo`),
    );
    this._modo.set(modo);
    return modo;
  }

  perfilesDisponibles(): Promise<PerfilDisponible[]> {
    return firstValueFrom(
      this.http.get<PerfilDisponible[]>(`${entorno.apiBase}/auth/perfiles`),
    );
  }

  /** Ingreso por selección de perfil (ambiente de pruebas). */
  async ingresar(rol: Rol, correo?: string): Promise<Sesion> {
    const sesion = await firstValueFrom(
      this.http.post<Sesion>(`${entorno.apiBase}/auth/ingresar`, { rol, correo }),
    );
    this.establecer(sesion);
    return sesion;
  }

  /** Ingreso institucional: redirige a Google Workspace. */
  async ingresarConWorkspace(): Promise<void> {
    const { url, state } = await firstValueFrom(
      this.http.get<{ url: string; state: string }>(`${entorno.apiBase}/auth/oidc/inicio`),
    );
    // El `state` completo queda en este navegador; al regresar se compara antes de nada.
    sessionStorage.setItem(CLAVE_STATE, state);
    window.location.href = url;
  }

  /**
   * Cierra el ingreso institucional: exige que el `state` recibido sea idéntico al
   * guardado al salir, lo envía con el código al servidor y establece la sesión.
   * El `state` temporal se elimina siempre, haya funcionado o no.
   */
  async completarIngresoOidc(code: string, state: string): Promise<Sesion> {
    try {
      const guardado = this.leerStateTemporal();
      if (!guardado || !code || !state || guardado !== state) {
        throw new Error('state no coincide');
      }
      const sesion = await firstValueFrom(
        this.http.post<Sesion>(`${entorno.apiBase}/auth/oidc/callback`, { code, state }),
      );
      this.establecer(sesion);
      return sesion;
    } finally {
      this.descartarStateTemporal();
    }
  }

  /** Limpia el valor temporal cuando el ingreso institucional se abandona o falla. */
  descartarStateTemporal(): void {
    try {
      sessionStorage.removeItem(CLAVE_STATE);
    } catch {
      /* sin sessionStorage no hay nada que limpiar */
    }
  }

  private leerStateTemporal(): string | null {
    try {
      return sessionStorage.getItem(CLAVE_STATE);
    } catch {
      return null;
    }
  }

  salir(): void {
    this._sesion.set(null);
    localStorage.removeItem(CLAVE_SESION);
    void this.router.navigate(['/ingreso']);
  }

  private establecer(sesion: Sesion): void {
    this._sesion.set(sesion);
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  }

  private recuperar(): Sesion | null {
    try {
      const crudo = localStorage.getItem(CLAVE_SESION);
      return crudo ? (JSON.parse(crudo) as Sesion) : null;
    } catch {
      return null;
    }
  }
}
