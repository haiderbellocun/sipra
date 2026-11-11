import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import {
  CATEGORIAS_EXPEDIENTE, CATEGORIAS_OBLIGACION, DetalleAnalitica, FILTROS_VACIOS, ReporteAnalitica, SIN_DATO, SIN_EMPRESA, apilar,
  cantidadFiltros, claseSerie, compararNiveles, compararPeriodos, escalaSemanas, hayDatos, horas, migas, nivel, parametros, partes,
  compararSemestres, pct1, porcentaje, quitar, razon, segunOrden, semanaCorta, semestre, tituloSegmento,
} from '../src/app/features/reportes/reportes-analitica.util';
import { metricasGenerales } from '../src/app/features/reportes/reportes-general.component';
import { PESTANAS, ROLES_ANALITICA } from '../src/app/features/reportes/reportes.component';
import { ROLES_CATALOGOS, ROLES_SGP, ROLES_SPE } from '../src/app/features/reportes/reportes-exportaciones.component';
import { MAX_PROGRAMAS_EVOLUCION } from '../src/app/features/reportes/reportes-periodos.component';
import { ReportesEstado } from '../src/app/features/reportes/reportes.estado';

// Las pruebas corren con cwd = apps/web.
const dir = join(process.cwd(), 'src', 'app', 'features', 'reportes');
const archivos = readdirSync(dir).filter((f) => f.endsWith('.component.ts'));
const leer = (f: string) => readFileSync(join(dir, f), 'utf8');
const globales = new Set([...readFileSync(join(process.cwd(), 'src', 'estilos.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
const plantilla = (f: string) => /template: `([\s\S]*?)`,\n\}\)/.exec(leer(f))?.[1] ?? '';

const cob = (s: Partial<ReporteAnalitica['resumen']> = {}): ReporteAnalitica['resumen'] => ({
  estudiantes: 3, practicas: 4, exigidos: 18, cargados: 2, aprobados: 1, correccion: 1, completos: 0,
  obligaciones: { sin_cargar: 15, en_proceso: 0, en_revision: 1, correccion: 1, rechazado: 0, aprobado: 1 },
  versiones: 4, documentos: 3, conReenvio: 1, devoluciones: 2, rechazos: 0, ...s,
});

/** Respuesta sintética mínima: sin datos personales reales. */
function reporte(s: Partial<ReporteAnalitica> = {}): ReporteAnalitica {
  return {
    generadoEn: '2026-09-16T15:00:00.000Z', periodosDisponibles: ['2026-2', '2026-1'], universo: { estudiantes: 10, practicas: 12 },
    ordenPeriodos: ['2026-1', '2026-2'], periodosSinFecha: [], dimensiones: { semestre: 'no_disponible', nombrePrograma: 'no_disponible', ubicacionInternacional: 'no_disponible' }, semestres: [],
    resumen: cob(),
    expedientes: { completo: 0, requiere_correccion: 1, sin_iniciar: 1, en_curso: 1, sin_matriz: 1 },
    estadosPractica: [{ estado: 'activa', practicas: 3 }, { estado: 'cerrada', practicas: 1 }],
    documental: { sin_cargar: 15, en_proceso: 0, en_revision: 1, correccion: 1, rechazado: 0, aprobado: 1 },
    porTipo: [], friccion: [], tiempos: { decisiones: 3, medianaHoras: 4, p90Horas: 10, porTipo: [] },
    semanas: [{ semana: '2026-09-07', cargas: 1, aprobaciones: 0, devoluciones: 1, rechazos: 0 }, { semana: '2026-09-14', cargas: 3, aprobaciones: 1, devoluciones: 1, rechazos: 0 }],
    periodos: [], modalidades: [{ modalidad: 'pasantia', ...cob() }],
    escuelas: [{ escuela: 'ESC-ING', nombre: 'Ingeniería', ...cob(), programas: [{ programa: 'SIS-PRO', ...cob() }] }],
    empresas: [{ empresa: 'Empresa Demo', practicas: 3, estudiantes: 2, sector: 'J', ciudad: '05001', tipo: 'externa' }, { empresa: null, practicas: 1, estudiantes: 1, sector: null, ciudad: null, tipo: 'interna_cun' }],
    sectores: [{ sector: 'J', nombre: 'Información y comunicaciones', ...cob() }], ciudades: [{ ciudad: '05001', nombre: 'Medellín', ...cob() }],
    receptores: [{ tipo: 'interna_cun', ...cob({ estudiantes: 1 }) }, { tipo: 'externa', ...cob({ estudiantes: 2 }) }],
    etiquetas: { sectores: { J: 'Información y comunicaciones' }, ciudades: { '05001': 'Medellín' } },
    niveles: [{ ciclo: 'profesional', ...cob() }],
    programas: [{ programa: 'SIS-PRO', nombre: null, escuela: 'ESC-ING', nombreEscuela: 'Ingeniería', ciclos: ['profesional'], ...cob() }],
    cruces: { programaModalidad: [], programaNivel: [], nivelModalidad: [], periodoPrograma: [], periodoModalidad: [], periodoNivel: [], semestreModalidad: [], programaSemestre: [],
      programaSector: [], programaCiudad: [], nivelSector: [], modalidadSector: [], receptorPrograma: [], receptorNivel: [] },
    ...s,
  };
}

class ApiFalsa {
  llamadas: { metodo: string; p: Record<string, string> }[] = [];
  fallar = false;
  respuesta = reporte();
  reporteAnalitica(p: Record<string, string>): Observable<ReporteAnalitica> {
    this.llamadas.push({ metodo: 'analitica', p });
    return this.fallar ? throwError(() => new HttpErrorResponse({ status: 500, error: { mensaje: 'Base no disponible' } })) : of(this.respuesta);
  }
  reporteAnaliticaDetalle(p: Record<string, string>): Observable<DetalleAnalitica> {
    this.llamadas.push({ metodo: 'detalle', p });
    return of({ total: 1, estudiantesUnicos: 1, filas: [] });
  }
}
class AvisosFalsos { exito(): void { /* */ } error(): void { /* */ } info(): void { /* */ } }

function crear() {
  const api = new ApiFalsa();
  const injector = Injector.create({ providers: [
    { provide: ReportesEstado, useClass: ReportesEstado }, { provide: ApiService, useValue: api }, { provide: AvisosService, useValue: new AvisosFalsos() },
    { provide: SesionService, useValue: { rol: signal('coordinador') } },
  ] });
  return { api, estado: injector.get(ReportesEstado) };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('Reportes V3 · lógica pura', () => {
  it('las partes suman 100 % con el mayor residuo y omiten las vacías', () => {
    const p = partes(CATEGORIAS_EXPEDIENTE, { completo: 1, en_curso: 1, requiere_correccion: 1, sin_iniciar: 0, sin_matriz: 0 });
    assert.equal(p.reduce((n, x) => n + x.pct, 0), 100);
    assert.deepEqual(p.map((x) => x.clave), ['completo', 'en_curso', 'requiere_correccion']);
    assert.deepEqual(partes(CATEGORIAS_OBLIGACION, { sin_cargar: 0, en_proceso: 0, en_revision: 0, correccion: 0, rechazado: 0, aprobado: 0 }), []);
  });
  it('porcentajes y razones con denominador explícito; sin denominador, «—»', () => {
    assert.equal(porcentaje(1, 0), null);
    assert.equal(porcentaje(1, 3), 33);
    assert.equal(pct1(84, 608), '13,8 %');
    assert.equal(pct1(1, 0), '—');
    assert.equal(razon(3, 2), '1,50');
  });
  it('un único contexto: todos los filtros viajan, los vacíos no; el recorte documental y la búsqueda se suman', () => {
    assert.deepEqual(parametros(FILTROS_VACIOS), {});
    const f = { ...FILTROS_VACIOS, periodos: ['2026-1', '2026-2'], programa: 'SIS-PRO', ciclo: 'profesional', modalidad: 'pasantia', empresa: SIN_EMPRESA, situacion: 'en_curso' as const };
    assert.deepEqual(parametros(f), { periodos: '2026-1,2026-2', programa: 'SIS-PRO', ciclo: 'profesional', modalidad: 'pasantia', empresa: SIN_EMPRESA, situacion: 'en_curso' });
    assert.deepEqual(parametros(f, { tipo: 'certificado_eps', estadoDocumental: 'correccion' }, ' ana '), { ...parametros(f), tipo: 'certificado_eps', estadoDocumental: 'correccion', buscar: 'ana' });
    assert.equal(cantidadFiltros(f), 6);
  });
  it('breadcrumb analítico en orden institución → expediente; quitar escuela suelta su programa', () => {
    const f = { ...FILTROS_VACIOS, situacion: 'requiere_correccion' as const, programa: 'SIS-PRO', escuela: 'ESC-ING', periodos: ['2026-2'], ciclo: 'profesional', modalidad: 'pasantia' };
    const m = migas(f, { escuela: () => 'Escuela de Ingenierías', etiqueta: (v) => (v === 'pasantia' ? 'Pasantía' : v) });
    assert.deepEqual(m.map((x) => `${x.rotulo}:${x.valor}`), ['Periodo:2026-2', 'Escuela:Escuela de Ingenierías', 'Programa:SIS-PRO', 'Nivel:Profesional', 'Modalidad:Pasantía', 'Expediente:Requiere corrección']);
    assert.deepEqual(quitar(f, 'escuela').programa, '');
    assert.deepEqual(quitar(f, 'ciclo').programa, 'SIS-PRO');
    assert.deepEqual(quitar(f, 'periodos').periodos, []);
  });
  it('nivel real (ciclo) sin inventar; ordenes académicos y de periodo no lexicográficos', () => {
    assert.equal(nivel('tecnologo'), 'Tecnólogo');
    assert.equal(nivel(null), 'Sin información');
    assert.deepEqual(['profesional', 'tecnico', 'tecnologo'].sort(compararNiveles), ['tecnico', 'tecnologo', 'profesional']);
    assert.deepEqual(['2026-10', '2026-2', '2025-1'].sort(compararPeriodos), ['2025-1', '2026-2', '2026-10']);
  });
  it('semestre: etiqueta, orden numérico (4…10, no lexicográfico), sin información al final y en el contexto', () => {
    assert.equal(semestre(8), 'Semestre 8');
    assert.equal(semestre(''), 'Sin información');
    assert.deepEqual(['10', '', '4', '9'].sort(compararSemestres), ['4', '9', '10', '']);
    const f = { ...FILTROS_VACIOS, programa: 'SYN-ING-SIS', ciclo: 'profesional', semestre: '8' };
    assert.deepEqual(parametros(f), { programa: 'SYN-ING-SIS', ciclo: 'profesional', semestre: '8' });
    assert.deepEqual(migas(f, { escuela: (c) => c, etiqueta: (v) => v }).map((m) => m.valor), ['SYN-ING-SIS', 'Profesional', 'Semestre 8']);
  });
  it('periodos en el orden cronológico que entrega el servidor (catálogo real), sin ordenar por texto', () => {
    const orden = ['2026A', '2026B', '26V04', '26V05', '26V06', '2056C', '26V01'];
    assert.deepEqual(['26V01', '26V04', '2026B', '2056C', '2026A'].sort(segunOrden(orden)), ['2026A', '2026B', '26V04', '2056C', '26V01']);
  });
  it('apilar: filas por total, columnas por total global y color estable con «otras» después de cinco', () => {
    const { filas, columnas } = apilar([
      { fila: 'A', columna: 'x', estudiantes: 1, practicas: 1 }, { fila: 'B', columna: 'x', estudiantes: 2, practicas: 2 },
      { fila: 'B', columna: 'y', estudiantes: 5, practicas: 5 },
    ]);
    assert.deepEqual(filas.map((f) => `${f.clave}:${f.total}`), ['B:7', 'A:1']);
    assert.deepEqual(columnas, ['y', 'x']);
    assert.equal(claseSerie(['a', 'b', 'c', 'd', 'e', 'f'], 'f'), 's-otras');
    assert.equal(claseSerie(['a', 'b'], 'b'), 's1');
  });
  it('horas, semanas, títulos y vacío', () => {
    assert.equal(horas(null), '—');
    assert.equal(horas(0.5), '30 min');
    assert.equal(semanaCorta('2026-09-14'), '14 sep');
    assert.equal(tituloSegmento({ tipo: 'certificado_eps', estadoDocumental: 'correccion' }, (v) => v), 'certificado_eps · En corrección');
    assert.equal(escalaSemanas([]), 0);
    assert.equal(hayDatos(null), false);
    assert.equal(hayDatos(reporte({ resumen: cob({ practicas: 0 }) })), false);
  });
  it('franja General: 6 cifras; con filtros, el denominador «en alcance»', () => {
    const m = metricasGenerales(reporte());
    assert.deepEqual(m.map((x) => x.t), ['Estudiantes', 'Expedientes completos', 'Requieren corrección', 'Aprobados', 'Cargados', 'Decisiones']);
    assert.match(m[0].contexto, /^4 práctica/);
    assert.match(metricasGenerales(reporte(), true)[0].contexto, /de 10 en alcance/);
  });
});

describe('Reportes V3 · contexto único y cross-filter', () => {
  it('carga con el contexto y distingue error de vacío', async () => {
    const { api, estado } = crear();
    api.fallar = true;
    await estado.cargar();
    assert.equal(estado.error(), 'Base no disponible');
    api.fallar = false;
    await estado.cargar();
    assert.equal(estado.error(), null);
    assert.deepEqual(estado.opciones().ciclos, ['profesional']);
    assert.deepEqual(estado.opciones().empresas, ['Empresa Demo', null]);
  });
  it('elegir un programa fija su escuela como contexto; elegirlo de nuevo lo quita', async () => {
    const { api, estado } = crear();
    await estado.cargar();
    estado.alternar('programa', 'SIS-PRO');
    assert.equal(estado.filtros().programa, 'SIS-PRO');
    assert.equal(estado.filtros().escuela, 'ESC-ING');
    await esperar();
    assert.deepEqual(api.llamadas.at(-1)?.p, { escuela: 'ESC-ING', programa: 'SIS-PRO' });
    estado.alternar('programa', 'SIS-PRO');
    assert.equal(estado.filtros().programa, '');
    assert.equal(estado.filtros().escuela, 'ESC-ING');
  });
  it('recorrido general → programa → nivel → modalidad → situación: cada paso acumula filtros y recarga la tabla granular', async () => {
    const { api, estado } = crear();
    await estado.cargar();
    await estado.abrirDetalle({});
    estado.alternar('programa', 'SIS-PRO');
    estado.alternar('ciclo', 'profesional');
    estado.alternar('modalidad', 'pasantia');
    estado.alternar('situacion', 'requiere_correccion');
    await esperar();
    const ultimaDetalle = api.llamadas.filter((l) => l.metodo === 'detalle').at(-1);
    assert.deepEqual(ultimaDetalle?.p, { escuela: 'ESC-ING', programa: 'SIS-PRO', ciclo: 'profesional', modalidad: 'pasantia', situacion: 'requiere_correccion' });
    assert.ok(estado.segmento(), 'la tabla sigue abierta tras el cross-filter');
    estado.quitar('modalidad');
    assert.equal(estado.filtros().modalidad, '');
    assert.equal(estado.activos(), 4);
    estado.limpiar();
    assert.equal(estado.activos(), 0);
  });
  it('nombre de programa: sin mapping se muestra el código; con mapping sintético de dev, el nombre (también en el contexto)', async () => {
    const { api, estado } = crear();
    await estado.cargar();
    assert.equal(estado.nombrePrograma('SIS-PRO'), 'SIS-PRO');
    api.respuesta = reporte({ dimensiones: { semestre: 'no_disponible', nombrePrograma: 'sintetico', ubicacionInternacional: 'no_disponible' },
      programas: [{ ...reporte().programas[0], nombre: 'Ingeniería de Sistemas' }] });
    await estado.cargar();
    assert.equal(estado.nombrePrograma('SIS-PRO'), 'Ingeniería de Sistemas');
    const f = { ...FILTROS_VACIOS, programa: 'SIS-PRO' };
    assert.deepEqual(migas(f, { escuela: (c) => c, etiqueta: (v) => v, programa: estado.nombrePrograma }).map((m) => m.valor), ['Ingeniería de Sistemas']);
  });
  it('organización receptora: tipo, sector y ciudad entran al contexto único, con nombres de los catálogos reales', async () => {
    const { api, estado } = crear();
    await estado.cargar();
    assert.equal(estado.nombreSector('J'), 'Información y comunicaciones');
    assert.equal(estado.nombreCiudad('05001'), 'Medellín');
    assert.equal(estado.nombreCiudad(''), 'Sin municipio registrado');
    api.respuesta = reporte({ etiquetas: { sectores: {}, ciudades: { __internacional__: 'Internacional · sin DIVIPOLA' } } });
    await estado.cargar();
    assert.equal(estado.nombreCiudad('__internacional__'), 'Internacional · sin DIVIPOLA');
    assert.notEqual(estado.nombreCiudad('__internacional__'), estado.nombreCiudad(''));
    estado.alternar('tipoReceptor', 'externa');
    estado.alternar('sector', 'J');
    estado.alternar('ciudad', '05001');
    await esperar();
    assert.deepEqual(api.llamadas.at(-1)?.p, { tipoReceptor: 'externa', sector: 'J', ciudad: '05001' });
    const m = migas(estado.filtros(), { escuela: (c) => c, etiqueta: (v) => v, sector: estado.nombreSector, ciudad: estado.nombreCiudad });
    assert.deepEqual(m.map((x) => `${x.rotulo}:${x.valor}`), ['Receptor:Externa', 'Sector:Información y comunicaciones', 'Ciudad:Medellín']);
    assert.equal(migas({ ...FILTROS_VACIOS, ciudad: SIN_DATO }, { escuela: (c) => c, etiqueta: (v) => v })[0].valor, 'Sin municipio registrado');
  });
  it('la búsqueda viaja con el contexto y cerrar la tabla la limpia', async () => {
    const { api, estado } = crear();
    estado.filtros.set({ ...FILTROS_VACIOS, periodos: ['2026-2'] });
    await estado.abrirDetalle({ tipo: 'certificado_eps', estadoDocumental: 'en_revision' });
    estado.buscar.set('ana');
    await estado.cargarDetalle();
    assert.deepEqual(api.llamadas.at(-1), { metodo: 'detalle', p: { periodos: '2026-2', tipo: 'certificado_eps', estadoDocumental: 'en_revision', buscar: 'ana' } });
    estado.cerrarDetalle();
    assert.equal(estado.buscar(), '');
    assert.equal(estado.segmento(), null);
  });
});

describe('Reportes V3 · plantillas', () => {
  it('todos los componentes son OnPush y no reutilizan clases globales', () => {
    for (const f of archivos) {
      assert.match(leer(f), /ChangeDetectionStrategy\.OnPush/, f);
      if (f === 'reportes-exportaciones.component.ts') continue; // Conserva la presentación previa (clases globales a propósito).
      const estilos = /styles: \[([\s\S]*?)\],\n  template/.exec(leer(f))?.[1] ?? '';
      const propias = [...estilos.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
      assert.deepEqual(propias.filter((c) => globales.has(c)), [], f);
    }
    const comunes = readFileSync(join(dir, 'reportes.estilos.ts'), 'utf8');
    assert.deepEqual([...comunes.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]).filter((c) => globales.has(c)), []);
  });
  it('pestañas ARIA; extensión solo exporta; la UI de exportaciones respeta los @Roles reales del servidor', () => {
    assert.deepEqual(PESTANAS.map((p) => p.texto), ['General', 'Estudiantes', 'Organizaciones', 'Documentos', 'Períodos', 'Exportaciones']);
    assert.deepEqual(ROLES_ANALITICA, ['administrador', 'coordinador', 'auxiliar', 'tutor']);
    assert.ok(!ROLES_SGP.includes('extension'), 'extensión no genera bases del SGP');
    assert.deepEqual(ROLES_SPE, ['administrador', 'extension']);
    assert.deepEqual(ROLES_CATALOGOS, ['administrador', 'extension', 'coordinador']);
    const api = readFileSync(join(process.cwd(), '..', 'api', 'src', 'infrastructure', 'controllers', 'reportes-sgp.controller.ts'), 'utf8');
    assert.match(api, /@Roles\(Rol\.ADMINISTRADOR, Rol\.COORDINADOR, Rol\.AUXILIAR, Rol\.TUTOR\)/);
    const t = plantilla('reportes-exportaciones.component.ts');
    assert.match(t, /@if \(puedeSgp\(\)\) \{\s*<h2 class="seccion">Bases del SGP en Excel/);
    assert.match(t, /@if \(generaSpe\(\)\) \{/);
  });
  it('breadcrumb con quitar por nivel y denominador «en alcance»', () => {
    const t = plantilla('reportes.component.ts');
    assert.match(t, /<nav class="contexto" aria-label="Contexto del reporte">/);
    assert.match(t, /\[attr\.aria-label\]="'Quitar ' \+ m\.rotulo/);
    assert.match(t, /de \{\{ r\.universo\.estudiantes \}\} estudiantes en alcance/);
    assert.match(t, /id="rp-ciclo"/);
    assert.match(t, /id="rp-empresa"/);
  });
  it('cross-filter accesible: barras y pilas son botones con aria-pressed; tooltip con cantidad y % del universo filtrado', () => {
    const b = plantilla('reportes-barras.component.ts');
    assert.match(b, /<button type="button" class="fila-b" \[attr\.aria-pressed\]/);
    assert.match(b, /del universo filtrado/);
    assert.match(b, /Ver todos \(/);
    const a = plantilla('reportes-apiladas.component.ts');
    assert.match(a, /class="ley" \[attr\.aria-pressed\]/);
    assert.match(a, /class="rot" \[attr\.aria-pressed\]/);
    assert.match(a, /Ver como tabla/);
    assert.match(a, /class="pila-a" aria-hidden="true"/);
  });
  it('General: programa, situación, modalidad, nivel, estado y salud documental; semestre declarado no disponible', () => {
    const g = plantilla('reportes-general.component.ts');
    for (const id of ['g-prog', 'g-exp', 'g-mod', 'g-niv', 'g-est', 'g-cob', 'g-sem']) assert.match(g, new RegExp(`id="${id}"`), id);
    assert.match(g, /El semestre no está en SIPRA/);
    const e = plantilla('reportes-estudiantes.component.ts');
    for (const c of ['programaNivel', 'programaModalidad', 'nivelModalidad']) assert.match(e, new RegExp(`r\\.cruces\\.${c}`), c);
    assert.match(e, /No disponible: SIPRA no guarda el semestre/);
    const o = plantilla('reportes-organizaciones.component.ts');
    for (const c of ['programaSector', 'programaCiudad', 'nivelSector', 'modalidadSector', 'receptorPrograma', 'receptorNivel']) assert.ok(o.includes(`r.cruces.${c}`), c);
    assert.match(o, /sin causalidad/);
    for (const id of ['g-rec', 'g-emp', 'g-sector', 'g-ciudad']) assert.ok(g.includes(`id="${id}"`), id);
    assert.match(e, /r\.dimensiones\.semestre === 'sintetica'/);
    assert.match(e, /r\.cruces\.semestreModalidad/);
    assert.match(g, /dato sintético de prueba/);
  });
  it('Documentos compara tasas por programa, nivel, modalidad y periodo (volumen y tasa separados)', () => {
    const d = plantilla('reportes-documentos.component.ts');
    assert.match(d, /Devol\.\/doc\./);
    assert.match(d, /Versiones\/doc\./);
    assert.match(d, /tasas\.aprobacion\.definicion/);
  });
  it('Períodos: A frente a B y evolución de hasta 5 programas', () => {
    const p = plantilla('reportes-periodos.component.ts');
    assert.equal(MAX_PROGRAMAS_EVOLUCION, 5);
    assert.match(p, /Periodo A frente a periodo B/);
    assert.match(p, /r\.cruces\.periodoModalidad/);
  });
  it('tabla granular: nivel, pendientes, devoluciones, búsqueda y «Abrir expediente»; sin documento ni correo', () => {
    const t = plantilla('reportes-detalle.component.ts');
    assert.doesNotMatch(t, /documento de identidad|correo|\.documento\b/i);
    assert.match(t, /\[routerLink\]="\['\/practicas', f\.practicaId\]"/);
    assert.match(t, />Abrir expediente</);
    assert.match(t, /type="search"/);
    for (const c of ['Nivel', 'Pend.', 'Devol.', 'Organización', 'Receptor', 'Sector', 'Ciudad']) assert.ok(t.includes(`>${c}</th>`), c);
    assert.doesNotMatch(t, /\bnit\b|tel[eé]fono|direcci[oó]n/i);
  });
  it('carga, vacío y error con reintento; gráficas decorativas con tabla', () => {
    const t = plantilla('reportes.component.ts');
    assert.match(t, /<sipra-carga-senal/);
    assert.match(t, /titulo="Sin prácticas para estos filtros"/);
    assert.match(t, /role="alert"[\s\S]*?Reintentar/);
    assert.match(plantilla('reportes-general.component.ts'), /Ver la serie como tabla/);
  });
  it('responsive: barras, pilas y tabla se reorganizan bajo 700 px', () => {
    for (const f of ['reportes-barras.component.ts', 'reportes-apiladas.component.ts', 'reportes-detalle.component.ts', 'reportes.component.ts']) {
      assert.match(leer(f), /@media \(width < 700px\)/, f);
    }
    // Regresión (1.000 filas): el texto solo para lectores (.ra-sr, absoluto) ensanchaba la página si el contenedor no estaba posicionado.
    assert.match(readFileSync(join(dir, 'reportes.estilos.ts'), 'utf8'), /\.ra-desliza \{ overflow-x: auto; position: relative; \}/);
  });
});
