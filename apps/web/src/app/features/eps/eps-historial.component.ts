import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EventoHistorial } from '@core/models/modelos';
import { fechaCorta } from './eps.util';

const VISIBLES = 4;

/**
 * Historial del caso: los últimos movimientos a la vista y el resto a un clic, sin perder ninguno.
 * Solo presenta; no pide ni cambia nada.
 */
@Component({
  selector: 'sipra-eps-historial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    ul { list-style:none; margin:0; padding:0; display:grid; gap:var(--sp-2); }
    li { display:grid; gap:2px; font-size:var(--fs-sm); overflow-wrap:break-word; }
    .cuando { color:var(--texto-tenue); font-variant-numeric:tabular-nums; }
    .detalle { color:var(--texto-tenue); }
    details { margin-top:var(--sp-3); }
    summary { cursor:pointer; font-size:var(--fs-sm); font-weight:700; min-height:36px; display:flex; align-items:center; width:fit-content; }
    details ul { margin-top:var(--sp-2); max-height:min(40dvh, 360px); overflow:auto; padding-right:var(--sp-2); }
  `],
  template: `
    @if (eventos().length === 0) {
      <p class="pista">Sin movimientos todavía.</p>
    } @else {
      <ul>
        @for (e of recientes(); track $index) {
          <li>
            <span><strong>{{ e.titulo }}</strong>@if (e.actor) { · {{ e.actor }} }</span>
            <span class="cuando">{{ fecha(e.fecha) }}</span>
            @if (e.detalle) { <span class="detalle">{{ e.detalle }}</span> }
          </li>
        }
      </ul>
      @if (anteriores().length > 0) {
        <details>
          <summary>Ver historial completo ({{ eventos().length }} movimientos)</summary>
          <ul>
            @for (e of ordenados(); track $index) {
              <li>
                <span><strong>{{ e.titulo }}</strong>@if (e.actor) { · {{ e.actor }} }</span>
                <span class="cuando">{{ fecha(e.fecha) }}</span>
                @if (e.detalle) { <span class="detalle">{{ e.detalle }}</span> }
              </li>
            }
          </ul>
        </details>
      }
    }
  `,
})
export class EpsHistorialComponent {
  readonly eventos = input.required<EventoHistorial[]>();

  /** Del más reciente al más antiguo. */
  readonly ordenados = computed(() => [...this.eventos()].sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha)));
  readonly recientes = computed(() => this.ordenados().slice(0, VISIBLES));
  readonly anteriores = computed(() => this.ordenados().slice(VISIBLES));

  fecha(iso: string | null): string { return fechaCorta(iso); }
}
