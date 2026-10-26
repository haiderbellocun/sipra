import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SesionService } from '@core/auth/sesion.service';

/**
 * Retorno del ingreso institucional (`/ingreso/callback`).
 *
 * El proveedor regresa aquí con `code` y `state`. Se leen una sola vez, se
 * borran de la URL visible de inmediato y se entregan al servidor por POST.
 * Cualquier fallo limpia lo temporal y devuelve a `/ingreso` con un aviso
 * genérico: ni el código, ni el `state`, ni el motivo llegan a la pantalla.
 */
@Component({
  selector: 'sipra-ingreso-callback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: grid; place-items: center; min-height: 100dvh; padding: var(--sp-6) var(--sp-4); }
    .cargando { padding: var(--sp-6); text-align: center; color: var(--texto-tenue); }
  `],
  template: `<div class="tarjeta cargando" role="status">Completando el ingreso…</div>`,
})
export class IngresoCallbackComponent implements OnInit {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ubicacion = inject(Location);
  private readonly sesion = inject(SesionService);

  async ngOnInit(): Promise<void> {
    const parametros = this.ruta.snapshot.queryParamMap;
    const code = parametros.get('code') ?? '';
    const state = parametros.get('state') ?? '';
    const errorProveedor = parametros.get('error');

    // Antes de cualquier otra cosa: que code y state no queden en la barra ni en el historial.
    this.ubicacion.replaceState('/ingreso/callback');

    try {
      if (errorProveedor || !code || !state) throw new Error('retorno incompleto');
      await this.sesion.completarIngresoOidc(code, state);
      await this.router.navigate(['/inicio'], { replaceUrl: true });
    } catch {
      this.sesion.descartarStateTemporal();
      await this.router.navigate(['/ingreso'], { queryParams: { error: 'oidc' }, replaceUrl: true });
    }
  }
}
