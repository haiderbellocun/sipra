import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HallazgoQrCrudo, LectorDocumentoLocalPort, LimitesLecturaLocal, PaginaRenderizada,
  ResultadoOcrPagina, ResultadoTextoNativo,
} from '../../../domain/ports/out/lector-documento-local.port';
import { normalizarImagen } from './imagen-local';
import { OcrTesseractMotor } from './ocr-tesseract.motor';
import { PdfTrabajador } from './pdfjs.lector';
import { Semaforo } from './semaforo';
import { cargarZxing } from './zxing.cargador';
import { INTERRUPTORES_EPS, interruptorActivo } from '../../../domain/services/interruptores-eps';

/**
 * Lector documental local: pdf.js (texto y rasterización), ZXing-WASM (QR) y
 * Tesseract (OCR). Todo en el proceso, en memoria y sin red.
 */
@Injectable()
export class LectorDocumentoLocalAdapter implements LectorDocumentoLocalPort, OnModuleDestroy {
  private readonly log = new Logger(LectorDocumentoLocalAdapter.name);
  private readonly ocr: OcrTesseractMotor;
  private readonly render: Semaforo;
  private readonly pdf = new PdfTrabajador();

  constructor(@Optional() private readonly config?: ConfigService) {
    this.ocr = new OcrTesseractMotor(Number(config?.get('LECTURA_LOCAL_OCR_CONCURRENTES') ?? 1));
    this.render = new Semaforo(Number(config?.get('LECTURA_LOCAL_RENDER_CONCURRENTES') ?? 2));
  }

  async onModuleDestroy(): Promise<void> {
    await this.ocr.cerrar();
    await this.pdf.terminar();
  }

  extraerTextoNativo(contenido: Buffer, limites: LimitesLecturaLocal): Promise<ResultadoTextoNativo> {
    return this.pdf.extraerTexto(contenido, limites);
  }

  renderizarPagina(contenido: Buffer, pagina: number, limites: LimitesLecturaLocal): Promise<PaginaRenderizada> {
    return this.pdf.renderizar(contenido, pagina, limites);
  }

  async prepararImagen(contenido: Buffer, mime: string, limites: LimitesLecturaLocal): Promise<PaginaRenderizada> {
    const { ancho, alto, png } = await this.render.ejecutar(() => normalizarImagen(contenido, mime, limites));
    return { pagina: 1, ancho, alto, imagen: png };
  }

  async detectarQr(imagen: Buffer, pagina: number | null): Promise<HallazgoQrCrudo[]> {
    try {
      const { readBarcodes } = await cargarZxing();
      const leidos = await readBarcodes(new Blob([new Uint8Array(imagen)], { type: 'image/png' }), {
        formats: ['QRCode'],
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        maxNumberOfSymbols: 8,
      });
      return leidos
        .filter((r) => r.isValid)
        .map((r) => {
          const p = r.position;
          const xs = p ? [p.topLeft.x, p.topRight.x, p.bottomRight.x, p.bottomLeft.x] : [];
          const ys = p ? [p.topLeft.y, p.topRight.y, p.bottomRight.y, p.bottomLeft.y] : [];
          return {
            formato: r.format,
            contenido: r.text,
            pagina,
            posicion: p
              ? { x: Math.min(...xs), y: Math.min(...ys), ancho: Math.max(...xs) - Math.min(...xs), alto: Math.max(...ys) - Math.min(...ys) }
              : null,
          };
        });
    } catch (error) {
      // Un QR ilegible no es un error del sistema: simplemente no hay hallazgo.
      this.log.debug(`No se pudo leer ningún QR (${(error as Error).name})`);
      return [];
    }
  }

  ejecutarOcr(imagen: Buffer, pagina: number | null, limites: LimitesLecturaLocal): Promise<ResultadoOcrPagina> {
    // Interruptor de incidente: sin OCR la lectura sigue con texto nativo y QR; lo ilegible pasa a revisión humana.
    if (!interruptorActivo(this.config?.get(INTERRUPTORES_EPS.ocr), INTERRUPTORES_EPS.ocr)) return Promise.resolve({ pagina, texto: '', confianza: 0, giro: 0 });
    return this.ocr.reconocer(imagen, pagina, limites);
  }
}
