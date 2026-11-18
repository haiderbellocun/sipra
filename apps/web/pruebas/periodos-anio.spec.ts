import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Periodo } from '@core/models/modelos';
import {
  anioDe, anioInicial, aniosDisponibles, filtrarPorAnio, filtroTrasCrear, masReciente, seleccionTrasFiltro,
} from '../src/app/features/gestion/periodos-anio';

// Gestión de periodos · filtro por año de la lista maestra (solo navegación, sin backend).
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const comp = src('features', 'gestion', 'periodos.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(comp)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(comp)?.[1] ?? '';

const P = (codigo: string, fechaInicio: string, fechaFin = fechaInicio) => ({ codigo, fechaInicio, fechaFin, nombre: codigo }) as unknown as Periodo;
// Códigos engañosos a propósito: el código NO decide el año.
const lista = [
  P('2026A', '2026-02-02T05:00:00.000Z'),
  P('2026D', '2026-10-19T05:00:00.000Z', '2027-02-26T05:00:00.000Z'), // cruza 2026–2027
  P('26V06', '2026-11-03T05:00:00.000Z'),
  P('2027A', '2025-08-04T05:00:00.000Z'), // código «2027» pero empieza en 2025
  P('27P01', '2027-01-25T05:00:00.000Z'),
];

describe('Periodos · año desde fechaInicio', () => {
  it('1 · extrae el año de fechaInicio', () => {
    assert.equal(anioDe(lista[0]), 2026);
    assert.equal(anioDe(lista[4]), 2027);
    assert.equal(anioDe(P('X', 'no-es-fecha')), null);
    // La API entrega la fecha simple («2027-01-01»): es el día calendario, sin corrimiento por zona horaria (Bogotá = UTC−5).
    assert.equal(anioDe(P('27V01', '2027-01-01')), 2027);
    assert.equal(anioDe(P('2026A', '2026-01-26')), 2026);
  });
  it('2 · NO usa el código del periodo', () => {
    assert.equal(anioDe(lista[3]), 2025); // «2027A» empezó en 2025
    assert.equal(anioDe(P('26V06', '2027-03-01T05:00:00.000Z')), 2027);
    assert.doesNotMatch(src('features', 'gestion', 'periodos-anio.ts'), /\.codigo\.(slice|substring|match|startsWith)|codigo\[/);
  });
  it('3 · años ordenados del más reciente al más antiguo, dinámicos (sin años fijos)', () => {
    assert.deepEqual(aniosDisponibles(lista), [2027, 2026, 2025]);
    assert.deepEqual(aniosDisponibles([...lista, P('28A', '2028-02-01T05:00:00.000Z')]), [2028, 2027, 2026, 2025]);
    assert.doesNotMatch(plantilla, /<option[^>]*>\s*20\d\d\s*</);
  });
  it('4 · filtra por año', () => {
    assert.deepEqual(filtrarPorAnio(lista, 2026).map((p) => p.codigo), ['2026A', '2026D', '26V06']);
    assert.deepEqual(filtrarPorAnio(lista, 2025).map((p) => p.codigo), ['2027A']);
  });
  it('5 · un periodo que cruza 2026–2027 pertenece a 2026 si inició en 2026', () => {
    assert.ok(filtrarPorAnio(lista, 2026).some((p) => p.codigo === '2026D'));
    assert.ok(!filtrarPorAnio(lista, 2027).some((p) => p.codigo === '2026D'));
  });
  it('año inicial: el actual si tiene periodos; si no, el más reciente; sin periodos, «todos»', () => {
    assert.equal(anioInicial(lista, new Date(2026, 10, 18)), 2026);
    assert.equal(anioInicial(lista, new Date(2030, 0, 1)), 2027);
    assert.equal(anioInicial([], new Date(2026, 10, 18)), 'todos');
  });
});

describe('Periodos · selección, «Todos», creación y vacío', () => {
  it('6 · cambiar de año: se conserva la selección si sigue visible; si no, el más reciente del año', () => {
    assert.equal(seleccionTrasFiltro(filtrarPorAnio(lista, 2026), '2026A'), '2026A');
    assert.equal(seleccionTrasFiltro(filtrarPorAnio(lista, 2026), '27P01'), '26V06'); // inicio más reciente de 2026
    assert.equal(seleccionTrasFiltro(filtrarPorAnio(lista, 2025), '2026A'), '2027A');
    assert.equal(masReciente(lista)?.codigo, '27P01');
  });
  it('6b · el componente toma la selección previa ANTES de filtrar y el detalle solo usa periodos visibles', () => {
    assert.match(comp, /const previa = this\.actual\(\)\?\.codigo \?\? null;[\s\S]*?this\.anio\.set\(anio\);[\s\S]*?seleccionTrasFiltro\(this\.visibles\(\), previa\)/);
    assert.match(comp, /readonly actual = computed\(\(\) => \{\s*const lista = this\.visibles\(\);/);
  });
  it('7 · «Todos los años» vuelve a mostrar todos', () => {
    assert.equal(filtrarPorAnio(lista, 'todos').length, lista.length);
    assert.match(plantilla, /<option \[ngValue\]="'todos'">Todos los años<\/option>/);
  });
  it('8 · crear un periodo de otro año cambia el filtro a su año y lo selecciona', () => {
    assert.equal(filtroTrasCrear(2026, P('27V01', '2027-02-01T05:00:00.000Z')), 2027);
    assert.equal(filtroTrasCrear(2026, P('2026E', '2026-12-01T05:00:00.000Z')), 2026);
    assert.equal(filtroTrasCrear('todos', P('27V01', '2027-02-01T05:00:00.000Z')), 'todos');
    assert.match(comp, /this\.anio\.set\(filtroTrasCrear\(this\.anio\(\) \?\? 'todos', p\)\);\s*this\.seleccion\.set\(p\.codigo\);/);
  });
  it('9 · estado vacío en la lista izquierda, con «+ Crear periodo» disponible', () => {
    assert.match(plantilla, /\} @empty \{\s*@if \(periodos\(\)\.length > 0\) \{ <p class="vacio-anio">No hay períodos registrados para este año\.<\/p> \}/);
    assert.ok(plantilla.indexOf('+ Crear periodo') < plantilla.indexOf('id="filtro-anio"'));
    assert.doesNotMatch(plantilla.slice(0, plantilla.indexOf('<div class="maestro-detalle">')), /@if \([^)]*anio/);
  });
});

describe('Periodos · filtro accesible, compacto y sin efectos en permisos ni edición', () => {
  it('label real asociado, select con foco visible, ubicado sobre la lista', () => {
    assert.match(plantilla, /<label for="filtro-anio">Año<\/label>\s*<select id="filtro-anio"/);
    assert.match(estilos, /\.filtro-anio select:focus-visible \{ outline:2px solid var\(--marca\)/);
    assert.ok(plantilla.indexOf('id="filtro-anio"') < plantilla.indexOf('<nav class="maestro"'));
  });
  it('móvil: el select ocupa el ancho disponible (flex:1; min-width:0) y solo usa tokens', () => {
    assert.match(estilos, /\.filtro-anio select \{ flex:1; min-width:0;/);
    assert.doesNotMatch(/\.filtro-anio[^}]*\}/.exec(estilos)?.[0] ?? '', /#[0-9a-f]{3,6}\b/i);
  });
  it('10 · no altera permisos ni edición: no hay llamadas nuevas a la API y las de edición siguen iguales', () => {
    const llamadas = [...comp.matchAll(/this\.api\.(\w+)\(/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(llamadas)], ['actualizarPeriodo', 'catalogoModalidades', 'crearPeriodo', 'listarPeriodos'].filter((x) => llamadas.includes(x)));
    assert.equal(llamadas.filter((x) => x === 'listarPeriodos').length, 1);
    assert.doesNotMatch(comp, /anio[^\n]*this\.api\./);
  });
});
