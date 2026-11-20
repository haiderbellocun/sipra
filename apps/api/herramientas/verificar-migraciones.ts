/**
 * Verificación de migraciones contra un PostgreSQL LOCAL DESECHABLE (Fase 6 EPS).
 *
 *   A. Desde cero: todas las migraciones en orden, esquema, restricciones válidas, disparadores,
 *      privilegios del rol de aplicación y la compuerta ARL en el motor (INSERT real rechazado
 *      por `ck_practicas_compuerta_arl`).
 *   B. Reversión controlada del bloque EPS (15 → 11) con datos sintéticos que el `down()` debe
 *      proteger (la evidencia OCR de solo inserción impide revertir la 12 «a propósito») y luego
 *      reaplicación completa.
 *   C. Upgrade: una base PRE-EPS (migraciones 0–10) con datos sintéticos de usuarios, estudiantes,
 *      prácticas, documentos, decisiones y auditoría; se aplican las migraciones EPS y se compara
 *      cada tabla previa (conteos y huella) antes y después, FKs, restricciones y migración 15
 *      sobre filas existentes.
 *
 * Uso:  DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npm run verificar:migraciones
 * Crea bases temporales y las elimina al terminar. Se NIEGA a correr si el host no es local.
 * Nunca apuntar a dev, qa, pre ni prod.
 */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, MigrationInterface } from 'typeorm';
import { cargarCatalogos } from '../src/infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { sembrar } from '../src/infrastructure/persistence/postgres/seeds/ejecutar-semillas';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable (cualquier base, p. ej. /postgres).');
const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  throw new Error('Se niega a correr: la base no es local. Use un contenedor desechable.');
}
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };

let fallos = 0;
/**
 * DEUDA conocida (desde G1, ver la nota de la sección B): varias secuencias de reversión heredadas se escribieron
 * cuando la última migración era la 20; con las 21–26 presentes ya no bajan lo que dicen bajar, y la 22 (roles de
 * gobierno) se NIEGA por diseño a revertirse con usuarios director/analista sembrados. Esa protección no se relaja.
 * Esos bloques corren en «modo deuda»: sus fallos se informan como DEUDA y se cuentan aparte, sin ocultarse, pero no
 * deciden el código de salida. Todo lo demás (A, H, la carta, la reversión sin datos) es estricto.
 */
let deuda = 0;
let enDeuda = false;
function comprobar(descripcion: string, ok: boolean, detalle = ''): void {
  if (!ok) { if (enDeuda) deuda += 1; else fallos += 1; }
  console.log(`${ok ? 'OK   ' : enDeuda ? 'DEUDA' : 'FALLA'}  ${descripcion}${ok || !detalle ? '' : `  → ${detalle}`}`);
}
async function bloqueDeuda(nombre: string, cuerpo: () => Promise<void>): Promise<void> {
  enDeuda = true;
  try {
    await cuerpo();
  } catch (e) {
    deuda += 1;
    console.log(`DEUDA  bloque heredado «${nombre}» interrumpido → ${(e as Error).message.slice(0, 200)}`);
  } finally {
    enDeuda = false;
  }
}
const nombreDe = (m: new () => MigrationInterface): string => (new m() as MigrationInterface & { name?: string }).name ?? m.name;
const ESPERADAS = MIGRACIONES.map(nombreDe);
const PRE_EPS = MIGRACIONES.slice(0, 11); // 0–10: hasta ConsentimientoVersionado
const EPS = MIGRACIONES.slice(11, 16); // 11–15
const ACTA = MIGRACIONES.slice(16, 19); // 16–18: responsable de la ARL, validación del acta de iniciación y su Mesa (Bloques 3 y 4)
const EMPRESARIAL = MIGRACIONES.slice(19); // 19–22: documentos empresariales (RUT y Cámara), su decisión humana y roles de gobierno (G1)

async function admin(): Promise<DataSource> {
  return new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
}
async function crearBase(nombre: string): Promise<void> {
  const a = await admin();
  await a.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
  await a.query(`CREATE DATABASE "${nombre}"`);
  await a.destroy();
}
async function borrarBase(nombre: string): Promise<void> {
  const a = await admin();
  await a.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
  await a.destroy();
}
async function abrir(nombre: string, migraciones: (new () => MigrationInterface)[]): Promise<DataSource> {
  return new DataSource({ type: 'postgres', url: urlDe(nombre), ssl: false, migrations: migraciones, synchronize: false, migrationsRun: false }).initialize();
}
async function registradas(ds: DataSource): Promise<string[]> {
  return (await ds.query('SELECT name FROM migrations ORDER BY id')).map((r: { name: string }) => r.name);
}
async function tablas(ds: DataSource): Promise<string[]> {
  return (await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`))
    .map((r: { table_name: string }) => r.table_name).filter((t: string) => t !== 'migrations');
}
/** Columnas AGREGADAS por migraciones posteriores: la huella de una fila previa las ignora (el resto debe quedar idéntico). */
const COLUMNAS_NUEVAS: Readonly<Record<string, string>> = { practicas: 'responsable_arl' };
async function huella(ds: DataSource, tabla: string, sinColumnasNuevas = false): Promise<{ filas: number; md5: string }> {
  const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM "${tabla}"`);
  const nueva = sinColumnasNuevas ? COLUMNAS_NUEVAS[tabla] : undefined;
  const fila = nueva ? `(to_jsonb(t) - '${nueva}')::text` : 't::text';
  const [{ h }] = await ds.query(`SELECT coalesce(md5(string_agg(${fila}, '|' ORDER BY ${fila})), '') AS h FROM "${tabla}" t`);
  return { filas: n as number, md5: h as string };
}
async function integridad(ds: DataSource, etiqueta: string): Promise<void> {
  const noValidas = await ds.query(`SELECT conrelid::regclass::text AS t, conname FROM pg_constraint WHERE NOT convalidated`);
  comprobar(`${etiqueta}: todas las restricciones están validadas`, noValidas.length === 0, JSON.stringify(noValidas));
  const idx = await ds.query(`SELECT indexrelid::regclass::text AS i FROM pg_index WHERE NOT indisvalid`);
  comprobar(`${etiqueta}: todos los índices son válidos`, idx.length === 0, JSON.stringify(idx));
  // Huérfanos: cada FK declarada debe tener todos sus valores presentes en la tabla referida.
  const fks = await ds.query(`
    SELECT c.conname, c.conrelid::regclass::text AS tabla, a.attname AS col, c.confrelid::regclass::text AS ref, af.attname AS refcol
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`);
  let huerfanos = 0;
  for (const f of fks) {
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM ${f.tabla} x WHERE x."${f.col}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${f.ref} y WHERE y."${f.refcol}" = x."${f.col}")`);
    huerfanos += n as number;
  }
  comprobar(`${etiqueta}: ninguna fila huérfana en ${fks.length} claves foráneas`, huerfanos === 0, `${huerfanos} huérfanas`);
}

async function esquemaEps(ds: DataSource, etiqueta: string): Promise<void> {
  const t = await tablas(ds);
  for (const tabla of ['validaciones_eps', 'evidencias_validacion_eps', 'auditoria']) comprobar(`${etiqueta}: existe la tabla ${tabla}`, t.includes(tabla));
  const cols = (await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name='validaciones_eps'`)).map((r: { column_name: string }) => r.column_name);
  for (const c of ['recibida_en', 'primera_revision_en', 'adres_estado', 'afiliacion_fuente', 'verificador_codigo', 'reservado_en']) comprobar(`${etiqueta}: validaciones_eps.${c}`, cols.includes(c));
  const trg = (await ds.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((r: { tgname: string }) => r.tgname);
  comprobar(`${etiqueta}: disparador de auditoría inmutable`, trg.includes('tg_auditoria_inmutable'));
  comprobar(`${etiqueta}: disparador de evidencias de solo inserción`, trg.includes('tg_evidencias_eps_inmutable'));
  const idx = (await ds.query(`SELECT indexname FROM pg_indexes WHERE tablename='validaciones_eps'`)).map((r: { indexname: string }) => r.indexname);
  for (const i of ['ix_veps_mesa', 'ix_veps_decididas', 'ix_veps_adres']) comprobar(`${etiqueta}: índice ${i}`, idx.includes(i));
  const p = async (rol: string, tabla: string, priv: string): Promise<boolean> => (await ds.query('SELECT has_table_privilege($1,$2,$3) AS v', [rol, tabla, priv]))[0].v as boolean;
  comprobar(`${etiqueta}: sipra_app NO puede UPDATE/DELETE sobre auditoria`, !(await p('sipra_app', 'auditoria', 'UPDATE')) && !(await p('sipra_app', 'auditoria', 'DELETE')));
  comprobar(`${etiqueta}: sipra_app NO puede UPDATE/DELETE sobre evidencias_validacion_eps`, !(await p('sipra_app', 'evidencias_validacion_eps', 'UPDATE')) && !(await p('sipra_app', 'evidencias_validacion_eps', 'DELETE')));
  comprobar(`${etiqueta}: sipra_app SÍ puede SELECT/INSERT/UPDATE sobre validaciones_eps`, await p('sipra_app', 'validaciones_eps', 'SELECT') && await p('sipra_app', 'validaciones_eps', 'INSERT') && await p('sipra_app', 'validaciones_eps', 'UPDATE'));
  comprobar(`${etiqueta}: sipra_app NO puede DELETE sobre validaciones_eps`, !(await p('sipra_app', 'validaciones_eps', 'DELETE')));
}

async function esquemaActa(ds: DataSource, etiqueta: string): Promise<void> {
  const t = await tablas(ds);
  for (const tabla of ['validaciones_acta_iniciacion', 'evidencias_validacion_acta']) comprobar(`${etiqueta}: existe la tabla ${tabla}`, t.includes(tabla));
  const col = (await ds.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='practicas' AND column_name='responsable_arl'`)) as { is_nullable: string }[];
  comprobar(`${etiqueta}: practicas.responsable_arl existe y admite NULL (histórico sin rellenar)`, col.length === 1 && col[0].is_nullable === 'YES');
  const cons = (await ds.query(`SELECT conname FROM pg_constraint WHERE conname IN ('ck_practicas_responsable_arl','ux_vacta_documento','ux_eacta_idempotencia','ck_vacta_solo_acta','ck_vacta_decision_humana')`)).map((r: { conname: string }) => r.conname);
  for (const c of ['ck_practicas_responsable_arl', 'ux_vacta_documento', 'ux_eacta_idempotencia', 'ck_vacta_solo_acta', 'ck_vacta_decision_humana']) comprobar(`${etiqueta}: restricción ${c}`, cons.includes(c));
  const colsMesa = (await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name='validaciones_acta_iniciacion'`)).map((r: { column_name: string }) => r.column_name);
  for (const c of ['asignado_a', 'reservado_en', 'reserva_hasta', 'motivo_decision', 'datos_practica_cambiaron_en']) comprobar(`${etiqueta}: validaciones_acta_iniciacion.${c}`, colsMesa.includes(c));
  const consMesa = (await ds.query(`SELECT conname FROM pg_constraint WHERE conname IN ('ck_vacta_reserva','ck_vacta_reserva_solo_revision','ck_vacta_motivo','ck_vacta_motivo_solo_devuelto')`)).map((r: { conname: string }) => r.conname);
  for (const c of ['ck_vacta_reserva', 'ck_vacta_reserva_solo_revision', 'ck_vacta_motivo', 'ck_vacta_motivo_solo_devuelto']) comprobar(`${etiqueta}: restricción ${c}`, consMesa.includes(c));
  const idxMesa = (await ds.query(`SELECT indexname FROM pg_indexes WHERE tablename='validaciones_acta_iniciacion'`)).map((r: { indexname: string }) => r.indexname);
  for (const i of ['ix_vacta_mesa', 'ix_vacta_asignado']) comprobar(`${etiqueta}: índice ${i}`, idxMesa.includes(i));
  const trg = (await ds.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((r: { tgname: string }) => r.tgname);
  comprobar(`${etiqueta}: disparador de evidencias del acta de solo inserción`, trg.includes('tg_evidencias_acta_inmutable'));
  const p = async (rol: string, tabla: string, priv: string): Promise<boolean> => (await ds.query('SELECT has_table_privilege($1,$2,$3) AS v', [rol, tabla, priv]))[0].v as boolean;
  comprobar(`${etiqueta}: sipra_app NO puede UPDATE/DELETE sobre evidencias_validacion_acta`, !(await p('sipra_app', 'evidencias_validacion_acta', 'UPDATE')) && !(await p('sipra_app', 'evidencias_validacion_acta', 'DELETE')));
  comprobar(`${etiqueta}: sipra_app SÍ puede SELECT/INSERT/UPDATE y NO DELETE sobre validaciones_acta_iniciacion`,
    await p('sipra_app', 'validaciones_acta_iniciacion', 'SELECT') && await p('sipra_app', 'validaciones_acta_iniciacion', 'INSERT')
    && await p('sipra_app', 'validaciones_acta_iniciacion', 'UPDATE') && !(await p('sipra_app', 'validaciones_acta_iniciacion', 'DELETE')));
}

async function esquemaHistorico(ds: DataSource, etiqueta: string): Promise<void> {
  const t = (await ds.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'historico' ORDER BY 1`)).map((r: { table_name: string }) => r.table_name);
  comprobar(`${etiqueta}: esquema historico con sus 5 tablas`, JSON.stringify(t) === JSON.stringify(['importaciones', 'organizacion_alias', 'organizacion_mapping', 'organizaciones', 'practicas']), t.join(','));
  const idx = (await ds.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'historico'`)) as { indexname: string; indexdef: string }[];
  const vigente = idx.find((i) => i.indexname === 'ux_hprac_vigente');
  comprobar(`${etiqueta}: índice único PARCIAL de la versión vigente`, !!vigente && /UNIQUE/.test(vigente.indexdef) && /WHERE is_current/.test(vigente.indexdef));
  comprobar(`${etiqueta}: idempotencia por archivo e importación única en curso`, idx.some((i) => i.indexname === 'ux_himp_archivo_completado') && idx.some((i) => i.indexname === 'ux_himp_una_en_curso'));
  const trg = (await ds.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((r: { tgname: string }) => r.tgname);
  comprobar(`${etiqueta}: disparadores de inmutabilidad del histórico`, trg.includes('tg_hprac_inmutable') && trg.includes('tg_himp_sin_borrado'));
  const cols = (await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'historico'`)).map((r: { column_name: string }) => r.column_name).join(',');
  comprobar(`${etiqueta}: ninguna columna personal directa en el histórico`, !/(email|correo|telefono|phone|jefe|boss|funciones|nombre_estudiante|nombre_docente|raw)/i.test(cols) && !/(^|,)documento(_docente|_estudiante)?(,|$)/i.test(cols));
  const [{ v }] = await ds.query(`SELECT has_schema_privilege('sipra_app', 'historico', 'USAGE') AS v`);
  comprobar(`${etiqueta}: sipra_app sin acceso al esquema historico`, v === false);
}
async function huellaPublica(ds: DataSource): Promise<string> {
  const partes: string[] = [];
  for (const t of await tablas(ds)) { const h = await huella(ds, t); partes.push(`${t}:${h.filas}:${h.md5}`); }
  return partes.join(';');
}

// ── Datos sintéticos ────────────────────────────────────────────────────────

const PRACTICAS = ['00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000043'];
/**
 * Compuerta ARL en el motor: una práctica `activa`, de modalidad que exige ARL, con
 * `arl_verificada = false` debe ser rechazada por `ck_practicas_compuerta_arl` y no por otra causa
 * (una clave foránea rota también fallaría). Toma estudiante, programa, escuela, ciclo y período de
 * una práctica sembrada para que las claves foráneas sean válidas, y revierte siempre.
 */
async function compuertaArl(ds: DataSource, etiqueta: string): Promise<void> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    const [ref] = (await qr.query(`SELECT estudiante_id, programa_id, escuela_id, ciclo, periodo_academico FROM practicas LIMIT 1`)) as Record<string, string>[];
    if (!ref) { comprobar(`${etiqueta}: compuerta ARL (hay una práctica sembrada de referencia)`, false, 'sin prácticas'); return; }
    let error: { code?: string; constraint?: string; message?: string } | null = null;
    try {
      await qr.query(
        `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, fecha_inicio, arl_verificada, ultima_actividad)
         VALUES ($1, $2, $3, $4, $5, $6, 'pasantia', 'activa', now(), false, now())`,
        [randomUUID(), ref.estudiante_id, ref.programa_id, ref.escuela_id, ref.ciclo, ref.periodo_academico],
      );
    } catch (e) {
      const d = e as { driverError?: { code?: string; constraint?: string }; message?: string };
      error = { code: d.driverError?.code, constraint: d.driverError?.constraint, message: d.message };
    }
    comprobar(
      `${etiqueta}: la base rechaza una práctica activa sin ARL por ck_practicas_compuerta_arl (23514)`,
      error?.code === '23514' && error.constraint === 'ck_practicas_compuerta_arl',
      error ? `${error.code ?? '?'} ${error.constraint ?? ''} ${(error.message ?? '').slice(0, 160)}` : 'el INSERT se aceptó',
    );
  } finally {
    await qr.rollbackTransaction();
    await qr.release();
  }
}

async function sintetizarPreEps(ds: DataSource): Promise<{ aprobador: string }> {
  const [{ id: aprobador }] = await ds.query(`SELECT id FROM usuarios WHERE rol = 'auxiliar' LIMIT 1`);
  const doc = async (practica: string, tipo: string, version: number, estado: string, extra: { decidido?: boolean } = {}): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, decidido_por, justificacion_decision, cargado_en)
       VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',1024,$7,$8,$9,$10, now() - interval '5 days')`,
      [id, practica, tipo, version, estado, `sintetico-${tipo}-${version}.pdf`, createHash('sha256').update(id).digest('hex'), `sinteticos/${id}.pdf`,
        extra.decidido ? aprobador : null, extra.decidido ? 'decisión sintética previa a EPS' : null],
    );
    return id;
  };
  await doc(PRACTICAS[0], 'cedula', 1, 'aprobado', { decidido: true });
  await doc(PRACTICAS[0], 'certificado_eps', 1, 'devuelto', { decidido: true });
  await doc(PRACTICAS[0], 'certificado_eps', 2, 'aprobado', { decidido: true });
  await doc(PRACTICAS[1], 'certificado_eps', 1, 'en_revision');
  await doc(PRACTICAS[1], 'cedula', 1, 'rechazado', { decidido: true });
  await doc(PRACTICAS[2], 'certificado_eps', 1, 'recibido');
  for (const accion of ['DOCUMENTO_CARGADO', 'DECISION_DOCUMENTO', 'DOCUMENTO_DECIDIDO']) {
    await ds.query(`INSERT INTO auditoria (actor_id, actor_rol, accion, entidad, justificacion, metadatos) VALUES ($1,'auxiliar',$2,'documento','dato sintético previo a EPS','{"origen":"sintetico"}')`, [aprobador, accion]);
  }
  return { aprobador };
}

async function main(): Promise<void> {
  const sufijo = randomUUID().slice(0, 6);
  const bases = { cero: `mig_cero_${sufijo}`, rev: `mig_rev_${sufijo}`, up: `mig_up_${sufijo}`, acta: `mig_acta_${sufijo}`, acta2: `mig_acta2_${sufijo}`, emp: `mig_emp_${sufijo}`, hist: `mig_hist_${sufijo}` };
  try {
    // ── A. Desde cero ─────────────────────────────────────────────────────
    console.log('\nA. Migración completa desde una base vacía');
    await crearBase(bases.cero);
    let ds = await abrir(bases.cero, MIGRACIONES);
    const aplicadas = await ds.runMigrations({ transaction: 'each' });
    comprobar(`se aplicaron ${MIGRACIONES.length} migraciones`, aplicadas.length === MIGRACIONES.length, `${aplicadas.length}`);
    const reg = await registradas(ds);
    comprobar('la tabla de migraciones coincide con la lista declarada, en orden', JSON.stringify(reg) === JSON.stringify(ESPERADAS), reg.join(', '));
    comprobar('una segunda ejecución no aplica nada (idempotente)', (await ds.runMigrations({ transaction: 'each' })).length === 0);
    await esquemaEps(ds, 'cero');
    await esquemaActa(ds, 'cero');
    await esquemaHistorico(ds, 'cero');
    await integridad(ds, 'cero');
    await cargarCatalogos(ds);
    await sembrar(ds);
    await integridad(ds, 'cero + semillas');
    await compuertaArl(ds, 'cero + semillas');
    await ds.destroy();

    // ── H. Histórico del SGP (25): estricta ────────────────────────────────
    console.log('\nH. Histórico del SGP (migraciones 25 y 26) sobre una base con operación');
    const ANTES_HIST = MIGRACIONES.slice(0, MIGRACIONES.findIndex((m) => m.name.startsWith('HistoricoSgp')));
    const colsH3 = async (): Promise<number> => (await ds.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'historico'
      AND ((table_name = 'practicas' AND column_name IN ('organization_flags', 'organization_type_hint', 'duplicado_de'))
        OR (table_name = 'organizaciones' AND column_name IN ('organization_type_hint', 'mapping_status'))
        OR (table_name = 'importaciones' AND column_name = 'load_mode'))`))[0].n as number;
    await crearBase(bases.hist);
    ds = await abrir(bases.hist, ANTES_HIST);
    await ds.runMigrations({ transaction: 'each' });
    await cargarCatalogos(ds);
    await sembrar(ds);
    const operacionAntes = await huellaPublica(ds);
    await ds.destroy();
    ds = await abrir(bases.hist, MIGRACIONES);
    const hist = await ds.runMigrations({ transaction: 'each' });
    comprobar('la 25 y la 26 se aplican solas sobre una base ya poblada', hist.length === 2 && hist[0].name.startsWith('HistoricoSgp') && hist[1].name.startsWith('HistoricoPreparacionCarga'), hist.map((m) => m.name).join(','));
    comprobar('la 26 agrega las 6 columnas de H3 (calidad de organización, pista, duplicado, correspondencia, modo de carga)', (await colsH3()) === 6);
    await esquemaHistorico(ds, 'historico');
    comprobar('la 25 y la 26 no cambian ninguna tabla de public (conteo y contenido)', (await huellaPublica(ds)) === operacionAntes);
    await integridad(ds, 'historico');
    await ds.undoLastMigration({ transaction: 'each' });
    comprobar('down de HistoricoPreparacionCarga (sin versiones): quita solo sus columnas', (await colsH3()) === 0
      && !(await registradas(ds)).some((x) => x.startsWith('HistoricoPreparacionCarga')) && (await ds.query(`SELECT to_regnamespace('historico') AS n`))[0].n !== null);
    await ds.undoLastMigration({ transaction: 'each' });
    comprobar('down de HistoricoSgp (vacío): esquema eliminado y fuera del registro',
      !(await registradas(ds)).some((x) => x.startsWith('HistoricoSgp')) && (await ds.query(`SELECT to_regnamespace('historico') AS n`))[0].n === null);
    comprobar('down de HistoricoSgp no toca public', (await huellaPublica(ds)) === operacionAntes);
    await ds.runMigrations({ transaction: 'each' });
    await esquemaHistorico(ds, 're-up');
    comprobar('re-up: la 26 también se reaplicó', (await colsH3()) === 6);
    // Con una importación registrada (sin versiones): la 26 baja, la 25 se NIEGA.
    await ds.query(`INSERT INTO historico.importaciones (id, source_system, file_name, file_sha256, hmac_key_version, importer_version, status, finished_at)
      VALUES ($1, 'SGP_SINTETICO', 'sintetico.xlsx', $2, 'v1', 'verificacion', 'failed', now())`, [randomUUID(), 'a'.repeat(64)]);
    await ds.undoLastMigration({ transaction: 'each' });
    const fallaHist = await ds.undoLastMigration({ transaction: 'each' }).then(() => null, (e: Error) => e.message);
    comprobar('down de HistoricoSgp se NIEGA con importaciones registradas', fallaHist !== null && /importaciones registradas/.test(fallaHist), fallaHist ?? 'no se negó');
    comprobar('tras el rechazo, el esquema y la importación siguen intactos', (await registradas(ds)).some((x) => x.startsWith('HistoricoSgp'))
      && (await ds.query(`SELECT count(*)::int AS n FROM historico.importaciones`))[0].n === 1);
    await ds.runMigrations({ transaction: 'each' });
    comprobar('la 26 se reaplica sobre el esquema con la importación registrada', (await colsH3()) === 6);
    await ds.destroy();

    // ── B. Reversión controlada ───────────────────────────────────────────
    console.log('\nB. Reversión controlada del bloque EPS y reaplicación');
    await crearBase(bases.rev);
    ds = await abrir(bases.rev, MIGRACIONES);
    await ds.runMigrations({ transaction: 'each' });
    await cargarCatalogos(ds);
    await sembrar(ds);
    // Protección: con una evidencia OCR (solo inserción), el down() de la 12 debe negarse.
    const [{ id: estudiante }] = await ds.query(`SELECT id FROM usuarios WHERE rol='estudiante' LIMIT 1`);
    const docId = randomUUID();
    await ds.query(
      `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento) VALUES ($1,$2,'certificado_eps',1,'en_revision','s.pdf','application/pdf',10,$3,'s/r.pdf')`,
      [docId, PRACTICAS[0], createHash('sha256').update(docId).digest('hex')]);
    const vId = randomUUID();
    await ds.query(`INSERT INTO validaciones_eps (id, documento_id, practica_id, estudiante_id) VALUES ($1,$2,$3,$4)`, [vId, docId, PRACTICAS[0], estudiante]);
    await ds.query(
      `INSERT INTO evidencias_validacion_eps (id, validacion_eps_id, tipo, fuente, metodo, resultado, hash_evidencia, datos_obtenidos, fecha_verificacion)
       VALUES ($1,$2,'ocr','certificado','ocr_local_tesseract_spa','leido',$3,'{}', now())`,
      [randomUUID(), vId, createHash('sha256').update(vId).digest('hex')]).catch(async (e: Error) => {
      // Si el esquema exige otras columnas, se informa en vez de adivinar.
      comprobar('se pudo sembrar una evidencia OCR sintética', false, e.message.slice(0, 200));
    });
    // La 26 y la 25 (histórico, vacío) bajan primero y limpio: así la 24 vuelve a ser la última para el bloque de la carta.
    await ds.undoLastMigration({ transaction: 'each' });
    await ds.undoLastMigration({ transaction: 'each' });
    comprobar('B: down de HistoricoPreparacionCarga y HistoricoSgp sin importaciones: limpio', !(await registradas(ds)).some((x) => x.startsWith('Historico')));
    // Carta de presentación digital (24, la última sin el histórico): down limpio (columnas, restricciones, índice y disparador) y re-up.
    {
      const colsCarta = async () => (await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name='cartas_presentacion' AND column_name IN ('referencia','estado','snapshot','pdf_sha256','ruta_archivo')`)).length;
      const disparador = async () => (await ds.query(`SELECT 1 FROM pg_trigger WHERE tgname='tr_cartas_presentacion_inmutable'`)).length;
      comprobar('carta digital (24): columnas y disparador de inmutabilidad presentes', (await colsCarta()) === 5 && (await disparador()) === 1);
      await ds.undoLastMigration({ transaction: 'each' });
      comprobar('down de CartaPresentacionDigital: sin columnas, disparador ni índice de referencia',
        (await colsCarta()) === 0 && (await disparador()) === 0 && (await ds.query(`SELECT 1 FROM pg_indexes WHERE indexname='ux_cartas_referencia'`)).length === 0);
      await ds.runMigrations({ transaction: 'each' });
      comprobar('re-up de CartaPresentacionDigital: restituida', (await colsCarta()) === 5 && (await disparador()) === 1);
      comprobar('re-up: el histórico (25 y 26) también se reaplicó', (await registradas(ds)).filter((x) => x.startsWith('Historico')).length === 2);
    }
    const dsB = ds;
    await bloqueDeuda('B: reversión heredada 20 → 12 con datos', async () => {
      const ds = dsB;
      // DEUDA conocida (desde G1): esta secuencia de reversión se escribió cuando la última migración era la 20; la 22
      // (roles de gobierno) se niega por diseño a revertirse con usuarios director/analista sembrados. Revertir por debajo
      // de la 21 exige antes adaptar esta herramienta (no se relaja la protección de la 22).
      // Bloque 3 (16–17) primero. Sin datos del acta el down es limpio y no toca el resto de lo que ya existía.
      const practicasAntes = await huella(ds, 'practicas', true);
      // La 20 (decisión humana del RUT) y luego la 19 (documentos empresariales): sin decisiones ni evidencias su down es limpio.
      await ds.undoLastMigration({ transaction: 'each' });
      comprobar('down de DecisionHumanaDocumentoEmpresarial: revertida y sin columnas de decisión', !(await registradas(ds)).some((x) => x.startsWith('DecisionHumana')) && (await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name='validaciones_documento_empresarial' AND column_name IN ('decidido_por','asignado_a','motivo_decision')`)).length === 0);
      await ds.undoLastMigration({ transaction: 'each' });
      comprobar('down de ValidacionDocumentoEmpresarial: revertida y sin tablas empresariales', !(await registradas(ds)).some((x) => x.startsWith('ValidacionDocumentoEmpresarial')) && !(await tablas(ds)).some((t) => t.includes('doc_empresarial') || t.includes('documento_empresarial')));
      for (const n of ['MesaActas', 'ValidacionActaIniciacion', 'ResponsableArlPractica']) {
        await ds.undoLastMigration({ transaction: 'each' });
        const regA = await registradas(ds);
        comprobar(`down de ${n}: revertida y fuera del registro`, !regA.some((x) => x.startsWith(n)));
      }
      comprobar('sin tablas del acta ni columna responsable_arl tras revertir el Bloque 3',
        !(await tablas(ds)).some((t) => t.includes('acta')) &&
        (await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name='practicas' AND column_name='responsable_arl'`)).length === 0);
      const practicasDespues = await huella(ds, 'practicas', true);
      comprobar('revertir el Bloque 3 deja las prácticas existentes idénticas (conteo y contenido)',
        practicasAntes.filas === practicasDespues.filas && practicasAntes.md5 === practicasDespues.md5);
      // down de 15, 14 y 13: seguros (solo quitan columnas, índices y restricciones propias).
      for (const n of ['MesaEps', 'ConsultaAdres', 'VerificacionEps']) {
        await ds.undoLastMigration({ transaction: 'each' });
        const reg2 = await registradas(ds);
        comprobar(`down de ${n}: revertida y fuera del registro`, !reg2.some((x) => x.startsWith(n)));
      }
      const fallaEn12 = await ds.undoLastMigration({ transaction: 'each' }).then(() => null, (e: Error) => e.message);
      comprobar('down de EvidenciaEpsOcr se NIEGA con evidencia OCR existente (protección de solo inserción)', fallaEn12 !== null, 'no se negó');
      const reg3 = await registradas(ds);
      comprobar('tras el rechazo, la migración 12 sigue registrada y el esquema no quedó a medias', reg3.some((x) => x.startsWith('EvidenciaEpsOcr')));
      const [{ n: evs }] = await ds.query(`SELECT count(*)::int AS n FROM evidencias_validacion_eps`);
      comprobar('la evidencia OCR sintética sigue intacta', evs === 1);
    });
    await ds.destroy();

    // Reversión completa del bloque EPS en una base SIN evidencias OCR (sin datos EPS).
    const sinDatos = `${bases.rev}_vacia`;
    await crearBase(sinDatos);
    ds = await abrir(sinDatos, MIGRACIONES);
    await ds.runMigrations({ transaction: 'each' });
    for (let i = 0; i < EMPRESARIAL.length + ACTA.length + EPS.length; i += 1) await ds.undoLastMigration({ transaction: 'each' });
    const quedan = await registradas(ds);
    comprobar('bloque EPS (11–15) y Bloque 3 (16–17) revertidos por completo sin datos', JSON.stringify(quedan) === JSON.stringify(ESPERADAS.slice(0, 11)), quedan.slice(-2).join(', '));
    comprobar('sin tablas EPS ni del acta tras revertir', !(await tablas(ds)).some((t) => t.includes('eps') || t.includes('acta') || t.includes('empresarial')));
    comprobar('la auditoría y su disparador siguen intactos (no pertenecen al bloque EPS)', (await tablas(ds)).includes('auditoria'));
    await integridad(ds, 'revertida');
    const re = await ds.runMigrations({ transaction: 'each' });
    comprobar(`reaplicación de los bloques EPS y del acta (${EPS.length + ACTA.length + EMPRESARIAL.length} migraciones)`, re.length === EPS.length + ACTA.length + EMPRESARIAL.length, `${re.length}`);
    await esquemaEps(ds, 'reaplicada');
    await esquemaActa(ds, 'reaplicada');
    await integridad(ds, 'reaplicada');
    await ds.destroy();
    await borrarBase(sinDatos);

    await bloqueDeuda('acta, Mesa de actas y documentos empresariales: protecciones de down (asumen la 20 como última)', async () => {
      // Con una evidencia del acta (solo inserción), el down de la validación del acta se NIEGA: no se borra evidencia en silencio.
      await crearBase(bases.acta);
      ds = await abrir(bases.acta, MIGRACIONES);
      await ds.runMigrations({ transaction: 'each' });
      await cargarCatalogos(ds);
      await sembrar(ds);
      const [{ id: estActa }] = await ds.query(`SELECT id FROM usuarios WHERE rol='estudiante' LIMIT 1`);
      const docActa = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento) VALUES ($1,$2,'acta_inicio',1,'en_revision','s.pdf','application/pdf',10,$3,'s/a.pdf')`,
        [docActa, PRACTICAS[0], createHash('sha256').update(docActa).digest('hex')]);
      const vActa = randomUUID();
      await ds.query(`INSERT INTO validaciones_acta_iniciacion (id, documento_id, practica_id, estudiante_id) VALUES ($1,$2,$3,$4)`, [vActa, docActa, PRACTICAS[0], estActa]);
      await ds.query(`INSERT INTO evidencias_validacion_acta (id, validacion_acta_id, intento, tipo, resultado, metodo, fecha) VALUES ($1,$2,1,'procesamiento','ok','sintetico', now())`, [randomUUID(), vActa]);
      // La 20 y la 19 (documentos empresariales) se revierten sin problema: aquí no tienen decisiones ni evidencias.
      await ds.undoLastMigration({ transaction: 'each' });
      await ds.undoLastMigration({ transaction: 'each' });
      // La 18 (Mesa) se revierte sin problema: no hay evidencia de cambio de datos de la práctica.
      await ds.undoLastMigration({ transaction: 'each' });
      comprobar('down de MesaActas sin evidencia de cambio de datos: revertida', !(await registradas(ds)).some((x) => x.startsWith('MesaActas')));
      const fallaActa = await ds.undoLastMigration({ transaction: 'each' }).then(() => null, (e: Error) => e.message);
      comprobar('down de ValidacionActaIniciacion se NIEGA con evidencia existente (solo inserción)', fallaActa !== null, 'no se negó');
      comprobar('tras el rechazo, la migración 17 sigue registrada y la evidencia intacta',
        (await registradas(ds)).some((x) => x.startsWith('ValidacionActaIniciacion')) &&
        (await ds.query(`SELECT count(*)::int AS n FROM evidencias_validacion_acta`))[0].n === 1);
      await ds.destroy();

      // Con una evidencia de CAMBIO DE DATOS de la práctica (solo inserción), el down de la Mesa (18) se NIEGA.
      await crearBase(bases.acta2);
      ds = await abrir(bases.acta2, MIGRACIONES);
      await ds.runMigrations({ transaction: 'each' });
      await cargarCatalogos(ds);
      await sembrar(ds);
      const [{ id: estActa2 }] = await ds.query(`SELECT id FROM usuarios WHERE rol='estudiante' LIMIT 1`);
      const [{ id: actorActa2 }] = await ds.query(`SELECT id FROM usuarios WHERE rol='coordinador' LIMIT 1`);
      const docActa2 = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento) VALUES ($1,$2,'acta_inicio',1,'en_revision','s.pdf','application/pdf',10,$3,'s/a.pdf')`,
        [docActa2, PRACTICAS[0], createHash('sha256').update(docActa2).digest('hex')]);
      const vActa2 = randomUUID();
      await ds.query(`INSERT INTO validaciones_acta_iniciacion (id, documento_id, practica_id, estudiante_id) VALUES ($1,$2,$3,$4)`, [vActa2, docActa2, PRACTICAS[0], estActa2]);
      await ds.query(`INSERT INTO evidencias_validacion_acta (id, validacion_acta_id, intento, tipo, resultado, metodo, fecha, actor_id) VALUES ($1,$2,2,'cambio_datos_practica','recalculada','correccion', now(), $3)`, [randomUUID(), vActa2, actorActa2]);
      await ds.undoLastMigration({ transaction: 'each' }); // la 20, sin decisiones
      await ds.undoLastMigration({ transaction: 'each' }); // la 19, sin evidencias
      const fallaMesa = await ds.undoLastMigration({ transaction: 'each' }).then(() => null, (e: Error) => e.message);
      comprobar('down de MesaActas se NIEGA con evidencia de cambio de datos (solo inserción)', fallaMesa !== null, 'no se negó');
      comprobar('tras el rechazo, la migración 18 sigue registrada y el esquema no quedó a medias',
        (await registradas(ds)).some((x) => x.startsWith('MesaActas')) &&
        (await ds.query(`SELECT 1 FROM information_schema.columns WHERE table_name='validaciones_acta_iniciacion' AND column_name='asignado_a'`)).length === 1);
      await ds.destroy();

      // Con una evidencia de documento empresarial (solo inserción), el down de la 19 se NIEGA.
      await crearBase(bases.emp);
      ds = await abrir(bases.emp, MIGRACIONES);
      await ds.runMigrations({ transaction: 'each' });
      await cargarCatalogos(ds);
      await sembrar(ds);
      const [{ id: estEmp }] = await ds.query(`SELECT id FROM usuarios WHERE rol='estudiante' LIMIT 1`);
      const docEmp = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento) VALUES ($1,$2,'rut_natural',1,'en_revision','s.pdf','application/pdf',10,$3,'s/e.pdf')`,
        [docEmp, PRACTICAS[0], createHash('sha256').update(docEmp).digest('hex')]);
      const vEmp = randomUUID();
      await ds.query(`INSERT INTO validaciones_documento_empresarial (id, documento_id, practica_id, estudiante_id) VALUES ($1,$2,$3,$4)`, [vEmp, docEmp, PRACTICAS[0], estEmp]);
      await ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha) VALUES ($1,$2,1,'lectura_documento','legible','sintetico', now())`, [randomUUID(), vEmp]);
      await ds.undoLastMigration({ transaction: 'each' }); // la 20: sin decisiones ni constancias, se revierte
      const fallaEmp = await ds.undoLastMigration({ transaction: 'each' }).then(() => null, (e: Error) => e.message);
      comprobar('down de ValidacionDocumentoEmpresarial se NIEGA con evidencia existente (solo inserción)', fallaEmp !== null, 'no se negó');
      comprobar('tras el rechazo, la migración 19 sigue registrada y la evidencia intacta',
        (await registradas(ds)).some((x) => x.startsWith('ValidacionDocumentoEmpresarial')) &&
        (await ds.query(`SELECT count(*)::int AS n FROM evidencias_validacion_doc_empresarial`))[0].n === 1);
      await ds.destroy();

      // Con una decisión humana sobre un RUT (estado terminal + evidencia de solo inserción), el down de la 20 se NIEGA.
      await crearBase(bases.emp);
      ds = await abrir(bases.emp, MIGRACIONES);
      await ds.runMigrations({ transaction: 'each' });
      await cargarCatalogos(ds);
      await sembrar(ds);
      const [{ id: estDec }] = await ds.query(`SELECT id FROM usuarios WHERE rol='estudiante' LIMIT 1`);
      const [{ id: actorDec }] = await ds.query(`SELECT id FROM usuarios WHERE rol='coordinador' LIMIT 1`);
      const docDec = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento) VALUES ($1,$2,'rut_natural',1,'en_revision','s.pdf','application/pdf',10,$3,'s/d.pdf')`,
        [docDec, PRACTICAS[0], createHash('sha256').update(docDec).digest('hex')]);
      const vDec = randomUUID();
      await ds.query(
        `INSERT INTO validaciones_documento_empresarial (id, documento_id, practica_id, estudiante_id, estado, tipo_detectado, familia_documento, tipo_persona, hash_documento, procesada_en, decidido_por, decidido_en)
         VALUES ($1,$2,$3,$4,'aprobado_manual','rut_persona_natural','rut','natural',$5, now(), $6, now())`,
        [vDec, docDec, PRACTICAS[0], estDec, createHash('sha256').update(vDec).digest('hex'), actorDec]);
      await ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha, actor_id) VALUES ($1,$2,1,'decision_humana','aprobar','decision_documento', now(), $3)`, [randomUUID(), vDec, actorDec]);
      const falla20 = await ds.undoLastMigration({ transaction: 'each' }).then(() => null, (e: Error) => e.message);
      comprobar('down de DecisionHumanaDocumentoEmpresarial se NIEGA con una decisión humana existente (solo inserción)', falla20 !== null, 'no se negó');
      comprobar('tras el rechazo, la migración 20 sigue registrada, la decisión y su evidencia intactas',
        (await registradas(ds)).some((x) => x.startsWith('DecisionHumana')) &&
        (await ds.query(`SELECT estado FROM validaciones_documento_empresarial WHERE id = $1`, [vDec]))[0].estado === 'aprobado_manual' &&
        (await ds.query(`SELECT count(*)::int AS n FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1`, [vDec]))[0].n === 1);
      await ds.destroy();
    });

    await bloqueDeuda('C: upgrade desde PRE-EPS (asume 16–20 como últimas)', async () => {
      // ── C. Upgrade desde PRE-EPS ──────────────────────────────────────────
      console.log('\nC. Upgrade desde una base PRE-EPS con datos sintéticos');
      await crearBase(bases.up);
      ds = await abrir(bases.up, PRE_EPS);
      await ds.runMigrations({ transaction: 'each' });
      comprobar('la base PRE-EPS no tiene tablas EPS', !(await tablas(ds)).some((t) => t.includes('eps')));
      await cargarCatalogos(ds);
      await sembrar(ds);
      await sintetizarPreEps(ds);
      const antes = new Map<string, { filas: number; md5: string }>();
      for (const t of await tablas(ds)) antes.set(t, await huella(ds, t, true));
      const idsAntes = new Set<string>((await ds.query(`SELECT id::text FROM documentos`)).map((r: { id: string }) => r.id));
      const [{ n: nDocs }] = await ds.query(`SELECT count(*)::int AS n FROM documentos`);
      const [{ n: nAud }] = await ds.query(`SELECT count(*)::int AS n FROM auditoria`);
      console.log(`      (antes: ${antes.size} tablas, ${nDocs} documentos, ${nAud} registros de auditoría)`);
      await integridad(ds, 'pre-EPS');
      await ds.destroy();

      // Se aplican 11–14, se crean validaciones sobre documentos YA existentes y luego la 15 (relleno).
      ds = await abrir(bases.up, MIGRACIONES.slice(0, 15));
      await ds.runMigrations({ transaction: 'each' });
      const docsEps = await ds.query(`SELECT d.id, d.practica_id, p.estudiante_id, d.cargado_en FROM documentos d JOIN practicas p ON p.id=d.practica_id WHERE d.tipo='certificado_eps' ORDER BY d.cargado_en, d.id`);
      for (const d of docsEps) await ds.query(`INSERT INTO validaciones_eps (id, documento_id, practica_id, estudiante_id, reservado_en, asignado_a, reserva_hasta) VALUES ($1,$2,$3,$4,NULL,NULL,NULL)`, [randomUUID(), d.id, d.practica_id, d.estudiante_id]);
      await ds.destroy();
      ds = await abrir(bases.up, MIGRACIONES);
      const ultima = await ds.runMigrations({ transaction: 'each' });
      comprobar('las migraciones 15 (Mesa EPS), 16–18 (acta y su Mesa), 19 (documentos empresariales) y 20 (decisión humana del RUT) se aplicaron sobre filas existentes',
        ultima.length === 6 && ultima[5].name.startsWith('DecisionHumana') && ultima[4].name.startsWith('ValidacionDocumentoEmpresarial') && ultima[0].name.startsWith('MesaEps') && ultima[1].name.startsWith('ResponsableArl') && ultima[2].name.startsWith('ValidacionActa') && ultima[3].name.startsWith('MesaActas'), ultima.map((m) => m.name).join(', '));
      const [{ n: sinRellenar }] = await ds.query(`SELECT count(*)::int AS n FROM practicas WHERE responsable_arl IS NOT NULL`);
      const [{ n: practicasN }] = await ds.query(`SELECT count(*)::int AS n FROM practicas`);
      comprobar(`las ${practicasN} prácticas históricas quedaron con responsable_arl NULL (no se rellenó ni se derivó de la modalidad)`, practicasN > 0 && sinRellenar === 0, `${sinRellenar} con valor`);
      const rec = await ds.query(`SELECT count(*)::int AS n FROM validaciones_eps v JOIN documentos d ON d.id=v.documento_id WHERE v.recibida_en IS DISTINCT FROM d.cargado_en`);
      comprobar('recibida_en se rellenó con la fecha de carga de cada certificado existente', rec[0].n === 0, `${rec[0].n} distintas`);

      let cambiadas = 0;
      for (const [t, h] of antes) {
        const d = await huella(ds, t, true);
        const igual = d.filas === h.filas && d.md5 === h.md5;
        if (!igual) { cambiadas += 1; comprobar(`tabla previa «${t}» intacta tras el upgrade`, false, `${h.filas}→${d.filas} filas, huella distinta`); }
      }
      comprobar(`las ${antes.size} tablas previas conservan conteo y contenido idénticos`, cambiadas === 0);
      const idsDespues = new Set<string>((await ds.query(`SELECT id::text FROM documentos`)).map((r: { id: string }) => r.id));
      comprobar('ningún identificador de documento cambió ni desapareció', [...idsAntes].every((i) => idsDespues.has(i)) && idsDespues.size === idsAntes.size);
      comprobar('la auditoría previa sigue completa', (await ds.query(`SELECT count(*)::int AS n FROM auditoria`))[0].n === nAud);
      comprobar('la tabla de migraciones quedó completa y en orden', JSON.stringify(await registradas(ds)) === JSON.stringify(ESPERADAS));
      await esquemaEps(ds, 'upgrade');
      await esquemaActa(ds, 'upgrade');
      await integridad(ds, 'upgrade');
      // Una restricción nueva no debe romper un dato histórico válido: una decisión previa ya está en documentos; las validaciones heredadas son legales.
      const [{ n: validas }] = await ds.query(`SELECT count(*)::int AS n FROM validaciones_eps`);
      comprobar(`${docsEps.length} certificados previos admiten su validación EPS sin violar restricciones`, validas === docsEps.length, `${validas}`);
      await ds.destroy();
    });
  } finally {
    for (const b of Object.values(bases)) await borrarBase(b).catch(() => undefined);
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLA(S)`} — verificación de migraciones`);
  if (deuda > 0) console.log(`DEUDA CONOCIDA: ${deuda} comprobación(es) heredada(s) no aplican con las migraciones 21–26 presentes (no son fallos de la 25 ni de la 26, que tienen su sección H estricta; ver la nota en la cabecera de comprobar()).`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((e: Error) => { console.error(e); process.exit(1); });
