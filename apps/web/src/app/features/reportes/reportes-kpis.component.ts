import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { TonoGrafico, num, tonoDe } from './reportes-graficos.util';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Cifra de la tira: un rótulo terminado en « %» se muestra como tasa (unidad junto a la cifra, no en el rótulo). */
export function cifraKpi(m: MetricaV3): { rotulo: string; valor: string; unidad: string } {
  const tasa = / %$/.test(m.t);
  return { rotulo: tasa ? m.t.replace(/ %$/, '') : m.t, valor: num(m.n), unidad: tasa ? '%' : '' };
}

/**
 * Tira de KPI de Reportes (acabado BI): rótulo, cifra dominante con su unidad y contexto secundario, separados por
 * hairlines (no seis tarjetas). El tono es una marca mínima junto al rótulo. Presentacional: las cifras vienen calculadas.
 */
@Component({
  selector: 'sipra-reportes-kpis',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .kp { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); margin: 0; padding: 14px 0; list-style: none;
      border-top: 1px solid var(--ra-regla); border-bottom: 1px solid var(--ra-regla); }
    .kp-i { display: grid; align-content: start; gap: 4px; min-width: 0; padding: 2px 18px; border-left: 1px solid var(--ra-regla); }
    .kp-i:first-child { border-left: 0; padding-left: 0; }
    .kp-r { display: flex; align-items: center; gap: 7px; font: 500 12px/16px var(--fuente); color: var(--text-secondary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .kp-r i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 18%, transparent); }
    .kp-i { position: relative; }
    .kp-i::before { content: ''; position: absolute; top: -15px; left: 18px; width: 28px; height: 2px; border-radius: 1px; background: var(--c); }
    .kp-i:first-child::before { left: 0; }
    .kp-v { color: var(--text-primary); }
    .kp-v { color: color-mix(in srgb, var(--c) 55%, var(--text-primary)); }
    .kp-g { display: grid; margin: 0 0 6px; }
    .kp-g span { font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); padding-left: 18px; }
    .kp-g span:first-child { padding-left: 0; }
    .kp-i.corte { border-left-color: var(--border-strong); }
    .kp-c { color: var(--text-secondary) !important; }
    .kp-v { font: 500 32px/36px var(--fuente-mono); letter-spacing: -.03em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .kp-v small { margin-left: 3px; font-size: 18px; letter-spacing: 0; color: var(--text-secondary); }
    .kp-c { font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    :host-context([data-theme='light']) .kp-c { color: var(--text-secondary); }
    :host(.compacta) .kp-v { font-size: 26px; line-height: 30px; }
    @media (width < 700px) {
      .kp { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 4px 0; }
      .kp-i { padding: 10px 12px; border-left: 0; border-top: 1px solid var(--ra-regla); }
      .kp-i:nth-child(-n+2) { border-top: 0; }
      .kp-i:nth-child(odd) { padding-left: 0; }
      .kp-v { font-size: 26px; line-height: 30px; }
    }
  `],
  template: `
    @if (grupos().length) {
      <div class="kp-g" aria-hidden="true" [style.grid-template-columns]="columnasGrupos()">@for (g of grupos(); track g.titulo) { <span>{{ g.titulo }}</span> }</div>
    }
    <ul class="kp" [attr.aria-label]="etiqueta()">
      @for (k of cifras(); track k.m.t) {
        <li class="kp-i" [class]="'gt-' + (acento($index) || tono(k.m))" [class.corte]="corte($index)" [attr.aria-label]="grupoDe($index) + k.c.rotulo + ': ' + k.c.valor + (k.c.unidad ? ' ' + k.c.unidad : '') + ', ' + k.m.contexto">
          <span class="kp-r"><i aria-hidden="true"></i>{{ k.c.rotulo }}</span>
          <span class="kp-v">{{ k.c.valor }}@if (k.c.unidad) { <small>{{ k.c.unidad }}</small> }</span>
          <span class="kp-c">{{ k.m.contexto }}</span>
        </li>
      }
    </ul>
  `,
})
export class ReportesKpisComponent {
  readonly etiqueta = input.required<string>();
  readonly metricas = input.required<MetricaV3[]>();
  /** Acento por cifra (microseñal: punto y hairline); sin él, el tono de estado de la métrica. */
  readonly acentos = input<readonly TonoGrafico[]>([]);
  /** Agrupación por universo (p. ej. Operación · Expedientes · Documentación): títulos y cuántas cifras tiene cada grupo. */
  readonly grupos = input<readonly { titulo: string; n: number }[]>([]);
  protected readonly columnasGrupos = computed(() => this.grupos().map((g) => `${g.n}fr`).join(' '));
  protected corte(i: number): boolean { let acum = 0; for (const g of this.grupos()) { acum += g.n; if (i === acum && i > 0) return true; } return false; }
  protected grupoDe(i: number): string { let acum = 0; for (const g of this.grupos()) { acum += g.n; if (i < acum) return `${g.titulo}. `; } return ''; }
  protected readonly cifras = computed(() => this.metricas().map((m) => ({ m, c: cifraKpi(m) })));
  protected tono(m: MetricaV3): string { return tonoDe(m.tono); }
  protected acento(i: number): string { return this.acentos()[i] ?? ''; }
}
