import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { SesionService } from '@core/auth/sesion.service';
import { CargaSenalComponent } from '@shared/components/carga-senal.component';
import { EstadoVacioComponent } from '@shared/components/estado-vacio.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesDetalleComponent } from './reportes-detalle.component';
import { ReportesDocumentosComponent } from './reportes-documentos.component';
import { ReportesEstudiantesComponent } from './reportes-estudiantes.component';
import { ReportesExportacionesComponent } from './reportes-exportaciones.component';
import { ReportesGeneralComponent } from './reportes-general.component';
import { ReportesPeriodosComponent } from './reportes-periodos.component';
import { hayDatos } from './reportes-analitica.util';
import { PestanaReportes, ReportesEstado } from './reportes.estado';

/** Perfiles que consultan la analítica (los mismos del servidor). Extensión solo ve las exportaciones regulatorias. */
export const ROLES_ANALITICA = ['administrador', 'coordinador', 'auxiliar', 'tutor'];

export const PESTANAS: readonly { id: PestanaReportes; texto: string }[] = [
  { id: 'general', texto: 'General' },
  { id: 'estudiantes', texto: 'Estudiantes' },
  { id: 'documentos', texto: 'Documentos' },
  { id: 'periodos', texto: 'Períodos' },
  { id: 'exportaciones', texto: 'Exportaciones' },
];

/**
 * Reportes V3 · inteligencia operativa de prácticas. Solo datos reales de SIPRA, calculados en el servidor con las
 * mismas reglas del Expediente. El periodo es el eje principal; los demás filtros van en divulgación progresiva.
 * Las exportaciones existentes (Excel del SGP y archivos del SPE) quedan en su propia pestaña, sin cambios.
 */
@Component({
  selector: 'sipra-reportes',
  standalone: true,
  imports: [
    DatePipe, EtiquetaPipe, CargaSenalComponent, EstadoVacioComponent, ReportesGeneralComponent, ReportesEstudiantesComponent,
    ReportesDocumentosComponent, ReportesPeriodosComponent, ReportesDetalleComponent, ReportesExportacionesComponent,
  ],
  providers: [ReportesEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --rp-regla: var(--vd-regla, var(--border-subtle)); }
    :host-context([data-theme='dark']) { --text-muted: #94aeac; }
    .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .cabecera { display: flex; flex-wrap: wrap; gap: 8px 32px; align-items: flex-end; justify-content: space-between; animation: entra 200ms var(--ease-out) both; }
    .kicker { margin: 0; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .cabecera h1 { margin: 2px 0; font: 600 24px/30px var(--fuente); letter-spacing: -.02em; color: var(--text-primary); }
    .ayuda { margin: 0; max-width: 92ch; font-size: 13px; line-height: 20px; color: var(--text-secondary); }
    .sello { font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    :host-context([data-theme='light']) .sello, :host-context([data-theme='light']) .actualizando { color: var(--text-secondary); }

    .herramientas { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 14px 0 0; padding: 10px 0; border-top: 1px solid var(--rp-regla); border-bottom: 1px solid var(--rp-regla); }
    .rotulo { font: 600 11px/16px var(--fuente); letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary); }
    .periodos { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; flex: 1 1 420px; }
    .chip { height: 30px; padding: 0 12px; font: 500 13px/1 var(--fuente-mono); color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 15px; cursor: pointer; transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out); }
    .chip:hover { border-color: var(--border-strong); }
    .chip[aria-pressed='true'] { color: var(--text-inverse); background: var(--signal-active); border-color: transparent; font-weight: 600; }
    .bt { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; font: 500 13px/1 var(--fuente); color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; transition: border-color 160ms var(--ease-out); }
    .bt:hover { border-color: var(--border-strong); }
    .bt[aria-expanded='true'] { border-color: color-mix(in srgb, var(--signal-active) 60%, var(--border-strong)); }
    .bt:disabled { opacity: .55; cursor: default; }
    .bt svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .contador { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: inline-grid; place-items: center; font: 600 11px/1 var(--fuente-mono); color: var(--text-inverse); background: var(--signal-active); }
    .chip:focus-visible, .bt:focus-visible, .ctl:focus-visible, [role='tab']:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    .panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 10px 16px; padding: 12px 0; border-bottom: 1px solid var(--rp-regla); }
    .panel label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .ctl { height: 36px; padding: 0 8px; font: inherit; font-size: 13px; font-weight: 400; color: var(--text-primary); background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }

    .pestanas { display: flex; gap: 2px; margin: 16px 0 20px; border-bottom: 1px solid var(--border-default); overflow-x: auto; scrollbar-width: none; }
    [role='tab'] { position: relative; flex: none; height: 40px; padding: 0 14px; font: 500 14px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; cursor: pointer; }
    [role='tab']:hover { color: var(--text-primary); }
    [role='tab'][aria-selected='true'] { color: var(--text-primary); font-weight: 600; }
    [role='tab'][aria-selected='true']::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; background: var(--signal-active); }
    .actualizando { margin: -12px 0 12px; font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    .error { display: grid; justify-items: start; gap: 10px; padding: 24px 0; }
    .error strong { font-size: 15px; color: var(--text-primary); }
    .error span { font-size: 13px; color: var(--text-secondary); }
    @keyframes entra { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { .cabecera { animation: none; } .chip, .bt { transition: none; } }
    @media (width < 700px) { .cabecera h1 { font-size: 21px; line-height: 28px; } [role='tab'] { padding: 0 10px; font-size: 13px; } }
  `],
  template: `
    <header class="cabecera">
      <div>
        <p class="kicker">Inteligencia operativa</p>
        <h1>Reportes</h1>
        <p class="ayuda">Cifras reales del proceso de prácticas dentro de su alcance. Estudiantes se cuentan una vez; los documentos, una vez por obligación exigida.</p>
      </div>
      @if (estado.datos(); as r) { <span class="sello">Calculado {{ r.generadoEn | date: 'yyyy-MM-dd HH:mm' : '-0500' }} · hora de Colombia</span> }
    </header>

    @if (analitica()) {
      <div class="herramientas" role="group" aria-label="Filtros del reporte">
        <div class="periodos" role="group" aria-labelledby="rp-per">
          <span class="rotulo" id="rp-per">Periodo</span>
          <button type="button" class="chip" [attr.aria-pressed]="estado.filtros().periodos.length === 0" (click)="estado.filtrar({ periodos: [] })">Todos</button>
          @for (p of estado.opciones().periodos; track p) {
            <button type="button" class="chip" [attr.aria-pressed]="estado.filtros().periodos.includes(p)" (click)="estado.alternarPeriodo(p)">{{ p }}</button>
          }
        </div>
        <button type="button" class="bt" [attr.aria-expanded]="panel()" aria-controls="rp-filtros" (click)="panel.set(!panel())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros
          @if (otrosActivos()) { <span class="contador" [attr.aria-label]="otrosActivos() + ' activos'">{{ otrosActivos() }}</span> }
        </button>
        <button type="button" class="bt" [disabled]="!estado.activos()" (click)="estado.limpiar()">Limpiar</button>
      </div>
      <div class="panel" id="rp-filtros" [hidden]="!panel()">
        <label for="rp-escuela">Escuela
          <select id="rp-escuela" class="ctl" [value]="estado.filtros().escuela" (change)="estado.filtrar({ escuela: valor($event) })">
            <option value="">Todas</option>
            @for (e of estado.opciones().escuelas; track e.codigo) { <option [value]="e.codigo" [selected]="e.codigo === estado.filtros().escuela">{{ e.nombre }}</option> }
          </select></label>
        <label for="rp-programa">Programa
          <select id="rp-programa" class="ctl" [value]="estado.filtros().programa" (change)="estado.filtrar({ programa: valor($event) })">
            <option value="">Todos</option>
            @for (p of estado.programas(); track p) { <option [value]="p" [selected]="p === estado.filtros().programa">{{ p }}</option> }
          </select></label>
        <label for="rp-modalidad">Modalidad
          <select id="rp-modalidad" class="ctl" [value]="estado.filtros().modalidad" (change)="estado.filtrar({ modalidad: valor($event) })">
            <option value="">Todas</option>
            @for (m of estado.opciones().modalidades; track m) { <option [value]="m" [selected]="m === estado.filtros().modalidad">{{ m | etiqueta }}</option> }
          </select></label>
        <label for="rp-estado">Estado de la práctica
          <select id="rp-estado" class="ctl" [value]="estado.filtros().estado" (change)="estado.filtrar({ estado: valor($event) })">
            <option value="">Todos</option>
            @for (s of estado.opciones().estados; track s) { <option [value]="s" [selected]="s === estado.filtros().estado">{{ s | etiqueta }}</option> }
          </select></label>
      </div>
    }

    <div class="pestanas" role="tablist" aria-label="Vistas del reporte">
      @for (p of pestanas(); track p.id) {
        <button type="button" role="tab" [id]="'tab-' + p.id" [attr.aria-selected]="estado.pestana() === p.id" [attr.aria-controls]="'vista-' + p.id"
                [attr.tabindex]="estado.pestana() === p.id ? 0 : -1" (click)="estado.pestana.set(p.id)" (keydown)="teclado($event)">{{ p.texto }}</button>
      }
    </div>

    <div role="tabpanel" [id]="'vista-' + estado.pestana()" [attr.aria-labelledby]="'tab-' + estado.pestana()" tabindex="0">
      @if (estado.pestana() === 'exportaciones') {
        <sipra-reportes-exportaciones />
      } @else if (estado.error() && !estado.datos()) {
        <div class="error" role="alert">
          <strong>No fue posible calcular el reporte</strong>
          <span>{{ estado.error() }}. Los datos no se perdieron: vuelva a intentarlo.</span>
          <button type="button" class="bt" (click)="estado.cargar()">Reintentar</button>
        </div>
      } @else if (!estado.datos()) {
        <sipra-carga-senal texto="Calculando el reporte…" />
      } @else if (!conDatos()) {
        @if (estado.activos()) {
          <sipra-estado-vacio titulo="Sin prácticas para estos filtros" texto="Ninguna práctica de su alcance cumple la combinación elegida.">
            <button type="button" class="bt" (click)="estado.limpiar()">Limpiar filtros</button>
          </sipra-estado-vacio>
        } @else {
          <sipra-estado-vacio titulo="Aún no hay prácticas en su alcance" texto="Cuando se registren prácticas en sus escuelas, aquí verá su avance documental y su evolución por periodo." />
        }
      } @else {
        @if (estado.cargando()) { <p class="actualizando" role="status">Actualizando…</p> }
        @if (estado.error(); as e) { <p class="actualizando" role="alert">No se pudo actualizar ({{ e }}). Se muestran las cifras anteriores. <button type="button" class="bt" (click)="estado.cargar()">Reintentar</button></p> }
        @switch (estado.pestana()) {
          @case ('general') { <sipra-reportes-general /> }
          @case ('estudiantes') { <sipra-reportes-estudiantes /> }
          @case ('documentos') { <sipra-reportes-documentos /> }
          @case ('periodos') { <sipra-reportes-periodos /> }
        }
        <sipra-reportes-detalle />
      }
    </div>
  `,
})
export class ReportesComponent implements OnInit {
  protected readonly estado = inject(ReportesEstado);
  private readonly sesion = inject(SesionService);

  protected readonly panel = signal(false);
  protected readonly analitica = computed(() => ROLES_ANALITICA.includes(this.sesion.rol() ?? ''));
  protected readonly pestanas = computed(() => (this.analitica() ? PESTANAS : PESTANAS.filter((p) => p.id === 'exportaciones')));
  protected readonly conDatos = computed(() => hayDatos(this.estado.datos()));
  protected readonly otrosActivos = computed(() => { const f = this.estado.filtros(); return [f.escuela, f.programa, f.modalidad, f.estado].filter(Boolean).length; });

  ngOnInit(): void {
    if (this.analitica()) void this.estado.cargar();
    else this.estado.pestana.set('exportaciones');
  }

  protected valor(evento: Event): string { return (evento.target as HTMLSelectElement).value; }

  /** Pestañas ARIA: flechas, Inicio y Fin mueven la selección y el foco. */
  protected teclado(evento: KeyboardEvent): void {
    const lista = this.pestanas();
    const actual = lista.findIndex((p) => p.id === this.estado.pestana());
    const destino = { ArrowRight: actual + 1, ArrowLeft: actual - 1, Home: 0, End: lista.length - 1 }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    const p = lista[(destino + lista.length) % lista.length];
    this.estado.pestana.set(p.id);
    document.getElementById(`tab-${p.id}`)?.focus();
  }
}
