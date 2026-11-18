import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CartaPublica } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { documentoConsultaValido, mensajeErrorConsulta, nombreArchivoPublico } from './consulta-carta.util';

/**
 * Consulta PÚBLICA de la carta de presentación vigente por número de identificación (sin sesión): la empresa ingresa la
 * cédula del estudiante, ve lo mínimo de cada carta VIGENTE y descarga el PDF oficial con un token temporal.
 * La identificación viaja en el cuerpo de un POST (no queda en la URL ni en el historial).
 */
@Component({
  selector: 'sipra-consultar-carta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  styles: [`
    :host { display: grid; place-items: start center; min-height: 100dvh; padding: 40px 16px; box-sizing: border-box; background: var(--surface-canvas, var(--superficie)); color: var(--text-primary, var(--texto)); }
    .caja { width: min(560px, 100%); border: 1px solid var(--border-default, var(--borde)); border-radius: 10px; background: var(--surface-raised, var(--superficie)); padding: 24px; box-sizing: border-box; }
    .marca { margin: 0 0 4px; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary, var(--texto-tenue)); }
    h1 { margin: 0 0 8px; font-size: 1.25rem; }
    .ayuda { margin: 0 0 16px; font-size: 14px; color: var(--text-secondary, var(--texto-tenue)); }
    form { display: grid; gap: 12px; }
    label { font-weight: 600; font-size: 14px; }
    input { width: 100%; box-sizing: border-box; min-height: 48px; font: inherit; font-size: 1.05rem; padding: 10px 12px; border: 1px solid var(--border-strong, var(--borde)); border-radius: 8px; background: var(--surface-base, transparent); color: inherit; }
    input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--focus-ring, var(--signal-active, #1a7f8e)); outline-offset: 2px; }
    button.principal { min-height: 48px; font: inherit; font-weight: 650; border: 0; border-radius: 8px; cursor: pointer; background: var(--signal-active, #1a7f8e); color: var(--text-inverse, #fff); }
    button.principal:disabled { opacity: .6; cursor: not-allowed; }
    .error { color: var(--status-error, var(--peligro, #c0392b)); font-size: 14px; margin: 0; }
    .vacio { margin: 16px 0 0; font-size: 14px; padding: 12px; border-radius: 8px; border: 1px solid var(--border-default, var(--borde)); }
    .carta { margin-top: 16px; border-top: 1px solid var(--border-default, var(--borde)); padding-top: 16px; display: grid; gap: 10px; }
    .estado { display: inline-flex; align-items: center; gap: 8px; font-weight: 650; }
    .estado i { width: 10px; height: 10px; border-radius: 50%; background: var(--status-ok, var(--ok, #1f9d55)); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 14px; }
    dt { color: var(--text-secondary, var(--texto-tenue)); } dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .ref { font-family: var(--fuente-mono, monospace); }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .acciones button, .acciones a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 8px; font: inherit; font-weight: 600; font-size: 14px; text-decoration: none; cursor: pointer; }
    .acciones button { border: 0; background: var(--signal-active, #1a7f8e); color: var(--text-inverse, #fff); }
    .acciones a { border: 1px solid var(--border-strong, var(--borde)); color: inherit; }
    .pie { margin: 20px 0 0; font-size: 13px; color: var(--text-secondary, var(--texto-tenue)); }
    .pie a { color: inherit; }
    @media (max-width: 480px) { .caja { padding: 18px; } .acciones > * { flex: 1 1 100%; } }
  `],
  template: `
    <main class="caja">
      <p class="marca">SIPRA · Corporación Unificada Nacional de Educación Superior</p>
      <h1>Consultar carta de presentación</h1>
      <p class="ayuda">Ingresa el número de identificación del estudiante para consultar su carta vigente.</p>
      <form (ngSubmit)="consultar()" novalidate>
        <label for="cc-doc">Número de identificación</label>
        <input id="cc-doc" name="documento" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40"
               [ngModel]="documento()" (ngModelChange)="documento.set($event); error.set(null)" [attr.aria-invalid]="error() ? 'true' : null" [attr.aria-describedby]="error() ? 'cc-err' : null" />
        @if (error()) { <p class="error" id="cc-err" role="alert">{{ error() }}</p> }
        <button type="submit" class="principal" [disabled]="cargando()">{{ cargando() ? 'Consultando…' : 'Consultar carta' }}</button>
      </form>

      <div aria-live="polite">
        @if (mensaje()) { <p class="vacio">{{ mensaje() }}</p> }
        @for (c of cartas(); track c.referencia) {
          <section class="carta" [attr.aria-label]="'Carta ' + c.referencia">
            <div class="estado"><i aria-hidden="true"></i>Carta de presentación vigente</div>
            <dl>
              <dt>Estudiante</dt><dd>{{ c.estudiante }}</dd>
              <dt>Programa</dt><dd>{{ c.programa }}</dd>
              <dt>Nivel</dt><dd>{{ c.nivel }}</dd>
              <dt>Modalidad</dt><dd>{{ c.modalidad }}</dd>
              <dt>Fecha de expedición</dt><dd>{{ c.fechaExpedicion }}</dd>
              <dt>Destinatario</dt><dd>{{ c.destinatario }}</dd>
              <dt>Referencia</dt><dd class="ref">{{ c.referencia }}</dd>
            </dl>
            <div class="acciones">
              <button type="button" (click)="descargar(c)" [disabled]="descargando() === c.referencia">{{ descargando() === c.referencia ? 'Descargando…' : 'Descargar carta PDF' }}</button>
              <a [routerLink]="['/verificar-carta', c.referencia]">Verificar autenticidad</a>
            </div>
          </section>
        }
      </div>
      <p class="pie">¿Ya tienes la carta? Escanea su código QR para verificar su autenticidad. Más información: practicas&#64;cun.edu.co.</p>
    </main>
  `,
})
export class ConsultarCartaComponent {
  private readonly api = inject(ApiService);
  readonly documento = signal('');
  readonly cartas = signal<CartaPublica[]>([]);
  readonly mensaje = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly descargando = signal<string | null>(null);

  async consultar(): Promise<void> {
    this.cartas.set([]); this.mensaje.set(null);
    if (!documentoConsultaValido(this.documento())) { this.error.set('Escribe un número de identificación válido (solo números o letras).'); document.getElementById('cc-doc')?.focus(); return; }
    this.cargando.set(true);
    try {
      const r = await firstValueFrom(this.api.consultarCartaPublica(this.documento()));
      this.cartas.set(r.cartas); this.mensaje.set(r.mensaje);
    } catch (e) {
      this.error.set(mensajeErrorConsulta(e));
    } finally { this.cargando.set(false); }
  }

  async descargar(c: CartaPublica): Promise<void> {
    this.descargando.set(c.referencia);
    try {
      const blob = await firstValueFrom(this.api.descargarCartaPublica(c.tokenDescarga));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombreArchivoPublico(c.referencia);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      this.error.set(mensajeErrorConsulta(e));
    } finally { this.descargando.set(null); }
  }
}
