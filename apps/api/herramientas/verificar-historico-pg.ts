/* eslint-disable no-console */
/**
 * Histórico del SGP (H2) · verificación contra un PostgreSQL LOCAL DESECHABLE, con el adaptador y el lector REALES.
 *
 * Crea una base temporal, aplica TODAS las migraciones, siembra la operación sintética y comprueba sobre el fixture
 * sintético (v1/v2, `SGP_SINTETICO`): simulacro sin escrituras, compuertas, idempotencia por archivo, versionado,
 * reversión (LIFO), bloqueo consultivo, atomicidad ante un fallo a mitad, restricciones e inmutabilidad en el motor,
 * mínimo privilegio, ausencia de columnas y valores personales, y que la operación (`public`) no cambia.
 *
 *   DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npm run test:pg:historico
 *
 * Se NIEGA a correr si el host no es local. Borra la base temporal al terminar.
 */
import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ImportarHistoricoUseCase, ResumenImportacion } from '../src/application/use-cases/historico/importar-historico.use-case';
import { RevertirImportacionHistoricoUseCase } from '../src/application/use-cases/historico/revertir-importacion-historico.use-case';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { HistoricoPostgresAdapter, OpcionesAdaptadorHistorico } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { LectorXlsxFlujoSgp } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { cargarCatalogos } from '../src/infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { sembrar } from '../src/infrastructure/persistence/postgres/seeds/ejecutar-semillas';
import { CENTINELAS, FIXTURE, escribirFixtureSgp } from '../test/soporte-historico-sgp';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable (cualquier base, p. ej. /postgres).');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('Se niega a correr: la base no es local. Use un PostgreSQL desechable.');
}
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };

let fallos = 0;
const comprobar = (d: string, ok: boolean, detalle = ''): void => {
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${d}${ok || !detalle ? '' : `  → ${detalle}`}`);
};
async function rechaza(d: string, accion: () => Promise<unknown>, patron: RegExp): Promise<void> {
  try { await accion(); comprobar(d, false, 'se aceptó'); } catch (e) { comprobar(d, patron.test((e as Error).message), (e as Error).message.slice(0, 200)); }
}

/** Secretos SINTÉTICOS generados en la corrida (nunca un literal versionado). */
const seud = SeudonimizadorHistorico.desdeSecreto(`verificacion-${randomUUID()}-${randomUUID()}`, 'v1');
const seudV2 = SeudonimizadorHistorico.desdeSecreto(`verificacion-${randomUUID()}-${randomUUID()}`, 'v2');
const SISTEMA = 'SGP_SINTETICO' as const;

async function main(): Promise<void> {
  const nombre = `hist_pg_${randomUUID().slice(0, 8)}`;
  const admin = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
  await admin.query(`CREATE DATABASE "${nombre}"`);
  const dir = await mkdtemp(join(tmpdir(), 'sipra-historico-pg-'));
  let ds: DataSource | null = null;
  const salida: string[] = [];
  const informar = (l: string): void => { salida.push(l); };
  try {
    ds = await new DataSource({ type: 'postgres', url: urlDe(nombre), ssl: false, migrations: MIGRACIONES, extra: { max: 10 } }).initialize();
    await ds.runMigrations({ transaction: 'each' });
    await cargarCatalogos(ds);
    await sembrar(ds);
    const v1 = join(dir, 'v1.xlsx');
    const v2 = join(dir, 'v2.xlsx');
    await escribirFixtureSgp(v1, 1);
    await escribirFixtureSgp(v2, 2);

    const operativas = ['practicas', 'usuarios', 'empresas', 'documentos', 'obligaciones', 'auditoria', 'bitacora_entradas', 'cartas_presentacion'];
    const huellaOperativa = async (): Promise<string> => {
      const partes: string[] = [];
      for (const t of operativas) partes.push(`${t}:${(await ds!.query(`SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS h FROM ${t} x`))[0].h}`);
      return partes.join(';');
    };
    const nitA = '999000001';
    const nitB = '999000002';
    for (const [nit, dv, sufijo] of [[nitA, Nit.calcularDigitoVerificacion(nitA), 'a'], [nitB, (Nit.calcularDigitoVerificacion(nitB) + 1) % 10, 'b']] as const) {
      await ds.query(`INSERT INTO empresas (id, razon_social, nit_numero, nit_dv, solicitante_nombre, solicitante_correo, estado)
        VALUES ($1, $2, $3, $4, 'Solicitante sintético', $5, 'habilitada')`, [randomUUID(), `EMPRESA SINTÉTICA ${sufijo}`, nit, dv, `verif-hist-${sufijo}@verificacion.example`]);
    }
    const operacionAntes = await huellaOperativa();
    const n = async (sql: string, p: unknown[] = []): Promise<number> => (await ds!.query(sql, p))[0].n as number;
    const escrituras = async (): Promise<number> => n(`SELECT ((SELECT count(*) FROM historico.importaciones) + (SELECT count(*) FROM historico.practicas)
      + (SELECT count(*) FROM historico.organizaciones) + (SELECT count(*) FROM historico.organizacion_alias) + (SELECT count(*) FROM historico.organizacion_mapping))::int AS n`);
    const repo = (o: OpcionesAdaptadorHistorico = {}): HistoricoPostgresAdapter => new HistoricoPostgresAdapter(ds!, o);
    const importar = (ruta: string, modo: 'dry-run' | 'apply', o: { s?: SeudonimizadorHistorico; compuerta?: boolean; r?: HistoricoPostgresAdapter; modoCarga?: 'single' | 'batched' } = {}): Promise<ResumenImportacion> =>
      new ImportarHistoricoUseCase(new LectorXlsxFlujoSgp(ruta), o.s ?? seud, o.r ?? repo())
        .ejecutar({ modo, sourceSystem: SISTEMA, compuertaEntorno: o.compuerta ?? true, informar, modoCarga: o.modoCarga });

    // ── 1. Esquema ────────────────────────────────────────────────────────
    console.log('\n1. Esquema historico');
    const tablas = (await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'historico' ORDER BY 1`)).map((r: { table_name: string }) => r.table_name);
    comprobar('migraciones 25 y 26 aplicadas', (await n(`SELECT count(*)::int AS n FROM migrations WHERE name IN ('HistoricoSgp1756000025000', 'HistoricoPreparacionCarga1756000026000')`)) === 2);
    comprobar('existen las 6 tablas del histórico', JSON.stringify(tablas) === JSON.stringify(['importaciones', 'organizacion_alias', 'organizacion_mapping', 'organizaciones', 'practica_correspondencia', 'practicas']), tablas.join(','));
    const columnas = (await ds.query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_schema = 'historico'`)).map((r: { c: string }) => r.c);
    const sensibles = columnas.filter((c: string) => /(student_name|email|correo|phone|telefono|teacher_name|nombre_docente|boss|jefe|funciones|functions_text|nombre_estudiante|nombre_empresa|raw|fila_original)/i.test(c) || /\.documento(_docente|_estudiante)?$/i.test(c));
    comprobar(`ninguna columna personal directa ni copia de la fila (${columnas.length} columnas)`, sensibles.length === 0, sensibles.join(','));
    const priv = async (q: string): Promise<boolean> => (await ds!.query(q))[0].v as boolean;
    comprobar('sipra_app SIN uso del esquema ni SELECT sobre historico.practicas',
      !(await priv(`SELECT has_schema_privilege('sipra_app', 'historico', 'USAGE') AS v`))
      && !(await priv(`SELECT has_table_privilege('sipra_app', 'historico.practicas', 'SELECT') AS v`)));

    // ── 2. Simulacro y compuertas: CERO escrituras ────────────────────────
    console.log('\n2. Simulacro y compuertas');
    const dry = await importar(v1, 'dry-run');
    comprobar(`DRY RUN: ${dry.lectura.filasReales} reales de ${dry.lectura.filasFisicas} físicas, ${dry.nuevos} nuevas proyectadas`, dry.lectura.filasReales === FIXTURE.reales && dry.nuevos === FIXTURE.reales && dry.lectura.filasDescartadas === FIXTURE.fantasmas);
    comprobar('DRY RUN: cero escrituras (ni la fila de importación)', (await escrituras()) === 0);
    await rechaza('APPLY sin compuerta de entorno → rechazado', () => importar(v1, 'apply', { compuerta: false }), /HISTORICO_IMPORT_APPLY/);
    await rechaza('APPLY con clave efímera → rechazado', () => importar(v1, 'apply', { s: SeudonimizadorHistorico.efimero() }), /efímera/);
    comprobar('compuertas cerradas: cero escrituras', (await escrituras()) === 0);

    // ── 3. APPLY v1 ───────────────────────────────────────────────────────
    console.log('\n3. APPLY v1');
    const a1 = await importar(v1, 'apply');
    comprobar(`APPLY v1 completado: ${a1.nuevos} nuevas`, a1.resultado === 'COMPLETED' && a1.nuevos === FIXTURE.reales && a1.versionados === 0);
    const imp1 = a1.importacionId!;
    const fila1 = (await ds.query(`SELECT * FROM historico.importaciones WHERE id = $1`, [imp1]))[0];
    comprobar('importación v1: completed con conteos, versión de clave y de importador', fila1.status === 'completed' && fila1.row_count_real === 250
      && fila1.row_count_file === 310 && fila1.row_count_imported === 250 && fila1.hmac_key_version === 'v1' && fila1.finished_at !== null && /historico-sgp/.test(fila1.importer_version));
    comprobar('todas las versiones v1: versión 1 y vigentes', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE version = 1 AND is_current`)) === 250);
    for (const [marca, esperado] of [['TRUNCATED_SOURCE_ROW', 1], ['END_BEFORE_START', 1], ['MODALITY_MAPPING_PENDING', 2], ['STUDENT_ID_MISSING', 1], ['INVALID_END_DATE', 2], ['IDENTICAL_CONTENT', 2]] as const) {
      const c = await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE $1 = ANY(quality_flags)`, [marca]);
      comprobar(`marca ${marca}: ${c}`, c === esperado);
    }
    comprobar('H3: ninguna práctica lleva marcas de empresa en quality_flags', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE array_to_string(quality_flags, ',') ~ '(COMPANY|IDENTIFIER|ALIAS)'`)) === 0);
    comprobar('H3: calidad de organización en organization_flags (persona natural, identificador inválido)',
      (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE 'IDENTIFIER_PERSON_NATURAL' = ANY(organization_flags)`)) === 1
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE 'IDENTIFIER_INVALID' = ANY(organization_flags)`)) === 1);
    comprobar('H3: pista de tipo solo donde se sustenta', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE organization_type_hint = 'NATURAL_PERSON' AND organization_identifier_kind <> 'persona_natural'`)) === 0
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE organization_type_hint = 'LEGAL_ENTITY'`)) > 0);
    comprobar('H3: empresa con varios alias no vuelve observada una práctica limpia', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_record_id IN ('9000022','9000023') AND quality_status = 'clean'`)) >= 1);
    comprobar('H3: duplicado idéntico → la copia apunta al representante', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_record_id = '9000032' AND duplicado_de = '9000031'`)) === 1);
    comprobar('H3: importación por lotes registrada como batched', (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE status = 'completed' AND load_mode = 'batched'`)) === 1);
    comprobar('quality_status solo clean/observed, coherente', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE (quality_status = 'observed') <> (cardinality(quality_flags) > 0)`)) === 0);
    comprobar('fila truncada importada como observed (no descartada)', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_record_id = '9000035' AND quality_status = 'observed'`)) === 1);
    comprobar('EMPRESA PROPIA: pendiente institucional, sin modalidad inventada', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE modalidad_mapping_status = 'PENDING_INSTITUTIONAL_MAPPING' AND modalidad_practica_normalizada IS NULL`)) === 2);
    comprobar('fecha 0000-00-00: original conservado, fecha NULL', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE fecha_fin_original = '0000-00-00' AND fecha_fin IS NULL`)) === 1);
    comprobar('fecha 2223: NULL', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE fecha_fin_original LIKE '2223-%' AND fecha_fin IS NULL`)) === 1);
    comprobar('estados abiertos = estado al corte, con fecha de corte', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE es_estado_de_corte AND (estado_analitico NOT IN ('inscrito','en_practica') OR estado_fecha_corte IS NULL)`)) === 0
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE es_estado_de_corte`)) > 0);
    comprobar('ningún código SINU inventado', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE codigo_sinu IS NOT NULL`)) === 0);
    // HMAC: el documento en texto con puntos y el mismo en número → misma clave; docente ≠ estudiante.
    const [k3, k128] = await ds.query(`SELECT source_record_id, student_key FROM historico.practicas WHERE source_record_id IN ('9000003','9000128') ORDER BY 1`) as { student_key: string }[];
    comprobar('HMAC: documento «9.100.000.002» (texto) y 9100000002 (número) → misma student_key', !!k3?.student_key && k3.student_key === k128?.student_key);
    comprobar('HMAC: claves de 64 hex y versión v1 en todas', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE hmac_key_version <> 'v1' OR (student_key IS NOT NULL AND student_key !~ '^[0-9a-f]{64}$')`)) === 0);
    comprobar('HMAC: ninguna student_key coincide con una teacher_key (prefijo de propósito)', (await n(`SELECT count(*)::int AS n FROM historico.practicas a JOIN historico.practicas b ON a.student_key = b.teacher_key`)) === 0);
    // Organizaciones derivadas, sin mapping automático.
    const orgs = await n(`SELECT count(*)::int AS n FROM historico.organizaciones`);
    comprobar(`organizaciones derivadas de lo vigente (${orgs}), con alias seudónimos y SIN correspondencias automáticas`,
      orgs > 0 && (await n(`SELECT count(*)::int AS n FROM historico.organizacion_alias`)) > 0 && (await n(`SELECT count(*)::int AS n FROM historico.organizacion_mapping`)) === 0);
    comprobar('organización con varios alias marcada en el CATÁLOGO (MULTIPLE_ALIASES)', (await n(`SELECT count(*)::int AS n FROM historico.organizaciones WHERE alias_count > 1 AND 'MULTIPLE_ALIASES' = ANY(quality_flags)`)) >= 1);
    comprobar('nombre compartido por varios NIT marcado en el catálogo (ALIAS_SHARED_ACROSS_IDENTIFIERS)', (await n(`SELECT count(*)::int AS n FROM historico.organizaciones WHERE 'ALIAS_SHARED_ACROSS_IDENTIFIERS' = ANY(quality_flags)`)) >= 2);
    comprobar('catálogo: sin correspondencia → MAPPING_PENDING y mapping_status sin_correspondencia', (await n(`SELECT count(*)::int AS n FROM historico.organizaciones WHERE mapping_status <> 'sin_correspondencia' OR NOT ('MAPPING_PENDING' = ANY(quality_flags))`)) === 0);
    // Propuesta SEGURA de correspondencias: NIT exacto + DV compatible + candidato único; nunca confirmada; no toca public.
    const simulada = await repo().proponerCorrespondencias(SISTEMA, false);
    comprobar(`propuesta (simulacro): ${simulada.conCandidatoUnico} con candidato único, 0 escritas`, simulada.conCandidatoUnico === 1 && simulada.propuestasCreadas === 0
      && (await n(`SELECT count(*)::int AS n FROM historico.organizacion_mapping`)) === 0);
    const propuesta = await repo().proponerCorrespondencias(SISTEMA, true);
    comprobar('propuesta aplicada: 1 «propuesta» por nit_exacto (la de DV incompatible no)', propuesta.propuestasCreadas === 1
      && (await n(`SELECT count(*)::int AS n FROM historico.organizacion_mapping WHERE status = 'propuesta' AND method = 'nit_exacto'`)) === 1
      && (await n(`SELECT count(*)::int AS n FROM historico.organizacion_mapping WHERE status = 'confirmada'`)) === 0
      && (await n(`SELECT count(*)::int AS n FROM historico.organizaciones WHERE mapping_status = 'propuesta'`)) === 1);
    comprobar('una segunda propuesta no duplica', (await repo().proponerCorrespondencias(SISTEMA, true)).propuestasCreadas === 0);
    comprobar('persona natural: sin NIT en claro', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE organization_identifier_kind = 'persona_natural' AND nit_juridica IS NOT NULL`)) === 0
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE organization_identifier_kind = 'persona_natural'`)) === 1);
    // PII: ningún centinela, documento ni cédula en NINGUNA columna de NINGUNA tabla del esquema.
    const volcado = (await ds.query(`SELECT string_agg(t, E'\\n') AS t FROM (
      SELECT to_jsonb(x)::text AS t FROM historico.practicas x UNION ALL SELECT to_jsonb(x)::text FROM historico.importaciones x
      UNION ALL SELECT to_jsonb(x)::text FROM historico.organizaciones x UNION ALL SELECT to_jsonb(x)::text FROM historico.organizacion_alias x) s`))[0].t as string;
    const filtrados = CENTINELAS.filter((c) => volcado.includes(c));
    comprobar('ningún valor centinela personal en el esquema historico', filtrados.length === 0, filtrados.join(','));
    comprobar('ningún documento sintético de estudiante ni cédula de persona natural en el esquema', !/9100000\d{3}/.test(volcado) && !/1099000001/.test(volcado) && !/92000\d{3}/.test(volcado));

    // ── 4. Idempotencia ───────────────────────────────────────────────────
    console.log('\n4. Idempotencia');
    const antes = await escrituras();
    const a1bis = await importar(v1, 'apply');
    comprobar('mismo archivo otra vez → ALREADY_IMPORTED', a1bis.resultado === 'ALREADY_IMPORTED' && a1bis.importacionId === imp1);
    comprobar('… y 0 registros escritos (ni una importación nueva)', (await escrituras()) === antes);
    const dry2 = await importar(v1, 'dry-run');
    comprobar('simulacro del mismo archivo contra lo vigente: 0 nuevas, 0 versionadas, 250 sin cambios', dry2.nuevos === 0 && dry2.versionados === 0 && dry2.sinCambios === 250);

    // ── 5. Versionado (v2) ────────────────────────────────────────────────
    console.log('\n5. Versionado');
    const v1Antes = (await ds.query(`SELECT md5(string_agg((to_jsonb(p) - 'is_current')::text, '|' ORDER BY id)) AS h FROM historico.practicas p WHERE importacion_id = $1`, [imp1]))[0].h;
    const a2 = await importar(v2, 'apply');
    const esperadoVersionados = FIXTURE.v2.modificados.length + 1;
    comprobar(`APPLY v2: ${a2.nuevos} nuevas, ${a2.versionados} versionadas, ${a2.sinCambios} sin cambios, ${a2.ausentes} ausentes`,
      a2.resultado === 'COMPLETED' && a2.nuevos === FIXTURE.v2.nuevos && a2.versionados === esperadoVersionados
      && a2.ausentes === FIXTURE.v2.retirados.length && a2.sinCambios === 250 - FIXTURE.v2.retirados.length - esperadoVersionados);
    const imp2 = a2.importacionId!;
    const idMod = String(FIXTURE.v2.modificados[0]);
    const versiones = await ds.query(`SELECT version, is_current, importacion_id FROM historico.practicas WHERE source_record_id = $1 ORDER BY version`, [idMod]) as { version: number; is_current: boolean; importacion_id: string }[];
    comprobar('registro modificado: v1 no vigente (de la importación 1) y v2 vigente (de la 2)',
      versiones.length === 2 && !versiones[0].is_current && versiones[0].importacion_id === imp1 && versiones[1].is_current && versiones[1].version === 2 && versiones[1].importacion_id === imp2);
    comprobar('cambio de documento (identidad) también versiona', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_record_id = $1`, [String(FIXTURE.v2.documentoCambiado)])) === 2);
    comprobar('historia intacta: el contenido de las versiones v1 no cambió', (await ds.query(`SELECT md5(string_agg((to_jsonb(p) - 'is_current')::text, '|' ORDER BY id)) AS h FROM historico.practicas p WHERE importacion_id = $1`, [imp1]))[0].h === v1Antes);
    comprobar('registros ausentes en v2 se conservan vigentes (no se borran)', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_record_id = $1 AND is_current`, [String(FIXTURE.v2.retirados[0])])) === 1);
    comprobar('una sola versión vigente por registro', (await n(`SELECT count(*)::int AS n FROM (SELECT source_record_id FROM historico.practicas WHERE is_current GROUP BY 1 HAVING count(*) > 1) d`)) === 0);

    // ── 6. Restricciones e inmutabilidad en el motor ──────────────────────
    console.log('\n6. Motor');
    await rechaza('índice único parcial: una segunda versión vigente es imposible', () => ds!.query(
      `INSERT INTO historico.practicas SELECT (jsonb_populate_record(NULL::historico.practicas, to_jsonb(p) || jsonb_build_object('id', gen_random_uuid(), 'version', 99))).* FROM historico.practicas p WHERE source_record_id = $1 AND is_current`, [idMod]), /ux_hprac_vigente|duplicad|duplicate/i);
    await rechaza('una versión es inmutable (UPDATE de contenido)', () => ds!.query(`UPDATE historico.practicas SET bitacora_count = 1 WHERE source_record_id = $1`, [idMod]), /inmutable/);
    await rechaza('una versión no se borra fuera de una reversión', () => ds!.query(`DELETE FROM historico.practicas WHERE source_record_id = $1`, [idMod]), /revirtiendo su importación/);
    await rechaza('una importación no se borra', () => ds!.query(`DELETE FROM historico.importaciones WHERE id = $1`, [imp1]), /no se borra/);
    await rechaza('estado de importación desconocido («invalid») rechazado', () => ds!.query(`UPDATE historico.importaciones SET status = 'invalid' WHERE id = $1`, [imp1]), /ck_himp_status/);
    await rechaza('mapping por nombre: rechazado', async () => {
      const [o] = await ds!.query(`SELECT id FROM historico.organizaciones LIMIT 1`);
      await ds!.query(`INSERT INTO historico.organizacion_mapping (id, organizacion_id, method, status) VALUES ($1, $2, 'nombre', 'propuesta')`, [randomUUID(), o.id]);
    }, /ck_hmap_method/);
    await rechaza('mapping confirmado sin revisor: rechazado', async () => {
      const [o] = await ds!.query(`SELECT id FROM historico.organizaciones LIMIT 1`);
      await ds!.query(`INSERT INTO historico.organizacion_mapping (id, organizacion_id, empresa_id, method, status) VALUES ($1, $2, $3, 'nit_exacto', 'confirmada')`, [randomUUID(), o.id, randomUUID()]);
    }, /ck_hmap_revision/);

    // ── 7. Concurrencia (bloqueo consultivo) ──────────────────────────────
    console.log('\n7. Concurrencia');
    const v3 = join(dir, 'v3.xlsx');
    await escribirFixtureSgp(v3, 3); // archivo nuevo (otro SHA-256): llega hasta pedir el bloqueo
    const ocupante = ds.createQueryRunner();
    await ocupante.connect();
    await ocupante.startTransaction();
    await ocupante.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [0x48495354, SISTEMA]);
    const escritasAntesBloqueo = await n(`SELECT count(*)::int AS n FROM historico.practicas`);
    await rechaza('APPLY con otra importación en curso (bloqueo tomado) → IMPORT_IN_PROGRESS', () => importar(v3, 'apply'), /IMPORT_IN_PROGRESS/);
    comprobar('… y nada se escribió mientras otro tenía el bloqueo', (await n(`SELECT count(*)::int AS n FROM historico.practicas`)) === escritasAntesBloqueo
      && (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE status = 'processing'`)) === 0);
    await ocupante.rollbackTransaction();
    await ocupante.release();

    // ── 8. Atomicidad: un fallo a mitad no deja nada ──────────────────────
    console.log('\n8. Atomicidad');
    const revertidaParaAtomicidad = await new RevertirImportacionHistoricoUseCase(repo()).ejecutar(imp2);
    comprobar(`reversión previa de v2 para el ensayo (${revertidaParaAtomicidad.versionesRetiradas} versiones)`, revertidaParaAtomicidad.versionesRetiradas === FIXTURE.v2.nuevos + esperadoVersionados);
    const totalAntesFallo = await n(`SELECT count(*)::int AS n FROM historico.practicas`);
    const vigentesAntesFallo = (await ds.query(`SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS h FROM historico.practicas WHERE is_current`))[0].h;
    await rechaza('APPLY con fallo después del primer lote → error', () => importar(v2, 'apply', { r: repo({ tamanoLote: 5, fallarTrasLotes: 1 }) }), /Fallo simulado/);
    comprobar('… cero versiones nuevas y vigentes intactas (rollback completo)', (await n(`SELECT count(*)::int AS n FROM historico.practicas`)) === totalAntesFallo
      && (await ds.query(`SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS h FROM historico.practicas WHERE is_current`))[0].h === vigentesAntesFallo);
    comprobar('… y queda constancia «failed» sin datos personales', (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE status = 'failed' AND metadata->>'error' LIKE '%Fallo simulado%'`)) === 1);
    // Una «processing» huérfana (proceso caído) se cierra como failed en el siguiente APPLY, que sí corre.
    await ds.query(`INSERT INTO historico.importaciones (id, source_system, file_name, file_sha256, hmac_key_version, importer_version, status)
      VALUES ($1, $2, 'huerfana.xlsx', $3, 'v1', 'x', 'processing')`, [randomUUID(), SISTEMA, 'a'.repeat(64)]);
    const a2b = await importar(v2, 'apply');
    comprobar('APPLY tras una «processing» huérfana: completa y la huérfana queda failed', a2b.resultado === 'COMPLETED'
      && (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE file_name = 'huerfana.xlsx' AND status = 'failed'`)) === 1);

    // ── 8b. Lotes: fallo en el lote 8, nada vigente, failed y purga ───────
    console.log('\n8b. Carga por lotes');
    const revertirB = new RevertirImportacionHistoricoUseCase(repo());
    await revertirB.ejecutar(a2b.importacionId!);
    const vigentesAntesLotes = (await ds.query(`SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS h FROM historico.practicas WHERE is_current`))[0].h;
    await rechaza('lotes de 2: falla al confirmar el lote 8', () => importar(v2, 'apply', { r: repo({ tamanoLote: 2, fallarTrasLotes: 7 }) }), /lote 8/);
    comprobar('… la importación queda «failed» (nunca completed) y sus versiones se purgaron',
      (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE status = 'failed' AND load_mode = 'batched' AND metadata->>'error' LIKE '%lote 8%'`)) === 1
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id WHERE i.status = 'failed'`)) === 0);
    comprobar('… y las vigentes no cambiaron', (await ds.query(`SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS h FROM historico.practicas WHERE is_current`))[0].h === vigentesAntesLotes);
    // Proceso «caído» antes de purgar: quedan versiones NO vigentes de una importación failed; no son visibles y el
    // siguiente APPLY las purga antes de numerar versiones.
    await rechaza('lotes sin purga (proceso caído): falla tras 3 lotes', () => importar(v2, 'apply', { r: repo({ tamanoLote: 2, fallarTrasLotes: 3, omitirPurgaAlFallar: true }) }), /lote 4/);
    const huerfanas = await n(`SELECT count(*)::int AS n FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id WHERE i.status = 'failed'`);
    comprobar(`… quedan ${huerfanas} versiones de la importación failed, todas NO vigentes`, huerfanas === 6
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id WHERE i.status = 'failed' AND p.is_current`)) === 0);
    const a2c = await importar(v2, 'apply', { modoCarga: 'single' });
    comprobar('el siguiente APPLY (modo single) purga las huérfanas y completa', a2c.resultado === 'COMPLETED' && a2c.versionados === esperadoVersionados
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id WHERE i.status = 'failed'`)) === 0
      && (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE id = $1 AND load_mode = 'single'`, [a2c.importacionId])) === 1);

    // ── 9. Reversión ──────────────────────────────────────────────────────
    console.log('\n9. Reversión');
    const revertir = new RevertirImportacionHistoricoUseCase(repo());
    await rechaza('LIFO: no se revierte v1 con una importación posterior completada', () => revertir.ejecutar(imp1), /posteriores/);
    await rechaza('identificador que no es UUID → rechazado (no hay borrado por source_record_id)', () => revertir.ejecutar('9000010'), /UUID/);
    const r2 = await revertir.ejecutar(a2c.importacionId!);
    comprobar(`revertir v2: ${r2.versionesRetiradas} retiradas, ${r2.vigentesRestituidas} restituidas`, r2.versionesRetiradas === FIXTURE.v2.nuevos + esperadoVersionados && r2.vigentesRestituidas === esperadoVersionados);
    comprobar('tras revertir v2: la versión 1 vuelve a ser la vigente', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE source_record_id = $1 AND is_current AND version = 1`, [idMod])) === 1);
    comprobar('tras revertir v2: los nuevos de v2 desaparecen; v1 queda con sus 250 vigentes', (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE is_current`)) === 250
      && (await n(`SELECT count(*)::int AS n FROM historico.practicas WHERE importacion_id = $1`, [imp1])) === 250);
    comprobar('la importación revertida queda «reverted» con fecha', (await n(`SELECT count(*)::int AS n FROM historico.importaciones WHERE id = $1 AND status = 'reverted' AND reverted_at IS NOT NULL`, [a2c.importacionId])) === 1);
    await rechaza('revertir dos veces → rechazado', () => revertir.ejecutar(a2c.importacionId!), /solo se revierte una «completed»/);
    comprobar('la organización con correspondencia propuesta se conserva tras revertir', (await n(`SELECT count(*)::int AS n FROM historico.organizaciones WHERE mapping_status = 'propuesta'`)) === 1);
    comprobar('organizaciones recalculadas tras revertir (sin huérfanas)', (await n(`SELECT count(*)::int AS n FROM historico.organizaciones WHERE record_count = 0`)) === 0);

    // ── 10. Versión de clave distinta: no se mezcla ───────────────────────
    console.log('\n10. Versión de clave');
    await rechaza('APPLY con otra versión de clave sobre lo vigente → rechazado (rotación no implementada)', () => importar(v2, 'apply', { s: seudV2 }), /versión de clave/);

    // ── 11. La operación no cambió ────────────────────────────────────────
    console.log('\n11. Operación');
    comprobar(`tablas operativas idénticas (${operativas.join(', ')})`, (await huellaOperativa()) === operacionAntes);

    // ── 12. Salida sin datos personales ───────────────────────────────────
    const texto = salida.join('\n');
    const enSalida = CENTINELAS.filter((c) => texto.includes(c));
    comprobar(`la salida del importador (${salida.length} líneas) no contiene centinelas, documentos ni cédulas`, enSalida.length === 0 && !/9100000\d{3}|1099000001/.test(texto), enSalida.join(','));
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
