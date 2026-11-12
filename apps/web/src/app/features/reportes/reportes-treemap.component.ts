import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { ItemBarra, pct1 } from './reportes-analitica.util';
import { TipGrafico, TonoGrafico, categorico, escucharMovil, num } from './reportes-graficos.util';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface FilaJerarquia { escuela: string; programa: string; ciclo: string; semestre: number | null; estudiantes: number }
export interface Nodo { id: string; nivel: number; clave: string; texto: string; n: number; hijos: Nodo[]; tono: TonoGrafico; ruta: string[] }
export interface Rect { x: number; y: number; w: number; h: number }

export const NIVELES_DRILL = ['Escuelas', 'Programas', 'Nivel de formación', 'Semestre'] as const;

/** Árbol escuela → programa → nivel → semestre; cada nodo suma sus hojas; el tono es el de su escuela. */
export function arbol(filas: readonly FilaJerarquia[], textos: readonly ((v: string) => string)[]): Nodo {
  const raiz: Nodo = { id: '', nivel: -1, clave: '', texto: 'Todo', n: 0, hijos: [], tono: 'muted', ruta: [] };
  const escuelas = [...new Set(filas.map((f) => f.escuela))].sort();
  for (const f of filas) {
    const claves = [f.escuela, f.programa, f.ciclo, f.semestre === null ? '' : String(f.semestre)];
    const tono = categorico(escuelas.indexOf(f.escuela));
    let nodo = raiz;
    raiz.n += f.estudiantes;
    claves.forEach((c, nivel) => {
      if (nivel === 3 && c === '') return;
      const id = claves.slice(0, nivel + 1).join('›');
      let hijo = nodo.hijos.find((h) => h.id === id);
      if (!hijo) { hijo = { id, nivel, clave: c, texto: textos[nivel](c), n: 0, hijos: [], tono, ruta: claves.slice(0, nivel + 1) }; nodo.hijos.push(hijo); }
      hijo.n += f.estudiantes;
      nodo = hijo;
    });
  }
  // Escuelas y programas por tamaño; nivel y semestre en su orden académico.
  const ordenar = (n: Nodo) => { n.hijos.sort((a, b) => (n.nivel >= 1 ? 0 : b.n - a.n) || a.clave.localeCompare(b.clave, 'es', { numeric: true })); n.hijos.forEach(ordenar); };
  ordenar(raiz);
  return raiz;
}

/**
 * Treemap «squarified» (Bruls et al.): rectángulos con proporciones cercanas a 1 para que el ÁREA se compare bien.
 * Recibe valores en el orden deseado (mayor a menor) y devuelve un rectángulo por valor dentro de `w`×`h`.
 */
export function squarify(valores: readonly number[], w: number, h: number): Rect[] {
  const total = valores.reduce((a, b) => a + b, 0);
  const salida: Rect[] = Array(valores.length);
  if (!total || w <= 0 || h <= 0) return valores.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const escala = (w * h) / total;
  let x = 0, y = 0, ancho = w, alto = h, i = 0;
  const peor = (fila: number[], lado: number) => {
    const s = fila.reduce((a, b) => a + b, 0), max = Math.max(...fila), min = Math.min(...fila);
    return Math.max((lado * lado * max) / (s * s), (s * s) / (lado * lado * min));
  };
  while (i < valores.length) {
    const lado = Math.min(ancho, alto);
    const fila: number[] = [valores[i] * escala];
    let j = i + 1;
    while (j < valores.length && peor([...fila, valores[j] * escala], lado) <= peor(fila, lado)) { fila.push(valores[j] * escala); j++; }
    const s = fila.reduce((a, b) => a + b, 0);
    if (ancho >= alto) {
      const anchoFila = s / alto;
      let yy = y;
      fila.forEach((a, k) => { const hh = a / anchoFila; salida[i + k] = { x, y: yy, w: anchoFila, h: hh }; yy += hh; });
      x += anchoFila; ancho -= anchoFila;
    } else {
      const altoFila = s / ancho;
      let xx = x;
      fila.forEach((a, k) => { const ww = a / altoFila; salida[i + k] = { x: xx, y, w: ww, h: altoFila }; xx += ww; });
      y += altoFila; alto -= altoFila;
    }
    i = j;
  }
  return salida;
}

const ALTO = 400;

/**
 * Exploración académica por niveles, de a uno: Escuelas → Programas → Nivel de formación → Semestre. Vista «Mapa»
 * (treemap: el ÁREA es el número de estudiantes) o «Ranking» (barras, la misma pregunta con valores exactos). Clic en un
 * bloque entra al nivel siguiente; la miga vuelve a cualquier nivel. Los bloques grandes muestran nombre, cantidad y %;
 * los medianos solo el nombre; los pequeños, nada (tooltip). En una escuela o un programa, «Filtrar el reporte».
 */
@Component({
  selector: 'sipra-reportes-treemap',
  standalone: true,
  imports: [ReportesTooltipComponent, ReportesBarrasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gt-cab { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 0 0 12px; }
    .gt-migas { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--text-secondary); }
    .gt-migas button { padding: 2px 8px; font: inherit; color: var(--text-primary); background: none; border: 1px solid var(--border-subtle); border-radius: 12px; cursor: pointer; }
    .gt-migas strong { color: var(--text-primary); }
    .gt-acc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .gt-modo { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border-default); border-radius: 7px; }
    .gt-modo button { height: 26px; padding: 0 10px; font: 500 12px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; border-radius: 5px; cursor: pointer; }
    .gt-modo button[aria-pressed='true'] { color: var(--text-primary); background: color-mix(in srgb, var(--bi-blue) 18%, transparent); font-weight: 650; }
    .gt-filtrar { padding: 5px 10px; font: 600 12px/16px var(--fuente); color: var(--text-primary); background: color-mix(in srgb, var(--bi-blue) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--bi-blue) 50%, transparent); border-radius: 6px; cursor: pointer; }
    .gt-migas button:focus-visible, .gt-modo button:focus-visible, .gt-filtrar:focus-visible, .gt-b:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .gt-nivel { margin: 0 0 8px; font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .gt-area { position: relative; height: ${ALTO}px; }
    .gt-b { position: absolute; display: flex; flex-direction: column; justify-content: flex-start; gap: 2px; padding: 8px 10px; overflow: hidden; text-align: left; font: inherit;
      color: var(--text-primary); background: color-mix(in srgb, var(--c) var(--f, 30%), var(--surface-raised)); border: 2px solid var(--surface-canvas, transparent); border-radius: 6px;
      cursor: pointer; transition: background-color 160ms ease, opacity 160ms ease; }
    .gt-b:hover { background: color-mix(in srgb, var(--c) calc(var(--f, 30%) + 12%), var(--surface-raised)); }
    .gt-b.hoja { cursor: default; }
    .gt-b.elegido { box-shadow: inset 0 0 0 2px var(--text-primary); }
    .gt-b b { font-size: 13px; font-weight: 650; line-height: 17px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .gt-b .gt-n { font: 650 20px/24px var(--fuente-mono); letter-spacing: -.02em; }
    .gt-b small { font: 500 11px/14px var(--fuente-mono); color: var(--text-secondary); }
    .gt-b.medio b { font-size: 12px; -webkit-line-clamp: 1; }
  `],
  template: `
    <div class="gt-cab">
      <ol class="gt-migas" aria-label="Ubicación">
        @for (m of migas(); track m.id; let ultimo = $last) {
          <li>@if (!ultimo) { <button type="button" (click)="ruta.set(m.ruta)">{{ m.texto }}</button> → } @else { <strong>{{ m.texto }}</strong> }</li>
        }
      </ol>
      <div class="gt-acc">
        @if (filtrable(); as f) { <button type="button" class="gt-filtrar" (click)="filtrar.emit(f)">Filtrar el reporte por {{ f.texto }}</button> }
        @if (!movil()) {
          <div class="gt-modo" role="group" aria-label="Vista">
            <button type="button" [attr.aria-pressed]="modo() === 'mapa'" (click)="modo.set('mapa')">Mapa</button>
            <button type="button" [attr.aria-pressed]="modo() === 'ranking'" (click)="modo.set('ranking')">Ranking</button>
          </div>
        }
      </div>
    </div>
    <p class="gt-nivel">{{ nivelActual() }} · {{ num(actual().n) }} estudiantes · {{ actual().hijos.length }} {{ actual().hijos.length === 1 ? 'grupo' : 'grupos' }}{{ hijosDrill() ? ' · clic para entrar' : '' }}</p>
    @if (modo() === 'ranking' || movil()) {
      <sipra-reportes-barras [titulo]="nivelActual()" [items]="items()" [total]="actual().n" [limite]="12" [seleccionable]="hijosDrill()" ejeX="Estudiantes" tono="principal" base="del nivel" (elegir)="entrar($event)" />
    } @else {
      <div class="gr-marco">
        <div class="gt-area" #marco role="group" [attr.aria-label]="titulo() + ': ' + nivelActual()">
          @for (b of bloques(); track b.nodo.id) {
            <button type="button" class="gt-b" [class]="'gt-' + b.nodo.tono" [class.hoja]="!b.nodo.hijos.length" [class.medio]="b.etiqueta === 'nombre'" [class.elegido]="esElegido(b.nodo)"
                    [style.--f]="b.fuerza" [style.left.px]="b.r.x" [style.top.px]="b.r.y" [style.width.px]="b.r.w" [style.height.px]="b.r.h"
                    [attr.aria-label]="b.nodo.texto + ': ' + num(b.nodo.n) + ' estudiantes, ' + pct(b.nodo.n) + (b.nodo.hijos.length ? '. Enter para entrar' : '')"
                    (click)="b.nodo.hijos.length && entrar(b.nodo.clave)" (mouseenter)="ver($event, b.nodo)" (mousemove)="ver($event, b.nodo)" (mouseleave)="tip.set(null)" (focus)="ver($event, b.nodo)" (blur)="tip.set(null)">
              @if (b.etiqueta === 'completa') { <b>{{ b.nodo.texto }}</b><span class="gt-n">{{ num(b.nodo.n) }}</span><small>{{ pct(b.nodo.n) }}</small> }
              @else if (b.etiqueta === 'nombre') { <b>{{ b.nodo.texto }}</b> }
            </button>
          }
        </div>
        <sipra-reportes-tooltip [tip]="tip()" />
      </div>
    }
  `,
})
export class ReportesTreemapComponent {
  readonly titulo = input.required<string>();
  readonly filas = input.required<FilaJerarquia[]>();
  readonly textos = input.required<((v: string) => string)[]>();
  readonly seleccion = input<{ escuela: string; programa: string }>({ escuela: '', programa: '' });
  readonly filtrar = output<{ nivel: number; clave: string; texto: string }>();

  private readonly marco = viewChild<ElementRef<HTMLElement>>('marco');
  protected readonly num = num;
  protected readonly modo = signal<'mapa' | 'ranking'>('mapa');
  protected readonly movil = signal(false);
  protected readonly ancho = signal(900);
  protected readonly ruta = signal<string[]>([]);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly raiz = computed(() => arbol(this.filas(), this.textos()));
  /** Nodo actual: sigue la ruta mientras exista (si un filtro la deja vacía, vuelve al nivel válido más profundo). */
  protected readonly actual = computed(() => {
    let n = this.raiz();
    for (const c of this.ruta()) { const h = n.hijos.find((x) => x.clave === c); if (!h) break; n = h; }
    return n;
  });
  protected readonly migas = computed(() => {
    const salida: Nodo[] = [this.raiz()];
    let n = this.raiz();
    for (const c of this.actual().ruta) { const h = n.hijos.find((x) => x.clave === c); if (!h) break; salida.push(h); n = h; }
    return salida;
  });
  protected readonly nivelActual = computed(() => NIVELES_DRILL[this.actual().nivel + 1] ?? '');
  protected readonly hijosDrill = computed(() => this.actual().hijos.some((h) => h.hijos.length > 0));
  protected readonly filtrable = computed(() => { const a = this.actual(); return a.nivel === 0 || a.nivel === 1 ? { nivel: a.nivel, clave: a.clave, texto: a.texto } : null; });
  protected readonly items = computed<ItemBarra[]>(() => this.actual().hijos.map((h) => ({ clave: h.clave, texto: h.texto, n: h.n, tono: h.tono })));
  protected readonly bloques = computed(() => {
    const hijos = this.actual().hijos, w = this.ancho(), rects = squarify(hijos.map((h) => h.n), w, ALTO);
    const escuelaUnica = this.actual().nivel >= 0;
    return hijos.map((nodo, i) => {
      const r = rects[i];
      const etiqueta = r.w >= 120 && r.h >= 74 ? 'completa' : r.w >= 64 && r.h >= 30 ? 'nombre' : 'ninguna';
      // Dentro de una escuela todos comparten su color: la intensidad alterna para separar bloques vecinos.
      const fuerza = escuelaUnica ? `${[34, 26, 30, 22][i % 4]}%` : '32%';
      return { nodo, r, etiqueta, fuerza };
    });
  });

  constructor() {
    const destruir = inject(DestroyRef);
    destruir.onDestroy(escucharMovil(this.movil));
    afterNextRender(() => {
      const medir = () => { const el = this.marco()?.nativeElement; if (el) this.ancho.set(Math.max(300, el.clientWidth)); };
      medir();
      if (typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(() => medir());
      const el = this.marco()?.nativeElement?.parentElement?.parentElement;
      if (el) { ro.observe(el); destruir.onDestroy(() => ro.disconnect()); }
    });
  }

  protected entrar(clave: string): void {
    const h = this.actual().hijos.find((x) => x.clave === clave);
    if (h?.hijos.length) { this.ruta.set(h.ruta); this.tip.set(null); }
  }
  protected pct(n: number): string { return pct1(n, this.actual().n); }
  protected esElegido(n: Nodo): boolean {
    const s = this.seleccion();
    return (n.nivel === 0 && n.clave === s.escuela && !s.programa) || (n.nivel === 1 && n.clave === s.programa);
  }
  protected ver(ev: Event, n: Nodo): void {
    const el = this.marco()?.nativeElement;
    if (!el) return;
    const m = el.getBoundingClientRect();
    let x: number, y: number;
    if ('clientX' in ev && ev.type.startsWith('mouse')) { x = (ev as MouseEvent).clientX - m.left; y = (ev as MouseEvent).clientY - m.top; }
    else { const b = (ev.target as HTMLElement).getBoundingClientRect(); x = b.left - m.left + Math.min(b.width, 200); y = b.top - m.top + b.height / 2; }
    this.tip.set({ x, y, izquierda: x > m.width * 0.6, titulo: n.texto, tono: n.tono,
      lineas: [`${num(n.n)} estudiantes`, `${this.pct(n.n)} de ${this.actual().texto === 'Todo' ? 'todo el universo' : this.actual().texto}`],
      pie: n.hijos.length ? `Clic para ver ${NIVELES_DRILL[n.nivel + 1]?.toLowerCase()}` : undefined });
  }
}
