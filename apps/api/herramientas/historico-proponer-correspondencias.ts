/* eslint-disable no-console */
/**
 * Propuesta SEGURA de correspondencias organización histórica → empresa de SIPRA (§27.3). Solo NIT base exacto, DV
 * compatible y candidato único; nunca por nombre; nunca confirmadas (eso lo decide una persona). Por omisión solo
 * CUENTA; con `--apply` (y HISTORICO_IMPORT_APPLY=true) escribe propuestas en `historico.organizacion_mapping`.
 * No escribe en `public`.
 *
 *   DB_URL=… npm run historico:proponer-correspondencias -- [--source-system SGP] [--apply]
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SISTEMAS_ORIGEN, SistemaOrigen } from '../src/domain/historico/registro-historico';
import { HistoricoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { compuertaApplyHabilitada } from '../src/infrastructure/historico/configuracion-historico';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--source-system');
  const sistema = (i >= 0 ? argv[i + 1] : 'SGP') as SistemaOrigen;
  if (!SISTEMAS_ORIGEN.includes(sistema)) throw new Error(`--source-system debe ser uno de: ${SISTEMAS_ORIGEN.join(', ')}`);
  const aplicar = argv.includes('--apply');
  if (aplicar && !compuertaApplyHabilitada(process.env)) throw new Error('Rechazado: --apply exige HISTORICO_IMPORT_APPLY=true. No se escribió nada.');
  const url = process.env.DB_URL?.trim();
  if (!url) throw new Error('Defina DB_URL');
  const ds = await new DataSource({ type: 'postgres', url, ssl: false, extra: { max: 2, application_name: 'sipra-historico-correspondencias' } }).initialize();
  try {
    const r = await new HistoricoPostgresAdapter(ds).proponerCorrespondencias(sistema, aplicar);
    console.log(`Organizaciones jurídicas evaluadas: ${r.evaluadas} · con candidato único por NIT+DV: ${r.conCandidatoUnico} · propuestas escritas: ${r.propuestasCreadas}${aplicar ? '' : ' (simulacro)'}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
