// Ejecutor mínimo de pruebas del frontend. No hay Karma, Jasmine ni Vitest en el
// repositorio (y no se agregan dependencias): se empaqueta cada `*.spec.ts` con esbuild
// (ya presente por @angular/build) y se corre con el ejecutor nativo de Node.
// Cubre la lógica de estado y las reglas visuales (servicios con signals en modo JIT,
// sin DOM). El renderizado real se verifica en navegador (ver DOCUMENTO-TECNICO.md).
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entradas = readdirSync(join(raiz, 'pruebas')).filter((f) => f.endsWith('.spec.ts')).map((f) => join(raiz, 'pruebas', f));
const salida = mkdtempSync(join(tmpdir(), 'sipra-web-pruebas-'));

try {
  await build({
    entryPoints: entradas,
    outdir: salida,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: 'inline',
    tsconfig: join(raiz, 'tsconfig.json'),
    // Los paquetes de Angular se empaquetan: son ESM y se resuelven con los alias del tsconfig.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
  });
  const archivos = readdirSync(salida).filter((f) => f.endsWith('.mjs')).map((f) => join(salida, f));
  const r = spawnSync(process.execPath, ['--test', '--test-force-exit', ...archivos], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(salida, { recursive: true, force: true });
}
