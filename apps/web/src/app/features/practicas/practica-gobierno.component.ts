import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DestinoOperativo, EstadoOperativo, ModalidadCatalogo, Practica } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { leerError } from '@shared/utils/errores';
import {
  FormularioPractica, JUSTIFICACION_MINIMA, cambiosFormulario, cuerpoModificacion, formularioDesdePractica, problemasEdicion,
} from './gobierno-practica';

/**
 * G5 · Gobierno de la práctica: «Editar práctica» (panel lateral) y «Cambiar estado» (diálogo).
 * Solo se muestra cuando el servidor proyecta `gobierno.puedeModificar` (coordinación y analista).
 * El servidor vuelve a autorizar, valida, audita y aplica las invariantes (ARL, cierre); aquí no hay atajos.
 */
@Component({
  selector: 'sipra-practica-gobierno',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  styles: [`
    :host { display:block; }
    .estado-op { display:flex; align-items:center; gap:var(--sp-2); flex-wrap:wrap; font-size:var(--fs-sm); }
    .estado-op strong { font-size:var(--fs-md); }
    .pendientes { margin:var(--sp-3) 0 0; padding-left:1.1rem; font-size:var(--fs-sm); }
    .acciones-g { display:flex; gap:var(--sp-2); flex-wrap:wrap; margin-top:var(--sp-3); }

    dialog.cajon { margin:0 0 0 auto; height:100dvh; max-height:100dvh; width:min(520px, 100vw); max-width:100vw; box-sizing:border-box; padding:0;
      border:0; border-left:1px solid var(--borde); background:var(--superficie); color:var(--texto); }
    dialog.cajon::backdrop, dialog.confirmar::backdrop { background:rgb(0 0 0 / .45); }
    .caj { display:flex; flex-direction:column; height:100%; }
    .caj header { display:flex; align-items:center; gap:var(--sp-2); padding:var(--sp-4) var(--sp-4) var(--sp-3); border-bottom:1px solid var(--borde); }
    .caj header h2 { margin:0; font-size:var(--fs-lg); flex:1; }
    .x { display:grid; place-items:center; width:40px; height:40px; border:1px solid transparent; border-radius:var(--r-sm); background:none; color:var(--texto-tenue); cursor:pointer; }
    .x:hover { border-color:var(--borde); color:var(--texto); } .x svg { width:18px; height:18px; }
    .x:focus-visible { outline:2px solid var(--marca); outline-offset:2px; }
    .caj .cuerpo { flex:1; overflow:auto; padding:var(--sp-4); display:grid; gap:var(--sp-4); align-content:start; }
    .caj fieldset { border:0; margin:0; padding:0; display:grid; gap:var(--sp-3); min-width:0; }
    .caj legend { font-weight:600; font-size:var(--fs-sm); padding:0; margin-bottom:var(--sp-1); color:var(--texto-tenue); text-transform:uppercase; letter-spacing:.04em; }
    .rej2 { display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-3); }
    .campo { margin:0; min-width:0; }
    .campo input, .campo select, .campo textarea { width:100%; box-sizing:border-box; }
    .error { color:var(--peligro); font-size:var(--fs-xs); }
    .resumen { border:1px solid var(--borde); border-radius:var(--r-sm); padding:var(--sp-3); font-size:var(--fs-sm); }
    .resumen h3 { margin:0 0 var(--sp-2); font-size:var(--fs-sm); }
    .resumen ul { margin:0; padding-left:1.1rem; display:grid; gap:4px; }
    .resumen .de { color:var(--texto-tenue); text-decoration:line-through; }
    .caj footer { display:flex; gap:var(--sp-2); justify-content:flex-end; padding:var(--sp-3) var(--sp-4); border-top:1px solid var(--borde); }
    .fijos { font-size:var(--fs-xs); color:var(--texto-tenue); margin:0; }

    dialog.confirmar { width:min(520px, calc(100vw - 32px)); box-sizing:border-box; border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-5); background:var(--superficie); color:var(--texto); }
    .confirmar h2 { margin:0 0 var(--sp-2); font-size:var(--fs-lg); }
    .confirmar form { display:grid; gap:var(--sp-3); }
    .destinos { border:0; margin:0; padding:0; display:grid; gap:6px; }
    .destinos legend { font-weight:600; font-size:var(--fs-sm); padding:0; margin-bottom:4px; }
    .opcion { display:grid; grid-template-columns:auto 1fr; gap:2px 8px; align-items:start; font-size:var(--fs-sm); cursor:pointer; }
    .opcion input { margin-top:3px; } .opcion small { grid-column:2; color:var(--texto-tenue); font-size:var(--fs-xs); }
    .opcion.no { cursor:not-allowed; } .opcion.no span { color:var(--texto-tenue); }
    .botones { display:flex; gap:var(--sp-2); justify-content:flex-end; }
    @media (max-width: 560px) { .rej2 { grid-template-columns:1fr; } }
  `],
  template: `
    @if (practica().gobierno; as g) {
      <div class="estado-op">Estado operativo: <strong>{{ g.etiquetaEstadoOperativo }}</strong></div>
      @if (g.pendientes.length > 0) {
        <ul class="pendientes aviso" aria-label="Pendientes de la práctica">@for (x of g.pendientes; track x) { <li>{{ x }}</li> }</ul>
      }
      @if (g.puedeModificar) {
        <div class="acciones-g">
          <button #botonEditar type="button" class="boton" [disabled]="terminal()" (click)="abrirEditor(botonEditar)">Editar práctica</button>
          <button #botonEstado type="button" class="boton" [disabled]="destinosDisponibles() === 0" (click)="abrirEstado(botonEstado)">Cambiar estado</button>
        </div>
        @if (terminal()) { <p class="pista" style="margin-top:var(--sp-2)">La práctica está en un estado final: sus datos ya no se modifican.</p> }
      } @else {
        <p class="pista" style="margin-top:var(--sp-2)">Los cambios de datos y de estado de la práctica los hacen coordinación y analista, con justificación.</p>
      }

      @if (g.puedeModificar) {
      <!-- ── Editor: panel lateral ───────────────────────────────────────── -->
      <dialog #editor class="cajon" aria-labelledby="ed-titulo" (close)="alCerrar()">
        <form class="caj" (ngSubmit)="guardar()" novalidate>
          <header>
            <h2 id="ed-titulo">Editar práctica</h2>
            <button type="button" class="x" aria-label="Cerrar" (click)="cerrarEditor()"><svg aria-hidden="true"><use href="#sipra-cerrar" /></svg></button>
          </header>
          <div class="cuerpo">
            <fieldset>
              <legend>Práctica</legend>
              <div class="campo"><label for="g-mod">Modalidad</label>
                <select #primerCampo id="g-mod" name="modalidad" [ngModel]="f().modalidad" (ngModelChange)="poner('modalidad', $event)" aria-describedby="g-mod-a">
                  @for (m of modalidadesOpciones(); track m.modalidad) { <option [value]="m.modalidad">{{ m.etiqueta }}</option> }
                </select>
                <span class="pista" id="g-mod-a">Cambiarla conserva los documentos cargados y recalcula las obligaciones.</span>
              </div>
              @if (cambiaModalidad()) {
                <div class="aviso" role="status">Cambio de modalidad: los documentos y su historial se conservan; las obligaciones que dejen de aplicar quedan como «no aplica».
                  El responsable de la ARL <strong>no cambia solo</strong>@if (sugeridoArl()) {<span>; para esta modalidad normalmente lo asume {{ sugeridoArl() }}</span>}.</div>
              }
              <p class="fijos">Fechas, periodo y empresa no se editan aquí.</p>
            </fieldset>

            <fieldset>
              <legend>Vacante</legend>
              <div class="rej2">
                <div class="campo"><label for="g-area">Área</label><input id="g-area" name="area" [ngModel]="f().area" (ngModelChange)="poner('area', $event)" /></div>
                <div class="campo"><label for="g-cargo">Cargo</label><input id="g-cargo" name="cargo" [ngModel]="f().cargo" (ngModelChange)="poner('cargo', $event)" /></div>
                <div class="campo"><label for="g-hor">Horario</label><input id="g-hor" name="horario" [ngModel]="f().horario" (ngModelChange)="poner('horario', $event)" /></div>
                <div class="campo"><label for="g-ciu">Ciudad</label><input id="g-ciu" name="ciudad" [ngModel]="f().ciudad" (ngModelChange)="poner('ciudad', $event)" /></div>
                <div class="campo"><label for="g-rem">Remuneración</label>
                  <select id="g-rem" name="tipoRemuneracion" [ngModel]="f().tipoRemuneracion" (ngModelChange)="poner('tipoRemuneracion', $event)">
                    @if (!f().tipoRemuneracion) { <option value="">Sin informar</option> }
                    <option value="remunerada">Remunerada</option><option value="no_remunerada">No remunerada</option>
                  </select></div>
                <div class="campo"><label for="g-sal">Salario</label>
                  <input id="g-sal" name="salario" type="number" min="0" inputmode="numeric" [disabled]="f().tipoRemuneracion === 'no_remunerada'" [ngModel]="f().salario" (ngModelChange)="poner('salario', $event ?? '')"
                         [attr.aria-invalid]="problemas().salario ? 'true' : null" [attr.aria-describedby]="problemas().salario ? 'g-sal-e' : null" />
                  @if (problemas().salario) { <span class="error" id="g-sal-e">{{ problemas().salario }}</span> }</div>
                <div class="campo"><label for="g-jn">Jefe inmediato</label><input id="g-jn" name="jn" [ngModel]="f().jefeInmediatoNombre" (ngModelChange)="poner('jefeInmediatoNombre', $event)" /></div>
                <div class="campo"><label for="g-jc">Cargo del jefe</label><input id="g-jc" name="jc" [ngModel]="f().jefeInmediatoCargo" (ngModelChange)="poner('jefeInmediatoCargo', $event)" /></div>
                <div class="campo"><label for="g-je">Correo del jefe</label><input id="g-je" name="je" type="email" [ngModel]="f().jefeInmediatoCorreo" (ngModelChange)="poner('jefeInmediatoCorreo', $event)"
                         [attr.aria-invalid]="problemas().jefeInmediatoCorreo ? 'true' : null" [attr.aria-describedby]="problemas().jefeInmediatoCorreo ? 'g-je-e' : null" />
                  @if (problemas().jefeInmediatoCorreo) { <span class="error" id="g-je-e">{{ problemas().jefeInmediatoCorreo }}</span> }</div>
                <div class="campo"><label for="g-jt">Teléfono del jefe</label><input id="g-jt" name="jt" [ngModel]="f().jefeInmediatoTelefono" (ngModelChange)="poner('jefeInmediatoTelefono', $event)" /></div>
              </div>
              <div class="campo"><label for="g-fun">Funciones relevantes</label><textarea id="g-fun" name="fun" rows="3" [ngModel]="f().funcionesRelevantes" (ngModelChange)="poner('funcionesRelevantes', $event)"></textarea></div>
            </fieldset>

            <fieldset>
              <legend>ARL</legend>
              <div class="campo"><label for="g-arl">Responsable de la afiliación</label>
                <select id="g-arl" name="responsableArl" [ngModel]="f().responsableArl" (ngModelChange)="poner('responsableArl', $event)" aria-describedby="g-arl-a">
                  @if (!f().responsableArl) { <option value="">Sin informar</option> }
                  <option value="empresa">Empresa</option><option value="cun">CUN</option>
                </select>
                <span class="pista" id="g-arl-a">Solo cambia si lo eliges aquí; SIPRA nunca lo deduce de la modalidad.</span></div>
            </fieldset>

            <fieldset>
              <legend>Justificación</legend>
              <div class="campo"><label for="g-just">Motivo del cambio</label>
                <textarea id="g-just" name="justificacion" rows="3" maxlength="1000" [ngModel]="justificacion()" (ngModelChange)="justificacion.set($event)"
                          [attr.aria-invalid]="mostrarJust() ? 'true' : null" [attr.aria-describedby]="mostrarJust() ? 'g-just-a g-just-e' : 'g-just-a'"></textarea>
                <span class="pista" id="g-just-a">Queda en la auditoría y en la bitácora (mínimo {{ minimo }} caracteres).</span>
                @if (mostrarJust()) { <span class="error" id="g-just-e">{{ problemas().justificacion }}</span> }</div>
            </fieldset>

            <div class="resumen" aria-live="polite">
              <h3>Resumen de cambios</h3>
              @if (cambios().length === 0) { <span class="pista">Aún no has cambiado ningún dato.</span> }
              @else { <ul>@for (c of cambios(); track c.clave) { <li><strong>{{ c.etiqueta }}:</strong> <span class="de">{{ c.de }}</span> → {{ c.a }}</li> }</ul> }
            </div>
          </div>
          <footer>
            <button type="button" class="boton" (click)="cerrarEditor()">Cancelar</button>
            <button type="submit" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="!puedeGuardar() || guardando()">Guardar cambios</button>
          </footer>
        </form>
      </dialog>

      <!-- ── Cambio de estado operativo ──────────────────────────────────── -->
      <dialog #estado class="confirmar" aria-labelledby="es-titulo" (close)="alCerrar()">
        <form (ngSubmit)="confirmarEstado()" novalidate>
          <h2 id="es-titulo">Cambiar estado</h2>
          <p class="pista" style="margin:0">Estado actual: <strong>{{ g.etiquetaEstadoOperativo }}</strong></p>
          <fieldset class="destinos">
            <legend>Nuevo estado</legend>
            @for (d of destinosVisibles(); track d.estado) {
              <label class="opcion" [class.no]="!d.disponible">
                <input type="radio" name="destino" [value]="d.estado" [disabled]="!d.disponible" [checked]="destino() === d.estado" (change)="destino.set(d.estado)" />
                <span>{{ d.etiqueta }}</span>
                @if (d.motivo) { <small>{{ d.motivo }}</small> }
              </label>
            }
          </fieldset>
          <div class="campo"><label for="es-just">Justificación</label>
            <textarea #justEstado id="es-just" name="justEstado" rows="3" maxlength="1000" [ngModel]="justificacionEstado()" (ngModelChange)="justificacionEstado.set($event)" aria-describedby="es-just-a"></textarea>
            <span class="pista" id="es-just-a">Obligatoria (mínimo {{ minimo }} caracteres). Queda en la auditoría y en la bitácora.</span></div>
          <div class="botones">
            <button type="button" class="boton" (click)="cerrarEstado()">Cancelar</button>
            <button type="submit" class="boton confirmar-estado" [class.boton--primario]="!destructivo()" [class.boton--peligro]="destructivo()" [class.cargando]="guardando()"
                    [disabled]="!puedeConfirmarEstado() || guardando()">Confirmar cambio</button>
          </div>
        </form>
      </dialog>
      }
    }
  `,
})
export class PracticaGobiernoComponent {
  readonly practica = input.required<Practica>();
  /** Se emite tras un cambio exitoso: el expediente recarga. */
  readonly actualizada = output<void>();

  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly editor = viewChild<ElementRef<HTMLDialogElement>>('editor');
  private readonly dialogoEstado = viewChild<ElementRef<HTMLDialogElement>>('estado');
  private readonly primerCampo = viewChild<ElementRef<HTMLSelectElement>>('primerCampo');
  private readonly justEstado = viewChild<ElementRef<HTMLTextAreaElement>>('justEstado');
  private origenFoco: HTMLElement | null = null;

  readonly minimo = JUSTIFICACION_MINIMA;
  readonly guardando = signal(false);
  readonly modalidades = signal<ModalidadCatalogo[]>([]);
  readonly original = signal<FormularioPractica | null>(null);
  readonly f = signal<FormularioPractica>({
    modalidad: '', area: '', cargo: '', tipoRemuneracion: '', salario: '', responsableArl: '', horario: '', ciudad: '',
    jefeInmediatoNombre: '', jefeInmediatoCargo: '', jefeInmediatoCorreo: '', jefeInmediatoTelefono: '', funcionesRelevantes: '',
  });
  readonly justificacion = signal('');
  readonly intento = signal(false);
  readonly destino = signal<EstadoOperativo | null>(null);
  readonly justificacionEstado = signal('');

  readonly terminal = computed(() => ['certificada', 'cancelada', 'anulada', 'reprobada'].includes(this.practica().estado));
  readonly destinosVisibles = computed<DestinoOperativo[]>(() => {
    const g = this.practica().gobierno;
    return g ? g.destinos.filter((d) => d.estado !== g.estadoOperativo) : [];
  });
  /** Anulado y Reprobado son finales: botón de peligro (sin mezclarlo con el primario). */
  readonly destructivo = computed(() => this.destino() === 'anulado' || this.destino() === 'reprobado');
  readonly destinosDisponibles = computed(() => this.destinosVisibles().filter((d) => d.disponible).length);
  readonly modalidadesOpciones = computed(() => {
    const lista = this.modalidades();
    const actual = this.practica().modalidad;
    return lista.some((m) => m.modalidad === actual) ? lista : [{ modalidad: actual, etiqueta: this.etiquetaModalidad(actual) } as ModalidadCatalogo, ...lista];
  });
  readonly cambios = computed(() => {
    const o = this.original();
    return o ? cambiosFormulario(o, this.f(), (clave, valor) => this.legible(clave, valor)) : [];
  });
  readonly cambiaModalidad = computed(() => !!this.original() && this.original()!.modalidad !== this.f().modalidad);
  readonly sugeridoArl = computed(() => {
    const r = this.modalidades().find((m) => m.modalidad === this.f().modalidad)?.responsableArl ?? '';
    return r === 'cun' ? 'la CUN' : r === 'empresa' ? 'la empresa' : '';
  });
  readonly problemas = computed(() => problemasEdicion(this.f(), this.justificacion()));
  readonly mostrarJust = computed(() => (this.intento() || this.justificacion().length > 0) && !!this.problemas().justificacion);
  readonly puedeGuardar = computed(() => this.cambios().length > 0 && Object.keys(this.problemas()).length === 0);
  readonly puedeConfirmarEstado = computed(() => {
    const d = this.destinosVisibles().find((x) => x.estado === this.destino());
    return !!d?.disponible && this.justificacionEstado().trim().length >= JUSTIFICACION_MINIMA;
  });

  poner<K extends keyof FormularioPractica>(clave: K, valor: FormularioPractica[K]): void {
    this.f.update((f) => ({ ...f, [clave]: valor ?? '' }));
  }

  async abrirEditor(origen: HTMLElement): Promise<void> {
    this.origenFoco = origen;
    const base = formularioDesdePractica(this.practica());
    this.original.set(base); this.f.set({ ...base }); this.justificacion.set(''); this.intento.set(false);
    const el = this.editor()?.nativeElement;
    if (el && !el.open) el.showModal();
    setTimeout(() => this.primerCampo()?.nativeElement.focus(), 0);
    if (this.modalidades().length === 0) {
      this.modalidades.set(await firstValueFrom(this.api.catalogoModalidades()).catch(() => [] as ModalidadCatalogo[]));
    }
  }
  cerrarEditor(): void { const el = this.editor()?.nativeElement; if (el?.open) el.close(); }

  abrirEstado(origen: HTMLElement): void {
    this.origenFoco = origen;
    this.destino.set(this.destinosVisibles().find((d) => d.disponible)?.estado ?? null);
    this.justificacionEstado.set('');
    const el = this.dialogoEstado()?.nativeElement;
    if (el && !el.open) el.showModal();
    setTimeout(() => (el?.querySelector<HTMLInputElement>('input[name="destino"]:checked') ?? this.justEstado()?.nativeElement)?.focus(), 0);
  }
  cerrarEstado(): void { const el = this.dialogoEstado()?.nativeElement; if (el?.open) el.close(); }

  alCerrar(): void { this.origenFoco?.focus(); this.origenFoco = null; }

  async guardar(): Promise<void> {
    this.intento.set(true);
    const o = this.original();
    if (!o || !this.puedeGuardar()) {
      if (this.problemas().justificacion) document.getElementById('g-just')?.focus();
      return;
    }
    const version = this.practica().gobierno?.actualizadaEn ?? '';
    await this.ejecutar(async () => {
      await firstValueFrom(this.api.modificarPractica(this.practica().id, cuerpoModificacion(o, this.f(), this.justificacion(), version)));
      this.cerrarEditor();
      return 'Práctica actualizada. El cambio quedó en la auditoría y en la bitácora.';
    });
  }

  async confirmarEstado(): Promise<void> {
    const destino = this.destino();
    if (!destino || !this.puedeConfirmarEstado()) return;
    await this.ejecutar(async () => {
      await firstValueFrom(this.api.cambiarEstadoOperativo(this.practica().id, {
        destino, justificacion: this.justificacionEstado().trim(), actualizadaEn: this.practica().gobierno?.actualizadaEn,
      }));
      this.cerrarEstado();
      return 'Estado actualizado. El cambio quedó en la auditoría y en la bitácora.';
    });
  }

  private async ejecutar(accion: () => Promise<string>): Promise<void> {
    this.guardando.set(true);
    try { this.avisos.exito(await accion()); this.actualizada.emit(); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }

  private etiquetaModalidad(m: string): string {
    return this.modalidades().find((x) => x.modalidad === m)?.etiqueta ?? m.replace(/_/g, ' ');
  }
  private legible(clave: keyof FormularioPractica, valor: string): string {
    if (!valor) return '';
    if (clave === 'modalidad') return this.etiquetaModalidad(valor);
    if (clave === 'tipoRemuneracion') return valor === 'remunerada' ? 'Remunerada' : 'No remunerada';
    if (clave === 'responsableArl') return valor === 'cun' ? 'CUN' : 'Empresa';
    if (clave === 'funcionesRelevantes' && valor.length > 60) return valor.slice(0, 57) + '…';
    return valor;
  }
}
