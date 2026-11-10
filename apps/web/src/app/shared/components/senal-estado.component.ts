import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

export type TonoV3 = 'ok' | 'aviso' | 'peligro' | 'info' | 'neutra';

/** Tono de los estados de práctica, señales y estados de documento (el mismo criterio que `sipra-estado`). */
const TONO: Record<string, TonoV3> = {
  activa: 'ok', certificada: 'ok', finalizada: 'info',
  en_validacion: 'aviso', documentacion: 'aviso', inscrita: 'neutra',
  suspendida: 'peligro', cancelada: 'peligro', anulada: 'neutra', reprobada: 'peligro',
  al_dia: 'ok', requiere_atencion: 'aviso', en_riesgo: 'peligro',
  auto_aprobado: 'ok', aprobado: 'ok', en_revision: 'aviso', ilegible: 'aviso', devuelto: 'aviso', rechazado: 'peligro',
  recibido: 'neutra', analizando: 'info',
};

export const tonoDe = (valor: string | null | undefined): TonoV3 => TONO[valor ?? ''] ?? 'neutra';

/**
 * Señal de estado (Kit V3): punto + texto, nunca solo color. Presentacional: recibe el valor de dominio
 * (estado o señal de una práctica, estado de un documento) y muestra su etiqueta legible con el tono semántico.
 * `tono` y `texto` permiten a quien ya calcula su propia presentación (p. ej. la guía del estudiante) usar la
 * misma señal sin traer su lógica aquí. En claro los tonos van un paso más profundos (≥ 4.5:1 medido).
 */
@Component({
  selector: 'sipra-senal-estado',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tono]': 'tonoFinal()' },
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; line-height: 16px; white-space: nowrap; color: var(--text-secondary); }
    :host::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
    :host([data-tono='ok']) { color: var(--t-ok); }
    :host { --t-ok: var(--status-success); --t-aviso: var(--status-review); --t-peligro: var(--status-critical); }
    :host-context([data-theme='light']) { --t-ok: #06695d; --t-aviso: #7a4a00; --t-peligro: #b8231f; }
    :host([data-tono='aviso']) { color: var(--t-aviso); }
    :host([data-tono='peligro']) { color: var(--t-peligro); }
    :host([data-tono='info']) { color: var(--status-available); }
  `],
  template: `{{ texto() ?? (valor() | etiqueta) }}`,
})
export class SenalEstadoComponent {
  readonly valor = input<string>('');
  readonly tono = input<TonoV3 | null>(null);
  readonly texto = input<string | null>(null);
  protected readonly tonoFinal = computed(() => this.tono() ?? tonoDe(this.valor()));
}
