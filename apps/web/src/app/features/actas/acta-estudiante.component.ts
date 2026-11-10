import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Documento, EstadoActaEstudiante } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { ExplicacionDocumentoComponent } from '@shared/components/explicacion-documento.component';
import { SenalEstadoComponent, TonoV3 } from '@shared/components/senal-estado.component';
import { tonoEstudiante } from './actas.util';

/**
 * El Acta de iniciación dentro del expediente del estudiante (no es un panel aparte). Responde siempre dos preguntas: qué pasó y
 * qué debo hacer. El texto viene del servidor en lenguaje humano: aquí nunca se muestra un nombre interno de estado, un código de
 * discrepancia ni lo que el sistema leyó del documento. La versión anterior se ve en segundo plano; la actual manda.
 */
@Component({
  selector: 'sipra-acta-estudiante',
  standalone: true,
  imports: [DatePipe, SenalEstadoComponent, ExplicacionDocumentoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .doc-cab { display:flex; gap:8px 14px; align-items:center; flex-wrap:wrap; }
    .doc-cab .nombre { flex:1; min-width:150px; font-size:14px; font-weight:600; color:var(--text-primary); }
    .ver { font:500 12px/16px var(--fuente-mono); color:var(--text-muted); }
    :host-context([data-theme='dark']) .ver, :host-context([data-theme='dark']) .archivo, :host-context([data-theme='dark']) ul.anteriores { color:#94aeac; }
    .archivo { margin:6px 0 0; font:500 12px/16px var(--fuente-mono); color:var(--text-secondary); }
    ul.anteriores { list-style:none; margin:4px 0 0; padding:0; display:grid; gap:2px; font:500 12px/18px var(--fuente-mono); color:var(--text-secondary); }
    .espera { margin:6px 0 0; font-size:13px; color:var(--text-secondary); }
  `],
  template: `
    @if (estado(); as e) {
      <div class="doc-cab">
        <span class="nombre">Acta de iniciación</span>
        @if ((e.versionActual ?? 0) > 1) { <span class="ver">versión {{ e.versionActual }}</span> }
        <sipra-senal-estado data-acta-estado [tono]="tono(e)" [texto]="e.etiqueta" />
        @if (e.estado === 'sin_cargar' && puedeCargar()) { <button type="button" class="boton compacto" (click)="cargar.emit()">Cargar</button> }
      </div>
      <sipra-explicacion-documento data-acta-mensaje [tono]="tono(e)" [que]="e.que" [hacer]="e.hacer">
        @if (e.puedeReenviar && e.estado !== 'sin_cargar' && puedeCargar()) { <button type="button" class="boton boton--primario" (click)="cargar.emit()">{{ e.estado === 'rechazada' ? 'Subir una nueva Acta' : 'Subir nueva versión' }}</button> }
      </sipra-explicacion-documento>
      @if (ultimo(); as u) { <p class="archivo">{{ u.nombreOriginal }} · {{ u.cargadoEn | date: 'd MMM y, HH:mm' }}</p> }
      @if (anteriores(e).length > 0) {
        <ul class="anteriores" aria-label="Versiones anteriores del Acta">
          @for (v of anteriores(e); track v.version) { <li>Versión {{ v.version }} · {{ v.etiqueta }}</li> }
        </ul>
      }
    } @else if (error()) {
      <div class="doc-cab"><span class="nombre">Acta de iniciación</span></div>
      <p class="espera" role="status">No pudimos consultar el estado de tu Acta ahora. Inténtalo de nuevo en un momento.</p>
    } @else {
      <div class="doc-cab"><span class="nombre">Acta de iniciación</span></div>
      <p class="espera" role="status">Consultando el estado de tu Acta…</p>
    }
  `,
})
export class ActaEstudianteComponent {
  private readonly api = inject(ApiService);

  readonly practicaId = input.required<string>();
  /** Los documentos del expediente: cuando cambian (se cargó una versión, hubo una decisión) se vuelve a consultar. */
  readonly documentos = input<Documento[]>([]);
  readonly puedeCargar = input<boolean>(false);
  /** Pide al expediente que lleve a la zona de carga con el Acta elegida. */
  readonly cargar = output<void>();

  readonly estado = signal<EstadoActaEstudiante | null>(null);
  readonly error = signal(false);

  constructor() {
    effect(() => {
      const id = this.practicaId();
      // Cualquier cambio en los documentos (versión nueva, estado nuevo) renueva la consulta.
      this.documentos().map((d) => `${d.id}:${d.estado}:${d.version}`).join('|');
      untracked(() => { void this.consultar(id); });
    });
  }

  private async consultar(id: string): Promise<void> {
    try {
      this.estado.set(await firstValueFrom(this.api.estadoDeMiActa(id)));
      this.error.set(false);
    } catch {
      this.error.set(true);
    }
  }

  ultimo(): Documento | null {
    return this.documentos().filter((d) => d.tipo === 'acta_inicio').sort((a, b) => b.version - a.version)[0] ?? null;
  }
  /** Las anteriores a la actual, de la más reciente a la más antigua: en segundo plano. */
  anteriores(e: EstadoActaEstudiante) {
    return [...e.versiones].sort((a, b) => b.version - a.version).filter((v) => v.version !== e.versionActual);
  }
  tono(e: EstadoActaEstudiante): TonoV3 { return tonoEstudiante(e.estado) as TonoV3; }
}
