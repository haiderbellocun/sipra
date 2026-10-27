import '@angular/compiler';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HttpClient } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { of } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { rolGuard, sesionGuard } from '@core/guards/sesion.guard';
import { Rol, Sesion } from '@core/models/modelos';

const sesionDe = (rol: Rol, nombre: string): Sesion => ({
  accessToken: `token-${rol}`, expiraEn: '2099-01-01T00:00:00Z', id: `id-${rol}`, nombre, correo: `${rol}@cun.edu.co`,
  rol, escuelas: [], empresaId: null, modo: 'abierto',
});

const almacen = () => {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
    removeItem: (k: string) => { datos.delete(k); },
  };
};

describe('SesionService: cerrar sesión y cambiar de usuario', () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  let storage: ReturnType<typeof almacen>;
  let navegaciones: unknown[][];
  let injector: Injector;
  let servicio: SesionService;

  const crear = () => {
    const router = {
      navigate: (...args: unknown[]) => { navegaciones.push(args); return Promise.resolve(true); },
      createUrlTree: (comandos: unknown[]) => ({ comandos }) as unknown as UrlTree,
    };
    const http = {
      post: (_url: string, cuerpo: { rol: Rol }) => of(sesionDe(cuerpo.rol, `Persona ${cuerpo.rol}`)),
    };
    injector = Injector.create({
      providers: [
        { provide: Router, useValue: router },
        { provide: HttpClient, useValue: http },
        { provide: SesionService, useClass: SesionService, deps: [] },
      ],
    });
    servicio = runInInjectionContext(injector, () => injector.get(SesionService));
  };

  beforeEach(() => {
    storage = almacen();
    navegaciones = [];
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    crear();
  });
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = original; });

  for (const rol of ['coordinador', 'auxiliar', 'estudiante'] as const) {
    it(`${rol}: cerrar sesión limpia token y estado y navega a /ingreso`, async () => {
      await servicio.ingresar(rol);
      assert.equal(servicio.autenticado(), true);
      assert.ok(storage.datos.has('sipra.sesion'));

      servicio.salir();

      assert.equal(servicio.autenticado(), false);
      assert.equal(servicio.token(), null);
      assert.equal(servicio.rol(), null);
      assert.equal(storage.datos.has('sipra.sesion'), false);
      assert.deepEqual(navegaciones.at(-1), [['/ingreso']]);
    });
  }

  it('cambiar de coordinación a auxiliar no requiere limpiar el almacenamiento a mano', async () => {
    await servicio.ingresar('coordinador');
    servicio.cambiarUsuario();
    assert.equal(servicio.autenticado(), false);
    assert.equal(storage.datos.has('sipra.sesion'), false);
    assert.deepEqual(navegaciones.at(-1), [['/ingreso']]);

    await servicio.ingresar('auxiliar');
    assert.equal(servicio.rol(), 'auxiliar');
    assert.equal(servicio.token(), 'token-auxiliar');
    assert.equal(JSON.parse(storage.datos.get('sipra.sesion') ?? '{}').rol, 'auxiliar');
  });

  it('tras cerrar sesión, una ruta protegida redirige a /ingreso', async () => {
    await servicio.ingresar('coordinador');
    const ruta = {} as never;
    const estado = {} as never;
    assert.equal(runInInjectionContext(injector, () => sesionGuard(ruta, estado)), true);
    assert.equal(runInInjectionContext(injector, () => rolGuard('coordinador')(ruta, estado)), true);

    servicio.salir();

    assert.deepEqual((runInInjectionContext(injector, () => sesionGuard(ruta, estado)) as unknown as { comandos: unknown[] }).comandos, ['/ingreso']);
    assert.deepEqual((runInInjectionContext(injector, () => rolGuard('coordinador')(ruta, estado)) as unknown as { comandos: unknown[] }).comandos, ['/ingreso']);
  });

  it('un servicio nuevo (recarga de página) no recupera la sesión cerrada', async () => {
    await servicio.ingresar('estudiante');
    servicio.salir();
    crear();
    assert.equal(servicio.autenticado(), false);
  });

  it('si el almacenamiento falla, cerrar sesión igual limpia el estado y navega', async () => {
    await servicio.ingresar('auxiliar');
    storage.removeItem = () => { throw new Error('bloqueado'); };
    servicio.salir();
    assert.equal(servicio.autenticado(), false);
    assert.deepEqual(navegaciones.at(-1), [['/ingreso']]);
  });
});
