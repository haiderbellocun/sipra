// Huella de una base (conteo exacto por tabla de public e historico + md5 de practicas/documentos). Solo lectura.
// Uso: node herramientas/huella-base.cjs <base>   (credenciales desde el entorno: DB_HOST/DB_PORT/DB_USER/DB_PASSWORD)
const { Client } = require('pg');
(async () => {
  const db = process.argv[2];
  if (!db) throw new Error('Falta el nombre de la base');
  const c = new Client({ host: process.env.DB_HOST || '127.0.0.1', port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: db });
  await c.connect();
  const tablas = (await c.query(`SELECT schemaname, relname FROM pg_stat_user_tables WHERE schemaname IN ('public','historico') ORDER BY 1,2`)).rows;
  const out = {};
  for (const t of tablas) out[`${t.schemaname}.${t.relname}`] = (await c.query(`SELECT count(*)::int n FROM "${t.schemaname}"."${t.relname}"`)).rows[0].n;
  for (const t of ['practicas', 'documentos', 'auditoria', 'usuarios']) {
    out[`md5:${t}`] = (await c.query(`SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x::text), '')) h FROM public."${t}" x`)).rows[0].h;
  }
  console.log(JSON.stringify(out, null, 1));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
