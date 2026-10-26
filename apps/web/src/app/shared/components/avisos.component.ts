import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AvisosService } from '@core/ui/avisos.service';

/** Anfitrión de los avisos flotantes: abajo a la derecha en escritorio, sobre la barra en móvil. */
@Component({
  selector: 'sipra-avisos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      position: fixed; z-index: 60; inset: auto var(--sp-4) calc(var(--sp-4) + env(safe-area-inset-bottom, 0px)) auto;
      display: grid; gap: var(--sp-2); width: min(420px, calc(100vw - 2 * var(--sp-4))); pointer-events: none;
    }
    @media (width < 1024px) { :host { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); } }
    .aviso-f {
      pointer-events: auto; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: var(--sp-3); align-items: start;
      padding: var(--sp-3) var(--sp-4); border-radius: var(--r-sm); border: 1px solid var(--borde);
      background: var(--superficie); color: var(--texto); box-shadow: var(--sh-lg); font-size: var(--fs-sm);
      border-left-width: 4px; animation: entrar var(--dur-5) var(--ease-out) both;
    }
    .aviso-f.ok { border-left-color: var(--ok); } .aviso-f.ok svg { color: var(--ok); }
    .aviso-f.error { border-left-color: var(--peligro); } .aviso-f.error svg { color: var(--peligro); }
    .aviso-f.info { border-left-color: var(--info); } .aviso-f.info svg { color: var(--info); }
    svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; margin-top: 1px; }
    .texto { line-height: 1.45; }
    .cerrar { all: unset; cursor: pointer; width: 32px; height: 32px; margin: -5px -8px -5px 0; display: grid; place-items: center; border-radius: 8px; color: var(--texto-tenue); }
    .cerrar:hover { background: var(--superficie-2); color: var(--texto); }
    .cerrar:focus-visible { outline: 3px solid var(--texto); outline-offset: 2px; }
    .cerrar svg { width: 16px; height: 16px; margin: 0; }
    .barra { grid-column: 1 / -1; height: 2px; border-radius: 2px; background: var(--borde); overflow: hidden; margin-top: var(--sp-1); }
    .barra span { display: block; height: 100%; background: currentColor; transform-origin: left; animation: agotar linear forwards; }
    .ok .barra span { color: var(--ok); } .error .barra span { color: var(--peligro); } .info .barra span { color: var(--info); }
    @keyframes entrar { from { opacity: 0; translate: 0 16px; scale: .98; } }
    @keyframes agotar { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) { .aviso-f, .barra span { animation: none; } }
  `],
  template: `
    <div aria-live="polite" aria-atomic="false" style="display:contents">
      @for (a of avisos.lista(); track a.id) {
        <div class="aviso-f" [class]="'aviso-f ' + a.tipo" role="status">
          @switch (a.tipo) {
            @case ('ok') { <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg> }
            @case ('error') { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18v.1"/></svg> }
            @default { <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/></svg> }
          }
          <div class="texto">{{ a.texto }}</div>
          <button type="button" class="cerrar" (click)="avisos.cerrar(a.id)" aria-label="Cerrar aviso">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
          <div class="barra" aria-hidden="true"><span [style.animation-duration.ms]="a.duracion"></span></div>
        </div>
      }
    </div>
  `,
})
export class AvisosComponent {
  readonly avisos = inject(AvisosService);
}
