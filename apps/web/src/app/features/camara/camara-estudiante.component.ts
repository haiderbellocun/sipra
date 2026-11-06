import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Documento, EstadoCamaraEstudiante } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { textoTipoEsperado, tonoEstudiante } from './camara.util';

/** Lo que ve quien no ha cargado nada de este tipo (no se consulta a la API). */
const SIN_CARGAR: EstadoCamaraEstudiante = {
  estado: 'pendiente', etiqueta: 'Pendiente de cargar', puedeReenviar: true,
  que: 'Todavía no has cargado tu certificado de Cámara de Comercio.', hacer: 'Descárgalo desde la Cámara de Comercio de tu ciudad y cárgalo en PDF.',
};

/**
 * El certificado dentro del expediente del estudiante (no es un panel aparte). Responde siempre dos preguntas: qué pasó y qué debo hacer.
 * El texto viene del servidor en lenguaje humano: aquí nunca se muestra un nombre interno de estado, un código, la confianza, un
 * hash ni lo que el sistema leyó del documento. La versión anterior queda en segundo plano; la actual manda.
 */
@Component({
  selector: 'sipra-camara-estudiante',
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
        <span class="nombre">{{ nombre() }}</span>
        @if ((ultimo()?.version ?? 0) > 1) { <span class="pista">versión {{ ultimo()?.version }}</span> }
        <span class="etiqueta etiqueta--{{ tono(e) }}" data-camara-estado>{{ e.etiqueta }}</span>
        @if (e.estado === 'pendiente' && !ultimo() && puedeCargar()) { <button type="button" class="boton compacto" (click)="cargar.emit()">Cargar</button> }
      </div>
      <div class="caja {{ tono(e) }}" role="status" data-camara-mensaje>
        <div class="pq">
          <p><span class="rotulo">¿Qué pasó?</span> {{ e.que }}</p>
          <p><span class="rotulo">¿Qué debo hacer?</span> {{ e.hacer }}</p>
        </div>
        @if (e.puedeReenviar && ultimo() && puedeCargar()) {
          <div class="accion"><button type="button" class="boton boton--primario" (click)="cargar.emit()">{{ e.estado === 'rechazado' ? 'Subir un nuevo certificado' : 'Subir nueva versión' }}</button></div>
        }
      </div>
      @if (ultimo(); as u) { <p class="archivo">{{ u.nombreOriginal }} · {{ u.cargadoEn | date: 'd MMM y, HH:mm' }}</p> }
      @if (anteriores().length > 0) {
        <ul class="anteriores" aria-label="Versiones anteriores del certificado">
          @for (v of anteriores(); track v.id) { <li>Versión {{ v.version }} · {{ v.cargadoEn | date: 'd MMM y, HH:mm' }}</li> }
        </ul>
      }
    } @else if (error()) {
      <div class="doc-cab"><span class="nombre">{{ nombre() }}</span></div>
      <p class="pista" role="status">No pudimos consultar el estado de tu certificado ahora. Inténtalo de nuevo en un momento.</p>
    } @else {
      <div class="doc-cab"><span class="nombre">{{ nombre() }}</span></div>
      <p class="pista" role="status">Consultando el estado de tu certificado…</p>
    }
  `,
})
export class CamaraEstudianteComponent {
  private readonly api = inject(ApiService);

  readonly practicaId = input.required<string>();
  /** Tipo documental de esta fila del expediente (camara_comercio). */
  readonly tipo = input<string>('camara_comercio');
  /** Los documentos del expediente: cuando cambian (se cargó una versión, hubo una decisión) se vuelve a consultar. */
  readonly documentos = input<Documento[]>([]);
  readonly puedeCargar = input<boolean>(false);
  /** Pide al expediente que lleve a la zona de carga con el certificado elegido. */
  readonly cargar = output<void>();

  readonly estado = signal<EstadoCamaraEstudiante | null>(null);
  readonly error = signal(false);

  constructor() {
    effect(() => {
      const id = this.practicaId();
      const propios = this.propios();
      // Cualquier cambio en los documentos (versión nueva, estado nuevo) renueva la consulta.
      propios.map((d) => `${d.id}:${d.estado}:${d.version}`).join('|');
      untracked(() => {
        // Sin documentos de ESTE tipo no hay nada que consultar: se evita mostrar el estado de otro tipo de certificado.
        if (propios.length === 0) { this.estado.set(SIN_CARGAR); this.error.set(false); return; }
        void this.consultar(id);
      });
    });
  }

  private propios(): Documento[] { return this.documentos().filter((d) => d.tipo === this.tipo()); }

  private async consultar(id: string): Promise<void> {
    try {
      this.estado.set(await firstValueFrom(this.api.estadoDeMiCamara(id)));
      this.error.set(false);
    } catch {
      this.error.set(true);
    }
  }

  nombre(): string { return textoTipoEsperado(this.tipo()); }
  ultimo(): Documento | null { return [...this.propios()].sort((a, b) => b.version - a.version)[0] ?? null; }
  /** Las anteriores a la actual, de la más reciente a la más antigua: en segundo plano. */
  anteriores(): Documento[] { return [...this.propios()].sort((a, b) => b.version - a.version).slice(1); }
  tono(e: EstadoCamaraEstudiante): string { return tonoEstudiante(e.estado); }
}
