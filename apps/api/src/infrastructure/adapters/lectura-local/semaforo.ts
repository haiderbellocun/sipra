/** Limita cuántas operaciones pesadas corren a la vez (memoria acotada en Cloud Run). */
export class Semaforo {
  private libres: number;
  private readonly espera: Array<() => void> = [];

  constructor(maximo: number) {
    this.libres = Math.max(1, maximo);
  }

  async ejecutar<T>(tarea: () => Promise<T>): Promise<T> {
    if (this.libres > 0) this.libres -= 1;
    else await new Promise<void>((continuar) => this.espera.push(continuar));
    try {
      return await tarea();
    } finally {
      const siguiente = this.espera.shift();
      if (siguiente) siguiente();
      else this.libres += 1;
    }
  }
}

/** Rechaza con `alVencer()` si la tarea tarda más de `ms`. La tarea no se cancela: quien llama limpia. */
export function conTiempoLimite<T>(tarea: Promise<T>, ms: number, alVencer: () => Error): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(alVencer()), ms);
    temporizador.unref();
  });
  return Promise.race([tarea, limite]).finally(() => clearTimeout(temporizador));
}
