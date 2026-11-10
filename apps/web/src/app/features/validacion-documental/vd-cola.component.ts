import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ItemExpediente } from '@core/models/validacion-documental.model';
import { VdCargandoComponent, VdEstadoComponent } from './vd-estados.component';
import { antiguedadCorta, estadoFila, puntosCola, reservasFila } from './vd.senal';
import { textoChip, textoProgreso } from './vd.util';

/**
 * Operations Feed: la cola de expedientes como un feed de filas separadas por hairlines (sin una caja por expediente). Presentacional:
 * recibe los expedientes que la API ya ordenó y emite el elegido. La micro-señal (un punto por documento obligatorio sobre una línea
 * de 1 px) resume el paquete; el detalle por documento queda para lectores de pantalla.
 */
@Component({
  selector: 'sipra-vd-cola',
  standalone: true,
  imports: [VdEstadoComponent, VdCargandoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; min-width:0; }
    ul { list-style:none; margin:0; padding:0; }
    li { position:relative; }
    li::after { content:""; position:absolute; left:16px; right:16px; bottom:0; height:1px; background:var(--vd-separador); }
    li:has(.exp[aria-current='true'])::after { display:none; }
    .exp { position:relative; display:block; width:100%; min-height:88px; margin:0; padding:10px 24px 6px 20px; text-align:left; background:transparent; border:0; border-radius:0; cursor:pointer; color:inherit; font:inherit; line-height:16px;
      transition:transform 160ms var(--ease-out), background-color 160ms var(--ease-out); }
    .exp:hover { transform:translateX(2px); background:color-mix(in srgb, var(--signal-default) 4%, transparent); }
    .exp:focus-visible { outline:2px solid var(--foco); outline-offset:-2px; }
    /* Fila activa (Figma F1): profundidad tonal, luz de borde superior con glow y línea de señal inferior; sangría de 4 px. */
    .exp[aria-current='true'] { width:calc(100% - 4px); margin-left:4px; background:linear-gradient(90deg, var(--vd-fila), transparent); }
    .exp[aria-current='true']::before, .exp[aria-current='true']::after { content:""; position:absolute; left:0; right:0; height:1px; pointer-events:none; }
    .exp[aria-current='true']::before { top:0; background:linear-gradient(90deg, var(--signal-default), transparent); box-shadow:0 0 6px color-mix(in srgb, var(--signal-default) 40%, transparent); }
    .exp[aria-current='true']::after { bottom:0; background:linear-gradient(90deg, color-mix(in srgb, var(--signal-default) 50%, transparent), transparent); }
    .l1 { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
    .n { font-size:15px; line-height:20px; font-weight:500; color:var(--text-primary); overflow-wrap:anywhere; }
    .exp[aria-current='true'] .n { font-weight:600; }
    .t { flex:none; font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; color:var(--text-muted); white-space:nowrap; }
    .l2 { display:block; font-size:var(--fs-meta); color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .senal { display:flex; align-items:center; gap:15px; height:16px; margin-top:4px; }
    .puntos { position:relative; display:flex; align-items:center; flex:none; gap:min(23px, calc((157px - var(--np) * 7px) / max(1, var(--np) - 1))); }
    .puntos::before { content:""; position:absolute; left:3px; right:3px; top:50%; height:1px; background:var(--vd-micro); }
    .p { position:relative; width:7px; height:7px; border-radius:50%; flex:none; background:var(--c); }
    .p[data-clave='pendiente'] { background:var(--vd-nodo-vacio); box-shadow:inset 0 0 0 1.2px color-mix(in srgb, var(--text-muted) 90%, transparent); }
    .p[data-clave='revision'], .p[data-clave='critico'], .p[data-clave='rechazado'] { box-shadow:0 0 6px color-mix(in srgb, var(--c) 60%, transparent); }
    .prog { flex:none; font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; color:var(--text-primary); white-space:nowrap; }
    .prog small { font-family:var(--fuente); font-size:var(--fs-meta); color:var(--text-secondary); margin-left:2px; }
    .l4 { display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:var(--fs-meta); }
    .est { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tono-peligro { color:var(--text-danger); } .tono-aviso { color:var(--status-review); } .tono-ok { color:var(--status-success); } .tono-info { color:var(--status-available); } .tono-neutra { color:var(--text-muted); }
    :host-context([data-theme="dark"]) .exp[aria-current='true'] .tono-peligro { color:#ffaba3; }
    .reserva { display:inline-flex; align-items:center; gap:4px; flex:none; font-family:var(--fuente-mono); font-weight:500; color:var(--text-secondary); white-space:nowrap; }
    .reserva svg { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
    .desc { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    .msg { margin:0; padding:16px 20px; font-size:var(--fs-sm); color:var(--text-secondary); }
    .error { margin:12px 16px; padding:10px 12px; border-radius:var(--radius-6); background:var(--status-critical-subtle); color:var(--text-primary); font-size:var(--fs-sm); }
    .error button { margin-left:8px; }
    @media (prefers-reduced-motion: reduce) { .exp { transition:none; } .exp:hover { transform:none; } }
  `],
  template: `
    @if (error(); as e) { <div class="error" role="alert">{{ e }} <button type="button" class="boton compacto" (click)="reintentar.emit()">Reintentar</button></div> }
    @if (cargando() && !hayListado()) { <sipra-vd-cargando role="status"><p>Cargando expedientes…</p></sipra-vd-cargando> }
    @else if (items().length === 0) { <sipra-vd-estado tipo="sin-pendientes" [compacto]="true"><h3>Sin pendientes</h3><p>No hay expedientes con estos filtros.</p></sipra-vd-estado> }
    @else {
      <ul aria-label="Expedientes en la cola">
        @for (x of items(); track x.practicaId) {
          <li>
            <button type="button" class="exp" data-vd-expediente [attr.data-practica]="x.practicaId" [attr.aria-current]="activo() === x.practicaId" (click)="abrir.emit(x)">
              <span class="l1"><span class="n">{{ x.estudiante.nombre }}</span><span class="t" [attr.title]="x.esperandoDesde ? 'Esperando revisión' : 'Sin documentos por revisar'">{{ antiguedad(x) }}</span></span>
              <span class="l2">{{ x.modalidadEtiqueta }}@if (x.empresa) { · {{ x.empresa }} }</span>
              <span class="senal" aria-hidden="true">
                <span class="puntos" [style.--np]="puntos(x).length">@for (p of puntos(x); track p.tipo) { <span class="p" [attr.data-clave]="p.senal.clave" [style.--c]="'var(' + p.senal.token + ')'"></span> }</span>
                <span class="prog">{{ progreso(x) }}</span>
              </span>
              @let est = estado(x);
              <span class="l4">
                <span class="est tono-{{ est.tono }}">{{ est.texto }}</span>
                @if (reservas(x); as r) { <span class="reserva"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8.5a4.5 4.5 0 019 0V11M6 11h12v8.5H6z" /></svg>{{ r }}</span> }
              </span>
              <span class="desc">{{ x.estudiante.documentoEnmascarado }} · {{ x.escuelaId }}. @for (d of x.documentos; track d.tipoDocumento) { {{ chip(d) }}; }@if (x.esperandoDesde) { Esperando revisión hace {{ x.diasEsperando }} día(s). } @else { Sin documentos por revisar. }
                {{ x.indicadores.criticos }} crítico(s), {{ x.indicadores.informacionInsuficiente }} con OCR o información insuficiente, {{ x.indicadores.reenvios }} reenvío(s).</span>
            </button>
          </li>
        }
      </ul>
      @if (truncado()) { <p class="msg">Hay más expedientes: use la búsqueda o los filtros para acotar.</p> }
    }
  `,
})
export class VdColaComponent {
  readonly items = input.required<readonly ItemExpediente[]>();
  readonly activo = input<string | null>(null);
  readonly cargando = input(false);
  readonly hayListado = input(false);
  readonly error = input<string | null>(null);
  readonly truncado = input(false);
  readonly abrir = output<ItemExpediente>();
  readonly reintentar = output<void>();

  protected readonly puntos = (x: ItemExpediente) => puntosCola(x.documentos);
  protected readonly estado = (x: ItemExpediente) => estadoFila(x);
  protected readonly antiguedad = antiguedadCorta;
  protected readonly progreso = (x: ItemExpediente): string => textoProgreso(x.progreso);
  protected readonly reservas = (x: ItemExpediente): string | null => reservasFila(x.funcionariosTrabajando);
  protected readonly chip = textoChip;
}
