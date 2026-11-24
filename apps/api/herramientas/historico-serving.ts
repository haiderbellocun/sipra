/* eslint-disable no-console */
/**
 * Publica el serving analítico del histórico (H5, §29): construye la proyección de las versiones vigentes, la valida y
 * cambia el puntero de publicación en una transacción (Reportes nunca ve un refresco a medias). Se ejecuta con el rol de
 * carga; la API solo lo lee. Lo invocan también `historico:import --apply` y `historico:revert` al terminar.
 *
 *   HISTORICO_IMPORT_APPLY=true DB_URL=… npm run historico:serving -- [--sistema SGP|SGP_SINTETICO]
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConstruirServingHistoricoUseCase } from '../src/application/use-cases/analitica/construir-serving.use-case';
import { SISTEMAS_ORIGEN, SistemaOrigen } from '../src/domain/historico/registro-historico';
import { AnaliticaUnificadaPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/analitica-unificada.adapter';
import { ServingAnaliticoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/serving-analitico.adapter';
import { compuertaApplyHabilitada } from '../src/infrastructure/historico/configuracion-historico';

export async function publicarServing(ds: DataSource, sistema: SistemaOrigen, salida: (l: string) => void = console.log): Promise<void> {
  const t0 = Date.now();
  const r = await new ConstruirServingHistoricoUseCase(new AnaliticaUnificadaPostgresAdapter(ds), new ServingAnaliticoPostgresAdapter(ds)).ejecutar(sistema);
  salida(`Serving ${sistema} publicado: versión ${r.version} · ${r.filas} filas · ${r.practicas} prácticas elegibles · ${Date.now() - t0} ms`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--sistema');
  const sistema = (i >= 0 ? argv[i + 1] : 'SGP') as SistemaOrigen;
  if (!SISTEMAS_ORIGEN.includes(sistema)) throw new Error(`--sistema debe ser uno de: ${SISTEMAS_ORIGEN.join(', ')}`);
  if (!compuertaApplyHabilitada(process.env)) throw new Error('Rechazado: publicar el serving exige HISTORICO_IMPORT_APPLY=true. No se escribió nada.');
  const url = process.env.DB_URL?.trim();
  if (!url) throw new Error('Defina DB_URL');
  const ds = await new DataSource({ type: 'postgres', url, ssl: false, extra: { max: 2, application_name: 'sipra-historico-serving' } }).initialize();
  try {
    await publicarServing(ds, sistema);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
