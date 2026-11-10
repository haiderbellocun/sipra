import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Carga (Kit V3): Document Signal de cinco nodos por los que viaja la señal (2,4 s); sin spinner.
 * Con movimiento reducido queda quieto. `role="status"` anuncia el texto.
 */
@Component({
  selector: 'sipra-carga-senal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status' },
  styles: [`
    :host { display: grid; justify-items: center; gap: 14px; padding: 72px 0; color: var(--text-secondary); font-size: 13px; }
    .carril { position: relative; width: 200px; height: 14px; }
    .carril::before { content: ""; position: absolute; left: 7px; right: 7px; top: 6.5px; height: 1px; background: var(--border-default); }
    i { position: absolute; top: 0; width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--surface-canvas); animation: nodo 2.4s var(--ease-out) infinite; }
    i:nth-child(1) { left: 0; } i:nth-child(2) { left: 46.75px; animation-delay: .3s; } i:nth-child(3) { left: 93.5px; animation-delay: .6s; }
    i:nth-child(4) { left: 140.25px; animation-delay: .9s; } i:nth-child(5) { left: 187px; animation-delay: 1.2s; }
    @keyframes nodo { 0%, 100% { border-color: var(--border-strong); background: var(--surface-canvas); } 30% { border-color: var(--signal-active); background: var(--signal-active); box-shadow: 0 0 8px var(--signal-active); } }
    @media (prefers-reduced-motion: reduce) { i { animation: none; } }
  `],
  template: `<div class="carril" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>{{ texto() }}`,
})
export class CargaSenalComponent {
  readonly texto = input('Cargando…');
}
