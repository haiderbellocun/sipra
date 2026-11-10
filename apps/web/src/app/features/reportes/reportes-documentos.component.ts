import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { CATEGORIAS_OBLIGACION, horas, partes } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Documentos de la Mesa Única como dimensiones: tipo de documento × estado de su última versión (obligaciones),
 * fricción por versiones y decisiones auditadas, y tiempo de carga a decisión. No hay un reporte por motor.
 */
@Component({
  selector: 'sipra-reportes-documentos',
  standalone: true,
  imports: [EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .ancho { grid-column: 1 / -1; }
    .leyenda { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: -4px 0 14px; padding: 0; list-style: none; font-size: 12px; color: var(--text-secondary); }
    .ra-tabla td.mini { min-width: 140px; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <div class="ra-rejilla">
        <section class="ra-bloque ancho" aria-labelledby="d-tipo">
          <h2 id="d-tipo">Obligaciones por tipo de documento</h2>
          <p class="ra-nota">Una obligación por documento exigido en cada práctica, según el estado de su última versión: las versiones nuevas no suman obligaciones. Cada cifra abre las prácticas de ese recorte.</p>
          <div class="ra-pila" aria-hidden="true">
            @for (p of total(); track p.clave) { <span [class]="'t-' + (p.clase ?? p.tono)" [style.flex-grow]="p.n" [title]="p.texto + ': ' + p.n"></span> }
          </div>
          <ul class="leyenda">
            @for (p of total(); track p.clave) { <li><span class="ra-punto" [class]="'t-' + (p.clase ?? p.tono)" aria-hidden="true"></span>{{ p.texto }} · <span class="ra-num">{{ p.n }}</span> ({{ p.pct }} %)</li> }
          </ul>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Obligaciones documentales por tipo y estado</caption>
              <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Exigidos</th>
                @for (c of categorias; track c.clave) { <th scope="col" class="d">{{ c.texto }}</th> }
                <th scope="col"><span class="ra-sr">Distribución</span></th></tr></thead>
              <tbody>
                @for (t of r.porTipo; track t.tipo) {
                  <tr>
                    <th scope="row">{{ t.tipo | etiqueta }}</th>
                    <td class="d">{{ t.exigidos }}</td>
                    @for (c of categorias; track c.clave) {
                      <td class="d">
                        @if (t[c.clave]) { <button type="button" class="ra-ir" (click)="estado.abrirDetalle({ tipo: t.tipo, estadoDocumental: c.clave })" [attr.aria-label]="(t.tipo | etiqueta) + ', ' + c.texto + ': ' + t[c.clave] + '. Ver prácticas'">{{ t[c.clave] }}</button> }
                        @else { <span class="ra-tenue">0</span> }
                      </td>
                    }
                    <td class="mini"><span class="ra-mini" aria-hidden="true">@for (c of categorias; track c.clave) { <span [class]="'t-' + (c.clase ?? c.tono)" [style.flex-grow]="t[c.clave]"></span> }</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="ra-bloque" aria-labelledby="d-fric">
          <h2 id="d-fric">Correcciones y versiones</h2>
          <p class="ra-nota">Por tipo: documentos (práctica y tipo), versiones cargadas, documentos con reenvío y decisiones de devolver o rechazar registradas en la auditoría.</p>
          @if (r.friccion.length) {
            <div class="ra-desliza">
              <table class="ra-tabla">
                <caption class="ra-sr">Versiones, reenvíos, devoluciones y rechazos por tipo de documento</caption>
                <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Docs.</th><th scope="col" class="d">Versiones</th><th scope="col" class="d">Prom.</th><th scope="col" class="d">Con reenvío</th><th scope="col" class="d">Devol.</th><th scope="col" class="d">Rech.</th></tr></thead>
                <tbody>@for (f of r.friccion; track f.tipo) {
                  <tr><th scope="row">{{ f.tipo | etiqueta }}</th><td class="d">{{ f.documentos }}</td><td class="d">{{ f.versiones }}</td><td class="d">{{ f.promedioVersiones }}</td><td class="d">{{ f.conReenvio }}</td><td class="d">{{ f.devoluciones }}</td><td class="d">{{ f.rechazos }}</td></tr>
                }</tbody>
              </table>
            </div>
          } @else { <p class="ra-nota">Aún no hay documentos cargados en este filtro.</p> }
        </section>

        <section class="ra-bloque" aria-labelledby="d-tiempo">
          <h2 id="d-tiempo">Tiempo de carga a decisión</h2>
          <p class="ra-nota">Desde la carga de cada versión hasta su decisión humana auditada. No se usa la fecha de actualización del registro. No hay meta de servicio definida institucionalmente, por eso no se muestra cumplimiento de SLA.</p>
          @if (r.tiempos.decisiones) {
            <p class="ra-nota" style="color:var(--text-primary)">Mediana <strong class="ra-num">{{ horas(r.tiempos.medianaHoras) }}</strong> · p90 <strong class="ra-num">{{ horas(r.tiempos.p90Horas) }}</strong> · {{ r.tiempos.decisiones }} decisiones</p>
            <table class="ra-tabla">
              <caption class="ra-sr">Mediana de horas de carga a decisión por tipo de documento</caption>
              <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Decisiones</th><th scope="col" class="d">Mediana</th></tr></thead>
              <tbody>@for (t of r.tiempos.porTipo; track t.tipo) { <tr><th scope="row">{{ t.tipo | etiqueta }}</th><td class="d">{{ t.decisiones }}</td><td class="d">{{ horas(t.medianaHoras) }}</td></tr> }</tbody>
            </table>
          } @else { <p class="ra-nota">Sin decisiones auditadas en este filtro.</p> }
        </section>
      </div>
    }
  `,
})
export class ReportesDocumentosComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly categorias = CATEGORIAS_OBLIGACION;
  protected readonly horas = horas;
  protected readonly total = computed(() => { const r = this.estado.datos(); return r ? partes(CATEGORIAS_OBLIGACION, r.documental) : []; });
}
