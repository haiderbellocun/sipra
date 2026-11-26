// COMPUERTA entre escalones (P10). Solo lectura. Decide si la campaña puede pasar al siguiente escalón:
//   1. integridad OK y exactamente <uploads> respuestas 201 (performance/out/<corrida>.integridad.json);
//   2. API viva y SIN reinicio: /salud 200 y el PID que escucha en :3100 es el registrado al iniciar (<corrida>.api.pid);
//      sin rachas de 5+ segundos sin métricas de la API durante el muestreo;
//   3. PostgreSQL estable: 0 deadlocks y ningún error de consulta durante el muestreo;
//   4. k6: 0 peticiones fallidas (incluye HTTP 5xx), 0 uploads fallidos y 0 iteraciones perdidas (dropped_iterations);
//   5. generador (PC B) medido y NO saturado: muestras que cubren la corrida, CPU total < 90 % (sin 3 s seguidos ≥ 90 %)
//      y RAM libre ≥ 1 GB. Si el generador se satura, el límite NO es de SIPRA: STOP para no atribuírselo.
//
//   6. PC SIPRA con margen (P11): disco libre mínimo ≥ COMPUERTA_DISCO_MIN_GB (5 por defecto) y RAM libre mínima
//      ≥ COMPUERTA_RAM_MIN_MB (512 por defecto); métricas completas (muestras del PC A que cubren ≥ 90 % de la corrida).
//      La paginación de Windows se REPORTA (racha de páginas/s ≥ 1000) sin detener por sí sola.
//
//   node performance/herramientas/compuerta.cjs <corrida> <uploads>
//
// VENTANA K6 (P11): exige la ventana REAL (summary.json → ventanaK6; la aproximada solo con COMPUERTA_VENTANA_APROXIMADA=1).
// Cobertura, picos, deadlocks, errores de muestreo, RAM, disco, paginación y generador se evalúan SOLO
// con las muestras tomadas mientras k6 se ejecutaba (ventana.cjs). Sin ventana determinable ⇒ STOP (no se adivina).
//
// Escribe performance/out/<corrida>.compuerta.json. Código 0 = CONTINUAR; 1 = STOP (no pasar al siguiente escalón).
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { ventanaCorrida, OUT } = require('./ventana.cjs');

const [corrida, uploadsArg] = process.argv.slice(2);
const uploads = Number(uploadsArg);
if (!corrida || !Number.isInteger(uploads) || uploads < 1) throw new Error('Uso: compuerta.cjs <corrida> <uploads>');
const ruta = (sufijo) => join(OUT, `${corrida}.${sufijo}`);
const sinBom = (t) => t.replace(/^﻿/, '');
const json = (sufijo) => (existsSync(ruta(sufijo)) ? JSON.parse(sinBom(readFileSync(ruta(sufijo), 'utf8'))) : null);
const rachaMax = (xs, pred) => { let r = 0, m = 0; for (const x of xs) { r = pred(x) ? r + 1 : 0; m = Math.max(m, r); } return m; };

(async () => {
  const compuertas = [];
  const g = (nombre, ok, detalle) => compuertas.push({ nombre, ok: Boolean(ok), detalle });

  // 1. Integridad
  const integ = json('integridad.json');
  g('integridad', integ && integ.integridad === 'OK' && integ.respuestas201 === uploads,
    integ ? { integridad: integ.integridad, respuestas201: integ.respuestas201, esperadas: uploads, filasDocumentos: integ.filasDocumentos, archivos: integ.archivosFisicosCorrida, auditorias: integ.auditoriasDocumentoCargado, problemas: integ.problemas } : 'falta <corrida>.integridad.json');

  // 2. API viva y sin reinicio
  let salud = null;
  try { salud = (await fetch('http://127.0.0.1:3100/api/v1/salud', { signal: AbortSignal.timeout(5000) })).status; } catch { salud = 'sin respuesta'; }
  const pidInicial = existsSync(ruta('api.pid')) ? readFileSync(ruta('api.pid'), 'utf8').trim() : null;
  let pidActual = null;
  try { pidActual = execFileSync('powershell', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 3100 -State Listen).OwningProcess | Select-Object -First 1'], { encoding: 'utf8' }).trim(); } catch { /* sin proceso */ }
  const V = ventanaCorrida(corrida);
  const muestras = V.muestrasA; // SOLO dentro de la ventana de k6
  // La ventana REAL (summary.json → ventanaK6) es obligatoria. La aproximada (última línea del k6.log − duración) solo se
  // acepta con COMPUERTA_VENTANA_APROXIMADA=1, para reevaluar corridas anteriores a ventanaK6 (≤ external-3000-003).
  const ventanaReal = V.ventana?.fuente === 'summary.json ventanaK6';
  const aproximadaPermitida = process.env.COMPUERTA_VENTANA_APROXIMADA === '1';
  g('ventana-k6', V.ventana && V.pcA && V.generador && (ventanaReal || aproximadaPermitida),
    V.ventana ? { ...V.ventana, real: ventanaReal, ...(ventanaReal ? {} : { aviso: aproximadaPermitida ? 'ventana APROXIMADA aceptada por COMPUERTA_VENTANA_APROXIMADA=1' : 'summary.json sin ventanaK6: el PC B usó un lib/resumen.js anterior (STOP)' }) }
      : 'sin ventana de k6 (falta summary.json con duración o k6.log)');
  const rachaSinApi = rachaMax(muestras, (m) => m.apiError);
  g('api-viva-sin-reinicio', salud === 200 && pidInicial && pidActual === pidInicial && rachaSinApi < 5,
    { salud, pidInicial, pidActual, rachaMaxSinMetricasSeg: rachaSinApi });

  // 3. PostgreSQL estable
  const res = V.pcA; // totales y picos de la ventana de k6
  const pgErrores = muestras.filter((m) => m.pgError).length;
  g('postgresql-estable', res && res.muestras > 0 && res.totalesDb.deadlocks === 0 && pgErrores === 0,
    res ? { deadlocks: res.totalesDb.deadlocks, rollbacks: res.totalesDb.rollbacks, commits: res.totalesDb.commits, muestrasConError: pgErrores } : 'sin muestras del PC A en la ventana de k6');

  // 4. k6
  const sum = json('summary.json');
  const v = (k, e) => sum?.metrics?.[k]?.values?.[e];
  const fallidas = v('http_req_failed', 'passes') ?? Math.round((v('http_req_failed', 'rate') ?? 0) * (v('http_reqs', 'count') ?? 0));
  const k6 = { peticiones: v('http_reqs', 'count'), fallidas, uploadsCompletados: v('uploads_completados', 'count') ?? 0, uploadsFallidos: v('uploads_fallidos', 'count') ?? 0, iteracionesPerdidas: v('dropped_iterations', 'count') ?? 0 };
  if (existsSync(ruta('k6.log'))) {
    const estados = [...readFileSync(ruta('k6.log'), 'utf8').matchAll(/UPLOAD_FALLIDO .*?status\\?":(\d+)/g)].map((m) => Number(m[1]));
    k6.http5xx = estados.filter((s) => s >= 500).length;
    k6.estadosFallidos = estados.reduce((a, s) => { a[s] = (a[s] ?? 0) + 1; return a; }, {});
  }
  g('k6-sin-errores', sum && k6.fallidas === 0 && k6.uploadsFallidos === 0 && k6.iteracionesPerdidas === 0 && k6.uploadsCompletados === uploads, sum ? k6 : 'falta <corrida>.summary.json');

  // 5. Generador
  const gen = V.generador; // picos del generador dentro de la ventana de k6
  const genM = V.muestrasG;
  const duracionSeg = (sum?.state?.testRunDurationMs ?? 0) / 1000;
  const cobertura = gen?.cobertura ?? 0;
  const rachaCpu = rachaMax(genM, (m) => (m.cpuTotalPct ?? 0) >= 90);
  g('generador-no-saturado', gen && gen.muestras > 0 && cobertura >= 0.6 && (gen.picos.cpuTotalPct ?? 100) < 90 && rachaCpu < 3 && gen.libreMinMb >= 1024,
    gen ? { muestras: genM.length, duracionCorridaSeg: +duracionSeg.toFixed(1), cobertura: +cobertura.toFixed(2), cpuTotalPicoPct: gen.picos.cpuTotalPct, k6CpuPicoPct: gen.picos.k6CpuPct, k6RamPicoMb: gen.picos.k6RamMb, redTxPicoMBs: gen.picos.redTxMBs, libreMinMb: gen.libreMinMb, rachaCpu90Seg: rachaCpu, muestrasArchivo: gen.muestrasArchivo } : 'sin muestras del generador en la ventana de k6 (falta <corrida>.generador.jsonl del PC B)');

  // 6. PC SIPRA con margen y métricas completas
  const discoMinGb = Number(process.env.COMPUERTA_DISCO_MIN_GB ?? 5);
  const ramMinMb = Number(process.env.COMPUERTA_RAM_MIN_MB ?? 512);
  const coberturaA = res?.cobertura ?? 0;
  const paginacion = { picoPaginasSeg: res?.picos?.paginasSeg ?? null, rachaMaxSegConMas1000: rachaMax(muestras, (m) => (m.paginasSeg ?? 0) >= 1000) };
  g('pc-sipra-con-margen', res && res.muestras > 0 && res.discoLibreMinMb >= discoMinGb * 1024 && res.hostLibreMinMb >= ramMinMb && coberturaA >= 0.9,
    res ? { discoLibreInicialMb: muestras.find((m) => m.discoLibreMb != null)?.discoLibreMb ?? null, discoLibreMinMb: res.discoLibreMinMb, discoMinExigidoMb: discoMinGb * 1024, discoConsumidoMb: res.discoConsumidoMb,
      ramLibreMinMb: res.hostLibreMinMb, ramMinExigidaMb: ramMinMb, muestrasPcA: muestras.length, muestrasArchivoPcA: res.muestrasArchivo, coberturaPcA: coberturaA, paginacion,
      apiCpuPicoPct: res.picos.apiCpuPct, apiRssPicoMb: res.picos.apiRssMb, eventLoopP99PicoMs: res.picos.eventLoopP99Ms, eventLoopMaxPicoMs: res.picos.eventLoopMaxMs,
      primeraMuestraExcluidaEventLoop: res.primeraMuestraExcluidaEventLoop, hostCpuPicoPct: res.picos.hostCpuPct, redRxPicoMBs: res.picos.redRxMBs } : 'sin muestras del PC A en la ventana de k6');

  const decision = compuertas.every((c) => c.ok) ? 'CONTINUAR' : 'STOP';
  const r = { corrida, uploads, decision, ventana: V.ventana, fallidas: compuertas.filter((c) => !c.ok).map((c) => c.nombre), compuertas };
  writeFileSync(ruta('compuerta.json'), JSON.stringify(r, null, 1));
  for (const c of compuertas) console.log(`${c.ok ? 'OK  ' : 'FALLA'} ${c.nombre.padEnd(24)} ${JSON.stringify(c.detalle)}`);
  console.log(`\nCOMPUERTA ${corrida}: ${decision}${decision === 'STOP' ? ` (${r.fallidas.join(', ')}) — no pasar al siguiente escalón` : ''}`);
  process.exit(decision === 'CONTINUAR' ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
