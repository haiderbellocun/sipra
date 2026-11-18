import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Periodo, Rol } from '@core/models/modelos';
import {
  MENSAJE_OBSOLETA, diferenciaFinal, escuelasElegibles, esPreviaObsoleta, periodoPorDefecto, puedeDistribuir, textoConfirmacion, textoResultado,
} from '../src/app/features/practicas/distribucion-docentes.util';

// G6 · Distribución de estudiantes por docente facilitador (presentación). El servidor autoriza, calcula y aplica.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const comp = src('features', 'practicas', 'distribucion-docentes.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(comp)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(comp)?.[1] ?? '';
const listado = src('features', 'practicas', 'practicas.component.ts');
const plantillaListado = /template: `([\s\S]*?)`,\n\}\)/.exec(listado)?.[1] ?? '';
const api = src('core', 'services', 'api.service.ts');

const periodo = (codigo: string, extra: Partial<Periodo> = {}) => ({ codigo, nombre: codigo, activo: true, vigente: false, ...extra }) as Periodo;

describe('G6 · quién distribuye', () => {
  it('solo coordinación y analista; administración, dirección y demás perfiles no', () => {
    for (const rol of ['coordinador', 'analista'] as Rol[]) assert.equal(puedeDistribuir(rol), true, rol);
    for (const rol of ['administrador', 'director', 'tutor', 'auxiliar', 'estudiante', 'empresa', 'extension'] as Rol[]) assert.equal(puedeDistribuir(rol), false, rol);
    assert.equal(puedeDistribuir(null), false);
  });
  it('el botón «Distribuir estudiantes» y el panel solo existen con puedeDistribuir()', () => {
    const i = plantillaListado.indexOf('@if (puedeDistribuir())');
    assert.ok(i > 0 && plantillaListado.indexOf('Distribuir estudiantes') > i);
    assert.match(plantillaListado, /@if \(puedeDistribuir\(\)\) \{\s*<sipra-distribucion-docentes \[periodos\]="periodos\(\)" \[periodoFiltro\]="f\.periodo" \(aplicada\)="consultar\(\)" \/>/);
  });
});

describe('G6 · periodo obligatorio y alcance explícito', () => {
  it('el periodo por defecto es el del filtro, si no el vigente, si no el primero activo; nunca «todos»', () => {
    const ps = [periodo('2026A', { activo: false }), periodo('2026C', { vigente: true }), periodo('2027A')];
    assert.equal(periodoPorDefecto(ps, '2027A'), '2027A');
    assert.equal(periodoPorDefecto(ps, ''), '2026C');
    assert.equal(periodoPorDefecto([periodo('2026A', { activo: false }), periodo('2027A')], ''), '2027A');
    assert.equal(periodoPorDefecto(ps, 'inexistente'), '2026C');
  });
  it('el selector de periodo no tiene opción vacía («Todos») y marca los inactivos', () => {
    const sel = /<select #primerCampo id="dd-periodo"[\s\S]*?<\/select>/.exec(plantilla)?.[0] ?? '';
    assert.doesNotMatch(sel, /<option value="">/);
    assert.match(sel, /\(inactivo\)/);
  });
  it('alcance: «Todas las escuelas de mi alcance» o «Una escuela» (no se infiere del filtro del listado)', () => {
    assert.match(plantilla, /Todas las escuelas de mi alcance/);
    assert.match(plantilla, /Una escuela/);
    assert.doesNotMatch(comp, /f\.busqueda|filtroSenal/);
  });
  it('las escuelas elegibles son las del alcance del actor; institucional = todas', () => {
    const cat = [{ codigo: 'ESC-ING', nombre: 'Ingenierías' }, { codigo: 'ESC-NEG', nombre: 'Negocios' }];
    assert.deepEqual(escuelasElegibles(cat, []).map((e) => e.codigo), ['ESC-ING', 'ESC-NEG']);
    assert.deepEqual(escuelasElegibles(cat, ['ESC-NEG']).map((e) => e.codigo), ['ESC-NEG']);
  });
  it('cambiar periodo o alcance invalida la vista previa (no se aplica algo distinto de lo que se ve)', () => {
    assert.match(plantilla, /\(ngModelChange\)="periodo\.set\(\$event\); invalidar\(\)"/);
    assert.match(comp, /invalidar\(\): void \{ this\.vista\.set\(null\)/);
  });
});

describe('G6 · vista previa, confirmación y resultado', () => {
  const v = { asignables: 34, docentes: [
    { id: 'a', nombre: 'Laura', escuelas: [], actual: 20, nuevos: 8, final: 28 },
    { id: 'b', nombre: 'Carlos', escuelas: [], actual: 21, nuevos: 7, final: 28 },
    { id: 'c', nombre: 'Ana', escuelas: [], actual: 28, nuevos: 0, final: 28 },
  ] };
  it('tabla compacta con Docente, Escuela(s), Actual, Nuevos y Final; cifras Pendientes, Docentes, Asignables, Sin docente compatible', () => {
    for (const t of ['Docente', 'Escuela(s)', 'Actual', 'Nuevos', 'Final', 'Pendientes', 'Asignables', 'Sin docente compatible']) assert.ok(plantilla.includes(t), t);
    assert.match(plantilla, /\+\{\{ d\.nuevos \}\}/);
  });
  it('no asignables por escuela, con su motivo y aclarando que no impiden aplicar las demás', () => {
    assert.match(plantilla, /Sin docente disponible/);
    assert.match(plantilla, /Quedan fuera del lote y no impiden aplicar las demás/);
  });
  it('texto de confirmación con X estudiantes e Y docentes (los que reciben)', () => {
    assert.equal(textoConfirmacion(v), 'Se asignarán 34 estudiantes a 2 docentes facilitadores. Las asignaciones existentes no serán modificadas.');
    assert.equal(textoConfirmacion({ asignables: 1, docentes: [v.docentes[0]] }), 'Se asignarán 1 estudiante a 1 docente facilitador. Las asignaciones existentes no serán modificadas.');
  });
  it('confirmación en un diálogo aparte con Cancelar (foco inicial) y «Aplicar distribución»', () => {
    assert.match(plantilla, /<dialog #confirmacion class="confirmar"/);
    assert.match(plantilla, /<button #cancelarConf type="button" class="boton" \(click\)="cerrarConfirmacion\(\)">Cancelar<\/button>/);
    assert.match(comp, /this\.cancelarConf\(\)\?\.nativeElement\.focus\(\)/);
  });
  it('«Aplicar distribución» solo con una vista previa aplicable; envía la huella', () => {
    assert.match(plantilla, /\[disabled\]="!vista\(\)\?\.puedeAplicar \|\| cargando\(\)"/);
    assert.match(comp, /periodoAcademico: v\.periodoAcademico, huella: v\.huella/);
    assert.match(api, /practicas\/distribucion-docentes/);
  });
  it('409 = vista previa obsoleta: se descarta y se pide generar una nueva', () => {
    assert.equal(esPreviaObsoleta({ status: 409 }), true);
    assert.equal(esPreviaObsoleta({ status: 400 }), false);
    assert.equal(esPreviaObsoleta(new Error('x')), false);
    assert.equal(MENSAJE_OBSOLETA, 'Las asignaciones cambiaron desde la vista previa. Genera una nueva distribución.');
    assert.match(comp, /if \(esPreviaObsoleta\(error\)\) \{ this\.vista\.set\(null\); this\.obsoleta\.set\(true\); \}/);
  });
  it('éxito: «Distribución completada» con Asignados, Docentes y Sin docente compatible (no un «OK» vacío) y recarga el listado', () => {
    assert.match(plantilla, /Distribución completada/);
    assert.equal(textoResultado({ periodoAcademico: '2026C', asignados: 187, docentes: 8, sinDocenteCompatible: 3 }),
      'Distribución completada: 187 asignado(s) a 8 docente(s); 3 sin docente compatible.');
    assert.match(comp, /this\.aplicada\.emit\(r\)/);
  });
  it('error que no es 409: aviso con el mensaje del servidor', () => {
    assert.match(comp, /else this\.avisos\.error\(leerError\(error\)\)/);
  });
  it('diferencia de carga final', () => { assert.equal(diferenciaFinal(v), 0); });
});

describe('G6 · accesibilidad y móvil', () => {
  it('OnPush y <dialog> nativos con título accesible; foco inicial en el periodo y retorno del foco', () => {
    assert.match(comp, /ChangeDetectionStrategy\.OnPush/);
    assert.match(plantilla, /<dialog #panel class="cajon" aria-labelledby="dd-titulo"/);
    assert.match(comp, /this\.primerCampo\(\)\?\.nativeElement\.focus\(\)/);
    assert.match(comp, /alCerrar\(\): void \{ this\.origenFoco\?\.focus\(\)/);
  });
  it('panel a ancho completo en móvil, cifras en 2 columnas y tabla sin la columna de escuelas', () => {
    assert.match(estilos, /width: min\(760px, 100vw\)/);
    assert.match(estilos, /@media \(max-width: 600px\)[\s\S]*\.cifras \{ grid-template-columns: repeat\(2/);
    assert.match(estilos, /td\.esc, th\.esc \{ display: none; \}/);
  });
});
