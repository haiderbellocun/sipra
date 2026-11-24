import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NO_DISPONIBLE_HISTORICO } from './reportes-paridad.util';

/**
 * Lugar de una gráfica de Actual cuya métrica no existe en el SGP (§32). Ocupa el mismo bloque y la misma altura que la
 * gráfica, para que cambiar de fuente no reacomode el reporte, y dice por qué no hay dato: nunca un cero ni una barra
 * genérica en su lugar.
 */
@Component({
  selector: 'sipra-reportes-no-disponible',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; place-content: center; justify-items: start; gap: 6px; min-height: var(--nd-alto, 160px); padding: 16px;
      border: 1px dashed var(--border-default); border-radius: 6px; background: color-mix(in srgb, var(--text-muted) 4%, transparent); }
    strong { font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    span { max-width: 46ch; font-size: 12px; line-height: 18px; color: var(--text-secondary); }
  `],
  host: { role: 'note' },
  template: `<strong>{{ titulo }}</strong><span>{{ motivo() }}</span>`,
})
export class ReportesNoDisponibleComponent {
  protected readonly titulo = NO_DISPONIBLE_HISTORICO;
  readonly motivo = input.required<string>();
}
