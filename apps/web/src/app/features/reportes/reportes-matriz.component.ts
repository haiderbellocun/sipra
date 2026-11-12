import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Celda, apilar, pct1 } from './reportes-analitica.util';
import { TOP_MOVIL, TipGrafico, TonoGrafico, escucharMovil, num, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Matriz de calor para un cruce (p. ej. programa × sector): una tabla real (accesible sin gráfica aparte) con la
 * intensidad del dato principal en cada celda; filas por total (Top N con «Ver todos»), columnas por su total global con
 * rótulo corto y leyenda de códigos. Encabezados de fila y columna son botones de cross-filter (`aria-pressed`); la celda
 * filtra las dos dimensiones a la vez. Las celdas en 0 quedan vacías: no se pinta una pared de ceros.
 */
@Component({
  selector: 'sipra-reportes-matriz',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gm-tabla { border-collapse: separate; border-spacing: 2px; font-size: 12px; }
    .gm-tabla th { padding: 0; font-weight: 500; color: var(--text-secondary); }
    .gm-esq { min-width: 11rem; padding: 0 8px 4px 0 !important; text-align: left; font: 500 11px/14px var(--fuente) !important; color: var(--gr-texto-eje) !important; vertical-align: bottom; }
    .gm-col, .gm-fila { width: 100%; padding: 4px 6px; font: inherit; color: var(--text-secondary); background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
    .gm-col { min-width: 34px; font: 600 12px/16px var(--fuente-mono); }
    .gm-fila { max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; color: var(--text-primary); font-size: 12px; }
    .gm-col:hover, .gm-fila:hover { background: var(--gr-hover); color: var(--text-primary); }
    .gm-col:focus-visible, .gm-fila:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gm-col[aria-pressed='true'], .gm-fila[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); color: var(--text-primary); font-weight: 600; }
    .gm-celda { min-width: 34px; height: 28px; padding: 0 4px; text-align: center; font: 500 11px/1 var(--fuente-mono); font-variant-numeric: tabular-nums; color: var(--text-primary);
      background: color-mix(in srgb, var(--c) calc(var(--a, 0) * var(--gm-max)), transparent); border-radius: 3px; cursor: pointer; transition: background-color var(--gr-dur) var(--gr-ease), opacity 180ms ease; }
    .gm-celda.vacia { background: color-mix(in srgb, var(--gr-rejilla) 60%, transparent); cursor: default; }
    /* Una sola polaridad de texto (tinta) y un techo de intensidad por tema: el texto cumple AA en TODA la escala. */
    .gm { --gm-max: 45%; }
    :host-context([data-theme='light']) .gm { --gm-max: 65%; }
    .gm-celda.fuerte { font-weight: 650; }
    .gm-celda.activa { outline: 2px solid var(--text-primary); outline-offset: -2px; }
    .gm.con-seleccion .gm-celda.fuera { opacity: .3; }
    .gm-tot { padding: 0 0 0 8px !important; text-align: right; font: 500 11px/1 var(--fuente-mono) !important; color: var(--gr-texto-eje) !important; }
    .gm-pie { display: flex; flex-wrap: wrap; gap: 6px 20px; align-items: center; margin-top: 10px; }
    .gm-escala { display: inline-flex; align-items: center; gap: 8px; font: 500 11px/1 var(--fuente-mono); color: var(--gr-texto-eje); }
    .gm-escala i { display: inline-block; width: 120px; height: 8px; border-radius: 2px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 6%, transparent), color-mix(in srgb, var(--c) var(--gm-max), transparent)); }
    .gm-movil { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13px; }
    .gm-movil li { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 6px 8px; border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 8%, transparent); border-radius: 0 4px 4px 0; }
    .gm-codigos { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 0; padding: 0; list-style: none; font-size: 11px; color: var(--text-secondary); }
    .gm-codigos b { font-family: var(--fuente-mono); color: var(--text-primary); margin-right: 4px; }
  `],
  template: `
    @if (movil()) {
      <ul class="gm-movil" [class]="'gt-' + tono()" [attr.aria-label]="titulo() + ': cruces con más ' + unidad()">
        @for (c of mayores(); track c.fila + c.columna) { <li><span>{{ textoFila()(c.fila) }} · {{ textoColumna()(c.columna) }}</span><b class="ra-num">{{ c.estudiantes }}</b></li> }
      </ul>
    } @else {
    <div class="gr-marco gm" #marco [class]="'gt-' + tono()" [class.con-seleccion]="!!seleccionFila() || seleccionColumna() !== null">
      <div class="ra-desliza">
        <table class="gm-tabla">
          <caption class="ra-sr">{{ titulo() }}: estudiantes únicos por {{ rotuloFilas().toLowerCase() }} y {{ rotuloColumnas().toLowerCase() }}</caption>
          <thead>
            <tr>
              <th scope="col" class="gm-esq">{{ rotuloFilas() }} · {{ rotuloColumnas().toLowerCase() }}</th>
              @for (c of columnas(); track c) {
                <th scope="col"><button type="button" class="gm-col" [attr.aria-pressed]="seleccionColumna() !== null && c === seleccionColumna()" [attr.aria-label]="textoColumna()(c)" (click)="elegirColumna.emit(c)">{{ cortoColumna()(c) }}</button></th>
              }
              <th scope="col" class="gm-tot">Total</th>
            </tr>
          </thead>
          <tbody>
            @for (f of visibles(); track f.clave) {
              <tr>
                <th scope="row"><button type="button" class="gm-fila" [attr.aria-pressed]="f.clave === seleccionFila()" (click)="elegirFila.emit(f.clave)">{{ textoFila()(f.clave) }}</button></th>
                @for (c of columnas(); track c) {
                  @let v = valor(f.clave, c);
                  <td class="gm-celda" [class.vacia]="!v" [class.fuerte]="alfa(v, f.clave) >= 72" [class.activa]="hover() === f.clave + '|' + c"
                      [class.fuera]="(!!seleccionFila() && seleccionFila() !== f.clave) || (seleccionColumna() !== null && seleccionColumna() !== c)"
                      [style.--a]="alfa(v, f.clave) / 100" (mouseenter)="ver($event, f.clave, c, v, f.total)" (mouseleave)="salir()" (click)="v && elegirCelda.emit({ fila: f.clave, columna: c })">{{ v || '' }}</td>
                }
                <td class="gm-tot">{{ f.total }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="gm-pie" aria-hidden="true">
        <span class="gm-escala">0<i></i>{{ maximo() }}</span>
        <ul class="gm-codigos">@for (c of columnas(); track c) { <li><b>{{ cortoColumna()(c) }}</b>{{ textoColumna()(c) }}</li> }</ul>
      </div>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
    }
    @if (!movil() && matriz().filas.length > tope()) {
      <button type="button" class="gr-mas" [attr.aria-expanded]="todos()" (click)="todos.set(!todos())">{{ todos() ? 'Ver menos' : 'Ver todas las filas (' + matriz().filas.length + ')' }}</button>
    }
  `,
})
export class ReportesMatrizComponent {
  readonly titulo = input.required<string>();
  readonly celdas = input.required<Celda[]>();
  readonly rotuloFilas = input.required<string>();
  readonly rotuloColumnas = input.required<string>();
  readonly textoFila = input<(v: string) => string>((v) => v);
  readonly textoColumna = input<(v: string) => string>((v) => v);
  readonly cortoColumna = input<(v: string) => string>((v) => v);
  readonly seleccionFila = input('');
  /** Columna elegida; `null` = ninguna ('' es una columna válida: «sin dato»). */
  readonly seleccionColumna = input<string | null>(null);
  readonly limite = input(10);
  /** Unidad de la celda (estudiantes, obligaciones…). */
  readonly unidad = input('estudiantes');
  /** Orden semántico de columnas (p. ej. estados documentales); por defecto, por total. */
  readonly ordenColumnas = input<readonly string[] | null>(null);
  /** Intensidad: respecto al máximo de la matriz, o a cada fila (composición dentro de la fila). */
  readonly normalizar = input<'global' | 'fila'>('global');
  readonly tono = input<TonoGrafico>('principal');
  readonly elegirFila = output<string>();
  readonly elegirColumna = output<string>();
  readonly elegirCelda = output<{ fila: string; columna: string }>();
  /** ¿La celda aplica un filtro? (No en cruces cuyas columnas no son filtros del reporte, p. ej. estado documental.) */
  readonly celdaFiltrable = input(true);
  readonly pieCelda = input('Clic para filtrar por ambos');

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly todos = signal(false);
  protected readonly movil = signal(false);
  protected readonly hover = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly matriz = computed(() => apilar(this.celdas()));
  protected readonly columnas = computed(() => {
    const o = this.ordenColumnas(), presentes = this.matriz().columnas;
    return o ? [...o.filter((c) => presentes.includes(c)), ...presentes.filter((c) => !o.includes(c))] : presentes;
  });
  private readonly totalColumna = computed(() => { const m = new Map<string, number>(); for (const c of this.celdas()) m.set(c.columna, (m.get(c.columna) ?? 0) + c.estudiantes); return m; });
  private readonly totalFila = computed(() => { const m = new Map<string, number>(); for (const c of this.celdas()) m.set(c.fila, (m.get(c.fila) ?? 0) + c.estudiantes); return m; });
  /** Móvil: la matriz completa no cabe en 390 px; se muestran los cruces de mayor valor. */
  protected readonly mayores = computed(() => [...this.celdas()].sort((a, b) => b.estudiantes - a.estudiantes).slice(0, 10));
  protected readonly tope = computed(() => (this.movil() ? Math.min(TOP_MOVIL, this.limite()) : this.limite()));
  protected readonly visibles = computed(() => (this.todos() ? this.matriz().filas : this.matriz().filas.slice(0, this.tope())));
  private readonly indice = computed(() => new Map(this.celdas().map((c) => [`${c.fila}|${c.columna}`, c.estudiantes])));
  protected readonly maximo = computed(() => Math.max(0, ...this.celdas().map((c) => c.estudiantes)));

  constructor() {
    inject(DestroyRef).onDestroy(escucharMovil(this.movil));
  }

  protected valor(f: string, c: string): number { return this.indice().get(`${f}|${c}`) ?? 0; }
  /** Intensidad 12–100 % proporcional al máximo de la matriz (o de la fila); 0 = celda vacía. */
  protected alfa(v: number, fila = ''): number {
    const m = this.normalizar() === 'fila' ? (this.totalFila().get(fila) ?? 0) : this.maximo();
    return v && m ? Math.round(12 + (88 * v) / m) : 0;
  }
  protected ver(ev: Event, f: string, c: string, v: number, total: number): void {
    this.hover.set(`${f}|${c}`);
    this.tip.set(tipEn(this.marco().nativeElement, ev, `${this.textoFila()(f)} · ${this.textoColumna()(c)}`,
      [`${num(v)} ${this.unidad()}`, `${pct1(v, total)} dentro de ${this.textoFila()(f)}`, `${pct1(v, this.totalColumna().get(c) ?? 0)} dentro de ${this.textoColumna()(c)}`],
      v && this.celdaFiltrable() ? this.pieCelda() : undefined, this.tono()));
  }
  protected salir(): void { this.hover.set(null); this.tip.set(null); }
}
