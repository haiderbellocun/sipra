import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

export interface CodigoLeido {
  format: string;
  text: string;
  isValid: boolean;
  position?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
}

export type LeerCodigos = (
  entrada: Blob,
  opciones: Record<string, unknown>,
) => Promise<CodigoLeido[]>;

export interface ModuloZxing {
  readBarcodes: LeerCodigos;
}

let carga: Promise<ModuloZxing> | null = null;

/**
 * Carga ZXing-WASM UNA sola vez por proceso, con el binario leído de disco: en
 * Node la biblioteca intentaría buscarlo por red, y este servicio no puede tener
 * esa dependencia en tiempo de ejecución. La comparten el lector de PDF417 de la
 * cédula y el de QR del certificado de EPS.
 */
export function cargarZxing(): Promise<ModuloZxing> {
  carga ??= (async () => {
    const zxing = (await import('zxing-wasm/reader')) as unknown as {
      readBarcodes: LeerCodigos;
      prepareZXingModule: (opciones: {
        overrides: Record<string, unknown>;
        fireImmediately: boolean;
      }) => Promise<unknown>;
    };
    // El paquete no expone su package.json en el mapa de `exports`: se resuelve el
    // binario por su propio subpath, que sí está declarado.
    const requerir = createRequire(__filename);
    const binario = await readFile(requerir.resolve('zxing-wasm/reader/zxing_reader.wasm'));
    await zxing.prepareZXingModule({
      overrides: {
        instantiateWasm: (
          importaciones: WebAssembly.Imports,
          listo: (instancia: WebAssembly.Instance, modulo: WebAssembly.Module) => void,
        ) => WebAssembly.instantiate(binario, importaciones).then((r) => listo(r.instance, r.module)),
      },
      fireImmediately: true,
    });
    return { readBarcodes: zxing.readBarcodes };
  })().catch((error: unknown) => {
    carga = null; // un fallo de carga no se memoriza: el siguiente intento reintenta
    throw error;
  });
  return carga;
}
