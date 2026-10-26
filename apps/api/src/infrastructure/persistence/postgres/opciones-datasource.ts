import { config as cargarEnv } from 'dotenv';
import { DataSourceOptions } from 'typeorm';
import { ENTIDADES_ORM } from './entities/todas.orm-entity';
import { MIGRACIONES } from './migrations/todas.migracion';

cargarEnv({ path: process.env.ENV_FILE ?? '../../.env' });
cargarEnv();

/**
 * Opciones de conexión, compartidas por la aplicación y por la CLI de TypeORM.
 *
 * En Cloud Run la conexión va por el socket del conector de Cloud SQL
 * (`/cloudsql/PROYECTO:REGION:INSTANCIA`); fuera de él, por host y puerto con TLS.
 */
export function opcionesDataSource(): DataSourceOptions {
  const socket = process.env.DB_SOCKET_PATH?.trim();
  const url = process.env.DB_URL?.trim();
  const tlsPorUrl = /sslmode=(require|verify-ca|verify-full)/.test(url ?? '');
  return {
    type: 'postgres',
    // Una sola cadena de conexión tiene prioridad: así la entregan los
    // Postgres gestionados, y evita repartir sus partes en cinco variables.
    ...(url
      ? { url }
      : socket
        ? { host: socket, extra: { socketPath: socket } }
        : { host: process.env.DB_HOST ?? 'localhost', port: Number(process.env.DB_PORT ?? 5432) }),
    ...(url
      ? {}
      : {
          username: process.env.DB_USER ?? 'sipra',
          password: process.env.DB_PASSWORD ?? 'sipra_local_dev',
          database: process.env.DB_NAME ?? 'sipra_dev',
        }),
    ssl:
      String(process.env.DB_SSL).toLowerCase() === 'true' || tlsPorUrl
        ? { rejectUnauthorized: false }
        : false,
    entities: ENTIDADES_ORM,
    migrations: MIGRACIONES,
    // `synchronize: true` está prohibido: el esquema se gobierna por migraciones.
    synchronize: false,
    migrationsRun: false,
    logging: process.env.LOG_NIVEL === 'debug' ? ['error', 'warn', 'migration'] : ['error'],
  };
}
