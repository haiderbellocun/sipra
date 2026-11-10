import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Las pruebas corren con cwd = apps/web.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const inicio = src('app', 'features', 'inicio', 'inicio.component.ts');
const globales = new Set([...src('estilos.css').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(inicio)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(inicio)?.[1] ?? '';

describe('Inicio V3', () => {
  it('no reutiliza nombres de clase globales de estilos.css (la colisión .hero pintó una caja)', () => {
    const propias = new Set([...estilos.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)(?![\w-]*\()/g)].map((m) => m[1]));
    const choques = [...propias].filter((c) => globales.has(c));
    assert.deepEqual(choques, []);
  });
  it('mantiene los datos y el orden de siempre (mismas llamadas y la misma prioridad)', () => {
    assert.match(inicio, /this\.api\.listarPracticas\(\)/);
    assert.match(inicio, /this\.api\.listarPeriodos\(\)/);
    assert.match(inicio, /this\.api\.tableroCumplimiento\(60\)/);
    assert.match(inicio, /\{ en_riesgo: 0, requiere_atencion: 1, al_dia: 2 \}/);
    assert.match(inicio, /\.slice\(0, 12\)/);
  });
  it('envuelve el cronograma compartido sin modificarlo', () => {
    assert.match(plantilla, /<sipra-cronograma \[periodo\]="per" \/>/);
  });
  it('estados con punto + texto (no solo color) y sin spinner ni canvas', () => {
    assert.match(plantilla, /<sipra-senal-estado \[valor\]="practica\.estado" \/>/);
    assert.match(plantilla, /<sipra-tira-metricas /);
    assert.doesNotMatch(inicio.replace(/\/\*[\s\S]*?\*\//g, ''), /<canvas|spinner|WebGL|getContext\(/i);
  });
  it('respeta movimiento reducido', () => {
    assert.match(estilos, /@media \(prefers-reduced-motion: reduce\)/);
  });
});
