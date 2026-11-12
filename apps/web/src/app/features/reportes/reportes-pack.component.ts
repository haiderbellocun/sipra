import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { pct1 } from './reportes-analitica.util';
import { TipGrafico, TonoGrafico, categorico, envolverEtiqueta, escucharMovil, medidorTexto, num, tipEn } from './reportes-graficos.util';
import { ReportesTooltipComponent } from './reportes-tooltip.component';
import { ESTILOS_REPORTES } from './reportes.estilos';

export interface Circulo { x: number; y: number; r: number }
export interface HojaPack { clave: string; texto: string; grupo: string; n: number; detalle: string[] }

/**
 * Empaquetado determinista de círculos: de mayor a menor, cada círculo se coloca tangente a uno ya puesto (24 ángulos) en
 * la posición válida más cercana al centro. Sin solapes (separación `hueco`). Devuelve posiciones y el radio envolvente.
 */
export function empaquetar(radios: readonly number[], hueco = 1.5): { c: Circulo[]; R: number } {
  const orden = radios.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const puestos: (Circulo & { i: number })[] = [];
  for (const { r, i } of orden) {
    if (!puestos.length) { puestos.push({ x: 0, y: 0, r, i }); continue; }
    let mejor: Circulo | null = null;
    for (const q of puestos) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + (q.i % 3) * 0.13, d = q.r + r + hueco;
        const c = { x: q.x + Math.cos(a) * d, y: q.y + Math.sin(a) * d, r };
        if (puestos.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < o.r + r + hueco - 1e-6)) continue;
        if (!mejor || Math.hypot(c.x, c.y) + r < Math.hypot(mejor.x, mejor.y) + mejor.r) mejor = c;
      }
    }
    const m = mejor as Circulo;
    puestos.push({ ...m, i });
  }
  // Centrar en el centro de masa geométrico y medir la envolvente.
  const cx = puestos.reduce((s, p) => s + p.x, 0) / puestos.length, cy = puestos.reduce((s, p) => s + p.y, 0) / puestos.length;
  const c = puestos.sort((a, b) => a.i - b.i).map((p) => ({ x: p.x - cx, y: p.y - cy, r: p.r }));
  return { c, R: Math.max(...c.map((p) => Math.hypot(p.x, p.y) + p.r)) };
}

/** Alto máximo del lienzo (px de pantalla: el SVG se dibuja 1:1 con su contenedor); el alto real sigue al círculo. */
const ALTO_MAX = 440;
/** Tamaño mínimo legible de las etiquetas de sector y de organización (no se reduce el texto para que «quepa»). */
export const FUENTE_SECTOR = 12;
export const FUENTE_ORG = 11;
const INTERLINEA = 15;

export interface EtiquetaSector { clave: string; lineas: string[]; completa: boolean; lado: 'izq' | 'der'; x: number; y: number; alto: number; guia: string }

/** Mejor guía de un círculo hasta su etiqueta: menos cruces con otros círculos y, a igualdad, la más corta. */
function mejorGuia(c: { clave: string; x: number; y: number; r: number }, otros: readonly { x: number; y: number; r: number }[], codo: number, ym: number, x: number, s0: number): { ps: number[][]; cruces: number } {
  const cruces = (ps: number[][]) => ps.slice(1).reduce((n, q, k) => n + otros.filter((o) => cruzaCirculo(ps[k], q, o)).length, 0);
  const largo = (ps: number[][]) => ps.slice(1).reduce((n, q, k) => n + Math.hypot(q[0] - ps[k][0], q[1] - ps[k][1]), 0);
  // Candidatos: salir por el borde cada 10°, avanzar hasta quedar libre de los demás círculos y luego ir a la etiqueta.
  let ps: number[][] = [[c.x + s0 * c.r, c.y], [codo, ym], [x, ym]];
  let mejor = [cruces(ps), largo(ps)];
  for (let g = 0; g < 360; g += 10) {
    const ux = Math.cos((g * Math.PI) / 180), uy = Math.sin((g * Math.PI) / 180);
    if (ux * s0 < -0.2) continue;
    let t = c.r + 6;
    while (t < c.r + 260 && otros.some((o) => Math.hypot(c.x + ux * t - o.x, c.y + uy * t - o.y) < o.r + 4)) t += 4;
    const cand = [[c.x + ux * c.r, c.y + uy * c.r], [c.x + ux * t, c.y + uy * t], [codo, ym], [x, ym]];
    const v = [cruces(cand), largo(cand)];
    if (v[0] < mejor[0] || (v[0] === mejor[0] && v[1] < mejor[1] - 0.5)) { ps = cand; mejor = v; }
  }
  return { ps, cruces: mejor[0] };
}

/**
 * Coloca las etiquetas de sector en dos canales laterales. Cada sector va al lado cuya guía cruza menos círculos (a
 * igualdad, el de su mitad); en cada lado, en el orden vertical de sus círculos y separadas para que no se pisen. La
 * guía sale por donde no hay otros sectores (se cuela entre círculos) y termina en un codo junto a la etiqueta.
 */
export function etiquetasLaterales(
  circulos: readonly { clave: string; x: number; y: number; r: number; lineas: string[]; completa: boolean }[],
  ancho: number, alto: number, canal: number,
): EtiquetaSector[] {
  const centro = ancho / 2, salida: EtiquetaSector[] = [];
  const xLado = (lado: 'izq' | 'der') => (lado === 'izq' ? canal - 10 : ancho - canal + 10);
  const lados = new Map(circulos.map((c) => {
    const otros = circulos.filter((o) => o.clave !== c.clave);
    const prueba = (lado: 'izq' | 'der') => mejorGuia(c, otros, lado === 'izq' ? xLado(lado) + 8 : xLado(lado) - 8, c.y, xLado(lado), lado === 'izq' ? -1 : 1).cruces;
    const propio: 'izq' | 'der' = c.x < centro ? 'izq' : 'der', otro: 'izq' | 'der' = propio === 'izq' ? 'der' : 'izq';
    return [c.clave, prueba(otro) < prueba(propio) ? otro : propio];
  }));
  for (const lado of ['izq', 'der'] as const) {
    const grupo = circulos.filter((c) => lados.get(c.clave) === lado).sort((a, b) => a.y - b.y);
    const cajas = grupo.map((c) => ({ c, alto: c.lineas.length * INTERLINEA, y: c.y - (c.lineas.length * INTERLINEA) / 2 }));
    // Separación: hacia abajo sin solaparse; si el último se sale, se empuja todo hacia arriba.
    for (let i = 1; i < cajas.length; i++) cajas[i].y = Math.max(cajas[i].y, cajas[i - 1].y + cajas[i - 1].alto + 8);
    const exceso = cajas.length ? cajas[cajas.length - 1].y + cajas[cajas.length - 1].alto - (alto - 4) : 0;
    if (exceso > 0) for (const k of cajas) k.y -= exceso;
    for (let i = cajas.length - 2; i >= 0; i--) cajas[i].y = Math.min(cajas[i].y, cajas[i + 1].y - cajas[i].alto - 8);
    for (const { c, alto: h, y } of cajas) {
      const x = xLado(lado), ym = y + h / 2, codo = lado === 'izq' ? x + 8 : x - 8;
      const { ps } = mejorGuia(c, circulos.filter((o) => o.clave !== c.clave), codo, ym, x, lado === 'izq' ? -1 : 1);
      salida.push({ clave: c.clave, lineas: c.lineas, completa: c.completa, lado, x, y, alto: h,
        guia: ps.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('') });
    }
  }
  return salida;
}

/** ¿El segmento p→q atraviesa el círculo o (distancia del segmento al centro menor que su radio)? */
export function cruzaCirculo(p: readonly number[], q: readonly number[], o: { x: number; y: number; r: number }): boolean {
  const vx = q[0] - p[0], vy = q[1] - p[1], l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((o.x - p[0]) * vx + (o.y - p[1]) * vy) / l2)) : 0;
  return Math.hypot(p[0] + t * vx - o.x, p[1] + t * vy - o.y) < o.r - 0.5;
}

/** Formas jurídicas y aclaraciones finales que no distinguen a una organización de otra. */
const FORMA_JURIDICA = /^(S\.?A\.?S\.?|S\.?A\.?|Ltda\.?|Ltd\.?|E\.?U\.?|S\.?C\.?A\.?|S\.?C\.?S\.?|\(.*\))$/i;

/**
 * Nombre corto para dibujar dentro de una burbuja pequeña: quita las palabras iniciales que comparten TODAS las hermanas
 * (si son 2 o más) y la forma jurídica final. Regla genérica: no hay nombres escritos a mano. El completo va al tooltip.
 */
export function nombreCorto(nombre: string, hermanos: readonly string[]): string {
  const p = nombre.split(/\s+/);
  let comun = 0;
  if (hermanos.length > 1) {
    const listas = hermanos.map((h) => h.split(/\s+/));
    while (comun < p.length - 1 && listas.every((l) => l[comun] === p[comun])) comun++;
  }
  const resto = p.slice(comun);
  while (resto.length > 1 && FORMA_JURIDICA.test(resto[resto.length - 1])) resto.pop();
  return resto.join(' ');
}

/**
 * Circle packing de dos niveles (sector → organización): el ÁREA de cada círculo es su número de estudiantes y el color,
 * su sector. Los nombres de sector NO se meten en las burbujas (taparían las organizaciones): van en canales laterales
 * unidos por una guía, en 1–2 líneas de palabras completas a 12 px; si no caben, se abrevian por palabra y el nombre
 * completo está siempre en el tooltip (hover/foco), la leyenda, la cabecera y la miga del sector elegido. Clic en un
 * sector (o su entrada de leyenda) hace zoom; clic en una organización aplica el filtro. En móvil: lista con indicador.
 */
@Component({
  selector: 'sipra-reportes-pack',
  standalone: true,
  imports: [ReportesTooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .gq-migas { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-height: 30px; margin: 0 0 6px; padding: 0; list-style: none; font-size: 13px; color: var(--text-secondary); }
    .gq-migas button { padding: 3px 10px; font: inherit; color: var(--text-primary); background: none; border: 1px solid var(--border-default); border-radius: 12px; cursor: pointer; }
    .gq-migas strong { color: var(--text-primary); font-weight: 650; }
    .gq-cab { margin: 0 0 10px; }
    .gq-cab span { display: block; font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .gq-cab b { display: block; font: 650 18px/24px var(--fuente); color: var(--text-primary); }
    .gq-cab small { font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .gq-migas button:focus-visible, .gq-hoja:focus-visible, .gq-grupo:focus-visible, .gq-ley button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    /* El lienzo recorta: al ampliar, nada se sale del gráfico (ni los sectores vecinos ni sus burbujas). */
    .gq svg { display: block; width: 100%; overflow: hidden; }
    .gq-zoom { transition: transform 520ms var(--gr-ease); }
    .gq-grupo { fill: color-mix(in srgb, var(--c) 9%, transparent); stroke: color-mix(in srgb, var(--c) 55%, transparent); stroke-width: 1.2; cursor: zoom-in; transition: fill 160ms ease, stroke-width 160ms ease; }
    .gq-grupo:hover, .gq-grupo.foco { fill: color-mix(in srgb, var(--c) 18%, transparent); stroke-width: 2.2; }
    .gq-hoja { fill: var(--c); fill-opacity: .82; stroke: var(--surface-raised); stroke-width: .8; cursor: pointer; transition: fill-opacity 160ms ease; }
    .gq-hoja:hover, .gq-hoja.elegida { fill-opacity: 1; }
    .gq-hoja.elegida { stroke: var(--text-primary); stroke-width: 2; }
    .gq.con-seleccion .gq-hoja:not(.elegida) { fill-opacity: .28; }
    .gq-guia { fill: none; stroke: color-mix(in srgb, var(--c) 70%, transparent); stroke-width: 1; }
    .gq-et { font: 600 ${FUENTE_SECTOR}px/1 var(--fuente); fill: var(--text-primary); cursor: pointer; }
    .gq-et.foco { fill: var(--c); }
    .gq-et-n { font: 500 11px/1 var(--fuente-mono); fill: var(--text-secondary); }
    .gq-t { font: 650 ${FUENTE_ORG}px/1 var(--fuente); fill: var(--text-primary); pointer-events: none; paint-order: stroke; stroke: var(--surface-raised); stroke-width: 3px; stroke-linejoin: round; }
    .gq-tn { font: 500 10px/1 var(--fuente-mono); fill: var(--text-secondary); pointer-events: none; }
    .gq-ley { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 16px; margin: 12px 0 0; padding: 0; list-style: none; }
    .gq-ley button { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; width: 100%; padding: 4px 6px; font: inherit; font-size: 12px; line-height: 16px;
      text-align: left; color: var(--text-primary); background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
    .gq-ley button:hover, .gq-ley button.foco { background: var(--gr-hover); }
    .gq-ley button[aria-pressed='true'] { border-color: color-mix(in srgb, var(--c) 70%, transparent); font-weight: 650; }
    .gq-ley i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); transform: translateY(1px); }
    .gq-ley small { font: 500 11px/16px var(--fuente-mono); color: var(--text-secondary); white-space: nowrap; }
    .gq-lista { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
    .gq-lista li { display: grid; gap: 4px; }
    .gq-lista .gq-fila { display: flex; justify-content: space-between; gap: 12px; }
    .gq-lista b { font-weight: 650; color: var(--text-primary); }
    .gq-lista .mini { height: 5px; border-radius: 3px; background: var(--c); }
    @media (width < 1100px) { .gq-ley { grid-template-columns: 1fr; } }
  `],
  template: `
    @if (movil()) {
      <ul class="gq-lista" [attr.aria-label]="titulo()">
        @for (g of grupos(); track g.clave) {
          <li [class]="'gt-' + g.tono" [attr.aria-label]="ariaGrupo(g)">
            <span class="gq-fila"><b>{{ g.texto }}</b><span class="ra-num">{{ num(g.n) }}</span></span>
            <span class="mini" aria-hidden="true" [style.width.%]="(g.n * 100) / (grupos()[0].n || 1)"></span>
            <span class="ra-tenue">{{ g.hojas.length }} organizaciones · {{ g.hojas.slice(0, 2).map(nombreN).join(' · ') }}</span>
          </li>
        }
      </ul>
    } @else {
      @if (grupoZoom(); as z) {
        <ol class="gq-migas" aria-label="Ubicación"><li><button type="button" (click)="zoom.set('')">Todos los sectores</button></li><li>›</li><li><strong>{{ z.texto }}</strong></li></ol>
        <div class="gq-cab" [class]="'gt-' + z.tono"><span>Sector</span><b>{{ z.texto }}</b><small>{{ z.hojas.length }} organizaciones · {{ num(z.n) }} estudiantes</small></div>
      } @else {
        <ol class="gq-migas" aria-label="Ubicación"><li><strong>Todos los sectores</strong></li><li class="ra-tenue">· clic en un sector para ver sus organizaciones; clic en una organización para filtrar</li></ol>
      }
      <div class="gr-marco gq" #marco [class.con-seleccion]="!!seleccion()">
        <svg [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto()" [attr.height]="alto()" role="group" [attr.aria-label]="titulo()">
          @if (!zoom()) {
            @for (e of etiquetas(); track e.clave) {
              <g [class]="'gt-' + tonoDe(e.clave)" aria-hidden="true">
                <path class="gq-guia" [attr.d]="e.guia" />
                <text class="gq-et" [class.foco]="foco() === e.clave" [attr.x]="e.x" [attr.y]="e.y + 12" [attr.text-anchor]="e.lado === 'izq' ? 'end' : 'start'"
                      (click)="zoom.set(e.clave)" (mousemove)="verGrupoClave($event, e.clave)" (mouseenter)="foco.set(e.clave)" (mouseleave)="foco.set(null); tip.set(null)">
                  @for (l of e.lineas; track $index) { <tspan [attr.x]="e.x" [attr.dy]="$first ? 0 : 15">{{ l }}</tspan> }
                </text>
              </g>
            }
          }
          <g class="gq-zoom" [style.transform]="transformacion()" [style.transform-origin]="'0 0'">
            @for (g of layout(); track g.clave) {
              <g [class]="'gt-' + g.tono" [attr.display]="zoom() && zoom() !== g.clave ? 'none' : null">
                <circle class="gq-grupo" [class.foco]="foco() === g.clave" [attr.cx]="g.x" [attr.cy]="g.y" [attr.r]="g.r" tabindex="0" role="button" [attr.aria-label]="ariaGrupo(g) + '. Enter para ver sus organizaciones'"
                        (click)="zoom.set(g.clave)" (keydown.enter)="zoom.set(g.clave)" (mousemove)="verGrupo($event, g)" (mouseenter)="foco.set(g.clave)" (mouseleave)="foco.set(null); tip.set(null)"
                        (focus)="verGrupo($event, g); foco.set(g.clave)" (blur)="foco.set(null); tip.set(null)" />
                @for (h of g.hojas; track h.clave) {
                  <circle class="gq-hoja" [class.elegida]="h.clave === seleccion()" [attr.cx]="h.x" [attr.cy]="h.y" [attr.r]="h.r" [attr.tabindex]="zoom() === g.clave ? 0 : -1" role="button"
                          [attr.aria-pressed]="h.clave === seleccion()" [attr.aria-label]="h.texto + ': ' + num(h.n) + ' estudiantes. ' + h.detalle.join('. ')"
                          (click)="elegirHoja($event, g.clave, h.clave)" (keydown.enter)="elegir.emit(h.clave)" (mousemove)="verHoja($event, g, h)" (mouseleave)="tip.set(null)"
                          (focus)="verHoja($event, g, h)" (blur)="tip.set(null)" />
                  @if (zoom() === g.clave) {
                    @if (etiquetaOrg(h.texto, h.r); as t) {
                      <text class="gq-t" [attr.x]="h.x" [attr.y]="h.y - ((t.length - 1) * 7.5 + 3) / escalaZoom()" text-anchor="middle" [style.font-size.px]="11 / escalaZoom()">
                        @for (l of t; track $index) { <tspan [attr.x]="h.x" [attr.dy]="$first ? 0 : 14 / escalaZoom()">{{ l }}</tspan> }
                      </text>
                      <text class="gq-tn" [attr.x]="h.x" [attr.y]="h.y + ((t.length - 1) * 7.5 + 13) / escalaZoom()" text-anchor="middle" [style.font-size.px]="10 / escalaZoom()">{{ h.n }}</text>
                    }
                  }
                }
              </g>
            }
          </g>
        </svg>
        <sipra-reportes-tooltip [tip]="tip()" />
      </div>
      <ul class="gq-ley" aria-label="Sectores (nombre completo); elegir uno amplía el gráfico">
        @for (g of grupos(); track g.clave) {
          <li [class]="'gt-' + g.tono"><button type="button" [class.foco]="foco() === g.clave" [attr.aria-pressed]="zoom() === g.clave" [attr.aria-label]="ariaGrupo(g)"
                      (click)="zoom.set(zoom() === g.clave ? '' : g.clave)" (mouseenter)="foco.set(g.clave)" (mouseleave)="foco.set(null)" (focus)="foco.set(g.clave)" (blur)="foco.set(null)">
            <i aria-hidden="true"></i><span>{{ g.texto }}</span><small>{{ num(g.n) }} · {{ g.hojas.length }} org.</small></button></li>
        }
      </ul>
    }
  `,
})
export class ReportesPackComponent {
  readonly titulo = input.required<string>();
  readonly hojas = input.required<HojaPack[]>();
  readonly textoGrupo = input<(v: string) => string>((v) => v);
  readonly seleccion = input('');
  readonly elegir = output<string>();

  private readonly marco = viewChild<ElementRef<HTMLElement>>('marco');
  protected readonly num = num;
  protected readonly movil = signal(false);
  protected readonly ancho = signal(760);
  protected readonly zoom = signal('');
  protected readonly foco = signal<string | null>(null);
  protected readonly tip = signal<TipGrafico | null>(null);
  protected readonly nombreN = (h: HojaPack): string => `${h.texto} (${h.n})`;
  private readonly total = computed(() => this.hojas().reduce((n, h) => n + h.n, 0));
  private readonly medirSector = medidorTexto('"Geist Variable", system-ui, sans-serif', FUENTE_SECTOR);
  private readonly medirOrg = medidorTexto('"Geist Variable", system-ui, sans-serif', FUENTE_ORG);

  /** Grupos por total (color categórico estable), con sus hojas por tamaño. */
  protected readonly grupos = computed(() => {
    const m = new Map<string, HojaPack[]>();
    for (const h of this.hojas()) { const g = m.get(h.grupo) ?? []; g.push(h); m.set(h.grupo, g); }
    return [...m.entries()].map(([clave, hs]) => ({ clave, texto: this.textoGrupo()(clave), n: hs.reduce((s, h) => s + h.n, 0), hojas: [...hs].sort((a, b) => b.n - a.n) }))
      .sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave)).map((g, i) => ({ ...g, tono: categorico(i) as TonoGrafico }));
  });
  /** Canal lateral para etiquetas: 30 % del ancho (150–250 px, ~38 caracteres por línea a 12 px); el círculo, al centro. */
  protected readonly canal = computed(() => Math.max(150, Math.min(250, this.ancho() * 0.3)));
  private readonly radio = computed(() => Math.max(80, Math.min(ALTO_MAX - 16, this.ancho() - 2 * this.canal() - 24) / 2));
  /** Alto = el círculo (o la pila de etiquetas más alta, si fuera mayor): sin vacíos arriba y abajo. */
  protected readonly alto = computed(() => {
    const pila = Math.max(...(['izq', 'der'] as const).map((lado) => this.layout().filter((g) => (lado === 'izq' ? g.x < this.ancho() / 2 : g.x >= this.ancho() / 2)).length)) * (2 * INTERLINEA + 8);
    return Math.round(Math.max(2 * this.radio() + 16, pila + 8));
  });
  /** Dos niveles de empaquetado: hojas dentro de cada grupo (área ∝ estudiantes) y grupos en el centro del lienzo. */
  protected readonly layout = computed(() => {
    const internos = this.grupos().map((g) => ({ g, p: empaquetar(g.hojas.map((h) => Math.sqrt(h.n)), 0.6) }));
    const externo = empaquetar(internos.map(({ p }) => p.R + 1.5), 3);
    const k = (this.radio() - 4) / externo.R, cx = this.ancho() / 2, cy = this.radio() + 8;
    return internos.map(({ g, p }, i) => {
      const c = externo.c[i];
      return { ...g, x: cx + c.x * k, y: cy + c.y * k, r: c.r * k,
        hojas: g.hojas.map((h, j) => ({ ...h, x: cx + (c.x + p.c[j].x) * k, y: cy + (c.y + p.c[j].y) * k, r: Math.max(1.5, p.c[j].r * k) })) };
    });
  });
  /** Etiquetas de sector: 1–2 líneas de palabras completas en el ancho del canal; sin «…» si caben. */
  protected readonly etiquetas = computed(() => etiquetasLaterales(this.layout().map((g) => {
    const e = envolverEtiqueta(g.texto, this.canal() - 18, this.medirSector, 2);
    return { clave: g.clave, x: g.x, y: g.y, r: g.r, lineas: e.lineas, completa: e.completa };
  }), this.ancho(), this.alto(), this.canal()));
  protected readonly grupoZoom = computed(() => this.layout().find((x) => x.clave === this.zoom()) ?? null);
  protected readonly escalaZoom = computed(() => { const g = this.grupoZoom(); return g ? (this.alto() / 2 - 8) / g.r : 1; });
  protected readonly transformacion = computed(() => {
    const g = this.grupoZoom();
    if (!g) return 'translate(0px, 0px) scale(1)';
    const s = this.escalaZoom();
    return `translate(${this.ancho() / 2 - g.x * s}px, ${this.alto() / 2 - g.y * s}px) scale(${s})`;
  });

  constructor() {
    const destruir = inject(DestroyRef);
    destruir.onDestroy(escucharMovil(this.movil));
    afterNextRender(() => {
      const el = this.marco()?.nativeElement;
      if (!el) return;
      this.ancho.set(Math.max(420, el.clientWidth));
      if (typeof ResizeObserver !== 'function') return;
      const ro = new ResizeObserver(([e]) => this.ancho.set(Math.max(420, Math.round(e.contentRect.width))));
      ro.observe(el);
      destruir.onDestroy(() => ro.disconnect());
    });
  }

  protected tonoDe(clave: string): TonoGrafico { return this.grupos().find((g) => g.clave === clave)?.tono ?? 'muted'; }
  protected ariaGrupo(g: { texto: string; n: number; hojas: unknown[] }): string { return `${g.texto}: ${num(g.n)} estudiantes, ${g.hojas.length} organizaciones`; }
  /** Nombre de organización dentro de su burbuja ampliada: solo si cabe COMPLETO en 1–2 líneas; si no, sin texto (tooltip). */
  protected etiquetaOrg(texto: string, r: number): string[] | null {
    const radioPx = r * this.escalaZoom();
    if (radioPx < 22) return null;
    const corto = this.cortos().get(texto) ?? texto;
    const e = envolverEtiqueta(corto, radioPx * 1.6, this.medirOrg, radioPx >= 40 ? 2 : 1);
    return e.completa ? e.lineas : null;
  }
  /** Nombre corto de cada organización del sector ampliado (lo común entre hermanas y la forma jurídica no distinguen). */
  protected readonly cortos = computed(() => {
    const g = this.grupoZoom();
    return new Map((g?.hojas ?? []).map((h) => [h.texto, nombreCorto(h.texto, g!.hojas.map((x) => x.texto))]));
  });
  protected elegirHoja(ev: Event, grupo: string, clave: string): void {
    ev.stopPropagation();
    if (this.zoom() !== grupo) { this.zoom.set(grupo); return; }
    this.elegir.emit(clave);
  }
  protected verGrupoClave(ev: MouseEvent, clave: string): void { const g = this.layout().find((x) => x.clave === clave); if (g) this.verGrupo(ev, g); }
  protected verGrupo(ev: Event, g: { texto: string; n: number; tono: TonoGrafico; hojas: unknown[] }): void {
    this.mostrar(ev, g.texto, [`${num(g.n)} estudiantes`, `${g.hojas.length} organizaciones`, `${pct1(g.n, this.total())} de los estudiantes en organizaciones externas`], 'Clic para explorar organizaciones', g.tono);
  }
  protected verHoja(ev: Event, g: { texto: string; tono: TonoGrafico }, h: HojaPack): void {
    this.mostrar(ev, h.texto, [`${num(h.n)} estudiantes`, `Sector: ${g.texto}`, ...h.detalle], this.zoom() ? (h.clave === this.seleccion() ? 'Clic para quitar el filtro' : 'Clic para filtrar') : 'Clic para explorar el sector', g.tono);
  }
  private mostrar(ev: Event, titulo: string, lineas: string[], pie: string, tono: TonoGrafico): void {
    const el = this.marco()?.nativeElement;
    if (!el) return;
    this.tip.set({ ...tipEn(el, ev, titulo, lineas, pie, tono) });
  }
}
