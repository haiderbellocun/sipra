import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { AvisosComponent } from '@shared/components/avisos.component';
import { ControlCuentaComponent } from '@shared/components/control-cuenta.component';
import { ControlTemaComponent } from '@shared/components/control-tema.component';
import { NavItem, estaActiva, navegacionPara } from './navegacion';

const CLAVE_COLAPSO = 'sipra.menu.colapsado';

/**
 * Armazón de la aplicación (V3, ajuste de navegación posterior a G6).
 *
 * - Barra lateral = SOLO navegación, agrupada (Principal · Operación · Análisis · Validación · Gestión · Soporte) desde la
 *   configuración central `navegacion.ts`, filtrada por el rol de la sesión. Logo fijo y área de navegación con scroll
 *   propio. En escritorio se puede contraer a iconos (con tooltip); el estado se recuerda en el navegador.
 * - Barra superior global (sticky): menú/contraer, título de la vista y, a la derecha, el tema y la cuenta.
 * - Móvil y tablet (< 1024 px): la navegación es un cajón (`<dialog>`) que se abre con ☰.
 * El tema sigue siendo TemaService (sin cambios); la cuenta, `SesionService.salir()`.
 */
@Component({
  selector: 'sipra-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, NgTemplateOutlet, AvisosComponent, ControlTemaComponent, ControlCuentaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.con-cinta]': "sesion.sesion()?.modo === 'abierto'",
    '[class.colapsada]': 'colapsada()',
  },
  styles: [`
    :host { display: block; min-height: 100dvh; --alto-cinta: 0px; --alto-barra: 56px; --ancho-lat: 264px; }
    :host(.con-cinta) { --alto-cinta: 36px; }
    :host(.colapsada) { --ancho-lat: 68px; }
    .sprite { display: none; }
    .lateral { view-transition-name: lateral; }
    .topbar { view-transition-name: appbar; }
    .cinta { view-transition-name: cinta; }

    .cinta {
      background: var(--surface-overlay); color: var(--text-primary); border-bottom: 1px solid var(--border-default);
      padding: 7px var(--space-16); font-size: var(--fs-meta); line-height: 20px;
      display: flex; gap: var(--space-12); align-items: center; justify-content: center; flex-wrap: wrap; text-align: center;
    }
    .cinta strong { font-weight: 650; display: inline-flex; align-items: center; gap: var(--space-8); }
    .cinta strong::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--status-review); }
    .cinta .detalle { color: var(--text-secondary); }
    .cinta-mas { display: none; }
    @media (width < 768px) {
      .cinta { padding: var(--space-4) var(--space-12); }
      .cinta-mas { display: inline-flex; align-items: center; min-height: 32px; padding: 0 var(--space-8); font: inherit; font-size: var(--fs-meta); font-weight: 600; color: inherit; background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius-6); cursor: pointer; }
      .cinta .detalle { display: none; flex-basis: 100%; }
      .cinta.abierta .detalle { display: block; }
    }
    @media (width >= 1024px) { .cinta { position: sticky; top: 0; z-index: 60; min-height: var(--alto-cinta); } }

    .app { display: grid; min-height: calc(100dvh - var(--alto-cinta)); grid-template-columns: minmax(0, 1fr); }
    @media (width >= 1024px) { .app { grid-template-columns: var(--ancho-lat) minmax(0, 1fr); } }

    /* ── Barra lateral: solo navegación ── */
    .lateral { display: none; }
    @media (width >= 1024px) {
      .lateral {
        display: flex; flex-direction: column; position: sticky; top: var(--alto-cinta); height: calc(100dvh - var(--alto-cinta)); z-index: 40;
        background: var(--surface-rail); border-right: 1px solid var(--border-subtle); min-width: 0;
      }
    }
    .lat-cab { flex: none; display: flex; align-items: center; height: var(--alto-barra); padding: 0 14px; border-bottom: 1px solid var(--border-subtle); }
    .logo { display: flex; align-items: center; gap: var(--space-12); min-width: 0; color: var(--rail-ink-active); text-decoration: none; white-space: nowrap; }
    .logo:hover { text-decoration: none; }
    .logo:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active)); outline-offset: 2px; }
    .logo .simbolo {
      width: 32px; height: 32px; flex: none; padding: 5px; color: var(--text-inverse); background: var(--signal-active);
      clip-path: polygon(0 var(--chaflan), var(--chaflan) 0, 100% 0, 100% calc(100% - var(--chaflan)), calc(100% - var(--chaflan)) 100%, 0 100%);
    }
    .logo .marca-texto { font-weight: 650; font-size: 1.05rem; letter-spacing: .04em; line-height: 1.1; }
    .logo small { display: block; font-weight: 400; font-size: var(--fs-meta); color: var(--rail-ink); letter-spacing: 0; }
    :host(.colapsada) .lateral .marca-texto { display: none; }

    .nav { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: var(--space-8) var(--space-8) var(--space-16); overscroll-behavior: contain; scrollbar-width: thin; }
    .grupo { display: grid; gap: 2px; }
    .grupo + .grupo { margin-top: var(--space-12); }
    .g-tit { margin: 0 0 2px; padding: 0 12px; font: 600 11px/18px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--rail-ink); opacity: .8; }
    .nav a {
      position: relative; display: flex; align-items: center; gap: var(--space-12); min-height: 40px; padding: 0 12px; border-radius: var(--radius-6);
      color: var(--rail-ink); font-size: var(--fs-sm); text-decoration: none; white-space: nowrap;
      transition: color var(--motion-fast), background var(--motion-fast);
    }
    .nav a:hover { color: var(--rail-ink-active); background: color-mix(in srgb, var(--rail-ink-active) 8%, transparent); text-decoration: none; }
    .nav a:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active)); outline-offset: -2px; }
    .nav svg { width: 20px; height: 20px; flex: none; }
    .nav .et { overflow: hidden; text-overflow: ellipsis; }
    /* Activo: fondo de selección, texto e icono con contraste y una pequeña barra de acento (sin brillo). */
    .nav a.activo { color: var(--rail-ink-active); font-weight: 600; background: color-mix(in srgb, var(--signal-default) 18%, transparent); }
    .nav a.activo svg { color: var(--signal-active); }
    .nav a.activo::before { content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px; border-radius: 2px; background: var(--signal-active); }

    /* Contraída: solo iconos; el título del grupo se vuelve una línea fina y la etiqueta, un tooltip (hover y foco). */
    :host(.colapsada) .lateral .nav { padding-inline: 10px; }
    :host(.colapsada) .lateral .g-tit { font-size: 0; height: 1px; margin: 4px 8px 6px; padding: 0; background: var(--border-subtle); opacity: 1; }
    :host(.colapsada) .lateral .grupo:first-child .g-tit { display: none; }
    :host(.colapsada) .lateral .nav a { justify-content: center; padding: 0; }
    :host(.colapsada) .lateral .nav .et { display: none; }
    .tip {
      display: none; position: fixed; z-index: 90; pointer-events: none; white-space: nowrap; padding: 4px 8px; border-radius: 4px;
      font: 500 12px/16px var(--fuente); color: var(--text-primary); background: var(--surface-overlay);
      border: 1px solid var(--border-default); box-shadow: var(--shadow-floating);
    }
    :host(.colapsada) .lateral .nav a:hover .tip, :host(.colapsada) .lateral .nav a:focus-visible .tip { display: block; }

    /* ── Contenido y barra superior global ── */
    .contenido { display: flex; flex-direction: column; min-width: 0; }
    .topbar {
      position: sticky; top: 0; z-index: 30; min-height: var(--alto-barra); box-sizing: border-box;
      display: flex; align-items: center; gap: var(--space-12); padding: 0 var(--space-16);
      background: color-mix(in srgb, var(--surface-canvas) 82%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-subtle);
    }
    @media (width >= 1024px) { .topbar { top: var(--alto-cinta); padding-inline: var(--space-24); } }
    .icono-btn {
      display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; padding: 0; cursor: pointer;
      color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: var(--radius-6);
    }
    .icono-btn:hover { color: var(--text-primary); border-color: var(--border-strong); }
    .icono-btn:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active)); outline-offset: 2px; }
    .icono-btn svg { width: 20px; height: 20px; }
    .btn-menu { display: inline-grid; } .btn-colapsar { display: none; }
    @media (width >= 1024px) { .btn-menu { display: none; } .btn-colapsar { display: inline-grid; } }
    .titulo { margin: 0; flex: 1 1 auto; min-width: 0; font-size: var(--fs-lg); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .der { display: flex; align-items: center; gap: var(--space-8); flex: none; }
    .tema-chico { display: inline-flex; } .tema-grande { display: none; }
    @media (width >= 640px) { .tema-chico { display: none; } .tema-grande { display: inline-flex; } }

    main { padding: var(--space-24) var(--space-16) var(--space-48); max-width: 78rem; width: 100%; box-sizing: border-box; }
    @media (width >= 1024px) { main { padding-inline: var(--space-32); } }
    main.ancho { max-width: 150rem; margin-inline: auto; }
    @media (width >= 1024px) { main.ancho { padding-inline: var(--space-16); } }
    main.lienzo { max-width: none; padding: 0; }

    /* ── Cajón de navegación (móvil y tablet) ── */
    dialog.cajon-nav {
      margin: 0 auto 0 0; height: 100dvh; max-height: 100dvh; width: min(300px, 86vw); padding: 0; border: 0;
      border-right: 1px solid var(--border-subtle); background: var(--surface-rail); color: var(--rail-ink-active);
    }
    dialog.cajon-nav::backdrop { background: rgb(0 0 0 / .45); }
    dialog.cajon-nav[open] { display: flex; flex-direction: column; }
    .cajon-nav .lat-cab { justify-content: space-between; gap: var(--space-8); }
    .cajon-nav .icono-btn { color: var(--rail-ink); }
    @media (width >= 1024px) { dialog.cajon-nav { display: none; } }
    @media (prefers-reduced-motion: reduce) { .nav a { transition: none; } }
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
      <symbol id="sipra-auditoria" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6v3H9Z"/><path d="M15 5h3v16H6V5h3"/><path d="M9 12h6M9 16h4"/></g></symbol>
      <symbol id="sipra-costos" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></g></symbol>
      <symbol id="sipra-colapsar" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 10l-2 2 2 2"/></g></symbol>
    </svg>
    @if (sesion.sesion()?.modo === 'abierto') {
      <div class="cinta" [class.abierta]="cintaAbierta()">
        <strong>Ambiente de pruebas</strong>
        <button type="button" class="cinta-mas" [attr.aria-expanded]="cintaAbierta()" aria-controls="cinta-detalle" (click)="cintaAbierta.set(!cintaAbierta())">{{ cintaAbierta() ? 'Ocultar' : 'Detalle' }}</button>
        <span class="detalle" id="cinta-detalle">ingreso sin contraseña · datos sintéticos · nada de lo que ve es real</span>
      </div>
    }

    <ng-template #navegacion let-movil="movil">
      <nav class="nav" [attr.aria-label]="'Navegación principal'">
        @for (g of grupos(); track g.id) {
          <div class="grupo" role="group" [attr.aria-labelledby]="(movil ? 'gm-' : 'g-') + g.id">
            <p class="g-tit" [id]="(movil ? 'gm-' : 'g-') + g.id">{{ g.etiqueta }}</p>
            @for (item of g.items; track item.ruta + item.etiqueta) {
              <a [routerLink]="item.ruta" [class.activo]="activa(item)" [attr.aria-current]="activa(item) ? 'page' : null"
                 [attr.aria-label]="item.etiqueta" (click)="movil && cerrarCajon()" (mouseenter)="ubicarTip($event)" (focus)="ubicarTip($event)">
                <svg aria-hidden="true"><use [attr.href]="'#' + item.icono" /></svg>
                <span class="et" aria-hidden="true">{{ item.etiqueta }}</span>
                @if (!movil) { <span class="tip" aria-hidden="true">{{ item.etiqueta }}</span> }
              </a>
            }
          </div>
        }
      </nav>
    </ng-template>

    <div class="ambiente-grano" aria-hidden="true"></div>
    <div class="app">
      <aside class="lateral" id="sipra-lateral" aria-label="Menú de SIPRA">
        <div class="lat-cab">
          <a class="logo" routerLink="/inicio" aria-label="SIPRA · Prácticas y empleo CUN, ir al inicio">
            <svg class="simbolo" viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"><path d="M22 94V38L42 18L74 50"/><path d="M96 24V80L65 109L44 90V57L74 86"/></g></svg>
            <span class="marca-texto">SIPRA<small>Prácticas y empleo CUN</small></span>
          </a>
        </div>
        <ng-container [ngTemplateOutlet]="navegacion" [ngTemplateOutletContext]="{ movil: false }" />
      </aside>

      <div class="contenido">
        <header class="topbar">
          <button #botonMenu type="button" class="icono-btn btn-menu" aria-label="Abrir menú" aria-haspopup="dialog" (click)="abrirCajon()">
            <svg aria-hidden="true"><use href="#sipra-menu" /></svg>
          </button>
          <button type="button" class="icono-btn btn-colapsar" aria-controls="sipra-lateral" [attr.aria-expanded]="!colapsada()"
                  [attr.aria-label]="colapsada() ? 'Expandir menú' : 'Contraer menú'" [attr.title]="colapsada() ? 'Expandir menú' : 'Contraer menú'" (click)="alternarColapso()">
            <svg aria-hidden="true"><use href="#sipra-colapsar" /></svg>
          </button>
          <h2 class="titulo">{{ titulo() }}</h2>
          <div class="der">
            <sipra-control-tema class="tema-grande" variante="etiqueta" />
            <sipra-control-tema class="tema-chico" variante="icono" />
            <sipra-control-cuenta variante="barra" />
          </div>
        </header>
        <main [class.ancho]="anchoCompleto()" [class.lienzo]="lienzo()"><router-outlet /></main>
        <sipra-avisos />
      </div>
    </div>

    <dialog #cajon class="cajon-nav" aria-label="Menú de SIPRA" (close)="alCerrarCajon()">
      <div class="lat-cab">
        <a class="logo" routerLink="/inicio" (click)="cerrarCajon()" aria-label="SIPRA · Prácticas y empleo CUN, ir al inicio">
          <svg class="simbolo" viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"><path d="M22 94V38L42 18L74 50"/><path d="M96 24V80L65 109L44 90V57L74 86"/></g></svg>
          <span class="marca-texto">SIPRA<small>Prácticas y empleo CUN</small></span>
        </a>
        <button #cerrarCajonBtn type="button" class="icono-btn" aria-label="Cerrar menú" (click)="cerrarCajon()"><svg aria-hidden="true"><use href="#sipra-cerrar" /></svg></button>
      </div>
      <ng-container [ngTemplateOutlet]="navegacion" [ngTemplateOutletContext]="{ movil: true }" />
    </dialog>
  `,
})
export class ShellComponent {
  readonly sesion = inject(SesionService);
  private readonly router = inject(Router);
  private readonly cajon = viewChild.required<ElementRef<HTMLDialogElement>>('cajon');
  private readonly botonMenu = viewChild.required<ElementRef<HTMLButtonElement>>('botonMenu');
  private readonly cerrarCajonBtn = viewChild.required<ElementRef<HTMLButtonElement>>('cerrarCajonBtn');

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

  /** Grupos visibles para el rol de la sesión (configuración central; los grupos vacíos no aparecen). */
  readonly grupos = computed(() => navegacionPara(this.sesion.rol()));

  private readonly url = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), startWith(null), map(() => this.router.url)),
    { initialValue: this.router.url },
  );
  readonly titulo = computed(() => this.tituloDe(this.url()));
  /** Vistas de trabajo denso que piden todo el ancho útil (Mesas especializadas y Reportes). */
  readonly anchoCompleto = computed(() => /^\/(?:eps|actas|mesa-rut|mesa-camara|reportes)(?:[/?#]|$)/.test(this.url()));
  /** Validación documental usa el lienzo completo (sin padding). */
  readonly lienzo = computed(() => /^\/validacion-documental(?:[/?#]|$)/.test(this.url()));

  readonly colapsada = signal(leerColapso());
  readonly cintaAbierta = signal(false);

  activa(item: NavItem): boolean { return estaActiva(item, this.url()); }

  alternarColapso(): void {
    const valor = !this.colapsada();
    this.colapsada.set(valor);
    try { localStorage.setItem(CLAVE_COLAPSO, valor ? '1' : '0'); } catch { /* almacenamiento no disponible: solo esta sesión */ }
  }

  abrirCajon(): void {
    const el = this.cajon().nativeElement;
    if (!el.open) el.showModal();
    setTimeout(() => this.cerrarCajonBtn().nativeElement.focus(), 0);
  }
  cerrarCajon(): void { const el = this.cajon().nativeElement; if (el.open) el.close(); }
  alCerrarCajon(): void { this.botonMenu().nativeElement.focus({ preventScroll: true }); }

  /** El tooltip de la barra contraída se posiciona junto al icono (position: fixed: no lo recorta el scroll). */
  ubicarTip(evento: Event): void {
    if (!this.colapsada()) return;
    const a = evento.currentTarget as HTMLElement;
    const tip = a.querySelector<HTMLElement>('.tip');
    if (!tip) return;
    const r = a.getBoundingClientRect();
    tip.style.left = `${r.right + 8}px`;
    tip.style.top = `${r.top + r.height / 2 - 12}px`;
  }

  private tituloDe(url: string): string {
    const limpia = url.split('?')[0].split('#')[0];
    if (/^\/practicas\/[^/]+/.test(limpia)) return 'Gestionar la práctica';
    if (limpia.startsWith('/gestion/usuarios')) return 'Gestión de usuarios';
    if (limpia.startsWith('/gestion/periodos')) return 'Gestión de periodos';
    const primera = limpia.split('/').filter(Boolean)[0] ?? 'inicio';
    return this.titulos[primera] ?? 'SIPRA';
  }
}

function leerColapso(): boolean {
  try { return localStorage.getItem(CLAVE_COLAPSO) === '1'; } catch { return false; }
}
