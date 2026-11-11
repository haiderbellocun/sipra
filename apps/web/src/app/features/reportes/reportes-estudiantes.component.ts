import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesApiladasComponent } from './reportes-apiladas.component';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ItemBarra, SIN_EMPRESA, compararNiveles, compararSemestres, nivel, porcentaje, semestre } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Estudiantes: composición académica (escuela → programa → nivel) y composición de prácticas (modalidad, empresa),
 * todo como cross-filter del mismo contexto, y al final la tabla granular (una fila por práctica → Expediente).
 * Sin ranking de personas: las filas agregadas son unidades académicas, modalidades o empresas.
 */
@Component({
  selector: 'sipra-reportes-estudiantes',
  standalone: true,
  imports: [ReportesBarrasComponent, ReportesApiladasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .cob { display: grid; grid-template-columns: minmax(80px, 1fr) 3rem; gap: 8px; align-items: center; }
    .ancho { grid-column: 1 / -1; }
    .seccion { grid-column: 1 / -1; margin: 8px 0 -14px; font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); border-top: 1px solid var(--ra-regla); padding-top: 18px; }
    .seccion:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <div class="ra-rejilla">
        <h2 class="seccion">Composición académica · ¿quiénes son nuestros estudiantes en práctica?</h2>
        <section class="ra-bloque ancho" aria-labelledby="e-esc">
          <h2 id="e-esc">Escuelas y programas</h2>
          <p class="ra-nota">Estudiantes únicos (una persona con dos prácticas cuenta una vez). Aprobado = obligaciones aprobadas / exigidas. El nombre de la escuela o del programa filtra el reporte; la flecha despliega sus programas.</p>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Estudiantes, prácticas y cobertura por escuela y programa</caption>
              <thead><tr><th scope="col">Escuela / programa</th><th scope="col">Nivel</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" style="min-width:150px">Aprobado</th></tr></thead>
              <tbody>
                @for (e of r.escuelas; track e.escuela) {
                  <tr>
                    <th scope="row"><button type="button" class="ra-abrir" [attr.aria-expanded]="abiertas().has(e.escuela)" [attr.aria-controls]="'prog-' + e.escuela" (click)="alternar(e.escuela)"><span class="ra-sr">Programas de {{ e.nombre }}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg></button><button type="button" class="ra-ir" [attr.aria-pressed]="f().escuela === e.escuela" (click)="estado.alternar('escuela', e.escuela)">{{ e.nombre }}</button></th>
                    <td></td>
                    <td class="d">{{ e.estudiantes }}</td><td class="d">{{ e.practicas }}</td><td class="d">{{ e.completos }}</td><td class="d">{{ e.correccion }}</td>
                    <td><span class="cob"><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pct(e.aprobados, e.exigidos) ?? 0"></span></span><span class="d ra-num">{{ pct(e.aprobados, e.exigidos) ?? '—' }} %</span></span></td>
                  </tr>
                  @if (abiertas().has(e.escuela) || f().escuela === e.escuela) {
                    @for (p of e.programas; track p.programa) {
                      <tr class="sub" [attr.id]="$first ? 'prog-' + e.escuela : null">
                        <td><button type="button" class="ra-ir" [attr.aria-pressed]="f().programa === p.programa" (click)="estado.alternar('programa', p.programa)" [title]="p.programa">{{ estado.nombrePrograma(p.programa) }}</button></td>
                        <td>{{ ciclos(p.programa) }}</td>
                        <td class="d">{{ p.estudiantes }}</td><td class="d">{{ p.practicas }}</td><td class="d">{{ p.completos }}</td><td class="d">{{ p.correccion }}</td>
                        <td><span class="cob"><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pct(p.aprobados, p.exigidos) ?? 0"></span></span><span class="d ra-num">{{ pct(p.aprobados, p.exigidos) ?? '—' }} %</span></span></td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="ra-bloque" aria-labelledby="e-pn">
          <h2 id="e-pn">Programa × nivel de formación</h2>
          <p class="ra-nota">Qué programas pertenecen a cada nivel, según el ciclo registrado en cada práctica (no se deduce del nombre).</p>
          <sipra-reportes-apiladas titulo="Estudiantes por programa y nivel" rotuloFilas="Programa" rotuloColumnas="nivel" [celdas]="r.cruces.programaNivel"
            [texto]="nivel" [textoFila]="estado.nombrePrograma" [ordenColores]="ordenNiveles()" [seleccionFila]="f().programa" [seleccionColumna]="f().ciclo"
            (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="estado.alternar('ciclo', $event)" />
        </section>
        @if (r.dimensiones.semestre === 'sintetica') {
          <section class="ra-bloque" aria-labelledby="e-ps">
            <h2 id="e-ps">Programa × semestre</h2>
            <p class="ra-nota">Semestre: dato sintético de prueba (tabla auxiliar de desarrollo); en producción SIPRA no lo guarda.</p>
            <sipra-reportes-apiladas titulo="Estudiantes por programa y semestre" rotuloFilas="Programa" rotuloColumnas="semestre" [celdas]="r.cruces.programaSemestre"
              [texto]="semestre" [textoFila]="estado.nombrePrograma" [ordenColores]="ordenSemestres()" [seleccionFila]="f().programa" [seleccionColumna]="f().semestre"
              (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="semestreElegido($event)" />
          </section>
        } @else {
          <section class="ra-bloque" aria-labelledby="e-sem">
            <h2 id="e-sem">Semestre</h2>
            <p class="ra-nota">No disponible: SIPRA no guarda el semestre en la práctica. Solo existe en SINU, que se consulta estudiante por estudiante (lo usa el Excel del SGP). No se infiere del periodo.</p>
          </section>
        }

        <h2 class="seccion">Composición de prácticas · ¿qué práctica están haciendo?</h2>
        <section class="ra-bloque" aria-labelledby="e-pm">
          <h2 id="e-pm">Programa × modalidad</h2>
          <p class="ra-nota">Qué programas concentran cada modalidad y cuáles son minoritarias.</p>
          <sipra-reportes-apiladas titulo="Estudiantes por programa y modalidad" rotuloFilas="Programa" rotuloColumnas="modalidad" [celdas]="r.cruces.programaModalidad"
            [texto]="etiqueta" [textoFila]="estado.nombrePrograma" [ordenColores]="ordenModalidades()" [seleccionFila]="f().programa" [seleccionColumna]="f().modalidad"
            (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="estado.alternar('modalidad', $event)" />
        </section>
        <section class="ra-bloque" aria-labelledby="e-nm">
          <h2 id="e-nm">Nivel × modalidad</h2>
          <p class="ra-nota">Modalidades que usa cada nivel de formación (distribución, no causalidad).</p>
          <sipra-reportes-apiladas titulo="Estudiantes por nivel y modalidad" rotuloFilas="Nivel" rotuloColumnas="modalidad" [celdas]="r.cruces.nivelModalidad"
            [texto]="etiqueta" [textoFila]="nivel" [ordenFilas]="compararNiveles" [ordenColores]="ordenModalidades()" [seleccionFila]="f().ciclo" [seleccionColumna]="f().modalidad"
            (elegirFila)="estado.alternar('ciclo', $event)" (elegirColumna)="estado.alternar('modalidad', $event)" />
        </section>
        @if (r.dimensiones.semestre === 'sintetica') {
          <section class="ra-bloque" aria-labelledby="e-sm">
            <h2 id="e-sm">Semestre × modalidad</h2>
            <p class="ra-nota">Cómo cambia la modalidad según el avance académico. Semestre: dato sintético de prueba (tabla auxiliar de desarrollo); en producción SIPRA no lo guarda.</p>
            <sipra-reportes-apiladas titulo="Estudiantes por semestre y modalidad" rotuloFilas="Semestre" rotuloColumnas="modalidad" [celdas]="r.cruces.semestreModalidad"
              [texto]="etiqueta" [textoFila]="semestre" [ordenFilas]="compararSemestres" [ordenColores]="ordenModalidades()" [seleccionFila]="f().semestre" [seleccionColumna]="f().modalidad"
              (elegirFila)="semestreElegido($event)" (elegirColumna)="estado.alternar('modalidad', $event)" />
          </section>
        }
        <section class="ra-bloque" aria-labelledby="e-emp">
          <h2 id="e-emp">Empresas</h2>
          <p class="ra-nota">Por razón social registrada; «Sin empresa registrada» es un dato faltante, no una empresa. Secundario: elija una para ver sus programas y modalidades.</p>
          <sipra-reportes-barras titulo="Estudiantes por empresa" [items]="empresas()" [total]="r.resumen.estudiantes" [seleccion]="f().empresa" [limite]="8" (elegir)="estado.alternar('empresa', $event)" />
        </section>
      </div>
    }
  `,
})
export class ReportesEstudiantesComponent implements OnInit {
  protected readonly estado = inject(ReportesEstado);
  protected readonly f = this.estado.filtros;
  protected readonly abiertas = signal<ReadonlySet<string>>(new Set());
  protected readonly pct = porcentaje;
  protected readonly nivel = nivel;
  protected readonly semestre = semestre;
  protected readonly compararNiveles = compararNiveles;
  protected readonly compararSemestres = compararSemestres;
  private readonly pipe = new EtiquetaPipe();
  protected readonly etiqueta = (v: string): string => this.pipe.transform(v);

  protected readonly ordenModalidades = computed(() => [...(this.estado.datos()?.modalidades ?? [])].sort((a, b) => b.estudiantes - a.estudiantes).map((m) => m.modalidad));
  protected readonly ordenNiveles = computed(() => ['tecnico', 'tecnologo', 'profesional']);
  protected readonly ordenSemestres = computed(() => this.estado.opciones().semestres.map(String));

  /** «Sin información» ('') no es un filtro: no se convierte un dato faltante en un valor. */
  protected semestreElegido(s: string): void {
    if (s !== '') this.estado.alternar('semestre', s);
  }
  protected readonly empresas = computed<ItemBarra[]>(() => (this.estado.datos()?.empresas ?? [])
    .map((e) => ({ clave: e.empresa ?? SIN_EMPRESA, texto: e.empresa ?? 'Sin empresa registrada', n: e.estudiantes })));

  ngOnInit(): void {
    // La navegación analítica termina en la tabla granular: en Estudiantes está siempre abierta para el contexto.
    if (!this.estado.segmento()) void this.estado.abrirDetalle({});
  }

  protected ciclos(programa: string): string {
    return (this.estado.datos()?.programas.find((p) => p.programa === programa)?.ciclos ?? []).map(nivel).join(', ');
  }

  protected alternar(escuela: string): void {
    this.abiertas.update((s) => { const n = new Set(s); if (n.has(escuela)) n.delete(escuela); else n.add(escuela); return n; });
  }
}
