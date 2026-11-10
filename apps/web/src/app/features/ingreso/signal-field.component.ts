import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, inject, signal,
} from '@angular/core';
import { ALTO_VB, ANCHO_VB, DOC, RAIL, Reaccion, calcularReaccion, generarCampo } from './campo-senal';

/** Controles y texto sobre los que el campo NUNCA reacciona, aunque estén dentro de su capa. */
const SELECTOR_PROTEGIDO = '[data-zona-protegida], input, button, select, textarea, a, [role="menu"], [role="dialog"]';

/** Filas de contenido del documento: y local y ancho de la barra (medidas del frame: 80 + 38·i; 70 + (37·i mod 60)). */
const FILAS = [0, 1, 2, 3, 4].map((i) => ({ y: 80 + i * 38, w: 70 + ((i * 37) % 60) }));

/**
 * «Signal Field»: curvas de señal que convergen en una hoja de cristal y salen como un rail de cinco nodos.
 * Reproduce el frame aprobado (F5/F6, 1440 × 1024): se compone en un lienzo de 1440 × 1024 que se escala
 * como `xMinYMid slice` (ancla a la izquierda, centrado en vertical). Solo CSS + SVG; se mueve únicamente
 * con `transform` y `opacity`.
 *
 * Rendimiento: ~90 partículas y 34 curvas con UNA animación CSS cada una (periodos y fases distintos), un
 * cometa y un único listener `pointermove` que solo guarda la posición y pide UN fotograma (rAF).
 *
 * Es decorativo: `aria-hidden`, sin foco. Con `prefers-reduced-motion: reduce` queda estático (que es,
 * además, el estado exacto del frame) y no registra el listener del puntero.
 */
@Component({
  selector: 'sipra-signal-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.estatico]': 'estatico()',
    '[class.pausado]': 'pausado()',
  },
  styles: [`
    :host { position: absolute; inset: 0; display: block; overflow: hidden; z-index: var(--sf-z, 0); pointer-events: auto; contain: layout paint; }
    .lienzo { position: absolute; left: 0; top: 0; width: 1440px; height: 1024px; transform-origin: 0 0; transform: translate(0, var(--oy, 0px)) scale(var(--k, 1)); }
    svg.trazos { position: absolute; left: 0; top: 0; width: 1440px; height: 1024px; display: block; overflow: visible; }

    /* Paleta del campo por tema (Figma: teal #0E7C86 · cian #0593C6 en claro; #3FD6C0 · #35B6E8 · #8FE3F2 en oscuro). */
    :host {
      --c-a1: #3fd6c0; --c-a2: #35b6e8; --c-hot: #8fe3f2; --c-vacio: #0f1c1f;
      --h-a: rgb(234 244 247 / .14); --h-b: rgb(234 244 247 / .05);
      --h-borde-a: rgb(255 255 255 / .55); --h-borde-b: rgb(143 227 242 / .35);
      --h-sombra: 0 0 40px rgb(143 227 242 / .25); --h-titulo-a: .65; --h-barra-a: .5;
      --tinta: 234 245 244; --tinta-sec: 169 191 189; --h-linea: 159 233 224; --h-fila: .06;
      --h-resalte: 143 227 242; --h-resalte-borde: 143 227 242; --h-visto: #3fd6c0; --h-resalte-a: .3; --h-halo: rgb(143 227 242 / .16); --h-halo-sombra: rgb(143 227 242 / .25); --rail-visto: #04201c;
    }
    :host-context([data-theme="light"]) {
      --c-a1: #0e7c86; --c-a2: #0593c6; --c-hot: #0593c6; --c-vacio: #ffffff;
      --h-a: rgb(255 255 255 / .9); --h-b: rgb(255 255 255 / .6);
      --h-borde-a: rgb(255 255 255 / .9); --h-borde-b: rgb(5 147 198 / .35);
      --h-sombra: 0 30px 50px -6px rgb(11 42 58 / .22); --h-titulo-a: .7; --h-barra-a: .45;
      --tinta: 7 25 35; --tinta-sec: 52 80 94; --h-linea: 7 25 35; --h-fila: .05;
      --h-resalte: 5 147 198; --h-resalte-borde: 5 147 198; --h-visto: #0e7c86; --h-resalte-a: .62; --h-halo: transparent; --h-halo-sombra: transparent; --rail-visto: #ffffff;
    }
    .s-a1 { stop-color: var(--c-a1); } .s-a2 { stop-color: var(--c-a2); } .s-hot { stop-color: var(--c-hot); }

    /* Curvas: degradado transparente → teal/cian (.30 / .85 las calientes) → luz fría; aparecen y desaparecen con opacidad lenta. */
    .curva { fill: none; stroke-linecap: round; opacity: var(--om); animation: curva var(--d) ease-in-out var(--r) infinite alternate; }
    .curva.caliente { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--c-a2) 55%, transparent)); }
    @keyframes curva { from { opacity: calc(var(--om) * .6); } to { opacity: var(--om); } }

    /* Partículas: el <g> externo recibe la reacción del puntero; el círculo, la deriva propia. */
    .nodo { transform: translate(var(--rx, 0px), var(--ry, 0px)); transition: transform 320ms var(--ease-out); }
    .nodo circle { fill: var(--c-hot); stroke: var(--c-a1); stroke-opacity: var(--bri, 0); stroke-width: 4; opacity: var(--o);
      animation: vida var(--d) ease-in-out var(--r) infinite alternate; }
    @keyframes vida {
      from { transform: translate(calc(var(--dx) * -1), calc(var(--dy) * -1)); opacity: calc(var(--o) * .6); }
      50%  { opacity: var(--o); }
      to   { transform: translate(var(--dx), var(--dy)); opacity: calc(var(--o) * .8); }
    }
    .conexion { stroke: var(--c-hot); stroke-width: 1; opacity: 0; transition: opacity 260ms linear; }
    .bloom { transform: translate(calc(var(--px, 0) * 6px), calc(var(--py, 0) * 4px)); transition: transform 900ms var(--ease-out); }

    /* Rail de salida (Figma: línea de 2 px #0593C6 .9 → #0E7C86 .15 con halo; nodos de 16 px; aprobados rellenos, pendientes con centro vacío). */
    .rail-linea { fill: none; stroke: url(#grad-rail); stroke-width: 2; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--c-hot) 50%, transparent)); }
    .rail-ok { fill: var(--c-a1); stroke: var(--c-a1); stroke-width: 1.5; }
    .rail-ok.activo { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--c-a1) 70%, transparent)); }
    .rail-pend { fill: var(--c-vacio); stroke: var(--c-a2); stroke-width: 1.5; }
    .rail-visto { fill: none; stroke: var(--rail-visto); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
    .cometa { animation: cometa 7s var(--ease-in-out) infinite; }
    .cometa rect { fill: url(#cola-cometa); }
    @keyframes cometa {
      0%   { transform: translateX(0); opacity: 0; }
      12%  { opacity: .9; }
      85%  { opacity: .9; }
      100% { transform: translateX(300px); opacity: 0; }
    }

    /* Hoja de cristal (HTML para poder usar la sombra exacta del frame: 0 30 50 −6). Esquina superior izquierda en (430, 330), girada 7° horario. */
    .hoja {
      position: absolute; left: 430px; top: 330px; width: 250px; height: 330px; transform-origin: 0 0; transform: rotate(7deg);
      border-radius: 4px; box-shadow: var(--h-sombra);
      background: linear-gradient(127.1deg, var(--h-a) 0%, var(--h-b) 71.4%);
    }
    .hoja::before {
      content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
      background: linear-gradient(127.1deg, var(--h-borde-a) 0%, var(--h-borde-b) 71.4%);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
      mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
    }
    /* Halo del frame (DROP_SHADOW #8FE3F2 .25, blur 40): en Figma también se ve bajo el cristal translúcido; CSS no pinta box-shadow bajo el propio elemento, así que va en una capa trasera. */
    .hoja::after { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: var(--h-halo); box-shadow: 0 0 40px var(--h-halo-sombra); }
    .hoja i { position: absolute; display: block; border-radius: 2px; }
    .h-titulo { left: 20px; top: 22px; width: 120px; height: 10px; background: rgb(var(--tinta) / var(--h-titulo-a)); }
    .h-sub { left: 20px; top: 40px; width: 80px; height: 6px; background: rgb(var(--tinta-sec) / .4); }
    .h-fila { left: 20px; width: 210px; height: 26px; background: rgb(var(--tinta) / var(--h-fila)); border: 1px solid rgb(var(--h-linea) / .18); box-sizing: border-box; }
    .h-barra { left: 28px; height: 6px; background: rgb(var(--tinta) / var(--h-barra-a)); }
    .h-resalte { left: 18px; top: 154px; width: 214px; height: 30px; background: rgb(var(--h-resalte) / var(--h-resalte-a, .5)); border: 1px solid rgb(var(--h-resalte-borde) / .9); box-sizing: border-box; box-shadow: 0 0 10px rgb(var(--h-resalte-borde) / .5); }
    .h-visto { position: absolute; left: 200px; top: 282px; width: 22px; height: 22px; fill: none; stroke: var(--h-visto); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }

    /* Estado estático: reduced-motion o preferencia de la persona. Todo queda legible y quieto. */
    :host(.estatico) .curva, :host(.estatico) .nodo circle, :host(.estatico) .cometa { animation: none; }
    :host(.estatico) .cometa { display: none; }
    :host(.estatico) .nodo, :host(.estatico) .bloom, :host(.estatico) .conexion { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      .curva, .nodo circle, .cometa { animation: none; }
      .cometa { display: none; }
      .nodo, .bloom, .conexion { transition: none; }
    }
    /* Pestaña oculta: se congela todo. */
    :host(.pausado) .curva, :host(.pausado) .nodo circle, :host(.pausado) .cometa { animation-play-state: paused; }
  `],
  template: `
    <div class="lienzo">
      <svg class="trazos" [attr.viewBox]="'0 0 ' + ancho + ' ' + alto" focusable="false">
        <defs>
          <linearGradient id="gc-a1" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" class="s-a1" stop-opacity="0" /><stop offset=".45" class="s-a1" stop-opacity=".3" /><stop offset="1" class="s-hot" stop-opacity=".55" />
          </linearGradient>
          <linearGradient id="gc-a2" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" class="s-a1" stop-opacity="0" /><stop offset=".45" class="s-a2" stop-opacity=".3" /><stop offset="1" class="s-hot" stop-opacity=".55" />
          </linearGradient>
          <linearGradient id="gh-a1" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" class="s-a1" stop-opacity="0" /><stop offset=".45" class="s-a1" stop-opacity=".85" /><stop offset="1" class="s-hot" stop-opacity="1" />
          </linearGradient>
          <linearGradient id="gh-a2" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" class="s-a1" stop-opacity="0" /><stop offset=".45" class="s-a2" stop-opacity=".85" /><stop offset="1" class="s-hot" stop-opacity="1" />
          </linearGradient>
          <linearGradient id="grad-rail" gradientUnits="userSpaceOnUse" x1="560" x2="930" y1="0" y2="0">
            <stop offset="0" class="s-hot" stop-opacity=".9" /><stop offset="1" class="s-a1" stop-opacity=".15" />
          </linearGradient>
          <linearGradient id="cola-cometa" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" class="s-a1" stop-opacity="0" /><stop offset="1" class="s-hot" stop-opacity=".95" />
          </linearGradient>
        </defs>

        <g class="bloom"><g>
          @for (c of campo.curvas; track c.id) {
            <path class="curva" [attr.d]="c.d" [attr.stroke-width]="c.ancho"
                  [attr.stroke]="'url(#' + (c.caliente ? 'gh' : 'gc') + (c.cian ? '-a2' : '-a1') + ')'"
                  [class.caliente]="c.caliente"
                  [style.--om]="c.opacidad" [style.--d]="c.dur + 's'" [style.--r]="c.retraso + 's'" />
          }
        </g></g>

        <g>
          @for (n of campo.nodos; track n.id) {
            <g class="nodo">
              <circle [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="n.r"
                      [style.--o]="n.opacidad" [style.--d]="n.dur + 's'" [style.--r]="n.retraso + 's'"
                      [style.--dx]="n.dx + 'px'" [style.--dy]="n.dy + 'px'" />
            </g>
          }
          @for (i of conexiones; track i) { <line class="conexion" /> }
        </g>

        <g class="rail">
          <path class="rail-linea" [attr.d]="'M' + rail.x0 + ' ' + rail.y + 'L' + rail.x1 + ' ' + rail.y" />
          <g class="cometa"><rect [attr.x]="rail.x0" [attr.y]="rail.y - 1.5" width="60" height="3" rx="1.5" /></g>
          @for (n of rail.nodos; track n.x; let i = $index) {
            @if (n.aprobado) {
              <circle class="rail-ok" [class.activo]="i === 2" [attr.cx]="n.x" [attr.cy]="rail.y" [attr.r]="rail.radio" />
              <path class="rail-visto" [attr.d]="'M' + (n.x - 3.5) + ' ' + (rail.y + 0.5) + 'l2.5 2.6l4.5 -5.2'" />
            } @else {
              <circle class="rail-pend" [attr.cx]="n.x" [attr.cy]="rail.y" [attr.r]="rail.radio" />
            }
          }
        </g>
      </svg>

      <div class="hoja">
        <i class="h-titulo"></i><i class="h-sub"></i>
        @for (f of filas; track f.y) {
          <i class="h-fila" [style.top.px]="f.y"></i>
          <i class="h-barra" [style.top.px]="f.y + 10" [style.width.px]="f.w"></i>
        }
        <i class="h-resalte"></i>
        <svg class="h-visto" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
      </div>
    </div>
  `,
})
export class SignalFieldComponent implements AfterViewInit, OnDestroy {
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zona = inject(NgZone);

  protected readonly ancho = ANCHO_VB;
  protected readonly alto = ALTO_VB;
  protected readonly doc = DOC;
  protected readonly rail = RAIL;
  protected readonly campo = generarCampo();
  protected readonly conexiones = [0, 1, 2];
  protected readonly filas = FILAS;

  readonly estatico = signal(false);
  readonly pausado = signal(false);

  private svg!: SVGSVGElement;
  private lienzo!: HTMLElement;
  private nodosEl: SVGGElement[] = [];
  private lineasEl: SVGLineElement[] = [];
  private bloomEl: SVGGElement | null = null;
  private railEl: SVGGElement | null = null;
  private mq: MediaQueryList | null = null;
  private observador: ResizeObserver | null = null;
  private fotograma = 0;
  private puntero: { x: number; y: number } | null = null;
  private protegido = false;
  private activos = new Set<number>();
  private escuchando = false;

  private readonly alMover = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const destino = e.target as Element | null;
    this.protegido = !!destino?.closest?.(SELECTOR_PROTEGIDO);
    this.puntero = { x: e.clientX, y: e.clientY };
    this.pedirFotograma();
  };
  private readonly alSalir = (): void => {
    this.puntero = null;
    this.pedirFotograma();
  };
  private readonly alCambiarVisibilidad = (): void => {
    const oculto = document.hidden;
    this.pausado.set(oculto);
    if (oculto) this.cancelarFotograma();
  };
  private readonly alCambiarMovimiento = (): void => this.aplicarMovimiento();

  ngAfterViewInit(): void {
    const el = this.raiz.nativeElement;
    this.svg = el.querySelector('svg.trazos') as SVGSVGElement;
    this.lienzo = el.querySelector('.lienzo') as HTMLElement;
    this.nodosEl = Array.from(el.querySelectorAll<SVGGElement>('.nodo'));
    this.lineasEl = Array.from(el.querySelectorAll<SVGLineElement>('.conexion'));
    this.bloomEl = el.querySelector<SVGGElement>('.bloom');
    this.railEl = el.querySelector<SVGGElement>('.rail');
    this.mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.mq?.addEventListener('change', this.alCambiarMovimiento);
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad);
    this.pausado.set(document.hidden);
    this.ajustarEscala();
    if (typeof ResizeObserver !== 'undefined') {
      this.observador = new ResizeObserver(() => this.ajustarEscala());
      this.observador.observe(el);
    }
    this.aplicarMovimiento();
  }

  ngOnDestroy(): void {
    this.mq?.removeEventListener('change', this.alCambiarMovimiento);
    document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);
    this.observador?.disconnect();
    this.escuchar(false);
    this.cancelarFotograma();
  }

  /** Rectángulo del rail en pantalla (origen de la transición al entrar). */
  rectRail(): DOMRect | null {
    return this.railEl?.getBoundingClientRect() ?? null;
  }

  /** `xMinYMid slice`: el lienzo de 1440 × 1024 cubre el contenedor, anclado a la izquierda y centrado en vertical. */
  private ajustarEscala(): void {
    const r = this.raiz.nativeElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.max(r.width / ANCHO_VB, r.height / ALTO_VB);
    this.lienzo.style.setProperty('--k', k.toFixed(4));
    this.lienzo.style.setProperty('--oy', `${((r.height - ALTO_VB * k) / 2).toFixed(1)}px`);
  }

  private aplicarMovimiento(): void {
    const reducido = this.mq?.matches ?? false;
    this.estatico.set(reducido);
    this.escuchar(!reducido);
    if (reducido) { this.cancelarFotograma(); this.limpiar(); }
  }

  private escuchar(activar: boolean): void {
    if (activar === this.escuchando) return;
    this.escuchando = activar;
    const el = this.raiz.nativeElement;
    this.zona.runOutsideAngular(() => {
      if (activar) {
        el.addEventListener('pointermove', this.alMover, { passive: true });
        el.addEventListener('pointerleave', this.alSalir, { passive: true });
      } else {
        el.removeEventListener('pointermove', this.alMover);
        el.removeEventListener('pointerleave', this.alSalir);
      }
    });
  }

  private pedirFotograma(): void {
    if (this.fotograma || document.hidden) return;
    this.fotograma = requestAnimationFrame(() => { this.fotograma = 0; this.pintar(); });
  }

  private cancelarFotograma(): void {
    if (this.fotograma) cancelAnimationFrame(this.fotograma);
    this.fotograma = 0;
  }

  /** Un fotograma: mapea el puntero al viewBox, calcula la reacción y toca solo lo que cambió. */
  private pintar(): void {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return;
    let reaccion: Reaccion = { nodos: [], conexiones: [] };
    if (this.puntero && !this.protegido) {
      const p = new DOMPoint(this.puntero.x, this.puntero.y).matrixTransform(ctm.inverse());
      const escala = ctm.a || 1;
      reaccion = calcularReaccion(this.campo.nodos, p, {
        radio: 170 / escala, maxDesplazamiento: 4 / escala, maxConexiones: 3, zonaProtegida: false,
      });
    }
    const ahora = new Set<number>();
    for (const r of reaccion.nodos) {
      ahora.add(r.indice);
      const g = this.nodosEl[r.indice];
      g.style.setProperty('--rx', `${r.dx.toFixed(2)}px`);
      g.style.setProperty('--ry', `${r.dy.toFixed(2)}px`);
      g.style.setProperty('--bri', (r.brillo * 0.9).toFixed(2));
    }
    for (const i of this.activos) {
      if (ahora.has(i)) continue;
      const g = this.nodosEl[i];
      g.style.removeProperty('--rx'); g.style.removeProperty('--ry'); g.style.removeProperty('--bri');
    }
    this.activos = ahora;

    this.lineasEl.forEach((linea, k) => {
      const par = reaccion.conexiones[k];
      if (!par) { linea.style.opacity = '0'; return; }
      const a = this.campo.nodos[par[0]]; const b = this.campo.nodos[par[1]];
      linea.setAttribute('x1', String(a.x)); linea.setAttribute('y1', String(a.y));
      linea.setAttribute('x2', String(b.x)); linea.setAttribute('y2', String(b.y));
      linea.style.opacity = '0.4';
    });

    if (this.bloomEl && this.puntero && !this.protegido) {
      const nx = (this.puntero.x / window.innerWidth - 0.5) * 2;
      const ny = (this.puntero.y / window.innerHeight - 0.5) * 2;
      this.bloomEl.style.setProperty('--px', nx.toFixed(3));
      this.bloomEl.style.setProperty('--py', ny.toFixed(3));
    }
  }

  private limpiar(): void {
    this.puntero = null;
    this.pintar();
    this.bloomEl?.style.removeProperty('--px');
    this.bloomEl?.style.removeProperty('--py');
  }
}
