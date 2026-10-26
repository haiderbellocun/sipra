import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import {
  DocumentoLocalIlegibleError, LimiteLecturaLocalError, LimitesLecturaLocal, PaginaRenderizada,
  ResultadoTextoNativo,
} from '../../../domain/ports/out/lector-documento-local.port';
import { Semaforo } from './semaforo';

interface Respuesta {
  id: number;
  ok: boolean;
  codigo?: string;
  resultado?: unknown;
}

const INACTIVIDAD_MS = 60_000;
/** Tope de la memoria de V8 del hilo; lo nativo (lienzos) está acotado por `maxPixeles`. */
const MEMORIA_MAXIMA_MB = 768;

/**
 * Cliente del hilo que ejecuta pdf.js (`pdfjs.worker.js`) sobre PDF no
 * confiables. Un solo hilo reutilizado, con las peticiones en fila. Si una
 * operación excede su tiempo, el hilo se TERMINA (no solo se deja de esperar) y
 * el siguiente pedido arranca uno limpio.
 *
 * Si se vuelve a pedir una operación sobre el MISMO `Buffer`, el hilo reutiliza
 * el documento ya abierto sin recibir de nuevo los bytes.
 */
export class PdfTrabajador {
  private hilo: Worker | null = null;
  private pedidos = 0;
  private readonly pendientes = new Map<number, { hilo: Worker; ok: (r: unknown) => void; fallo: (e: Error) => void }>();
  private ultimo: { contenido: Buffer; id: number } | null = null;
  private documentos = 0;
  private inactividad: NodeJS.Timeout | null = null;
  private readonly fila = new Semaforo(1);

  private obtener(): Worker {
    if (this.hilo) return this.hilo;
    const hilo = new Worker(join(__dirname, 'pdfjs.worker.js'), {
      workerData: { base: __filename },
      resourceLimits: { maxOldGenerationSizeMb: MEMORIA_MAXIMA_MB },
    });
    hilo.unref();
    hilo.on('message', (r: Respuesta) => {
      const p = this.pendientes.get(r.id);
      if (!p) return;
      this.pendientes.delete(r.id);
      if (r.ok) p.ok(r.resultado);
      else p.fallo(this.errorDe(r.codigo));
    });
    const caer = (): void => {
      if (this.hilo === hilo) { this.hilo = null; this.ultimo = null; }
      // Solo los pedidos de ESTE hilo: un hilo viejo que termina tarde no debe tumbar los del nuevo.
      for (const [id, p] of this.pendientes) {
        if (p.hilo !== hilo) continue;
        this.pendientes.delete(id);
        p.fallo(new Error('lector_pdf_caido'));
      }
    };
    hilo.on('error', caer);
    hilo.on('exit', caer);
    this.hilo = hilo;
    return hilo;
  }

  private errorDe(codigo: string | undefined): Error {
    switch (codigo) {
      case 'pdf_no_valido': return new DocumentoLocalIlegibleError('pdf_no_valido');
      case 'paginas': return new LimiteLecturaLocalError('paginas', 'El PDF tiene más páginas de las admitidas para su lectura');
      case 'pixeles': return new LimiteLecturaLocalError('pixeles', 'La página excede los píxeles admitidos');
      default: return new Error(codigo ?? 'lector_pdf_fallido');
    }
  }

  private async cerrar(): Promise<void> {
    if (this.inactividad) clearTimeout(this.inactividad);
    this.inactividad = null;
    const hilo = this.hilo;
    this.hilo = null;
    this.ultimo = null;
    if (hilo) await hilo.terminate().catch(() => undefined);
  }

  async terminar(): Promise<void> {
    await this.cerrar();
  }

  private async pedir<T>(
    contenido: Buffer, limites: LimitesLecturaLocal, mensaje: Record<string, unknown>,
  ): Promise<T> {
    return this.fila.ejecutar(async () => {
      if (this.inactividad) clearTimeout(this.inactividad);
      const hilo = this.obtener();
      const mismo = this.ultimo !== null && this.ultimo.contenido === contenido;
      if (!mismo) this.ultimo = { contenido, id: (this.documentos += 1) };
      const pedido = (this.pedidos += 1);
      try {
        return await new Promise<T>((ok, fallo) => {
          const temporizador = setTimeout(() => {
            this.pendientes.delete(pedido);
            // Cancelación REAL: el hilo se termina para que no siga consumiendo CPU ni memoria.
            void this.cerrar();
            fallo(new LimiteLecturaLocalError('tiempo', 'Se agotó el tiempo de lectura del PDF'));
          }, limites.timeoutMs);
          this.pendientes.set(pedido, {
            hilo,
            ok: (r) => { clearTimeout(temporizador); ok(r as T); },
            fallo: (e) => { clearTimeout(temporizador); fallo(e); },
          });
          hilo.postMessage({
            ...mensaje, pedido, limites, documento: (this.ultimo as { id: number }).id, datos: mismo ? null : contenido,
          });
        });
      } finally {
        this.inactividad = setTimeout(() => { void this.cerrar(); }, INACTIVIDAD_MS);
        this.inactividad.unref();
      }
    });
  }

  extraerTexto(contenido: Buffer, limites: LimitesLecturaLocal): Promise<ResultadoTextoNativo> {
    return this.pedir<ResultadoTextoNativo>(contenido, limites, { op: 'texto' });
  }

  async renderizar(contenido: Buffer, pagina: number, limites: LimitesLecturaLocal): Promise<PaginaRenderizada> {
    const r = await this.pedir<{ pagina: number; ancho: number; alto: number; imagen: Uint8Array }>(
      contenido, limites, { op: 'render', pagina },
    );
    return { pagina: r.pagina, ancho: r.ancho, alto: r.alto, imagen: Buffer.from(r.imagen) };
  }
}
