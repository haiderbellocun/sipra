/* eslint-disable no-console */
/**
 * Genera el fixture SINTÉTICO del SGP (v1 y v2) en una carpeta temporal, para cargarlo con `historico:import
 * --source-system SGP_SINTETICO`. Nada de esto sale del archivo real.
 *
 *   npm run historico:fixture -- --out <carpeta>
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { escribirFixtureSgp } from '../test/soporte-historico-sgp';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--out');
  const carpeta = i >= 0 ? argv[i + 1] : undefined;
  if (!carpeta) throw new Error('Falta --out <carpeta>');
  await mkdir(carpeta, { recursive: true });
  for (const v of [1, 2] as const) {
    const ruta = join(carpeta, `sgp-sintetico-v${v}.xlsx`);
    const r = await escribirFixtureSgp(ruta, v);
    console.log(`${ruta}: ${r.reales} registros reales + ${r.fantasmas} filas fantasma`);
  }
}

main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
