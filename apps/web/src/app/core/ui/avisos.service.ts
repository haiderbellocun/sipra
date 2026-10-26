import { Injectable, signal } from '@angular/core';

export type TipoAviso = 'ok' | 'error' | 'info';

export interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
  /** Milisegundos hasta que se cierra solo; los errores esperan más. */
  duracion: number;
}

/**
 * Avisos flotantes de la aplicación. Reemplazan las franjas fijas de éxito y
 * error: entran por abajo, se leen con `aria-live` y se cierran solos, salvo
 * que la persona los cierre antes. Un aviso igual al anterior no se repite.
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  private siguiente = 1;
  private readonly _lista = signal<Aviso[]>([]);
  readonly lista = this._lista.asReadonly();

  exito(texto: string): void { this.mostrar('ok', texto, 5000); }
  error(texto: string): void { this.mostrar('error', texto, 9000); }
  info(texto: string): void { this.mostrar('info', texto, 6000); }

  cerrar(id: number): void {
    this._lista.update((l) => l.filter((a) => a.id !== id));
  }

  private mostrar(tipo: TipoAviso, texto: string, duracion: number): void {
    const limpio = texto.trim();
    if (!limpio) return;
    const ultimo = this._lista().at(-1);
    if (ultimo && ultimo.texto === limpio && ultimo.tipo === tipo) return;
    const aviso: Aviso = { id: this.siguiente++, tipo, texto: limpio, duracion };
    this._lista.update((l) => [...l.slice(-3), aviso]);
    setTimeout(() => this.cerrar(aviso.id), duracion);
  }
}
