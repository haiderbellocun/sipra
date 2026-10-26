import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { Rol } from '@core/models/modelos';
import { AvisosComponent } from '@shared/components/avisos.component';

interface EntradaMenu {
  ruta: string;
  etiqueta: string;
  icono: string;
  roles: Rol[] | null;
}

type ModoTema = 'oscuro' | 'claro';
const CLAVE_TEMA = 'sipra.tema';

/**
 * Armazón de la aplicación.
 *
 * Panel lateral fijo en escritorio, barra inferior en móvil: la misma
 * navegación, filtrada por el rol de la sesión, en la forma que cada tamaño
 * de pantalla pide. La barra superior lleva el título de la vista actual y el
 * conmutador de tema; el tema elegido se guarda en el navegador del usuario.
 */
@Component({
  selector: 'sipra-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AvisosComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.con-cinta]': "sesion.sesion()?.modo === 'abierto'" },
  styles: [`
    :host { display: block; min-height: 100dvh; }
    .sprite { display: none; }
    /* Regiones estables entre vistas: solo el contenido principal transita. */
    .lateral { view-transition-name: lateral; }
    .appbar { view-transition-name: appbar; }
    .barra-inf { view-transition-name: barra-inf; }
    .cinta { view-transition-name: cinta; }
    .tema { display: inline-flex; align-items: center; gap: var(--sp-2); }
    .tema svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--dur-5) var(--ease-out); }
    .tema:hover svg { transform: rotate(40deg); }

    :host { --alto-cinta: 0px; }
    :host(.con-cinta) { --alto-cinta: 36px; }
    .cinta {
      background: var(--marca); color: var(--marca-contraste);
      padding: var(--sp-2) var(--sp-4); font-size: var(--fs-xs); line-height: 20px;
      display: flex; gap: var(--sp-3); align-items: center; justify-content: center;
      flex-wrap: wrap; text-align: center;
    }
    .cinta strong { font-weight: 650; }
    /* En escritorio la cinta cabe en una línea y se queda fija; el panel
       lateral y la barra superior descuentan su altura. En móvil puede
       ocupar dos líneas y simplemente se desplaza con la página. */
    @media (width >= 1024px) {
      .cinta { position: sticky; top: 0; z-index: 30; min-height: var(--alto-cinta); }
      .lateral { top: var(--alto-cinta); height: calc(100dvh - var(--alto-cinta)); }
      .appbar { top: var(--alto-cinta); }
    }

    .app { display: grid; min-height: 100dvh; grid-template-columns: 1fr; }
    @media (width >= 1024px) { .app { grid-template-columns: var(--lateral) 1fr; } }

    /* ── Panel lateral ── */
    .lateral {
      display: none; flex-direction: column; gap: var(--sp-5);
      background: var(--superficie); border-right: 1px solid var(--borde);
      padding: var(--sp-4); position: sticky; top: 0; height: 100dvh;
    }
    @media (width >= 1024px) { .lateral { display: flex; } }
    .logo {
      display: flex; gap: var(--sp-3); align-items: center;
      font-weight: 680; letter-spacing: -.02em; color: var(--texto); text-decoration: none;
      line-height: 1.15;
    }
    .logo:hover { text-decoration: none; }
    .logo .simbolo { width: 36px; height: 36px; color: var(--marca); flex: none; }
    .logo .marca-texto { color: var(--marca); font-size: 1.35rem; font-weight: 700; letter-spacing: .02em; }
    .logo small { display: block; font-weight: 400; font-size: var(--fs-xs); color: var(--texto-tenue); letter-spacing: 0; }
    .nav { display: flex; flex-direction: column; gap: 2px; }
    .nav a {
      display: flex; gap: var(--sp-3); align-items: center;
      padding: var(--sp-2) var(--sp-3); min-height: 44px; border-radius: var(--r-sm);
      color: var(--texto-tenue); font-size: var(--fs-sm); text-decoration: none;
    }
    .nav a:hover { background: var(--superficie-2); color: var(--texto); }
    .nav a.activo { background: var(--marca-suave); color: var(--marca); font-weight: 700; }
    .nav svg { width: 20px; height: 20px; flex: none; }
    .actor {
      margin-top: auto; border-top: 1px solid var(--borde); padding-top: var(--sp-4);
      font-size: var(--fs-sm); display: grid; gap: var(--sp-1);
    }
    .actor .quien { font-weight: 600; }
    .actor .rol { color: var(--texto-tenue); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .07em; }
    .actor .boton { margin-top: var(--sp-2); justify-self: start; }

    /* ── Contenido ── */
    .contenido { display: flex; flex-direction: column; min-width: 0; }
    .appbar {
      position: sticky; top: 0; z-index: 15;
      background: color-mix(in oklab, var(--superficie) 92%, transparent);
      backdrop-filter: blur(8px); border-bottom: 1px solid var(--borde);
      padding: var(--sp-3) var(--sp-4); display: flex; gap: var(--sp-3); align-items: center; flex-wrap: wrap;
    }
    .appbar h2 { margin: 0; font-size: var(--fs-xl); }
    .appbar .der { margin-left: auto; display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; }
    .appbar .quien-movil { font-size: var(--fs-xs); color: var(--texto-tenue); }
    @media (width >= 1024px) { .appbar .solo-movil { display: none; } }
    @media (width < 600px) { .solo-escritorio { display: none; } }
    main { padding: var(--sp-5) var(--sp-4) var(--sp-7); max-width: 78rem; width: 100%; }
    @media (width >= 1024px) { main { padding-inline: var(--sp-6); } }

    /* ── Barra inferior (móvil) ── */
    .barra-inf {
      position: sticky; bottom: 0; z-index: 20; display: flex; margin-top: auto;
      background: var(--superficie); border-top: 1px solid var(--borde);
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    @media (width >= 1024px) { .barra-inf { display: none; } }
    .barra-inf a {
      flex: 1; display: grid; place-items: center; gap: 2px; min-height: 56px;
      color: var(--texto-tenue); font-size: 11px; line-height: 14px; font-weight: 500;
      padding: var(--sp-1); text-decoration: none;
    }
    .barra-inf svg { width: 24px; height: 24px; }
    .barra-inf a.activo { color: var(--marca); }
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
      <div class="cinta">
        <strong>Ambiente de pruebas</strong>
        <span>ingreso sin contraseña · datos sintéticos · nada de lo que ve es real</span>
      </div>
    }

    <div class="app">
      <aside class="lateral">
        <a class="logo" routerLink="/inicio" aria-label="SIPRA · Prácticas y empleo CUN, ir al inicio">
          <svg class="simbolo" viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"><path d="M22 94V38L42 18L74 50"/><path d="M96 24V80L65 109L44 90V57L74 86"/></g></svg>
          <span class="marca-texto">SIPRA<small>Prácticas y empleo CUN</small></span>
        </a>
        <nav class="nav" aria-label="Principal">
          @for (entrada of menuVisible(); track entrada.ruta) {
            <a [routerLink]="entrada.ruta" routerLinkActive="activo" ariaCurrentWhenActive="page">
              <svg aria-hidden="true"><use [attr.href]="'#' + entrada.icono" /></svg>
              {{ entrada.etiqueta }}
            </a>
          }
        </nav>
        <div class="actor">
          <div class="quien">{{ sesion.sesion()?.nombre }}</div>
          <div class="rol">{{ etiquetaRol() }}</div>
          <button type="button" class="boton compacto" (click)="sesion.salir()">Cerrar sesión</button>
        </div>
      </aside>

      <div class="contenido">
        <header class="appbar">
          <h2>{{ titulo() }}</h2>
          <div class="der">
            <span class="quien-movil solo-movil">{{ sesion.sesion()?.nombre }}</span>
            <button type="button" class="boton compacto tema" (click)="alternarTema($event)"
                    [attr.aria-label]="'Tema: ' + etiquetaTema() + '. Cambiar'">
              @if (tema() === 'oscuro') {
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>
              } @else {
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>
              }
              <span class="solo-escritorio">{{ etiquetaTema() }}</span>
            </button>
            <button type="button" class="boton compacto solo-movil" (click)="sesion.salir()">Salir</button>
          </div>
        </header>
        <main><router-outlet /></main>
        <sipra-avisos />
        <nav class="barra-inf" aria-label="Principal">
          @for (entrada of menuMovil(); track entrada.ruta) {
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
  private readonly router = inject(Router);
  private readonly documento = inject(DOCUMENT);

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
    { ruta: '/eps', etiqueta: 'Validación de EPS', icono: 'sipra-seguridad', roles: ['auxiliar', 'coordinador', 'administrador'] },
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
    vistas: 'Vistas SINU',
    gestion: 'Gestión',
    practicas: 'Prácticas',
    cumplimiento: 'Cumplimiento normativo',
    empresas: 'Empresas',
    bolsa: 'Bolsa de empleo',
    reportes: 'Reportes',
    'costos-ia': 'Costos de IA',
    auditoria: 'Auditoría',
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

  readonly etiquetaRol = computed(() => {
    const etiquetas: Record<string, string> = {
      estudiante: 'Practicante',
      tutor: 'Docente facilitador',
      coordinador: 'Coordinación de prácticas',
      administrador: 'Administrador institucional',
      empresa: 'Empresa habilitada',
      extension: 'Dirección de Extensión',
      auxiliar: 'Auxiliar de prácticas',
    };
    const rol = this.sesion.rol();
    const base = rol ? (etiquetas[rol] ?? rol) : '';
    return this.sesion.sesion()?.permiso === 'consulta' ? `${base} · consulta` : base;
  });

  // ── Tema ──────────────────────────────────────────────────────────────────
  readonly tema = signal<ModoTema>(this.temaGuardado());
  readonly etiquetaTema = computed(() => ({ oscuro: 'Tema oscuro', claro: 'Tema claro' })[this.tema()]);

  constructor() {
    effect(() => {
      const modo = this.tema();
      this.documento.documentElement.dataset['modo'] = modo;
      try { localStorage.setItem(CLAVE_TEMA, modo); } catch { /* sin almacenamiento: el tema no persiste */ }
    });
  }

  /** Cambio de tema con revelado circular desde el botón (View Transitions); sin él, cambia en seco. */
  alternarTema(evento?: MouseEvent): void {
    const siguiente: ModoTema = this.tema() === 'oscuro' ? 'claro' : 'oscuro';
    const doc = this.documento as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reducido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reducido) { this.tema.set(siguiente); return; }
    const x = evento?.clientX ?? innerWidth - 40;
    const y = evento?.clientY ?? 40;
    const radio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const raiz = doc.documentElement;
    raiz.style.setProperty('--tema-x', `${x}px`);
    raiz.style.setProperty('--tema-y', `${y}px`);
    raiz.style.setProperty('--tema-r', `${radio}px`);
    raiz.dataset['transicion'] = 'tema';
    const transicion = doc.startViewTransition(() => { this.tema.set(siguiente); });
    void transicion.finished.finally(() => { delete raiz.dataset['transicion']; });
  }

  private temaGuardado(): ModoTema {
    try {
      return localStorage.getItem(CLAVE_TEMA) === 'claro' ? 'claro' : 'oscuro';
    } catch {
      return 'oscuro';
    }
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
