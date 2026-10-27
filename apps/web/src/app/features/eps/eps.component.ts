import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilaMesa, KpisMesa } from '@core/models/modelos';
import { EpsDetalleComponent } from './eps-detalle.component';
import { EpsMesaEstado, VistaRapida } from './eps-mesa.estado';
import { AFILIACION, AUTENTICIDAD, ESTADO_ADRES, ESTADO_RESERVA, RECOMENDACION, diaCorto, textoRestante } from './eps.util';

interface TarjetaKpi { clave: keyof KpisMesa; titulo: string; vista?: VistaRapida; filtro?: Record<string, string> }

const KPIS: TarjetaKpi[] = [
  { clave: 'abiertas', titulo: 'Casos abiertos', vista: 'todos' },
  { clave: 'pendientes', titulo: 'Pendientes', filtro: { responsable: 'sin_asignar' } },
  { clave: 'enRevision', titulo: 'En revisión (otras personas)', filtro: { responsable: 'otros' } },
  { clave: 'pendientesAdres', titulo: 'Pendientes de ADRES', filtro: { estadoAdres: 'pendiente' } },
  { clave: 'conDiscrepancias', titulo: 'Con discrepancias', filtro: { conDiscrepancias: 'si' } },
  { clave: 'candidatos', titulo: 'Candidatos', filtro: { recomendacion: 'candidato_autoaprobacion' } },
  { clave: 'asignadosAMi', titulo: 'Asignados a mí', vista: 'mis' },
];

const CLAVE_LISTA = 'sipra.mesa.lista';
function leerListaFijada(): boolean {
  try { return localStorage.getItem(CLAVE_LISTA) === 'si'; } catch { return false; }
}

const VISTAS: Array<{ valor: VistaRapida; texto: string }> = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'mis', texto: 'Mis casos' },
  { valor: 'mis_pendiente_adres', texto: 'Míos · falta ADRES' },
  { valor: 'mis_listos', texto: 'Míos · listos para decidir' },
  { valor: 'por_vencer', texto: 'Reservas por vencer' },
];

/**
 * Mesa operativa de validación de EPS. La pantalla solo coordina: la bandeja, los
 * filtros, la prioridad, la reserva y el TOMAR SIGUIENTE los resuelve la API (de forma
 * atómica); la decisión es siempre de una persona.
 */
@Component({
  selector: 'sipra-eps',
  standalone: true,
  imports: [FormsModule, EpsDetalleComponent],
  providers: [EpsMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cab { display:flex; gap:var(--sp-2) var(--sp-4); justify-content:space-between; align-items:center; flex-wrap:wrap; }
    .cab > div:first-child { flex:1 1 24rem; min-width:0; }
    .cab h1 { margin:0; } .cab p { margin:0; }
    .kpis { display:flex; flex-wrap:wrap; gap:var(--sp-2); margin:var(--sp-3) 0; }
    .kpi { flex:0 1 auto; display:flex; align-items:baseline; gap:var(--sp-2); text-align:left; white-space:nowrap; border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie); padding:var(--sp-2); min-height:44px; cursor:pointer; color:inherit; font:inherit; }
    .kpi:hover { background:var(--superficie-2); }
    .kpi[aria-pressed='true'] { border-color:var(--marca); background:var(--marca-suave); }
    .kpi .n { font-size:1.25rem; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
    .kpi .t { font-size:var(--fs-sm); color:var(--texto-tenue); line-height:1.2; }
    .vistas { display:flex; gap:var(--sp-2); flex-wrap:wrap; margin-bottom:var(--sp-3); align-items:center; }
    .vistas button[aria-pressed='true'] { border-color:var(--marca); background:var(--marca-suave); }
    .filtros { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); align-items:end; margin-bottom:var(--sp-3); }
    .filtros .campo { margin:0; }
    .filtros[hidden] { display:none; }
    .cuerpo { display:grid; gap:var(--sp-4); grid-template-columns:1fr; align-items:start; }
    @media (width >= 1200px) { .cuerpo { grid-template-columns:248px minmax(0,1fr); } }
    @media (width >= 1200px) { .cuerpo.sin-lista { grid-template-columns:minmax(0,1fr); } .cuerpo.sin-lista .lista-col { display:none; } }
    .detalle-col { min-width:0; padding:var(--sp-4); }
    @media (width < 600px) { .detalle-col { padding:var(--sp-3); } }
    .solo-escritorio { display:none; }
    @media (width >= 1200px) { .solo-escritorio { display:inline-flex; } }
    .lista-cab { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-2); margin-bottom:var(--sp-2); }
    .lista-cab h2 { margin:0; }
    @media (width < 1200px) { .cuerpo.ver-detalle .lista-col { display:none; } .cuerpo.ver-lista .detalle-col { display:none; } }
    .lista { list-style:none; margin:0; padding:0; max-height:calc(100dvh - 320px); min-height:240px; overflow:auto; }
    .caso { display:block; width:100%; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--borde); padding:var(--sp-2) var(--sp-2); cursor:pointer; color:inherit; font:inherit; }
    .caso:hover { background:var(--superficie-2); }
    .caso[aria-current='true'] { background:var(--marca-suave); }
    .caso .l1 { display:flex; gap:var(--sp-2); align-items:baseline; justify-content:space-between; }
    .caso .n { font-weight:700; overflow-wrap:break-word; min-width:0; }
    .caso .prio { flex:none; font-size:var(--fs-sm); font-weight:700; color:var(--texto-tenue); font-variant-numeric:tabular-nums; }
    .caso .meta { display:block; font-size:var(--fs-sm); color:var(--texto-tenue); overflow-wrap:break-word; }
    .caso .etiquetas { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }
    .caso .etiqueta { font-size:var(--fs-xs); padding:2px 8px; }
    .pagina { display:flex; gap:var(--sp-1) var(--sp-2); flex-wrap:wrap; align-items:center; justify-content:space-between; margin-top:var(--sp-2); font-size:var(--fs-sm); }
    .pagina .boton { white-space:nowrap; padding:0 var(--sp-3); }
    .sup table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
    .sup th, .sup td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--borde); }
    .sup .envoltura { overflow-x:auto; }
    .aviso-trunc { background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); font-size:var(--fs-sm); margin-bottom:var(--sp-2); }
    .error { background:var(--peligro-suave); padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>Mesa de validación de EPS</h1>
        <p class="pista">Revise el certificado, contraste con ADRES y decida. La recomendación del sistema es una ayuda; la decisión es suya.</p>
      </div>
      <div class="acciones">
        <button type="button" class="boton boton--primario compacto" [disabled]="estado.ocupado()" (click)="estado.tomarSiguiente()">Tomar siguiente</button>
        <button type="button" class="boton compacto" [disabled]="estado.ocupado()" (click)="estado.tomarSiguiente('pendiente_adres')">Siguiente con ADRES pendiente</button>
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
      </div>
    }

    <div class="vistas" role="group" aria-label="Vistas rápidas">
      @for (v of vistas; track v.valor) {
        <button type="button" class="boton compacto" [attr.aria-pressed]="estado.vistaRapida() === v.valor" (click)="estado.elegirVista(v.valor)">{{ v.texto }}</button>
      }
      <button type="button" class="boton compacto" style="margin-left:auto" [attr.aria-expanded]="filtrosAbiertos()" aria-controls="filtros-mesa" (click)="filtrosAbiertos.set(!filtrosAbiertos())">
        {{ filtrosAbiertos() ? 'Ocultar filtros' : 'Mostrar filtros' }}@if (filtrosActivos() > 0) { ({{ filtrosActivos() }} activos) }
      </button>
    </div>
    <form id="filtros-mesa" class="filtros" role="search" aria-label="Filtros de la Mesa" [hidden]="!filtrosAbiertos()" (submit)="$event.preventDefault()">
      <div class="campo"><label for="f-buscar">Buscar estudiante o documento</label>
        <input id="f-buscar" type="search" autocomplete="off" [ngModel]="estado.filtros().buscar ?? ''" name="buscar" (ngModelChange)="estado.buscar($event)" /></div>
      <div class="campo"><label for="f-adres">Estado ADRES</label>
        <select id="f-adres" [ngModel]="estado.filtros().estadoAdres ?? ''" name="estadoAdres" (ngModelChange)="filtrar({ estadoAdres: $event })">
          <option value="">Todos</option>@for (e of estadosAdres; track e[0]) { <option [value]="e[0]">{{ e[1] }}</option> }</select></div>
      <div class="campo"><label for="f-aut">Autenticidad</label>
        <select id="f-aut" [ngModel]="estado.filtros().autenticidad ?? ''" name="autenticidad" (ngModelChange)="filtrar({ autenticidad: $event })">
          <option value="">Todas</option>@for (e of autenticidades; track e[0]) { <option [value]="e[0]">{{ e[1] }}</option> }</select></div>
      <div class="campo"><label for="f-afi">Afiliación</label>
        <select id="f-afi" [ngModel]="estado.filtros().afiliacion ?? ''" name="afiliacion" (ngModelChange)="filtrar({ afiliacion: $event })">
          <option value="">Todas</option>@for (e of afiliaciones; track e[0]) { <option [value]="e[0]">{{ e[1] }}</option> }</select></div>
      <div class="campo"><label for="f-rec">Recomendación</label>
        <select id="f-rec" [ngModel]="estado.filtros().recomendacion ?? ''" name="recomendacion" (ngModelChange)="filtrar({ recomendacion: $event })">
          <option value="">Todas</option>@for (e of recomendaciones; track e[0]) { <option [value]="e[0]">{{ e[1] }}</option> }</select></div>
      <div class="campo"><label for="f-dis">Discrepancias</label>
        <select id="f-dis" [ngModel]="estado.filtros().conDiscrepancias ?? ''" name="conDiscrepancias" (ngModelChange)="filtrar({ conDiscrepancias: $event })">
          <option value="">Todas</option><option value="si">Con discrepancias</option><option value="no">Sin discrepancias</option></select></div>
      <div class="campo"><label for="f-res">Responsable</label>
        <select id="f-res" [ngModel]="estado.filtros().responsable ?? ''" name="responsable" (ngModelChange)="filtrar({ responsable: $event })">
          <option value="">Todos</option><option value="yo">Yo</option><option value="otros">Otras personas</option><option value="sin_asignar">Sin asignar</option></select></div>
      <div class="campo"><label for="f-per">Periodo</label>
        <select id="f-per" [ngModel]="estado.filtros().periodo ?? ''" name="periodo" (ngModelChange)="filtrar({ periodo: $event })">
          <option value="">Todos</option>@for (p of estado.listado()?.filtrosDisponibles?.periodos ?? []; track p) { <option [value]="p">{{ p }}</option> }</select></div>
      <div class="campo"><label for="f-pro">Programa</label>
        <select id="f-pro" [ngModel]="estado.filtros().programa ?? ''" name="programa" (ngModelChange)="filtrar({ programa: $event })">
          <option value="">Todos</option>@for (p of estado.listado()?.filtrosDisponibles?.programas ?? []; track p) { <option [value]="p">{{ p }}</option> }</select></div>
      <div class="campo"><label for="f-mod">Modalidad</label>
        <select id="f-mod" [ngModel]="estado.filtros().modalidad ?? ''" name="modalidad" (ngModelChange)="filtrar({ modalidad: $event })">
          <option value="">Todas</option>@for (p of estado.listado()?.filtrosDisponibles?.modalidades ?? []; track p) { <option [value]="p">{{ p }}</option> }</select></div>
      <div class="campo"><label for="f-des">Recibido desde</label>
        <input id="f-des" type="date" [ngModel]="estado.filtros().desde ?? ''" name="desde" (ngModelChange)="filtrar({ desde: $event })" /></div>
      <div class="campo"><label for="f-has">Recibido hasta</label>
        <input id="f-has" type="date" [ngModel]="estado.filtros().hasta ?? ''" name="hasta" (ngModelChange)="filtrar({ hasta: $event })" /></div>
      <button type="button" class="boton" (click)="estado.limpiarFiltros()">Limpiar filtros</button>
    </form>

    <div class="cuerpo" [class.ver-lista]="estado.vista() === 'lista'" [class.ver-detalle]="estado.vista() === 'detalle'" [class.sin-lista]="!!estado.seleccionId() && !listaVisible()">
      <section class="tarjeta lista-col compacto" aria-labelledby="t-lista">
        <div class="lista-cab">
          <h2 id="t-lista">Casos @if (estado.listado(); as l) { <span class="pista">({{ l.total }})</span> }</h2>
          @if (estado.seleccionId()) {
            <button type="button" class="boton compacto solo-escritorio" aria-label="Ocultar la lista de casos para dar más ancho al detalle" (click)="mostrarLista(false)">Ocultar</button>
          }
        </div>
        @if (estado.listado()?.truncado) {
          <div class="aviso-trunc" role="status">Hay más casos abiertos de los que la lista carga: se muestran los {{ estado.listado()?.mostrando }} más antiguos de {{ estado.listado()?.kpis?.abiertas }}. Use los filtros; «Tomar siguiente» siempre considera todos.</div>
        }
        @if (estado.errorListado(); as e) {
          <div class="error" role="alert">{{ e }} <button type="button" class="boton compacto" (click)="estado.cargar()">Reintentar</button></div>
        } @else if (estado.cargando() && !estado.listado()) {
          <p class="pista" role="status">Cargando los casos…</p>
        } @else if (estado.filas().length === 0) {
          <div class="vacio">No hay casos con estos criterios.</div>
        } @else {
          <ul class="lista" [attr.aria-busy]="estado.cargando()">
            @for (f of estado.filas(); track f.validacionId) {
              <li>
                <button type="button" class="caso" [attr.aria-current]="estado.seleccionId() === f.validacionId" (click)="estado.seleccionar(f.validacionId)">
                  <span class="l1">
                    <span class="n">{{ f.estudiante.nombre }}</span>
                    <span class="prio" [attr.title]="f.prioridad.razones.join(' · ')">P{{ f.prioridad.puntaje }}</span>
                  </span>
                  <span class="meta">{{ f.estudiante.documentoEnmascarado }} · {{ f.programa }} · recibido {{ dia(f.recibidaEn) }}@if (f.totalVersiones > 1) { · v{{ f.versionDocumento }} }</span>
                  <span class="etiquetas">
                    <span class="etiqueta etiqueta--icono etiqueta--{{ reserva(f).tono }}"><span aria-hidden="true">{{ reserva(f).icono }}</span> {{ reserva(f).texto }}@if (f.reserva.estado === 'mia') { · {{ restante(f) }} }</span>
                    @if (f.recomendacion !== 'pendiente_adres') {
                      <span class="etiqueta etiqueta--icono etiqueta--{{ rec(f).tono }}"><span aria-hidden="true">{{ rec(f).icono }}</span> {{ rec(f).texto }}</span>
                    }
                    <span class="etiqueta etiqueta--icono etiqueta--{{ adres(f).tono }}"><span aria-hidden="true">{{ adres(f).icono }}</span> {{ adres(f).texto }}</span>
                    @if (f.discrepancias.criticas > 0) { <span class="etiqueta etiqueta--icono etiqueta--peligro"><span aria-hidden="true">!</span> {{ f.discrepancias.criticas }} crítica{{ f.discrepancias.criticas > 1 ? 's' : '' }}</span> }
                  </span>
                </button>
              </li>
            }
          </ul>
          @if (estado.listado(); as l) {
            <div class="pagina">
              <button type="button" class="boton compacto" [disabled]="l.pagina <= 1" (click)="estado.aplicarFiltros({ pagina: l.pagina - 1 })">Anterior</button>
              <span>Página {{ l.pagina }} de {{ paginas(l.total, l.limite) }}</span>
              <button type="button" class="boton compacto" [disabled]="l.pagina >= paginas(l.total, l.limite)" (click)="estado.aplicarFiltros({ pagina: l.pagina + 1 })">Siguiente</button>
            </div>
          }
        }
      </section>

      <section class="tarjeta detalle-col" aria-label="Detalle del caso">
        @if (estado.seleccionId() && !listaVisible()) {
          <button type="button" class="boton compacto solo-escritorio" style="margin-bottom:var(--sp-3)" (click)="mostrarLista(true)">← Mostrar la lista de casos</button>
        }
        @if (estado.seleccionId()) { <sipra-eps-detalle /> }
        @else { <div class="vacio">Elija un caso de la lista o pulse «Tomar siguiente».</div> }
      </section>
    </div>

    @if (estado.esSupervisor()) {
      <section class="tarjeta sup" style="margin-top:var(--sp-4)" aria-labelledby="t-sup">
        <h2 id="t-sup">Supervisión</h2>
        <div class="acciones"><button type="button" class="boton" [disabled]="estado.cargandoSupervision()" (click)="estado.cargarSupervision()">Cargar la supervisión</button></div>
        @if (estado.supervision(); as s) {
          <p>{{ s.abiertas }} abiertos · {{ s.sinAsignar }} sin asignar · primera revisión en promedio: {{ s.horasMediasHastaPrimeraRevision ?? '—' }} h</p>
          <div class="envoltura">
            <table>
              <thead><tr><th scope="col">Funcionario</th><th scope="col">Reservas vigentes</th><th scope="col">Por vencer</th><th scope="col">Decididos (7 días)</th><th scope="col">Horas medias hasta decidir</th></tr></thead>
              <tbody>
                @for (f of s.funcionarios; track f.funcionarioId) {
                  <tr><th scope="row">{{ f.nombre }}</th><td>{{ f.reservasVigentes }}</td><td>{{ f.reservasPorVencer }}</td><td>{{ f.decididas7Dias }}</td><td>{{ f.horasMediasHastaDecision ?? '—' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
})
export class EpsComponent implements OnInit {
  protected readonly estado = inject(EpsMesaEstado);

  readonly kpis = KPIS;
  readonly vistas = VISTAS;
  /** Los filtros empiezan plegados (su botón dice cuántos hay activos): el caso en revisión queda a la vista. */
  readonly filtrosAbiertos = signal(false);
  /**
   * Solo escritorio: con un caso abierto la lista se oculta para darle todo el ancho al detalle (certificado y revisión);
   * quien la prefiera al lado la fija. Es una comodidad por navegador, no un dato del caso.
   */
  readonly listaVisible = signal(leerListaFijada());
  readonly filtrosActivos = computed(() => Object.keys(this.estado.filtros()).filter((k) => k !== 'pagina').length);
  readonly estadosAdres = Object.entries(ESTADO_ADRES).map(([k, v]) => [k, v.texto] as const);
  readonly autenticidades = Object.entries(AUTENTICIDAD).map(([k, v]) => [k, v.texto] as const);
  readonly afiliaciones = Object.entries(AFILIACION).map(([k, v]) => [k, v.texto] as const);
  readonly recomendaciones = Object.entries(RECOMENDACION).map(([k, v]) => [k, v.texto] as const);

  async ngOnInit(): Promise<void> {
    await this.estado.cargar();
    if (this.estado.esSupervisor()) await this.estado.cargarSupervision();
  }

  filtrar(parcial: Record<string, string>): void { void this.estado.aplicarFiltros(parcial); }

  mostrarLista(visible: boolean): void {
    this.listaVisible.set(visible);
    try { localStorage.setItem(CLAVE_LISTA, visible ? 'si' : 'no'); } catch { /* sin almacenamiento: no persiste */ }
  }

  async clicKpi(k: TarjetaKpi): Promise<void> {
    if (k.vista) { await this.estado.limpiarFiltros(); if (k.vista !== 'todos') await this.estado.elegirVista(k.vista); return; }
    await this.estado.limpiarFiltros();
    await this.estado.aplicarFiltros(k.filtro ?? {});
  }

  kpiActivo(k: TarjetaKpi): boolean {
    if (k.vista) return this.estado.vistaRapida() === k.vista && Object.keys(this.estado.filtros()).length === 0;
    const f = this.estado.filtros() as Record<string, unknown>;
    return Object.entries(k.filtro ?? {}).every(([c, v]) => f[c] === v);
  }

  reserva(f: FilaMesa) { return ESTADO_RESERVA[f.reserva.estado]; }
  rec(f: FilaMesa) { return RECOMENDACION[f.recomendacion] ?? RECOMENDACION['informacion_insuficiente']; }
  adres(f: FilaMesa) { return ESTADO_ADRES[f.estadoAdres] ?? ESTADO_ADRES['no_determinable']; }
  restante(f: FilaMesa): string { return textoRestante(f.reserva.hasta, this.estado.ahora()); }
  dia(iso: string | null): string { return diaCorto(iso); }
  paginas(total: number, limite: number): number { return Math.max(1, Math.ceil(total / Math.max(1, limite))); }
}
