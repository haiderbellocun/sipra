import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TipGrafico } from './reportes-graficos.util';

/**
 * Tooltip compartido de las gráficas V3.1 («Signal Inspector mini»): título, cifra dominante, contexto y la acción
 * disponible. Es decorativo (`aria-hidden`): la misma información está en el `aria-label` del control y en las tablas.
 * Nunca se usa el tooltip nativo del navegador (`title`).
 */
@Component({
  selector: 'sipra-reportes-tooltip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
    .gt-principal { --c: var(--gr-principal); } .gt-comparacion { --c: var(--gr-comparacion); } .gt-ok { --c: var(--gr-ok); } .gt-info { --c: var(--gr-info); }
    .gt-aviso { --c: var(--gr-aviso); } .gt-riesgo { --c: var(--gr-riesgo); } .gt-interna { --c: var(--gr-interna); } .gt-externa { --c: var(--gr-externa); }
    .gt-c0 { --c: var(--bi-blue); } .gt-c1 { --c: var(--bi-teal); } .gt-c2 { --c: var(--bi-amber); } .gt-c3 { --c: var(--bi-rose); } .gt-c4 { --c: var(--bi-emerald); }
    .gt-c5 { --c: var(--bi-sky); } .gt-c6 { --c: var(--bi-orange); } .gt-c7 { --c: var(--bi-lime); } .gt-c8 { --c: var(--bi-cyan); } .gt-c9 { --c: var(--bi-coral); }
    .tip { position: absolute; display: grid; gap: 2px; min-width: 150px; max-width: 280px; padding: 9px 12px 9px 11px; font: 400 12px/17px var(--fuente);
      color: var(--text-secondary); background: var(--surface-overlay); border: 1px solid var(--border-default); border-left: 2px solid var(--c, var(--gr-principal));
      border-radius: 6px; box-shadow: 0 10px 28px rgb(0 0 0 / .32); transform: translate(14px, -50%); white-space: normal; }
    .tip.izq { transform: translate(calc(-100% - 14px), -50%); }
    .tip-t { font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    .tip-v { display: flex; align-items: center; gap: 6px; font: 650 13px/18px var(--fuente-mono); font-variant-numeric: tabular-nums; color: var(--c, var(--text-primary)); }
    .tip-v i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--text-primary)); flex: none; }
    .tip-p { justify-self: start; margin-top: 6px; padding: 2px 8px; font-size: 11px; color: var(--text-secondary); border: 1px solid var(--border-default); border-radius: 10px; }
    :host-context([data-theme='light']) .tip { box-shadow: 0 10px 24px rgb(7 25 35 / .16); }
    :host-context([data-theme='light']) .tip-p { color: var(--text-secondary); }
  `],
  template: `
    @if (tip(); as t) {
      <div class="tip" aria-hidden="true" [class]="t.tono ? 'gt-' + t.tono : ''" [class.izq]="t.izquierda" [style.left.px]="t.x" [style.top.px]="t.y">
        <span class="tip-t">{{ t.titulo }}</span>
        @for (l of t.lineas; track $index) { @if ($first) { <span class="tip-v"><i></i>{{ l }}</span> } @else { <span>{{ l }}</span> } }
        @if (t.pie) { <span class="tip-p">{{ t.pie }}</span> }
      </div>
    }
  `,
})
export class ReportesTooltipComponent {
  readonly tip = input<TipGrafico | null>(null);
}
