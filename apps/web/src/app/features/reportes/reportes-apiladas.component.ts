import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Celda, apilar, claseSerie, pct1 } from './reportes-analitica.util';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Cruce de dos dimensiones como barras horizontales apiladas (estudiantes únicos por celda). El nombre de la fila filtra
 * la dimensión de filas; cada entrada de la leyenda filtra la de columnas (cross-filter con teclado). Paleta corta y estable
 * (cinco tonos + «otras»), siempre con texto; la matriz completa está en «Ver como tabla».
 */
@Component({
  selector: 'sipra-reportes-apiladas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .leyenda-a { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0 0 10px; padding: 0; list-style: none; }
    .ley { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 8px; font: 500 12px/16px var(--fuente); color: var(--text-primary); background: none; border: 1px solid var(--border-subtle); border-radius: 13px; cursor: pointer; }
    .ley[aria-pressed='true'] { border-color: var(--signal-active); background: color-mix(in srgb, var(--signal-active) 12%, transparent); }
    .ley:focus-visible, .rot:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .filas-a { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .fila-a { display: grid; grid-template-columns: minmax(6rem, 30%) 1fr 3.5rem; gap: 10px; align-items: center; }
    .rot { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 6px; font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
    .rot:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    .rot[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); }
    .pila-a { display: flex; height: 14px; gap: 1px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    .pila-a span { height: 100%; }
    .tot { font: 500 12px/16px var(--fuente-mono); text-align: right; color: var(--text-secondary); }
    .mas { margin-top: 6px; padding: 4px 6px; font: 500 12px/16px var(--fuente); color: var(--text-secondary); background: none; border: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    details { margin-top: 10px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    summary:focus-visible, .mas:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    @media (width < 700px) { .fila-a { grid-template-columns: 1fr 3rem; } .pila-a { grid-column: 1 / -1; } }
  `],
  template: `
    <ul class="leyenda-a" [attr.aria-label]="'Filtrar por ' + rotuloColumnas()">
      @for (c of columnas(); track c) {
        <li><button type="button" class="ley" [attr.aria-pressed]="c === seleccionColumna()" (click)="elegirColumna.emit(c)">
          <span class="ra-punto" [class]="claseDe(c)" aria-hidden="true" style="margin-right:0"></span>{{ texto()(c) }}</button></li>
      }
    </ul>
    <ul class="filas-a" [attr.aria-label]="titulo()">
      @for (f of visibles(); track f.clave) {
        <li class="fila-a">
          <button type="button" class="rot" [attr.aria-pressed]="f.clave === seleccionFila()" [title]="'Filtrar por ' + textoFila()(f.clave)" (click)="elegirFila.emit(f.clave)">{{ textoFila()(f.clave) }}</button>
          <span class="pila-a" aria-hidden="true">
            @for (p of f.partes; track p.columna) {
              <span [class]="claseDe(p.columna)" [style.flex-grow]="p.n" [title]="textoFila()(f.clave) + ' · ' + texto()(p.columna) + ': ' + p.n + ' estudiantes (' + porc(p.n, f.total) + ' de la fila)'"></span>
            }
          </span>
          <span class="tot">{{ f.total }}</span>
        </li>
      }
    </ul>
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

  protected readonly todos = signal(false);
  protected readonly matriz = computed(() => apilar(this.celdas(), this.ordenFilas()));
  /** Con un orden dado (p. ej. técnico → tecnólogo → profesional), la leyenda y la tabla lo respetan; si no, por total. */
  protected readonly columnas = computed(() => {
    const presentes = this.matriz().columnas, orden = this.ordenColores();
    return orden ? [...orden.filter((c) => presentes.includes(c)), ...presentes.filter((c) => !orden.includes(c))] : presentes;
  });
  protected readonly visibles = computed(() => (this.todos() ? this.matriz().filas : this.matriz().filas.slice(0, this.limite())));

  protected claseDe(c: string): string { return claseSerie(this.ordenColores() ?? this.columnas(), c); }
  protected porc(n: number, total: number): string { return pct1(n, total); }
  protected valor(partes: { columna: string; n: number }[], c: string): number { return partes.find((p) => p.columna === c)?.n ?? 0; }
}
