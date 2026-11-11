import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesApiladasComponent } from './reportes-apiladas.component';
import { Cobertura, nivel, pct1, porcentaje, segunOrden } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Máximo de programas en la evolución por periodo: más líneas serían ilegibles. */
export const MAX_PROGRAMAS_EVOLUCION = 5;

interface Comparable { periodo: string; c: Cobertura; programas: number; modalidades: number }

/**
 * Periodos (eje principal): comparativo, comparación A frente a B con las mismas definiciones, evolución de hasta cinco
 * programas y descomposición por modalidad y nivel. El nombre del periodo lo fija como filtro.
 */
@Component({
  selector: 'sipra-reportes-periodos',
  standalone: true,
  imports: [ReportesApiladasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .doble { display: grid; gap: 3px; min-width: 150px; }
    .doble .ra-mini { height: 5px; }
    .ra-tabla td.cob { width: 26%; }
    .ancho { grid-column: 1 / -1; }
    .elegir { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); }
    .elegir select { height: 32px; padding: 0 8px; font: inherit; color: var(--text-primary); background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }
    .elegir select:focus-visible, .chk-p input:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .chk-p { display: inline-flex; gap: 6px; align-items: center; color: var(--text-primary); }
    .barra-ev { display: inline-block; height: 8px; margin-right: 6px; border-radius: 2px; background: var(--ra-info); vertical-align: 0; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <div class="ra-rejilla">
        <section class="ra-bloque ancho" aria-labelledby="p-comp">
          <h2 id="p-comp">Comparación de periodos</h2>
          <p class="ra-nota">El periodo es el registrado en cada práctica, en orden cronológico por la fecha de inicio del catálogo de periodos.@if (r.periodosSinFecha.length) { Sin fecha en el catálogo (al final, orden no cronológico): {{ r.periodosSinFecha.join(', ') }}. } Cobertura: barra superior cargado, inferior aprobado (obligaciones aprobadas / exigidas). El periodo filtra el reporte.</p>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Estudiantes, prácticas y cobertura documental por periodo</caption>
              <thead><tr><th scope="col">Periodo</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Cargado</th><th scope="col" class="d">Aprobado</th><th scope="col"><span class="ra-sr">Cobertura</span></th></tr></thead>
              <tbody>
                @for (p of r.periodos; track p.periodo) {
                  <tr>
                    <th scope="row" class="ra-num"><button type="button" class="ra-ir" [attr.aria-pressed]="soloEste(p.periodo)" (click)="fijar(p.periodo)">{{ p.periodo }}</button></th>
                    <td class="d">{{ p.estudiantes }}</td><td class="d">{{ p.practicas }}</td><td class="d">{{ p.completos }}</td><td class="d">{{ p.correccion }}</td>
                    <td class="d">{{ pct(p.cargados, p.exigidos) ?? '—' }} %</td><td class="d">{{ pct(p.aprobados, p.exigidos) ?? '—' }} %</td>
                    <td class="cob"><span class="doble" aria-hidden="true">
                      <span class="ra-mini"><span class="t-info" [style.width.%]="pct(p.cargados, p.exigidos) ?? 0"></span></span>
                      <span class="ra-mini"><span class="t-ok" [style.width.%]="pct(p.aprobados, p.exigidos) ?? 0"></span></span>
                    </span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (r.periodos.length === 1 && r.periodosDisponibles.length > 1) {
            <p class="ra-nota" style="margin-top:12px">Hay {{ r.periodosDisponibles.length }} periodos en su alcance: quite el filtro de periodo para compararlos.</p>
          }
        </section>

        @if (r.periodos.length > 1) {
          <section class="ra-bloque ancho" aria-labelledby="p-ab">
            <h2 id="p-ab">Periodo A frente a periodo B</h2>
            <p class="ra-nota">Mismas definiciones de métricas en ambos lados; la diferencia es B − A (puntos porcentuales en las tasas).</p>
            <div class="elegir">
              <label>A <select [value]="a()" (change)="aSel.set(valor($event))">@for (p of r.periodos; track p.periodo) { <option [value]="p.periodo" [selected]="p.periodo === a()">{{ p.periodo }}</option> }</select></label>
              <label>B <select [value]="b()" (change)="bSel.set(valor($event))">@for (p of r.periodos; track p.periodo) { <option [value]="p.periodo" [selected]="p.periodo === b()">{{ p.periodo }}</option> }</select></label>
            </div>
            @if (comparacion(); as c) {
              <table class="ra-tabla" style="max-width:760px">
                <caption class="ra-sr">Comparación entre {{ c.a.periodo }} y {{ c.b.periodo }}</caption>
                <thead><tr><th scope="col">Métrica</th><th scope="col" class="d">{{ c.a.periodo }}</th><th scope="col" class="d">{{ c.b.periodo }}</th><th scope="col" class="d">Diferencia</th></tr></thead>
                <tbody>
                  @for (m of c.filas; track m.texto) {
                    <tr><th scope="row" [title]="m.definicion">{{ m.texto }}</th><td class="d">{{ m.va }}</td><td class="d">{{ m.vb }}</td>
                      <td class="d">{{ m.delta > 0 ? '+' : '' }}{{ m.deltaTexto }}</td></tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <section class="ra-bloque ancho" aria-labelledby="p-prog">
            <h2 id="p-prog">Evolución de programas</h2>
            <p class="ra-nota">Estudiantes únicos por periodo de hasta {{ max }} programas (los de más estudiantes vienen elegidos).</p>
            <div class="elegir" role="group" aria-label="Programas a comparar">
              @for (p of candidatos(); track p) {
                <label class="chk-p"><input type="checkbox" [checked]="elegidos().includes(p)" [disabled]="!elegidos().includes(p) && elegidos().length >= max" (change)="alternarPrograma(p)" />{{ estado.nombrePrograma(p) }}</label>
              }
            </div>
            <div class="ra-desliza">
              <table class="ra-tabla">
                <caption class="ra-sr">Estudiantes por periodo y programa</caption>
                <thead><tr><th scope="col">Periodo</th>@for (p of elegidos(); track p) { <th scope="col" class="d" [title]="p">{{ estado.nombrePrograma(p) }}</th> }</tr></thead>
                <tbody>@for (fila of evolucion(); track fila.periodo) {
                  <tr><th scope="row" class="ra-num">{{ fila.periodo }}</th>@for (v of fila.valores; track $index) { <td class="d"><span class="barra-ev" aria-hidden="true" [style.width.px]="v * escala()"></span>{{ v }}</td> }</tr>
                }</tbody>
              </table>
            </div>
          </section>

          <section class="ra-bloque" aria-labelledby="p-mod">
            <h2 id="p-mod">Periodo × modalidad</h2>
            <p class="ra-nota">Cómo cambia la modalidad elegida entre periodos.</p>
            <sipra-reportes-apiladas titulo="Estudiantes por periodo y modalidad" rotuloFilas="Periodo" rotuloColumnas="modalidad" [celdas]="r.cruces.periodoModalidad"
              [texto]="etiqueta" [ordenFilas]="compararPeriodos" [seleccionColumna]="estado.filtros().modalidad"
              (elegirFila)="fijar($event)" (elegirColumna)="estado.alternar('modalidad', $event)" />
          </section>
          <section class="ra-bloque" aria-labelledby="p-niv">
            <h2 id="p-niv">Periodo × nivel de formación</h2>
            <p class="ra-nota">Distribución de niveles en cada periodo.</p>
            <sipra-reportes-apiladas titulo="Estudiantes por periodo y nivel" rotuloFilas="Periodo" rotuloColumnas="nivel" [celdas]="r.cruces.periodoNivel"
              [texto]="nivel" [ordenFilas]="compararPeriodos" [ordenColores]="['tecnico', 'tecnologo', 'profesional']" [seleccionColumna]="estado.filtros().ciclo"
              (elegirFila)="fijar($event)" (elegirColumna)="estado.alternar('ciclo', $event)" />
          </section>
        }
      </div>
    }
  `,
})
export class ReportesPeriodosComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly pct = porcentaje;
  protected readonly nivel = nivel;
  protected readonly compararPeriodos = (a: string, b: string): number => segunOrden(this.estado.datos()?.ordenPeriodos ?? [])(a, b);
  protected readonly max = MAX_PROGRAMAS_EVOLUCION;
  private readonly pipe = new EtiquetaPipe();
  protected readonly etiqueta = (v: string): string => this.pipe.transform(v);

  protected readonly aSel = signal('');
  protected readonly bSel = signal('');
  private readonly seleccionProgramas = signal<string[] | null>(null);

  private readonly ordenados = computed(() => [...(this.estado.datos()?.periodos ?? [])].sort((x, y) => this.compararPeriodos(x.periodo, y.periodo)));
  protected readonly a = computed(() => (this.ordenados().some((p) => p.periodo === this.aSel()) ? this.aSel() : this.ordenados().at(-2)?.periodo ?? ''));
  protected readonly b = computed(() => (this.ordenados().some((p) => p.periodo === this.bSel()) ? this.bSel() : this.ordenados().at(-1)?.periodo ?? ''));

  protected readonly comparacion = computed(() => {
    const r = this.estado.datos();
    if (!r) return null;
    const de = (periodo: string): Comparable | null => {
      const c = r.periodos.find((p) => p.periodo === periodo);
      if (!c) return null;
      const celdas = (k: 'periodoPrograma' | 'periodoModalidad') => r.cruces[k].filter((x) => x.fila === periodo).length;
      return { periodo, c, programas: celdas('periodoPrograma'), modalidades: celdas('periodoModalidad') };
    };
    const a = de(this.a()), b = de(this.b());
    if (!a || !b) return null;
    const n = (texto: string, va: number, vb: number, definicion = '') => ({ texto, definicion, va: String(va), vb: String(vb), delta: vb - va, deltaTexto: String(vb - va) });
    const t = (texto: string, definicion: string, pa: number, ta: number, pb: number, tb: number) => {
      const xa = ta ? (pa * 100) / ta : 0, xb = tb ? (pb * 100) / tb : 0;
      const d = Math.round((xb - xa) * 10) / 10;
      return { texto, definicion, va: pct1(pa, ta), vb: pct1(pb, tb), delta: d, deltaTexto: `${d.toLocaleString('es-CO')} pp` };
    };
    return {
      a, b, filas: [
        n('Estudiantes', a.c.estudiantes, b.c.estudiantes, 'estudiantes únicos'),
        n('Prácticas', a.c.practicas, b.c.practicas),
        n('Programas con prácticas', a.programas, b.programas),
        n('Modalidades usadas', a.modalidades, b.modalidades),
        t('Cobertura cargada', 'obligaciones cargadas / exigidas', a.c.cargados, a.c.exigidos, b.c.cargados, b.c.exigidos),
        t('Aprobación documental', 'obligaciones aprobadas / exigidas', a.c.aprobados, a.c.exigidos, b.c.aprobados, b.c.exigidos),
        t('Obligaciones en corrección', 'en corrección / exigidas', a.c.correccion, a.c.exigidos, b.c.correccion, b.c.exigidos),
        n('Devoluciones auditadas', a.c.devoluciones, b.c.devoluciones),
      ],
    };
  });

  protected readonly candidatos = computed(() => (this.estado.datos()?.programas ?? []).map((p) => p.programa));
  protected readonly elegidos = computed(() => (this.seleccionProgramas() ?? this.candidatos().slice(0, MAX_PROGRAMAS_EVOLUCION)).filter((p) => this.candidatos().includes(p)));
  protected readonly evolucion = computed(() => {
    const celdas = this.estado.datos()?.cruces.periodoPrograma ?? [];
    return this.ordenados().map((p) => ({ periodo: p.periodo, valores: this.elegidos().map((prog) => celdas.find((c) => c.fila === p.periodo && c.columna === prog)?.estudiantes ?? 0) }));
  });
  protected readonly escala = computed(() => { const m = Math.max(1, ...this.evolucion().flatMap((f) => f.valores)); return 60 / m; });

  protected valor(e: Event): string { return (e.target as HTMLSelectElement).value; }
  protected soloEste(periodo: string): boolean { const f = this.estado.filtros().periodos; return f.length === 1 && f[0] === periodo; }
  protected fijar(periodo: string): void { this.estado.filtrar({ periodos: this.soloEste(periodo) ? [] : [periodo] }); }
  protected alternarPrograma(p: string): void {
    const actual = this.elegidos();
    this.seleccionProgramas.set(actual.includes(p) ? actual.filter((x) => x !== p) : [...actual, p].slice(0, MAX_PROGRAMAS_EVOLUCION));
  }
}

