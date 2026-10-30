import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Documento, EstadoActaEstudiante } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { tonoEstudiante } from './actas.util';

/**
 * El Acta de iniciación dentro del expediente del estudiante (no es un panel aparte). Responde siempre dos preguntas: qué pasó y
 * qué debo hacer. El texto viene del servidor en lenguaje humano: aquí nunca se muestra un nombre interno de estado, un código de
 * discrepancia ni lo que el sistema leyó del documento. La versión anterior se ve en segundo plano; la actual manda.
 */
@Component({
  selector: 'sipra-acta-estudiante',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .doc-cab { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap; }
    .doc-cab .nombre { font-weight:700; }
    .pq { display:grid; gap:var(--sp-1); margin:var(--sp-2) 0 0; }
    .pq p { margin:0; font-size:var(--fs-sm); overflow-wrap:anywhere; }
    .pq .rotulo { font-weight:700; }
    .accion { margin-top:var(--sp-2); }
    .caja { margin-top:var(--sp-2); padding:var(--sp-3); border-radius:var(--r-sm); background:var(--aviso-suave); }
    .caja.ok { background:var(--ok-suave); } .caja.peligro { background:var(--peligro-suave); } .caja.info { background:var(--info-suave); } .caja.neutra { background:var(--superficie-2); }
    ul.anteriores { list-style:none; margin:var(--sp-2) 0 0; padding:0; display:grid; gap:2px; font-size:var(--fs-sm); color:var(--texto-tenue); }
    .archivo { margin:var(--sp-1) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }
  `],
  template: `
    @if (estado(); as e) {
      <div class="doc-cab">
        <span class="nombre">Acta de iniciación</span>
        @if ((e.versionActual ?? 0) > 1) { <span class="pista">versión {{ e.versionActual }}</span> }
        <span class="etiqueta etiqueta--{{ tono(e) }}" data-acta-estado>{{ e.etiqueta }}</span>
        @if (e.estado === 'sin_cargar' && puedeCargar()) { <button type="button" class="boton compacto" (click)="cargar.emit()">Cargar</button> }
      </div>
      <div class="caja {{ tono(e) }}" role="status" data-acta-mensaje>
        <div class="pq">
          <p><span class="rotulo">¿Qué pasó?</span> {{ e.que }}</p>
          <p><span class="rotulo">¿Qué debo hacer?</span> {{ e.hacer }}</p>
        </div>
        @if (e.puedeReenviar && e.estado !== 'sin_cargar' && puedeCargar()) {
          <div class="accion"><button type="button" class="boton boton--primario" (click)="cargar.emit()">{{ e.estado === 'rechazada' ? 'Subir una nueva Acta' : 'Subir nueva versión' }}</button></div>
        }
      </div>
      @if (ultimo(); as u) { <p class="archivo">{{ u.nombreOriginal }} · {{ u.cargadoEn | date: 'd MMM y, HH:mm' }}</p> }
      @if (anteriores(e).length > 0) {
        <ul class="anteriores" aria-label="Versiones anteriores del Acta">
          @for (v of anteriores(e); track v.version) { <li>Versión {{ v.version }} · {{ v.etiqueta }}</li> }
        </ul>
      }
    } @else if (error()) {
      <div class="doc-cab"><span class="nombre">Acta de iniciación</span></div>
      <p class="pista" role="status">No pudimos consultar el estado de tu Acta ahora. Inténtalo de nuevo en un momento.</p>
    } @else {
      <div class="doc-cab"><span class="nombre">Acta de iniciación</span></div>
      <p class="pista" role="status">Consultando el estado de tu Acta…</p>
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
  tono(e: EstadoActaEstudiante): string { return tonoEstudiante(e.estado); }
}
