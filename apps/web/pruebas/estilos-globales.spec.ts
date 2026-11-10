import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Smoke de estilos globales. Protege contra la regresión de noviembre de 2026: los tokens pasaron de estilos.css a
 * estilos/tokens.css y un `ng serve` arrancado antes del cambio de angular.json siguió sirviendo solo estilos.css, sin
 * variables ni Geist (toda la app en Times y sin layout). Aquí se verifica la configuración y que ninguna variable
 * global quede sin definir; el reinicio del servidor de desarrollo no se puede probar desde node --test.
 */
const raiz = process.cwd(); // las pruebas corren con cwd = apps/web
const leer = (...p: string[]) => readFileSync(join(raiz, ...p), 'utf8');
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const angular = JSON.parse(leer('angular.json'));
const estilosBuild: string[] = angular.projects['sipra-web'].architect.build.options.styles;
const tokens = sinComentarios(leer('src', 'estilos', 'tokens.css'));
const ambiente = sinComentarios(leer('src', 'estilos', 'ambiente.css'));
const globales = sinComentarios(leer('src', 'estilos.css'));
const definidas = (css: string) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const usadas = (css: string) => new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
const bloque = (css: string, selector: RegExp) => {
  const m = selector.exec(css);
  if (!m) return '';
  const inicio = css.indexOf('{', m.index) + 1;
  let nivel = 1, i = inicio;
  while (nivel > 0 && i < css.length) { if (css[i] === '{') nivel++; else if (css[i] === '}') nivel--; i++; }
  return css.slice(inicio, i - 1);
};

describe('Estilos globales: angular.json', () => {
  it('el build carga Geist, tokens, ambiente y estilos.css, con los tokens antes de las clases globales', () => {
    for (const hoja of ['@fontsource-variable/geist/wght.css', '@fontsource-variable/geist-mono/wght.css', 'src/estilos/tokens.css', 'src/estilos/ambiente.css', 'src/estilos.css']) {
      assert.ok(estilosBuild.includes(hoja), `falta ${hoja} en build.options.styles`);
    }
    assert.ok(estilosBuild.indexOf('src/estilos/tokens.css') < estilosBuild.indexOf('src/estilos.css'));
  });
  it('cada hoja declarada existe en disco (src o node_modules)', () => {
    for (const hoja of estilosBuild) {
      const ruta = hoja.startsWith('src/') ? join(raiz, hoja) : [join(raiz, 'node_modules', hoja), join(raiz, '..', '..', 'node_modules', hoja)].find(existsSync);
      assert.ok(ruta && existsSync(ruta), `no existe ${hoja}`);
    }
  });
  it('ninguna configuración (production/development) reemplaza la lista de estilos', () => {
    for (const [nombre, conf] of Object.entries<Record<string, unknown>>(angular.projects['sipra-web'].architect.build.configurations)) {
      assert.equal(conf['styles'], undefined, `la configuración ${nombre} redefine styles`);
    }
  });
  it('index.html aplica el tema antes del primer pintado', () => {
    assert.match(leer('src', 'index.html'), /<script src="assets\/tema-inicial\.js"><\/script>/);
  });
});

describe('Estilos globales: variables', () => {
  const todas = new Set([...definidas(tokens), ...definidas(ambiente), ...definidas(globales)]);
  it('toda variable usada por estilos.css y ambiente.css está definida en las hojas globales', () => {
    const faltan = [...usadas(globales), ...usadas(ambiente)].filter((v) => !todas.has(v));
    assert.deepEqual(faltan, []);
  });
  it('los tokens no dependen de [data-theme]: :root sin atributo ya resuelve el tema oscuro', () => {
    assert.match(tokens, /:root,\s*:root\[data-theme="dark"\]\s*\{/);
  });
  it('los alias heredados que usan los módulos siguen definidos', () => {
    for (const alias of ['--bg', '--superficie', '--superficie-2', '--borde', '--texto', '--texto-tenue', '--marca', '--marca-contraste', '--ok', '--aviso', '--peligro', '--info', '--fuente', '--fuente-mono', '--fs-sm', '--fs-base', '--sp-3', '--r-md', '--sombra-tinta']) {
      assert.ok(todas.has(alias), `alias sin definir: ${alias}`);
    }
  });
  it('body toma la familia y el color de los tokens', () => {
    const body = bloque(globales, /(^|\})\s*body\s*\{/m);
    assert.match(body, /font-family:\s*var\(--fuente\)/);
    assert.match(body, /color:\s*var\(--/);
  });
});

describe('Estilos sin encapsular', () => {
  const archivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const r = join(dir, n); return statSync(r).isDirectory() ? archivos(r) : r.endsWith('.ts') ? [r] : []; });
  it('todo componente con ViewEncapsulation.None ancla cada selector en #vd-motor', () => {
    const fuera: string[] = [];
    for (const archivo of archivos(join(raiz, 'src', 'app'))) {
      const src = readFileSync(archivo, 'utf8');
      for (const dec of src.split('@Component(').slice(1)) {
        if (!/encapsulation:\s*ViewEncapsulation\.None/.test(dec)) continue;
        let css = sinComentarios((/styles:\s*\[`([\s\S]*?)`\]/.exec(dec) ?? ['', ''])[1]);
        // Los @keyframes son globales: el nombre debe llevar el prefijo vd-; sus paradas (0%, to…) no son selectores.
        for (const k of css.matchAll(/@keyframes\s+([\w-]+)/g)) if (!k[1].startsWith('vd-')) fuera.push(`${archivo.slice(raiz.length)}: @keyframes ${k[1]}`);
        css = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
        for (const m of css.matchAll(/([^{}]+)\{/g)) {
          const prelude = m[1].trim();
          if (prelude.startsWith('@')) continue;
          // Separa la lista por comas de primer nivel (las de :is()/:has() no cuentan).
          let nivel = 0, actual = '';
          const partes: string[] = [];
          for (const c of prelude) { if (c === '(') nivel++; if (c === ')') nivel--; if (c === ',' && nivel === 0) { partes.push(actual); actual = ''; } else actual += c; }
          partes.push(actual);
          for (const s of partes.map((p) => p.trim())) if (!s.startsWith('#vd-motor')) fuera.push(`${archivo.slice(raiz.length)}: ${s}`);
        }
      }
    }
    assert.deepEqual(fuera, []);
  });
});
