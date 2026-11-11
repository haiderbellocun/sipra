import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CargaSenalComponent } from '@shared/components/carga-senal.component';
import { EstadoVacioComponent } from '@shared/components/estado-vacio.component';
import { SenalEstadoComponent } from '@shared/components/senal-estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { CATEGORIAS_EXPEDIENTE, RECEPTORES, migas, nivel, semestre, tituloSegmento } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Filas que se pintan; el CSV lleva todas. */
export const LIMITE_FILAS_DETALLE = 200;

/**
 * Tabla granular (fin de toda navegación analítica): una fila por práctica del contexto de filtros, con las mismas
 * definiciones de los agregados, y salida al Expediente existente. Búsqueda por nombre, programa o empresa en el servidor
 * (nunca por documento de identidad). Sin documento ni correo. El CSV del mismo recorte se audita en el servidor.
 */
@Component({
  selector: 'sipra-reportes-detalle',
  standalone: true,
  imports: [DatePipe, RouterLink, EtiquetaPipe, CargaSenalComponent, EstadoVacioComponent, SenalEstadoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    section { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border-default); scroll-margin-top: 16px; }
    section:focus { outline: none; }
    .cab { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .cab h2 { margin: 0; font: 600 15px/22px var(--fuente); color: var(--text-primary); }
    .cab p { margin: 2px 0 0; font-size: 12px; color: var(--text-secondary); }
    .botones { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .bt { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; font: 500 13px/1 var(--fuente); color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; }
    .bt:hover { border-color: var(--border-strong); }
    .bt:focus-visible, .busca:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .bt:disabled { opacity: .55; cursor: default; }
    .busca { height: 34px; width: min(100%, 300px); padding: 0 10px; font: inherit; font-size: 13px; color: var(--text-primary); background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }
    a { color: var(--signal-default); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    :host-context([data-theme='light']) a { color: #03587a; }
    .error { padding: 12px 0; font-size: 13px; color: var(--text-primary); }
    .pend { color: var(--ra-aviso); font-weight: 600; }
    .ra-tabla td { white-space: nowrap; }
    .ra-tabla td.envuelve { white-space: normal; min-width: 9rem; }
    @media (width < 700px) {
      .ra-tabla thead { display: none; }
      .ra-tabla tr { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--ra-regla); }
      .ra-tabla td { padding: 0; border: 0; }
      .ra-tabla td.oculta-movil { display: none; }
    }
  `],
  template: `
    @if (estado.segmento(); as s) {
      <section aria-labelledby="det-titulo" #raiz tabindex="-1">
        <div class="cab">
          <div>
            <h2 id="det-titulo">Prácticas · {{ titulo() }}</h2>
            @if (estado.detalle(); as d) { <p aria-live="polite">{{ d.total }} práctica(s) · {{ d.estudiantesUnicos }} estudiante(s) único(s)@if (estado.buscar()) { · búsqueda «{{ estado.buscar() }}» }@if (d.total > limite) { · se muestran las primeras {{ limite }}; el CSV las incluye todas }</p> }
          </div>
          <div class="botones">
            <label class="ra-sr" for="det-buscar">Buscar por estudiante, programa o empresa</label>
            <input id="det-buscar" class="busca" type="search" placeholder="Buscar estudiante, programa o empresa" [value]="estado.buscar()" (input)="buscar($event)" />
            <button type="button" class="bt" [disabled]="estado.exportando() || !estado.detalle()?.total" (click)="estado.exportar()">{{ estado.exportando() ? 'Generando…' : 'Descargar CSV' }}</button>
            @if (cerrable()) { <button type="button" class="bt" (click)="estado.cerrarDetalle()">Cerrar</button> }
          </div>
        </div>
        @if (estado.cargandoDetalle() && !estado.detalle()) {
          <sipra-carga-senal texto="Cargando las prácticas…" />
        } @else if (estado.errorDetalle(); as e) {
          <div class="error" role="alert">No fue posible cargar las prácticas: {{ e }} <button type="button" class="bt" (click)="estado.cargarDetalle()">Reintentar</button></div>
        } @else if (estado.detalle(); as d) {
          @if (d.total === 0) {
            <sipra-estado-vacio titulo="Sin prácticas en este recorte" [texto]="estado.buscar() ? 'Ninguna práctica del contexto coincide con la búsqueda.' : 'Ninguna práctica del contexto cumple esta condición.'" />
          } @else {
            <div class="ra-desliza">
              <table class="ra-tabla">
                <caption class="ra-sr">Prácticas de {{ titulo() }}</caption>
                <thead><tr><th scope="col">Estudiante</th><th scope="col">Programa</th><th scope="col">Nivel</th>@if (conSemestre()) { <th scope="col" title="Dato sintético de prueba">Sem.</th> }<th scope="col">Modalidad</th><th scope="col">Organización</th><th scope="col">Receptor</th><th scope="col">Sector</th><th scope="col">Ciudad</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col" class="d">Avance</th><th scope="col" class="d">Pend.</th><th scope="col" class="d">Devol.</th><th scope="col">Expediente</th><th scope="col">Último mov.</th><th scope="col"><span class="ra-sr">Acción</span></th></tr></thead>
                <tbody>
                  @for (f of filas(); track f.practicaId) {
                    <tr>
                      <td class="envuelve">{{ f.estudiante }}</td>
                      <td class="oculta-movil envuelve" [title]="f.programa + ' · ' + f.escuela">{{ f.programaNombre ?? f.programa }}</td>
                      <td class="oculta-movil">{{ nivel(f.ciclo) }}</td>
                      @if (conSemestre()) { <td class="oculta-movil d">{{ f.semestre ?? '—' }}</td> }
                      <td class="oculta-movil">{{ f.modalidad | etiqueta }}</td>
                      <td class="oculta-movil envuelve">{{ f.empresa ?? '—' }}</td>
                      <td class="oculta-movil">{{ f.tipoReceptor ? receptores[f.tipoReceptor] : '—' }}</td>
                      <td class="oculta-movil envuelve" [title]="f.sector ?? ''">{{ f.sector ?? 'Sin información' }}</td>
                      <td class="oculta-movil">{{ f.ciudad ?? 'Sin municipio' }}</td>
                      <td class="ra-num oculta-movil">{{ f.periodo }}</td>
                      <td class="oculta-movil">{{ f.estado | etiqueta }}</td>
                      <td class="d" [title]="'Aprobados ' + f.aprobados + ' de ' + f.exigidos + ' exigidos'">{{ f.aprobados }}/{{ f.exigidos }}</td>
                      <td class="d" [class.pend]="f.pendientes > 0">{{ f.pendientes }}</td>
                      <td class="d oculta-movil">{{ f.devoluciones }}</td>
                      <td><sipra-senal-estado [tono]="tono(f.situacion)" [texto]="texto(f.situacion)" /></td>
                      <td class="ra-num oculta-movil" [title]="f.ultimoMovimiento ? (f.ultimoMovimiento | date: 'yyyy-MM-dd HH:mm' : '-0500') + ' (hora de Colombia)' : ''">{{ f.ultimoMovimiento ? (f.ultimoMovimiento | date: 'yyyy-MM-dd' : '-0500') : '—' }}</td>
                      <td><a [routerLink]="['/practicas', f.practicaId]" [attr.aria-label]="'Abrir expediente de ' + f.estudiante">Abrir expediente</a></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </section>
    }
  `,
})
export class ReportesDetalleComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly limite = LIMITE_FILAS_DETALLE;
  protected readonly nivel = nivel;
  protected readonly receptores = RECEPTORES;
  protected readonly semestre = semestre;
  protected readonly conSemestre = computed(() => this.estado.datos()?.dimensiones.semestre === 'sintetica');
  private readonly etiqueta = new EtiquetaPipe();
  private readonly raiz = viewChild<ElementRef<HTMLElement>>('raiz');
  private espera: ReturnType<typeof setTimeout> | undefined;

  /** En Estudiantes la tabla es parte de la vista (no se cierra); en el resto es un drilldown que se puede cerrar. */
  protected readonly cerrable = computed(() => this.estado.pestana() !== 'estudiantes');
  protected readonly titulo = computed(() => {
    const s = this.estado.segmento();
    if (!s) return '';
    const contexto = migas(this.estado.filtros(), { escuela: this.estado.nombreEscuela, etiqueta: (v) => this.etiqueta.transform(v), programa: this.estado.nombrePrograma, sector: this.estado.nombreSector, ciudad: this.estado.nombreCiudad }).map((m) => m.valor);
    return [...(contexto.length ? contexto : ['todo el alcance']), ...(s.tipo || s.estadoDocumental ? [tituloSegmento(s, (v) => this.etiqueta.transform(v))] : [])].join(' · ');
  });
  protected readonly filas = computed(() => (this.estado.detalle()?.filas ?? []).slice(0, LIMITE_FILAS_DETALLE));

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.espera));
    // Un recorte documental abierto desde una cifra lleva el foco al detalle (no se pierde el contexto con teclado).
    effect(() => {
      const el = this.raiz()?.nativeElement;
      const s = this.estado.segmento();
      if (el && s && (s.tipo || s.estadoDocumental)) {
        el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        el.focus({ preventScroll: true });
      }
    });
  }

  protected buscar(evento: Event): void {
    this.estado.buscar.set((evento.target as HTMLInputElement).value.slice(0, 80));
    clearTimeout(this.espera);
    this.espera = setTimeout(() => void this.estado.cargarDetalle(), 300);
  }

  protected tono(s: string) { return CATEGORIAS_EXPEDIENTE.find((c) => c.clave === s)?.tono ?? 'neutra'; }
  protected texto(s: string): string { return CATEGORIAS_EXPEDIENTE.find((c) => c.clave === s)?.texto ?? s; }
}
