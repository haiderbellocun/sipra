// Prepara los JWT de los estudiantes sintéticos ANTES de la ventana medida (P5). Usa el modo abierto EXISTENTE de dev
// (POST /auth/ingresar): no toca el proveedor institucional ni agrega ningún bypass. Escribe performance/out/tokens.json
// (ignorado por Git): [{ i, correo, practicaId, token }]. Concurrencia acotada para no medir el login.
//
//   node performance/herramientas/preparar-tokens.cjs [desde=1] [cantidad=101] [base=http://127.0.0.1:3100/api/v1]
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const desde = Number(process.argv[2] ?? 1);
const cantidad = Number(process.argv[3] ?? 101);
const BASE = process.argv[4] ?? 'http://127.0.0.1:3100/api/v1';
const pad = (n, w) => String(n).padStart(w, '0');

async function uno(i) {
  const correo = `perf-est-${pad(i, 4)}@performance.invalid`;
  const r = await fetch(`${BASE}/auth/ingresar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rol: 'estudiante', correo }) });
  if (r.status !== 200 && r.status !== 201) throw new Error(`ingreso de ${correo}: HTTP ${r.status}`);
  const j = await r.json();
  return { i, correo, practicaId: `aaaaaaaa-0000-4000-8000-${pad(i, 12)}`, token: j.accessToken };
}

(async () => {
  const t0 = Date.now();
  const indices = Array.from({ length: cantidad }, (_, k) => desde + k);
  const salida = [];
  for (let k = 0; k < indices.length; k += 10) salida.push(...(await Promise.all(indices.slice(k, k + 10).map(uno))));
  mkdirSync(join(__dirname, '..', 'out'), { recursive: true });
  writeFileSync(join(__dirname, '..', 'out', 'tokens.json'), JSON.stringify(salida));
  console.log(`${salida.length} tokens (estudiantes ${desde}–${desde + cantidad - 1}) en ${Date.now() - t0} ms`);
})().catch((e) => { console.error(e.message); process.exit(1); });
