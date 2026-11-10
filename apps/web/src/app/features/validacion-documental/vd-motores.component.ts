import { ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, ViewEncapsulation, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DocumentoDeExpediente } from '@core/models/validacion-documental.model';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { traducirErrorEps } from '../eps/eps.util';
import { enfasisDecision, tonoDeClases } from './vd.senal';
import { ActasDetalleComponent } from '../actas/actas-detalle.component';
import { ActasMesaEstado } from '../actas/actas-mesa.estado';
import { CamaraDetalleComponent } from '../camara/camara-detalle.component';
import { CamaraMesaEstado } from '../camara/camara-mesa.estado';
import { EpsDetalleComponent } from '../eps/eps-detalle.component';
import { EpsMesaEstado } from '../eps/eps-mesa.estado';
import { RutDetalleComponent } from '../rut/rut-detalle.component';
import { RutMesaEstado } from '../rut/rut-mesa.estado';

/**
 * Los cuatro motores se muestran con SUS PROPIOS componentes de detalle (visor, resultado, evidencia, reserva y decisión): la Mesa
 * Documental no duplica ni visores ni tablas, y la reserva y la decisión siguen siendo del motor, contra su propio endpoint. Cada
 * envoltorio solo (1) le da su estado al componente, (2) le indica qué caso mostrar y (3) AVISA cuando algo cambió (se tomó, se liberó
 * o se decidió) para que el expediente y la cola actualicen sus metadatos sin recargar la aplicación.
 */
/**
 * Directiva de presentación: lee el TONO de la recomendación que el motor YA pinta (`rec--ok|aviso|peligro`) y lo deja en
 * `data-tono` y en `data-enfasis` (qué acción de la barra de decisión lleva el énfasis). No decide nada ni toca al motor: un solo
 * MutationObserver sobre el host, coalescido con rAF.
 */
@Directive({ selector: '[sipraVdTono]', standalone: true })
export class VdTonoDirective {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destruir = inject(DestroyRef);
    let cuadro = 0;
    const leer = (): void => {
      cuadro = 0;
      const tono = tonoDeClases(el.querySelector('.rec')?.className ?? null);
      if (tono) el.setAttribute('data-tono', tono); else el.removeAttribute('data-tono');
      const enfasis = enfasisDecision(tono);
      if (el.getAttribute('data-enfasis') !== enfasis) el.setAttribute('data-enfasis', enfasis);
    };
    leer();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => { if (!cuadro) cuadro = requestAnimationFrame(leer); });
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    destruir.onDestroy(() => { mo.disconnect(); if (cuadro) cancelAnimationFrame(cuadro); });
  }
}

/*
 * Piel V3 de los motores dentro de la Mesa (Figma V3 · F1/F2/F3). Solo PRESENTACIÓN: no toca plantillas, reglas ni acciones de los
 * motores. Son dos componentes sin encapsulación que se cargan una vez con la Mesa (antes este CSS se repetía en los cuatro envoltorios)
 * y cuelgan de `#vd-motor`: el id del envoltorio del motor visible (hay uno a la vez). La especificidad de id es la que les permite
 * ganar a las reglas encapsuladas del motor sin `!important`; fuera de la Mesa no aplican.
 */
/** Franja del caso, avisos, bahía del documento, barra técnica del visor y papel. */
@Component({
  selector: 'sipra-vd-piel-bahia',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { hidden: '' },
  styles: [`
  #vd-motor { display:block; min-width:0; }
  #vd-motor .atras { display:none !important; }
  @media (width >= 1024px) {
    #vd-motor { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
    #vd-motor > * { position:relative; display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
  }
  #vd-motor .cab.cab { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px 12px; min-height:32px; margin:0 0 8px; flex:none; }
  #vd-motor .cab.cab h2, #vd-motor .cab.cab .meta { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  #vd-motor .cab.cab > div:first-child, #vd-motor .cab.cab .estados { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0; }
  #vd-motor .cab.cab .etiqueta { padding:0; border:0; background:transparent; font-size:var(--fs-meta); font-weight:500; }
  #vd-motor .cab.cab .pista { font-size:var(--fs-meta); }
  #vd-motor .cab.cab .acciones { display:flex; gap:6px; flex-wrap:wrap; }
  #vd-motor .cab.cab .boton, #vd-motor .barra.barra .boton, #vd-motor .controles.controles .boton, #vd-motor .aviso.aviso .boton {
    min-height:28px; padding:0 12px; border-radius:var(--radius-6); border:1px solid var(--vd-boton-borde); background:var(--vd-boton); color:var(--text-primary);
    font-size:var(--fs-meta); font-weight:500; clip-path:none; box-shadow:none; transform:none; }
  #vd-motor .cab.cab .boton--primario { background:var(--action-primary); color:var(--action-on-primary); border-color:transparent; font-weight:600; box-shadow:var(--vd-primario-glow); }
  #vd-motor .aviso.aviso { margin:0 0 8px; padding:8px 12px; border:0; border-left:2px solid var(--status-review); border-radius:0 var(--radius-6) var(--radius-6) 0; font-size:var(--fs-xs);
    background:linear-gradient(90deg, var(--status-review-subtle), transparent 80%); }
  #vd-motor .aviso.aviso.peligro { border-left-color:var(--status-critical); background:linear-gradient(90deg, var(--status-critical-subtle), transparent 80%); box-shadow:-6px 0 12px -8px var(--status-critical); }
  #vd-motor .aviso.aviso.info { border-left-color:var(--status-available); background:linear-gradient(90deg, var(--status-available-subtle), transparent 80%); }
  #vd-motor .est.est { display:grid; grid-template-columns:minmax(0, 1fr); gap:16px; align-items:start; }
  #vd-motor .est.est > :not(.col-rev) {
    position:relative; top:auto; height:auto; max-height:none; min-height:0; display:flex; flex-direction:column; min-width:0; padding:14px 0 0; border-radius:var(--radius-6); overflow:hidden;
    background:var(--vd-bahia-interior), var(--vd-bahia-bloom), var(--vd-bahia); border:1px solid var(--vd-bahia-borde); }
  #vd-motor .est.est > :not(.col-rev) > h3 { display:none; }
  #vd-motor .est.est > :not(.col-rev) > :is(sipra-eps-visor, sipra-rut-visor, sipra-actas-visor, sipra-camara-visor) {
    flex:1 1 auto; min-height:0; height:auto; display:grid; grid-template-columns:1fr auto auto 1fr; grid-template-rows:auto minmax(0, 1fr); }
  #vd-motor .barra.barra { grid-column:2; grid-row:1; display:flex; flex-wrap:nowrap; align-items:center; gap:4px; height:32px; margin:0; padding:0 6px 0 14px; white-space:nowrap;
    background:var(--vd-pildora); border:1px solid var(--vd-pildora-borde); border-radius:16px; }
  #vd-motor :has(> .controles) > .barra.barra { border-right:0; border-radius:16px 0 0 16px; }
  #vd-motor .barra.barra .meta { flex:none; font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; color:var(--text-secondary); margin-right:6px; }
  #vd-motor .barra.barra .meta strong { font-weight:500; color:var(--text-primary); }
  #vd-motor .barra.barra .boton { min-height:24px; padding:0 8px; border-color:transparent; background:transparent; }
  #vd-motor .barra.barra .boton--primario { color:var(--status-available); font-weight:600; }
  #vd-motor .controles.controles { grid-column:3; grid-row:1; display:flex; flex-wrap:nowrap; align-items:center; gap:0; height:32px; margin:0; padding:0 8px 0 6px; white-space:nowrap;
    font-family:var(--fuente-mono); font-size:var(--fs-meta); background:var(--vd-pildora); border:1px solid var(--vd-pildora-borde); border-left-color:var(--vd-regla); border-radius:0 16px 16px 0; }
  #vd-motor .controles.controles .boton { min-height:24px; min-width:24px; padding:0 6px; border-color:transparent; background:transparent; font-family:var(--fuente); }
  #vd-motor .controles.controles .boton:hover:not(:disabled), #vd-motor .barra.barra .boton:hover:not(:disabled) { background:var(--vd-boton); border-color:var(--vd-boton-borde); }
  #vd-motor .controles.controles label { gap:4px; color:var(--text-secondary); }
  #vd-motor .controles.controles input { width:2.6rem; min-height:22px; padding:0 4px; font:inherit; color:var(--text-primary); background:transparent; border:1px solid var(--vd-regla); border-radius:var(--radius-4); }
  #vd-motor .controles.controles .zoom { color:var(--text-primary); }
  #vd-motor .barra.barra .meta { max-width:150px; overflow:hidden; text-overflow:ellipsis; }
  #vd-motor .barra.barra .boton--primario:has(+ .boton), #vd-motor .barra.barra .boton--primario + .boton, #vd-motor .controles.controles .boton[aria-pressed], #vd-motor .controles.controles label { font-size:0; }
  #vd-motor .barra.barra .boton--primario:has(+ .boton)::before { content:'⤢'; font-size:15px; }
  #vd-motor .barra.barra .boton--primario + .boton::before { content:'✕'; font-size:12px; }
  #vd-motor .controles.controles .boton[aria-pressed]::before { content:'↔'; font-size:14px; }
  #vd-motor .controles.controles .boton[aria-pressed='true'] { color:var(--status-available); }
  #vd-motor .controles.controles label input { font-size:var(--fs-meta); }
  #vd-motor .marco.marco { grid-column:1 / -1; grid-row:2; width:calc(100% - 142px); min-width:min(100%, 280px); margin:28px auto 32px; min-height:0; border-radius:var(--radius-2);
    border:1px dashed var(--vd-bahia-borde); background:transparent; }
  #vd-motor .marco.marco.previa { background:var(--vd-papel); border:1px solid var(--vd-papel-borde); box-shadow:var(--vd-papel-sombra); }
  #vd-motor .marco.marco .estado { color:var(--text-secondary); font-size:var(--fs-xs); }

  @media (width < 768px) {
    #vd-motor .marco.marco.previa, #vd-motor .controles.controles { display:none; }
    #vd-motor .est.est > :not(.col-rev) { padding:8px; }
    #vd-motor .est.est > :not(.col-rev) > :is(sipra-eps-visor, sipra-rut-visor, sipra-actas-visor, sipra-camara-visor) { grid-template-columns:1fr; }
    #vd-motor .barra.barra { grid-column:1; justify-self:start; }
  }

`],
  template: '',
})
export class VdPielBahiaComponent {}

/** Inspector continuo, hoja de comparación, información secundaria y barra de decisión. */
@Component({
  selector: 'sipra-vd-piel-inspector',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { hidden: '' },
  styles: [`
  #vd-motor .col-rev.col-rev { display:flex; flex-direction:column; gap:0; padding:18px 20px 20px; counter-reset:vdsec; align-content:normal; border-radius:var(--radius-6);
    background:linear-gradient(90deg, transparent, var(--vd-inspector-edge), transparent) 6px 0 / calc(100% - 12px) 1px no-repeat, var(--vd-inspector);
    border:1px solid var(--vd-inspector-borde); box-shadow:var(--vd-inspector-sombra); }
  #vd-motor .col-rev.col-rev::before { content:"Inspector"; display:block; margin-bottom:20px; font-size:var(--fs-meta); font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--text-secondary); }
  #vd-motor .col-rev.col-rev > * { margin:0; padding:18px 0; border-top:1px solid var(--vd-regla); }
  #vd-motor .col-rev.col-rev > :first-child, #vd-motor .col-rev.col-rev > ul.lectura { border-top:0; padding-top:0; }
  #vd-motor .col-rev.col-rev > .rec, #vd-motor .col-rev.col-rev > .sec { counter-increment:vdsec; }
  #vd-motor .rec.rec .rotulo, #vd-motor .sec.sec > h3, #vd-motor .sec.sec .cab-sec h3 {
    margin:0 0 10px; font-size:var(--fs-meta); font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--text-secondary); }
  #vd-motor .rec.rec .rotulo::before, #vd-motor .sec.sec > h3::before, #vd-motor .sec.sec .cab-sec h3::before {
    content:counter(vdsec, decimal-leading-zero); display:inline-block; width:24px; font-family:var(--fuente-mono); font-weight:500; letter-spacing:0; color:var(--text-muted); }
  #vd-motor .rec.rec { background:transparent; border-radius:0; padding-bottom:16px; }
  #vd-motor .rec.rec .titulo { margin:0; }
  #vd-motor .rec.rec .titulo .etiqueta { display:inline-flex; align-items:center; gap:10px; padding:0 0 0 2px; border:0; background:transparent; font-size:var(--fs-meta); font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
  #vd-motor .rec.rec .titulo .etiqueta > [aria-hidden] { display:none; }
  #vd-motor .rec.rec .titulo .etiqueta::before { content:""; width:9px; height:9px; border-radius:50%; background:currentColor; box-shadow:0 0 8px color-mix(in srgb, currentColor 60%, transparent); }
  #vd-motor .rec.rec .frase { margin:8px 0; font-size:1.25rem; font-weight:600; line-height:25px; letter-spacing:-.015em; color:var(--text-primary); text-wrap:balance; }
  #vd-motor .rec.rec .nota { margin:0; font-size:var(--fs-xs); line-height:19px; color:var(--text-secondary); }
  #vd-motor .rec.rec--ok .etiqueta { color:var(--status-success); }
  #vd-motor .rec.rec--aviso .etiqueta { color:var(--status-review); }
  #vd-motor .rec.rec--peligro .etiqueta { color:var(--text-danger); }
  #vd-motor .rec.rec--peligro::after { content:""; display:block; height:2px; margin-top:14px; background:linear-gradient(90deg, var(--signal-critical), transparent 85%);
    box-shadow:0 0 10px color-mix(in srgb, var(--signal-critical) 25%, transparent); animation:vd-linea-critica 1.4s ease-out 1; }
  @keyframes vd-linea-critica { 0% { opacity:.55; } 40% { opacity:1; } 100% { opacity:.9; } }
  #vd-motor .col-rev.col-rev > ul.lectura { margin-top:-6px; padding-bottom:16px; gap:2px 14px; font-size:var(--fs-meta); color:var(--text-muted); }
  #vd-motor .sec.sec h4 { margin:14px 0 6px; font-size:var(--fs-meta); font-weight:500; color:var(--text-muted); }
  #vd-motor .sec.sec :is(.qr, .pista, .nota) { font-size:var(--fs-meta); color:var(--text-muted); }
  #vd-motor table.cmp.cmp { display:table; width:calc(100% + 8px); margin:0 -4px; table-layout:fixed; border-collapse:separate; border-spacing:0; overflow:hidden;
    font-size:var(--fs-xs); color:#071923; background:var(--vd-hoja); border:1px solid rgb(7 25 35 / .14); border-radius:var(--radius-4); box-shadow:var(--vd-hoja-sombra); }
  #vd-motor table.cmp.cmp thead { display:table-header-group; position:static; width:auto; height:auto; overflow:visible; clip:auto; }
  #vd-motor table.cmp.cmp tbody { display:table-row-group; }
  #vd-motor table.cmp.cmp tr { display:table-row; padding:0; border:0; }
  #vd-motor table.cmp.cmp :is(th, td) { display:table-cell; width:auto; padding:6px 6px; vertical-align:middle; border:0; border-bottom:1px solid rgb(7 25 35 / .09); grid-column:auto; overflow-wrap:anywhere; }
  #vd-motor table.cmp.cmp tr:last-child > * { border-bottom:0; }
  #vd-motor table.cmp.cmp td[data-etiqueta]::before { content:none; }
  #vd-motor table.cmp.cmp thead th { padding:4px 6px; overflow-wrap:normal; white-space:nowrap; font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:#526a77; }
  #vd-motor table.cmp.cmp th[scope=row] { font-size:var(--fs-xs); font-weight:500; color:#071923; }
  #vd-motor table.cmp.cmp td:not(.td-res) { font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; }
  #vd-motor table.cmp.cmp .c-campo { width:22%; } #vd-motor table.cmp.cmp .c-res { width:21%; }
  #vd-motor table.cmp.cmp .etiqueta { padding:0; gap:3px; border:0; background:transparent; font-size:11px; font-weight:600; color:#3b5560; }
  #vd-motor table.cmp.cmp .etiqueta--ok { color:#0a6a5e; } #vd-motor table.cmp.cmp .etiqueta--aviso { color:#8f5600; }
  #vd-motor table.cmp.cmp .etiqueta--peligro { color:#b8231f; } #vd-motor table.cmp.cmp .etiqueta--info { color:#04688f; }
  #vd-motor table.cmp.cmp :is(.nota, .sin-dato) { color:#3b5560; font-size:11px; }
  #vd-motor table.cmp.cmp .tag-critico { font-size:10px; color:#b8231f; }
  #vd-motor table.cmp.cmp tr.falla-critica > * { background:rgb(184 35 31 / .12); }
  #vd-motor table.cmp.cmp tr.falla > * { background:rgb(242 169 59 / .16); }
  #vd-motor .secundaria.secundaria { padding-top:14px; border-top:1px solid var(--vd-regla); }
  #vd-motor .pestanas.pestanas { gap:16px; margin-bottom:10px; border-bottom:1px solid var(--vd-regla); }
  #vd-motor .pestanas.pestanas button { min-height:36px; padding:0; border-bottom-width:2px; font-size:var(--fs-meta); font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--text-secondary); }
  #vd-motor .pestanas.pestanas button .n { font-family:var(--fuente-mono); letter-spacing:0; color:var(--text-muted); }
  #vd-motor .pestanas.pestanas button.activa { color:var(--text-primary); border-bottom-color:var(--signal-default); }
  #vd-motor :is(ul.filas, ul.eventos) li { padding:8px 0; border-radius:0; background:transparent; border-bottom:1px solid var(--vd-regla); font-size:var(--fs-xs); }
  #vd-motor .info-lista > div { background:transparent; border-radius:0; border-bottom:1px solid var(--vd-regla); }
  #vd-motor .tiempos { font-size:var(--fs-meta); color:var(--text-muted); }
  #vd-motor .barra-decision.barra-decision { flex:none; position:sticky; bottom:0; z-index:6; display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:12px 0 0; padding:12px 20px 18px;
    background:var(--vd-inspector); border:1px solid var(--vd-inspector-borde); border-radius:var(--radius-6); box-shadow:var(--vd-inspector-sombra); }
  #vd-motor .barra-decision.barra-decision :is(.decidida, .pista) { flex:1 1 100%; order:-1; margin:0; font-size:var(--fs-meta); color:var(--text-secondary); }
  #vd-motor .barra-decision.barra-decision button:nth-of-type(3) { order:0; margin:0 auto 0 0; }
  #vd-motor .barra-decision.barra-decision button:nth-of-type(2) { order:2; margin:0; }
  #vd-motor .barra-decision.barra-decision button:nth-of-type(1) { order:3; }
  #vd-motor .barra-decision.barra-decision button { min-height:42px; min-width:112px; padding:0 20px; border-radius:var(--radius-6); font-size:var(--fs-sm); font-weight:500;
    background:transparent; color:var(--text-primary); border:1px solid var(--vd-boton-sec-borde); clip-path:none; box-shadow:none; transform:none; transition:background-color 160ms var(--ease-out), box-shadow 220ms var(--ease-out); }
  #vd-motor .barra-decision.barra-decision button:hover:not(:disabled) { background:var(--vd-boton); }
  #vd-motor .barra-decision.barra-decision button:nth-of-type(3) { min-width:0; padding:0 4px; border-color:transparent; color:var(--text-danger); }
  #vd-motor .barra-decision.barra-decision button:nth-of-type(3):hover:not(:disabled) { background:transparent; text-decoration:underline; }
  #vd-motor .barra-decision.barra-decision button:disabled { opacity:.5; }
  #vd-motor[data-enfasis='aprobar'] .barra-decision.barra-decision button:nth-of-type(1):not(:disabled),
  #vd-motor[data-enfasis='devolver'] .barra-decision.barra-decision button:nth-of-type(2):not(:disabled) {
    min-width:150px; background:var(--action-primary); color:var(--action-on-primary); border-color:transparent; font-weight:600; box-shadow:var(--vd-primario-glow);
    clip-path:polygon(0 0, calc(100% - var(--chaflan)) 0, 100% var(--chaflan), 100% 100%, var(--chaflan) 100%, 0 calc(100% - var(--chaflan))); }
  #vd-motor[data-enfasis='aprobar'] .barra-decision.barra-decision button:nth-of-type(1):not(:disabled):hover,
  #vd-motor[data-enfasis='devolver'] .barra-decision.barra-decision button:nth-of-type(2):not(:disabled):hover { background:var(--action-primary-hover); }
  #vd-motor .barra-decision.barra-decision button:focus-visible { clip-path:none; outline:2px solid var(--foco); outline-offset:2px; }
  @media (width >= 1024px) {
    #vd-motor .est.est { grid-template-columns:minmax(0, 1fr) var(--c-inspector-ancho); flex:1 1 auto; min-height:0; align-items:stretch; }
    #vd-motor .est.est > .col-rev { overflow-y:auto; min-height:0; overscroll-behavior:contain; scrollbar-width:thin; margin-bottom:var(--vd-alto-decision, 74px);
      border-bottom:0; border-radius:var(--radius-6) var(--radius-6) 0 0; box-shadow:none; }
    #vd-motor :has(> .barra-decision :is(.pista, .decidida)) .est.est > .col-rev { --vd-alto-decision:98px; }
    #vd-motor .barra-decision.barra-decision { position:absolute; right:0; bottom:0; width:var(--c-inspector-ancho); min-height:var(--vd-alto-decision, 74px); margin:0; align-content:flex-end;
      border-top:0; border-radius:0 0 var(--radius-6) var(--radius-6); }
    #vd-motor :has(> .barra-decision :is(.pista, .decidida)) > .barra-decision { --vd-alto-decision:98px; }
  }
  @media (width < 1024px) {
    #vd-motor .barra-decision.barra-decision { bottom:calc(var(--alto-nav-movil, 56px) + env(safe-area-inset-bottom, 0px)); }
    #vd-motor .barra-decision.barra-decision button { flex:1 1 0; min-width:0; min-height:44px; padding-inline:8px; }
    #vd-motor .barra-decision.barra-decision button:nth-of-type(3) { flex:0 0 auto; }
    #vd-motor .marco.marco.previa { width:calc(100% - 32px); min-height:clamp(320px, 52dvh, 640px); }
    #vd-motor .col-rev.col-rev { padding:14px 16px; }
  }
  @media (prefers-reduced-motion: reduce) { #vd-motor .rec.rec--peligro::after { animation:none; } #vd-motor .barra-decision.barra-decision button { transition:none; } }
`],
  template: '',
})
export class VdPielInspectorComponent {}

@Component({
  selector: 'sipra-vd-eps',
  standalone: true,
  hostDirectives: [VdTonoDirective],
  host: { id: 'vd-motor' },
  imports: [EpsDetalleComponent],
  providers: [EpsMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sipra-eps-detalle />`,
})
export class VdEpsComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(EpsMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.caso.decision}|${d.acceso.reserva.estado}|${d.caso.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

@Component({
  selector: 'sipra-vd-acta',
  standalone: true,
  hostDirectives: [VdTonoDirective],
  host: { id: 'vd-motor' },
  imports: [ActasDetalleComponent],
  providers: [ActasMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sipra-actas-detalle />`,
})
export class VdActaComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(ActasMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.cargarMotivos(); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.estado}|${d.reserva.estado}|${d.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

@Component({
  selector: 'sipra-vd-rut',
  standalone: true,
  hostDirectives: [VdTonoDirective],
  host: { id: 'vd-motor' },
  imports: [RutDetalleComponent],
  providers: [RutMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sipra-rut-detalle />`,
})
export class VdRutComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(RutMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.cargarMotivos(); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.estado}|${d.reserva.estado}|${d.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

@Component({
  selector: 'sipra-vd-camara',
  standalone: true,
  hostDirectives: [VdTonoDirective],
  host: { id: 'vd-motor' },
  imports: [CamaraDetalleComponent],
  providers: [CamaraMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sipra-camara-detalle />`,
})
export class VdCamaraComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(CamaraMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.cargarMotivos(); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.estado}|${d.reserva.estado}|${d.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

/**
 * Documento SIN motor especializado: PDF (por el enlace del flujo general, pedido solo al pulsar), estado, versión y las acciones del
 * flujo general únicamente si el servidor dice que la persona puede decidir. No aplica EPS, RUT, Cámara ni Actas.
 */
@Component({
  selector: 'sipra-vd-general',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .fila { display:flex; flex-wrap:wrap; gap:var(--sp-2); align-items:center; }
    dl.datos { display:grid; grid-template-columns:max-content 1fr; gap:var(--sp-1) var(--sp-3); margin:var(--sp-2) 0; }
    dl.datos dt { color:var(--texto-tenue); } dl.datos dd { margin:0; }
  `],
  template: `
    @let d = documento();
    <section aria-labelledby="vd-gen-titulo" data-vd-general>
      <h3 id="vd-gen-titulo" style="margin:0">{{ d.nombreHumano }}</h3>
      <dl class="datos">
        <dt>Estado</dt><dd>{{ d.estadoHumanoEtiqueta }}</dd>
        <dt>Versión</dt><dd>{{ d.version ?? '—' }}@if (d.versionesAnteriores > 0) { <span class="pista"> · {{ d.versionesAnteriores }} anterior(es)</span> }</dd>
        <dt>Revisión</dt><dd>Flujo general (este documento no tiene un motor de validación especializado).</dd>
      </dl>
      @if (d.documentoId) {
        <div class="fila">
          <button type="button" class="boton compacto" [disabled]="abriendo()" (click)="abrir(d.documentoId)">Abrir el documento</button>
          @if (enlace(); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer" data-vd-enlace>Abrir en una pestaña nueva</a> }
        </div>
      }
      @if (!d.operable) {
        <p class="pista" role="note">Su perfil puede ver este documento, pero no decidirlo.</p>
      } @else if (d.puedeDecidir && d.documentoId) {
        <div class="campo" style="margin-top:var(--sp-3)">
          <label for="vd-gen-just">Justificación de la decisión (mínimo 10 caracteres)</label>
          <input id="vd-gen-just" type="text" [ngModel]="justificacion()" (ngModelChange)="justificacion.set($event)" />
        </div>
        <div class="acciones">
          <button type="button" class="boton compacto" [disabled]="!valida() || guardando()" (click)="decidir(d.documentoId, 'aprobar')">Aprobar</button>
          <button type="button" class="boton compacto" [disabled]="!valida() || guardando()" (click)="decidir(d.documentoId, 'devolver')">Devolver al estudiante</button>
          <button type="button" class="boton compacto boton--peligro" [disabled]="!valida() || guardando()" (click)="decidir(d.documentoId, 'rechazar')">Rechazar</button>
        </div>
      }
    </section>
  `,
})
export class VdGeneralComponent {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly documento = input.required<DocumentoDeExpediente>();
  readonly cambio = output<void>();
  readonly enlace = signal<string | null>(null);
  readonly abriendo = signal(false);
  readonly guardando = signal(false);
  readonly justificacion = signal('');

  constructor() {
    effect(() => { this.documento(); untracked(() => this.enlace.set(null)); });
  }

  valida(): boolean { return this.justificacion().trim().length >= 10; }

  async abrir(id: string): Promise<void> {
    this.abriendo.set(true);
    try { this.enlace.set((await firstValueFrom(this.api.enlaceDocumento(id))).url); } catch (e) { this.avisos.error(traducirErrorEps(e)); } finally { this.abriendo.set(false); }
  }

  async decidir(id: string, decision: 'aprobar' | 'devolver' | 'rechazar'): Promise<void> {
    this.guardando.set(true);
    try {
      await firstValueFrom(this.api.decidirDocumento(id, decision, this.justificacion().trim()));
      this.justificacion.set('');
      this.avisos.exito('Decisión registrada.');
      this.cambio.emit();
    } catch (e) {
      this.avisos.error(traducirErrorEps(e));
      this.cambio.emit();
    } finally {
      this.guardando.set(false);
    }
  }
}
