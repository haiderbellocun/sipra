// Comprueba que un rango de estudiantes sintéticos está SIN USAR (ninguna práctica del rango tiene documentos), para
// que cada corrida tenga estudiantes y documentos propios (versiones, conteos e integridad no se contaminan). Solo lectura.
//
//   node performance/herramientas/verificar-rango.cjs <desde> <cantidad>
//   (sin argumentos: informa el primer estudiante libre después del último usado)
const { Client } = require('pg');

const pad = (n, w) => String(n).padStart(w, '0');
(async () => {
  const db = new Client({ host: process.env.DB_HOST || '127.0.0.1', port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'sipra_performance', application_name: 'perf-rango' });
  await db.connect();
  const [{ ultimo }] = (await db.query(`SELECT coalesce(max(substring(p.id::text from 25)::int), 0) AS ultimo FROM practicas p
    WHERE p.id::text LIKE 'aaaaaaaa-0000-4000-8000-%' AND EXISTS (SELECT 1 FROM documentos d WHERE d.practica_id = p.id)`)).rows;
  const desde = Number(process.argv[2] ?? ultimo + 1);
  const cantidad = Number(process.argv[3] ?? 100);
  const ids = Array.from({ length: cantidad }, (_, k) => `aaaaaaaa-0000-4000-8000-${pad(desde + k, 12)}`);
  const [{ existen, usadas }] = (await db.query(`SELECT count(*)::int AS existen, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documentos d WHERE d.practica_id = p.id))::int AS usadas
    FROM practicas p WHERE p.id = ANY($1::uuid[])`, [ids])).rows;
  console.log(JSON.stringify({ ultimoEstudianteUsado: ultimo, desde, hasta: desde + cantidad - 1, practicasExistentes: existen, practicasConDocumentos: usadas }));
  await db.end();
  if (existen !== cantidad || usadas > 0) { console.error('RANGO NO DISPONIBLE: elija otro desde/cantidad'); process.exit(1); }
})().catch((e) => { console.error(e.message); process.exit(1); });
