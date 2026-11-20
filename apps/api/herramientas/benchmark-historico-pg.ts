/* eslint-disable no-console */
/**
 * Benchmark SINTÉTICO del importador del histórico (H3) contra un PostgreSQL LOCAL DESECHABLE.
 *
 * Genera un lote sintético grande (por omisión 10.000 registros + filas fantasma en la proporción real), crea una base
 * temporal con todas las migraciones y mide: simulacro (lectura/transformación), APPLY por lotes y en una
 * transacción (tiempo de base por fase), idempotencia, reversión y memoria. Extrapola a 143.659 registros (aproximado).
 * Borra la base y los archivos temporales al terminar. Nada sale del Excel real.
 *
 *   DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npm run benchmark:historico -- [--registros 10000]
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { ImportarHistoricoUseCase, ResumenImportacion } from '../src/application/use-cases/historico/importar-historico.use-case';
import { RevertirImportacionHistoricoUseCase } from '../src/application/use-cases/historico/revertir-importacion-historico.use-case';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { HistoricoPostgresAdapter, TiemposEscritura } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { LectorXlsxFlujoSgp } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { escribirLoteSinteticoGrande } from '../test/soporte-historico-sgp';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Se niega a correr: la base no es local.');
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--registros') + 1] ?? '') || 10_000;
const REAL = 143_659;

let picoRss = 0;
const muestreo = setInterval(() => { picoRss = Math.max(picoRss, process.memoryUsage().rss); }, 100);
const mb = (b: number): number => Math.round(b / 1_048_576);
const vivo = (): number => { (globalThis as { gc?: () => void }).gc?.(); return mb(process.memoryUsage().heapUsed); };

async function main(): Promise<void> {
  const nombre = `hist_bench_${randomUUID().slice(0, 8)}`;
  const admin = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
  await admin.query(`CREATE DATABASE "${nombre}"`);
  const dir = await mkdtemp(join(tmpdir(), 'sipra-historico-bench-'));
  let ds: DataSource | null = null;
  try {
    ds = await new DataSource({ type: 'postgres', url: urlDe(nombre), ssl: false, migrations: MIGRACIONES, extra: { max: 4 } }).initialize();
    await ds.runMigrations({ transaction: 'each' });
    const ruta = join(dir, 'lote.xlsx');
    let t = Date.now();
    const g = await escribirLoteSinteticoGrande(ruta, N);
    console.log(`Lote sintético: ${g.reales} registros + ${g.fantasmas} fantasma (generación ${((Date.now() - t) / 1000).toFixed(1)} s)`);
    const seud = SeudonimizadorHistorico.desdeSecreto(`bench-${randomUUID()}-${randomUUID()}`, 'v1');
    const correr = async (modo: 'dry-run' | 'apply', modoCarga: 'single' | 'batched' = 'batched'): Promise<{ r: ResumenImportacion; ms: number; db: TiemposEscritura | null }> => {
      const repo = new HistoricoPostgresAdapter(ds!);
      const t0 = Date.now();
      const r = await new ImportarHistoricoUseCase(new LectorXlsxFlujoSgp(ruta), seud, repo)
        .ejecutar({ modo, sourceSystem: 'SGP_SINTETICO', compuertaEntorno: true, modoCarga });
      return { r, ms: Date.now() - t0, db: repo.ultimosTiempos };
    };
    const filas: string[] = [];
    const informe = (etiqueta: string, ms: number, extra = ''): void => {
      const porSeg = Math.round(N / (ms / 1000));
      filas.push(`${etiqueta.padEnd(36)} ${(ms / 1000).toFixed(2).padStart(7)} s · ${String(porSeg).padStart(6)} reg/s · ≈ ${(REAL / porSeg).toFixed(0).padStart(4)} s para 143.659${extra}`);
    };

    const d = await correr('dry-run');
    informe('Simulacro (lectura + transformación)', d.ms, ` · heap vivo ${vivo()} MB`);
    const a = await correr('apply', 'batched');
    informe('APPLY por lotes (total)', a.ms, ` · base: plan ${a.db?.planMs} ms, inserción ${a.db?.insercionMs} ms (${a.db?.lotes} lotes), final ${a.db?.finalizacionMs} ms`);
    t = Date.now();
    const otra = await correr('apply');
    informe('APPLY repetido (ALREADY_IMPORTED)', Date.now() - t, ` · resultado ${otra.r.resultado}`);
    t = Date.now();
    const rev = await new RevertirImportacionHistoricoUseCase(new HistoricoPostgresAdapter(ds)).ejecutar(a.r.importacionId!);
    informe('Reversión', Date.now() - t, ` · ${rev.versionesRetiradas} versiones retiradas`);
    const s = await correr('apply', 'single');
    informe('APPLY en una transacción (total)', s.ms, ` · base: inserción ${s.db?.insercionMs} ms, final ${s.db?.finalizacionMs} ms`);
    const [{ tam }]: { tam: string }[] = await ds.query(`SELECT pg_size_pretty(pg_total_relation_size('historico.practicas')) AS tam`);
    console.log(filas.join('\n'));
    console.log(`Tamaño de historico.practicas con ${N} versiones: ${tam}`);
    console.log(`Memoria: RSS pico ${mb(picoRss)} MB · heap vivo al final ${vivo()} MB`);
    console.log(`Verificación: ${d.r.lectura.filasReales} reales / ${d.r.lectura.filasDescartadas} descartadas; repetido ${otra.r.resultado}; nuevas ${a.r.nuevos}; single ${s.r.resultado}`);
  } finally {
    clearInterval(muestreo);
    if (ds) await ds.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e: Error) => { clearInterval(muestreo); console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
