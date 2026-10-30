import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { traducirErrorEps } from '../eps/eps.util';

type EstadoVisor = 'cerrado' | 'cargando' | 'listo' | 'error';

/**
 * Visor del Acta. El contenido llega por la sesión autenticada (cabecera Authorization) como un blob local: no hay enlace
 * firmado, ni credencial en la URL, ni URL permanente. El blob se libera al cerrar el visor o cambiar de caso.
 *
 * El PDF se muestra con el visor integrado del navegador (zoom, páginas, ajuste al ancho): no se construye un editor. Dos
 * presentaciones del MISMO blob (ampliar no vuelve a pedir el archivo, así que no se audita una segunda visualización): la vista
 * normal, que llena la columna, y un diálogo casi a pantalla completa para leer con detalle.
 */
@Component({
  selector: 'sipra-actas-visor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; }
    .barra { display:flex; gap:var(--sp-2); flex-wrap:nowrap; align-items:center; margin-bottom:var(--sp-2); }
    .barra .boton { flex:none; white-space:nowrap; }
    .barra .meta { flex:1 1 0; font-size:var(--fs-sm); color:var(--texto-tenue); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .barra .meta strong { color:var(--texto); }
    .marco { border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie-2); overflow:auto; flex:1 1 auto; min-height:0; display:grid; }
    .marco.previa { display:block; min-height:var(--visor-min, clamp(420px, 70dvh, 820px)); }
    .marco iframe { width:100%; height:100%; border:0; display:block; background:#fff; }
    .marco img { display:block; margin:0 auto; transform-origin:top center; max-width:100%; height:auto; }
    .estado { padding:var(--sp-5); text-align:center; color:var(--texto-tenue); align-self:center; }
    .zoom { min-width:4.5ch; text-align:center; font-variant-numeric:tabular-nums; }
    dialog.ampliado {
      padding:0; border:1px solid var(--borde); border-radius:var(--r-md, 12px);
      width:min(1280px, 96vw); height:94dvh; max-width:96vw; max-height:94dvh; background:var(--superficie); color:var(--texto);
    }
    dialog.ampliado::backdrop { background:rgb(0 0 0 / .6); }
    dialog.ampliado[open] { display:flex; flex-direction:column; }
    .ampliado-cab { display:flex; gap:var(--sp-2); align-items:center; padding:var(--sp-2) var(--sp-3); border-bottom:1px solid var(--borde); flex-wrap:wrap; }
    .ampliado-cab .titulo { flex:1 1 200px; min-width:0; font-weight:600; font-size:var(--fs-sm); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ampliado-cuerpo { flex:1 1 auto; min-height:0; overflow:auto; background:var(--superficie-2); }
    .ampliado-cuerpo iframe { width:100%; height:100%; border:0; display:block; background:#fff; }
    .ampliado-cuerpo img { display:block; margin:var(--sp-3) auto; transform-origin:top center; max-width:none; }
    @media (width < 700px) {
      dialog.ampliado { width:100vw; height:100dvh; max-width:100vw; max-height:100dvh; border-radius:0; border:0; }
    }
  `],
  template: `
    <div class="barra">
      <div class="meta" [attr.title]="'Acta de iniciación · versión ' + version()"><strong>Acta</strong> · v{{ version() }}@if (estado() === 'listo') { · {{ esPdf() ? 'PDF' : 'Imagen' }} }</div>
      @if (estado() === 'cerrado' || estado() === 'error') {
        <button type="button" class="boton boton--primario compacto" [disabled]="!habilitado()" (click)="abrir()">Abrir el Acta</button>
      }
      @if (estado() === 'listo') {
        <button type="button" class="boton boton--primario compacto" (click)="ampliar()">Ampliar</button>
        <button type="button" class="boton compacto" (click)="cerrar()">Cerrar</button>
      }
    </div>

    @switch (estado()) {
      @case ('cerrado') {
        <div class="marco"><div class="estado">
          @if (habilitado()) { El Acta no se carga hasta que la abra, para no exponer datos personales sin necesidad. }
          @else { Tome el caso para abrir el Acta. }
        </div></div>
      }
      @case ('cargando') { <div class="marco"><div class="estado" role="status">Cargando el Acta…</div></div> }
      @case ('error') { <div class="marco"><div class="estado" role="alert">{{ error() }}</div></div> }
      @case ('listo') {
        <div class="marco previa">
          @if (esPdf()) {
            <iframe [src]="urlPrevia()" title="Acta de iniciación (vista previa)"></iframe>
          } @else {
            <img [src]="url()" [style.transform]="'scale(' + zoom() / 100 + ')'" alt="Acta de iniciación cargada por el estudiante" />
          }
        </div>
      }
    }

    <dialog #dialogo class="ampliado" aria-label="Acta de iniciación ampliada" (close)="ampliado.set(false)">
      @if (ampliado() && url()) {
        <div class="ampliado-cab">
          <span class="titulo">Acta de iniciación · versión {{ version() }}</span>
          @if (!esPdf()) {
            <button type="button" class="boton compacto" (click)="alejar()" aria-label="Alejar">−</button>
            <span class="zoom" aria-live="polite">{{ zoom() }} %</span>
            <button type="button" class="boton compacto" (click)="acercar()" aria-label="Acercar">+</button>
          }
          <button type="button" class="boton boton--primario compacto" (click)="cerrarAmpliado()">Cerrar</button>
        </div>
        <div class="ampliado-cuerpo">
          @if (esPdf()) {
            <iframe [src]="urlAmpliada()" title="Acta de iniciación (PDF ampliado)"></iframe>
          } @else {
            <img [src]="url()" [style.transform]="'scale(' + zoom() / 100 + ')'" alt="Acta de iniciación cargada por el estudiante" />
          }
        </div>
      }
    </dialog>
  `,
})
export class ActasVisorComponent {
  private readonly api = inject(ApiService);
  private readonly sanitizador = inject(DomSanitizer);
  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');

  readonly validacionId = input.required<string>();
  readonly version = input.required<number>();
  /** Solo se puede abrir con el caso tomado (o siendo supervisión): lo decide la API; aquí se refleja. */
  readonly habilitado = input<boolean>(false);
  /** Con el caso tomado por la persona, el Acta se abre sola: ya decidió trabajarlo. */
  readonly autoabrir = input<boolean>(false);
  /** Avisa que hubo actividad (para renovar la reserva). */
  readonly actividad = output<void>();

  readonly estado = signal<EstadoVisor>('cerrado');
  readonly error = signal<string | null>(null);
  readonly url = signal<string | null>(null);
  readonly mime = signal<string>('application/pdf');
  readonly zoom = signal(100);
  readonly ampliado = signal(false);

  readonly esPdf = computed(() => this.mime() === 'application/pdf');
  /** Con la barra del visor integrado (páginas, zoom, ajuste al ancho) y ajustada al ancho. */
  readonly urlPrevia = computed<SafeResourceUrl | null>(() => this.conParametros('toolbar=1&navpanes=0&view=FitH'));
  readonly urlAmpliada = computed<SafeResourceUrl | null>(() => this.conParametros('toolbar=1&navpanes=0&view=FitH'));

  constructor() {
    // Al cambiar de caso se libera lo anterior: un blob de otro estudiante no debe quedar en memoria. Si la persona tiene el
    // caso tomado, se abre el Acta. `untracked`: solo el cambio de caso (o de habilitación) debe dispararlo.
    effect(() => {
      const id = this.validacionId();
      const auto = this.autoabrir() && this.habilitado();
      untracked(() => { this.cerrar(); if (id && auto) void this.abrir(); });
    });
    inject(DestroyRef).onDestroy(() => this.liberar());
  }

  private conParametros(parametros: string): SafeResourceUrl | null {
    const u = this.url();
    return u ? this.sanitizador.bypassSecurityTrustResourceUrl(`${u}#${parametros}`) : null;
  }

  async abrir(): Promise<void> {
    if (this.estado() === 'cargando') return;
    this.estado.set('cargando');
    this.error.set(null);
    try {
      const blob = await firstValueFrom(this.api.archivoActa(this.validacionId()));
      this.liberar();
      this.mime.set(blob.type || 'application/pdf');
      this.url.set(URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' })));
      this.zoom.set(100);
      this.estado.set('listo');
      this.actividad.emit();
    } catch (e) {
      this.error.set(traducirErrorEps(e));
      this.estado.set('error');
    }
  }

  ampliar(): void {
    if (this.estado() !== 'listo') return;
    this.ampliado.set(true);
    this.actividad.emit();
    const el = this.dialogo()?.nativeElement;
    if (el && !el.open) el.showModal();
  }

  cerrarAmpliado(): void {
    const el = this.dialogo()?.nativeElement;
    if (el?.open) el.close();
    this.ampliado.set(false);
  }

  cerrar(): void {
    const el = this.dialogo()?.nativeElement;
    if (el?.open) el.close();
    this.ampliado.set(false);
    this.liberar();
    this.estado.set('cerrado');
  }

  private liberar(): void {
    const u = this.url();
    if (u) URL.revokeObjectURL(u);
    this.url.set(null);
  }

  acercar(): void { this.zoom.update((z) => Math.min(300, z + 25)); this.actividad.emit(); }
  alejar(): void { this.zoom.update((z) => Math.max(50, z - 25)); }
}
