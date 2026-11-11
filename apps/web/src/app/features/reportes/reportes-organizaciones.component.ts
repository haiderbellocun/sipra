import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesApiladasComponent } from './reportes-apiladas.component';
import { RECEPTORES, SIN_DATO, TASAS, TipoReceptor, compararNiveles, nivel, pct1, razon } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Organizaciones receptoras como dimensión: sector (sección CIIU de la empresa) y ciudad (municipio DIVIPOLA) del modelo
 * real, e interna CUN frente a externa según la regla del dominio (modalidad articulada). Todo es cross-filter del mismo
 * contexto. La comparación interna/externa es descriptiva: no se infiere causalidad.
 */
@Component({
  selector: 'sipra-reportes-organizaciones',
  standalone: true,
  imports: [ReportesApiladasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .ancho { grid-column: 1 / -1; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <div class="ra-rejilla">
        <section class="ra-bloque ancho" aria-labelledby="o-doc">
          <h2 id="o-doc">Interna CUN frente a externa</h2>
          <p class="ra-nota">Distribución descriptiva, sin causalidad. {{ tasas.aprobacion.texto }} = {{ tasas.aprobacion.definicion }}; {{ tasas.devolucion.texto }} = {{ tasas.devolucion.definicion }}. El nombre filtra el reporte.</p>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Cobertura documental por tipo de organización receptora</caption>
              <thead><tr><th scope="col">Receptor</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">%</th><th scope="col" class="d">Exigidos</th><th scope="col" class="d">Cargado</th><th scope="col" class="d">Aprobación</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Devol./doc.</th></tr></thead>
              <tbody>
                @for (x of receptores(); track x.tipo) {
                  <tr>
                    <th scope="row"><button type="button" class="ra-ir" [attr.aria-pressed]="estado.filtros().tipoReceptor === x.tipo" (click)="tipo(x.tipo)">{{ etiquetaReceptor(x.tipo) }}</button></th>
                    <td class="d">{{ x.estudiantes }}</td><td class="d ra-tenue">{{ pct1(x.estudiantes, r.resumen.estudiantes) }}</td>
                    <td class="d">{{ x.exigidos }}</td><td class="d">{{ pct1(x.cargados, x.exigidos) }}</td><td class="d">{{ pct1(x.aprobados, x.exigidos) }}</td>
                    <td class="d">{{ x.completos }}</td><td class="d">{{ x.correccion }}</td><td class="d">{{ razon(x.devoluciones, x.documentos) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="ra-bloque" aria-labelledby="o-ps">
          <h2 id="o-ps">Programa × sector económico</h2>
          <p class="ra-nota">Qué sectores (sección CIIU) reciben estudiantes de cada programa.</p>
          <sipra-reportes-apiladas titulo="Estudiantes por programa y sector" rotuloFilas="Programa" rotuloColumnas="sector" [celdas]="r.cruces.programaSector"
            [texto]="estado.nombreSector" [textoFila]="estado.nombrePrograma" [seleccionFila]="estado.filtros().programa" [seleccionColumna]="estado.filtros().sector"
            (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="dato('sector', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="o-pc">
          <h2 id="o-pc">Programa × ciudad</h2>
          <p class="ra-nota">Municipio DIVIPOLA de la organización receptora.</p>
          <sipra-reportes-apiladas titulo="Estudiantes por programa y ciudad" rotuloFilas="Programa" rotuloColumnas="ciudad" [celdas]="r.cruces.programaCiudad"
            [texto]="estado.nombreCiudad" [textoFila]="estado.nombrePrograma" [seleccionFila]="estado.filtros().programa" [seleccionColumna]="estado.filtros().ciudad"
            (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="dato('ciudad', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="o-ns">
          <h2 id="o-ns">Nivel × sector</h2>
          <p class="ra-nota">Sectores de cada nivel de formación.</p>
          <sipra-reportes-apiladas titulo="Estudiantes por nivel y sector" rotuloFilas="Nivel" rotuloColumnas="sector" [celdas]="r.cruces.nivelSector"
            [texto]="estado.nombreSector" [textoFila]="nivel" [ordenFilas]="compararNiveles" [seleccionFila]="estado.filtros().ciclo" [seleccionColumna]="estado.filtros().sector"
            (elegirFila)="estado.alternar('ciclo', $event)" (elegirColumna)="dato('sector', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="o-ms">
          <h2 id="o-ms">Modalidad × sector</h2>
          <p class="ra-nota">Qué sectores concentran cada modalidad.</p>
          <sipra-reportes-apiladas titulo="Estudiantes por modalidad y sector" rotuloFilas="Modalidad" rotuloColumnas="sector" [celdas]="r.cruces.modalidadSector"
            [texto]="estado.nombreSector" [textoFila]="etiqueta" [seleccionFila]="estado.filtros().modalidad" [seleccionColumna]="estado.filtros().sector"
            (elegirFila)="estado.alternar('modalidad', $event)" (elegirColumna)="dato('sector', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="o-rp">
          <h2 id="o-rp">Interna / externa × programa</h2>
          <p class="ra-nota">Programas con estudiantes en práctica interna CUN o externa (distribución, no desempeño).</p>
          <sipra-reportes-apiladas titulo="Estudiantes por tipo de receptor y programa" rotuloFilas="Receptor" rotuloColumnas="programa" [celdas]="r.cruces.receptorPrograma"
            [texto]="estado.nombrePrograma" [textoFila]="etiquetaReceptor" [seleccionFila]="estado.filtros().tipoReceptor" [seleccionColumna]="estado.filtros().programa"
            (elegirFila)="tipo($event)" (elegirColumna)="estado.alternar('programa', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="o-rn">
          <h2 id="o-rn">Interna / externa × nivel</h2>
          <p class="ra-nota">Técnico, tecnólogo y profesional dentro de cada tipo de receptor.</p>
          <sipra-reportes-apiladas titulo="Estudiantes por tipo de receptor y nivel" rotuloFilas="Receptor" rotuloColumnas="nivel" [celdas]="r.cruces.receptorNivel"
            [texto]="nivel" [textoFila]="etiquetaReceptor" [ordenColores]="['tecnico', 'tecnologo', 'profesional']" [seleccionFila]="estado.filtros().tipoReceptor" [seleccionColumna]="estado.filtros().ciclo"
            (elegirFila)="tipo($event)" (elegirColumna)="estado.alternar('ciclo', $event)" />
        </section>
      </div>
    }
  `,
})
export class ReportesOrganizacionesComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly tasas = TASAS;
  protected readonly pct1 = pct1;
  protected readonly razon = razon;
  protected readonly nivel = nivel;
  protected readonly compararNiveles = compararNiveles;
  private readonly pipe = new EtiquetaPipe();
  protected readonly etiqueta = (v: string): string => this.pipe.transform(v);
  protected readonly etiquetaReceptor = (t: string | null): string => (t ? RECEPTORES[t as TipoReceptor] ?? t : 'Sin información');
  protected readonly receptores = computed(() => (this.estado.datos()?.receptores ?? []).filter((x) => x.tipo));

  protected tipo(t: string | null): void { if (t) this.estado.alternar('tipoReceptor', t as TipoReceptor); }
  /** '' en un cruce es «sin dato» (NULL): se filtra con el valor explícito, nunca como cadena vacía. */
  protected dato(k: 'sector' | 'ciudad', v: string): void { this.estado.alternar(k, v === '' ? SIN_DATO : v); }
}
