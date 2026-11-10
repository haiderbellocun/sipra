import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CargaSenalComponent } from '@shared/components/carga-senal.component';
import { EstadoVacioComponent } from '@shared/components/estado-vacio.component';
import { SenalEstadoComponent } from '@shared/components/senal-estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { CATEGORIAS_EXPEDIENTE, tituloSegmento } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Filas que se pintan; el CSV lleva todas. */
export const LIMITE_FILAS_DETALLE = 200;

/**
 * Detalle de un recorte (drilldown): una fila por práctica, con las mismas definiciones de los agregados. Muestra el
 * nombre del estudiante (para gestionar), nunca documento ni correo. El CSV del recorte se audita en el servidor.
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
    .botones { display: flex; gap: 8px; }
    .bt { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; font: 500 13px/1 var(--fuente); color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; }
    .bt:hover { border-color: var(--border-strong); }
    .bt:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .bt:disabled { opacity: .55; cursor: default; }
    a { color: var(--signal-default); text-decoration: none; }
    a:hover { text-decoration: underline; }
    :host-context([data-theme='light']) a { color: #03587a; }
    .error { padding: 12px 0; font-size: 13px; color: var(--text-primary); }
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
            <h2 id="det-titulo">Detalle · {{ titulo() }}</h2>
            @if (estado.detalle(); as d) { <p aria-live="polite">{{ d.total }} práctica(s) · {{ d.estudiantesUnicos }} estudiante(s) único(s)@if (d.total > limite) { · se muestran las primeras {{ limite }}; el CSV las incluye todas }</p> }
          </div>
          <div class="botones">
            <button type="button" class="bt" [disabled]="estado.exportando() || !estado.detalle()?.total" (click)="estado.exportar()">{{ estado.exportando() ? 'Generando…' : 'Descargar CSV' }}</button>
            <button type="button" class="bt" (click)="estado.cerrarDetalle()">Cerrar detalle</button>
          </div>
        </div>
        @if (estado.cargandoDetalle()) {
          <sipra-carga-senal texto="Cargando el detalle…" />
        } @else if (estado.errorDetalle(); as e) {
          <div class="error" role="alert">No fue posible cargar el detalle: {{ e }} <button type="button" class="bt" (click)="estado.abrirDetalle(s)">Reintentar</button></div>
        } @else if (estado.detalle(); as d) {
          @if (d.total === 0) {
            <sipra-estado-vacio titulo="Sin prácticas en este recorte" texto="Ninguna práctica del filtro cumple esta condición." />
          } @else {
            <div class="ra-desliza">
              <table class="ra-tabla">
                <caption class="ra-sr">Prácticas del recorte {{ titulo() }}</caption>
                <thead><tr><th scope="col">Estudiante</th><th scope="col">Programa</th><th scope="col">Modalidad</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col" class="d">Aprobados</th><th scope="col">Expediente</th><th scope="col">Último movimiento</th></tr></thead>
                <tbody>
                  @for (f of filas(); track f.practicaId) {
                    <tr>
                      <td><a [routerLink]="['/practicas', f.practicaId]">{{ f.estudiante }}</a></td>
                      <td class="oculta-movil ra-num" [title]="f.escuela">{{ f.programa }}</td>
                      <td class="oculta-movil">{{ f.modalidad | etiqueta }}</td>
                      <td class="ra-num oculta-movil">{{ f.periodo }}</td>
                      <td class="oculta-movil">{{ f.estado | etiqueta }}</td>
                      <td class="d">{{ f.aprobados }}/{{ f.exigidos }}</td>
                      <td><sipra-senal-estado [tono]="tono(f.situacion)" [texto]="texto(f.situacion)" /></td>
                      <td class="ra-num oculta-movil">{{ f.ultimoMovimiento ? (f.ultimoMovimiento | date: 'yyyy-MM-dd HH:mm' : '-0500') : '—' }}</td>
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
  private readonly etiqueta = new EtiquetaPipe();
  private readonly raiz = viewChild<ElementRef<HTMLElement>>('raiz');

  protected readonly titulo = computed(() => { const s = this.estado.segmento(); return s ? tituloSegmento(s, (v) => this.etiqueta.transform(v), (c) => this.estado.opciones().escuelas.find((e) => e.codigo === c)?.nombre ?? c) : ''; });
  protected readonly filas = computed(() => (this.estado.detalle()?.filas ?? []).slice(0, LIMITE_FILAS_DETALLE));

  constructor() {
    // Al abrir un recorte, el foco y la vista van al detalle (no se pierde el contexto con teclado ni lector).
    effect(() => {
      const el = this.raiz()?.nativeElement;
      if (el && this.estado.segmento()) { el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); }
    });
  }

  protected tono(s: string) { return CATEGORIAS_EXPEDIENTE.find((c) => c.clave === s)?.tono ?? 'neutra'; }
  protected texto(s: string): string { return CATEGORIAS_EXPEDIENTE.find((c) => c.clave === s)?.texto ?? s; }
}
