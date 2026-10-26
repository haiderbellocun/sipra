import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Pdf417Adapter } from '../src/infrastructure/adapters/codigo-barras/pdf417.adapter';
import { Pdf417DomainService } from '../src/domain/services/pdf417.domain-service';

/**
 * Prueba de ida y vuelta: se GENERA un PDF417 real con ZXing y se lee con el
 * adaptador. Es la única forma honesta de comprobar el decodificador sin tener
 * una cédula auténtica: si el código que produce el estándar se lee bien,
 * el camino funciona.
 */

const adaptador = new Pdf417Adapter();
const dominio = new Pdf417DomainService();

/** Genera la imagen de un PDF417 con el contenido indicado. */
async function generarPdf417(contenido: string): Promise<Buffer> {
  const zxing = (await import('zxing-wasm/full')) as unknown as {
    writeBarcode: (
      texto: string,
      opciones: Record<string, unknown>,
    ) => Promise<{ image?: Blob }>;
    prepareZXingModule: (opciones: {
      overrides: Record<string, unknown>;
      fireImmediately: boolean;
    }) => Promise<unknown>;
  };

  const requerir = createRequire(__filename);
  const binario = await readFile(requerir.resolve('zxing-wasm/full/zxing_full.wasm'));

  await zxing.prepareZXingModule({
    overrides: {
      instantiateWasm: (
        importaciones: WebAssembly.Imports,
        listo: (i: WebAssembly.Instance, m: WebAssembly.Module) => void,
      ) => WebAssembly.instantiate(binario, importaciones).then((r) => listo(r.instance, r.module)),
    },
    fireImmediately: true,
  });

  const { image } = await zxing.writeBarcode(contenido, { format: 'PDF417', scale: 3 });
  if (!image) throw new Error('No se pudo generar el código de prueba');
  return Buffer.from(await image.arrayBuffer());
}

/** Trama con el número en su relleno de ceros; datos ficticios. */
const TRAMA = `PubDSK_1${'0'.repeat(28)}1032456789${' '.repeat(10)}RAMIREZ ORTIZ LAURA SOFIA`;

describe('Lectura real de un PDF417', () => {
  jest.setTimeout(60_000);

  it('lee el contenido exacto que se codificó', async () => {
    const imagen = await generarPdf417(TRAMA);
    const resultado = await adaptador.leerPdf417(imagen, 'image/png');

    expect(resultado.encontrado).toBe(true);
    expect(resultado.formato).toBe('PDF417');
    expect(resultado.contenido).toBe(TRAMA);
  });

  it('el contenido leído se interpreta como una cédula', async () => {
    const imagen = await generarPdf417(TRAMA);
    const { contenido } = await adaptador.leerPdf417(imagen, 'image/png');
    const { leida, cedula } = dominio.interpretar(contenido);

    expect(leida).toBe(true);
    // Se comprueba el número, que es lo que se localiza por patrón y se
    // verifica aritméticamente. Los nombres dependen de posiciones aún no
    // conciliadas y no se afirman aquí.
    expect(cedula!.numeroDocumento).toBe('1032456789');
    expect(cedula!.disposicionConfirmada).toBe(false);
  });

  it('no encuentra código donde no lo hay', async () => {
    // Un PNG gris uniforme: no debe inventarse una lectura.
    const gris = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk' +
        'YPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64',
    );
    const resultado = await adaptador.leerPdf417(gris, 'image/png');
    expect(resultado.encontrado).toBe(false);
    expect(resultado.contenido).toBe('');
  });

  it('no intenta leer un PDF: el código vive en una imagen', async () => {
    const resultado = await adaptador.leerPdf417(Buffer.from('%PDF-1.7'), 'application/pdf');
    expect(resultado.encontrado).toBe(false);
  });
});
