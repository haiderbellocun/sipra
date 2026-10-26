import { Injectable, Logger } from '@nestjs/common';
import {
  LectorCodigoBarrasPort, ResultadoCodigoBarras,
} from '../../../domain/ports/out/servicios-externos.port';
import { cargarZxing } from '../lectura-local/zxing.cargador';

/**
 * Decodificación PDF417 con ZXing compilado a WebAssembly.
 *
 * Se usa una biblioteca y no una implementación propia por una razón concreta:
 * un decodificador PDF417 escrito a mano —tablas de agrupamiento y aritmética
 * de Reed-Solomon sobre GF(929)— que no se pueda probar contra cédulas reales
 * es una fuente de datos falsos con apariencia de certeza. Sobre un documento
 * de identidad eso es inaceptable.
 *
 * ZXing es la implementación de referencia, con años de uso en producción.
 */
@Injectable()
export class Pdf417Adapter implements LectorCodigoBarrasPort {
  private readonly log = new Logger(Pdf417Adapter.name);

  async leerPdf417(contenido: Buffer, mime: string): Promise<ResultadoCodigoBarras> {
    const vacio: ResultadoCodigoBarras = { encontrado: false, formato: null, contenido: '' };
    if (!mime.startsWith('image/')) return vacio;

    try {
      const { readBarcodes } = await cargarZxing();
      const resultados = await readBarcodes(new Blob([new Uint8Array(contenido)], { type: mime }), {
        formats: ['PDF417'],
        // La cédula suele venir fotografiada de lado o con el código pequeño.
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        maxNumberOfSymbols: 1,
      });

      const primero = resultados.find((r) => r.isValid);
      if (!primero) return vacio;

      this.log.debug(`PDF417 leído: ${primero.text.length} caracteres`);
      return { encontrado: true, formato: primero.format, contenido: primero.text };
    } catch (error) {
      // Una lectura fallida no es un error del sistema: es un documento que no
      // trae código legible, y el pipeline seguirá su curso normal.
      this.log.debug(`No se pudo leer el PDF417: ${(error as Error).message}`);
      return vacio;
    }
  }
}
