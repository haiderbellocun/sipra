import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeyObject, generateKeyPairSync, sign } from 'node:crypto';
import { OidcService } from '../src/infrastructure/auth/oidc.service';

/**
 * OIDC sin proveedor real: Google se simula con `fetch` y con un par de claves RSA
 * generado aquí. Lo que se fija es lo que SIPRA hace con `state`, `nonce` e
 * `id_token`; no el comportamiento de Google.
 */

const CLIENT_ID = 'cliente-de-prueba.apps.googleusercontent.com';
const SECRETO = 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres';
const KID = 'clave-1';

const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
const parAjeno = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...par.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

function servicio(extra: Record<string, unknown> = {}): OidcService {
  return new OidcService(
    new ConfigService({
      AUTH_MODO: 'oidc',
      JWT_SECRETO: SECRETO,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_CLIENT_SECRET: 'secreto-del-cliente',
      OIDC_REDIRECT_URI: 'http://localhost:4200/ingreso/callback',
      OIDC_DOMINIOS_PERMITIDOS: 'cun.edu.co',
      ...extra,
    }),
  );
}

const b64 = (objeto: unknown): string => Buffer.from(JSON.stringify(objeto)).toString('base64url');
const ahora = (): number => Math.floor(Date.now() / 1000);

function idToken(
  claims: Record<string, unknown>,
  opciones: { clave?: KeyObject; kid?: string; alg?: string } = {},
): string {
  const cabecera = b64({ alg: opciones.alg ?? 'RS256', kid: opciones.kid ?? KID, typ: 'JWT' });
  const carga = b64(claims);
  const firma = sign('RSA-SHA256', Buffer.from(`${cabecera}.${carga}`), opciones.clave ?? par.privateKey);
  return `${cabecera}.${carga}.${firma.toString('base64url')}`;
}

function claims(nonce: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: ahora() + 3600,
    sub: '1234567890',
    email: 'ana.perez@cun.edu.co',
    email_verified: true,
    name: 'Ana Pérez',
    hd: 'cun.edu.co',
    nonce,
    ...extra,
  };
}

/** Google simulado: publica las claves y responde al endpoint de tokens como se le indique. */
function simularGoogle(token: () => Response | Promise<Response>): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (entrada: unknown) => {
    const url = String(entrada);
    if (url.includes('/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
    if (url.includes('oauth2.googleapis.com/token')) return token();
    throw new Error(`URL no simulada: ${url}`);
  });
}

const respuestaToken = (idTokenFirmado: string): Response =>
  new Response(JSON.stringify({ id_token: idTokenFirmado }), { status: 200 });

/** Inicia un ingreso y devuelve lo que el cliente y Google verían. */
function iniciar(oidc: OidcService): { state: string; nonce: string; url: URL } {
  const { url, state } = oidc.urlAutorizacion();
  const direccion = new URL(url);
  return { state, nonce: direccion.searchParams.get('nonce') ?? '', url: direccion };
}

afterEach(() => jest.restoreAllMocks());

describe('OIDC · URL de autorización', () => {
  it('lleva state y nonce, y no devuelve el nonce como campo aparte', () => {
    const resultado = servicio().urlAutorizacion();
    expect(Object.keys(resultado).sort()).toEqual(['state', 'url']);
    const url = new URL(resultado.url);
    expect(url.searchParams.get('state')).toBe(resultado.state);
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4200/ingreso/callback');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
  });
});

describe('OIDC · state', () => {
  it('correcto: devuelve csrf y el mismo nonce que viajó a Google', () => {
    const oidc = servicio();
    const { state, nonce } = iniciar(oidc);
    const contenido = oidc.verificarState(state);
    expect(contenido.nonce).toBe(nonce);
    expect(contenido.csrf).toBeTruthy();
  });

  it('csrf y nonce son independientes, con entropía de 256 bits y distintos en cada ingreso', () => {
    const oidc = servicio();
    const a = oidc.verificarState(iniciar(oidc).state);
    const b = oidc.verificarState(iniciar(oidc).state);
    expect(a.csrf).not.toBe(a.nonce);
    expect(a.csrf).not.toBe(b.csrf);
    expect(a.nonce).not.toBe(b.nonce);
    for (const valor of [a.csrf, a.nonce]) {
      expect(Buffer.from(valor, 'base64url')).toHaveLength(32);
    }
  });

  it('solo contiene csrf, nonce y exp: ni secretos ni datos personales', () => {
    const { state } = iniciar(servicio());
    const [carga] = state.split('.');
    const texto = Buffer.from(carga, 'base64url').toString('utf8');
    expect(Object.keys(JSON.parse(texto) as object).sort()).toEqual(['csrf', 'exp', 'nonce']);
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain('cun.edu.co');
  });

  it('firma manipulada → rechazado', () => {
    const oidc = servicio();
    const [carga, firma] = iniciar(oidc).state.split('.');
    const alterada = `${firma[0] === 'A' ? 'B' : 'A'}${firma.slice(1)}`;
    expect(() => oidc.verificarState(`${carga}.${alterada}`)).toThrow(UnauthorizedException);
  });

  it('contenido manipulado con la firma original → rechazado', () => {
    const oidc = servicio();
    const [carga, firma] = iniciar(oidc).state.split('.');
    const contenido = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as Record<string, unknown>;
    const falsificado = b64({ ...contenido, exp: ahora() + 999_999 });
    expect(() => oidc.verificarState(`${falsificado}.${firma}`)).toThrow(UnauthorizedException);
  });

  it('firmado con otro secreto → rechazado', () => {
    const { state } = iniciar(servicio({ JWT_SECRETO: 'otro-secreto-distinto-de-al-menos-treinta-y-dos' }));
    expect(() => servicio().verificarState(state)).toThrow(UnauthorizedException);
  });

  it('expirado → rechazado', () => {
    const oidc = servicio();
    const { state } = iniciar(oidc);
    expect(() => oidc.verificarState(state)).not.toThrow();
    const real = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(real + 11 * 60 * 1000);
    expect(() => oidc.verificarState(state)).toThrow(UnauthorizedException);
  });

  it.each([
    ['vacío', ''],
    ['sin punto', 'abc'],
    ['sin firma', 'abc.'],
    ['con tres partes', 'a.b.c'],
    ['no es texto', undefined as unknown as string],
  ])('%s → rechazado', (_nombre, valor) => {
    expect(() => servicio().verificarState(valor)).toThrow(UnauthorizedException);
  });
});

describe('OIDC · nonce', () => {
  it('correcto: el id_token con el nonce del state completa el ingreso', async () => {
    const oidc = servicio();
    const { state, nonce } = iniciar(oidc);
    simularGoogle(() => respuestaToken(idToken(claims(nonce))));
    const identidad = await oidc.intercambiarCodigo('codigo-de-prueba', state);
    expect(identidad).toMatchObject({ correo: 'ana.perez@cun.edu.co', dominio: 'cun.edu.co' });
  });

  it('diferente al del state → rechazado', async () => {
    const oidc = servicio();
    const { state } = iniciar(oidc);
    simularGoogle(() => respuestaToken(idToken(claims('nonce-de-otro-ingreso'))));
    await expect(oidc.intercambiarCodigo('codigo', state)).rejects.toThrow(/Nonce/);
  });

  it('token sin nonce → rechazado', async () => {
    const oidc = servicio();
    const { state } = iniciar(oidc);
    simularGoogle(() => respuestaToken(idToken(claims(undefined))));
    await expect(oidc.intercambiarCodigo('codigo', state)).rejects.toThrow(/Nonce/);
  });

  it('ausente al verificar (esperado vacío) → rechazado aunque el token traiga uno', async () => {
    simularGoogle(() => new Response('{}'));
    await expect(servicio().verificarIdToken(idToken(claims('algo')), '')).rejects.toThrow(/Nonce/);
  });

  it('esperado ausente (undefined) tampoco omite la comprobación', async () => {
    simularGoogle(() => new Response('{}'));
    await expect(
      servicio().verificarIdToken(idToken(claims(undefined)), undefined as unknown as string),
    ).rejects.toThrow(/Nonce/);
  });
});

describe('OIDC · id_token', () => {
  const NONCE = 'nonce-esperado';
  const verificar = (token: string): Promise<unknown> => {
    simularGoogle(() => new Response('{}'));
    return servicio().verificarIdToken(token, NONCE);
  };

  it('firma válida → identidad en minúsculas', async () => {
    simularGoogle(() => new Response('{}'));
    const identidad = await servicio().verificarIdToken(
      idToken(claims(NONCE, { email: 'Ana.Perez@CUN.edu.co' })),
      NONCE,
    );
    expect(identidad).toMatchObject({ correo: 'ana.perez@cun.edu.co', sub: '1234567890' });
  });

  it('firma inválida (otra clave privada) → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE), { clave: parAjeno.privateKey })))
      .rejects.toThrow(/Firma/);
  });

  it('clave desconocida (kid) → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE), { kid: 'no-existe' }))).rejects.toThrow(/Clave/);
  });

  it('algoritmo distinto de RS256 → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE), { alg: 'none' }))).rejects.toThrow(/Algoritmo/);
  });

  it('emisor incorrecto → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE, { iss: 'https://emisor-falso.example' }))))
      .rejects.toThrow(/Emisor/);
  });

  it('audience incorrecto → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE, { aud: 'otra-aplicacion' })))).rejects.toThrow(/aplicación/);
  });

  it('expirado → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE, { exp: ahora() - 60 })))).rejects.toThrow(/vencido/);
  });

  it('email no verificado → rechazado', async () => {
    await expect(verificar(idToken(claims(NONCE, { email_verified: false })))).rejects.toThrow(/verificado/);
  });

  it('dominio no permitido → rechazado', async () => {
    await expect(
      verificar(idToken(claims(NONCE, { email: 'intruso@gmail.com', hd: undefined }))),
    ).rejects.toThrow(/institucionales/);
  });

  it('malformado (sin tres partes o con JSON roto) → 401, no un error interno', async () => {
    await expect(verificar('no-es-un-jwt')).rejects.toThrow(UnauthorizedException);
    await expect(verificar('%%%.%%%.%%%')).rejects.toThrow(UnauthorizedException);
  });
});

describe('OIDC · canje del código', () => {
  it('state inválido: se rechaza antes de llamar al proveedor', async () => {
    const llamadas = simularGoogle(() => respuestaToken('x'));
    await expect(servicio().intercambiarCodigo('codigo', 'state-falso')).rejects.toThrow(UnauthorizedException);
    expect(llamadas).not.toHaveBeenCalled();
  });

  it('state ausente → rechazado sin llamar al proveedor', async () => {
    const llamadas = simularGoogle(() => respuestaToken('x'));
    await expect(servicio().intercambiarCodigo('codigo', '')).rejects.toThrow(UnauthorizedException);
    expect(llamadas).not.toHaveBeenCalled();
  });

  it('code ausente → rechazado sin llamar al proveedor', async () => {
    const oidc = servicio();
    const llamadas = simularGoogle(() => respuestaToken('x'));
    await expect(oidc.intercambiarCodigo('', iniciar(oidc).state)).rejects.toThrow(BadRequestException);
    expect(llamadas).not.toHaveBeenCalled();
  });

  it('el proveedor devuelve error → mensaje genérico, sin filtrar su detalle', async () => {
    const oidc = servicio();
    simularGoogle(() => new Response(JSON.stringify({ error: 'invalid_grant', detalle: 'secreto' }), { status: 400 }));
    const error = await oidc.intercambiarCodigo('codigo', iniciar(oidc).state).catch((e: Error) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe('No fue posible completar el ingreso institucional');
  });

  it('el endpoint de tokens cae (red) → mensaje genérico', async () => {
    const oidc = servicio();
    simularGoogle(() => { throw new Error('ECONNRESET'); });
    await expect(oidc.intercambiarCodigo('codigo', iniciar(oidc).state))
      .rejects.toThrow('No fue posible completar el ingreso institucional');
  });

  it('respuesta sin id_token o ilegible → rechazado', async () => {
    const oidc = servicio();
    simularGoogle(() => new Response('{}', { status: 200 }));
    await expect(oidc.intercambiarCodigo('codigo', iniciar(oidc).state)).rejects.toThrow(BadRequestException);
    simularGoogle(() => new Response('no es json', { status: 200 }));
    await expect(oidc.intercambiarCodigo('codigo', iniciar(oidc).state)).rejects.toThrow(BadRequestException);
  });
});
