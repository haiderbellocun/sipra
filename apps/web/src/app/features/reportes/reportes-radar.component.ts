import { ChangeDetectionStrategy, Component, ElementRef, computed, input, signal, viewChild } from '@angular/core';
import { TipGrafico, TonoGrafico } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface EjeRadar { clave: string; texto: string; definicion: string }
export interface SerieRadar { clave: string; texto: string; valores: (number | null)[]; tono: TonoGrafico }
/** Un radar es un PERFIL: 5–6 ejes de tasas 0–100 y como mucho dos series (más polígonos se tapan entre sí). */
export const MAX_EJES_RADAR = 6;
export const MAX_SERIES_RADAR = 2;

const T = 300, C = T / 2, R = 104;

/**
 * Radar de perfil normalizado (todas las variables son tasas 0–100 comparables; nunca volúmenes mezclados con tasas).
 * Anillos 25/50/75/100, una o dos series (p. ej. el programa elegido frente al conjunto o a otro programa) y la tabla con
 * los mismos valores al lado: el radar compara la FORMA del perfil, la tabla da la cifra.
 */
@Component({
  selector: 'sipra-reportes-radar',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gr-r { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; }
    .gr-r svg { flex: none; width: ${T}px; max-width: 100%; height: auto; overflow: visible; }
    .gr-anillo { fill: none; stroke: var(--gr-rejilla); }
    .gr-radio { stroke: var(--gr-rejilla); }
    .gr-eje { font: 500 11px/1 var(--fuente); fill: var(--text-secondary); }
    .gr-anillo-t { font: 500 9px/1 var(--fuente-mono); fill: var(--gr-texto-eje); }
    .gr-poli { fill: var(--c); fill-opacity: .16; stroke: var(--c); stroke-width: 2.25; stroke-linejoin: round; transition: opacity 160ms ease; }
    .gr-poli.b { fill-opacity: .06; stroke-dasharray: 5 4; }
    .gr-v { fill: var(--c); cursor: default; }
    .gr-tabla { flex: 1 1 240px; }
    .gr-tabla td.c { color: var(--gr-valor, var(--c)); font-weight: 650; }
  `],
  template: `
    <div class="gr-marco gr-r" #marco>
      <svg [attr.viewBox]="'0 0 ' + t + ' ' + t" aria-hidden="true">
        @for (k of [25, 50, 75, 100]; track k) {
          <polygon class="gr-anillo" [attr.points]="anillo(k)" />
          <text class="gr-anillo-t" [attr.x]="c + 3" [attr.y]="c - (r * k) / 100 - 2">{{ k }}</text>
        }
        @for (e of ejes(); track e.clave; let i = $index) {
          <line class="gr-radio" [attr.x1]="c" [attr.y1]="c" [attr.x2]="punto(i, 100)[0]" [attr.y2]="punto(i, 100)[1]" />
          <text class="gr-eje" [attr.x]="punto(i, 122)[0]" [attr.y]="punto(i, 122)[1] + 4" [attr.text-anchor]="ancla(i)">{{ e.texto }}</text>
        }
        @for (s of series(); track s.clave; let j = $index) {
          <g [class]="'gt-' + s.tono">
            <polygon class="gr-poli" [class.b]="j === 1" [attr.points]="poligono(s)" />
            @for (v of s.valores; track $index; let i = $index) {
              @if (v !== null) { <circle class="gr-v" [attr.cx]="punto(i, v)[0]" [attr.cy]="punto(i, v)[1]" r="4" (mouseenter)="ver($event, s, i)" (mouseleave)="tip.set(null)" /> }
            }
          </g>
        }
      </svg>
      <table class="ra-tabla gr-tabla">
        <caption class="ra-sr">{{ titulo() }} (0–100)</caption>
        <thead><tr><th scope="col">Indicador (0–100)</th>@for (s of series(); track s.clave) { <th scope="col" class="d" [class]="'gt-' + s.tono"><span class="gr-muestra" aria-hidden="true"></span>{{ s.texto }}</th> }</tr></thead>
        <tbody>@for (e of ejes(); track e.clave; let i = $index) {
          <tr><th scope="row">{{ e.texto }}<br><span class="ra-tenue" style="font-size:11px">{{ e.definicion }}</span></th>
            @for (s of series(); track s.clave) { <td class="d c" [class]="'gt-' + s.tono">{{ s.valores[i] === null ? '—' : fmt(s.valores[i]!) }}</td> }</tr>
        }</tbody>
      </table>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
  `,
})
export class ReportesRadarComponent {
  readonly titulo = input.required<string>();
  readonly ejes = input.required<EjeRadar[]>();
  readonly series = input.required<SerieRadar[]>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly t = T;
  protected readonly c = C;
  protected readonly r = R;
  protected readonly tip = signal<TipGrafico | null>(null);
  private readonly n = computed(() => Math.min(MAX_EJES_RADAR, this.ejes().length));

  protected punto(i: number, v: number): [number, number] {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / this.n(), d = (R * Math.max(0, Math.min(100, v))) / 100;
    return [C + Math.cos(a) * d, C + Math.sin(a) * d];
  }
  protected ancla(i: number): string { const x = this.punto(i, 100)[0]; return Math.abs(x - C) < 8 ? 'middle' : x > C ? 'start' : 'end'; }
  protected anillo(k: number): string { return Array.from({ length: this.n() }, (_, i) => this.punto(i, k).join(',')).join(' '); }
  protected poligono(s: SerieRadar): string { return s.valores.slice(0, this.n()).map((v, i) => this.punto(i, v ?? 0).join(',')).join(' '); }
  protected fmt(v: number): string { return v.toLocaleString('es-CO', { maximumFractionDigits: 1 }); }
  protected ver(ev: MouseEvent, s: SerieRadar, i: number): void {
    const m = this.marco().nativeElement.getBoundingClientRect(), e = this.ejes()[i];
    this.tip.set({ x: ev.clientX - m.left, y: ev.clientY - m.top, titulo: `${s.texto} · ${e.texto}`, lineas: [`${this.fmt(s.valores[i] ?? 0)} de 100`, e.definicion], izquierda: ev.clientX - m.left > m.width * 0.6, tono: s.tono });
  }
}
