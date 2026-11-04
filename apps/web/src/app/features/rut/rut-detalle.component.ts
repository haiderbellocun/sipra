import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { CampoComparadoRut, DecisionRut, DetalleRut } from '@core/models/modelos';
import { fechaCorta, textoRestante } from '../eps/eps.util';
import { RutDecisionComponent } from './rut-decision.component';
import { RutMesaEstado } from './rut-mesa.estado';
import { RutVisorComponent } from './rut-visor.component';
import {
  AVISO_DATOS_SIPRA, TEXTO_AUTENTICIDAD, TIPOS_EVIDENCIA, descripcionCampo, estadoVersion, resultadoCampo, resultadoEvento, resultadoRut,
  separarCampos, textoMetodo, textoPersona, textoReserva, textoTipoDetectado, textoTipoEsperado, textosQr,
} from './rut.util';

type Pestana = 'versiones' | 'evidencia' | 'historial';

/**
 * Detalle de un caso de la Mesa de RUT como estación de trabajo: el documento a la izquierda (fijo mientras se revisa) y, a su
 * lado, lo que hace falta para decidir en orden de importancia: resumen, método de lectura, comparación SIPRA ↔ RUT (críticos
 * y, aparte, informativos) y, debajo, versiones, evidencia e historial. Las acciones van en una barra inferior. La composición
 * responde al ANCHO DEL PROPIO DETALLE (container query). Toda acción pasa por `RutMesaEstado` (y de ahí por la API, que revalida).
 */
@Component({
  selector: 'sipra-rut-detalle',
  standalone: true,
  imports: [NgTemplateOutlet, RutVisorComponent, RutDecisionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; container-type:inline-size; container-name:det; --sticky-top:calc(var(--alto-cinta, 0px) + 62px + 12px); }
    .cab { display:flex; gap:var(--sp-2) var(--sp-4); align-items:flex-start; justify-content:space-between; flex-wrap:wrap; margin-bottom:var(--sp-3); }
    .cab h2 { margin:0 0 2px; font-size:var(--fs-xl); overflow-wrap:anywhere; }
    .cab .meta { margin:0; font-size:var(--fs-sm); color:var(--texto-tenue); overflow-wrap:anywhere; }
    .cab .estados { display:flex; gap:var(--sp-1) var(--sp-2); flex-wrap:wrap; align-items:center; margin-top:var(--sp-2); }
    .cab .acciones { justify-content:flex-end; }
    .atras { display:none; margin-bottom:var(--sp-2); }
    @media (width < 1200px) { .atras { display:inline-flex; } }
    .aviso { border-left:3px solid var(--aviso); background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:0 var(--r-sm) var(--r-sm) 0; font-size:var(--fs-sm); margin:0 0 var(--sp-3); }
    .aviso.peligro { border-left-color:var(--peligro); background:var(--peligro-suave); }
    .aviso.info { border-left-color:var(--info); background:var(--info-suave); }
    .aviso .boton { margin-top:var(--sp-1); }
    .aviso p { margin:0; }

    .est { display:grid; gap:var(--sp-4); grid-template-columns:minmax(0, 1fr); }
    .col-doc { min-width:0; }
    .col-rev { min-width:0; display:grid; gap:var(--sp-4); align-content:start; container-type:inline-size; container-name:rev; }
    @container det (min-width: 760px) { .est { grid-template-columns:minmax(340px, 42%) minmax(0, 1fr); align-items:start; } }
    @media (width >= 1024px) {
      @container det (min-width: 760px) {
        .col-doc { position:sticky; top:var(--sticky-top); height:calc(100dvh - var(--sticky-top) - 84px); min-height:380px; max-height:1100px; --visor-min:0px; }
      }
    }

    .rec { padding:var(--sp-3); border-radius:var(--r-sm); background:var(--superficie-2); }
    .rec--peligro { background:var(--peligro-suave); }
    .rec--aviso { background:var(--aviso-suave); }
    .rec--ok { background:var(--ok-suave); }
    .rec .rotulo { margin:0 0 var(--sp-1); font-size:var(--fs-xs); letter-spacing:.06em; text-transform:uppercase; color:var(--texto-tenue); font-weight:700; }
    .rec .titulo { margin:0 0 var(--sp-1); }
    .rec .titulo .etiqueta { font-size:var(--fs-base); }
    .rec .frase { margin:0 0 var(--sp-1); }
    .rec .nota { margin:0; font-size:var(--fs-sm); color:var(--texto-tenue); }
    .rec .etiqueta, table.cmp .etiqueta, ul.filas .etiqueta { background:transparent; border-color:currentColor; }
    .rec--ok .etiqueta--ok { color:color-mix(in oklab, var(--ok) 72%, var(--texto)); }
    .rec--aviso .etiqueta--aviso { color:color-mix(in oklab, var(--aviso) 72%, var(--texto)); }
    .rec--peligro .etiqueta--peligro { color:color-mix(in oklab, var(--peligro) 72%, var(--texto)); }

    .lectura { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-4); margin:0; padding:0; list-style:none; font-size:var(--fs-sm); color:var(--texto-tenue); }
    .lectura strong { color:var(--texto); font-weight:600; }
    .lectura .ocr { color:var(--texto); font-weight:600; }

    .sec h3 { margin:0 0 var(--sp-2); font-size:var(--fs-base); }
    .sec .cab-sec { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-2); flex-wrap:wrap; margin-bottom:var(--sp-2); }
    .sec .cab-sec h3 { margin:0; }
    .sec h4 { margin:var(--sp-3) 0 var(--sp-1); font-size:var(--fs-sm); color:var(--texto-tenue); }

    table.cmp { width:100%; border-collapse:collapse; font-size:var(--fs-sm); table-layout:fixed; }
    table.cmp th, table.cmp td { text-align:left; vertical-align:top; padding:var(--sp-2) var(--sp-2); border-bottom:1px solid var(--borde); overflow-wrap:anywhere; }
    table.cmp thead th { font-size:var(--fs-xs); letter-spacing:.05em; text-transform:uppercase; color:var(--texto-tenue); }
    table.cmp .c-campo { width:24%; } table.cmp .c-res { width:26%; }
    table.cmp tr.critico th[scope=row] { font-weight:800; }
    table.cmp tr.falla-critica { background:var(--peligro-suave); }
    table.cmp tr.falla { background:var(--aviso-suave); }
    table.cmp .res { display:flex; flex-direction:column; gap:2px; align-items:flex-start; }
    table.cmp .nota { display:block; font-size:var(--fs-xs); color:var(--texto-tenue); font-weight:400; }
    .tag-critico { font-size:var(--fs-xs); font-weight:800; letter-spacing:.06em; }
    .sin-dato { color:var(--texto-tenue); font-style:italic; }
    @container rev (max-width: 36rem) {
      table.cmp, table.cmp tbody, table.cmp tr, table.cmp th, table.cmp td { display:block; width:auto; }
      table.cmp thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
      table.cmp tr { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 var(--sp-3); padding:var(--sp-2) var(--sp-2); border-bottom:1px solid var(--borde); }
      table.cmp th, table.cmp td { border:0; padding:2px 0; }
      table.cmp th[scope=row] { grid-column:1 / -1; font-size:var(--fs-base); }
      table.cmp td[data-etiqueta]::before { content:attr(data-etiqueta); display:block; font-size:var(--fs-xs); letter-spacing:.05em; text-transform:uppercase; color:var(--texto-tenue); }
      table.cmp td.td-res { grid-column:1 / -1; padding-top:var(--sp-1); }
    }

    .qr { margin:var(--sp-2) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }

    .secundaria { padding-top:var(--sp-3); border-top:1px solid var(--borde); }
    .pestanas { display:flex; gap:2px; border-bottom:1px solid var(--borde); margin-bottom:var(--sp-3); overflow-x:auto; }
    .pestanas button { flex:none; font:inherit; font-size:var(--fs-sm); font-weight:600; color:var(--texto-tenue); background:none; border:0; border-bottom:2px solid transparent; padding:var(--sp-2) var(--sp-3); min-height:44px; cursor:pointer; white-space:nowrap; }
    .pestanas button.activa { color:var(--marca); border-bottom-color:var(--marca); }
    .pestanas button:focus-visible { outline:2px solid var(--marca); outline-offset:-2px; }
    .pestanas .n { font-weight:400; font-variant-numeric:tabular-nums; }
    ul.filas { list-style:none; margin:0; padding:0; display:grid; gap:var(--sp-1); }
    ul.filas li { display:flex; flex-wrap:wrap; align-items:center; gap:var(--sp-1) var(--sp-3); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); background:var(--superficie-2); font-size:var(--fs-sm); overflow-wrap:anywhere; }
    ul.filas li.vigente { background:var(--ok-suave); }
    ul.eventos { list-style:none; margin:0; padding:0; }
    ul.eventos li { display:flex; flex-wrap:wrap; gap:0 var(--sp-2); font-size:var(--fs-sm); padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); overflow-wrap:anywhere; }
    ul.eventos li:last-child { border-bottom:0; }
    .tiempos { margin:var(--sp-3) 0 0; font-size:var(--fs-xs); color:var(--texto-tenue); }

    .barra-decision {
      margin-top:var(--sp-4); padding:var(--sp-3) 0 0; border-top:1px solid var(--borde); background:var(--superficie);
      display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center; z-index:6;
    }
    .barra-decision .pista { margin:0; flex:1 1 16rem; font-size:var(--fs-sm); }
    .barra-decision .rechazar { margin-left:auto; }
    .barra-decision .decidida { flex:1 1 100%; font-size:var(--fs-sm); }
    .barra-decision { position:sticky; bottom:0; padding-bottom:var(--sp-3); }
    @media (width < 1024px) { .barra-decision { bottom:var(--alto-nav-movil, 4.25rem); } }
    @media (width < 520px) { .barra-decision .boton { flex:1 1 auto; } .barra-decision .rechazar { margin-left:0; } }
  `],
  template: `
    @if (estado.cargandoDetalle() && !estado.detalle()) {
      <p class="pista" role="status">Cargando el caso…</p>
    } @else if (estado.errorDetalle(); as e) {
      <div class="aviso peligro" role="alert">{{ e }}</div>
      <button type="button" class="boton" (click)="estado.refrescarDetalle()">Reintentar</button>
    } @else if (estado.detalle(); as d) {
      <header class="cab">
        <div>
          <button type="button" class="boton compacto atras" (click)="estado.volverALista()">← Volver a la lista</button>
          <h2>{{ d.estudiante.nombre }}</h2>
          <p class="meta">
            {{ d.estudiante.documento ?? d.estudiante.documentoEnmascarado }} · {{ d.practica.empresa ?? 'Sin empresa registrada' }} · versión {{ d.version }}
          </p>
          <div class="estados">
            <span class="etiqueta etiqueta--icono etiqueta--{{ reserva(d).tono }}"><span aria-hidden="true">{{ reserva(d).icono }}</span> {{ reserva(d).texto }}</span>
            @if (d.reserva.estado === 'mia' && d.reserva.hasta) { <span class="pista" style="margin:0">{{ restante(d) }}</span> }
          </div>
        </div>
        <div class="acciones">
          @if (d.reserva.estado === 'libre' || d.reserva.estado === 'vencida') {
            <button type="button" class="boton boton--primario compacto" [disabled]="estado.ocupado() || !d.vigente || !!d.inconsistenciaOperativa || !!d.decision || d.estado !== 'revision'" (click)="estado.tomar()">Tomar el caso</button>
          }
          @if (d.reserva.estado === 'mia') {
            <button type="button" class="boton compacto" [disabled]="estado.ocupado()" (click)="estado.liberar()">Liberar el caso</button>
          }
          @if (d.reserva.estado === 'otro' && estado.esSupervisor()) {
            <button type="button" class="boton compacto" [disabled]="estado.ocupado()" [attr.aria-expanded]="confirmandoLiberar()" (click)="confirmandoLiberar.set(true)">Liberar la reserva de otra persona</button>
          }
          @if (d.estado === 'revision') {
            <button type="button" class="boton compacto" [disabled]="estado.cargandoDetalle()" (click)="estado.refrescarDetalle()" title="Vuelve a comparar con lo que SIPRA dice hoy, sin releer el documento">Recalcular comparación</button>
          } @else {
            <button type="button" class="boton compacto" [disabled]="estado.cargandoDetalle()" (click)="estado.refrescarDetalle()">Actualizar</button>
          }
        </div>
      </header>

      @if (confirmandoLiberar() && d.reserva.estado === 'otro') {
        <div class="aviso" role="alertdialog" aria-labelledby="lib-t" data-aviso="liberar">
          <p id="lib-t"><strong>¿Liberar la reserva de {{ d.reserva.por ?? 'otra persona' }}?</strong></p>
          <p>Esa persona perderá el caso y no podrá decidir hasta tomarlo de nuevo. La liberación queda registrada en la auditoría.</p>
          <button type="button" class="boton boton--peligro compacto" [disabled]="estado.ocupado()" (click)="liberarAjena()">Sí, liberar la reserva</button>
          <button type="button" class="boton compacto" (click)="confirmandoLiberar.set(false)">Cancelar</button>
        </div>
      }
      @if (d.inconsistenciaOperativa; as i) {
        <div class="aviso peligro" role="alert" data-aviso="inconsistencia">
          <p><strong>Este caso requiere revisión administrativa.</strong></p>
          <p>{{ i.mensaje }} No se puede decidir de la forma habitual.</p>
        </div>
      }
      @if (!d.vigente) {
        <div class="aviso" role="status" data-aviso="no-vigente"><strong>No es la versión vigente.</strong> El estudiante cargó una versión más reciente. Esta se muestra solo como historia.</div>
      }
      @if (estado.reservaVencidaEnPantalla()) {
        <div class="aviso peligro" role="alert"><strong>Su reserva venció.</strong> Tome el caso de nuevo para seguir trabajando; mientras tanto no puede decidir.</div>
      }
      @if (d.avisoDatosSipra) {
        <div class="aviso info" role="status" data-aviso="datos-sipra">
          <p><strong>{{ avisoDatosSipra }}</strong></p>
          @if (d.decision) {
            <p>Esta decisión corresponde a la información registrada en ese momento y no se modifica.</p>
            <button type="button" class="boton compacto" (click)="verHistorial()">Ver historial</button>
          } @else {
            <p>La comparación se recalculó con lo que SIPRA dice hoy.</p>
          }
        </div>
      }

      <div class="est">
        <section class="col-doc" aria-labelledby="p-doc">
          <h3 id="p-doc" class="sr-only">Documento</h3>
          <sipra-rut-visor [validacionId]="d.validacionId" [version]="d.version" [habilitado]="d.estudiante.documento !== null"
                           [autoabrir]="d.reserva.estado === 'mia'" (actividad)="estado.renovarSiHaceFalta()" />
        </section>

        <div class="col-rev">
          <section class="rec rec--{{ resultado(d).tono }}" aria-labelledby="p-rec" data-resultado>
            <p class="rotulo" id="p-rec">RUT · revisión</p>
            <p class="titulo"><span class="etiqueta etiqueta--icono etiqueta--{{ resultado(d).tono }}"><span aria-hidden="true">{{ resultado(d).icono }}</span> {{ resultado(d).titulo }}</span></p>
            <p class="frase">{{ resultado(d).frase }}</p>
            <p class="nota">Es una ayuda para quien revisa: la decisión es de una persona.</p>
          </section>

          <ul class="lectura" aria-label="Cómo se leyó el documento">
            <li>Esperado: <strong>{{ tipoEsperado(d) }}</strong></li>
            <li>Detectado: <strong>{{ tipoDetectado(d) }}</strong></li>
            <li>Persona: <strong>{{ persona(d) }}</strong></li>
            @if (metodo(d); as m) { <li data-lectura [class.ocr]="d.lectura.dudosa || d.lectura.metodo === 'ocr'">{{ m }}</li> }
          </ul>

          @if (d.comparacion; as c) {
            <section class="sec" aria-labelledby="p-cmp">
              <div class="cab-sec"><h3 id="p-cmp">Comparación SIPRA ↔ RUT</h3></div>
              <table class="cmp" data-tabla="criticos">
                <caption class="sr-only">Campos críticos: comparación entre los datos de SIPRA y los del RUT</caption>
                <thead><tr><th scope="col" class="c-campo">Campo</th><th scope="col">SIPRA</th><th scope="col">RUT</th><th scope="col" class="c-res">Resultado</th></tr></thead>
                <tbody>
                  @for (f of campos(c.campos).criticos; track f.campo) { <ng-container *ngTemplateOutlet="fila; context: { f: f }" /> }
                </tbody>
              </table>
              @if (campos(c.campos).informativos.length > 0) {
                <h4>Datos informativos (no afectan la decisión)</h4>
                <table class="cmp" data-tabla="informativos">
                  <caption class="sr-only">Datos informativos del RUT</caption>
                  <thead><tr><th scope="col" class="c-campo">Campo</th><th scope="col">SIPRA</th><th scope="col">RUT</th><th scope="col" class="c-res">Resultado</th></tr></thead>
                  <tbody>
                    @for (f of campos(c.campos).informativos; track f.campo) { <ng-container *ngTemplateOutlet="fila; context: { f: f }" /> }
                  </tbody>
                </table>
              }
              <p class="qr" data-qr>{{ qr(d) }} · {{ autenticidadTexto }}</p>
            </section>
          } @else {
            <section class="sec">
              <h3>Comparación SIPRA ↔ RUT</h3>
              <p class="pista">@if (d.recomendacion === 'documento_incorrecto') { No se compara: el archivo no corresponde al tipo de documento esperado. Revíselo visualmente. } @else { Todavía no hay datos para comparar: el RUT no se pudo leer o no se ha procesado. }</p>
              <p class="qr" data-qr>{{ qr(d) }} · {{ autenticidadTexto }}</p>
            </section>
          }

          <div class="secundaria">
            <div class="pestanas" role="tablist" aria-label="Información secundaria del caso">
              @for (t of pestanas(d); track t.clave) {
                <button type="button" role="tab" [id]="'rt-' + t.clave" [attr.aria-selected]="pestana() === t.clave" [attr.aria-controls]="'rp-' + t.clave"
                        [tabIndex]="pestana() === t.clave ? 0 : -1" [class.activa]="pestana() === t.clave"
                        (click)="pestana.set(t.clave)" (keydown)="tecla($event, d)">{{ t.texto }} <span class="n">{{ t.n }}</span></button>
              }
            </div>
            @if (pestana() === 'versiones') {
              <div role="tabpanel" id="rp-versiones" aria-labelledby="rt-versiones">
                <ul class="filas">
                  @for (v of d.versiones; track v.documentoId) {
                    <li [class.vigente]="v.vigente" [attr.aria-label]="'Versión ' + v.version + (v.vigente ? ', vigente' : ', anterior') + ', ' + estadoV(v.estado).texto">
                      <strong>v{{ v.version }}</strong>
                      <span class="etiqueta etiqueta--{{ v.vigente ? 'ok' : 'neutra' }}">{{ v.vigente ? 'Vigente' : 'Anterior' }}</span>
                      <span class="etiqueta etiqueta--icono etiqueta--{{ estadoV(v.estado).tono }}"><span aria-hidden="true">{{ estadoV(v.estado).icono }}</span> {{ estadoV(v.estado).texto }}</span>
                      @if (v.motivo) { <span>Motivo: {{ motivoTitulo(v.motivo) }}</span> }
                      <span class="pista" style="margin:0">{{ fechaHora(v.cargadaEn) }}@if (v.decididaEn) { · decidida {{ fechaHora(v.decididaEn) }} }</span>
                      @if (v.documentoId === d.documentoId) { <span class="etiqueta etiqueta--info">En pantalla</span> }
                      @else if (v.validacionId) { <button type="button" class="boton compacto" (click)="estado.seleccionar(v.validacionId)">Ver</button> }
                    </li>
                  }
                </ul>
              </div>
            }
            @if (pestana() === 'evidencia') {
              <div role="tabpanel" id="rp-evidencia" aria-labelledby="rt-evidencia">
                <p class="pista" style="margin:0 0 var(--sp-2)">Lo que el sistema leyó y calculó en la versión {{ d.version }}. Nunca incluye el texto del documento.</p>
                @if (evidencia(d).length === 0) { <p class="pista">Sin evidencia registrada para esta versión.</p> }
                @else { <ul class="eventos">@for (e of evidencia(d); track $index) { <li><strong>{{ e.etiqueta }}</strong> <span>· {{ resultadoEv(e.resultado) }}</span> <span class="pista" style="margin:0">· {{ fechaHora(e.fecha) }}</span></li> }</ul> }
              </div>
            }
            @if (pestana() === 'historial') {
              <div role="tabpanel" id="rp-historial" aria-labelledby="rt-historial">
                <p class="pista" style="margin:0 0 var(--sp-2)">Lo que ocurrió con la versión {{ d.version }}.</p>
                @if (historial(d).length === 0) { <p class="pista">Todavía no hay eventos.</p> }
                @else { <ul class="eventos">@for (e of historial(d); track $index) { <li><strong>{{ e.etiqueta }}</strong> <span>· {{ resultadoEv(e.resultado) }}</span>@if (e.actor) { <span>· {{ e.actor }}</span> } <span class="pista" style="margin:0">· {{ fechaHora(e.fecha) }}</span></li> }</ul> }
              </div>
            }
            <p class="tiempos">Prioridad {{ d.prioridad.puntaje }} pts@if (d.prioridad.razones.length) { · {{ d.prioridad.razones.join(' · ') }} }</p>
          </div>
        </div>
      </div>

      <div class="barra-decision" role="group" aria-label="Decisión sobre el RUT">
        @if (d.decision; as dec) {
          <span class="decidida" data-decision>Decisión: <strong>{{ estadoV(dec.estado).texto }}</strong>@if (dec.motivo) { · {{ motivoTitulo(dec.motivo) }} }@if (dec.por) { por {{ dec.por }} }@if (dec.en) { el {{ fechaHora(dec.en) }} }.</span>
        } @else {
          <button type="button" class="boton boton--primario" [disabled]="!estado.puedeDecidir()" (click)="decision.abrir('aprobar')">Aprobar</button>
          <button type="button" class="boton" [disabled]="!estado.puedeDecidir()" (click)="decision.abrir('devolver')">Devolver</button>
          <button type="button" class="boton boton--peligro rechazar" [disabled]="!estado.puedeDecidir()" (click)="decision.abrir('rechazar')">Rechazar</button>
          @if (!estado.puedeDecidir()) { <span class="pista">{{ porQueNoDecide(d) }}</span> }
        }
      </div>

      <sipra-rut-decision #decision [detalle]="d" [motivos]="estado.motivos()" [ocupado]="estado.ocupado()" (confirmada)="decidir($event)" />

      <ng-template #fila let-f="f">
        <tr [class.critico]="f.criticidad === 'critico'" [class.falla-critica]="res(f).critico" [class.falla]="res(f).tono === 'aviso' && f.criticidad === 'critico'" [attr.aria-label]="descripcion(f)">
          <th scope="row">{{ f.etiqueta }}</th>
          <td data-etiqueta="SIPRA">@if (f.sipra) { {{ f.sipra }} } @else { <span class="sin-dato">Sin dato</span> }</td>
          <td data-etiqueta="RUT">@if (f.rut) { {{ f.rut }} } @else { <span class="sin-dato">No se leyó</span> }</td>
          <td class="td-res">
            <span class="res">
              <span class="etiqueta etiqueta--icono etiqueta--{{ res(f).tono }}"><span aria-hidden="true">{{ res(f).icono }}</span> {{ res(f).texto }}</span>
              @if (res(f).critico) { <span class="tag-critico">CRÍTICO</span> }
              @if (f.advertencia) { <span class="nota">{{ f.advertencia }}</span> }
            </span>
          </td>
        </tr>
      </ng-template>
    }
  `,
})
export class RutDetalleComponent {
  protected readonly estado = inject(RutMesaEstado);
  private readonly decisionDialogo = viewChild<RutDecisionComponent>('decision');

  readonly pestana = signal<Pestana>('versiones');
  readonly avisoDatosSipra = AVISO_DATOS_SIPRA;
  readonly autenticidadTexto = TEXTO_AUTENTICIDAD;
  readonly confirmandoLiberar = signal(false);

  pestanas(d: DetalleRut) {
    return [
      { clave: 'versiones', texto: 'Versiones', n: d.versiones.length },
      { clave: 'evidencia', texto: 'Evidencia', n: this.evidencia(d).length },
      { clave: 'historial', texto: 'Historial', n: this.historial(d).length },
    ] as const;
  }

  evidencia(d: DetalleRut) { return d.historial.filter((e) => TIPOS_EVIDENCIA.includes(e.tipo)); }
  historial(d: DetalleRut) { return d.historial.filter((e) => !TIPOS_EVIDENCIA.includes(e.tipo)); }

  /** Flechas, Inicio y Fin cambian de pestaña (patrón de pestañas del APG) y llevan el foco. */
  tecla(e: KeyboardEvent, d: DetalleRut): void {
    const claves = this.pestanas(d).map((t) => t.clave);
    const i = claves.indexOf(this.pestana());
    const sig = e.key === 'ArrowRight' ? (i + 1) % claves.length : e.key === 'ArrowLeft' ? (i - 1 + claves.length) % claves.length : e.key === 'Home' ? 0 : e.key === 'End' ? claves.length - 1 : -1;
    if (sig < 0) return;
    e.preventDefault();
    this.pestana.set(claves[sig]);
    setTimeout(() => document.getElementById('rt-' + claves[sig])?.focus(), 0);
  }

  /** «Ver historial» del aviso de datos cambiados: abre la pestaña y lleva el foco a ella. */
  verHistorial(): void {
    this.pestana.set('historial');
    setTimeout(() => { const t = document.getElementById('rt-historial'); t?.scrollIntoView({ block: 'center' }); t?.focus(); }, 0);
  }

  async decidir(dto: DecisionRut): Promise<void> {
    const ok = await this.estado.decidir(dto);
    if (!ok) this.decisionDialogo()?.cerrar();
  }

  /** La liberación de la reserva de otra persona pide confirmación: el funcionario puede estar en medio de una revisión. */
  async liberarAjena(): Promise<void> {
    await this.estado.liberar();
    this.confirmandoLiberar.set(false);
  }

  porQueNoDecide(d: DetalleRut): string {
    if (d.inconsistenciaOperativa) return 'Este caso requiere revisión administrativa: no se decide de la forma habitual.';
    if (!d.vigente) return 'No es la versión vigente del RUT.';
    if (d.reserva.estado !== 'mia') return 'Toma el caso para poder decidir.';
    if (this.estado.reservaVencidaEnPantalla()) return 'Tu reserva venció: toma el caso de nuevo.';
    if (d.estado !== 'revision') return 'El RUT todavía no está listo para revisión.';
    return 'En este momento no se puede decidir sobre el caso.';
  }

  reserva(d: DetalleRut) {
    return textoReserva({ estado: this.estado.reservaVencidaEnPantalla() ? 'vencida' : d.reserva.estado, por: d.reserva.por });
  }
  restante(d: DetalleRut): string {
    const t = textoRestante(d.reserva.hasta, this.estado.ahora());
    return t === 'venció' ? 'venció' : `le quedan ${t}`;
  }
  resultado(d: DetalleRut) { return resultadoRut(d.recomendacion); }
  tipoEsperado(d: DetalleRut): string { return textoTipoEsperado(d.tipoEsperado); }
  tipoDetectado(d: DetalleRut): string { return textoTipoDetectado(d.tipoDetectado); }
  persona(d: DetalleRut): string { return textoPersona(d.tipoPersona); }
  metodo(d: DetalleRut): string | null { return textoMetodo(d.lectura.metodo, d.lectura.dudosa); }
  qr(d: DetalleRut): string { return textosQr(d.autenticidad).join(' · '); }
  campos(c: readonly CampoComparadoRut[]) { return separarCampos(c); }
  res(f: Pick<CampoComparadoRut, 'resultado' | 'criticidad'>) { return resultadoCampo(f); }
  descripcion(f: CampoComparadoRut): string { return descripcionCampo(f); }
  estadoV(estado: string) { return estadoVersion(estado); }
  /** El título del motivo sale del catálogo de la API; sin catálogo, se muestra el código legible. */
  motivoTitulo(codigo: string): string { return this.estado.motivos().find((m) => m.codigo === codigo)?.titulo ?? codigo.replace(/_/g, ' '); }
  resultadoEv(r: string): string { return resultadoEvento(r); }
  fechaHora(iso: string | null): string { return fechaCorta(iso); }
}
