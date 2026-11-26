// 03 · Upload concurrente: VUS estudiantes DISTINTOS, 1 upload cada uno, arrancando a la vez (sin carrera de versiones:
// ninguna práctica/tipo recibe dos cargues concurrentes). Umbrales amplios: la compuerta real es la integridad.
import { SharedArray } from 'k6/data';
import { ARCHIVO, RUTA_BINARIO, RUTA_TOKENS, VUS, sesionDe } from '../lib/config.js';
import { cargarDocumento } from '../lib/flujo.js';
import { resumen, TENDENCIAS } from '../lib/resumen.js';

const binario = open(RUTA_BINARIO, 'b');
const tokens = new SharedArray('tokens', () => JSON.parse(open(RUTA_TOKENS)));

export const options = {
  scenarios: { upload: { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '10m' } },
  summaryTrendStats: TENDENCIAS,
  tags: { escenario: '03-upload', archivo: ARCHIVO },
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

export default function () {
  cargarDocumento(sesionDe(tokens), binario);
}

export const handleSummary = resumen;
