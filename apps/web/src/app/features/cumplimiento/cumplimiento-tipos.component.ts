import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TableroCumplimiento } from '@core/models/modelos';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { CATEGORIAS, descripcionBarra, segmentos } from './cumplimiento.util';

/**
 * Cumplimiento por tipo de obligación: barras horizontales apiladas (vencida → próxima → en plazo → cumplida) con la
 * fracción en texto. La primera fila es la distribución por estado de todo el filtro. Cada barra se lee completa por
 * lector de pantalla; los segmentos llevan además textura (vencida) y la leyenda nombra cada tono: nunca color solo.
 */
@Component({
  selector: 'sipra-cumplimiento-tipos',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --s-vencida: var(--status-critical); --s-proxima: var(--status-review); --s-en_plazo: var(--status-available); --s-cumplida: var(--status-success); }
    :host-context([data-theme='dark']) { --text-muted: #94aeac; }
    .ley { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 12px; padding: 0; list-style: none; font-size: 12px; color: var(--text-secondary); }
    .ley li { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 12px; height: 8px; border-radius: 2px; background: var(--c); }
    .fila { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto; gap: 4px 16px; align-items: center; padding: 10px 0; border-top: 1px solid var(--vd-regla, var(--border-subtle)); }
    .fila.total { border-top: 0; padding-top: 0; }
    .fila.total .r { font-weight: 600; }
    .r { font-size: 13px; line-height: 18px; color: var(--text-primary); min-width: 0; }
    .r small { display: block; font-size: 11px; line-height: 16px; color: var(--text-muted); }
    .barra { display: flex; height: 10px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
    .barra i { display: block; height: 100%; background: var(--c); min-width: 3px; }
    .barra i + i { box-shadow: inset 1px 0 0 var(--surface-canvas, #000); }
    .sw.vencida, .barra i.vencida { background-image: repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, #000 22%, transparent) 3px 5px); }
    .vencida { --c: var(--s-vencida); } .proxima { --c: var(--s-proxima); } .en_plazo { --c: var(--s-en_plazo); } .cumplida { --c: var(--s-cumplida); }
    .f { font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); white-space: nowrap; text-align: right; }
    .det { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 2px 12px; font: 500 11px/16px var(--fuente-mono); color: var(--text-muted); }
    @media (width < 700px) {
      .fila { grid-template-columns: minmax(0, 1fr) auto; }
      .barra, .det { grid-column: 1 / -1; }
      .f { grid-row: 1; grid-column: 2; }
    }
  `],
  template: `
    <ul class="ley" aria-label="Leyenda">
      @for (c of categorias; track c.valor) { <li><i class="sw" [class]="'sw ' + c.valor" aria-hidden="true"></i>{{ c.etiqueta }}</li> }
    </ul>
    @for (b of barras(); track b.clave) {
      <div class="fila" [class.total]="b.total">
        <div class="r">{{ b.total ? 'Todas las obligaciones' : (b.clave | etiqueta) }}@if (b.norma) { <small>{{ b.norma }}</small> }</div>
        <div class="barra" role="img" [attr.aria-label]="b.descripcion">
          @for (s of b.segmentos; track s.categoria) { <i [class]="s.categoria" [style.width.%]="s.ancho" [attr.title]="s.etiqueta + ': ' + s.n"></i> }
        </div>
        <span class="f" aria-hidden="true">{{ b.fraccion }}</span>
        <div class="det" aria-hidden="true">
          @for (s of b.segmentos; track s.categoria) { <span>{{ s.etiqueta }} {{ s.n }}</span> }
        </div>
      </div>
    }
  `,
})
export class CumplimientoTiposComponent {
  readonly tablero = input.required<TableroCumplimiento>();
  protected readonly categorias = CATEGORIAS;
  protected readonly barras = computed(() => {
    const t = this.tablero();
    const filas = [{ clave: '__total', total: true, norma: '', c: t.indicadores }, ...t.porTipo.map((p) => ({ clave: p.tipo, total: false, norma: p.norma, c: p }))];
    return filas.map((x) => ({
      clave: x.clave, total: x.total, norma: x.norma, segmentos: segmentos(x.c),
      fraccion: `${x.c.cumplidas}/${x.c.aplicables} cumplidas`,
      descripcion: descripcionBarra(x.total ? 'Todas las obligaciones' : this.etiqueta.transform(x.clave), x.c),
    }));
  });
  private readonly etiqueta = new EtiquetaPipe();
}
