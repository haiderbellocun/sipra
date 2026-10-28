import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SesionService } from '@core/auth/sesion.service';
import { ModoAutenticacion, PerfilDisponible } from '@core/models/modelos';

/**
 * Pantalla de ingreso.
 *
 * El SERVIDOR decide qué se muestra. Cuando el ingreso abierto está habilitado (solo dev local)
 * aparece el selector de perfil sin contraseña; en cualquier otro ambiente
 * la configuración prohíbe ese modo y aquí solo queda el ingreso
 * institucional con Google Workspace. No hay una bandera del cliente que
 * pueda cambiarlo.
 */
@Component({
  selector: 'sipra-ingreso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; place-items: center; min-height: 100dvh; padding: var(--sp-6) var(--sp-4); }
    .panel { width: min(1080px, 100%); display: grid; gap: var(--sp-5); grid-template-columns: 1fr; }
    @media (width >= 900px) { .panel { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); align-items: stretch; } }
    .lado {
      background: var(--hero); border-radius: var(--r-lg); padding: var(--sp-6);
      display: grid; align-content: space-between; gap: var(--sp-5); min-height: 420px;
    }
    .lado img { width: min(100%, 440px); border-radius: var(--r-md); justify-self: center; }
    .marca { display: flex; gap: var(--sp-3); align-items: center; color: var(--marca); text-decoration: none; }
    .marca svg { width: 56px; height: 56px; flex: none; }
    .marca .nombre { font-size: 2rem; font-weight: 700; letter-spacing: .02em; line-height: 1; }
    .marca small { display: block; font-size: var(--fs-sm); color: var(--texto-tenue); font-weight: 400; margin-top: 4px; letter-spacing: 0; }
    .lema h1 { font-size: var(--fs-h1); margin-bottom: var(--sp-2); }
    .lema p { color: var(--texto-tenue); margin: 0; max-width: 44ch; }
    .cinta { margin-top: var(--sp-3); }
    .acceso { display: grid; gap: var(--sp-4); align-content: start; }
    .perfiles { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
    .perfil {
      text-align: left; padding: var(--sp-4); border-radius: var(--r-sm);
      border: 1px solid var(--borde); background: var(--bg);
      display: grid; gap: var(--sp-2); font: inherit; color: inherit; min-height: 44px; align-content: start;
    }
    .perfil .quien { font-size: var(--fs-sm); color: var(--texto-tenue); margin-top: var(--sp-1); }
    .perfil select { font: inherit; font-size: var(--fs-sm); color: var(--texto); background: var(--superficie); border: 1px solid var(--borde-campo); border-radius: 10px; min-height: 40px; padding: 0 var(--sp-3); width: 100%; }
    .perfil .boton { justify-self: start; margin-top: var(--sp-1); }
    .perfil.ocupado { opacity: .7; }
    .perfil .rol { font-weight: 700; font-size: var(--fs-base); color: var(--marca); }
    .perfil .nombre { font-size: var(--fs-sm); color: var(--texto); }
    .perfil .desc { font-size: var(--fs-sm); color: var(--texto-tenue); line-height: 1.45; margin-top: var(--sp-1); }
    @media (prefers-reduced-motion: no-preference) {
      .perfil { transition: border-color var(--dur-2), background var(--dur-2); }
    }
    .perfil:hover { border-color: var(--marca); }
    .nota { margin-top: var(--sp-2); }
    .centrado { text-align: center; display: grid; justify-items: center; gap: var(--sp-2); }
    .centrado .pista { max-width: 52ch; }
    .cargando { padding: var(--sp-6); text-align: center; color: var(--texto-tenue); }
    footer { grid-column: 1 / -1; text-align: center; color: var(--texto-tenue); font-size: var(--fs-sm); }
  `],
  template: `
    <div class="panel">
      <section class="lado" aria-label="SIPRA">
        <a class="marca" href="/" aria-label="SIPRA · Prácticas y empleo CUN">
          <svg viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"><path d="M22 94V38L42 18L74 50"/><path d="M96 24V80L65 109L44 90V57L74 86"/></g></svg>
          <span><span class="nombre">SIPRA</span><small>Prácticas y empleo CUN</small></span>
        </a>
        <img src="assets/ilustraciones/acceso.svg" alt="" width="600" height="360" />
        <div class="lema">
          <h1>Conecta tu talento</h1>
          <p>Prácticas, seguimiento y documentos en un solo lugar. Sistema Integrado de Prácticas y Relacionamiento Académico-Empresarial de la CUN.</p>
          @if (modo(); as m) {
            <div class="cinta">
              <span class="etiqueta" [class.etiqueta--aviso]="m.permiteSelectorDePerfil"
                    [class.etiqueta--ok]="!m.permiteSelectorDePerfil">
                ambiente {{ m.ambiente }} · autenticación {{ m.modo }}
              </span>
            </div>
          }
        </div>
      </section>

      <section class="acceso">
        @if (error(); as e) {
          <div class="aviso aviso--error">{{ e }}</div>
        }

        @if (cargando()) {
          <div class="tarjeta cargando">Consultando el modo de autenticación del ambiente…</div>
        } @else if (sinApi()) {
          <div class="tarjeta centrado">
            <img src="assets/ilustraciones/sinconexion.svg" alt="" width="600" height="360" style="width:min(100%,300px);border-radius:var(--r-sm)" />
            <h2>La API no responde</h2>
            <p class="pista">
              El modo de ingreso lo decide el servidor, así que sin su respuesta esta pantalla no
              ofrece ninguna opción: mostrar una al azar solo llevaría a un error confuso.
            </p>
            <button type="button" class="boton boton--primario" (click)="ngOnInit()">Reintentar</button>
          </div>
        } @else if (modo()?.permiteSelectorDePerfil) {
          <div class="tarjeta">
            <p class="et-sec">Ambiente de pruebas</p>
            <h2>Ingresa a tu espacio</h2>
            <p class="pista" style="margin-bottom:var(--sp-4)">
              El ingreso no pide contraseña. Cada perfil ve exactamente lo que le corresponde,
              porque el alcance lo aplica el servidor y no la interfaz.
            </p>
            <div class="perfiles">
              @for (perfil of perfiles(); track perfil.rol) {
                <div class="perfil" [class.ocupado]="entrando() !== null">
                  <span class="rol">{{ etiquetaRol(perfil.rol) }}</span>
                  <span class="desc">{{ perfil.descripcion }}</span>
                  @if (perfil.usuarios.length > 1) {
                    <label class="quien" [for]="'quien-' + perfil.rol">Entrar como</label>
                    <select [id]="'quien-' + perfil.rol" [value]="elegido(perfil)" (change)="elegir(perfil, $event)" [disabled]="entrando() !== null">
                      @for (u of perfil.usuarios; track u.id) { <option [value]="u.correo">{{ u.nombre }}{{ u.detalle ? ' · ' + u.detalle : '' }}</option> }
                    </select>
                  } @else {
                    <span class="nombre">{{ perfil.nombre }}@if (perfil.usuarios[0]?.detalle) { <span class="pista"> · {{ perfil.usuarios[0].detalle }}</span> }</span>
                  }
                  <button type="button" class="boton boton--primario compacto" [class.cargando]="entrando() === perfil.rol" [disabled]="entrando() !== null" (click)="entrar(perfil)">Entrar</button>
                </div>
              }
            </div>
            <p class="nota pista">
              Al pasar a preproducción o producción esta pantalla desaparece sola: la validación de
              configuración rechaza el arranque con <code>AUTH_MODO=abierto</code> en esos ambientes.
            </p>
          </div>
        } @else {
          <div class="tarjeta centrado">
            <h2>Ingresa a tu espacio</h2>
            <p class="pista" style="margin-bottom:var(--sp-3)">
              Use su cuenta de Google Workspace de la CUN. El retiro de un usuario del directorio
              revoca su acceso automáticamente.
            </p>
            <button type="button" class="boton boton--primario" (click)="entrarConWorkspace()">
              Continuar con Google Workspace
            </button>
          </div>
        }
      </section>

      <footer>SIPRA · Prácticas y empleo CUN · Dirección de Operaciones · Fábrica de Software CUN</footer>
    </div>
  `,
})
export class IngresoComponent implements OnInit {
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);

  readonly modo = signal<ModoAutenticacion | null>(null);
  readonly perfiles = signal<PerfilDisponible[]>([]);
  readonly cargando = signal(true);
  /** La API no respondió: no se sabe el modo, así que no se ofrece ninguno. */
  readonly sinApi = signal(false);
  readonly entrando = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  private readonly etiquetas: Record<string, string> = {
    estudiante: 'Estudiante',
    tutor: 'Docente facilitador',
    coordinador: 'Coordinación de prácticas',
    administrador: 'Administrador institucional',
    empresa: 'Empresa habilitada',
    extension: 'Dirección de Extensión',
    auxiliar: 'Auxiliar de prácticas',
  };

  async ngOnInit(): Promise<void> {
    // Solo se reconoce una marca fija; nada de la URL se muestra.
    if (this.ruta.snapshot.queryParamMap.get('error') === 'oidc') {
      this.error.set('No fue posible completar el ingreso institucional. Intente de nuevo.');
    }
    try {
      const modo = await this.sesion.cargarModo();
      this.modo.set(modo);
      if (modo.permiteSelectorDePerfil) {
        this.perfiles.set(await this.sesion.perfilesDisponibles());
      }
    } catch {
      this.sinApi.set(true);
      this.error.set(
        'No fue posible contactar la API de SIPRA. Mientras no responda, esta pantalla no puede ' +
          'saber qué forma de ingreso corresponde a este ambiente.',
      );
    } finally {
      this.cargando.set(false);
    }
  }

  etiquetaRol(rol: string): string {
    return this.etiquetas[rol] ?? rol;
  }

  /** Persona elegida dentro de cada perfil; por defecto la predeterminada del servidor. */
  private readonly seleccion = new Map<string, string>();
  elegido(perfil: PerfilDisponible): string { return this.seleccion.get(perfil.rol) ?? perfil.correo; }
  elegir(perfil: PerfilDisponible, evento: Event): void { this.seleccion.set(perfil.rol, (evento.target as HTMLSelectElement).value); }

  async entrar(perfil: PerfilDisponible): Promise<void> {
    this.entrando.set(perfil.rol);
    this.error.set(null);
    try {
      await this.sesion.ingresar(perfil.rol, this.elegido(perfil));
      await this.router.navigate(['/inicio']);
    } catch {
      this.error.set('No fue posible iniciar la sesión con ese perfil.');
    } finally {
      this.entrando.set(null);
    }
  }

  async entrarConWorkspace(): Promise<void> {
    try {
      await this.sesion.ingresarConWorkspace();
    } catch {
      this.error.set('El ingreso institucional no está configurado en este ambiente.');
    }
  }
}
