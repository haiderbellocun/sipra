import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ItemExpediente } from '@core/models/validacion-documental.model';
import { VdActaComponent, VdCamaraComponent, VdEpsComponent, VdGeneralComponent, VdRutComponent } from './vd-motores.component';
import { VdSupervisionComponent } from './vd-supervision.component';
import { ValidacionDocumentalEstado } from './vd.estado';
import {
  NOMBRE_MOTOR, contadoresExpediente, etiquetaProgreso, filtrosAvanzadosActivos, rotuloEstado, textoChip, textoProgreso, textoReservaDocumento, textoTrabajando,
} from './vd.util';

const CLAVE_ANCHO_COLA = 1500;

/**
 * Mesa de Validación Documental. La entidad operativa es ESTUDIANTE + PRÁCTICA: la persona abre un expediente y revisa su paquete
 * completo en el mismo lugar. La pantalla solo ORQUESTA: la cola, el progreso y los estados humanos los entrega la API (que consulta
 * a los motores); el resultado, la reserva y la decisión de cada documento los resuelve el componente de SU motor. Las Mesas
 * especializadas siguen existiendo para diagnóstico, soporte y supervisión.
 */
@Component({
  selector: 'sipra-validacion-documental',
  standalone: true,
  imports: [FormsModule, VdEpsComponent, VdActaComponent, VdRutComponent, VdCamaraComponent, VdGeneralComponent, VdSupervisionComponent],
  providers: [ValidacionDocumentalEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cab { display:flex; gap:var(--sp-2) var(--sp-4); justify-content:space-between; align-items:center; flex-wrap:wrap; }
    .cab > div:first-child { flex:1 1 24rem; min-width:0; } .cab h1, .cab p { margin:0; }
    .kpis { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-2); margin:var(--sp-2) 0; align-items:center; }
    .kpi { display:flex; align-items:baseline; gap:var(--sp-1); text-align:left; white-space:nowrap; border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie); padding:var(--sp-1) var(--sp-2); cursor:pointer; color:inherit; font:inherit; }
    .kpi:hover { background:var(--superficie-2); } .kpi[aria-pressed='true'] { border-color:var(--marca); background:var(--marca-suave); }
    .kpi .n { font-size:1.125rem; font-weight:700; font-variant-numeric:tabular-nums; } .kpi .t { font-size:var(--fs-xs); color:var(--texto-tenue); }
    .info-kpi { font-size:var(--fs-sm); color:var(--texto-tenue); padding-inline:var(--sp-2); }
    .filtros { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); align-items:end; margin-bottom:var(--sp-3); }
    .filtros .campo { margin:0; } .filtros .buscar { grid-column:span 2; }
    @media (width < 520px) { .filtros .buscar { grid-column:1 / -1; } }
    .mas { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); align-items:end; margin:0 0 var(--sp-3); }
    .mas[hidden] { display:none; } .mas .campo { margin:0; }
    .marcas { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-3); }
    .marcas label { display:inline-flex; gap:var(--sp-1); align-items:center; }
    .cuerpo { display:grid; gap:var(--sp-3); grid-template-columns:minmax(0,1fr); align-items:start; --sticky-top:calc(var(--alto-cinta, 0px) + 62px + 12px); }
    .panel { min-width:0; padding:var(--sp-3); }
    @media (width < 600px) { .panel { padding:var(--sp-2); } }
    @media (width >= 1200px) {
      .cuerpo { grid-template-columns:clamp(280px,21vw,360px) clamp(250px,19vw,320px) minmax(0,1fr); }
      .cuerpo.cola-no { grid-template-columns:clamp(250px,19vw,320px) minmax(0,1fr); } .cuerpo.cola-no .p-cola { display:none; }
      .cuerpo.sin-exp { grid-template-columns:clamp(300px,28vw,420px) minmax(0,1fr); }
      .p-cola, .p-exp { position:sticky; top:var(--sticky-top); max-height:calc(100dvh - var(--sticky-top) - 16px); overflow:auto; }
      .solo-estrecho { display:none !important; }
    }
    @media (width >= 900px) and (width < 1200px) {
      .cuerpo.v-expediente, .cuerpo.v-documento { grid-template-columns:minmax(220px,260px) minmax(0,1fr); }
      .cuerpo.v-cola .p-exp, .cuerpo.v-cola .p-doc { display:none; }
      .cuerpo.v-expediente .p-cola, .cuerpo.v-documento .p-cola { display:none; }
      .cuerpo.v-cola .p-vacio { display:none; }
    }
    @media (width < 900px) {
      .cuerpo.v-cola .p-exp, .cuerpo.v-cola .p-doc, .cuerpo.v-cola .p-vacio { display:none; }
      .cuerpo.v-expediente .p-cola, .cuerpo.v-expediente .p-doc, .cuerpo.v-documento .p-cola, .cuerpo.v-documento .p-exp { display:none; }
    }
    .p-vacio { display:none; }
    @media (width >= 1200px) { .p-vacio { display:block; } .cuerpo:not(.sin-exp) .p-vacio { display:none; } }
    .lista { list-style:none; margin:0; padding:0; }
    .exp { display:block; width:100%; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--borde); padding:var(--sp-2) var(--sp-1); cursor:pointer; color:inherit; font:inherit; line-height:1.3; min-height:44px; }
    .exp:hover { background:var(--superficie-2); } .exp[aria-current='true'] { background:var(--marca-suave); }
    .exp .n { display:block; font-weight:700; overflow-wrap:anywhere; }
    .exp .sub { display:block; font-size:var(--fs-sm); color:var(--texto-tenue); overflow-wrap:anywhere; }
    .progreso { display:flex; align-items:center; gap:var(--sp-2); margin:var(--sp-1) 0; font-size:var(--fs-sm); font-weight:600; }
    .barra { flex:1 1 auto; height:6px; background:var(--superficie-2); border:1px solid var(--borde); border-radius:999px; overflow:hidden; min-width:60px; }
    .barra > span { display:block; height:100%; background:var(--marca); }
    .chips { list-style:none; margin:var(--sp-1) 0 0; padding:0; display:flex; flex-direction:column; gap:2px; font-size:var(--fs-xs); }
    .chips li { display:flex; gap:var(--sp-1); align-items:baseline; overflow-wrap:anywhere; }
    .chips .i { width:1.1em; text-align:center; flex:0 0 auto; }
    .t-ok { color:var(--ok, #1a7f4b); } .t-aviso { color:var(--aviso); } .t-peligro { color:var(--peligro); } .t-info { color:var(--marca); } .t-neutra { color:var(--texto-tenue); }
    .ind { font-size:var(--fs-xs); margin-top:3px; color:var(--texto-tenue); } .ind strong { color:var(--peligro); }
    .enc h2 { margin:0; overflow-wrap:anywhere; }
    .enc dl { display:grid; grid-template-columns:max-content 1fr; gap:2px var(--sp-3); margin:var(--sp-2) 0; font-size:var(--fs-sm); }
    .enc dt { color:var(--texto-tenue); } .enc dd { margin:0; overflow-wrap:anywhere; }
    .contadores { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-3); font-size:var(--fs-sm); margin:var(--sp-1) 0 var(--sp-2); }
    .doc { display:block; width:100%; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--borde); padding:var(--sp-2) var(--sp-1); cursor:pointer; color:inherit; font:inherit; line-height:1.3; min-height:44px; }
    .doc:hover { background:var(--superficie-2); } .doc[aria-current='true'] { background:var(--marca-suave); }
    .doc .est { display:flex; gap:var(--sp-1); align-items:baseline; font-weight:600; }
    .doc .nom { display:block; overflow-wrap:anywhere; } .doc .meta { display:block; font-size:var(--fs-xs); color:var(--texto-tenue); overflow-wrap:anywhere; }
    .doc .prob { display:block; font-size:var(--fs-xs); color:var(--aviso); overflow-wrap:anywhere; }
    .nav { display:flex; flex-wrap:wrap; gap:var(--sp-2); align-items:center; margin-bottom:var(--sp-3); }
    .nav .sep { flex:1 1 auto; }
    .aviso-doc { background:var(--superficie-2); border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); }
    .error { background:var(--peligro-suave); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); }
    .versiones { margin-top:var(--sp-3); } .versiones ul { margin:var(--sp-1) 0 0; padding-left:var(--sp-4); font-size:var(--fs-sm); }
    .doc-cuerpo { min-width:0; }
    .solo-estrecho { display:inline-flex; }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>Validación documental</h1>
        <p class="pista">Revise el paquete documental completo de cada estudiante desde un solo lugar. Cada documento lo valida y lo decide su motor; aquí solo se ordena y se muestra.</p>
      </div>
      <div class="acciones">
        <button type="button" class="boton compacto" [disabled]="estado.cargando()" (click)="estado.cargar()">Actualizar</button>
        @if (estado.esSupervisor()) {
          <button type="button" class="boton compacto" [attr.aria-expanded]="supervisionAbierta()" (click)="alternarSupervision()">{{ supervisionAbierta() ? 'Ocultar supervisión' : 'Supervisión' }}</button>
        }
      </div>
    </div>

    @if (supervisionAbierta()) {
      <div class="tarjeta" style="margin:var(--sp-2) 0"><sipra-vd-supervision (abrir)="abrirDesdeSupervision($event)" /></div>
    }

    @if (estado.listado(); as l) {
      <div class="kpis" role="group" aria-label="Indicadores de la cola">
        <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'todos'" (click)="estado.elegirVista('todos')"><span class="n">{{ l.kpis.expedientes }}</span><span class="t">Expedientes</span></button>
        <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'pendientes'" (click)="estado.elegirVista('pendientes')"><span class="n">{{ l.kpis.conPendientes }}</span><span class="t">Con pendientes</span></button>
        <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'problemas'" (click)="estado.elegirVista('problemas')"><span class="n">{{ l.kpis.conProblemas }}</span><span class="t">Con problemas</span></button>
        <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'mis_documentos'" (click)="estado.elegirVista('mis_documentos')"><span class="n">{{ l.kpis.misDocumentos }}</span><span class="t">Mis documentos</span></button>
        <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'por_vencer'" (click)="estado.elegirVista('por_vencer')"><span class="n">{{ l.kpis.reservasPorVencer }}</span><span class="t">Reservas por vencer</span></button>
        <span class="info-kpi" data-por-revisar>{{ l.kpis.documentosPorRevisar }} documento(s) por revisar</span>
      </div>
    }

    <div class="filtros" role="search" aria-label="Filtros de la cola">
      <div class="campo buscar"><label for="vd-buscar">Buscar estudiante</label><input id="vd-buscar" type="search" autocomplete="off" [ngModel]="filtros().buscar ?? ''" (ngModelChange)="estado.buscar($event)" /></div>
      <div class="campo"><label for="vd-estado">Estado del expediente</label>
        <select id="vd-estado" [ngModel]="filtros().estado ?? ''" (ngModelChange)="estado.aplicarFiltros({ estado: $event })">
          <option value="">Todos</option><option value="abiertos">Abiertos</option><option value="completos">Con la documentación completa</option>
        </select></div>
      <div class="campo"><label for="vd-reserva">Reservas</label>
        <select id="vd-reserva" [ngModel]="filtros().reserva ?? ''" (ngModelChange)="estado.aplicarFiltros({ reserva: $event })">
          <option value="">Todas</option><option value="mias">Reservados por mí</option><option value="libres">Sin reserva</option>
        </select></div>
      <div class="campo"><button type="button" class="boton compacto" [attr.aria-expanded]="masAbierto()" (click)="masAbierto.set(!masAbierto())">Más filtros@if (avanzados() > 0) { ({{ avanzados() }}) }</button></div>
    </div>
    <div class="mas" [hidden]="!masAbierto()">
      <div class="campo"><label for="vd-escuela">Escuela</label>
        <select id="vd-escuela" [ngModel]="filtros().escuela ?? ''" (ngModelChange)="estado.aplicarFiltros({ escuela: $event })">
          <option value="">Todas</option>@for (e of escuelas(); track e) { <option [value]="e">{{ e }}</option> }
        </select></div>
      <div class="campo"><label for="vd-modalidad">Modalidad</label>
        <select id="vd-modalidad" [ngModel]="filtros().modalidad ?? ''" (ngModelChange)="estado.aplicarFiltros({ modalidad: $event })">
          <option value="">Todas</option>@for (m of modalidades(); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }
        </select></div>
      <div class="campo"><label for="vd-antig">Esperando revisión desde hace</label>
        <select id="vd-antig" [ngModel]="filtros().antiguedadMinDias ?? ''" (ngModelChange)="estado.aplicarFiltros({ antiguedadMinDias: $event })">
          <option value="">Cualquier tiempo</option><option value="1">1 día o más</option><option value="3">3 días o más</option><option value="7">7 días o más</option>
        </select></div>
      <fieldset class="marcas" style="border:0;padding:0;margin:0"><legend class="pista">Solo expedientes</legend>
        <label><input type="checkbox" [checked]="filtros().conPendientes === 'si'" (change)="estado.aplicarFiltros({ conPendientes: marcado($event) })" /> con pendientes</label>
        <label><input type="checkbox" [checked]="filtros().conDiscrepancias === 'si'" (change)="estado.aplicarFiltros({ conDiscrepancias: marcado($event) })" /> con discrepancias</label>
        <label><input type="checkbox" [checked]="filtros().conDevueltos === 'si'" (change)="estado.aplicarFiltros({ conDevueltos: marcado($event) })" /> con devueltos</label>
        <label><input type="checkbox" [checked]="filtros().ocr === 'si'" (change)="estado.aplicarFiltros({ ocr: marcado($event) })" /> con OCR o información insuficiente</label>
      </fieldset>
      <div class="campo"><button type="button" class="boton compacto" (click)="estado.limpiarFiltros()">Limpiar filtros</button></div>
    </div>

    <div class="cuerpo v-{{ estado.vista() }}" [class.sin-exp]="!estado.practicaId()" [class.cola-no]="!!estado.practicaId() && !estado.colaVisible()">
      <!-- COLA DE EXPEDIENTES -->
      <section class="tarjeta panel p-cola" aria-labelledby="vd-cola-titulo">
        <h2 id="vd-cola-titulo" style="margin:0 0 var(--sp-2)">Expedientes <span class="pista" role="status">({{ estado.items().length }})</span></h2>
        @if (estado.errorListado(); as e) { <div class="error" role="alert">{{ e }} <button type="button" class="boton compacto" (click)="estado.cargar()">Reintentar</button></div> }
        @if (estado.cargando() && !estado.listado()) { <p class="pista">Cargando expedientes…</p> }
        @else if (estado.items().length === 0) { <p class="pista">No hay expedientes con estos filtros.</p> }
        @else {
          <ul class="lista">
            @for (x of estado.items(); track x.practicaId) {
              <li>
                <button type="button" class="exp" data-vd-expediente [attr.data-practica]="x.practicaId" [attr.aria-current]="estado.practicaId() === x.practicaId" (click)="abrir(x)">
                  <span class="n">{{ x.estudiante.nombre }}</span>
                  <span class="sub">{{ x.estudiante.documentoEnmascarado }} · {{ x.modalidadEtiqueta }} · {{ x.escuelaId }}</span>
                  @if (x.empresa) { <span class="sub">{{ x.empresa }}</span> }
                  <span class="progreso"><span>{{ progreso(x) }}</span><span class="barra" aria-hidden="true"><span [style.width.%]="x.progreso.porcentaje"></span></span></span>
                  <ul class="chips" aria-label="Documentos del expediente">
                    @for (d of x.documentos; track d.tipoDocumento) {
                      <li><span class="i t-{{ rotulo(d.estadoHumano).tono }}" aria-hidden="true">{{ rotulo(d.estadoHumano).icono }}</span><span>{{ chip(d) }}</span></li>
                    }
                  </ul>
                  @if (x.indicadores.criticos + x.indicadores.informacionInsuficiente + x.indicadores.reenvios > 0) {
                    <span class="ind"><strong>{{ x.indicadores.criticos }}</strong> crítico(s) · {{ x.indicadores.informacionInsuficiente }} OCR / información insuficiente · {{ x.indicadores.reenvios }} reenvío(s)</span>
                  }
                  <span class="ind">@if (x.esperandoDesde) { Esperando revisión hace {{ x.diasEsperando }} día(s) } @else { Sin documentos por revisar }@if (trabajando(x); as t) { · Trabajando: {{ t }} }</span>
                </button>
              </li>
            }
          </ul>
          @if (estado.listado()?.truncado) { <p class="pista">Hay más expedientes: use la búsqueda o los filtros para acotar.</p> }
        }
      </section>

      <!-- EXPEDIENTE Y SUS DOCUMENTOS -->
      @if (estado.practicaId()) {
        <section class="tarjeta panel p-exp" aria-labelledby="vd-exp-titulo">
          <div class="nav" style="margin-bottom:var(--sp-2)">
            <button type="button" class="boton compacto" (click)="cerrar()">← Cola de expedientes</button>
            <button type="button" class="boton compacto" (click)="alternarCola()" [attr.aria-pressed]="estado.colaVisible()">{{ estado.colaVisible() ? 'Ocultar la cola' : 'Mostrar la cola' }}</button>
          </div>
          @if (estado.errorExpediente(); as e) { <div class="error" role="alert">{{ e }}</div> }
          @if (estado.expediente(); as e) {
            <div class="enc">
              <h2 id="vd-exp-titulo">{{ e.encabezado.estudiante.nombre }}</h2>
              <dl>
                <dt>Documento</dt><dd>{{ e.encabezado.estudiante.documentoEnmascarado }}</dd>
                <dt>Modalidad</dt><dd>{{ e.encabezado.modalidadEtiqueta }}</dd>
                <dt>Periodo</dt><dd>{{ e.encabezado.periodo }}</dd>
                <dt>Escuela</dt><dd>{{ e.encabezado.escuelaId }}</dd>
                <dt>Docente</dt><dd>{{ e.encabezado.docente ?? 'Sin asignar' }}</dd>
                <dt>Empresa</dt><dd>{{ e.encabezado.empresa ?? '—' }}</dd>
                <dt>Práctica</dt><dd>{{ e.encabezado.estadoPractica }}</dd>
              </dl>
              <p class="progreso" data-vd-progreso><span>{{ progreso(e) }}</span><span class="barra" role="progressbar" [attr.aria-valuenow]="e.progreso.aprobados" aria-valuemin="0" [attr.aria-valuemax]="e.progreso.total" [attr.aria-label]="progreso(e)"><span [style.width.%]="e.progreso.porcentaje"></span></span></p>
              <p class="pista" style="margin:0" data-vd-etiqueta-progreso>{{ etiquetaProgreso(e.progreso) }}</p>
              <div class="contadores" data-vd-contadores>@for (c of contadores(e.progreso); track c.clave) { <span>{{ c.texto }}: <strong>{{ c.n }}</strong></span> }</div>
            </div>
            <h3 style="margin:var(--sp-2) 0 0">Documentos</h3>
            <ul class="lista" aria-label="Documentos del expediente">
              @for (d of e.documentos; track d.tipoDocumento) {
                <li>
                  <button type="button" class="doc" data-vd-doc [attr.data-tipo]="d.tipoDocumento" [attr.aria-current]="estado.tipoActivo() === d.tipoDocumento" (click)="elegir(d.tipoDocumento)">
                    <span class="est t-{{ rotulo(d.estadoHumano).tono }}"><span aria-hidden="true">{{ rotulo(d.estadoHumano).icono }}</span><span>{{ d.estadoHumanoEtiqueta }}</span></span>
                    <span class="nom">{{ d.nombreHumano }}@if (!d.obligatorio) { <span class="pista"> (adicional)</span> }</span>
                    <span class="meta">{{ motor(d.motor) }}@if (d.version) { · versión {{ d.version }} }@if (d.reserva.estado !== 'libre') { · {{ reserva(d) }} }</span>
                    @if (d.problemaPrincipal) { <span class="prob">{{ d.problemaPrincipal }}</span> }
                  </button>
                </li>
              }
            </ul>
          } @else if (estado.cargandoExpediente()) { <p class="pista">Cargando expediente…</p> }
        </section>

        <!-- DOCUMENTO ACTIVO: visor + resultado + acciones, en el mismo espacio -->
        <section class="tarjeta panel p-doc" aria-label="Documento activo">
          <div class="nav" data-vd-nav>
            <button type="button" class="boton compacto solo-estrecho" (click)="estado.volver()">← Documentos</button>
            <button type="button" class="boton compacto" (click)="estado.navegar('anterior')">Documento anterior</button>
            <button type="button" class="boton compacto" (click)="estado.navegar('siguiente')">Documento siguiente</button>
            <button type="button" class="boton compacto boton--primario" (click)="estado.navegar('pendiente')">Siguiente pendiente</button>
          </div>
          @if (estado.documentoActivo(); as d) {
            <div class="doc-cuerpo">
              @if (d.documentoId === null) {
                <div class="aviso-doc" data-vd-sin-cargar><strong>{{ d.nombreHumano }}</strong>: pendiente de cargar. El estudiante todavía no ha cargado este documento.</div>
              } @else if (d.motor !== 'general' && !d.operable) {
                <div class="aviso-doc" data-vd-sin-permiso role="note">
                  <strong>{{ d.nombreHumano }}</strong> · {{ d.estadoHumanoEtiqueta }}@if (d.version) { · versión {{ d.version }} }<br />
                  Este documento lo revisa y lo decide «{{ motor(d.motor) }}»; su perfil no lo opera, por eso no hay acciones aquí.
                  @if (d.reserva.estado !== 'libre') { <br />{{ reserva(d) }} }
                </div>
              } @else if (d.motor === 'general') {
                <sipra-vd-general [documento]="d" (cambio)="estado.actualizarTrasAccion()" />
              } @else if (!d.validacionId) {
                <div class="aviso-doc" role="status"><strong>{{ d.nombreHumano }}</strong> · {{ d.estadoHumanoEtiqueta }}. El documento todavía no tiene un resultado de validación para mostrar.</div>
              } @else {
                @switch (d.motor) {
                  @case ('eps') { <sipra-vd-eps [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                  @case ('acta') { <sipra-vd-acta [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                  @case ('rut') { <sipra-vd-rut [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                  @case ('camara') { <sipra-vd-camara [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                }
              }
              @if (d.documentoId && d.versionesAnteriores > 0) {
                <div class="versiones" data-vd-versiones>
                  <button type="button" class="boton compacto" (click)="estado.cargarVersiones(d.tipoDocumento)">Ver versiones anteriores ({{ d.versionesAnteriores }})</button>
                  @if (estado.versiones(); as v) {
                    @if (v.tipo === d.tipoDocumento) {
                      <ul>@for (x of v.items; track x.documentoId) { <li>Versión {{ x.version }}{{ x.vigente ? ' (vigente)' : ' (histórica)' }} · {{ x.estadoHumanoEtiqueta }}@if (x.motivoDevolucion) { · {{ x.motivoDevolucion }} }</li> }</ul>
                    }
                  }
                </div>
              }
            </div>
          } @else {
            <p class="pista">Elija un documento de la lista para revisarlo aquí.</p>
          }
        </section>
      } @else {
        <section class="tarjeta panel p-vacio" aria-label="Expediente">
          <p class="pista" style="margin:0">Elija un expediente de la cola para revisar su paquete documental completo. Puede pasar de un documento al siguiente sin volver a buscar al estudiante.</p>
        </section>
      }
    </div>
  `,
})
export class ValidacionDocumentalComponent implements OnInit {
  protected readonly estado = inject(ValidacionDocumentalEstado);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly params = toSignal(this.ruta.paramMap);
  private readonly consulta = toSignal(this.ruta.queryParamMap);

  protected readonly masAbierto = signal(false);
  protected readonly supervisionAbierta = signal(false);
  protected readonly filtros = this.estado.filtros;
  protected readonly vistaActual = computed(() => this.filtros().vista ?? 'todos');
  protected readonly avanzados = computed(() => filtrosAvanzadosActivos(this.filtros()));
  protected readonly escuelas = computed(() => [...new Set(this.estado.items().map((i) => i.escuelaId))].sort());
  protected readonly modalidades = computed(() => [...new Map(this.estado.items().map((i) => [i.modalidad, i.modalidadEtiqueta] as [string, string])).entries()]);

  protected readonly rotulo = rotuloEstado;
  protected readonly motor = (m: string): string => NOMBRE_MOTOR[m] ?? m;
  protected readonly contadores = contadoresExpediente;
  protected readonly etiquetaProgreso = etiquetaProgreso;
  protected readonly chip = textoChip;
  protected readonly progreso = (x: { progreso: { aprobados: number; total: number } }): string => textoProgreso(x.progreso);
  protected readonly trabajando = (x: ItemExpediente): string | null => textoTrabajando(x.funcionariosTrabajando);
  protected reserva(d: { reserva: Parameters<typeof textoReservaDocumento>[0] }): string { return textoReservaDocumento(d.reserva); }

  constructor() {
    // La URL manda: /validacion-documental/:practicaId?doc=<tipo>. La pantalla se sincroniza con ella.
    effect(() => {
      const id = this.params()?.get('practicaId') ?? null;
      const doc = this.consulta()?.get('doc') ?? null;
      untracked(() => {
        if (!id) { if (this.estado.practicaId()) this.estado.cerrarExpediente(); return; }
        if (this.estado.practicaId() !== id) {
          if (typeof window !== 'undefined' && window.innerWidth < CLAVE_ANCHO_COLA) this.estado.colaVisible.set(false);
          void this.estado.abrirExpediente(id, doc);
        } else if (doc && doc !== this.estado.tipoActivo()) {
          this.estado.seleccionarDocumento(doc);
        }
      });
    });
  }

  async ngOnInit(): Promise<void> {
    await this.estado.cargar();
  }

  protected marcado(e: Event): 'si' | '' { return (e.target as HTMLInputElement).checked ? 'si' : ''; }

  protected abrir(x: ItemExpediente): void {
    void this.router.navigate(['/validacion-documental', x.practicaId]);
  }

  protected abrirDesdeSupervision(practicaId: string): void {
    this.supervisionAbierta.set(false);
    void this.router.navigate(['/validacion-documental', practicaId]);
  }

  protected elegir(tipo: string): void {
    this.estado.seleccionarDocumento(tipo);
    void this.router.navigate([], { relativeTo: this.ruta, queryParams: { doc: tipo }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected cerrar(): void {
    this.estado.cerrarExpediente();
    void this.router.navigate(['/validacion-documental']);
  }

  protected alternarCola(): void {
    this.estado.colaVisible.set(!this.estado.colaVisible());
  }

  protected alternarSupervision(): void {
    const abrir = !this.supervisionAbierta();
    this.supervisionAbierta.set(abrir);
    if (abrir) void this.estado.cargarSupervision();
  }
}

