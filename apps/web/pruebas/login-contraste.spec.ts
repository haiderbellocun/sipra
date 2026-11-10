import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Contraste WCAG del login. Lee los tokens REALES de `src/estilos/tokens.css` (no copias),
 * los resuelve por tema y compone los fondos translúcidos sobre el lienzo (peor caso: los dos
 * extremos del degradado del lienzo, sin el bloom, que solo aclara u oscurece levemente).
 */
const ruta = join(process.cwd(), 'src', 'estilos', 'tokens.css'); // las pruebas corren con cwd = apps/web;
const css = readFileSync(ruta, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Mapa = Map<string, string>;
const base: Mapa = new Map();
const oscuro: Mapa = new Map();
const claro: Mapa = new Map();
for (const [, selector, cuerpo] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const destino = selector.includes('data-theme="light"') ? claro : selector.includes('data-theme="dark"') ? oscuro : base;
  for (const [, nombre, valor] of cuerpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) destino.set(nombre, valor.trim());
}

const temas: Record<string, Mapa> = {
  oscuro: new Map([...base, ...oscuro]),
  claro: new Map([...base, ...claro]),
};

type Rgba = [number, number, number, number];

function resolver(mapa: Mapa, valor: string): string {
  let v = valor;
  for (let i = 0; i < 10; i += 1) {
    const m = /var\((--[\w-]+)\)/.exec(v);
    if (!m) return v;
    const siguiente = mapa.get(m[1]);
    if (siguiente === undefined) throw new Error(`Token sin definir: ${m[1]}`);
    v = v.replace(m[0], siguiente);
  }
  return v;
}

function parsear(valor: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(valor);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(valor);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`Color no soportado: ${valor}`);
}

const token = (tema: string, nombre: string): Rgba => {
  const mapa = temas[tema];
  const v = mapa.get(nombre);
  if (v === undefined) throw new Error(`Token sin definir: ${nombre}`);
  return parsear(resolver(mapa, v));
};

/** Compone `sobre` (con alfa) encima de `fondo` opaco. */
const componer = (sobre: Rgba, fondo: Rgba): Rgba => [
  sobre[0] * sobre[3] + fondo[0] * (1 - sobre[3]),
  sobre[1] * sobre[3] + fondo[1] * (1 - sobre[3]),
  sobre[2] * sobre[3] + fondo[2] * (1 - sobre[3]),
  1,
];

const luminancia = ([r, g, b]: Rgba): number => {
  const c = [r, g, b].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contraste = (a: Rgba, b: Rgba): number => {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

for (const tema of ['oscuro', 'claro']) {
  describe(`Contraste del login · tema ${tema}`, () => {
    // Los dos extremos del degradado del lienzo: el peor caso entre ambos.
    const lienzos = [token(tema, '--surface-canvas'), token(tema, '--surface-canvas-2')];
    const panel = lienzos.map((l) => componer(token(tema, '--surface-base'), l));

    const verificar = (nombre: string, texto: string, fondos: Rgba[], minimo: number): void => {
      it(`${nombre} ≥ ${minimo}:1`, () => {
        for (const fondo of fondos) {
          const c = contraste(componer(token(tema, texto), fondo), fondo);
          assert.ok(c >= minimo, `${nombre}: ${c.toFixed(2)}:1 (${texto})`);
        }
      });
    };

    // Texto operativo sobre el panel (translúcido compuesto sobre el lienzo).
    verificar('texto principal sobre el panel', '--text-primary', panel, 4.5);
    verificar('texto secundario sobre el panel', '--text-secondary', panel, 4.5);
    verificar('texto muted sobre el panel', '--text-muted', panel, 4.5);
    verificar('cian (etiqueta ACCESO, rol) sobre el panel', '--status-available', panel, 4.5);
    verificar('ámbar sobre el panel', '--status-review', panel, 4.5);
    verificar('coral sobre el panel', '--status-returned', panel, 4.5);
    verificar('rojo de error sobre el panel', '--text-danger', panel, 4.5);
    verificar('verde de éxito sobre el panel', '--status-success', panel, 4.5);

    // Texto sobre el lienzo (titular, subtítulo, pie mono, marca).
    verificar('texto principal sobre el lienzo', '--text-primary', lienzos, 4.5);
    verificar('subtítulo y pie mono (secundario) sobre el lienzo', '--text-secondary', lienzos, 4.5);
    // Última línea del titular: texto grande (≥ 24 px, negrita 600) → umbral AA de 3:1.
    verificar('última línea del titular (señal) sobre el lienzo, texto grande', '--signal-active', lienzos, 3);

    it('selector «Entrar como»: texto sobre superficie elevada ≥ 4.5:1', () => {
      assert.ok(contraste(token(tema, '--text-primary'), token(tema, '--surface-raised')) >= 4.5);
    });

    it('botón primario (normal y hover): texto sobre acción ≥ 4.5:1', () => {
      for (const accion of ['--action-primary', '--action-primary-hover']) {
        const c = contraste(token(tema, '--action-on-primary'), token(tema, accion));
        assert.ok(c >= 4.5, `${accion}: ${c.toFixed(2)}:1`);
      }
    });

    it('símbolo de la marca: tinta inversa sobre la señal ≥ 4.5:1', () => {
      const c = contraste(token(tema, '--text-inverse'), token(tema, '--signal-active'));
      assert.ok(c >= 4.5, `${c.toFixed(2)}:1`);
    });
  });
}
