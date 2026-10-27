import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ComparacionTriple } from '@core/models/modelos';
import { CAMPO_COMPARACION, CERTIFICADO_VS_SIPRA, RESULTADO_COMPARACION } from './eps.util';

/**
 * Comparación SIPRA · certificado · ADRES, una fila por campo. Cada fuente va con su etiqueta
 * sobre el valor (no en columnas de una tabla que se comprime y parte las palabras) y el
 * resultado lleva icono y texto, no solo color. Sin los datos personales a la vista cuando la
 * persona no tiene el caso tomado: entonces solo se ve el resultado de cada campo.
 */
@Component({
  selector: 'sipra-eps-comparacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    ul { list-style:none; margin:0; padding:0; display:grid; gap:var(--sp-2); }
    li { padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); background:var(--superficie-2); }
    li.critico { background:var(--peligro-suave); }
    .cab { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-3); align-items:center; justify-content:space-between; margin-bottom:var(--sp-1); }
    .cab h4 { margin:0; font-size:var(--fs-base); }
    .res { display:flex; flex-wrap:wrap; gap:var(--sp-1) var(--sp-2); align-items:center; }
    dl { margin:0; display:grid; gap:var(--sp-1) var(--sp-3); grid-template-columns:repeat(auto-fit, minmax(7.5rem, 1fr)); }
    dl > div { min-width:0; }
    dt { font-size:var(--fs-sm); color:var(--texto-tenue); }
    dd { margin:0; font-weight:600; overflow-wrap:break-word; font-variant-numeric:tabular-nums; }
    .vacio-valor { color:var(--texto-tenue); font-weight:400; }
  `],
  template: `
    <p class="pista" style="margin-top:0">Cada campo se compara entre lo que tiene SIPRA, lo que dice el certificado y lo que muestra ADRES.</p>
    <ul>
      @for (c of filas(); track c.campo) {
        <li [class.critico]="c.critico">
          <div class="cab">
            <h4>{{ campo(c.campo) }}</h4>
            <span class="res">
              @if (c.certificadoVsSipra; as v) {
                <span class="etiqueta etiqueta--icono etiqueta--{{ vsSipra(v).tono }}"><span aria-hidden="true">{{ vsSipra(v).icono }}</span> Certificado vs SIPRA: {{ vsSipra(v).texto }}</span>
              }
              @if (c.resultado !== 'no_disponible' || !c.certificadoVsSipra) {
                <span class="etiqueta etiqueta--icono etiqueta--{{ rotulo(c).tono }}"><span aria-hidden="true">{{ rotulo(c).icono }}</span> ADRES: {{ rotulo(c).texto }}</span>
              }
              @if (c.critico) { <span class="etiqueta etiqueta--icono etiqueta--peligro"><span aria-hidden="true">!</span> Crítico</span> }
            </span>
          </div>
          <dl>
            <div><dt>SIPRA</dt><dd>@if (valores()) { {{ c.sipra ?? '—' }} } @else { <span class="vacio-valor">Oculto</span> }</dd></div>
            <div><dt>Certificado</dt><dd>@if (valores()) { {{ c.certificado ?? '—' }} } @else { <span class="vacio-valor">Oculto</span> }</dd></div>
            <div><dt>ADRES</dt><dd>@if (valores()) { {{ c.adres ?? '—' }} } @else { <span class="vacio-valor">Oculto</span> }</dd></div>
          </dl>
        </li>
      }
    </ul>
  `,
})
export class EpsComparacionComponent {
  readonly filas = input.required<ComparacionTriple[]>();
  readonly valores = input<boolean>(true);

  campo(c: string): string { return CAMPO_COMPARACION[c] ?? c; }
  vsSipra(v: string) { return CERTIFICADO_VS_SIPRA[v] ?? CERTIFICADO_VS_SIPRA['insuficiente']; }
  rotulo(c: ComparacionTriple) { return RESULTADO_COMPARACION[c.resultado] ?? RESULTADO_COMPARACION['no_disponible']; }
}
