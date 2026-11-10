import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ItemExpediente } from '@core/models/validacion-documental.model';
import { VdColaComponent } from './vd-cola.component';
import { VdCargandoComponent, VdEstadoComponent } from './vd-estados.component';
import { VdActaComponent, VdCamaraComponent, VdEpsComponent, VdGeneralComponent, VdPielBahiaComponent, VdPielInspectorComponent, VdPielNormalComponent, VdRutComponent } from './vd-motores.component';
import { VdProgresoComponent } from './vd-progreso.component';
import { VdSignalRailComponent } from './vd-signal-rail.component';
import { VdSupervisionComponent } from './vd-supervision.component';
import { ValidacionDocumentalEstado } from './vd.estado';
import { chipReserva } from './vd.senal';
import { NOMBRE_MOTOR, filtrosAvanzadosActivos, textoReservaDocumento } from './vd.util';

/** Por debajo de este ancho, al abrir un expediente la cola se pliega (la persona la vuelve a abrir cuando quiera). */
const ANCHO_COLA_PLEGADA = 1280;

/**
 * Mesa de Validación Documental (V3 · Hybrid Signal / Arctic Signal). La entidad operativa es ESTUDIANTE + PRÁCTICA: la persona abre
 * un expediente y revisa su paquete completo en el mismo lugar. La pantalla solo ORQUESTA: la cola, el progreso y los estados humanos
 * los entrega la API (que consulta a los motores); el resultado, la reserva y la decisión de cada documento los resuelve el componente de
 * SU motor. Composición: Operations Feed (cola) · encabezado del expediente · Document Signal rail con el progreso · documento activo
 * (bahía del visor + inspector + barra de decisión, que son de cada motor y aquí solo se reubican y reestilizan).
 */
@Component({
  selector: 'sipra-validacion-documental',
  standalone: true,
  imports: [FormsModule, VdColaComponent, VdEstadoComponent, VdCargandoComponent, VdProgresoComponent, VdSignalRailComponent, VdEpsComponent, VdActaComponent, VdRutComponent, VdCamaraComponent, VdGeneralComponent, VdPielBahiaComponent, VdPielInspectorComponent, VdPielNormalComponent, VdSupervisionComponent],
  providers: [ValidacionDocumentalEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    /* Oscuro: el tenue de Figma (#8CA6A4) queda en 4,50:1 sobre la cola con bloom; se aclara lo mínimo para ≥ 4.5:1 medido. */
    :host-context([data-theme="dark"]) { --text-muted:#94aeac; }
    .sr { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    .cuerpo { position:relative; display:grid; grid-template-columns:minmax(0, 1fr); align-items:start; min-width:0; }
    .rot { margin:0; font-size:var(--fs-meta); font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--text-secondary); }
    .mono { font-family:var(--fuente-mono); font-weight:500; }
    .bt { display:inline-flex; align-items:center; gap:6px; min-height:32px; padding:0 14px; border-radius:var(--radius-6); border:1px solid var(--vd-boton-borde); background:var(--vd-boton);
      color:var(--text-primary); font:inherit; font-size:var(--fs-xs); font-weight:500; cursor:pointer; white-space:nowrap; transition:border-color var(--motion-fast) var(--ease-out); }
    .bt:hover:not(:disabled), .lnk:hover { border-color:var(--signal-default); color:var(--text-primary); }
    .bt:disabled { opacity:.5; cursor:default; }
    .bt:focus-visible, .lnk:focus-visible, .kpi:focus-visible, .filtrar:focus-visible { outline:2px solid var(--foco); outline-offset:2px; }
    .lnk { display:inline-flex; align-items:center; gap:4px; min-height:26px; padding:0 8px; border:1px solid transparent; border-radius:var(--radius-4); background:transparent; color:var(--text-secondary);
      font:inherit; font-size:var(--fs-meta); font-weight:500; cursor:pointer; white-space:nowrap; transition:border-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out); }
    .lnk.sig { color:var(--status-available); }
    :host-context([data-theme="light"]) .lnk.sig { color:#03587a; }

    /* ── Operations Feed (Figma F1: 340 × 1008, x 76) ── */
    .p-cola { position:relative; min-width:0; display:flex; flex-direction:column; background:var(--vd-feed); border-radius:var(--radius-6); }
    .p-cola::before { content:""; position:absolute; left:6px; right:6px; top:0; height:1px; background:linear-gradient(90deg, transparent, var(--vd-edge), transparent); }
    .cola-cab { display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding:18px 20px 0; }
    .cola-cab h2 { margin:0; font-size:var(--fs-xs); line-height:17px; font-weight:600; letter-spacing:.02em; }
    .cuenta { font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; color:var(--text-secondary); }
    .buscar { position:relative; margin:14px 16px 0; }
    .buscar > svg { position:absolute; left:10px; top:10px; width:16px; height:16px; color:var(--text-muted); pointer-events:none; }
    svg.i { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
    .buscar input { font:inherit; width:100%; min-height:36px; margin:0; padding:0 40px 0 34px; border-radius:var(--radius-6); border:1px solid var(--vd-campo-borde); background:var(--vd-campo); font-size:var(--fs-xs); color:var(--text-primary); }
    .buscar input::placeholder { color:var(--text-muted); opacity:1; }
    .filtrar { position:absolute; right:3px; top:3px; width:30px; height:30px; display:grid; place-items:center; padding:0; border:0; border-radius:var(--radius-4); background:transparent; color:var(--text-secondary); cursor:pointer; }
    .filtrar svg { width:16px; height:16px; }
    .filtrar[aria-expanded='true'], .filtrar:hover { color:var(--text-primary); background:var(--vd-boton); }
    .filtrar .n { position:absolute; right:0; top:0; min-width:14px; height:14px; padding:0 3px; border-radius:7px; background:var(--signal-default); color:var(--text-inverse); font:600 10px/14px var(--fuente-mono); }
    .kpis { display:flex; gap:14px; margin:14px 16px 0; padding-bottom:9px; border-bottom:1px solid var(--vd-regla); overflow-x:auto; scrollbar-width:none; }
    .kpi { position:relative; flex:none; display:inline-flex; align-items:baseline; gap:4px; padding:0; border:0; background:transparent; color:var(--text-secondary); font:inherit; font-size:var(--fs-xs); line-height:17px; font-weight:500; cursor:pointer; }
    .kpi .n { font-family:var(--fuente-mono); font-size:11px; color:var(--text-muted); }
    .kpi .r { width:14px; height:14px; align-self:center; }
    .kpi::after { content:""; position:absolute; left:0; right:0; bottom:-5px; height:2px; border-radius:1px; background:var(--signal-default); box-shadow:0 0 6px color-mix(in srgb, var(--signal-default) 60%, transparent);
      transform:scaleX(0); transform-origin:left; transition:transform var(--motion-fast) var(--ease-out); }
    .kpi:hover, .kpi[aria-pressed='true'] { color:var(--text-primary); }
    .kpi[aria-pressed='true'] { font-weight:600; } .kpi[aria-pressed='true']::after { transform:scaleX(1); }
    .kpis::-webkit-scrollbar { display:none; }
    .mas { display:grid; gap:8px 10px; grid-template-columns:1fr 1fr; align-items:end; margin:10px 16px 0; padding:12px; border-radius:var(--radius-6); background:var(--vd-campo); border:1px solid var(--vd-regla); }
    .mas[hidden] { display:none; }
    .mas .campo { margin:0; gap:3px; } .mas .campo > label { font-size:var(--fs-meta); font-weight:500; color:var(--text-secondary); }
    .mas select { min-height:32px; padding:2px 8px; font-size:var(--fs-xs); background:var(--vd-campo); border-color:var(--vd-campo-borde); }
    .marcas { grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:2px 14px; border:0; padding:0; margin:0; font-size:var(--fs-meta); color:var(--text-secondary); }
    .marcas legend { padding:0 0 2px; } .marcas label { display:inline-flex; gap:6px; align-items:center; min-height:26px; }
    .orden { margin:0; padding:9px 20px 8px; font-size:var(--fs-meta); line-height:16px; color:var(--text-muted); }
    .cola-lista { min-height:0; }
    .cola-pie { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 14px 12px 20px; font-size:var(--fs-meta); color:var(--text-muted); }
    .cola-pie span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cola-pie div { display:flex; flex:none; }
    @media (pointer:coarse) { .kpi, .lnk { min-height:44px; } .mas select { min-height:44px; } }

    /* ── Espacio de trabajo: encabezado + Document Signal + documento activo ── */
    .ws { position:relative; min-width:0; display:flex; flex-direction:column; }
    .p-vacio { display:none; }
    .p-exp { min-width:0; padding:14px 0 0; }
    .error { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin:0 0 8px; padding:10px 14px; border-radius:var(--radius-6); background:var(--status-critical-subtle); }
    .enc { display:flex; align-items:flex-start; justify-content:space-between; gap:8px 24px; }
    .enc > div:first-child { flex:1 1 20rem; min-width:0; }
    .kicker { display:flex; gap:11px; align-items:baseline; margin:0; }
    .kicker .mono { font-size:var(--fs-meta); color:var(--text-muted); }
    .enc h2 { margin:2px 0 1px; font-size:1.875rem; line-height:39px; font-weight:600; letter-spacing:-.02em; overflow-wrap:anywhere; }
    .meta { margin:0; font-size:var(--fs-sm); line-height:18px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .meta2 { display:flex; flex-wrap:nowrap; overflow:hidden; white-space:nowrap; gap:0 14px; margin:3px 0 0; font-size:var(--fs-meta); line-height:16px; color:var(--text-muted); }
    .meta2 { -webkit-mask-image:linear-gradient(90deg, #000 calc(100% - 24px), transparent); mask-image:linear-gradient(90deg, #000 calc(100% - 24px), transparent); }
    .meta2 > div { flex:none; display:inline-flex; gap:6px; } .meta2 > div + div::before { content:"·"; margin-right:8px; color:var(--text-muted); } .meta2 dt { font-weight:500; } .meta2 dd { margin:0; color:var(--text-primary); }
    .enc-der { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:flex-end; margin-top:-2px; }
    .chip-reserva { display:inline-flex; align-items:center; gap:6px; min-height:32px; padding:0 14px 0 12px; font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; white-space:nowrap;
      color:var(--vd-reserva-texto); background:var(--vd-reserva); clip-path:polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px); }
    .chip-reserva svg { width:14px; height:14px; }
    .chip-reserva[data-tono='otro'] { color:var(--text-secondary); background:var(--vd-boton); }
    .chip-reserva[data-tono='vencida'] { color:var(--text-danger); background:var(--status-critical-subtle); }
    .senal { display:grid; grid-template-columns:minmax(0, 1fr) auto; column-gap:24px; margin-top:20px; }
    .senal-cab { display:flex; align-items:center; gap:4px 12px; min-width:0; height:16px; }
    .senal-cab .rot { color:var(--text-muted); flex:none; }
    .nav { display:flex; gap:2px; align-items:center; margin-left:auto; }
    .senal sipra-vd-signal-rail { grid-column:1; min-width:0; }
    .senal sipra-vd-progreso { grid-column:2; grid-row:1 / span 2; align-self:start; }
    .versiones { position:relative; }
    .versiones ul { position:absolute; right:0; top:calc(100% + 6px); z-index:12; width:min(30rem, 86vw); margin:0; padding:10px 14px 10px 28px; list-style:disc; font-size:var(--fs-sm);
      background:var(--surface-overlay); border:1px solid var(--border-default); border-radius:var(--radius-8); box-shadow:var(--shadow-floating); }
    .solo-estrecho { display:none; }
    .p-doc { min-width:0; display:flex; flex-direction:column; padding:4px 0 0; }
    .doc-cuerpo { min-width:0; display:flex; flex-direction:column; flex:1 1 auto; min-height:0; }
    .aviso-doc { margin:0; padding:16px 20px; border-radius:var(--radius-6); background:var(--vd-inspector); border:1px solid var(--vd-inspector-borde); font-size:var(--fs-sm); color:var(--text-secondary); }
    .aviso-doc strong { color:var(--text-primary); }
    .supervision { position:absolute; inset:0; z-index:20; overflow:auto; padding:20px 24px; background:var(--surface-overlay); border-radius:var(--radius-6); }
    .supervision .cerrar { margin-bottom:8px; }

    /* Cambio de expediente: el espacio sube y aparece (220 ms); cambio de documento: cruza con 6 px de desplazamiento (180 ms). */
    @keyframes vd-ent-exp-a { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
    @keyframes vd-ent-exp-b { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
    @keyframes vd-ent-doc-a { from { opacity:0; transform:translateX(6px); } to { opacity:1; transform:none; } }
    @keyframes vd-ent-doc-b { from { opacity:0; transform:translateX(6px); } to { opacity:1; transform:none; } }
    .ent-exp-0 { animation:vd-ent-exp-a var(--motion-default) var(--ease-out) both; } .ent-exp-1 { animation:vd-ent-exp-b var(--motion-default) var(--ease-out) both; }
    .ent-doc-0 { animation:vd-ent-doc-a 180ms var(--ease-out) both; } .ent-doc-1 { animation:vd-ent-doc-b 180ms var(--ease-out) both; }
    @media (prefers-reduced-motion: reduce) { .ent-exp-0, .ent-exp-1, .ent-doc-0, .ent-doc-1 { animation:none; } .kpi::after, .bt, .lnk { transition:none; } }

    /* ≥ 1024: estación de alto completo (Figma 1440 × 1024): cola 340 px, 24 px de calle, márgenes 8/16/8/12. */
    @media (width >= 1024px) {
      .cuerpo { grid-template-columns:var(--c-cola-ancho) minmax(0, 1fr); column-gap:24px; padding:8px 16px 8px 12px; min-height:calc(100dvh - var(--alto-cinta, 0px)); align-items:start; }
      .cuerpo.cola-no { grid-template-columns:minmax(0, 1fr); padding-left:24px; }
      .cuerpo.cola-no .p-cola { display:none; }
      /* La cola acompaña al desplazamiento (sticky, alto del viewport) y desplaza su propia lista. */
      .p-cola { position:sticky; top:calc(var(--alto-cinta, 0px) + 8px); height:calc(100dvh - var(--alto-cinta, 0px) - 16px); min-height:0; overflow:hidden; }
      .cola-lista { flex:1 1 auto; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--text-primary) 22%, transparent) transparent; }
      .ws { min-height:0; }
      /* Mesa del documento a alto completo: bahía e inspector usan todo el viewport tras desplazar el encabezado. */
      .p-doc { flex:none; height:calc(100dvh - var(--alto-cinta, 0px) - 16px); min-height:520px; }
      .p-vacio { display:grid; place-items:center; height:100%; }
      .cuerpo:not(.sin-exp) .p-vacio { display:none; }
    }
    @media (width >= 1024px) and (height < 820px) { .enc h2 { font-size:1.5rem; line-height:30px; } .senal { margin-top:10px; } .meta2 { display:none; } }
    @media (width >= 900px) and (width < 1024px) {
      .cuerpo { gap:12px; padding:12px; }
      .cuerpo.cola-no .p-cola { display:none; }
      .p-cola { max-height:min(60dvh, 28rem); }
      .cola-lista { overflow-y:auto; }
      .cuerpo.sin-exp .p-vacio { display:grid; }
    }
    @media (width < 900px) { .solo-ancho { display:none !important; } }
    /* < 900: una cosa a la vez (cola → expediente → documento); la barra de decisión queda fija sobre la barra inferior. */
    @media (width < 900px) {
      .cuerpo { padding:8px; gap:8px; }
      .cuerpo.v-cola .p-exp, .cuerpo.v-cola .p-doc, .cuerpo.v-cola .p-vacio { display:none; }
      .cuerpo.v-expediente .p-cola, .cuerpo.v-expediente .p-doc, .cuerpo.v-documento .p-cola, .cuerpo.v-documento .p-exp { display:none; }
      .p-exp { padding:8px 4px; } .p-doc { padding:0 0 96px; }
      .enc { flex-direction:column; } .enc h2 { font-size:1.5rem; line-height:30px; }
      .senal { grid-template-columns:minmax(0, 1fr); }
      .senal sipra-vd-progreso { grid-column:1; grid-row:auto; order:-1; padding-bottom:8px; margin-bottom:8px; border-bottom:1px solid var(--vd-regla); }
      .senal-cab { height:auto; flex-wrap:wrap; }
      .nav { margin-left:0; flex-wrap:wrap; }
      .solo-estrecho { display:inline-flex; }
      .lnk, .bt { min-height:44px; }
      .supervision { position:static; margin:12px 0; z-index:auto; }
    }
  `],
  template: `
    <sipra-vd-piel-bahia /><sipra-vd-piel-inspector /><sipra-vd-piel-normal />
    <div class="cuerpo v-{{ estado.vista() }}" [class.sin-exp]="!estado.practicaId()" [class.cola-no]="!!estado.practicaId() && !estado.colaVisible()">
      <!-- OPERATIONS FEED: la cola de expedientes -->
      <section class="p-cola" aria-labelledby="vd-cola-titulo">
        <h1 class="sr">Validación documental</h1>
        <header class="cola-cab">
          <h2 id="vd-cola-titulo">Cola operativa</h2>
          <span class="cuenta" role="status">{{ estado.items().length }} {{ estado.items().length === 1 ? 'expediente' : 'expedientes' }}</span>
        </header>

        <div class="buscar" role="search" aria-label="Filtros de la cola">
          <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20 20" /></svg>
          <label for="vd-buscar" class="sr">Buscar estudiante</label>
          <input id="vd-buscar" type="search" autocomplete="off" placeholder="Buscar estudiante" [ngModel]="filtros().buscar ?? ''" (ngModelChange)="estado.buscar($event)" />
          <button type="button" class="filtrar" [attr.aria-expanded]="masAbierto()" aria-controls="vd-mas" [attr.aria-label]="'Más filtros' + (avanzados() > 0 ? ' (' + avanzados() + ' activos)' : '')" (click)="masAbierto.set(!masAbierto())">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>@if (avanzados() > 0) { <span class="n" aria-hidden="true">{{ avanzados() }}</span> }
          </button>
        </div>

        @if (estado.listado(); as l) {
          <div class="kpis" role="group" aria-label="Indicadores de la cola">
            <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'todos'" (click)="estado.elegirVista('todos')">Todos <span class="n">{{ l.kpis.expedientes }}</span></button>
            <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'pendientes'" (click)="estado.elegirVista('pendientes')">Pendientes <span class="n">{{ l.kpis.conPendientes }}</span></button>
            <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'problemas'" (click)="estado.elegirVista('problemas')">Problemas <span class="n">{{ l.kpis.conProblemas }}</span></button>
            <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'mis_documentos'" (click)="estado.elegirVista('mis_documentos')"><span aria-hidden="true">Míos</span><span class="sr">Mis documentos</span> <span class="n">{{ l.kpis.misDocumentos }}</span></button>
            <button type="button" class="kpi" [attr.aria-pressed]="vistaActual() === 'por_vencer'" (click)="estado.elegirVista('por_vencer')" title="Reservas por vencer"><svg class="i r" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8.5a4.5 4.5 0 019 0V11M6 11h12v8.5H6z" /></svg><span class="sr">Reservas por vencer</span> <span class="n">{{ l.kpis.reservasPorVencer }}</span></button>
          </div>
        }

        <div class="mas" id="vd-mas" [hidden]="!masAbierto()">
          <div class="campo"><label for="vd-estado">Estado del expediente</label>
            <select id="vd-estado" [ngModel]="filtros().estado ?? ''" (ngModelChange)="estado.aplicarFiltros({ estado: $event })">
              <option value="">Todos</option><option value="abiertos">Abiertos</option><option value="completos">Con la documentación completa</option>
            </select></div>
          <div class="campo"><label for="vd-reserva">Reservas</label>
            <select id="vd-reserva" [ngModel]="filtros().reserva ?? ''" (ngModelChange)="estado.aplicarFiltros({ reserva: $event })">
              <option value="">Todas</option><option value="mias">Reservados por mí</option><option value="libres">Sin reserva</option>
            </select></div>
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
          <div class="campo"><button type="button" class="bt" (click)="estado.limpiarFiltros()">Limpiar filtros</button></div>
          <fieldset class="marcas"><legend>Solo expedientes</legend>
            <label><input type="checkbox" [checked]="filtros().conPendientes === 'si'" (change)="estado.aplicarFiltros({ conPendientes: marcado($event) })" /> con pendientes</label>
            <label><input type="checkbox" [checked]="filtros().conDiscrepancias === 'si'" (change)="estado.aplicarFiltros({ conDiscrepancias: marcado($event) })" /> con discrepancias</label>
            <label><input type="checkbox" [checked]="filtros().conDevueltos === 'si'" (change)="estado.aplicarFiltros({ conDevueltos: marcado($event) })" /> con devueltos</label>
            <label><input type="checkbox" [checked]="filtros().ocr === 'si'" (change)="estado.aplicarFiltros({ ocr: marcado($event) })" /> con OCR o información insuficiente</label>
          </fieldset>
        </div>
        <p class="orden">Orden: reenvíos · críticos · antigüedad</p>

        <div class="cola-lista">
          <sipra-vd-cola [items]="estado.items()" [activo]="estado.practicaId()" [cargando]="estado.cargando()" [hayListado]="!!estado.listado()"
                         [error]="estado.errorListado()" [truncado]="!!estado.listado()?.truncado" (abrir)="abrir($event)" (reintentar)="estado.cargar()" />
        </div>
        <footer class="cola-pie">
          @if (estado.listado(); as l) { <span data-por-revisar>{{ l.kpis.documentosPorRevisar }} por revisar</span> } @else { <span></span> }
          <div>
            <button type="button" class="lnk" [disabled]="estado.cargando()" (click)="estado.cargar()">Actualizar</button>
            @if (estado.esSupervisor()) {
              <button type="button" class="lnk" [attr.aria-expanded]="supervisionAbierta()" (click)="alternarSupervision()">{{ supervisionAbierta() ? 'Ocultar supervisión' : 'Supervisión' }}</button>
            }
          </div>
        </footer>
      </section>

      <div class="ws">
        @if (estado.practicaId()) {
          <!-- EXPEDIENTE: encabezado compacto + Document Signal con el progreso -->
          <section [class]="'p-exp ent-exp-' + paridadExpediente()" aria-labelledby="vd-exp-titulo">
            @if (estado.errorExpediente(); as e) {
              <div class="error" role="alert">{{ e }} <button type="button" class="bt" (click)="cerrar()">← Cola de expedientes</button></div>
            }
            @if (estado.expediente(); as e) {
              <header class="enc">
                <div>
                  <p class="kicker"><span class="rot">Expediente</span><span class="mono" [attr.title]="e.encabezado.practicaId">{{ idCorto(e.encabezado.practicaId) }} · {{ e.encabezado.periodo }}</span></p>
                  <h2 id="vd-exp-titulo">{{ e.encabezado.estudiante.nombre }}</h2>
                  <p class="meta" [attr.title]="e.encabezado.modalidadEtiqueta + ' · ' + (e.encabezado.empresa ?? 'Sin empresa registrada')">{{ e.encabezado.modalidadEtiqueta }} · {{ e.encabezado.empresa ?? 'Sin empresa registrada' }}</p>
                  <dl class="meta2">
                    <div><dt>Documento</dt><dd class="mono">{{ e.encabezado.estudiante.documentoEnmascarado }}</dd></div>
                    <div><dt>Escuela</dt><dd>{{ e.encabezado.escuelaId }}</dd></div>
                    <div><dt>Docente</dt><dd>{{ e.encabezado.docente ?? 'Sin asignar' }}</dd></div>
                    <div><dt>Práctica</dt><dd>{{ e.encabezado.estadoPractica }}</dd></div>
                  </dl>
                </div>
                <div class="enc-der">
                  @if (reservaActiva(); as r) {
                    <span class="chip-reserva" [attr.data-tono]="r.tono" role="status">
                      <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8.5a4.5 4.5 0 019 0V11M6 11h12v8.5H6z" /></svg>{{ r.texto }}</span>
                  }
                  <button type="button" class="bt" (click)="cerrar()">← Cola de expedientes</button>
                  <button type="button" class="bt solo-ancho" (click)="alternarCola()" [attr.aria-pressed]="estado.colaVisible()">{{ estado.colaVisible() ? 'Ocultar la cola' : 'Mostrar la cola' }}</button>
                </div>
              </header>
              <div class="senal">
                <div class="senal-cab">
                  <p class="rot">Document Signal</p>
                  <div class="nav" data-vd-nav>
                    <button type="button" class="lnk solo-estrecho" (click)="estado.volver()">← Documentos</button>
                    <button type="button" class="lnk" (click)="estado.navegar('anterior')">Documento anterior</button>
                    <button type="button" class="lnk" (click)="estado.navegar('siguiente')">Documento siguiente</button>
                    <button type="button" class="lnk sig" (click)="estado.navegar('pendiente')">Siguiente pendiente</button>
                    @if (estado.documentoActivo(); as d) {
                      @if (d.documentoId && d.versionesAnteriores > 0) {
                        <div class="versiones" data-vd-versiones>
                          <button type="button" class="lnk" (click)="estado.cargarVersiones(d.tipoDocumento)">Ver versiones anteriores ({{ d.versionesAnteriores }})</button>
                          @if (estado.versiones(); as v) {
                            @if (v.tipo === d.tipoDocumento) {
                              <ul>@for (x of v.items; track x.documentoId) { <li>Versión {{ x.version }}{{ x.vigente ? ' (vigente)' : ' (histórica)' }} · {{ x.estadoHumanoEtiqueta }}@if (x.motivoDevolucion) { · {{ x.motivoDevolucion }} }</li> }</ul>
                            }
                          }
                        </div>
                      }
                    }
                  </div>
                </div>
                <sipra-vd-signal-rail [documentos]="e.documentos" [activo]="estado.tipoActivo()" [expediente]="e.encabezado.practicaId" (elegir)="elegir($event)" />
                <sipra-vd-progreso [progreso]="e.progreso" />
              </div>
            } @else if (estado.cargandoExpediente()) {
              <sipra-vd-cargando role="status"><p>Cargando expediente…</p></sipra-vd-cargando>
            }
          </section>

          <!-- DOCUMENTO ACTIVO: bahía del visor + inspector + decisión (de cada motor) -->
          <section class="p-doc" aria-label="Documento activo">
            @if (estado.documentoActivo(); as d) {
              <div [class]="'doc-cuerpo ent-doc-' + paridadDocumento()">
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
                  <sipra-vd-estado [tipo]="d.estadoHumano === 'procesando' ? 'procesando' : 'sin-pendientes'" role="status">
                    <h3>{{ d.estadoHumano === 'procesando' ? 'Procesando documento' : d.nombreHumano }}</h3>
                    <p>{{ d.estadoHumanoEtiqueta }}. El documento todavía no tiene un resultado de validación para mostrar.</p>
                  </sipra-vd-estado>
                } @else {
                  @switch (d.motor) {
                    @case ('eps') { <sipra-vd-eps [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                    @case ('acta') { <sipra-vd-acta [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                    @case ('rut') { <sipra-vd-rut [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                    @case ('camara') { <sipra-vd-camara [validacionId]="d.validacionId" (cambio)="estado.actualizarTrasAccion()" /> }
                  }
                }
              </div>
            } @else if (estado.expediente()?.progreso?.completo) {
              <sipra-vd-estado tipo="aprobado"><h3>Todo aprobado</h3><p>Los documentos obligatorios de este expediente están aprobados.</p></sipra-vd-estado>
            } @else {
              <p class="pista">Elija un documento del Document Signal para revisarlo aquí.</p>
            }
          </section>
        } @else {
          <section class="p-vacio" aria-label="Expediente">
            <sipra-vd-estado tipo="sin-expediente">
              <h3>Sin expediente abierto</h3>
              <p>Elija un expediente de la cola para revisar su paquete documental completo. Puede pasar de un documento al siguiente sin volver a buscar al estudiante.</p>
            </sipra-vd-estado>
          </section>
        }

        @if (supervisionAbierta()) {
          <div class="supervision">
            <button type="button" class="bt cerrar" (click)="alternarSupervision()">Cerrar el panel</button>
            <sipra-vd-supervision (abrir)="abrirDesdeSupervision($event)" />
          </div>
        }
      </div>
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
  /** Reserva del documento activo (chip del encabezado). */
  protected readonly reservaActiva = computed(() => chipReserva(this.estado.documentoActivo()?.reserva));
  /** Alternan 0/1 en cada cambio de expediente o de documento: reinician la animación de entrada sin recrear el DOM. */
  protected readonly paridadExpediente = signal(0);
  protected readonly paridadDocumento = signal(0);

  protected readonly motor = (m: string): string => NOMBRE_MOTOR[m] ?? m;
  protected readonly idCorto = (id: string): string => id.slice(0, 8);
  protected reserva(d: { reserva: Parameters<typeof textoReservaDocumento>[0] }): string { return textoReservaDocumento(d.reserva); }

  constructor() {
    // La URL manda: /validacion-documental/:practicaId?doc=<tipo>. La pantalla se sincroniza con ella.
    effect(() => {
      const id = this.params()?.get('practicaId') ?? null;
      const doc = this.consulta()?.get('doc') ?? null;
      untracked(() => {
        if (!id) { if (this.estado.practicaId()) this.estado.cerrarExpediente(); return; }
        if (this.estado.practicaId() !== id) {
          if (typeof window !== 'undefined' && window.innerWidth < ANCHO_COLA_PLEGADA) this.estado.colaVisible.set(false);
          void this.estado.abrirExpediente(id, doc);
        } else if (doc && doc !== this.estado.tipoActivo()) {
          this.estado.seleccionarDocumento(doc);
        }
      });
    });
    effect(() => { this.estado.practicaId(); untracked(() => this.paridadExpediente.update((v) => 1 - v)); });
    effect(() => { this.estado.tipoActivo(); untracked(() => this.paridadDocumento.update((v) => 1 - v)); });
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
