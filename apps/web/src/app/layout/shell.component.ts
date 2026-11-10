import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { TemaService } from '@core/ui/tema.service';
import { Rol } from '@core/models/modelos';
import { AvisosComponent } from '@shared/components/avisos.component';
import { ControlCuentaComponent, etiquetaRol } from '@shared/components/control-cuenta.component';
import { ControlTemaComponent } from '@shared/components/control-tema.component';

interface EntradaMenu {
  ruta: string;
  etiqueta: string;
  icono: string;
  roles: Rol[] | null;
}

/**
 * Armazón de la aplicación (V3).
 *
 * Escritorio: command rail de 64 px (iconos; al pasar el puntero o enfocar con teclado se abre a 248 px y
 * muestra las etiquetas), con el control de tema y la cuenta al pie. Móvil/tablet: barra inferior.
 * La navegación sigue filtrada por el rol de la sesión; no cambian rutas ni menús. El tema lo gestiona
 * TemaService (se persiste en el navegador y se aplica antes del primer pintado).
 */
@Component({
  selector: 'sipra-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvisosComponent, ControlTemaComponent, ControlCuentaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.con-cinta]': "sesion.sesion()?.modo === 'abierto'",
  },
  styles: [`
    :host { display: block; min-height: 100dvh; }
    .sprite { display: none; }
    /* Regiones estables entre vistas: solo el contenido principal transita. */
    .lateral { view-transition-name: lateral; }
    .appbar { view-transition-name: appbar; }
    .barra-inf { view-transition-name: barra-inf; }
    .cinta { view-transition-name: cinta; }

    :host { --alto-cinta: 0px; }
    :host(.con-cinta) { --alto-cinta: 36px; }
    .cinta {
      background: var(--surface-overlay); color: var(--text-primary); border-bottom: 1px solid var(--border-default);
      padding: 7px var(--space-16); font-size: var(--fs-meta); line-height: 20px;
      display: flex; gap: var(--space-12); align-items: center; justify-content: center;
      flex-wrap: wrap; text-align: center;
    }
    .cinta strong { font-weight: 650; display: inline-flex; align-items: center; gap: var(--space-8); }
    .cinta strong::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--status-review); }
    .cinta .detalle { color: var(--text-secondary); }
    /* Móvil: una línea («Ambiente de pruebas») y el detalle a un toque; en escritorio se ve completo. */
    .cinta-mas { display: none; }
    @media (width < 768px) {
      .cinta { padding: var(--space-4) var(--space-12); }
      .cinta-mas { display: inline-flex; align-items: center; min-height: 32px; padding: 0 var(--space-8); font: inherit; font-size: var(--fs-meta); font-weight: 600; color: inherit; background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius-6); cursor: pointer; }
      .cinta .detalle { display: none; flex-basis: 100%; }
      .cinta.abierta .detalle { display: block; }
    }
    @media (width >= 1024px) {
      .cinta { position: sticky; top: 0; z-index: 60; min-height: var(--alto-cinta); }
    }

    .app { display: grid; min-height: calc(100dvh - var(--alto-cinta)); grid-template-columns: 1fr; }
    @media (width >= 1024px) { .app { grid-template-columns: var(--c-rail-ancho) 1fr; } }

    /* ── Command rail ── */
    .lateral { display: none; position: relative; z-index: 50; }
    @media (width >= 1024px) { .lateral { display: block; } }
    .dock {
      position: fixed; top: var(--alto-cinta); bottom: 0; left: 0; width: var(--c-rail-ancho);
      display: flex; flex-direction: column; gap: var(--space-8); padding: var(--space-16) 0 var(--space-12);
      background: var(--surface-rail); border-right: 1px solid transparent;
      border-image: linear-gradient(180deg, transparent, color-mix(in srgb, var(--signal-active) 28%, transparent) 50%, transparent) 1;
      overflow: hidden; backdrop-filter: blur(10px);
      transition: width var(--motion-default) var(--ease-out), box-shadow var(--motion-default) var(--ease-out);
    }
    .dock:hover, .dock:focus-within { width: var(--c-rail-ancho-abierto); box-shadow: var(--shadow-floating); }
    .logo {
      display: flex; align-items: center; gap: var(--space-12); height: 32px; padding: 0 16px; flex: none;
      color: var(--text-primary); text-decoration: none; white-space: nowrap;
    }
    .logo:hover { text-decoration: none; }
    .logo .simbolo {
      width: 32px; height: 32px; flex: none; padding: 5px; color: var(--text-inverse); background: var(--signal-active);
      clip-path: polygon(0 var(--chaflan), var(--chaflan) 0, 100% 0, 100% calc(100% - var(--chaflan)), calc(100% - var(--chaflan)) 100%, 0 100%);
    }
    .logo .marca-texto { font-weight: 650; font-size: 1.05rem; letter-spacing: .04em; opacity: 0; transition: opacity var(--motion-fast); color: var(--rail-ink-active); }
    .logo small { display: block; font-weight: 400; font-size: var(--fs-meta); color: var(--rail-ink); letter-spacing: 0; }
    .nav { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: var(--space-8) 0; scrollbar-width: none; overscroll-behavior: contain; }
    .nav::-webkit-scrollbar { display: none; }
    .nav a {
      position: relative; display: flex; align-items: center; gap: var(--space-12); height: 40px; flex: none;
      padding: 0 20px; color: var(--rail-ink); font-size: var(--fs-sm); text-decoration: none; white-space: nowrap;
      transition: color var(--motion-fast), background var(--motion-fast);
    }
    .nav a:hover { color: var(--rail-ink-active); background: color-mix(in srgb, var(--rail-ink-active) 8%, transparent); text-decoration: none; }
    .nav svg { width: 24px; height: 24px; flex: none; }
    .nav .et, .dock .oculto-rail { opacity: 0; transition: opacity var(--motion-fast); }
    .dock:hover .et, .dock:focus-within .et, .dock:hover .marca-texto, .dock:focus-within .marca-texto { opacity: 1; }
    /* Activo: pista de señal + punto + luz de borde suave (no un botón relleno). */
    .nav a.activo { color: var(--rail-ink-active); background: radial-gradient(30px 30px at 32px 50%, color-mix(in srgb, var(--signal-default) 45%, transparent), color-mix(in srgb, var(--signal-default) 16%, transparent) 55%, transparent); font-weight: 600; }
    .nav a.activo::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--signal-default); box-shadow: 0 0 8px var(--signal-default); }
    .nav a.activo::after { content: ""; position: absolute; left: 44px; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: var(--signal-active); box-shadow: 0 0 6px var(--signal-active); }

    /* Pie del rail: control de tema y cuenta (Kit V3: sipra-control-tema / sipra-control-cuenta). */
    .pie { display: flex; flex-direction: column; gap: var(--space-12); align-items: stretch; padding-top: var(--space-8); border-top: 1px solid var(--border-subtle); flex: none; }
    .fila-pie { display: flex; align-items: center; gap: var(--space-12); padding: 0 17px; white-space: nowrap; }
    .fila-pie .et { color: var(--rail-ink); font-size: var(--fs-sm); opacity: 0; transition: opacity var(--motion-fast); overflow: hidden; text-overflow: ellipsis; }
    .dock:hover .fila-pie .et, .dock:focus-within .fila-pie .et, .dock.fijo .fila-pie .et { opacity: 1; }
    /* Con el panel de cuenta abierto el rail no se repliega aunque el puntero salga. */
    .dock.fijo { width: var(--c-rail-ancho-abierto); box-shadow: var(--shadow-floating); overflow: visible; }
    .dock.fijo .et, .dock.fijo .marca-texto { opacity: 1; }

    /* ── Contenido ── */
    .contenido { display: flex; flex-direction: column; min-width: 0; }
    .appbar {
      position: sticky; top: 0; z-index: 15;
      background: color-mix(in srgb, var(--surface-canvas) 78%, transparent);
      backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-subtle);
      padding: var(--space-12) var(--space-16); display: flex; gap: var(--space-12); align-items: center; flex-wrap: wrap;
    }
    .appbar h2 { margin: 0; font-size: var(--fs-xl); }
    .appbar .der { margin-left: auto; display: flex; gap: var(--space-8); align-items: center; flex-wrap: wrap; position: relative; }
    @media (width >= 1024px) { .appbar .der { display: none; } .appbar { top: var(--alto-cinta); } .appbar.sin-barra { display: none; } }
    main { padding: var(--space-24) var(--space-16) var(--space-48); max-width: 78rem; width: 100%; }
    @media (width >= 1024px) { main { padding-inline: var(--space-32); } }
    /* Estación de trabajo (Mesas): usa casi todo el ancho; las demás vistas conservan su medida de lectura. */
    main.ancho { max-width: 150rem; margin-inline: auto; }
    @media (width >= 1024px) { main.ancho { padding-inline: var(--space-16); } }
    /* Lienzo: Validación documental ocupa todo el alto/ancho útil (sin padding): el contenido gestiona sus paneles. */
    main.lienzo { max-width: none; padding: 0; }

    /* ── Barra inferior (móvil) ── */
    .barra-inf {
      position: sticky; bottom: 0; z-index: 20; display: flex; margin-top: auto;
      background: var(--surface-rail); border-top: 1px solid var(--border-subtle); backdrop-filter: blur(10px);
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    @media (width >= 1024px) { .barra-inf { display: none; } }
    .barra-inf a {
      position: relative; flex: 1; display: grid; place-items: center; gap: 2px; min-height: 56px;
      color: var(--rail-ink); font-size: var(--fs-meta); line-height: 14px; font-weight: 500;
      padding: var(--space-4) 2px; min-width: 0; text-decoration: none; text-align: center;
      overflow-wrap: normal; hyphens: auto;
    }
    .barra-inf svg { width: 24px; height: 24px; }
    .barra-inf a.activo { color: var(--rail-ink-active); }
    .barra-inf a.activo::before { content: ""; position: absolute; top: 0; left: 30%; right: 30%; height: 2px; border-radius: 2px; background: var(--signal-default); box-shadow: 0 0 8px var(--signal-default); }
  `],
  template: `
    <!-- Sprite de iconos del paquete de diseño SIPRA (24 px, trazo 1.8, currentColor). -->
    <svg class="sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <symbol id="sipra-inicio" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></g></symbol>
      <symbol id="sipra-oportunidades" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/></g></symbol>
      <symbol id="sipra-documentos" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h9l5 5v13H5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></g></symbol>
      <symbol id="sipra-calendario" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h2M7 17h2"/></g></symbol>
      <symbol id="sipra-indicadores" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 18v-6h3v6M11 18V8h3v10M17 18V3h3v15"/></g></symbol>
      <symbol id="sipra-empresa" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V3h11v18M15 9h5v12M2 21h20M8 7h3M8 11h3M8 15h3M8 21v-3h3v3M18 12v1M18 16v1"/></g></symbol>
      <symbol id="sipra-buscar" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></g></symbol>
      <symbol id="sipra-ubicacion" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></g></symbol>
      <symbol id="sipra-guardar" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4Z"/></g></symbol>
      <symbol id="sipra-cargar" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></g></symbol>
      <symbol id="sipra-descargar" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></g></symbol>
      <symbol id="sipra-verificado" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></g></symbol>
      <symbol id="sipra-pendiente" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></g></symbol>
      <symbol id="sipra-alerta" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v1"/></g></symbol>
      <symbol id="sipra-notificaciones" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17V9a6 6 0 0 1 12 0v8l2 2H4ZM10 22h4"/></g></symbol>
      <symbol id="sipra-configuracion" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></g></symbol>
      <symbol id="sipra-flecha" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18m-6-6 6 6-6 6"/></g></symbol>
      <symbol id="sipra-cerrar" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 5 14 14M19 5 5 19"/></g></symbol>
      <symbol id="sipra-menu" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></g></symbol>
      <symbol id="sipra-ayuda" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 4v1"/></g></symbol>
      <symbol id="sipra-correo" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></g></symbol>
      <symbol id="sipra-remoto" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="13" rx="2"/><path d="M2 21h20M9 16v5M15 16v5"/></g></symbol>
      <symbol id="sipra-seguridad" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 4v7c0 5-9 9-9 9s-9-4-9-9V6Z"/><path d="m7 12 3 3 7-7"/></g></symbol>
      <symbol id="sipra-revision" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16M6 17l-1-4L16 2l5 5-11 11Z"/><path d="m13 5 5 5"/></g></symbol>
    </svg>

    @if (sesion.sesion()?.modo === 'abierto') {
      <div class="cinta" [class.abierta]="cintaAbierta()">
        <strong>Ambiente de pruebas</strong>
        <button type="button" class="cinta-mas" [attr.aria-expanded]="cintaAbierta()" aria-controls="cinta-detalle" (click)="cintaAbierta.set(!cintaAbierta())">{{ cintaAbierta() ? 'Ocultar' : 'Detalle' }}</button>
        <span class="detalle" id="cinta-detalle">ingreso sin contraseña · datos sintéticos · nada de lo que ve es real</span>
      </div>
    }

    <div class="ambiente-grano" aria-hidden="true"></div>
    <div class="app">
      <aside class="lateral">
        <div class="dock" [class.fijo]="cuentaAbierta()">
          <a class="logo" routerLink="/inicio" aria-label="SIPRA · Prácticas y empleo CUN, ir al inicio">
            <svg class="simbolo" viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"><path d="M22 94V38L42 18L74 50"/><path d="M96 24V80L65 109L44 90V57L74 86"/></g></svg>
            <span class="marca-texto">SIPRA<small>Prácticas y empleo CUN</small></span>
          </a>
          <nav class="nav" aria-label="Principal">
            @for (entrada of menuVisible(); track entrada.ruta + entrada.etiqueta) {
              <a [routerLink]="entrada.ruta" routerLinkActive="activo" ariaCurrentWhenActive="page" [attr.title]="entrada.etiqueta">
                <svg aria-hidden="true"><use [attr.href]="'#' + entrada.icono" /></svg>
                <span class="et">{{ entrada.etiqueta }}</span>
              </a>
            }
          </nav>
          <div class="pie">
            <div class="fila-pie">
              <sipra-control-tema variante="rail" />
              <span class="et" aria-hidden="true">{{ temaServicio.etiqueta() }}</span>
            </div>
            <div class="fila-pie">
              <sipra-control-cuenta variante="rail" (abiertoCambio)="cuentaAbierta.set($event)" />
              <span class="et" aria-hidden="true" [attr.title]="sesion.sesion()?.nombre">{{ rotuloCuenta() }}</span>
            </div>
          </div>
        </div>
      </aside>

      <div class="contenido">
        <header class="appbar" [class.sin-barra]="lienzo()">
          <h2>{{ titulo() }}</h2>
          <div class="der">
            <sipra-control-tema variante="etiqueta" />
            <sipra-control-cuenta variante="barra" />
          </div>
        </header>
        <main [class.ancho]="anchoCompleto()" [class.lienzo]="lienzo()"><router-outlet /></main>
        <sipra-avisos />
        <nav class="barra-inf" aria-label="Principal">
          @for (entrada of menuMovil(); track entrada.ruta + entrada.etiqueta) {
            <a [routerLink]="entrada.ruta" routerLinkActive="activo" ariaCurrentWhenActive="page">
              <svg aria-hidden="true"><use [attr.href]="'#' + entrada.icono" /></svg>
              {{ entrada.etiqueta }}
            </a>
          }
        </nav>
      </div>
    </div>
  `,
})
export class ShellComponent {
  readonly sesion = inject(SesionService);
  readonly temaServicio = inject(TemaService);
  private readonly router = inject(Router);

  private readonly menu: EntradaMenu[] = [
    { ruta: '/inicio', etiqueta: 'Inicio', icono: 'sipra-inicio', roles: null },
    { ruta: '/registro', etiqueta: 'Registrar mi práctica', icono: 'sipra-cargar', roles: ['estudiante'] },
    { ruta: '/practicas', etiqueta: 'Prácticas', icono: 'sipra-documentos', roles: null },
    {
      ruta: '/arl', etiqueta: 'Solicitud de ARL', icono: 'sipra-seguridad',
      roles: ['estudiante', 'auxiliar', 'coordinador', 'administrador', 'tutor'],
    },
    {
      ruta: '/registro', etiqueta: 'Registro FUR y cartas', icono: 'sipra-cargar',
      roles: ['coordinador', 'administrador', 'tutor', 'auxiliar'],
    },
    {
      ruta: '/cumplimiento', etiqueta: 'Cumplimiento', icono: 'sipra-verificado',
      roles: ['administrador', 'coordinador', 'extension', 'tutor'],
    },
    {
      ruta: '/empresas', etiqueta: 'Empresas', icono: 'sipra-empresa',
      roles: ['administrador', 'coordinador', 'extension', 'empresa'],
    },
    { ruta: '/bolsa', etiqueta: 'Bolsa de empleo', icono: 'sipra-oportunidades', roles: null },
    {
      ruta: '/reportes', etiqueta: 'Reportes', icono: 'sipra-indicadores',
      roles: ['administrador', 'extension', 'coordinador', 'auxiliar', 'tutor'],
    },
    { ruta: '/costos-ia', etiqueta: 'Costos de IA', icono: 'sipra-indicadores', roles: ['administrador', 'coordinador'] },
    { ruta: '/vistas', etiqueta: 'Vistas SINU', icono: 'sipra-buscar', roles: ['coordinador', 'administrador', 'auxiliar', 'tutor'] },
    { ruta: '/validacion-documental', etiqueta: 'Validación documental', icono: 'sipra-documentos', roles: ['tutor', 'auxiliar', 'coordinador', 'administrador'] },
    { ruta: '/eps', etiqueta: 'Validación de EPS', icono: 'sipra-seguridad', roles: ['auxiliar', 'coordinador', 'administrador'] },
    { ruta: '/actas', etiqueta: 'Actas de iniciación', icono: 'sipra-verificado', roles: ['auxiliar', 'coordinador', 'administrador'] },
    { ruta: '/mesa-rut', etiqueta: 'RUT', icono: 'sipra-verificado', roles: ['tutor', 'coordinador', 'administrador'] },
    { ruta: '/mesa-camara', etiqueta: 'Mesa de Cámara', icono: 'sipra-empresa', roles: ['tutor', 'coordinador', 'administrador'] },
    { ruta: '/pqrs', etiqueta: 'PQRS', icono: 'sipra-correo', roles: ['estudiante', 'coordinador', 'administrador', 'auxiliar'] },
    { ruta: '/ayuda', etiqueta: 'Ayuda', icono: 'sipra-ayuda', roles: null },
    { ruta: '/gestion/periodos', etiqueta: 'Gestión de periodos', icono: 'sipra-calendario', roles: ['coordinador', 'administrador'] },
    { ruta: '/gestion/usuarios', etiqueta: 'Gestión de usuarios', icono: 'sipra-configuracion', roles: ['coordinador', 'administrador'] },
    { ruta: '/auditoria', etiqueta: 'Auditoría', icono: 'sipra-revision', roles: ['administrador'] },
  ];

  private readonly titulos: Record<string, string> = {
    inicio: 'Inicio',
    registro: 'Registro y cartas',
    arl: 'Solicitud de ARL',
    ayuda: 'Centro de ayuda',
    pqrs: 'PQRS',
    eps: 'Validación de EPS',
    actas: 'Actas de iniciación',
    'mesa-rut': 'Revisión de RUT',
    'mesa-camara': 'Revisión de Cámara de Comercio',
    vistas: 'Vistas SINU',
    gestion: 'Gestión',
    practicas: 'Prácticas',
    cumplimiento: 'Cumplimiento normativo',
    empresas: 'Empresas',
    bolsa: 'Bolsa de empleo',
    reportes: 'Reportes',
    'costos-ia': 'Costos de IA',
    auditoria: 'Auditoría',
    'validacion-documental': 'Validación documental',
  };

  readonly menuVisible = computed(() => {
    const rol = this.sesion.rol();
    if (!rol) return [];
    return this.menu.filter((e) => e.roles === null || e.roles.includes(rol));
  });

  /** En móvil caben cinco: las primeras del menú visible. */
  readonly menuMovil = computed(() => this.menuVisible().slice(0, 5));

  readonly titulo = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.tituloDe(this.router.url)),
    ),
    { initialValue: '' },
  );

  /** Vistas de trabajo denso que piden todo el ancho útil (Mesas de EPS, Actas, RUT y Cámara). */
  readonly anchoCompleto = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => /^\/(?:eps|actas|mesa-rut|mesa-camara)(?:[/?#]|$)/.test(this.router.url)),
    ),
    { initialValue: false },
  );

  /** Validación documental usa el lienzo completo (sin padding ni barra superior en escritorio). */
  readonly lienzo = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => /^\/validacion-documental(?:[/?#]|$)/.test(this.router.url)),
    ),
    { initialValue: false },
  );

  /** Rótulo junto al avatar cuando el rail se abre (el mismo rol que muestra el control de cuenta). */
  readonly rotuloCuenta = computed(() => {
    const rol = etiquetaRol(this.sesion.rol(), this.sesion.sesion()?.permiso);
    return this.sesion.sesion()?.modo === 'abierto' ? `Prueba · ${rol}` : rol;
  });

  readonly cuentaAbierta = signal(false);
  readonly cintaAbierta = signal(false);

  private tituloDe(url: string): string {
    const limpia = url.split('?')[0].split('#')[0];
    if (/^\/practicas\/[^/]+/.test(limpia)) return 'Gestionar la práctica';
    if (limpia.startsWith('/gestion/usuarios')) return 'Gestión de usuarios';
    if (limpia.startsWith('/gestion/periodos')) return 'Gestión de periodos';
    const primera = limpia.split('/').filter(Boolean)[0] ?? 'inicio';
    return this.titulos[primera] ?? 'SIPRA';
  }
}
