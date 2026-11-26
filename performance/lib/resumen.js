// Resumen de k6: JSON completo en <OUT>/<corrida>.summary.json (comparable entre etapas; por defecto ./out, ejecutando
// desde performance/) y un texto breve.
// Sin dependencias remotas (nada de jslib por red).
import { CORRIDA, OUT } from './config.js';

const ms = (v) => (v === undefined ? '—' : `${v.toFixed(1)} ms`);

export function resumen(data) {
  // Ventana REAL de la ejecución (reloj del PC generador): handleSummary corre al terminar la prueba, así que fin = ahora e
  // inicio = fin − duración. La compuerta y campana.cjs solo cuentan las muestras del PC SIPRA dentro de esta ventana.
  const fin = new Date();
  const duracionMs = (data.state && data.state.testRunDurationMs) || 0;
  const ventanaK6 = { inicio: new Date(fin.getTime() - duracionMs).toISOString(), fin: fin.toISOString(), duracionMs, reloj: 'generador' };
  const m = data.metrics;
  const v = (k) => (m[k] ? m[k].values : {});
  const lineas = [
    `corrida ${CORRIDA}`,
    `http_reqs ${v('http_reqs').count ?? 0} (${(v('http_reqs').rate ?? 0).toFixed(2)}/s) · fallidas ${((v('http_req_failed').rate ?? 0) * 100).toFixed(2)} %`,
    `http_req_duration p50 ${ms(v('http_req_duration').med)} · p90 ${ms(v('http_req_duration')['p(90)'])} · p95 ${ms(v('http_req_duration')['p(95)'])} · p99 ${ms(v('http_req_duration')['p(99)'])}`,
    `upload_duracion p50 ${ms(v('upload_duracion').med)} · p95 ${ms(v('upload_duracion')['p(95)'])} · p99 ${ms(v('upload_duracion')['p(99)'])} · máx ${ms(v('upload_duracion').max)}`,
    `uploads iniciados ${v('uploads_iniciados').count ?? 0} · completados ${v('uploads_completados').count ?? 0} · fallidos ${v('uploads_fallidos').count ?? 0} · reintentos ${v('uploads_reintentos').count ?? 0} · persistencia verificada ${v('persistencia_verificada').count ?? 0}`,
    `datos enviados ${((v('data_sent').count ?? 0) / 1048576).toFixed(1)} MB · recibidos ${((v('data_received').count ?? 0) / 1048576).toFixed(2)} MB`,
  ];
  return {
    stdout: `\n${lineas.join('\n')}\n`,
    [`${OUT}/${CORRIDA}.summary.json`]: JSON.stringify(Object.assign({}, data, { ventanaK6 }), null, 1),
  };
}

export const TENDENCIAS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];
