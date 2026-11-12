import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { TipGrafico, TonoGrafico, categorico, escucharMovil, num } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface SerieBump { clave: string; texto: string; valores: number[] }
/** Líneas visibles a la vez: más de 8 rankings cruzados dejan de leerse. */
export const MAX_BUMP = 8;
/** Líneas al abrir: cinco (colores categóricos bien distintos); se pueden elegir hasta MAX_BUMP. */
export const INICIAL_BUMP = 5;

/**
 * Ranking (1 = más estudiantes) de cada serie en cada categoría, calculado entre TODAS las series (no solo las visibles):
 * desempate por nombre, estable. Una serie sin valor en un periodo no tiene posición (null).
 */
export function rankings(series: readonly SerieBump[], n: number): (number | null)[][] {
  const r = series.map(() => Array<number | null>(n).fill(null));
  for (let i = 0; i < n; i++) {
    const orden = series.map((s, k) => ({ k, v: s.valores[i] ?? 0, t: s.texto })).filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || a.t.localeCompare(b.t));
    orden.forEach((x, pos) => { r[x.k][i] = pos + 1; });
  }
  return r;
}

const ALTO_FILA = 34, M = { arriba: 18, abajo: 30, izquierda: 30, derecha: 200 };

/**
 * Bump: cómo cambia la POSICIÓN de cada programa entre periodos (no su volumen; el volumen va en el tooltip). Eje X: periodos
 * en orden cronológico; eje Y: puesto 1…N. Se ven hasta 8 programas (los de más estudiantes, o los elegidos); pasar por una
 * línea o por su nombre la resalta y atenúa las demás. En móvil, la misma pregunta como tabla de puestos.
 */
@Component({
  selector: 'sipra-reportes-bump',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gu svg { display: block; width: 100%; overflow: visible; }
    .gu-rej { stroke: var(--gr-rejilla); }
    .gu-x { font: 500 11px/1 var(--fuente-mono); fill: var(--gr-texto-eje); }
    .gu-y { font: 500 11px/1 var(--fuente-mono); fill: var(--gr-texto-eje); }
    .gu-linea { fill: none; stroke: var(--c); stroke-width: 3; stroke-linecap: round; transition: opacity 180ms ease, stroke-width 180ms ease; }
    .gu-pt { fill: var(--surface-raised); stroke: var(--c); stroke-width: 2.5; transition: opacity 180ms ease; }
    .gu-pt-t { font: 650 10px/1 var(--fuente-mono); fill: var(--text-primary); pointer-events: none; }
    .gu-nom { font: 500 12px/1 var(--fuente); fill: var(--text-primary); cursor: pointer; }
    .gu-nom.fin { fill: var(--c); font-weight: 650; }
    .gu-serie { cursor: pointer; }
    .gu.con-foco .gu-serie:not(.foco) { opacity: .16; }
    .gu.con-foco .gu-serie.foco .gu-linea { stroke-width: 4.5; }
    .gu-elegir { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0 0 12px; padding: 0; list-style: none; }
    .gu-elegir button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; font: 500 12px/1 var(--fuente); color: var(--text-secondary);
      background: none; border: 1px solid var(--border-subtle); border-radius: 14px; cursor: pointer; }
    .gu-elegir button[aria-pressed='true'] { color: var(--text-primary); border-color: color-mix(in srgb, var(--c) 70%, transparent); }
    .gu-elegir button[aria-pressed='true'] i { background: var(--c); }
    .gu-elegir i { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--c); }
    .gu-elegir button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .gu-elegir button:disabled { opacity: .45; cursor: not-allowed; }
    .gu-sel { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px 14px; margin: 0 0 12px; }
    .gu-sel .gu-elegir { margin: 0; }
    .gu-mas { font-size: 12px; }
    .gu-mas summary { cursor: pointer; height: 28px; line-height: 28px; color: var(--text-secondary); }
    .gu-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 16px; margin-top: 6px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: 6px; }
    .gu-lista label { display: inline-flex; gap: 6px; align-items: center; color: var(--text-primary); }
  `],
  template: `
    <div class="gu-sel">
      <ul class="gu-elegir" aria-label="Programas en el ranking">
        @for (s of visiblesSeries(); track s.clave) {
          <li><button type="button" [class]="'gt-' + tonoDe(s.clave)" [attr.aria-pressed]="true" [attr.aria-label]="'Quitar ' + s.texto + ' del ranking'"
                      (click)="alternar(s.clave)" (mouseenter)="foco.set(s.clave)" (mouseleave)="foco.set(null)"><i aria-hidden="true"></i>{{ s.texto }} ×</button></li>
        }
      </ul>
      <details class="gu-mas">
        <summary>Elegir programas ({{ visibles().length }} de {{ max }})</summary>
        <div class="gu-lista">
          @for (s of candidatos(); track s.clave) {
            <label><input type="checkbox" [checked]="visibles().includes(s.clave)" [attr.aria-pressed]="visibles().includes(s.clave)" [disabled]="!visibles().includes(s.clave) && visibles().length >= max" (change)="alternar(s.clave)" />{{ s.texto }}</label>
          }
        </div>
      </details>
    </div>
    @if (movil()) {
      <div class="ra-desliza">
        <table class="ra-tabla">
          <caption class="ra-sr">{{ titulo() }}: puesto por periodo</caption>
          <thead><tr><th scope="col">Programa</th>@for (c of categorias(); track c) { <th scope="col" class="d">{{ c }}</th> }</tr></thead>
          <tbody>@for (s of trazos(); track s.clave) { <tr><th scope="row">{{ s.texto }}</th>@for (p of s.rangos; track $index) { <td class="d">{{ p ? '#' + p : '—' }}</td> }</tr> }</tbody>
        </table>
      </div>
    } @else {
      <div class="gr-marco gu" #marco [class.con-foco]="!!foco()">
        <svg [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto()" [attr.height]="alto()" aria-hidden="true">
          @for (k of puestos(); track k) {
            <line class="gu-rej" [attr.x1]="mg.izquierda" [attr.x2]="ancho() - mg.derecha" [attr.y1]="y(k)" [attr.y2]="y(k)" />
            <text class="gu-y" [attr.x]="mg.izquierda - 10" [attr.y]="y(k) + 4" text-anchor="end">{{ k }}</text>
          }
          @for (c of categorias(); track c; let i = $index) { <text class="gu-x" [attr.x]="x(i)" [attr.y]="alto() - 8" text-anchor="middle">{{ c }}</text> }
          @for (s of trazos(); track s.clave) {
            <g class="gu-serie" [class]="'gt-' + s.tono" [class.foco]="foco() === s.clave" (mouseenter)="foco.set(s.clave)" (mouseleave)="foco.set(null); tip.set(null)">
              <path class="gu-linea" [attr.d]="s.d" />
              @for (p of s.puntos; track p.i) {
                <circle class="gu-pt" [attr.cx]="p.x" [attr.cy]="p.y" r="10" (mousemove)="ver($event, s, p.i)" />
                <text class="gu-pt-t" [attr.x]="p.x" [attr.y]="p.y + 3.5" text-anchor="middle">{{ p.r }}</text>
              }
              @if (s.fin; as f) { <text class="gu-nom fin" [attr.x]="f.x + 16" [attr.y]="f.y + 4">{{ s.texto }}</text> }
            </g>
          }
        </svg>
        <sipra-reportes-tooltip [tip]="tip()" />
      </div>
    }
    <details style="margin-top:10px;font-size:13px">
      <summary style="cursor:pointer;color:var(--text-secondary);width:max-content">Ver puestos y estudiantes como tabla</summary>
      <div class="ra-desliza">
        <table class="ra-tabla" style="margin-top:8px">
          <caption class="ra-sr">{{ titulo() }}</caption>
          <thead><tr><th scope="col">Programa</th>@for (c of categorias(); track c) { <th scope="col" class="d">{{ c }}</th> }</tr></thead>
          <tbody>@for (s of trazos(); track s.clave) {
            <tr><th scope="row">{{ s.texto }}</th>@for (p of s.rangos; track $index) { <td class="d">{{ p ? '#' + p + ' · ' + s.valores[$index] : '—' }}</td> }</tr>
          }</tbody>
        </table>
      </div>
    </details>
  `,
})
export class ReportesBumpComponent {
  readonly titulo = input.required<string>();
  readonly categorias = input.required<string[]>();
  readonly series = input.required<SerieBump[]>();
  readonly unidad = input('estudiantes');

  private readonly marco = viewChild<ElementRef<HTMLElement>>('marco');
  protected readonly max = MAX_BUMP;
  protected readonly mg = M;
  protected readonly ancho = signal(900);
  protected readonly movil = signal(false);
  protected readonly foco = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  private readonly eleccion = signal<string[] | null>(null);
  /** Todas las series por volumen total (los candidatos del selector). */
  protected readonly candidatos = computed(() => [...this.series()].sort((a, b) => sum(b.valores) - sum(a.valores) || a.texto.localeCompare(b.texto)));
  protected readonly visiblesSeries = computed(() => this.candidatos().filter((s) => this.visibles().includes(s.clave)));
  protected readonly visibles = computed(() => (this.eleccion() ?? this.candidatos().slice(0, INICIAL_BUMP).map((s) => s.clave)).filter((k) => this.series().some((s) => s.clave === k)));
  private readonly rangos = computed(() => rankings(this.series(), this.categorias().length));
  /** El eje Y llega hasta el peor puesto de las series visibles (no hasta el total de programas). */
  protected readonly puestos = computed(() => {
    const peor = Math.max(1, ...this.trazosBase().flatMap((s) => s.rangos.filter((r): r is number => r !== null)));
    return Array.from({ length: peor }, (_, i) => i + 1);
  });
  protected readonly alto = computed(() => M.arriba + M.abajo + (this.puestos().length - 1) * ALTO_FILA + 20);
  private readonly trazosBase = computed(() => this.series().map((s, k) => ({ s, rangos: this.rangos()[k] })).filter((x) => this.visibles().includes(x.s.clave))
    .map(({ s, rangos }) => ({ clave: s.clave, texto: s.texto, valores: s.valores, rangos })));
  protected readonly trazos = computed(() => this.trazosBase().map((t) => {
    const puntos = t.rangos.map((r, i) => (r === null ? null : { i, r, x: this.x(i), y: this.y(r) })).filter((p): p is { i: number; r: number; x: number; y: number } => !!p);
    let d = '';
    puntos.forEach((p, k) => {
      if (k === 0 || puntos[k - 1].i !== p.i - 1) { d += `M${p.x},${p.y}`; return; }
      const a = puntos[k - 1], m = (a.x + p.x) / 2;
      d += `C${m},${a.y} ${m},${p.y} ${p.x},${p.y}`;
    });
    return { ...t, tono: this.tonoDe(t.clave), puntos, d, fin: puntos.at(-1) ?? null };
  }));

  constructor() {
    const destruir = inject(DestroyRef);
    destruir.onDestroy(escucharMovil(this.movil));
    afterNextRender(() => {
      const el = this.marco()?.nativeElement;
      if (!el) return;
      this.ancho.set(Math.max(480, el.clientWidth));
      if (typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(([e]) => this.ancho.set(Math.max(480, Math.round(e.contentRect.width))));
      ro.observe(el);
      destruir.onDestroy(() => ro.disconnect());
    });
  }

  /** Color estable por serie: su posición en el orden por volumen (no cambia al elegir otras). */
  protected tonoDe(clave: string): TonoGrafico { return categorico(this.candidatos().findIndex((s) => s.clave === clave)); }
  protected x(i: number): number {
    const n = this.categorias().length, util = this.ancho() - M.izquierda - M.derecha;
    return n <= 1 ? M.izquierda + util / 2 : M.izquierda + 12 + (i * (util - 24)) / (n - 1);
  }
  protected y(r: number): number { return M.arriba + (r - 1) * ALTO_FILA; }
  protected alternar(clave: string): void {
    const v = this.visibles();
    this.eleccion.set(v.includes(clave) ? v.filter((k) => k !== clave) : [...v, clave].slice(0, MAX_BUMP));
  }
  protected ver(ev: MouseEvent, s: { clave: string; texto: string; valores: number[]; rangos: (number | null)[] }, i: number): void {
    const el = this.marco()?.nativeElement;
    if (!el) return;
    const total = this.series().filter((x) => (x.valores[i] ?? 0) > 0).length;
    const ant = i > 0 ? s.rangos[i - 1] : null, r = s.rangos[i];
    const cambio = ant && r ? (ant > r ? `Sube ${ant - r} puesto${ant - r === 1 ? '' : 's'}` : ant < r ? `Baja ${r - ant} puesto${r - ant === 1 ? '' : 's'}` : 'Mantiene el puesto') : '';
    const m = el.getBoundingClientRect();
    this.tip.set({ x: ev.clientX - m.left, y: ev.clientY - m.top, titulo: `${s.texto} · ${this.categorias()[i]}`,
      lineas: [`Puesto ${r} de ${total}`, `${num(s.valores[i] ?? 0)} ${this.unidad()}`, ...(cambio ? [cambio] : [])], izquierda: ev.clientX - m.left > m.width * 0.6, tono: this.tonoDe(s.clave) });
  }
}

function sum(v: readonly number[]): number { return v.reduce((a, b) => a + b, 0); }
