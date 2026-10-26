import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ColaPort, PrioridadTrabajo, ResultadoEncolado, Trabajo,
} from '../../../domain/ports/out/servicios-externos.port';

/** Reintentos con espera creciente ante fallo transitorio. */
const MAX_INTENTOS = 5;
const ESPERA_BASE_MS = 1_000;

type Ejecutor = (trabajo: Trabajo) => Promise<void>;

/**
 * Cola en proceso, para desarrollo y pruebas.
 *
 * Reproduce fielmente la semántica que importa —dos prioridades, la
 * interactiva siempre antes que la de lote, reintentos con espera creciente—
 * para que el comportamiento observado en local sea el mismo que en Cloud Tasks.
 */
@Injectable()
export class ColaEnProcesoAdapter implements ColaPort, OnModuleDestroy {
  private readonly log = new Logger(ColaEnProcesoAdapter.name);
  private readonly colas: Record<PrioridadTrabajo, Trabajo[]> = { interactiva: [], lote: [] };
  private ejecutor: Ejecutor | null = null;
  private drenando = false;
  private detenido = false;

  /**
   * Donde el proceso se congela al responder —el ambiente puente sin
   * servidor— un drenado diferido nunca llega a ejecutarse. En ese caso el
   * trabajo se atiende antes de contestar y así se declara al llamador.
   */
  private readonly enLinea: boolean;

  constructor(config: ConfigService) {
    this.enLinea = config.get<string>('COLA_DRIVER') === 'en_linea';
  }

  /** El módulo enlaza aquí el procesador real al arrancar. */
  registrarEjecutor(ejecutor: Ejecutor): void {
    this.ejecutor = ejecutor;
  }

  async encolar(trabajo: Trabajo): Promise<ResultadoEncolado> {
    const id = randomUUID();
    this.colas[trabajo.prioridad].push({ ...trabajo, intentos: trabajo.intentos ?? 0 });
    if (this.enLinea) {
      await this.drenar();
      return { id, prioridad: trabajo.prioridad, ejecutadoEnLinea: true };
    }
    void this.drenar();
    return { id, prioridad: trabajo.prioridad, ejecutadoEnLinea: false };
  }

  async profundidad(): Promise<Record<PrioridadTrabajo, number>> {
    return { interactiva: this.colas.interactiva.length, lote: this.colas.lote.length };
  }

  onModuleDestroy(): void {
    this.detenido = true;
  }

  /** La cola interactiva se agota antes de tocar la de lote. */
  private siguiente(): Trabajo | undefined {
    return this.colas.interactiva.shift() ?? this.colas.lote.shift();
  }

  private async drenar(): Promise<void> {
    if (this.drenando || !this.ejecutor) return;
    this.drenando = true;
    try {
      let trabajo = this.siguiente();
      while (trabajo && !this.detenido) {
        await this.procesar(trabajo);
        trabajo = this.siguiente();
      }
    } finally {
      this.drenando = false;
    }
  }

  private async procesar(trabajo: Trabajo): Promise<void> {
    try {
      await this.ejecutor!(trabajo);
    } catch (error) {
      const intentos = (trabajo.intentos ?? 0) + 1;
      if (intentos >= MAX_INTENTOS) {
        this.log.error(
          `Trabajo ${trabajo.tipo}/${trabajo.referencia} agotó ${MAX_INTENTOS} intentos: ` +
            `${(error as Error).message}`,
        );
        return;
      }
      const espera = ESPERA_BASE_MS * 2 ** (intentos - 1);
      this.log.warn(
        `Trabajo ${trabajo.tipo}/${trabajo.referencia} falló (intento ${intentos}). ` +
          `Reintento en ${espera} ms.`,
      );
      setTimeout(() => {
        this.colas[trabajo.prioridad].push({ ...trabajo, intentos });
        void this.drenar();
      }, espera).unref?.();
    }
  }
}

/**
 * Cloud Tasks. Encola una petición HTTP autenticada al endpoint worker del
 * propio servicio, de modo que el escalado automático de Cloud Run responda a
 * la profundidad de la cola.
 *
 * Se usan DOS colas distintas, no una con prioridades: Cloud Tasks no ordena
 * por prioridad dentro de una cola, así que la separación es la única forma
 * real de que el cargue en curso no quede detrás del lote nocturno.
 */
@Injectable()
export class ColaCloudTasksAdapter implements ColaPort {
  private readonly log = new Logger(ColaCloudTasksAdapter.name);
  private clienteCache: unknown;

  constructor(private readonly config: ConfigService) {}

  private nombreCola(prioridad: PrioridadTrabajo): string {
    const proyecto = this.config.getOrThrow<string>('GCP_PROYECTO');
    const region = this.config.getOrThrow<string>('GCP_REGION');
    const ambiente = this.config.getOrThrow<string>('SIPRA_AMBIENTE');
    const sufijo = prioridad === 'interactiva' ? 'documentos' : 'lote';
    return `projects/${proyecto}/locations/${region}/queues/sipra-${sufijo}-${ambiente}`;
  }

  private async cliente(): Promise<{
    createTask: (p: unknown) => Promise<[{ name?: string }]>;
    getQueue: (p: unknown) => Promise<[{ stats?: { tasksCount?: number } }]>;
  }> {
    if (!this.clienteCache) {
      const { CloudTasksClient } = await import('@google-cloud/tasks');
      this.clienteCache = new CloudTasksClient();
    }
    return this.clienteCache as never;
  }

  async encolar(trabajo: Trabajo): Promise<ResultadoEncolado> {
    const cliente = await this.cliente();
    const url = `${this.config.getOrThrow<string>('WORKER_URL')}/api/v1/trabajos/procesar`;

    const [tarea] = await cliente.createTask({
      parent: this.nombreCola(trabajo.prioridad),
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(trabajo)).toString('base64'),
          // Identidad de servicio: el worker no acepta peticiones anónimas.
          oidcToken: {
            serviceAccountEmail: this.config.getOrThrow<string>('GCP_CUENTA_SERVICIO'),
            audience: this.config.getOrThrow<string>('WORKER_URL'),
          },
        },
        dispatchDeadline: { seconds: 300 },
      },
    });

    this.log.debug(`Encolado ${trabajo.tipo}/${trabajo.referencia} en ${trabajo.prioridad}`);
    return {
      id: tarea.name ?? randomUUID(),
      prioridad: trabajo.prioridad,
      ejecutadoEnLinea: false,
    };
  }

  async profundidad(): Promise<Record<PrioridadTrabajo, number>> {
    const cliente = await this.cliente();
    const medir = async (p: PrioridadTrabajo): Promise<number> => {
      try {
        const [cola] = await cliente.getQueue({ name: this.nombreCola(p), readMask: { paths: ['stats'] } });
        return cola.stats?.tasksCount ?? 0;
      } catch {
        return 0;
      }
    };
    return { interactiva: await medir('interactiva'), lote: await medir('lote') };
  }
}
