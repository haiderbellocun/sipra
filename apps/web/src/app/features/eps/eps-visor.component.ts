import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { DetalleMesa } from '@core/models/modelos';
import { ApiService } from '@core/services/api.service';
import { fechaCorta, traducirErrorEps } from './eps.util';

type EstadoVisor = 'cerrado' | 'cargando' | 'listo' | 'error';

/**
 * Visor del certificado. El contenido llega por la sesión autenticada (cabecera
 * Authorization) como un blob local: no hay enlace firmado, ni credencial en la URL,
 * ni URL permanente. El blob se libera al cerrar el visor o cambiar de caso.
 *
 * Dos presentaciones del MISMO blob (ampliar no vuelve a pedir el archivo, así que no se
 * audita una segunda visualización):
 *  · vista normal: vista previa grande, sin la barra del visor nativo (no se duplican controles)
 *    y un botón «Ampliar documento»;
 *  · vista ampliada: diálogo modal casi a pantalla completa. Para PDF usa el visor integrado del
 *    navegador con su propia barra (zoom, páginas, descarga e impresión); para PNG/JPEG hay zoom propio.
 */
@Component({
  selector: 'sipra-eps-visor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Llena la columna que lo contiene (en escritorio, la columna fija del certificado). La altura mínima la
       fija quien lo aloja con --visor-min; sin eso, una vista previa cómoda. */
    :host { display:flex; flex-direction:column; height:100%; min-height:0; }
    .barra { display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center; margin-bottom:var(--sp-2); }
    .barra .meta { flex:1 1 7rem; font-size:var(--fs-sm); color:var(--texto-tenue); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .barra .meta strong { color:var(--texto); }
    .marco { border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie-2); overflow:auto; flex:1 1 auto; min-height:0; display:grid; }
    .marco.previa { display:block; min-height:var(--visor-min, clamp(420px, 70dvh, 820px)); }
    .marco iframe { width:100%; height:100%; border:0; display:block; background:#fff; }
    .marco img { display:block; margin:0 auto; transform-origin:top center; max-width:100%; height:auto; }
    .estado { padding:var(--sp-5); text-align:center; color:var(--texto-tenue); }
    .zoom { min-width:4.5ch; text-align:center; font-variant-numeric:tabular-nums; }

    dialog.ampliado {
      padding:0; border:1px solid var(--borde); border-radius:var(--r-md, 12px);
      width:min(1280px, 96vw); height:94dvh; max-width:96vw; max-height:94dvh;
      background:var(--superficie); color:var(--texto);
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
      <div class="meta" [attr.title]="meta().nombreOriginal + ' · versión ' + meta().version + ' · cargado ' + cargado()">
        <strong>{{ meta().nombreOriginal }}</strong> · v{{ meta().version }} · {{ esPdf() ? 'PDF' : 'Imagen' }}
      </div>
      @if (estado() === 'cerrado' || estado() === 'error') {
        <button type="button" class="boton boton--primario compacto" [disabled]="!habilitado()" (click)="abrir()">Abrir el certificado</button>
      }
      @if (estado() === 'listo') {
        <button type="button" class="boton boton--primario compacto" (click)="ampliar()">Ampliar documento</button>
        <button type="button" class="boton compacto" (click)="cerrar()">Cerrar</button>
      }
    </div>

    @switch (estado()) {
      @case ('cerrado') {
        <div class="marco"><div class="estado">
          @if (habilitado()) { El certificado no se carga hasta que lo abra, para no exponer datos personales sin necesidad. }
          @else { Tome el caso para abrir el certificado. }
        </div></div>
      }
      @case ('cargando') { <div class="marco"><div class="estado" role="status">Cargando el certificado…</div></div> }
      @case ('error') { <div class="marco"><div class="estado" role="alert">{{ error() }}</div></div> }
      @case ('listo') {
        <div class="marco previa">
          @if (esPdf()) {
            <iframe [src]="urlPrevia()" title="Certificado de EPS (vista previa)"></iframe>
          } @else {
            <img [src]="url()" alt="Certificado de EPS cargado por el estudiante" />
          }
        </div>
      }
    }

    <dialog #dialogo class="ampliado" aria-label="Certificado de EPS ampliado" (close)="ampliado.set(false)">
      @if (ampliado() && url()) {
        <div class="ampliado-cab">
          <span class="titulo">{{ meta().nombreOriginal }} · versión {{ meta().version }}</span>
          @if (!esPdf()) {
            <button type="button" class="boton compacto" (click)="alejar()" aria-label="Alejar">−</button>
            <span class="zoom" aria-live="polite">{{ zoom() }} %</span>
            <button type="button" class="boton compacto" (click)="acercar()" aria-label="Acercar">+</button>
          }
          <button type="button" class="boton boton--primario compacto" (click)="cerrarAmpliado()">Cerrar</button>
        </div>
        <div class="ampliado-cuerpo">
          @if (esPdf()) {
            <iframe [src]="urlAmpliada()" title="Certificado de EPS (PDF ampliado)"></iframe>
          } @else {
            <img [src]="url()" [style.transform]="'scale(' + zoom() / 100 + ')'" alt="Certificado de EPS cargado por el estudiante" />
          }
        </div>
      }
    </dialog>
  `,
})
export class EpsVisorComponent {
  private readonly api = inject(ApiService);
  private readonly sanitizador = inject(DomSanitizer);
  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');

  readonly validacionId = input.required<string>();
  readonly meta = input.required<DetalleMesa['certificado']>();
  /** Solo se puede abrir con el caso tomado (o siendo supervisión): lo decide la API; aquí se refleja. */
  readonly habilitado = input<boolean>(false);
  /** Avisa que hubo actividad (para renovar la reserva). */
  readonly actividad = output<void>();

  readonly estado = signal<EstadoVisor>('cerrado');
  readonly error = signal<string | null>(null);
  readonly url = signal<string | null>(null);
  readonly zoom = signal(100);
  readonly ampliado = signal(false);

  readonly esPdf = computed(() => this.meta().mime === 'application/pdf');
  readonly cargado = computed(() => fechaCorta(this.meta().cargadoEn));
  /** Vista previa: ajustada al ancho y sin barra ni panel lateral del visor nativo. */
  readonly urlPrevia = computed<SafeResourceUrl | null>(() => this.conParametros('toolbar=0&navpanes=0&view=FitH'));
  /** Vista ampliada: con la barra nativa (zoom, páginas, descarga e impresión) y ajustada al ancho. */
  readonly urlAmpliada = computed<SafeResourceUrl | null>(() => this.conParametros('toolbar=1&navpanes=0&view=FitH'));

  constructor() {
    // Al cambiar de caso se libera lo anterior: un blob de otro estudiante no debe quedar en memoria.
    // `untracked`: `cerrar()` lee y escribe señales propias; solo el cambio de caso debe dispararlo.
    effect(() => { this.validacionId(); untracked(() => this.cerrar()); });
    inject(DestroyRef).onDestroy(() => this.liberar());
  }

  private conParametros(parametros: string): SafeResourceUrl | null {
    const u = this.url();
    return u ? this.sanitizador.bypassSecurityTrustResourceUrl(`${u}#${parametros}`) : null;
  }

  async abrir(): Promise<void> {
    this.estado.set('cargando');
    this.error.set(null);
    try {
      const blob = await firstValueFrom(this.api.certificadoMesaEps(this.validacionId()));
      this.liberar();
      this.url.set(URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: this.meta().mime })));
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
