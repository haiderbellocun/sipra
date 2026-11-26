// Muestreo durante una corrida (P11–P13, P15). Solo lectura. Escribe performance/out/<corrida>.muestras.jsonl y, al
// terminar (señal o duración), performance/out/<corrida>.muestras-resumen.json con los picos.
//
//   node performance/herramientas/muestrear.cjs <corrida> [segundosMax=900]
//   (se detiene al crear performance/out/<corrida>.stop o al cumplir segundosMax)
//
// Fuentes por segundo:
//   - PostgreSQL (sipra_performance): conexiones por estado, wait events de las activas, locks en espera y deltas de
//     pg_stat_database (commits, rollbacks, deadlocks, bloques leídos, bytes temporales);
//   - API (/api/v1/metrics con el token efímero): CPU (delta de process_cpu_seconds_total), RSS, heap, event loop p99,
//     handles/peticiones activas y GC;
//   - máquina: CPU total (os.cpus), memoria libre (mínimo) y red (bytes/s de todos los adaptadores);
//   - CPU/RAM del node de la API y RAM/cantidad de procesos postgres.exe (PowerShell Get-Process, asíncrono). La CPU
//     de postgres.exe no es legible sin privilegios (servicio de otra cuenta): se usa la CPU total de la máquina.
const { Client } = require('pg');
const os = require('node:os');
const { appendFileSync, existsSync, readFileSync, rmSync, statfsSync, writeFileSync } = require('node:fs');
const { execFile } = require('node:child_process');
const { join } = require('node:path');

const corrida = process.argv[2];
if (!corrida) throw new Error('Falta el nombre de la corrida');
const segundosMax = Number(process.argv[3] ?? 900);
const OUT = process.env.PERF_OUT || join(__dirname, '..', 'out'); // PERF_OUT: solo para probar sin escribir en out/
const archivo = join(OUT, `${corrida}.muestras.jsonl`);
const TOKEN = readFileSync(join(__dirname, '..', 'out', '.metricas-token'), 'utf8').trim();
const API = process.env.PERF_API ?? 'http://127.0.0.1:3100/api/v1';
const API_PID = Number(process.env.PERF_API_PID ?? 0);
// Almacenamiento de la instancia de performance: se mide el espacio libre de su unidad (MB) por segundo.
const ALMACEN = join(__dirname, '..', '..', 'apps', 'api', '.almacen-performance');
const discoLibreMb = () => { try { const f = statfsSync(ALMACEN); return Math.round((f.bavail * f.bsize) / 1048576); } catch { return null; } };

const cpuHost = () => os.cpus().reduce((a, c) => { const t = c.times; a.total += t.user + t.nice + t.sys + t.idle + t.irq; a.idle += t.idle; return a; }, { total: 0, idle: 0 });

function prom(texto) {
  const v = {};
  for (const l of texto.split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const m = l.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-0-9.eE+]+|NaN)/);
    if (!m) continue;
    const clave = m[1].replace(/^sipra_/, '') + (m[2] ?? '');
    v[clave] = Number(m[3]);
  }
  return v;
}

function procesos() {
  return new Promise((ok) => {
    const ps = `$p=Get-Process -Name postgres -ErrorAction SilentlyContinue; $a=Get-Process -Id ${API_PID || 0} -ErrorAction SilentlyContinue;` +
      `[pscustomobject]@{pgCpu=($p|Measure-Object CPU -Sum).Sum; pgWs=($p|Measure-Object WorkingSet64 -Sum).Sum; pgN=($p|Measure-Object).Count; apiCpu=$a.CPU; apiWs=$a.WorkingSet64;` +
      `redRx=(Get-NetAdapterStatistics -ErrorAction SilentlyContinue|Measure-Object ReceivedBytes -Sum).Sum; redTx=(Get-NetAdapterStatistics -ErrorAction SilentlyContinue|Measure-Object SentBytes -Sum).Sum;` +
      `pag=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue).PagesPerSec} | ConvertTo-Json -Compress`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 }, (e, so) => { try { ok(JSON.parse(so)); } catch { ok(null); } });
  });
}

(async () => {
  const db = new Client({ host: process.env.DB_HOST || '127.0.0.1', port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'sipra_performance', application_name: 'perf-muestreo' });
  await db.connect();
  // CALENTAMIENTO del event loop: prom-client guarda el máximo de retraso del event loop desde la lectura ANTERIOR de
  // /metrics y lo reinicia en cada lectura. La primera lectura de una corrida arrastraría un máximo de antes (en
  // external-3000-002: 1.730.871,8 ms de una pausa previa). Esta lectura descarta ese arrastre y queda en el resumen.
  let calentamiento = null;
  try {
    const r = await fetch(`${API}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(3000) });
    const p = prom(await r.text());
    calentamiento = { t: new Date().toISOString(), eventLoopMaxDescartadoMs: +(((p.nodejs_eventloop_lag_max_seconds ?? 0)) * 1000).toFixed(1) };
  } catch (e) { calentamiento = { error: e.message }; }
  writeFileSync(archivo, '');
  let prevDb = null, prevCpu = cpuHost(), prevApiCpu = null, prevT = Date.now(), prevProc = null, prevProcT = Date.now();
  const picos = { pgConexiones: 0, pgActivas: 0, pgLocksEspera: 0, apiCpuPct: 0, apiRssMb: 0, apiHeapMb: 0, eventLoopP99Ms: 0, eventLoopMaxMs: 0, apiActivas: 0, hostCpuPct: 0, apiProcCpuPct: 0, pgProcRamMb: 0, pgProcesos: 0, apiProcRamMb: 0, redRxMBs: 0, redTxMBs: 0, pgIdleEnTransaccion: 0, paginasSeg: 0 };
  let hostLibreMin = Infinity, discoLibreMin = Infinity, discoLibreInicial = null;
  const waits = {};
  const totalesDb = { commits: 0, rollbacks: 0, deadlocks: 0, tempBytes: 0 };
  let n = 0, fin = false, gc0 = null, gc1 = null;
  const terminar = async () => {
    if (fin) return; fin = true;
    const resumen = { corrida, muestras: n, calentamiento, nota: 'picos de TODO el muestreo (antes, durante y después de k6); los de la corrida los calcula ventana.cjs', picos, hostLibreMinMb: hostLibreMin, discoLibreMinMb: discoLibreMin, discoConsumidoMb: discoLibreInicial !== null && discoLibreMin !== Infinity ? discoLibreInicial - discoLibreMin : null, waitEventsActivas: Object.fromEntries(Object.entries(waits).sort((a, b) => b[1] - a[1])), totalesDb,
      gc: gc0 && gc1 ? { pausas: gc1.c - gc0.c, segundos: +(gc1.s - gc0.s).toFixed(3) } : null };
    writeFileSync(join(OUT, `${corrida}.muestras-resumen.json`), JSON.stringify(resumen, null, 1));
    await db.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', terminar); process.on('SIGINT', terminar);
  const tFin = Date.now() + segundosMax * 1000;
  let tick = 0;
  let sondeando = false;
  const ultimoProc = {};
  const parada = join(OUT, `${corrida}.stop`);
  rmSync(parada, { force: true });
  while (!fin && Date.now() < tFin && !existsSync(parada)) {
    const t = Date.now();
    const m = { t: new Date(t).toISOString() };
    try {
      const est = (await db.query(`SELECT coalesce(state,'(sin estado)') s, coalesce(wait_event_type||':'||wait_event, '') w, count(*)::int n
        FROM pg_stat_activity WHERE datname = 'sipra_performance' AND application_name <> 'perf-muestreo' GROUP BY 1,2`)).rows;
      m.pgConexiones = est.reduce((a, r) => a + r.n, 0);
      m.pgEstados = {}; for (const r of est) m.pgEstados[r.s] = (m.pgEstados[r.s] ?? 0) + r.n;
      m.pgActivas = m.pgEstados.active ?? 0;
      m.pgIdleEnTransaccion = m.pgEstados['idle in transaction'] ?? 0;
      m.pgWaits = {}; // wait events de las conexiones activas en ESTA muestra (ventana.cjs los suma dentro de la ventana de k6)
      for (const r of est) if (r.s === 'active' && r.w) { waits[r.w] = (waits[r.w] ?? 0) + r.n; m.pgWaits[r.w] = (m.pgWaits[r.w] ?? 0) + r.n; }
      m.pgLocksEspera = (await db.query(`SELECT count(*)::int n FROM pg_locks l JOIN pg_database d ON d.oid = l.database WHERE d.datname = 'sipra_performance' AND NOT l.granted`)).rows[0].n;
      const [s] = (await db.query(`SELECT xact_commit::bigint c, xact_rollback::bigint r, deadlocks::bigint d, blks_read::bigint b, temp_bytes::bigint tb FROM pg_stat_database WHERE datname = 'sipra_performance'`)).rows;
      if (prevDb) {
        m.pgCommits = s.c - prevDb.c; m.pgRollbacks = s.r - prevDb.r; m.pgDeadlocks = s.d - prevDb.d; m.pgBloquesLeidos = s.b - prevDb.b; m.pgTempBytes = s.tb - prevDb.tb;
        totalesDb.commits += m.pgCommits; totalesDb.rollbacks += m.pgRollbacks; totalesDb.deadlocks += m.pgDeadlocks; totalesDb.tempBytes += m.pgTempBytes;
      }
      prevDb = { c: Number(s.c), r: Number(s.r), d: Number(s.d), b: Number(s.b), tb: Number(s.tb) };
    } catch (e) { m.pgError = e.message; }
    try {
      const r = await fetch(`${API}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(3000) });
      const p = prom(await r.text());
      const seg = (t - prevT) / 1000;
      const cpu = p.process_cpu_seconds_total;
      if (prevApiCpu !== null && seg > 0) m.apiCpuPct = +(((cpu - prevApiCpu) / seg) * 100).toFixed(1);
      prevApiCpu = cpu;
      m.apiRssMb = +((p.process_resident_memory_bytes ?? 0) / 1048576).toFixed(1);
      m.apiHeapMb = +((p.nodejs_heap_size_used_bytes ?? 0) / 1048576).toFixed(1);
      m.eventLoopP99Ms = +(((p.nodejs_eventloop_lag_p99_seconds ?? 0)) * 1000).toFixed(1);
      m.eventLoopMaxMs = +(((p.nodejs_eventloop_lag_max_seconds ?? 0)) * 1000).toFixed(1);
      m.apiHandles = p.nodejs_active_handles_total; m.apiActivas = p.nodejs_active_requests_total;
      const gcC = Object.entries(p).filter(([k]) => k.startsWith('nodejs_gc_duration_seconds_count')).reduce((a, [, v]) => a + v, 0);
      const gcS = Object.entries(p).filter(([k]) => k.startsWith('nodejs_gc_duration_seconds_sum')).reduce((a, [, v]) => a + v, 0);
      gc0 ??= { c: gcC, s: gcS }; gc1 = { c: gcC, s: gcS };
      m.gcPausasAcum = gcC; m.gcSegAcum = +gcS.toFixed(3); // acumulados: ventana.cjs calcula el GC de la ventana de k6
    } catch (e) { m.apiError = e.message; }
    const c = cpuHost();
    m.hostCpuPct = +((1 - (c.idle - prevCpu.idle) / Math.max(1, c.total - prevCpu.total)) * 100).toFixed(1);
    m.hostLibreMb = Math.round(os.freemem() / 1048576);
    m.discoLibreMb = discoLibreMb();
    if (m.discoLibreMb !== null) { discoLibreInicial ??= m.discoLibreMb; discoLibreMin = Math.min(discoLibreMin, m.discoLibreMb); }
    prevCpu = c; prevT = t;
    // Sondeo de procesos sin bloquear el muestreo (PowerShell tarda en arrancar): se usa el último resultado disponible.
    if (!sondeando) {
      sondeando = true;
      procesos().then((pr) => {
        if (pr) {
          const segP = (Date.now() - prevProcT) / 1000;
          if (prevProc && segP > 0) {
            ultimoProc.apiProcCpuPct = +((((pr.apiCpu ?? 0) - (prevProc.apiCpu ?? 0)) / segP) * 100).toFixed(1);
            ultimoProc.redRxMBs = +(((pr.redRx ?? 0) - (prevProc.redRx ?? 0)) / segP / 1048576).toFixed(2);
            ultimoProc.redTxMBs = +(((pr.redTx ?? 0) - (prevProc.redTx ?? 0)) / segP / 1048576).toFixed(2);
          }
          ultimoProc.paginasSeg = pr.pag ?? null; // paginación de Windows (páginas/s de disco); sostenida alta = presión de memoria
          ultimoProc.pgProcRamMb = Math.round((pr.pgWs ?? 0) / 1048576); ultimoProc.pgProcesos = pr.pgN; ultimoProc.apiProcRamMb = Math.round((pr.apiWs ?? 0) / 1048576);
          prevProc = pr; prevProcT = Date.now();
        }
      }).finally(() => { sondeando = false; });
    }
    Object.assign(m, ultimoProc);
    for (const k of Object.keys(picos)) if (typeof m[k] === 'number') picos[k] = Math.max(picos[k], m[k]);
    hostLibreMin = Math.min(hostLibreMin, m.hostLibreMb);
    appendFileSync(archivo, `${JSON.stringify(m)}\n`);
    n += 1; tick += 1;
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t))));
  }
  await terminar();
})().catch((e) => { console.error(e.message); process.exit(1); });
