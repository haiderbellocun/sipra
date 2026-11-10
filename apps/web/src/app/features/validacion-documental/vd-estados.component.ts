import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type TipoEstadoVd = 'sin-expediente' | 'sin-pendientes' | 'procesando' | 'error' | 'aprobado';

/**
 * Estados abstractos de la Mesa (Figma V3 · F9): Topology Orb + Document Signal, sin ilustraciones. Presentacional: el texto y la
 * acción los pone quien lo usa (proyección de contenido). El orbe es SVG estático; solo «procesando» mueve su nodo, y nada se mueve
 * con `prefers-reduced-motion`.
 */
@Component({
  selector: 'sipra-vd-estado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tipo]': 'tipo()', '[class.compacto]': 'compacto()' },
  styles: [`
    :host { display:grid; justify-items:center; align-content:center; gap:0; text-align:center; padding:32px 16px; --c:var(--signal-active); }
    :host([data-tipo='error']) { --c:var(--status-critical); }
    .orbe { position:relative; width:112px; height:112px; margin-bottom:44px; }
    .orbe::before { content:""; position:absolute; inset:-60px; border-radius:50%; background:radial-gradient(closest-side, color-mix(in srgb, var(--c) 22%, transparent), color-mix(in srgb, var(--c) 7%, transparent) 55%, transparent); }
    svg { position:relative; width:100%; height:100%; overflow:visible; fill:none; stroke:var(--c); stroke-width:1.2; }
    .lleno { fill:var(--c); stroke:none; }
    .hueco { fill:var(--vd-nodo-vacio); stroke-width:1.4; }
    .tenue { stroke-opacity:.45; }
    :host([data-tipo='aprobado']) .aro { stroke-width:3; }
    .giro { transform-origin:56px 56px; }
    @media (prefers-reduced-motion: no-preference) { :host([data-tipo='procesando']) .giro { animation:vd-orbita 2.4s linear infinite; } }
    @keyframes vd-orbita { to { transform:rotate(360deg); } }
    ::slotted(*), :host ::ng-deep h3 { margin:0; }
    :host ::ng-deep h3 { font-size:1.125rem; font-weight:600; letter-spacing:-.01em; color:var(--text-primary); }
    :host ::ng-deep p { margin:10px 0 0; max-width:240px; font-size:var(--fs-xs); line-height:1.45; color:var(--text-secondary); }
    :host ::ng-deep .boton { margin-top:16px; }
    :host(.compacto) { padding:24px 16px; }
    :host(.compacto) .orbe { width:72px; height:72px; margin-bottom:24px; }
  `],
  template: `
    <div class="orbe" aria-hidden="true">
      <svg viewBox="0 0 112 112">
        @switch (tipo()) {
          @case ('sin-expediente') {
            <circle cx="56" cy="56" r="55" /><ellipse cx="56" cy="56" rx="55" ry="20" class="tenue" /><ellipse cx="56" cy="56" rx="55" ry="38" class="tenue" />
            <ellipse cx="56" cy="56" rx="20" ry="55" class="tenue" /><ellipse cx="56" cy="56" rx="38" ry="55" class="tenue" /><path d="M1 56h110M56 1v110" class="tenue" />
            <circle cx="30" cy="38" r="1.6" class="lleno" /><circle cx="54" cy="52" r="1.6" class="lleno" /><circle cx="60" cy="58" r="1.6" class="lleno" />
            <circle cx="74" cy="66" r="1.6" class="lleno" /><circle cx="46" cy="80" r="1.6" class="lleno" /><circle cx="70" cy="90" r="1.6" class="lleno" /><circle cx="56" cy="22" r="1.6" class="lleno" />
          }
          @case ('sin-pendientes') {
            <circle cx="56" cy="56" r="55" class="tenue" /><circle cx="56" cy="56" r="35" class="tenue" /><circle cx="56" cy="56" r="4" class="lleno" />
            <circle cx="56" cy="1" r="1.6" class="lleno" /><circle cx="95" cy="17" r="1.6" class="lleno" /><circle cx="111" cy="56" r="1.6" class="lleno" />
            <circle cx="95" cy="95" r="1.6" class="lleno" /><circle cx="56" cy="111" r="1.6" class="lleno" /><circle cx="17" cy="95" r="1.6" class="lleno" /><circle cx="1" cy="56" r="1.6" class="lleno" /><circle cx="17" cy="17" r="1.6" class="lleno" />
          }
          @case ('procesando') {
            <circle cx="56" cy="56" r="55" class="tenue" />
            <g class="giro"><circle cx="56" cy="1" r="4" class="lleno" /><circle cx="109" cy="39" r="3.6" class="lleno" /><circle cx="89" cy="101" r="3.6" class="lleno" /><circle cx="23" cy="101" r="3.4" class="hueco" /><circle cx="3" cy="39" r="3.4" class="hueco" /></g>
          }
          @case ('error') {
            <circle cx="56" cy="56" r="55" /><path d="M56 30v10" stroke-width="2.4" stroke-linecap="round" /><circle cx="56" cy="56" r="4" class="lleno" />
          }
          @case ('aprobado') {
            <circle cx="56" cy="56" r="55" class="aro" /><path d="M45 56l8 8 15-16" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="56" cy="1" r="4" class="lleno" /><circle cx="104" cy="28" r="4" class="lleno" /><circle cx="104" cy="84" r="4" class="lleno" />
            <circle cx="56" cy="111" r="4" class="lleno" /><circle cx="8" cy="84" r="4" class="lleno" /><circle cx="8" cy="28" r="4" class="lleno" />
          }
        }
      </svg>
    </div>
    <ng-content />
  `,
})
export class VdEstadoComponent {
  readonly tipo = input.required<TipoEstadoVd>();
  readonly compacto = input(false);
}

/**
 * Loader «Document Signal» (Figma V3 · F9): cinco nodos sobre una línea; la señal viaja de nodo en nodo con `transform` (sin
 * spinner). Con `prefers-reduced-motion` queda estático en el primer nodo. El texto de estado lo pone quien lo usa.
 */
@Component({
  selector: 'sipra-vd-cargando',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:grid; gap:10px; justify-items:start; padding:16px 20px; }
    .l { position:relative; width:150px; height:12px; }
    .l::before { content:""; position:absolute; left:6px; right:6px; top:5.5px; height:1px; background:var(--vd-linea); }
    .f { position:absolute; left:6px; top:5px; width:138px; height:2px; transform-origin:left; transform:scaleX(0); background:var(--signal-active); box-shadow:0 0 6px color-mix(in srgb, var(--signal-active) 45%, transparent); }
    .n, .on { position:absolute; top:0; left:0; width:150px; height:12px; }
    .n { background:radial-gradient(circle 5.3px at 6px 6px, var(--vd-nodo-vacio) 4.6px, var(--signal-active) 5px, transparent 5.6px) 0 0 / 34.5px 12px repeat-x; }
    .on { background:radial-gradient(circle 6px at 6px 6px, var(--signal-active) 5.5px, transparent 6px) 0 0 / 34.5px 12px repeat-x; clip-path:inset(0 calc(100% - 12px) 0 0); }
    @media (prefers-reduced-motion: no-preference) {
      .f { animation:vd-flujo 2.4s var(--ease-in-out) infinite; }
      .on { animation:vd-encendido 2.4s var(--ease-in-out) infinite; }
    }
    @keyframes vd-flujo { 0% { transform:scaleX(0); } 80%, 100% { transform:scaleX(1); } }
    @keyframes vd-encendido { 0% { clip-path:inset(0 calc(100% - 12px) 0 0); } 80%, 100% { clip-path:inset(0 0 0 0); } }
    ::slotted(*) { margin:0; }
    :host ::ng-deep p { margin:0; font-size:var(--fs-xs); color:var(--text-secondary); }
  `],
  template: `<span class="l" aria-hidden="true"><span class="f"></span><span class="n"></span><span class="on"></span></span><ng-content />`,
})
export class VdCargandoComponent {}
