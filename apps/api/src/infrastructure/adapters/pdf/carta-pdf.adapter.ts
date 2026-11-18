import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { DocumentoCarta } from '../../../domain/services/carta-presentacion.plantilla';
import { GeneradorCartaPdfPort } from '../../../domain/ports/out/servicios-externos.port';

/** Membrete institucional CUN (curvas y pie con logo): identidad gráfica de las cartas vigentes. */
const MEMBRETE = join(__dirname, 'recursos', 'membrete-cun.jpg');
/** Logo CUN a color, centrado arriba (como en las cartas vigentes). */
const LOGO = join(__dirname, 'recursos', 'logo-cun.jpg');

/** A4 en puntos y zonas útiles sobre el membrete (las curvas ocupan la esquina superior izquierda y el pie). */
const A4 = { ancho: 595.28, alto: 841.89 };
const X = 70;
const ANCHO = A4.ancho - 2 * X;
const Y_CUERPO = 150;
/** El cuerpo nunca baja de aquí (la curva del pie empieza a la izquierda hacia el 79 % del alto). */
const Y_LIMITE_CUERPO = 628;
const Y_PIE = 650;
const TAM_QR = 58;
const TINTA = '#111827';
const TENUE = '#4B5563';
const AZUL_CUN = '#06233F';

type EscribirQr = (texto: string, opciones: Record<string, unknown>) => Promise<{ image: Blob | null; error: string }>;
let escritor: Promise<EscribirQr> | null = null;

/** ZXing (escritor) cargado una vez por proceso con su binario local: sin red, como el lector. */
function cargarEscritorQr(): Promise<EscribirQr> {
  escritor ??= (async () => {
    const requerir = createRequire(__filename);
    const zxing = requerir('zxing-wasm/writer') as {
      writeBarcode: EscribirQr;
      prepareZXingModule: (o: { overrides: Record<string, unknown>; fireImmediately: boolean }) => Promise<unknown>;
    };
    const binario = await readFile(requerir.resolve('zxing-wasm/writer/zxing_writer.wasm'));
    await zxing.prepareZXingModule({
      overrides: {
        instantiateWasm: (imp: WebAssembly.Imports, listo: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) =>
          WebAssembly.instantiate(binario, imp).then((r) => listo(r.instance, r.module)),
      },
      fireImmediately: true,
    });
    return zxing.writeBarcode;
  })().catch((e: unknown) => { escritor = null; throw e; });
  return escritor;
}

export async function qrPng(texto: string): Promise<Buffer> {
  const escribir = await cargarEscritorQr();
  const r = await escribir(texto, { format: 'QRCode', ecLevel: 'M', scale: 6, addQuietZones: true });
  if (!r.image) throw new Error(`No se pudo generar el QR de verificación: ${r.error}`);
  return Buffer.from(await r.image.arrayBuffer());
}

/**
 * Carta de presentación en PDF (pdfkit, en el servidor; sin capturas del navegador ni servicios externos).
 * Una página A4: el tamaño del cuerpo se ajusta (11 → 9 pt) para que el contenido normal quepa sobre el membrete, y la
 * referencia, el QR y el correo de verificación van en el pie, nunca en una segunda página.
 * La firma manuscrita solo se imprime si la institución configuró una imagen aprobada (`CARTA_FIRMA_IMAGEN`).
 */
@Injectable()
export class CartaPdfAdapter implements GeneradorCartaPdfPort {
  private readonly firma: Buffer | null;
  private readonly membrete: Buffer;
  private readonly logo: Buffer;

  constructor(@Optional() config?: ConfigService) {
    const ruta = config?.get<string>('CARTA_FIRMA_IMAGEN')?.trim();
    this.firma = ruta ? readFileSync(ruta) : null;
    this.membrete = readFileSync(MEMBRETE);
    this.logo = readFileSync(LOGO);
  }

  async generar(d: DocumentoCarta, urlVerificacion: string): Promise<Buffer> {
    const qr = await qrPng(urlVerificacion);
    return new Promise((resolver, rechazar) => {
      const doc = new PDFDocument({
        size: 'A4', margins: { top: 0, bottom: 0, left: X, right: X }, autoFirstPage: true,
        info: { Title: 'Carta de presentación', Author: 'Corporación Unificada Nacional de Educación Superior — CUN', Subject: `REF ${d.referencia}`, Creator: 'SIPRA PRÁCTICAS' },
      });
      const partes: Buffer[] = [];
      doc.on('data', (p: Buffer) => partes.push(p));
      doc.on('end', () => resolver(Buffer.concat(partes)));
      doc.on('error', rechazar);

      doc.image(this.membrete, 0, 0, { width: A4.ancho, height: A4.alto });

      // Logo y encabezado institucional centrados (como en las cartas vigentes).
      const anchoLogo = 104;
      doc.image(this.logo, (A4.ancho - anchoLogo) / 2, 26, { width: anchoLogo });
      doc.fillColor(AZUL_CUN).font('Helvetica-Bold').fontSize(9).text(d.encabezado[0], X, 90, { width: ANCHO, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor(TENUE);
      for (const linea of d.encabezado.slice(1)) doc.text(linea, X, doc.y + 1, { width: ANCHO, align: 'center' });

      const tam = this.tamanoQueCabe(doc, d);
      this.cuerpo(doc, d, tam);
      this.pie(doc, d, qr);
      doc.end();
    });
  }

  /** Mayor tamaño de letra (11 → 9 pt) con el que el cuerpo completo cabe sobre la curva del pie. */
  private tamanoQueCabe(doc: PDFKit.PDFDocument, d: DocumentoCarta): number {
    for (let t = 11; t >= 9; t -= 0.25) if (Y_CUERPO + this.alto(doc, d, t) <= Y_LIMITE_CUERPO) return t;
    return 9;
  }

  private alto(doc: PDFKit.PDFDocument, d: DocumentoCarta, t: number): number {
    const sep = t * 0.75;
    const h = (texto: string, fuente = 'Helvetica') => doc.font(fuente).fontSize(t).heightOfString(texto, { width: ANCHO, align: 'justify', lineGap: 1.5 });
    let total = h(d.fechaLugar) + sep * 1.5;
    total += d.destinatario.reduce((s, l) => s + h(l, 'Helvetica-Bold'), 0) + sep;
    total += h(d.saludo) + sep;
    for (const p of d.parrafos) total += h(p) + sep;
    total += doc.font('Helvetica').fontSize(t - 1.5).heightOfString(d.notaVerificacion, { width: ANCHO, lineGap: 1 }) + sep;
    total += h(d.despedida) + sep;
    total += (this.firma ? 40 : 26) + d.firmante.length * (t + 2);
    return total;
  }

  private cuerpo(doc: PDFKit.PDFDocument, d: DocumentoCarta, t: number): void {
    const sep = t * 0.75;
    const opciones = { width: ANCHO, align: 'justify' as const, lineGap: 1.5 };
    doc.fillColor(TINTA).font('Helvetica').fontSize(t).text(d.fechaLugar, X, Y_CUERPO, { width: ANCHO });
    doc.moveDown(0); doc.y += sep * 1.5;
    doc.font('Helvetica-Bold');
    for (const l of d.destinatario) doc.text(l, X, doc.y, { width: ANCHO });
    doc.y += sep;
    doc.font('Helvetica').text(d.saludo, X, doc.y, { width: ANCHO });
    doc.y += sep;
    for (const p of d.parrafos) { doc.text(p, X, doc.y, opciones); doc.y += sep; }
    doc.fillColor(TENUE).fontSize(t - 1.5).text(d.notaVerificacion, X, doc.y, { width: ANCHO, lineGap: 1 });
    doc.y += sep;
    doc.fillColor(TINTA).fontSize(t).text(d.despedida, X, doc.y, { width: ANCHO });

    // Firma: imagen aprobada (si existe), línea y bloque del firmante.
    let y = doc.y + (this.firma ? 4 : 18);
    if (this.firma) { doc.image(this.firma, X, y, { height: 34 }); y += 36; }
    doc.strokeColor(TINTA).lineWidth(0.6).moveTo(X, y).lineTo(X + 190, y).stroke();
    doc.y = y + 3;
    d.firmante.forEach((l, i) => doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? t : t - 1).fillColor(TINTA).text(l, X, doc.y, { width: ANCHO }));
  }

  /** Pie: referencia, QR y canal de verificación, sobre la curva derecha del membrete. */
  private pie(doc: PDFKit.PDFDocument, d: DocumentoCarta, qr: Buffer): void {
    const xQr = X + ANCHO - TAM_QR;
    doc.image(qr, xQr, Y_PIE, { width: TAM_QR, height: TAM_QR });
    const ancho = ANCHO - TAM_QR - 10;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(`REF: ${d.referencia}`, X, Y_PIE + 10, { width: ancho, align: 'right', lineBreak: false });
    doc.fillColor(TENUE).font('Helvetica').fontSize(7.5)
      .text('Verifica esta carta en SIPRA (escanea el código)', X, Y_PIE + 24, { width: ancho, align: 'right', lineBreak: false })
      .text('practicas@cun.edu.co', X, Y_PIE + 35, { width: ancho, align: 'right', lineBreak: false });
  }
}
