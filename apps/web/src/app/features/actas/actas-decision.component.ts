import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecisionActa as DecisionDto, DetalleActa, MotivoDevolucionActa } from '@core/models/modelos';
import {
  DecisionActa, JUSTIFICACION_MINIMA, apartaDeRecomendacionActa, devolucionValida, minimoJustificacion,
  previsualizarDevolucion, resultadoActa,
} from './actas.util';

const TITULO: Record<DecisionActa, string> = { aprobar: 'Aprobar el Acta', devolver: 'Devolver al estudiante', rechazar: 'Rechazar el Acta' };
const BOTON: Record<DecisionActa, string> = { aprobar: 'Aprobar Acta', devolver: 'Devolver Acta', rechazar: 'Rechazar Acta' };

/**
 * Diálogo de decisión (nativo `<dialog>`: trae foco atrapado, cierre con Esc y devuelve el foco al botón que lo abrió).
 * Compacto: una decisión, lo mínimo para tomarla y, si la persona se aparta de la recomendación del sistema, la justificación
 * reforzada. La decisión final es suya; el servidor vuelve a validar todo (reserva, versión, justificación).
 */
@Component({
  selector: 'sipra-actas-decision',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    dialog { border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-5); width:min(560px, calc(100vw - 32px)); background:var(--superficie); color:var(--texto); }
    dialog::backdrop { background:rgb(0 0 0 / .45); }
    h2 { margin:0 0 var(--sp-1); font-size:var(--fs-lg); }
    .sub { margin:0 0 var(--sp-3); color:var(--texto-tenue); font-size:var(--fs-sm); }
    .aviso { border-left:3px solid var(--aviso); background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:0 var(--r-sm) var(--r-sm) 0; margin:0 0 var(--sp-3); font-size:var(--fs-sm); }
    .aviso.peligro { border-left-color:var(--peligro); background:var(--peligro-suave); }
    .contador { display:flex; justify-content:space-between; gap:var(--sp-2); font-size:var(--fs-sm); color:var(--texto-tenue); font-variant-numeric:tabular-nums; }
    .contador.falta { color:var(--peligro); }
    .previa { background:var(--superficie-2); border-radius:var(--r-sm); padding:var(--sp-3); margin:0 0 var(--sp-3); font-size:var(--fs-sm); }
    .previa .rotulo { margin:0 0 var(--sp-1); font-weight:700; color:var(--texto-tenue); }
    .previa p { margin:0 0 var(--sp-1); }
    .previa p:last-child { margin:0; }
    .confirma { display:flex; gap:var(--sp-2); align-items:flex-start; margin:0 0 var(--sp-3); font-size:var(--fs-sm); }
    .confirma input { margin-top:3px; flex:none; width:18px; height:18px; }
    .pie { display:flex; gap:var(--sp-2); justify-content:flex-end; flex-wrap:wrap; margin-top:var(--sp-3); }
    .error-campo { color:var(--peligro); font-size:var(--fs-sm); margin:var(--sp-1) 0 0; }
  `],
  template: `
    <dialog #dialogo aria-labelledby="acta-dec-titulo" (close)="cerrado()" (cancel)="cerrado()">
      @if (detalle(); as d) {
        <h2 id="acta-dec-titulo">{{ titulo() }}</h2>
        <p class="sub">{{ d.estudiante.nombre }} · versión {{ d.version }} · el sistema indica: {{ resultado().texto }}</p>

        @switch (decision()) {
          @case ('aprobar') {
            @if (aparta()) {
              <div class="aviso" role="status"><strong>Estás tomando una decisión distinta de la recomendación del sistema.</strong>
                Explica por qué con al menos {{ minimo() }} caracteres: queda registrado.</div>
            } @else {
              <p>El Acta queda aprobada y el estudiante será informado.</p>
            }
          }
          @case ('devolver') {
            <div class="campo">
              <label for="acta-motivo">Motivo de la devolución</label>
              <select id="acta-motivo" [ngModel]="motivo()" (ngModelChange)="motivo.set($event)" [attr.aria-invalid]="intento() && motivo() === '' ? 'true' : null" aria-describedby="acta-motivo-ayuda">
                <option value="">Seleccione…</option>
                @for (m of motivos(); track m.codigo) { <option [value]="m.codigo">{{ m.titulo }}</option> }
              </select>
              <span id="acta-motivo-ayuda" class="pista">El estudiante recibe un mensaje claro sobre qué corregir.</span>
              @if (motivos().length === 0) { <span class="error-campo" role="alert">No se pudo cargar la lista de motivos. Cierra este cuadro y actualiza la Mesa.</span> }
            </div>
            @if (requiereDetalle()) {
              <div class="campo">
                <label for="acta-detalle">Explica qué debe corregir el estudiante</label>
                <textarea id="acta-detalle" rows="3" maxlength="500" [ngModel]="texto()" (ngModelChange)="texto.set($event)" [attr.aria-invalid]="intento() && !valida() ? 'true' : null" aria-describedby="acta-detalle-contador"></textarea>
                <div id="acta-detalle-contador" class="contador" [class.falta]="intento() && !valida()"><span>Mínimo {{ minimoOtro }} caracteres</span><span>{{ largo() }} / {{ minimoOtro }}</span></div>
              </div>
            } @else if (motivo() !== '') {
              <div class="campo">
                <label for="acta-detalle">Detalle adicional para el estudiante (opcional)</label>
                <textarea id="acta-detalle" rows="2" maxlength="500" [ngModel]="texto()" (ngModelChange)="texto.set($event)"></textarea>
              </div>
            }
            @if (vista(); as v) {
              <div class="previa" aria-live="polite">
                <p class="rotulo">El estudiante verá</p>
                <p><strong>Qué pasó:</strong> {{ v.que }}</p>
                <p><strong>Qué debe hacer:</strong> {{ v.hacer }}</p>
              </div>
            }
          }
          @case ('rechazar') {
            <div class="aviso peligro" role="status"><strong>Rechazar es una decisión de mayor impacto.</strong>
              El estudiante será informado y esta versión no se podrá reabrir; para continuar tendrá que hablar con coordinación o cargar un Acta nueva.
              Si el problema se puede corregir, es mejor <em>devolverla</em>.</div>
            <div class="campo">
              <label for="acta-just">Justificación del rechazo</label>
              <textarea id="acta-just" rows="3" maxlength="2000" [ngModel]="texto()" (ngModelChange)="texto.set($event)" [attr.aria-invalid]="intento() && !valida() ? 'true' : null" aria-describedby="acta-just-contador"></textarea>
              <div id="acta-just-contador" class="contador" [class.falta]="intento() && !valida()"><span>{{ aparta() ? 'Rechazas un Acta que el sistema ve consistente: ' : '' }}mínimo {{ minimo() }} caracteres</span><span>{{ largo() }} / {{ minimo() }}</span></div>
            </div>
            <label class="confirma"><input type="checkbox" [ngModel]="confirmaRechazo()" (ngModelChange)="confirmaRechazo.set($event)" /> <span>Confirmo que quiero rechazar esta Acta.</span></label>
          }
        }

        @if (decision() === 'aprobar' && aparta()) {
          <div class="campo">
            <label for="acta-just">Justificación</label>
            <textarea id="acta-just" rows="3" maxlength="2000" [ngModel]="texto()" (ngModelChange)="texto.set($event)" [attr.aria-invalid]="intento() && !valida() ? 'true' : null" aria-describedby="acta-just-contador"></textarea>
            <div id="acta-just-contador" class="contador" [class.falta]="intento() && !valida()"><span>Mínimo {{ minimo() }} caracteres</span><span>{{ largo() }} / {{ minimo() }}</span></div>
          </div>
        }
        @if (intento() && !valida()) { <p class="error-campo" role="alert">{{ errorTexto() }}</p> }

        <div class="pie">
          <button type="button" class="boton" (click)="cerrar()">Cancelar</button>
          <button type="button" class="boton" [class.boton--primario]="decision() !== 'rechazar'" [class.boton--peligro]="decision() === 'rechazar'" [disabled]="ocupado() || !valida()" (click)="confirmar()">{{ boton() }}</button>
        </div>
      }
    </dialog>
  `,
})
export class ActasDecisionComponent {
  readonly detalle = input<DetalleActa | null>(null);
  readonly ocupado = input<boolean>(false);
  readonly confirmada = output<DecisionDto>();

  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  readonly decision = signal<DecisionActa>('aprobar');
  readonly intento = signal(false);
  readonly motivo = signal('');
  readonly texto = signal('');
  readonly confirmaRechazo = signal(false);
  /** El catálogo lo entrega la API; aquí no hay lista propia. */
  readonly motivos = input<readonly MotivoDevolucionActa[]>([]);
  readonly requiereDetalle = computed(() => this.motivos().find((m) => m.codigo === this.motivo())?.requiereDetalle ?? false);
  readonly minimoOtro = JUSTIFICACION_MINIMA;

  private readonly codigo = computed(() => this.detalle()?.recomendacion ?? '');
  readonly resultado = computed(() => resultadoActa(this.codigo()));
  readonly titulo = computed(() => TITULO[this.decision()]);
  readonly boton = computed(() => BOTON[this.decision()]);
  readonly aparta = computed(() => apartaDeRecomendacionActa(this.decision(), this.codigo()));
  readonly minimo = computed(() => minimoJustificacion(this.decision(), this.codigo()));
  readonly largo = computed(() => this.texto().trim().length);
  readonly vista = computed(() => previsualizarDevolucion(this.motivos(), this.motivo(), this.texto()));

  /** Misma regla que el servidor: aquí solo se anticipa para no dejar enviar algo que se va a rechazar. */
  readonly valida = computed(() => {
    switch (this.decision()) {
      case 'devolver': return devolucionValida(this.motivos(), this.motivo(), this.texto());
      case 'rechazar': return this.largo() >= this.minimo() && this.confirmaRechazo();
      default: return !this.aparta() || this.largo() >= this.minimo();
    }
  });

  abrir(decision: DecisionActa): void {
    this.decision.set(decision);
    this.motivo.set('');
    this.texto.set('');
    this.confirmaRechazo.set(false);
    this.intento.set(false);
    const el = this.dialogo().nativeElement;
    if (!el.open) el.showModal();
  }

  cerrar(): void { const el = this.dialogo().nativeElement; if (el.open) el.close(); }
  cerrado(): void { this.intento.set(false); }

  errorTexto(): string {
    switch (this.decision()) {
      case 'devolver': return this.motivo() === '' ? 'Elige el motivo de la devolución.' : `Explica qué debe corregir el estudiante (al menos ${JUSTIFICACION_MINIMA} caracteres).`;
      case 'rechazar': return this.largo() < this.minimo() ? `La justificación necesita al menos ${this.minimo()} caracteres.` : 'Confirma que quieres rechazar el Acta.';
      default: return `La justificación necesita al menos ${this.minimo()} caracteres.`;
    }
  }

  confirmar(): void {
    this.intento.set(true);
    if (!this.valida()) return;
    const dto: DecisionDto = { decision: this.decision() };
    const motivo = this.motivo();
    if (this.decision() === 'devolver' && motivo !== '') dto.motivo = motivo;
    if (this.texto().trim()) dto.justificacion = this.texto().trim();
    this.confirmada.emit(dto);
    this.cerrar();
  }
}
