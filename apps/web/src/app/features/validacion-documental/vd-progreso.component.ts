import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProgresoExpediente } from '@core/models/validacion-documental.model';
import { contadoresExpediente, etiquetaProgreso } from './vd.util';
import { resumenProgreso, textoAprobados } from './vd.senal';

/**
 * Progreso integrado junto al Document Signal (Figma V3 · F1): cifra mono «3 /6» y, a su lado, la leyenda real del expediente
 * (aprobados, en revisión, pendientes, corrección). Sin barra SaaS: el Document Signal ya es la lectura visual; la barra de progreso
 * queda solo para lectores de pantalla (`role="progressbar"`), igual que la frase «X / Y aprobados».
 */
@Component({
  selector: 'sipra-vd-progreso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; min-width:0; }
    .sr { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    /* Figma F1: «3» Geist Mono 46/500 −4 %, «/6» Mono 20 tenue y, a 26 px, la leyenda de 13 px (aprobados · en revisión · pendientes). */
    .caja { display:grid; grid-template-columns:auto auto; column-gap:26px; align-items:start; }
    .cifra { display:flex; align-items:baseline; gap:8px; font-family:var(--fuente-mono); font-weight:500; white-space:nowrap; }
    .cifra .n { font-weight:500; font-size:46px; line-height:60px; letter-spacing:-.04em; color:var(--text-primary); font-variant-numeric:tabular-nums; }
    .cifra .tot { font-size:20px; line-height:26px; color:var(--text-muted); }
    .leyenda { display:grid; gap:3px; padding-top:6px; font-size:var(--fs-xs); line-height:17px; color:var(--text-muted); white-space:nowrap; }
    .ap { font-weight:500; color:var(--status-success); }
    .contadores { display:grid; gap:3px; }
    .contadores span[data-clave='revision'] { color:var(--status-review); }
    .contadores span[data-clave='correccion'] { color:var(--status-returned); }
    .contadores strong { font-family:var(--fuente-mono); font-weight:500; margin-left:2px; }
    .estado-p { margin:0; font-family:var(--fuente-mono); font-size:11px; color:var(--text-muted); }
    /* Claro: la leyenda cae sobre el bloom cian de Figma; tonos un paso más profundos para ≥ 4.5:1 medido. */
    :host-context([data-theme="light"]) .ap { color:#06695d; }
    :host-context([data-theme="light"]) .contadores span[data-clave='revision'] { color:#7a4a00; }
    :host-context([data-theme="light"]) .contadores span[data-clave='correccion'] { color:#983016; }
    :host-context([data-theme="light"]) .leyenda, :host-context([data-theme="light"]) .estado-p { color:var(--text-secondary); }
    @media (width < 900px) { .cifra .n { font-size:34px; line-height:44px; } .contadores { grid-auto-flow:column; gap:2px 12px; } }
  `],
  template: `
    @let p = progreso();
    <div class="caja" [attr.aria-label]="resumen()" role="group">
      <p class="sr" data-vd-progreso aria-live="polite" aria-atomic="true">{{ p.aprobados }} / {{ p.total }} aprobados</p>
      <span class="cifra" aria-hidden="true"><span class="n">{{ p.aprobados }}</span><span class="tot">/{{ p.total }}</span></span>
      <div class="leyenda">
        <span class="ap" aria-hidden="true">aprobados</span>
        <div class="contadores" data-vd-contadores>@for (c of contadores(); track c.clave) { <span [attr.data-clave]="c.clave">{{ c.texto }}: <strong>{{ c.n }}</strong></span> }</div>
        <p class="estado-p" data-vd-etiqueta-progreso>{{ etiqueta() }}</p>
      </div>
      <span class="sr" role="progressbar" [attr.aria-valuenow]="p.aprobados" aria-valuemin="0" [attr.aria-valuemax]="p.total" [attr.aria-label]="texto()"></span>
    </div>
  `,
})
export class VdProgresoComponent {
  readonly progreso = input.required<ProgresoExpediente>();
  protected readonly texto = computed(() => textoAprobados(this.progreso()));
  protected readonly etiqueta = computed(() => etiquetaProgreso(this.progreso()));
  protected readonly contadores = computed(() => contadoresExpediente(this.progreso()));
  protected readonly resumen = computed(() => [this.texto(), ...resumenProgreso(this.progreso())].join(', '));
}
