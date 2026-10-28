import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { DecisionMesa } from '@core/models/modelos';
import { EpsAdresComponent } from './eps-adres.component';
import { EpsComparacionComponent } from './eps-comparacion.component';
import { EpsDecisionComponent } from './eps-decision.component';
import { EpsHistorialComponent } from './eps-historial.component';
import { EpsMesaEstado } from './eps-mesa.estado';
import { EpsVisorComponent } from './eps-visor.component';
import {
  AFILIACION, AUTENTICIDAD, ESTADO_RESERVA, FUENTE_AFILIACION, FUENTE_CAMPO, METODO_EXTRACCION, RECOMENDACION, SEVERIDAD_DISCREPANCIA,
  diaCorto, fechaCorta, fechaIso, textoRestante,
} from './eps.util';

type Detalle = NonNullable<ReturnType<EpsMesaEstado['detalle']>>;

/**
 * Detalle de un caso de la Mesa como estación de trabajo: el certificado a la izquierda (fijo mientras se
 * revisa) y, a su lado, lo que hace falta para decidir, en orden de importancia; lo histórico va debajo y las
 * acciones en una barra inferior. La composición responde al ANCHO DEL PROPIO DETALLE (container query), no al de
 * la ventana: con la lista de casos a la vista el detalle es más angosto que con ella oculta.
 * Toda acción pasa por `EpsMesaEstado` (y de ahí por la API, que revalida): aquí solo se muestra.
 */
@Component({
  selector: 'sipra-eps-detalle',
  standalone: true,
  imports: [EpsVisorComponent, EpsComparacionComponent, EpsAdresComponent, EpsDecisionComponent, EpsHistorialComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      display:block; container-type:inline-size; container-name:det;
      /* Debajo de la cinta de pruebas y de la barra superior del armazón. */
      --sticky-top: calc(var(--alto-cinta, 0px) + 62px + 12px);
    }

    /* ── Encabezado del caso ── */
    .cab { display:flex; gap:var(--sp-2) var(--sp-4); align-items:flex-start; justify-content:space-between; flex-wrap:wrap; margin-bottom:var(--sp-3); }
    .cab h2 { margin:0 0 2px; font-size:var(--fs-xl); overflow-wrap:break-word; }
    .cab .meta { margin:0; font-size:var(--fs-sm); color:var(--texto-tenue); overflow-wrap:break-word; }
    .cab .estados { display:flex; gap:var(--sp-1) var(--sp-2); flex-wrap:wrap; align-items:center; margin-top:var(--sp-2); }
    .cab .acciones { justify-content:flex-end; }
    .atras { display:none; margin-bottom:var(--sp-2); }
    @media (width < 1200px) { .atras { display:inline-flex; } }

    .aviso { background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); font-size:var(--fs-sm); margin:0 0 var(--sp-3); }
    .aviso.peligro { background:var(--peligro-suave); }

    /* ── Composición: certificado | revisión ── */
    .est { display:grid; gap:var(--sp-4); grid-template-columns:minmax(0, 1fr); }
    .col-cert { min-width:0; }
    /* La revisión es también un contenedor: sus secciones se acomodan al ancho que de verdad tienen. */
    .col-rev { min-width:0; display:grid; gap:var(--sp-4); align-content:start; container-type:inline-size; container-name:rev; }
    @container det (min-width: 720px) {
      .est { grid-template-columns:minmax(320px, 40%) minmax(0, 1fr); align-items:start; }
    }
    /* El certificado queda a la vista mientras se revisa lo demás (solo con ventana de escritorio). */
    @media (width >= 1024px) {
      @container det (min-width: 720px) {
        .col-cert { position:sticky; top:var(--sticky-top); height:calc(100dvh - var(--sticky-top) - 84px); min-height:360px; max-height:1000px; --visor-min:0px; }
      }
    }

    /* ── Secciones de la revisión ── */
    .sec h3 { margin:0 0 var(--sp-2); font-size:var(--fs-base); }
    .sec > p:last-child { margin-bottom:0; }
    .rec { padding:var(--sp-3); border-radius:var(--r-sm); background:var(--superficie-2); }
    .rec--peligro { background:var(--peligro-suave); }
    .rec--aviso { background:var(--aviso-suave); }
    .rec--ok { background:var(--ok-suave); }
    .rec--info { background:var(--info-suave); }
    .rec .rotulo { margin:0 0 var(--sp-1); font-size:var(--fs-sm); color:var(--texto-tenue); font-weight:700; }
    .rec .titulo { margin:0 0 var(--sp-1); }
    .rec .titulo .etiqueta { font-size:var(--fs-base); }
    .rec .texto { margin:0 0 var(--sp-2); }
    .rec .tambien { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-2); align-items:center; margin:0 0 var(--sp-2); font-size:var(--fs-sm); }
    .rec .nota { margin:0; font-size:var(--fs-sm); color:var(--texto-tenue); }

    ul.lista { list-style:none; margin:0; padding:0; display:grid; gap:var(--sp-2); }
    ul.disc { gap:2px; grid-template-columns:fit-content(9.5rem) minmax(0, 1fr); }
    ul.disc li { grid-column:1 / -1; display:grid; grid-template-columns:subgrid; gap:0 var(--sp-3); align-items:start; padding:var(--sp-1) var(--sp-2); border-radius:var(--r-sm); background:var(--superficie-2); }
    ul.disc li.critica { background:var(--peligro-suave); }
    ul.disc .etiqueta { grid-row:1 / span 2; justify-self:start; white-space:normal; max-width:100%; }
    ul.disc .titulo { grid-column:2; font-weight:700; overflow-wrap:break-word; }
    ul.disc .exp { grid-column:2; font-size:var(--fs-sm); color:var(--texto); overflow-wrap:break-word; }
    @container rev (max-width: 24rem) {
      ul.disc { grid-template-columns:minmax(0, 1fr); }
      ul.disc li { grid-template-columns:minmax(0, 1fr); }
      ul.disc .etiqueta { grid-row:auto; } ul.disc .titulo, ul.disc .exp { grid-column:1; }
    }

    dl.campos { margin:0; display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit, minmax(10.5rem, 1fr)); }
    dl.campos > div { min-width:0; }
    dt { font-size:var(--fs-sm); color:var(--texto-tenue); }
    dd { margin:0; font-weight:600; overflow-wrap:break-word; font-variant-numeric:tabular-nums; }
    dd .fuente { font-weight:400; color:var(--texto-tenue); font-size:var(--fs-sm); }
    .vigencia { margin:var(--sp-2) 0 var(--sp-3); font-size:var(--fs-sm); }
    .vigencia.vencido { background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); }

    .par { display:grid; gap:var(--sp-4); grid-template-columns:minmax(0, 1fr); }
    @container rev (min-width: 46rem) { .par { grid-template-columns:minmax(0, 3fr) minmax(0, 2fr); align-items:start; } .par .dos { grid-template-columns:minmax(0, 1fr); } }
    .dos { display:grid; gap:var(--sp-3) var(--sp-4); grid-template-columns:repeat(auto-fit, minmax(11rem, 1fr)); }
    .dos h4 { margin:0 0 var(--sp-1); font-size:var(--fs-base); }
    .dos dl { margin:var(--sp-2) 0 0; display:grid; gap:var(--sp-1); font-size:var(--fs-sm); }
    .dos dl > div { display:flex; gap:var(--sp-2); flex-wrap:wrap; }
    .dos dt { font-size:var(--fs-sm); }
    .dos dd { font-weight:400; }
    .dos p { margin:var(--sp-2) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }

    /* ── Zona secundaria ── */
    .secundaria { padding-top:var(--sp-3); border-top:1px solid var(--borde); display:grid; gap:var(--sp-4); grid-template-columns:minmax(0, 1fr); }
    @container rev (min-width: 30rem) { .secundaria { grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); align-items:start; } .secundaria .ancho { grid-column:1 / -1; } }
    ul.versiones { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:var(--sp-2); }
    ul.versiones li { display:inline-flex; align-items:center; gap:var(--sp-1); padding:2px var(--sp-3); border-radius:999px; background:var(--superficie-2); font-size:var(--fs-sm); font-weight:700; min-height:32px; }
    ul.versiones li.vigente { background:var(--ok-suave); color:var(--ok); }
    .nota-ver { margin:var(--sp-2) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }
    details.evid { margin-top:var(--sp-3); }
    details.evid summary { cursor:pointer; font-size:var(--fs-sm); font-weight:700; min-height:36px; display:flex; align-items:center; width:fit-content; }
    details.evid ul { margin-top:var(--sp-2); font-size:var(--fs-sm); }
    details.evid li { display:flex; flex-wrap:wrap; gap:0 var(--sp-2); overflow-wrap:break-word; }
    /* Banda de tiempos: una línea de pares etiqueta/valor, no una tarjeta. */
    .tiempos { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-5); margin:0; padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); background:var(--superficie-2); }
    .tiempos > div { min-width:0; display:grid; gap:0; }
    .tiempos dt { font-size:var(--fs-xs); line-height:1.3; }
    .tiempos dd { font-weight:700; font-size:var(--fs-sm); white-space:nowrap; }
    .retencion { font-size:var(--fs-xs); color:var(--texto-tenue); margin:var(--sp-1) 0 0; }

    /* ── Acciones: siempre al alcance cuando se termina de revisar ── */
    .barra-decision {
      margin-top:var(--sp-4); padding:var(--sp-3) 0 0; border-top:1px solid var(--borde); background:var(--superficie);
      display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center; z-index:6;
    }
    .barra-decision .pista { margin:0; flex:1 1 16rem; font-size:var(--fs-sm); }
    .barra-decision .rechazar { margin-left:auto; }
    @media (width >= 1024px) { .barra-decision { position:sticky; bottom:0; padding-bottom:var(--sp-3); } }
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
          <h2>{{ d.caso.estudiante.nombre }}</h2>
          <p class="meta">
            {{ d.caso.estudiante.documento ?? d.caso.estudiante.documentoEnmascarado }} · {{ d.caso.programa }} · {{ d.caso.modalidad }} · {{ d.caso.periodo }}
            · versión {{ d.caso.version }} de {{ d.caso.totalVersiones }}
          </p>
          <div class="estados">
            <span class="etiqueta etiqueta--icono etiqueta--{{ reserva(d).tono }}"><span aria-hidden="true">{{ reserva(d).icono }}</span> {{ reserva(d).texto }}</span>
            @if (d.acceso.esMia && d.acceso.reserva.hasta) { <span class="pista" aria-live="off" style="margin:0">{{ restante(d) }}</span> }
            <span class="etiqueta etiqueta--neutra" [attr.title]="d.prioridad.razones.join(' · ')">Prioridad {{ d.prioridad.puntaje }} pts</span>
          </div>
        </div>
        <div class="acciones">
          @if (d.acceso.reserva.estado === 'libre' || d.acceso.reserva.estado === 'vencida') {
            <button type="button" class="boton boton--primario compacto" [disabled]="estado.ocupado() || !d.caso.esVersionVigente" (click)="estado.tomar()">Tomar el caso</button>
          }
          @if (d.acceso.esMia) {
            <button type="button" class="boton compacto" [disabled]="estado.ocupado()" (click)="estado.liberar()">Liberar el caso</button>
          }
          @if (!d.acceso.esMia && d.acceso.reserva.estado === 'ajena' && estado.esSupervisor()) {
            <button type="button" class="boton compacto" [disabled]="estado.ocupado()" (click)="estado.liberar()">Liberar la reserva de otra persona</button>
          }
          <button type="button" class="boton compacto" [disabled]="estado.cargandoDetalle()" (click)="estado.refrescarDetalle()">Actualizar</button>
        </div>
      </header>

      @if (!d.caso.esVersionVigente) {
        <div class="aviso" role="status"><strong>No es la versión vigente.</strong> El estudiante volvió a enviar el certificado. Trabaje sobre la versión más reciente; esta se muestra solo como historia.</div>
      }
      @if (estado.reservaVencidaEnPantalla()) {
        <div class="aviso peligro" role="alert"><strong>Su reserva venció.</strong> Tome el caso de nuevo para seguir trabajando; mientras tanto no puede decidir.</div>
      }
      @if (d.acceso.motivoSinAcceso) { <div class="aviso" role="status">{{ d.acceso.motivoSinAcceso }}</div> }

      <div class="est">
        <section class="col-cert" aria-labelledby="p-cert">
          <h3 id="p-cert" class="sr-only">Certificado</h3>
          <sipra-eps-visor [validacionId]="d.caso.validacionId" [meta]="d.certificado" [habilitado]="d.acceso.puedeVerValores" (actividad)="estado.renovarSiHaceFalta()" />
        </section>

        <div class="col-rev">
          <section class="rec rec--{{ recomendacion(d).tono }}" aria-labelledby="p-rec">
            <p class="rotulo" id="p-rec">Recomendación del sistema</p>
            <p class="titulo">
              <span class="etiqueta etiqueta--icono etiqueta--{{ recomendacion(d).tono }}"><span aria-hidden="true">{{ recomendacion(d).icono }}</span> {{ d.recomendacion.titulo }}</span>
            </p>
            <p class="texto">{{ d.recomendacion.explicacion }}</p>
            @if (d.recomendacion.tambien.length > 0) {
              <p class="tambien">
                <strong>También aplica:</strong>
                @for (t of d.recomendacion.tambien; track t.codigo) {
                  <span class="etiqueta etiqueta--icono etiqueta--{{ rotuloRecomendacion(t.codigo).tono }}"><span aria-hidden="true">{{ rotuloRecomendacion(t.codigo).icono }}</span> {{ t.titulo }}</span>
                }
              </p>
            }
            <p class="nota">Es una ayuda para quien revisa: no es una decisión. La decisión final es de una persona.</p>
          </section>

          <section class="sec" aria-labelledby="p-disc">
            <h3 id="p-disc">Discrepancias</h3>
            @if (d.discrepancias.length === 0) { <p class="pista">No se encontraron discrepancias.</p> }
            @else {
              <ul class="lista disc">
                @for (x of d.discrepancias; track $index) {
                  <li [class.critica]="x.severidad === 'critica'">
                    <span class="etiqueta etiqueta--icono etiqueta--{{ severidad(x.severidad).tono }}"><span aria-hidden="true">{{ severidad(x.severidad).icono }}</span> {{ severidad(x.severidad).texto }}</span>
                    <span class="titulo">{{ x.titulo }}</span>
                    <span class="exp">{{ x.explicacion }}</span>
                  </li>
                }
              </ul>
            }
          </section>

          <div class="par">
          <section class="sec" aria-labelledby="p-dat">
            <h3 id="p-dat">Datos extraídos del certificado</h3>
            @if (d.certificado.lectura.estado !== 'leida') {
              <p class="sin-lectura aviso" [class.peligro]="d.certificado.lectura.estado !== 'pendiente'" role="status" [attr.data-lectura]="d.certificado.lectura.estado">
                <strong>{{ tituloLectura(d.certificado.lectura.estado) }}.</strong>
                {{ d.certificado.lectura.motivo }}
              </p>
            } @else if (d.certificado.vigencia === 'vencido') {
              <p class="vigencia vencido" role="status" data-vigencia="vencido">
                <strong>CERTIFICADO VENCIDO</strong> · expedido el {{ fechaIso(d.certificado.vigenciaDetalle.fechaExpedicion) }}
                @if (d.certificado.vigenciaDetalle.diasTranscurridos !== null) { (hace {{ d.certificado.vigenciaDetalle.diasTranscurridos }} días) }
                @if (d.certificado.vigenciaDetalle.diasVigencia !== null) { · regla institucional: no más de {{ d.certificado.vigenciaDetalle.diasVigencia }} días }
              </p>
            } @else if (d.certificado.vigencia === 'vigente') {
              <p class="vigencia" data-vigencia="vigente">Vigente: expedido el {{ fechaIso(d.certificado.vigenciaDetalle.fechaExpedicion) }}@if (d.certificado.vigenciaDetalle.diasTranscurridos !== null) { (hace {{ d.certificado.vigenciaDetalle.diasTranscurridos }} días) }.</p>
            } @else {
              <p class="vigencia" data-vigencia="no_determinada">Vigencia no determinada: no se pudo leer la fecha de expedición (generación).</p>
            }
            @if (d.certificado.lectura.estado !== 'leida') {
              <!-- Sin lectura no hay campos ni «método de lectura» que mostrar: «—» en todo sería un resultado inventado. -->
            } @else if (!d.acceso.puedeVerValores) {
              <p class="pista">Los datos personales se muestran cuando usted tiene el caso tomado.</p>
            } @else {
              <dl class="campos">
                @for (c of d.certificado.campos; track c.campo) {
                  <div>
                    <dt>{{ c.etiqueta }}</dt>
                    <dd>{{ c.campo === 'fecha_expedicion' ? fechaIso(c.valor) : (c.valor ?? '—') }}@if (c.fuente && c.fuente !== fuentePredominante(d)) { <span class="fuente"> ({{ fuenteCampo(c.fuente) }})</span> }</dd>
                  </div>
                }
              </dl>
              <p class="pista" style="margin:var(--sp-2) 0 0">Método de lectura: {{ metodo(d.certificado.metodoExtraccion) }}</p>
            }
          </section>

          <section class="sec" aria-label="Autenticidad y afiliación">
            <div class="dos">
              <div>
                <h4>Autenticidad</h4>
                <span class="etiqueta etiqueta--icono etiqueta--{{ autenticidad(d).tono }}"><span aria-hidden="true">{{ autenticidad(d).icono }}</span> {{ autenticidad(d).texto }}</span>
                <dl>
                  <div><dt>Verificador:</dt><dd>{{ d.autenticidad.verificador ?? 'ninguno habilitado' }}</dd></div>
                  @if (d.autenticidad.verificadoEn) { <div><dt>Verificada el</dt><dd>{{ fecha(d.autenticidad.verificadoEn) }}</dd></div> }
                </dl>
                <p>{{ d.autenticidad.explicacion }}</p>
              </div>
              <div>
                <h4>Afiliación</h4>
                <span class="etiqueta etiqueta--icono etiqueta--{{ afiliacion(d).tono }}"><span aria-hidden="true">{{ afiliacion(d).icono }}</span> {{ afiliacion(d).texto }}</span>
                <dl>
                  <div><dt>Fuente:</dt><dd>{{ fuenteAfiliacion(d.afiliacion.fuente) }}</dd></div>
                  @if (d.afiliacion.consultadoEn) { <div><dt>Consultada el</dt><dd>{{ fecha(d.afiliacion.consultadoEn) }}</dd></div> }
                  @if (d.afiliacion.fuenteActualizadaEn) { <div><dt>Fuente actualizada el</dt><dd>{{ fecha(d.afiliacion.fuenteActualizadaEn) }}</dd></div> }
                </dl>
                @if (d.afiliacion.frescura.diasDesdeConsulta !== null) {
                  <p>Consulta a ADRES realizada {{ d.afiliacion.frescura.diasDesdeConsulta === 0 ? 'hoy' : 'hace ' + d.afiliacion.frescura.diasDesdeConsulta + (d.afiliacion.frescura.diasDesdeConsulta === 1 ? ' día' : ' días') }}.</p>
                }
                @if (!d.afiliacion.frescura.politicaDefinida) {
                  <p>Frescura de ADRES pendiente de definición del proceso: SIPRA no da por vencido ningún resultado.</p>
                } @else if (d.afiliacion.frescura.vencida) {
                  <p class="aviso" role="status" style="margin-top:var(--sp-2)">La consulta a ADRES tiene más de {{ d.afiliacion.frescura.dias }} días. Considere repetirla.</p>
                }
              </div>
            </div>
          </section>
          </div>

          <section class="sec" aria-labelledby="p-cmp">
            <h3 id="p-cmp">Comparación SIPRA · certificado · ADRES</h3>
            @if (d.comparacion.length === 0) { <p class="pista">Todavía no hay datos para comparar.</p> }
            @else { <sipra-eps-comparacion [filas]="d.comparacion" [valores]="d.acceso.puedeVerValores" /> }
          </section>

          <section class="sec" aria-labelledby="p-adres">
            <h3 id="p-adres">Consulta ADRES</h3>
            <sipra-eps-adres
              [validacionId]="d.caso.validacionId" [estado]="d.adres.estado" [errorPrevio]="d.adres.error"
              [puedeConsultar]="d.acceso.puedeConsultarAdres && estado.puedeActuar()"
              (cambio)="estado.refrescarDetalle()" />
          </section>

      <div class="secundaria">
        <section class="sec" aria-labelledby="p-ver">
          <h3 id="p-ver">Versiones y evidencia</h3>
          <ul class="versiones">
            @for (v of d.versiones; track v.documentoId) {
              <li [class.vigente]="v.esVigente" [attr.title]="fecha(v.cargadoEn) + ' · ' + v.estado"
                  [attr.aria-label]="'Versión ' + v.version + (v.esVigente ? ', vigente' : '') + (v.esEsta ? ', la que está en pantalla' : '') + ', cargada ' + fecha(v.cargadoEn) + ', estado ' + v.estado">
                v{{ v.version }}@if (v.esVigente) { <span> · vigente</span> }@if (v.esEsta) { <span aria-hidden="true"> ●</span> }
              </li>
            }
          </ul>
          <p class="nota-ver">El punto ● marca la versión que está en pantalla.</p>
          <details class="evid">
            <summary>Evidencia registrada ({{ d.evidencias.length }})</summary>
            @if (d.evidencias.length === 0) { <p class="pista">Sin evidencias registradas.</p> }
            @else {
              <ul class="lista">
                @for (v of d.evidencias; track v.id) {
                  <li><strong>{{ v.tipo }}</strong> <span>{{ v.fuente }}</span> <span>· {{ v.resultado }}@if (v.error) { · {{ v.error }} }</span> <span class="pista" style="margin:0">· {{ fecha(v.fecha) }}</span></li>
                }
              </ul>
            }
          </details>
        </section>

        <section class="sec" aria-labelledby="p-his">
          <h3 id="p-his">Historial</h3>
          <sipra-eps-historial [eventos]="d.historial" />
        </section>

        <section class="sec ancho" aria-labelledby="p-met">
          <h3 id="p-met" class="sr-only">Tiempos</h3>
          <dl class="tiempos">
            <div><dt>Recibido</dt><dd>{{ dia(d.metricas.recibidaEn) }}</dd></div>
            <div><dt>Primera revisión</dt><dd>{{ dia(d.metricas.primeraRevisionEn) }}</dd></div>
            <div><dt>Decidido</dt><dd>{{ dia(d.metricas.decididoEn) }}</dd></div>
            <div><dt>Tiempo</dt><dd>{{ d.metricas.horasHastaDecision !== null ? d.metricas.horasHastaDecision + ' h' : '—' }}</dd></div>
            <div><dt>Reenvíos</dt><dd>{{ d.metricas.reenvios }}</dd></div>
            <div [attr.title]="d.prioridad.razones.join(' · ')"><dt>Prioridad</dt><dd>{{ d.prioridad.puntaje }} pts</dd></div>
          </dl>
          @if (d.prioridad.razones.length) { <p class="retencion">Prioridad: {{ d.prioridad.razones.join(' · ') }}</p> }
          <p class="retencion">{{ d.retencion }}</p>
        </section>
      </div>
        </div>
      </div>

      <div class="barra-decision decisiones" role="group" aria-label="Decisión sobre el certificado">
        <button type="button" class="boton boton--primario" [disabled]="!puedeDecidir()" (click)="decision.abrir('aprobar')">Aprobar</button>
        <button type="button" class="boton" [disabled]="!puedeDecidir()" (click)="decision.abrir('devolver')">Devolver al estudiante</button>
        <button type="button" class="boton boton--peligro rechazar" [disabled]="!puedeDecidir()" (click)="decision.abrir('rechazar')">Rechazar</button>
        @if (!puedeDecidir()) { <span class="pista">Para decidir debe tener el caso tomado, con la reserva vigente y la versión vigente del certificado.</span> }
      </div>

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

  reserva(d: Detalle) {
    const estado = this.estado.reservaVencidaEnPantalla() ? 'vencida' : d.acceso.reserva.estado;
    return ESTADO_RESERVA[estado];
  }
  restante(d: Detalle): string {
    const t = textoRestante(d.acceso.reserva.hasta, this.estado.ahora());
    return t === 'venció' ? 'venció' : `le quedan ${t}`;
  }
  autenticidad(d: Detalle) { return AUTENTICIDAD[d.autenticidad.estado] ?? AUTENTICIDAD['no_evaluada']; }
  afiliacion(d: Detalle) { return AFILIACION[d.afiliacion.estado] ?? AFILIACION['no_contrastada']; }
  recomendacion(d: Detalle) { return RECOMENDACION[d.recomendacion.codigo] ?? RECOMENDACION['informacion_insuficiente']; }
  rotuloRecomendacion(codigo: string) { return RECOMENDACION[codigo] ?? RECOMENDACION['informacion_insuficiente']; }
  severidad(s: string) { return SEVERIDAD_DISCREPANCIA[s] ?? SEVERIDAD_DISCREPANCIA['informativa']; }
  fechaIso(iso: string | null): string { return fechaIso(iso); }
  fuenteAfiliacion(f: string): string { return FUENTE_AFILIACION[f] ?? f; }
  fuenteCampo(f: string): string { return FUENTE_CAMPO[f] ?? f; }
  tituloLectura(estado: string): string {
    return ({ pendiente: 'Procesamiento pendiente', fallida: 'Procesamiento fallido', sin_lectura: 'Certificado sin lectura' } as Record<string, string>)[estado] ?? 'Certificado sin lectura';
  }
  metodo(m: string): string { return METODO_EXTRACCION[m] ?? m; }
  fecha(iso: string | null): string { return fechaCorta(iso); }
  dia(iso: string | null): string { return diaCorto(iso); }

  /** La fuente que más campos aportó: solo se destaca la de los campos que vienen de otra. */
  fuentePredominante(d: Detalle): string | null {
    const cuenta = new Map<string, number>();
    for (const c of d.certificado.campos) if (c.fuente && c.valor !== null) cuenta.set(c.fuente, (cuenta.get(c.fuente) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
}
