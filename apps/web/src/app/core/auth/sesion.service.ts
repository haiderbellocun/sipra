import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { entorno } from '../../../environments/environment';
import { ModoAutenticacion, PerfilDisponible, Rol, Sesion } from '../models/modelos';

const CLAVE_SESION = 'sipra.sesion';

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
    const { url, nonce } = await firstValueFrom(
      this.http.get<{ url: string; state: string; nonce: string }>(
        `${entorno.apiBase}/auth/oidc/inicio`,
      ),
    );
    sessionStorage.setItem('sipra.nonce', nonce);
    window.location.href = url;
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
