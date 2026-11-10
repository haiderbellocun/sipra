import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Documento, EstadoCamaraEstudiante } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { ExplicacionDocumentoComponent } from '@shared/components/explicacion-documento.component';
import { SenalEstadoComponent, TonoV3 } from '@shared/components/senal-estado.component';
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
        <span class="nombre">{{ nombre() }}</span>
        @if ((ultimo()?.version ?? 0) > 1) { <span class="ver">versión {{ ultimo()?.version }}</span> }
        <sipra-senal-estado data-camara-estado [tono]="tono(e)" [texto]="e.etiqueta" />
        @if (e.estado === 'pendiente' && !ultimo() && puedeCargar()) { <button type="button" class="boton compacto" (click)="cargar.emit()">Cargar</button> }
      </div>
      <sipra-explicacion-documento data-camara-mensaje [tono]="tono(e)" [que]="e.que" [hacer]="e.hacer">
        @if (e.puedeReenviar && ultimo() && puedeCargar()) { <button type="button" class="boton boton--primario" (click)="cargar.emit()">{{ e.estado === 'rechazado' ? 'Subir un nuevo certificado' : 'Subir nueva versión' }}</button> }
      </sipra-explicacion-documento>
      @if (ultimo(); as u) { <p class="archivo">{{ u.nombreOriginal }} · {{ u.cargadoEn | date: 'd MMM y, HH:mm' }}</p> }
      @if (anteriores().length > 0) {
        <ul class="anteriores" aria-label="Versiones anteriores del certificado">
          @for (v of anteriores(); track v.id) { <li>Versión {{ v.version }} · {{ v.cargadoEn | date: 'd MMM y, HH:mm' }}</li> }
        </ul>
      }
    } @else if (error()) {
      <div class="doc-cab"><span class="nombre">{{ nombre() }}</span></div>
      <p class="espera" role="status">No pudimos consultar el estado de tu certificado ahora. Inténtalo de nuevo en un momento.</p>
    } @else {
      <div class="doc-cab"><span class="nombre">{{ nombre() }}</span></div>
      <p class="espera" role="status">Consultando el estado de tu certificado…</p>
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
  tono(e: EstadoCamaraEstudiante): TonoV3 { return tonoEstudiante(e.estado) as TonoV3; }
}
