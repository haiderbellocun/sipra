import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeyObject, generateKeyPairSync, sign } from 'node:crypto';
import { OidcService } from '../src/infrastructure/auth/oidc.service';
import { SaludController } from '../src/infrastructure/controllers/salud.controller';
import { TrabajosController } from '../src/infrastructure/controllers/trabajos.controller';
import { tokenMetricasValido } from '../src/infrastructure/observability/acceso-metricas';

/**
 * Superficie técnica: el worker de la cola y las métricas. Google se simula con
 * `fetch` y un par de claves RSA generado aquí.
 */

const SECRETO = 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres';
const CUENTA = 'sipra-app-qa@proyecto.iam.gserviceaccount.com';
const WORKER_URL = 'https://sipra-api-qa-abc123.a.run.app';
const KID = 'clave-1';
const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
const parAjeno = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...par.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const ahora = (): number => Math.floor(Date.now() / 1000);

function tokenDeServicio(
  extra: Record<string, unknown> = {},
  clave: KeyObject = par.privateKey,
): string {
  const cabecera = b64({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const carga = b64({
    iss: 'https://accounts.google.com', aud: WORKER_URL, exp: ahora() + 3600,
    email: CUENTA, email_verified: true, ...extra,
  });
  const firma = sign('RSA-SHA256', Buffer.from(`${cabecera}.${carga}`), clave).toString('base64url');
  return `${cabecera}.${carga}.${firma}`;
}

function simularCertificados(): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (entrada: unknown) => {
    if (String(entrada).includes('/oauth2/v3/certs')) {
      return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
    }
    throw new Error(`URL no simulada: ${String(entrada)}`);
  });
}

afterEach(() => jest.restoreAllMocks());

// ── Worker ─────────────────────────────────────────────────────────────────

const TRABAJO = { tipo: 'validar_documento', referencia: 'doc-1', prioridad: 'interactiva' } as const;

function montarWorker(entorno: Record<string, unknown>) {
  const procesar = { ejecutar: jest.fn().mockResolvedValue(undefined) };
  const config = new ConfigService({ JWT_SECRETO: SECRETO, ...entorno });
  const controlador = new TrabajosController(procesar as never, {} as never, config, new OidcService(config));
  return { controlador, procesar };
}

const CLOUD_TASKS = { COLA_DRIVER: 'cloud_tasks', GCP_CUENTA_SERVICIO: CUENTA, WORKER_URL };

describe('Worker · COLA_DRIVER=cloud_tasks', () => {
  it('invocación legítima: token de la cuenta de servicio emitido para el worker → ejecuta el trabajo', async () => {
    simularCertificados();
    const { controlador, procesar } = montarWorker(CLOUD_TASKS);
    await controlador.procesarTrabajo({ ...TRABAJO }, `Bearer ${tokenDeServicio()}`);
    expect(procesar.ejecutar).toHaveBeenCalledWith(TRABAJO);
  });

  it.each([
    ['sin cabecera', undefined],
    ['sin esquema Bearer', 'abc'],
    ['token malformado', 'Bearer no-es-un-jwt'],
    ['JSON ilegible (no es un 500)', 'Bearer %%%.%%%.%%%'],
  ])('invocación arbitraria: %s → 401 y no se ejecuta nada', async (_caso, cabecera) => {
    simularCertificados();
    const { controlador, procesar } = montarWorker(CLOUD_TASKS);
    await expect(controlador.procesarTrabajo({ ...TRABAJO }, cabecera)).rejects.toThrow(UnauthorizedException);
    expect(procesar.ejecutar).not.toHaveBeenCalled();
  });

  it.each([
    ['firma de otra clave', () => tokenDeServicio({}, parAjeno.privateKey)],
    ['otra cuenta de servicio', () => tokenDeServicio({ email: 'intruso@proyecto.iam.gserviceaccount.com' })],
    ['audiencia de otro servicio', () => tokenDeServicio({ aud: 'https://otro-servicio.a.run.app' })],
    ['sin audiencia', () => tokenDeServicio({ aud: undefined })],
    ['emisor falso', () => tokenDeServicio({ iss: 'https://emisor-falso.example' })],
    ['vencido', () => tokenDeServicio({ exp: ahora() - 60 })],
    ['correo no verificado', () => tokenDeServicio({ email_verified: false })],
  ])('token con %s → 401', async (_caso, fabricar) => {
    simularCertificados();
    const { controlador, procesar } = montarWorker(CLOUD_TASKS);
    await expect(controlador.procesarTrabajo({ ...TRABAJO }, `Bearer ${fabricar()}`)).rejects.toThrow(UnauthorizedException);
    expect(procesar.ejecutar).not.toHaveBeenCalled();
  });

  it('falla cerrada: sin identidad de servicio o sin URL del worker configuradas, nada se ejecuta', async () => {
    simularCertificados();
    for (const faltante of ['GCP_CUENTA_SERVICIO', 'WORKER_URL']) {
      const { controlador, procesar } = montarWorker({ ...CLOUD_TASKS, [faltante]: undefined });
      await expect(controlador.procesarTrabajo({ ...TRABAJO }, `Bearer ${tokenDeServicio()}`))
        .rejects.toThrow(UnauthorizedException);
      expect(procesar.ejecutar).not.toHaveBeenCalled();
    }
  });

  it('con identidad válida, un trabajo mal formado igual se rechaza', async () => {
    simularCertificados();
    const { controlador, procesar } = montarWorker(CLOUD_TASKS);
    await expect(
      controlador.procesarTrabajo({ ...TRABAJO, tipo: 'otro' } as never, `Bearer ${tokenDeServicio()}`),
    ).rejects.toThrow();
    expect(procesar.ejecutar).not.toHaveBeenCalled();
  });
});

describe('Worker · cola local (en_proceso / en_linea)', () => {
  it.each(['en_proceso', 'en_linea', undefined])(
    'COLA_DRIVER=%s: el endpoint no existe (404), con o sin credenciales, y no se ejecuta nada',
    async (driver) => {
      simularCertificados();
      const { controlador, procesar } = montarWorker({ ...CLOUD_TASKS, COLA_DRIVER: driver });
      await expect(controlador.procesarTrabajo({ ...TRABAJO }, undefined)).rejects.toThrow(NotFoundException);
      await expect(controlador.procesarTrabajo({ ...TRABAJO }, `Bearer ${tokenDeServicio()}`))
        .rejects.toThrow(NotFoundException);
      expect(procesar.ejecutar).not.toHaveBeenCalled();
    },
  );
});

// ── Métricas ───────────────────────────────────────────────────────────────

const TOKEN = 'token-de-metricas-de-al-menos-treinta-y-dos-caracteres';

function montarMetricas(entorno: Record<string, unknown>) {
  const metricas = { contentType: 'text/plain; version=0.0.4', exponer: jest.fn().mockResolvedValue('# HELP x\n') };
  const controlador = new SaludController({} as never, metricas as never, new ConfigService(entorno));
  const respuesta = {
    cabeceras: {} as Record<string, string>,
    cuerpo: undefined as unknown,
    header(nombre: string, valor: string) { this.cabeceras[nombre] = valor; return this; },
    send(cuerpo: unknown) { this.cuerpo = cuerpo; return Promise.resolve(); },
  };
  return { controlador, metricas, respuesta };
}

describe('Métricas · GET /metrics', () => {
  it('deshabilitadas → 404, aunque el token sea correcto', async () => {
    const { controlador, metricas, respuesta } = montarMetricas({ METRICAS_HABILITADAS: false, METRICAS_TOKEN: TOKEN });
    await expect(controlador.exponerMetricas(`Bearer ${TOKEN}`, respuesta as never)).rejects.toThrow(NotFoundException);
    expect(metricas.exponer).not.toHaveBeenCalled();
  });

  it('habilitadas pero sin token configurado → 404: nunca quedan abiertas', async () => {
    const { controlador, metricas, respuesta } = montarMetricas({ METRICAS_HABILITADAS: true });
    await expect(controlador.exponerMetricas(undefined, respuesta as never)).rejects.toThrow(NotFoundException);
    await expect(controlador.exponerMetricas('Bearer ', respuesta as never)).rejects.toThrow(NotFoundException);
    expect(metricas.exponer).not.toHaveBeenCalled();
  });

  it('habilitadas + token válido → entrega las métricas, sin caché', async () => {
    const { controlador, respuesta } = montarMetricas({ METRICAS_HABILITADAS: true, METRICAS_TOKEN: TOKEN });
    await controlador.exponerMetricas(`Bearer ${TOKEN}`, respuesta as never);
    expect(respuesta.cuerpo).toBe('# HELP x\n');
    expect(respuesta.cabeceras['cache-control']).toBe('no-store');
  });

  it.each([
    ['token incorrecto', 'Bearer otro-token-distinto-de-al-menos-treinta-y-dos'],
    ['sin cabecera', undefined],
    ['sin esquema Bearer', TOKEN],
    ['esquema Basic', `Basic ${TOKEN}`],
    ['Bearer vacío', 'Bearer '],
    ['token con prefijo del correcto', `Bearer ${TOKEN}extra`],
    ['token truncado', `Bearer ${TOKEN.slice(0, -1)}`],
  ])('habilitadas + %s → 401 y no se entregan métricas', async (_caso, cabecera) => {
    const { controlador, metricas, respuesta } = montarMetricas({ METRICAS_HABILITADAS: true, METRICAS_TOKEN: TOKEN });
    await expect(controlador.exponerMetricas(cabecera, respuesta as never)).rejects.toThrow(UnauthorizedException);
    expect(metricas.exponer).not.toHaveBeenCalled();
  });

  it('el token no aparece en el mensaje del error', async () => {
    const { controlador, respuesta } = montarMetricas({ METRICAS_HABILITADAS: true, METRICAS_TOKEN: TOKEN });
    const error = await controlador.exponerMetricas('Bearer equivocado', respuesta as never).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain('equivocado');
  });
});

describe('tokenMetricasValido', () => {
  it('compara en tiempo constante: acepta solo el token exacto', () => {
    expect(tokenMetricasValido(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMetricasValido(`Bearer ${TOKEN} `, TOKEN)).toBe(false);
    expect(tokenMetricasValido(`bearer ${TOKEN}`, TOKEN)).toBe(false);
    expect(tokenMetricasValido(`Bearer ${TOKEN}`, '')).toBe(false);
  });

  it('la decisión pasa por timingSafeEqual (no por una comparación directa de cadenas)', () => {
    const cripto = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const espia = jest.spyOn(cripto, 'timingSafeEqual');
    tokenMetricasValido(`Bearer ${TOKEN}`, TOKEN);
    tokenMetricasValido('Bearer incorrecto', TOKEN);
    expect(espia).toHaveBeenCalledTimes(2);
  });
});
