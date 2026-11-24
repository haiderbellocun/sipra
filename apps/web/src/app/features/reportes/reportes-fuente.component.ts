import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChildren } from '@angular/core';
import { FUENTES_REPORTE, FuenteReporte } from './reportes-fuentes.util';
import { ReportesEstado } from './reportes.estado';

/** Destino del foco con el teclado en un grupo de opciones (flechas en ciclo, Inicio y Fin). */
export function destinoTecla(tecla: string, actual: number, total: number): number | null {
  const d = ({ ArrowRight: actual + 1, ArrowDown: actual + 1, ArrowLeft: actual - 1, ArrowUp: actual - 1, Home: 0, End: total - 1 } as Record<string, number>)[tecla];
  return d === undefined ? null : (d + total) % total;
}

/**
 * Selector de fuente: Actual / Histórico / Todos. Grupo de radio ARIA (una sola parada de tabulación, flechas para moverse,
 * selección con el foco). El estado elegido no depende del color: lleva marca de verificación, peso y `aria-checked`.
 */
@Component({
  selector: 'sipra-reportes-fuente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .rotulo { font: 600 11px/16px var(--fuente); letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary); }
    .grupo { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--border-default); border-radius: 8px; }
    .op { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; font: 500 13px/1 var(--fuente); color: var(--text-secondary);
      background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; transition: color 160ms var(--ease-out), background 160ms var(--ease-out); }
    .op:hover { color: var(--text-primary); }
    .op[aria-checked='true'] { color: var(--text-primary); font-weight: 650; background: color-mix(in srgb, var(--signal-active) 14%, transparent);
      border-color: color-mix(in srgb, var(--signal-active) 55%, transparent); }
    .op svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .op:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .op { transition: none; } }
    @media (width < 700px) { .rotulo { display: none; } .op { padding: 0 10px; } }
  `],
  template: `
    <span class="rotulo" id="rp-fuente">Fuente</span>
    <div class="grupo" role="radiogroup" aria-labelledby="rp-fuente">
      @for (f of fuentes; track f.id) {
        <button #op type="button" role="radio" class="op" [attr.aria-checked]="estado.fuente() === f.id" [attr.tabindex]="estado.fuente() === f.id ? 0 : -1"
                [title]="f.ayuda" [attr.aria-describedby]="'rp-fuente-' + f.id" (click)="elegir(f.id)" (keydown)="teclado($event, $index)">
          @if (estado.fuente() === f.id) { <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.2 2.2L9.5 3.8"/></svg> }
          {{ f.texto }}
        </button>
      }
    </div>
    @for (f of fuentes; track f.id) { <span [id]="'rp-fuente-' + f.id" hidden>{{ f.ayuda }}</span> }
  `,
})
export class ReportesFuenteComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly fuentes = FUENTES_REPORTE;
  private readonly botones = viewChildren<ElementRef<HTMLButtonElement>>('op');

  protected elegir(f: FuenteReporte): void { this.estado.cambiarFuente(f); }

  protected teclado(evento: KeyboardEvent, i: number): void {
    const d = destinoTecla(evento.key, i, this.fuentes.length);
    if (d === null) return;
    evento.preventDefault();
    this.elegir(this.fuentes[d].id);
    this.botones()[d]?.nativeElement.focus();
  }
}
