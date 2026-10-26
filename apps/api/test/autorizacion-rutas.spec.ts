import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JwtAuthGuard } from '../src/infrastructure/auth/jwt-auth.guard';
import { PermisoEscrituraGuard } from '../src/infrastructure/auth/permiso-escritura.guard';
import {
  Autenticado, CLAVE_AUTENTICADO, CLAVE_PUBLICO, CLAVE_ROLES, Publico, Roles,
} from '../src/infrastructure/auth/roles.decorator';
import { RolesGuard } from '../src/infrastructure/auth/roles.guard';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe } from './soporte-autorizacion';

/**
 * Política de acceso de TODAS las rutas. Si alguien agrega un endpoint y olvida
 * declarar su política, esta prueba falla (y, además, el guard lo rechaza en
 * ejecución): olvidar `@Roles` ya no deja la ruta abierta a cualquier sesión.
 */

interface Ruta {
  clave: string;
  controlador: string;
  metodo: string;
  verbo: string;
  ruta: string;
  roles: Rol[] | undefined;
  publico: boolean;
  autenticado: boolean;
}

const VERBOS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const DIRECTORIO = join(__dirname, '..', 'src', 'infrastructure', 'controllers');

async function descubrirRutas(): Promise<Ruta[]> {
  const rutas: Ruta[] = [];
  for (const archivo of readdirSync(DIRECTORIO).filter((f) => f.endsWith('.controller.ts'))) {
    const modulo = (await import(join(DIRECTORIO, archivo))) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado !== 'function') continue;
      const clase = exportado as { name: string; prototype: Record<string, unknown> };
      const base = Reflect.getMetadata('path', clase) as string | undefined;
      if (base === undefined) continue; // no es un controlador

      for (const metodo of Object.getOwnPropertyNames(clase.prototype)) {
        const manejador = clase.prototype[metodo];
        if (typeof manejador !== 'function') continue;
        const verbo = Reflect.getMetadata('method', manejador) as number | undefined;
        if (verbo === undefined) continue;
        const propio = Reflect.getMetadata('path', manejador) as string;

        const meta = <T>(clave: string): T | undefined =>
          (Reflect.getMetadata(clave, manejador) ?? Reflect.getMetadata(clave, clase)) as T | undefined;
        rutas.push({
          clave: `${clase.name}.${metodo}`,
          controlador: clase.name,
          metodo,
          verbo: VERBOS[verbo],
          ruta: `/${[base, propio].filter((p) => p && p !== '/').join('/')}`,
          roles: meta<Rol[]>(CLAVE_ROLES),
          publico: meta<boolean>(CLAVE_PUBLICO) === true,
          autenticado: meta<boolean>(CLAVE_AUTENTICADO) === true,
        });
      }
    }
  }
  return rutas;
}

let RUTAS: Ruta[] = [];
beforeAll(async () => {
  RUTAS = await descubrirRutas();
});

describe('Política de acceso · cobertura de rutas', () => {
  it('descubre las rutas de todos los controladores (no es una prueba vacía)', () => {
    expect(RUTAS.length).toBeGreaterThan(80);
    expect(new Set(RUTAS.map((r) => r.controlador)).size).toBeGreaterThanOrEqual(19);
  });

  it('toda ruta declara explícitamente @Publico, @Autenticado o @Roles', () => {
    const sinPolitica = RUTAS
      .filter((r) => !r.publico && !r.autenticado && !(r.roles && r.roles.length > 0))
      .map((r) => `${r.verbo} ${r.ruta}  (${r.clave})`);
    expect(sinPolitica).toEqual([]);
  });

  it('ninguna ruta declara roles vacíos', () => {
    expect(RUTAS.filter((r) => r.roles && r.roles.length === 0).map((r) => r.clave)).toEqual([]);
  });

  it('las rutas públicas son exactamente las conocidas: una nueva exige decidirlo aquí', () => {
    const publicas = RUTAS.filter((r) => r.publico).map((r) => `${r.verbo} ${r.ruta}`).sort();
    expect(publicas).toEqual([
      'GET /auth/modo',
      'GET /auth/oidc/inicio',
      'GET /auth/perfiles',
      'GET /documentos/descarga',
      'GET /metrics',
      'GET /salud',
      'POST /auth/ingresar',
      'POST /auth/oidc/callback',
      'POST /empresas/nit/verificar',
      'POST /empresas/solicitudes',
      'POST /trabajos/procesar',
    ]);
  });
});

describe('Política de acceso · rutas sensibles', () => {
  const rolesDe = (clave: string): Rol[] | undefined => RUTAS.find((r) => r.clave === clave)?.roles;
  const ordenados = (r: Rol[] | undefined): Rol[] => [...(r ?? [])].sort();

  it('empresas: bandeja y detalle solo para administración, coordinación, extensión y la propia empresa', () => {
    const esperados = [Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EMPRESA, Rol.EXTENSION].sort();
    expect(ordenados(rolesDe('EmpresasController.listar'))).toEqual(esperados);
    expect(ordenados(rolesDe('EmpresasController.obtener'))).toEqual(esperados);
  });

  it('documentos: consulta para estudiante, docente, auxiliar, coordinación y administración; empresa y extensión fuera', () => {
    const esperados = [Rol.ADMINISTRADOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ESTUDIANTE, Rol.TUTOR].sort();
    expect(ordenados(rolesDe('DocumentosController.listar'))).toEqual(esperados);
    expect(ordenados(rolesDe('DocumentosController.enlace'))).toEqual(esperados);
  });

  it('documentos: cargar solo estudiante, docente, coordinación y administración', () => {
    expect(ordenados(rolesDe('DocumentosController.cargar')))
      .toEqual([Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ESTUDIANTE, Rol.TUTOR].sort());
  });

  it('bitácora: ni auxiliar, ni extensión, ni empresa', () => {
    const esperados = [Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ESTUDIANTE, Rol.TUTOR].sort();
    expect(ordenados(rolesDe('BitacoraController.listar'))).toEqual(esperados);
    expect(ordenados(rolesDe('BitacoraController.estadoCierre'))).toEqual(esperados);
  });

  it('cartas: extensión y empresa no intervienen', () => {
    for (const clave of ['CartasController.generar', 'CartasController.listar', 'CartasController.pdf']) {
      expect(rolesDe(clave)).not.toContain(Rol.EXTENSION);
      expect(rolesDe(clave)).not.toContain(Rol.EMPRESA);
    }
  });

  it('administración: parámetros, diagnóstico, auditoría y cola, solo administrador', () => {
    for (const clave of [
      'AdministracionController.diagnostico', 'AdministracionController.listar',
      'AdministracionController.cambiar', 'AdministracionController.restaurar',
      'CumplimientoController.consultarAuditoria', 'TrabajosController.profundidad',
    ]) {
      expect(rolesDe(clave)).toEqual([Rol.ADMINISTRADOR]);
    }
  });
});

// ── Guards ─────────────────────────────────────────────────────────────────

class Ejemplo {
  @Publico() publica(): void { /* sin sesión */ }
  @Autenticado() autenticada(): void { /* cualquier sesión */ }
  @Roles(Rol.ADMINISTRADOR) soloAdministrador(): void { /* solo admin */ }
  @Roles(Rol.TUTOR, Rol.COORDINADOR) docentes(): void { /* tutor o coordinación */ }
  sinPolitica(): void { /* olvidada */ }
}

function contexto(
  metodo: keyof Ejemplo,
  peticion: Record<string, unknown>,
): ExecutionContext {
  return {
    getHandler: () => (Ejemplo.prototype as unknown as Record<string, () => void>)[metodo],
    getClass: () => Ejemplo,
    switchToHttp: () => ({ getRequest: () => peticion }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('@Publico pasa aun sin actor', () => {
    expect(guard.canActivate(contexto('publica', {}))).toBe(true);
  });

  it('@Autenticado pasa con cualquier rol', () => {
    for (const rol of Object.values(Rol)) {
      expect(guard.canActivate(contexto('autenticada', { actor: actorDe(rol) }))).toBe(true);
    }
  });

  it('@Roles pasa solo con un rol listado', () => {
    expect(guard.canActivate(contexto('soloAdministrador', { actor: actorDe(Rol.ADMINISTRADOR) }))).toBe(true);
    expect(() => guard.canActivate(contexto('soloAdministrador', { actor: actorDe(Rol.ESTUDIANTE) })))
      .toThrow(ForbiddenException);
    expect(guard.canActivate(contexto('docentes', { actor: actorDe(Rol.COORDINADOR) }))).toBe(true);
    expect(() => guard.canActivate(contexto('docentes', { actor: actorDe(Rol.AUXILIAR) })))
      .toThrow(ForbiddenException);
  });

  it('@Roles sin actor → denegado', () => {
    expect(() => guard.canActivate(contexto('soloAdministrador', {}))).toThrow(ForbiddenException);
  });

  it('una ruta SIN política declarada se rechaza (falla cerrada), incluso para el administrador', () => {
    for (const rol of Object.values(Rol)) {
      expect(() => guard.canActivate(contexto('sinPolitica', { actor: actorDe(rol) })))
        .toThrow(ForbiddenException);
    }
  });
});

describe('JwtAuthGuard', () => {
  const SECRETO = 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres';
  const jwt = new JwtService({ secret: SECRETO });
  const guard = new JwtAuthGuard(jwt, new Reflector());
  const carga = { sub: 'u-1', correo: 'a@cun.edu.co', rol: Rol.TUTOR, escuelas: ['ESC-NEG'], empresaId: null };

  const peticion = (cabeceras: Record<string, string | undefined>): Record<string, unknown> => ({
    headers: cabeceras, ip: '10.0.0.1',
  });

  it('@Publico no exige sesión', async () => {
    await expect(guard.canActivate(contexto('publica', peticion({})))).resolves.toBe(true);
  });

  it.each([
    ['sin cabecera', undefined],
    ['sin esquema Bearer', 'Basic abc'],
    ['Bearer vacío', 'Bearer '],
    ['token malformado', 'Bearer no-es-un-jwt'],
  ])('%s → 401', async (_caso, cabecera) => {
    await expect(guard.canActivate(contexto('autenticada', peticion({ authorization: cabecera }))))
      .rejects.toThrow(UnauthorizedException);
  });

  it('token firmado con otro secreto → 401', async () => {
    const ajeno = await new JwtService({ secret: 'otro-secreto-distinto-de-al-menos-treinta-y-dos' }).signAsync(carga);
    await expect(guard.canActivate(contexto('autenticada', peticion({ authorization: `Bearer ${ajeno}` }))))
      .rejects.toThrow(UnauthorizedException);
  });

  it('token vencido → 401', async () => {
    const vencido = await jwt.signAsync(carga, { expiresIn: '-10s' });
    await expect(guard.canActivate(contexto('autenticada', peticion({ authorization: `Bearer ${vencido}` }))))
      .rejects.toThrow(UnauthorizedException);
  });

  it('token válido → el actor sale SOLO del token, no de cabeceras del cliente', async () => {
    const token = await jwt.signAsync(carga);
    const req = peticion({
      authorization: `Bearer ${token}`,
      'x-actor-rol': 'administrador',
      'user-agent': 'pruebas',
    });
    await expect(guard.canActivate(contexto('autenticada', req))).resolves.toBe(true);
    expect(req.actor).toMatchObject({
      id: 'u-1', rol: Rol.TUTOR, escuelas: ['ESC-NEG'], permiso: 'escritura', ip: '10.0.0.1', agenteUsuario: 'pruebas',
    });
  });
});

describe('PermisoEscrituraGuard', () => {
  const guard = new PermisoEscrituraGuard(new Reflector());
  const con = (metodo: string, permiso: 'consulta' | 'escritura', ruta: keyof Ejemplo = 'autenticada'): ExecutionContext =>
    contexto(ruta, { method: metodo, actor: actorDe(Rol.COORDINADOR, { permiso }) });

  it('un usuario de consulta puede leer', () => {
    for (const metodo of ['GET', 'HEAD', 'OPTIONS']) expect(guard.canActivate(con(metodo, 'consulta'))).toBe(true);
  });

  it('un usuario de consulta no puede escribir (POST, PUT, PATCH, DELETE)', () => {
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(() => guard.canActivate(con(metodo, 'consulta'))).toThrow(ForbiddenException);
    }
  });

  it('un usuario con permiso de escritura puede escribir', () => {
    expect(guard.canActivate(con('POST', 'escritura'))).toBe(true);
  });

  it('una ruta pública no se somete al permiso', () => {
    expect(guard.canActivate(contexto('publica', { method: 'POST' }))).toBe(true);
  });

  it('sin actor no bloquea (lo resuelve el guard de sesión)', () => {
    expect(guard.canActivate(contexto('autenticada', { method: 'POST' }))).toBe(true);
  });
});
