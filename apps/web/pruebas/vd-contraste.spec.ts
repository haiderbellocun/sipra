import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { join } from 'node:path';

/**
 * Contraste WCAG de los tokens V3 que usa la Validación documental. Parsea `src/estilos/tokens.css` (primitivos + semánticos de dark y light),
 * compone los fondos translúcidos sobre `--surface-canvas` y mide la razón de contraste. Texto operativo ≥ 4.5:1; bordes de control e
 * indicadores ≥ 3:1. Los pares que NO cumplen quedan listados en `INCUMPLIMIENTOS_CONOCIDOS` (documentados, con el ajuste propuesto): la prueba
 * falla si aparece uno nuevo o si uno conocido deja de incumplir (para que la lista no envejezca).
 */

type Rgba = { r: number; g: number; b: number; a: number };
const CSS = readFileSync(join(process.cwd(), 'src/estilos/tokens.css'), 'utf8');

function bloque(selector: RegExp): Record<string, string> {
  const m = selector.exec(CSS);
  assert.ok(m, `no se encontró el bloque ${selector}`);
  const ini = CSS.indexOf('{', m.index);
  let nivel = 0; let fin = ini;
  for (let i = ini; i < CSS.length; i += 1) { if (CSS[i] === '{') nivel += 1; if (CSS[i] === '}') { nivel -= 1; if (nivel === 0) { fin = i; break; } } }
  const cuerpo = CSS.slice(ini + 1, fin).replace(/\/\*[\s\S]*?\*\//g, '');
  const vars: Record<string, string> = {};
  for (const x of cuerpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[x[1]] = x[2].trim();
  return vars;
}

const PRIMITIVOS = bloque(/:root\s*\{\s*\n?\s*\/\* ── 1\. PRIMITIVOS/);
const DARK = bloque(/:root,\s*\n:root\[data-theme="dark"\]\s*\{/);
const LIGHT = bloque(/:root\[data-theme="light"\]\s*\{\s*\n\s*color-scheme: light/);

function resolver(nombre: string, tema: Record<string, string>, nivel = 0): string {
  assert.ok(nivel < 8, `referencia circular en ${nombre}`);
  const v = tema[nombre] ?? PRIMITIVOS[nombre];
  assert.ok(v !== undefined, `token inexistente ${nombre}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? resolver(ref[1], tema, nivel + 1) : v;
}

function color(valor: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(valor);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[/,]\s*([\d.]+))?\s*\)$/.exec(valor);
  assert.ok(rgb, `color no reconocido: ${valor}`);
  return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
}

const sobre = (arriba: Rgba, abajo: Rgba): Rgba => ({
  r: arriba.r * arriba.a + abajo.r * (1 - arriba.a), g: arriba.g * arriba.a + abajo.g * (1 - arriba.a), b: arriba.b * arriba.a + abajo.b * (1 - arriba.a), a: 1,
});
const lum = (c: Rgba): number => {
  const f = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
export const razon = (a: Rgba, b: Rgba): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

interface Par { texto: string; fondo: string; minimo: 4.5 | 3; uso: string }
const TEXTOS = ['--text-muted', '--text-secondary', '--status-review', '--status-returned', '--signal-default', '--status-available', '--text-danger', '--status-success', '--status-pending', '--text-primary'];
const FONDOS = ['--surface-base', '--surface-raised', '--surface-bay'];
const PARES: Par[] = [
  ...TEXTOS.flatMap((t) => FONDOS.map((f) => ({ texto: t, fondo: f, minimo: 4.5 as const, uso: 'texto operativo' }))),
  // Bordes de control e indicadores (nodos, puntos, línea de señal) contra el fondo sobre el que se dibujan.
  ...['--border-strong', '--status-pending', '--signal-default', '--status-critical', '--status-success', '--status-review', '--status-returned'].flatMap((t) =>
    ['--surface-base', '--surface-raised'].map((f) => ({ texto: t, fondo: f, minimo: 3 as const, uso: 'borde o indicador' }))),
];

export function medir(tema: Record<string, string>): { par: Par; razon: number; ok: boolean }[] {
  const canvas = sobre(color(resolver('--surface-canvas', tema)), { r: 0, g: 0, b: 0, a: 1 });
  const compuesto = (nombre: string): Rgba => sobre(color(resolver(nombre, tema)), canvas);
  return PARES.map((par) => {
    const fondo = compuesto(par.fondo);
    const r = razon(sobre(color(resolver(par.texto, tema)), fondo), fondo);
    return { par, razon: r, ok: r >= par.minimo };
  });
}

/**
 * Pares que hoy NO cumplen (medidos con esta misma utilidad). Cada uno lleva el ajuste propuesto; los tokens son de otro responsable, así que
 * aquí solo se documentan. Formato: `tema|texto|fondo`.
 */
export const INCUMPLIMIENTOS_CONOCIDOS: Readonly<Record<string, string>> = {
  // Bahía del visor en claro (#bfd4e0): ahí NO se pone texto de estado (solo --text-secondary, que cumple 5.58:1). Se documenta por si alguien lo usa.
  'light|--text-muted|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--status-review|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--status-returned|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--status-available|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--text-danger|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--status-success|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--status-pending|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  'light|--signal-default|--surface-bay': 'Sobre la bahía clara no se usa texto de este color; ahí solo va --text-secondary.',
  // --signal-default como TEXTO en claro (3.24–3.50:1): en la pantalla el texto usa --status-available (cian-700); --signal-default queda para líneas, puntos y brillos (≥ 3:1 sobre base/raised).
  'light|--signal-default|--surface-base': 'Usar --status-available para texto; --signal-default solo para trazos/indicadores.',
  'light|--signal-default|--surface-raised': 'Usar --status-available para texto; --signal-default solo para trazos/indicadores.',
  // --border-strong en claro ya se subió a alfa .52 (≥ 3:1): resuelto en tokens.css.
};

describe('Validación documental · contraste de los tokens V3', () => {
  for (const [nombre, tema] of [['dark', DARK], ['light', LIGHT]] as const) {
    const filas = medir(tema);
    it(`${nombre}: ningún par nuevo incumple (texto ≥ 4.5:1, bordes e indicadores ≥ 3:1)`, () => {
      const fallos = filas.filter((f) => !f.ok).map((f) => `${nombre}|${f.par.texto}|${f.par.fondo}`);
      const nuevos = fallos.filter((k) => !(k in INCUMPLIMIENTOS_CONOCIDOS));
      assert.deepEqual(nuevos, [], `pares nuevos que incumplen:\n${filas.filter((f) => !f.ok).map((f) => `${f.par.texto} sobre ${f.par.fondo}: ${f.razon.toFixed(2)} (mín ${f.par.minimo})`).join('\n')}`);
    });
    it(`${nombre}: los incumplimientos conocidos siguen siendo reales (la lista no envejece)`, () => {
      const fallos = new Set(filas.filter((f) => !f.ok).map((f) => `${nombre}|${f.par.texto}|${f.par.fondo}`));
      const obsoletos = Object.keys(INCUMPLIMIENTOS_CONOCIDOS).filter((k) => k.startsWith(`${nombre}|`) && !fallos.has(k));
      assert.deepEqual(obsoletos, []);
    });
  }

  it('la utilidad mide bien: negro sobre blanco = 21:1 y gris medio sobre blanco < 4.5:1', () => {
    assert.ok(Math.abs(razon({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }) - 21) < 0.01);
    assert.ok(razon({ r: 150, g: 150, b: 150, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }) < 4.5);
  });

  it('el texto sobre el papel del inspector (tinta oscura sobre --surface-document) cumple 4.5:1 en ambos temas', () => {
    for (const tema of [DARK, LIGHT]) {
      const papel = color(resolver('--surface-document', tema));
      assert.ok(razon(color(resolver('--text-document', tema)), papel) >= 4.5);
      // Colores locales de la tabla de comparación (ver vd-motores.component.ts): ok, aviso, peligro, info y texto tenue.
      for (const c of ['#0a6a5e', '#8f5600', '#b8231f', '#04688f', '#3b5560']) assert.ok(razon(color(c), papel) >= 4.5, `${c} sobre papel`);
    }
  });
});

if (process.env['VD_CONTRASTE_VER'] === '1') {
  for (const [nombre, tema] of [['dark', DARK], ['light', LIGHT]] as const) {
    for (const f of medir(tema)) console.log(`${nombre}\t${f.ok ? 'ok ' : 'FALLA'}\t${f.razon.toFixed(2)}\t${f.par.texto} sobre ${f.par.fondo} (${f.par.minimo})`);
  }
}
