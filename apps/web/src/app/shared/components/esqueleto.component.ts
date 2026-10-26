import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type TipoEsqueleto = 'filas' | 'tarjetas' | 'bloque' | 'cifras';

/**
 * Esqueleto de carga: ocupa el lugar del contenido con bloques que laten,
 * para que la pantalla no salte cuando llegan los datos.
 */
@Component({
  selector: 'sipra-esqueleto',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite', '[attr.aria-label]': '"Cargando"' },
  styles: [`
    :host { display: block; }
    .h { background: linear-gradient(90deg, var(--superficie-2) 25%, color-mix(in oklab, var(--superficie-2) 70%, var(--texto-tenue)) 50%, var(--superficie-2) 75%);
         background-size: 200% 100%; border-radius: 8px; animation: latir 1.4s ease-in-out infinite; }
    .filas { display: grid; gap: var(--sp-3); }
    .fila { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: var(--sp-3); align-items: center; padding: var(--sp-2) 0; border-bottom: 1px solid var(--borde); }
    .fila:last-child { border-bottom: 0; }
    .fila .l1 { height: 14px; width: 55%; } .fila .l2 { height: 11px; width: 80%; margin-top: 8px; } .fila .p { height: 26px; border-radius: 30px; }
    .tarjetas { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
    .tarjeta-h { border: 1px solid var(--borde); border-radius: var(--r-md); padding: var(--sp-4); display: grid; gap: var(--sp-2); }
    .tarjeta-h .t { height: 16px; width: 60%; } .tarjeta-h .b { height: 12px; width: 90%; } .tarjeta-h .c { height: 12px; width: 70%; }
    .cifras { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 168px), 1fr)); }
    .cifra-h { border: 1px solid var(--borde); border-radius: var(--r-md); padding: var(--sp-4); display: grid; gap: var(--sp-2); }
    .cifra-h .n { height: 34px; width: 48px; } .cifra-h .t { height: 12px; width: 70%; }
    .bloque { display: grid; gap: var(--sp-2); } .bloque .a { height: 20px; width: 40%; } .bloque .b { height: 12px; width: 100%; } .bloque .c { height: 12px; width: 85%; } .bloque .d { height: 12px; width: 60%; }
    @keyframes latir { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .h { animation: none; } }
  `],
  template: `
    @switch (tipo()) {
      @case ('tarjetas') { <div class="tarjetas">@for (i of indices(); track i) { <div class="tarjeta-h"><div class="h t"></div><div class="h b"></div><div class="h c"></div></div> }</div> }
      @case ('cifras') { <div class="cifras">@for (i of indices(); track i) { <div class="cifra-h"><div class="h n"></div><div class="h t"></div></div> }</div> }
      @case ('bloque') { <div class="bloque"><div class="h a"></div><div class="h b"></div><div class="h c"></div><div class="h d"></div></div> }
      @default { <div class="filas">@for (i of indices(); track i) { <div class="fila"><div><div class="h l1"></div><div class="h l2"></div></div><div class="h p"></div></div> }</div> }
    }
  `,
})
export class EsqueletoComponent {
  readonly tipo = input<TipoEsqueleto>('filas');
  readonly cantidad = input(4);
  readonly indices = computed(() => Array.from({ length: this.cantidad() }, (_, i) => i));
}
