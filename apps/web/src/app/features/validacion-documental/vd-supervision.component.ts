import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ValidacionDocumentalEstado } from './vd.estado';
import { NOMBRE_MOTOR } from './vd.util';

/** Vista agregada para coordinación y administración. Solo muestra lo que la API ya sumó; cada reserva y cada expediente con reserva vencida abre el expediente. */
@Component({
  selector: 'sipra-vd-supervision',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cifras { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin:var(--sp-2) 0; }
    .cifra { border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2); background:var(--superficie); }
    .cifra .n { display:block; font-size:1.25rem; font-weight:700; font-variant-numeric:tabular-nums; } .cifra .t { font-size:var(--fs-xs); color:var(--texto-tenue); }
    table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); } th, td { text-align:left; padding:var(--sp-1) var(--sp-2); border-bottom:1px solid var(--borde); overflow-wrap:anywhere; }
    .tabla { overflow-x:auto; }
    .enlace { background:none; border:0; padding:0; color:var(--marca); text-decoration:underline; cursor:pointer; font:inherit; text-align:left; }
  `],
  template: `
    <section aria-labelledby="vd-sup-titulo" data-vd-supervision>
      <h2 id="vd-sup-titulo" style="margin:0">Supervisión</h2>
      @if (estado.cargandoSupervision() && !estado.supervision()) { <p class="pista">Cargando…</p> }
      @if (estado.supervision(); as s) {
        <div class="cifras">
          <div class="cifra"><span class="n">{{ s.expedientesAbiertos }}</span><span class="t">Expedientes abiertos</span></div>
          <div class="cifra"><span class="n">{{ s.documentosPorRevisar }}</span><span class="t">Documentos por revisar</span></div>
          <div class="cifra"><span class="n">{{ s.documentosSinCargar }}</span><span class="t">Obligaciones sin cargar</span></div>
          <div class="cifra"><span class="n">{{ s.aprobadosHoy }}</span><span class="t">Aprobados hoy</span></div>
          <div class="cifra"><span class="n">{{ s.devueltos }}</span><span class="t">Devueltos (necesitan corrección)</span></div>
          <div class="cifra"><span class="n">{{ s.rechazados }}</span><span class="t">Rechazados</span></div>
          <div class="cifra"><span class="n">{{ s.informacionInsuficiente }}</span><span class="t">OCR / información insuficiente</span></div>
          <div class="cifra"><span class="n">{{ s.discrepancias }}</span><span class="t">Con señal crítica</span></div>
          <div class="cifra"><span class="n">{{ s.reservasActivas }}</span><span class="t">Reservas activas</span></div>
          <div class="cifra"><span class="n">{{ s.reservasPorVencer }}</span><span class="t">Reservas por vencer</span></div>
          <div class="cifra"><span class="n">{{ s.reservasVencidas }}</span><span class="t">Reservas vencidas</span></div>
        </div>
        <h3 style="margin:var(--sp-3) 0 var(--sp-1)">Carga por funcionario</h3>
        @if (s.funcionarios.length === 0) { <p class="pista">Nadie tiene documentos reservados.</p> }
        @else {
          <div class="tabla"><table>
            <caption class="pista" style="text-align:left">Documentos reservados por persona (la reserva es por documento)</caption>
            <thead><tr><th scope="col">Funcionario</th><th scope="col">Reservas vigentes</th><th scope="col">Por vencer</th><th scope="col">Documentos</th></tr></thead>
            <tbody>
              @for (f of s.funcionarios; track f.funcionarioId) {
                <tr>
                  <th scope="row">{{ f.nombre }}</th><td>{{ f.reservasVigentes }}</td><td>{{ f.reservasPorVencer }}</td>
                  <td>@for (d of f.documentos; track d.practicaId + d.tipoDocumento) {
                    <div><button type="button" class="enlace" (click)="abrir.emit(d.practicaId)">{{ d.estudiante }} · {{ d.nombreHumano }}</button> <span class="pista">({{ motor(d.motor) }}{{ d.vencida ? ' · vencida' : '' }})</span></div>
                  }</td>
                </tr>
              }
            </tbody>
          </table></div>
        }
        @if (s.conReservaVencida.length > 0) {
          <h3 style="margin:var(--sp-3) 0 var(--sp-1)">Expedientes con una reserva vencida</h3>
          <ul>@for (c of s.conReservaVencida; track c.practicaId) { <li><button type="button" class="enlace" (click)="abrir.emit(c.practicaId)">{{ c.estudiante }}</button> · {{ c.documentos }} documento(s)</li> }</ul>
        }
      }
    </section>
  `,
})
export class VdSupervisionComponent {
  protected readonly estado = inject(ValidacionDocumentalEstado);
  readonly abrir = output<string>();
  protected readonly motor = (m: string): string => NOMBRE_MOTOR[m] ?? m;
}
