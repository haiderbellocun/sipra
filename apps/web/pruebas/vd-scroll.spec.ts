import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Las pruebas corren con cwd = apps/web.
const vd = readFileSync(join(process.cwd(), 'src', 'app', 'features', 'validacion-documental', 'validacion-documental.component.ts'), 'utf8');
const motor = readFileSync(join(process.cwd(), 'src', 'app', 'features', 'validacion-documental', 'vd-motores.component.ts'), 'utf8');
const escritorio = vd.slice(vd.indexOf('@media (width >= 1024px) {'), vd.indexOf('@media (width >= 1024px) and (height < 820px)'));

describe('Validación documental · ergonomía de scroll (≥ 1024)', () => {
  it('la página no queda bloqueada al viewport: .cuerpo crece (min-height) y no recorta (sin overflow:hidden ni height fijo)', () => {
    const cuerpo = /\.cuerpo \{[^}]*\}/.exec(escritorio)?.[0] ?? '';
    assert.match(cuerpo, /min-height:calc\(100dvh - var\(--alto-cinta, 0px\)\)/);
    assert.doesNotMatch(cuerpo, /overflow:hidden|[^-]height:calc/);
  });
  it('la cola acompaña el desplazamiento (sticky, alto del viewport) y desplaza su propia lista', () => {
    assert.match(escritorio, /\.p-cola \{ position:sticky; top:calc\(var\(--alto-cinta, 0px\) \+ 8px\); height:calc\(100dvh/);
    assert.match(escritorio, /\.cola-lista \{ flex:1 1 auto; overflow-y:auto; overscroll-behavior:contain;/);
  });
  it('la mesa del documento usa el alto del viewport (bahía e inspector a pantalla completa)', () => {
    assert.match(escritorio, /\.p-doc \{ flex:none; height:calc\(100dvh - var\(--alto-cinta, 0px\) - 16px\);/);
  });
  it('el inspector desplaza solo su contenido y la barra de decisión queda sticky al pie, sin salir del motor', () => {
    assert.match(motor, /#vd-motor \.est\.est > \.col-rev \{ overflow-y:auto; min-height:0; overscroll-behavior:contain;/);
    assert.match(motor, /#vd-motor \.barra-decision\.barra-decision \{ position:sticky; bottom:0; align-self:flex-end;/);
  });
});
