import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Demuestra que ni pdf.js ni Tesseract ni ZXing piden nada a la red. Se lee un
 * corpus completo (texto, rasterización, QR y OCR) en un PROCESO APARTE con un
 * bloqueo precargado en cada hilo —los hilos de trabajo heredan los argumentos del
 * proceso—: cualquier intento de conexión se anota en un archivo y se rechaza.
 * Si hubiera una sola llamada, quedaría registrada y la prueba fallaría.
 */
jest.setTimeout(300_000);

describe('La lectura local no necesita Internet', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'sipra-sin-red-'));
  const marca = join(carpeta, 'intentos.txt');
  afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

  it('texto, rasterización, QR y OCR completos, sin un solo intento de conexión', () => {
    const raiz = join(__dirname, '..');
    const proceso = spawnSync(
      process.execPath,
      [
        '-r', 'ts-node/register/transpile-only',
        '-r', join(__dirname, 'soporte-bloqueo-red.cjs'),
        join(__dirname, 'soporte-lectura-sin-red.script.ts'),
      ],
      { cwd: raiz, env: { ...process.env, SIPRA_MARCA_RED: marca, TS_NODE_PROJECT: join(raiz, 'tsconfig.json') }, encoding: 'utf8', timeout: 280_000 },
    );
    expect(proceso.status).toBe(0);

    const linea = proceso.stdout.split('\n').find((l) => l.startsWith('RESULTADO '));
    expect(linea).toBeDefined();
    const r = JSON.parse((linea as string).slice('RESULTADO '.length)) as Record<string, unknown>;
    expect(r).toMatchObject({ digitalQr: 1, digitalOcr: false, escaneadoOcr: true, escaneadoQr: 1, errores: [] });
    expect(String(r.imagenDocumento)).toMatch(/1\.032\.456\.786/);

    expect(existsSync(marca)).toBe(true);
    const registro = readFileSync(marca, 'utf8').split('\n').filter(Boolean);
    // La precarga SÍ se aplicó en los hilos de trabajo (si no, esta prueba no probaría nada)…
    expect(registro.filter((l) => l === 'cargado:hilo').length).toBeGreaterThanOrEqual(2);
    // …y nadie intentó conectarse.
    expect(registro.filter((l) => !l.startsWith('cargado:'))).toEqual([]);
  });
});
