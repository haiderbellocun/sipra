import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { DecisionMesa } from '@core/models/modelos';
import { EpsAdresComponent } from './eps-adres.component';
import { EpsComparacionComponent } from './eps-comparacion.component';
import { EpsDecisionComponent } from './eps-decision.component';
import { EpsMesaEstado } from './eps-mesa.estado';
import { EpsVisorComponent } from './eps-visor.component';
import {
  AFILIACION, AUTENTICIDAD, ESTADO_RESERVA, FUENTE_AFILIACION, FUENTE_CAMPO, METODO_EXTRACCION, RECOMENDACION, diaCorto, fechaCorta, textoRestante,
} from './eps.util';

/**
 * Detalle de un caso de la Mesa: el certificado, lo que se extrajo, la autenticidad, la
 * afiliación, la comparación triple y la recomendación del sistema, en una sola pantalla.
 * Toda acción pasa por `EpsMesaEstado` (y de ahí por la API, que revalida): aquí solo se muestra.
 */
@Component({
  selector: 'sipra-eps-detalle',
  standalone: true,
  imports: [EpsVisorComponent, EpsComparacionComponent, EpsAdresComponent, EpsDecisionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cab { display:flex; gap:var(--sp-3); align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .cab h2 { margin:0; }
    .atras { display:none; }
    @media (width < 1024px) { .atras { display:inline-flex; } }
    .datos { display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr)); font-size:var(--fs-sm); }
    .k { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    section.panel { margin-top:var(--sp-4); }
    section.panel > h3 { margin:0 0 var(--sp-2); font-size:var(--fs-md, 1rem); }
    .recomendacion { border-left:4px solid var(--marca); background:var(--superficie-2); padding:var(--sp-3); border-radius:0 var(--r-sm) var(--r-sm) 0; }
    .recomendacion .rotulo { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.06em; color:var(--texto-tenue); }
    .aviso { border-left:3px solid var(--aviso); background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:0 var(--r-sm) var(--r-sm) 0; font-size:var(--fs-sm); margin:var(--sp-3) 0; }
    .aviso.peligro { border-left-color:var(--peligro); background:var(--peligro-suave); }
    ul.lista { list-style:none; margin:0; padding:0; }
    ul.lista li { padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); font-size:var(--fs-sm); }
    ul.lista li:last-child { border-bottom:0; }
    table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
    th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--borde); vertical-align:top; overflow-wrap:anywhere; }
    thead th { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    .envoltura { overflow-x:auto; }
    .decisiones { display:flex; gap:var(--sp-2); flex-wrap:wrap; margin-top:var(--sp-4); padding-top:var(--sp-3); border-top:1px solid var(--borde); }
    .retencion { font-size:var(--fs-xs); color:var(--texto-tenue); margin-top:var(--sp-4); }
  `],
  template: `
    @if (estado.cargandoDetalle() && !estado.detalle()) {
      <p class="pista" role="status">Cargando el caso…</p>
    } @else if (estado.errorDetalle(); as e) {
      <div class="aviso peligro" role="alert">{{ e }}</div>
      <button type="button" class="boton" (click)="estado.refrescarDetalle()">Reintentar</button>
    } @else if (estado.detalle(); as d) {
      <div class="cab">
        <div>
          <button type="button" class="boton compacto atras" (click)="estado.volverALista()">← Volver a la lista</button>
          <h2>{{ d.caso.estudiante.nombre }}</h2>
          <p class="pista">
            {{ d.caso.estudiante.documento ?? d.caso.estudiante.documentoEnmascarado }} · {{ d.caso.programa }} · {{ d.caso.modalidad }} · {{ d.caso.periodo }}
            · versión {{ d.caso.version }} de {{ d.caso.totalVersiones }}
          </p>
        </div>
        <div>
          <span class="etiqueta etiqueta--icono etiqueta--{{ reserva(d).tono }}"><span aria-hidden="true">{{ reserva(d).icono }}</span> {{ reserva(d).texto }}</span>
          @if (d.acceso.esMia && d.acceso.reserva.hasta) {
            <span class="pista" aria-live="off"> · {{ restante(d) }}</span>
          }
        </div>
      </div>

      @if (!d.caso.esVersionVigente) {
        <div class="aviso" role="status"><strong>No es la versión vigente.</strong> El estudiante volvió a enviar el certificado. Trabaje sobre la versión más reciente; esta se muestra solo como historia.</div>
      }
      @if (estado.reservaVencidaEnPantalla()) {
        <div class="aviso peligro" role="alert"><strong>Su reserva venció.</strong> Tome el caso de nuevo para seguir trabajando; mientras tanto no puede decidir.</div>
      }
      @if (d.acceso.motivoSinAcceso) { <div class="aviso" role="status">{{ d.acceso.motivoSinAcceso }}</div> }

      <div class="acciones" style="margin-top:var(--sp-3)">
        @if (d.acceso.reserva.estado === 'libre' || d.acceso.reserva.estado === 'vencida') {
          <button type="button" class="boton boton--primario" [disabled]="estado.ocupado() || !d.caso.esVersionVigente" (click)="estado.tomar()">Tomar el caso</button>
        }
        @if (d.acceso.esMia) {
          <button type="button" class="boton" [disabled]="estado.ocupado()" (click)="estado.liberar()">Liberar el caso</button>
        }
        @if (!d.acceso.esMia && d.acceso.reserva.estado === 'ajena' && estado.esSupervisor()) {
          <button type="button" class="boton" [disabled]="estado.ocupado()" (click)="estado.liberar()">Liberar la reserva de otra persona</button>
        }
        <button type="button" class="boton" [disabled]="estado.cargandoDetalle()" (click)="estado.refrescarDetalle()">Actualizar</button>
      </div>

      <section class="panel tarjeta" aria-labelledby="p-cert">
        <h3 id="p-cert">Certificado</h3>
        <sipra-eps-visor [validacionId]="d.caso.validacionId" [meta]="d.certificado" [habilitado]="d.acceso.puedeVerValores" (actividad)="estado.renovarSiHaceFalta()" />
      </section>

      <section class="panel recomendacion" aria-labelledby="p-rec">
        <div class="rotulo" id="p-rec">Recomendación del sistema</div>
        <p style="margin:var(--sp-1) 0">
          <span class="etiqueta etiqueta--icono etiqueta--{{ recomendacion(d).tono }}"><span aria-hidden="true">{{ recomendacion(d).icono }}</span> {{ d.recomendacion.titulo }}</span>
        </p>
        <p style="margin:0">{{ d.recomendacion.explicacion }}</p>
        <p class="pista" style="margin:var(--sp-1) 0 0">Es una ayuda para quien revisa: no es una decisión. La decisión final es de una persona.</p>
      </section>

      <section class="panel tarjeta" aria-labelledby="p-disc">
        <h3 id="p-disc">Discrepancias</h3>
        @if (d.discrepancias.length === 0) { <p class="pista">No se encontraron discrepancias.</p> }
        @else {
          <ul class="lista">
            @for (x of d.discrepancias; track $index) {
              <li>
                <span class="etiqueta etiqueta--icono etiqueta--{{ x.severidad === 'critica' ? 'peligro' : 'info' }}"><span aria-hidden="true">{{ x.severidad === 'critica' ? '!' : 'i' }}</span> {{ x.severidad === 'critica' ? 'Crítica' : 'Informativa' }}</span>
                <strong> {{ x.titulo }}</strong><br />{{ x.explicacion }}
              </li>
            }
          </ul>
        }
      </section>

      <section class="panel tarjeta" aria-labelledby="p-aut">
        <h3 id="p-aut">Autenticidad y afiliación</h3>
        <div class="datos">
          <div><div class="k">Autenticidad</div><span class="etiqueta etiqueta--icono etiqueta--{{ autenticidad(d).tono }}"><span aria-hidden="true">{{ autenticidad(d).icono }}</span> {{ autenticidad(d).texto }}</span></div>
          <div><div class="k">Verificador</div>{{ d.autenticidad.verificador ?? 'Ninguno habilitado' }}</div>
          <div><div class="k">Verificada el</div>{{ fecha(d.autenticidad.verificadoEn) }}</div>
          <div><div class="k">Afiliación</div><span class="etiqueta etiqueta--icono etiqueta--{{ afiliacion(d).tono }}"><span aria-hidden="true">{{ afiliacion(d).icono }}</span> {{ afiliacion(d).texto }}</span></div>
          <div><div class="k">Fuente</div>{{ fuenteAfiliacion(d.afiliacion.fuente) }}</div>
          <div><div class="k">Consultada el</div>{{ fecha(d.afiliacion.consultadoEn) }}</div>
          <div><div class="k">Fuente actualizada el</div>{{ fecha(d.afiliacion.fuenteActualizadaEn) }}</div>
        </div>
        <p class="pista" style="margin-top:var(--sp-2)">{{ d.autenticidad.explicacion }}</p>
        @if (d.afiliacion.frescura.diasDesdeConsulta !== null) {
          <p class="pista">Consulta a ADRES realizada {{ d.afiliacion.frescura.diasDesdeConsulta === 0 ? 'hoy' : 'hace ' + d.afiliacion.frescura.diasDesdeConsulta + (d.afiliacion.frescura.diasDesdeConsulta === 1 ? ' día' : ' días') }}.</p>
        }
        @if (!d.afiliacion.frescura.politicaDefinida) {
          <p class="pista">Frescura de ADRES pendiente de definición del proceso: SIPRA no da por vencido ningún resultado.</p>
        } @else if (d.afiliacion.frescura.vencida) {
          <div class="aviso" role="status">La consulta a ADRES tiene más de {{ d.afiliacion.frescura.dias }} días. Considere repetirla.</div>
        }
      </section>

      <section class="panel tarjeta" aria-labelledby="p-dat">
        <h3 id="p-dat">Datos extraídos del certificado</h3>
        <p class="pista">Método: {{ metodo(d.certificado.metodoExtraccion) }} · vigencia {{ d.certificado.vigencia === 'vigente' ? 'vigente' : d.certificado.vigencia === 'vencido' ? 'vencida' : 'no determinada' }}</p>
        @if (!d.acceso.puedeVerValores) {
          <p class="pista">Los datos personales se muestran cuando usted tiene el caso tomado.</p>
        } @else {
          <div class="envoltura">
            <table>
              <thead><tr><th scope="col">Campo</th><th scope="col">Valor</th><th scope="col">Fuente</th></tr></thead>
              <tbody>
                @for (c of d.certificado.campos; track c.campo) {
                  <tr><th scope="row">{{ c.etiqueta }}</th><td>{{ c.valor ?? '—' }}</td><td>{{ c.fuente ? fuenteCampo(c.fuente) : '—' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="panel tarjeta" aria-labelledby="p-cmp">
        <h3 id="p-cmp">Comparación SIPRA · certificado · ADRES</h3>
        @if (d.comparacion.length === 0) { <p class="pista">Todavía no hay datos para comparar.</p> }
        @else { <sipra-eps-comparacion [filas]="d.comparacion" [valores]="d.acceso.puedeVerValores" /> }
      </section>

      <section class="panel tarjeta" aria-labelledby="p-adres">
        <h3 id="p-adres">Consulta ADRES</h3>
        <sipra-eps-adres
          [validacionId]="d.caso.validacionId" [estado]="d.adres.estado" [errorPrevio]="d.adres.error"
          [puedeConsultar]="d.acceso.puedeConsultarAdres && estado.puedeActuar()"
          (cambio)="estado.refrescarDetalle()" />
      </section>

      <section class="panel tarjeta" aria-labelledby="p-evi">
        <h3 id="p-evi">Evidencia</h3>
        @if (d.evidencias.length === 0) { <p class="pista">Sin evidencias registradas.</p> }
        @else {
          <div class="envoltura">
            <table>
              <thead><tr><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Fuente</th><th scope="col">Resultado</th></tr></thead>
              <tbody>
                @for (v of d.evidencias; track v.id) {
                  <tr><td>{{ fecha(v.fecha) }}</td><td>{{ v.tipo }}</td><td>{{ v.fuente }}</td><td>{{ v.resultado }}@if (v.error) { · {{ v.error }} }</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="panel tarjeta" aria-labelledby="p-ver">
        <h3 id="p-ver">Versiones del certificado</h3>
        <ul class="lista">
          @for (v of d.versiones; track v.documentoId) {
            <li>Versión {{ v.version }} · {{ fecha(v.cargadoEn) }} · {{ v.estado }}
              @if (v.esVigente) { <span class="etiqueta etiqueta--ok">Vigente</span> }
              @if (v.esEsta) { <span class="etiqueta etiqueta--neutra">Esta pantalla</span> }
            </li>
          }
        </ul>
      </section>

      <section class="panel tarjeta" aria-labelledby="p-his">
        <h3 id="p-his">Historial</h3>
        @if (d.historial.length === 0) { <p class="pista">Sin movimientos todavía.</p> }
        @else {
          <ul class="lista">
            @for (h of d.historial; track $index) {
              <li><strong>{{ h.titulo }}</strong> · {{ fecha(h.fecha) }}@if (h.actor) { · {{ h.actor }} }@if (h.detalle) { <br /><span class="pista">{{ h.detalle }}</span> }</li>
            }
          </ul>
        }
      </section>

      <section class="panel tarjeta" aria-labelledby="p-met">
        <h3 id="p-met">Tiempos</h3>
        <div class="datos">
          <div><div class="k">Recibido</div>{{ fecha(d.metricas.recibidaEn) }}</div>
          <div><div class="k">Primera revisión</div>{{ fecha(d.metricas.primeraRevisionEn) }}</div>
          <div><div class="k">Decidido</div>{{ fecha(d.metricas.decididoEn) }}</div>
          <div><div class="k">Horas hasta la decisión</div>{{ d.metricas.horasHastaDecision ?? '—' }}</div>
          <div><div class="k">Reenvíos</div>{{ d.metricas.reenvios }}</div>
          <div><div class="k">Prioridad</div>{{ d.prioridad.puntaje }} pts@if (d.prioridad.razones.length) { <span class="pista"> · {{ d.prioridad.razones.join(' · ') }}</span> }</div>
        </div>
      </section>

      <div class="decisiones" role="group" aria-label="Decisión sobre el certificado">
        <button type="button" class="boton boton--primario" [disabled]="!puedeDecidir()" (click)="decision.abrir('aprobar')">Aprobar</button>
        <button type="button" class="boton" [disabled]="!puedeDecidir()" (click)="decision.abrir('devolver')">Devolver al estudiante</button>
        <button type="button" class="boton boton--peligro" [disabled]="!puedeDecidir()" (click)="decision.abrir('rechazar')">Rechazar</button>
        @if (!puedeDecidir()) { <span class="pista">Para decidir debe tener el caso tomado, con la reserva vigente y la versión vigente del certificado.</span> }
      </div>

      <p class="retencion">{{ d.retencion }}</p>

      <sipra-eps-decision #decision [detalle]="d" [ocupado]="estado.ocupado()" (confirmada)="decidir($event)" />
    }
  `,
})
export class EpsDetalleComponent {
  protected readonly estado = inject(EpsMesaEstado);
  private readonly decisionDialogo = viewChild<EpsDecisionComponent>('decision');

  readonly puedeDecidir = computed(() => {
    const d = this.estado.detalle();
    return !!d && d.acceso.puedeDecidir && d.caso.esVersionVigente && this.estado.puedeActuar() && !this.estado.ocupado();
  });

  async decidir(dto: DecisionMesa): Promise<void> {
    const ok = await this.estado.decidir(dto);
    if (!ok) this.decisionDialogo()?.cerrar();
  }

  reserva(d: NonNullable<ReturnType<EpsMesaEstado['detalle']>>) {
    const estado = this.estado.reservaVencidaEnPantalla() ? 'vencida' : d.acceso.reserva.estado;
    return ESTADO_RESERVA[estado];
  }
  restante(d: NonNullable<ReturnType<EpsMesaEstado['detalle']>>): string {
    const t = textoRestante(d.acceso.reserva.hasta, this.estado.ahora());
    return t === 'venció' ? 'venció' : `le quedan ${t}`;
  }
  autenticidad(d: NonNullable<ReturnType<EpsMesaEstado['detalle']>>) { return AUTENTICIDAD[d.autenticidad.estado] ?? AUTENTICIDAD['no_evaluada']; }
  afiliacion(d: NonNullable<ReturnType<EpsMesaEstado['detalle']>>) { return AFILIACION[d.afiliacion.estado] ?? AFILIACION['no_contrastada']; }
  recomendacion(d: NonNullable<ReturnType<EpsMesaEstado['detalle']>>) { return RECOMENDACION[d.recomendacion.codigo] ?? RECOMENDACION['informacion_insuficiente']; }
  fuenteAfiliacion(f: string): string { return FUENTE_AFILIACION[f] ?? f; }
  fuenteCampo(f: string): string { return FUENTE_CAMPO[f] ?? f; }
  metodo(m: string): string { return METODO_EXTRACCION[m] ?? m; }
  fecha(iso: string | null): string { return fechaCorta(iso); }
  dia(iso: string | null): string { return diaCorto(iso); }
}
