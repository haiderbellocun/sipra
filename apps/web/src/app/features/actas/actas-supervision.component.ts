import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { FiltrosActas } from '@core/models/modelos';
import { ActasMesaEstado } from './actas-mesa.estado';
import { estadoVersion } from './actas.util';

/**
 * Supervisión de la Mesa de Actas (coordinación y administración): cuánto hay libre, tomado, por vencer y vencido, la carga por
 * funcionario y los casos con estado inconsistente. Es solo lectura y atajos a la bandeja: no hay reasignación ni arrastre.
 * La reserva de otra persona se libera desde el caso, con confirmación.
 */
@Component({
  selector: 'sipra-actas-supervision',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cifras { display:grid; gap:var(--sp-2); grid-template-columns:repeat(auto-fit, minmax(8.5rem, 1fr)); margin:var(--sp-3) 0; padding:0; list-style:none; }
    .cifras > li { display:grid; }
    .cifra { width:100%; border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-2) var(--sp-3); display:grid; gap:2px; text-align:left; background:var(--superficie); color:inherit; font:inherit; min-height:44px; }
    button.cifra { cursor:pointer; }
    button.cifra:hover { background:var(--superficie-2); }
    .cifra .n { font-size:1.375rem; font-weight:700; line-height:1.1; font-variant-numeric:tabular-nums; }
    .cifra .t { font-size:var(--fs-xs); color:var(--texto-tenue); }
    .cifra.t-aviso { border-color:var(--aviso); background:var(--aviso-suave); }
    .tabla { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
    .tabla th, .tabla td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--borde); }
    .envoltura { overflow-x:auto; }
    ul.inc { list-style:none; margin:var(--sp-2) 0 0; padding:0; display:grid; gap:var(--sp-1); }
    ul.inc li { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap; padding:var(--sp-2) var(--sp-3); border-radius:var(--r-sm); background:var(--peligro-suave); font-size:var(--fs-sm); }
    h3 { margin:var(--sp-4) 0 var(--sp-1); font-size:var(--fs-base); }
  `],
  template: `
    <section class="tarjeta" aria-labelledby="t-sup" data-supervision>
      <div style="display:flex; justify-content:space-between; gap:var(--sp-2); flex-wrap:wrap; align-items:center">
        <h2 id="t-sup" style="margin:0">Supervisión</h2>
        <button type="button" class="boton compacto" [disabled]="estado.cargandoSupervision()" (click)="estado.cargarSupervision()">{{ estado.supervision() ? 'Actualizar' : 'Cargar la supervisión' }}</button>
      </div>
      @if (estado.supervision(); as s) {
        <ul class="cifras" aria-label="Estado de las reservas">
          <li><button type="button" class="cifra" (click)="filtrar({ reserva: 'libres' })"><span class="n">{{ s.libres }}</span><span class="t">Libres</span></button></li>
          <li><button type="button" class="cifra" (click)="filtrar({ reserva: 'otros' })"><span class="n">{{ s.tomadas }}</span><span class="t">Tomados</span></button></li>
          <li><span class="cifra" [class.t-aviso]="s.porVencer > 0"><span class="n">{{ s.porVencer }}</span><span class="t">Por vencer (5 min)</span></span></li>
          <li><button type="button" class="cifra" [class.t-aviso]="s.vencidas > 0" (click)="filtrar({ reserva: 'vencidas' })"><span class="n">{{ s.vencidas }}</span><span class="t">Vencidos</span></button></li>
          <li><button type="button" class="cifra" (click)="filtrar({ conDiscrepancias: 'si' })"><span class="n">{{ s.conDiscrepanciaCritica }}</span><span class="t">Discrepancias críticas</span></button></li>
          <li><button type="button" class="cifra" (click)="filtrar({ documentoIncorrecto: 'si' })"><span class="n">{{ s.documentoIncorrecto }}</span><span class="t">Documentos incorrectos</span></button></li>
        </ul>

        @if (s.inconsistentes > 0) {
          <div class="aviso aviso--error" role="alert" data-inconsistencias style="margin:0 0 var(--sp-3)">
            <strong>{{ s.inconsistentes }} {{ s.inconsistentes === 1 ? 'caso requiere' : 'casos requieren' }} revisión administrativa.</strong>
            El documento ya tiene una decisión, pero la validación sigue en revisión. No se corrigen solos ni se pueden decidir de la forma habitual.
            <ul class="inc">
              @for (i of s.inconsistencias; track i.validacionId) {
                <li>
                  <span>Acta v{{ i.version }} · documento {{ estadoDoc(i.estadoDocumento) }}</span>
                  <button type="button" class="boton compacto" (click)="abrir.emit(i.validacionId)">Abrir el caso</button>
                </li>
              }
            </ul>
          </div>
        }

        <h3>Carga por funcionario</h3>
        @if (s.funcionarios.length === 0) { <p class="pista">Todavía nadie ha tomado ni decidido casos.</p> }
        @else {
          <div class="envoltura">
            <table class="tabla">
              <caption class="sr-only">Reservas y decisiones por funcionario</caption>
              <thead><tr><th scope="col">Funcionario</th><th scope="col">Reservas vigentes</th><th scope="col">Por vencer</th><th scope="col">Decididos (7 días)</th></tr></thead>
              <tbody>
                @for (f of s.funcionarios; track f.funcionarioId) {
                  <tr><th scope="row">{{ f.nombre }}</th><td>{{ f.reservasVigentes }}</td><td>{{ f.reservasPorVencer }}</td><td>{{ f.decididas7Dias }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }

        <h3>Por estado</h3>
        <p class="pista" style="margin:0">
          @for (e of estados(s.porEstado); track e[0]; let ultimo = $last) { {{ etiqueta(e[0]) }}: <strong>{{ e[1] }}</strong>@if (!ultimo) { · } }
        </p>
      }
    </section>
  `,
})
export class ActasSupervisionComponent {
  protected readonly estado = inject(ActasMesaEstado);
  /** Abre un caso (los inconsistentes) en el detalle. */
  readonly abrir = output<string>();
  readonly aplicar = output<FiltrosActas>();

  filtrar(f: FiltrosActas): void { this.aplicar.emit(f); }
  estados(porEstado: Record<string, number>): Array<[string, number]> { return Object.entries(porEstado); }
  etiqueta(estado: string): string { return estadoVersion(estado).texto; }
  estadoDoc(estado: string): string { return ({ aprobado: 'aprobado', devuelto: 'devuelto', rechazado: 'rechazado' } as Record<string, string>)[estado] ?? estado; }
}
