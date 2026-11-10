import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { DocumentoDeExpediente } from '@core/models/validacion-documental.model';
import {
  ClaveSenal, ICONO_SENAL, animacionNodo, cambioAAprobado, construirRail, duracionTransicion, fraccionFlujo, indiceActivo, indiceConTecla, modoRail,
} from './vd.senal';
import { textoReservaDocumento } from './vd.util';

/** Ancho de la celda de cada nodo (px) en escritorio y en móvil: el indicador y el flujo se posicionan con `calc()` y `transform`, sin medir el DOM. */
const ANCHO_NODO = 128;
const ANCHO_NODO_MOVIL = 88;

/**
 * Document Signal rail: un nodo REAL por documento del expediente, unidos por una línea de 3 px. Presentacional: no decide nada; recibe
 * los documentos y emite el tipo elegido. Solo el nodo activo respira (un único elemento animado); con `prefers-reduced-motion`
 * todo queda estático. El indicador luminoso viaja al nodo nuevo con `transform` (250–350 ms) a partir de `--i`, sin mediciones.
 * Con más de ~8 documentos la franja desborda con degradado en los bordes y botones de desplazamiento.
 */
@Component({
  selector: 'sipra-vd-signal-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; min-width:0; --w:${ANCHO_NODO}px; --nodo:28px; }
    @media (width < 900px) { :host { --w:${ANCHO_NODO_MOVIL}px; --nodo:24px; } }
    .rail { position:relative; display:flex; align-items:stretch; min-width:0; margin-top:-14px; }
    .franja { flex:1 1 auto; min-width:0; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; overscroll-behavior-x:contain; padding-block:40px 0; }
    .franja::-webkit-scrollbar { display:none; }
    .rail[data-izq='1'] .franja { -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 40px); mask-image:linear-gradient(90deg, transparent 0, #000 40px); }
    .rail[data-der='1'] .franja { -webkit-mask-image:linear-gradient(90deg, #000 calc(100% - 40px), transparent); mask-image:linear-gradient(90deg, #000 calc(100% - 40px), transparent); }
    .rail[data-izq='1'][data-der='1'] .franja { -webkit-mask-image:linear-gradient(90deg, transparent 0, #000 40px, #000 calc(100% - 40px), transparent); mask-image:linear-gradient(90deg, transparent 0, #000 40px, #000 calc(100% - 40px), transparent); }
    .pista { position:relative; width:calc(var(--n) * var(--w)); }

    /* La línea: base, flujo (del primer nodo al activo, teal → color del estado) y cometa corto en la cabeza del flujo. */
    .linea, .flujo, .cometa, .indicador { position:absolute; pointer-events:none; }
    .linea { left:calc(var(--w) / 2); width:calc((var(--n) - 1) * var(--w)); top:calc(var(--nodo) / 2 - 1.5px); height:3px; border-radius:2px; background:var(--vd-linea); }
    .flujo { left:calc(var(--w) / 2); width:calc((var(--n) - 1) * var(--w)); top:calc(var(--nodo) / 2 - 1.5px); height:3px; border-radius:2px; transform-origin:left center;
      transform:scaleX(var(--k)); background:linear-gradient(90deg, var(--status-success), var(--c-act)); box-shadow:0 0 6px color-mix(in srgb, var(--status-success) 45%, transparent); transition:transform 220ms var(--ease-out); overflow:hidden; }
    .flujo::after { content:""; position:absolute; inset:0; background:linear-gradient(90deg, transparent, rgb(255 255 255 / .85), transparent); transform:translateX(-110%); }
    .rail.barrido .flujo::after { animation:vd-barrido 350ms var(--ease-out) 1; }
    .cometa { left:0; top:calc(var(--nodo) / 2 - 1.5px); width:58px; height:3px; border-radius:2px; opacity:.9;
      background:linear-gradient(90deg, transparent, #fff); transform:translateX(calc(var(--i) * var(--w) + var(--w) / 2 - 62px)); transition:transform 220ms var(--ease-out); }
    :host-context([data-theme='light']) .cometa { opacity:0; }
    .indicador { left:0; bottom:0; width:36px; height:2px; border-radius:1px; background:var(--c-act); box-shadow:0 0 8px color-mix(in srgb, var(--c-act) 80%, transparent);
      transform:translateX(calc(var(--i) * var(--w) + var(--w) / 2 - 18px)); transition:transform 220ms var(--ease-out); }
    @media (width < 900px) { .indicador { width:24px; transform:translateX(calc(var(--i) * var(--w) + var(--w) / 2 - 12px)); } }

    .nodos { list-style:none; margin:0; padding:0; display:flex; position:relative; }
    .nodos > li { flex:0 0 var(--w); width:var(--w); display:flex; }
    .nodo-btn { position:relative; display:grid; justify-items:center; align-content:start; gap:0; width:100%; padding:0 8px 8px; background:transparent; border:0; border-radius:8px; color:var(--text-primary);
      font:inherit; text-align:center; cursor:pointer; transition:transform 160ms var(--ease-out); }
    .nodo-btn:hover { transform:translateY(-1px); }
    .nodo-btn:hover .nombre { color:var(--text-primary); }
    .nodo-btn:focus-visible { outline:3px solid var(--foco); outline-offset:-2px; }

    .nodo { position:relative; width:var(--nodo); height:var(--nodo); margin-top:0; border-radius:50%; display:grid; place-items:center; z-index:1;
      color:var(--c); background:color-mix(in srgb, var(--c) 20%, var(--vd-nodo-vacio)); border:1.5px solid var(--c);
      transition:background-color var(--t, 220ms) var(--ease-out), border-color var(--t, 220ms) var(--ease-out), color var(--t, 220ms) var(--ease-out), transform var(--motion-default) var(--ease-out); }
    .nodo svg { width:60%; height:60%; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
    .nodo svg[data-ico='disponible'] path, .nodo svg[data-ico='procesando'] path { stroke-width:5; }
    .activo .nodo { transform:scale(1.2857); }
    @media (width < 900px) { .activo .nodo { transform:scale(1.15); } }
    [data-clave='aprobado'] .nodo { background:var(--c); color:var(--text-inverse); }
    [data-clave='pendiente'] .nodo { background:var(--vd-nodo-vacio); border-color:var(--text-muted); color:var(--text-muted); }
    .activo .nodo-btn::before { content:""; position:absolute; left:calc(50% - 52px); top:-38px; width:104px; height:104px; border-radius:50%; pointer-events:none;
      background:radial-gradient(closest-side, color-mix(in srgb, var(--c) 45%, transparent), color-mix(in srgb, var(--c) 16%, transparent) 55%, transparent); }
    .activo[data-glow='1'] .nodo { box-shadow:0 0 14px 1px color-mix(in srgb, var(--c) 35%, transparent); }
    .candado { position:absolute; right:-6px; top:-6px; width:14px; height:14px; padding:2px; border-radius:50%; background:var(--surface-raised-2); color:var(--signal-default); border:1px solid var(--border-default); z-index:2; }
    .candado svg { width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:2.6; stroke-linecap:round; stroke-linejoin:round; }

    /* Halo del nodo activo (un solo pseudo-elemento animado a la vez): opacity + scale, nunca parpadeo. */
    .nodo::after { content:""; position:absolute; inset:-6px; border-radius:50%; border:2px solid var(--c); opacity:0; pointer-events:none; }
    .activo[data-anim='pulso-lento'] .nodo::after { animation:vd-pulso var(--c-pulso-duracion) ease-in-out infinite; }
    .activo[data-anim='pulso-unico'] .nodo::after { animation:vd-pulso-unico 2s ease-out 1 forwards; }
    .activo[data-anim='vivo-sutil'] .nodo::after { animation:vd-vivo 2.4s ease-in-out infinite; }
    .activo[data-anim='barrido-unico'] .nodo::after { opacity:.3; }
    .activo[data-anim='ninguna'] .nodo::after { opacity:.28; }
    .barriendo .nodo::after { animation:vd-expande 350ms var(--ease-out) 1 forwards !important; }
    @keyframes vd-pulso { 0%, 100% { opacity:.35; transform:scale(1); } 50% { opacity:.6; transform:scale(1.04); } }
    @keyframes vd-pulso-unico { 0% { opacity:.3; transform:scale(1); } 35% { opacity:.65; transform:scale(1.04); } 100% { opacity:.25; transform:scale(1); } }
    @keyframes vd-vivo { 0%, 100% { opacity:.18; } 50% { opacity:.34; } }
    @keyframes vd-expande { 0% { opacity:.6; transform:scale(1); } 100% { opacity:0; transform:scale(1.5); } }
    @keyframes vd-barrido { from { transform:translateX(-110%); } to { transform:translateX(110%); } }

    .nombre { margin-top:12px; font-size:var(--fs-sm); font-weight:500; line-height:18px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
    
    .activo .nombre { font-weight:600; }
    .est { display:inline-flex; gap:4px; align-items:center; justify-content:center; margin-top:2px; font-size:var(--fs-meta); line-height:16px; color:var(--ct); font-weight:500; }
    .est svg { display:none; width:12px; height:12px; flex:none; fill:none; stroke:currentColor; stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round; }
    .est svg[data-ico='disponible'] path, .est svg[data-ico='procesando'] path { stroke-width:5; }
    .est span { display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; text-align:left; }
    .meta { margin-top:2px; font-family:var(--fuente-mono); font-size:var(--fs-meta); font-weight:500; color:var(--text-muted); line-height:16px; }
    .meta .adic { font-family:var(--fuente); }
    .meta.res { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .reenvio { color:inherit; }
    .desc { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }

    .flecha { position:absolute; z-index:3; top:26px; width:28px; height:28px; display:grid; place-items:center; padding:0; border-radius:50%; background:var(--vd-pildora); color:var(--text-primary); border:1px solid var(--vd-pildora-borde); cursor:pointer; }
    .flecha:first-child { left:0; } .flecha:last-child { right:0; }
    @media (pointer:coarse) { .flecha { width:44px; height:44px; top:18px; } }
    .flecha:hover:not(:disabled) { border-color:var(--signal-default); } .flecha:disabled { opacity:.4; cursor:default; }
    .flecha svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
    .rail:not([data-desborda='1']) .flecha { display:none; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation:none !important; transition:none !important; }
      .activo[data-anim='pulso-lento'] .nodo::after, .activo[data-anim='pulso-unico'] .nodo::after, .activo[data-anim='vivo-sutil'] .nodo::after { opacity:.3; }
    }
  `],
  template: `
    @let ns = nodos();
    <div class="rail" [class.barrido]="!!barriendo()" [attr.data-modo]="modo()" [attr.data-izq]="puedeIzq() ? 1 : 0" [attr.data-der]="puedeDer() ? 1 : 0"
         [attr.data-desborda]="desborda() ? 1 : 0" [style.--n]="ns.length" [style.--i]="indice()" [style.--k]="fraccion()" [style.--c-act]="colorActivo()">
      <button type="button" class="flecha" aria-label="Documentos anteriores" [disabled]="!puedeIzq()" (click)="desplazar(-1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <div class="franja" #franja (scroll)="alDesplazar()">
        <div class="pista">
          <span class="linea" aria-hidden="true"></span>
          <span class="flujo" aria-hidden="true"></span>
          <span class="cometa" aria-hidden="true"></span>
          <span class="indicador" aria-hidden="true"></span>
          <ol class="nodos" aria-label="Documentos del expediente">
            @for (n of ns; track n.tipo) {
              <li [class.activo]="n.activo" [class.barriendo]="barriendo() === n.tipo" [attr.data-clave]="n.senal.clave" [attr.data-anim]="anim(n)" [attr.data-glow]="n.senal.glow ? 1 : 0"
                  [style.--c]="'var(' + n.senal.token + ')'" [style.--ct]="'var(' + n.senal.tokenTexto + ')'" [style.--t]="ms(n.senal.clave) + 'ms'">
                <button type="button" class="nodo-btn" data-vd-doc [attr.data-tipo]="n.tipo" [attr.data-indice]="n.indice" [attr.aria-current]="n.activo" [tabindex]="n.activo ? 0 : -1" (click)="elegir.emit(n.tipo)" (keydown)="alTeclear($event)">
                  <span class="nodo">
                    <svg viewBox="0 0 24 24" aria-hidden="true" [attr.data-ico]="n.senal.icono"><path [attr.d]="iconos[n.senal.icono]" /></svg>
                    @if (n.candado) { <span class="candado" aria-hidden="true"><svg viewBox="0 0 24 24"><path [attr.d]="iconos.reservado" /></svg></span> }
                  </span>
                  <span class="nombre">{{ n.nombre }}</span>
                  <span class="est"><svg viewBox="0 0 24 24" aria-hidden="true" [attr.data-ico]="n.senal.icono"><path [attr.d]="iconos[n.senal.icono]" /></svg><span>{{ n.etiquetaEstado }}</span></span>
                  @if (n.version || n.reenvio || n.adicional) {
                    <span class="meta">@if (n.version) { v{{ n.version }} }@if (n.reenvio) { <span class="reenvio"> · reenvío</span> }@if (n.adicional) { <span class="adic"> · adicional</span> }</span>
                  }
                  @if (n.reservaCorta) { <span class="meta res" aria-hidden="true">{{ n.reservaCorta }}</span> }
                  <span class="desc">@if (n.version) { En versión {{ n.version }}@if (n.reenvio) { (reenvío) }. }@if (n.reservaTexto) { {{ n.reservaTexto }}. }@if (n.problema) { {{ n.problema }} }</span>
                </button>
              </li>
            }
          </ol>
        </div>
      </div>
      <button type="button" class="flecha" aria-label="Documentos siguientes" [disabled]="!puedeDer()" (click)="desplazar(1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  `,
})
export class VdSignalRailComponent {
  readonly documentos = input.required<readonly DocumentoDeExpediente[]>();
  readonly activo = input<string | null>(null);
  /** Identidad del expediente: al cambiarla no se dispara el barrido de «aprobado» (no es una decisión, es otro paquete). */
  readonly expediente = input<string | null>(null);
  readonly elegir = output<string>();

  protected readonly iconos = ICONO_SENAL;
  protected readonly ms = duracionTransicion;
  protected readonly nodos = computed(() => construirRail(this.documentos(), this.activo(), (r) => textoReservaDocumento(r)));
  protected readonly modo = computed(() => modoRail(this.nodos().length));
  protected readonly indice = computed(() => indiceActivo(this.nodos()));
  protected readonly fraccion = computed(() => fraccionFlujo(this.indice(), this.nodos().length));
  protected readonly colorActivo = computed(() => `var(${(this.nodos()[this.indice()]?.senal ?? { token: '--signal-default' }).token})`);
  protected readonly reducido = signal(false);
  protected readonly barriendo = signal<string | null>(null);
  protected readonly puedeIzq = signal(false);
  protected readonly puedeDer = signal(false);
  protected readonly desborda = signal(false);

  private readonly franja = viewChild<ElementRef<HTMLElement>>('franja');
  private previo: { expediente: string | null; mapa: Map<string, ClaveSenal> } = { expediente: null, mapa: new Map() };
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private cuadro = 0;

  constructor() {
    const destruir = inject(DestroyRef);
    // Movimiento reducido: un solo escucha, liberado al destruir.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducido.set(mq.matches);
      const alCambiar = (e: MediaQueryListEvent): void => this.reducido.set(e.matches);
      mq.addEventListener('change', alCambiar);
      destruir.onDestroy(() => mq.removeEventListener('change', alCambiar));
    }
    // Barrido único cuando el estado REAL de un documento pasa a «aprobado» (después de la acción existente, sin retrasarla).
    effect(() => {
      const ns = this.nodos();
      const exp = this.expediente();
      untracked(() => {
        const mapa = new Map(ns.map((n) => [n.tipo, n.senal.clave] as [string, ClaveSenal]));
        const antes = this.previo.expediente === exp ? this.previo.mapa : new Map<string, ClaveSenal>();
        const aprobados = cambioAAprobado(antes, mapa);
        this.previo = { expediente: exp, mapa };
        if (aprobados.length > 0 && !this.reducido()) {
          this.barriendo.set(aprobados[0]);
          if (this.temporizador) clearTimeout(this.temporizador);
          this.temporizador = setTimeout(() => this.barriendo.set(null), 500);
        }
      });
    });
    // Al cambiar el documento activo, la franja lo trae a la vista (una medición por cambio).
    effect(() => {
      const i = this.indice();
      const n = this.nodos().length;
      untracked(() => { this.programar(() => this.centrar(i, n)); });
    });
    // El estado de los bordes y botones se recalcula al cambiar el ancho de la franja (un solo observador).
    effect((alLimpiar) => {
      const el = this.franja()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.programar(() => this.medirBordes()));
      ro.observe(el);
      alLimpiar(() => ro.disconnect());
    });
    destruir.onDestroy(() => { if (this.temporizador) clearTimeout(this.temporizador); if (this.cuadro) cancelAnimationFrame(this.cuadro); });
  }

  protected anim(n: { senal: Parameters<typeof animacionNodo>[0]; activo: boolean }): string {
    return animacionNodo(n.senal, { activo: n.activo, reducido: this.reducido() });
  }

  protected alDesplazar(): void { this.programar(() => this.medirBordes()); }

  protected desplazar(sentido: -1 | 1): void {
    const el = this.franja()?.nativeElement;
    if (el) el.scrollBy({ left: sentido * el.clientWidth * 0.7, behavior: this.reducido() ? 'auto' : 'smooth' });
  }

  protected alTeclear(e: KeyboardEvent): void {
    const botones = Array.from((e.currentTarget as HTMLElement).closest('ol')?.querySelectorAll<HTMLButtonElement>('button.nodo-btn') ?? []);
    const actual = botones.findIndex((b) => b === document.activeElement);
    const destino = indiceConTecla(e.key, Math.max(0, actual), botones.length);
    if (destino === null) return;
    e.preventDefault();
    botones[destino]?.focus();
  }

  private programar(f: () => void): void {
    if (this.cuadro) cancelAnimationFrame(this.cuadro);
    this.cuadro = requestAnimationFrame(() => { this.cuadro = 0; f(); });
  }

  private centrar(indice: number, total: number): void {
    const el = this.franja()?.nativeElement;
    if (!el) return;
    const w = el.scrollWidth / Math.max(1, total);
    const izquierda = indice * w + w / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, izquierda), behavior: this.reducido() ? 'auto' : 'smooth' });
    this.medirBordes();
  }

  private medirBordes(): void {
    const el = this.franja()?.nativeElement;
    if (!el) return;
    const sobra = el.scrollWidth - el.clientWidth;
    this.desborda.set(sobra > 2);
    this.puedeIzq.set(el.scrollLeft > 2);
    this.puedeDer.set(el.scrollLeft < sobra - 2);
  }
}
