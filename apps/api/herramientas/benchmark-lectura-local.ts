/* eslint-disable no-console */
/**
 * Benchmark de la lectura documental LOCAL (pdf.js + ZXing + Tesseract).
 *
 * No es un microbenchmark: responde si el flujo es viable en la máquina de
 * desarrollo (no promete equivalencia con Cloud Run). Corpus sintético, sin datos
 * reales. Mide el primer documento (arranque en frío: carga de WASM y modelo) y
 * una repetición en caliente de cada escenario.
 *
 * Uso: npm run lectura:benchmark --workspace=@sipra/api
 */
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import {
  imagenCertificado, pdfDigital, pdfEscaneado, pngQr,
} from '../test/soporte-lectura-local';

const mb = (b: number): number => Math.round(b / 1048576);

async function medir(nombre: string, contenido: Buffer, mime: string, servicio: LecturaLocalEpsService, pasada: string) {
  let pico = process.memoryUsage().rss;
  const muestreo = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 20);
  const antes = process.memoryUsage().rss;
  const t = process.hrtime.bigint();
  const r = await servicio.leer(contenido, mime);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  clearInterval(muestreo);
  pico = Math.max(pico, process.memoryUsage().rss);
  return {
    escenario: nombre, pasada, kb: Math.round(contenido.length / 1024), paginas: r.resumen.textoNativo?.paginas ?? 1,
    ms: Math.round(ms), rssPicoMb: mb(pico), deltaMb: mb(pico - antes),
    ocr: r.resumen.ocr.ejecutado, ocrPaginas: r.resumen.ocr.paginas.length, qr: r.resumen.qr.hallazgos.length,
    camposLeidos: Object.values(r.campos).filter((c) => c.valor !== null).length,
  };
}

async function main(): Promise<void> {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalEpsService(lector);
  const qr = await pngQr('https://eps.example/validar?id=1');
  const corpus: Array<[string, Buffer, string]> = [
    ['PDF texto (1 pág, con QR)', await pdfDigital(undefined, { qrs: [qr] }), 'application/pdf'],
    ['PDF escaneado 1 pág', await pdfEscaneado([await imagenCertificado()]), 'application/pdf'],
    ['PDF escaneado 3 pág', await pdfEscaneado([await imagenCertificado(), await imagenCertificado(), await imagenCertificado()]), 'application/pdf'],
    ['PNG', await imagenCertificado(), 'image/png'],
    ['JPEG', await imagenCertificado(undefined, { jpeg: true }), 'image/jpeg'],
    ['PNG rotado 90°', await imagenCertificado(undefined, { grados: 90 }), 'image/png'],
  ];
  const filas = [];
  console.log(`rss al inicio: ${mb(process.memoryUsage().rss)} MB · node ${process.version} · ${process.platform}`);
  try {
    for (const [n, c, m] of corpus) filas.push(await medir(n, c, m, servicio, 'frío/1.ª'));
    for (const [n, c, m] of corpus) filas.push(await medir(n, c, m, servicio, 'caliente'));
  } finally {
    await lector.onModuleDestroy();
  }
  console.table(filas);
}

main().catch((e) => { console.error(e); process.exit(1); });
