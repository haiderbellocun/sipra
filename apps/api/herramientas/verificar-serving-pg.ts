/* eslint-disable no-console */
/**
 * Serving analítico del histórico (H5) · verificación contra un PostgreSQL LOCAL DESECHABLE con los adaptadores REALES.
 *
 * Base temporal con todas las migraciones y la operación sintética. Mismo escenario de solapamiento que H4 (confirmado,
 * candidato, ambiguo) con clave sintética de la corrida. Comprueba: la ruta por fuentes (H5) da EXACTAMENTE lo mismo
 * que la capa H4 en current/historical/all y con filtros; el refresco es atómico (una publicación que falla la
 * validación no reemplaza la vigente); sin publicación, Histórico/Todos fallan controlados y Actual sigue; sipra_app
 * solo puede LEER el serving; y, con 10.000 registros adicionales, la latencia H4 vs H5 y el plan de ejecución.
 *
 *   DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npm run test:pg:serving
 *
 * Exige CREATEDB para la base temporal: sin él se detiene con CREATEDB_REQUIRED (nunca modifica el rol).
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { borrarBaseTemporal } from './soporte-base-temporal';
import { AnaliticaUnificadaUseCase } from '../src/application/use-cases/analitica/analitica-unificada.use-case';
import { ConstruirServingHistoricoUseCase } from '../src/application/use-cases/analitica/construir-serving.use-case';
import { ImportarHistoricoUseCase } from '../src/application/use-cases/historico/importar-historico.use-case';
import { Actor } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { FiltroFuentes, ReportesFuentesUseCase } from '../src/application/use-cases/reportes/reportes-fuentes.use-case';
import { FiltroAnaliticoUnificado, ResultadoAnaliticoUnificado } from '../src/domain/analitica/modelo-analitico';
import { DIMENSIONES } from '../src/domain/analitica/serving-analitico';
import { COLUMNAS_SGP, SistemaOrigen } from '../src/domain/historico/registro-historico';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { AnaliticaUnificadaPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/analitica-unificada.adapter';
import { HistoricoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { ServingAnaliticoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/serving-analitico.adapter';
import { IdentidadAnaliticaHmac } from '../src/infrastructure/historico/identidad-analitica.adapter';
import { LectorXlsxFlujoSgp } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { cargarCatalogos } from '../src/infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { sembrar } from '../src/infrastructure/persistence/postgres/seeds/ejecutar-semillas';
import { CENTINELAS, escribirLoteSinteticoGrande, filasFixtureSgp } from '../test/soporte-historico-sgp';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Se niega a correr: la base no es local.');
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };

let fallos = 0;
const comprobar = (d: string, ok: boolean, detalle = ''): void => {
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${d}${ok || !detalle ? '' : `  → ${detalle}`}`);
};
const seud = SeudonimizadorHistorico.desdeSecreto(`serving-${randomUUID()}-${randomUUID()}`, 'v1');
const CICLO_SGP: Record<string, [string, string]> = {
  tecnico: ['PRÁCTICA NIVEL TÉCNICO ', 'Técnico'], tecnologo: ['PRACTICA NIVEL TECNOLÓGICO', 'Tecnologo'], profesional: ['PRACTICA NIVEL PROFESIONAL UNIVERSITARIO', 'Profesional'],
};
const ADMIN = { id: randomUUID(), correo: 'admin@verificacion.example', rol: Rol.ADMINISTRADOR, permiso: 'consulta', escuelas: [], empresaId: null } as unknown as Actor;

/** Lo que el contrato compara entre H4 y H5 (dimensiones en orden canónico). */
function huella(r: ResultadoAnaliticoUnificado): string {
  const dims = Object.fromEntries(DIMENSIONES.map((d) => [d, [...r.dimensiones[d]].sort((a, b) => a.clave.localeCompare(b.clave))]));
  return JSON.stringify({ t: r.totales, ta: r.tasas, du: r.duracion, doc: r.indicadorDocumentalSgp, so: r.solapamiento, dims });
}

/** Primera ruta JSON donde difieren dos huellas (solo diagnóstico: no cambia el criterio de igualdad). */
function primeraDiferencia(a: unknown, b: unknown, ruta = ''): string {
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = primeraDiferencia((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${ruta}.${k}`);
      if (d) return d;
    }
  }
  return `${ruta}: H4=${JSON.stringify(a)?.slice(0, 300)} · H5=${JSON.stringify(b)?.slice(0, 300)}`;
}

async function main(): Promise<void> {
  const admin = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
  const [rol] = (await admin.query('SELECT rolcreatedb OR rolsuper AS puede FROM pg_roles WHERE rolname = current_user')) as { puede: boolean }[];
  if (!rol?.puede) {
    await admin.destroy();
    console.error('CREATEDB_REQUIRED: el rol de DB_URL no puede crear la base temporal. No se modificó ningún privilegio.');
    process.exit(2);
  }
  const nombre = `hist_serv_${randomUUID().slice(0, 8)}`;
  await admin.query(`CREATE DATABASE "${nombre}"`);
  const dir = await mkdtemp(join(tmpdir(), 'sipra-serving-pg-'));
  let ds: DataSource | null = null;
  try {
    ds = await new DataSource({ type: 'postgres', url: urlDe(nombre), ssl: false, migrations: MIGRACIONES, extra: { max: 6 } }).initialize();
    await ds.runMigrations({ transaction: 'each' });
    await cargarCatalogos(ds);
    await sembrar(ds);
    const importar = (ruta: string, sistema: SistemaOrigen) => new ImportarHistoricoUseCase(new LectorXlsxFlujoSgp(ruta), seud, new HistoricoPostgresAdapter(ds!))
      .ejecutar({ modo: 'apply', sourceSystem: sistema, compuertaEntorno: true });
    const lectura = new AnaliticaUnificadaPostgresAdapter(ds);
    const serving = new ServingAnaliticoPostgresAdapter(ds);
    const publicar = (sistema: SistemaOrigen) => new ConstruirServingHistoricoUseCase(lectura, serving).ejecutar(sistema);
    const h4 = (sistema: SistemaOrigen, f: FiltroAnaliticoUnificado) => new AnaliticaUnificadaUseCase(lectura, new IdentidadAnaliticaHmac([seud]), { sistema }).consultar(f);
    const h5 = (sistema: SistemaOrigen, f: FiltroFuentes, actor = ADMIN, conClave = true) =>
      new ReportesFuentesUseCase(lectura, serving, new IdentidadAnaliticaHmac(conClave ? [seud] : []), sistema).consultar(f, actor);
    const n = async (sql: string, p: unknown[] = []): Promise<number> => (await ds!.query(sql, p))[0].n as number;

    // ── Escenario (el de H4): confirmado, candidato y ambiguo contra estudiantes sembrados ─────────────────────
    const semillas = (await ds.query(`SELECT p.id, u.documento, p.periodo_academico AS periodo, p.ciclo FROM practicas p JOIN usuarios u ON u.id = p.estudiante_id
      WHERE u.documento IS NOT NULL AND p.estado <> 'anulada' ORDER BY p.id LIMIT 40`)) as { id: string; documento: string; periodo: string; ciclo: string }[];
    const distintas = semillas.filter((s) => semillas.filter((x) => x.documento === s.documento && x.periodo === s.periodo && x.ciclo === s.ciclo).length === 1);
    const [conf, cand, amb] = distintas.filter((s, i, arr) => arr.findIndex((x) => x.documento === s.documento) === i);
    const plantilla = filasFixtureSgp(1)[40];
    const fila = (id: number, s: { documento: string; periodo: string; ciclo: string }) => ({
      ...plantilla, '#': id, 'Documento': s.documento, 'Periodo Inscripción Asignatura': s.periodo,
      'Nombre Asignatura': CICLO_SGP[s.ciclo][0], 'Nivel Formación': CICLO_SGP[s.ciclo][1], 'Estado Práctica': 'Inscrito',
    });
    const solapes = join(dir, 'solapes.xlsx');
    {
      const libro = new ExcelJS.Workbook();
      const hoja = libro.addWorksheet('Reporte Prácticas general');
      hoja.addRow([...COLUMNAS_SGP]);
      for (const f of [fila(9_100_001, conf), fila(9_100_002, cand), fila(9_100_003, amb), { ...fila(9_100_004, amb), 'Estado Práctica': 'Cerrado', 'Registros Bitacora': 3 }]) hoja.addRow(COLUMNAS_SGP.map((c) => (f as Record<string, unknown>)[c] ?? null));
      for (const f of filasFixtureSgp(1)) hoja.addRow(COLUMNAS_SGP.map((c) => (f as Record<string, unknown>)[c] ?? null));
      await libro.xlsx.writeFile(solapes);
    }
    const imp = await importar(solapes, 'SGP_SINTETICO');
    comprobar(`fixture + 4 registros de solape importados (${imp.nuevos})`, imp.resultado === 'COMPLETED' && imp.nuevos === 254);
    const [{ id: revisor }] = (await ds.query(`SELECT id FROM usuarios WHERE rol = 'coordinador' LIMIT 1`)) as { id: string }[];
    await ds.query(`INSERT INTO historico.practica_correspondencia (id, source_system, source_record_id, practica_id, method, status, reviewed_by, reviewed_at)
      VALUES ($1, 'SGP_SINTETICO', '9100001', $2, 'manual', 'confirmada', $3, now())`, [randomUUID(), conf.id, revisor]);

    // ── Sin publicación: Actual sigue; Histórico/Todos fallan controlados ─────────────────────────────────
    console.log('\nSin serving publicado');
    const actualSinServing = await h5('SGP_SINTETICO', { fuente: 'current' });
    comprobar('Actual responde sin serving', actualSinServing.totales.practicas === await n('SELECT count(*)::int AS n FROM practicas'));
    const fallo = await h5('SGP_SINTETICO', { fuente: 'historical' }).then(() => '', (e: Error) => `${e.constructor.name}: ${e.message}`);
    comprobar('Histórico sin serving → 503 SERVING_HISTORICO_NO_DISPONIBLE', /ServiceUnavailable/.test(fallo) && /SERVING_HISTORICO_NO_DISPONIBLE/.test(fallo), fallo);

    // ── Publicación y equivalencia exacta con H4 ──────────────────────────────────────────────────────────
    console.log('\nEquivalencia H5 = H4');
    const p1 = await publicar('SGP_SINTETICO');
    comprobar(`serving publicado (${p1.filas} filas)`, p1.filas === 254);
    const filtros: [string, FiltroFuentes][] = [
      ['current', { fuente: 'current' }], ['historical', { fuente: 'historical' }], ['all', { fuente: 'all' }],
      [`all · periodo ${conf.periodo}`, { fuente: 'all', periodos: [conf.periodo] }],
      ['historical · nivel tecnólogo + pasantía', { fuente: 'historical', nivel: 'tecnologo', modalidadPractica: 'modalidad:pasantia' }],
      ['all · estado cerrado', { fuente: 'all', estado: 'cerrado' }],
    ];
    for (const [etq, f] of filtros) {
      const a = huella(await h4('SGP_SINTETICO', { ...f, escuelaIds: undefined } as FiltroAnaliticoUnificado));
      const b = huella(await h5('SGP_SINTETICO', f));
      comprobar(`${etq}: H5 idéntico a H4`, a === b, a === b ? '' : primeraDiferencia(JSON.parse(a), JSON.parse(b)));
    }
    const all = await h5('SGP_SINTETICO', { fuente: 'all' });
    comprobar(`solapamiento: 1 matched, 1 candidato, 2 ambiguos (${JSON.stringify(all.solapamiento?.categorias)})`,
      all.solapamiento?.categorias.matched === 1 && all.solapamiento.categorias.candidate_overlap === 1 && all.solapamiento.categorias.ambiguous_overlap === 2);
    const sinClave = await h5('SGP_SINTETICO', { fuente: 'all' }, ADMIN, false);
    comprobar('sin clave: cota superior explícita', sinClave.totales.precisionEstudiantes === 'cota_superior' && sinClave.advertencias.some((x) => /IDENTIDAD_NO_COMPARABLE/.test(x)));
    const coord = { ...ADMIN, rol: Rol.COORDINADOR, escuelas: ['ESC-NEG'] } as unknown as Actor;
    const conAlcance = await h5('SGP_SINTETICO', { fuente: 'all' }, coord).catch(() => null);
    comprobar('alcance por escuelas: el histórico sin equivalencia no entra y se informa',
      conAlcance === null || (conAlcance.cobertura.historicoFueraDeAlcance > 0 && conAlcance.solapamiento?.categorias.historical_only === 0));

    // ── Refresco atómico ──────────────────────────────────────────────────────────────────────────────────
    console.log('\nRefresco atómico');
    const puntero = async (): Promise<string> => (await ds!.query(`SELECT version::text AS v FROM historico.serving_publicacion WHERE sistema = 'SGP_SINTETICO'`))[0].v as string;
    const antes = await puntero();
    const filasAntes = await n('SELECT count(*)::int AS n FROM historico.serving_practicas');
    const rechazo = await serving.publicar('SGP_SINTETICO', [], { corte: null, desde: null, practicasEsperadas: 1 }).then(() => '', (e: Error) => e.message);
    comprobar('una publicación que no valida se rechaza', /Validación del serving fallida/.test(rechazo), rechazo);
    comprobar('… y la versión vigente queda intacta (puntero y filas)', (await puntero()) === antes && (await n('SELECT count(*)::int AS n FROM historico.serving_practicas')) === filasAntes);
    const p2 = await publicar('SGP_SINTETICO');
    comprobar('una nueva publicación cambia el puntero y no deja versiones viejas', (await puntero()) === p2.version && p2.version !== antes
      && (await n(`SELECT count(DISTINCT version)::int AS n FROM historico.serving_practicas WHERE sistema = 'SGP_SINTETICO'`)) === 1);

    // ── Mínimo privilegio y privacidad ────────────────────────────────────────────────────────────────────
    console.log('\nPrivilegios y privacidad');
    const priv = async (t: string, p: string): Promise<boolean> => (await ds!.query('SELECT has_table_privilege($1,$2,$3) AS v', ['sipra_app', t, p]))[0].v as boolean;
    let escribe = false;
    for (const t of ['historico.serving_practicas', 'historico.serving_publicacion', 'historico.practica_correspondencia']) for (const p of ['INSERT', 'UPDATE', 'DELETE']) escribe ||= await priv(t, p);
    comprobar('sipra_app lee el serving y no puede escribirlo ni escribir correspondencias', await priv('historico.serving_practicas', 'SELECT') && !escribe);
    comprobar('sipra_app no lee las versiones crudas del histórico', !(await priv('historico.practicas', 'SELECT')));
    const documentos = (await ds.query(`SELECT documento FROM usuarios WHERE documento IS NOT NULL`)).map((r: { documento: string }) => r.documento);
    let fuga = 0;
    for (const f of ['current', 'historical', 'all'] as const) {
      const t = JSON.stringify(await h5('SGP_SINTETICO', { fuente: f }));
      if (/[0-9a-f]{64}/.test(t) || documentos.some((d: string) => t.includes(d)) || CENTINELAS.some((c) => t.includes(c))) fuga += 1;
    }
    comprobar('ninguna respuesta contiene claves HMAC, documentos ni valores personales', fuga === 0);

    // ── Rendimiento: 10.000 registros, H4 vs H5 ───────────────────────────────────────────────────────────
    console.log('\nRendimiento (10.000 registros SGP sintéticos)');
    const grande = join(dir, 'grande.xlsx');
    await escribirLoteSinteticoGrande(grande, 10_000);
    const g = await importar(grande, 'SGP');
    comprobar(`10.000 registros importados como SGP (${g.nuevos})`, g.nuevos === 10_000);
    await ds.query('ANALYZE historico.practicas');
    const tPub = Date.now();
    await publicar('SGP');
    console.log(`      publicación del serving SGP (10.000)            ${String(Date.now() - tPub).padStart(5)} ms`);
    await ds.query('ANALYZE historico.serving_practicas');
    // Tiempo total del backend (caso de uso completo) y tiempo SQL (suma de las consultas a PostgreSQL dentro de la
    // llamada, medida en el cliente). Mediana de 7 tras un calentamiento.
    const consultaOriginal = ds.query.bind(ds);
    let sqlMs = 0;
    (ds as unknown as { query: (q: string, p?: unknown[]) => Promise<unknown> }).query = async (q: string, p?: unknown[]) => {
      const t0 = performance.now();
      try { return await consultaOriginal(q, p); } finally { sqlMs += performance.now() - t0; }
    };
    const mediana = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const medir = async (etq: string, fn: () => Promise<unknown>): Promise<{ total: number; sql: number }> => {
      await fn();
      const ts: number[] = [], ss: number[] = [];
      for (let i = 0; i < 7; i += 1) { sqlMs = 0; const t0 = performance.now(); await fn(); ts.push(performance.now() - t0); ss.push(sqlMs); }
      const r = { total: mediana(ts), sql: mediana(ss) };
      console.log(`      ${etq.padEnd(40)} total ${r.total.toFixed(0).padStart(5)} ms · SQL ${r.sql.toFixed(0).padStart(5)} ms (mediana de 7)`);
      return r;
    };
    const casos: [string, FiltroFuentes][] = [
      ['historical', { fuente: 'historical' }], ['all', { fuente: 'all' }],
      ['historical · periodo 24V03', { fuente: 'historical', periodos: ['24V03'] }], ['all · periodo 24V03', { fuente: 'all', periodos: ['24V03'] }],
    ];
    const tiempos: Record<string, [number, number]> = {};
    const filasBench: string[] = [];
    for (const [etq, f] of casos) {
      const a = await medir(`H4 ${etq}`, () => h4('SGP', f as FiltroAnaliticoUnificado));
      const b = await medir(`H5 ${etq}`, () => h5('SGP', f));
      tiempos[etq] = [a.total, b.total];
      filasBench.push(`| ${etq} | ${a.total.toFixed(0)} | ${a.sql.toFixed(0)} | ${b.total.toFixed(0)} | ${b.sql.toFixed(0)} | ${(((a.total - b.total) / a.total) * 100).toFixed(1)} % |`);
      comprobar(`${etq} (10.000): H5 idéntico a H4`, huella(await h4('SGP', f as FiltroAnaliticoUnificado)) === huella(await h5('SGP', f)));
    }
    (ds as unknown as { query: unknown }).query = consultaOriginal;
    console.log('\n      | Caso (10.000) | H4 total ms | H4 SQL ms | H5 total ms | H5 SQL ms | Mejora H4→H5 |');
    console.log(filasBench.map((l) => `      ${l}`).join('\n'));
    // Tiempo de motor de la consulta del serving por caso (EXPLAIN ANALYZE, mediana de 3).
    for (const [etq, f] of casos) {
      let sqlCaso: [string, unknown[]] | null = null;
      (ds as unknown as { query: (q: string, p?: unknown[]) => Promise<unknown> }).query = (q: string, p?: unknown[]) => { if (/serving_practicas/.test(q)) sqlCaso ??= [q, p ?? []]; return consultaOriginal(q, p); };
      await h5('SGP', f);
      (ds as unknown as { query: unknown }).query = consultaOriginal;
      const motor: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const p = (await ds.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sqlCaso![0]}`, sqlCaso![1])) as { 'QUERY PLAN': [{ 'Execution Time': number }] }[];
        motor.push(p[0]['QUERY PLAN'][0]['Execution Time']);
      }
      console.log(`      motor H5 ${etq.padEnd(32)} ${mediana(motor).toFixed(1).padStart(7)} ms (EXPLAIN ANALYZE, mediana de 3)`);
    }
    comprobar(`H5 all (10.000) por debajo de 1 s (${tiempos.all[1].toFixed(0)} ms; H4 ${tiempos.all[0].toFixed(0)} ms)`, tiempos.all[1] < 1000);
    // Plan de la consulta del serving: se captura la SQL real del adaptador y se ejecuta con EXPLAIN ANALYZE.
    let capturada: [string, unknown[]] | null = null;
    const original = ds.query.bind(ds);
    (ds as unknown as { query: (q: string, p?: unknown[]) => Promise<unknown> }).query = (q: string, p?: unknown[]) => { capturada ??= [q, p ?? []]; return original(q, p); };
    await serving.agregados({ sistema: 'SGP', excluirRegistros: [], clavesEstudiantesActuales: [] });
    (ds as unknown as { query: unknown }).query = original;
    const plan = (await ds.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${capturada![0]}`, capturada![1])) as { 'QUERY PLAN': [{ 'Execution Time': number; Plan: { 'Node Type': string; Plans?: unknown[] } }] }[];
    const nodos: string[] = [];
    const recorrer = (p: { 'Node Type': string; Plans?: unknown[] }): void => { nodos.push(p['Node Type']); for (const h of (p.Plans ?? []) as typeof p[]) recorrer(h); };
    recorrer(plan[0]['QUERY PLAN'][0].Plan);
    const ms = plan[0]['QUERY PLAN'][0]['Execution Time'];
    console.log(`      plan serving: ${[...new Set(nodos)].join(', ')} · ${ms.toFixed(1)} ms`);
    if (process.env.SERVING_PLAN_TEXTO === '1') {
      const texto = (await ds.query(`EXPLAIN (ANALYZE, BUFFERS) ${capturada![0]}`, capturada![1])) as { 'QUERY PLAN': string }[];
      console.log(texto.map((l) => `        ${l['QUERY PLAN']}`).join('\n'));
    }
    comprobar(`consulta del serving (10.000) en menos de 300 ms en el motor (${ms.toFixed(1)} ms)`, ms < 300);
    comprobar('sin bucles anidados sobre el serving', !nodos.includes('Nested Loop'));
  } finally {
    if (ds) await ds.destroy();
    await borrarBaseTemporal(admin, nombre);
    await admin.destroy();
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`\n${fallos === 0 ? 'TODO EN VERDE' : `${fallos} FALLA(S)`}`);
  if (fallos) process.exit(1);
}

main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
