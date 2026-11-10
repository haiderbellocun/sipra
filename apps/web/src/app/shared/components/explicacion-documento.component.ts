import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TonoV3 } from './senal-estado.component';

/**
 * Explicación de un documento al estudiante (Kit V3): «¿Qué pasó?» y «¿Qué debo hacer?» con una línea de señal del tono del
 * estado, sin caja. Aprobado: silenciosa (sin línea ni fondo). Presentacional: los textos llegan ya en lenguaje humano desde
 * quien la usa (RUT, Cámara, Acta); la acción existente se proyecta debajo. `role="status"` anuncia los cambios.
 */
@Component({
  selector: 'sipra-explicacion-documento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.data-tono]': 'tono()' },
  styles: [`
    :host {
      --t: var(--border-strong); --ok: var(--status-success); --aviso: var(--status-review); --peligro: var(--status-critical);
      display: grid; gap: 4px; margin-top: 8px; padding: 8px 0 8px 14px; border-left: 2px solid var(--t);
      background: linear-gradient(90deg, color-mix(in srgb, var(--t) 9%, transparent), transparent 75%);
      animation: entra 200ms var(--ease-out) both;
    }
    :host-context([data-theme='light']) { --ok: #06695d; --aviso: #7a4a00; --peligro: #b8231f; }
    :host([data-tono='aviso']) { --t: var(--aviso); }
    :host([data-tono='peligro']) { --t: var(--peligro); }
    :host([data-tono='info']) { --t: var(--status-available); }
    :host([data-tono='neutra']) { background: none; }
    /* Aprobado: silenciosa, sin línea ni fondo. */
    :host([data-tono='ok']) { padding-left: 0; border-left: 0; background: none; }
    :host([data-tono='ok']) p { color: var(--text-secondary); }
    p { margin: 0; font-size: 13px; line-height: 20px; color: var(--text-primary); overflow-wrap: anywhere; }
    .rotulo { font-weight: 600; }
    :host([data-tono='aviso']) .hacer .rotulo { color: var(--aviso); }
    :host([data-tono='peligro']) .hacer .rotulo { color: var(--peligro); }
    .accion:not(:empty) { margin-top: 6px; }
    @keyframes entra { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { :host { animation: none; } }
  `],
  template: `
    <p class="que"><span class="rotulo">¿Qué pasó?</span> {{ que() }}</p>
    <p class="hacer"><span class="rotulo">¿Qué debo hacer?</span> {{ hacer() }}</p>
    <div class="accion"><ng-content /></div>
  `,
})
export class ExplicacionDocumentoComponent {
  readonly tono = input<TonoV3>('neutra');
  readonly que = input.required<string>();
  readonly hacer = input.required<string>();
}
