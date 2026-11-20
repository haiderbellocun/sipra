import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { FiltrosCumplimiento, TableroCumplimiento } from '@core/models/modelos';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { EstadoVacioComponent } from '@shared/components/estado-vacio.component';
import { TiraMetricasComponent } from '@shared/components/tira-metricas.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { CumplimientoTablaComponent } from './cumplimiento-tabla.component';
import { CumplimientoTiposComponent } from './cumplimiento-tipos.component';
import { CATEGORIAS, FILTROS_VACIOS, fechaHora, filtrosActivos, fraccionCumplidas, metricasCumplimiento, textoAlcance } from './cumplimiento.util';

/**
 * Cumplimiento V3. Monitorea obligaciones, vencimientos y casos que requieren atención.
 * Todo lo calcula el servidor en GET /cumplimiento/tablero (alcance G1, filtros, categorías, días, orden y paginación):
 * esta pantalla solo presenta. No duplica Reportes (analítica) ni Inicio (resumen) ni el expediente (acción: abrirlo).
 */
@Component({
  selector: 'sipra-cumplimiento',
  standalone: true,
  imports: [FormsModule, EsqueletoComponent, EstadoVacioComponent, TiraMetricasComponent, EtiquetaPipe, CumplimientoTablaComponent, CumplimientoTiposComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --peligro: var(--status-critical); }
    :host-context([data-theme='light']) { --peligro: #b8231f; }
    :host-context([data-theme='dark']) { --text-muted: #94aeac; }
    .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .cabecera { display: flex; gap: 8px 32px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; animation: entra 200ms var(--ease-out) both; }
    .kicker { margin: 0; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    h1 { margin: 2px 0; font: 600 24px/30px var(--fuente); letter-spacing: -.02em; color: var(--text-primary); }
    .ayuda { margin: 0; font-size: 13px; line-height: 20px; color: var(--text-secondary); }
    .ctx { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; padding: 0; list-style: none; font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    .ctx b { font-weight: 500; color: var(--text-secondary); }
    .herr { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0 0; padding: 8px 0; border-top: 1px solid var(--vd-regla, var(--border-subtle)); border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); }
    .buscar { position: relative; flex: 1 1 260px; max-width: 360px; }
    .buscar svg { position: absolute; left: 11px; top: 11px; width: 16px; height: 16px; fill: none; stroke: var(--text-muted); stroke-width: 1.8; stroke-linecap: round; }
    .ctl { height: 38px; padding: 0 10px; font: inherit; font-size: 13px; color: var(--text-primary); max-width: 100%;
      background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }
    .buscar .ctl { width: 100%; padding-left: 34px; }
    select.ctl { flex: 1 1 170px; max-width: 230px; padding-right: 28px; min-width: 0; }
    .ctl:hover { border-color: var(--border-strong); }
    .ctl:focus-visible, .bt:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .bt { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; font: 500 13px/1 var(--fuente); cursor: pointer;
      color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; }
    .bt:hover { border-color: var(--border-strong); background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    .bt:disabled { opacity: .55; cursor: default; }
    .bt.primario { color: var(--text-inverse); background: var(--signal-active); border-color: transparent; font-weight: 600; }
    .conteo { margin-left: auto; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .tira { margin: 14px 0 0; }
    .frac { margin: 8px 0 0; font-size: 13px; color: var(--text-secondary); }
    .frac b { font: 600 13px/18px var(--fuente-mono); color: var(--text-primary); }
    .bloq { margin: 14px 0 0; padding: 10px 14px; font-size: 13px; line-height: 20px; color: var(--text-primary); border-left: 3px solid var(--peligro);
      background: color-mix(in srgb, var(--peligro) 8%, transparent); }
    section { scroll-margin-top: 120px; margin-top: 26px; animation: entra 200ms var(--ease-out) 40ms both; }
    h2 { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    h2 .n { font: 500 12px/16px var(--fuente-mono); letter-spacing: 0; color: var(--text-muted); }
    .nota { margin: 8px 0 0; font-size: 12px; color: var(--text-secondary); }
    .pag { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 10px; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    details { margin-top: 26px; border-top: 1px solid var(--vd-regla, var(--border-subtle)); padding-top: 12px; }
    summary { cursor: pointer; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    summary:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    dl { display: grid; grid-template-columns: minmax(0, 240px) minmax(0, 1fr); gap: 8px 20px; margin: 12px 0 0; font-size: 13px; }
    dt { font-weight: 600; color: var(--text-primary); } dt small { display: block; font-weight: 400; font-size: 11px; color: var(--text-muted); }
    dd { margin: 0; color: var(--text-secondary); }
    .error { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-top: 18px; padding: 12px 14px; border-left: 3px solid var(--peligro); font-size: 13px; color: var(--text-primary); }
    [aria-busy='true'] { opacity: .6; transition: opacity 160ms var(--ease-out); }
    @media (width < 700px) {
      .buscar { max-width: none; flex-basis: 100%; }
      .herr select.ctl { flex: 1 1 calc(50% - 4px); max-width: none; }
      .conteo { margin-left: 0; flex-basis: 100%; }
      dl { grid-template-columns: 1fr; gap: 2px; } dd { margin-bottom: 8px; }
    }
    @keyframes entra { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .cabecera, section { animation: none; } }
  `],
  template: `
    <header class="cabecera">
      <div>
        <p class="kicker">Operación</p>
        <h1>Cumplimiento</h1>
        <p class="ayuda">Monitorea obligaciones, vencimientos y casos que requieren atención.</p>
      </div>
      @if (tablero(); as t) {
        <ul class="ctx" aria-label="Contexto del cálculo">
          <li>Alcance <b>{{ alcance() }}</b></li>
          <li>Periodo <b>{{ t.filtros.periodo ?? 'Todos' }}</b></li>
          <li>Calculado <b><time [attr.datetime]="t.generadoEn">{{ calculado() }}</time></b></li>
        </ul>
      }
    </header>

    @if (tablero(); as t) {
      <form class="herr" role="search" aria-label="Filtrar obligaciones" (submit)="$event.preventDefault(); aplicar()">
        <div class="buscar">
          <label for="c-busqueda" class="sr">Buscar estudiante</label>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg>
          <input id="c-busqueda" name="busqueda" class="ctl" type="search" maxlength="80" [(ngModel)]="borrador.busqueda" placeholder="Buscar estudiante: nombre o documento" />
        </div>
        <select class="ctl" name="periodo" aria-label="Periodo" [(ngModel)]="borrador.periodo" (ngModelChange)="aplicar()">
          <option value="">Todos los periodos</option>
          @for (p of t.opciones.periodos; track p) { <option [value]="p">{{ p }}</option> }
        </select>
        @if (t.opciones.escuelas.length > 1 || borrador.escuela) {
          <select class="ctl" name="escuela" aria-label="Escuela" [(ngModel)]="borrador.escuela" (ngModelChange)="aplicar()">
            <option value="">Todas las escuelas</option>
            @for (e of t.opciones.escuelas; track e.codigo) { <option [value]="e.codigo">{{ e.nombre }}</option> }
          </select>
        }
        <select class="ctl" name="programa" aria-label="Programa" [(ngModel)]="borrador.programa" (ngModelChange)="aplicar()">
          <option value="">Todos los programas</option>
          @for (p of t.opciones.programas; track p) { <option [value]="p">{{ p }}</option> }
        </select>
        <select class="ctl" name="tipo" aria-label="Tipo de obligación" [(ngModel)]="borrador.tipo" (ngModelChange)="aplicar()">
          <option value="">Todos los tipos</option>
          @for (o of t.opciones.tipos; track o.tipo) { <option [value]="o.tipo">{{ o.tipo | etiqueta }}</option> }
        </select>
        <select class="ctl" name="estado" aria-label="Estado de la obligación" [(ngModel)]="borrador.estado" (ngModelChange)="aplicar()">
          <option value="">Todos los estados</option>
          @for (c of categorias; track c.valor) { <option [value]="c.valor">{{ c.etiqueta }}</option> }
        </select>
        <button type="submit" class="bt primario" [disabled]="cargando()">Buscar</button>
        @if (activos() > 0) { <button type="button" class="bt" (click)="limpiar()">Limpiar</button> }
        <span class="conteo" aria-live="polite">{{ t.listado.total }} obligación(es)</span>
      </form>
    }

    @if (error(); as e) {
      <div class="error" role="alert">
        <span>{{ e }}</span>
        <button type="button" class="bt" (click)="cargar()">Reintentar</button>
      </div>
    }

    @if (!tablero() && cargando()) {
      <sipra-esqueleto class="tira" tipo="cifras" [cantidad]="5" />
      <section aria-hidden="true"><sipra-esqueleto tipo="filas" [cantidad]="6" /></section>
    } @else if (tablero(); as t) {
      <div [attr.aria-busy]="cargando()">
        @if (t.indicadores.aplicables === 0 && t.indicadores.noAplica === 0) {
          <section>
            @if (activos() > 0) {
              <sipra-estado-vacio titulo="Sin obligaciones para estos filtros" texto="Ninguna obligación de su alcance coincide con el filtro.">
                <button type="button" class="bt" (click)="limpiar()">Limpiar filtros</button>
              </sipra-estado-vacio>
            } @else {
              <sipra-estado-vacio titulo="Sin obligaciones en su alcance" texto="Las obligaciones se crean al abrirse cada práctica. Cuando existan, su estado aparecerá aquí." />
            }
          </section>
        } @else {
          <sipra-tira-metricas class="tira compacta" [metricas]="metricas()" etiqueta="Indicadores de cumplimiento del filtro" />
          <p class="frac"><b>{{ fraccion() }}</b>@if (t.indicadores.noAplica > 0) { · {{ t.indicadores.noAplica }} marcadas «no aplica» (fuera del cálculo) }</p>
          @if (t.practicasBloqueadas > 0) {
            <p class="bloq"><strong>{{ t.practicasBloqueadas }}</strong> práctica(s) detenidas en validación por la compuerta de afiliación a ARL (Decreto 055 de 2015): ninguna puede activarse hasta registrar la afiliación con fecha anterior al inicio.</p>
          }

          <section aria-labelledby="c-tipos">
            <h2 id="c-tipos">Cumplimiento por tipo de obligación</h2>
            <sipra-cumplimiento-tipos [tablero]="t" />
          </section>

          <section aria-labelledby="c-atencion">
            <h2 id="c-atencion">Requiere atención <span class="n">{{ t.atencion.total }}</span></h2>
            @if (t.atencion.total === 0) {
              <sipra-estado-vacio titulo="Nada requiere atención" texto="No hay obligaciones vencidas ni próximas a vencer (10 días o menos) en este filtro." />
            } @else {
              <sipra-cumplimiento-tabla [filas]="t.atencion.filas" titulo="Obligaciones que requieren atención: vencidas primero, luego próximas a vencer" />
              @if (t.atencion.total > t.atencion.filas.length) {
                <p class="nota">Se muestran las {{ t.atencion.filas.length }} más urgentes de {{ t.atencion.total }}. Use el filtro de estado para recorrer el resto en el listado.</p>
              }
            }
          </section>

          <section aria-labelledby="c-listado">
            <h2 id="c-listado">Listado de obligaciones <span class="n">{{ t.listado.total }}</span></h2>
            @if (t.listado.total === 0) {
              <sipra-estado-vacio titulo="Sin obligaciones en este estado" texto="Cambie el filtro de estado para ver otras obligaciones." />
            } @else {
              <sipra-cumplimiento-tabla [filas]="t.listado.filas" titulo="Listado de obligaciones del filtro, en orden operativo" />
              @if (t.listado.paginas > 1) {
                <nav class="pag" aria-label="Paginación del listado">
                  <button type="button" class="bt" [disabled]="cargando() || t.listado.pagina <= 1" (click)="irAPagina(t.listado.pagina - 1)">Anterior</button>
                  <span aria-live="polite">Página {{ t.listado.pagina }} de {{ t.listado.paginas }}</span>
                  <button type="button" class="bt" [disabled]="cargando() || t.listado.pagina >= t.listado.paginas" (click)="irAPagina(t.listado.pagina + 1)">Siguiente</button>
                </nav>
              }
            }
          </section>
        }

        <details>
          <summary>Catálogo de obligaciones</summary>
          <dl>
            @for (o of t.opciones.tipos; track o.tipo) { <dt>{{ o.tipo | etiqueta }}<small>{{ o.norma }}</small></dt><dd>{{ o.descripcion }}</dd> }
          </dl>
        </details>
      </div>
    }
  `,
})
export class CumplimientoComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly tablero = signal<TableroCumplimiento | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  /** Filtros aplicados (los que produjeron `tablero`) y borrador del formulario. */
  readonly aplicados = signal<FiltrosCumplimiento>({ ...FILTROS_VACIOS });
  borrador: FiltrosCumplimiento = { ...FILTROS_VACIOS };
  protected readonly categorias = CATEGORIAS;
  private solicitud = 0;

  readonly metricas = computed(() => { const t = this.tablero(); return t ? metricasCumplimiento(t) : []; });
  readonly fraccion = computed(() => { const t = this.tablero(); return t ? fraccionCumplidas(t.indicadores) : ''; });
  readonly alcance = computed(() => { const t = this.tablero(); return t ? textoAlcance(t.alcance) : ''; });
  readonly calculado = computed(() => { const t = this.tablero(); return t ? fechaHora(t.generadoEn) : ''; });
  readonly activos = computed(() => filtrosActivos(this.aplicados()));

  ngOnInit(): void { void this.cargar(); }

  aplicar(): void {
    this.aplicados.set({ ...this.borrador, pagina: 1 });
    void this.cargar();
  }

  limpiar(): void {
    this.borrador = { ...FILTROS_VACIOS };
    this.aplicar();
  }

  irAPagina(pagina: number): void {
    this.aplicados.update((f) => ({ ...f, pagina }));
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const id = ++this.solicitud;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const t = await firstValueFrom(this.api.tableroCumplimientoV3(this.aplicados()));
      if (id !== this.solicitud) return; // respuesta vieja: la descarta
      this.tablero.set(t);
    } catch {
      if (id !== this.solicitud) return;
      this.error.set('No fue posible consultar el tablero de cumplimiento.');
    } finally {
      if (id === this.solicitud) this.cargando.set(false);
    }
  }
}
