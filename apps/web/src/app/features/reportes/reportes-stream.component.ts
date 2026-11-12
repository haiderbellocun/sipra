import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { Celda, pct1 } from './reportes-analitica.util';
import { TipGrafico, TonoGrafico, categorico, escucharMovil, num } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Bandas con color propio; el resto se agrupa en «Otras» SOLO para el dibujo (el tooltip muestra la composición completa). */
export const MAX_BANDAS = 5;
export const OTRAS_BANDA = '__otras__';

export interface BandaStream { clave: string; texto: string; valores: number[] }

/** Bandas del stream: las de mayor total + «Otras»; los datos de cada categoría no cambian. */
export function bandas(celdas: readonly Celda[], categorias: readonly string[], texto: (v: string) => string, max = MAX_BANDAS, otrasTexto = 'Otras'): BandaStream[] {
  const por = new Map<string, number[]>();
  for (const c of celdas) {
    const i = categorias.indexOf(c.fila);
    if (i < 0) continue;
    const v = por.get(c.columna) ?? Array<number>(categorias.length).fill(0);
    v[i] += c.estudiantes;
    por.set(c.columna, v);
  }
  const orden = [...por.entries()].sort((a, b) => sumar(b[1]) - sumar(a[1]) || a[0].localeCompare(b[0]));
  const propias = orden.slice(0, max).map(([clave, valores]) => ({ clave, texto: texto(clave), valores }));
  const resto = orden.slice(max);
  if (!resto.length) return propias;
  const otras = categorias.map((_, i) => resto.reduce((n, [, v]) => n + v[i], 0));
  return [...propias, { clave: OTRAS_BANDA, texto: `${otrasTexto} (${resto.length})`, valores: otras }];
}

const ALTO = 260, M = { arriba: 10, abajo: 28, izquierda: 12, derecha: 12 };

/**
 * Stream: composición de modalidades a través de los periodos. Las bandas se apilan alrededor de un eje central
 * (silhouette): el grosor es el número de estudiantes de cada modalidad en cada periodo. Top 5 + «Otras» con colores de la
 * paleta categórica; el inspector vertical muestra la composición COMPLETA de ese periodo. En móvil, la misma pregunta
 * como tabla.
 */
@Component({
  selector: 'sipra-reportes-stream',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gs svg { display: block; width: 100%; height: ${ALTO}px; overflow: visible; }
    .gs-banda { fill: var(--c); fill-opacity: .88; stroke: var(--surface-raised); stroke-width: .75; transition: fill-opacity 180ms ease; cursor: crosshair; }
    .gs-banda.gt-muted { fill: var(--bi-gris); fill-opacity: .45; }
    .gs.con-foco .gs-banda:not(.foco) { fill-opacity: .18; }
    .gs-x { font: 500 11px/1 var(--fuente-mono); fill: var(--gr-texto-eje); }
    .gs-guia { stroke: var(--text-primary); stroke-opacity: .5; stroke-dasharray: 3 3; }
    .gs-ley { margin-top: 10px; }
    .gs-ley button { display: inline-flex; align-items: center; padding: 2px 4px; font: inherit; color: inherit; background: none; border: 0; border-radius: 4px; cursor: default; }
    .gs-ley button:focus-visible { outline: 2px solid var(--signal-active); }
  `],
  template: `
    @if (movil()) {
      <div class="ra-desliza">
        <table class="ra-tabla">
          <caption class="ra-sr">{{ titulo() }}</caption>
          <thead><tr><th scope="col">Modalidad</th>@for (c of categorias(); track c) { <th scope="col" class="d">{{ c }}</th> }</tr></thead>
          <tbody>@for (b of bandas(); track b.clave) { <tr><th scope="row">{{ b.texto }}</th>@for (v of b.valores; track $index) { <td class="d">{{ v }}</td> }</tr> }</tbody>
        </table>
      </div>
    } @else {
      <div class="gr-marco gs" #marco [class.con-foco]="!!foco()">
        <svg [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto" aria-hidden="true" (mouseleave)="salir()">
          @for (c of capas(); track c.clave) {
            <path class="gs-banda" [class]="'gt-' + c.tono" [class.foco]="foco() === c.clave" [attr.d]="c.d" (mousemove)="mover($event)" (mouseenter)="foco.set(c.clave)" (mouseleave)="foco.set(null)" />
          }
          @if (indice() !== null) { <line class="gs-guia" [attr.x1]="x(indice()!)" [attr.x2]="x(indice()!)" [attr.y1]="mg.arriba" [attr.y2]="alto - mg.abajo" /> }
          @for (c of categorias(); track c; let i = $index) { <text class="gs-x" [attr.x]="x(i)" [attr.y]="alto - 8" text-anchor="middle">{{ c }}</text> }
        </svg>
        <ul class="gr-leyenda gs-ley" aria-label="Modalidades">
          @for (c of capas(); track c.clave) {
            <li><button type="button" [class]="'gt-' + c.tono" (mouseenter)="foco.set(c.clave)" (mouseleave)="foco.set(null)" (focus)="foco.set(c.clave)" (blur)="foco.set(null)">
              <span class="gr-muestra" aria-hidden="true"></span>{{ c.texto }} · {{ num(c.total) }}</button></li>
          }
        </ul>
        <sipra-reportes-tooltip [tip]="tip()" />
      </div>
    }
  `,
})
export class ReportesStreamComponent {
  readonly titulo = input.required<string>();
  readonly categorias = input.required<string[]>();
  readonly celdas = input.required<Celda[]>();
  readonly texto = input<(v: string) => string>((v) => v);
  readonly unidad = input('estudiantes');
  readonly otrasTexto = input('Otras');
  readonly maxBandas = input(MAX_BANDAS);

  private readonly marco = viewChild<ElementRef<HTMLElement>>('marco');
  protected readonly alto = ALTO;
  protected readonly mg = M;
  protected readonly num = num;
  protected readonly ancho = signal(900);
  protected readonly movil = signal(false);
  protected readonly foco = signal<string | null>(null);
  protected readonly indice = signal<number | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly bandas = computed(() => bandas(this.celdas(), this.categorias(), this.texto(), this.maxBandas(), this.otrasTexto()));
  private readonly maximo = computed(() => Math.max(1, ...this.categorias().map((_, i) => this.bandas().reduce((n, b) => n + b.valores[i], 0))));
  /** Silhouette: cada periodo se centra en el eje; curvas suaves (Bézier horizontal) entre periodos. */
  protected readonly capas = computed(() => {
    const n = this.categorias().length, util = ALTO - M.arriba - M.abajo, centro = M.arriba + util / 2, k = (util * 0.96) / this.maximo();
    const totales = this.categorias().map((_, i) => this.bandas().reduce((s, b) => s + b.valores[i], 0));
    const base = totales.map((t) => centro - (t * k) / 2);
    return this.bandas().map((b, j) => {
      const y0 = base.map((y, i) => y + this.bandas().slice(0, j).reduce((s, x) => s + x.valores[i], 0) * k);
      const y1 = y0.map((y, i) => y + b.valores[i] * k);
      const arriba = curva(y0.map((y, i) => [this.x(i), y]));
      const abajo = curva(y1.map((y, i) => [this.x(i), y]).reverse(), true);
      const tono: TonoGrafico = b.clave === OTRAS_BANDA ? 'muted' : categorico(j);
      return { clave: b.clave, texto: b.texto, tono, total: sumar(b.valores), d: n ? `${arriba}${abajo}Z` : '' };
    });
  });

  constructor() {
    const destruir = inject(DestroyRef);
    destruir.onDestroy(escucharMovil(this.movil));
    afterNextRender(() => {
      const el = this.marco()?.nativeElement;
      if (!el) return;
      this.ancho.set(Math.max(420, el.clientWidth));
      if (typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(([e]) => this.ancho.set(Math.max(420, Math.round(e.contentRect.width))));
      ro.observe(el);
      destruir.onDestroy(() => ro.disconnect());
    });
  }

  protected x(i: number): number {
    const n = this.categorias().length, util = this.ancho() - M.izquierda - M.derecha;
    return n <= 1 ? M.izquierda + util / 2 : M.izquierda + 24 + (i * (util - 48)) / (n - 1);
  }
  protected mover(ev: MouseEvent): void {
    const el = this.marco()?.nativeElement, svg = (ev.target as SVGElement).ownerSVGElement;
    if (!el || !svg) return;
    const caja = svg.getBoundingClientRect(), px = ((ev.clientX - caja.left) * this.ancho()) / caja.width;
    let i = 0;
    for (let k = 1; k < this.categorias().length; k++) if (Math.abs(this.x(k) - px) < Math.abs(this.x(i) - px)) i = k;
    this.indice.set(i);
    // Composición COMPLETA del periodo (todas las modalidades, también las agrupadas en «Otras»).
    const completas = new Map<string, number>();
    for (const c of this.celdas()) if (c.fila === this.categorias()[i]) completas.set(c.columna, (completas.get(c.columna) ?? 0) + c.estudiantes);
    const total = [...completas.values()].reduce((a, b) => a + b, 0);
    // Composición del periodo: estudiantes, participación y puesto de cada categoría (todas, también las de «Otros»).
    const lista = [...completas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const visibles = lista.slice(0, 8), resto = lista.slice(8);
    const lineas = [`${num(total)} ${this.unidad()} en ${this.categorias()[i]}`, ...visibles.map(([k, v], p) => `#${p + 1} ${this.texto()(k)}: ${num(v)} · ${pct1(v, total)}`),
      ...(resto.length ? [`… y ${resto.length} más: ${num(resto.reduce((n, [, v]) => n + v, 0))}`] : [])];
    const m = el.getBoundingClientRect();
    this.tip.set({ x: ev.clientX - m.left, y: ev.clientY - m.top, titulo: this.categorias()[i], lineas, izquierda: ev.clientX - m.left > m.width * 0.55, tono: 'principal' });
  }
  protected salir(): void { this.indice.set(null); this.tip.set(null); }
}

function sumar(v: readonly number[]): number { return v.reduce((a, b) => a + b, 0); }

/** Trayecto suave por puntos (Bézier con tangente horizontal en cada periodo). `continuar` = sin «M» inicial (une con L). */
function curva(p: readonly number[][], continuar = false): string {
  if (!p.length) return '';
  let d = `${continuar ? 'L' : 'M'}${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length; i++) {
    const m = (p[i - 1][0] + p[i][0]) / 2;
    d += `C${m.toFixed(1)},${p[i - 1][1].toFixed(1)} ${m.toFixed(1)},${p[i][1].toFixed(1)} ${p[i][0].toFixed(1)},${p[i][1].toFixed(1)}`;
  }
  return d;
}
