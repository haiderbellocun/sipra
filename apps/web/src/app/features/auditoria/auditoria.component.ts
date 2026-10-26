import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

interface Registro {
  actorCorreo: string | null;
  actorRol: string | null;
  accion: string;
  entidad: string;
  entidadId: string | null;
  justificacion: string | null;
  metadatos: Record<string, unknown> | null;
  ocurridoEn: string;
}

@Component({
  selector: 'sipra-auditoria',
  standalone: true,
  imports: [EsqueletoComponent, FormsModule, DatePipe, JsonPipe, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .barra { display:flex; gap:0.8rem; align-items:flex-end; flex-wrap:wrap; margin-bottom:1.1rem; }
    .barra .campo { margin:0; min-width:190px; }
    td.compacto { white-space:nowrap; }
    .meta { font-size:0.76rem; color:var(--texto-tenue); max-width:44ch;
            overflow:hidden; text-overflow:ellipsis; }
  `],
  template: `
    <h1>Auditoría</h1>
    <p class="pista" style="max-width:74ch;margin-bottom:1.2rem">
      Registro inmutable. La tabla no admite <code>UPDATE</code> ni <code>DELETE</code>: lo impiden
      un disparador en el motor y la revocación de esos permisos al rol de aplicación. Ninguna
      función de la aplicación puede modificar el histórico.
    </p>

    <div class="barra">
      <div class="campo">
        <label for="f-entidad">Entidad</label>
        <select id="f-entidad" [(ngModel)]="entidad" (ngModelChange)="recargar()">
          <option value="">Todas</option>
          <option value="practica">Prácticas</option>
          <option value="documento">Documentos</option>
          <option value="empresa">Empresas</option>
          <option value="vacante">Vacantes</option>
          <option value="usuario">Sesiones</option>
        </select>
      </div>
    </div>

    <div class="tarjeta" style="padding:0">
      @if (cargando()) {
        <sipra-esqueleto tipo="filas" [cantidad]="6" />
      } @else if (registros().length === 0) {
        <div class="vacio">Sin registros para el filtro seleccionado.</div>
      } @else {
        <div class="tabla-envoltura">
          <table class="tabla">
            <thead>
              <tr>
                <th>Momento</th><th>Actor</th><th>Acción</th>
                <th>Entidad</th><th>Justificación</th><th>Metadatos</th>
              </tr>
            </thead>
            <tbody>
              @for (registro of registros(); track $index) {
                <tr>
                  <td class="compacto pista">{{ registro.ocurridoEn | date: 'd MMM, HH:mm:ss' }}</td>
                  <td>
                    {{ registro.actorCorreo ?? '—' }}
                    <div class="pista">{{ registro.actorRol | etiqueta }}</div>
                  </td>
                  <td>{{ registro.accion | etiqueta }}</td>
                  <td class="pista">{{ registro.entidad }}</td>
                  <td class="pista">{{ registro.justificacion ?? '—' }}</td>
                  <td class="meta mono">
                    {{ registro.metadatos ? (registro.metadatos | json) : '—' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AuditoriaComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly registros = signal<Registro[]>([]);
  readonly cargando = signal(true);
  readonly entidad = signal('');

  async ngOnInit(): Promise<void> {
    await this.recargar();
  }

  async recargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const datos = await firstValueFrom(this.api.auditoria(this.entidad() || undefined, 120));
      this.registros.set(datos as unknown as Registro[]);
    } finally {
      this.cargando.set(false);
    }
  }
}
