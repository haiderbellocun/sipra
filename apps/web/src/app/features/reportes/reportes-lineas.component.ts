import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TONOS_SERIE, TipGrafico, TonoGrafico, escala, num } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface SerieLinea { clave: string; texto: string; valores: number[]; tono?: TonoGrafico }

/** Máximo de series simultáneas: más líneas dejan de leerse (se elige cuáles con un selector). */
export const MAX_SERIES_LINEA = 5;
const ALTO = 220, M = { arriba: 14, derecha: 16, abajo: 30, izquierda: 44 };

/**
 * Líneas para tiempo (periodos, semanas): eje Y con marcas y rejilla horizontal tenue, eje X con las categorías en orden
 * cronológico, puntos en cada valor y un inspector vertical compartido (tooltip con todas las series en esa categoría).
 * El ancho sigue al contenedor (ResizeObserver). Si se escucha `elegirX`, los rótulos del eje X son botones (cross-filter).
 * La tabla equivalente la conserva quien la usa.
 */
@Component({
  selector: 'sipra-reportes-lineas',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gl svg { display: block; width: 100%; height: ${ALTO}px; overflow: visible; }
    .gl-rej { stroke: var(--gr-rejilla); stroke-width: 1; }
    .gl-rej.base { stroke: var(--gr-eje); }
    .gl-my { font: 500 11px/1 var(--fuente-mono); fill: var(--gr-texto-eje); }
    .gl-linea { fill: none; stroke: var(--c); stroke-width: 2.25; stroke-linejoin: round; stroke-linecap: round; transition: opacity 180ms ease; }
    .gl-punto { fill: var(--surface-raised); stroke: var(--c); stroke-width: 2; transition: opacity 180ms ease; }
    .gl-punto.activo { fill: var(--c); }
    .gl-guia { stroke: var(--gr-eje); stroke-dasharray: 3 3; }
    .gl.con-foco .gl-serie:not(.activa) .gl-linea, .gl.con-foco .gl-serie:not(.activa) .gl-punto { opacity: .3; }
    .gl-captura { fill: transparent; cursor: crosshair; }
    .gl-x { position: relative; height: 22px; margin: -24px 0 0; }
    .gl-xi { position: absolute; top: 0; transform: translateX(-50%); padding: 2px 4px; font: 500 11px/16px var(--fuente-mono); color: var(--gr-texto-eje); white-space: nowrap; background: none; border: 0; border-radius: 4px; }
    button.gl-xi { cursor: pointer; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; }
    button.gl-xi:hover { color: var(--text-primary); text-decoration-color: currentColor; }
    button.gl-xi:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gl-xi[aria-pressed='true'] { color: var(--text-primary); font-weight: 600; }
    .gl-ley { margin-top: 10px; }
    .gl-ley button { padding: 2px 4px; font: inherit; color: inherit; background: none; border: 0; border-radius: 4px; cursor: default; }
    .gl-trazo { display: inline-block; width: 14px; height: 2px; margin-right: 6px; background: var(--c); vertical-align: 3px; border-radius: 1px; }
  `],
  template: `
    <div class="gr-marco gl" #marco [class.con-foco]="!!serieFoco()">
      <svg [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto" aria-hidden="true" (mouseleave)="salir()">
        @for (m of esc().marcas; track $index) {
          <line class="gl-rej" [class.base]="m === 0" [attr.x1]="mg.izquierda" [attr.x2]="ancho() - mg.derecha" [attr.y1]="y(m)" [attr.y2]="y(m)" />
          <text class="gl-my" [attr.x]="mg.izquierda - 8" [attr.y]="y(m) + 4" text-anchor="end">{{ formatoY()(m) }}</text>
        }
        @if (indice() !== null) { <line class="gl-guia" [attr.x1]="x(indice()!)" [attr.x2]="x(indice()!)" [attr.y1]="mg.arriba" [attr.y2]="alto - mg.abajo" /> }
        @for (s of trazos(); track s.clave) {
          <g class="gl-serie" [class]="'gt-' + s.tono" [class.activa]="serieFoco() === s.clave">
            <path class="gl-linea" [attr.d]="s.d" />
            @for (p of s.puntos; track $index) { <circle class="gl-punto" [class.activo]="indice() === $index" [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="indice() === $index ? 4.5 : 3.25" /> }
          </g>
        }
        <rect class="gl-captura" [attr.x]="mg.izquierda" [attr.y]="mg.arriba" [attr.width]="ancho() - mg.izquierda - mg.derecha" [attr.height]="alto - mg.arriba - mg.abajo" (mousemove)="mover($event)" />
      </svg>
      <div class="gl-x">
        @for (c of categorias(); track c; let i = $index) {
          @if (filtrable()) {
            <button type="button" class="gl-xi" [style.left.px]="x(i)" [attr.aria-pressed]="c === seleccionX()" [attr.aria-label]="c + ': ' + resumen(i)" (click)="elegirX.emit(c)">{{ corto()(c) }}</button>
          } @else { <span class="gl-xi" [style.left.px]="x(i)" aria-hidden="true">{{ corto()(c) }}</span> }
        }
      </div>
      <ul class="gr-leyenda gl-ley" aria-hidden="true">
        @for (s of trazos(); track s.clave) { <li><button type="button" tabindex="-1" [class]="'gt-' + s.tono" (mouseenter)="serieFoco.set(s.clave)" (mouseleave)="serieFoco.set(null)"><span class="gl-trazo"></span>{{ s.texto }}</button></li> }
      </ul>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
  `,
})
export class ReportesLineasComponent {
  readonly titulo = input.required<string>();
  readonly categorias = input.required<string[]>();
  readonly series = input.required<SerieLinea[]>();
  readonly formatoY = input<(n: number) => string>((n) => num(n));
  readonly unidad = input('');
  /** Máximo fijo del eje (p. ej. 100 para tasas); por defecto, escala «redonda» sobre el dato. */
  readonly maxY = input<number | null>(null);
  readonly corto = input<(c: string) => string>((c) => c);
  readonly filtrable = input(false);
  readonly seleccionX = input('');
  readonly elegirX = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly ancho = signal(640);
  protected readonly alto = ALTO;
  protected readonly mg = M;
  protected readonly indice = signal<number | null>(null);
  protected readonly serieFoco = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly esc = computed(() => {
    const fijo = this.maxY();
    if (fijo) { const e = escala(fijo, 4, false); return e; }
    return escala(Math.max(0, ...this.series().flatMap((s) => s.valores)), 4);
  });
  protected readonly trazos = computed(() => this.series().slice(0, MAX_SERIES_LINEA).map((s, k) => {
    const puntos = s.valores.map((v, i) => ({ x: this.x(i), y: this.y(v) }));
    return { clave: s.clave, texto: s.texto, tono: s.tono ?? TONOS_SERIE[k % TONOS_SERIE.length], puntos, d: puntos.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') };
  }));

  constructor() {
    const destruir = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.marco().nativeElement;
      this.ancho.set(Math.max(280, el.clientWidth));
      if (typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(([e]) => this.ancho.set(Math.max(280, Math.round(e.contentRect.width))));
      ro.observe(el);
      destruir.onDestroy(() => ro.disconnect());
    });
  }

  protected x(i: number): number {
    const n = this.categorias().length, util = this.ancho() - M.izquierda - M.derecha;
    return n <= 1 ? M.izquierda + util / 2 : M.izquierda + 8 + (i * (util - 16)) / (n - 1);
  }
  protected y(v: number): number { return M.arriba + (1 - v / this.esc().max) * (ALTO - M.arriba - M.abajo); }
  protected resumen(i: number): string {
    return this.series().slice(0, MAX_SERIES_LINEA).map((s) => `${s.texto} ${this.formatoY()(s.valores[i] ?? 0)}${this.unidad() ? ' ' + this.unidad() : ''}`).join(', ');
  }

  protected mover(ev: MouseEvent): void {
    const svg = (ev.target as SVGElement).ownerSVGElement ?? (ev.target as SVGSVGElement);
    const caja = svg.getBoundingClientRect();
    const px = ((ev.clientX - caja.left) * this.ancho()) / caja.width;
    const n = this.categorias().length;
    if (!n) return;
    let mejor = 0;
    for (let i = 1; i < n; i++) if (Math.abs(this.x(i) - px) < Math.abs(this.x(mejor) - px)) mejor = i;
    this.indice.set(mejor);
    const m = this.marco().nativeElement.getBoundingClientRect();
    const xPx = caja.left - m.left + (this.x(mejor) * caja.width) / this.ancho();
    const lineas = this.series().slice(0, MAX_SERIES_LINEA).map((s) => `${s.texto}: ${this.formatoY()(s.valores[mejor] ?? 0)}${this.unidad() ? ' ' + this.unidad() : ''}`);
    this.tip.set({ x: xPx, y: ev.clientY - m.top, titulo: this.categorias()[mejor], lineas, pie: this.filtrable() ? 'Clic en el periodo (eje) para filtrar' : undefined, izquierda: xPx > m.width * 0.6 });
  }
  protected salir(): void { this.indice.set(null); this.tip.set(null); }
}
