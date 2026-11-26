// Verificador de INTEGRIDAD posterior a cada escenario (P14). Solo lectura. Cruza:
//   respuestas 201 de k6 (marcas DOC201 del registro de la corrida)
//   ↔ filas de `documentos` ↔ archivos en el almacenamiento local ↔ auditoría DOCUMENTO_CARGADO.
//
//   node performance/herramientas/integridad.cjs <corrida> <registro-k6.log> [esperaColaSeg=180]
//   INTEGRIDAD_ESPERADOS=<n> (opcional): además exige exactamente n respuestas 201 (p. ej. 100 = VUS de la corrida).
//
// Sale con código 1 ante CUALQUIER inconsistencia (INTEGRIDAD = FALLÓ) y escribe performance/out/<corrida>.integridad.json.
const { Client } = require('pg');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

const [corrida, registro, esperaArg] = process.argv.slice(2);
if (!corrida || !registro) throw new Error('Uso: integridad.cjs <corrida> <registro-k6.log> [esperaColaSeg]');
const esperaCola = Number(esperaArg ?? 180);
const RAIZ = join(__dirname, '..', '..', 'apps', 'api', '.almacen-performance');
const OUT = process.env.PERF_OUT || join(__dirname, '..', 'out'); // PERF_OUT: solo para probar sobre una copia

function marcas(tipo) {
  const salida = [];
  for (const l of readFileSync(registro, 'utf8').split(/\r?\n/)) {
    const i = l.indexOf(`${tipo} {`);
    if (i < 0) continue;
    // k6 escribe msg="..." con comillas escapadas.
    let j = l.slice(i + tipo.length + 1);
    j = j.replace(/\\"/g, '"').replace(/"\s+source=console.*$/, '');
    // time="..." (reloj del PC generador, resolución de 1 s): sirve para estimar el desfase de reloj con el PC SIPRA.
    const tiempo = (l.match(/^time="([^"]+)"/) || [])[1];
    try { const o = JSON.parse(j); if (o.corrida === corrida) { Object.defineProperty(o, 'tiempo', { value: tiempo, enumerable: false }); salida.push(o); } } catch { /* línea ajena */ }
  }
  return salida;
}

function archivos(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(p)); else out.push(p);
  }
  return out;
}

(async () => {
  const db = new Client({ host: process.env.DB_HOST || '127.0.0.1', port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'sipra_performance', application_name: 'perf-integridad' });
  await db.connect();
  const [{ base }] = (await db.query('SELECT current_database() AS base')).rows;
  if (base !== 'sipra_performance') throw new Error(`Se niega: la conexión apunta a ${base}`);

  const ok201 = marcas('DOC201');
  const fallidos = marcas('UPLOAD_FALLIDO');
  const ids = ok201.map((x) => x.documentoId);
  const practicas = [...new Set(ok201.map((x) => x.practicaId).concat(fallidos.map((x) => `aaaaaaaa-0000-4000-8000-${String(x.i).padStart(12, '0')}`)))];

  // Esperar a que la cola en proceso termine con los documentos de la corrida (sin forzar nada).
  const t0 = Date.now();
  let pendientes = 0;
  do {
    pendientes = (await db.query(`SELECT count(*)::int n FROM documentos WHERE id = ANY($1::uuid[]) AND estado IN ('recibido','analizando')`, [ids])).rows[0].n;
    if (pendientes === 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  } while (Date.now() - t0 < esperaCola * 1000);
  const drenadoSeg = (Date.now() - t0) / 1000;

  const filas = (await db.query(`SELECT id::text, practica_id::text AS practica, tipo, version, estado, hash_sha256 AS hash, ruta_almacenamiento AS ruta, tamano_bytes::int AS tamano, cargado_en
    FROM documentos WHERE id = ANY($1::uuid[])`, [ids])).rows;
  const porId = new Map(filas.map((f) => [f.id, f]));
  const sinPersistencia = ids.filter((id) => !porId.has(id));

  // Documentos de las prácticas de la corrida que el cliente NO vio como 201 (p. ej. cancelación tras guardar).
  const enPracticas = (await db.query(`SELECT id::text, practica_id::text AS practica, tipo, version, hash_sha256 AS hash FROM documentos WHERE practica_id = ANY($1::uuid[])`, [practicas])).rows;
  const persistidosSin201 = enPracticas.filter((d) => !ids.includes(d.id)).map((d) => d.id);
  const grupos = new Map();
  for (const d of enPracticas) { const k = `${d.practica}|${d.tipo}`; grupos.set(k, (grupos.get(k) ?? 0) + 1); }
  const duplicados = [...grupos.entries()].filter(([, n]) => n > 1).map(([k, n]) => ({ practicaTipo: k, documentos: n }));
  const hashes = new Map();
  for (const d of enPracticas) { const k = `${d.practica}|${d.hash}`; hashes.set(k, (hashes.get(k) ?? 0) + 1); }
  const mismoArchivoRepetido = [...hashes.values()].filter((n) => n > 1).length;

  // Archivo físico y hash (el saneamiento no altera los PDF sintéticos: el archivo guardado = original).
  const sinArchivo = [];
  const hashDistinto = [];
  const tamanoDistinto = [];
  for (const f of filas) {
    const p = join(RAIZ, ...f.ruta.split('/'));
    if (!existsSync(p)) { sinArchivo.push(f.id); continue; }
    const b = readFileSync(p);
    if (b.length !== f.tamano) tamanoDistinto.push(f.id);
    if (createHash('sha256').update(b).digest('hex') !== f.hash) hashDistinto.push(f.id);
  }
  // Huérfanos y registros sin archivo en TODO el almacenamiento de performance (no solo la corrida).
  const rutasDb = new Set((await db.query('SELECT ruta_almacenamiento AS r FROM documentos')).rows.map((x) => x.r));
  const fisicos = archivos(join(RAIZ, 'practicas')).map((p) => relative(RAIZ, p).split(sep).join('/'));
  const huerfanos = fisicos.filter((r) => !rutasDb.has(r));
  const registrosSinArchivoGlobal = [...rutasDb].filter((r) => !existsSync(join(RAIZ, ...r.split('/')))).length;

  // Auditoría: exactamente un DOCUMENTO_CARGADO por documento.
  const aud = (await db.query(`SELECT entidad_id::text AS id, count(*)::int n FROM auditoria WHERE accion = 'documento_cargado' AND entidad_id::text = ANY($1::text[]) GROUP BY 1`, [ids])).rows;
  const audPorId = new Map(aud.map((a) => [a.id, a.n]));
  const auditoriaFaltante = filas.filter((f) => !audPorId.has(f.id)).map((f) => f.id);
  const auditoriaDuplicada = aud.filter((a) => a.n > 1).map((a) => a.id);

  // Escritura parcial: documento sin la actividad de la práctica actualizada.
  const parciales = (await db.query(`SELECT d.id::text FROM documentos d JOIN practicas p ON p.id = d.practica_id
    WHERE d.id = ANY($1::uuid[]) AND (p.ultima_actividad IS NULL OR p.ultima_actividad < d.cargado_en - interval '1 second')`, [ids])).rows.map((x) => x.id);
  const atascados = filas.filter((f) => ['recibido', 'analizando'].includes(f.estado)).map((f) => f.id);
  // DESFASE DE RELOJ generador − SIPRA (ms). La marca DOC201 se registra en el PC B justo después del 201; cargado_en lo
  // fija el PC A antes de responder. d = time(DOC201, truncado al segundo) − cargado_en ⇒ mediana(d) + 500 ms ≈ desfase
  // (+ la latencia de respuesta, decenas de ms). ventana.cjs lo usa para llevar la ventana de k6 al reloj del PC A.
  const difs = ok201.filter((x) => x.tiempo && porId.has(x.documentoId)).map((x) => Date.parse(x.tiempo) - new Date(porId.get(x.documentoId).cargado_en).getTime()).sort((a, b) => a - b);
  const pct = (q) => difs[Math.min(difs.length - 1, Math.floor(q * difs.length))];
  const reloj = difs.length ? { relojGeneradorMenosSipraMs: pct(0.5) + 500, marcas: difs.length, dP05Ms: pct(0.05), dP95Ms: pct(0.95), precision: '±0,5 s aprox. (marcas k6 con resolución de 1 s)' } : null;
  const estados = filas.reduce((a, f) => { a[f.estado] = (a[f.estado] ?? 0) + 1; return a; }, {});

  const r = {
    corrida, respuestas201: ids.length, uploadsFallidosCliente: fallidos.length, filasDocumentos: filas.length,
    archivosFisicosCorrida: filas.length - sinArchivo.length, auditoriasDocumentoCargado: aud.reduce((a, x) => a + x.n, 0),
    estados, colaDrenadaEnSeg: +drenadoSeg.toFixed(1), reloj,
    problemas: {
      sinPersistencia201: sinPersistencia.length, registrosSinArchivo: Math.max(sinArchivo.length, registrosSinArchivoGlobal),
      archivosHuerfanos: huerfanos.length, hashDistinto: hashDistinto.length, tamanoDistinto: tamanoDistinto.length,
      duplicados: duplicados.length, mismoArchivoRepetido, persistidosSin201: persistidosSin201.length,
      auditoriasFaltantes: auditoriaFaltante.length, auditoriasDuplicadas: auditoriaDuplicada.length,
      documentosAtascados: atascados.length, escriturasParciales: parciales.length,
    },
  };
  const esperados = process.env.INTEGRIDAD_ESPERADOS ? Number(process.env.INTEGRIDAD_ESPERADOS) : null;
  if (esperados !== null) r.respuestas201Esperadas = esperados;
  r.integridad = Object.values(r.problemas).every((n) => n === 0) && (esperados === null || r.respuestas201 === esperados) && r.respuestas201 === r.filasDocumentos && r.filasDocumentos === r.archivosFisicosCorrida && r.archivosFisicosCorrida === r.auditoriasDocumentoCargado ? 'OK' : 'FALLÓ';
  writeFileSync(join(OUT, `${corrida}.integridad.json`), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
  await db.end();
  if (r.integridad !== 'OK') process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
