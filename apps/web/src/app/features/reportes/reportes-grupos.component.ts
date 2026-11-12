import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { TipGrafico, escala, num, pieFiltro, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface GrupoBarras { clave: string; texto: string; a: number; b: number }

/**
 * Barras agrupadas horizontales para comparar dos momentos (periodo A frente a B) por categoría: A en azul frío
 * (comparación), B en teal (dato principal), misma escala, rejilla y eje X; la cifra al final de cada barra. La fila es un
 * botón (cross-filter con `aria-pressed`). Top N con «Ver todos».
 */
@Component({
  selector: 'sipra-reportes-grupos',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gg, .gg-ley { --gg-y: clamp(8.5rem, 30%, 15rem); --gg-pad: 3rem; --gg-gap: 12px; --gg-px: 8px; }
    .gg-rejilla { position: absolute; top: 0; bottom: 22px; left: calc(var(--gg-px) + var(--gg-y) + var(--gg-gap)); right: calc(var(--gg-px) + var(--gg-pad) + var(--gg-gap)); pointer-events: none; }
    .gg-linea { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gr-rejilla); transition: left var(--gr-dur) var(--gr-ease); }
    .gg-linea.base { background: var(--gr-eje); }
    .gg-ley { margin: 0 0 12px; }
    .gg-filas { position: relative; display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .gg-fila { display: grid; grid-template-columns: var(--gg-y) minmax(0, 1fr) var(--gg-pad); column-gap: var(--gg-gap); align-items: center; width: 100%; padding: 3px var(--gg-px);
      font: inherit; font-size: 13px; text-align: left; color: var(--text-primary); background: none; border: 0; border-radius: 4px; cursor: pointer; }
    .gg-fila:hover, .gg-fila.activa { background: var(--gr-hover); }
    .gg-fila:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 0; }
    .gg-fila[aria-pressed='true'] .gg-y { font-weight: 600; }
    .gg-y { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gg-plot { display: grid; gap: 2px; }
    .gg-carril { position: relative; height: 11px; }
    .gg-barra { position: absolute; top: 0; bottom: 0; left: 0; background: var(--c); border-radius: 0 2px 2px 0; transition: width var(--gr-dur) var(--gr-ease), opacity 180ms ease; }
    .gg-valor { position: absolute; top: 50%; margin-left: 6px; transform: translateY(-50%); font: 500 11px/1 var(--fuente-mono); color: var(--text-secondary); white-space: nowrap; transition: left var(--gr-dur) var(--gr-ease); }
    .gg.con-hover .gg-fila:not(.activa) .gg-barra { opacity: .42; }
    .gg.con-seleccion .gg-fila[aria-pressed='false'] .gg-barra { opacity: .35; }
    .gg-eje { display: grid; grid-template-columns: var(--gg-y) minmax(0, 1fr) var(--gg-pad); column-gap: var(--gg-gap); padding: 6px var(--gg-px) 0; }
    .gg-eje .gr-eje-t { text-align: right; }
    .gg-marcas { grid-column: 2; position: relative; height: 16px; }
    .gg-marcas span { position: absolute; transform: translateX(-50%); font: 500 11px/16px var(--fuente-mono); color: var(--gr-texto-eje); white-space: nowrap; transition: left var(--gr-dur) var(--gr-ease); }
    @media (width < 700px) {
      .gg, .gg-ley { --gg-y: 0px; }
      .gg-y { grid-column: 1 / -1; grid-row: 1; }
      .gg-plot { grid-column: 2; grid-row: 2; }
      .gg-eje .gr-eje-t { display: none; }
    }
  `],
  template: `
    <ul class="gr-leyenda gg-ley" aria-hidden="true">
      <li><span class="gr-muestra gt-comparacion"></span>{{ rotuloA() }}</li>
      <li><span class="gr-muestra gt-principal"></span>{{ rotuloB() }}</li>
    </ul>
    <div class="gr-marco gg" #marco [class.con-hover]="!!hover()" [class.con-seleccion]="!!seleccion()">
      <div class="gg-rejilla" aria-hidden="true">
        @for (m of esc().marcas; track $index) { <span class="gg-linea" [class.base]="m === 0" [style.left.%]="(m * 100) / esc().max"></span> }
      </div>
      <ul class="gg-filas" [attr.aria-label]="titulo()">
        @for (g of visibles(); track g.clave) {
          <li>
            <button type="button" class="gg-fila" [class.activa]="hover() === g.clave" [attr.aria-pressed]="g.clave === seleccion()" [attr.aria-label]="aria(g)"
                    (click)="elegir.emit(g.clave)" (mouseenter)="ver($event, g)" (mousemove)="ver($event, g)" (mouseleave)="salir()" (focus)="ver($event, g)" (blur)="salir()">
              <span class="gg-y">{{ g.texto }}</span>
              <span class="gg-plot" aria-hidden="true">
                <span class="gg-carril"><span class="gg-barra gt-comparacion" [style.width.%]="ancho(g.a)"></span><span class="gg-valor" [style.left.%]="ancho(g.a)">{{ num(g.a) }}</span></span>
                <span class="gg-carril"><span class="gg-barra gt-principal" [style.width.%]="ancho(g.b)"></span><span class="gg-valor" [style.left.%]="ancho(g.b)">{{ num(g.b) }}</span></span>
              </span>
            </button>
          </li>
        }
      </ul>
      <div class="gg-eje" aria-hidden="true">
        <span class="gr-eje-t">{{ ejeX() }}</span>
        <span class="gg-marcas">@for (m of esc().marcas; track $index) { <span [style.left.%]="(m * 100) / esc().max">{{ num(m) }}</span> }</span>
      </div>
      <sipra-reportes-tooltip [tip]="tip()" />
    </div>
    @if (grupos().length > limite()) {
      <button type="button" class="gr-mas" [attr.aria-expanded]="todos()" (click)="todos.set(!todos())">{{ todos() ? 'Ver menos' : 'Ver todos (' + grupos().length + ')' }}</button>
    }
  `,
})
export class ReportesGruposComponent {
  readonly titulo = input.required<string>();
  readonly grupos = input.required<GrupoBarras[]>();
  readonly rotuloA = input.required<string>();
  readonly rotuloB = input.required<string>();
  readonly unidad = input('estudiantes');
  readonly ejeX = input('Estudiantes');
  readonly seleccion = input('');
  readonly limite = input(8);
  readonly elegir = output<string>();

  private readonly marco = viewChild.required<ElementRef<HTMLElement>>('marco');
  protected readonly todos = signal(false);
  protected readonly hover = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly visibles = computed(() => (this.todos() ? this.grupos() : this.grupos().slice(0, this.limite())));
  protected readonly esc = computed(() => escala(Math.max(0, ...this.grupos().flatMap((g) => [g.a, g.b])), 4));
  protected readonly num = num;

  protected ancho(n: number): number { return (n * 100) / this.esc().max; }
  private lineas(g: GrupoBarras): string[] {
    const d = g.b - g.a;
    return [`${this.rotuloB()}: ${num(g.b)} ${this.unidad()}`, `${this.rotuloA()}: ${num(g.a)} ${this.unidad()}`, `Diferencia B − A: ${d > 0 ? '+' : ''}${num(d)}`];
  }
  protected aria(g: GrupoBarras): string { return `${g.texto}: ${this.lineas(g).join(', ')}`; }
  protected ver(ev: Event, g: GrupoBarras): void {
    this.hover.set(g.clave);
    this.tip.set(tipEn(this.marco().nativeElement, ev, g.texto, this.lineas(g), pieFiltro(g.clave === this.seleccion()), 'principal'));
  }
  protected salir(): void { this.hover.set(null); this.tip.set(null); }
}
