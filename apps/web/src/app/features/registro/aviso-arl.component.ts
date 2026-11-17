import { ChangeDetectionStrategy, Component, ElementRef, viewChild } from '@angular/core';
import { AYUDA_ARL, MENSAJE_ARL, TITULO_ARL } from './aviso-arl';

/**
 * G3 · Diálogo informativo sobre la ARL. Patrón de SIPRA: `<dialog>` nativo con `showModal()` (foco atrapado,
 * fondo inerte y Esc para cerrar). Al cerrar devuelve el foco a quien lo abrió. Sin consentimiento: «Entendido» y
 * la X solo cierran; el clic fuera no cierra (como el resto de diálogos de SIPRA), pero Esc sí.
 */
@Component({
  selector: 'sipra-aviso-arl',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // El teclado del diálogo burbujea hasta el anfitrión: aquí se atrapa el foco (Tab / Mayús+Tab).
  host: { '(keydown)': 'atraparFoco($event)' },
  styles: [`
    dialog.aviso-arl { width:min(560px, calc(100vw - 32px)); max-height:calc(100dvh - 32px); overflow:auto; box-sizing:border-box;
      border:1px solid var(--borde); border-radius:var(--r-md); padding:var(--sp-5); background:var(--superficie); color:var(--texto);
      box-shadow:0 18px 48px rgb(0 0 0 / .28); }
    dialog.aviso-arl::backdrop { background:rgb(0 0 0 / .45); }
    .cab { display:flex; gap:var(--sp-3); align-items:flex-start; }
    .escudo { flex:none; display:grid; place-items:center; width:44px; height:44px; border-radius:12px; color:var(--marca);
      border:1px solid color-mix(in srgb, var(--marca) 45%, var(--borde)); background:color-mix(in srgb, var(--marca) 10%, transparent); position:relative; }
    .escudo svg { width:22px; height:22px; }
    /* Señal ámbar pequeña: importante, no error. */
    .escudo::after { content:""; position:absolute; top:-3px; right:-3px; width:9px; height:9px; border-radius:50%; background:var(--aviso); border:2px solid var(--superficie); }
    .titulo { margin:2px 0 0; font-size:var(--fs-xs); font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--texto-tenue); }
    .x { margin-left:auto; flex:none; display:grid; place-items:center; width:40px; height:40px; border:1px solid transparent; border-radius:var(--r-sm); background:none; color:var(--texto-tenue); cursor:pointer; }
    .x:hover { border-color:var(--borde); color:var(--texto); } .x svg { width:18px; height:18px; }
    .x:focus-visible, .boton:focus-visible { outline:2px solid var(--marca); outline-offset:2px; }
    .mensaje { margin:var(--sp-4) 0 0; font-size:var(--fs-lg); line-height:1.4; font-weight:600; text-wrap:pretty; }
    .ayuda { margin:var(--sp-2) 0 0; font-size:var(--fs-sm); color:var(--texto-tenue); }
    .acciones { display:flex; justify-content:flex-end; margin-top:var(--sp-5); padding-top:var(--sp-3); border-top:1px solid var(--borde); }
    @media (width < 480px) { dialog.aviso-arl { padding:var(--sp-4); } .acciones .boton { width:100%; } }
  `],
  template: `
    <dialog #dialogo class="aviso-arl" aria-modal="true" aria-labelledby="aviso-arl-titulo" aria-describedby="aviso-arl-mensaje aviso-arl-ayuda" (close)="alCerrar()">
      <div class="cab">
        <span class="escudo" aria-hidden="true"><svg><use href="#sipra-seguridad" /></svg></span>
        <h2 class="titulo" id="aviso-arl-titulo">{{ titulo }}</h2>
        <button type="button" class="x" aria-label="Cerrar" (click)="cerrar()"><svg aria-hidden="true"><use href="#sipra-cerrar" /></svg></button>
      </div>
      <p class="mensaje" id="aviso-arl-mensaje">{{ mensaje }}</p>
      <p class="ayuda" id="aviso-arl-ayuda">{{ ayuda }}</p>
      <div class="acciones"><button #entendido type="button" class="boton boton--primario" (click)="cerrar()">Entendido</button></div>
    </dialog>
  `,
})
export class AvisoArlComponent {
  readonly titulo = TITULO_ARL;
  readonly mensaje = MENSAJE_ARL;
  readonly ayuda = AYUDA_ARL;
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  private readonly entendido = viewChild.required<ElementRef<HTMLButtonElement>>('entendido');
  private origen: HTMLElement | null = null;
  private respaldo: HTMLElement | null = null;

  /** `respaldo`: dónde devolver el foco si lo abrió el desplazamiento (no un control enfocado). */
  abrir(respaldo: HTMLElement | null = null): void {
    const el = this.dialogo().nativeElement;
    if (el.open) return;
    const activo = document.activeElement;
    this.origen = activo instanceof HTMLElement && activo !== document.body ? activo : null;
    this.respaldo = respaldo;
    el.showModal();
    // Foco inicial en la acción principal (showModal lo pondría en la X, el primer control).
    this.entendido().nativeElement.focus();
  }

  cerrar(): void {
    const el = this.dialogo().nativeElement;
    if (el.open) el.close();
  }

  get abierto(): boolean { return this.dialogo().nativeElement.open; }

  /** Tab y Mayús+Tab giran entre los controles del diálogo (no salen a la página ni al navegador). */
  atraparFoco(evento: KeyboardEvent): void {
    if (evento.key !== 'Tab') return;
    const controles = [...this.dialogo().nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (controles.length === 0) return;
    const primero = controles[0];
    const ultimo = controles[controles.length - 1];
    if (evento.shiftKey && document.activeElement === primero) { evento.preventDefault(); ultimo.focus(); }
    else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primero.focus(); }
  }

  alCerrar(): void {
    const destino = this.origen?.isConnected ? this.origen : this.respaldo;
    this.origen = null;
    destino?.focus();
  }
}
