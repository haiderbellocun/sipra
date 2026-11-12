import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { ItemBarra, pct1 } from './reportes-analitica.util';
import { TipGrafico, TonoGrafico, escala, num, pieFiltro, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Columnas verticales para distribuciones ordenadas (p. ej. semestre 4 → 9): eje Y con marcas, rejilla horizontal tenue,
 * línea base, cifra sobre cada columna y la categoría debajo. Cada columna es un botón (cross-filter con teclado y
 * `aria-pressed`). El orden lo decide quien la usa (académico, no por volumen).
 */
@Component({
  selector: 'sipra-reportes-columnas',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gc { --gc-alto: 168px; --gc-y: 2.4rem; display: grid; grid-template-columns: var(--gc-y) minmax(0, 1fr); column-gap: 8px; }
    .gc-y { position: relative; height: var(--gc-alto); margin-top: 18px; }
    .gc-y span { position: absolute; right: 0; transform: translateY(50%); font: 500 11px/14px var(--fuente-mono); color: var(--gr-texto-eje); transition: bottom var(--gr-dur) var(--gr-ease); }
    .gc-area { position: relative; }
    .gc-rejilla { position: absolute; left: 0; right: 0; top: 18px; height: var(--gc-alto); pointer-events: none; }
    .gc-linea { position: absolute; left: 0; right: 0; height: 1px; background: var(--gr-rejilla); transition: bottom var(--gr-dur) var(--gr-ease); }
    .gc-linea.base { background: var(--gr-eje); }
    .gc-cols { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px; margin: 0; padding: 0; list-style: none; }
    .gc-col { display: grid; grid-template-rows: 18px var(--gc-alto) auto; width: 100%; padding: 0; font: inherit; color: var(--text-primary); background: none; border: 0; border-radius: 4px; cursor: pointer; }
    .gc-col:hover, .gc-col.activa { background: var(--gr-hover); }
    .gc-col:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gc-pista { position: relative; grid-row: 2; display: flex; align-items: flex-end; justify-content: center; }
    .gc-barra { position: relative; width: min(46px, 62%); background: var(--c); border-radius: 3px 3px 0 0; transition: height var(--gr-dur) var(--gr-ease), opacity 180ms ease, background-color 180ms ease; }
    .gc-valor { position: absolute; left: 50%; transform: translate(-50%, -4px); transition: bottom var(--gr-dur) var(--gr-ease); font: 500 12px/14px var(--fuente-mono); font-variant-numeric: tabular-nums; color: var(--gr-valor, var(--c)); white-space: nowrap; }
    .gc-x { grid-row: 3; padding: 6px 2px 2px; font-size: 12px; line-height: 16px; color: var(--text-secondary); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gc-col[aria-pressed='true'] .gc-x, .gc-col[aria-pressed='true'] .gc-valor, .gc-col.activa .gc-valor { font-weight: 600; color: var(--text-primary); }
    .gc.con-hover .gc-col:not(.activa) .gc-barra { opacity: .42; }
    .gc.con-seleccion .gc-col[aria-pressed='false'] .gc-barra { background: var(--gr-muted); }
    .gc-t { grid-column: 2; margin-top: 2px; text-align: center; }
    @media (width < 700px) { .gc { --gc-alto: 132px; --gc-y: 2rem; } .gc-cols { gap: 3px; } }
  `],
  template: `
    <div class="gr-marco gc" #marco [class.con-seleccion]="!!seleccion()" [class.con-hover]="!!hover()">
      <div class="gc-y" aria-hidden="true">@for (m of esc().marcas; track $index) { <span [style.bottom.%]="(m * 100) / esc().max">{{ num(m) }}</span> }</div>
      <div class="gc-area">
        <div class="gc-rejilla" aria-hidden="true">@for (m of esc().marcas; track $index) { <span class="gc-linea" [class.base]="m === 0" [style.bottom.%]="(m * 100) / esc().max"></span> }</div>
        <ul class="gc-cols" [attr.aria-label]="titulo()">
          @for (i of items(); track i.clave) {
            <li>
              <button type="button" class="gc-col" [class.activa]="hover() === i.clave" [attr.aria-pressed]="i.clave === seleccion()" [attr.aria-label]="aria(i)"
                      (click)="elegir.emit(i.clave)" (mouseenter)="ver($event, i)" (mousemove)="ver($event, i)" (mouseleave)="salir()" (focus)="ver($event, i)" (blur)="salir()">
                <span class="gc-pista" aria-hidden="true" [class]="'gt-' + tono()"><span class="gc-barra" [style.height.%]="(i.n * 100) / esc().max"></span><span class="gc-valor" [style.bottom.%]="(i.n * 100) / esc().max">{{ num(i.n) }}</span></span>
                <span class="gc-x" aria-hidden="true">{{ corto()(i) }}</span>
              </button>
            </li>
          }
        </ul>
      </div>
      <span class="gr-eje-t gc-t" aria-hidden="true">{{ ejeX() }}</span>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
  `,
})
export class ReportesColumnasComponent {
  readonly titulo = input.required<string>();
  readonly items = input.required<ItemBarra[]>();
  readonly total = input.required<number>();
  readonly unidad = input('estudiantes');
  readonly ejeX = input('');
  /** Rótulo corto bajo la columna (p. ej. «4» para «Semestre 4»); el tooltip y el `aria-label` usan el texto completo. */
  readonly corto = input<(i: ItemBarra) => string>((i) => i.texto);
  readonly seleccion = input('');
  readonly tono = input<TonoGrafico>('principal');
  readonly elegir = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly hover = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly esc = computed(() => escala(Math.max(0, ...this.items().map((i) => i.n)), 4));
  protected readonly num = num;

  private lineas(i: ItemBarra): string[] { return [`${num(i.n)} ${this.unidad()}`, `${pct1(i.n, this.total())} del universo filtrado`, ...(i.detalle ?? [])]; }
  protected aria(i: ItemBarra): string { return `${i.texto}: ${this.lineas(i).join(', ')}`; }
  protected ver(ev: Event, i: ItemBarra): void {
    this.hover.set(i.clave);
    this.tip.set(tipEn(this.marco().nativeElement, ev, i.texto, this.lineas(i), pieFiltro(i.clave === this.seleccion()), this.tono()));
  }
  protected salir(): void { this.hover.set(null); this.tip.set(null); }
}
