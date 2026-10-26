import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { TableroCumplimiento } from '@core/models/modelos';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

interface EntradaCatalogo {
  tipo: string; norma: string; responsable: string; efecto: string; descripcion: string;
}

@Component({
  selector: 'sipra-cumplimiento',
  standalone: true,
  imports: [EsqueletoComponent, RouterLink, DatePipe, EstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cifras { display:grid; gap:0.9rem; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); margin-bottom:1.4rem; }
    .cifra { padding:0.9rem 1rem; }
    .cifra .n { font-size:1.7rem; font-weight:700; line-height:1.1; }
    .cifra .t { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.045em; color:var(--texto-tenue); }
    .cifra.vencida .n { color:var(--peligro); }
    .cifra.critica .n { color:var(--peligro); }
    .cifra.alerta .n { color:var(--aviso); }
    .cifra.cumplida .n { color:var(--ok); }
    td.compacto { white-space:nowrap; }
    .dias { font-weight:640; }
    .dias.negativo { color:var(--peligro); }
    .catalogo { margin-top:1.6rem; }
    .catalogo li { margin-bottom:0.55rem; font-size:0.88rem; }
  `],
  template: `
    <h1>Cumplimiento normativo</h1>
    <p class="pista" style="max-width:74ch;margin-bottom:1.3rem">
      Una obligación no es una validación sobre un documento: es un estado con fecha límite que
      puede estar vencido sin que nadie haya cargado nada. El sistema las crea automáticamente al
      abrirse la práctica.
    </p>

    @if (cargando()) {
      <sipra-esqueleto tipo="cifras" [cantidad]="4" />
    } @else if (tablero(); as t) {
      @if (t.practicasBloqueadas > 0) {
        <div class="aviso aviso--error" style="margin-bottom:1.2rem">
          <strong>{{ t.practicasBloqueadas }}</strong> práctica(s) detenidas en validación por la
          compuerta de afiliación a ARL (Decreto 055 de 2015). Ninguna puede activarse hasta que la
          afiliación quede registrada con fecha anterior al inicio.
        </div>
      }

      <div class="cifras">
        <div class="tarjeta cifra vencida"><div class="n">{{ t.resumen.vencida }}</div><div class="t">Vencidas</div></div>
        <div class="tarjeta cifra critica"><div class="n">{{ t.resumen.critica }}</div><div class="t">Críticas (≤3 días)</div></div>
        <div class="tarjeta cifra alerta"><div class="n">{{ t.resumen.alerta }}</div><div class="t">Alerta (≤10 días)</div></div>
        <div class="tarjeta cifra"><div class="n">{{ t.resumen.vigente }}</div><div class="t">Vigentes</div></div>
        <div class="tarjeta cifra cumplida"><div class="n">{{ t.resumen.cumplida }}</div><div class="t">Cumplidas</div></div>
      </div>

      <div class="tarjeta" style="padding:0">
        @if (t.filas.length === 0) {
          <div class="vacio">No hay obligaciones próximas a vencer en su alcance.</div>
        } @else {
          <div class="tabla-envoltura">
            <table class="tabla">
              <thead>
                <tr>
                  <th>Obligación</th><th>Norma</th><th>Responsable</th>
                  <th>Efecto</th><th>Fecha límite</th><th>Días</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                @for (fila of t.filas; track fila.obligacionId) {
                  <tr>
                    <td>{{ fila.tipo | etiqueta }}</td>
                    <td class="pista">{{ fila.norma }}</td>
                    <td>{{ fila.responsable | etiqueta }}</td>
                    <td class="pista">{{ fila.efecto | etiqueta }}</td>
                    <td class="compacto">{{ fila.fechaLimite | date: 'd MMM y' }}</td>
                    <td class="compacto dias" [class.negativo]="fila.diasRestantes < 0">
                      {{ fila.diasRestantes }}
                    </td>
                    <td class="compacto"><sipra-estado [valor]="fila.semaforo" /></td>
                    <td class="compacto">
                      <a [routerLink]="['/practicas', fila.practicaId]">Ver expediente</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="tarjeta catalogo">
        <h2>Obligaciones administradas</h2>
        <ul>
          @for (entrada of catalogo(); track entrada.tipo) {
            <li>
              <strong>{{ entrada.tipo | etiqueta }}</strong> — {{ entrada.descripcion }}.
              <span class="pista">
                {{ entrada.norma }} · responsable: {{ entrada.responsable | etiqueta }} ·
                {{ entrada.efecto | etiqueta }}
              </span>
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class CumplimientoComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly tablero = signal<TableroCumplimiento | null>(null);
  readonly catalogo = signal<EntradaCatalogo[]>([]);
  readonly cargando = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      const [tablero, catalogo] = await Promise.all([
        firstValueFrom(this.api.tableroCumplimiento(90)),
        firstValueFrom(this.api.catalogoObligaciones()),
      ]);
      this.tablero.set(tablero);
      this.catalogo.set(catalogo);
    } finally {
      this.cargando.set(false);
    }
  }
}
