import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CLAVE_TEMA, ModoTema, atributosTema, debeAnimarTema, resolverTema } from '@shared/utils/tema';

/**
 * Tema de la aplicación. El script `assets/tema-inicial.js` ya aplicó el tema guardado antes del primer
 * pintado; este servicio lo adopta tal cual (sin parpadeo), lo mantiene en una señal y lo persiste.
 */
/** `<meta name="theme-color">` por tema: los mismos valores que assets/tema-inicial.js. */
export const COLOR_BARRA: Record<ModoTema, string> = { claro: '#D3E4EE', oscuro: '#0A1C20' };

@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly documento = inject(DOCUMENT);
  private readonly _tema = signal<ModoTema>(this.inicial());

  readonly tema = this._tema.asReadonly();
  readonly esClaro = computed(() => this._tema() === 'claro');
  readonly etiqueta = computed(() => (this._tema() === 'claro' ? 'Tema claro' : 'Tema oscuro'));

  constructor() {
    this.aplicar(this._tema());
  }

  /** Cambia el tema, lo aplica al documento y lo guarda (misma clave y valores de siempre). */
  establecer(modo: ModoTema): void {
    this._tema.set(modo);
    this.aplicar(modo);
    try { localStorage.setItem(CLAVE_TEMA, modo); } catch { /* sin almacenamiento: el tema no persiste */ }
  }

  private aplicar(modo: ModoTema): void {
    const a = atributosTema(modo);
    const raiz = this.documento.documentElement;
    raiz.dataset['theme'] = a.theme;
    raiz.dataset['modo'] = a.modo;
    // Mismo color de barra del navegador que fija assets/tema-inicial.js antes del primer pintado.
    this.documento.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[modo]);
  }

  /** Cambio con fundido de 240 ms (View Transitions); sin soporte o con movimiento reducido, cambia en seco. */
  alternar(): void {
    const siguiente: ModoTema = this._tema() === 'oscuro' ? 'claro' : 'oscuro';
    const doc = this.documento as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reducido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || !debeAnimarTema(reducido, true)) { this.establecer(siguiente); return; }
    const raiz = doc.documentElement;
    raiz.dataset['transicion'] = 'tema';
    const t = doc.startViewTransition(() => { this.establecer(siguiente); });
    void t.finished.finally(() => { delete raiz.dataset['transicion']; });
  }

  private inicial(): ModoTema {
    const prefiereClaro = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    let guardado: string | null = null;
    try { guardado = localStorage.getItem(CLAVE_TEMA); } catch { /* sin almacenamiento */ }
    return resolverTema(guardado, prefiereClaro);
  }
}
