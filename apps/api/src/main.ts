import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { crearAplicacion } from './crear-aplicacion';

async function arrancar(): Promise<void> {
  const app = await crearAplicacion();
  const config = app.get(ConfigService);
  const ambiente = config.get<string>('SIPRA_AMBIENTE') ?? 'dev';
  const log = new Logger('Arranque');

  const puerto = config.get<number>('PORT') ?? 3000;
  await app.listen({ port: puerto, host: '0.0.0.0' });

  log.log(`SIPRA PRÁCTICAS · API en http://0.0.0.0:${puerto} · ambiente ${ambiente}`);
  log.log(`Modo de autenticación: ${config.get<string>('AUTH_MODO')}`);
  if (ambiente !== 'prod') {
    log.log(`Documentación: http://0.0.0.0:${puerto}/docs/dev-only/swagger`);
  }
}

arrancar().catch((error: Error) => {
  // Una configuración inválida debe impedir el arranque, no degradar en runtime.
  new Logger('Arranque').error(error.message);
  process.exit(1);
});
