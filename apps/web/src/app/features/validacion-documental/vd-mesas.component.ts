import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SesionService } from '@core/auth/sesion.service';
import { mesasPara } from '../../layout/navegacion';

/**
 * Navegación secundaria de Validación documental hacia las mesas de los motores especializados (EPS, Actas, RUT,
 * Cámara): sus rutas históricas siguen vivas (bandeja, supervisión, deep links) y ya no son entradas de primer nivel
 * del menú. Solo se muestran las que el rol puede abrir (los mismos roles que el `rolGuard` de cada ruta).
 */
@Component({
  selector: 'sipra-vd-mesas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: [`
    :host { display: block; }
    nav { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 20px 0; font-size: var(--fs-meta); }
    .t { color: var(--text-muted); margin-right: 2px; }
    a { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border: 1px solid var(--border-default); border-radius: 999px; color: var(--text-secondary); text-decoration: none; font-weight: 500; }
    a:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--signal-active) 55%, var(--border-strong)); text-decoration: none; }
    a:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active)); outline-offset: 2px; }
  `],
  template: `
    @if (mesas().length > 0) {
      <nav class="mesas" aria-label="Mesas especializadas">
        <span class="t">Mesas:</span>
        @for (m of mesas(); track m.ruta) { <a [routerLink]="m.ruta" [attr.title]="'Mesa de ' + m.etiqueta + ' (bandeja y supervisión del motor)'">{{ m.etiqueta }}</a> }
      </nav>
    }
  `,
})
export class VdMesasComponent {
  private readonly sesion = inject(SesionService);
  readonly mesas = computed(() => mesasPara(this.sesion.rol()));
}
