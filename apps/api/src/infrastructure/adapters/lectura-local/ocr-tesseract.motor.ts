import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  LimiteLecturaLocalError, LimitesLecturaLocal, ResultadoOcrPagina, VarianteOcr,
} from '../../../domain/ports/out/lector-documento-local.port';
import { ampliarImagen, girarImagen, mejorarParaOcr } from './imagen-local';
import { Semaforo, conTiempoLimite } from './semaforo';

interface TrabajadorOcr {
  setParameters(parametros: Record<string, string>): Promise<unknown>;
  recognize(imagen: Buffer): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}
interface ModuloTesseract {
  createWorker(idioma: string, oem: number, opciones: Record<string, unknown>): Promise<TrabajadorOcr>;
}

/** Confianza y volumen de texto mínimos para dar por buena una lectura sin probar otras orientaciones. */
const CONFIANZA_SUFICIENTE = 70;
const CARACTERES_SUFICIENTES = 60;
const INACTIVIDAD_MS = 60_000;

/**
 * Directorio con el modelo de idioma EMPAQUETADO (`@tesseract.js-data/spa`).
 * No hay descarga en ejecución ni CDN: si falta, el OCR falla cerrado.
 * `OCR_DATOS_IDIOMA_DIR` permite apuntar a otra copia local (p. ej. en la imagen Docker).
 */
export function directorioDatosIdioma(): string {
  const explicito = process.env.OCR_DATOS_IDIOMA_DIR?.trim();
  if (explicito) return explicito;
  const raiz = dirname(createRequire(__filename).resolve('@tesseract.js-data/spa'));
  return join(raiz, '4.0.0_best_int');
}

/**
 * OCR local con Tesseract (WASM) sobre UN trabajador reutilizado: arrancarlo
 * cuesta ~0,3 s y ~50 MB, así que se conserva entre páginas y se cierra tras un
 * minuto sin uso. Las lecturas se serializan (`maxConcurrentes`, 1 por defecto)
 * para que varios documentos grandes no agoten la memoria de la instancia.
 */
export class OcrTesseractMotor {
  private trabajador: TrabajadorOcr | null = null;
  private inactividad: NodeJS.Timeout | null = null;
  private readonly semaforo: Semaforo;

  constructor(maxConcurrentes = 1) {
    this.semaforo = new Semaforo(maxConcurrentes);
  }

  private async obtener(): Promise<TrabajadorOcr> {
    if (this.trabajador) return this.trabajador;
    const langPath = directorioDatosIdioma();
    if (!existsSync(join(langPath, 'spa.traineddata.gz'))) {
      throw new Error('No está el modelo de idioma local del OCR; no se descarga en ejecución');
    }
    const tesseract = createRequire(__filename)('tesseract.js') as ModuloTesseract;
    this.trabajador = await tesseract.createWorker('spa', 1, {
      langPath,
      gzip: true,
      // Sin caché en disco ni descargas: el modelo se lee del paquete.
      cacheMethod: 'none',
      workerBlobURL: false,
    });
    return this.trabajador;
  }

  private programarCierre(): void {
    if (this.inactividad) clearTimeout(this.inactividad);
    this.inactividad = setTimeout(() => { void this.cerrar(); }, INACTIVIDAD_MS);
    this.inactividad.unref();
  }

  async cerrar(): Promise<void> {
    if (this.inactividad) clearTimeout(this.inactividad);
    this.inactividad = null;
    const t = this.trabajador;
    this.trabajador = null;
    if (t) await t.terminate().catch(() => undefined);
  }

  /** `psm`: segmentación de página de Tesseract (3 automática, 4 columnas, 6 bloque uniforme). Se fija en CADA lectura: el trabajador es compartido. */
  private async leer(png: Buffer, limites: LimitesLecturaLocal, psm = '3'): Promise<{ texto: string; confianza: number }> {
    const trabajador = await this.obtener();
    try {
      await trabajador.setParameters({ tessedit_pageseg_mode: psm });
      const r = await conTiempoLimite(trabajador.recognize(png), limites.timeoutMs, () =>
        new LimiteLecturaLocalError('tiempo', 'Se agotó el tiempo del OCR'));
      return { texto: r.data.text, confianza: r.data.confidence };
    } catch (error) {
      // Tras un tiempo agotado el trabajador queda en estado incierto: se descarta.
      if (error instanceof LimiteLecturaLocalError) await this.cerrar();
      throw error;
    }
  }

  /**
   * Lee la imagen; si el resultado es pobre prueba, en orden, la versión con
   * contraste mejorado y los giros de 90°, 180° y 270°, y se queda con la mejor.
   */
  async reconocer(
    png: Buffer, pagina: number | null, limites: LimitesLecturaLocal, variante: VarianteOcr = 'automatica',
  ): Promise<ResultadoOcrPagina> {
    return this.semaforo.ejecutar(async () => {
      try {
        // Variantes de UNA sola pasada: las pide quien ya vio que la automática no alcanzó (ver LecturaLocalEpsService).
        if (variante === 'bloque') return { pagina, ...(await this.leer(png, limites, '6')), giro: 0 };
        if (variante === 'reforzada') {
          const grande = await ampliarImagen(await mejorarParaOcr(png), 1.5, limites.maxPixeles * 2);
          return { pagina, ...(await this.leer(grande, limites, '4')), giro: 0 };
        }
        const intentos: Array<{ texto: string; confianza: number; giro: number }> = [];
        const util = (r: { texto: string; confianza: number }): boolean =>
          r.confianza >= CONFIANZA_SUFICIENTE && r.texto.replace(/\s+/g, '').length >= CARACTERES_SUFICIENTES;

        const primero = await this.leer(png, limites);
        intentos.push({ ...primero, giro: 0 });
        if (!util(primero)) {
          const mejorada = await mejorarParaOcr(png);
          intentos.push({ ...(await this.leer(mejorada, limites)), giro: 0 });
          for (const giro of [90, 180, 270] as const) {
            if (intentos.some((i) => util(i))) break;
            intentos.push({ ...(await this.leer(await girarImagen(mejorada, giro), limites)), giro });
          }
        }
        const puntaje = (i: { texto: string; confianza: number }): number =>
          i.confianza * Math.min(1, i.texto.replace(/\s+/g, '').length / 200);
        const mejor = intentos.reduce((a, b) => (puntaje(b) > puntaje(a) ? b : a));
        return { pagina, texto: mejor.texto, confianza: mejor.confianza, giro: mejor.giro };
      } finally {
        this.programarCierre();
      }
    });
  }
}
