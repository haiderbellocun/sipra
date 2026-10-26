/**
 * Se ejecuta en un PROCESO APARTE (lo lanza `lectura-local-sin-red.spec.ts`) con el
 * bloqueo de red precargado en todos sus hilos. Lee un corpus completo y emite un
 * resumen en JSON por la salida estándar.
 */
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { imagenCertificado, pdfDigital, pdfEscaneado, pngQr } from './soporte-lectura-local';

async function main(): Promise<void> {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalEpsService(lector);
  try {
    const digital = await servicio.leer(await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/validar?t=1')] }), 'application/pdf');
    const escaneado = await servicio.leer(await pdfEscaneado([await imagenCertificado(undefined, { qr: await pngQr('https://eps.example/v') })]), 'application/pdf');
    const imagen = await servicio.leer(await imagenCertificado(), 'image/png');
    process.stdout.write(`RESULTADO ${JSON.stringify({
      digitalQr: digital.resumen.qr.hallazgos.length,
      digitalOcr: digital.resumen.ocr.ejecutado,
      escaneadoOcr: escaneado.resumen.ocr.ejecutado,
      escaneadoQr: escaneado.resumen.qr.hallazgos.length,
      imagenDocumento: imagen.campos.documento_afiliado.valor,
      errores: [...digital.resumen.errores, ...escaneado.resumen.errores, ...imagen.resumen.errores],
    })}\n`);
  } finally {
    await lector.onModuleDestroy();
  }
}
void main();
