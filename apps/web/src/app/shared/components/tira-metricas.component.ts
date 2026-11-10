import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TonoV3 } from './senal-estado.component';

export interface MetricaV3 { n: number; t: string; tono: TonoV3; contexto: string }

/**
 * Franja de métricas (Kit V3): cifras en una sola franja con separadores finos, cada una con cifra mono,
 * rótulo con punto de señal y contexto mínimo. Presentacional: las cifras las calcula quien la usa.
 */
@Component({
  selector: 'sipra-tira-metricas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); margin: 0; padding: 0; list-style: none; }
    li { display: grid; gap: 2px; padding: 4px 20px 4px 18px; border-left: 1px solid var(--vd-regla, var(--border-subtle)); }
    li:first-child { border-left: 0; padding-left: 0; }
    .valor { font: 500 34px/40px var(--fuente-mono); letter-spacing: -.03em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .rotulo { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .ctx { font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    :host-context([data-theme='dark']) .ctx { color: #94aeac; }
    :host-context([data-theme='light']) .ctx { color: var(--text-secondary); }
    .punto { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    :host { --t-aviso: var(--status-review); --t-peligro: var(--status-critical); }
    :host-context([data-theme='light']) { --t-aviso: #7a4a00; --t-peligro: #b8231f; }
    .tono-ok .punto { background: var(--status-success); } .tono-aviso .punto { background: var(--t-aviso); }
    .tono-peligro .punto { background: var(--t-peligro); } .tono-info .punto { background: var(--status-available); }
    .tono-neutra .punto { background: var(--text-secondary); }
    /* Compacta (pantallas de trabajo): cifra de 24 px en una línea con su rótulo. */
    :host(.compacta) li { grid-template-columns: auto 1fr; column-gap: 10px; align-items: baseline; padding-block: 2px; }
    :host(.compacta) .valor { grid-row: 1 / span 2; font-size: 26px; line-height: 32px; }
    /* Estrecha (columna lateral de ~300 px): tres columnas apiladas, cifra sobre rótulo. Opt-in por clase. */
    :host(.estrecha) ul { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); }
    :host(.estrecha) li { padding: 0 10px; }
    :host(.estrecha) li:first-child { padding-left: 0; }
    :host(.estrecha) .valor { font-size: 28px; line-height: 34px; }
    :host(.estrecha) .rotulo { font-size: 12px; gap: 6px; }
    @media (width < 700px) {
      ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      li { padding: 8px 12px; border-left: 0; border-top: 1px solid var(--vd-regla, var(--border-subtle)); }
      li:nth-child(-n+2) { border-top: 0; }
      li:first-child { padding-left: 12px; }
      .valor { font-size: 28px; line-height: 34px; }
    }
  `],
  template: `
    <ul [attr.aria-label]="etiqueta()">
      @for (m of metricas(); track m.t) {
        <li [class]="'tono-' + m.tono">
          <span class="valor">{{ m.n }}</span>
          <span class="rotulo"><span class="punto" aria-hidden="true"></span>{{ m.t }}</span>
          <span class="ctx">{{ m.contexto }}</span>
        </li>
      }
    </ul>
  `,
})
export class TiraMetricasComponent {
  readonly metricas = input.required<MetricaV3[]>();
  readonly etiqueta = input('Cifras');
}
