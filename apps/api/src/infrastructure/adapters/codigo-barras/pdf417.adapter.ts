import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  LectorCodigoBarrasPort, ResultadoCodigoBarras,
} from '../../../domain/ports/out/servicios-externos.port';

interface CodigoLeido {
  format: string;
  text: string;
  isValid: boolean;
}

type LeerCodigos = (
  entrada: Blob,
  opciones: Record<string, unknown>,
) => Promise<CodigoLeido[]>;

interface ModuloZxing {
  readBarcodes: LeerCodigos;
}

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
  private modulo: ModuloZxing | null = null;

  /**
   * Carga el WASM desde disco. En Node no hay `fetch` de recursos locales, y
   * dejar que la biblioteca lo busque por red sería una dependencia externa en
   * tiempo de ejecución que este servicio no debe tener.
   */
  private async cargar(): Promise<ModuloZxing> {
    if (this.modulo) return this.modulo;

    const zxing = (await import('zxing-wasm/reader')) as unknown as {
      readBarcodes: LeerCodigos;
      prepareZXingModule: (opciones: {
        overrides: Record<string, unknown>;
        fireImmediately: boolean;
      }) => Promise<unknown>;
    };

    // El paquete no expone su package.json en el mapa de `exports`, así que se
    // resuelve el binario por su propio subpath, que sí está declarado.
    const requerir = createRequire(__filename);
    const binario = await readFile(requerir.resolve('zxing-wasm/reader/zxing_reader.wasm'));

    await zxing.prepareZXingModule({
      overrides: {
        instantiateWasm: (
          importaciones: WebAssembly.Imports,
          listo: (instancia: WebAssembly.Instance, modulo: WebAssembly.Module) => void,
        ) =>
          WebAssembly.instantiate(binario, importaciones).then((r) =>
            listo(r.instance, r.module),
          ),
      },
      fireImmediately: true,
    });

    this.modulo = { readBarcodes: zxing.readBarcodes };
    return this.modulo;
  }

  async leerPdf417(contenido: Buffer, mime: string): Promise<ResultadoCodigoBarras> {
    const vacio: ResultadoCodigoBarras = { encontrado: false, formato: null, contenido: '' };
    if (!mime.startsWith('image/')) return vacio;

    try {
      const { readBarcodes } = await this.cargar();
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
