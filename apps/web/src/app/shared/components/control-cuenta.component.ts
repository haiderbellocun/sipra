import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { SesionService } from '@core/auth/sesion.service';
import { Rol } from '@core/models/modelos';

const ETIQUETAS_ROL: Record<Rol, string> = {
  estudiante: 'Practicante',
  tutor: 'Docente facilitador',
  coordinador: 'Coordinación de prácticas',
  administrador: 'Administrador institucional',
  empresa: 'Empresa habilitada',
  extension: 'Dirección de Extensión',
  auxiliar: 'Auxiliar de prácticas',
};

/** Rótulo del rol tal como lo muestra el armazón (con «· consulta» si el permiso es de solo lectura). */
export function etiquetaRol(rol: Rol | null | undefined, permiso?: string | null): string {
  const base = rol ? (ETIQUETAS_ROL[rol] ?? rol) : '';
  return permiso === 'consulta' ? `${base} · consulta` : base;
}

/** Iniciales para el avatar: primera letra del primer y del último nombre. */
export function inicialesDe(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '·';
}

let siguienteId = 0;

/**
 * Control de cuenta (Kit V3). Muestra quién está en sesión (nombre y rol, los mismos datos que ya mostraba
 * el armazón) y la salida. En modo `abierto` (ambiente de pruebas) lo rotula «Usuario de prueba».
 * Cerrar sesión es SIEMPRE `SesionService.salir()`: limpia la señal y `sipra.sesion`, descarta el `state`
 * OIDC y vuelve a `/ingreso`; aquí no hay lógica de sesión propia.
 *
 * Patrón de divulgación: `button` con `aria-expanded`/`aria-controls`; Escape y clic fuera cierran,
 * y el foco vuelve al disparador.
 * - `rail`: avatar de 30 px al pie del command rail; el panel se abre hacia arriba dentro del rail.
 * - `barra`: botón con el nombre en la barra superior móvil; el panel se abre hacia abajo.
 */
@Component({
  selector: 'sipra-control-cuenta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-variante]': 'variante()',
    '(document:click)': 'alClicDocumento($event)',
    '(document:keydown.escape)': 'alEscape()',
  },
  styles: [`
    :host { position: relative; display: inline-flex; }
    .disparador { cursor: pointer; font: inherit; color: var(--rail-ink-active, var(--text-primary)); padding: 0; background: transparent; }
    .disparador:focus-visible, .salir:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active)); outline-offset: 2px; }
    :host([data-variante='rail']) .disparador {
      width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
      border: 1px solid var(--border-strong); font-size: 12px; font-weight: 650; letter-spacing: .02em;
      transition: background 160ms var(--ease-out), border-color 160ms var(--ease-out);
    }
    :host([data-variante='rail']) .disparador:hover, :host([data-variante='rail']) .disparador[aria-expanded='true'] {
      background: color-mix(in srgb, var(--rail-ink-active) 12%, transparent); border-color: color-mix(in srgb, var(--signal-active) 55%, var(--border-strong));
    }
    /* Prueba: anillo y punto ámbar (el rail es oscuro en ambos temas), para que la sesión sintética se reconozca sin abrir el menú. */
    :host([data-variante='rail']) .disparador.prueba { border-color: var(--p-amber-400); }
    .punto { position: absolute; right: -1px; top: -1px; width: 8px; height: 8px; border-radius: 50%; background: var(--p-amber-400); box-shadow: 0 0 0 2px var(--surface-rail, var(--surface-canvas)); }
    :host([data-variante='barra']) .disparador {
      display: inline-flex; align-items: center; gap: 8px; max-width: 13rem; height: 36px; padding: 0 12px; border-radius: 6px;
      border: 1px solid var(--border-strong); color: var(--text-primary); font-size: var(--fs-sm); font-weight: 500;
      background: color-mix(in srgb, var(--text-primary) 6%, transparent);
    }
    :host([data-variante='barra']) .disparador .nombre { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host([data-variante='barra']) .punto { position: static; flex: none; box-shadow: none; }
    @media (pointer: coarse) { :host([data-variante='barra']) .disparador { height: 44px; } }

    /* Tooltip del avatar (hover y foco de teclado), encima para no tapar el rótulo del rail abierto;
       no es la única vía: el clic abre el panel. */
    .tip {
      position: absolute; left: -2px; bottom: calc(100% + 8px); z-index: 5; pointer-events: none; white-space: nowrap;
      padding: 4px 8px; border-radius: 4px; font: 500 12px/16px var(--fuente-mono); color: var(--text-primary);
      background: var(--surface-overlay); border: 1px solid var(--border-default); box-shadow: var(--shadow-floating);
      opacity: 0; transform: translateY(4px); transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
    }
    .disparador:hover + .tip, .disparador:focus-visible + .tip { opacity: 1; transform: none; }
    .disparador[aria-expanded='true'] + .tip { opacity: 0; }

    /* Panel: superficie elevada, hairline, radio 8, sombra flotante. Entra con opacidad + 4 px en 170 ms. */
    .panel {
      position: absolute; z-index: 80; width: 15rem; display: grid; gap: 2px; padding: 12px; color: var(--text-primary); text-align: left;
      background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 8px; box-shadow: var(--shadow-floating);
      animation: entra 170ms var(--ease-out) both;
    }
    :host([data-variante='rail']) .panel { left: -9px; bottom: calc(100% + 10px); width: 232px; }
    :host([data-variante='barra']) .panel { right: 0; top: calc(100% + 8px); }
    @keyframes entra { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .kicker { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font: 600 11px/16px var(--fuente-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--status-review); }
    .kicker::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
    .kicker.normal { color: var(--text-muted); } .kicker.normal::before { display: none; }
    .quien { margin: 0; font-size: var(--fs-sm); font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
    .rol { margin: 0; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .regla { height: 1px; margin: 10px -12px 6px; background: var(--border-subtle); }
    .salir {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 0 8px; margin: 0 -8px; width: calc(100% + 16px);
      font: inherit; font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); text-align: left;
      background: transparent; border: 0; border-radius: 6px; cursor: pointer;
    }
    .salir:hover { background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
    .salir svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; color: var(--text-secondary); }
    @media (pointer: coarse) { .salir { min-height: 44px; } }
    @media (prefers-reduced-motion: reduce) {
      .panel { animation: none; } .tip, .disparador { transition: none; }
    }
  `],
  template: `
    @let s = sesion.sesion();
    <button #disparador type="button" class="disparador" [class.prueba]="esPrueba()"
            [attr.aria-expanded]="abierto()" [attr.aria-controls]="idPanel" [attr.aria-label]="nombreAccesible()"
            (click)="alternar($event)">
      @if (variante() === 'rail') { {{ iniciales() }} } @else { <span class="nombre">{{ s?.nombre }}</span> }
      @if (esPrueba()) { <span class="punto" aria-hidden="true"></span> }
    </button>
    @if (variante() === 'rail') { <span class="tip" aria-hidden="true">{{ esPrueba() ? 'Usuario de prueba' : 'Cuenta' }}</span> }
    @if (abierto()) {
      <div class="panel" [id]="idPanel" role="group" [attr.aria-label]="esPrueba() ? 'Usuario de prueba' : 'Cuenta'">
        <p class="kicker" [class.normal]="!esPrueba()">{{ esPrueba() ? 'Usuario de prueba' : 'Cuenta' }}</p>
        <p class="quien">{{ s?.nombre }}</p>
        <p class="rol">{{ rol() }}</p>
        <div class="regla" aria-hidden="true"></div>
        <button #salir type="button" class="salir" (click)="sesion.salir()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg>
          Cerrar sesión
        </button>
      </div>
    }
  `,
})
export class ControlCuentaComponent {
  readonly variante = input<'rail' | 'barra'>('rail');
  /** Avisa al contenedor (el rail se mantiene abierto mientras el panel está visible). */
  readonly abiertoCambio = output<boolean>();

  protected readonly sesion = inject(SesionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly disparador = viewChild.required<ElementRef<HTMLButtonElement>>('disparador');
  private readonly botonSalir = viewChild<ElementRef<HTMLButtonElement>>('salir');

  protected readonly idPanel = `sipra-cuenta-${++siguienteId}`;
  readonly abierto = signal(false);
  protected readonly esPrueba = computed(() => this.sesion.sesion()?.modo === 'abierto');
  protected readonly rol = computed(() => etiquetaRol(this.sesion.rol(), this.sesion.sesion()?.permiso));
  protected readonly iniciales = computed(() => inicialesDe(this.sesion.sesion()?.nombre));
  protected readonly nombreAccesible = computed(() => `${this.esPrueba() ? 'Usuario de prueba' : 'Cuenta'}: ${this.sesion.sesion()?.nombre ?? ''}`);

  constructor() {
    // Al abrir, el foco pasa a «Cerrar sesión» (la única acción del panel).
    effect(() => { if (this.abierto()) queueMicrotask(() => this.botonSalir()?.nativeElement.focus()); });
  }

  protected alternar(evento: Event): void {
    evento.stopPropagation();
    this.fijar(!this.abierto());
  }

  protected alClicDocumento(evento: Event): void {
    if (this.abierto() && !this.host.nativeElement.contains(evento.target as Node)) this.fijar(false);
  }

  protected alEscape(): void {
    if (!this.abierto()) return;
    const dentro = this.host.nativeElement.contains(document.activeElement);
    this.fijar(false);
    if (dentro) this.disparador().nativeElement.focus();
  }

  private fijar(abierto: boolean): void {
    this.abierto.set(abierto);
    this.abiertoCambio.emit(abierto);
  }
}
