/**
 * Verificación de migraciones contra un PostgreSQL LOCAL DESECHABLE (Fase 6 EPS).
 *
 *   A. Desde cero: las 16 migraciones en orden, esquema, restricciones válidas, disparadores,
 *      privilegios del rol de aplicación.
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
function comprobar(descripcion: string, ok: boolean, detalle = ''): void {
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${descripcion}${ok || !detalle ? '' : `  → ${detalle}`}`);
}
const nombreDe = (m: new () => MigrationInterface): string => (new m() as MigrationInterface & { name?: string }).name ?? m.name;
const ESPERADAS = MIGRACIONES.map(nombreDe);
const PRE_EPS = MIGRACIONES.slice(0, 11); // 0–10: hasta ConsentimientoVersionado
const EPS = MIGRACIONES.slice(11); // 11–15

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
async function huella(ds: DataSource, tabla: string): Promise<{ filas: number; md5: string }> {
  const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM "${tabla}"`);
  const [{ h }] = await ds.query(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${tabla}" t`);
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

// ── Datos sintéticos ────────────────────────────────────────────────────────

const PRACTICAS = ['00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000043'];
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
  const bases = { cero: `mig_cero_${sufijo}`, rev: `mig_rev_${sufijo}`, up: `mig_up_${sufijo}` };
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
    await integridad(ds, 'cero');
    await cargarCatalogos(ds);
    await sembrar(ds);
    await integridad(ds, 'cero + semillas');
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
    await ds.destroy();

    // Reversión completa del bloque EPS en una base SIN evidencias OCR (sin datos EPS).
    const sinDatos = `${bases.rev}_vacia`;
    await crearBase(sinDatos);
    ds = await abrir(sinDatos, MIGRACIONES);
    await ds.runMigrations({ transaction: 'each' });
    for (let i = 0; i < EPS.length; i += 1) await ds.undoLastMigration({ transaction: 'each' });
    const quedan = await registradas(ds);
    comprobar('bloque EPS (11–15) revertido por completo sin datos EPS', JSON.stringify(quedan) === JSON.stringify(ESPERADAS.slice(0, 11)), quedan.slice(-2).join(', '));
    comprobar('sin tablas EPS tras revertir', !(await tablas(ds)).some((t) => t.includes('eps')));
    comprobar('la auditoría y su disparador siguen intactos (no pertenecen al bloque EPS)', (await tablas(ds)).includes('auditoria'));
    await integridad(ds, 'revertida');
    const re = await ds.runMigrations({ transaction: 'each' });
    comprobar(`reaplicación del bloque EPS (${EPS.length} migraciones)`, re.length === EPS.length, `${re.length}`);
    await esquemaEps(ds, 'reaplicada');
    await integridad(ds, 'reaplicada');
    await ds.destroy();
    await borrarBase(sinDatos);

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
    for (const t of await tablas(ds)) antes.set(t, await huella(ds, t));
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
    comprobar('la migración 15 (Mesa) se aplicó sobre filas existentes', ultima.length === 1 && ultima[0].name.startsWith('MesaEps'));
    const rec = await ds.query(`SELECT count(*)::int AS n FROM validaciones_eps v JOIN documentos d ON d.id=v.documento_id WHERE v.recibida_en IS DISTINCT FROM d.cargado_en`);
    comprobar('recibida_en se rellenó con la fecha de carga de cada certificado existente', rec[0].n === 0, `${rec[0].n} distintas`);

    let cambiadas = 0;
    for (const [t, h] of antes) {
      const d = await huella(ds, t);
      const igual = d.filas === h.filas && d.md5 === h.md5;
      if (!igual) { cambiadas += 1; comprobar(`tabla previa «${t}» intacta tras el upgrade`, false, `${h.filas}→${d.filas} filas, huella distinta`); }
    }
    comprobar(`las ${antes.size} tablas previas conservan conteo y contenido idénticos`, cambiadas === 0);
    const idsDespues = new Set<string>((await ds.query(`SELECT id::text FROM documentos`)).map((r: { id: string }) => r.id));
    comprobar('ningún identificador de documento cambió ni desapareció', [...idsAntes].every((i) => idsDespues.has(i)) && idsDespues.size === idsAntes.size);
    comprobar('la auditoría previa sigue completa', (await ds.query(`SELECT count(*)::int AS n FROM auditoria`))[0].n === nAud);
    comprobar('la tabla de migraciones quedó completa y en orden', JSON.stringify(await registradas(ds)) === JSON.stringify(ESPERADAS));
    await esquemaEps(ds, 'upgrade');
    await integridad(ds, 'upgrade');
    // Una restricción nueva no debe romper un dato histórico válido: una decisión previa ya está en documentos; las validaciones heredadas son legales.
    const [{ n: validas }] = await ds.query(`SELECT count(*)::int AS n FROM validaciones_eps`);
    comprobar(`${docsEps.length} certificados previos admiten su validación EPS sin violar restricciones`, validas === docsEps.length, `${validas}`);
    await ds.destroy();
  } finally {
    for (const b of Object.values(bases)) await borrarBase(b).catch(() => undefined);
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLA(S)`} — verificación de migraciones`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((e: Error) => { console.error(e); process.exit(1); });
