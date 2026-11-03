import PDFDocument from 'pdfkit';
import { OpcionesRut, rutSintetico } from './soporte-rut-sintetico';
import { pngQr } from './soporte-lectura-local';

/**
 * PDF SINTÉTICO de un RUT, generado en memoria con la disposición del formulario (etiquetas numeradas y valores
 * debajo, cada dígito en su caja) y valores inventados. Sirve para ejercitar el lector REAL (pdf.js, ZXing,
 * Tesseract) sin ningún documento real ni binario versionado.
 */
export async function pdfRutSintetico(o: OpcionesRut & { qr?: string }): Promise<Buffer> {
  const qr = o.qr ? await pngQr(o.qr, 220) : null;
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: [612, 792], margin: 0 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.font('Helvetica').fontSize(7);
    for (const c of rutSintetico({ ...o, fuente: 'texto' })) {
      doc.text(c.texto, c.x * 612, c.y * 792, { lineBreak: false });
    }
    if (qr) doc.image(qr, 390, 105, { width: 95 });
    doc.end();
  });
}
