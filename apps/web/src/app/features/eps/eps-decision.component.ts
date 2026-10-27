import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecisionMesa, DetalleMesa, MotivoDevolucionEps } from '@core/models/modelos';
import {
  AFILIACION, AUTENTICIDAD, JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA, MOTIVOS_DEVOLUCION, RECOMENDACION, apartaDeRecomendacion,
} from './eps.util';

type Decision = DecisionMesa['decision'];

const TITULO: Record<Decision, string> = { aprobar: 'Aprobar el certificado', devolver: 'Devolver al estudiante', rechazar: 'Rechazar el certificado' };
const BOTON: Record<Decision, string> = { aprobar: 'Aprobar', devolver: 'Devolver', rechazar: 'Rechazar' };

/**
 * Diálogo de decisión (nativo `<dialog>`: trae foco atrapado y cierre con Esc). Muestra
 * el resumen de lo que se va a decidir y, si la persona se aparta de la recomendación del
 * sistema, exige una justificación reforzada. La decisión final es suya; el servidor
 * vuelve a validar todo (reserva, versión, justificación).
 */
@Component({
  selector: 'sipra-eps-decision',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    dialog { border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-5); width:min(640px, calc(100vw - 32px)); background:var(--superficie); color:var(--texto); }
    dialog::backdrop { background:rgb(0 0 0 / .45); }
    .resumen { display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); font-size:var(--fs-sm); margin-bottom:var(--sp-3); }
    .k { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    .aviso { border-left:3px solid var(--aviso); background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:0 var(--r-sm) var(--r-sm) 0; margin-bottom:var(--sp-3); font-size:var(--fs-sm); }
    .aviso.peligro { border-left-color:var(--peligro); background:var(--peligro-suave); }
    .pie { display:flex; gap:var(--sp-2); justify-content:flex-end; flex-wrap:wrap; }
    .error-campo { color:var(--peligro); font-size:var(--fs-sm); }
  `],
  template: `
    <dialog #dialogo aria-labelledby="eps-dec-titulo" (close)="cerrado()" (cancel)="cerrado()">
      @if (detalle(); as d) {
        <h2 id="eps-dec-titulo">{{ titulo() }}</h2>
        <p class="pista">{{ d.caso.estudiante.nombre }} · versión {{ d.caso.version }}</p>

        <div class="resumen" aria-label="Resumen del caso">
          <div><div class="k">Autenticidad</div>{{ autenticidad(d).icono }} {{ autenticidad(d).texto }}</div>
          <div><div class="k">Coincidencia con SIPRA</div>{{ coincide(d) }}</div>
          <div><div class="k">Afiliación</div>{{ afiliacion(d).icono }} {{ afiliacion(d).texto }}</div>
          <div><div class="k">Vigencia del certificado</div>{{ d.certificado.vigencia === 'vigente' ? 'Vigente' : d.certificado.vigencia === 'vencido' ? 'Vencido' : 'No determinada' }}</div>
          <div><div class="k">Discrepancias</div>{{ criticas(d) }} críticas · {{ informativas(d) }} informativas</div>
          <div><div class="k">Recomendación del sistema</div>{{ recomendacion(d).icono }} {{ recomendacion(d).texto }}</div>
        </div>

        @if (criticas(d) > 0) {
          <div class="aviso peligro" role="alert"><strong>Atención:</strong> este caso tiene discrepancias críticas. Revise la sección de discrepancias antes de confirmar.</div>
        }
        <p class="pista">La recomendación es una ayuda, no una decisión automática: la decisión es suya.</p>

        @if (decision() === 'devolver') {
          <div class="campo">
            <label for="eps-motivo">Motivo de la devolución</label>
            <select id="eps-motivo" [(ngModel)]="motivo" [attr.aria-invalid]="motivo === '' && intento() ? 'true' : null">
              <option value="">Seleccione…</option>
              @for (m of motivos; track m.valor) { <option [value]="m.valor">{{ m.texto }}</option> }
            </select>
            <span class="pista">El estudiante recibe un mensaje claro que explica qué corregir.</span>
          </div>
        }

        @if (decision() !== 'devolver' || motivo === 'otro') {
          <div class="campo">
            <label for="eps-just">{{ etiquetaJustificacion() }}</label>
            <textarea id="eps-just" [(ngModel)]="justificacion" rows="4" maxlength="2000" [attr.aria-invalid]="intento() && !valida() ? 'true' : null" aria-describedby="eps-just-ayuda"></textarea>
            <span id="eps-just-ayuda" class="pista">{{ justificacion.trim().length }} caracteres · mínimo {{ minimo() }}</span>
          </div>
        } @else {
          <div class="campo">
            <label for="eps-detalle">Detalle adicional para el estudiante (opcional)</label>
            <textarea id="eps-detalle" [(ngModel)]="justificacion" rows="2" maxlength="500"></textarea>
          </div>
        }

        @if (aparta()) {
          <div class="aviso" role="status"><strong>Se aparta de la recomendación del sistema.</strong> Explique el motivo con al menos {{ minimo() }} caracteres: quedará registrado.</div>
        }
        @if (intento() && !valida()) { <p class="error-campo" role="alert">{{ errorTexto() }}</p> }

        <div class="pie">
          <button type="button" class="boton" (click)="cancelar()">Cancelar</button>
          <button type="button" class="boton boton--primario" [class.boton--peligro]="decision() === 'rechazar'" [disabled]="ocupado()" (click)="confirmar()">{{ boton() }}</button>
        </div>
      }
    </dialog>
  `,
})
export class EpsDecisionComponent {
  readonly detalle = input<DetalleMesa | null>(null);
  readonly ocupado = input<boolean>(false);
  readonly confirmada = output<DecisionMesa>();

  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  readonly decision = signal<Decision>('aprobar');
  readonly intento = signal(false);
  motivo: MotivoDevolucionEps | '' = '';
  justificacion = '';
  readonly motivos = MOTIVOS_DEVOLUCION;

  readonly titulo = computed(() => TITULO[this.decision()]);
  readonly boton = computed(() => BOTON[this.decision()]);
  readonly aparta = computed(() => apartaDeRecomendacion(this.decision(), this.detalle()?.recomendacion.codigo ?? ''));
  readonly minimo = computed(() => (this.aparta() ? JUSTIFICACION_REFORZADA : JUSTIFICACION_MINIMA));

  abrir(decision: Decision): void {
    this.decision.set(decision);
    this.motivo = '';
    this.justificacion = '';
    this.intento.set(false);
    const el = this.dialogo().nativeElement;
    if (!el.open) el.showModal();
  }

  cerrar(): void { const el = this.dialogo().nativeElement; if (el.open) el.close(); }
  cancelar(): void { this.cerrar(); }
  cerrado(): void { this.intento.set(false); }

  etiquetaJustificacion(): string {
    return this.decision() === 'rechazar' ? 'Justificación del rechazo' : this.decision() === 'devolver' ? 'Explique qué debe corregir' : this.aparta() ? 'Justificación reforzada' : 'Comentario (opcional)';
  }

  valida(): boolean {
    const len = this.justificacion.trim().length;
    switch (this.decision()) {
      case 'devolver': return this.motivo !== '' && (this.motivo !== 'otro' || len >= JUSTIFICACION_MINIMA);
      case 'rechazar': return len >= this.minimo();
      default: return !this.aparta() || len >= this.minimo();
    }
  }

  errorTexto(): string {
    if (this.decision() === 'devolver') return this.motivo === '' ? 'Elija el motivo de la devolución.' : 'Explique al estudiante qué debe corregir (al menos 10 caracteres).';
    return `La justificación necesita al menos ${this.minimo()} caracteres.`;
  }

  confirmar(): void {
    this.intento.set(true);
    if (!this.valida()) return;
    const dto: DecisionMesa = { decision: this.decision() };
    if (this.decision() === 'devolver' && this.motivo !== '') dto.motivo = this.motivo;
    if (this.justificacion.trim()) dto.justificacion = this.justificacion.trim();
    this.confirmada.emit(dto);
    this.cerrar();
  }

  autenticidad(d: DetalleMesa) { return AUTENTICIDAD[d.autenticidad.estado] ?? AUTENTICIDAD['no_evaluada']; }
  afiliacion(d: DetalleMesa) { return AFILIACION[d.afiliacion.estado] ?? AFILIACION['no_contrastada']; }
  recomendacion(d: DetalleMesa) { return RECOMENDACION[d.recomendacion.codigo] ?? RECOMENDACION['informacion_insuficiente']; }
  criticas(d: DetalleMesa): number { return d.discrepancias.filter((x) => x.severidad === 'critica').length; }
  informativas(d: DetalleMesa): number { return d.discrepancias.filter((x) => x.severidad === 'informativa').length; }
  coincide(d: DetalleMesa): string {
    const filas = d.comparacion.filter((c) => c.campo === 'numero_documento' || c.campo === 'nombre');
    return filas.some((c) => c.conflictos.includes('sipra_vs_certificado')) ? '✗ No coincide' : '✓ Coincide';
  }
}
