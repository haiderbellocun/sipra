import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked,
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
 * ni URL permanente. Para PDF se usa el visor integrado del navegador (zoom y páginas);
 * para PNG/JPEG hay zoom propio. El blob se libera al cerrar o cambiar de caso.
 */
@Component({
  selector: 'sipra-eps-visor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .barra { display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center; margin-bottom:var(--sp-2); }
    .barra .meta { flex:1 1 220px; font-size:var(--fs-sm); color:var(--texto-tenue); min-width:0; }
    .marco { border:1px solid var(--borde); border-radius:var(--r-sm); background:var(--superficie-2); overflow:auto; height:min(70vh, 640px); }
    .marco iframe { width:100%; height:100%; border:0; display:block; background:#fff; }
    .marco img { display:block; margin:0 auto; transform-origin:top center; max-width:none; }
    .estado { padding:var(--sp-5); text-align:center; color:var(--texto-tenue); }
    .zoom { min-width:4.5ch; text-align:center; font-variant-numeric:tabular-nums; }
  `],
  template: `
    <div class="barra">
      <div class="meta">
        <strong>{{ meta().nombreOriginal }}</strong> · versión {{ meta().version }} · cargado {{ cargado() }}
        · {{ esPdf() ? 'PDF' : 'Imagen' }}
      </div>
      @if (estado() === 'cerrado' || estado() === 'error') {
        <button type="button" class="boton boton--primario compacto" [disabled]="!habilitado()" (click)="abrir()">Abrir el certificado</button>
      }
      @if (estado() === 'listo') {
        <button type="button" class="boton compacto" (click)="alejar()" aria-label="Alejar">−</button>
        <span class="zoom" aria-live="polite">{{ zoom() }} %</span>
        <button type="button" class="boton compacto" (click)="acercar()" aria-label="Acercar">+</button>
        @if (esPdf()) {
          <button type="button" class="boton compacto" (click)="paginaAnterior()" [disabled]="pagina() <= 1">Página anterior</button>
          <span class="zoom" aria-live="polite">pág. {{ pagina() }}</span>
          <button type="button" class="boton compacto" (click)="paginaSiguiente()">Página siguiente</button>
        }
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
        <div class="marco">
          @if (esPdf()) {
            <iframe [src]="urlSegura()" title="Certificado de EPS (PDF)"></iframe>
          } @else {
            <img [src]="url()" [style.transform]="'scale(' + zoom() / 100 + ')'" alt="Certificado de EPS cargado por el estudiante" />
          }
        </div>
      }
    }
  `,
})
export class EpsVisorComponent {
  private readonly api = inject(ApiService);
  private readonly sanitizador = inject(DomSanitizer);

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
  readonly pagina = signal(1);

  readonly esPdf = computed(() => this.meta().mime === 'application/pdf');
  readonly cargado = computed(() => fechaCorta(this.meta().cargadoEn));
  readonly urlSegura = computed<SafeResourceUrl | null>(() => {
    const u = this.url();
    return u ? this.sanitizador.bypassSecurityTrustResourceUrl(`${u}#page=${this.pagina()}&zoom=${this.zoom()}`) : null;
  });

  constructor() {
    // Al cambiar de caso se libera lo anterior: un blob de otro estudiante no debe quedar en memoria.
    // `untracked`: `cerrar()` lee y escribe señales propias; solo el cambio de caso debe dispararlo.
    effect(() => { this.validacionId(); untracked(() => this.cerrar()); });
    inject(DestroyRef).onDestroy(() => this.liberar());
  }

  async abrir(): Promise<void> {
    this.estado.set('cargando');
    this.error.set(null);
    try {
      const blob = await firstValueFrom(this.api.certificadoMesaEps(this.validacionId()));
      this.liberar();
      this.url.set(URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: this.meta().mime })));
      this.zoom.set(100);
      this.pagina.set(1);
      this.estado.set('listo');
      this.actividad.emit();
    } catch (e) {
      this.error.set(traducirErrorEps(e));
      this.estado.set('error');
    }
  }

  cerrar(): void {
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
  paginaSiguiente(): void { this.pagina.update((p) => p + 1); this.actividad.emit(); }
  paginaAnterior(): void { this.pagina.update((p) => Math.max(1, p - 1)); }
}
