import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FiltrosActas, ItemBandejaActa } from '@core/models/modelos';
import { textoRestante } from '../eps/eps.util';
import { ActasDetalleComponent } from './actas-detalle.component';
import { ActasMesaEstado } from './actas-mesa.estado';
import { ActasSupervisionComponent } from './actas-supervision.component';
import { problemaPrincipal, textoReserva } from './actas.util';

interface TarjetaKpi { clave: keyof NonNullable<ReturnType<ActasMesaEstado['listado']>>['kpis']; titulo: string; filtro?: FiltrosActas }

/** Solo cifras que sirven para decidir qué atender; cada una que se puede filtrar lleva a su lista. */
const KPIS: TarjetaKpi[] = [
  { clave: 'libres', titulo: 'Pendientes', filtro: { reserva: 'libres' } },
  { clave: 'mias', titulo: 'Míos', filtro: { reserva: 'mias' } },
  { clave: 'conDiscrepanciaCritica', titulo: 'Con discrepancias', filtro: { conDiscrepancias: 'si' } },
  { clave: 'documentoIncorrecto', titulo: 'Documento incorrecto', filtro: { documentoIncorrecto: 'si' } },
  { clave: 'firmasPendientes', titulo: 'Firmas pendientes', filtro: { firmas: 'faltantes' } },
];

const CLAVE_LISTA = 'sipra.actas.lista';
function leerListaVisible(): boolean {
  try { return localStorage.getItem(CLAVE_LISTA) !== 'no'; } catch { return true; }
}

/**
 * Mesa de Actas de Iniciación. La pantalla solo coordina: la bandeja, los filtros, la prioridad, la reserva y «Tomar siguiente» los
 * resuelve la API (de forma atómica); la decisión es siempre de una persona. Más simple que la Mesa de EPS: no hay consulta externa.
 */
@Component({
  selector: 'sipra-actas',
  standalone: true,
  imports: [FormsModule, ActasDetalleComponent, ActasSupervisionComponent],
  providers: [ActasMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cab { display:flex; gap:var(--sp-2) var(--sp-4); justify-content:space-between; align-items:center; flex-wrap:wrap; }
    .cab > div:first-child { flex:1 1 24rem; min-width:0; }
    .cab h1 { margin:0; } .cab p { margin:0; }
    .kpis { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-2); margin:var(--sp-2) 0; align-items:center; }
    .kpi { flex:0 1 auto; display:flex; align-items:baseline; gap:var(--sp-1); text-align:left; white-space:nowrap; border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie); padding:var(--sp-1) var(--sp-2); min-height:44px; cursor:pointer; color:inherit; font:inherit; }
    .kpi:hover { background:var(--superficie-2); }
    .kpi[aria-pressed='true'] { border-color:var(--marca); background:var(--marca-suave); }
    .kpi .n { font-size:1.125rem; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
    .kpi .t { font-size:var(--fs-xs); color:var(--texto-tenue); line-height:1.2; }
    .por-vencer { font-size:var(--fs-sm); color:var(--texto-tenue); padding-inline:var(--sp-2); }
    .por-vencer strong { color:var(--aviso); }
    .filtros { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); align-items:end; margin-bottom:var(--sp-3); }
    .filtros .campo { margin:0; }
    .filtros .buscar { grid-column:span 2; }
    @media (width < 520px) { .filtros .buscar { grid-column:1 / -1; } }
    .mas { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); align-items:end; margin:0 0 var(--sp-3); }
    .mas[hidden] { display:none; }
    .mas .campo { margin:0; }
    .cuerpo { display:grid; gap:var(--sp-3); grid-template-columns:1fr; align-items:start; --sticky-top:calc(var(--alto-cinta, 0px) + 62px + 12px); }
    @media (width >= 1200px) { .cuerpo { grid-template-columns:clamp(250px, 17vw, 300px) minmax(0,1fr); } }
    @media (width >= 1200px) { .cuerpo.sin-lista { grid-template-columns:minmax(0,1fr); } .cuerpo.sin-lista .lista-col { display:none; } }
    .detalle-col { min-width:0; padding:var(--sp-3); }
    @media (width < 600px) { .detalle-col { padding:var(--sp-2); } }
    .solo-escritorio { display:none; }
    @media (width >= 1200px) { .solo-escritorio { display:inline-flex; } }
    .lista-cab { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-2); margin-bottom:var(--sp-2); }
    .lista-cab h2 { margin:0; }
    @media (width < 1200px) { .cuerpo.ver-caso .lista-col { display:none; } .cuerpo.ver-lista .detalle-col { display:none; } }
    .lista { list-style:none; margin:0; padding:0; max-height:calc(100dvh - 320px); min-height:240px; overflow:auto; }
    @media (width >= 1200px) {
      .lista-col { position:sticky; top:var(--sticky-top); padding:var(--sp-3); }
      .lista-col .lista { max-height:calc(100dvh - var(--sticky-top) - 120px); }
    }
    @media (width < 1200px) { .lista { max-height:none; } }
    .caso { display:block; width:100%; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--borde); padding:var(--sp-2) var(--sp-1); cursor:pointer; color:inherit; font:inherit; line-height:1.3; min-height:44px; }
    .caso:hover { background:var(--superficie-2); }
    .caso[aria-current='true'] { background:var(--marca-suave); }
    .caso .n { display:block; font-weight:700; overflow-wrap:anywhere; }
    .caso .empresa { display:block; font-size:var(--fs-sm); color:var(--texto-tenue); overflow-wrap:anywhere; }
    .caso .problema { display:block; margin-top:3px; font-size:var(--fs-sm); font-weight:600; overflow-wrap:anywhere; }
    .caso .problema.t-peligro { color:var(--peligro); } .caso .problema.t-aviso { color:var(--aviso); } .caso .problema.t-ok, .caso .problema.t-info, .caso .problema.t-neutra, .caso .problema.sin { color:var(--texto-tenue); font-weight:400; }
    .caso .estado-linea { display:block; margin-top:3px; font-size:var(--fs-xs); color:var(--texto-tenue); overflow-wrap:anywhere; }
    .error { background:var(--peligro-suave); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>Mesa de Actas de Iniciación</h1>
        <p class="pista">Revise cada Acta frente a la práctica y decida. La recomendación del sistema es una ayuda; la decisión es suya.</p>
      </div>
      <div class="acciones">
        <button type="button" class="boton boton--primario compacto" [disabled]="estado.ocupado()" (click)="estado.tomarSiguiente()">Tomar siguiente</button>
        <button type="button" class="boton compacto" [disabled]="estado.cargando()" (click)="estado.cargar()">Actualizar</button>
      </div>
    </div>

    @if (estado.listado(); as l) {
      <div class="kpis" role="group" aria-label="Indicadores de la Mesa">
        @for (k of kpis; track k.clave) {
          <button type="button" class="kpi" [attr.aria-pressed]="kpiActivo(k)" (click)="clicKpi(k)">
            <span class="n">{{ l.kpis[k.clave] }}</span><span class="t">{{ k.titulo }}</span>
          </button>
        }
        @if (l.kpis.porVencer > 0) {
          <span class="por-vencer" role="status"><strong>{{ l.kpis.porVencer }}</strong> {{ l.kpis.porVencer === 1 ? 'reserva por vencer' : 'reservas por vencer' }}</span>
        }
      </div>
    }

    <form class="filtros" role="search" aria-label="Filtros de la Mesa" (submit)="$event.preventDefault()">
      <div class="campo buscar"><label for="f-buscar">Buscar estudiante</label>
        <input id="f-buscar" type="search" autocomplete="off" [ngModel]="estado.filtros().buscar ?? ''" name="buscar" (ngModelChange)="estado.buscar($event)" /></div>
      <div class="campo"><label for="f-reserva">Reserva</label>
        <select id="f-reserva" [ngModel]="estado.filtros().reserva ?? ''" name="reserva" (ngModelChange)="filtrar({ reserva: $event })">
          <option value="">Todas</option><option value="libres">Disponibles</option><option value="mias">Mías</option><option value="otros">De otras personas</option><option value="vencidas">Vencidas</option></select></div>
      <div class="campo"><label for="f-firmas">Firmas</label>
        <select id="f-firmas" [ngModel]="estado.filtros().firmas ?? ''" name="firmas" (ngModelChange)="filtrar({ firmas: $event })">
          <option value="">Todas</option><option value="faltantes">Faltan firmas</option><option value="no_determinables">No se pudieron determinar</option><option value="completas">Completas</option></select></div>
      <div class="campo"><label for="f-dis">Discrepancias</label>
        <select id="f-dis" [ngModel]="estado.filtros().conDiscrepancias ?? ''" name="conDiscrepancias" (ngModelChange)="filtrar({ conDiscrepancias: $event })">
          <option value="">Todas</option><option value="si">Con discrepancias</option><option value="no">Sin discrepancias</option></select></div>
      <button type="button" class="boton compacto" [attr.aria-expanded]="masAbiertos()" aria-controls="mas-filtros" (click)="masAbiertos.set(!masAbiertos())">
        {{ masAbiertos() ? 'Menos filtros' : 'Más filtros' }}@if (filtrosOcultosActivos() > 0) { ({{ filtrosOcultosActivos() }}) }
      </button>
      @if (hayFiltros()) { <button type="button" class="boton compacto" (click)="estado.limpiarFiltros()">Limpiar filtros</button> }
    </form>
    <div id="mas-filtros" class="mas" [hidden]="!masAbiertos()" role="group" aria-label="Más filtros">
      @if (estado.esSupervisor()) {
        <div class="campo"><label for="f-estado">Estado del Acta</label>
          <select id="f-estado" [ngModel]="estado.filtros().estado ?? ''" name="estado" (ngModelChange)="filtrar({ estado: $event })">
            <option value="">En revisión</option><option value="revision,aprobado_manual,devuelto,rechazado">Todos los estados</option><option value="aprobado_manual">Aprobadas</option><option value="devuelto">Devueltas</option><option value="rechazado">Rechazadas</option><option value="error">Con error de lectura</option></select></div>
      }
      <div class="campo"><label for="f-prio">Prioridad</label>
        <select id="f-prio" [ngModel]="estado.filtros().prioridadMinima ?? ''" name="prioridadMinima" (ngModelChange)="filtrar({ prioridadMinima: $event })">
          <option value="">Cualquiera</option><option value="20">20 o más</option><option value="30">30 o más</option><option value="40">40 o más</option></select></div>
      <div class="campo"><label for="f-rem">Remuneración del Acta</label>
        <select id="f-rem" [ngModel]="estado.filtros().remuneracion ?? ''" name="remuneracion" (ngModelChange)="filtrar({ remuneracion: $event })">
          <option value="">Todas</option><option value="remunerada">Remunerada</option><option value="no_remunerada">No remunerada</option><option value="no_determinable">No determinable</option></select></div>
      <div class="campo"><label for="f-arl">Responsable ARL del Acta</label>
        <select id="f-arl" [ngModel]="estado.filtros().responsableArl ?? ''" name="responsableArl" (ngModelChange)="filtrar({ responsableArl: $event })">
          <option value="">Todos</option><option value="empresa">Empresa</option><option value="cun">CUN</option><option value="no_determinable">No determinable</option></select></div>
      <div class="campo"><label for="f-inc">Documento</label>
        <select id="f-inc" [ngModel]="estado.filtros().documentoIncorrecto ?? ''" name="documentoIncorrecto" (ngModelChange)="filtrar({ documentoIncorrecto: $event })">
          <option value="">Todos</option><option value="si">Parece otro documento</option></select></div>
      <div class="campo"><label for="f-ree">Reenvío</label>
        <select id="f-ree" [ngModel]="estado.filtros().reenvio ?? ''" name="reenvio" (ngModelChange)="filtrar({ reenvio: $event })">
          <option value="">Todos</option><option value="si">Solo reenvíos</option></select></div>
      <div class="campo"><label for="f-ant">Antigüedad</label>
        <select id="f-ant" [ngModel]="estado.filtros().antiguedadMinDias ?? ''" name="antiguedadMinDias" (ngModelChange)="filtrar({ antiguedadMinDias: $event })">
          <option value="">Cualquiera</option><option value="1">1 día o más</option><option value="3">3 días o más</option><option value="7">7 días o más</option></select></div>
    </div>

    <div class="cuerpo" [class.ver-lista]="estado.vista() === 'lista'" [class.ver-caso]="estado.vista() === 'caso'" [class.sin-lista]="!!estado.seleccionId() && !listaVisible()">
      <section class="tarjeta lista-col compacto" aria-labelledby="t-lista">
        <div class="lista-cab">
          <h2 id="t-lista">Casos @if (estado.listado(); as l) { <span class="pista">({{ l.total }})</span> }</h2>
          @if (estado.seleccionId()) {
            <button type="button" class="boton compacto solo-escritorio" aria-label="Ocultar la lista de casos para dar más ancho al Acta" (click)="mostrarLista(false)">Ocultar</button>
          }
        </div>
        @if (estado.errorListado(); as e) {
          <div class="error" role="alert">{{ e }} <button type="button" class="boton compacto" (click)="estado.cargar()">Reintentar</button></div>
        } @else if (estado.cargando() && !estado.listado()) {
          <p class="pista" role="status">Cargando los casos…</p>
        } @else if (estado.items().length === 0) {
          <div class="vacio"><strong>No hay casos pendientes</strong><br />Todo está al día con los filtros actuales.</div>
        } @else {
          <ul class="lista" [attr.aria-busy]="estado.cargando()">
            @for (f of estado.items(); track f.validacionId) {
              <li>
                <button type="button" class="caso" [attr.aria-current]="estado.seleccionId() === f.validacionId" (click)="estado.seleccionar(f.validacionId)">
                  <span class="n">{{ f.estudiante.nombre }}</span>
                  <span class="empresa">{{ f.empresa ?? 'Sin empresa registrada' }}</span>
                  @if (problema(f); as pr) {
                    <span class="problema t-{{ pr.tono }}"><span aria-hidden="true">{{ pr.icono }}</span> {{ pr.texto }}</span>
                  } @else {
                    <span class="problema sin"><span aria-hidden="true">✓</span> Sin diferencias</span>
                  }
                  <span class="estado-linea">
                    Prioridad {{ f.prioridad.puntaje }} · <span aria-hidden="true">{{ reserva(f).icono }}</span> {{ reserva(f).texto }}@if (f.reserva.estado === 'mia') { · {{ restante(f) }} }@if (f.esReenvio) { · Reenvío (v{{ f.version }}) }
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <section class="tarjeta detalle-col" aria-label="Detalle del caso">
        @if (estado.seleccionId() && !listaVisible()) {
          <button type="button" class="boton compacto solo-escritorio" style="margin-bottom:var(--sp-3)" (click)="mostrarLista(true)">← Mostrar la lista de casos</button>
        }
        @if (estado.seleccionId()) { <sipra-actas-detalle /> }
        @else { <div class="vacio"><strong>Elija un caso</strong><br />Selecciónelo en la lista o pulse «Tomar siguiente» para empezar la revisión.</div> }
      </section>
    </div>

    @if (estado.esSupervisor()) {
      <div style="margin-top:var(--sp-4)"><sipra-actas-supervision (abrir)="estado.seleccionar($event)" (aplicar)="aplicarDesdeSupervision($event)" /></div>
    }
  `,
})
export class ActasComponent implements OnInit {
  protected readonly estado = inject(ActasMesaEstado);

  readonly kpis = KPIS;
  /** Los filtros no esenciales empiezan plegados (su botón dice cuántos hay activos): el caso en revisión queda a la vista. */
  readonly masAbiertos = signal(false);
  /** Solo escritorio: la bandeja compacta va junto al caso; quien necesite todo el ancho la oculta (y se recuerda). */
  readonly listaVisible = signal(leerListaVisible());
  readonly hayFiltros = computed(() => Object.keys(this.estado.filtros()).length > 0);
  readonly filtrosOcultosActivos = computed(() => {
    const f = this.estado.filtros();
    return (['estado', 'prioridadMinima', 'remuneracion', 'responsableArl', 'documentoIncorrecto', 'reenvio', 'antiguedadMinDias'] as const).filter((k) => f[k]).length;
  });

  async ngOnInit(): Promise<void> {
    void this.estado.cargarMotivos();
    await this.estado.cargar();
    if (this.estado.esSupervisor()) await this.estado.cargarSupervision();
  }

  filtrar(parcial: FiltrosActas): void { void this.estado.aplicarFiltros(parcial); }

  mostrarLista(visible: boolean): void {
    this.listaVisible.set(visible);
    try { localStorage.setItem(CLAVE_LISTA, visible ? 'si' : 'no'); } catch { /* sin almacenamiento: no persiste */ }
  }

  async clicKpi(k: TarjetaKpi): Promise<void> {
    const activo = this.kpiActivo(k);
    await this.estado.limpiarFiltros();
    if (!activo) await this.estado.aplicarFiltros(k.filtro ?? {});
  }

  async aplicarDesdeSupervision(f: FiltrosActas): Promise<void> {
    await this.estado.limpiarFiltros();
    await this.estado.aplicarFiltros(f);
    this.estado.volverALista();
  }

  kpiActivo(k: TarjetaKpi): boolean {
    const f = this.estado.filtros() as Record<string, unknown>;
    const pares = Object.entries(k.filtro ?? {});
    return pares.length > 0 && Object.keys(f).length === pares.length && pares.every(([c, v]) => f[c] === v);
  }

  reserva(f: ItemBandejaActa) { return textoReserva(f.reserva); }
  problema(f: ItemBandejaActa) { return problemaPrincipal(f); }
  restante(f: ItemBandejaActa): string { return textoRestante(f.reserva.hasta, this.estado.ahora()); }
}
