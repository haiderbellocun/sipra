// 00 · Calibración del GENERADOR y de la RED (P15): mismo multipart que 03-upload contra el servidor eco (sin SIPRA).
// Mide cuánto tarda el generador + la red en ENVIAR VUS × archivo, para no atribuir a SIPRA ese límite.
// En LAN el eco se levanta en el PC SIPRA en el MISMO puerto 3100 (con la API detenida): no se abre otro puerto.
//
//   k6 run -e ECO=http://<IP_PC_SIPRA>:3100 -e VUS=100 -e CORRIDA=<id> scenarios/00-calibracion-generador.js
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { MIME, NOMBRE_ARCHIVO, RUTA_BINARIO, VUS } from '../lib/config.js';
import { resumen, TENDENCIAS } from '../lib/resumen.js';

const binario = open(RUTA_BINARIO, 'b');
const ECO = __ENV.ECO;
if (!ECO) throw new Error('Defina ECO, por ejemplo -e ECO=http://<IP_PC_SIPRA>:3100');
const upload = new Trend('upload_duracion', true);

export const options = {
  scenarios: { eco: { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '10m' } },
  summaryTrendStats: TENDENCIAS,
};

export default function () {
  const r = http.post(`${ECO}/eco`, { tipo: 'carta_aceptacion', archivo: http.file(binario, NOMBRE_ARCHIVO, MIME) }, { timeout: '120s' });
  upload.add(r.timings.duration);
  check(r, { 'eco 201': (x) => x.status === 201 });
}

export const handleSummary = resumen;
