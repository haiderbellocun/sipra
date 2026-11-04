import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { traducirErrorEps } from '../eps/eps.util';

type EstadoVisor = 'cerrado' | 'cargando' | 'listo' | 'error';
const PASOS_ZOOM = [50, 75, 100, 125, 150, 200, 300];

/**
 * Visor del RUT. El contenido llega por la sesión autenticada (cabecera Authorization) como un blob local: no hay enlace firmado,
 * ni credencial en la URL, ni URL permanente. El blob se libera al cerrar el visor o cambiar de caso.
 *
 * El PDF se muestra con el visor integrado del navegador, gobernado por parámetros de fragmento (página, zoom, ajuste al ancho):
 * no se construye un editor. Ampliar es otra presentación del MISMO blob (no se vuelve a pedir ni a auditar el archivo).
 */
@Component({
  selector: 'sipra-rut-visor',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; }
    .barra { display:flex; gap:var(--sp-1) var(--sp-2); flex-wrap:wrap; align-items:center; margin-bottom:var(--sp-2); }
    .barra .boton { flex:none; white-space:nowrap; }
    .barra .meta { flex:1 1 8rem; font-size:var(--fs-sm); color:var(--texto-tenue); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .barra .meta strong { color:var(--texto); }
    .controles { display:flex; gap:var(--sp-1); flex-wrap:wrap; align-items:center; margin-bottom:var(--sp-2); font-size:var(--fs-sm); }
    .controles label { display:inline-flex; gap:var(--sp-1); align-items:center; }
    .controles input[type=number] { width:3.5rem; min-height:36px; }
    .controles .boton { min-width:0; }
    .controles .zoom { min-width:4.5ch; text-align:center; font-variant-numeric:tabular-nums; }
    .marco { border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie-2); overflow:auto; flex:1 1 auto; min-height:0; display:grid; }
    .marco.previa { display:block; min-height:var(--visor-min, clamp(420px, 70dvh, 820px)); }
    .marco iframe { width:100%; height:100%; border:0; display:block; background:#fff; }
    .marco img { display:block; margin:0 auto; transform-origin:top center; max-width:100%; height:auto; }
    .estado { padding:var(--sp-5); text-align:center; color:var(--texto-tenue); align-self:center; }
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
      <div class="meta" [attr.title]="'RUT · versión ' + version()"><strong>RUT</strong> · v{{ version() }}@if (estado() === 'listo') { · {{ esPdf() ? 'PDF' : 'Imagen' }} }</div>
      @if (estado() === 'cerrado' || estado() === 'error') {
        <button type="button" class="boton boton--primario compacto" [disabled]="!habilitado()" (click)="abrir()">Abrir el RUT</button>
      }
      @if (estado() === 'listo') {
        <button type="button" class="boton boton--primario compacto" (click)="ampliar()">Ampliar</button>
        <button type="button" class="boton compacto" (click)="cerrar()">Cerrar</button>
      }
    </div>

    @if (estado() === 'listo') {
      <div class="controles" role="group" aria-label="Controles del visor">
        @if (esPdf()) {
          <button type="button" class="boton compacto" aria-label="Página anterior" [disabled]="pagina() <= 1" (click)="irAPagina(pagina() - 1)">‹</button>
          <label>Pág. <input type="number" min="1" inputmode="numeric" [ngModel]="pagina()" (ngModelChange)="irAPagina($event)" name="pagina-rut" aria-label="Número de página" /></label>
          <button type="button" class="boton compacto" aria-label="Página siguiente" (click)="irAPagina(pagina() + 1)">›</button>
        }
        <button type="button" class="boton compacto" aria-label="Alejar" [disabled]="!puedeAlejar()" (click)="alejar()">−</button>
        <span class="zoom" aria-live="polite">{{ etiquetaZoom() }}</span>
        <button type="button" class="boton compacto" aria-label="Acercar" [disabled]="!puedeAcercar()" (click)="acercar()">+</button>
        <button type="button" class="boton compacto" [attr.aria-pressed]="ajustarAncho()" (click)="ajustar()">Ajustar ancho</button>
      </div>
    }

    @switch (estado()) {
      @case ('cerrado') {
        <div class="marco"><div class="estado">
          @if (habilitado()) { El RUT no se carga hasta que lo abra, para no exponer datos personales sin necesidad. }
          @else { Tome el caso para abrir el RUT. }
        </div></div>
      }
      @case ('cargando') { <div class="marco"><div class="estado" role="status">Cargando el RUT…</div></div> }
      @case ('error') { <div class="marco"><div class="estado" role="alert">{{ error() }}</div></div> }
      @case ('listo') {
        <div class="marco previa">
          @if (esPdf()) {
            <iframe [src]="urlPdf()" title="RUT (vista previa)"></iframe>
          } @else {
            <img [src]="url()" [style.transform]="'scale(' + zoom() / 100 + ')'" alt="RUT cargado por el estudiante" />
          }
        </div>
      }
    }

    <dialog #dialogo class="ampliado" aria-label="RUT ampliado" (close)="ampliado.set(false)">
      @if (ampliado() && url()) {
        <div class="ampliado-cab">
          <span class="titulo">RUT · versión {{ version() }}</span>
          <button type="button" class="boton compacto" aria-label="Alejar" [disabled]="!puedeAlejar()" (click)="alejar()">−</button>
          <span class="zoom" aria-live="polite">{{ etiquetaZoom() }}</span>
          <button type="button" class="boton compacto" aria-label="Acercar" [disabled]="!puedeAcercar()" (click)="acercar()">+</button>
          <button type="button" class="boton compacto" [attr.aria-pressed]="ajustarAncho()" (click)="ajustar()">Ajustar ancho</button>
          <button type="button" class="boton boton--primario compacto" (click)="cerrarAmpliado()">Cerrar</button>
        </div>
        <div class="ampliado-cuerpo">
          @if (esPdf()) {
            <iframe [src]="urlPdf()" title="RUT (PDF ampliado)"></iframe>
          } @else {
            <img [src]="url()" [style.transform]="'scale(' + zoom() / 100 + ')'" alt="RUT cargado por el estudiante" />
          }
        </div>
      }
    </dialog>
  `,
})
export class RutVisorComponent {
  private readonly api = inject(ApiService);
  private readonly sanitizador = inject(DomSanitizer);
  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');

  readonly validacionId = input.required<string>();
  readonly version = input.required<number>();
  /** Solo se puede abrir con el caso tomado (o siendo supervisión): lo decide la API; aquí se refleja. */
  readonly habilitado = input<boolean>(false);
  /** Con el caso tomado por la persona, el RUT se abre solo: ya decidió trabajarlo. */
  readonly autoabrir = input<boolean>(false);
  /** Avisa que hubo actividad (para renovar la reserva). */
  readonly actividad = output<void>();

  readonly estado = signal<EstadoVisor>('cerrado');
  readonly error = signal<string | null>(null);
  readonly url = signal<string | null>(null);
  readonly mime = signal<string>('application/pdf');
  readonly zoom = signal(100);
  readonly ajustarAncho = signal(true);
  readonly pagina = signal(1);
  readonly ampliado = signal(false);

  readonly esPdf = computed(() => this.mime() === 'application/pdf');
  readonly etiquetaZoom = computed(() => (this.ajustarAncho() ? 'Ancho' : `${this.zoom()} %`));
  readonly puedeAlejar = computed(() => this.zoom() > PASOS_ZOOM[0]);
  readonly puedeAcercar = computed(() => this.zoom() < PASOS_ZOOM[PASOS_ZOOM.length - 1]);
  /** Con la barra del visor integrado y los parámetros de página y zoom o de ajuste al ancho. */
  readonly urlPdf = computed<SafeResourceUrl | null>(() => {
    const u = this.url();
    if (!u) return null;
    const vista = this.ajustarAncho() ? 'view=FitH' : `zoom=${this.zoom()}`;
    return this.sanitizador.bypassSecurityTrustResourceUrl(`${u}#toolbar=1&navpanes=0&page=${this.pagina()}&${vista}`);
  });

  constructor() {
    // Al cambiar de caso se libera lo anterior: un blob de otro estudiante no debe quedar en memoria. Si la persona tiene el
    // caso tomado, se abre el RUT. `untracked`: solo el cambio de caso (o de habilitación) debe dispararlo.
    effect(() => {
      const id = this.validacionId();
      const auto = this.autoabrir() && this.habilitado();
      untracked(() => { this.cerrar(); if (id && auto) void this.abrir(); });
    });
    inject(DestroyRef).onDestroy(() => this.liberar());
  }

  async abrir(): Promise<void> {
    if (this.estado() === 'cargando') return;
    this.estado.set('cargando');
    this.error.set(null);
    try {
      const blob = await firstValueFrom(this.api.archivoRut(this.validacionId()));
      this.liberar();
      this.mime.set(blob.type || 'application/pdf');
      this.url.set(URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' })));
      this.zoom.set(100);
      this.ajustarAncho.set(true);
      this.pagina.set(1);
      this.estado.set('listo');
      this.actividad.emit();
    } catch (e) {
      this.error.set(traducirErrorEps(e));
      this.estado.set('error');
    }
  }

  irAPagina(n: number | string | null): void {
    const v = Math.max(1, Math.floor(Number(n)) || 1);
    this.pagina.set(v);
    this.actividad.emit();
  }

  acercar(): void { this.mover(1); }
  alejar(): void { this.mover(-1); }
  private mover(paso: 1 | -1): void {
    const i = PASOS_ZOOM.findIndex((z) => z >= this.zoom());
    const actual = i < 0 ? PASOS_ZOOM.length - 1 : i;
    this.zoom.set(PASOS_ZOOM[Math.min(PASOS_ZOOM.length - 1, Math.max(0, actual + paso))]);
    this.ajustarAncho.set(false);
    this.actividad.emit();
  }
  ajustar(): void { this.ajustarAncho.update((v) => !v); this.actividad.emit(); }

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
}
