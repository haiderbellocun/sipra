import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AvanceMomento } from '@core/models/modelos';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { guiaDocumento } from './guia-documento';

/**
 * Document Signal del expediente (V3): un nodo por documento exigido, en el orden real de los momentos que trae la
 * práctica (nunca una lista fija de tipos). Cada nodo dice su estado en texto (la guía del estudiante) y es un botón que
 * lleva a su fila. Presentacional: el estado lo decide el servidor. En móvil pasa a lista vertical.
 */
@Component({
  selector: 'sipra-expediente-senal',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --ok-x: var(--status-success); --aviso-x: var(--status-review); --peligro-x: var(--status-critical); --sr: var(--status-review); }
    :host-context([data-theme="light"]) { --ok-x: #06695d; --aviso-x: #7a4a00; --peligro-x: #b8231f; }
    .rail { display: flex; margin: 14px 0 0; padding: 0 0 4px; list-style: none; overflow-x: auto; scrollbar-width: thin; }
    .rail.largo { mask-image: linear-gradient(90deg, #000 90%, transparent); padding-right: 40px; }
    .nodo-doc { position: relative; flex: 1 0 104px; min-width: 104px; padding-top: 18px; }
    .nodo-doc::before { content: ""; position: absolute; left: 0; right: 0; top: 32px; height: 1px; background: var(--border-default); }
    .nodo-doc:first-child::before { left: 50%; } .nodo-doc:last-child::before { right: 50%; }
    .nodo-doc.tono-ok::before { background: var(--ok-x); box-shadow: 0 0 6px color-mix(in srgb, var(--status-success) 50%, transparent); }
    .nodo-doc .mom { position: absolute; left: 0; top: 0; font: 500 11px/14px var(--fuente-mono); color: var(--text-muted); white-space: nowrap; }
    .nodo-doc.inicio-momento { margin-left: 10px; } .nodo-doc.inicio-momento:first-child { margin-left: 0; }
    .nodo-doc.inicio-momento:not(:first-child) .mom { padding-left: 0; }
    .nodo-doc button { position: relative; display: grid; justify-items: center; gap: 2px; width: 100%; padding: 6px 4px 4px; font: inherit; color: inherit; text-align: center; background: none; border: 0; border-radius: 6px; cursor: pointer; transition: background 160ms var(--ease-out); }
    .nodo-doc button:hover { background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    .nodo-doc button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .punto { display: grid; place-items: center; width: 18px; height: 18px; margin-bottom: 4px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--surface-canvas); font: 700 11px/1 var(--fuente); color: var(--text-inverse); }
    .tono-ok .punto { border-color: var(--ok-x); background: var(--ok-x); }
    .tono-aviso .punto { border-color: var(--aviso-x); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sr) 18%, transparent); }
    .tono-peligro .punto { border-color: var(--peligro-x); background: color-mix(in srgb, var(--status-critical) 25%, var(--surface-canvas)); }
    .tono-info .punto { border-color: var(--status-available); }
    .nom { font-size: 12px; font-weight: 600; line-height: 16px; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .est { font-size: 11px; font-weight: 600; line-height: 14px; color: var(--text-secondary); }
    .tono-ok .est { color: var(--ok-x); } .tono-aviso .est { color: var(--aviso-x); } .tono-peligro .est { color: var(--peligro-x); }
    @media (prefers-reduced-motion: reduce) { .nodo-doc button { transition: none; } }
    @media (width < 700px) {
      .rail { display: grid; gap: 0; overflow: visible; }
      .nodo-doc { min-width: 0; padding: 0; }
      .nodo-doc::before { left: 8px !important; right: auto !important; top: 0; bottom: 0; width: 1px; height: auto; }
      .nodo-doc .mom { position: static; display: block; padding: 8px 0 2px 28px; }
      .nodo-doc.inicio-momento { margin-left: 0; }
      .nodo-doc button { grid-template-columns: 18px minmax(0, 1fr) auto; justify-items: start; align-items: center; gap: 10px; text-align: left; padding: 6px 0; }
      .punto { margin: 0; position: relative; z-index: 1; }
      .nom { -webkit-line-clamp: 1; }
    }
  `],
  template: `
    <ol class="rail" [class.largo]="largo()" aria-label="Documentos exigidos en orden">
      @for (m of momentos(); track m.momento) {
        @for (d of m.documentos; track d.tipo; let primero = $first) {
          @let g = guia(d.estado);
          <li [class]="'nodo-doc tono-' + g.tono" [class.inicio-momento]="primero">
            @if (primero) { <span class="mom" [attr.title]="m.etiqueta">Momento {{ m.momento }}</span> }
            <button type="button" (click)="ir.emit(d.tipo)" [attr.aria-label]="(d.tipo | etiqueta) + ': ' + g.estado + (d.version ? ', versión ' + d.version : '') + '. Ir al documento'">
              <span class="punto" aria-hidden="true">@if (g.tono === 'ok') { ✓ }</span>
              <span class="nom">{{ d.tipo | etiqueta }}</span>
              <span class="est">{{ g.estado }}</span>
            </button>
          </li>
        }
      }
    </ol>
  `,
})
export class ExpedienteSenalComponent {
  readonly momentos = input.required<AvanceMomento[]>();
  readonly largo = input(false);
  readonly ir = output<string>();
  /** Solo la etiqueta y el tono del estado (independientes del nombre del documento). */
  protected guia(estado: string | null | undefined) { return guiaDocumento(estado, ''); }
}
