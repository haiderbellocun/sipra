// 11 · Carga SOSTENIDA grande (P11): UPLOADS cargues (3.000 / 6.000), cada uno de un estudiante DISTINTO, a una tasa
// TOPADA por la red del PC SIPRA (no escala con UPLOADS). Mismo caso que P9/P10: PDF medio, carta_aceptacion, sin OCR.
// NO es una ráfaga: el burst extremo es otro escenario.
//
// Perfil (ramping-arrival-rate, modelo abierto; mismo para 3.000 y 6.000, solo cambia la meseta):
//   rampa lineal 0 → TASA uploads/s en RAMPA_S (240 s)            → aporta TASA·RAMPA_S/2 llegadas (960 con TASA=8)
//   meseta a TASA durante (UPLOADS − TASA·RAMPA_S/2) / TASA s     → 3.000: 255 s · 6.000: 630 s
//   cola de COLA_S (30 s) a TASA solo para absorber redondeos; toda iteración posterior a la n.º UPLOADS no hace nada.
//   TASA por defecto 8/s ≈ 16 MB/s (≈40 % de los 39,7 MB/s de entrada medidos en el PC SIPRA): mide SIPRA, no la red.
//   VUs: 100 preasignados, máximo MAX_VUS (600 por defecto = 8/s × 75 s de latencia). Si SIPRA se ralentiza, la
//   concurrencia en vuelo sube sola hasta ese tope; más allá, k6 cuenta dropped_iterations (la compuerta lo exige en 0).
//
//   k6 run -e BASE=http://<IP_PC_SIPRA>:3100/api/v1 -e UPLOADS=3000 -e OFFSET=0 -e CORRIDA=external-3000-001 \
//     scenarios/11-sostenida-upload.js            [-e TASA=8] [-e MAX_VUS=600]
//
// SECO=1: lee el PDF compartido en 2 VUs sin ninguna petición ni tokens (valida el generador).
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { open as abrirCompartido, SeekMode } from 'k6/experimental/fs';
import { ARCHIVO, OFFSET, RUTA_BINARIO, RUTA_TOKENS } from '../lib/config.js';
import { cargarDocumento } from '../lib/flujo.js';
import { resumen, TENDENCIAS } from '../lib/resumen.js';

const SECO = __ENV.SECO === '1';
const UPLOADS = Number(__ENV.UPLOADS || 0);
if (!Number.isInteger(UPLOADS) || UPLOADS < 1) throw new Error('Defina UPLOADS (número de cargues), por ejemplo -e UPLOADS=3000');
export const TASA = Number(__ENV.TASA || 8);
if (!Number.isInteger(TASA) || TASA < 1 || TASA > 10) throw new Error('TASA debe ser un entero entre 1 y 10 uploads/s (tope por la red del PC SIPRA)');
export const MAX_VUS = Number(__ENV.MAX_VUS || 600);
export const RAMPA_S = 240;
export const COLA_S = 30;
const EN_RAMPA = (TASA * RAMPA_S) / 2;
if (UPLOADS <= EN_RAMPA && !SECO) throw new Error(`UPLOADS debe superar ${EN_RAMPA} (lo que aporta la rampa a TASA=${TASA})`);
export const MESETA_S = Math.ceil((UPLOADS - EN_RAMPA) / TASA);

const archivo = await abrirCompartido(RUTA_BINARIO);
const tokens = SECO ? [] : new SharedArray('tokens', () => JSON.parse(open(RUTA_TOKENS)));
if (!SECO && tokens.length < OFFSET + UPLOADS) throw new Error(`out/tokens.json tiene ${tokens.length} tokens; se necesitan ${OFFSET + UPLOADS} (OFFSET + UPLOADS)`);

export const options = {
  scenarios: SECO ? { seco: { executor: 'per-vu-iterations', vus: 2, iterations: 1 } } : {
    sostenida: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.min(100, MAX_VUS),
      maxVUs: MAX_VUS,
      stages: [
        { duration: `${RAMPA_S}s`, target: TASA },
        { duration: `${MESETA_S}s`, target: TASA },
        { duration: `${COLA_S}s`, target: TASA },
      ],
      gracefulStop: '180s',
    },
  },
  summaryTrendStats: TENDENCIAS,
  tags: { escenario: '11-sostenida-upload', archivo: ARCHIVO, uploads: String(UPLOADS), tasa: String(TASA) },
  thresholds: {
    uploads_fallidos: ['count==0'],
    http_req_failed: ['rate==0'],
    // Siempre verdaderos: solo crean las submétricas del POST (sending/waiting/receiving) en el resumen comparable.
    'http_req_sending{name:POST upload}': ['max>=0'],
    'http_req_waiting{name:POST upload}': ['max>=0'],
    'http_req_receiving{name:POST upload}': ['max>=0'],
    'http_req_duration{name:POST upload}': ['max>=0'],
  },
};

async function leerArchivo() {
  const info = await archivo.stat();
  const datos = new Uint8Array(info.size);
  await archivo.seek(0, SeekMode.Start);
  let leidos = 0;
  while (leidos < info.size) {
    const n = await archivo.read(datos.subarray(leidos));
    if (n === null) break;
    leidos += n;
  }
  if (leidos !== info.size) throw new Error(`lectura incompleta del PDF: ${leidos} de ${info.size} bytes`);
  return datos.buffer;
}

export default async function () {
  if (SECO) {
    const b = await leerArchivo();
    console.log(`SECO_OK ${JSON.stringify({ vu: __VU, bytes: b.byteLength })}`);
    return;
  }
  const k = exec.scenario.iterationInTest;
  if (k >= UPLOADS) return; // cola de redondeo: sin petición
  cargarDocumento(tokens[OFFSET + k], await leerArchivo());
}

export const handleSummary = resumen;
