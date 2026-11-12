import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { Celda, pct1 } from './reportes-analitica.util';
import { ParteGrafico, TipGrafico, escala, num, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Filas propias; el resto se agrupa en «Otras modalidades» (solo para el dibujo; «Ver todas» las muestra). */
export const MAX_FILAS_COMPOSICION = 7;
export const OTRAS_FILAS = '__otras__';

export interface FilaComposicion { clave: string; texto: string; total: number; partes: { columna: string; n: number }[] }

/** Filas por volumen (prácticas) + «Otras»; dentro, las columnas en su orden semántico. La suma total no cambia. */
export function filasComposicion(celdas: readonly Celda[], columnas: readonly string[], texto: (v: string) => string, max = MAX_FILAS_COMPOSICION, elegida = ''): FilaComposicion[] {
  const porFila = new Map<string, Map<string, number>>();
  for (const c of celdas) {
    const f = porFila.get(c.fila) ?? new Map<string, number>();
    f.set(c.columna, (f.get(c.columna) ?? 0) + c.practicas);
    porFila.set(c.fila, f);
  }
  const filas = [...porFila.entries()].map(([clave, m]) => ({ clave, texto: texto(clave), total: [...m.values()].reduce((a, b) => a + b, 0), m }))
    .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave));
  const propias = filas.filter((f, i) => i < max || f.clave === elegida);
  const resto = filas.filter((f) => !propias.includes(f));
  const otras = new Map<string, number>();
  for (const f of resto) for (const [k, v] of f.m) otras.set(k, (otras.get(k) ?? 0) + v);
  const todas = [...propias, ...(resto.length ? [{ clave: OTRAS_FILAS, texto: `Otras ${resto.length} modalidades`, total: resto.reduce((n, f) => n + f.total, 0), m: otras }] : [])];
  return todas.map((f) => ({ clave: f.clave, texto: f.texto, total: f.total, partes: columnas.map((c) => ({ columna: c, n: f.m.get(c) ?? 0 })).filter((p) => p.n > 0) }));
}

/**
 * Composición por modalidad y situación: barras horizontales APILADAS con cantidades absolutas. Todas las filas tienen la
 * misma altura; la LONGITUD es el número de prácticas de la modalidad (300 se ve el doble que 150) y los segmentos, su
 * situación del expediente. «%» cambia a 100 % para comparar composición (Cantidad es el modo por defecto). El tooltip
 * explica la fila completa. El nombre filtra la modalidad; el segmento o la leyenda, la situación.
 */
@Component({
  selector: 'sipra-reportes-composicion',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gk { --gk-y: clamp(9rem, 28%, 14rem); --gk-tot: 3.2rem; }
    .gk-barra-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 0 0 12px; }
    .gk-ley { display: flex; flex-wrap: wrap; gap: 2px 4px; margin: 0; padding: 0; list-style: none; }
    .gk-ley button { display: inline-flex; align-items: baseline; gap: 6px; min-height: 28px; padding: 3px 8px; font: inherit; font-size: 12px; color: var(--text-primary);
      background: none; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
    .gk-ley button:hover, .gk-ley button.activa { background: var(--gr-hover); }
    .gk-ley button[aria-pressed='true'] { border-color: color-mix(in srgb, var(--c) 70%, transparent); font-weight: 650; }
    .gk-ley b { font: 650 12px/16px var(--fuente-mono); }
    .gk-modo { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border-default); border-radius: 7px; }
    .gk-modo button { height: 26px; padding: 0 10px; font: 500 12px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; border-radius: 5px; cursor: pointer; }
    .gk-modo button[aria-pressed='true'] { color: var(--text-primary); background: color-mix(in srgb, var(--bi-blue) 18%, transparent); font-weight: 650; }
    .gk-ley button:focus-visible, .gk-modo button:focus-visible, .gk-rot:focus-visible, .gr-mas:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .gk-rej { position: absolute; top: 0; bottom: 22px; left: calc(var(--gk-y) + 12px); right: calc(var(--gk-tot) + 12px); pointer-events: none; }
    .gk-rej span { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gr-rejilla); transition: left var(--gr-dur) var(--gr-ease); }
    .gk-rej span.base { background: var(--gr-eje); }
    .gk-filas { position: relative; display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .gk-fila, .gk-eje { display: grid; grid-template-columns: var(--gk-y) minmax(0, 1fr) var(--gk-tot); column-gap: 12px; align-items: center; }
    .gk-rot { min-width: 0; padding: 3px 6px; font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gk-rot:hover { background: var(--gr-hover); }
    .gk-rot[aria-pressed='true'] { border-color: color-mix(in srgb, var(--signal-active) 70%, transparent); font-weight: 650; }
    .gk-rot.otras { cursor: default; color: var(--text-secondary); }
    .gk-pista { position: relative; height: 24px; }
    .gk-pila { display: flex; gap: 1px; height: 100%; transition: width var(--gr-dur) var(--gr-ease); }
    .gk-seg { min-width: 2px; background: var(--c); cursor: pointer; transition: flex-grow var(--gr-dur) var(--gr-ease), opacity 160ms ease; }
    .gk-seg:last-child { border-radius: 0 3px 3px 0; }
    .gk.con-foco .gk-seg:not(.foco) { opacity: .3; }
    .gk.con-seleccion .gk-seg.fuera, .gk-fila.atenuada .gk-seg { opacity: .3; }
    .gk-tot { font: 600 12px/16px var(--fuente-mono); text-align: right; color: var(--text-primary); }
    .gk-eje { margin-top: 6px; }
    .gk-marcas { grid-column: 2; position: relative; height: 16px; }
    .gk-marcas span { position: absolute; transform: translateX(-50%); font: 500 11px/16px var(--fuente-mono); color: var(--gr-texto-eje); white-space: nowrap; }
    .gk-eje .gr-eje-t { text-align: right; }
    details { margin-top: 10px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    @media (width < 700px) {
      .gk { --gk-y: 0px; }
      .gk-rej, .gk-eje .gr-eje-t { display: none; }
      .gk-fila { grid-template-columns: minmax(0, 1fr) var(--gk-tot); row-gap: 2px; }
      .gk-rot { grid-column: 1 / -1; padding: 0; }
    }
  `],
  template: `
    <div class="gk-barra-h">
      <ul class="gk-ley" [attr.aria-label]="'Filtrar por ' + rotuloColumnas()">
        @for (c of totales(); track c.clave) {
          <li><button type="button" [class]="'gt-' + c.tono" [class.activa]="foco() === c.clave" [attr.aria-pressed]="seleccionColumna() === c.clave"
                      [attr.aria-label]="c.texto + ': ' + num(c.n) + ' ' + unidad() + ', ' + c.pct" (click)="elegirColumna.emit(c.clave)"
                      (mouseenter)="foco.set(c.clave)" (mouseleave)="foco.set(null)" (focus)="foco.set(c.clave)" (blur)="foco.set(null)">
            <span class="gr-muestra" aria-hidden="true"></span>{{ c.texto }} <b>{{ num(c.n) }}</b></button></li>
        }
      </ul>
      <div class="gk-modo" role="group" aria-label="Medida">
        <button type="button" [attr.aria-pressed]="modo() === 'cantidad'" (click)="modo.set('cantidad')">Cantidad</button>
        <button type="button" [attr.aria-pressed]="modo() === 'pct'" (click)="modo.set('pct')">%</button>
      </div>
    </div>
    <div class="gr-marco gk" #marco [class.con-foco]="!!foco()" [class.con-seleccion]="!!seleccionColumna()">
      <div class="gk-rej" aria-hidden="true">@for (m of marcas(); track $index) { <span [class.base]="m.v === 0" [style.left.%]="m.x"></span> }</div>
      <ul class="gk-filas" [attr.aria-label]="titulo()">
        @for (f of filas(); track f.clave) {
          <li class="gk-fila" [class.atenuada]="!!seleccionFila() && f.clave !== seleccionFila()">
            @if (f.clave === otras) {
              <span class="gk-rot otras">{{ f.texto }}</span>
            } @else {
              <button type="button" class="gk-rot" [attr.aria-pressed]="f.clave === seleccionFila()" [attr.aria-label]="resumen(f)" (click)="elegirFila.emit(f.clave)">{{ f.texto }}</button>
            }
            <span class="gk-pista" aria-hidden="true">
              <span class="gk-pila" [style.width.%]="modo() === 'pct' ? 100 : (f.total * 100) / esc().max">
                @for (p of f.partes; track p.columna) {
                  <span class="gk-seg" [class]="'gt-' + tonoDe(p.columna)" [class.foco]="foco() === p.columna" [class.fuera]="!!seleccionColumna() && seleccionColumna() !== p.columna"
                        [style.flex-grow]="p.n" (click)="elegirColumna.emit(p.columna)" (mouseenter)="ver($event, f)" (mousemove)="ver($event, f)" (mouseleave)="salir()"></span>
                }
              </span>
            </span>
            <span class="gk-tot">{{ num(f.total) }}</span>
          </li>
        }
      </ul>
      <div class="gk-eje" aria-hidden="true">
        <span class="gr-eje-t">{{ modo() === 'pct' ? '% de la modalidad' : unidad() }}</span>
        <span class="gk-marcas">@for (m of marcas(); track $index) { <span [style.left.%]="m.x">{{ m.t }}</span> }</span>
      </div>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
    @if (totalFilas() > max) {
      <button type="button" class="gr-mas" [attr.aria-expanded]="todas()" (click)="todas.set(!todas())">{{ todas() ? 'Ver menos' : 'Ver todas (' + totalFilas() + ')' }}</button>
    }
    <details>
      <summary>Ver como tabla</summary>
      <div class="ra-desliza">
        <table class="ra-tabla ra-una-linea" style="margin-top:8px">
          <caption class="ra-sr">{{ titulo() }}</caption>
          <thead><tr><th scope="col">Modalidad</th>@for (c of categorias(); track c.clave) { <th scope="col" class="d">{{ c.texto }}</th> }<th scope="col" class="d">Total</th></tr></thead>
          <tbody>@for (f of filasCompletas(); track f.clave) {
            <tr><th scope="row" [attr.title]="f.texto">{{ f.texto }}</th>@for (c of categorias(); track c.clave) { <td class="d">{{ valor(f, c.clave) }}</td> }<td class="d">{{ f.total }}</td></tr>
          }</tbody>
        </table>
      </div>
    </details>
  `,
})
export class ReportesComposicionComponent {
  readonly titulo = input.required<string>();
  readonly celdas = input.required<Celda[]>();
  /** Categorías de los segmentos en su orden semántico y con su color fijo (situaciones del expediente). */
  readonly categorias = input.required<ParteGrafico[]>();
  readonly textoFila = input<(v: string) => string>((v) => v);
  readonly rotuloColumnas = input('situación del expediente');
  readonly unidad = input('prácticas');
  readonly seleccionFila = input('');
  readonly seleccionColumna = input('');
  readonly elegirFila = output<string>();
  readonly elegirColumna = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly max = MAX_FILAS_COMPOSICION;
  protected readonly otras = OTRAS_FILAS;
  protected readonly num = num;
  protected readonly modo = signal<'cantidad' | 'pct'>('cantidad');
  protected readonly todas = signal(false);
  protected readonly foco = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly filasCompletas = computed(() => filasComposicion(this.celdas(), this.categorias().map((c) => c.clave), this.textoFila(), Infinity));
  protected readonly totalFilas = computed(() => this.filasCompletas().length);
  protected readonly filas = computed(() => (this.todas() ? this.filasCompletas()
    : filasComposicion(this.celdas(), this.categorias().map((c) => c.clave), this.textoFila(), MAX_FILAS_COMPOSICION, this.seleccionFila())));
  /** Escala real sobre la fila más larga (las «Otras» cuentan: así su barra no se sale del eje). */
  protected readonly esc = computed(() => escala(Math.max(0, ...this.filas().map((f) => f.total)), 4));
  protected readonly marcas = computed(() => (this.modo() === 'pct' ? [0, 25, 50, 75, 100].map((v) => ({ v, x: v, t: `${v} %` }))
    : this.esc().marcas.map((v) => ({ v, x: (v * 100) / this.esc().max, t: num(v) }))));
  /** Totales por situación = la reconciliación de la leyenda (suman las prácticas del universo de la faceta). */
  protected readonly totales = computed(() => {
    const filas = this.filasCompletas(), t = filas.reduce((n, f) => n + f.total, 0);
    return this.categorias().map((c) => {
      const n = filas.reduce((s, f) => s + (f.partes.find((p) => p.columna === c.clave)?.n ?? 0), 0);
      return { ...c, n, pct: pct1(n, t) };
    }).filter((c) => c.n > 0);
  });

  protected tonoDe(c: string): string { return this.categorias().find((x) => x.clave === c)?.tono ?? 'muted'; }
  protected valor(f: FilaComposicion, c: string): number { return f.partes.find((p) => p.columna === c)?.n ?? 0; }
  private lineas(f: FilaComposicion): string[] {
    return [`${num(f.total)} ${this.unidad()}`, ...this.categorias().map((c) => { const n = this.valor(f, c.clave); return n ? `${c.texto}: ${num(n)} · ${pct1(n, f.total)}` : ''; }).filter(Boolean)];
  }
  protected resumen(f: FilaComposicion): string { return `${f.texto}: ${this.lineas(f).join(', ')}. Filtrar por esta modalidad`; }
  protected ver(ev: Event, f: FilaComposicion): void {
    this.foco.set(null);
    this.tip.set(tipEn(this.marco().nativeElement, ev, `Modalidad · ${f.texto}`, this.lineas(f), f.clave === OTRAS_FILAS ? 'Use «Ver todas» para filtrar una de ellas' : 'Clic en un color: filtra esa situación', 'principal'));
  }
  protected salir(): void { this.tip.set(null); }
}
