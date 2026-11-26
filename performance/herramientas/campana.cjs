// Tabla de la campaña de escalones (P10) y sostenida (P11). Solo lee performance/out/. Escribe performance/out/campana-p10.md.
// Las columnas de PC A y del generador salen SOLO de las muestras dentro de la ventana real de k6 (ventana.cjs); las
// muestras de antes/después quedan en los .jsonl para diagnóstico y no entran en los picos.
//
//   node performance/herramientas/campana.cjs external-250-001 external-500-001 external-1000-001 ...
//
// Tabla principal (la pedida) + detalle k6 / API / PostgreSQL / máquina / generador por escalón. Un escalón sin algún
// archivo muestra «—» en esas columnas (nunca inventa valores).
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const { ventanaCorrida, OUT } = require('./ventana.cjs');
const corridas = process.argv.slice(2);
if (!corridas.length) throw new Error('Uso: campana.cjs <corrida> [<corrida> ...]');
const leer = (c, s) => { const f = join(OUT, `${c}.${s}`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) : null; };
const f = (x, d = 0) => (x === undefined || x === null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));

const filas = corridas.map((c) => {
  const s = leer(c, 'summary.json'); const V = ventanaCorrida(c); const r = V.pcA; const g = V.generador;
  const i = leer(c, 'integridad.json'); const q = leer(c, 'compuerta.json');
  const v = (k, e) => s?.metrics?.[k]?.values?.[e];
  const post = (k, e) => v(`${k}{name:POST upload}`, e);
  const waits = r?.waitEventsActivas ? Object.entries(r.waitEventsActivas).slice(0, 3).map(([w, n]) => `${w} (${n})`).join(', ') || 'ninguno' : '— (sin dato por muestra)';
  return {
    c, usuarios: q?.uploads ?? i?.respuestas201Esperadas ?? '—', ok: v('uploads_completados', 'count') ?? 0, err: (v('http_req_failed', 'rate') ?? NaN) * 100,
    p50: v('upload_duracion', 'med'), p90: v('upload_duracion', 'p(90)'), p95: v('upload_duracion', 'p(95)'), p99: v('upload_duracion', 'p(99)'), max: v('upload_duracion', 'max'),
    rps: v('http_reqs', 'rate'), reqs: v('http_reqs', 'count'), dur: (s?.state?.testRunDurationMs ?? NaN) / 1000,
    h50: v('http_req_duration', 'med'), h90: v('http_req_duration', 'p(90)'), h95: v('http_req_duration', 'p(95)'), h99: v('http_req_duration', 'p(99)'),
    snd50: post('http_req_sending', 'med'), snd95: post('http_req_sending', 'p(95)'), wt50: post('http_req_waiting', 'med'), wt95: post('http_req_waiting', 'p(95)'),
    rcv50: post('http_req_receiving', 'med'), rcv95: post('http_req_receiving', 'p(95)'), mbEnv: (v('data_sent', 'count') ?? NaN) / 1048576,
    perdidas: v('dropped_iterations', 'count') ?? 0, vusMax: v('vus_max', 'max'),
    apiCpu: r?.picos.apiCpuPct, apiRss: r?.picos.apiRssMb, heap: r?.picos.apiHeapMb, el99: r?.picos.eventLoopP99Ms, elMax: r?.picos.eventLoopMaxMs, activas: r?.picos.apiActivas,
    gc: r?.gc ? `${r.gc.pausas} / ${r.gc.segundos} s` : '—',
    pgCon: r?.picos.pgConexiones, pgAct: r?.picos.pgActivas, pgIdleTx: r?.picos.pgIdleEnTransaccion, pgLocks: r?.picos.pgLocksEspera, waits,
    commits: r?.totalesDb.commits, rollbacks: r?.totalesDb.rollbacks, deadlocks: r?.totalesDb.deadlocks,
    hostCpu: r?.picos.hostCpuPct, hostLibre: r?.hostLibreMinMb, disco: r?.discoConsumidoMb, discoLibre: r?.discoLibreMinMb, redRx: r?.picos.redRxMBs, pag: r?.picos.paginasSeg,
    genCpu: g?.picos.cpuTotalPct, genK6Cpu: g?.picos.k6CpuPct, genRam: g?.picos.k6RamMb, genLibre: g?.libreMinMb, genTx: g?.picos.redTxMBs,
    integ: i?.integridad ?? '—', compuerta: q?.decision ?? '—', cobA: r?.cobertura, cobG: g?.cobertura, ventana: V.ventana?.fuente ?? 'sin ventana k6',
  };
});

const tabla = (cab, fila) => [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...filas.map((x) => `| ${fila(x).join(' | ')} |`)].join('\n');
const md = [
  '# Campaña de upload con generador externo (P10 escalones / P11 sostenida)', '',
  'P10 (`10-escalones-upload`): rampa 0→P en 120 s, meseta P 120 s, cola 30 s; P = ⌈UPLOADS/3⌉ llegadas/min; VUs máx = UPLOADS.',
  'P11 (`11-sostenida-upload`): rampa 0→TASA (8/s) en 240 s, meseta a TASA hasta completar UPLOADS, cola 30 s; VUs máx 600.',
  'Caso común: PDF medio (2.096.839 bytes), `carta_aceptacion`, sin OCR, 1 carga por estudiante. Latencias en ms; upload = POST completo.', '',
  tabla(['Usuarios', 'Uploads OK', 'Error %', 'p50', 'p95', 'p99', 'req/s', 'API CPU', 'API RAM', 'Event loop p99', 'PG conexiones', 'Generador CPU', 'Integridad'],
    (x) => [x.usuarios, x.ok, f(x.err, 2), f(x.p50), f(x.p95), f(x.p99), f(x.rps, 2), `${f(x.apiCpu, 1)} %`, `${f(x.apiRss)} MB`, `${f(x.el99, 1)} ms`, f(x.pgCon), `${f(x.genCpu)} %`, x.integ]), '',
  '## k6', '',
  tabla(['Corrida', 'Peticiones', 'Duración s', 'HTTP p50/p90/p95/p99', 'Upload p90 / máx', 'Sending p50/p95', 'Waiting p50/p95', 'Receiving p50/p95', 'MB enviados', 'VUs máx usados', 'Iteraciones perdidas'],
    (x) => [x.c, f(x.reqs), f(x.dur, 1), `${f(x.h50)}/${f(x.h90)}/${f(x.h95)}/${f(x.h99)}`, `${f(x.p90)} / ${f(x.max)}`, `${f(x.snd50)}/${f(x.snd95)}`, `${f(x.wt50)}/${f(x.wt95)}`, `${f(x.rcv50)}/${f(x.rcv95)}`, f(x.mbEnv, 1), f(x.vusMax), f(x.perdidas)]), '',
  '## Ventana de k6 (picos de PC A y generador solo dentro de ella)', '',
  tabla(['Corrida', 'Fuente de la ventana', 'Cobertura PC A', 'Cobertura generador'], (x) => [x.c, x.ventana, f(x.cobA, 2), f(x.cobG, 2)]), '',
  '## API (PC A)', '',
  tabla(['Corrida', 'CPU pico (% 1 núcleo)', 'RSS pico MB', 'Heap pico MB', 'Event loop p99 / máx ms', 'Peticiones activas pico', 'GC pausas / tiempo'],
    (x) => [x.c, f(x.apiCpu, 1), f(x.apiRss), f(x.heap), `${f(x.el99, 1)} / ${f(x.elMax, 1)}`, f(x.activas), x.gc]), '',
  '## PostgreSQL', '',
  tabla(['Corrida', 'Conexiones pico', 'Activas pico', 'Idle in transaction pico', 'Locks en espera pico', 'Wait events (muestras activas)', 'Commits', 'Rollbacks', 'Deadlocks'],
    (x) => [x.c, f(x.pgCon), f(x.pgAct), f(x.pgIdleTx), f(x.pgLocks), x.waits, f(x.commits), f(x.rollbacks), f(x.deadlocks)]), '',
  '## Máquina SIPRA (PC A) y generador (PC B)', '',
  tabla(['Corrida', 'CPU PC A pico %', 'RAM libre mín. MB', 'Paginación pico pág/s', 'Red entrada pico MB/s', 'Disco consumido MB', 'Disco libre mín. MB', 'Gen. CPU total pico %', 'Gen. CPU k6 pico %', 'Gen. RAM k6 MB', 'Gen. RAM libre mín. MB', 'Gen. red salida MB/s', 'Compuerta'],
    (x) => [x.c, f(x.hostCpu, 1), f(x.hostLibre), f(x.pag), f(x.redRx, 2), f(x.disco), f(x.discoLibre), f(x.genCpu), f(x.genK6Cpu, 1), f(x.genRam), f(x.genLibre), f(x.genTx, 2), x.compuerta]), '',
].join('\n');
writeFileSync(join(OUT, 'campana-p10.md'), md);
console.log(md);
