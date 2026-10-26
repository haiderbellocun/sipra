import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DocumentoPdf, GeneradorPdfPort } from '../../../domain/ports/out/servicios-externos.port';

/**
 * Dibuja documentos institucionales con pdfkit: carta tamaño carta (LETTER),
 * márgenes de una pulgada, tipografía Helvetica y encabezado en el azul CUN.
 * El dominio compone el texto; aquí solo se maqueta.
 */
@Injectable()
export class PdfKitAdapter implements GeneradorPdfPort {
  private static readonly AZUL_CUN = '#123C6E';
  private static readonly GRIS = '#4B5563';

  generar(documento: DocumentoPdf): Promise<Buffer> {
    return new Promise((resolver, rechazar) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: { Title: documento.titulo, Author: 'SIPRA PRÁCTICAS — CUN' },
      });
      const partes: Buffer[] = [];
      doc.on('data', (parte: Buffer) => partes.push(parte));
      doc.on('end', () => resolver(Buffer.concat(partes)));
      doc.on('error', rechazar);

      // Encabezado institucional.
      doc.fillColor(PdfKitAdapter.AZUL_CUN).font('Helvetica-Bold').fontSize(13);
      for (const linea of documento.encabezado) doc.text(linea, { align: 'left' });
      doc.moveDown(0.4);
      doc.strokeColor(PdfKitAdapter.AZUL_CUN).lineWidth(1.2)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(1.2);

      // Fecha y lugar, título.
      doc.fillColor(PdfKitAdapter.GRIS).font('Helvetica').fontSize(10.5)
        .text(documento.fechaLugar, { align: 'right' });
      doc.moveDown(1);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12)
        .text(documento.titulo.toUpperCase(), { align: 'left' });
      doc.moveDown(1);

      // Cuerpo.
      doc.font('Helvetica').fontSize(11).fillColor('#111827');
      for (const parrafo of documento.parrafos) {
        doc.text(parrafo, { align: 'justify', lineGap: 2 });
        doc.moveDown(0.8);
      }

      // Firma.
      doc.moveDown(2);
      const anchoFirma = 220;
      const yFirma = doc.y;
      doc.strokeColor('#111827').lineWidth(0.8)
        .moveTo(doc.page.margins.left, yFirma)
        .lineTo(doc.page.margins.left + anchoFirma, yFirma)
        .stroke();
      doc.moveDown(0.3);
      documento.firma.forEach((linea, indice) => {
        doc.font(indice === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5)
          .text(linea, doc.page.margins.left, doc.y, { width: anchoFirma + 120 });
      });

      // Pie.
      if (documento.pie.length > 0) {
        const yPie = doc.page.height - doc.page.margins.bottom + 18;
        doc.fontSize(8).fillColor(PdfKitAdapter.GRIS).font('Helvetica');
        documento.pie.forEach((linea, indice) => {
          doc.text(linea, doc.page.margins.left, yPie + indice * 11, {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            align: 'center', lineBreak: false,
          });
        });
      }

      doc.end();
    });
  }
}
