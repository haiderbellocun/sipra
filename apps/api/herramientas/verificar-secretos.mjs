/**
 * Escaneo local de secretos (reemplaza el paso «Buscar credenciales» del flujo de GitHub Actions
 * retirado en la bitácora 0.38.4). Multiplataforma: Node puro, sin bash ni grep.
 *
 *   npm run verificar:secretos
 *
 * Recorre los archivos que Git versionaría (versionados + nuevos no ignorados; así quedan fuera
 * node_modules, dist, .git y todo lo de .gitignore). Si Git no está disponible, recorre el árbol
 * excluyendo esas carpetas. Busca:
 *   - claves de API conocidas (OpenAI, Anthropic, Google);
 *   - claves privadas PEM;
 *   - JSON de cuenta de servicio de Google;
 *   - archivos .env sensibles versionados (se permite .env.example).
 *
 * Salida: código 0 si está limpio; 1 si encontró un posible secreto. Nunca imprime el valor
 * completo: solo archivo, línea, tipo y una huella enmascarada.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESTE = fileURLToPath(import.meta.url);

/** Raíz del repositorio: la que informa Git o, sin Git, dos niveles arriba de apps/api/herramientas. */
function raiz() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return join(dirname(ESTE), '..', '..', '..');
  }
}
const RAIZ = raiz();

const CARPETAS_EXCLUIDAS = new Set(['node_modules', '.git', 'dist', '.angular', 'coverage', 'out-tsc', '.almacen', 'pilot-data']);
const EXTENSIONES_BINARIAS = /\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|otf|eot|zip|gz|tgz|7z|mp4|webm|mp3|wasm|traineddata|bin|lock)$/i;
const TAMANO_MAXIMO = 2 * 1024 * 1024;

/**
 * Patrones. Exigen longitud y alfabeto reales para no saltar con ejemplos como «sk-ant-...» o
 * nombres de variables. `sk-ant-` se excluye del patrón de OpenAI para no contar dos veces.
 */
const PATRONES = [
  { tipo: 'Clave de API de Anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { tipo: 'Clave de API de OpenAI', re: /sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { tipo: 'Clave de API de Google', re: /AIza[0-9A-Za-z_-]{35}/g },
  { tipo: 'Secreto de cliente OAuth de Google', re: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { tipo: 'Clave privada PEM', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { tipo: 'JSON de cuenta de servicio', re: /"type"\s*:\s*"service_account"/g },
];

/** `.env`, `.env.dev`, `.env.production`, `apps/api/.env.local`…; `.env.example` y plantillas no. */
const ENV_SENSIBLE = /(^|\/)\.env(\.(?!example$|sample$|plantilla$|template$)[A-Za-z0-9_-]+)?$/;

/**
 * Excepciones explícitas: archivos que contienen patrones a propósito (este mismo escáner).
 * Si una prueba necesita un secreto sintético, agréguela aquí con su justificación.
 */
const PERMITIDOS = new Set([relative(RAIZ, ESTE).split(sep).join('/')]);

function archivosDeGit() {
  try {
    const salida = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return { versionados: salida.split('\0').filter(Boolean), conGit: true };
  } catch {
    return { versionados: null, conGit: false };
  }
}

function recorrer(dir, acumulado = []) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (!CARPETAS_EXCLUIDAS.has(entrada.name)) recorrer(join(dir, entrada.name), acumulado);
    } else if (entrada.isFile()) {
      acumulado.push(relative(RAIZ, join(dir, entrada.name)).split(sep).join('/'));
    }
  }
  return acumulado;
}

function enmascarar(valor) {
  const v = valor.replace(/\s+/g, ' ');
  return v.length <= 8 ? `${v.slice(0, 2)}… (${v.length} caracteres)` : `${v.slice(0, 6)}… (${v.length} caracteres)`;
}

const { versionados, conGit } = archivosDeGit();
const lista = (versionados ?? recorrer(RAIZ)).filter((f) => !f.split('/').some((p) => CARPETAS_EXCLUIDAS.has(p)));
const hallazgos = [];

for (const archivo of lista) {
  if (ENV_SENSIBLE.test(archivo)) hallazgos.push({ archivo, linea: '-', tipo: 'Archivo .env sensible en el repositorio', muestra: '' });
  if (PERMITIDOS.has(archivo) || EXTENSIONES_BINARIAS.test(archivo)) continue;
  const ruta = join(RAIZ, archivo);
  let contenido;
  try {
    if (statSync(ruta).size > TAMANO_MAXIMO) continue;
    contenido = readFileSync(ruta);
  } catch {
    continue; // borrado en el árbol de trabajo
  }
  if (contenido.includes(0)) continue; // binario
  const lineas = contenido.toString('utf8').split(/\r?\n/);
  lineas.forEach((texto, i) => {
    for (const { tipo, re } of PATRONES) {
      re.lastIndex = 0;
      for (const m of texto.matchAll(re)) hallazgos.push({ archivo, linea: i + 1, tipo, muestra: enmascarar(m[0]) });
    }
  });
}

console.log(`Escaneo de secretos: ${lista.length} archivos (${conGit ? 'según Git: versionados y nuevos no ignorados' : 'recorrido del árbol, sin Git'}).`);
if (hallazgos.length === 0) {
  console.log('Sin claves, claves privadas, cuentas de servicio ni archivos .env sensibles.');
  process.exit(0);
}
console.error(`\nFALLO: ${hallazgos.length} posible(s) secreto(s). Valores enmascarados; revise cada archivo:`);
for (const h of hallazgos) console.error(`  ${h.archivo}:${h.linea}  ${h.tipo}${h.muestra ? `  [${h.muestra}]` : ''}`);
console.error('\nSi es real: retírelo, rótelo en el proveedor y llévelo a Secret Manager. Si es sintético a propósito, documente la excepción en PERMITIDOS.');
process.exit(1);
