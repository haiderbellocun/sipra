import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { CLASES_SERIE, CLASE_OTRAS, Celda, FilaApilada, apilar, claseSerie, pct1 } from './reportes-analitica.util';
import { TipGrafico, escala, num, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Cruce de dos dimensiones como barras horizontales apiladas con ESCALA REAL (el largo es el total de la fila; eje X,
 * rejilla y línea base). El nombre de la fila filtra la dimensión de filas; cada entrada de la leyenda filtra la de columnas
 * (cross-filter con teclado). Paleta corta y estable (principal, comparación, variantes + «otras»); el segmento muestra su
 * tooltip y pasar por la leyenda resalta esa serie en todas las filas. La matriz completa está en «Ver como tabla».
 */
/** Segmento agregado de las series sin tono propio (no es una categoría de los datos). */
const OTRAS = '__otras__';

@Component({
  selector: 'sipra-reportes-apiladas',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .ga { --ga-yw: clamp(7rem, 28%, 15rem); --ga-tot: 3.5rem; --ga-gap: 10px; }
    .leyenda-a { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0 0 12px; padding: 0; list-style: none; }
    .ley { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 8px; font: 500 12px/16px var(--fuente); color: var(--text-primary); background: none; border: 1px solid var(--border-subtle); border-radius: 13px; cursor: pointer; }
    .ley:hover { background: var(--gr-hover); }
    .mas-ley { color: var(--text-secondary); border-style: dashed; }
    .ley[aria-pressed='true'] { border-color: var(--signal-active); background: color-mix(in srgb, var(--signal-active) 12%, transparent); }
    .ley:focus-visible, .rot:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .ga-rejilla { position: absolute; top: 0; bottom: 22px; left: calc(var(--ga-yw) + var(--ga-gap)); right: calc(var(--ga-tot) + var(--ga-gap)); pointer-events: none; }
    .ga-linea { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gr-rejilla); transition: left var(--gr-dur) var(--gr-ease); }
    .ga-linea.base { background: var(--gr-eje); }
    .filas-a { position: relative; display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .fila-a, .ga-eje { display: grid; grid-template-columns: var(--ga-yw) minmax(0, 1fr) var(--ga-tot); column-gap: var(--ga-gap); align-items: center; }
    .rot { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 6px; font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
    .rot:hover { background: var(--gr-hover); }
    .rot[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); font-weight: 600; }
    .pila-a { position: relative; height: 20px; }
    .ga-in { display: flex; height: 100%; gap: 1px; transition: width var(--gr-dur) var(--gr-ease); }
    .ga-in span { height: 100%; min-width: 2px; transition: flex-grow var(--gr-dur) var(--gr-ease), opacity 160ms ease; }
    .ga-in span:last-child { border-radius: 0 3px 3px 0; }
    /* Énfasis de selección: la columna o la fila elegida conserva su tono; el resto se atenúa (no solo color: aria-pressed y borde). */
    .ga-in span.atenuada, .fila-a.atenuada .ga-in { opacity: .3; }
    .ga.con-foco .ga-in span:not(.foco) { opacity: .4; }
    .tot { font: 500 12px/16px var(--fuente-mono); text-align: right; color: var(--text-secondary); }
    .ga-eje { padding-top: 6px; }
    .ga-eje .gr-eje-t { text-align: right; }
    .ga-marcas { position: relative; height: 16px; }
    .ga-marcas span { position: absolute; transform: translateX(-50%); font: 500 11px/16px var(--fuente-mono); color: var(--gr-texto-eje); white-space: nowrap; transition: left var(--gr-dur) var(--gr-ease); }
    .mas { margin-top: 8px; padding: 4px 6px; font: 500 12px/16px var(--fuente); color: var(--text-secondary); background: none; border: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    details { margin-top: 10px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    summary:focus-visible, .mas:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    @media (width < 700px) {
      .fila-a { grid-template-columns: minmax(0, 1fr) 3rem; }
      .rot { grid-column: 1 / -1; }
      .ga-rejilla, .ga-eje { display: none; }
    }
  `],
  template: `
    <ul class="leyenda-a" [attr.aria-label]="'Filtrar por ' + rotuloColumnas()">
      @for (c of leyenda(); track c) {
        <li><button type="button" class="ley" [attr.aria-pressed]="c === seleccionColumna()" (click)="elegirColumna.emit(c)" (mouseenter)="foco.set(c)" (mouseleave)="foco.set(null)">
          <span class="ra-punto" [class]="claseDe(c)" aria-hidden="true" style="margin-right:0"></span>{{ texto()(c) }}</button></li>
      }
      @if (columnas().length > maxLeyenda) {
        <li><button type="button" class="ley mas-ley" [attr.aria-expanded]="leyendaCompleta()" (click)="leyendaCompleta.set(!leyendaCompleta())">{{ leyendaCompleta() ? 'Menos' : '+' + (columnas().length - maxLeyenda) + ' más' }}</button></li>
      }
    </ul>
    <div class="gr-marco ga" #marco [class.con-foco]="!!foco()">
      <div class="ga-rejilla" aria-hidden="true">
        @for (m of esc().marcas; track $index) { <span class="ga-linea" [class.base]="m === 0" [style.left.%]="(m * 100) / esc().max"></span> }
      </div>
      <ul class="filas-a" [attr.aria-label]="titulo()">
        @for (f of visibles(); track f.clave) {
          <li class="fila-a" [class.atenuada]="!!seleccionFila() && f.clave !== seleccionFila()">
            <button type="button" class="rot" [attr.aria-pressed]="f.clave === seleccionFila()" [attr.aria-label]="'Filtrar por ' + textoFila()(f.clave) + ', ' + f.total + ' estudiantes'" (click)="elegirFila.emit(f.clave)">{{ textoFila()(f.clave) }}</button>
            <span class="pila-a" aria-hidden="true">
              <span class="ga-in" [style.width.%]="(f.total * 100) / esc().max">
                @for (p of f.partes; track p.columna) {
                  <span [class]="claseDe(p.columna)" [class.atenuada]="!!seleccionColumna() && p.columna !== seleccionColumna()" [class.foco]="foco() === p.columna" [style.flex-grow]="p.n"
                        (mouseenter)="ver($event, f, p)" (mousemove)="ver($event, f, p)" (mouseleave)="salir()"></span>
                }
              </span>
            </span>
            <span class="tot">{{ f.total }}</span>
          </li>
        }
      </ul>
      <div class="ga-eje" aria-hidden="true">
        <span class="gr-eje-t">Estudiantes</span>
        <span class="ga-marcas">@for (m of esc().marcas; track $index) { <span [style.left.%]="(m * 100) / esc().max">{{ m }}</span> }</span>
      </div>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
    @if (matriz().filas.length > limite()) {
      <button type="button" class="mas" [attr.aria-expanded]="todos()" (click)="todos.set(!todos())">{{ todos() ? 'Ver menos' : 'Ver todas las filas (' + matriz().filas.length + ')' }}</button>
    }
    <details>
      <summary>Ver como tabla</summary>
      <div class="ra-desliza">
        <table class="ra-tabla" style="margin-top:8px">
          <caption class="ra-sr">{{ titulo() }}: estudiantes únicos por celda</caption>
          <thead><tr><th scope="col">{{ rotuloFilas() }}</th>@for (c of columnas(); track c) { <th scope="col" class="d">{{ texto()(c) }}</th> }<th scope="col" class="d">Total</th></tr></thead>
          <tbody>@for (f of matriz().filas; track f.clave) {
            <tr><th scope="row">{{ textoFila()(f.clave) }}</th>@for (c of columnas(); track c) { <td class="d">{{ valor(f.partes, c) }}</td> }<td class="d">{{ f.total }}</td></tr>
          }</tbody>
        </table>
      </div>
    </details>
  `,
})
export class ReportesApiladasComponent {
  readonly titulo = input.required<string>();
  readonly celdas = input.required<Celda[]>();
  readonly rotuloFilas = input.required<string>();
  readonly rotuloColumnas = input.required<string>();
  readonly texto = input<(v: string) => string>((v) => v);
  readonly textoFila = input<(v: string) => string>((v) => v);
  /** Orden fijo de columnas para que una categoría tenga el mismo tono en todas las gráficas (p. ej. modalidades globales). */
  readonly ordenColores = input<string[] | null>(null);
  readonly ordenFilas = input<((a: string, b: string) => number) | undefined>(undefined);
  readonly seleccionFila = input('');
  readonly seleccionColumna = input('');
  readonly limite = input(10);
  readonly elegirFila = output<string>();
  readonly elegirColumna = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly todos = signal(false);
  protected readonly foco = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly matriz = computed(() => apilar(this.celdas(), this.ordenFilas()));
  /** Con un orden dado (p. ej. técnico → tecnólogo → profesional), la leyenda y la tabla lo respetan; si no, por total. */
  protected readonly columnas = computed(() => {
    const presentes = this.matriz().columnas, orden = this.ordenColores();
    return orden ? [...orden.filter((c) => presentes.includes(c)), ...presentes.filter((c) => !orden.includes(c))] : presentes;
  });
  /**
   * Dentro de cada fila, los segmentos siguen el orden de la leyenda (p. ej. técnico → tecnólogo → profesional). Las series
   * sin tono propio (más allá de la quinta) se agrupan en un solo segmento «Otras» por fila: no una hilera de astillas grises.
   * La columna elegida nunca se agrupa.
   */
  protected readonly visibles = computed(() => {
    const orden = this.ordenColores() ?? this.columnas(), filas = this.todos() ? this.matriz().filas : this.matriz().filas.slice(0, this.limite());
    const propia = (c: string) => claseSerie(orden, c) !== CLASE_OTRAS || c === this.seleccionColumna();
    return filas.map((f) => {
      const partes = [...f.partes].sort((a, b) => this.columnas().indexOf(a.columna) - this.columnas().indexOf(b.columna));
      const resto = partes.filter((p) => !propia(p.columna)).reduce((n, p) => n + p.n, 0);
      return { ...f, partes: [...partes.filter((p) => propia(p.columna)), ...(resto ? [{ columna: OTRAS, n: resto }] : [])] };
    });
  });
  /** Leyenda compacta: las series con tono propio y «+N más» para el resto (que comparten «otras»), sin media pantalla de chips. */
  protected readonly maxLeyenda = CLASES_SERIE.length;
  protected readonly leyendaCompleta = signal(false);
  protected readonly leyenda = computed(() => (this.leyendaCompleta() ? this.columnas() : this.columnas().slice(0, this.maxLeyenda)));

  /** Escala real: el largo de cada fila es su total (no 100 %), con marcas «redondas». */
  protected readonly esc = computed(() => escala(Math.max(0, ...this.matriz().filas.map((f) => f.total)), 4));

  protected ver(ev: Event, f: FilaApilada, p: { columna: string; n: number }): void {
    this.foco.set(p.columna);
    const otras = this.columnas().length - this.maxLeyenda;
    this.tip.set(tipEn(this.marco().nativeElement, ev, `${this.textoFila()(f.clave)} · ${p.columna === OTRAS ? `otras ${otras} categorías` : this.texto()(p.columna)}`,
      [`${num(p.n)} estudiantes`, `${pct1(p.n, f.total)} de la fila`], 'Filtre con el nombre de la fila o la leyenda'));
  }
  protected salir(): void { this.foco.set(null); this.tip.set(null); }

  protected claseDe(c: string): string { return c === OTRAS ? CLASE_OTRAS : claseSerie(this.ordenColores() ?? this.columnas(), c); }
  protected valor(partes: { columna: string; n: number }[], c: string): number { return partes.find((p) => p.columna === c)?.n ?? 0; }
}
