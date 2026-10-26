import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { KeyObject, generateKeyPairSync, sign } from 'node:crypto';
import { OidcCallbackDto } from '../src/application/dtos/auth.dto';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import { OidcService } from '../src/infrastructure/auth/oidc.service';
import { AuthController } from '../src/infrastructure/controllers/auth.controller';

/**
 * AuthController con OIDC simulado (sin Google) y la matriz del ingreso abierto.
 * El servicio OIDC es el real; solo `fetch` y los repositorios son dobles.
 */

const CLIENT_ID = 'cliente-de-prueba.apps.googleusercontent.com';
const SECRETO = 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres';
const KID = 'clave-1';
const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...par.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const ENTORNO_OIDC = {
  AUTH_MODO: 'oidc',
  SIPRA_AMBIENTE: 'qa',
  JWT_SECRETO: SECRETO,
  JWT_EXPIRACION: '8h',
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: 'secreto-del-cliente',
  OIDC_REDIRECT_URI: 'http://localhost:4200/ingreso/callback',
  OIDC_DOMINIOS_PERMITIDOS: 'cun.edu.co',
};

const b64 = (objeto: unknown): string => Buffer.from(JSON.stringify(objeto)).toString('base64url');

function idToken(nonce: string, clave: KeyObject = par.privateKey): string {
  const cabecera = b64({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const carga = b64({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
    sub: '1234567890', email: 'ana.perez@cun.edu.co', email_verified: true, name: 'Ana Pérez',
    hd: 'cun.edu.co', nonce,
  });
  const firma = sign('RSA-SHA256', Buffer.from(`${cabecera}.${carga}`), clave).toString('base64url');
  return `${cabecera}.${carga}.${firma}`;
}

function simularGoogle(token: () => Response | Promise<Response>): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (entrada: unknown) => {
    const url = String(entrada);
    if (url.includes('/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
    if (url.includes('oauth2.googleapis.com/token')) return token();
    throw new Error(`URL no simulada: ${url}`);
  });
}

function usuarioDePrueba(sobrescribe: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: 'u-1', nombre: 'Ana Pérez', correo: 'ana.perez@cun.edu.co', rol: 'coordinador',
    permiso: 'escritura', escuelas: ['ing'], empresaId: null, activo: true,
    ...sobrescribe,
  };
  return { ...base, registrarAcceso: jest.fn(), instantanea: () => ({ ...base }) };
}

function montar(entorno: Record<string, unknown>, usuario: Record<string, unknown> | null = usuarioDePrueba()) {
  const usuarios = { buscarPorCorreo: jest.fn().mockResolvedValue(usuario), guardar: jest.fn().mockResolvedValue(undefined) };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const ingresarAbierto = { ejecutar: jest.fn().mockResolvedValue(usuarioDePrueba()) };
  const listarPerfiles = { ejecutar: jest.fn().mockResolvedValue([]) };
  const config = new ConfigService(entorno);
  const jwt = new JwtService({ secret: SECRETO });
  const controlador = new AuthController(
    ingresarAbierto as never, listarPerfiles as never, usuarios as never, jwt, config,
    new OidcService(config), auditoria as never,
  );
  return { controlador, usuarios, auditoria, ingresarAbierto, listarPerfiles, jwt };
}

/** Inicia el ingreso como lo haría el SPA y devuelve el state y el nonce que viajó a Google. */
function iniciar(controlador: AuthController): { state: string; nonce: string } {
  const { url, state } = controlador.iniciarOidc();
  return { state, nonce: new URL(url).searchParams.get('nonce') ?? '' };
}

afterEach(() => jest.restoreAllMocks());

describe('AuthController · ingreso institucional (OIDC)', () => {
  it('inicio: entrega url y state, sin nonce aparte', () => {
    const { controlador } = montar(ENTORNO_OIDC);
    const resultado = controlador.iniciarOidc();
    expect(Object.keys(resultado).sort()).toEqual(['state', 'url']);
  });

  it('callback correcto: emite la sesión, audita y registra el acceso', async () => {
    const { controlador, usuarios, auditoria, jwt } = montar(ENTORNO_OIDC);
    const { state, nonce } = iniciar(controlador);
    simularGoogle(() => new Response(JSON.stringify({ id_token: idToken(nonce) }), { status: 200 }));

    const sesion = await controlador.callbackOidc({ code: 'codigo-de-prueba', state });

    expect(sesion).toMatchObject({ id: 'u-1', correo: 'ana.perez@cun.edu.co', rol: 'coordinador', modo: 'oidc' });
    const carga = await jwt.verifyAsync<{ sub: string; rol: string }>(sesion.accessToken);
    expect(carga).toMatchObject({ sub: 'u-1', rol: 'coordinador' });
    expect(usuarios.guardar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }), AccionAuditada.SESION_INICIADA, 'usuario', 'u-1', { modo: 'oidc' },
    );
  });

  it('state inválido → 401 y no se emite sesión', async () => {
    const { controlador, auditoria } = montar(ENTORNO_OIDC);
    const llamadas = simularGoogle(() => new Response('{}'));
    await expect(controlador.callbackOidc({ code: 'codigo', state: 'state-falso' }))
      .rejects.toThrow(UnauthorizedException);
    expect(llamadas).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('state ausente o code ausente → rechazados', async () => {
    const { controlador } = montar(ENTORNO_OIDC);
    const { state } = iniciar(controlador);
    simularGoogle(() => new Response('{}'));
    await expect(controlador.callbackOidc({ code: 'codigo', state: '' })).rejects.toThrow(UnauthorizedException);
    await expect(controlador.callbackOidc({ code: '', state })).rejects.toThrow(BadRequestException);
  });

  it('usuario inexistente → rechazado, sin sesión', async () => {
    const { controlador, auditoria } = montar(ENTORNO_OIDC, null);
    const { state, nonce } = iniciar(controlador);
    simularGoogle(() => new Response(JSON.stringify({ id_token: idToken(nonce) }), { status: 200 }));
    await expect(controlador.callbackOidc({ code: 'codigo', state })).rejects.toThrow(/perfil activo/);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('usuario inactivo → rechazado, sin sesión', async () => {
    const { controlador, usuarios, auditoria } = montar(ENTORNO_OIDC, usuarioDePrueba({ activo: false }));
    const { state, nonce } = iniciar(controlador);
    simularGoogle(() => new Response(JSON.stringify({ id_token: idToken(nonce) }), { status: 200 }));
    await expect(controlador.callbackOidc({ code: 'codigo', state })).rejects.toThrow(/perfil activo/);
    expect(usuarios.guardar).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('el proveedor devuelve error → rechazado, sin sesión', async () => {
    const { controlador, auditoria } = montar(ENTORNO_OIDC);
    const { state } = iniciar(controlador);
    simularGoogle(() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(controlador.callbackOidc({ code: 'codigo', state })).rejects.toThrow(BadRequestException);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('el endpoint de tokens falla → rechazado, sin sesión', async () => {
    const { controlador, auditoria } = montar(ENTORNO_OIDC);
    const { state } = iniciar(controlador);
    simularGoogle(() => new Response('error interno', { status: 503 }));
    await expect(controlador.callbackOidc({ code: 'codigo', state })).rejects.toThrow(BadRequestException);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('en modo abierto el ingreso institucional no está activo', async () => {
    const { controlador } = montar({ ...ENTORNO_OIDC, AUTH_MODO: 'abierto' });
    expect(() => controlador.iniciarOidc()).toThrow(BadRequestException);
    await expect(controlador.callbackOidc({ code: 'c', state: 's' })).rejects.toThrow(BadRequestException);
  });
});

describe('AuthController · cuerpo del callback (DTO)', () => {
  const errores = (cuerpo: Record<string, unknown>): string[] =>
    validateSync(plainToInstance(OidcCallbackDto, cuerpo)).map((e) => e.property);

  it('acepta code y state', () => expect(errores({ code: 'abc', state: 'x.y' })).toEqual([]));
  it('code ausente o vacío → inválido', () => {
    expect(errores({ state: 'x.y' })).toContain('code');
    expect(errores({ code: '', state: 'x.y' })).toContain('code');
  });
  it('state ausente o vacío → inválido', () => {
    expect(errores({ code: 'abc' })).toContain('state');
    expect(errores({ code: 'abc', state: '' })).toContain('state');
  });
  it('valores desmesurados → inválidos', () => {
    expect(errores({ code: 'a'.repeat(3000), state: 'x.y' })).toContain('code');
    expect(errores({ code: 'abc', state: 'a'.repeat(2000) })).toContain('state');
  });
});

describe('AuthController · ingreso abierto', () => {
  const ABIERTO_DEV = {
    AUTH_MODO: 'abierto', AUTH_ABIERTO_CONFIRMADO: true, SIPRA_AMBIENTE: 'dev', JWT_SECRETO: SECRETO,
  };

  it('dev + abierto + confirmación: permite perfiles e ingreso', async () => {
    const { controlador, ingresarAbierto } = montar(ABIERTO_DEV);
    expect(controlador.modo().permiteSelectorDePerfil).toBe(true);
    await expect(controlador.perfiles()).resolves.toEqual([]);
    const sesion = await controlador.ingresar({ rol: 'coordinador' } as never);
    expect(sesion.modo).toBe('abierto');
    expect(ingresarAbierto.ejecutar).toHaveBeenCalled();
  });

  it.each([
    ['dev sin confirmación', { ...ABIERTO_DEV, AUTH_ABIERTO_CONFIRMADO: false }],
    ['dev con confirmación ausente', { ...ABIERTO_DEV, AUTH_ABIERTO_CONFIRMADO: undefined }],
    ['qa con confirmación', { ...ABIERTO_DEV, SIPRA_AMBIENTE: 'qa' }],
    ['pre', { ...ABIERTO_DEV, SIPRA_AMBIENTE: 'pre' }],
    ['prod', { ...ABIERTO_DEV, SIPRA_AMBIENTE: 'prod' }],
    ['ambiente ausente', { ...ABIERTO_DEV, SIPRA_AMBIENTE: undefined }],
    ['modo oidc', { ...ABIERTO_DEV, AUTH_MODO: 'oidc' }],
  ])('%s: ni perfiles ni ingreso emiten nada', async (_caso, entorno) => {
    const { controlador, ingresarAbierto } = montar(entorno);
    await expect(controlador.perfiles()).rejects.toThrow(BadRequestException);
    await expect(controlador.ingresar({ rol: 'administrador' } as never)).rejects.toThrow(BadRequestException);
    expect(ingresarAbierto.ejecutar).not.toHaveBeenCalled();
  });

  it('modo(): con el selector apagado fuera de dev, aunque pidan abierto', () => {
    expect(montar({ ...ABIERTO_DEV, SIPRA_AMBIENTE: 'qa' }).controlador.modo().permiteSelectorDePerfil).toBe(false);
  });

  it('modo(): sin AUTH_MODO o sin SIPRA_AMBIENTE no inventa un valor', () => {
    expect(() => montar({ ...ABIERTO_DEV, AUTH_MODO: undefined }).controlador.modo()).toThrow();
    expect(() => montar({ ...ABIERTO_DEV, SIPRA_AMBIENTE: undefined }).controlador.modo()).toThrow();
  });
});
