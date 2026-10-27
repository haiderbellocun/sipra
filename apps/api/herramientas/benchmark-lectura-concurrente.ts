/* eslint-disable no-console */
/**
 * Benchmark de CARGA CONCURRENTE de la lectura local (Fase 6): ¿1 GiB por instancia sigue siendo razonable?
 *
 * Lanza 1, 3 y 6 documentos A LA VEZ (el máximo razonable: ~6 personas operando; la cola de Cloud Tasks
 * limita la concurrencia por instancia) sobre un corpus SINTÉTICO mixto, con la configuración por defecto
 * del servicio (`LECTURA_LOCAL_OCR_CONCURRENTES=1`, `LECTURA_LOCAL_RENDER_CONCURRENTES=2`). Mide tiempo
 * por documento y total, RSS pico, CPU de usuario+sistema consumida y los vencimientos de tiempo. No
 * promete equivalencia con Cloud Run: es la máquina de desarrollo. NO modifica ninguna configuración de nube.
 *
 * Uso: npm run lectura:benchmark:concurrente --workspace=@sipra/api
 *   (opcional) OCR_CONC=2 RENDER_CONC=2 para probar otros valores.
 */
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { imagenCertificado, pdfDigital, pdfEscaneado, pngQr } from '../test/soporte-lectura-local';

const mb = (b: number): number => Math.round(b / 1048576);
const ocrConc = Number(process.env.OCR_CONC ?? 1);
const renderConc = Number(process.env.RENDER_CONC ?? 2);

async function main(): Promise<void> {
  const config = { get: (k: string) => ({ LECTURA_LOCAL_OCR_CONCURRENTES: ocrConc, LECTURA_LOCAL_RENDER_CONCURRENTES: renderConc } as Record<string, number>)[k] };
  const lector = new LectorDocumentoLocalAdapter(config as never);
  const servicio = new LecturaLocalEpsService(lector);
  const qr = await pngQr('https://eps.example/validar?id=1');
  const corpus: Array<[string, Buffer, string]> = [
    ['PDF texto + QR', await pdfDigital(undefined, { qrs: [qr] }), 'application/pdf'],
    ['PDF escaneado 1 pág', await pdfEscaneado([await imagenCertificado()]), 'application/pdf'],
    ['PNG', await imagenCertificado(), 'image/png'],
    ['JPEG', await imagenCertificado(undefined, { jpeg: true }), 'image/jpeg'],
    ['PDF escaneado 3 pág', await pdfEscaneado([await imagenCertificado(), await imagenCertificado(), await imagenCertificado()]), 'application/pdf'],
    ['PNG rotado 90°', await imagenCertificado(undefined, { grados: 90 }), 'image/png'],
  ];
  console.log(`node ${process.version} · ${process.platform} · OCR_CONC=${ocrConc} RENDER_CONC=${renderConc} · rss inicial ${mb(process.memoryUsage().rss)} MB`);

  // Calentamiento: el primer documento paga la carga de WASM y del modelo (arranque en frío).
  const frio = process.hrtime.bigint();
  await servicio.leer(corpus[1][1], corpus[1][2]);
  console.log(`arranque en frío (1.er documento escaneado): ${Math.round(Number(process.hrtime.bigint() - frio) / 1e6)} ms`);

  const filas: Array<Record<string, number | string>> = [];
  try {
    for (const n of [1, 3, 6]) {
      for (let ronda = 1; ronda <= 2; ronda += 1) {
        const lote = Array.from({ length: n }, (_, i) => corpus[(i + (ronda - 1)) % corpus.length]);
        let pico = process.memoryUsage().rss;
        const muestreo = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 15);
        const cpu0 = process.cpuUsage();
        const t0 = process.hrtime.bigint();
        const tiempos: number[] = [];
        let errores = 0;
        let vencidos = 0;
        await Promise.all(lote.map(async ([, c, m]) => {
          const t = process.hrtime.bigint();
          try {
            const r = await servicio.leer(c, m);
            if (r.resumen.limitesAplicados.some((l) => /tiempo|timeout/i.test(l))) vencidos += 1;
          } catch { errores += 1; }
          tiempos.push(Number(process.hrtime.bigint() - t) / 1e6);
        }));
        const total = Number(process.hrtime.bigint() - t0) / 1e6;
        clearInterval(muestreo);
        pico = Math.max(pico, process.memoryUsage().rss);
        const cpu = process.cpuUsage(cpu0);
        filas.push({
          simultaneos: n, ronda, totalMs: Math.round(total), mediaMs: Math.round(tiempos.reduce((a, b) => a + b, 0) / n), maxMs: Math.round(Math.max(...tiempos)),
          rssPicoMb: mb(pico), cpuMs: Math.round((cpu.user + cpu.system) / 1000), cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / total) * 100), errores, vencidos,
        });
      }
    }
  } finally {
    await lector.onModuleDestroy();
  }
  console.table(filas);
  const pico = Math.max(...filas.map((f) => Number(f.rssPicoMb)));
  console.log(`RSS pico observado: ${pico} MB (${Math.round((pico / 1024) * 100)} % de 1 GiB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
