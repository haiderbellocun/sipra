import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { ResultadoAntidiscriminacion, Vacante } from '@core/models/modelos';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

@Component({
  selector: 'sipra-bolsa',
  standalone: true,
  imports: [EsqueletoComponent, FormsModule, DatePipe, EstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .vacante { padding:1rem 0; border-bottom:1px solid var(--borde); }
    .vacante:last-child { border-bottom:none; }
    .cab { display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap; }
    .cab .titulo { font-weight:640; flex:1; min-width:200px; }
    .catalogos { font-size:0.78rem; color:var(--texto-tenue); margin-top:0.3rem; }
    .catalogos code { background:var(--superficie-2); padding:0.08rem 0.32rem; border-radius:4px; }
    .hallazgo { font-size:0.82rem; padding:0.4rem 0.6rem; border-radius:var(--r-sm);
                background:var(--peligro-suave); color:var(--peligro); margin-top:0.35rem; }
  `],
  template: `
    <h1>Bolsa de empleo</h1>

    <div class="aviso aviso--info" style="margin-bottom:1.2rem;max-width:74ch">
      <strong>Módulo construido, no activable todavía.</strong> La operación pública de la bolsa
      depende del acto administrativo de modificación de la autorización ante la Unidad del
      Servicio Público de Empleo. Las vacantes en marco <em>práctica</em> no constituyen
      intermediación laboral y no entran en el reporte diario.
    </div>

    <div class="tarjeta" style="margin-bottom:1.2rem">
      <h2>Filtro antidiscriminación</h2>
      <p class="pista">
        Escriba el texto de una vacante y valídelo. No es una advertencia: si hay hallazgos, la
        publicación se bloquea (Ley 931 de 2004 y concordantes).
      </p>
      <div class="campo">
        <textarea [(ngModel)]="texto"
                  placeholder="Ej.: se busca persona entre 20 y 30 años con foto reciente y buena presencia"></textarea>
      </div>
      <button type="button" class="boton boton--primario"
              [disabled]="texto().trim().length < 5 || validando()" (click)="validar()">
        Validar texto
      </button>

      @if (resultado(); as r) {
        @if (r.publicable) {
          <div class="aviso aviso--ok" style="margin-top:0.9rem">
            El texto no contiene requisitos discriminatorios: puede publicarse.
          </div>
        } @else {
          <div class="aviso aviso--error" style="margin-top:0.9rem">
            La publicación quedaría bloqueada. Hallazgos:
          </div>
          @for (hallazgo of r.hallazgos; track hallazgo.categoria) {
            <div class="hallazgo">
              <strong>{{ hallazgo.categoria }}</strong>: «{{ hallazgo.fragmento }}» —
              {{ hallazgo.norma }}
            </div>
          }
        }
      }
    </div>

    <div class="tarjeta">
      <h2>Vacantes</h2>
      @if (cargando()) {
        <sipra-esqueleto tipo="tarjetas" [cantidad]="3" />
      } @else if (vacantes().length === 0) {
        <div class="vacio">No hay vacantes visibles para su perfil.</div>
      } @else {
        @for (vacante of vacantes(); track vacante.id) {
          <div class="vacante">
            <div class="cab">
              <span class="titulo">{{ vacante.titulo }}</span>
              <sipra-estado [valor]="vacante.marco" />
              <sipra-estado [valor]="vacante.estado" />
            </div>
            <div class="pista">
              {{ vacante.empresaRazonSocial ?? '—' }} ·
              {{ vacante.vacantesDisponibles }} cupo(s)
              @if (vacante.vigenteHasta) {
                · vigente hasta {{ vacante.vigenteHasta | date: 'd MMM y' }}
              }
            </div>
            <p style="margin:0.5rem 0 0.3rem">{{ vacante.descripcion }}</p>
            <div class="catalogos">
              CNO <code>{{ vacante.codigoCno }}</code> ·
              CIIU <code>{{ vacante.codigoCiiu }}</code> ·
              DIVIPOLA <code>{{ vacante.divipolaMunicipio }}</code> ·
              nivel {{ vacante.nivelEducativo | etiqueta }}
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class BolsaComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly vacantes = signal<Vacante[]>([]);
  readonly cargando = signal(true);
  readonly texto = signal('');
  readonly resultado = signal<ResultadoAntidiscriminacion | null>(null);
  readonly validando = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.vacantes.set(await firstValueFrom(this.api.listarVacantes()));
    } finally {
      this.cargando.set(false);
    }
  }

  async validar(): Promise<void> {
    this.validando.set(true);
    try {
      this.resultado.set(await firstValueFrom(this.api.validarTextoVacante(this.texto())));
    } finally {
      this.validando.set(false);
    }
  }
}
