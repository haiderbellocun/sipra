/* eslint-disable no-console */
/**
 * Capa analítica unificada (H4) · verificación contra un PostgreSQL LOCAL DESECHABLE con los adaptadores REALES.
 *
 * Base temporal con todas las migraciones y la operación sintética sembrada. Se importa (clave sintética de la corrida)
 * el fixture del SGP más registros construidos contra estudiantes sembrados para producir solapamientos CONFIRMADO,
 * CANDIDATO y AMBIGUO. Comprueba CURRENT (= operación = Reportes V3), HISTORICAL (solo vigentes de importaciones
 * `completed`), ALL (solo lo confirmado se deduplica), estudiantes únicos por identidad, privacidad del contrato y,
 * con 10.000 registros sintéticos adicionales, tiempos y planes de ejecución.
 *
 *   DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npm run test:pg:analitica
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { AnaliticaUnificadaUseCase } from '../src/application/use-cases/analitica/analitica-unificada.use-case';
import { ImportarHistoricoUseCase } from '../src/application/use-cases/historico/importar-historico.use-case';
import { RevertirImportacionHistoricoUseCase } from '../src/application/use-cases/historico/revertir-importacion-historico.use-case';
import { FiltroAnaliticoUnificado, ResultadoAnaliticoUnificado } from '../src/domain/analitica/modelo-analitico';
import { COLUMNAS_SGP, SistemaOrigen } from '../src/domain/historico/registro-historico';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { AnaliticaUnificadaPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/analitica-unificada.adapter';
import { HistoricoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { ReportesAnaliticaAdapter } from '../src/infrastructure/adapters/persistence/postgres/reportes-analitica.adapter';
import { IdentidadAnaliticaHmac } from '../src/infrastructure/historico/identidad-analitica.adapter';
import { LectorXlsxFlujoSgp } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { cargarCatalogos } from '../src/infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { sembrar } from '../src/infrastructure/persistence/postgres/seeds/ejecutar-semillas';
import { CENTINELAS, escribirFixtureSgp, escribirLoteSinteticoGrande, filasFixtureSgp } from '../test/soporte-historico-sgp';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Se niega a correr: la base no es local.');
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };

let fallos = 0;
const comprobar = (d: string, ok: boolean, detalle = ''): void => {
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${d}${ok || !detalle ? '' : `  → ${detalle}`}`);
};
const seud = SeudonimizadorHistorico.desdeSecreto(`analitica-${randomUUID()}-${randomUUID()}`, 'v1');
const CICLO_SGP: Record<string, [string, string]> = {
  tecnico: ['PRÁCTICA NIVEL TÉCNICO ', 'Técnico'], tecnologo: ['PRACTICA NIVEL TECNOLÓGICO', 'Tecnologo'], profesional: ['PRACTICA NIVEL PROFESIONAL UNIVERSITARIO', 'Profesional'],
};

async function main(): Promise<void> {
  const nombre = `hist_anal_${randomUUID().slice(0, 8)}`;
  const admin = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
  await admin.query(`CREATE DATABASE "${nombre}"`);
  const dir = await mkdtemp(join(tmpdir(), 'sipra-analitica-pg-'));
  let ds: DataSource | null = null;
  try {
    ds = await new DataSource({ type: 'postgres', url: urlDe(nombre), ssl: false, migrations: MIGRACIONES, extra: { max: 6 } }).initialize();
    await ds.runMigrations({ transaction: 'each' });
    await cargarCatalogos(ds);
    await sembrar(ds);
    const importar = (ruta: string, sistema: SistemaOrigen, r = new HistoricoPostgresAdapter(ds!)) => new ImportarHistoricoUseCase(new LectorXlsxFlujoSgp(ruta), seud, r)
      .ejecutar({ modo: 'apply', sourceSystem: sistema, compuertaEntorno: true });
    const analitica = (sistema: SistemaOrigen, conClave = true) => new AnaliticaUnificadaUseCase(
      new AnaliticaUnificadaPostgresAdapter(ds!), new IdentidadAnaliticaHmac(conClave ? [seud] : []), { sistema });
    const n = async (sql: string, p: unknown[] = []): Promise<number> => (await ds!.query(sql, p))[0].n as number;

    // ── Escenario: tres prácticas sembradas de estudiantes con documento, en periodos y ciclos conocidos ──────
    const semillas = (await ds.query(`SELECT p.id, u.documento, p.periodo_academico AS periodo, p.ciclo FROM practicas p JOIN usuarios u ON u.id = p.estudiante_id
      WHERE u.documento IS NOT NULL AND p.estado <> 'anulada' ORDER BY p.id LIMIT 40`)) as { id: string; documento: string; periodo: string; ciclo: string }[];
    const distintas = semillas.filter((s, i) => semillas.findIndex((x) => x.documento === s.documento && x.periodo === s.periodo && x.ciclo === s.ciclo) === i
      && semillas.filter((x) => x.documento === s.documento && x.periodo === s.periodo && x.ciclo === s.ciclo).length === 1);
    const [conf, cand, amb] = distintas.filter((s, i, arr) => arr.findIndex((x) => x.documento === s.documento) === i);
    comprobar('hay tres prácticas sembradas de estudiantes distintos para construir los solapamientos', !!conf && !!cand && !!amb);
    const plantilla = filasFixtureSgp(1)[40];
    const fila = (id: number, s: { documento: string; periodo: string; ciclo: string }) => ({
      ...plantilla, '#': id, 'Documento': s.documento, 'Periodo Inscripción Asignatura': s.periodo,
      'Nombre Asignatura': CICLO_SGP[s.ciclo][0], 'Nivel Formación': CICLO_SGP[s.ciclo][1], 'Estado Práctica': 'Inscrito',
    });
    const v1 = join(dir, 'v1.xlsx');
    await escribirFixtureSgp(v1, 1);
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
    // Correspondencia CONFIRMADA (decisión humana registrada) solo para el primero.
    const [{ id: revisor }] = (await ds.query(`SELECT id FROM usuarios WHERE rol = 'coordinador' LIMIT 1`)) as { id: string }[];
    await ds.query(`INSERT INTO historico.practica_correspondencia (id, source_system, source_record_id, practica_id, method, status, reviewed_by, reviewed_at)
      VALUES ($1, 'SGP_SINTETICO', '9100001', $2, 'manual', 'confirmada', $3, now())`, [randomUUID(), conf.id, revisor]);
    // Importaciones que NUNCA deben aportar: una revertida y una fallida con versiones sin purgar (proceso caído).
    const v2 = join(dir, 'v2.xlsx');
    await escribirFixtureSgp(v2, 2);
    const revertida = await importar(v2, 'SGP_SINTETICO');
    await new RevertirImportacionHistoricoUseCase(new HistoricoPostgresAdapter(ds)).ejecutar(revertida.importacionId!);
    await importar(v2, 'SGP_SINTETICO', new HistoricoPostgresAdapter(ds, { tamanoLote: 2, fallarTrasLotes: 2, omitirPurgaAlFallar: true })).catch(() => undefined);
    comprobar('hay una importación reverted y una failed con versiones no vigentes', (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE status IN ('reverted','failed')`)) >= 2
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id WHERE i.status = 'failed'`)) === 4);

    // ── CURRENT ───────────────────────────────────────────────────────────
    console.log('\nCURRENT');
    const cur = await analitica('SGP_SINTETICO').consultar({ fuente: 'current' });
    const operativas = await n('SELECT count(*)::int AS n FROM practicas');
    const reportes = (await new ReportesAnaliticaAdapter(ds, new ConfigService({})).practicas({})).length;
    comprobar(`CURRENT = operación = Reportes V3 (${cur.totales.practicas} / ${operativas} / ${reportes})`, cur.totales.practicas === operativas && operativas === reportes);
    comprobar('CURRENT: estudiantes únicos = estudiantes distintos con práctica', cur.totales.estudiantesUnicos === await n('SELECT count(DISTINCT estudiante_id)::int AS n FROM practicas'));
    for (const per of [...new Set(semillas.map((s) => s.periodo))].slice(0, 2)) {
      const f = await analitica('SGP_SINTETICO').consultar({ fuente: 'current', periodos: [per] });
      comprobar(`CURRENT filtrado por ${per} = operación`, f.totales.practicas === await n('SELECT count(*)::int AS n FROM practicas WHERE periodo_academico = $1', [per]));
    }

    // ── HISTORICAL ────────────────────────────────────────────────────────
    console.log('\nHISTORICAL');
    const his = await analitica('SGP_SINTETICO').consultar({ fuente: 'historical' });
    const vigentesCompleted = await n(`SELECT count(*)::int AS n FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id
      WHERE p.is_current AND i.status = 'completed' AND p.source_system = 'SGP_SINTETICO' AND p.duplicado_de IS NULL`);
    comprobar(`HISTORICAL = vigentes de importaciones completed sin copias (${his.totales.practicas} / ${vigentesCompleted})`, his.totales.practicas === vigentesCompleted);
    const deLaCompleted = await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE importacion_id = $1 AND is_current AND duplicado_de IS NULL`, [imp.importacionId]);
    comprobar(`HISTORICAL = solo la importación completed (${his.totales.practicas} = ${deLaCompleted}); las reverted y failed no aportan`,
      his.totales.practicas === deLaCompleted && deLaCompleted === 254 - 1);
    comprobar('HISTORICAL: EMPRESA PROPIA como valor SGP separado; B y C no unificados',
      his.dimensiones.modalidadPractica.some((d) => d.clave === 'sgp:EMPRESA PROPIA'));
    comprobar('HISTORICAL: tasas sin estados al corte', his.tasas.cierre.denominador === his.elegibilidad.tasa_cierre?.elegibles);

    // ── ALL ───────────────────────────────────────────────────────────────
    console.log('\nALL');
    const all = await analitica('SGP_SINTETICO').consultar({ fuente: 'all' });
    comprobar(`ALL = CURRENT + HISTORICAL − 1 confirmado (${all.totales.practicas})`, all.totales.practicas === cur.totales.practicas + his.totales.practicas - 1);
    comprobar(`solapamiento: 1 matched, 1 candidato, 2 ambiguos (${JSON.stringify(all.solapamiento?.categorias)})`,
      all.solapamiento?.categorias.matched === 1 && all.solapamiento.categorias.candidate_overlap === 1 && all.solapamiento.categorias.ambiguous_overlap === 2);
    comprobar('solo lo confirmado sale de ALL', JSON.stringify(all.solapamiento?.excluidosDeAll) === JSON.stringify({ CORRESPONDENCIA_CONFIRMADA_CON_SIPRA: 1 }));
    // Estudiantes únicos: los 3 estudiantes con práctica en ambas fuentes cuentan una vez.
    comprobar(`estudiantes únicos ALL = actuales + históricos − 3 compartidos (${all.totales.estudiantesUnicos})`,
      all.totales.estudiantesUnicos === cur.totales.estudiantesUnicos + his.totales.estudiantesUnicos - 3 && all.totales.precisionEstudiantes === 'exacta');
    const sinClave = await analitica('SGP_SINTETICO', false).consultar({ fuente: 'all' });
    // Sin clave no hay identidad común: cuentan por separado. El histórico CONFIRMADO igual sale de ALL (la
    // correspondencia no depende de la clave), así que su estudiante (que solo tiene ese registro SGP) no suma.
    comprobar('sin clave: cota superior (no se inventa la identidad)', sinClave.totales.precisionEstudiantes === 'cota_superior'
      && sinClave.totales.estudiantesUnicos === cur.totales.estudiantesUnicos + his.totales.estudiantesUnicos - 1);
    const conAlcance = await analitica('SGP_SINTETICO').consultar({ fuente: 'all', escuelaIds: ['ESC-NEG'] });
    comprobar('alcance por escuelas: el histórico no entra y se advierte', conAlcance.solapamiento?.categorias.historical_only === 0 && conAlcance.advertencias.some((a) => /FUERA_DE_ALCANCE/.test(a)));

    // ── Privacidad del contrato ───────────────────────────────────────────
    const documentos = (await ds.query(`SELECT documento FROM usuarios WHERE documento IS NOT NULL`)).map((r: { documento: string }) => r.documento);
    let fuga = 0;
    for (const r of [cur, his, all, sinClave]) {
      const t = JSON.stringify(r);
      if (/[0-9a-f]{64}/.test(t) || documentos.some((d: string) => t.includes(d)) || CENTINELAS.some((c) => t.includes(c))) fuga += 1;
    }
    comprobar('ningún resultado contiene claves HMAC, documentos ni valores personales', fuga === 0);

    // ── Rendimiento con 10.000 registros sintéticos adicionales ───────────
    console.log('\nRendimiento (10.000 registros SGP sintéticos)');
    const grande = join(dir, 'grande.xlsx');
    await escribirLoteSinteticoGrande(grande, 10_000);
    const g = await importar(grande, 'SGP');
    comprobar(`10.000 registros importados como SGP (${g.nuevos})`, g.nuevos === 10_000);
    await ds.query('ANALYZE historico.practicas');
    const medir = async (etiqueta: string, filtro: FiltroAnaliticoUnificado): Promise<ResultadoAnaliticoUnificado> => {
      const t0 = Date.now();
      const r = await analitica('SGP').consultar(filtro);
      console.log(`      ${etiqueta.padEnd(44)} ${String(Date.now() - t0).padStart(5)} ms · ${r.totales.practicas} prácticas`);
      return r;
    };
    const h10 = await medir('historical (10.000)', { fuente: 'historical' });
    await medir('historical · periodo 24V03', { fuente: 'historical', periodos: ['24V03'] });
    await medir('historical · nivel + modalidad', { fuente: 'historical', nivel: 'tecnologo', modalidadPractica: 'modalidad:pasantia' });
    await medir('current', { fuente: 'current' });
    await medir('all (10.000 + operación)', { fuente: 'all' });
    await medir('all · periodo 24V03', { fuente: 'all', periodos: ['24V03'] });
    comprobar('HISTORICAL con 10.000 cuenta exactamente las vigentes', h10.totales.practicas === await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_system = 'SGP' AND is_current AND duplicado_de IS NULL`));
    const plan = (await ds.query(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT p.source_record_id, p.organization_key FROM historico.practicas p
      JOIN historico.importaciones i ON i.id = p.importacion_id AND i.status = 'completed'
      WHERE p.is_current AND p.source_system = 'SGP'`)) as { 'QUERY PLAN': [{ Plan: { 'Node Type': string; 'Actual Rows': number; Plans?: unknown[] }; 'Execution Time': number }] }[];
    const raiz = plan[0]['QUERY PLAN'][0];
    const nodos: { 'Node Type': string; 'Actual Rows': number; 'Actual Loops'?: number }[] = [];
    const recorrer = (p: { 'Node Type': string; 'Actual Rows': number; Plans?: unknown[] }): void => { nodos.push(p); for (const h of (p.Plans ?? []) as typeof p[]) recorrer(h); };
    recorrer(raiz.Plan);
    console.log(`      plan histórico: ${[...new Set(nodos.map((x) => x['Node Type']))].join(', ')} · ${raiz['Execution Time'].toFixed(1)} ms`);
    if (process.env.ANALITICA_PLAN_TEXTO === '1') {
      const texto = (await ds.query(`EXPLAIN (ANALYZE, BUFFERS) SELECT p.source_record_id, p.organization_key FROM historico.practicas p
        JOIN historico.importaciones i ON i.id = p.importacion_id AND i.status = 'completed'
        WHERE p.is_current AND p.source_system = 'SGP'`)) as { 'QUERY PLAN': string }[];
      const texto2 = (await ds.query(`EXPLAIN (ANALYZE, BUFFERS) SELECT o.organization_key, o.id, m.empresa_id FROM historico.organizaciones o
        LEFT JOIN historico.organizacion_mapping m ON m.organizacion_id = o.id AND m.status = 'confirmada' WHERE o.source_system = 'SGP'`)) as { 'QUERY PLAN': string }[];
      texto.push(...texto2);
      console.log(texto.map((l) => `        ${l['QUERY PLAN']}`).join('\n'));
    }
    comprobar('plan sin producto cartesiano: ningún nodo devuelve más filas que las versiones leídas', nodos.every((x) => x['Actual Rows'] <= 10_000 + 260));
    comprobar(`consulta histórica de 10.000 versiones en menos de 200 ms (${raiz['Execution Time'].toFixed(1)} ms)`, raiz['Execution Time'] < 200);
  } finally {
    if (ds) await ds.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.destroy();
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`\n${fallos === 0 ? 'TODO EN VERDE' : `${fallos} FALLA(S)`}`);
  if (fallos) process.exit(1);
}

main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
