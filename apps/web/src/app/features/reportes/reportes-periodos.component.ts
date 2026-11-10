import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { porcentaje } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Comparación entre periodos académicos (eje principal), en orden cronológico, con el mismo cálculo que General. */
@Component({
  selector: 'sipra-reportes-periodos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .doble { display: grid; gap: 3px; min-width: 150px; }
    .doble .ra-mini { height: 5px; }
    .ra-tabla td.cob { width: 30%; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <section class="ra-bloque" aria-labelledby="p-comp">
        <h2 id="p-comp">Comparación de periodos</h2>
        <p class="ra-nota">El periodo es el registrado en cada práctica, ordenado por año y luego por su código. Cobertura: barra superior cargado, inferior aprobado, sobre los documentos exigidos del periodo.</p>
        @if (r.periodos.length) {
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Estudiantes, prácticas y cobertura documental por periodo</caption>
              <thead><tr><th scope="col">Periodo</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Cargado</th><th scope="col" class="d">Aprobado</th><th scope="col"><span class="ra-sr">Cobertura</span></th></tr></thead>
              <tbody>
                @for (p of r.periodos; track p.periodo) {
                  <tr>
                    <th scope="row" class="ra-num">{{ p.periodo }}</th>
                    <td class="d">{{ p.estudiantes }}</td>
                    <td class="d"><button type="button" class="ra-ir" (click)="estado.abrirDetalle({ periodo: p.periodo })">{{ p.practicas }}</button></td>
                    <td class="d">{{ p.completos }}</td>
                    <td class="d">{{ p.correccion }}</td>
                    <td class="d">{{ pct(p.cargados, p.exigidos) ?? '—' }} %</td>
                    <td class="d">{{ pct(p.aprobados, p.exigidos) ?? '—' }} %</td>
                    <td class="cob"><span class="doble" aria-hidden="true">
                      <span class="ra-mini"><span class="t-info" [style.width.%]="pct(p.cargados, p.exigidos) ?? 0"></span></span>
                      <span class="ra-mini"><span class="t-ok" [style.width.%]="pct(p.aprobados, p.exigidos) ?? 0"></span></span>
                    </span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (r.periodos.length === 1 && disponibles() > 1) {
            <p class="ra-nota" style="margin-top:12px">Hay {{ disponibles() }} periodos con prácticas en su alcance: quite el filtro de periodo para compararlos.</p>
          }
        }
      </section>
    }
  `,
})
export class ReportesPeriodosComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly pct = porcentaje;
  protected readonly disponibles = computed(() => this.estado.datos()?.periodosDisponibles.length ?? 0);
}
