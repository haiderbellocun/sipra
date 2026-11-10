import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let siguienteId = 0;

/**
 * Estado vacío (Kit V3): Topology Orb sutil (SVG estático), título, explicación y, proyectada,
 * la acción que ya exista en la pantalla. Sin ilustraciones genéricas.
 */
@Component({
  selector: 'sipra-estado-vacio',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; justify-items: center; gap: 6px; padding: 28px 12px 24px; text-align: center; }
    svg { width: 120px; height: 84px; margin-bottom: 6px; }
    strong { font-size: 15px; color: var(--text-primary); }
    span { font-size: 13px; color: var(--text-secondary); max-width: 52ch; }
  `],
  template: `
    <svg viewBox="0 0 120 84" aria-hidden="true">
      <defs><radialGradient [id]="idOrbe" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="var(--signal-active)" stop-opacity=".35"/><stop offset="1" stop-color="var(--signal-active)" stop-opacity="0"/></radialGradient></defs>
      <circle cx="60" cy="42" r="40" [attr.fill]="'url(#' + idOrbe + ')'"/>
      <g fill="none" stroke="var(--signal-default)" stroke-width="1"><ellipse cx="60" cy="42" rx="26" ry="26" opacity=".7"/><ellipse cx="60" cy="42" rx="26" ry="9" opacity=".5"/><ellipse cx="60" cy="42" rx="9" ry="26" opacity=".5"/></g>
      <g fill="var(--signal-active)"><circle cx="34" cy="42" r="2.5"/><circle cx="86" cy="42" r="2.5"/><circle cx="60" cy="16" r="2.5"/><circle cx="60" cy="68" r="2.5"/></g>
    </svg>
    <strong>{{ titulo() }}</strong>
    <span>{{ texto() }}</span>
    <ng-content />
  `,
})
export class EstadoVacioComponent {
  readonly titulo = input.required<string>();
  readonly texto = input('');
  protected readonly idOrbe = `sipra-orbe-${++siguienteId}`;
}
