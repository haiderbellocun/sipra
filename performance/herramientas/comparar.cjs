// Comparación ANTES/DESPUÉS de dos corridas (P9 §6) con las mismas métricas. Solo lee performance/out/.
//
//   node performance/herramientas/comparar.cjs <corridaAntes> <corridaDespues>   (escribe out/comparacion-<a>-vs-<b>.md)
//
// Generador: si existe <corrida>.generador-resumen.json (k6 nativo en el PC B) se usa; si no, <corrida>.docker-stats.jsonl
// (k6 en Docker Desktop en el mismo PC). La red del PC SIPRA viene del muestreo (redRxMBs).
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'out');
const leer = (f) => JSON.parse(readFileSync(join(OUT, f), 'utf8').replace(/^﻿/, ''));
const mb = (s) => { const m = String(s).match(/([\d.]+)\s*([KMG]i?B)/); return m ? +m[1] * ({ KiB: 1 / 1024, MiB: 1, GiB: 1024, KB: 1 / 1000, MB: 1, GB: 1000, B: 0 }[m[2]] ?? 0) : 0; };

function datos(c) {
  const s = leer(`${c}.summary.json`).metrics;
  const v = (k, e) => s[k]?.values?.[e];
  const post = (k, e) => s[`${k}{name:POST upload}`]?.values?.[e] ?? v(k, e);
  const r = leer(`${c}.muestras-resumen.json`);
  const muestras = readFileSync(join(OUT, `${c}.muestras.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const integ = existsSync(join(OUT, `${c}.integridad.json`)) ? leer(`${c}.integridad.json`) : null;
  let gen = { cpu: '—', ram: '—', red: '—', fuente: '—' };
  if (existsSync(join(OUT, `${c}.generador-resumen.json`))) {
    const g = leer(`${c}.generador-resumen.json`);
    gen = { cpu: `${g.picos.k6CpuPct} % de ${g.nucleos} núcleos (máquina ${g.picos.cpuTotalPct} %)`, ram: `${g.picos.k6RamMb} MB (libre mín. ${g.libreMinMb} MB)`, red: `${g.picos.redTxMBs} MB/s salida`, fuente: 'k6 nativo · PC generador' };
  } else if (existsSync(join(OUT, `${c}.docker-stats.jsonl`))) {
    const d = readFileSync(join(OUT, `${c}.docker-stats.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    gen = { cpu: `${Math.max(...d.map((x) => parseFloat(x.CPUPerc) || 0))} % (contenedor, 100 % = 1 núcleo)`, ram: `${Math.max(...d.map((x) => mb(x.MemUsage.split(' / ')[0]))).toFixed(0)} MiB`, red: d.at(-2)?.NetIO ?? '—', fuente: 'k6 en Docker Desktop · mismo PC' };
  }
  const f = (x, d = 0) => (x === undefined || x === null ? '—' : Number(x).toFixed(d));
  return {
    'Generador': gen.fuente,
    'Upload p50 (ms)': f(v('upload_duracion', 'med')), 'Upload p95 (ms)': f(v('upload_duracion', 'p(95)')), 'Upload p99 (ms)': f(v('upload_duracion', 'p(99)')),
    'Throughput (req/s)': f(v('http_reqs', 'rate'), 2), 'Cargue (MB/s)': f((v('data_sent', 'count') ?? 0) / 1048576 / ((s.iteration_duration?.values?.max ?? 1) / 1000), 1),
    'Sending p50 / p95 (ms)': `${f(post('http_req_sending', 'med'))} / ${f(post('http_req_sending', 'p(95)'))}`,
    'Waiting p50 / p95 (ms)': `${f(post('http_req_waiting', 'med'))} / ${f(post('http_req_waiting', 'p(95)'))}`,
    'Receiving p50 / p95 (ms)': `${f(post('http_req_receiving', 'med'))} / ${f(post('http_req_receiving', 'p(95)'))}`,
    'Errores HTTP': `${f((v('http_req_failed', 'rate') ?? 0) * 100, 2)} %`,
    'CPU API pico (% de 1 núcleo)': f(r.picos.apiCpuPct, 1), 'RAM API pico (MB RSS)': f(r.picos.apiRssMb, 0),
    'Event loop p99 / máx pico (ms)': `${f(r.picos.eventLoopP99Ms, 0)} / ${f(r.picos.eventLoopMaxMs ?? r.picos.eventLoopP99Ms, 0)}`,
    'PG conexiones pico / activas pico': `${r.picos.pgConexiones} / ${r.picos.pgActivas}`,
    'PG idle in transaction pico': Math.max(0, ...muestras.map((m) => m.pgEstados?.['idle in transaction'] ?? 0)),
    'PG deadlocks / rollbacks': `${r.totalesDb.deadlocks} / ${r.totalesDb.rollbacks}`,
    'CPU máquina SIPRA pico (%)': f(r.picos.hostCpuPct, 1), 'RAM libre mín. máquina SIPRA (MB)': f(r.hostLibreMinMb ?? Math.min(...muestras.map((m) => m.hostLibreMb)), 0),
    'Red PC SIPRA entrada pico (MB/s)': f(r.picos.redRxMBs, 2),
    'CPU generador pico': gen.cpu, 'RAM generador pico': gen.ram, 'Red generador': gen.red,
    'Integridad': integ ? integ.integridad : '—',
  };
}

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('Uso: comparar.cjs <corridaAntes> <corridaDespues>');
const A = datos(a); const B = datos(b);
const md = [`| Métrica | ANTES · ${a} | DESPUÉS · ${b} |`, '|---|---|---|', ...Object.keys(A).map((k) => `| ${k} | ${A[k]} | ${B[k]} |`)].join('\n');
writeFileSync(join(OUT, `comparacion-${a}-vs-${b}.md`), `${md}\n`);
console.log(md);
