import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as LoggerPino } from 'nestjs-pino';
import { AppModule } from './infrastructure/modules/app.module';

/**
 * Construcción de la aplicación, sin abrir el puerto.
 *
 * El destino de producción es Cloud Run, donde `main.ts` la pone a escuchar.
 * Separar la construcción de la escucha permite además inyectarle peticiones
 * desde un entorno sin servidor (ver `infra/netlify`), que es como se sirve el
 * ambiente puente mientras Tecnología entrega los proyectos de Google Cloud.
 */
export async function crearAplicacion(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Fastify como adaptador HTTP: alto rendimiento y baja latencia.
    new FastifyAdapter({ trustProxy: true, bodyLimit: 12 * 1_048_576 }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(LoggerPino));
  const config = app.get(ConfigService);
  const ambiente = config.get<string>('SIPRA_AMBIENTE') ?? 'dev';

  await app.register(import('@fastify/helmet'), {
    contentSecurityPolicy: false, // la API no sirve HTML
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(import('@fastify/multipart'), {
    limits: {
      fileSize: (config.get<number>('DOC_TAMANO_MAXIMO_MB') ?? 10) * 1_048_576,
      files: 1,
    },
  });

  app.setGlobalPrefix(config.get<string>('API_PREFIJO') ?? 'api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.get<string>('API_VERSION') ?? '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // Errores genéricos hacia afuera: no confirman la existencia de registros.
      disableErrorMessages: ['pre', 'prod'].includes(ambiente),
    }),
  );

  app.enableCors({
    origin: (config.get<string>('CORS_ORIGENES') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Swagger: fuera de producción, donde la superficie documentada no se expone.
  if (ambiente !== 'prod') {
    const documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SIPRA PRÁCTICAS — API')
        .setDescription(
          'Sistema Integrado de Prácticas y Relacionamiento Académico-Empresarial · CUN.\n\n' +
            'Arquitectura hexagonal sobre NestJS. La identidad se resuelve siempre desde el ' +
            'token de sesión; el alcance de visibilidad se aplica en el servidor.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .addTag('Autenticación', 'M1 — Identidad, perfiles y permisos')
        .addTag('Prácticas', 'M2 — Ciclo de vida de la práctica')
        .addTag('Documentos', 'M3 y M4 — Gestión documental y pipeline de validación')
        .addTag('Cumplimiento normativo', 'M5 y M11 — Obligaciones y auditoría')
        .addTag('Empresas', 'M6 — Registro, verificación y habilitación')
        .addTag('Bolsa de empleo', 'M7 — Vacantes y postulaciones')
        .build(),
    );
    SwaggerModule.setup('docs/dev-only/swagger', app, documento, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  new Logger('Arranque').log(`Aplicación construida · ambiente ${ambiente}`);
  return app;
}
