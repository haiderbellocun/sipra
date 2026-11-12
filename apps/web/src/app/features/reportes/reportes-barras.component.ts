import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { ItemBarra, pct1 } from './reportes-analitica.util';
import { TOP_MOVIL, TipGrafico, TonoGrafico, escala, escucharMovil, num, pieFiltro, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Gráfica de barras horizontales (ranking) con escala real: eje X con marcas «redondas», línea base, rejilla vertical
 * tenue, barras de 24 px con 10 px de separación y la cifra al final de cada barra (nunca dentro). Cada fila es un botón
 * (cross-filter con teclado: Enter o Espacio; `aria-pressed` marca el valor activo; clic de nuevo lo quita). Tooltip
 * compartido con cifra, % del universo filtrado y contexto. Top N (Top 5 en móvil) con «Ver todos»: limita lo que se
 * pinta, nunca el universo. Sin lógica de dominio.
 */
@Component({
  selector: 'sipra-reportes-barras',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gb { --gb-y: var(--barras-y, clamp(8.5rem, 32%, 15.5rem)); --gb-pad: 3rem; --gb-gap: 12px; --gb-px: 8px; }
    .gb-rejilla { position: absolute; top: 0; bottom: 22px; left: calc(var(--gb-px) + var(--gb-y) + var(--gb-gap)); right: calc(var(--gb-px) + var(--gb-pad) + var(--gb-gap)); pointer-events: none; }
    .gb-linea { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gr-rejilla); transition: left var(--gr-dur) var(--gr-ease); }
    .gb-linea.base { background: var(--gr-eje); }
    .gb-filas { position: relative; display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .gb-fila { display: grid; grid-template-columns: var(--gb-y) minmax(0, 1fr) var(--gb-pad); column-gap: var(--gb-gap); align-items: center; width: 100%;
      padding: 3px var(--gb-px); font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 0; border-radius: 4px; cursor: pointer; }
    .gb-fila:hover, .gb-fila.activa { background: var(--gr-hover); }
    .gb-fila:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gb-fila[aria-disabled='true'] { cursor: default; }
    .gb-y { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gb-plot { position: relative; height: 24px; }
    .gb-barra { position: absolute; top: 0; bottom: 0; left: 0; background: var(--c); border-radius: 0 3px 3px 0;
      transition: width var(--gr-dur) var(--gr-ease), opacity 180ms ease, background-color 180ms ease; }
    .gb-valor { position: absolute; top: 50%; margin-left: 8px; transform: translateY(-50%); font: 500 12px/1 var(--fuente-mono); font-variant-numeric: tabular-nums;
      color: var(--gr-valor, var(--c)); white-space: nowrap; transition: left var(--gr-dur) var(--gr-ease); }
    .gb-fila[aria-pressed='true'] .gb-y, .gb-fila[aria-pressed='true'] .gb-valor, .gb-fila.activa .gb-valor { font-weight: 650; }
    .gb.con-seleccion .gb-fila[aria-pressed='false'] .gb-valor { color: var(--text-secondary); }
    /* Hover: la barra señalada conserva toda su presencia; el resto baja. Selección: lo no elegido pasa a muted (el texto conserva su contraste). */
    .gb.con-hover .gb-fila:not(.activa) .gb-barra { opacity: .42; }
    .gb.con-seleccion .gb-fila[aria-pressed='false'] .gb-barra { background: var(--gr-muted); }
    .gb-eje { display: grid; grid-template-columns: var(--gb-y) minmax(0, 1fr) var(--gb-pad); column-gap: var(--gb-gap); padding: 6px var(--gb-px) 0; }
    .gb-eje .gr-eje-t { text-align: right; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .gb-marcas { grid-column: 2; position: relative; height: 16px; }
    .gb-marcas span { position: absolute; transform: translateX(-50%); font: 500 11px/16px var(--fuente-mono); color: var(--gr-texto-eje); white-space: nowrap; transition: left var(--gr-dur) var(--gr-ease); }
    @media (width < 700px) {
      .gb { --gb-y: 0px; --gb-pad: 2.6rem; }
      .gb-fila { row-gap: 2px; }
      .gb-y { grid-column: 1 / -1; grid-row: 1; }
      .gb-plot { grid-column: 2; grid-row: 2; height: 20px; }
      .gb-eje .gr-eje-t { display: none; }
    }
  `],
  template: `
    <div class="gr-marco gb" #marco [class.con-seleccion]="!!seleccion()" [class.con-hover]="!!hover()">
      <div class="gb-rejilla" aria-hidden="true">
        @for (m of esc().marcas; track $index) { <span class="gb-linea" [class.base]="m === 0" [style.left.%]="(m * 100) / esc().max"></span> }
      </div>
      <ul class="gb-filas" [attr.aria-label]="titulo()">
        @for (i of visibles(); track i.clave) {
          <li>
            <button type="button" class="gb-fila" [class.activa]="hover() === i.clave" [attr.aria-pressed]="seleccionable() ? i.clave === seleccion() : null"
                    [attr.aria-disabled]="seleccionable() ? null : true" [attr.aria-label]="aria(i)" (click)="pulsar(i.clave)"
                    (mouseenter)="ver($event, i)" (mousemove)="ver($event, i)" (mouseleave)="salir()" (focus)="ver($event, i)" (blur)="salir()">
              <span class="gb-y">{{ i.texto }}</span>
              <span class="gb-plot" aria-hidden="true" [class]="'gt-' + (i.tono ?? tono())">
                <span class="gb-barra" [style.width.%]="ancho(i.n)"></span>
                <span class="gb-valor" [style.left.%]="ancho(i.n)">{{ cifra(i.n) }}</span>
              </span>
            </button>
          </li>
        }
      </ul>
      <div class="gb-eje" aria-hidden="true">
        <span class="gr-eje-t">{{ eje() }}</span>
        <span class="gb-marcas">@for (m of esc().marcas; track $index) { <span [style.left.%]="(m * 100) / esc().max">{{ cifra(m) }}</span> }</span>
      </div>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
    @if (items().length > tope()) {
      <button type="button" class="gr-mas" [attr.aria-expanded]="todos()" (click)="todos.set(!todos())">{{ todos() ? 'Ver menos' : 'Ver todos (' + items().length + ')' }}</button>
    }
  `,
})
export class ReportesBarrasComponent {
  readonly titulo = input.required<string>();
  readonly items = input.required<ItemBarra[]>();
  /** Denominador del porcentaje del tooltip: el total del universo filtrado (no la suma de lo visible). 0 = sin %. */
  readonly total = input.required<number>();
  readonly unidad = input('estudiantes');
  /** Título del eje X (por defecto, la unidad). */
  readonly ejeX = input('');
  readonly seleccion = input<string>('');
  readonly seleccionable = input(true);
  readonly limite = input(10);
  readonly tono = input<TonoGrafico>('principal');
  /** Formato de la cifra (p. ej. tasas «12,5 %»); por defecto, entero es-CO. */
  readonly formato = input<((n: number) => string) | null>(null);
  /** Contexto del porcentaje en el tooltip. */
  readonly base = input('del universo filtrado');
  readonly elegir = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly todos = signal(false);
  protected readonly movil = signal(false);
  protected readonly hover = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly tope = computed(() => (this.movil() ? Math.min(TOP_MOVIL, this.limite()) : this.limite()));
  protected readonly visibles = computed(() => (this.todos() ? this.items() : this.items().slice(0, this.tope())));
  protected readonly esc = computed(() => escala(Math.max(0, ...this.items().map((i) => i.n)), 4, !this.formato()));
  protected readonly eje = computed(() => this.ejeX() || this.unidad().charAt(0).toUpperCase() + this.unidad().slice(1));

  constructor() {
    inject(DestroyRef).onDestroy(escucharMovil(this.movil));
  }

  protected ancho(n: number): number { return (Math.max(0, n) * 100) / this.esc().max; }
  protected cifra(n: number): string { return this.formato()?.(n) ?? num(n); }
  private lineas(i: ItemBarra): string[] {
    const l = [`${this.cifra(i.n)} ${this.unidad()}`];
    if (this.total() > 0) l.push(`${pct1(i.n, this.total())} ${this.base()}`);
    return [...l, ...(i.detalle ?? [])];
  }
  protected aria(i: ItemBarra): string { return `${i.texto}: ${this.lineas(i).join(', ')}`; }
  protected ver(ev: Event, i: ItemBarra): void {
    this.hover.set(i.clave);
    this.tip.set(tipEn(this.marco().nativeElement, ev, i.texto, this.lineas(i), this.seleccionable() ? pieFiltro(i.clave === this.seleccion()) : undefined, i.tono ?? this.tono()));
  }
  protected salir(): void { this.hover.set(null); this.tip.set(null); }
  protected pulsar(clave: string): void { if (this.seleccionable()) this.elegir.emit(clave); }
}
