import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { ModalidadCatalogo, Periodo, TipoVentana } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';
import {
  CONFIRMAR_INHABILITAR, ROTULO_ESTADO_CARGUE, avisoFechaPasada, fechaCorta, problemaVentana, sugerenciaVentana, tonoEstadoCargue,
} from '@shared/utils/cargue-estudiante';

/** El cargue del ESTUDIANTE tiene su propia sección (G2): habilitación manual + ventana dentro del periodo. */
const VENTANAS: TipoVentana[] = ['registro_fur', 'solicitud_arl', 'cargue_docente', 'carta_presentacion'];

/** Gestión de periodos (SGP): ventanas, modalidades ofertadas y sincronización, periodo por periodo. */
import { FiltroAnio, anioInicial, aniosDisponibles, filtrarPorAnio, filtroTrasCrear, masReciente, seleccionTrasFiltro } from './periodos-anio';

@Component({
  selector: 'sipra-periodos',
  standalone: true,
  imports: [FormsModule, EtiquetaPipe, CronogramaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .intro { margin-bottom:var(--sp-3); } .intro summary { cursor:pointer; font-weight:600; font-size:var(--fs-sm); min-height:36px; display:flex; align-items:center; width:fit-content; }
    /* Maestro / detalle: una lista de periodos y la configuración del elegido (antes, nueve periodos expandidos en una sola página). */
    /* Cerrado es solo un botón; abierto, la tarjeta del formulario. */
    details.crear:not([open]) { padding:0; border:0; background:none; box-shadow:none; }
    details.crear summary::-webkit-details-marker { display:none; }
    .maestro-detalle { display:grid; gap:var(--sp-3); grid-template-columns:minmax(0,1fr); align-items:start; }
    @media (width >= 1000px) { .maestro-detalle { grid-template-columns:260px minmax(0,1fr); } .columna { position:sticky; top:calc(var(--alto-cinta, 0px) + 62px + 12px); max-height:calc(100dvh - 140px); overflow:auto; } }
    /* Filtro por año (solo navegación): etiqueta pequeña y select compacto, sobre la lista. */
    .columna { display:grid; gap:var(--sp-2); align-content:start; min-width:0; }
    .filtro-anio { display:flex; align-items:center; gap:var(--sp-2); margin:0; }
    .filtro-anio label { font-size:var(--fs-xs); font-weight:600; color:var(--texto-tenue); text-transform:uppercase; letter-spacing:.06em; }
    .filtro-anio select { flex:1; min-width:0; font:inherit; font-size:var(--fs-sm); min-height:36px; padding:4px 8px; border:1px solid var(--borde-campo); border-radius:var(--r-sm); background:var(--superficie); color:var(--texto); }
    .filtro-anio select:focus-visible { outline:2px solid var(--marca); outline-offset:2px; }
    .maestro .vacio-anio { font-size:var(--fs-sm); color:var(--texto-tenue); padding:var(--sp-2) 0; margin:0; }
    .maestro { display:flex; flex-wrap:wrap; gap:var(--sp-1); }
    @media (width >= 1000px) { .maestro { flex-direction:column; flex-wrap:nowrap; } }
    .maestro .item { display:flex; gap:var(--sp-2); align-items:center; text-align:left; font:inherit; color:inherit; background:var(--superficie); border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); min-height:44px; cursor:pointer; }
    .maestro .item:hover { background:var(--superficie-2); } .maestro .item.sel { border-color:var(--marca); background:var(--marca-suave); }
    .maestro .item { flex-wrap:wrap; } .maestro .cod { font-weight:700; flex:1; } .maestro .item .etiqueta { flex:none; }
    .maestro .nom { flex:1 1 100%; order:3; font-size:var(--fs-xs); color:var(--texto-tenue); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @media (width < 1000px) { .maestro .nom { display:none; } }
    .periodo { display:grid; gap:var(--sp-3); }
    .periodo header { display:flex; gap:var(--sp-2) var(--sp-4); align-items:center; flex-wrap:wrap; } .periodo header h2 { margin:0; flex:1 1 20rem; font-size:var(--fs-lg); }
    .marca { display:flex; gap:6px; align-items:center; font-size:var(--fs-sm); min-height:36px; }
    .pestanas { display:flex; flex-wrap:wrap; gap:0 2px; border-bottom:1px solid var(--borde); }
    .pestanas button { flex:none; font:inherit; font-size:var(--fs-sm); font-weight:600; color:var(--texto-tenue); background:none; border:0; border-bottom:2px solid transparent; padding:var(--sp-2) var(--sp-3); min-height:44px; cursor:pointer; white-space:nowrap; }
    .pestanas button.activa { color:var(--marca); border-bottom-color:var(--marca); }
    .pestanas button:focus-visible { outline:2px solid var(--marca); outline-offset:-2px; }
    /* Cada ventana en UNA fila: nombre y estado, fechas y acciones. */
    .ventanas { display:grid; gap:var(--sp-1); }
    .ventana { border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); font-size:var(--fs-sm); display:grid; gap:var(--sp-2); align-items:center; }
    /* En una fila (nombre · fechas · acciones) solo cuando el detalle es ancho: con el menú lateral y la lista de periodos hacen falta ~1400 px. */
    @media (width >= 1400px) { .ventana { grid-template-columns:minmax(14rem,1.1fr) minmax(0,1.2fr) auto; } }
    .ventana .acciones { display:flex; flex-wrap:wrap; gap:var(--sp-2); } .ventana .acciones .boton { white-space:nowrap; }
    .ventana .t { display:flex; gap:var(--sp-2); align-items:center; justify-content:space-between; flex-wrap:wrap; font-weight:600; } .ventana .t .etiqueta { flex:none; white-space:nowrap; }
    .ventana input { font:inherit; font-size:var(--fs-xs); border:1px solid var(--borde-campo); border-radius:var(--r-sm); padding:4px 6px; background:var(--superficie); color:inherit; min-height:32px; }
    .fechas { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-1); }
    .mods { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-3); font-size:var(--fs-xs); } .mods label { display:flex; gap:4px; align-items:center; }
    .rej { display:grid; gap:0 var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); }
    .crono { display:grid; gap:var(--sp-3); grid-template-columns:1fr; } @media (width >= 900px) { .crono { grid-template-columns:minmax(0,1fr) 300px; align-items:start; } }
    .crono input { font:inherit; font-size:var(--fs-xs); border:1px solid var(--borde-campo); border-radius:var(--r-sm); padding:4px 6px; background:var(--superficie); color:inherit; min-height:32px; }
    .crono .campo { margin:0; }
    /* G2 · resumen compacto y control del cargue del estudiante (hairlines, sin tarjetas grandes). */
    .resumen { display:grid; gap:var(--sp-1) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr)); margin:0; padding:var(--sp-2) 0; border-top:1px solid var(--borde); border-bottom:1px solid var(--borde); }
    .resumen div { display:grid; gap:2px; } .resumen dt { font-size:var(--fs-xs); color:var(--texto-tenue); } .resumen dd { margin:0; font-weight:600; font-size:var(--fs-sm); font-variant-numeric:tabular-nums; }
    .senal-cargue { display:inline-flex; align-items:center; gap:6px; }
    .senal-cargue i { width:8px; height:8px; border-radius:50%; background:var(--texto-tenue); flex:none; }
    .senal-cargue[data-tono="ok"] i { background:var(--ok); }
    .senal-cargue[data-tono="pendiente"] i { background:var(--aviso); }
    .senal-cargue[data-tono="pausa"] i { background:transparent; border:2px solid var(--aviso); }
    .cargue { display:grid; gap:var(--sp-2); padding:var(--sp-3) 0 var(--sp-1); border-bottom:1px solid var(--borde); }
    .cargue h3 { margin:0; font-size:var(--fs-sm); text-transform:uppercase; letter-spacing:.06em; color:var(--texto-tenue); }
    .cargue .fila { display:flex; flex-wrap:wrap; gap:var(--sp-2) var(--sp-4); align-items:end; }
    .cargue .campo { margin:0; min-width:min(100%,160px); }
    .cargue input[type="date"] { font:inherit; font-size:var(--fs-sm); border:1px solid var(--borde-campo); border-radius:var(--r-sm); padding:6px 8px; background:var(--superficie); color:inherit; min-height:40px; }
    .interruptor { display:inline-flex; align-items:center; gap:var(--sp-2); min-height:44px; font-weight:600; font-size:var(--fs-sm); cursor:pointer; }
    .interruptor input { appearance:none; -webkit-appearance:none; width:40px; height:22px; border-radius:11px; background:var(--borde-campo); position:relative; margin:0; cursor:pointer; transition:background .15s; flex:none; }
    .interruptor input::after { content:""; position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:50%; background:var(--superficie); transition:transform .15s; }
    .interruptor input:checked { background:var(--marca); } .interruptor input:checked::after { transform:translateX(18px); }
    .interruptor input:focus-visible { outline:2px solid var(--marca); outline-offset:2px; }
    .interruptor .estado { font-weight:400; color:var(--texto-tenue); }
    @media (prefers-reduced-motion: reduce) { .interruptor input, .interruptor input::after { transition:none; } }
    .nota { font-size:var(--fs-xs); margin:0; } .nota--aviso { color:var(--texto); } .nota--error { color:var(--peligro); }
    fieldset.cargue-nuevo { border:0; border-top:1px solid var(--borde); margin:var(--sp-3) 0; padding:var(--sp-3) 0 0; display:grid; gap:var(--sp-2); }
    fieldset.cargue-nuevo legend { font-size:var(--fs-sm); text-transform:uppercase; letter-spacing:.06em; color:var(--texto-tenue); padding:0; }
  `],
  template: `
    <details class="intro">
      <summary>Cómo funcionan los periodos</summary>
    <p class="pista" style="max-width:72ch;margin:var(--sp-2) 0 0">
      Habilite o deshabilite por periodo el registro FUR, el cargue de documentos del estudiante y del docente (casos especiales),
      la solicitud de ARL, la carta de presentación, la sincronización de docentes con SINU y las modalidades ofertadas. Hay tres calendarios:
      presencial (2026A–D), virtual (26V01–06) y 335 (26P01–06). Al crear un periodo, el cronograma se arma con la regla del Área de Prácticas:
      dos meses desde el inicio para registrar y solicitar la ARL e inducción en la segunda semana. El cargue de documentos del estudiante
      tiene su propia sección: se habilita o inhabilita sin perder las fechas, y solo carga dentro de «desde» y «hasta».
      Solo administración y dirección gestionan los periodos.
    </p>
    </details>

    <details class="tarjeta crear" style="margin-bottom:var(--sp-4)">
      <summary class="boton compacto" style="display:inline-flex">+ Crear periodo</summary>
      <div class="rej" style="margin-top:var(--sp-3)">
        <div class="campo"><label for="n-cod">Código</label><input id="n-cod" [(ngModel)]="n.codigo" placeholder="2027A o 27V01" /></div>
        <div class="campo"><label for="n-nom">Nombre</label><input id="n-nom" [(ngModel)]="n.nombre" /></div>
        <div class="campo"><label for="n-cal">Calendario</label><select id="n-cal" [(ngModel)]="n.calendario"><option value="presencial">Presencial</option><option value="virtual">Virtual</option><option value="335">335</option></select></div>
        <div class="campo"><label for="n-ini">Fecha de inicio</label><input id="n-ini" type="date" [(ngModel)]="n.fechaInicio" (ngModelChange)="sugerir()" /></div>
        <div class="campo"><label for="n-fin">Fecha de finalización</label><input id="n-fin" type="date" [(ngModel)]="n.fechaFin" (ngModelChange)="sugerir()" /></div>
        <div class="campo"><label for="n-fur">Límite de registro y ARL</label><input id="n-fur" type="date" [(ngModel)]="n.cierreFur" /><span class="pista">Vacío: dos meses después del inicio.</span></div>
      </div>
      <fieldset class="cargue-nuevo">
        <legend>Cargue de documentos del estudiante</legend>
        <label class="interruptor"><input type="checkbox" role="switch" [(ngModel)]="n.cargueHabilitado" [attr.aria-checked]="n.cargueHabilitado" /> Habilitado</label>
        <div class="rej">
          <div class="campo"><label for="n-cd">Desde</label><input id="n-cd" type="date" [(ngModel)]="n.cargueDesde" (ngModelChange)="n.cargueTocado = true" /></div>
          <div class="campo"><label for="n-ch">Hasta</label><input id="n-ch" type="date" [(ngModel)]="n.cargueHasta" (ngModelChange)="n.cargueTocado = true" /></div>
        </div>
        <p class="pista nota">Sugerencia: desde el inicio del periodo hasta dos semanas antes del cierre. Revísela y cámbiela antes de crear.</p>
      </fieldset>
      <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="crear()">Crear periodo</button>
    </details>

    <div class="maestro-detalle">
      <div class="columna">
      <div class="filtro-anio">
        <label for="filtro-anio">Año</label>
        <select id="filtro-anio" [ngModel]="anio()" (ngModelChange)="cambiarAnio($event)">
          <option [ngValue]="'todos'">Todos los años</option>
          @for (a of anios(); track a) { <option [ngValue]="a">{{ a }}</option> }
        </select>
      </div>
      <nav class="maestro" aria-label="Periodos académicos">
        @for (p of visibles(); track p.codigo) {
          <button type="button" class="item" [class.sel]="actual()?.codigo === p.codigo" [attr.aria-current]="actual()?.codigo === p.codigo ? 'true' : null" (click)="elegir(p.codigo)">
            <span class="cod">{{ p.codigo }}</span>
            <span class="nom">{{ p.nombre }}</span>
            <span class="etiqueta" [class.etiqueta--ok]="p.vigente && p.activo" [class.etiqueta--neutra]="!(p.vigente && p.activo)">{{ !p.activo ? 'inactivo' : p.vigente ? 'vigente' : 'cerrado' }}</span>
          </button>
        } @empty {
          @if (periodos().length > 0) { <p class="vacio-anio">No hay períodos registrados para este año.</p> }
        }
      </nav>
      </div>

      @if (actual(); as p) {
        <section class="tarjeta periodo" [attr.aria-label]="'Periodo ' + p.codigo">
          <header>
            <h2>{{ p.codigo }} <span class="pista">· {{ p.nombre }}</span></h2>
            <label class="marca"><input type="checkbox" [checked]="p.sincronizacionDocentes" (change)="guardar(p, { sincronizacionDocentes: !p.sincronizacionDocentes })" /> Sincronización de docentes</label>
            <label class="marca"><input type="checkbox" [checked]="p.activo" (change)="guardar(p, { activo: !p.activo })" /> Periodo activo</label>
          </header>

          <dl class="resumen" aria-label="Resumen del periodo">
            <div><dt>Calendario</dt><dd>{{ p.calendario | etiqueta }}</dd></div>
            <div><dt>Fechas</dt><dd>{{ corta(p.fechaInicio) }} — {{ corta(p.fechaFin, true) }}</dd></div>
            <div><dt>Estado del periodo</dt><dd>{{ p.activo ? 'Activo' : 'Inactivo' }}</dd></div>
            <div><dt>Cargue estudiante</dt><dd><span class="senal-cargue" [attr.data-tono]="tono(p)"><i aria-hidden="true"></i>{{ rotulo(p) }}</span></dd></div>
            <div><dt>Ventana</dt><dd>{{ corta(p.cargueEstudiante.desde) }} → {{ corta(p.cargueEstudiante.hasta) }}</dd></div>
          </dl>

          <section class="cargue" aria-labelledby="cargue-titulo">
            <h3 id="cargue-titulo">Cargue de documentos del estudiante</h3>
            <label class="interruptor">
              <input type="checkbox" role="switch" [checked]="p.cargueEstudiante.habilitado" [attr.aria-checked]="p.cargueEstudiante.habilitado"
                     [disabled]="guardando()" (change)="alternarCargue(p, $event)" aria-describedby="cargue-ayuda" />
              Cargue de estudiantes <span class="estado">{{ p.cargueEstudiante.habilitado ? 'Habilitado' : 'Inhabilitado' }}</span>
            </label>
            <p id="cargue-ayuda" class="pista nota">Inhabilitarlo no borra las fechas: al volver a habilitarlo se conservan «desde» y «hasta».</p>
            <div class="fila">
              <div class="campo"><label [for]="'cd-' + p.codigo">Desde</label><input [id]="'cd-' + p.codigo" type="date" [value]="valorVentana(p, 'desde')" (change)="fechaCargue(p, 'desde', $event)" [attr.aria-describedby]="'cargue-aviso-' + p.codigo" /></div>
              <div class="campo"><label [for]="'ch-' + p.codigo">Hasta</label><input [id]="'ch-' + p.codigo" type="date" [value]="valorVentana(p, 'hasta')" (change)="fechaCargue(p, 'hasta', $event)" [attr.aria-describedby]="'cargue-aviso-' + p.codigo" /></div>
              <button type="button" class="boton compacto" [disabled]="guardando() || !!problema(p)" (click)="guardarVentanaCargue(p)">Guardar ventana de cargue</button>
            </div>
            <div [id]="'cargue-aviso-' + p.codigo" aria-live="polite">
              @if (problema(p); as x) { <p class="nota nota--error">{{ x }}</p> }
              @else if (avisoPasada(p); as x) { <p class="nota nota--aviso">⚠ {{ x }}</p> }
            </div>
          </section>

          <div role="tablist" class="pestanas" aria-label="Qué configurar de este periodo">
            @for (t of pestanas; track t.clave) {
              <button type="button" role="tab" [id]="'pt-' + t.clave" [attr.aria-selected]="pestana() === t.clave" [attr.aria-controls]="'pp-' + t.clave" [tabIndex]="pestana() === t.clave ? 0 : -1"
                      [class.activa]="pestana() === t.clave" (click)="pestana.set(t.clave)" (keydown)="teclaPestana($event)">{{ t.texto }}@if (t.clave === 'modalidades') { <span class="pista"> ({{ p.modalidadesHabilitadas.length === 0 ? 'todas' : p.modalidadesHabilitadas.length }})</span> }</button>
            }
          </div>

          @if (pestana() === 'ventanas') {
            <div role="tabpanel" id="pp-ventanas" aria-labelledby="pt-ventanas" class="ventanas">
              @for (v of ventanas; track v) {
                <div class="ventana">
                  <div class="t"><span>{{ v | etiqueta }}</span><span class="etiqueta etiqueta--icono" [class.etiqueta--ok]="p.abiertas[v]" [class.etiqueta--neutra]="!p.abiertas[v]"><span aria-hidden="true">{{ p.abiertas[v] ? '●' : '○' }}</span> {{ p.abiertas[v] ? 'abierta' : 'cerrada' }}</span></div>
                  <div class="fechas">
                    <input type="date" [value]="p.ventanas[v]?.desde ?? ''" (change)="fecha(p, v, 'desde', $event)" [attr.aria-label]="(v | etiqueta) + ': desde'" />
                    <input type="date" [value]="p.ventanas[v]?.hasta ?? ''" (change)="fecha(p, v, 'hasta', $event)" [attr.aria-label]="(v | etiqueta) + ': hasta'" />
                  </div>
                  <div class="acciones"><button type="button" class="boton compacto" (click)="aplicarVentana(p, v)" [disabled]="guardando()">Aplicar</button>
                    @if (p.ventanas[v]) { <button type="button" class="boton compacto boton--peligro" (click)="deshabilitarVentana(p, v)" [disabled]="guardando()">Deshabilitar</button> }</div>
                </div>
              }
            </div>
          }
          @if (pestana() === 'cronograma') {
            <div role="tabpanel" id="pp-cronograma" aria-labelledby="pt-cronograma" class="crono">
              <div class="rej">
                <div class="campo"><label [for]="'j1-' + p.codigo">Jornada de inducción 1</label><input [id]="'j1-' + p.codigo" type="date" [value]="jornada(p, 0)" (change)="campoCrono(p, 'j1', $event)" /></div>
                <div class="campo"><label [for]="'j2-' + p.codigo">Jornada de inducción 2</label><input [id]="'j2-' + p.codigo" type="date" [value]="jornada(p, 1)" (change)="campoCrono(p, 'j2', $event)" /></div>
                <div class="campo"><span class="pista">Fecha de cargue de documentos: {{ p.cronograma.fechaCargueDocumentos ?? '—' }} (la fija «hasta» del cargue del estudiante)</span></div>
                <div class="acciones" style="align-self:end"><button type="button" class="boton compacto" [disabled]="guardando()" (click)="aplicarCronograma(p)">Aplicar cronograma</button></div>
              </div>
              <sipra-cronograma [periodo]="p" />
            </div>
          }
          @if (pestana() === 'modalidades') {
            <div role="tabpanel" id="pp-modalidades" aria-labelledby="pt-modalidades">
              <div class="mods">
                @for (m of modalidades(); track m.modalidad) {
                  <label><input type="checkbox" [checked]="p.modalidadesOfertadas.includes(m.modalidad)" (change)="alternarModalidad(p, m.modalidad)" /> {{ m.etiquetaSgp }}</label>
                }
              </div>
              <p class="pista" style="margin-top:var(--sp-2)">Desmarque las que no se ofertan este periodo. Con todas marcadas, la oferta queda abierta.</p>
            </div>
          }
        </section>
      } @else {
        @if (periodos().length === 0) { <div class="vacio"><strong>Aún no hay periodos</strong><br />Cree el primero con el botón «Crear periodo».</div> }
        @else { <div class="vacio">No hay períodos registrados para este año. Elija otro año o cree uno con «Crear periodo».</div> }
      }
    </div>
  `,
})
export class PeriodosComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly periodos = signal<Periodo[]>([]);
  /** Periodo elegido en la lista (por defecto, el vigente y activo, o el primero) y la pestaña de su configuración. */
  readonly seleccion = signal<string | null>(null);
  /** Filtro por año de la lista (solo navegación; el año sale de `fechaInicio`). null hasta cargar los periodos. */
  readonly anio = signal<FiltroAnio | null>(null);
  readonly anios = computed(() => aniosDisponibles(this.periodos()));
  readonly visibles = computed(() => filtrarPorAnio(this.periodos(), this.anio() ?? 'todos'));
  /** Nunca queda en el detalle un periodo oculto por el filtro. */
  readonly actual = computed(() => {
    const lista = this.visibles();
    return lista.find((x) => x.codigo === this.seleccion()) ?? lista.find((x) => x.vigente && x.activo) ?? masReciente(lista);
  });
  cambiarAnio(anio: FiltroAnio): void {
    const previa = this.actual()?.codigo ?? null; // la que se veía ANTES de filtrar
    this.anio.set(anio);
    this.seleccion.set(seleccionTrasFiltro(this.visibles(), previa));
  }
  readonly pestanas = [
    { clave: 'ventanas', texto: 'Ventanas habilitadas' }, { clave: 'cronograma', texto: 'Cronograma' }, { clave: 'modalidades', texto: 'Modalidades ofertadas' },
  ] as const;
  readonly pestana = signal<'ventanas' | 'cronograma' | 'modalidades'>('ventanas');
  elegir(codigo: string): void { this.seleccion.set(codigo); }
  /** Flechas, Inicio y Fin cambian de pestaña (patrón de pestañas del APG). */
  teclaPestana(e: KeyboardEvent): void {
    const claves = this.pestanas.map((t) => t.clave); const i = claves.indexOf(this.pestana());
    const siguiente = e.key === 'ArrowRight' ? (i + 1) % claves.length : e.key === 'ArrowLeft' ? (i - 1 + claves.length) % claves.length : e.key === 'Home' ? 0 : e.key === 'End' ? claves.length - 1 : -1;
    if (siguiente < 0) return;
    e.preventDefault(); this.pestana.set(claves[siguiente]);
    setTimeout(() => document.getElementById('pt-' + claves[siguiente])?.focus(), 0);
  }
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly guardando = signal(false);
  readonly ventanas = VENTANAS;
  readonly n = {
    codigo: '', nombre: '', calendario: 'presencial', fechaInicio: '', fechaFin: '', cierreFur: '',
    cargueHabilitado: true, cargueDesde: '', cargueHasta: '', cargueTocado: false,
  };
  /** Borrador de la ventana de cargue del periodo elegido (señal: los avisos previos se recalculan al escribir). */
  readonly borradorCargue = signal<{ codigo: string; desde?: string; hasta?: string } | null>(null);
  readonly corta = fechaCorta;
  private readonly borrador = new Map<string, { desde?: string; hasta?: string }>();
  private readonly borradorCrono = new Map<string, { j1?: string; j2?: string; cargue?: string }>();

  async ngOnInit(): Promise<void> {
    void firstValueFrom(this.api.catalogoModalidades()).then((m) => this.modalidades.set(m)).catch(() => undefined);
    await this.cargar();
  }

  async cargar(): Promise<void> {
    try {
      this.periodos.set(await firstValueFrom(this.api.listarPeriodos()));
      if (this.anio() === null) this.anio.set(anioInicial(this.periodos()));
    } catch (error) { this.avisos.error(leerError(error)); }
  }

  fecha(p: Periodo, v: TipoVentana, campo: 'desde' | 'hasta', evento: Event): void {
    const clave = `${p.codigo}:${v}`;
    this.borrador.set(clave, { ...(this.borrador.get(clave) ?? {}), [campo]: (evento.target as HTMLInputElement).value });
  }

  async aplicarVentana(p: Periodo, v: TipoVentana): Promise<void> {
    const b = this.borrador.get(`${p.codigo}:${v}`) ?? {};
    const desde = b.desde ?? p.ventanas[v]?.desde; const hasta = b.hasta ?? p.ventanas[v]?.hasta;
    if (!desde || !hasta) { this.avisos.error('Indique desde y hasta para la ventana.'); return; }
    await this.guardar(p, { ventanas: { [v]: { desde, hasta } } });
  }

  async deshabilitarVentana(p: Periodo, v: TipoVentana): Promise<void> {
    await this.guardar(p, { ventanas: { [v]: null } });
  }

  jornada(p: Periodo, i: number): string { return p.cronograma.jornadasInduccion[i] ?? ''; }

  campoCrono(p: Periodo, campo: 'j1' | 'j2' | 'cargue', evento: Event): void {
    this.borradorCrono.set(p.codigo, { ...(this.borradorCrono.get(p.codigo) ?? {}), [campo]: (evento.target as HTMLInputElement).value });
  }

  async aplicarCronograma(p: Periodo): Promise<void> {
    const b = this.borradorCrono.get(p.codigo) ?? {};
    const j1 = b.j1 ?? p.cronograma.jornadasInduccion[0] ?? '';
    const j2 = b.j2 ?? p.cronograma.jornadasInduccion[1] ?? '';
    await this.guardar(p, { jornadasInduccion: [j1, j2].filter(Boolean) });
    this.borradorCrono.delete(p.codigo);
  }

  async alternarModalidad(p: Periodo, modalidad: string): Promise<void> {
    const actuales = new Set(p.modalidadesOfertadas);
    if (actuales.has(modalidad)) actuales.delete(modalidad); else actuales.add(modalidad);
    const todas = this.modalidades().map((m) => m.modalidad);
    const lista = todas.filter((m) => actuales.has(m));
    await this.guardar(p, { modalidadesHabilitadas: lista.length === todas.length ? [] : lista });
  }

  async guardar(p: Periodo, cambios: Record<string, unknown>): Promise<void> {
    this.guardando.set(true);
    try { await firstValueFrom(this.api.actualizarPeriodo(p.codigo, cambios)); await this.cargar(); this.avisos.exito(`Periodo ${p.codigo} actualizado.`); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }

  /** Propone la ventana de cargue al escribir las fechas del periodo; si el usuario ya la tocó, no la pisa. */
  sugerir(): void {
    if (this.n.cargueTocado) return;
    const s = sugerenciaVentana(this.n.fechaInicio, this.n.fechaFin);
    if (s) { this.n.cargueDesde = s.desde; this.n.cargueHasta = s.hasta; }
  }

  rotulo(p: Periodo): string { return ROTULO_ESTADO_CARGUE[p.cargueEstudiante.estado]; }
  tono(p: Periodo): string { return tonoEstadoCargue(p.cargueEstudiante.estado); }

  valorVentana(p: Periodo, campo: 'desde' | 'hasta'): string {
    const b = this.borradorCargue();
    return (b?.codigo === p.codigo ? b[campo] : undefined) ?? p.cargueEstudiante[campo] ?? '';
  }

  fechaCargue(p: Periodo, campo: 'desde' | 'hasta', evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    const b = this.borradorCargue();
    this.borradorCargue.set({ ...(b?.codigo === p.codigo ? b : { codigo: p.codigo }), [campo]: valor });
  }

  problema(p: Periodo): string | null {
    return problemaVentana(this.valorVentana(p, 'desde'), this.valorVentana(p, 'hasta'), p.fechaInicio, p.fechaFin);
  }

  avisoPasada(p: Periodo): string | null {
    return this.borradorCargue()?.codigo === p.codigo ? avisoFechaPasada(this.valorVentana(p, 'hasta')) : null;
  }

  async guardarVentanaCargue(p: Periodo): Promise<void> {
    const aviso = avisoFechaPasada(this.valorVentana(p, 'hasta'));
    if (aviso && !confirm(aviso)) return;
    await this.guardar(p, { ventanaCargueEstudiante: { desde: this.valorVentana(p, 'desde'), hasta: this.valorVentana(p, 'hasta') } });
    this.borradorCargue.set(null);
  }

  async alternarCargue(p: Periodo, evento: Event): Promise<void> {
    const entrada = evento.target as HTMLInputElement;
    const habilitar = entrada.checked;
    if (!habilitar && !confirm(CONFIRMAR_INHABILITAR)) { entrada.checked = true; return; }
    await this.guardar(p, { cargueEstudianteHabilitado: habilitar });
  }

  async crear(): Promise<void> {
    const problema = problemaVentana(this.n.cargueDesde, this.n.cargueHasta, this.n.fechaInicio, this.n.fechaFin);
    if (problema) { this.avisos.error(problema); return; }
    this.guardando.set(true);
    try {
      const { codigo, nombre, calendario, fechaInicio, fechaFin, cierreFur, cargueHabilitado, cargueDesde, cargueHasta } = this.n;
      const p = await firstValueFrom(this.api.crearPeriodo({
        codigo, nombre, calendario, fechaInicio, fechaFin, cierreFur: cierreFur || undefined,
        cargueEstudiante: { habilitado: cargueHabilitado, desde: cargueDesde, hasta: cargueHasta },
      }));
      await this.cargar();
      // Si el nuevo periodo es de otro año, el filtro pasa a su año y queda seleccionado.
      this.anio.set(filtroTrasCrear(this.anio() ?? 'todos', p));
      this.seleccion.set(p.codigo);
      this.avisos.exito(`Periodo ${p.codigo} creado.`); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }
}
