import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TemaService } from '@core/ui/tema.service';

/**
 * Control de tema (Kit V3). Presentacional: toda la lógica es de TemaService (clave `sipra.tema`, valores
 * `oscuro`/`claro`, fundido de 240 ms); el primer pintado sin parpadeo lo resuelve `assets/tema-inicial.js`.
 *
 * - `rail`: píldora vertical sol/luna del command rail (Figma V3); la etiqueta la pone el rail al abrirse.
 * - `icono`: botón técnico de 32 px (44 en táctil) con micro‑señal y tooltip; para el login.
 * - `etiqueta`: icono + «Claro»/«Oscuro»; para la barra superior móvil.
 *
 * Es un `button` con `role="switch"`: nombre «Tema claro» y estado en `aria-checked`.
 */
@Component({
  selector: 'sipra-control-tema',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variante]': 'variante()' },
  styles: [`
    :host { display: inline-flex; position: relative; }
    button {
      position: relative; display: inline-grid; place-items: center; padding: 0; cursor: pointer; font: inherit; color: var(--text-secondary);
      border: 1px solid var(--border-strong); background: color-mix(in srgb, var(--text-primary) 6%, transparent);
      transition: border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
    }
    button:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--signal-active) 55%, var(--border-strong)); }
    button:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active)); outline-offset: 2px; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

    /* ── rail: píldora 30 × 62, pulgar que viaja 220 ms ── */
    :host([data-variante='rail']) button { color: var(--rail-ink); width: 30px; height: 62px; border-radius: 999px; background: color-mix(in srgb, var(--rail-ink-active) 8%, transparent); }
    :host([data-variante='rail']) button:hover { color: var(--rail-ink-active); }
    .sol, .luna { position: absolute; left: 6px; }
    .sol { top: 7px; } .luna { top: 37px; }
    .pulgar {
      position: absolute; left: 2px; top: 2px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
      background: var(--signal-active); color: var(--text-inverse); box-shadow: 0 0 10px color-mix(in srgb, var(--signal-active) 50%, transparent);
      transition: transform 220ms var(--ease-out);
    }
    .pulgar svg { position: static; }
    [aria-checked='false'] .pulgar { transform: translateY(32px); }
    :host-context([data-theme='light']) .pulgar { background: #fff; color: var(--p-neutral-900); box-shadow: 0 0 8px rgb(255 255 255 / .5); }

    /* ── icono / etiqueta: botón técnico con micro‑señal ── */
    :host([data-variante='icono']) button { width: 32px; height: 32px; border-radius: 6px; }
    :host([data-variante='etiqueta']) button { grid-auto-flow: column; gap: 8px; height: 36px; padding: 0 12px 0 10px; border-radius: 6px; font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); }
    .glifo { display: grid; place-items: center; width: 16px; height: 16px; }
    .glifo svg { grid-area: 1 / 1; transition: opacity 220ms var(--ease-out), transform 220ms var(--ease-out); }
    .glifo .fuera { opacity: 0; transform: rotate(-60deg) scale(.6); }
    /* Micro‑señal: punto de 5 px en la esquina, color de señal activa. */
    .senal { position: absolute; right: 3px; top: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--signal-active); box-shadow: 0 0 6px var(--signal-active); }
    :host([data-variante='etiqueta']) .senal { position: static; }
    @media (pointer: coarse) { :host([data-variante='icono']) button { width: 44px; height: 44px; } :host([data-variante='etiqueta']) button { height: 44px; } }

    /* Tooltip (hover y foco de teclado); el nombre accesible no depende de él. */
    .tip {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 5; pointer-events: none; white-space: nowrap;
      padding: 4px 8px; border-radius: 4px; font: 500 12px/16px var(--fuente-mono); color: var(--text-primary);
      background: var(--surface-overlay); border: 1px solid var(--border-default); box-shadow: var(--shadow-floating);
      opacity: 0; transform: translateY(-4px); transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
    }
    button:hover + .tip, button:focus-visible + .tip { opacity: 1; transform: none; }

    @media (prefers-reduced-motion: reduce) {
      .pulgar, .glifo svg, .tip, button { transition: none; }
      .glifo .fuera { transform: none; }
    }
  `],
  template: `
    @let claro = tema.esClaro();
    <button type="button" role="switch" [attr.aria-checked]="claro" aria-label="Tema claro" (click)="tema.alternar()">
      @if (variante() === 'rail') {
        <svg class="sol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>
        <svg class="luna" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>
        <span class="pulgar" aria-hidden="true">
          @if (claro) { <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg> }
          @else { <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg> }
        </span>
      } @else {
        <span class="glifo" aria-hidden="true">
          <svg viewBox="0 0 24 24" [class.fuera]="!claro"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>
          <svg viewBox="0 0 24 24" [class.fuera]="claro"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>
        </span>
        @if (variante() === 'etiqueta') { <span aria-hidden="true">{{ claro ? 'Claro' : 'Oscuro' }}</span> }
        <span class="senal" aria-hidden="true"></span>
      }
    </button>
    @if (variante() === 'icono') { <span class="tip" aria-hidden="true">{{ ayuda() }}</span> }
  `,
})
export class ControlTemaComponent {
  readonly variante = input<'rail' | 'icono' | 'etiqueta'>('icono');
  protected readonly tema = inject(TemaService);
  protected readonly ayuda = computed(() => (this.tema.esClaro() ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'));
}
