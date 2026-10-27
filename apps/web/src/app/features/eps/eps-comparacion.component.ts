import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ComparacionTriple } from '@core/models/modelos';
import { CAMPO_COMPARACION, RESULTADO_COMPARACION } from './eps.util';

/**
 * Comparación triple SIPRA · certificado · ADRES. Cada resultado lleva icono y texto
 * (no solo color). Sin los datos personales a la vista cuando la persona no tiene el
 * caso tomado: entonces solo se ve el resultado de cada campo.
 */
@Component({
  selector: 'sipra-eps-comparacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
    caption { text-align:left; font-size:var(--fs-sm); color:var(--texto-tenue); padding-bottom:var(--sp-2); }
    th, td { text-align:left; padding:8px; border-bottom:1px solid var(--borde); vertical-align:top; overflow-wrap:anywhere; }
    thead th { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    tr.critico td, tr.critico th { background:var(--peligro-suave); }
    .valor-vacio { color:var(--texto-tenue); }
    .envoltura { overflow-x:auto; }
  `],
  template: `
    <div class="envoltura">
      <table>
        <caption>Cada campo se compara entre lo que tiene SIPRA, lo que dice el certificado y lo que muestra ADRES.</caption>
        <thead>
          <tr><th scope="col">Campo</th><th scope="col">SIPRA</th><th scope="col">Certificado</th><th scope="col">ADRES</th><th scope="col">Resultado</th></tr>
        </thead>
        <tbody>
          @for (c of filas(); track c.campo) {
            <tr [class.critico]="c.critico">
              <th scope="row">{{ campo(c.campo) }}</th>
              <td>@if (valores()) { {{ c.sipra ?? '—' }} } @else { <span class="valor-vacio">Oculto</span> }</td>
              <td>@if (valores()) { {{ c.certificado ?? '—' }} } @else { <span class="valor-vacio">Oculto</span> }</td>
              <td>@if (valores()) { {{ c.adres ?? '—' }} } @else { <span class="valor-vacio">Oculto</span> }</td>
              <td>
                <span class="etiqueta etiqueta--icono etiqueta--{{ rotulo(c).tono }}"><span aria-hidden="true">{{ rotulo(c).icono }}</span> {{ rotulo(c).texto }}</span>
                @if (c.critico) { <span class="etiqueta etiqueta--icono etiqueta--peligro"><span aria-hidden="true">!</span> Crítico</span> }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class EpsComparacionComponent {
  readonly filas = input.required<ComparacionTriple[]>();
  readonly valores = input<boolean>(true);

  campo(c: string): string { return CAMPO_COMPARACION[c] ?? c; }
  rotulo(c: ComparacionTriple) { return RESULTADO_COMPARACION[c.resultado] ?? RESULTADO_COMPARACION['no_disponible']; }
}
