import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { tonoDe } from '@shared/components/senal-estado.component';

// Las pruebas corren con cwd = apps/web.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const practicas = src('app', 'features', 'practicas', 'practicas.component.ts');
const globales = new Set([...src('estilos.css').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(practicas)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(practicas)?.[1] ?? '';

describe('Prácticas V3 (lista)', () => {
  it('no reutiliza nombres de clase globales de estilos.css', () => {
    const propias = new Set([...estilos.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
    assert.deepEqual([...propias].filter((c) => globales.has(c)), []);
  });
  it('conserva los 13 controles de filtro con sus ids y la consulta de siempre', () => {
    for (const id of ['f-busqueda', 'f-periodo', 'f-programa', 'f-regional', 'f-modalidad', 'f-estado', 'f-asignacion', 'f-nivel', 'f-desde', 'f-hasta', 'f-cargado', 'f-aprobado', 'f-cantidad']) {
      assert.match(plantilla, new RegExp(`id="${id}"`), id);
    }
    assert.match(practicas, /this\.api\.listarPracticas\(\{\s*\.\.\.this\.f,/);
    assert.match(plantilla, /\(keyup\.enter\)="consultar\(\)"/);
  });
  it('los filtros del panel van en divulgación progresiva (button con aria-expanded/aria-controls)', () => {
    assert.match(plantilla, /\[attr\.aria-expanded\]="panelAbierto\(\)" aria-controls="filtros-practicas"/);
    assert.match(plantilla, /id="filtros-practicas" \[hidden\]="!panelAbierto\(\)"/);
  });
  it('navega al expediente con un enlace real (no una fila clicable)', () => {
    assert.match(plantilla, /<a \[routerLink\]="\['\/practicas', p\.id\]">\{\{ p\.estudianteNombre \}\}<\/a>/);
    assert.doesNotMatch(plantilla, /<tr[^>]*\(click\)/);
  });
  it('distingue «sin práctica», «sin resultados para estos filtros» y «sin resultados»', () => {
    assert.match(plantilla, /titulo="Sin práctica registrada"/);
    assert.match(plantilla, /titulo="Sin resultados para estos filtros"/);
    assert.match(plantilla, /titulo="Sin resultados"/);
  });
  it('usa los componentes V3 compartidos con Inicio', () => {
    for (const s of ['sipra-senal-estado', 'sipra-tira-metricas', 'sipra-carga-senal', 'sipra-estado-vacio']) assert.match(plantilla, new RegExp(`<${s}`), s);
  });
});

describe('Kit V3 · señal de estado', () => {
  it('tono por estado y señal de práctica (mismo criterio que sipra-estado)', () => {
    assert.equal(tonoDe('activa'), 'ok');
    assert.equal(tonoDe('en_validacion'), 'aviso');
    assert.equal(tonoDe('en_riesgo'), 'peligro');
    assert.equal(tonoDe('finalizada'), 'info');
    assert.equal(tonoDe('inscrita'), 'neutra');
    assert.equal(tonoDe('desconocido'), 'neutra');
    assert.equal(tonoDe(null), 'neutra');
  });
});
