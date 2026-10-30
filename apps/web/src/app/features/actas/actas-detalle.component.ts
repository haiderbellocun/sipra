import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { CampoComparadoActa, DecisionActa, DetalleActa } from '@core/models/modelos';
import { diaCorto, fechaCorta, fechaIso, textoRestante } from '../eps/eps.util';
import { ActasCorreccionComponent } from './actas-correccion.component';
import { ActasDecisionComponent } from './actas-decision.component';
import { ActasMesaEstado } from './actas-mesa.estado';
import { ActasVisorComponent } from './actas-visor.component';
import {
  AYUDA_FIRMAS, TEXTO_CLASIFICACION, descripcionCampo, estadoVersion, ordenarCampos, presenciaFirma, resultadoActa, resultadoCampo,
  resultadoEvento, textoReserva,
} from './actas.util';

type Pestana = 'versiones' | 'evidencia' | 'historial';

/** Eventos de lectura del sistema (la «evidencia»); el resto es lo que ocurrió con el caso (el «historial»). Ambos son de ESTA versión. */
const TIPOS_EVIDENCIA = ['lectura_documento', 'clasificacion_documental', 'comparacion', 'medicion_firmas'];

/**
 * Detalle de un caso de la Mesa de Actas como estación de trabajo: el Acta a la izquierda (fija mientras se revisa) y, a su lado,
 * lo que hace falta para decidir, en orden de importancia: resultado, cuatro datos clave, comparación y, debajo, versiones,
 * evidencia e historial. Las acciones van en una barra inferior. La composición responde al ANCHO DEL PROPIO DETALLE
 * (container query), no al de la ventana. Toda acción pasa por `ActasMesaEstado` (y de ahí por la API, que revalida).
 */
@Component({
  selector: 'sipra-actas-detalle',
  standalone: true,
  imports: [ActasVisorComponent, ActasDecisionComponent, ActasCorreccionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; container-type:inline-size; container-name:det; --sticky-top:calc(var(--alto-cinta, 0px) + 62px + 12px); }

    /* ── Encabezado del caso ── */
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

    /* ── Composición: Acta | revisión ── */
    .est { display:grid; gap:var(--sp-4); grid-template-columns:minmax(0, 1fr); }
    .col-acta { min-width:0; }
    .col-rev { min-width:0; display:grid; gap:var(--sp-4); align-content:start; container-type:inline-size; container-name:rev; }
    @container det (min-width: 760px) { .est { grid-template-columns:minmax(340px, 42%) minmax(0, 1fr); align-items:start; } }
    /* El Acta queda a la vista mientras se revisa lo demás (solo con ventana de escritorio). */
    @media (width >= 1024px) {
      @container det (min-width: 760px) {
        .col-acta { position:sticky; top:var(--sticky-top); height:calc(100dvh - var(--sticky-top) - 84px); min-height:380px; max-height:1100px; --visor-min:0px; }
      }
    }

    /* ── Resultado principal ── */
    .rec { padding:var(--sp-3); border-radius:var(--r-sm); background:var(--superficie-2); }
    .rec--peligro { background:var(--peligro-suave); }
    .rec--aviso { background:var(--aviso-suave); }
    .rec--ok { background:var(--ok-suave); }
    .rec .rotulo { margin:0 0 var(--sp-1); font-size:var(--fs-xs); letter-spacing:.06em; text-transform:uppercase; color:var(--texto-tenue); font-weight:700; }
    .rec .titulo { margin:0 0 var(--sp-1); }
    .rec .titulo .etiqueta { font-size:var(--fs-base); }
    .rec .frase { margin:0 0 var(--sp-1); }
    .rec .nota { margin:0; font-size:var(--fs-sm); color:var(--texto-tenue); }
    /* Una etiqueta de tono sobre un fondo ya teñido se teñiría dos veces y perdería contraste en el tema claro: aquí va sin relleno, con borde del mismo color. */
    .rec .etiqueta, table.cmp .etiqueta, ul.filas .etiqueta { background:transparent; border-color:currentColor; }
    /* Sobre el recuadro teñido, el texto del tono se acerca al color del texto (mezcla de tokens existentes) para llegar a 4,5:1 en ambos temas. */
    .rec--ok .etiqueta--ok { color:color-mix(in oklab, var(--ok) 72%, var(--texto)); }
    .rec--aviso .etiqueta--aviso { color:color-mix(in oklab, var(--aviso) 72%, var(--texto)); }
    .rec--peligro .etiqueta--peligro { color:color-mix(in oklab, var(--peligro) 72%, var(--texto)); }

    /* ── Cuatro datos clave ── */
    .claves { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit, minmax(11rem, 1fr)); margin:0; padding:0; list-style:none; }
    .clave { border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); display:grid; gap:2px; align-content:start; min-width:0; }
    .clave.t-peligro { border-color:var(--peligro); background:var(--peligro-suave); }
    .clave.t-aviso { border-color:var(--aviso); background:var(--aviso-suave); }
    .clave .k { font-size:var(--fs-xs); letter-spacing:.06em; text-transform:uppercase; color:var(--texto-tenue); font-weight:700; }
    .clave .v { display:flex; gap:var(--sp-2); align-items:baseline; font-size:var(--fs-sm); min-width:0; }
    .clave .v .r { flex:none; width:3.6rem; color:var(--texto-tenue); font-size:var(--fs-xs); }
    .clave .v strong { overflow-wrap:anywhere; }
    .clave .est-campo { margin-top:var(--sp-1); font-size:var(--fs-sm); font-weight:700; }
    .clave .grande { font-size:var(--fs-lg); font-weight:700; line-height:1.25; overflow-wrap:anywhere; }
    .ayuda-firmas { margin:var(--sp-2) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }

    .sec h3 { margin:0 0 var(--sp-2); font-size:var(--fs-base); }
    .sec .cab-sec { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-2); flex-wrap:wrap; margin-bottom:var(--sp-2); }
    .sec .cab-sec h3 { margin:0; }

    /* ── Comparación: tabla en escritorio, bloques apilados cuando el ancho no alcanza ── */
    table.cmp { width:100%; border-collapse:collapse; font-size:var(--fs-sm); table-layout:fixed; }
    table.cmp th, table.cmp td { text-align:left; vertical-align:top; padding:var(--sp-2) var(--sp-2); border-bottom:1px solid var(--borde); overflow-wrap:anywhere; }
    table.cmp thead th { font-size:var(--fs-xs); letter-spacing:.05em; text-transform:uppercase; color:var(--texto-tenue); }
    table.cmp .c-campo { width:24%; } table.cmp .c-res { width:23%; }
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

    .lista-d { margin:0; padding-left:var(--sp-4); display:grid; gap:2px; font-size:var(--fs-sm); }
    dl.registrados { margin:0; display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit, minmax(10rem, 1fr)); font-size:var(--fs-sm); }
    dl.registrados dt { font-size:var(--fs-xs); color:var(--texto-tenue); }
    dl.registrados dd { margin:0; font-weight:600; overflow-wrap:anywhere; }
    .sugerencia { margin:var(--sp-2) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }

    /* ── Zona secundaria en pestañas ── */
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

    /* ── Acciones: siempre al alcance al terminar de revisar ── */
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
            {{ d.estudiante.documento ?? d.estudiante.documentoEnmascarado }}@if (d.estudiante.programa) { · {{ d.estudiante.programa }} }
            · {{ d.practica.empresa ?? 'Sin empresa registrada' }} · {{ d.practica.modalidad }} · versión {{ d.version }}
          </p>
          <div class="estados">
            <span class="etiqueta etiqueta--icono etiqueta--{{ reserva(d).tono }}"><span aria-hidden="true">{{ reserva(d).icono }}</span> {{ reserva(d).texto }}</span>
            @if (d.reserva.estado === 'mia' && d.reserva.hasta) { <span class="pista" style="margin:0">{{ restante(d) }}</span> }
          </div>
        </div>
        <div class="acciones">
          @if (d.reserva.estado === 'libre' || d.reserva.estado === 'vencida') {
            <button type="button" class="boton boton--primario compacto" [disabled]="estado.ocupado() || !d.vigente || !!d.inconsistenciaOperativa || !!d.decision" (click)="estado.tomar()">Tomar el caso</button>
          }
          @if (d.reserva.estado === 'mia') {
            <button type="button" class="boton compacto" [disabled]="estado.ocupado()" (click)="estado.liberar()">Liberar el caso</button>
          }
          @if (d.reserva.estado === 'otro' && estado.esSupervisor()) {
            <button type="button" class="boton compacto" [disabled]="estado.ocupado()" [attr.aria-expanded]="confirmandoLiberar()" (click)="confirmandoLiberar.set(true)">Liberar la reserva de otra persona</button>
          }
          <button type="button" class="boton compacto" [disabled]="estado.cargandoDetalle()" (click)="estado.refrescarDetalle()">Actualizar</button>
        </div>
      </header>

      @if (confirmandoLiberar() && d.reserva.estado === 'otro') {
        <div class="aviso" role="alertdialog" aria-labelledby="lib-t" data-aviso="liberar">
          <p id="lib-t"><strong>¿Liberar la reserva de {{ d.reserva.por ?? 'otra persona' }}?</strong></p>
          <p>Esa persona perderá el caso y no podrá decidir hasta tomarlo de nuevo.</p>
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
        <div class="aviso" role="status"><strong>No es la versión vigente.</strong> El estudiante cargó una versión más reciente. Esta se muestra solo como historia.</div>
      }
      @if (estado.reservaVencidaEnPantalla()) {
        <div class="aviso peligro" role="alert"><strong>Su reserva venció.</strong> Tome el caso de nuevo para seguir trabajando; mientras tanto no puede decidir.</div>
      }
      @if (d.datosPracticaCambiaronDespuesDeDecision) {
        <div class="aviso info" role="status" data-aviso="datos-cambiaron">
          <p><strong>Los datos de la práctica cambiaron después de esta decisión.</strong></p>
          <p>Esta decisión corresponde a la información registrada en ese momento.</p>
          <button type="button" class="boton compacto" (click)="verHistorial()">Ver historial</button>
        </div>
      }

      <div class="est">
        <section class="col-acta" aria-labelledby="p-acta">
          <h3 id="p-acta" class="sr-only">Acta</h3>
          <sipra-actas-visor [validacionId]="d.validacionId" [version]="d.version" [habilitado]="d.estudiante.documento !== null"
                             [autoabrir]="d.reserva.estado === 'mia'" (actividad)="estado.renovarSiHaceFalta()" />
        </section>

        <div class="col-rev">
          <section class="rec rec--{{ resultado(d).tono }}" aria-labelledby="p-rec" data-resultado>
            <p class="rotulo" id="p-rec">Acta de iniciación · revisión</p>
            <p class="titulo"><span class="etiqueta etiqueta--icono etiqueta--{{ resultado(d).tono }}"><span aria-hidden="true">{{ resultado(d).icono }}</span> {{ resultado(d).titulo }}</span></p>
            <p class="frase">{{ resultado(d).frase }}</p>
            <p class="nota">@if (d.resumen.clasificacion) { Lo que parece ser el archivo: {{ clasificacion(d) }}. }Es una ayuda para quien revisa: la decisión es de una persona.</p>
          </section>

          <section class="sec" aria-label="Datos clave del Acta">
            <ul class="claves">
              <li class="clave {{ tonoClave(d, 'remuneracion') }}" data-clave="remuneracion">
                <span class="k">Remuneración</span>
                <span class="v"><span class="r">SIPRA</span><strong>{{ d.resumen.remuneracionSipra ?? 'Sin dato' }}</strong></span>
                <span class="v"><span class="r">Acta</span><strong>{{ d.resumen.remuneracionActa ?? 'No se leyó' }}</strong></span>
                <span class="est-campo">{{ estadoClave(d, 'remuneracion') }}</span>
              </li>
              <li class="clave {{ tonoClave(d, 'responsable_arl') }}" data-clave="arl">
                <span class="k">Responsable ARL</span>
                <span class="v"><span class="r">SIPRA</span><strong>{{ d.resumen.responsableArlSipra ?? 'Sin dato' }}</strong></span>
                <span class="v"><span class="r">Acta</span><strong>{{ d.resumen.responsableArlActa ?? 'No se leyó' }}</strong></span>
                <span class="est-campo">{{ estadoClave(d, 'responsable_arl') }}</span>
              </li>
              <li class="clave {{ tonoFirma(d.resumen.firmaEmpresa) }}" data-clave="firma-empresa">
                <span class="k">Firma empresa</span>
                <span class="grande"><span aria-hidden="true">{{ firma(d.resumen.firmaEmpresa).icono }}</span> {{ firma(d.resumen.firmaEmpresa).texto }}</span>
              </li>
              <li class="clave {{ tonoFirma(d.resumen.firmaPracticante) }}" data-clave="firma-practicante">
                <span class="k">Firma practicante</span>
                <span class="grande"><span aria-hidden="true">{{ firma(d.resumen.firmaPracticante).icono }}</span> {{ firma(d.resumen.firmaPracticante).texto }}</span>
              </li>
            </ul>
            <p class="ayuda-firmas">{{ ayudaFirmas }}</p>
          </section>

          @if (d.comparacion; as c) {
            <section class="sec" aria-labelledby="p-cmp">
              <div class="cab-sec"><h3 id="p-cmp">Comparación SIPRA ↔ Acta</h3></div>
              @if (!c.vigente) {
                <p class="aviso info" role="status">Los datos de la práctica cambiaron: la comparación se muestra con lo que SIPRA dice hoy.</p>
              }
              @if (d.decision && d.datosPracticaCambiaronDespuesDeDecision) {
                <p class="pista" style="margin:0 0 var(--sp-2)">Resultado de la decisión, con los datos registrados en ese momento.</p>
              }
              <table class="cmp">
                <caption class="sr-only">Comparación campo por campo entre los datos de SIPRA y los del Acta</caption>
                <thead><tr><th scope="col" class="c-campo">Campo</th><th scope="col">SIPRA</th><th scope="col">Acta</th><th scope="col" class="c-res">Resultado</th></tr></thead>
                <tbody>
                  @for (f of campos(c.campos); track f.campo) {
                    <tr [class.critico]="esCritico(f)" [class.falla-critica]="res(f).critico" [class.falla]="res(f).tono === 'aviso' && !res(f).critico" [attr.aria-label]="descripcion(f)">
                      <th scope="row">{{ f.etiqueta }}</th>
                      <td data-etiqueta="SIPRA">@if (f.sipra) { {{ f.sipra }} } @else { <span class="sin-dato">Sin dato</span> }</td>
                      <td data-etiqueta="Acta">@if (f.acta) { {{ f.acta }} } @else { <span class="sin-dato">No se leyó</span> }</td>
                      <td class="td-res">
                        <span class="res">
                          <span class="etiqueta etiqueta--icono etiqueta--{{ res(f).tono }}"><span aria-hidden="true">{{ res(f).icono }}</span> {{ res(f).texto }}</span>
                          @if (res(f).critico) { <span class="tag-critico">CRÍTICO</span> }
                          @if (f.nota) { <span class="nota">{{ f.nota }}</span> }
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>

            @if (c.discrepancias.length > 0) {
              <section class="sec" aria-labelledby="p-dif">
                <h3 id="p-dif">Qué conviene revisar</h3>
                <ul class="lista-d">@for (x of c.discrepancias; track $index) { <li>{{ x.mensaje }}</li> }</ul>
              </section>
            }
          } @else {
            <section class="sec"><h3>Comparación SIPRA ↔ Acta</h3><p class="pista">Todavía no hay datos para comparar: el Acta no se pudo leer o no se ha procesado.</p></section>
          }

          <section class="sec" aria-labelledby="p-reg">
            <div class="cab-sec">
              <h3 id="p-reg">Datos registrados en SIPRA</h3>
              @if (estado.esSupervisor()) { <button type="button" class="boton compacto" [disabled]="estado.ocupado()" (click)="correccion.abrir()">Corregir datos</button> }
            </div>
            <dl class="registrados">
              <div><dt>Remuneración</dt><dd>{{ d.resumen.remuneracionSipra ?? 'Sin dato' }}</dd></div>
              <div><dt>Responsable de la ARL</dt><dd>{{ d.resumen.responsableArlSipra ?? 'Sin informar' }}</dd></div>
              <div><dt>Inicio · fin</dt><dd>{{ fecha(d.practica.fechaInicio) }} · {{ fecha(d.practica.fechaFin) }}</dd></div>
            </dl>
            @if (d.responsableArlSugeridoPorModalidad) {
              <p class="sugerencia" data-sugerencia-arl>Sugerencia de la modalidad: <strong>{{ sugerenciaArl(d.responsableArlSugeridoPorModalidad) }}</strong>. Es solo una referencia: no es el dato registrado en la práctica.</p>
            }
          </section>

          <div class="secundaria">
            <div class="pestanas" role="tablist" aria-label="Información secundaria del caso">
              @for (t of pestanas(d); track t.clave) {
                <button type="button" role="tab" [id]="'at-' + t.clave" [attr.aria-selected]="pestana() === t.clave" [attr.aria-controls]="'ap-' + t.clave"
                        [tabIndex]="pestana() === t.clave ? 0 : -1" [class.activa]="pestana() === t.clave"
                        (click)="pestana.set(t.clave)" (keydown)="tecla($event, d)">{{ t.texto }} <span class="n">{{ t.n }}</span></button>
              }
            </div>
            @if (pestana() === 'versiones') {
              <div role="tabpanel" id="ap-versiones" aria-labelledby="at-versiones">
                <ul class="filas">
                  @for (v of d.versiones; track v.documentoId) {
                    <li [class.vigente]="v.vigente" [attr.aria-label]="'Versión ' + v.version + (v.vigente ? ', vigente' : ', anterior') + ', ' + estadoV(v.estado).texto">
                      <strong>v{{ v.version }}</strong>
                      <span class="etiqueta etiqueta--{{ v.vigente ? 'ok' : 'neutra' }}">{{ v.vigente ? 'Vigente' : 'Anterior' }}</span>
                      <span class="etiqueta etiqueta--icono etiqueta--{{ estadoV(v.estado).tono }}"><span aria-hidden="true">{{ estadoV(v.estado).icono }}</span> {{ estadoV(v.estado).texto }}</span>
                      <span class="pista" style="margin:0">{{ fechaHora(v.cargadaEn) }}</span>
                      @if (v.documentoId === d.documentoId) { <span class="etiqueta etiqueta--info">En pantalla</span> }
                      @else if (v.validacionId) { <button type="button" class="boton compacto" (click)="estado.seleccionar(v.validacionId)">Ver</button> }
                    </li>
                  }
                </ul>
              </div>
            }
            @if (pestana() === 'evidencia') {
              <div role="tabpanel" id="ap-evidencia" aria-labelledby="at-evidencia">
                <p class="pista" style="margin:0 0 var(--sp-2)">Lo que el sistema leyó y calculó en la versión {{ d.version }}. Nunca incluye el texto del documento.</p>
                @if (evidencia(d).length === 0) { <p class="pista">Sin evidencia registrada para esta versión.</p> }
                @else { <ul class="eventos">@for (e of evidencia(d); track $index) { <li><strong>{{ e.etiqueta }}</strong> <span>· {{ resultadoEv(e.resultado) }}</span> <span class="pista" style="margin:0">· {{ fechaHora(e.fecha) }}</span></li> }</ul> }
              </div>
            }
            @if (pestana() === 'historial') {
              <div role="tabpanel" id="ap-historial" aria-labelledby="at-historial">
                <p class="pista" style="margin:0 0 var(--sp-2)">Lo que ocurrió con la versión {{ d.version }}.</p>
                @if (historial(d).length === 0) { <p class="pista">Todavía no hay eventos.</p> }
                @else { <ul class="eventos">@for (e of historial(d); track $index) { <li><strong>{{ e.etiqueta }}</strong> <span>· {{ resultadoEv(e.resultado) }}</span>@if (e.actor) { <span>· {{ e.actor }}</span> } <span class="pista" style="margin:0">· {{ fechaHora(e.fecha) }}</span></li> }</ul> }
              </div>
            }
            <p class="tiempos">Prioridad {{ d.prioridad.puntaje }} pts@if (d.prioridad.razones.length) { · {{ d.prioridad.razones.join(' · ') }} }</p>
          </div>
        </div>
      </div>

      <div class="barra-decision" role="group" aria-label="Decisión sobre el Acta">
        @if (d.decision; as dec) {
          <span class="decidida" data-decision>Decisión: <strong>{{ estadoV(dec.estado).texto }}</strong>@if (dec.por) { por {{ dec.por }} }@if (dec.en) { el {{ fechaHora(dec.en) }} }.</span>
        } @else {
          <button type="button" class="boton boton--primario" [disabled]="!estado.puedeDecidir()" (click)="decision.abrir('aprobar')">Aprobar</button>
          <button type="button" class="boton" [disabled]="!estado.puedeDecidir()" (click)="decision.abrir('devolver')">Devolver</button>
          <button type="button" class="boton boton--peligro rechazar" [disabled]="!estado.puedeDecidir()" (click)="decision.abrir('rechazar')">Rechazar</button>
          @if (!estado.puedeDecidir()) { <span class="pista">{{ porQueNoDecide(d) }}</span> }
        }
      </div>

      <sipra-actas-decision #decision [detalle]="d" [ocupado]="estado.ocupado()" (confirmada)="decidir($event)" />
      <sipra-actas-correccion #correccion [detalle]="d" />
    }
  `,
})
export class ActasDetalleComponent {
  protected readonly estado = inject(ActasMesaEstado);
  private readonly decisionDialogo = viewChild<ActasDecisionComponent>('decision');

  readonly pestana = signal<Pestana>('versiones');
  readonly ayudaFirmas = AYUDA_FIRMAS;

  pestanas(d: DetalleActa) {
    return [
      { clave: 'versiones', texto: 'Versiones', n: d.versiones.length },
      { clave: 'evidencia', texto: 'Evidencia', n: this.evidencia(d).length },
      { clave: 'historial', texto: 'Historial', n: this.historial(d).length },
    ] as const;
  }

  evidencia(d: DetalleActa) { return d.historial.filter((e) => TIPOS_EVIDENCIA.includes(e.tipo)); }
  historial(d: DetalleActa) { return d.historial.filter((e) => !TIPOS_EVIDENCIA.includes(e.tipo)); }

  /** Flechas, Inicio y Fin cambian de pestaña (patrón de pestañas del APG) y llevan el foco. */
  tecla(e: KeyboardEvent, d: DetalleActa): void {
    const claves = this.pestanas(d).map((t) => t.clave);
    const i = claves.indexOf(this.pestana());
    const sig = e.key === 'ArrowRight' ? (i + 1) % claves.length : e.key === 'ArrowLeft' ? (i - 1 + claves.length) % claves.length : e.key === 'Home' ? 0 : e.key === 'End' ? claves.length - 1 : -1;
    if (sig < 0) return;
    e.preventDefault();
    this.pestana.set(claves[sig]);
    setTimeout(() => document.getElementById('at-' + claves[sig])?.focus(), 0);
  }

  /** «Ver historial» del aviso de datos cambiados: abre la pestaña y lleva el foco a ella. */
  verHistorial(): void {
    this.pestana.set('historial');
    setTimeout(() => { const t = document.getElementById('at-historial'); t?.scrollIntoView({ block: 'center' }); t?.focus(); }, 0);
  }

  async decidir(dto: DecisionActa): Promise<void> {
    const ok = await this.estado.decidir(dto);
    if (!ok) this.decisionDialogo()?.cerrar();
  }

  /** La liberación de la reserva de otra persona pide confirmación: el funcionario puede estar en medio de una revisión. */
  readonly confirmandoLiberar = signal(false);
  async liberarAjena(): Promise<void> {
    await this.estado.liberar();
    this.confirmandoLiberar.set(false);
  }

  porQueNoDecide(d: DetalleActa): string {
    if (d.inconsistenciaOperativa) return 'Este caso requiere revisión administrativa: no se decide de la forma habitual.';
    if (!d.vigente) return 'No es la versión vigente del Acta.';
    if (d.reserva.estado !== 'mia') return 'Toma el caso para poder decidir.';
    if (this.estado.reservaVencidaEnPantalla()) return 'Tu reserva venció: toma el caso de nuevo.';
    if (d.estado !== 'revision') return 'El Acta todavía no está lista para revisión.';
    return 'En este momento no se puede decidir sobre el caso.';
  }

  reserva(d: DetalleActa) {
    return textoReserva({ estado: this.estado.reservaVencidaEnPantalla() ? 'vencida' : d.reserva.estado, por: d.reserva.por });
  }
  restante(d: DetalleActa): string {
    const t = textoRestante(d.reserva.hasta, this.estado.ahora());
    return t === 'venció' ? 'venció' : `le quedan ${t}`;
  }
  resultado(d: DetalleActa) { return resultadoActa(d.recomendacion); }
  clasificacion(d: DetalleActa): string { return TEXTO_CLASIFICACION[d.resumen.clasificacion ?? ''] ?? 'No determinable'; }
  firma(valor: string | null) { return presenciaFirma(valor); }
  tonoFirma(valor: string | null): string { const t = presenciaFirma(valor).tono; return t === 'peligro' || t === 'aviso' ? `t-${t}` : ''; }
  campos(c: readonly CampoComparadoActa[]) { return ordenarCampos(c); }
  res(f: Parameters<typeof resultadoCampo>[0]) { return resultadoCampo(f); }
  descripcion(f: Parameters<typeof descripcionCampo>[0]): string { return descripcionCampo(f); }
  esCritico(f: { criticidad: string }): boolean { return f.criticidad === 'critica'; }
  private campoClave(d: DetalleActa, campo: string) { return d.comparacion?.campos.find((c) => c.campo === campo) ?? null; }
  tonoClave(d: DetalleActa, campo: string): string {
    const c = this.campoClave(d, campo);
    if (!c) return '';
    const r = resultadoCampo(c);
    return r.tono === 'peligro' || r.tono === 'aviso' ? `t-${r.tono}` : '';
  }
  estadoClave(d: DetalleActa, campo: string): string {
    const c = this.campoClave(d, campo);
    if (!c) return 'Sin comparar';
    const r = resultadoCampo(c);
    return `${r.icono} ${r.texto}${r.critico ? ' · CRÍTICO' : ''}`;
  }
  estadoV(estado: string) { return estadoVersion(estado); }
  sugerenciaArl(valor: string): string { return valor === 'cun' ? 'CUN' : valor === 'empresa' ? 'Empresa' : 'según el convenio'; }
  resultadoEv(r: string): string { return resultadoEvento(r); }
  fecha(iso: string | null): string { return fechaIso(iso); }
  fechaHora(iso: string | null): string { return fechaCorta(iso); }
  dia(iso: string | null): string { return diaCorto(iso); }
}
