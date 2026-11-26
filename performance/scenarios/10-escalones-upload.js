// 10 · Escalones de capacidad (P10): UPLOADS cargues, cada uno de un estudiante DISTINTO (1 carga por estudiante), con
// LLEGADA EN RAMPA (modelo abierto, ramping-arrival-rate), no en ráfaga. Mismo caso que 03-upload (PDF medio,
// carta_aceptacion, sin OCR) para que los escalones sean comparables entre sí y con las corridas de 100.
//
// Perfil IDÉNTICO para todos los escalones (solo escala la tasa):
//   rampa lineal 0 → P en RAMPA_S (120 s) · meseta a P durante MESETA_S (120 s) · cola de COLA_S (30 s) solo para
//   absorber el redondeo. P = ceil(UPLOADS / 3) llegadas por minuto (rampa aporta P, meseta 2P ⇒ 3P ≈ UPLOADS).
//   Las iteraciones posteriores a la n.º UPLOADS no hacen nada (sin petición): siempre exactamente UPLOADS cargues.
//   VUs: preasignados min(UPLOADS, 200), máximo UPLOADS. Si SIPRA se degrada, la concurrencia en vuelo crece sola
//   (tasa × latencia); si faltan VUs, k6 cuenta dropped_iterations (= señal de saturación, la compuerta lo detecta).
//
//   k6 run -e BASE=http://<IP_PC_SIPRA>:3100/api/v1 -e UPLOADS=250 -e OFFSET=0 -e CORRIDA=external-250-001 \
//     scenarios/10-escalones-upload.js
//
// El PDF se abre con k6/experimental/fs (una sola copia en memoria para todos los VUs; open() de k6 copiaría 2 MB
// por VU y con 2.000 VUs saturaría el generador).
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { open as abrirCompartido, SeekMode } from 'k6/experimental/fs';
import { ARCHIVO, OFFSET, RUTA_BINARIO, RUTA_TOKENS } from '../lib/config.js';
import { cargarDocumento } from '../lib/flujo.js';
import { resumen, TENDENCIAS } from '../lib/resumen.js';

const UPLOADS = Number(__ENV.UPLOADS || 0);
if (!Number.isInteger(UPLOADS) || UPLOADS < 1) throw new Error('Defina UPLOADS (número de cargues del escalón), por ejemplo -e UPLOADS=250');
export const RAMPA_S = 120;
export const MESETA_S = 120;
export const COLA_S = 30;
const POR_MINUTO = Math.ceil(UPLOADS / 3);

// SECO=1: prueba en seco del generador (sin ninguna petición HTTP ni tokens): 2 VUs leen el PDF compartido y comprueban
// su tamaño. Sirve para validar k6/experimental/fs en el PC B antes del primer escalón.
const SECO = __ENV.SECO === '1';

const archivo = await abrirCompartido(RUTA_BINARIO);
const tokens = SECO ? [] : new SharedArray('tokens', () => JSON.parse(open(RUTA_TOKENS)));
if (!SECO && tokens.length < OFFSET + UPLOADS) throw new Error(`out/tokens.json tiene ${tokens.length} tokens; se necesitan ${OFFSET + UPLOADS} (OFFSET + UPLOADS)`);

export const options = {
  scenarios: SECO ? { seco: { executor: 'per-vu-iterations', vus: 2, iterations: 1 } } : {
    escalon: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1m',
      preAllocatedVUs: Math.min(UPLOADS, 200),
      maxVUs: UPLOADS,
      stages: [
        { duration: `${RAMPA_S}s`, target: POR_MINUTO },
        { duration: `${MESETA_S}s`, target: POR_MINUTO },
        { duration: `${COLA_S}s`, target: POR_MINUTO },
      ],
      gracefulStop: '180s',
    },
  },
  summaryTrendStats: TENDENCIAS,
  tags: { escenario: '10-escalones-upload', archivo: ARCHIVO, uploads: String(UPLOADS) },
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
    console.log(`SECO_OK ${JSON.stringify({ vu: __VU, bytes: b.byteLength, tokens: tokens.length })}`);
    return;
  }
  const k = exec.scenario.iterationInTest;
  if (k >= UPLOADS) return; // cola de redondeo: sin petición
  const sesion = tokens[OFFSET + k];
  cargarDocumento(sesion, await leerArchivo());
}

export const handleSummary = resumen;
