import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FilaCumplimiento } from '@core/models/modelos';
import { SenalEstadoComponent } from '@shared/components/senal-estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { etiquetaCategoria, fecha, textoDias, tonoCategoria } from './cumplimiento.util';

/**
 * Filas de obligaciones (Requiere atención y listado). Presentacional: el orden, la categoría y los días vienen del
 * servidor. La acción abre la práctica (su expediente); no se duplica aquí. Bajo 760 px cada fila se apila.
 */
@Component({
  selector: 'sipra-cumplimiento-tabla',
  standalone: true,
  imports: [RouterLink, SenalEstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --enlace: var(--signal-default); --t-peligro: var(--status-critical); --t-aviso: var(--status-review); }
    :host-context([data-theme='light']) { --enlace: #03587a; --t-peligro: #b8231f; --t-aviso: #7a4a00; }
    :host-context([data-theme='dark']) { --text-muted: #94aeac; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
    caption, .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    th { padding: 8px 12px; text-align: left; font: 600 11px/16px var(--fuente); letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary);
      border-bottom: 1px solid var(--border-default); white-space: nowrap; }
    td { padding: 10px 12px; vertical-align: top; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); color: var(--text-primary); }
    tbody tr { transition: background 160ms var(--ease-out); }
    tbody tr:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    tr.vencida td:first-child { box-shadow: inset 2px 0 0 var(--t-peligro); }
    tr.proxima td:first-child { box-shadow: inset 2px 0 0 var(--t-aviso); }
    .p { font-size: 14px; font-weight: 600; line-height: 20px; }
    .m { margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--text-secondary); }
    .cod { font-family: var(--fuente-mono); color: var(--text-muted); }
    .dias { font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .dias.vencida { color: var(--t-peligro); font-weight: 600; }
    .dias.proxima { color: var(--t-aviso); font-weight: 600; }
    .nw { white-space: nowrap; }
    a.ir { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; font: 600 12px/1 var(--fuente); color: var(--enlace);
      text-decoration: none; border: 1px solid var(--border-default); border-radius: 6px; white-space: nowrap; }
    a.ir:hover { border-color: var(--border-strong); background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    a.ir:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    @media (width < 760px) {
      thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      table, tbody, tr, td { display: block; }
      tr { padding: 10px 0 10px 12px; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); }
      td { padding: 2px 0; border: 0; }
      tr.vencida { box-shadow: inset 2px 0 0 var(--t-peligro); }
      tr.proxima { box-shadow: inset 2px 0 0 var(--t-aviso); }
      tr.vencida td:first-child, tr.proxima td:first-child { box-shadow: none; }
      td.accion { padding-top: 8px; }
    }
    @media (prefers-reduced-motion: reduce) { tbody tr { transition: none; } }
  `],
  template: `
    <table>
      <caption>{{ titulo() }}</caption>
      <thead>
        <tr><th scope="col">Estudiante</th><th scope="col">Obligación</th><th scope="col">Estado</th><th scope="col">Fecha límite</th><th scope="col">Práctica</th><th scope="col"><span class="sr">Acción</span></th></tr>
      </thead>
      <tbody>
        @for (f of filas(); track f.obligacionId) {
          <tr [class]="f.categoria">
            <td>
              <div class="p">{{ f.estudianteNombre }}</div>
              <div class="m"><span class="cod">{{ f.programaId }}</span> · {{ f.escuelaNombre ?? f.escuelaId }}</div>
            </td>
            <td>
              <div>{{ f.tipo | etiqueta }}</div>
              <div class="m">{{ f.norma }}</div>
            </td>
            <td><sipra-senal-estado [tono]="tono(f)" [texto]="etiqueta(f)" /></td>
            <td class="nw">
              <div>{{ fecha(f.fechaLimite) }}</div>
              <div class="dias" [class]="'dias ' + f.categoria">{{ dias(f) }}</div>
            </td>
            <td>
              <div class="cod">{{ f.periodo }}</div>
              <div class="m">{{ f.practicaEstado | etiqueta }}</div>
            </td>
            <td class="accion">
              <a class="ir" [routerLink]="['/practicas', f.practicaId]" [attr.aria-label]="'Ver práctica de ' + f.estudianteNombre + ': ' + (f.tipo | etiqueta)">Ver práctica <span aria-hidden="true">→</span></a>
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class CumplimientoTablaComponent {
  readonly filas = input.required<FilaCumplimiento[]>();
  readonly titulo = input.required<string>();
  protected readonly fecha = fecha;
  protected tono(f: FilaCumplimiento) { return tonoCategoria(f.categoria); }
  protected etiqueta(f: FilaCumplimiento) { return etiquetaCategoria(f.categoria); }
  protected dias(f: FilaCumplimiento) { return textoDias(f.diasRestantes, f.categoria); }
}
