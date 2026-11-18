import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { Carta, Periodo, VistaPreviaCarta } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { leerError } from '@shared/utils/errores';
import {
  OpcionCarta, TEXTO_CONFIRMACION, etiquetaArl, etiquetaEstado, nombreArchivo, puedeEmitirCarta, rutaVerificacion, solicitudDesde,
} from './carta-presentacion.util';

/**
 * Paso 1 · Carta de presentación digital, dentro de «Registro FUR y cartas».
 * Flujo: periodo (y documento, para el personal) → opción (genérica con modalidad, o ligada a una práctica) → vista
 * previa del servidor → confirmación → PDF institucional con referencia y QR → historial. Ningún dato del estudiante se
 * digita: vienen de SIPRA/SINU. No se edita el texto de la carta.
 */
@Component({
  selector: 'sipra-carta-presentacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink],
  styles: [`
    :host { display: block; }
    .fila { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); align-items: end; }
    .campo { margin: 0; min-width: 0; } .campo select, .campo input { width: 100%; box-sizing: border-box; }
    fieldset { border: 0; margin: var(--sp-3) 0 0; padding: 0; display: grid; gap: 6px; min-width: 0; }
    legend { font-weight: 600; font-size: var(--fs-sm); padding: 0; margin-bottom: 4px; }
    .opcion { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: start; font-size: var(--fs-sm); cursor: pointer; }
    .opcion input { margin-top: 3px; } .opcion small { grid-column: 2; color: var(--texto-tenue); font-size: var(--fs-xs); }
    .previa { margin-top: var(--sp-4); border-top: 1px solid var(--borde); padding-top: var(--sp-3); display: grid; gap: var(--sp-3); }
    .datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: var(--sp-2) var(--sp-4); margin: 0; }
    .datos div { min-width: 0; } .datos dt { font-size: var(--fs-xs); color: var(--texto-tenue); } .datos dd { margin: 0; font-weight: 600; font-size: var(--fs-sm); overflow-wrap: anywhere; }
    /* Extracto del texto: papel neutro (el PDF institucional no cambia con el tema de la aplicación). */
    .papel { border: 1px solid var(--borde); border-radius: var(--r-sm); padding: var(--sp-3) var(--sp-4); font-size: var(--fs-sm); line-height: 1.55; max-height: 22rem; overflow: auto; }
    .papel p { margin: 0 0 var(--sp-2); } .papel .dest { font-weight: 600; }
    .lista-b { margin: 0; padding-left: 1.1rem; font-size: var(--fs-sm); }
    .hecha { display: grid; gap: var(--sp-2); }
    .hecha dl { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--sp-3); margin: 0; font-size: var(--fs-sm); }
    .hecha dt { color: var(--texto-tenue); } .hecha dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .acciones { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
    .historial { margin-top: var(--sp-4); }
    .historial h3 { margin: 0 0 var(--sp-2); font-size: var(--fs-sm); }
    .item { display: flex; gap: var(--sp-3); align-items: center; padding: var(--sp-2) 0; border-bottom: 1px solid var(--borde); font-size: var(--fs-sm); }
    .item:last-child { border-bottom: 0; }
    .item .q { flex: 1; min-width: 0; } .item .q div { overflow-wrap: anywhere; }
    .ref { font-family: var(--fuente-mono, monospace); font-weight: 600; }
    .estado { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); }
    .estado i { width: 7px; height: 7px; border-radius: 50%; background: var(--texto-tenue); }
    .estado.vigente i { background: var(--ok); } .estado.anulada i { background: var(--peligro); }
    dialog.confirmar { width: min(480px, calc(100vw - 32px)); box-sizing: border-box; border: 1px solid var(--borde); border-radius: var(--r-md); padding: var(--sp-5); background: var(--superficie); color: var(--texto); }
    dialog.confirmar::backdrop { background: rgb(0 0 0 / .45); }
    .confirmar h2 { margin: 0 0 var(--sp-2); font-size: var(--fs-lg); } .confirmar p { margin: 0; color: var(--texto-tenue); font-size: var(--fs-sm); }
    .botones { display: flex; gap: var(--sp-2); justify-content: flex-end; margin-top: var(--sp-4); flex-wrap: wrap; }
  `],
  template: `
    @if (emite()) {
      <div class="fila">
        @if (!esEstudiante()) {
          <div class="campo"><label for="c-doc">Documento del estudiante</label>
            <input id="c-doc" inputmode="numeric" autocomplete="off" [ngModel]="documento()" (ngModelChange)="documento.set($event); vista.set(null)" placeholder="Número de identificación" /></div>
        }
        <div class="campo"><label for="c-periodo">Periodo académico</label>
          <select id="c-periodo" [ngModel]="periodo()" (ngModelChange)="periodo.set($event); vista.set(null)">
            @for (p of periodos(); track p.codigo) {
              <option [value]="p.codigo">{{ p.codigo }} · {{ p.nombre }}{{ p.abiertas.carta_presentacion ? '' : ' (ventana cerrada)' }}</option>
            }
          </select></div>
        <div><button type="button" class="boton" [class.cargando]="cargando()" [disabled]="cargando() || !periodo() || (!esEstudiante() && !documento().trim())" (click)="previsualizar()">
          {{ vista() ? 'Actualizar vista previa' : 'Ver vista previa' }}</button></div>
      </div>

      @if (vista(); as v) {
        <div class="previa" aria-live="polite">
          @if (v.practicas.length > 0 || v.modalidadesOfertadas.length > 0) {
            <fieldset>
              <legend>¿Para qué carta?</legend>
              @for (p of v.practicas; track p.id) {
                @if (p.empresa) {
                  <label class="opcion"><input type="radio" name="c-op" [checked]="esOpcion(p.id, 'empresa')" (change)="elegir({ practicaId: p.id, destinatario: 'empresa', modalidad: p.modalidad })" />
                    <span>{{ p.modalidadEtiqueta }} · dirigida a {{ p.empresa }}</span><small>Organización vinculada a tu práctica (no se edita).</small></label>
                }
                <label class="opcion"><input type="radio" name="c-op" [checked]="esOpcion(p.id, 'generica')" (change)="elegir({ practicaId: p.id, destinatario: 'generica', modalidad: p.modalidad })" />
                  <span>{{ p.modalidadEtiqueta }} · A QUIEN CORRESPONDA</span><small>Con los datos de tu práctica registrada.</small></label>
              }
              @if (v.practicas.length === 0) {
                <label class="opcion"><input type="radio" name="c-op" checked disabled />
                  <span>Carta genérica · A QUIEN CORRESPONDA</span><small>Para presentarte ante organizaciones antes de registrar la práctica.</small></label>
                <div class="campo" style="margin-top:4px"><label for="c-mod">Modalidad de práctica</label>
                  <select id="c-mod" [ngModel]="opcion().modalidad" (ngModelChange)="elegir({ practicaId: null, destinatario: 'generica', modalidad: $event })">
                    <option value="">Elige la modalidad…</option>
                    @for (m of v.modalidadesOfertadas; track m.modalidad) { <option [value]="m.modalidad">{{ m.etiqueta }}</option> }
                  </select></div>
              }
            </fieldset>
          }

          @if (v.bloqueos.length > 0) {
            <div class="aviso aviso--error" role="alert"><ul class="lista-b">@for (b of v.bloqueos; track b) { <li>{{ b }}</li> }</ul></div>
          }
          @for (a of v.advertencias; track a) { <div class="aviso" role="status">{{ a }}</div> }

          @if (v.estudiante; as e) {
            <dl class="datos" aria-label="Datos de la carta">
              <div><dt>Destinatario</dt><dd>{{ v.datos?.destinatario ?? '—' }}</dd></div>
              <div><dt>Estudiante</dt><dd>{{ e.nombre }}</dd></div>
              <div><dt>Documento</dt><dd>{{ e.tipoDocumento ?? 'Doc.' }} {{ e.documento }}</dd></div>
              <div><dt>Programa</dt><dd>{{ e.programa }}</dd></div>
              <div><dt>Nivel</dt><dd>{{ e.nivel }}</dd></div>
              <div><dt>Modalidad</dt><dd>{{ v.datos?.modalidadEtiqueta ?? '—' }}</dd></div>
              <div><dt>Responsable ARL</dt><dd>{{ v.datos ? arl(v.datos.responsableArl) : '—' }}</dd></div>
            </dl>
          }
          @if (v.documento; as d) {
            <div class="papel" aria-label="Texto principal de la carta">
              <p class="dest">{{ d.destinatario.join(' ') }}</p>
              @for (p of d.parrafos; track $index) { <p>{{ p }}</p> }
            </div>
          }
          <div class="acciones">
            <button #botonGenerar type="button" class="boton boton--primario" [disabled]="!v.puedeGenerar || cargando()" (click)="confirmar(botonGenerar)">Generar carta</button>
          </div>
        </div>
      }

      @if (emitida(); as c) {
        <div class="previa hecha" role="status">
          <strong>Carta generada</strong>
          <dl>
            <dt>Fecha</dt><dd>{{ c.generadaEn | date: 'd MMM y, HH:mm' }}</dd>
            <dt>Referencia</dt><dd class="ref">{{ c.referencia }}</dd>
            <dt>Destinatario</dt><dd>{{ c.destinatario }}</dd>
          </dl>
          <div class="acciones">
            <button type="button" class="boton boton--primario" (click)="descargar(c)">Descargar PDF</button>
            @if (c.referencia) { <a class="boton" [routerLink]="verificar(c.referencia)" target="_blank" rel="noopener">Verificar</a> }
          </div>
        </div>
      }
    } @else {
      <p class="pista">La carta la expiden el estudiante, el docente facilitador, el auxiliar, coordinación y analista. Aquí puedes consultar las emitidas.</p>
    }

    @if (cartas().length > 0) {
      <section class="historial" aria-labelledby="c-hist">
        <h3 id="c-hist">{{ esEstudiante() ? 'Mis cartas' : 'Cartas emitidas' }}</h3>
        @for (c of cartas(); track c.id) {
          <div class="item">
            <div class="q">
              <div>{{ c.generadaEn | date: 'd MMM y' }} · @if (c.referencia) { <span class="ref">REF {{ c.referencia }}</span> } @else { <span>Carta histórica</span> }
                · {{ c.modalidadEtiqueta ?? (c.modalidadCarta === 'abierta' ? 'Genérica' : 'Con empresa') }}</div>
              <div class="pista">@if (!esEstudiante()) { {{ c.estudianteNombre }} · } {{ c.destinatario }}</div>
            </div>
            <span class="estado" [class]="c.estado"><i aria-hidden="true"></i>{{ estado(c.estado) }}</span>
            <button type="button" class="boton compacto" (click)="descargar(c)" [attr.aria-label]="'Descargar PDF de la carta ' + (c.referencia ?? '')">PDF</button>
          </div>
        }
      </section>
    }

    <dialog #confirmacion class="confirmar" aria-labelledby="c-conf-t" aria-describedby="c-conf-p" (close)="alCerrar()">
      <h2 id="c-conf-t">Generar carta de presentación</h2>
      <p id="c-conf-p">{{ textoConfirmacion }}</p>
      <div class="botones">
        <button #cancelar type="button" class="boton" (click)="cerrar()">Cancelar</button>
        <button type="button" class="boton boton--primario" [class.cargando]="cargando()" [disabled]="cargando()" (click)="generar()">Generar carta</button>
      </div>
    </dialog>
  `,
})
export class CartaPresentacionComponent implements OnInit {
  readonly periodos = input.required<Periodo[]>();

  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly sesion = inject(SesionService);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('confirmacion');
  private readonly cancelar = viewChild<ElementRef<HTMLButtonElement>>('cancelar');
  private origen: HTMLElement | null = null;

  readonly textoConfirmacion = TEXTO_CONFIRMACION;
  readonly esEstudiante = computed(() => this.sesion.rol() === 'estudiante');
  readonly emite = computed(() => puedeEmitirCarta(this.sesion.rol()));
  readonly periodo = signal('');
  readonly documento = signal('');
  readonly opcion = signal<OpcionCarta>({ practicaId: null, destinatario: 'generica', modalidad: '' });
  readonly vista = signal<VistaPreviaCarta | null>(null);
  readonly emitida = signal<Carta | null>(null);
  readonly cartas = signal<Carta[]>([]);
  readonly cargando = signal(false);

  async ngOnInit(): Promise<void> {
    const ps = this.periodos();
    this.periodo.set((ps.find((p) => p.abiertas.carta_presentacion) ?? ps.find((p) => p.vigente) ?? ps[0])?.codigo ?? '');
    await this.cargarCartas();
  }

  arl = etiquetaArl;
  estado = etiquetaEstado;
  verificar = rutaVerificacion;
  esOpcion(practicaId: string, destinatario: 'generica' | 'empresa'): boolean {
    const o = this.opcion(); return o.practicaId === practicaId && o.destinatario === destinatario;
  }

  async previsualizar(): Promise<void> {
    this.emitida.set(null);
    await this.consultar(true);
  }

  async elegir(opcion: OpcionCarta): Promise<void> {
    this.opcion.set(opcion);
    await this.consultar(false);
  }

  private async consultar(inicial: boolean): Promise<void> {
    this.cargando.set(true);
    try {
      let v = await firstValueFrom(this.api.previsualizarCarta(solicitudDesde(this.periodo(), inicial ? { practicaId: null, destinatario: 'generica', modalidad: this.opcion().modalidad } : this.opcion(), this.esEstudiante() ? null : this.documento())));
      // Con práctica registrada, la opción inicial es la carta de esa práctica (a la organización si está vinculada).
      if (inicial && v.practicas.length > 0) {
        const p = v.practicas[0];
        this.opcion.set({ practicaId: p.id, destinatario: p.empresa ? 'empresa' : 'generica', modalidad: p.modalidad });
        v = await firstValueFrom(this.api.previsualizarCarta(solicitudDesde(this.periodo(), this.opcion(), this.esEstudiante() ? null : this.documento())));
      } else if (inicial) {
        this.opcion.set({ practicaId: null, destinatario: 'generica', modalidad: this.opcion().modalidad });
      }
      this.vista.set(v);
    } catch (error) {
      this.vista.set(null);
      this.avisos.error(leerError(error));
    } finally { this.cargando.set(false); }
  }

  confirmar(origen: HTMLElement): void {
    this.origen = origen;
    this.dialogo().nativeElement.showModal();
    setTimeout(() => this.cancelar()?.nativeElement.focus(), 0);
  }
  cerrar(): void { const d = this.dialogo().nativeElement; if (d.open) d.close(); }
  alCerrar(): void { this.origen?.focus(); this.origen = null; }

  async generar(): Promise<void> {
    this.cargando.set(true);
    try {
      const c = await firstValueFrom(this.api.generarCarta(solicitudDesde(this.periodo(), this.opcion(), this.esEstudiante() ? null : this.documento())));
      this.cerrar();
      this.vista.set(null);
      this.emitida.set(c);
      this.avisos.exito(`Carta generada · REF ${c.referencia}.`);
      await this.cargarCartas();
    } catch (error) {
      this.cerrar();
      this.avisos.error(leerError(error));
    } finally { this.cargando.set(false); }
  }

  async descargar(c: Carta): Promise<void> {
    try {
      const blob = await firstValueFrom(this.api.descargarCartaPdf(c.id));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombreArchivo(c);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { this.avisos.error(leerError(error)); }
  }

  private async cargarCartas(): Promise<void> {
    try { this.cartas.set(await firstValueFrom(this.api.listarCartas())); } catch { this.cartas.set([]); }
  }
}
