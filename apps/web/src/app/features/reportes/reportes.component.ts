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
import { ReportesOrganizacionesComponent } from './reportes-organizaciones.component';
import { ReportesPeriodosComponent } from './reportes-periodos.component';
import { SIN_EMPRESA, hayDatos, migas, nivel, semestre } from './reportes-analitica.util';
import { num } from './reportes-graficos.util';

/** Nombre del contexto inicial en dev sintético (los periodos los entrega el servidor). */
export const ROTULO_DATASET = 'Dataset v4';
import { PestanaReportes, ReportesEstado } from './reportes.estado';

/** Perfiles que consultan la analítica (los mismos del servidor). Extensión solo ve las exportaciones regulatorias. */
export const ROLES_ANALITICA = ['administrador', 'coordinador', 'auxiliar', 'tutor'];

export const PESTANAS: readonly { id: PestanaReportes; texto: string }[] = [
  { id: 'general', texto: 'General' },
  { id: 'estudiantes', texto: 'Estudiantes' },
  { id: 'organizaciones', texto: 'Organizaciones' },
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
    ReportesDocumentosComponent, ReportesOrganizacionesComponent, ReportesPeriodosComponent, ReportesDetalleComponent, ReportesExportacionesComponent,
  ],
  providers: [ReportesEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --rp-regla: var(--vd-regla, var(--border-subtle)); }
    :host-context([data-theme='dark']) { --text-muted: #94aeac; }
    .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    /* Encabezado de una línea: el título del Shell ya nombra la vista; aquí solo identidad, definición corta y sello. */
    .cabecera { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; animation: entra 200ms var(--ease-out) both; }
    /* El título visible lo pone la barra de la aplicación («Reportes»): el h1 queda para lectores de pantalla, sin duplicarlo. */
    .cabecera h1 { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .ayuda { margin: 0; flex: 1 1 360px; font-size: 13px; line-height: 20px; color: var(--text-secondary); }
    .sello { font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    :host-context([data-theme='light']) .sello { color: var(--text-secondary); }

    .herramientas { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 8px 0 0; padding: 8px 0; border-top: 1px solid var(--rp-regla); border-bottom: 1px solid var(--rp-regla); }
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

    /* Pestañas y estado en la misma fila: recalcular no desplaza el contenido. */
    .barra-pestanas { display: flex; align-items: center; gap: 12px; margin: 10px 0 16px; border-bottom: 1px solid var(--border-default); }
    .pestanas { display: flex; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
    .estado-linea { margin-left: auto; flex: none; display: flex; gap: 8px; align-items: center; min-height: 34px; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    [role='tabpanel'] { transition: opacity 140ms var(--ease-out); }
    [role='tabpanel'].recalculando { opacity: .6; }
    [role='tab'] { position: relative; flex: none; height: 40px; padding: 0 14px; font: 500 14px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; cursor: pointer; }
    [role='tab']:hover { color: var(--text-primary); }
    [role='tab'][aria-selected='true'] { color: var(--text-primary); font-weight: 600; }
    [role='tab'][aria-selected='true']::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; background: var(--signal-active); }
    .contexto { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--rp-regla); }
    .contexto ol { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; padding: 0; list-style: none; flex: 1 1 auto; }
    .contexto li { display: inline-flex; align-items: center; gap: 6px; }
    .contexto li + li::before { content: '/'; color: var(--text-muted); }
    .miga { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 4px 0 10px; font: 500 13px/1 var(--fuente); color: var(--text-primary); background: color-mix(in srgb, var(--signal-active) 12%, transparent); border: 1px solid color-mix(in srgb, var(--signal-active) 45%, transparent); border-radius: 14px; }
    .miga.raiz { padding: 0 10px; background: none; border-color: var(--border-default); cursor: pointer; }
    .miga.raiz:disabled { cursor: default; color: var(--text-secondary); }
    .mr { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); }
    .quitar { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; color: var(--text-secondary); background: none; border: 0; border-radius: 50%; cursor: pointer; }
    .quitar:hover { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 10%, transparent); }
    .quitar svg { width: 10px; height: 10px; stroke: currentColor; stroke-width: 1.8; }
    .quitar:focus-visible, .miga.raiz:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .universo { font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .universo.dev { font-family: var(--fuente); color: var(--text-muted); }
    :host-context([data-theme='light']) .universo.dev { color: var(--text-secondary); }
    .chip.preset { font-family: var(--fuente); }

    .error { display: grid; justify-items: start; gap: 10px; padding: 24px 0; }
    .error strong { font-size: 15px; color: var(--text-primary); }
    .error span { font-size: 13px; color: var(--text-secondary); }
    @keyframes entra { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { .cabecera { animation: none; } .chip, .bt, [role='tabpanel'] { transition: none; } }
    /* Móvil: periodos en una fila desplazable (no una pared de chips); la ayuda larga se oculta. */
    @media (width < 700px) {
      .ayuda { display: none; }
      .periodos { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; flex-basis: 100%; }
      .chip, .periodos .rotulo { flex: none; }
      [role='tab'] { padding: 0 10px; font-size: 13px; }
      .estado-linea { display: none; }
    }
  `],
  template: `
    <header class="cabecera">
      <h1>Reportes</h1>
      <p class="ayuda">Inteligencia operativa de prácticas en su alcance: estudiantes únicos; documentos por obligación exigida.</p>
      @if (estado.datos(); as r) { <span class="sello">Calculado {{ r.generadoEn | date: 'yyyy-MM-dd HH:mm' : '-0500' }} · hora de Colombia</span> }
    </header>

    @if (analitica()) {
      <div class="herramientas" role="group" aria-label="Filtros del reporte">
        <div class="periodos" role="group" aria-labelledby="rp-per">
          <span class="rotulo" id="rp-per">Periodo</span>
          @if (estado.dataset()) {
            <button type="button" class="chip preset" [attr.aria-pressed]="estado.presetActivo()" (click)="estado.aplicarDataset()" title="">{{ rotuloDataset }}</button>
          }
          <button type="button" class="chip" [attr.aria-pressed]="estado.filtros().periodos.length === 0" (click)="estado.filtrar({ periodos: [] })">Todos</button>
          @for (p of estado.opciones().periodos; track p) {
            <button type="button" class="chip" [attr.aria-pressed]="estado.filtros().periodos.includes(p)" (click)="estado.alternarPeriodo(p)">{{ p }}</button>
          }
        </div>
        <button type="button" class="bt" [attr.aria-expanded]="panel()" aria-controls="rp-filtros" (click)="panel.set(!panel())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros
          @if (otrosActivos()) { <span class="contador" [attr.aria-label]="otrosActivos() + ' activos'">{{ otrosActivos() }}</span> }
        </button>
        <button type="button" class="bt" [disabled]="estado.enInicio()" (click)="estado.limpiar()">Limpiar</button>
        @if (estado.datos(); as r) {
          <span class="universo">{{ num(r.resumen.estudiantes) }} de {{ num(r.universo.estudiantes) }} estudiantes en alcance</span>
          @if (contextoDev(); as c) { <span class="universo dev">{{ c }}</span> }
        }
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
            @for (p of estado.programas(); track p) { <option [value]="p" [selected]="p === estado.filtros().programa">{{ estado.nombrePrograma(p) }}</option> }
          </select></label>
        <label for="rp-ciclo">Nivel de formación
          <select id="rp-ciclo" class="ctl" [value]="estado.filtros().ciclo" (change)="estado.filtrar({ ciclo: valor($event) })">
            <option value="">Todos</option>
            @for (c of estado.opciones().ciclos; track c) { <option [value]="c" [selected]="c === estado.filtros().ciclo">{{ nivel(c) }}</option> }
          </select></label>
        @if (estado.datos()?.dimensiones?.semestre === 'sintetica') {
          <label for="rp-semestre">Semestre (sintético)
            <select id="rp-semestre" class="ctl" [value]="estado.filtros().semestre" (change)="estado.filtrar({ semestre: valor($event) })">
              <option value="">Todos</option>
              @for (s of estado.opciones().semestres; track s) { <option [value]="s" [selected]="'' + s === estado.filtros().semestre">{{ semestre(s) }}</option> }
            </select></label>
        }
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
        <label for="rp-receptor">Organización receptora
          <select id="rp-receptor" class="ctl" [value]="estado.filtros().tipoReceptor" (change)="estado.filtrar({ tipoReceptor: valorReceptor($event) })">
            <option value="">Todas</option><option value="interna_cun" [selected]="estado.filtros().tipoReceptor === 'interna_cun'">Interna CUN</option>
            <option value="externa" [selected]="estado.filtros().tipoReceptor === 'externa'">Externa</option>
          </select></label>
        <label for="rp-sector">Sector económico
          <select id="rp-sector" class="ctl" [value]="estado.filtros().sector" (change)="estado.filtrar({ sector: valor($event) })">
            <option value="">Todos</option>
            @for (s of estado.datos()?.sectores ?? []; track s.sector) { @if (s.sector) { <option [value]="s.sector" [selected]="s.sector === estado.filtros().sector">{{ s.nombre }}</option> } }
          </select></label>
        <label for="rp-ciudad">Ciudad
          <select id="rp-ciudad" class="ctl" [value]="estado.filtros().ciudad" (change)="estado.filtrar({ ciudad: valor($event) })">
            <option value="">Todas</option>
            @for (c of estado.datos()?.ciudades ?? []; track c.ciudad) { @if (c.ciudad) { <option [value]="c.ciudad" [selected]="c.ciudad === estado.filtros().ciudad">{{ c.nombre }}</option> } }
          </select></label>
        <label for="rp-empresa">Empresa
          <select id="rp-empresa" class="ctl" [value]="estado.filtros().empresa" (change)="estado.filtrar({ empresa: valor($event) })">
            <option value="">Todas</option>
            @for (e of empresasDelContexto(); track e) { <option [value]="e ?? sinEmpresa" [selected]="(e ?? sinEmpresa) === estado.filtros().empresa">{{ e ?? 'Sin empresa registrada' }}</option> }
          </select></label>
      </div>
      @if (migas().length) {
        <nav class="contexto" aria-label="Contexto del reporte">
          <span class="rotulo">Contexto</span>
          <ol>
            <li><button type="button" class="miga raiz" (click)="estado.limpiar()">Todo el alcance</button></li>
            @for (m of migas(); track m.clave) {
              <li><span class="miga activa" [attr.aria-label]="m.rotulo + ': ' + m.valor"><span class="mr">{{ m.rotulo }}</span> {{ m.valor }}
                <button type="button" class="quitar" [attr.aria-label]="'Quitar ' + m.rotulo + ' ' + m.valor" (click)="estado.quitar(m.clave)"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg></button></span></li>
            }
          </ol>
        </nav>
      }
    }

    <div class="barra-pestanas">
      <div class="pestanas" role="tablist" aria-label="Vistas del reporte">
        @for (p of pestanas(); track p.id) {
          <button type="button" role="tab" [id]="'tab-' + p.id" [attr.aria-selected]="estado.pestana() === p.id" [attr.aria-controls]="'vista-' + p.id"
                  [attr.tabindex]="estado.pestana() === p.id ? 0 : -1" (click)="irA(p.id)" (keydown)="teclado($event)">{{ p.texto }}</button>
        }
      </div>
      <div class="estado-linea" role="status" aria-live="polite">
        @if (estado.cargando() && estado.datos()) { <span>Actualizando…</span> }
        @if (estado.error() && estado.datos()) { <span role="alert">No se pudo actualizar: se muestran las cifras anteriores.</span><button type="button" class="bt" (click)="estado.cargar()">Reintentar</button> }
      </div>
    </div>

    <div role="tabpanel" [id]="'vista-' + estado.pestana()" [attr.aria-labelledby]="'tab-' + estado.pestana()" tabindex="0"
         [class.recalculando]="estado.cargando() && !!estado.datos()" [attr.aria-busy]="estado.cargando()">
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
        @switch (estado.pestana()) {
          @case ('general') { <sipra-reportes-general /> }
          @case ('estudiantes') { <sipra-reportes-estudiantes /> }
          @case ('organizaciones') { <sipra-reportes-organizaciones /> }
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
  protected readonly otrosActivos = computed(() => { const f = this.estado.filtros(); return [f.escuela, f.programa, f.ciclo, f.semestre, f.modalidad, f.estado, f.empresa, f.tipoReceptor, f.sector, f.ciudad].filter(Boolean).length; });
  protected readonly nivel = nivel;
  protected readonly semestre = semestre;
  protected readonly sinEmpresa = SIN_EMPRESA;
  private readonly etiqueta = new EtiquetaPipe();
  protected readonly migas = computed(() => migas(this.estado.filtros(), { escuela: this.estado.nombreEscuela, etiqueta: (v) => this.etiqueta.transform(v), programa: this.estado.nombrePrograma, sector: this.estado.nombreSector, ciudad: this.estado.nombreCiudad })
    .map((m) => (m.clave === 'periodos' && this.estado.presetActivo() ? { ...m, valor: `${ROTULO_DATASET} (${this.estado.filtros().periodos.length} periodos)` } : m)));
  protected readonly rotuloDataset = ROTULO_DATASET;
  protected readonly num = num;
  /**
   * Solo dev sintético: explica la diferencia entre el dataset y «Todos» con un conteo calculado (universo menos las
   * prácticas de los periodos del dataset), nunca un número fijo. En producción no hay `dataset` y no se muestra nada.
   */
  protected readonly contextoDev = computed(() => {
    const r = this.estado.datos(), d = this.estado.dataset();
    if (!r || !d) return '';
    if (this.estado.presetActivo()) return `${ROTULO_DATASET} · ${d.length} periodos`;
    if (this.estado.activos() > 0) return '';
    const enDataset = r.periodos.filter((p) => d.includes(p.periodo)).reduce((n, p) => n + p.practicas, 0);
    const fuera = r.universo.practicas - enDataset;
    return fuera > 0 ? `Todos los datos · incluye ${num(fuera)} práctica${fuera === 1 ? '' : 's'} fuera del ${ROTULO_DATASET}` : 'Todos los datos en alcance';
  });

  ngOnInit(): void {
    if (this.analitica()) void this.estado.cargar();
    else this.estado.pestana.set('exportaciones');
  }

  /** Empresas del universo filtrado (coherentes con receptor, sector y ciudad), más la elegida si ya no aparece. */
  protected readonly empresasDelContexto = computed(() => {
    const lista = (this.estado.datos()?.empresas ?? []).map((e) => e.empresa);
    const elegida = this.estado.filtros().empresa;
    return elegida && !lista.includes(elegida) ? [...lista, elegida] : lista;
  });

  protected valor(evento: Event): string { return (evento.target as HTMLSelectElement).value; }
  protected valorReceptor(evento: Event): '' | 'interna_cun' | 'externa' { return this.valor(evento) as '' | 'interna_cun' | 'externa'; }

  /** Al salir de Estudiantes, su tabla granular (sin recorte documental) no persiste en las demás vistas. */
  protected irA(id: PestanaReportes): void {
    const s = this.estado.segmento();
    if (this.estado.pestana() === 'estudiantes' && id !== 'estudiantes' && s && !s.tipo && !s.estadoDocumental) this.estado.cerrarDetalle();
    this.estado.pestana.set(id);
  }

  /** Pestañas ARIA: flechas, Inicio y Fin mueven la selección y el foco. */
  protected teclado(evento: KeyboardEvent): void {
    const lista = this.pestanas();
    const actual = lista.findIndex((p) => p.id === this.estado.pestana());
    const destino = { ArrowRight: actual + 1, ArrowLeft: actual - 1, Home: 0, End: lista.length - 1 }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    const p = lista[(destino + lista.length) % lista.length];
    this.irA(p.id);
    document.getElementById(`tab-${p.id}`)?.focus();
  }
}
