import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ItemBarra, pct1 } from './reportes-analitica.util';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Barras horizontales ordenadas de mayor a menor. Cada fila es un botón real (cross-filter): Enter o Espacio aplica el
 * filtro y `aria-pressed` marca el valor activo. El texto visible (nombre, cantidad, %) es la representación tabular; la
 * barra es decorativa. Top N con «Ver todos»: limita lo que se pinta, nunca el universo.
 */
@Component({
  selector: 'sipra-reportes-barras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
    .fila-b { display: grid; grid-template-columns: minmax(7rem, 38%) 1fr auto; gap: 10px; align-items: center; width: 100%; min-height: 30px; padding: 3px 6px; font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
    .fila-b:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    .fila-b:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .fila-b[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); background: color-mix(in srgb, var(--signal-active) 10%, transparent); }
    .fila-b:disabled { cursor: default; }
    .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { color: var(--text-secondary); font-size: 12px; }
    .pista-b { height: 10px; background: color-mix(in srgb, var(--text-primary) 6%, transparent); border-radius: 3px; overflow: hidden; }
    .pista-b span { display: block; height: 100%; border-radius: 3px; background: var(--ra-info); }
    .fila-b[aria-pressed='true'] .pista-b span { background: var(--signal-active); }
    .cifra-b { font-family: var(--fuente-mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; min-width: 7.5rem; }
    .cifra-b small { color: var(--text-secondary); font-size: 11px; margin-left: 6px; }
    :host-context([data-theme='light']) .cifra-b small, :host-context([data-theme='light']) .sub { color: var(--text-secondary); }
    .mas { margin-top: 6px; padding: 4px 6px; font: 500 12px/16px var(--fuente); color: var(--text-secondary); background: none; border: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .mas:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    @media (width < 700px) { .fila-b { grid-template-columns: 1fr auto; } .pista-b { grid-column: 1 / -1; grid-row: 2; } }
  `],
  template: `
    <ul [attr.aria-label]="titulo()">
      @for (i of visibles(); track i.clave) {
        <li>
          <button type="button" class="fila-b" [attr.aria-pressed]="seleccionable() ? i.clave === seleccion() : null" [disabled]="!seleccionable()"
                  [title]="i.texto + ' · ' + i.n + ' ' + unidad() + ' · ' + pct(i.n) + ' del universo filtrado'" (click)="elegir.emit(i.clave)">
            <span class="nom">{{ i.texto }} @if (i.sub) { <span class="sub">· {{ i.sub }}</span> }</span>
            <span class="pista-b" aria-hidden="true"><span [style.width.%]="ancho(i.n)"></span></span>
            <span class="cifra-b">{{ i.n }}<small>{{ pct(i.n) }}</small></span>
          </button>
        </li>
      }
    </ul>
    @if (items().length > limite()) {
      <button type="button" class="mas" [attr.aria-expanded]="todos()" (click)="todos.set(!todos())">{{ todos() ? 'Ver menos' : 'Ver todos (' + items().length + ')' }}</button>
    }
  `,
})
export class ReportesBarrasComponent {
  readonly titulo = input.required<string>();
  readonly items = input.required<ItemBarra[]>();
  /** Denominador del porcentaje: el total del universo filtrado (no la suma de lo visible). */
  readonly total = input.required<number>();
  readonly unidad = input('estudiantes');
  readonly seleccion = input<string>('');
  readonly seleccionable = input(true);
  readonly limite = input(10);
  readonly elegir = output<string>();

  protected readonly todos = signal(false);
  protected readonly visibles = computed(() => (this.todos() ? this.items() : this.items().slice(0, this.limite())));
  private readonly maximo = computed(() => Math.max(0, ...this.items().map((i) => i.n)));

  protected ancho(n: number): number { const m = this.maximo(); return m ? Math.max(n > 0 ? 1.5 : 0, (n * 100) / m) : 0; }
  protected pct(n: number): string { return pct1(n, this.total()); }
}
