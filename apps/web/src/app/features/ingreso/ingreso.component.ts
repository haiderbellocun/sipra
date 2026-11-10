import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SesionService } from '@core/auth/sesion.service';
import { ModoAutenticacion, PerfilDisponible, UsuarioDePerfil } from '@core/models/modelos';
import { entorno } from '../../../environments/environment';
import { ControlTemaComponent } from '@shared/components/control-tema.component';
import { SignalFieldComponent } from './signal-field.component';
import { lanzarTransicionEntrada } from './transicion-entrada';
import { debeMostrarUsuariosDePrueba } from './usuarios-prueba';

/**
 * Pantalla de ingreso («Signal Field»).
 *
 * Reproduce el frame aprobado de Figma (F5/F6, 1440 × 1024; nodo 32:978 en claro): las medidas de abajo salen
 * de ese frame leído con el MCP, no de una captura. El SERVIDOR decide qué se ofrece. El ingreso institucional
 * con Google Workspace es siempre la acción principal. El bloque «Usuarios de prueba» (perfiles sin contraseña)
 * existe solo si el servidor habilita el selector Y el cliente no es de producción ni de preproducción
 * (`debeMostrarUsuariosDePrueba`); aparece cerrado y se abre como un panel flotante.
 */
@Component({
  selector: 'sipra-ingreso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SignalFieldComponent, ControlTemaComponent],
  styles: [`
    :host {
      display: block; position: relative; min-height: 100dvh; overflow-x: clip; isolation: isolate;
      color: var(--text-primary); font-family: var(--fuente);
      /* Valores del frame por tema (oscuro: lo que usaba el frame F5; claro: F6). */
      --l-tinta: 159 233 224; --l-acento: var(--signal-active);
      --l-panel: rgb(13 25 28 / .62); --l-panel-borde: rgb(159 233 224 / .14);
      --l-panel-sombra: 0 30px 60px -10px rgb(0 0 0 / .5);
      --l-chip: var(--signal-default); --l-chip-texto: #bfe8f7; --l-boton-glow: .35; --l-edge: .35; --l-ancho-panel: 404px;
    }
    :host-context([data-theme="light"]) {
      --l-tinta: 7 25 35; --l-acento: #0593c6;
      --l-panel: rgb(248 252 253 / .82); --l-panel-borde: rgb(255 255 255 / .7);
      --l-panel-sombra: 0 28px 56px -8px rgb(11 42 58 / .22);
      --l-chip: #0593c6; --l-chip-texto: #0593c6; --l-boton-glow: .28; --l-edge: .9;
    }

    /* ── Fondo del frame: degradado (151.9° = la matriz [[.6 .8][-.8 .6]] del frame), tres blooms y retícula de 48 px ── */
    .fondo {
      position: fixed; inset: 0; z-index: -1; pointer-events: none;
      background:
        linear-gradient(rgb(127 232 218 / .04) 1px, transparent 1px) 0 0 / 48px 48px,
        linear-gradient(90deg, rgb(127 232 218 / .04) 1px, transparent 1px) 0 0 / 48px 48px,
        radial-gradient(circle 500px at 13.9% 95.7%, rgb(63 214 192 / .1) 0%, rgb(63 214 192 / .035) 55%, transparent 100%),
        radial-gradient(circle 560px at 86.8% 29.3%, rgb(5 147 198 / .2) 0%, rgb(5 147 198 / .07) 55%, transparent 100%),
        radial-gradient(circle 720px at 36.1% 48.8%, rgb(23 100 95 / .62) 0%, rgb(23 100 95 / .217) 55%, transparent 100%),
        linear-gradient(151.9deg, #071418 0%, #030708 71.4%);
    }
    :host-context([data-theme="light"]) .fondo {
      background:
        linear-gradient(rgb(7 25 35 / .05) 1px, transparent 1px) 0 0 / 48px 48px,
        linear-gradient(90deg, rgb(7 25 35 / .05) 1px, transparent 1px) 0 0 / 48px 48px,
        radial-gradient(circle 560px at 12.5% 91.8%, rgb(63 214 192 / .26) 0%, rgb(63 214 192 / .091) 55%, transparent 100%),
        radial-gradient(circle 620px at 83.3% 15.6%, rgb(5 147 198 / .22) 0%, rgb(5 147 198 / .077) 55%, transparent 100%),
        radial-gradient(circle 720px at 36.1% 46.9%, rgb(255 255 255 / .7) 0%, rgb(255 255 255 / .245) 55%, transparent 100%),
        linear-gradient(151.9deg, #e6f0f6 0%, #cfe2ed 71.4%);
    }
    /* El frame aprobado (F5/F6) no lleva grano T1: el login lo oculta en ambos temas. */
    .ambiente-grano { display: none; }

    /* ── Escena (≥ 1024): todo se ancla como en el frame (izquierda/abajo a la izquierda, panel a la derecha) ── */
    .escena { position: relative; z-index: 1; min-height: 100dvh; pointer-events: none; }
    .marca, .titular, .panel, .cabecera-der, .tema-acceso { pointer-events: auto; }
    .visual-slot { display: contents; --sf-z: -1; }

    /* Marca: cuadrado de 36 px con esquinas cortadas (9 px) y «S» de 22 px; SIPRA 24/31 ls 2 %; «Prácticas · CUN» 12 px. */
    .marca { position: absolute; left: 40px; top: 36px; width: 180px; height: 48px; }
    .marca-simbolo {
      position: absolute; left: 0; top: 0; width: 36px; height: 36px; display: grid; place-items: center; padding-top: 1px;
      background: #3fd6c0; color: #04201c; font: 600 22px/1 var(--fuente);
      clip-path: polygon(0 9px, 9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%);
    }
    .marca-nombre { position: absolute; left: 48px; top: 4px; font: 600 24px/31px var(--fuente); letter-spacing: .02em; color: var(--text-primary); white-space: nowrap; }
    .marca-sub { position: absolute; left: 48px; top: 32px; font: 400 12px/16px var(--fuente); color: var(--text-muted); white-space: nowrap; }

    /* Control de tema (Kit V3) a la derecha de la cabecera; los metadatos se corren 48 px para dejarle sitio. */
    .tema-acceso { position: absolute; right: 40px; top: 38px; }
    .cabecera-der { position: absolute; right: 88px; top: 46px; width: 240px; margin: 0; white-space: pre; text-align: right; font: 500 12px/16px var(--fuente-mono); letter-spacing: 0; color: var(--text-muted); }

    /* Titular: 72 px, interlineado 68 (0,944), −4 %; líneas 2 y 3 sangradas 84 px (1,167 em); subtítulo 16/24 a 540 px; metadatos a 92 px. */
    .titular { --h: clamp(44px, 5vw, 72px); position: absolute; left: 64px; bottom: 40px; }
    .titular h1 { margin: 0; font-family: var(--fuente); font-weight: 600; text-transform: uppercase; font-size: var(--h); line-height: .9444; letter-spacing: -.04em; color: var(--text-primary); }
    .titular h1, .titular .sub { position: relative; top: 1px; }
    .titular h1 span { display: block; white-space: nowrap; }
    .titular h1 span:nth-child(2), .titular h1 span:nth-child(3) { padding-left: 1.1667em; }
    .titular h1 span:nth-child(3) { color: var(--l-acento); }
    .titular .sub { margin: 17px 0 0 calc(var(--h) * 1.1667); width: 540px; max-width: 42vw; font: 400 16px/24px var(--fuente); color: var(--text-secondary); }
    .titular .pie { margin: 36px 0 0; display: flex; gap: 92px; font: 500 12px/16px var(--fuente-mono); letter-spacing: 0; color: var(--text-muted); white-space: nowrap; }

    /* ── Panel de ingreso: 404 × 500, r 6, relleno translúcido, borde de 1 px, sombra fría y línea de luz superior ── */
    .panel {
      position: absolute; right: min(84px, 5.8334vw); top: 50%; translate: 0 calc(-50% + 6px);
      width: clamp(340px, 28.06vw, var(--l-ancho-panel)); min-height: 500px; box-sizing: border-box;
      display: flex; flex-direction: column; padding: 29px 31px 33px; /* −1 px: el borde de 1 px del frame es interno */
      border-radius: var(--radius-6); border: 1px solid var(--l-panel-borde); background: var(--l-panel); box-shadow: var(--l-panel-sombra);
    }
    .panel::before { content: ""; position: absolute; top: 0; left: 6px; right: 6px; height: 1px; background: linear-gradient(90deg, transparent, #fff, transparent); opacity: var(--l-edge); pointer-events: none; }
    .etiqueta-acceso { margin: 0; font: 600 12px/16px var(--fuente); letter-spacing: .1em; color: var(--text-muted); }
    .panel h2 { margin: 6px 0 0; font: 600 30px/39px var(--fuente); letter-spacing: -.02em; color: var(--text-primary); }
    .texto { margin: 5px 0 0; font: 400 14px/21px var(--fuente); color: var(--text-secondary); }
    .aviso { margin-top: var(--space-12); }

    .cta-envoltura { margin-top: 32px; filter: drop-shadow(0 0 16px color-mix(in srgb, var(--action-primary) calc(var(--l-boton-glow) * 100%), transparent)); }
    .cta {
      width: 100%; height: 48px; padding: 0 22px 0 28px; border: 0; cursor: pointer;
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-8);
      font: 600 15px/20px var(--fuente); background: var(--action-primary); color: var(--action-on-primary);
      clip-path: polygon(0 10px, 10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
      transition: background var(--motion-fast) var(--ease-out);
    }
    .cta svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .cta:hover:not(:disabled) { background: var(--action-primary-hover); }
    /* El chaflán recortaría el anillo de foco: mientras tiene foco se muestra completo. */
    .cta:focus-visible { clip-path: none; outline: 2px solid var(--foco); outline-offset: 3px; }
    .cta:disabled { opacity: .6; cursor: not-allowed; }
    .reintentar { width: auto; justify-content: center; padding: 0 var(--space-24); }

    .estado { margin: 12px 0 0; font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.55; }

    /* Divisor «o» (155 + 8 + 155 px) y fila «Usuarios de prueba» de 44 px, en el lugar del campo alternativo del frame. */
    .divisor { margin-top: 26px; height: 17px; display: flex; align-items: center; gap: 11px; font: 400 13px/17px var(--fuente); color: var(--text-muted); }
    .divisor i { font-style: normal; }
    .divisor span { flex: 1; height: 1px; background: rgb(var(--l-tinta) / .18); }
    .usuarios { position: relative; margin-top: 95px; }
    .disclosure {
      position: relative; width: 100%; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;
      background: transparent; color: var(--text-primary); font: 500 14px/18px var(--fuente);
      border: 1px solid rgb(var(--l-tinta) / .4); border-radius: var(--radius-6);
      transition: background var(--motion-fast) var(--ease-out);
    }
    .disclosure:hover { background: rgb(var(--l-tinta) / .06); }
    .flecha { position: absolute; right: 14px; top: 13px; width: 16px; height: 16px; transition: transform var(--motion-default) var(--ease-out); color: var(--text-secondary); }
    .flecha svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .disclosure[aria-expanded="true"] .flecha { transform: rotate(180deg); }
    .lista {
      list-style: none; margin: 0; padding: var(--space-4) var(--space-12); position: absolute; left: -8px; right: -8px; top: calc(100% + 6px); z-index: 5;
      max-height: min(46dvh, 320px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
      background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: var(--radius-8); box-shadow: var(--shadow-floating);
    }
    .lista[hidden] { display: none; }
    .fila {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-4) var(--space-12);
      padding: var(--space-8) 0; border-top: 1px solid var(--border-subtle);
    }
    .lista .fila:first-child { border-top: 0; }
    .fila.ocupado { opacity: .7; }
    .fila-datos { min-width: 0; display: grid; gap: 1px; }
    .fila-nombre { font-size: var(--fs-sm); font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .fila-meta { font-size: var(--fs-meta); line-height: 1.35; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fila-meta b { font-weight: 600; color: var(--status-available); }
    .fila-elegir { grid-column: 1 / -1; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-8); }
    .fila-elegir label { font-size: var(--fs-meta); color: var(--text-secondary); }
    .fila-elegir select {
      width: 100%; min-width: 0; min-height: 36px; padding: 0 var(--space-8); font: inherit; font-size: var(--fs-meta);
      color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: var(--radius-6);
    }
    .entrar {
      min-height: 36px; min-width: 64px; padding: 0 var(--space-12); cursor: pointer; font: 600 var(--fs-meta) var(--fuente);
      color: var(--text-primary); background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius-6);
      transition: background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out);
    }
    .entrar:hover:not(:disabled) { background: var(--signal-default-subtle); border-color: var(--signal-default); }
    .entrar:disabled { opacity: .55; cursor: not-allowed; }
    .entrar.cargando { position: relative; color: transparent; }
    .entrar.cargando::after {
      content: ""; position: absolute; inset: 0; margin: auto; width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid var(--border-strong); border-top-color: var(--signal-active); animation: giro .7s linear infinite;
    }
    @keyframes giro { to { transform: rotate(360deg); } }

    /* Pie del panel: «Solo en desarrollo local…» + chip DEV (44 × 18, mono 12) y fila con candado de 12 px. */
    .pie-panel { margin-top: auto; display: grid; gap: 15px; font: 400 12px/16px var(--fuente); color: var(--text-muted); }
    .dev-fila { height: 16px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-12); }
    .etiqueta-dev { flex: none; width: 44px; height: 18px; line-height: 18px; text-align: center; border-radius: 3px; font: 500 12px/18px var(--fuente-mono); color: var(--l-chip-texto); background: color-mix(in srgb, var(--l-chip) 18%, transparent); }
    .candado { display: flex; align-items: center; gap: 6px; }
    .candado svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; flex: none; }

    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: panel-entra 420ms var(--ease-out) both; }
      .titular { animation: panel-entra 520ms var(--ease-out) 80ms both; }
    }
    @keyframes panel-entra { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .flecha, .cta, .entrar, .disclosure { transition: none; }
      .entrar.cargando::after { animation: none; }
    }

    /* ── < 1024: marca · titular · visual compacto · acceso (una columna, sin solapes) ── */
    @media (width < 1024px) {
      .escena { display: grid; grid-template-columns: minmax(0, 1fr); row-gap: var(--space-16); padding: var(--space-24) var(--space-16) var(--space-32); }
      .marca { position: relative; left: auto; top: auto; grid-row: 1; }
      .cabecera-der { display: none; }
      .tema-acceso { position: relative; right: auto; top: auto; grid-row: 1; justify-self: end; align-self: center; }
      .titular { position: static; grid-row: 2; --h: clamp(32px, 9vw, 52px); }
      .titular .sub, .titular .pie { display: none; }
      .visual-slot { display: block; position: relative; grid-row: 3; height: clamp(190px, 52vw, 300px); margin-inline: calc(var(--space-16) * -1); pointer-events: none; }
      .panel { position: relative; right: auto; top: auto; translate: none; grid-row: 4; width: min(100%, 520px); justify-self: center; min-height: 0; padding: var(--space-24) var(--space-20); }
      .pie-panel { margin-top: var(--space-20); }
      .lista { left: 0; right: 0; }
    }
  `],
  template: `
    <div class="fondo" aria-hidden="true"></div>
    <main class="escena">
      <div class="visual-slot" aria-hidden="true"><sipra-signal-field /></div>

      <header class="marca">
        <span class="marca-simbolo" aria-hidden="true">S</span>
        <span class="marca-nombre">SIPRA</span>
        <span class="marca-sub">Prácticas · CUN</span>
      </header>
      <p class="cabecera-der">ACCESO INSTITUCIONAL&nbsp;&nbsp;·&nbsp;&nbsp;ES-CO</p>
      <sipra-control-tema class="tema-acceso" variante="icono" />

      <section class="titular" data-zona-protegida>
        <h1><span>Validación</span><span>inteligente de</span><span>prácticas</span></h1>
        <p class="sub">Sistema Integrado de Prácticas y Relacionamiento Académico-Empresarial. Cada documento, una señal verificable.</p>
        <p class="pie"><span>01 — DOCUMENT SIGNAL</span><span>DECIDE SIEMPRE UNA PERSONA</span></p>
      </section>

      <section class="panel" data-zona-protegida aria-labelledby="titulo-acceso">
        <p class="etiqueta-acceso">ACCESO</p>
        <h2 id="titulo-acceso">Ingresa a SIPRA</h2>

        <div aria-live="polite">
          @if (error(); as e) {
            <div class="aviso aviso--error" role="alert">{{ e }}</div>
          }
        </div>

        @if (cargando()) {
          <p class="estado" role="status">Consultando el modo de autenticación del ambiente…</p>
        } @else if (sinApi()) {
          <p class="estado">
            La API no responde. El modo de ingreso lo decide el servidor, así que sin su respuesta
            esta pantalla no ofrece ninguna opción: mostrar una al azar solo llevaría a un error confuso.
          </p>
          <p class="estado"><button type="button" class="cta reintentar" (click)="ngOnInit()">Reintentar</button></p>
        } @else {
          <p class="texto">Usa tu cuenta institucional. Tu sesión se asocia a tu rol y a las escuelas que gestionas.</p>
          <div class="cta-envoltura">
            <button type="button" class="cta" (click)="entrarConWorkspace()">
              <span>Continuar con Google Workspace</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>

          @if (mostrarUsuariosDePrueba()) {
            <div class="divisor" aria-hidden="true"><span></span><i>o</i><span></span></div>
            <div class="usuarios">
              <button type="button" class="disclosure" aria-controls="usuarios-prueba"
                      [attr.aria-expanded]="usuariosAbiertos()" (click)="usuariosAbiertos.set(!usuariosAbiertos())">
                <span>Usuarios de prueba</span>
                <span class="flecha" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
              </button>
              <ul class="lista" id="usuarios-prueba" [hidden]="!usuariosAbiertos()" aria-label="Usuarios de prueba sin contraseña">
                @for (perfil of perfiles(); track perfil.rol) {
                  <li class="fila" [class.ocupado]="entrando() !== null">
                    <div class="fila-datos">
                      <span class="fila-nombre">{{ usuarioElegido(perfil).nombre }}</span>
                      <span class="fila-meta" [attr.title]="contexto(perfil)"><b>{{ etiquetaRol(perfil.rol) }}</b> · {{ contexto(perfil) }}</span>
                    </div>
                    <button type="button" class="entrar" [class.cargando]="entrando() === perfil.rol"
                            [disabled]="entrando() !== null" (click)="entrar(perfil)"
                            [attr.aria-label]="'Entrar como ' + usuarioElegido(perfil).nombre + ', ' + etiquetaRol(perfil.rol)">Entrar</button>
                    @if (perfil.usuarios.length > 1) {
                      <div class="fila-elegir">
                        <label [for]="'quien-' + perfil.rol">Entrar como</label>
                        <select [id]="'quien-' + perfil.rol" [value]="elegido(perfil)" (change)="elegir(perfil, $event)" [disabled]="entrando() !== null">
                          @for (u of perfil.usuarios; track u.id) { <option [value]="u.correo">{{ u.nombre }}{{ u.detalle ? ' · ' + u.detalle : '' }}</option> }
                        </select>
                      </div>
                    }
                  </li>
                }
              </ul>
            </div>
          }
          <div class="pie-panel">
            @if (mostrarUsuariosDePrueba() && modo(); as m) {
              <div class="dev-fila">
                <span>Solo en desarrollo local, sin contraseña</span>
                <span class="etiqueta-dev">{{ m.ambiente.toUpperCase() }}</span>
              </div>
            }
            <span class="candado">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>Conexión protegida · datos tratados según política</span>
            </span>
          </div>
        }
      </section>
    </main>

    <div class="ambiente-grano" aria-hidden="true"></div>
  `,
})
export class IngresoComponent implements OnInit {
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly campo = viewChild(SignalFieldComponent);

  readonly modo = signal<ModoAutenticacion | null>(null);
  readonly perfiles = signal<PerfilDisponible[]>([]);
  readonly cargando = signal(true);
  /** La API no respondió: no se sabe el modo, así que no se ofrece ninguno. */
  readonly sinApi = signal(false);
  readonly entrando = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  /** Decisión pura (servidor + ambiente del cliente): ver `usuarios-prueba.ts`. */
  readonly mostrarUsuariosDePrueba = computed(() => debeMostrarUsuariosDePrueba(this.modo(), entorno));
  /** Siempre cerrado al entrar: una sola línea «Usuarios de prueba»; la lista es un panel flotante que se abre a demanda. */
  readonly usuariosAbiertos = signal(false);

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
    this.cargando.set(true);
    this.sinApi.set(false);
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
  private readonly seleccion = signal<ReadonlyMap<string, string>>(new Map());
  elegido(perfil: PerfilDisponible): string { return this.seleccion().get(perfil.rol) ?? perfil.correo; }
  elegir(perfil: PerfilDisponible, evento: Event): void {
    const siguiente = new Map(this.seleccion());
    siguiente.set(perfil.rol, (evento.target as HTMLSelectElement).value);
    this.seleccion.set(siguiente);
  }

  /** Usuario elegido (solo presentación); si no se halla, el predeterminado del perfil. */
  usuarioElegido(perfil: PerfilDisponible): Pick<UsuarioDePerfil, 'nombre' | 'detalle'> {
    const correo = this.elegido(perfil);
    return perfil.usuarios.find((u) => u.correo === correo) ?? { nombre: perfil.nombre, detalle: perfil.usuarios[0]?.detalle ?? '' };
  }

  /** Contexto compacto: descripción del perfil y, si existe, el detalle del usuario. */
  contexto(perfil: PerfilDisponible): string {
    const detalle = this.usuarioElegido(perfil).detalle;
    return [perfil.descripcion, detalle].filter(Boolean).join(' · ');
  }

  async entrar(perfil: PerfilDisponible): Promise<void> {
    this.entrando.set(perfil.rol);
    this.error.set(null);
    try {
      await this.sesion.ingresar(perfil.rol, this.elegido(perfil));
      // La capa de transición vive fuera del componente y corre sola: no retrasa la navegación.
      lanzarTransicionEntrada(this.campo()?.rectRail() ?? null);
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
