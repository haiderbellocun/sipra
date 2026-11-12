import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { horas as textoHoras } from './reportes-analitica.util';
import { TipGrafico, TonoGrafico, categorico, escucharMovil, num } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface PuntoSwarm { grupo: string; horas: number; detalle: string }
export interface GrupoSwarm { clave: string; texto: string; mediana: number | null; n: number }

/** Escala logarítmica de horas: los tiempos de decisión van de minutos a semanas (lineal escondería la mayoría). */
export const MARCAS_HORAS: readonly { h: number; t: string }[] = [
  { h: 0.1, t: '6 min' }, { h: 1, t: '1 h' }, { h: 4, t: '4 h' }, { h: 24, t: '1 d' }, { h: 72, t: '3 d' }, { h: 168, t: '1 sem' }, { h: 720, t: '1 mes' },
];
const MIN_H = 0.05, MAX_H = 1500, R = 2.6, ALTO_FILA = 46;
export const posLog = (h: number): number => (Math.log10(Math.min(MAX_H, Math.max(MIN_H, h))) - Math.log10(MIN_H)) / (Math.log10(MAX_H) - Math.log10(MIN_H));

/**
 * Enjambre (beeswarm) determinista: cada punto conserva su X exacta y se desplaza en Y lo mínimo para no tocar a los
 * anteriores (alternando arriba y abajo). Si la fila se llena, el punto queda en el borde (densidad visible, sin perderlo).
 */
export function enjambre(xs: readonly number[], r: number, medio: number): number[] {
  const orden = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const y = Array<number>(xs.length).fill(0);
  const puestos: { x: number; y: number }[] = [];
  const d2 = (2 * r) ** 2;
  for (const p of orden) {
    const cerca = puestos.filter((q) => p.x - q.x < 2 * r);
    let elegido = medio;
    for (let k = 0; k <= Math.ceil(medio / r); k++) {
      const cand = [k * r, -k * r];
      const ok = cand.find((dy) => cerca.every((q) => (p.x - q.x) ** 2 + (dy - q.y) ** 2 >= d2));
      if (ok !== undefined) { elegido = ok; break; }
    }
    if (Math.abs(elegido) > medio) elegido = Math.sign(elegido) * medio;
    y[p.i] = elegido;
    puestos.push({ x: p.x, y: elegido });
    if (puestos.length > 400) puestos.shift();
  }
  return y;
}

/**
 * Distribución de tiempos de carga → decisión: un punto por decisión (muestra determinista acotada del servidor), agrupados
 * por tipo de documento o por programa, con la mediana del grupo marcada. Muestra concentración y valores atípicos, no solo
 * mediana y p90. En móvil: tabla de medianas por grupo.
 */
@Component({
  selector: 'sipra-reportes-swarm',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gw svg { display: block; width: 100%; overflow: visible; }
    .gw-rej { stroke: var(--gr-rejilla); }
    .gw-sep { stroke: var(--gr-rejilla); stroke-dasharray: 2 4; }
    .gw-m { font: 500 11px/1 var(--fuente-mono); fill: var(--gr-texto-eje); }
    .gw-g { font: 500 12px/1 var(--fuente); fill: var(--text-primary); }
    .gw-gn { font: 500 11px/1 var(--fuente-mono); fill: var(--text-secondary); }
    .gw-pt { fill: var(--c); fill-opacity: .78; transition: fill-opacity 160ms ease; }
    .gw-fila:hover .gw-pt { fill-opacity: 1; }
    .gw.con-foco .gw-fila:not(.foco) .gw-pt { fill-opacity: .2; }
    .gw-med { stroke: var(--text-primary); stroke-width: 2; }
    .gw-med-t { font: 650 10px/1 var(--fuente-mono); fill: var(--text-primary); }
    .gw-cap { fill: transparent; }
  `],
  template: `
    @if (movil()) {
      <table class="ra-tabla">
        <caption class="ra-sr">{{ titulo() }}: mediana por grupo</caption>
        <thead><tr><th scope="col">{{ rotulo() }}</th><th scope="col" class="d">Decisiones</th><th scope="col" class="d">Mediana</th></tr></thead>
        <tbody>@for (g of filas(); track g.clave) { <tr><th scope="row">{{ g.texto }}</th><td class="d">{{ num(g.n) }}</td><td class="d">{{ horasTxt(g.mediana) }}</td></tr> }</tbody>
      </table>
    } @else {
      <div class="gr-marco gw" #marco [class.con-foco]="!!foco()">
        <svg [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto()" [attr.height]="alto()" aria-hidden="true">
          @for (m of marcas; track m.h) {
            <line class="gw-rej" [attr.x1]="xh(m.h)" [attr.x2]="xh(m.h)" y1="0" [attr.y2]="alto() - 22" />
            <text class="gw-m" [attr.x]="xh(m.h)" [attr.y]="alto() - 6" text-anchor="middle">{{ m.t }}</text>
          }
          @for (f of dibujo(); track f.clave; let k = $index) {
            <g class="gw-fila" [class]="'gt-' + f.tono" [class.foco]="foco() === f.clave" (mouseenter)="foco.set(f.clave)" (mouseleave)="foco.set(null); tip.set(null)">
              <line class="gw-sep" [attr.x1]="izq" [attr.x2]="ancho() - 12" [attr.y1]="f.y0 + filaAlto" [attr.y2]="f.y0 + filaAlto" />
              <text class="gw-g" x="0" [attr.y]="f.y0 + filaAlto / 2 - 2">{{ f.corto }}</text>
              <text class="gw-gn" x="0" [attr.y]="f.y0 + filaAlto / 2 + 12">{{ num(f.n) }} · med. {{ horasTxt(f.mediana) }}</text>
              <rect class="gw-cap" [attr.x]="izq" [attr.y]="f.y0" [attr.width]="ancho() - izq - 12" [attr.height]="filaAlto" />
              @for (p of f.puntos; track $index) { <circle class="gw-pt" [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="r" (mouseenter)="ver($event, f, p.h, p.d)" /> }
              @if (f.mediana !== null) {
                <line class="gw-med" [attr.x1]="xh(f.mediana)" [attr.x2]="xh(f.mediana)" [attr.y1]="f.y0 + 6" [attr.y2]="f.y0 + filaAlto - 6" />
              }
            </g>
          }
        </svg>
        <sipra-reportes-tooltip [tip]="tip()" />
      </div>
    }
  `,
})
export class ReportesSwarmComponent {
  readonly titulo = input.required<string>();
  readonly puntos = input.required<PuntoSwarm[]>();
  readonly grupos = input.required<GrupoSwarm[]>();
  readonly rotulo = input('Grupo');
  readonly tono = input<TonoGrafico | null>(null);

  private readonly marco = viewChild<ElementRef<HTMLElement>>('marco');
  protected readonly marcas = MARCAS_HORAS;
  protected readonly r = R;
  protected readonly filaAlto = ALTO_FILA;
  protected readonly izq = 190;
  protected readonly num = num;
  protected readonly ancho = signal(900);
  protected readonly movil = signal(false);
  protected readonly foco = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly filas = computed(() => this.grupos());
  protected readonly alto = computed(() => this.grupos().length * ALTO_FILA + 26);
  protected readonly dibujo = computed(() => this.grupos().map((g, k) => {
    const ps = this.puntos().filter((p) => p.grupo === g.clave);
    const xs = ps.map((p) => this.xh(p.horas));
    const y0 = k * ALTO_FILA, medio = ALTO_FILA / 2 - R - 2;
    const ys = enjambre(xs, R, medio);
    return {
      clave: g.clave, n: g.n, mediana: g.mediana, y0, tono: this.tono() ?? categorico(k),
      corto: g.texto.length > 26 ? `${g.texto.slice(0, 25)}…` : g.texto, texto: g.texto,
      puntos: ps.map((p, i) => ({ x: xs[i], y: y0 + ALTO_FILA / 2 + ys[i], h: p.horas, d: p.detalle })),
    };
  }));

  constructor() {
    const destruir = inject(DestroyRef);
    destruir.onDestroy(escucharMovil(this.movil));
    afterNextRender(() => {
      const el = this.marco()?.nativeElement;
      if (!el) return;
      this.ancho.set(Math.max(520, el.clientWidth));
      if (typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(([e]) => this.ancho.set(Math.max(520, Math.round(e.contentRect.width))));
      ro.observe(el);
      destruir.onDestroy(() => ro.disconnect());
    });
  }

  protected xh(h: number): number { return this.izq + 8 + posLog(h) * (this.ancho() - this.izq - 28); }
  protected horasTxt(h: number | null): string { return textoHoras(h); }
  protected ver(ev: MouseEvent, f: { texto: string; tono: TonoGrafico; mediana: number | null }, h: number, d: string): void {
    const el = this.marco()?.nativeElement;
    if (!el) return;
    const m = el.getBoundingClientRect();
    const rel = f.mediana ? (h > f.mediana * 3 ? 'Más de 3 veces la mediana del grupo' : h < f.mediana / 3 ? 'Menos de un tercio de la mediana' : 'Cerca de la mediana del grupo') : '';
    this.tip.set({ x: ev.clientX - m.left, y: ev.clientY - m.top, titulo: f.texto, lineas: [textoHoras(h), d, ...(rel ? [rel] : [])], izquierda: ev.clientX - m.left > m.width * 0.6, tono: f.tono });
  }
}
