import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { ParteGrafico, TipGrafico, num, pieFiltro, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Un segmento solo lleva su % adentro si ocupa al menos esta fracción (criterio `labelSkipWidth`). */
export const MIN_ROTULO_SEGMENTO = 0.09;

/**
 * Barra 100 % apilada (composición de un total) con leyenda compacta: nombre, cantidad y porcentaje. Pasar el puntero por
 * un segmento o por su entrada de leyenda resalta ese segmento y atenúa el resto; el clic (o Enter en la leyenda) aplica
 * el cross-filter y un segundo clic lo quita. Los controles accesibles son los de la leyenda (`aria-pressed`); la barra
 * es la misma información para el mouse. El % va dentro del segmento solo si cabe.
 */
@Component({
  selector: 'sipra-reportes-proporcion',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gp-barra { display: flex; gap: 2px; height: var(--gp-alto, 28px); margin: 2px 0 12px; }
    .gp-seg { position: relative; display: grid; place-items: center; min-width: 4px; overflow: hidden; background: var(--c); border-radius: 2px; cursor: pointer;
      transition: flex-grow var(--gr-dur) var(--gr-ease), opacity 180ms ease, background-color 180ms ease; }
    .gp-seg:first-child { border-radius: 4px 2px 2px 4px; } .gp-seg:last-child { border-radius: 2px 4px 4px 2px; }
    .gp-seg span { font: 600 11px/1 var(--fuente-mono); color: var(--text-inverse); white-space: nowrap; }
    :host-context([data-theme='light']) .gp-seg span { color: #ffffff; }
    .gp-seg.gt-muted span { color: var(--text-primary); }
    .gp.estatico .gp-seg { cursor: default; }
    .gp.con-foco .gp-seg:not(.activa) { opacity: .35; }
    .gp.con-seleccion .gp-seg.fuera { background: var(--gr-muted); }
    .gp-ley { display: flex; flex-wrap: wrap; gap: 2px 4px; margin: 0; padding: 0; list-style: none; }
    .gp-item { display: inline-grid; grid-template-columns: auto auto auto; column-gap: 8px; align-items: baseline; min-height: 30px; padding: 4px 8px; font: inherit; font-size: 13px;
      color: var(--text-primary); text-align: left; background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
    .gp-item:hover, .gp-item.activa { background: var(--gr-hover); }
    .gp-item:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gp-item[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); font-weight: 600; }
    .gp-item[aria-disabled='true'] { cursor: default; }
    .gp-n { font: 600 13px/18px var(--fuente-mono); font-variant-numeric: tabular-nums; }
    .gp-p { font: 500 12px/18px var(--fuente-mono); color: var(--text-secondary); }
    /* Grande: dos o tres categorías con cifra dominante (p. ej. interna CUN / externa). */
    .gp.grande .gp-item { grid-template-columns: auto auto; grid-template-rows: auto auto; row-gap: 0; padding: 6px 14px 6px 8px; }
    .gp.grande .gp-item .gp-txt { grid-column: 1 / -1; font-size: 12px; color: var(--text-secondary); }
    .gp.grande .gp-n { font-size: 22px; line-height: 28px; }
  `],
  template: `
    <div class="gr-marco gp" #marco [class.grande]="grande()" [class.estatico]="!seleccionable()" [class.con-foco]="!!hover()" [class.con-seleccion]="!!seleccion()">
      <div class="gp-barra" aria-hidden="true">
        @for (p of partes(); track p.clave) {
          <span class="gp-seg" [class]="'gt-' + p.tono" [class.activa]="hover() === p.clave" [class.fuera]="!!seleccion() && seleccion() !== p.clave" [style.flex-grow]="p.n"
                (click)="pulsar(p.clave)" (mouseenter)="ver($event, p)" (mousemove)="ver($event, p)" (mouseleave)="salir()">
            @if (p.n / suma() >= minRotulo) { <span>{{ p.pct }}</span> }
          </span>
        }
      </div>
      <ul class="gp-ley" [attr.aria-label]="titulo()">
        @for (p of partes(); track p.clave) {
          <li>
            <button type="button" class="gp-item" [class.activa]="hover() === p.clave" [attr.aria-pressed]="seleccionable() ? seleccion() === p.clave : null"
                    [attr.aria-disabled]="seleccionable() ? null : true" [attr.aria-label]="p.texto + ': ' + num(p.n) + ' ' + unidad() + ', ' + p.pct"
                    (click)="pulsar(p.clave)" (mouseenter)="ver($event, p)" (mouseleave)="salir()" (focus)="ver($event, p)" (blur)="salir()">
              <span class="gp-txt"><span class="gr-muestra" [class]="'gt-' + p.tono" aria-hidden="true"></span>{{ p.texto }}</span>
              <span class="gp-n">{{ num(p.n) }}</span><span class="gp-p">{{ p.pct }}</span>
            </button>
          </li>
        }
      </ul>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
  `,
})
export class ReportesProporcionComponent {
  readonly titulo = input.required<string>();
  readonly partes = input.required<ParteGrafico[]>();
  readonly unidad = input('estudiantes');
  /** Texto del % en el tooltip (p. ej. «de las prácticas filtradas»). */
  readonly base = input('del universo filtrado');
  readonly seleccion = input('');
  readonly seleccionable = input(true);
  readonly grande = input(false);
  readonly elegir = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly hover = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly suma = computed(() => this.partes().reduce((n, p) => n + p.n, 0) || 1);
  protected readonly minRotulo = MIN_ROTULO_SEGMENTO;
  protected readonly num = num;

  protected ver(ev: Event, p: ParteGrafico): void {
    this.hover.set(p.clave);
    this.tip.set(tipEn(this.marco().nativeElement, ev, p.texto, [`${num(p.n)} ${this.unidad()}`, `${p.pct} ${this.base()}`],
      this.seleccionable() ? pieFiltro(p.clave === this.seleccion()) : undefined, p.tono));
  }
  protected salir(): void { this.hover.set(null); this.tip.set(null); }
  protected pulsar(clave: string): void { if (this.seleccionable()) this.elegir.emit(clave); }
}
