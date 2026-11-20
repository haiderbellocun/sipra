import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TableroCumplimiento } from '@core/models/modelos';
import {
  FILTROS_VACIOS, descripcionBarra, etiquetaCategoria, filtrosActivos, fraccionCumplidas, metricasCumplimiento, segmentos,
  textoAlcance, textoDias, tonoCategoria,
} from '../src/app/features/cumplimiento/cumplimiento.util';

// Cumplimiento V3 · presentación. Las reglas (categoría, días, orden, alcance) son del servidor.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const pagina = src('features', 'cumplimiento', 'cumplimiento.component.ts');
const tabla = src('features', 'cumplimiento', 'cumplimiento-tabla.component.ts');
const tipos = src('features', 'cumplimiento', 'cumplimiento-tipos.component.ts');
const util = src('features', 'cumplimiento', 'cumplimiento.util.ts');
const api = src('core', 'services', 'api.service.ts');

const conteo = { aplicables: 10, cumplidas: 4, enPlazo: 2, proximas: 1, vencidas: 3 };
const tablero = {
  generadoEn: '2026-11-18T20:00:00.000Z', alcance: { tipo: 'institucional', escuelas: [] },
  indicadores: { ...conteo, noAplica: 1 }, practicasBloqueadas: 2,
} as unknown as TableroCumplimiento;

describe('Cumplimiento V3 · textos', () => {
  it('días del servidor: vencida, hoy, futuro, singular/plural; la cumplida no «vence»', () => {
    assert.equal(textoDias(-1, 'vencida'), 'Vencida hace 1 día');
    assert.equal(textoDias(-12, 'vencida'), 'Vencida hace 12 días');
    assert.equal(textoDias(0, 'proxima'), 'Vence hoy');
    assert.equal(textoDias(1, 'proxima'), 'Vence en 1 día');
    assert.equal(textoDias(40, 'en_plazo'), 'Vence en 40 días');
    assert.equal(textoDias(-30, 'cumplida'), 'Cumplida');
  });
  it('fracción «X de Y» sin porcentaje', () => {
    assert.equal(fraccionCumplidas(conteo), '4 de 10 obligaciones cumplidas');
    assert.equal(fraccionCumplidas({ cumplidas: 1, aplicables: 1 }), '1 de 1 obligación cumplida');
    assert.doesNotMatch(util, /\* ?100\)?\s*[,;]?\s*\}\s*%|toFixed\(/);
  });
  it('categorías con etiqueta y tono (nunca solo color)', () => {
    assert.equal(etiquetaCategoria('proxima'), 'Próxima a vencer');
    assert.equal(tonoCategoria('vencida'), 'peligro');
    assert.equal(tonoCategoria('cumplida'), 'ok');
  });
  it('alcance legible', () => {
    assert.equal(textoAlcance({ tipo: 'institucional', escuelas: [] }), 'Institucional');
    assert.equal(textoAlcance({ tipo: 'asignados', escuelas: [] }), 'Mis prácticas asignadas');
    assert.equal(textoAlcance({ tipo: 'escuelas', escuelas: ['ESC-ING'] }), 'Escuela ESC-ING');
  });
});

describe('Cumplimiento V3 · indicadores y barras', () => {
  it('KPI desde los indicadores del servidor', () => {
    const m = metricasCumplimiento(tablero);
    assert.deepEqual(m.map((x) => [x.t, x.n]), [['Cumplidas', 4], ['Vencidas', 3], ['Próximas a vencer', 1], ['En plazo', 2], ['Prácticas detenidas', 2]]);
    assert.equal(m[0].contexto, 'de 10 aplicables');
  });
  it('segmentos en orden vencida → próxima → en plazo → cumplida, suman 100 %, omiten ceros', () => {
    const s = segmentos(conteo);
    assert.deepEqual(s.map((x) => x.categoria), ['vencida', 'proxima', 'en_plazo', 'cumplida']);
    assert.equal(Math.round(s.reduce((a, x) => a + x.ancho, 0)), 100);
    assert.deepEqual(segmentos({ ...conteo, proximas: 0, aplicables: 9 }).map((x) => x.categoria), ['vencida', 'en_plazo', 'cumplida']);
    assert.deepEqual(segmentos({ aplicables: 0, cumplidas: 0, enPlazo: 0, proximas: 0, vencidas: 0 }), []);
  });
  it('descripción accesible de cada barra', () => {
    assert.match(descripcionBarra('Afiliación a ARL', conteo), /^Afiliación a ARL: 4 de 10 obligaciones cumplidas; 3 vencidas, 1 próximas a vencer, 2 en plazo\.$/);
    assert.match(tipos, /role="img" \[attr\.aria-label\]="b\.descripcion"/);
  });
  it('filtros activos no cuentan la página', () => {
    assert.equal(filtrosActivos({ ...FILTROS_VACIOS, pagina: 4 }), 0);
    assert.equal(filtrosActivos({ ...FILTROS_VACIOS, periodo: '26V06', estado: 'vencida', busqueda: '  ' }), 2);
  });
});

describe('Cumplimiento V3 · garantías estáticas', () => {
  it('OnPush en los tres componentes', () => {
    for (const c of [pagina, tabla, tipos]) assert.match(c, /ChangeDetectionStrategy\.OnPush/);
  });
  it('sin reglas de negocio en el frontend: ni cálculo de días ni semáforo ni orden', () => {
    for (const c of [pagina, tabla, tipos, util]) {
      assert.doesNotMatch(c, /86_?400_?000|Date\.now\(\)|getTime\(\) -/);
      assert.doesNotMatch(c, /\.sort\(/);
      assert.doesNotMatch(c, /<= ?10|<= ?3\b/);
    }
  });
  it('un solo endpoint (el existente) con filtros y paginación en el servidor', () => {
    assert.match(api, /tableroCumplimientoV3\(f: Partial<FiltrosCumplimiento>\)[\s\S]{0,400}\/cumplimiento\/tablero/);
    assert.match(api, /tableroCumplimiento\(dias = 60\)/); // Inicio sigue intacto
    assert.doesNotMatch(pagina, /catalogoObligaciones\(/);
  });
  it('encabezado y bloques pedidos', () => {
    assert.match(pagina, /<h1>Cumplimiento<\/h1>/);
    assert.match(pagina, /Monitorea obligaciones, vencimientos y casos que requieren atención\./);
    assert.match(pagina, /Requiere atención/);
    assert.match(pagina, /Cumplimiento por tipo de obligación/);
    assert.match(pagina, /Reintentar/);
    assert.match(pagina, /sipra-esqueleto/);
  });
  it('la acción abre la práctica; sin colores fuera de tokens (sin púrpura ni índigo)', () => {
    assert.match(tabla, /\[routerLink\]="\['\/practicas', f\.practicaId\]"/);
    for (const c of [pagina, tabla, tipos]) assert.doesNotMatch(c, /purple|indigo|violet|#[6-9a][0-9a-f]{1}[0-9a-f]{2}ff/i);
  });
});
