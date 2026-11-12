import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { ParteGrafico, TipGrafico, num, pieFiltro, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Una dona solo se usa con pocas categorías: con más, el ángulo deja de leerse y corresponde una barra. */
export const MAX_PARTES_DONA = 4;
const R = 52;
const C = 2 * Math.PI * R;

/**
 * Dona compacta para 2–4 categorías (nivel de formación, interna/externa): arcos SVG con separación, total al centro y
 * leyenda con cantidad y %. Los controles accesibles son las entradas de la leyenda (botones con `aria-pressed`); el arco
 * es la misma información para el mouse. Hover resalta el arco; clic filtra y un segundo clic quita el filtro.
 */
@Component({
  selector: 'sipra-reportes-dona',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gd { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: center; }
    .gd svg { flex: none; }
    .gd-ley { flex: 1 1 200px; min-width: 0; }
    .gd svg { width: 132px; height: 132px; display: block; overflow: visible; }
    .gd-fondo { fill: none; stroke: var(--gr-rejilla); stroke-width: 16; }
    .gd-arco { fill: none; stroke: var(--c); stroke-width: 16; cursor: pointer; transition: stroke-dasharray var(--gr-dur) var(--gr-ease), stroke-dashoffset var(--gr-dur) var(--gr-ease), opacity 180ms ease, stroke-width 180ms ease; }
    .gd-arco.activa { stroke-width: 19; }
    .gd.con-foco .gd-arco:not(.activa) { opacity: .35; }
    .gd.con-seleccion .gd-arco.fuera { stroke: var(--gr-muted); }
    .gd-n { font: 600 22px/1 var(--fuente-mono); fill: var(--text-primary); }
    .gd-t { font: 500 11px/1 var(--fuente); fill: var(--text-secondary); }
    .gd-ley { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
    .gd-item { display: grid; grid-template-columns: minmax(0, 1fr) auto 3.8rem; column-gap: 10px; align-items: center; width: 100%; min-height: 30px; padding: 3px 8px;
      font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
    .gd-item:hover, .gd-item.activa { background: var(--gr-hover); }
    .gd-item:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gd-item[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); font-weight: 600; }
    .gd-item .gd-c { font: 600 13px/18px var(--fuente-mono); font-variant-numeric: tabular-nums; text-align: right; }
    .gd-item .gd-p { font: 500 12px/18px var(--fuente-mono); color: var(--text-secondary); text-align: right; }
    .gd-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (width < 700px) { .gd svg { width: 112px; height: 112px; } }
  `],
  template: `
    <div class="gr-marco gd" #marco [class.con-foco]="!!hover()" [class.con-seleccion]="!!seleccion()">
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle class="gd-fondo" cx="66" cy="66" [attr.r]="r" />
        @for (a of arcos(); track a.p.clave) {
          <circle class="gd-arco" [class]="'gt-' + a.p.tono" [class.activa]="hover() === a.p.clave" [class.fuera]="!!seleccion() && seleccion() !== a.p.clave"
                  cx="66" cy="66" [attr.r]="r" transform="rotate(-90 66 66)" [style.stroke-dasharray]="a.largo + ' ' + (c - a.largo)" [style.stroke-dashoffset]="-a.inicio"
                  (click)="elegir.emit(a.p.clave)" (mouseenter)="ver($event, a.p)" (mousemove)="ver($event, a.p)" (mouseleave)="salir()" />
        }
        <text class="gd-n" x="66" y="68" text-anchor="middle">{{ num(suma()) }}</text>
        <text class="gd-t" x="66" y="86" text-anchor="middle">{{ centro() }}</text>
      </svg>
      <ul class="gd-ley" [attr.aria-label]="titulo()">
        @for (p of partes(); track p.clave) {
          <li>
            <button type="button" class="gd-item" [class.activa]="hover() === p.clave" [attr.aria-pressed]="seleccion() === p.clave" [attr.aria-label]="p.texto + ': ' + num(p.n) + ' ' + unidad() + ', ' + p.pct"
                    (click)="elegir.emit(p.clave)" (mouseenter)="ver($event, p)" (mouseleave)="salir()" (focus)="ver($event, p)" (blur)="salir()">
              <span class="gd-txt"><span class="gr-muestra" [class]="'gt-' + p.tono" aria-hidden="true"></span>{{ p.texto }}</span>
              <span class="gd-c">{{ num(p.n) }}</span><span class="gd-p">{{ p.pct }}</span>
            </button>
          </li>
        }
      </ul>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
  `,
})
export class ReportesDonaComponent {
  readonly titulo = input.required<string>();
  readonly partes = input.required<ParteGrafico[]>();
  readonly unidad = input('estudiantes');
  /** Rótulo bajo el total central. */
  readonly centro = input('estudiantes');
  readonly seleccion = input('');
  readonly elegir = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly hover = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly r = R;
  protected readonly c = C;
  protected readonly num = num;
  protected readonly suma = computed(() => this.partes().reduce((n, p) => n + p.n, 0));
  /** Arcos con 2 px de separación entre categorías (si el arco lo permite). */
  protected readonly arcos = computed(() => {
    const total = this.suma() || 1, hueco = this.partes().length > 1 ? 2 : 0;
    let inicio = 0;
    return this.partes().map((p) => {
      const bruto = (p.n / total) * C;
      const a = { p, inicio: inicio + hueco / 2, largo: Math.max(0, bruto - hueco) };
      inicio += bruto;
      return a;
    });
  });

  protected ver(ev: Event, p: ParteGrafico): void {
    this.hover.set(p.clave);
    this.tip.set(tipEn(this.marco().nativeElement, ev, p.texto, [`${num(p.n)} ${this.unidad()}`, `${p.pct} del universo filtrado`], pieFiltro(p.clave === this.seleccion()), p.tono));
  }
  protected salir(): void { this.hover.set(null); this.tip.set(null); }
}
