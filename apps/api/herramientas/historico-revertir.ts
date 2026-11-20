/* eslint-disable no-console */
/**
 * Reversión de UNA importación del histórico del SGP (H2). La unidad es la importación (nunca un registro suelto):
 * retira sus versiones, restituye como vigente la versión anterior de cada registro y la marca `reverted`, en una
 * transacción y bajo el mismo bloqueo consultivo que la importación. Solo se revierte la última `completed`.
 *
 *   HISTORICO_IMPORT_APPLY=true DB_URL=… npm run historico:revert -- --import-id <uuid>
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { RevertirImportacionHistoricoUseCase } from '../src/application/use-cases/historico/revertir-importacion-historico.use-case';
import { HistoricoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { compuertaApplyHabilitada } from '../src/infrastructure/historico/configuracion-historico';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--import-id');
  const id = i >= 0 ? argv[i + 1] : undefined;
  if (!id) throw new Error('Falta --import-id <uuid>');
  if (!compuertaApplyHabilitada(process.env)) throw new Error('Reversión rechazada: falta HISTORICO_IMPORT_APPLY=true. No se escribió nada.');
  const url = process.env.DB_URL?.trim();
  if (!url) throw new Error('Defina DB_URL');
  const ds = await new DataSource({ type: 'postgres', url, ssl: false, extra: { max: 2, application_name: 'sipra-historico-revert' } }).initialize();
  try {
    const r = await new RevertirImportacionHistoricoUseCase(new HistoricoPostgresAdapter(ds)).ejecutar(id);
    console.log(`Importación ${r.importacionId} revertida: ${r.versionesRetiradas} versiones retiradas, ${r.vigentesRestituidas} versiones anteriores restituidas como vigentes.`);
  } finally {
    await ds.destroy();
  }
}

main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
