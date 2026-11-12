import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesBumpComponent, SerieBump } from './reportes-bump.component';
import { ReportesStreamComponent } from './reportes-stream.component';
import { ReportesInsightsComponent, insights } from './reportes-insights.component';
import { GrupoBarras, ReportesGruposComponent } from './reportes-grupos.component';
import { ReportesLineasComponent, SerieLinea } from './reportes-lineas.component';
import { Cobertura, pct1, porcentaje, segunOrden } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Máximo de programas comparados a la vez en una vista de periodos (el bump abre con 5 y admite hasta 8 líneas). */
export const MAX_PROGRAMAS_EVOLUCION = 5;

interface Comparable { periodo: string; c: Cobertura; programas: number; modalidades: number }

/**
 * Periodos (eje principal), visualmente temporal: líneas para la tendencia (cobertura y aprobación; evolución de hasta
 * cinco programas), barras agrupadas para A frente a B y barras apiladas con escala para modalidad y nivel por periodo.
 * Las tablas equivalentes se conservan. El nombre del periodo (en la tabla o en el eje) lo fija como filtro.
 */
@Component({
  selector: 'sipra-reportes-periodos',
  standalone: true,
  imports: [ReportesLineasComponent, ReportesGruposComponent, ReportesBumpComponent, ReportesStreamComponent, ReportesInsightsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .ancho { grid-column: 1 / -1; }
    .elegir { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); }
    .elegir select { height: 32px; padding: 0 8px; font: inherit; color: var(--text-primary); background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }
    .elegir select:focus-visible, .chk-p input:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .chk-p { display: inline-flex; gap: 6px; align-items: center; color: var(--text-primary); }
    .marco-l { margin: 4px 0 12px; }
    .sub-cab { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 0 0 12px; }
    .elegir-p { margin: 0 0 10px; font-size: 13px; }
    .elegir-p summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    .ab { display: grid; gap: 24px 32px; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); align-items: start; }
    .ab td.sube { color: var(--gr-ok); } .ab td.baja { color: var(--gr-riesgo); }
    .sub { margin: 0 0 8px; font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    .dims { display: inline-flex; gap: 2px; margin: 4px 0 12px; padding: 2px; border: 1px solid var(--border-default); border-radius: 7px; }
    .dims button { height: 30px; padding: 0 14px; font: 500 13px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; border-radius: 5px; cursor: pointer; }
    .dims button[aria-pressed='true'] { color: var(--text-primary); background: color-mix(in srgb, var(--bi-blue) 18%, transparent); font-weight: 650; }
    .dims button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    @media (width < 1100px) { .ab { grid-template-columns: 1fr; } }
    details { margin-top: 12px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    summary:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-reportes-insights class="zona-tiempo" [lineas]="lecturas()" />
      <div class="ra-rejilla">
        <section class="ra-bloque ancho ra-zona zona-tiempo" aria-labelledby="p-comp">
          <h2 id="p-comp">Comparación de periodos</h2>
          <p class="ra-nota">Periodo registrado en cada práctica, en orden cronológico por la fecha de inicio del catálogo.@if (r.periodosSinFecha.length) { Sin fecha en el catálogo (al final de la tabla y fuera de la línea temporal): {{ r.periodosSinFecha.join(', ') }}. } Cobertura cargada y aprobación documental (obligaciones / exigidas); el periodo del eje filtra el reporte.</p>
          @if (r.periodos.length > 1) {
            <div class="marco-l">
              <sipra-reportes-lineas titulo="Cobertura y aprobación documental por periodo" [categorias]="nombresPeriodo()" [series]="seriesCobertura()" [maxY]="100" [formatoY]="porcentajeFmt"
                [filtrable]="true" [seleccionX]="unico()" (elegirX)="fijar($event)" />
            </div>
          }
          <details>
            <summary>Ver estudiantes, prácticas y cobertura por periodo</summary>
            <div class="ra-desliza">
              <table class="ra-tabla" style="margin-top:8px">
                <caption class="ra-sr">Estudiantes, prácticas y cobertura documental por periodo</caption>
                <thead><tr><th scope="col">Periodo</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Cargado</th><th scope="col" class="d">Aprobado</th></tr></thead>
                <tbody>
                  @for (p of r.periodos; track p.periodo) {
                    <tr>
                      <th scope="row" class="ra-num"><button type="button" class="ra-ir" [attr.aria-pressed]="soloEste(p.periodo)" (click)="fijar(p.periodo)">{{ p.periodo }}</button></th>
                      <td class="d">{{ p.estudiantes }}</td><td class="d">{{ p.practicas }}</td><td class="d">{{ p.completos }}</td><td class="d">{{ p.correccion }}</td>
                      <td class="d">{{ pct(p.cargados, p.exigidos) ?? '—' }} %</td><td class="d">{{ pct(p.aprobados, p.exigidos) ?? '—' }} %</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
          @if (r.periodos.length === 1 && r.periodosDisponibles.length > 1) {
            <p class="ra-nota" style="margin-top:12px">Hay {{ r.periodosDisponibles.length }} periodos en su alcance: quite el filtro de periodo para compararlos.</p>
          }
        </section>

        @if (r.periodos.length > 1) {
          <section class="ra-bloque ancho ra-zona zona-academica" aria-labelledby="p-vista">
            <h2 id="p-vista">{{ tituloVista() }}</h2>
            <div class="dims" role="tablist" aria-label="Análisis entre periodos">
              @for (v of vistas; track v.id) {
                <button type="button" role="tab" [attr.aria-selected]="vista() === v.id" [attr.aria-pressed]="vista() === v.id" (click)="vista.set(v.id)">{{ v.texto }}</button>
              }
            </div>
            @switch (vista()) {
              @case ('volumen') {
                <p class="ra-nota">Estudiantes de cada programa por periodo, en orden cronológico. Empieza con los 5 programas de más estudiantes; cambie la selección (hasta 5).</p>
                  <details class="elegir-p">
                  <summary>Programas: {{ lineasProgramas().length }} de {{ seriesRanking().length }} · elegir</summary>
                  <div class="elegir">
                    @for (s of programasPorVolumen(); track s.clave) {
                      <label class="chk-p"><input type="checkbox" [checked]="lineasProgramas().includes(s.clave)" [disabled]="!lineasProgramas().includes(s.clave) && lineasProgramas().length >= 5" (change)="alternarLinea(s.clave)" />{{ s.texto }}</label>
                    }
                  </div>
                </details>
                <sipra-reportes-lineas titulo="Estudiantes por programa y periodo" [categorias]="nombresPeriodo()" [series]="seriesLineas()" unidad="estudiantes" [filtrable]="true" [seleccionX]="unico()" (elegirX)="fijar($event)" />
              }
              @case ('ranking') {
                <p class="ra-nota">Análisis secundario: puesto de cada programa en cada periodo, donde <strong>1 = el programa con más estudiantes</strong>. La distancia entre líneas NO es volumen (el volumen está en el tooltip y en «Estudiantes por programa»).</p>
                <sipra-reportes-bump titulo="Ranking de programas por periodo" [categorias]="nombresPeriodo()" [series]="seriesRanking()" />
              }
              @case ('composicion') {
                <p class="ra-nota">Cómo se reparte el periodo entre modalidades: el grosor de cada banda es su número de estudiantes. Cinco modalidades con color y «Otras»; el inspector muestra la composición completa.</p>
                <sipra-reportes-stream titulo="Estudiantes por modalidad y periodo" [categorias]="nombresPeriodo()" [celdas]="r.cruces.periodoModalidad" [texto]="etiqueta" />
              }
              @case ('ab') {
                <p class="ra-nota">Periodo A frente a periodo B. Mismas definiciones de métricas en ambos lados; la diferencia es B − A (puntos porcentuales en las tasas).</p>
                <div class="elegir">
                  <label>A <select [value]="a()" (change)="aSel.set(valor($event))">@for (p of r.periodos; track p.periodo) { <option [value]="p.periodo" [selected]="p.periodo === a()">{{ p.periodo }}</option> }</select></label>
                  <label>B <select [value]="b()" (change)="bSel.set(valor($event))">@for (p of r.periodos; track p.periodo) { <option [value]="p.periodo" [selected]="p.periodo === b()">{{ p.periodo }}</option> }</select></label>
                </div>
                @if (comparacion(); as c) {
                  <div class="ab">
                    <table class="ra-tabla">
                      <caption class="ra-sr">Comparación entre {{ c.a.periodo }} y {{ c.b.periodo }}</caption>
                      <thead><tr><th scope="col">Métrica</th><th scope="col" class="d">{{ c.a.periodo }}</th><th scope="col" class="d">{{ c.b.periodo }}</th><th scope="col" class="d">Diferencia</th></tr></thead>
                      <tbody>
                        @for (m of c.filas; track m.texto) {
                          <tr><th scope="row" [title]="m.definicion">{{ m.texto }}</th><td class="d">{{ m.va }}</td><td class="d">{{ m.vb }}</td>
                            <td class="d" [class.sube]="m.delta > 0" [class.baja]="m.delta < 0">{{ m.delta > 0 ? '+' : '' }}{{ m.deltaTexto }}</td></tr>
                        }
                      </tbody>
                    </table>
                    <div>
                      <h3 class="sub">Estudiantes por programa: {{ c.a.periodo }} frente a {{ c.b.periodo }}</h3>
                      <sipra-reportes-grupos [titulo]="'Estudiantes por programa en ' + c.a.periodo + ' y ' + c.b.periodo" [grupos]="gruposAB()" [rotuloA]="'A · ' + c.a.periodo" [rotuloB]="'B · ' + c.b.periodo"
                        [seleccion]="estado.filtros().programa" (elegir)="estado.alternar('programa', $event)" />
                    </div>
                  </div>
                }
              }
            }
          </section>
        }
      </div>
    }
  `,
})
export class ReportesPeriodosComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly pct = porcentaje;
  protected readonly compararPeriodos = (a: string, b: string): number => segunOrden(this.estado.datos()?.ordenPeriodos ?? [])(a, b);
  private readonly pipe = new EtiquetaPipe();
  protected readonly etiqueta = (v: string): string => this.pipe.transform(v);

  /** Una visualización grande a la vez entre periodos (ranking, composición o A/B): no más de dos gráficas grandes en pantalla. */
  protected readonly vistas = VISTAS_PERIODOS;
  protected readonly vista = signal<VistaPeriodos>('volumen');
  protected readonly tituloVista = computed(() => ({ volumen: 'Estudiantes por programa entre periodos', composicion: 'Composición por modalidad', ranking: 'Movimiento en ranking', ab: 'Periodo A frente a periodo B' })[this.vista()]);
  /** Programas por volumen total en los periodos con fecha (los candidatos de las líneas). */
  protected readonly programasPorVolumen = computed(() => [...this.seriesRanking()].sort((a, b) => sumar(b.valores) - sumar(a.valores) || a.texto.localeCompare(b.texto)));
  private readonly eleccionLineas = signal<string[] | null>(null);
  protected readonly lineasProgramas = computed(() => (this.eleccionLineas() ?? this.programasPorVolumen().slice(0, 5).map((s) => s.clave)).filter((k) => this.seriesRanking().some((s) => s.clave === k)));
  protected readonly seriesLineas = computed<SerieLinea[]>(() => this.lineasProgramas().map((k) => this.seriesRanking().find((s) => s.clave === k)!).map((s) => ({ clave: s.clave, texto: s.texto, valores: s.valores })));
  protected alternarLinea(k: string): void {
    const v = this.lineasProgramas();
    this.eleccionLineas.set(v.includes(k) ? v.filter((x) => x !== k) : [...v, k].slice(0, 5));
  }
  protected readonly lecturas = computed(() => {
    const r = this.estado.datos();
    return r ? insights.periodos(r, { programa: this.estado.nombrePrograma, modalidad: this.etiqueta, tipo: this.etiqueta, escuela: this.estado.nombreEscuela }) : [];
  });
  /** Series del bump: TODOS los programas (el ranking se calcula entre todos), en los periodos con fecha. */
  protected readonly seriesRanking = computed<SerieBump[]>(() => {
    const celdas = this.estado.datos()?.cruces.periodoPrograma ?? [], periodos = this.nombresPeriodo();
    const programas = [...new Set(celdas.map((c) => c.columna))];
    return programas.map((prog) => ({ clave: prog, texto: this.estado.nombrePrograma(prog), valores: periodos.map((p) => celdas.find((c) => c.fila === p && c.columna === prog)?.estudiantes ?? 0) }));
  });
  protected readonly aSel = signal('');
  protected readonly bSel = signal('');

  private readonly ordenados = computed(() => [...(this.estado.datos()?.periodos ?? [])].sort((x, y) => this.compararPeriodos(x.periodo, y.periodo)));
  /** Por defecto se comparan los dos últimos periodos con fecha en el catálogo; los «sin fecha» no tienen orden cronológico. */
  private readonly fechados = computed(() => {
    const sinFecha = new Set(this.estado.datos()?.periodosSinFecha ?? []);
    const f = this.ordenados().filter((p) => !sinFecha.has(p.periodo));
    return f.length >= 2 ? f : this.ordenados();
  });
  protected readonly a = computed(() => (this.ordenados().some((p) => p.periodo === this.aSel()) ? this.aSel() : this.fechados().at(-2)?.periodo ?? ''));
  protected readonly b = computed(() => (this.ordenados().some((p) => p.periodo === this.bSel()) ? this.bSel() : this.fechados().at(-1)?.periodo ?? ''));

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

  /** Eje temporal: solo periodos con fecha en el catálogo (un «sin fecha» no tiene posición cronológica; sigue en las tablas). */
  protected readonly nombresPeriodo = computed(() => this.fechados().map((p) => p.periodo));
  protected readonly unico = computed(() => { const f = this.estado.filtros().periodos; return f.length === 1 ? f[0] : ''; });
  protected readonly porcentajeFmt = (n: number): string => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
  /** Tasas por periodo (cobertura cargada y aprobación, sobre exigidas): misma definición que la tabla. */
  protected readonly seriesCobertura = computed<SerieLinea[]>(() => {
    const tasa = (n: number, d: number) => (d ? Math.round((n * 1000) / d) / 10 : 0);
    return [
      { clave: 'cargado', texto: 'Cobertura cargada', valores: this.fechados().map((p) => tasa(p.cargados, p.exigidos)), tono: 'principal' },
      { clave: 'aprobado', texto: 'Aprobación documental', valores: this.fechados().map((p) => tasa(p.aprobados, p.exigidos)), tono: 'ok' },
    ];
  });
  /** A frente a B por programa (estudiantes únicos de cada periodo), ordenado por el mayor de los dos. */
  protected readonly gruposAB = computed<GrupoBarras[]>(() => {
    const celdas = this.estado.datos()?.cruces.periodoPrograma ?? [], a = this.a(), b = this.b();
    const programas = new Set(celdas.filter((c) => c.fila === a || c.fila === b).map((c) => c.columna));
    const v = (periodo: string, prog: string) => celdas.find((c) => c.fila === periodo && c.columna === prog)?.estudiantes ?? 0;
    return [...programas].map((prog) => ({ clave: prog, texto: this.estado.nombrePrograma(prog), a: v(a, prog), b: v(b, prog) }))
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || x.texto.localeCompare(y.texto));
  });

  protected valor(e: Event): string { return (e.target as HTMLSelectElement).value; }
  protected soloEste(periodo: string): boolean { const f = this.estado.filtros().periodos; return f.length === 1 && f[0] === periodo; }
  protected fijar(periodo: string): void { this.estado.filtrar({ periodos: this.soloEste(periodo) ? [] : [periodo] }); }
}


export type VistaPeriodos = 'volumen' | 'composicion' | 'ranking' | 'ab';
/** La vista por defecto responde «¿cómo se distribuyen los estudiantes por programa entre periodos?» (volumen, no puesto). */
export const VISTAS_PERIODOS: readonly { id: VistaPeriodos; texto: string }[] = [
  { id: 'volumen', texto: 'Estudiantes por programa' }, { id: 'composicion', texto: 'Composición por modalidad' }, { id: 'ranking', texto: 'Movimiento en ranking' }, { id: 'ab', texto: 'A frente a B' },
];
/**
 * Evaluado en V3.3 con capturas: el AreaBump (bandas ordenadas por puesto) dejaba «Otros programas» con ~65 % del área y
 * cinco bandas finas que se cruzan: CONFUSO. La vista por defecto usa líneas por cantidad (5 programas seleccionables).
 */
export const FORMA_VOLUMEN = 'lineas' as const;
function sumar(v: readonly number[]): number { return v.reduce((a, b) => a + b, 0); }
