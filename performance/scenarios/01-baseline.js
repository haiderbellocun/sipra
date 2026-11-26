// 01 · Baseline: 1 usuario, 1 iteración. Expediente → upload → verificación de persistencia.
import { SharedArray } from 'k6/data';
import { ARCHIVO, RUTA_BINARIO, RUTA_TOKENS, sesionDe } from '../lib/config.js';
import { cargarDocumento } from '../lib/flujo.js';
import { resumen, TENDENCIAS } from '../lib/resumen.js';

const binario = open(RUTA_BINARIO, 'b');
const tokens = new SharedArray('tokens', () => JSON.parse(open(RUTA_TOKENS)));

export const options = {
  scenarios: { baseline: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '2m' } },
  summaryTrendStats: TENDENCIAS,
  tags: { escenario: '01-baseline', archivo: ARCHIVO },
};

export default function () {
  cargarDocumento(sesionDe(tokens), binario);
}

export const handleSummary = resumen;
