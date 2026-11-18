import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { VerificacionCarta } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';

/**
 * Verificación PÚBLICA de una carta de presentación (a esta ruta apunta el QR impreso). Sin sesión. Muestra solo lo
 * mínimo que entrega el servidor: estado, estudiante, documento enmascarado, programa, nivel, modalidad y fecha.
 */
@Component({
  selector: 'sipra-verificar-carta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: [`
    :host { display: grid; place-items: start center; min-height: 100dvh; padding: 48px 16px; box-sizing: border-box; background: var(--surface-canvas, var(--superficie)); color: var(--text-primary, var(--texto)); }
    .caja { width: min(520px, 100%); border: 1px solid var(--border-default, var(--borde)); border-radius: 10px; background: var(--surface-raised, var(--superficie)); padding: 24px; box-sizing: border-box; }
    .marca { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary, var(--texto-tenue)); }
    h1 { margin: 0 0 16px; font-size: 1.25rem; }
    .estado { display: inline-flex; align-items: center; gap: 8px; font-weight: 650; margin-bottom: 16px; }
    .estado i { width: 10px; height: 10px; border-radius: 50%; }
    .estado.vigente i { background: var(--ok, #1f9d55); } .estado.reemplazada i { background: var(--aviso, #c58a00); } .estado.anulada i, .estado.no i { background: var(--peligro, #c0392b); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; font-size: 14px; }
    dt { color: var(--text-secondary, var(--texto-tenue)); } dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .nota { margin: 16px 0 0; font-size: 12px; color: var(--text-secondary, var(--texto-tenue)); }
    .ref { font-family: var(--fuente-mono, monospace); }
    .nota a { color: inherit; }
  `],
  template: `
    <main class="caja" aria-live="polite">
      <p class="marca">SIPRA · Corporación Unificada Nacional de Educación Superior</p>
      <h1>Verificación de carta de presentación</h1>
      @if (cargando()) {
        <p>Consultando la referencia…</p>
      } @else if (resultado(); as r) {
        @if (r.encontrada) {
          <div class="estado" [class]="r.estado"><i aria-hidden="true"></i>{{ textoEstado(r.estado) }}</div>
          <dl>
            <dt>Referencia</dt><dd class="ref">{{ r.referencia }}</dd>
            <dt>Estudiante</dt><dd>{{ r.estudiante }}</dd>
            <dt>Identificación</dt><dd>{{ r.documento }}</dd>
            <dt>Programa</dt><dd>{{ r.programa }}</dd>
            <dt>Nivel</dt><dd>{{ r.nivel }}</dd>
            <dt>Modalidad</dt><dd>{{ r.modalidad }}</dd>
            <dt>Fecha de expedición</dt><dd>{{ r.fechaExpedicion }}</dd>
          </dl>
          <p class="nota">Para más información escriba a practicas&#64;cun.edu.co.</p>
        } @else {
          <div class="estado no"><i aria-hidden="true"></i>Carta no encontrada</div>
          <p class="nota">Revise la referencia impresa en la carta (formato XXXXX-XXXXX) o escriba a practicas&#64;cun.edu.co.</p>
        }
      } @else {
        <div class="estado no"><i aria-hidden="true"></i>No fue posible verificar la carta en este momento.</div>
      }
      <p class="nota">¿Necesitas descargar la carta vigente? <a routerLink="/consultar-carta">Consultar carta por identificación</a>.</p>
    </main>
  `,
})
export class VerificarCartaComponent implements OnInit {
  readonly referencia = input.required<string>();
  private readonly api = inject(ApiService);
  readonly resultado = signal<VerificacionCarta | null>(null);
  readonly cargando = signal(true);

  async ngOnInit(): Promise<void> {
    try { this.resultado.set(await firstValueFrom(this.api.verificarCarta(this.referencia()))); }
    catch { this.resultado.set(null); }
    finally { this.cargando.set(false); }
  }

  textoEstado(e: string): string {
    return e === 'vigente' ? 'Carta válida · vigente' : e === 'reemplazada' ? 'Carta reemplazada por una más reciente' : 'Carta anulada';
  }
}
