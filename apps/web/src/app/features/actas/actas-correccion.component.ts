import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CorreccionDatosPractica, DetalleActa } from '@core/models/modelos';
import { ActasMesaEstado } from './actas-mesa.estado';
import {
  JUSTIFICACION_MINIMA, OPCIONES_ARL, OPCIONES_REMUNERACION, TEXTO_RESULTADO_CORRECCION, valorDeTexto,
} from './actas.util';

/**
 * Corrección controlada de los datos de la práctica que gobiernan la comparación (remuneración y responsable de la ARL).
 * Solo coordinación y administración, con justificación. Es una acción propia, no parte del formulario de decisión: corregir
 * un dato de SIPRA no es lo mismo que decidir sobre un Acta. Después de guardar se dice qué pasó con la comparación.
 */
@Component({
  selector: 'sipra-actas-correccion',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    dialog { border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-5); width:min(520px, calc(100vw - 32px)); background:var(--superficie); color:var(--texto); }
    dialog::backdrop { background:rgb(0 0 0 / .45); }
    h2 { margin:0 0 var(--sp-1); font-size:var(--fs-lg); }
    .sub { margin:0 0 var(--sp-3); color:var(--texto-tenue); font-size:var(--fs-sm); }
    .aviso { border-left:3px solid var(--aviso); background:var(--aviso-suave); padding:var(--sp-2) var(--sp-3); border-radius:0 var(--r-sm) var(--r-sm) 0; margin:0 0 var(--sp-2); font-size:var(--fs-sm); }
    .aviso.info { border-left-color:var(--info); background:var(--info-suave); }
    .aviso.ok { border-left-color:var(--ok); background:var(--ok-suave); }
    .actual { font-weight:400; color:var(--texto-tenue); }
    .contador { display:flex; justify-content:space-between; font-size:var(--fs-sm); color:var(--texto-tenue); font-variant-numeric:tabular-nums; }
    .pie { display:flex; gap:var(--sp-2); justify-content:flex-end; flex-wrap:wrap; margin-top:var(--sp-3); }
  `],
  template: `
    <dialog #dialogo aria-labelledby="acta-corr-titulo" (close)="resultado.set(null)">
      @if (detalle(); as d) {
        <h2 id="acta-corr-titulo">Corregir datos de la práctica</h2>
        <p class="sub">{{ d.estudiante.nombre }} · {{ d.practica.empresa ?? 'sin empresa registrada' }}</p>

        @if (resultado(); as r) {
          <div class="aviso ok" role="status" aria-live="polite">
            <strong>Datos corregidos.</strong> {{ textoResultado(r) }}
          </div>
          <div class="pie"><button type="button" class="boton boton--primario" (click)="cerrar()">Entendido</button></div>
        } @else {
          <div class="aviso" role="note">Este cambio puede recalcular la comparación del Acta.</div>
          @if (decidida()) {
            <div class="aviso info" role="note">Este cambio no modificará la decisión histórica: el Acta ya fue decidida con los datos de ese momento.</div>
          }
          <div class="campo">
            <label for="corr-rem">Remuneración <span class="actual">(hoy: {{ d.resumen.remuneracionSipra ?? 'sin dato' }})</span></label>
            <select id="corr-rem" [ngModel]="remuneracion()" (ngModelChange)="remuneracion.set($event)">
              @for (o of opcionesRemuneracion; track o.valor) { <option [value]="o.valor">{{ o.texto }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="corr-arl">Responsable de la ARL <span class="actual">(hoy: {{ d.resumen.responsableArlSipra ?? 'sin dato' }})</span></label>
            <select id="corr-arl" [ngModel]="arl()" (ngModelChange)="arl.set($event)">
              @if (arlOriginal(d) === '') { <option value="">Sin definir</option> }
              @for (o of opcionesArl; track o.valor) { <option [value]="o.valor">{{ o.texto }}</option> }
            </select>
          </div>
          <div class="campo">
            <label for="corr-just">Justificación</label>
            <textarea id="corr-just" rows="3" maxlength="2000" [ngModel]="justificacion()" (ngModelChange)="justificacion.set($event)" aria-describedby="corr-just-ayuda"></textarea>
            <div id="corr-just-ayuda" class="contador"><span>Queda en la auditoría con el valor anterior y el nuevo.</span><span>{{ largo() }} / {{ minimo }}</span></div>
          </div>
          @if (!hayCambios(d)) { <p class="pista" role="status">Cambia al menos uno de los dos datos para poder guardar.</p> }
          <div class="pie">
            <button type="button" class="boton" (click)="cerrar()">Cancelar</button>
            <button type="button" class="boton boton--primario" [disabled]="estado.ocupado() || !hayCambios(d) || largo() < minimo" (click)="guardar(d)">Guardar corrección</button>
          </div>
        }
      }
    </dialog>
  `,
})
export class ActasCorreccionComponent {
  protected readonly estado = inject(ActasMesaEstado);
  readonly detalle = input<DetalleActa | null>(null);

  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  readonly opcionesRemuneracion = OPCIONES_REMUNERACION;
  readonly opcionesArl = OPCIONES_ARL;
  readonly minimo = JUSTIFICACION_MINIMA;

  readonly remuneracion = signal('');
  readonly arl = signal('');
  readonly justificacion = signal('');
  readonly resultado = signal<CorreccionDatosPractica | null>(null);
  readonly largo = computed(() => this.justificacion().trim().length);
  /** Un acta con decisión no se reabre: el cambio solo deja constancia. */
  readonly decidida = computed(() => this.detalle()?.decision != null);

  abrir(): void {
    const d = this.detalle();
    if (!d) return;
    this.remuneracion.set(this.remuneracionOriginal(d));
    this.arl.set(this.arlOriginal(d));
    this.justificacion.set('');
    this.resultado.set(null);
    const el = this.dialogo().nativeElement;
    if (!el.open) el.showModal();
  }

  cerrar(): void { const el = this.dialogo().nativeElement; if (el.open) el.close(); }

  remuneracionOriginal(d: DetalleActa): string { return valorDeTexto(OPCIONES_REMUNERACION, d.resumen.remuneracionSipra); }
  arlOriginal(d: DetalleActa): string { return valorDeTexto(OPCIONES_ARL, d.resumen.responsableArlSipra); }
  hayCambios(d: DetalleActa): boolean {
    return (this.remuneracion() !== this.remuneracionOriginal(d) && this.remuneracion() !== '') || (this.arl() !== this.arlOriginal(d) && this.arl() !== '');
  }
  textoResultado(r: CorreccionDatosPractica): string { return TEXTO_RESULTADO_CORRECCION[r.actaIniciacion] ?? ''; }

  async guardar(d: DetalleActa): Promise<void> {
    const dto: { tipoRemuneracion?: string; responsableArl?: string; justificacion: string } = { justificacion: this.justificacion().trim() };
    if (this.remuneracion() !== '' && this.remuneracion() !== this.remuneracionOriginal(d)) dto.tipoRemuneracion = this.remuneracion();
    if (this.arl() !== '' && this.arl() !== this.arlOriginal(d)) dto.responsableArl = this.arl();
    const r = await this.estado.corregirDatos(d.practicaId, dto);
    if (r) this.resultado.set(r);
  }
}
