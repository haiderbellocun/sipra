import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { DOCUMENT } from '@angular/common';
import { Injector, runInInjectionContext } from '@angular/core';
import { COLOR_BARRA, TemaService } from '@core/ui/tema.service';
import { CLAVE_TEMA, atributosTema, debeAnimarTema, resolverTema } from '@shared/utils/tema';

const almacen = () => {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
    removeItem: (k: string) => { datos.delete(k); },
  };
};

describe('Tema: resolución y atributos (funciones puras)', () => {
  it('la preferencia guardada manda sobre la del sistema', () => {
    assert.equal(resolverTema('claro', false), 'claro');
    assert.equal(resolverTema('oscuro', true), 'oscuro');
  });
  it('sin preferencia guardada se respeta el sistema y, por defecto, el oscuro', () => {
    assert.equal(resolverTema(null, true), 'claro');
    assert.equal(resolverTema(null, false), 'oscuro');
    assert.equal(resolverTema('basura', false), 'oscuro');
  });
  it('el documento lleva data-theme (dark|light) y data-modo (oscuro|claro)', () => {
    assert.deepEqual(atributosTema('oscuro'), { theme: 'dark', modo: 'oscuro' });
    assert.deepEqual(atributosTema('claro'), { theme: 'light', modo: 'claro' });
  });
  it('con movimiento reducido o sin View Transitions el cambio no se anima', () => {
    assert.equal(debeAnimarTema(true, true), false);
    assert.equal(debeAnimarTema(false, false), false);
    assert.equal(debeAnimarTema(false, true), true);
  });
});

describe('TemaService: aplica y persiste el tema', () => {
  const originales = {
    ls: (globalThis as { localStorage?: unknown }).localStorage,
    mm: (globalThis as { matchMedia?: unknown }).matchMedia,
  };
  let storage: ReturnType<typeof almacen>;
  let raiz: { dataset: Record<string, string> };

  const crear = (prefiereClaro = false) => {
    (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('prefers-color-scheme: light') ? prefiereClaro : false });
    raiz = { dataset: {} };
    const inj = Injector.create({
      providers: [
        { provide: DOCUMENT, useValue: { documentElement: raiz } },
        { provide: TemaService, useClass: TemaService, deps: [] },
      ],
    });
    return runInInjectionContext(inj, () => inj.get(TemaService));
  };

  beforeEach(() => { storage = almacen(); (globalThis as { localStorage?: unknown }).localStorage = storage; });
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originales.ls;
    (globalThis as { matchMedia?: unknown }).matchMedia = originales.mm;
  });

  it('arranca en oscuro, sin preferencia guardada ni del sistema', () => {
    const t = crear(false);
    assert.equal(t.tema(), 'oscuro');
    assert.equal(t.esClaro(), false);
  });

  it('adopta el tema claro guardado (tema persistido)', () => {
    storage.setItem(CLAVE_TEMA, 'claro');
    const t = crear(false);
    assert.equal(t.tema(), 'claro');
  });

  it('establecer() cambia el tema, actualiza los atributos y lo guarda con la clave y valores de siempre', () => {
    const t = crear(false);
    t.establecer('claro');
    assert.equal(t.esClaro(), true);
    assert.equal(t.etiqueta(), 'Tema claro');
    assert.equal(storage.getItem(CLAVE_TEMA), 'claro');
    assert.deepEqual(raiz.dataset, { theme: 'light', modo: 'claro' });
    t.establecer('oscuro');
    assert.equal(storage.getItem(CLAVE_TEMA), 'oscuro');
    assert.deepEqual(raiz.dataset, { theme: 'dark', modo: 'oscuro' });
  });

  it('alternar() sin View Transitions va de oscuro a claro y de vuelta, y persiste cada cambio', () => {
    const t = crear(false);
    t.alternar();
    assert.equal(t.tema(), 'claro'); assert.equal(storage.getItem(CLAVE_TEMA), 'claro');
    t.alternar();
    assert.equal(t.tema(), 'oscuro'); assert.equal(storage.getItem(CLAVE_TEMA), 'oscuro');
  });

  it('un servicio nuevo (recarga) conserva el tema guardado', () => {
    crear(false).establecer('claro');
    assert.equal(crear(false).tema(), 'claro');
  });

  it('actualiza <meta name="theme-color"> con los mismos colores que tema-inicial.js', () => {
    const meta = { content: '', setAttribute(_k: string, v: string) { this.content = v; } };
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
    const r = { dataset: {} as Record<string, string> };
    const inj = Injector.create({ providers: [
      { provide: DOCUMENT, useValue: { documentElement: r, querySelector: (s: string) => (s === 'meta[name="theme-color"]' ? meta : null) } },
      { provide: TemaService, useClass: TemaService, deps: [] },
    ] });
    const t = runInInjectionContext(inj, () => inj.get(TemaService));
    assert.equal(meta.content, COLOR_BARRA.oscuro);
    t.establecer('claro');
    assert.equal(meta.content, COLOR_BARRA.claro);
    const inicial = readFileSync(join(process.cwd(), 'src', 'assets', 'tema-inicial.js'), 'utf8');
    assert.match(inicial, new RegExp(`'${COLOR_BARRA.claro}' : '${COLOR_BARRA.oscuro}'`));
  });
});

describe('assets/tema-inicial.js: tema aplicado antes del primer pintado (sin parpadeo)', () => {
  const ruta = join(process.cwd(), 'src', 'assets', 'tema-inicial.js'); // las pruebas corren con cwd = apps/web
  let codigo = '';
  try { codigo = readFileSync(ruta, 'utf8'); } catch { codigo = ''; }

  const ejecutar = (guardado: string | null, prefiereClaro: boolean) => {
    const meta = { content: '', setAttribute(_k: string, v: string) { this.content = v; } };
    const raiz = { dataset: {} as Record<string, string> };
    runInNewContext(codigo, {
      localStorage: { getItem: () => guardado },
      matchMedia: () => ({ matches: prefiereClaro }),
      document: { documentElement: raiz, querySelector: () => meta },
    });
    return { dataset: raiz.dataset, color: meta.content };
  };

  it('el script existe', () => assert.ok(codigo.length > 0, `no se pudo leer ${ruta}`));
  it('claro guardado → data-theme=light y color de barra claro', () => {
    const r = ejecutar('claro', false);
    assert.equal(r.dataset['theme'], 'light');
    assert.equal(r.dataset['modo'], 'claro');
    assert.equal(r.color, '#D3E4EE');
  });
  it('oscuro guardado gana al sistema claro', () => {
    assert.equal(ejecutar('oscuro', true).dataset['theme'], 'dark');
  });
  it('sin preferencia: sistema claro → light; si no → dark', () => {
    assert.equal(ejecutar(null, true).dataset['theme'], 'light');
    assert.equal(ejecutar(null, false).dataset['theme'], 'dark');
  });
});
