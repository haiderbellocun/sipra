import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { ModalidadCatalogo, Periodo, Practica } from '@core/models/modelos';
import { CargaSenalComponent } from '@shared/components/carga-senal.component';
import { EstadoVacioComponent } from '@shared/components/estado-vacio.component';
import { SenalEstadoComponent } from '@shared/components/senal-estado.component';
import { MetricaV3, TiraMetricasComponent } from '@shared/components/tira-metricas.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

/** Valores por defecto de los filtros del panel (los de «Limpiar»). */
const FILTROS_INICIALES = {
  busqueda: '', periodo: '', programa: '', regional: '', modalidad: '', estado: '', asignacion: '' as '' | 'asignado' | 'sin_asignacion',
  nivel: '', movimientoDesde: '', movimientoHasta: '', cargadoMinimo: null as number | null, aprobadoMinimo: null as number | null,
  cantidad: 200,
};

/**
 * Gestión de prácticas (SGP, apartado Prácticas) · V3 Operations Workspace: la bandeja con los filtros
 * del manual de coordinación. El alcance se aplica en el servidor; aquí solo se elige qué pedir.
 * Misma consulta, mismos filtros, mismo orden y misma navegación al expediente (enlace del nombre);
 * cambia la presentación: encabezado compacto, franja de cifras del listado, barra de herramientas con
 * filtros en divulgación progresiva y una lista estructurada (tabla) que en móvil se apila por fila.
 * Clases propias: evitan los nombres globales de estilos.css (.tabla, .fila, .campo, .pista, .boton…).
 */
@Component({
  selector: 'sipra-practicas',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, EtiquetaPipe, SenalEstadoComponent, TiraMetricasComponent, CargaSenalComponent, EstadoVacioComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --enlace: var(--signal-default); --peligro: var(--status-critical); }
    :host-context([data-theme="dark"]) { --text-muted: #94aeac; }
    :host-context([data-theme="light"]) { --enlace: #03587a; --peligro: #b8231f; }
    .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .cod { font-family: var(--fuente-mono); }

    /* ── Encabezado compacto ── */
    .cabecera { display: flex; gap: 12px 32px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; animation: entra 200ms var(--ease-out) both; }
    .kicker { margin: 0; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .cabecera h1 { margin: 2px 0 2px; font: 600 24px/30px var(--fuente); letter-spacing: -.02em; color: var(--text-primary); }
    .cabecera .ayuda { margin: 0; max-width: 92ch; font-size: 13px; line-height: 20px; color: var(--text-secondary); }
    .accion {
      display: inline-flex; align-items: center; gap: 10px; min-height: 38px; padding: 0 16px; font: 600 14px/20px var(--fuente);
      color: var(--text-primary); text-decoration: none; border: 1px solid var(--border-strong); border-radius: 6px;
      background: color-mix(in srgb, var(--text-primary) 5%, transparent); transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out);
    }
    .accion:hover { text-decoration: none; border-color: color-mix(in srgb, var(--signal-active) 60%, var(--border-strong)); }
    .accion.primaria { color: var(--text-inverse); background: var(--signal-active); border-color: transparent; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); }

    .tira { margin: 12px 0 0; animation: entra 200ms var(--ease-out) 30ms both; }

    /* ── Barra de herramientas: búsqueda + filtros (divulgación) + señal + acciones + conteo ── */
    .herramientas { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 0; padding: 8px 0; border-top: 1px solid var(--vd-regla, var(--border-subtle)); border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); }
    .buscar { position: relative; flex: 1 1 320px; max-width: 460px; }
    .buscar svg { position: absolute; left: 11px; top: 11px; width: 16px; height: 16px; fill: none; stroke: var(--text-muted); stroke-width: 1.8; stroke-linecap: round; }
    .ctl {
      height: 38px; padding: 0 10px; font: inherit; font-size: 13px; color: var(--text-primary);
      background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px;
      transition: border-color 160ms var(--ease-out);
    }
    .ctl:hover { border-color: var(--border-strong); }
    .ctl:focus-visible, .bt:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .buscar .ctl { width: 100%; padding-left: 34px; }
    select.ctl { padding-right: 28px; }
    .bt {
      display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; font: 500 13px/1 var(--fuente); cursor: pointer;
      color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px;
      transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out);
    }
    .bt:hover { border-color: var(--border-strong); background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    .bt[aria-expanded="true"] { border-color: color-mix(in srgb, var(--signal-active) 60%, var(--border-strong)); }
    .bt.primario { color: var(--text-inverse); background: var(--signal-active); border-color: transparent; font-weight: 600; }
    .bt:disabled { opacity: .55; cursor: default; }
    .bt svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .contador { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: inline-grid; place-items: center; font: 600 11px/1 var(--fuente-mono); color: var(--text-inverse); background: var(--signal-active); }
    .conteo { margin-left: auto; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }

    .panel { display: grid; gap: 12px 16px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); padding: 16px 0 14px; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); animation: abre 180ms var(--ease-out) both; }
    .panel[hidden] { display: none; }
    .panel label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .panel .ctl { width: 100%; }

    /* ── Lista estructurada ── */
    .cabecera + .lista-zona { margin-top: 20px; }
    .lista-zona { margin-top: 8px; min-height: 200px; animation: entra 200ms var(--ease-out) 60ms both; }
    table.lista { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
    .lista thead th { padding: 8px 12px; text-align: left; font: 600 11px/16px var(--fuente); letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary); background: color-mix(in srgb, var(--surface-canvas) 92%, transparent); border-bottom: 1px solid var(--border-default); white-space: nowrap; }
    .lista td { padding: 11px 12px; vertical-align: top; overflow-wrap: normal; word-break: normal; hyphens: manual; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); color: var(--text-primary); }
    .lista tbody tr { position: relative; transition: background 160ms var(--ease-out); }
    .lista tbody tr:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    .lista tbody tr:hover td:first-child { box-shadow: inset 2px 0 0 color-mix(in srgb, var(--signal-active) 70%, transparent); }
    /* Práctica actual del estudiante: borde de señal + tono. */
    .lista tbody tr.actual { background: color-mix(in srgb, var(--signal-active) 7%, transparent); }
    .lista tbody tr.actual td:first-child { box-shadow: inset 2px 0 0 var(--signal-active); }
    .nombre { font-size: 14px; font-weight: 600; line-height: 20px; }
    .nombre a { color: var(--text-primary); text-decoration: none; }
    .nombre a:hover { color: var(--enlace); text-decoration: underline; }
    .nombre a:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; border-radius: 2px; }
    .meta { margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--text-secondary); }
    .meta .cod, .sub .cod { color: var(--text-muted); }
    .sub { margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--text-secondary); }
    .disparo { display: flex; gap: 8px; align-items: baseline; margin-top: 4px; font-size: 12px; line-height: 16px; color: var(--peligro); }
    .disparo::before { content: ""; flex: none; width: 12px; height: 1px; background: currentColor; transform: translateY(-3px); }
    .nw { white-space: nowrap; }

    /* Avance: telemetría compacta (porcentaje mono + microseñal de 40 px). */
    .tel { display: grid; grid-template-columns: 56px 40px auto; align-items: center; gap: 2px 8px; font-size: 12px; line-height: 18px; white-space: nowrap; }
    .tel .tel-et { color: var(--text-secondary); }
    .tel .pista-av { position: relative; height: 3px; border-radius: 2px; background: var(--border-default); overflow: hidden; }
    .tel .pista-av i { position: absolute; inset: 0 auto 0 0; width: var(--p); background: var(--signal-default); border-radius: 2px; }
    .tel .pista-av.ok i { background: var(--status-success); }
    .tel b { font: 500 12px/18px var(--fuente-mono); color: var(--text-primary); }
    .ir { width: 28px; text-align: right; }
    .ir a { display: inline-grid; place-items: center; width: 24px; height: 24px; color: var(--text-muted); text-decoration: none; font: 500 14px/1 var(--fuente-mono); transition: transform 160ms var(--ease-out), color 160ms var(--ease-out); }
    tr:hover .ir a { color: var(--enlace); transform: translateX(2px); }

    @keyframes entra { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes abre { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .cabecera, .tira, .lista-zona, .panel { animation: none; }
      .lista tbody tr, .ir a, .ctl, .bt, .accion { transition: none; }
      tr:hover .ir a { transform: none; }
    }

    /* Tableta: fuera las columnas secundarias; identidad, estado y avance se conservan. */
    @media (width < 1280px) { .lista .c-docente { display: none; } }
    @media (width < 1180px) { .lista .c-periodo { display: none; } }

    /* Móvil: cada práctica es una fila apilada (práctica · estado · contexto · avance · acción). */
    @media (width < 900px) {
      .cabecera h1 { font-size: 22px; line-height: 28px; }
      .buscar { flex-basis: 100%; max-width: none; }
      .conteo { flex-basis: 100%; margin-left: 0; }
      table.lista, .lista tbody { display: block; }
      .lista thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      .lista tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 12px 4px; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); }
      .lista td { display: block; padding: 0; border: 0; }
      .lista .c-estudiante { grid-column: 1; }
      .lista .c-estado { grid-column: 2; grid-row: 1; text-align: right; }
      .lista .c-practica, .lista .c-avance, .lista .c-senal { grid-column: 1 / -1; }
      .lista .c-docente { display: none; }
      .lista .c-periodo { display: flex; gap: 10px; align-items: baseline; grid-column: 1 / -1; font-size: 12px; }
      .lista .c-periodo .sub { margin: 0; }
      .lista .ir { grid-column: 2; grid-row: 1; align-self: end; display: none; }
      .lista tbody tr.actual td:first-child, .lista tbody tr:hover td:first-child { box-shadow: none; }
      .lista tbody tr.actual { box-shadow: inset 2px 0 0 var(--signal-active); padding-left: 10px; }
      .tel { grid-template-columns: auto 40px auto auto 40px auto; justify-content: start; column-gap: 8px; }
      .tel b:nth-of-type(1) { margin-right: 12px; }
    }
  `],
  template: `
    @let interno = sesion.esInterno();
    @let estudiante = sesion.rol() === 'estudiante';
    <header class="cabecera">
      <div>
        <p class="kicker">Prácticas</p>
        <h1>{{ estudiante ? 'Mi práctica' : 'Gestión de prácticas' }}</h1>
        <p class="ayuda">
          @if (estudiante) {
            Su registro del periodo y el avance documental por momentos. Abra el expediente para cargar documentos y hablar con su docente.
          } @else {
            Consulta y validación de los registros del periodo vigente y de los anteriores. El alcance se aplica en el servidor: lo que no le corresponde no llega al navegador.
          }
        </p>
      </div>
      @if (estudiante) {
        <a routerLink="/registro" class="accion primaria">Registrar mi práctica</a>
      } @else if (['coordinador', 'administrador'].includes(sesion.rol() ?? '')) {
        <a routerLink="/registro" class="accion">Registro FUR administrativo</a>
      }
    </header>

    @if (interno) {
      @if (!cargando()) { <sipra-tira-metricas class="tira compacta" [metricas]="metricas()" etiqueta="Cifras del listado" /> }

      <div class="herramientas" role="search" aria-label="Buscar y filtrar prácticas">
        <div class="buscar">
          <label for="f-busqueda" class="sr">Buscar</label>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg>
          <input id="f-busqueda" class="ctl" type="search" [(ngModel)]="f.busqueda" (keyup.enter)="consultar()"
                 placeholder="Documento, correo institucional o nombre del estudiante" />
        </div>
        <button type="button" class="bt" [attr.aria-expanded]="panelAbierto()" aria-controls="filtros-practicas" (click)="panelAbierto.set(!panelAbierto())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filtros
          @if (filtrosActivos(); as n) { <span class="contador" [attr.aria-label]="n + ' filtros activos'">{{ n }}</span> }
        </button>
        <select class="ctl" [ngModel]="filtroSenal()" (ngModelChange)="filtroSenal.set($event)" aria-label="Señal de acompañamiento">
          <option value="">Todas las señales</option>
          <option value="en_riesgo">En riesgo</option>
          <option value="requiere_atencion">Requiere atención</option>
          <option value="al_dia">Al día</option>
        </select>
        <button type="button" class="bt primario" (click)="consultar()" [disabled]="cargando()">Filtrar</button>
        <button type="button" class="bt" (click)="limpiar()">Limpiar</button>
        <span class="conteo" aria-live="polite">{{ visibles().length }} registro(s)</span>
      </div>

      <div class="panel" id="filtros-practicas" [hidden]="!panelAbierto()">
        <label for="f-periodo">Periodo
          <select id="f-periodo" class="ctl" [(ngModel)]="f.periodo">
            <option value="">Todos</option>
            @for (p of periodos(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}</option> }
          </select>
        </label>
        <label for="f-programa">Programa <input id="f-programa" class="ctl" [(ngModel)]="f.programa" placeholder="Código, p. ej. ADM-PRO" /></label>
        <label for="f-regional">Regional <input id="f-regional" class="ctl" [(ngModel)]="f.regional" placeholder="Bogotá, Medellín…" /></label>
        <label for="f-modalidad">Modalidad de práctica
          <select id="f-modalidad" class="ctl" [(ngModel)]="f.modalidad">
            <option value="">Todas</option>
            @for (m of modalidades(); track m.modalidad) { <option [value]="m.modalidad">{{ m.etiquetaSgp }}</option> }
          </select>
        </label>
        <label for="f-estado">Estado
          <select id="f-estado" class="ctl" [(ngModel)]="f.estado">
            <option value="">Todos</option>
            @for (e of estados; track e.valor) { <option [value]="e.valor">{{ e.etiqueta }}</option> }
          </select>
        </label>
        <label for="f-asignacion">Asignación docente
          <select id="f-asignacion" class="ctl" [(ngModel)]="f.asignacion">
            <option value="">Todas</option><option value="asignado">Asignado</option><option value="sin_asignacion">Sin asignación</option>
          </select>
        </label>
        <label for="f-nivel">Nivel de práctica
          <select id="f-nivel" class="ctl" [(ngModel)]="f.nivel">
            <option value="">Todos</option><option value="tecnico">Técnico</option><option value="tecnologo">Tecnólogo</option><option value="profesional">Profesional</option>
          </select>
        </label>
        <label for="f-desde">Movimiento desde <input id="f-desde" class="ctl" type="date" [(ngModel)]="f.movimientoDesde" /></label>
        <label for="f-hasta">Movimiento hasta <input id="f-hasta" class="ctl" type="date" [(ngModel)]="f.movimientoHasta" /></label>
        <label for="f-cargado">% cargados mínimo <input id="f-cargado" class="ctl" type="number" min="0" max="100" [(ngModel)]="f.cargadoMinimo" /></label>
        <label for="f-aprobado">% aprobados mínimo <input id="f-aprobado" class="ctl" type="number" min="0" max="100" [(ngModel)]="f.aprobadoMinimo" /></label>
        <label for="f-cantidad">Cantidad
          <select id="f-cantidad" class="ctl" [(ngModel)]="f.cantidad">
            <option [ngValue]="50">50</option><option [ngValue]="200">200</option><option [ngValue]="500">500</option>
          </select>
        </label>
      </div>
    }

    <section class="lista-zona" aria-label="Listado de prácticas">
      @if (cargando()) {
        <sipra-carga-senal texto="Consultando prácticas…" />
      } @else if (visibles().length === 0) {
        @if (estudiante) {
          <sipra-estado-vacio titulo="Sin práctica registrada" texto="Aún no tiene una práctica registrada en este periodo.">
            <a routerLink="/registro" class="accion primaria" style="margin-top:8px">Registrar mi práctica</a>
          </sipra-estado-vacio>
        } @else if (hayFiltros()) {
          <sipra-estado-vacio titulo="Sin resultados para estos filtros" texto="No hay registros que coincidan con el filtro.">
            <button type="button" class="bt" style="margin-top:8px" (click)="limpiar()">Limpiar filtros</button>
          </sipra-estado-vacio>
        } @else {
          <sipra-estado-vacio titulo="Sin resultados" texto="No hay registros que coincidan con el filtro." />
        }
      } @else {
        <table class="lista">
          <thead>
            <tr>
              <th scope="col" class="c-estudiante">Estudiante</th>
              <th scope="col" class="c-practica">Práctica</th>
              <th scope="col" class="c-periodo">Periodo</th>
              <th scope="col" class="c-docente">Docente</th>
              <th scope="col" class="c-estado">Estado</th>
              <th scope="col" class="c-avance">Cargados / aprobados</th>
              @if (interno) { <th scope="col" class="c-senal">Señal</th> }
              <th scope="col" class="ir"><span class="sr">Abrir</span></th>
            </tr>
          </thead>
          <tbody>
            @for (p of visibles(); track p.id; let primero = $first) {
              <tr [class.actual]="estudiante && primero">
                <td class="c-estudiante">
                  <div class="nombre"><a [routerLink]="['/practicas', p.id]">{{ p.estudianteNombre }}</a></div>
                  <div class="meta">{{ p.programaId }} · {{ p.ciclo | etiqueta }}{{ p.regional ? ' · ' + p.regional : '' }}@if (p.numeroFur) { · <span class="cod">FUR {{ p.numeroFur }}</span> }</div>
                  @if (interno && p.disparadoresSenal.length > 0) { <div class="disparo">{{ p.disparadoresSenal.join(' · ') }}</div> }
                </td>
                <td class="c-practica">
                  <div>{{ p.modalidad | etiqueta }}</div>
                  <div class="sub">{{ p.empresaRazonSocial ?? '—' }}</div>
                </td>
                <td class="c-periodo nw">
                  <div class="cod">{{ p.periodoAcademico }}</div>
                  <div class="sub"><span class="cod">{{ p.ultimaActividad | date: 'd MMM y' }}</span></div>
                </td>
                <td class="c-docente">{{ p.tutorNombre ?? (veDocente() ? 'Sin asignación' : '—') }}</td>
                <td class="c-estado">
                  <sipra-senal-estado [valor]="p.estado" />
                  <div class="sub">{{ p.estadoSgp }}</div>
                </td>
                <td class="c-avance">
                  @if (veAvance()) {
                    <div class="tel">
                      <span class="tel-et">Cargados</span><span class="pista-av" aria-hidden="true"><i [style.--p]="p.avance.porcentajeCargado + '%'"></i></span><b>{{ p.avance.porcentajeCargado }} %</b>
                      <span class="tel-et">Aprobados</span><span class="pista-av ok" aria-hidden="true"><i [style.--p]="p.avance.porcentajeAprobado + '%'"></i></span><b>{{ p.avance.porcentajeAprobado }} %</b>
                    </div>
                  } @else { — }
                </td>
                @if (interno) { <td class="c-senal"><sipra-senal-estado [valor]="p.senal" /></td> }
                <td class="ir"><a [routerLink]="['/practicas', p.id]" tabindex="-1" aria-hidden="true">→</a></td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class PracticasComponent implements OnInit {
  readonly sesion = inject(SesionService);
  /** El avance documental y el docente solo se muestran a quien los recibe del servidor. */
  readonly veAvance = computed(() => ['estudiante', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly veDocente = computed(() => !['empresa', 'extension'].includes(this.sesion.rol() ?? ''));
  private readonly api = inject(ApiService);

  readonly practicas = signal<Practica[]>([]);
  readonly periodos = signal<Periodo[]>([]);
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly cargando = signal(true);
  readonly filtroSenal = signal('');
  readonly panelAbierto = signal(false);

  /** Filtros del formulario (objeto mutable enlazado con ngModel). */
  readonly f = { ...FILTROS_INICIALES };

  readonly estados = [
    { valor: 'inscrita', etiqueta: 'Inscrito (registro)' }, { valor: 'documentacion', etiqueta: 'Inscrito (en documentación)' },
    { valor: 'en_validacion', etiqueta: 'Inscrito (en validación)' }, { valor: 'activa', etiqueta: 'En práctica' },
    { valor: 'finalizada', etiqueta: 'En práctica (finalizada)' }, { valor: 'certificada', etiqueta: 'Cerrado' },
    { valor: 'reprobada', etiqueta: 'Reprueba' }, { valor: 'anulada', etiqueta: 'Anulado' },
    { valor: 'suspendida', etiqueta: 'Suspendida' }, { valor: 'cancelada', etiqueta: 'Cancelada' },
  ];

  readonly visibles = computed(() => {
    const senal = this.filtroSenal();
    return this.practicas().filter((p) => !senal || p.senal === senal);
  });

  /** Cifras del listado visible: conteos directos sobre lo que ya llegó (sin lógica nueva). */
  readonly metricas = computed<MetricaV3[]>(() => {
    const v = this.visibles();
    const de = `de ${v.length}`;
    return [
      { n: v.length, t: 'En el listado', tono: 'info', contexto: 'registros' },
      { n: v.filter((p) => p.estado === 'activa').length, t: 'En práctica', tono: 'ok', contexto: de },
      { n: v.filter((p) => p.senal === 'requiere_atencion').length, t: 'Requieren atención', tono: 'aviso', contexto: de },
      { n: v.filter((p) => p.senal === 'en_riesgo').length, t: 'En riesgo', tono: 'peligro', contexto: de },
    ];
  });

  /** Filtros del panel distintos del valor inicial (la búsqueda y la señal están a la vista). */
  filtrosActivos(): number {
    const claves = ['periodo', 'programa', 'regional', 'modalidad', 'estado', 'asignacion', 'nivel', 'movimientoDesde', 'movimientoHasta', 'cargadoMinimo', 'aprobadoMinimo', 'cantidad'] as const;
    return claves.filter((k) => (this.f[k] ?? '') !== (FILTROS_INICIALES[k] ?? '')).length;
  }

  hayFiltros(): boolean {
    return this.filtrosActivos() > 0 || !!this.f.busqueda.trim() || !!this.filtroSenal();
  }

  async ngOnInit(): Promise<void> {
    if (this.sesion.esInterno()) {
      void firstValueFrom(this.api.listarPeriodos()).then((p) => this.periodos.set(p)).catch(() => undefined);
      void firstValueFrom(this.api.catalogoModalidades()).then((m) => this.modalidades.set(m)).catch(() => undefined);
    }
    await this.consultar();
  }

  async consultar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.practicas.set(await firstValueFrom(this.api.listarPracticas({
        ...this.f,
        cargadoMinimo: this.f.cargadoMinimo ?? undefined,
        aprobadoMinimo: this.f.aprobadoMinimo ?? undefined,
      })));
    } catch {
      this.practicas.set([]);
    } finally {
      this.cargando.set(false);
    }
  }

  async limpiar(): Promise<void> {
    Object.assign(this.f, { ...FILTROS_INICIALES });
    this.filtroSenal.set('');
    await this.consultar();
  }
}
