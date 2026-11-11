/**
 * reportes_seed_1000 — dataset SINTÉTICO de volumen para probar Reportes V3 (1.000 estudiantes, 1.000 prácticas).
 *
 * Uso (solo bases locales desechables):
 *   DB_URL=postgres://postgres@127.0.0.1:55432/sipra_reportes_1000 \
 *     npx ts-node --transpile-only herramientas/seed-reportes-1000.ts <crear|borrar|estado|huella|verificar> --base sipra_reportes_1000
 *
 * Garantías:
 * - Se niega a correr si el host no es local, si el puerto es 5433 (sipra_dev), si el nombre de la base no empieza por
 *   `sipra_reportes_` o `sipra_e2e_`, o si `--base` no coincide con `current_database()`.
 * - Reproducible: generador mulberry32 con semilla 20261111 y fecha de referencia fija (nunca `now()`).
 * - Idempotente: IDs deterministas con prefijo `5eed1000-` (el discriminador). `crear` sobre un dataset completo no hace
 *   nada; sobre uno parcial, lo borra y lo rehace. `borrar` elimina solo filas con ese prefijo y las escuelas `SYN-ESC-*`.
 * - La auditoría es inmutable por diseño (disparador): las decisiones sintéticas llevan `metadatos.seed` y NO se borran;
 *   al recrear no se duplican. Para limpiar todo, se elimina la base desechable.
 * - Semestre: SIPRA no lo persiste (vive en SINU). Aquí va a la tabla auxiliar `sintetico_semestre_practica`, creada por
 *   este script (no por una migración) y leída por la API solo con `REPORTES_SEMESTRE_SINTETICO=true` en `dev`.
 * - Nombre de programa: mismo mecanismo, tabla `sintetico_programa` (código sintético → nombre), leída solo con
 *   `REPORTES_PROGRAMAS_SINTETICOS=true` en `dev`. En producción Reportes muestra el código (el nombre vive en SINU).
 * - Periodos: solo códigos que EXISTEN en `periodos_academicos` (se verifica antes de insertar). 335 es un calendario, no
 *   un periodo: se usan sus periodos 26P05 y 26P06. 26V01–26V03 y 2056C no están en el catálogo y quedan fuera.
 * - Organización receptora (v4): TODAS las prácticas tienen una. Práctica interna CUN = modalidad articulada del dominio
 *   («escenario dentro de la institución»): 120 internas ligadas a un registro sintético «CUN · Práctica interna». Las 880
 *   externas se reparten entre 89 empresas sintéticas. Sector y ciudad usan el modelo REAL: `empresas.ciiu` (cat_ciiu) y
 *   `empresas.divipola_municipio` (cat_divipola). Las receptoras de pasantía internacional están en el exterior: sin DIVIPOLA.
 *   Las afinidades programa → sector son pesos del generador, no reglas de negocio.
 * - Situación del expediente: no se inserta (la calcula el servicio de dominio). Se fija una situación objetivo por práctica
 *   (completo 22,5 %, en curso 42,5 %, requiere corrección 27,5 %, sin iniciar 7,5 %) y se generan los documentos que la producen.
 * - Regla SOLO de este dataset (no institucional): semestre 4 → técnico; 5–6 → tecnólogo; 7–9 → profesional.
 * - Documentos: la matriz real de cada modalidad (`documentosExigidos`), la misma que usa el Expediente.
 */
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import {
  CIIU_CUN, CIUDADES, CLASES_CIIU, ESCUELAS, INTERNAS, MODALIDADES, Organizacion, PERIODOS, PREFIJO, PROGRAMAS, SEED, TOTAL, articulada, generar,
} from './seed-reportes-1000.generador';

// ── Guardas de base ────────────────────────────────────────────────────────────────────────────────────────────────────
const [, , comando, ...resto] = process.argv;
const base = resto[resto.indexOf('--base') + 1];
const url = process.env.DB_URL?.trim();
function abortar(m: string): never { console.error(`✖ ${m}`); process.exit(2); }
if (!['crear', 'borrar', 'estado', 'huella', 'verificar'].includes(comando ?? '')) abortar('Comando: crear | borrar | estado | huella | verificar');
if (!url) abortar('Falta DB_URL.');
if (!base || resto.indexOf('--base') < 0) abortar('Indique la base esperada con --base <nombre> (confirmación explícita).');
const destino = new URL(url);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(destino.hostname)) abortar(`Host no local («${destino.hostname}»).`);
if (destino.port === '5433') abortar('El puerto 5433 es sipra_dev: prohibido para este dataset.');
const nombreBase = destino.pathname.replace(/^\//, '');
if (!/^sipra_(reportes|e2e)_[a-z0-9_]+$/.test(nombreBase)) abortar(`La base «${nombreBase}» no es una base desechable de pruebas (sipra_reportes_* o sipra_e2e_*).`);
if (nombreBase !== base) abortar(`--base «${base}» no coincide con la base de DB_URL «${nombreBase}».`);

// ── Operaciones ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function confirmarBase(db: Client): Promise<void> {
  const { rows: [b] } = await db.query<{ base: string; puerto: number; datos: string }>(
    `SELECT current_database() AS base, inet_server_port() AS puerto, current_setting('data_directory') AS datos`);
  if (b.base !== base) abortar(`La conexión apunta a «${b.base}», no a «${base}».`);
  const { rows: [t] } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name IN ('practicas','documentos','auditoria','periodos_academicos')`);
  if (Number(t.n) !== 4) abortar('La base no tiene el esquema de SIPRA migrado.');
  console.log(`Base confirmada: ${b.base} · puerto ${b.puerto} · data_directory ${b.datos}`);
}

async function contar(db: Client) {
  const q = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0].n);
  return {
    estudiantes: await q(`SELECT count(*) AS n FROM usuarios WHERE id::text LIKE '${PREFIJO}1%'`),
    practicas: await q(`SELECT count(*) AS n FROM practicas WHERE id::text LIKE '${PREFIJO}2%'`),
    documentos: await q(`SELECT count(*) AS n FROM documentos WHERE id::text LIKE '${PREFIJO}3%'`),
    semestres: await q(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'sintetico_semestre_practica'`)
      ? await q(`SELECT count(*) AS n FROM sintetico_semestre_practica WHERE seed = '${SEED}'`) : 0,
    auditoria: await q(`SELECT count(*) AS n FROM auditoria WHERE metadatos->>'seed' = '${SEED}'`),
  };
}

async function borrar(db: Client): Promise<void> {
  await db.query('BEGIN');
  // Orden por llaves foráneas. Todo por el prefijo determinista (nunca un DELETE sin discriminador).
  const existeOverlay = (await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'sintetico_semestre_practica'`)).rowCount;
  if (existeOverlay) await db.query(`DELETE FROM sintetico_semestre_practica WHERE seed = $1`, [SEED]);
  const docs = await db.query(`DELETE FROM documentos WHERE id::text LIKE $1`, [`${PREFIJO}3%`]);
  const prs = await db.query(`DELETE FROM practicas WHERE id::text LIKE $1`, [`${PREFIJO}2%`]);
  const usr = await db.query(`DELETE FROM usuarios WHERE id::text LIKE $1 OR id::text LIKE $2`, [`${PREFIJO}1%`, `${PREFIJO}5%`]);
  if ((await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'sintetico_empresa_ubicacion'`)).rowCount) {
    await db.query(`DELETE FROM sintetico_empresa_ubicacion WHERE seed = $1`, [SEED]);
    if (Number((await db.query(`SELECT count(*) AS n FROM sintetico_empresa_ubicacion`)).rows[0].n) === 0) await db.query(`DROP TABLE sintetico_empresa_ubicacion`);
  }
  const emp = await db.query(`DELETE FROM empresas WHERE id::text LIKE $1`, [`${PREFIJO}4%`]);
  if ((await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'sintetico_programa'`)).rowCount) {
    await db.query(`DELETE FROM sintetico_programa WHERE seed = $1`, [SEED]);
    if (Number((await db.query(`SELECT count(*) AS n FROM sintetico_programa`)).rows[0].n) === 0) await db.query(`DROP TABLE sintetico_programa`);
  }
  const esc = await db.query(`DELETE FROM cat_escuela WHERE codigo LIKE 'SYN-ESC-%' AND NOT EXISTS (SELECT 1 FROM practicas p WHERE p.escuela_id = cat_escuela.codigo)`);
  if (existeOverlay && Number((await db.query(`SELECT count(*) AS n FROM sintetico_semestre_practica`)).rows[0].n) === 0) {
    await db.query(`DROP TABLE sintetico_semestre_practica`);
  }
  await db.query('COMMIT');
  console.log(`Borrado ${SEED}: ${docs.rowCount} versiones, ${prs.rowCount} prácticas, ${usr.rowCount} usuarios, ${emp.rowCount} empresas, ${esc.rowCount} escuelas.`);
  console.log('La auditoría sintética (metadatos.seed) es inmutable por diseño y se conserva; al recrear no se duplica.');
}

async function crear(db: Client): Promise<void> {
  const antes = await contar(db);
  if (antes.estudiantes === TOTAL && antes.practicas === TOTAL && antes.semestres === TOTAL) {
    console.log(`${SEED} ya está completo (${TOTAL} estudiantes): sin cambios.`);
    return;
  }
  if (antes.estudiantes || antes.practicas || antes.documentos) { console.log('Dataset parcial: se borra y se rehace.'); await borrar(db); }

  const { rows: enCatalogo } = await db.query<{ codigo: string }>(`SELECT codigo FROM periodos_academicos WHERE codigo = ANY($1::text[])`, [PERIODOS]);
  const faltan = PERIODOS.filter((p) => !enCatalogo.some((c) => c.codigo === p));
  if (faltan.length) throw new Error(`Periodos no presentes en periodos_academicos: ${faltan.join(', ')}. No se crean catálogos falsos.`);
  // La regla interna/externa es del dominio: las cantidades del dataset deben respetarla.
  const internas = MODALIDADES.filter(([m]) => articulada(m)).reduce((n, [, c]) => n + c, 0);
  if (internas !== INTERNAS) throw new Error(`Las modalidades articuladas suman ${internas}, no ${INTERNAS}: revise MODALIDADES.`);
  const clases = [CIIU_CUN, ...Object.values(CLASES_CIIU).flat()];
  const { rows: enCiiu } = await db.query<{ codigo: string }>(`SELECT codigo FROM cat_ciiu WHERE codigo = ANY($1::text[])`, [clases]);
  const { rows: enDivipola } = await db.query<{ codigo: string }>(`SELECT codigo FROM cat_divipola WHERE codigo = ANY($1::text[])`, [CIUDADES.map((c) => c[0])]);
  if (enCiiu.length !== clases.length || enDivipola.length !== CIUDADES.length) throw new Error('Hay clases CIIU o municipios DIVIPOLA del generador que no están en el catálogo cargado.');
  const g = generar();

  await db.query('BEGIN');
  await db.query(`CREATE TABLE IF NOT EXISTS sintetico_semestre_practica (
      practica_id uuid PRIMARY KEY REFERENCES practicas(id) ON DELETE CASCADE,
      semestre smallint NOT NULL CHECK (semestre BETWEEN 1 AND 12),
      seed varchar(40) NOT NULL)`);
  await db.query(`COMMENT ON TABLE sintetico_semestre_practica IS 'SOLO bases sintéticas de prueba (${SEED}). No es parte del modelo productivo: SIPRA no persiste el semestre (vive en SINU).'`);
  await db.query(`CREATE TABLE IF NOT EXISTS sintetico_programa (
      codigo varchar(60) PRIMARY KEY, nombre varchar(200) NOT NULL, seed varchar(40) NOT NULL)`);
  await db.query(`COMMENT ON TABLE sintetico_programa IS 'SOLO bases sintéticas de prueba (${SEED}): código sintético → nombre de programa. No es parte del modelo productivo (el nombre real vive en SINU).'`);
  await db.query(`INSERT INTO sintetico_programa (codigo, nombre, seed) SELECT * , $3 FROM unnest($1::text[], $2::text[]) ON CONFLICT (codigo) DO NOTHING`,
    [PROGRAMAS.map((p) => p.codigo), PROGRAMAS.map((p) => p.nombre), SEED]);
  for (const e of ESCUELAS) await db.query(`INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2) ON CONFLICT (codigo) DO NOTHING`, [e.codigo, e.nombre]);
  await db.query(
    `INSERT INTO usuarios (id, correo, nombre, rol, permiso, escuelas)
     SELECT id, correo, nombre, 'tutor', 'escritura', ARRAY[escuela]::text[]
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS t(id, correo, nombre, escuela)`,
    [g.docentes.map((d) => d.id), g.docentes.map((d) => d.correo), g.docentes.map((d) => d.nombre), g.docentes.map((d) => d.escuela)]);
  await db.query(
    `INSERT INTO usuarios (id, correo, nombre, documento, rol, permiso, escuelas, programa_id)
     SELECT id, correo, nombre, documento, 'estudiante', 'escritura', '{}', programa
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[]) AS t(id, correo, nombre, documento, programa)`,
    [g.estudiantes.map((e) => e.id), g.estudiantes.map((e) => e.correo), g.estudiantes.map((e) => e.nombre), g.estudiantes.map((e) => e.documento), g.estudiantes.map((e) => e.programa)]);
  await db.query(
    `INSERT INTO empresas (id, razon_social, nit_numero, nit_dv, ciiu, divipola_municipio, solicitante_nombre, solicitante_correo, estado)
     SELECT id, razon, nit, dv, ciiu, divipola, 'Contacto Sintético Reportes', 'contacto.reportes@empresa.ejemplo.invalid', 'habilitada'
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[]) AS t(id, razon, nit, dv, ciiu, divipola)`,
    ['id', 'razon', 'nit', 'dv', 'ciiu', 'divipola'].map((k) => g.organizaciones.map((o) => o[k as keyof Organizacion])));
  // SIPRA no guarda país: el ámbito internacional de las receptoras de pasantía internacional es un dato del FIXTURE, en una
  // tabla auxiliar de dev (misma regla que semestre y nombre de programa; la API la lee solo con REPORTES_UBICACION_SINTETICA).
  await db.query(`CREATE TABLE IF NOT EXISTS sintetico_empresa_ubicacion (
      empresa_id uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      ambito varchar(20) NOT NULL CHECK (ambito IN ('internacional')), seed varchar(40) NOT NULL)`);
  await db.query(`COMMENT ON TABLE sintetico_empresa_ubicacion IS 'SOLO bases sintéticas de prueba (${SEED}): receptoras en el exterior. SIPRA no persiste país; no es parte del modelo productivo.'`);
  const internacionales = g.organizaciones.filter((o) => o.ambito === 'internacional');
  await db.query(`INSERT INTO sintetico_empresa_ubicacion (empresa_id, ambito, seed) SELECT id, 'internacional', $2 FROM unnest($1::uuid[]) AS t(id) ON CONFLICT (empresa_id) DO NOTHING`,
    [internacionales.map((o) => o.id), SEED]);
  const P = g.practicas as Record<string, never>[];
  const col = (k: string) => P.map((p) => p[k] ?? null);
  await db.query(
    `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, numero_fur, tutor_id,
                            empresa_id, empresa_razon_social, fecha_inicio, arl_verificada, arl_fecha_afiliacion, fecha_fin, nota, cerrada_en, registrada_por)
     SELECT * , 'coordinacion' FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bigint[], $10::uuid[],
                         $11::uuid[], $12::text[], $13::timestamptz[], $14::boolean[], $15::timestamptz[], $16::timestamptz[], $17::numeric[], $18::timestamptz[])`,
    ['id', 'estudiante', 'programa', 'escuela', 'ciclo', 'periodo', 'modalidad', 'estado', 'fur', 'tutor', 'empresaId', 'empresaRazon',
      'fechaInicio', 'arl', 'arlFecha', 'fechaFin', 'nota', 'cerrada'].map(col));
  await db.query(
    `INSERT INTO sintetico_semestre_practica (practica_id, semestre, seed) SELECT practica, semestre, $3 FROM unnest($1::uuid[], $2::int[]) AS t(practica, semestre)`,
    [g.semestreDe.map((s) => s.practica), g.semestreDe.map((s) => s.semestre), SEED]);
  const V = g.versiones;
  await db.query(
    `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento,
                             cargado_en, decidido_por, justificacion_decision, motivo_devolucion)
     SELECT id, practica, tipo, version, estado, 'sintetico-' || tipo || '-v' || version || '.pdf', 'application/pdf', 2048, hash, 'sintetico/${SEED}/' || id,
            cargado, CASE WHEN decidido IS NULL THEN NULL ELSE docente END,
            CASE WHEN estado IN ('aprobado', 'rechazado') THEN 'Decisión sintética (${SEED})' END,
            CASE WHEN estado = 'devuelto' THEN 'Corrección sintética de prueba' END
     FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[], $5::text[], $6::text[], $7::timestamptz[], $8::timestamptz[], $9::uuid[])
       AS t(id, practica, tipo, version, estado, hash, cargado, decidido, docente)`,
    [V.map((v) => v.id), V.map((v) => v.practica), V.map((v) => v.tipo), V.map((v) => v.version), V.map((v) => v.estado),
      V.map((v) => createHash('sha256').update(v.id).digest('hex')), V.map((v) => new Date(v.cargado)),
      V.map((v) => (v.decidido ? new Date(v.decidido) : null)), V.map((v) => v.docente)]);
  // La auditoría previa (inmutable) no puede contradecir los documentos que se insertan ahora.
  const { rows: [c] } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM auditoria a JOIN unnest($1::uuid[], $2::text[]) AS t(id, decision) ON t.id = a.entidad_id
     WHERE a.accion = 'decision_documento' AND a.metadatos->>'seed' = $3 AND a.metadatos->>'decision' IS DISTINCT FROM t.decision`,
    [V.map((v) => v.id), V.map((v) => v.decision), SEED]);
  if (Number(c.n) > 0) throw new Error(`Hay ${c.n} decisiones auditadas previas que contradicen esta versión del generador: recree la base desechable.`);
  const D = V.filter((v) => v.decision);
  const aud = await db.query(
    `INSERT INTO auditoria (actor_id, actor_rol, accion, entidad, entidad_id, metadatos, ocurrido_en)
     SELECT docente, 'tutor', 'decision_documento', 'documento', id, jsonb_build_object('decision', decision, 'seed', $5::text), decidido
     FROM unnest($1::uuid[], $2::text[], $3::timestamptz[], $4::uuid[]) AS t(id, decision, decidido, docente)
     WHERE NOT EXISTS (SELECT 1 FROM auditoria a WHERE a.entidad_id = t.id AND a.accion = 'decision_documento' AND a.metadatos->>'seed' = $5::text)`,
    [D.map((v) => v.id), D.map((v) => v.decision), D.map((v) => new Date(v.decidido as number)), D.map((v) => v.docente), SEED]);
  await db.query('COMMIT');
  console.log(`Creado ${SEED}: ${g.estudiantes.length} estudiantes, ${g.practicas.length} prácticas, ${V.length} versiones, ${aud.rowCount} decisiones auditadas nuevas, ${g.docentes.length} docentes, ${g.organizaciones.length} organizaciones receptoras (1 CUN interna + ${g.organizaciones.length - 1} externas).`);
}

/** Huella del dataset (para comprobar la reproducibilidad entre dos bases limpias). */
async function huella(db: Client): Promise<void> {
  const { rows: [h] } = await db.query<{ p: string; d: string; s: string; a: string }>(
    `SELECT
       (SELECT md5(string_agg(concat_ws('|', id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, empresa_razon_social, tutor_id), ',' ORDER BY id)) FROM practicas WHERE id::text LIKE '${PREFIJO}2%') AS p,
       (SELECT md5(string_agg(concat_ws('|', id, practica_id, tipo, version, estado, cargado_en), ',' ORDER BY id)) FROM documentos WHERE id::text LIKE '${PREFIJO}3%') AS d,
       (SELECT md5(string_agg(concat_ws('|', practica_id, semestre), ',' ORDER BY practica_id)) FROM sintetico_semestre_practica) AS s,
       (SELECT md5(string_agg(concat_ws('|', a.entidad_id, a.metadatos->>'decision', a.ocurrido_en), ',' ORDER BY a.entidad_id))
          FROM auditoria a JOIN documentos d ON d.id = a.entidad_id WHERE a.metadatos->>'seed' = '${SEED}') AS a`);
  console.log(`huella prácticas ${h.p} · documentos ${h.d} · semestres ${h.s} · decisiones ${h.a}`);
}

/**
 * Invariantes del dataset contra la base (el comando termina con error si alguna falla). Interna/externa se deriva SIEMPRE
 * de la regla del dominio `definicionModalidad(m).articulada`: no hay otra fuente de verdad.
 */
async function verificar(db: Client): Promise<void> {
  const articuladas = MODALIDADES.map(([m]) => m).filter((m) => articulada(m));
  const cun = `${PREFIJO}4%-000000000001`;
  const q = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
  const dePrueba = `p.id::text LIKE '${PREFIJO}2%'`;
  const reglas: [string, number, number][] = [
    ['prácticas del seed', await q(`SELECT count(*) AS n FROM practicas p WHERE ${dePrueba}`), TOTAL],
    ['prácticas sin organización receptora', await q(`SELECT count(*) AS n FROM practicas p WHERE ${dePrueba} AND p.empresa_id IS NULL`), 0],
    ['internas (modalidad articulada)', await q(`SELECT count(*) AS n FROM practicas p WHERE ${dePrueba} AND p.modalidad = ANY($1::text[])`, [articuladas]), INTERNAS],
    ['externas (modalidad no articulada)', await q(`SELECT count(*) AS n FROM practicas p WHERE ${dePrueba} AND NOT p.modalidad = ANY($1::text[])`, [articuladas]), TOTAL - INTERNAS],
    ['modalidades externas asignadas a la CUN', await q(`SELECT count(*) AS n FROM practicas p WHERE ${dePrueba} AND NOT p.modalidad = ANY($1::text[]) AND p.empresa_id::text LIKE $2`, [articuladas, cun]), 0],
    ['modalidades articuladas en empresa externa', await q(`SELECT count(*) AS n FROM practicas p WHERE ${dePrueba} AND p.modalidad = ANY($1::text[]) AND p.empresa_id::text NOT LIKE $2`, [articuladas, cun]), 0],
    ['pasantía internacional fuera de receptoras internacionales', await q(`SELECT count(*) AS n FROM practicas p LEFT JOIN sintetico_empresa_ubicacion u ON u.empresa_id = p.empresa_id WHERE ${dePrueba} AND p.modalidad = 'pasantia_internacional' AND u.empresa_id IS NULL`), 0],
    ['receptoras internacionales con municipio DIVIPOLA', await q(`SELECT count(*) AS n FROM sintetico_empresa_ubicacion u JOIN empresas e ON e.id = u.empresa_id WHERE e.divipola_municipio IS NOT NULL`), 0],
    ['receptoras nacionales sin municipio DIVIPOLA', await q(`SELECT count(DISTINCT e.id) AS n FROM practicas p JOIN empresas e ON e.id = p.empresa_id LEFT JOIN sintetico_empresa_ubicacion u ON u.empresa_id = e.id WHERE ${dePrueba} AND e.divipola_municipio IS NULL AND u.empresa_id IS NULL`), 0],
    ['receptoras sin CIIU', await q(`SELECT count(DISTINCT e.id) AS n FROM practicas p JOIN empresas e ON e.id = p.empresa_id WHERE ${dePrueba} AND e.ciiu IS NULL`), 0],
  ];
  let fallas = 0;
  for (const [regla, valor, esperado] of reglas) {
    const ok = valor === esperado;
    if (!ok) fallas += 1;
    console.log(`${ok ? '✔' : '✖'} ${regla}: ${valor} (esperado ${esperado})`);
  }
  if (fallas) throw new Error(`${fallas} invariante(s) del dataset no se cumplen.`);
}

async function estado(db: Client): Promise<void> {
  console.log(JSON.stringify(await contar(db)));
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await confirmarBase(db);
    if (comando === 'crear') { await crear(db); await verificar(db); }
    else if (comando === 'borrar') await borrar(db);
    else if (comando === 'huella') await huella(db);
    else if (comando === 'verificar') await verificar(db);
    await estado(db);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
