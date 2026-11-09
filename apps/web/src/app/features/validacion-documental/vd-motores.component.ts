import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DocumentoDeExpediente } from '@core/models/validacion-documental.model';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { traducirErrorEps } from '../eps/eps.util';
import { ActasDetalleComponent } from '../actas/actas-detalle.component';
import { ActasMesaEstado } from '../actas/actas-mesa.estado';
import { CamaraDetalleComponent } from '../camara/camara-detalle.component';
import { CamaraMesaEstado } from '../camara/camara-mesa.estado';
import { EpsDetalleComponent } from '../eps/eps-detalle.component';
import { EpsMesaEstado } from '../eps/eps-mesa.estado';
import { RutDetalleComponent } from '../rut/rut-detalle.component';
import { RutMesaEstado } from '../rut/rut-mesa.estado';

/**
 * Los cuatro motores se muestran con SUS PROPIOS componentes de detalle (visor, resultado, evidencia, reserva y decisión): la Mesa
 * Documental no duplica ni visores ni tablas, y la reserva y la decisión siguen siendo del motor, contra su propio endpoint. Cada
 * envoltorio solo (1) le da su estado al componente, (2) le indica qué caso mostrar y (3) AVISA cuando algo cambió (se tomó, se liberó
 * o se decidió) para que el expediente y la cola actualicen sus metadatos sin recargar la aplicación.
 */
const ESTILO = ':host { display:block; } :host ::ng-deep .atras { display:none !important; }';

@Component({
  selector: 'sipra-vd-eps',
  standalone: true,
  imports: [EpsDetalleComponent],
  providers: [EpsMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILO],
  template: `<sipra-eps-detalle />`,
})
export class VdEpsComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(EpsMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.caso.decision}|${d.acceso.reserva.estado}|${d.caso.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

@Component({
  selector: 'sipra-vd-acta',
  standalone: true,
  imports: [ActasDetalleComponent],
  providers: [ActasMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILO],
  template: `<sipra-actas-detalle />`,
})
export class VdActaComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(ActasMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.cargarMotivos(); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.estado}|${d.reserva.estado}|${d.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

@Component({
  selector: 'sipra-vd-rut',
  standalone: true,
  imports: [RutDetalleComponent],
  providers: [RutMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILO],
  template: `<sipra-rut-detalle />`,
})
export class VdRutComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(RutMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.cargarMotivos(); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.estado}|${d.reserva.estado}|${d.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

@Component({
  selector: 'sipra-vd-camara',
  standalone: true,
  imports: [CamaraDetalleComponent],
  providers: [CamaraMesaEstado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILO],
  template: `<sipra-camara-detalle />`,
})
export class VdCamaraComponent {
  readonly validacionId = input.required<string>();
  readonly cambio = output<void>();
  private readonly estado = inject(CamaraMesaEstado);
  private ultimo = '';

  constructor() {
    effect(() => {
      const id = this.validacionId();
      untracked(() => { this.ultimo = ''; this.estado.seleccionId.set(id); void this.estado.cargarMotivos(); void this.estado.refrescarDetalle(); });
    });
    effect(() => {
      const d = this.estado.detalle();
      const firma = d ? `${d.estado}|${d.reserva.estado}|${d.version}` : '';
      untracked(() => { if (this.ultimo && firma && firma !== this.ultimo) this.cambio.emit(); if (firma) this.ultimo = firma; });
    });
  }
}

/**
 * Documento SIN motor especializado: PDF (por el enlace del flujo general, pedido solo al pulsar), estado, versión y las acciones del
 * flujo general únicamente si el servidor dice que la persona puede decidir. No aplica EPS, RUT, Cámara ni Actas.
 */
@Component({
  selector: 'sipra-vd-general',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .fila { display:flex; flex-wrap:wrap; gap:var(--sp-2); align-items:center; }
    dl.datos { display:grid; grid-template-columns:max-content 1fr; gap:var(--sp-1) var(--sp-3); margin:var(--sp-2) 0; }
    dl.datos dt { color:var(--texto-tenue); } dl.datos dd { margin:0; }
  `],
  template: `
    @let d = documento();
    <section aria-labelledby="vd-gen-titulo" data-vd-general>
      <h3 id="vd-gen-titulo" style="margin:0">{{ d.nombreHumano }}</h3>
      <dl class="datos">
        <dt>Estado</dt><dd>{{ d.estadoHumanoEtiqueta }}</dd>
        <dt>Versión</dt><dd>{{ d.version ?? '—' }}@if (d.versionesAnteriores > 0) { <span class="pista"> · {{ d.versionesAnteriores }} anterior(es)</span> }</dd>
        <dt>Revisión</dt><dd>Flujo general (este documento no tiene un motor de validación especializado).</dd>
      </dl>
      @if (d.documentoId) {
        <div class="fila">
          <button type="button" class="boton compacto" [disabled]="abriendo()" (click)="abrir(d.documentoId)">Abrir el documento</button>
          @if (enlace(); as url) { <a [href]="url" target="_blank" rel="noopener noreferrer" data-vd-enlace>Abrir en una pestaña nueva</a> }
        </div>
      }
      @if (!d.operable) {
        <p class="pista" role="note">Su perfil puede ver este documento, pero no decidirlo.</p>
      } @else if (d.puedeDecidir && d.documentoId) {
        <div class="campo" style="margin-top:var(--sp-3)">
          <label for="vd-gen-just">Justificación de la decisión (mínimo 10 caracteres)</label>
          <input id="vd-gen-just" type="text" [ngModel]="justificacion()" (ngModelChange)="justificacion.set($event)" />
        </div>
        <div class="acciones">
          <button type="button" class="boton compacto" [disabled]="!valida() || guardando()" (click)="decidir(d.documentoId, 'aprobar')">Aprobar</button>
          <button type="button" class="boton compacto" [disabled]="!valida() || guardando()" (click)="decidir(d.documentoId, 'devolver')">Devolver al estudiante</button>
          <button type="button" class="boton compacto boton--peligro" [disabled]="!valida() || guardando()" (click)="decidir(d.documentoId, 'rechazar')">Rechazar</button>
        </div>
      }
    </section>
  `,
})
export class VdGeneralComponent {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly documento = input.required<DocumentoDeExpediente>();
  readonly cambio = output<void>();
  readonly enlace = signal<string | null>(null);
  readonly abriendo = signal(false);
  readonly guardando = signal(false);
  readonly justificacion = signal('');

  constructor() {
    effect(() => { this.documento(); untracked(() => this.enlace.set(null)); });
  }

  valida(): boolean { return this.justificacion().trim().length >= 10; }

  async abrir(id: string): Promise<void> {
    this.abriendo.set(true);
    try { this.enlace.set((await firstValueFrom(this.api.enlaceDocumento(id))).url); } catch (e) { this.avisos.error(traducirErrorEps(e)); } finally { this.abriendo.set(false); }
  }

  async decidir(id: string, decision: 'aprobar' | 'devolver' | 'rechazar'): Promise<void> {
    this.guardando.set(true);
    try {
      await firstValueFrom(this.api.decidirDocumento(id, decision, this.justificacion().trim()));
      this.justificacion.set('');
      this.avisos.exito('Decisión registrada.');
      this.cambio.emit();
    } catch (e) {
      this.avisos.error(traducirErrorEps(e));
      this.cambio.emit();
    } finally {
      this.guardando.set(false);
    }
  }
}
