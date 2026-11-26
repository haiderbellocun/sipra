// VENTANA REAL DE K6 de una corrida (P11). Solo lectura. La usan compuerta.cjs y campana.cjs: cobertura, picos de PC A
// (CPU, RAM, red, event loop, paginación, PostgreSQL, GC, disco) y del generador se calculan SOLO con las muestras
// tomadas mientras k6 se ejecutaba. Las muestras de antes/después se conservan en los .jsonl para diagnóstico.
//
// Ventana (reloj del PC generador):
//   1. <corrida>.summary.json → ventanaK6 {inicio, fin} (lib/resumen.js la escribe desde P11 / external-3000-003);
//   2. corridas anteriores: fin = última línea de <corrida>.k6.log (+1 s por la resolución), inicio = fin − duración.
// Reloj del PC SIPRA: ventana − desfase (integridad.json → reloj.relojGeneradorMenosSipraMs; 0 si no se estimó).
//
// Event loop: se excluye SIEMPRE la primera muestra del archivo (puede arrastrar el máximo acumulado de antes de la
// corrida). Desde external-3000-003 muestrear.cjs además hace una lectura de calentamiento. Cualquier muestra posterior
// al inicio de k6 cuenta: no se oculta ningún evento real de la corrida.
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = process.env.PERF_OUT || join(__dirname, '..', 'out');
const sinBom = (t) => t.replace(/^﻿/, '');
const PICOS = ['pgConexiones', 'pgActivas', 'pgLocksEspera', 'apiCpuPct', 'apiRssMb', 'apiHeapMb', 'eventLoopP99Ms', 'eventLoopMaxMs', 'apiActivas', 'hostCpuPct', 'apiProcCpuPct', 'pgProcRamMb', 'pgProcesos', 'apiProcRamMb', 'redRxMBs', 'redTxMBs', 'pgIdleEnTransaccion', 'paginasSeg'];
const PICOS_GEN = ['cpuTotalPct', 'k6CpuPct', 'k6RamMb', 'redTxMBs', 'redRxMBs'];

function ventanaCorrida(corrida) {
  const ruta = (s) => join(OUT, `${corrida}.${s}`);
  const json = (s) => (existsSync(ruta(s)) ? JSON.parse(sinBom(readFileSync(ruta(s), 'utf8'))) : null);
  const lineas = (s) => (existsSync(ruta(s)) ? sinBom(readFileSync(ruta(s), 'utf8')).split(/\r?\n/).map(sinBom).filter(Boolean).map((l) => JSON.parse(l)) : []);

  const sum = json('summary.json');
  const duracionMs = sum?.state?.testRunDurationMs ?? 0;
  let inicioG = null, finG = null, fuente = null;
  if (sum?.ventanaK6?.inicio && sum?.ventanaK6?.fin) {
    inicioG = Date.parse(sum.ventanaK6.inicio); finG = Date.parse(sum.ventanaK6.fin); fuente = 'summary.json ventanaK6';
  } else if (duracionMs && existsSync(ruta('k6.log'))) {
    const ts = [...readFileSync(ruta('k6.log'), 'utf8').matchAll(/^time="([^"]+)"/gm)].map((m) => Date.parse(m[1])).filter(Number.isFinite);
    if (ts.length) { finG = Math.max(...ts) + 1000; inicioG = finG - duracionMs; fuente = 'aproximada: última línea de k6.log − duración (corrida anterior a ventanaK6)'; }
  }
  const integ = json('integridad.json');
  const desfaseMs = integ?.reloj?.relojGeneradorMenosSipraMs ?? 0;
  const ventana = inicioG === null ? null : {
    fuente, duracionSeg: +(duracionMs / 1000).toFixed(1),
    generador: { inicio: new Date(inicioG).toISOString(), fin: new Date(finG).toISOString() },
    relojGeneradorMenosSipraMs: desfaseMs, desfaseFuente: integ?.reloj ? 'integridad.json (DOC201 vs cargado_en)' : 'no estimado (0)',
    sipra: { inicio: new Date(inicioG - desfaseMs).toISOString(), fin: new Date(finG - desfaseMs).toISOString() },
  };
  const dentro = (m, ini, fin) => { const t = Date.parse(m.t); return t >= ini && t <= fin; };

  // PC A
  const todasA = lineas('muestras.jsonl');
  const primeraA = todasA[0];
  const a = ventana ? todasA.filter((m) => dentro(m, inicioG - desfaseMs, finG - desfaseMs)) : [];
  const max = (xs, k) => xs.reduce((r, m) => (typeof m[k] === 'number' ? Math.max(r ?? -Infinity, m[k]) : r), null);
  const min = (xs, k) => xs.reduce((r, m) => (typeof m[k] === 'number' ? Math.min(r ?? Infinity, m[k]) : r), null);
  const suma = (xs, k) => xs.reduce((r, m) => r + (typeof m[k] === 'number' ? m[k] : 0), 0);
  const picos = {};
  for (const k of PICOS) picos[k] = max(k === 'eventLoopMaxMs' || k === 'eventLoopP99Ms' ? a.filter((m) => m !== primeraA) : a, k);
  const waits = {};
  for (const m of a) for (const [w, n] of Object.entries(m.pgWaits ?? {})) waits[w] = (waits[w] ?? 0) + n;
  const conGc = a.filter((m) => typeof m.gcPausasAcum === 'number');
  const discos = a.map((m) => m.discoLibreMb).filter((x) => typeof x === 'number');
  const pcA = ventana ? {
    muestras: a.length, muestrasArchivo: todasA.length, cobertura: ventana.duracionSeg ? +(a.length / ventana.duracionSeg).toFixed(2) : 0,
    primeraMuestraExcluidaEventLoop: primeraA && a.includes(primeraA) ? { t: primeraA.t, eventLoopMaxMs: primeraA.eventLoopMaxMs } : null,
    picos, hostLibreMinMb: min(a, 'hostLibreMb'), discoLibreMinMb: discos.length ? Math.min(...discos) : null,
    discoConsumidoMb: discos.length ? discos[0] - Math.min(...discos) : null,
    totalesDb: { commits: suma(a, 'pgCommits'), rollbacks: suma(a, 'pgRollbacks'), deadlocks: suma(a, 'pgDeadlocks'), tempBytes: suma(a, 'pgTempBytes') },
    waitEventsActivas: a.some((m) => 'pgWaits' in m) ? Object.fromEntries(Object.entries(waits).sort((x, y) => y[1] - x[1])) : null,
    gc: conGc.length >= 2 ? { pausas: conGc.at(-1).gcPausasAcum - conGc[0].gcPausasAcum, segundos: +(conGc.at(-1).gcSegAcum - conGc[0].gcSegAcum).toFixed(3) } : null,
    pgErrores: a.filter((m) => m.pgError).length, apiErrores: a.filter((m) => m.apiError).length,
  } : null;

  // Generador (PC B): su reloj es el mismo de la ventana; sin desfase.
  const todasG = lineas('generador.jsonl');
  const g = ventana ? todasG.filter((m) => dentro(m, inicioG, finG)) : [];
  const picosG = {};
  for (const k of PICOS_GEN) picosG[k] = max(g, k);
  const generador = ventana ? { muestras: g.length, muestrasArchivo: todasG.length, cobertura: ventana.duracionSeg ? +(g.length / ventana.duracionSeg).toFixed(2) : 0, picos: picosG, libreMinMb: min(g, 'libreMb') } : null;

  return { corrida, ventana, pcA, generador, muestrasA: a, muestrasG: g };
}

module.exports = { ventanaCorrida, OUT };

if (require.main === module) {
  const c = process.argv[2];
  if (!c) throw new Error('Uso: ventana.cjs <corrida>');
  const { muestrasA, muestrasG, ...r } = ventanaCorrida(c);
  console.log(JSON.stringify(r, null, 1));
}
