import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { CapturaGuiadaService, EvaluacionCaptura } from '@core/services/captura-guiada.service';
import {
  CampoLectura, Documento, EntradaBitacora, EscribirBitacora, EstadoCierre, EstadoPractica, Practica,
  TipoEntradaBitacora, VacanteEditable,
} from '@core/models/modelos';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';
import { formatearEntero, formatearUsd } from '@shared/utils/moneda';
import { guiaDocumento, lineaVersionAnterior } from './guia-documento';
import { textoBandera } from './banderas';

type Pestana = 'documentos' | 'bitacora' | 'datos';

/**
 * «Gestionar mi práctica» del SGP: avance por momentos, cargue y revisión de
 * documentos, bitácora con el docente, condiciones de cierre y edición de la
 * vacante. La misma pantalla sirve al docente, a coordinación y al auxiliar
 * con las acciones que a cada uno le corresponden; el servidor decide.
 */
@Component({
  selector: 'sipra-expediente',
  standalone: true,
  imports: [EsqueletoComponent, FormsModule, DatePipe, DecimalPipe, RouterLink, EstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cab { display:flex; gap:var(--sp-3); align-items:flex-start; flex-wrap:wrap; margin-bottom:var(--sp-4); }
    .cab .t { flex:1; min-width:240px; } .cab h1 { margin-bottom:2px; }
    .cab .chips { display:flex; gap:var(--sp-2); flex-wrap:wrap; }
    .progreso { display:grid; gap:var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); margin-bottom:var(--sp-4); }
    /* Móvil: los dos avances lado a lado y el resto a todo el ancho; así los documentos no quedan a 1000 px del inicio. */
    @media (width < 600px) { .progreso { grid-template-columns:1fr 1fr; } .progreso > :nth-child(n+3) { grid-column:1 / -1; } }
    .atencion { display:flex; gap:var(--sp-3); align-items:center; flex-wrap:wrap; padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4); border-radius:var(--r-sm); background:var(--aviso-suave); }
    .atencion p { margin:0; flex:1 1 16rem; } .atencion strong { display:block; }
    .pct .n { font-size:var(--fs-xl); font-weight:600; font-variant-numeric:tabular-nums; }
    .pct .barra { height:6px; border-radius:3px; background:var(--superficie-2); overflow:hidden; margin-top:var(--sp-1); }
    .pct .barra span { display:block; height:100%; background:var(--marca); transform-origin:left; animation:crecer .9s var(--ease-out) both; transition:width var(--dur-5) var(--ease-out); } .pct.ok .barra span { background:var(--ok); }
    .pestanas { display:flex; gap:2px; border-bottom:1px solid var(--borde); margin-bottom:var(--sp-4); overflow-x:auto; }
    .pestanas button { flex:none; font:inherit; font-size:var(--fs-sm); font-weight:600; color:var(--texto-tenue); background:none; border:0; border-bottom:2px solid transparent; padding:var(--sp-2) var(--sp-3); min-height:44px; cursor:pointer; white-space:nowrap; }
    .pestanas button { position:relative; border-bottom-color:transparent !important; transition:color var(--dur-2); }
    .pestanas button::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:var(--marca); border-radius:2px; transform:scaleX(0); transform-origin:center; transition:transform var(--dur-3) var(--ease-out); }
    .pestanas button.activa { color:var(--marca); } .pestanas button.activa::after { transform:scaleX(1); }
    .pestanas ~ * { animation:aparecer var(--dur-5) var(--ease-out) both; }
    .columnas { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 1000px) { .columnas { grid-template-columns:1.5fr 1fr; align-items:start; } }
    .momento { margin-bottom:var(--sp-4); } .momento h3 { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap; }
    .momento h3 .pista { font-weight:500; }
    .doc { padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); } .doc:last-child { border-bottom:0; }
    .doc-cab { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap; } .doc-cab .nombre { font-weight:600; flex:1; min-width:150px; font-size:var(--fs-sm); }
    /* Quien estudia: qué pasó y qué hacer, con el motivo de una devolución como protagonista. */
    .guia { margin:var(--sp-1) 0 0; font-size:var(--fs-sm); } .guia strong { font-weight:600; }
    .devolucion { margin-top:var(--sp-2); padding:var(--sp-3); border-radius:var(--r-sm); background:var(--aviso-suave); display:grid; gap:var(--sp-1); }
    .devolucion h4 { margin:0; font-size:var(--fs-base); } .devolucion p { margin:0; font-size:var(--fs-sm); overflow-wrap:break-word; }
    .devolucion .rotulo { font-weight:700; } .devolucion .boton { justify-self:start; margin-top:var(--sp-1); }
    .anteriores { list-style:none; margin:var(--sp-1) 0 0; padding:0; font-size:var(--fs-sm); color:var(--texto-tenue); }
    .bandera { font-size:var(--fs-xs); padding:var(--sp-1) var(--sp-2); border-radius:var(--r-sm); margin-top:var(--sp-1); background:var(--superficie-2); }
    .bandera.critica { background:var(--peligro-suave); color:var(--peligro); } .bandera.alta { background:var(--aviso-suave); color:var(--aviso); }
    .revision { display:inline-flex; gap:var(--sp-2); align-items:center; margin-top:var(--sp-1); padding:var(--sp-1) var(--sp-3); border-radius:30px; font-size:var(--fs-sm); font-weight:700; background:var(--aviso-suave); color:var(--aviso); border:1px solid color-mix(in oklab, var(--aviso) 45%, transparent); }
    .revision svg { width:16px; height:16px; flex:none; }
    .lectura { margin-top:var(--sp-2); border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); font-size:var(--fs-sm); background:var(--superficie-2); }
    .lectura summary { cursor:pointer; font-weight:600; display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center; min-height:28px; }
    .lectura .linea { margin-top:var(--sp-2); }
    .criterios { list-style:none; padding:0; margin:var(--sp-2) 0; display:grid; gap:var(--sp-2); }
    .criterios li { display:flex; gap:var(--sp-2); align-items:flex-start; }
    .criterios .m { flex:none; width:22px; height:22px; border-radius:50%; display:grid; place-items:center; font-size:var(--fs-xs); font-weight:700; background:var(--superficie); color:var(--texto-tenue); }
    .criterios .si .m { background:var(--ok-suave); color:var(--ok); } .criterios .no .m { background:var(--peligro-suave); color:var(--peligro); }
    .zona { display:grid; gap:var(--sp-1); width:100%; font:inherit; color:inherit; border:1.5px dashed var(--borde); border-radius:var(--r-md); padding:var(--sp-4); background:var(--superficie); text-align:center; cursor:pointer; }
    .zona:hover, .zona.encima { border-color:var(--marca); background:var(--marca-suave); }
    .chat { display:flex; flex-direction:column; gap:var(--sp-2); max-height:60vh; overflow:auto; padding:var(--sp-1); }
    .msg { max-width:min(100%,60ch); border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-2) var(--sp-3); font-size:var(--sm, var(--fs-sm)); background:var(--superficie); }
    .msg.propia { align-self:flex-end; background:var(--marca-suave); border-color:transparent; }
    .msg.sistema { align-self:center; background:var(--superficie-2); font-size:var(--fs-xs); text-align:center; }
    .msg .meta { font-size:var(--fs-xs); color:var(--texto-tenue); display:flex; gap:var(--sp-2); flex-wrap:wrap; margin-bottom:2px; }
    .msg dl { margin:var(--sp-1) 0 0; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px var(--sp-3); font-size:var(--fs-xs); align-items:start; } .msg dt { color:var(--texto-tenue); } .msg dd { margin:0; max-width:32ch; text-align:right; }
    .cierre li { display:flex; gap:var(--sp-2); align-items:center; padding:var(--sp-1) 0; font-size:var(--fs-sm); } .cierre ul { list-style:none; padding:0; margin:0; }
    .cierre .si { color:var(--ok); } .cierre .no { color:var(--texto-tenue); }
    .escala { display:flex; gap:var(--sp-1); } .escala label { flex:1; text-align:center; border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-1); cursor:pointer; font-size:var(--fs-sm); }
    .escala input { position:absolute; opacity:0; } .escala label:has(input:checked) { background:var(--marca); color:var(--marca-contraste); border-color:transparent; }
    .et-campo { font-size:var(--fs-sm); font-weight:600; color:var(--texto-tenue); }
    .rej { display:grid; gap:0 var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr)); } .rej .ancho { grid-column:1/-1; }
    .datos { display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); }
    .dato .k { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); } .dato .v { font-weight:560; font-size:var(--fs-sm); }
  `],
  template: `
    @if (cargando()) {
      <sipra-esqueleto tipo="bloque" /><div style="height:var(--sp-4)"></div><sipra-esqueleto tipo="cifras" [cantidad]="4" />
    } @else if (!practica()) {
      <div class="tarjeta vacio">Expediente no encontrado o fuera de su alcance.</div>
    } @else if (practica(); as p) {
      <div class="cab">
        <div class="t">
          <p class="et-sec" style="margin-bottom:2px">FUR n.º {{ p.numeroFur ?? '—' }} · {{ p.periodoAcademico }} · {{ p.estadoSgp }}</p>
          <h1>{{ p.estudianteNombre }}</h1>
          <div class="pista">{{ p.modalidad | etiqueta }} · {{ p.ciclo | etiqueta }} · {{ p.programaId }}
            @if (p.tutorNombre) { · docente {{ p.tutorNombre }} } @else if (veDocente()) { · <span style="color:var(--aviso)">sin docente asignado</span> }</div>
        </div>
        <div class="chips">
          <sipra-estado [valor]="p.estado" />
          @if (sesion.esInterno()) { <sipra-estado [valor]="p.senal" /> }
          @if (p.nota !== null) { <span class="etiqueta" [class.etiqueta--ok]="p.nota >= 3" [class.etiqueta--peligro]="p.nota < 3">Nota {{ p.nota | number: '1.1-1' }}</span> }
        </div>
      </div>


      @for (t of pendientesCorreccion(); track t) {
        <div class="atencion" role="status">
          <p><strong>Tu {{ enMinuscula(t | etiqueta) }} necesita una corrección</strong>Mira el motivo y sube una nueva versión.</p>
          <button type="button" class="boton boton--primario" (click)="corregir(t)">Corregir ahora</button>
        </div>
      }
      <div class="progreso">
        @if (veAvance()) {
        <div class="tarjeta compacto pct"><div class="t pista">Documentos cargados</div><div class="n">{{ p.avance.porcentajeCargado }} %</div>
          <div class="barra"><span [style.width.%]="p.avance.porcentajeCargado"></span></div><div class="pista">{{ p.avance.cargados }} de {{ p.avance.exigidos }}</div></div>
        <div class="tarjeta compacto pct ok"><div class="t pista">Documentos aprobados</div><div class="n">{{ p.avance.porcentajeAprobado }} %</div>
          <div class="barra"><span [style.width.%]="p.avance.porcentajeAprobado"></span></div><div class="pista">{{ p.avance.aprobados }} de {{ p.avance.exigidos }}</div></div>
        }
        <div class="tarjeta compacto"><div class="pista">Afiliación a ARL</div>
          <div style="margin-top:var(--sp-1)"><span class="etiqueta" [class.etiqueta--ok]="p.arlVerificada" [class.etiqueta--peligro]="!p.arlVerificada">{{ p.arlVerificada ? 'verificada' : 'sin afiliación' }}</span></div>
          @if (!p.arlVerificada && solicitaArl()) { <a routerLink="/arl" class="pista">Solicitar la ARL a la CUN →</a> }</div>
        @if (cierre(); as c) {
          <div class="tarjeta compacto cierre"><div class="pista">Cierre del proceso</div>
            <ul><li [class.si]="c.documentosAprobados" [class.no]="!c.documentosAprobados">{{ c.documentosAprobados ? '✓' : '○' }} 100 % aprobado</li>
              <li [class.si]="c.evaluaTuProceso" [class.no]="!c.evaluaTuProceso">{{ c.evaluaTuProceso ? '✓' : '○' }} Evalúa tu proceso</li>
              <li [class.si]="c.calificacion" [class.no]="!c.calificacion">{{ c.calificacion ? '✓' : '○' }} Calificación docente</li></ul>
            @if (c.cerradaEn) { <div class="pista">Cerrado el {{ c.cerradaEn | date: 'd MMM y' }}</div> }
            @else if (c.puedeCerrar && puedeCalificar()) { <button type="button" class="boton compacto boton--primario" (click)="cerrar()" [disabled]="guardando()">Cerrar proceso</button> }
          </div>
        }
      </div>

      @if (sesion.esInterno() && p.disparadoresSenal.length > 0) {
        <div class="aviso aviso--info" style="margin-bottom:var(--sp-4)"><strong>Por qué está señalada:</strong> {{ p.disparadoresSenal.join(' · ') }}</div>
      }

      <div class="pestanas" role="tablist">
        <button type="button" role="tab" [class.activa]="pestana() === 'documentos'" (click)="pestana.set('documentos')">Documentos por momento</button>
        @if (puedeVerBitacora()) {
          <button type="button" role="tab" [class.activa]="pestana() === 'bitacora'" (click)="pestana.set('bitacora')">Bitácora ({{ bitacora().length }})</button>
        }
        <button type="button" role="tab" [class.activa]="pestana() === 'datos'" (click)="pestana.set('datos')">Datos de la práctica</button>
      </div>

      <!-- ── Documentos ─────────────────────────────────────────────────── -->
      @if (pestana() === 'documentos') {
        <div class="columnas">
          <div class="tarjeta">
            @for (m of p.avance.momentos; track m.momento) {
              <section class="momento">
                <h3>{{ m.etiqueta }} <span class="pista">{{ m.aprobados }}/{{ m.exigidos }} aprobados</span>
                  @if (m.completo) { <span class="etiqueta etiqueta--ok">completo</span> } @else if (p.avance.momentoActual === m.momento) { <span class="etiqueta etiqueta--info">momento actual</span> }</h3>
                @for (d of m.documentos; track d.tipo) {
                  <div class="doc">
                    <div class="doc-cab">
                      <span class="nombre">{{ d.tipo | etiqueta }}</span>
                      @if (esEstudiante()) {
                        @if (d.version && d.version > 1) { <span class="pista">versión {{ d.version }}</span> }
                        <span class="etiqueta etiqueta--{{ guia(d.tipo, d.estado).tono }}">{{ guia(d.tipo, d.estado).estado }}</span>
                        @if (puedeCargar() && !d.estado) { <button type="button" class="boton compacto" (click)="tipoSeleccionado.set(d.tipo)">Cargar</button> }
                      } @else {
                        @if (d.version) { <span class="pista">v{{ d.version }}</span> }
                        @if (d.estado) { <sipra-estado [valor]="d.estado" /> } @else { <span class="etiqueta etiqueta--neutra">sin cargar</span> }
                        @if (puedeCargar()) { <button type="button" class="boton compacto" (click)="tipoSeleccionado.set(d.tipo)">Cargar</button> }
                      }
                    </div>
                    @if (esEstudiante()) {
                      <p class="guia">{{ guia(d.tipo, d.estado).que }} <strong>{{ guia(d.tipo, d.estado).hacer }}</strong></p>
                      @if (ultimoDe(d.tipo); as ult) {
                        <p class="pista" style="margin:2px 0 0">{{ ult.nombreOriginal }} · {{ ult.cargadoEn | date: 'd MMM y, HH:mm' }}</p>
                        @if (guia(d.tipo, ult.estado).necesitaCorreccion) {
                          <div class="devolucion" role="status">
                            <h4>Tu {{ enMinuscula(d.tipo | etiqueta) }} necesita una corrección</h4>
                            @if (ult.motivoDevolucion) { <p><span class="rotulo">Motivo:</span> {{ ult.motivoDevolucion }}</p> }
                            <p><span class="rotulo">Qué debes hacer:</span> {{ guia(d.tipo, ult.estado).hacer }}</p>
                            @if (puedeCargar()) { <button type="button" class="boton boton--primario" (click)="corregir(d.tipo)">Subir nueva versión</button> }
                          </div>
                        }
                        @if (anteriores(d.tipo).length > 0) {
                          <ul class="anteriores" aria-label="Versiones anteriores">
                            @for (a of anteriores(d.tipo); track a.id) { <li>{{ lineaAnterior(a) }}</li> }
                          </ul>
                        }
                      }
                    } @else if (ultimoDe(d.tipo); as doc) {
                      <div class="pista">{{ doc.nombreOriginal }} · {{ doc.cargadoEn | date: 'd MMM y, HH:mm' }}@if (doc.puntaje !== null) { · {{ doc.puntaje }}/100 }</div>
                      @if (doc.motivoDevolucion) { <div class="aviso aviso--info" style="margin-top:var(--sp-1)">{{ doc.motivoDevolucion }}</div> }
                      @for (b of doc.banderas ?? []; track b.codigo) {
                        <div class="bandera" [class.critica]="b.severidad === 'critica'" [class.alta]="b.severidad === 'alta'"><span [attr.title]="'Código: ' + b.codigo">{{ textoBandera(b.codigo, b.mensaje) }}</span></div>
                      }
                      @if (doc.estado === 'en_revision' || doc.estado === 'ilegible') {
                        <div class="revision" role="status"><svg aria-hidden="true"><use href="#sipra-alerta" /></svg>{{ doc.estado === 'ilegible' ? 'No se pudo leer: hace falta una persona que lo revise o un nuevo archivo' : 'Pendiente de revisión por una persona' }}</div>
                      }
                      @if (doc.lectura; as l) {
                        <details class="lectura">
                          <summary>Lectura asistida <span class="pista">{{ l.proveedor }} · <span class="mono">{{ l.modelo }}</span></span></summary>
                          @if (l.resumen) { <p style="margin:var(--sp-2) 0 0">{{ l.resumen }}</p> }
                          <dl class="linea">
                            <dt>Tipo detectado</dt><dd>{{ l.tipoDetectado | etiqueta }}@if (l.tipoDetectado && l.tipoDetectado !== doc.tipo) { <span class="etiqueta etiqueta--aviso" style="margin-left:var(--sp-2)">no coincide con el esperado</span> }</dd>
                            @if (l.ilegible) { <dt>Ilegible</dt><dd>{{ l.motivoIlegible ?? 'El modelo no pudo leer el documento.' }}</dd> }
                            @if (l.leidoEn) { <dt>Leído</dt><dd>{{ l.leidoEn | date: 'd MMM y, HH:mm' }}</dd> }
                          </dl>
                          @if (l.hallazgos.length > 0) {
                            <ul class="criterios">
                              @for (h of l.hallazgos; track h.codigo) {
                                <li [class.si]="h.cumple === 'si'" [class.no]="h.cumple === 'no'">
                                  <span class="m" [attr.aria-label]="etiquetaCumple(h.cumple)">{{ h.cumple === 'si' ? '✓' : h.cumple === 'no' ? '✕' : '?' }}</span>
                                  <div><strong>{{ h.enunciado }}</strong><span class="pista"> · {{ etiquetaCumple(h.cumple) }}</span>
                                    @if (h.causalDevolucion && h.cumple === 'no') { <span class="etiqueta etiqueta--peligro" style="margin-left:var(--sp-2)">causal de devolución</span> }
                                    @if (h.detalle) { <div class="pista">{{ h.detalle }}</div> }</div>
                                </li>
                              }
                            </ul>
                          }
                          @if (camposLeidos(l.campos); as campos) {
                            @if (campos.length > 0) {
                              <dl class="linea">@for (c of campos; track c[0]) { <dt>{{ c[0] | etiqueta }}</dt><dd>{{ c[1].valor ?? '—' }} <span class="pista">· confianza {{ confianza(c[1].confianza) }}</span></dd> }</dl>
                            }
                          }
                          <div class="pista" style="margin-top:var(--sp-2)">{{ tokens(l.tokensEntrada) }} tokens de entrada · {{ tokens(l.tokensSalida) }} de salida · {{ costo(l.costoUsd) }}</div>
                        </details>
                      }
                      @if (puedeDecidir() && decidible(doc)) {
                        <div class="campo" style="margin:var(--sp-2) 0 var(--sp-1)"><input type="text" [ngModel]="justificacionDoc()[doc.id] ?? ''" (ngModelChange)="anotar(doc.id, $event)" placeholder="Justificación de la decisión (mínimo 10 caracteres)" /></div>
                        <div class="acciones">
                          <button type="button" class="boton compacto" [disabled]="!justificado(doc.id) || guardando()" (click)="decidir(doc, 'aprobar')">Aprobar</button>
                          <button type="button" class="boton compacto" [disabled]="!justificado(doc.id) || guardando()" (click)="decidir(doc, 'devolver')">Devolver (8 días para subsanar)</button>
                          <button type="button" class="boton compacto boton--peligro" [disabled]="!justificado(doc.id) || guardando()" (click)="decidir(doc, 'rechazar')">Rechazar</button>
                        </div>
                      }
                    }
                  </div>
                }
              </section>
            }
          </div>

          <div class="tarjeta">
            <h2>Cargar documento</h2>
            @if (!puedeCargar()) {
              <div class="vacio">Su perfil no carga documentos en este expediente.</div>
            } @else {
              <div class="campo"><label for="tipo-doc">Tipo de documento</label>
                <select id="tipo-doc" [ngModel]="tipoSeleccionado()" (ngModelChange)="tipoSeleccionado.set($event)">
                  @for (tipo of tiposExigidos(); track tipo) { <option [value]="tipo">{{ tipo | etiqueta }}</option> }
                </select></div>
              <button type="button" class="zona" [class.encima]="arrastrando()" (click)="entrada.click()"
                      (dragover)="$event.preventDefault(); arrastrando.set(true)" (dragleave)="arrastrando.set(false)" (drop)="soltar($event)">
                <strong>Elija un archivo o arrástrelo aquí</strong><span class="pista">PDF sin contraseña · máximo 10 MB</span></button>
              <input #entrada type="file" hidden accept="application/pdf,image/jpeg,image/png" (change)="seleccionar($event)" />
              @if (evaluacion(); as ev) {
                <div class="aviso" style="margin-top:var(--sp-2)" [class.aviso--error]="!ev.aceptable" [class.aviso--ok]="ev.aceptable">
                  @if (ev.aceptable) { La imagen tiene calidad suficiente para leerse. } @else { @for (motivo of ev.motivos; track motivo) { <div>· {{ motivo }}</div> } }</div>
              }
              @if (archivo(); as a) {
                <p class="pista" style="margin-top:var(--sp-2)">{{ a.name }}</p>
                <button type="button" class="boton boton--primario" [disabled]="!puedeEnviar() || guardando()" (click)="enviar()">{{ guardando() ? 'Procesando…' : 'Cargar y validar' }}</button>
              }
              <p class="pista" style="margin-top:var(--sp-3)">Todo documento va en PDF, sin contraseña y con firmas manuscritas o digitales. EPS y ARL con máximo 30 días de expedición. Un documento devuelto se subsana en ocho días calendario.</p>
            }
          </div>
        </div>
      }

      <!-- ── Bitácora ───────────────────────────────────────────────────── -->
      @if (pestana() === 'bitacora') {
        <div class="columnas">
          <div class="tarjeta">
            <h2>Bitácora de seguimiento</h2>
            @if (bitacora().length === 0) { <div class="vacio">Aún no hay mensajes. La bitácora es la trazabilidad del acompañamiento.</div> }
            <div class="chat">
              @for (e of bitacora(); track e.id) {
                <div class="msg" [class.propia]="e.propia" [class.sistema]="e.autor === 'sistema'">
                  <div class="meta"><strong>{{ e.autorNombre }}</strong><span>{{ e.autor | etiqueta }}</span><span>{{ e.etiqueta }}</span><span>{{ e.creadaEn | date: 'd MMM y, HH:mm' }}</span></div>
                  <div>{{ e.mensaje }}</div>
                  @if (e.venceEl) { <div class="pista" style="margin-top:2px">Plazo hasta el {{ e.venceEl | date: 'd MMM y' }}</div> }
                  @if (detalleLegible(e); as pares) { <dl>@for (par of pares; track par[0]) { <dt>{{ par[0] }}</dt><dd>{{ par[1] }}</dd> }</dl> }
                </div>
              }
            </div>
          </div>

          <div class="tarjeta">
            <h2>Nuevo mensaje</h2>
            @if (!puedeEscribir()) { <div class="vacio">Su perfil consulta la bitácora; no escribe en ella.</div> }
            @else {
              <div class="campo"><label for="b-tipo">Tipo de mensaje</label>
                <select id="b-tipo" [ngModel]="tipoEntrada()" (ngModelChange)="tipoEntrada.set($event)">
                  @for (t of tiposEntrada(); track t) { <option [value]="t">{{ t | etiqueta }}</option> }
                </select></div>

              @switch (tipoEntrada()) {
                @case ('seguimiento') {
                  <div class="rej">
                    <div class="campo"><label for="s-fecha">Fecha y hora de la visita</label><input id="s-fecha" type="datetime-local" [(ngModel)]="seg.fechaVisita" /></div>
                    <div class="campo"><label for="s-mod">Modalidad de la visita</label><select id="s-mod" [(ngModel)]="seg.modalidadVisita"><option value="presencial">Presencial</option><option value="virtual">Virtual</option><option value="telefonica">Telefónica</option></select></div>
                    <div class="campo"><label for="s-nombre">Con quién se desarrolló</label><input id="s-nombre" [(ngModel)]="seg.contactoNombre" /></div>
                    <div class="campo"><label for="s-cargo">Cargo</label><input id="s-cargo" [(ngModel)]="seg.contactoCargo" /></div>
                    <div class="campo"><label for="s-area">Área</label><input id="s-area" [(ngModel)]="seg.contactoArea" /></div>
                    <div class="campo ancho"><label for="s-sug">Sugerencias para el plan de mejoramiento</label><textarea id="s-sug" [(ngModel)]="seg.sugerenciasPlanMejoramiento"></textarea></div>
                    <div class="campo ancho"><label for="s-eval">Evaluación con el jefe inmediato</label><textarea id="s-eval" [(ngModel)]="seg.evaluacionJefeInmediato"></textarea></div>
                  </div>
                }
                @case ('evaluacion_final') {
                  <div class="campo"><label for="ef-des">Desempeño del estudiante</label><textarea id="ef-des" [(ngModel)]="evalFinal.desempeno"></textarea></div>
                  <div class="campo"><label for="ef-sat">Nivel de satisfacción de la empresa</label><textarea id="ef-sat" [(ngModel)]="evalFinal.satisfaccionEmpresa"></textarea></div>
                  <div class="campo"><label for="ef-ret">Retroalimentación final del plan de mejoramiento</label><textarea id="ef-ret" [(ngModel)]="evalFinal.retroalimentacionPlanMejoramiento"></textarea></div>
                }
                @case ('evalua_tu_proceso') {
                  @if (cierre()?.evaluaTuProceso) { <div class="aviso aviso--ok">Ya respondió «Evalúa tu proceso». Se responde una sola vez.</div> }
                  @else {
                    @for (pregunta of cierre()?.preguntasEvaluaTuProceso ?? []; track $index; let i = $index) {
                      <div class="campo"><span class="et-campo">{{ i + 1 }}. {{ pregunta }}</span>
                        <div class="escala">@for (v of [1, 2, 3, 4, 5]; track v) { <label><input type="radio" [name]="'q' + i" [value]="v" [(ngModel)]="respuestas[i]" />{{ v }}</label> }</div></div>
                    }
                    <p class="pista">1 = en desacuerdo · 5 = totalmente de acuerdo</p>
                    <div class="campo"><label for="etp-com">Comentario (opcional)</label><textarea id="etp-com" [(ngModel)]="comentarioEvalua"></textarea></div>
                  }
                }
                @case ('calificacion_docente') {
                  @if (!cierre()?.documentosAprobados) { <div class="aviso aviso--aviso">La calificación se registra con el 100 % de los documentos aprobados (hoy {{ cierre()?.porcentajeAprobado }} %).</div> }
                  <div class="campo" style="max-width:200px"><label for="cal-nota">Nota definitiva (0,0 a 5,0)</label><input id="cal-nota" type="number" min="0" max="5" step="0.1" [(ngModel)]="nota" /></div>
                  <p class="pista">Aprueba desde 3,0. Si el estudiante ya respondió «Evalúa tu proceso», el proceso cierra al calificar.</p>
                }
                @case ('plazo_subsanacion') {
                  <div class="campo"><span class="et-campo">Documentos pendientes</span>
                    @for (t of tiposExigidos(); track t) { <label style="display:flex;gap:6px;font-size:var(--fs-sm)"><input type="checkbox" [checked]="pendientesSel().includes(t)" (change)="alternarPendiente(t)" /> {{ t | etiqueta }}</label> }</div>
                  <p class="pista">Deja constancia del plazo máximo de ocho días calendario y avisa al estudiante.</p>
                }
                @default {}
              }

              @if (tipoEntrada() !== 'evalua_tu_proceso' || !cierre()?.evaluaTuProceso) {
                <div class="campo"><label for="b-msg">{{ tipoEntrada() === 'calificacion_docente' ? 'Observación (opcional)' : 'Mensaje' }}</label><textarea id="b-msg" [(ngModel)]="mensajeNuevo"></textarea></div>
                <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="escribir()">{{ guardando() ? 'Enviando…' : 'Registrar en la bitácora' }}</button>
              }
            }
          </div>
        </div>
      }

      <!-- ── Datos de la práctica ───────────────────────────────────────── -->
      @if (pestana() === 'datos') {
        <div class="columnas">
          <div class="tarjeta">
            <h2>Organización y vacante</h2>
            <div class="datos">
              <div class="dato"><div class="k">Organización</div><div class="v">{{ p.empresaRazonSocial ?? '—' }}</div></div>
              <div class="dato"><div class="k">NIT</div><div class="v">{{ p.empresaNit ?? '—' }}</div></div>
              <div class="dato"><div class="k">Ciudad</div><div class="v">{{ p.ciudad ?? '—' }}</div></div>
              <div class="dato"><div class="k">Área</div><div class="v">{{ p.area ?? '—' }}</div></div>
              <div class="dato"><div class="k">Cargo</div><div class="v">{{ p.cargo ?? '—' }}</div></div>
              <div class="dato"><div class="k">Remuneración</div><div class="v">{{ p.tipoRemuneracion | etiqueta }}{{ p.salario ? ' · $' + (p.salario | number) : '' }}</div></div>
              <div class="dato"><div class="k">Responsable de la ARL</div><div class="v">{{ p.responsableArl === 'cun' ? 'CUN' : p.responsableArl === 'empresa' ? 'Empresa' : 'No informado' }}</div></div>
              <div class="dato"><div class="k">Horario</div><div class="v">{{ p.horario ?? '—' }}</div></div>
              <div class="dato"><div class="k">Inicio</div><div class="v">{{ p.fechaInicio ? (p.fechaInicio | date: 'd MMM y') : '—' }}</div></div>
              <div class="dato"><div class="k">Fin</div><div class="v">{{ p.fechaFin ? (p.fechaFin | date: 'd MMM y') : '—' }}</div></div>
              <div class="dato"><div class="k">Jefe inmediato</div><div class="v">{{ p.jefeInmediatoNombre ?? '—' }}{{ p.jefeInmediatoCargo ? ' · ' + p.jefeInmediatoCargo : '' }}</div></div>
              <div class="dato"><div class="k">Contacto del jefe</div><div class="v">{{ p.jefeInmediatoCorreo ?? '—' }}{{ p.jefeInmediatoTelefono ? ' · ' + p.jefeInmediatoTelefono : '' }}</div></div>
              <div class="dato"><div class="k">Registrada por</div><div class="v">{{ p.registradaPor === 'estudiante' ? 'El estudiante' : 'Coordinación' }}</div></div>
            </div>
            @if (p.funcionesRelevantes) { <p style="margin-top:var(--sp-3)" class="pista"><strong>Funciones:</strong> {{ p.funcionesRelevantes }}</p> }

            @if (puedeEditarVacante()) {
              <details style="margin-top:var(--sp-4)"><summary class="boton compacto" style="display:inline-flex">Editar datos de la vacante</summary>
                <p class="pista" style="margin-top:var(--sp-3)">La modalidad y las fechas no se modifican; para corregirlas coordinación anula el registro y se hace uno nuevo.</p>
                <div class="rej">
                  <div class="campo"><label for="v-area">Área</label><input id="v-area" [(ngModel)]="vac.area" /></div>
                  <div class="campo"><label for="v-cargo">Cargo</label><input id="v-cargo" [(ngModel)]="vac.cargo" /></div>
                  <div class="campo"><label for="v-hor">Horario</label><input id="v-hor" [(ngModel)]="vac.horario" /></div>
                  <div class="campo"><label for="v-ciu">Ciudad</label><input id="v-ciu" [(ngModel)]="vac.ciudad" /></div>
                  <div class="campo"><label for="v-jn">Jefe inmediato</label><input id="v-jn" [(ngModel)]="vac.jefeInmediatoNombre" /></div>
                  <div class="campo"><label for="v-jc">Cargo del jefe</label><input id="v-jc" [(ngModel)]="vac.jefeInmediatoCargo" /></div>
                  <div class="campo"><label for="v-je">Correo del jefe</label><input id="v-je" type="email" [(ngModel)]="vac.jefeInmediatoCorreo" /></div>
                  <div class="campo"><label for="v-jt">Teléfono del jefe</label><input id="v-jt" [(ngModel)]="vac.jefeInmediatoTelefono" /></div>
                  <div class="campo ancho"><label for="v-fun">Funciones relevantes</label><textarea id="v-fun" [(ngModel)]="vac.funcionesRelevantes"></textarea></div>
                </div>
                <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="guardarVacante()">Guardar cambios</button>
              </details>
            }
          </div>

          <div class="tarjeta">
            <h2>Gestión del expediente</h2>
            @if (puedeAdministrar() && !p.arlVerificada) {
              <div class="aviso aviso--error">La práctica no pasa a <strong>activa</strong> sin afiliación a ARL anterior al inicio (Decreto 055 de 2015).</div>
              <div class="campo" style="max-width:220px;margin-top:var(--sp-3)"><label for="arl">Fecha de afiliación</label><input id="arl" type="date" [(ngModel)]="fechaArl" /></div>
              <button type="button" class="boton" [disabled]="!fechaArl() || guardando()" (click)="registrarArl()">Registrar afiliación</button>
            }
            @if (puedeAdministrar() && p.transicionesPosibles.length > 0) {
              <div style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--borde)">
                <div class="campo"><label for="just">Justificación del cambio de estado</label><input id="just" type="text" [(ngModel)]="justificacion" placeholder="Queda en la auditoría inmutable (mínimo 10 caracteres)" /></div>
                <div class="acciones">
                  @for (destino of p.transicionesPosibles; track destino) {
                    <button type="button" class="boton compacto" [class.boton--peligro]="destino === 'anulada' || destino === 'reprobada'" [disabled]="justificacion().length < 10 || guardando()" (click)="transicionar(destino)">Pasar a {{ destino | etiqueta }}</button>
                  }
                </div>
                <p class="pista" style="margin-top:var(--sp-2)">«Anulado» habilita un registro nuevo cuando el actual tiene inconsistencias; el cierre y «Reprueba» salen de la calificación.</p>
              </div>
            }
            @if (!puedeAdministrar()) { <div class="vacio">Los cambios de estado los hace coordinación. El cierre ocurre solo cuando concurren las tres condiciones.</div> }
          </div>
        </div>
      }
    }
  `,
})
export class ExpedienteComponent implements OnInit {
  readonly id = input.required<string>();
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly captura = inject(CapturaGuiadaService);
  private readonly etiqueta = new EtiquetaPipe();

  readonly practica = signal<Practica | null>(null);
  readonly documentos = signal<Documento[]>([]);
  readonly bitacora = signal<EntradaBitacora[]>([]);
  readonly cierre = signal<EstadoCierre | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly pestana = signal<Pestana>('documentos');

  readonly justificacion = signal('');
  readonly fechaArl = signal('');
  readonly tipoSeleccionado = signal('');
  readonly archivo = signal<File | null>(null);
  readonly evaluacion = signal<EvaluacionCaptura | null>(null);
  readonly arrastrando = signal(false);
  readonly justificacionDoc = signal<Record<string, string | undefined>>({});

  readonly tipoEntrada = signal<TipoEntradaBitacora>('mensaje_libre');
  readonly mensajeNuevo = signal('');
  readonly nota = signal<number | null>(null);
  readonly comentarioEvalua = signal('');
  readonly pendientesSel = signal<string[]>([]);
  readonly respuestas: (number | null)[] = [null, null, null, null];
  readonly seg = { fechaVisita: '', modalidadVisita: 'presencial' as 'presencial' | 'virtual' | 'telefonica', contactoNombre: '', contactoCargo: '', contactoArea: '', sugerenciasPlanMejoramiento: '', evaluacionJefeInmediato: '' };
  readonly evalFinal = { desempeno: '', satisfaccionEmpresa: '', retroalimentacionPlanMejoramiento: '' };
  readonly vac: VacanteEditable = {};

  readonly puedeAdministrar = computed(() => ['administrador', 'coordinador'].includes(this.sesion.rol() ?? ''));
  readonly puedeDecidir = computed(() => ['tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly puedeCargar = computed(() => ['estudiante', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? '') && !this.terminal());
  /** El avance documental y el docente solo se muestran a quien los recibe del servidor. */
  readonly veAvance = computed(() => ['estudiante', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly veDocente = computed(() => !['empresa', 'extension'].includes(this.sesion.rol() ?? ''));
  readonly puedeVerBitacora = computed(() => ['estudiante', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly puedeEscribir = computed(() => ['estudiante', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly puedeCalificar = computed(() => ['tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly puedeEditarVacante = computed(() => this.puedeCargar());
  readonly terminal = computed(() => ['certificada', 'cancelada', 'anulada', 'reprobada'].includes(this.practica()?.estado ?? ''));
  readonly solicitaArl = computed(() => {
    const m = this.practica()?.modalidad ?? '';
    return ['monitoria', 'social', 'investigacion', 'practica_tecnica_investigacion', 'pasantia_investigativa', 'cunbre_naciente', 'cunbre_consolidado', 'pasantia'].includes(m);
  });
  readonly tiposExigidos = computed(() => this.practica()?.avance.momentos.flatMap((m) => m.documentos.map((d) => d.tipo)) ?? []);
  readonly tiposEntrada = computed<TipoEntradaBitacora[]>(() => {
    switch (this.sesion.rol()) {
      case 'estudiante': return ['mensaje_libre', 'evalua_tu_proceso'];
      case 'tutor': return ['mensaje_libre', 'seguimiento', 'evaluacion_final', 'plazo_subsanacion', 'calificacion_docente'];
      case 'coordinador': case 'administrador': return ['mensaje_libre', 'plazo_subsanacion', 'calificacion_docente'];
      default: return [];
    }
  });
  readonly puedeEnviar = computed(() => { const ev = this.evaluacion(); return this.archivo() !== null && !!this.tipoSeleccionado() && (ev === null || ev.aceptable); });

  async ngOnInit(): Promise<void> { await this.recargar(); }

  ultimoDe(tipo: string): Documento | null {
    return this.documentos().filter((d) => d.tipo === tipo).sort((a, b) => b.version - a.version)[0] ?? null;
  }
  readonly textoBandera = textoBandera;
  readonly esEstudiante = computed(() => this.sesion.rol() === 'estudiante');
  /** Tipos cuyo último documento necesita corrección: se avisa arriba, sin obligar a buscarlo entre los momentos. */
  readonly pendientesCorreccion = computed(() => {
    if (!this.esEstudiante()) return [] as string[];
    const tipos = [...new Set(this.documentos().map((d) => d.tipo))];
    return tipos.filter((t) => guiaDocumento(this.ultimoDe(t)?.estado, '').necesitaCorreccion);
  });
  guia(tipo: string, estado: string | null | undefined) { return guiaDocumento(estado, this.etiquetaTipo(tipo)); }
  /** Versiones anteriores de un tipo (la última se muestra aparte), de la más reciente a la más antigua. */
  anteriores(tipo: string): Documento[] { return this.documentos().filter((d) => d.tipo === tipo).sort((a, b) => b.version - a.version).slice(1); }
  lineaAnterior(d: Documento): string { return lineaVersionAnterior(d.version, d.estado, this.etiquetaTipo(d.tipo)); }
  /** «Subir nueva versión»: deja elegido el tipo y lleva a la zona de carga. */
  corregir(tipo: string): void {
    this.tipoSeleccionado.set(tipo);
    setTimeout(() => { const zona = document.querySelector<HTMLElement>('.zona'); zona?.scrollIntoView({ block: 'center' }); zona?.focus(); }, 0);
  }
  /** «Certificado de EPS» → «certificado de EPS» (solo la inicial: las siglas se conservan). */
  enMinuscula(texto: string): string { return texto ? texto.charAt(0).toLowerCase() + texto.slice(1) : texto; }
  private etiquetaTipo(tipo: string): string { return this.etiqueta.transform(tipo); }
  decidible(doc: Documento): boolean { return !['aprobado', 'rechazado'].includes(doc.estado); }
  etiquetaCumple(cumple: 'si' | 'no' | 'no_determinable'): string {
    return cumple === 'si' ? 'cumple' : cumple === 'no' ? 'no cumple' : 'no determinable';
  }
  camposLeidos(campos: Record<string, CampoLectura>): [string, CampoLectura][] { return Object.entries(campos); }
  confianza(valor: number): string { return `${Math.round((valor <= 1 ? valor * 100 : valor))} %`; }
  tokens(valor: number): string { return formatearEntero(valor); }
  costo(valor: number): string { return formatearUsd(valor); }
  justificado(id: string): boolean { return (this.justificacionDoc()[id] ?? '').trim().length >= 10; }
  anotar(id: string, texto: string): void { this.justificacionDoc.update((a) => ({ ...a, [id]: texto })); }
  alternarPendiente(t: string): void { this.pendientesSel.update((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t])); }

  detalleLegible(e: EntradaBitacora): [string, string][] | null {
    const d = e.detalle;
    if (!d) return null;
    if (e.tipo === 'evalua_tu_proceso') {
      const r = (d['respuestas'] as { pregunta: string; valor: number }[] | undefined) ?? [];
      return [...r.map((x) => [x.pregunta, `${x.valor} / 5`] as [string, string]), ...(d['comentario'] ? [['Comentario', String(d['comentario'])] as [string, string]] : [])];
    }
    if (e.tipo === 'seguimiento') {
      return [['Visita', `${new Date(String(d['fechaVisita'])).toLocaleString('es-CO')} · ${String(d['modalidadVisita'])}`],
        ['Contacto', [d['contactoNombre'], d['contactoCargo'], d['contactoArea']].filter(Boolean).join(' · ')],
        ...(d['sugerenciasPlanMejoramiento'] ? [['Sugerencias', String(d['sugerenciasPlanMejoramiento'])] as [string, string]] : []),
        ...(d['evaluacionJefeInmediato'] ? [['Evaluación del jefe', String(d['evaluacionJefeInmediato'])] as [string, string]] : [])];
    }
    if (e.tipo === 'evaluacion_final') {
      return [['Desempeño', String(d['desempeno'])], ['Satisfacción', String(d['satisfaccionEmpresa'])], ...(d['retroalimentacionPlanMejoramiento'] ? [['Plan de mejoramiento', String(d['retroalimentacionPlanMejoramiento'])] as [string, string]] : [])];
    }
    if (e.tipo === 'calificacion_docente') return [['Nota', String(d['nota'])], ['Resultado', d['aprobada'] ? 'Aprobado' : 'Reprueba']];
    if (e.tipo === 'plazo_subsanacion') return [['Documentos', ((d['documentos'] as string[]) ?? []).join(', ')]];
    return null;
  }

  async seleccionar(evento: Event): Promise<void> { await this.tomar((evento.target as HTMLInputElement).files?.[0] ?? null); }
  async soltar(evento: DragEvent): Promise<void> { evento.preventDefault(); this.arrastrando.set(false); await this.tomar(evento.dataTransfer?.files?.[0] ?? null); }
  private async tomar(archivo: File | null): Promise<void> { this.archivo.set(archivo); this.evaluacion.set(archivo ? await this.captura.evaluar(archivo) : null); }

  async enviar(): Promise<void> {
    const archivo = this.archivo();
    if (!archivo) return;
    const formulario = new FormData();
    formulario.append('tipo', this.tipoSeleccionado());
    formulario.append('archivo', archivo, archivo.name);
    const ev = this.evaluacion();
    if (ev) formulario.append('calidad', JSON.stringify(ev.metricas));
    await this.ejecutar(async () => {
      await firstValueFrom(this.api.cargarDocumento(this.id(), formulario));
      this.archivo.set(null); this.evaluacion.set(null);
      await this.esperarValidacion();
      return 'Documento cargado. La validación ya lo procesó.';
    });
  }

  async decidir(doc: Documento, decision: 'aprobar' | 'rechazar' | 'devolver'): Promise<void> {
    await this.ejecutar(async () => {
      await firstValueFrom(this.api.decidirDocumento(doc.id, decision, this.justificacionDoc()[doc.id] ?? ''));
      this.anotar(doc.id, '');
      return decision === 'devolver' ? 'Documento devuelto: la bitácora registró el plazo de ocho días y el estudiante fue avisado.' : 'Decisión registrada en la auditoría.';
    });
  }

  async escribir(): Promise<void> {
    const tipo = this.tipoEntrada();
    const dto: EscribirBitacora = { tipo, mensaje: this.mensajeNuevo().trim() || undefined };
    if (tipo === 'seguimiento') dto.seguimiento = { ...this.seg, fechaVisita: this.seg.fechaVisita ? new Date(this.seg.fechaVisita).toISOString() : '' };
    if (tipo === 'evaluacion_final') dto.evaluacionFinal = { ...this.evalFinal };
    if (tipo === 'evalua_tu_proceso') dto.evaluaTuProceso = { respuestas: this.respuestas.map((valor, pregunta) => ({ pregunta, valor: valor ?? 0 })), comentario: this.comentarioEvalua().trim() || undefined };
    if (tipo === 'calificacion_docente') dto.calificacion = { nota: Number(this.nota()) };
    if (tipo === 'plazo_subsanacion') dto.subsanacion = { documentos: this.pendientesSel() };
    await this.ejecutar(async () => {
      await firstValueFrom(this.api.escribirBitacora(this.id(), dto));
      this.mensajeNuevo.set(''); this.comentarioEvalua.set(''); this.pendientesSel.set([]); this.nota.set(null);
      this.respuestas.fill(null);
      return tipo === 'calificacion_docente' ? 'Calificación registrada.' : 'Registrado en la bitácora.';
    });
  }

  async cerrar(): Promise<void> {
    await this.ejecutar(async () => { const r = await firstValueFrom(this.api.cerrarPractica(this.id())); return r.cerrada ? `Proceso cerrado: ${r.estado === 'certificada' ? 'aprobado' : 'reprueba'}.` : 'No fue posible cerrar.'; });
  }

  async guardarVacante(): Promise<void> {
    const cambios: VacanteEditable = {};
    for (const [k, v] of Object.entries(this.vac)) if (v !== undefined && v !== '') (cambios as Record<string, unknown>)[k] = v;
    await this.ejecutar(async () => { await firstValueFrom(this.api.actualizarVacante(this.id(), cambios)); return 'Datos de la vacante actualizados.'; });
  }

  async registrarArl(): Promise<void> {
    await this.ejecutar(async () => { await firstValueFrom(this.api.registrarArl(this.id(), this.fechaArl())); return 'Afiliación a ARL registrada y obligación cumplida.'; });
  }

  async transicionar(destino: EstadoPractica): Promise<void> {
    await this.ejecutar(async () => { await firstValueFrom(this.api.transicionarPractica(this.id(), destino, this.justificacion())); this.justificacion.set(''); return 'Estado actualizado.'; });
  }

  private async ejecutar(accion: () => Promise<string>): Promise<void> {
    this.guardando.set(true);
    try { const texto = await accion(); this.avisos.exito(texto); await this.recargar(); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }

  private enProceso(documentos: Documento[]): boolean { return documentos.some((d) => ['recibido', 'analizando'].includes(d.estado)); }

  private async esperarValidacion(): Promise<void> {
    for (const espera of [250, 400, 700, 1200, 2000, 3000]) {
      const documentos = await firstValueFrom(this.api.listarDocumentos(this.id()));
      if (!this.enProceso(documentos)) return;
      await new Promise((seguir) => setTimeout(seguir, espera));
    }
  }

  private async recargar(): Promise<void> {
    try {
      const [practica, documentos, bitacora, cierre] = await Promise.all([
        firstValueFrom(this.api.obtenerPractica(this.id())),
        // Empresa y extensión no consultan documentos (403) y el auxiliar solo los de su proceso:
        // el expediente se abre igual, sin lista.
        firstValueFrom(this.api.listarDocumentos(this.id())).catch(() => [] as Documento[]),
        firstValueFrom(this.api.listarBitacora(this.id())).catch(() => [] as EntradaBitacora[]),
        firstValueFrom(this.api.estadoCierre(this.id())).catch(() => null),
      ]);
      this.practica.set(practica); this.documentos.set(documentos); this.bitacora.set(bitacora); this.cierre.set(cierre);
      if (!this.tipoSeleccionado()) this.tipoSeleccionado.set(practica.avance.pendientes[0] ?? this.tiposExigidos()[0] ?? '');
      Object.assign(this.vac, {
        area: practica.area ?? '', cargo: practica.cargo ?? '', horario: practica.horario ?? '', ciudad: practica.ciudad ?? '',
        jefeInmediatoNombre: practica.jefeInmediatoNombre ?? '', jefeInmediatoCargo: practica.jefeInmediatoCargo ?? '',
        jefeInmediatoCorreo: practica.jefeInmediatoCorreo ?? '', jefeInmediatoTelefono: practica.jefeInmediatoTelefono ?? '',
        funcionesRelevantes: practica.funcionesRelevantes ?? '',
      });
    } catch { this.practica.set(null); }
    finally { this.cargando.set(false); }
  }
}
