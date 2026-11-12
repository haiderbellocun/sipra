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
  compararSemestres, partesGrafico, pct1, porcentaje, quitar, razon, segunOrden, semanaCorta, semestre, tituloSegmento,
} from '../src/app/features/reportes/reportes-analitica.util';
import { metricasGenerales, partesReceptor } from '../src/app/features/reportes/reportes-general.component';
import { INTERNACIONAL, insightsOrganizaciones, metricasOrganizaciones } from '../src/app/features/reportes/reportes-organizaciones.component';
import { CONSULTA_MOVIL, TOP_MOVIL, envolverEtiqueta, escala, num, tonoDe } from '../src/app/features/reportes/reportes-graficos.util';
import { cifraKpi } from '../src/app/features/reportes/reportes-kpis.component';
import { MIN_ROTULO_SEGMENTO } from '../src/app/features/reportes/reportes-proporcion.component';
import { MAX_SERIES_LINEA } from '../src/app/features/reportes/reportes-lineas.component';
import { ESTILOS_REPORTES } from '../src/app/features/reportes/reportes.estilos';
import { PESTANAS, ROLES_ANALITICA } from '../src/app/features/reportes/reportes.component';
import { ROLES_CATALOGOS, ROLES_SGP, ROLES_SPE } from '../src/app/features/reportes/reportes-exportaciones.component';
import { FORMA_VOLUMEN, MAX_PROGRAMAS_EVOLUCION, VISTAS_PERIODOS } from '../src/app/features/reportes/reportes-periodos.component';
import { ACENTOS_GENERAL, GRUPOS_GENERAL, reconciliacion } from '../src/app/features/reportes/reportes-general.component';
import { ROTULO_DATASET } from '../src/app/features/reportes/reportes.component';
import { INICIAL_BUMP, MAX_BUMP, rankings } from '../src/app/features/reportes/reportes-bump.component';
import { MAX_BANDAS, OTRAS_BANDA, bandas } from '../src/app/features/reportes/reportes-stream.component';
import { MARCAS_HORAS, enjambre, posLog } from '../src/app/features/reportes/reportes-swarm.component';
import { NIVELES_DRILL, arbol, squarify } from '../src/app/features/reportes/reportes-treemap.component';
import { FUENTE_SECTOR, cruzaCirculo, empaquetar, etiquetasLaterales, nombreCorto } from '../src/app/features/reportes/reportes-pack.component';
import { MAX_SERIES_RADAR } from '../src/app/features/reportes/reportes-radar.component';
import { MAX_FILAS_COMPOSICION, OTRAS_FILAS, filasComposicion } from '../src/app/features/reportes/reportes-composicion.component';
import { EJES_PERFIL, perfilDe, sumarCobertura } from '../src/app/features/reportes/reportes-estudiantes.component';
import { MAX_INSIGHTS, insights } from '../src/app/features/reportes/reportes-insights.component';
import { CRUCES } from '../src/app/features/reportes/reportes-cruces.component';
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
    porTipo: [], friccion: [], tiempos: { decisiones: 3, medianaHoras: 4, p90Horas: 10, porTipo: [], muestras: [] },
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
      programaSector: [], programaCiudad: [], nivelSector: [], modalidadSector: [], receptorPrograma: [], receptorNivel: [], modalidadSituacion: [] },
    dataset: null, jerarquia: [],
    facetas: Object.fromEntries(['programa', 'ciclo', 'semestre', 'modalidad', 'tipoReceptor', 'sector', 'ciudad', 'empresa', 'situacion'].map((k) => [k, { estudiantes: 3, practicas: 4 }])) as ReporteAnalitica['facetas'],
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
    assert.deepEqual(m.map((x) => x.t), ['Estudiantes', 'Prácticas', 'Expedientes completos', 'Requieren corrección', 'Cobertura vigente %', 'Aprobación %']);
    assert.equal(m[0].contexto, 'únicos en su alcance');
    assert.equal(m[2].contexto, '0 / 4 · 0,0 %', 'denominador visible: n / total · %');
    assert.equal(m[4].contexto, '2 / 18 obligaciones');
    assert.equal(m[5].contexto, '1 / 18 obligaciones');
    const grande = metricasGenerales(reporte({ resumen: cob({ practicas: 1000, exigidos: 6210, cargados: 4365 }), universo: { estudiantes: 1003, practicas: 1003 } }), true);
    assert.equal(grande[1].contexto, 'de 1.003 en alcance', 'miles con punto (es-CO)');
    assert.equal(grande[4].contexto, '4.365 / 6.210 obligaciones');
    // Con filtro de situación, la distribución es faceta (trae todas), pero la cifra de la tira es la del universo filtrado.
    assert.equal(metricasGenerales(reporte({ resumen: cob({ practicas: 7 }) }), true, 'requiere_correccion')[3].n, 7);
    assert.equal(metricasGenerales(reporte(), true, 'completo')[3].n, 0);
    assert.match(metricasGenerales(reporte(), true)[0].contexto, /de 10 en alcance/);
    assert.match(metricasGenerales(reporte(), true)[1].contexto, / en alcance$/);
  });
});

describe('Reportes V3.1 · capa de gráficas (lógica pura)', () => {
  it('escala real «redonda» desde 0: marcas 1-2-5 × 10ⁿ y máximo nunca menor que el dato', () => {
    assert.deepEqual(escala(73), { max: 80, marcas: [0, 20, 40, 60, 80] });
    assert.deepEqual(escala(317).max, 400);
    assert.deepEqual(escala(182), { max: 200, marcas: [0, 50, 100, 150, 200] });
    assert.deepEqual(escala(3), { max: 3, marcas: [0, 1, 2, 3] }, 'conteos: paso mínimo 1');
    assert.deepEqual(escala(0), { max: 1, marcas: [0, 1] });
    assert.deepEqual(escala(7.6, 4, false), { max: 8, marcas: [0, 2, 4, 6, 8] }, 'tasas: con decimales permitidos');
    for (const n of [1, 7, 56, 73, 120, 999, 1003]) assert.ok(escala(n).max >= n, String(n));
    assert.equal(num(1003), '1.003');
  });
  it('tonos del SIPRA Charts Theme: el estado de dominio se traduce sin arcoíris', () => {
    assert.equal(tonoDe('ok'), 'ok');
    assert.equal(tonoDe('info'), 'info');
    assert.equal(tonoDe('info', 'info-suave'), 'info-suave');
    assert.equal(tonoDe('aviso'), 'aviso');
    assert.equal(tonoDe('peligro'), 'riesgo');
    assert.equal(tonoDe('neutra'), 'muted');
    assert.deepEqual(partesGrafico(partes(CATEGORIAS_EXPEDIENTE, { completo: 1, requiere_correccion: 1, sin_iniciar: 0, en_curso: 2, sin_matriz: 0 })).map((p) => [p.clave, p.pct, p.tono]),
      [['completo', '25 %', 'ok'], ['en_curso', '50 %', 'info'], ['requiere_correccion', '25 %', 'aviso']]);
  });
  it('KPI con acabado BI: la tasa lleva su unidad junto a la cifra, no en el rótulo', () => {
    assert.deepEqual(cifraKpi({ n: 70, t: 'Cobertura documental %', tono: 'info', contexto: '' }), { rotulo: 'Cobertura documental', valor: '70', unidad: '%' });
    assert.deepEqual(cifraKpi({ n: 1003, t: 'Estudiantes', tono: 'info', contexto: '' }), { rotulo: 'Estudiantes', valor: '1.003', unidad: '' });
  });
  it('interna CUN / externa con % de un decimal sobre el universo filtrado', () => {
    // Denominador = universo de SU faceta (con filtro de receptor activo, siguen viéndose las dos partes).
    const p = partesReceptor(reporte({ resumen: cob({ estudiantes: 121 }), facetas: { ...reporte().facetas, tipoReceptor: { estudiantes: 1003, practicas: 1003 } },
      receptores: [{ tipo: 'interna_cun', ...cob({ estudiantes: 121 }) }, { tipo: 'externa', ...cob({ estudiantes: 882 }) }] }));
    assert.deepEqual(p.map((x) => [x.texto, x.n, x.pct]), [['Interna CUN', 121, '12,1 %'], ['Externa', 882, '87,9 %']]);
  });
  it('responsive y límites: Top 5 en móvil con la misma consulta que el CSS; etiquetas, series y dona acotadas', () => {
    assert.equal(CONSULTA_MOVIL, '(width < 700px)');
    assert.equal(TOP_MOVIL, 5);
    assert.ok(MIN_ROTULO_SEGMENTO > 0.05 && MIN_ROTULO_SEGMENTO < 0.15, 'labelSkipWidth');
    assert.equal(MAX_SERIES_LINEA, 5);
  });
});

describe('Reportes V3.1 · Organizaciones (lógica pura)', () => {
  const org = (s: Partial<ReporteAnalitica> = {}) => reporte({
    dimensiones: { semestre: 'sintetica', nombrePrograma: 'sintetico', ubicacionInternacional: 'sintetica' },
    resumen: cob({ estudiantes: 10, practicas: 10 }),
    empresas: [
      { empresa: 'CUN · Práctica interna', practicas: 2, estudiantes: 2, sector: 'P', ciudad: '11001', tipo: 'interna_cun' },
      { empresa: 'Empresa Sintética A', practicas: 4, estudiantes: 4, sector: 'J', ciudad: '11001', tipo: 'externa' },
      { empresa: 'Empresa Sintética B', practicas: 3, estudiantes: 3, sector: 'P', ciudad: '05001', tipo: 'externa' },
      { empresa: 'Empresa Sintética C', practicas: 1, estudiantes: 1, sector: 'J', ciudad: INTERNACIONAL, tipo: 'externa' },
    ],
    sectores: [{ sector: 'J', nombre: 'Información y comunicaciones', ...cob({ estudiantes: 5 }) }, { sector: 'P', nombre: 'Educación', ...cob({ estudiantes: 5 }) }],
    ciudades: [{ ciudad: '11001', nombre: 'Bogotá, D.C.', ...cob({ estudiantes: 6 }) }, { ciudad: '05001', nombre: 'Medellín', ...cob({ estudiantes: 3 }) }, { ciudad: INTERNACIONAL, nombre: 'Internacional · sin DIVIPOLA', ...cob({ estudiantes: 1 }) }],
    receptores: [{ tipo: 'interna_cun', ...cob({ estudiantes: 2, practicas: 2 }) }, { tipo: 'externa', ...cob({ estudiantes: 8, practicas: 8 }) }],
    cruces: { ...reporte().cruces, programaSector: [{ fila: 'SIS', columna: 'J', estudiantes: 3, practicas: 3 }, { fila: 'ADM', columna: 'J', estudiantes: 2, practicas: 2 }, { fila: 'ADM', columna: 'P', estudiantes: 5, practicas: 5 }] },
    ...s,
  });
  it('KPI solo con totales que la API ya entrega: receptoras, externas, internas CUN, sectores, ciudades e internacionales', () => {
    assert.deepEqual(metricasOrganizaciones(org()).map((m) => [m.t, m.n]), [
      ['Organizaciones receptoras', 4], ['Empresas externas', 3], ['Prácticas internas CUN', 2], ['Sectores', 2], ['Ciudades', 2], ['Internacionales', 1],
    ]);
    const prod = metricasOrganizaciones(org({ dimensiones: { semestre: 'no_disponible', nombrePrograma: 'no_disponible', ubicacionInternacional: 'no_disponible' } }));
    assert.ok(!prod.some((m) => m.t === 'Internacionales'), 'sin la dimensión sintética no se inventa el total');
  });
  it('lecturas deterministas (máx. 3), sin IA y solo con denominador: ciudad sobre externas, sector por programas, peso interno', () => {
    const t = insightsOrganizaciones(org(), { ciudad: (c) => ({ '11001': 'Bogotá, D.C.', '05001': 'Medellín' })[c] ?? c, sector: (c) => c });
    assert.deepEqual(t, [
      'Bogotá, D.C. concentra el 50,0 % de las prácticas externas.',
      'El sector Información y comunicaciones recibe estudiantes de 2 programas.',
      'El 20,0 % de las prácticas son internas CUN.',
    ]);
    assert.deepEqual(insightsOrganizaciones(reporte({ empresas: [], sectores: [], receptores: [], resumen: cob({ practicas: 0 }) }), { ciudad: String, sector: String }), [], 'sin datos, sin lecturas');
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

describe('Reportes V3.1 · gráficas', () => {
  const graficas = ['reportes-barras', 'reportes-columnas', 'reportes-proporcion', 'reportes-dona', 'reportes-lineas', 'reportes-grupos', 'reportes-matriz', 'reportes-apiladas'];
  it('SIPRA Charts Theme: tokens únicos para oscuro y claro; ninguna gráfica fija colores propios', () => {
    // Paleta BI: cada tono definido una vez para oscuro y otra para claro; los significados (--gr-*) apuntan a la paleta.
    for (const t of ['--bi-blue', '--bi-sky', '--bi-cyan', '--bi-teal', '--bi-emerald', '--bi-lime', '--bi-amber', '--bi-orange', '--bi-coral', '--bi-rose', '--bi-gris', '--gr-muted', '--gr-rejilla', '--gr-eje']) {
      assert.equal((ESTILOS_REPORTES.match(new RegExp(`${t}: `, 'g')) ?? []).length, 2, `${t} en oscuro y en claro`);
    }
    assert.match(ESTILOS_REPORTES, /--gr-principal: var\(--bi-blue\); --gr-comparacion: var\(--bi-orange\); --gr-ok: var\(--bi-emerald\); --gr-info: var\(--bi-sky\); --gr-aviso: var\(--bi-amber\);/);
    assert.match(ESTILOS_REPORTES, /--gr-riesgo: var\(--bi-rose\); --gr-interna: var\(--bi-teal\); --gr-externa: var\(--bi-blue\);/);
    assert.doesNotMatch(ESTILOS_REPORTES, /#(7c3aed|8b5cf6|6366f1|a855f7|9333ea|4f46e5)/i, 'sin morado ni índigo');
    // Familias (base clara): académico, organizaciones, atención, crítico y neutro; en claro las cifras de serie van en tinta.
    const claros = /:host-context\(\[data-theme='light'\]\) \{ (--bi-blue[^}]*)\}/.exec(ESTILOS_REPORTES)?.[1] ?? '';
    for (const hex of ['#2563eb', '#0284c7', '#0e7490', '#0f766e', '#15803d', '#4d7c0f', '#be123c', '#64748b']) assert.ok(claros.includes(hex), hex);
    assert.match(claros, /--gr-valor: var\(--text-primary\)/);
    assert.match(leer('reportes-barras.component.ts'), /color: var\(--gr-valor, var\(--c\)\)/);
    // Como marca (no texto), cada tono claro ≥ 3:1 sobre el lienzo claro de SIPRA.
    const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    for (const [, nombre, hex] of claros.matchAll(/--bi-(\w+): (#[0-9a-f]{6})/g)) {
      assert.ok((lum('#d3e4ee') + 0.05) / (lum(hex) + 0.05) >= 3, `--bi-${nombre} (${hex}) como marca sobre el lienzo claro`);
    }
    for (const g of graficas) {
      const hex = (leer(`${g}.component.ts`).match(/#[0-9a-f]{3,8}\b/gi) ?? []).filter((h) => h.toLowerCase() !== '#ffffff');
      assert.deepEqual(hex, [], `${g}: colores desde los tokens`);
    }
  });
  it('cada gráfica: escala o leyenda con cifra, tooltip compartido decorativo (sin title nativo) y selección con aria-pressed', () => {
    for (const g of graficas) {
      const t = plantilla(`${g}.component.ts`);
      assert.match(t, /aria-pressed/, `${g}: selección accesible`);
      assert.match(t, /<sipra-reportes-tooltip \[tip\]="tip\(\)" \/>/, `${g}: tooltip compartido`);
      assert.doesNotMatch(t, /\[title\]=/, `${g}: sin tooltip nativo`);
    }
    for (const g of ['reportes-barras', 'reportes-columnas', 'reportes-grupos', 'reportes-apiladas', 'reportes-lineas']) {
      assert.match(plantilla(`${g}.component.ts`), /esc\(\)\.marcas/, `${g}: eje con marcas de escala real`);
    }
    assert.match(plantilla('reportes-tooltip.component.ts'), /<div class="tip" aria-hidden="true"/);
    // Etiquetas: el % solo dentro del segmento si cabe (labelSkipWidth); en barras, la cifra siempre al final.
    assert.match(plantilla('reportes-proporcion.component.ts'), /@if \(p\.n \/ suma\(\) >= minRotulo\)/);
    assert.match(plantilla('reportes-barras.component.ts'), /<span class="gb-valor" \[style\.left\.%\]="ancho\(i\.n\)">/);
  });
  it('motion: 300–450 ms con easing suave al filtrar; reduced motion sin transición', () => {
    assert.match(ESTILOS_REPORTES, /--gr-dur: 380ms; --gr-ease: cubic-bezier\(\.25, \.8, \.25, 1\)/);
    assert.match(ESTILOS_REPORTES, /@media \(prefers-reduced-motion: reduce\) \{ \.gr-marco \* \{ transition: none !important; \} \}/);
    assert.match(leer('reportes-barras.component.ts'), /transition: width var\(--gr-dur\) var\(--gr-ease\)/);
    assert.match(leer('reportes-columnas.component.ts'), /transition: height var\(--gr-dur\) var\(--gr-ease\)/);
  });
  it('leyendas compactas: la pila muestra las series con tono propio y «+N más» para el resto', () => {
    assert.match(plantilla('reportes-apiladas.component.ts'), /@for \(c of leyenda\(\); track c\)/);
    assert.match(plantilla('reportes-apiladas.component.ts'), /'\+' \+ \(columnas\(\)\.length - maxLeyenda\) \+ ' más'/);
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
    assert.match(plantilla('reportes.component.ts'), /@case \('organizaciones'\) \{ <sipra-reportes-organizaciones \/> \}/);
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
    assert.match(t, /\{\{ num\(r\.resumen\.estudiantes\) \}\} de \{\{ num\(r\.universo\.estudiantes\) \}\} estudiantes en alcance/);
    assert.match(t, /id="rp-ciclo"/);
    assert.match(t, /id="rp-empresa"/);
  });
  it('cross-filter accesible: barras y pilas son botones con aria-pressed; tooltip con cantidad y % del universo filtrado', () => {
    const b = plantilla('reportes-barras.component.ts');
    assert.match(b, /<button type="button" class="gb-fila"[^>]*\[attr\.aria-pressed\]="seleccionable\(\) \? i\.clave === seleccion\(\) : null"/);
    assert.match(leer('reportes-barras.component.ts'), /readonly base = input\('del universo filtrado'\)/);
    assert.match(b, /Ver todos \(/);
    const a = plantilla('reportes-apiladas.component.ts');
    assert.match(a, /class="ley" \[attr\.aria-pressed\]/);
    assert.match(a, /class="rot" \[attr\.aria-pressed\]/);
    assert.match(a, /Ver como tabla/);
    assert.match(a, /class="pila-a" aria-hidden="true"/);
  });
  it('General: KPI por universo + reconciliación + lecturas; composición por modalidad (barras apiladas absolutas, 7/12) junto a programa (5/12); nivel, semestre e interna/externa (4/12)', () => {
    const g = plantilla('reportes-general.component.ts');
    const orden = ['g-op', 'g-prog', 'g-niv', 'g-semestre', 'g-rec'].map((id) => g.indexOf(`id="${id}"`));
    assert.ok(orden.every((x) => x > 0), 'todas las secciones existen');
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'en el orden de lectura');
    assert.doesNotMatch(g, /sipra-reportes-mekko/, 'el Mekko ya no es la vista principal');
    const m = metricasGenerales(reporte());
    assert.deepEqual(m.map((x) => x.t), ['Estudiantes', 'Prácticas', 'Expedientes completos', 'Requieren corrección', 'Cobertura vigente %', 'Aprobación %']);
    assert.match(g, /<sipra-reportes-kpis [^>]*\[acentos\]="acentos" \[grupos\]="grupos"/);
    assert.deepEqual(GRUPOS_GENERAL.map((x) => [x.titulo, x.n]), [['Operación', 2], ['Expedientes', 2], ['Documentación', 2]]);
    assert.deepEqual(ACENTOS_GENERAL, ['c0', 'c8', 'ok', 'aviso', 'info', 'c4']);
    assert.match(g, /<sipra-reportes-composicion titulo="Prácticas por modalidad y situación del expediente" \[celdas\]="r\.cruces\.modalidadSituacion"/);
    assert.match(g, /class="ra-bloque ra-zona zona-academica c7 alto-l" aria-labelledby="g-op"/);
    assert.match(g, /class="ra-bloque ra-zona zona-academica c5 alto-l" aria-labelledby="g-prog"/);
    for (const id of ['g-niv', 'g-rec']) assert.match(g, new RegExp(`c4 alto-s" aria-labelledby="${id}"`));
    assert.match(g, /<sipra-reportes-barras titulo="Estudiantes por programa" [^>]*\[total\]="r\.facetas\.programa\.estudiantes"/);
    assert.match(g, /class="rec" aria-label="Cómo cuadran las cifras"/);
    assert.match(leer('reportes-general.component.ts'), /texto: p\.nombre \?\? p\.programa, n: p\.estudiantes, detalle: \[p\.nombreEscuela\]/);
    assert.deepEqual(partesReceptor(reporte()).map((x) => x.tono), ['interna', 'externa']);
  });
  it('Organizaciones: KPI, ranking EXTERNO (CUN aparte), sector, ciudad, interna/externa, lecturas, programa × sector y franja de detalle', () => {
    const o = plantilla('reportes-organizaciones.component.ts');
    const orden = ['o-pack', 'o-emp', 'o-cruce', 'o-ciudad', 'o-rec'].map((id) => o.indexOf(`id="${id}"`));
    assert.ok(orden.every((x) => x > 0), 'todas las secciones existen');
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'layout: circle packing + ranking; heatmap; ciudades + interna/externa');
    assert.match(o, /<sipra-reportes-pack titulo="Estudiantes por sector económico y organización" \[hojas\]="hojasPack\(\)"/);
    assert.match(leer('reportes-organizaciones.component.ts'), /filter\(\(e\) => e\.tipo === 'externa' && e\.estudiantes > 0\)/, 'el pack, como el ranking, sin la CUN');
    assert.match(o, /<sipra-reportes-insights class="zona-org" \[lineas\]="insights\(\)\.slice\(0, 2\)" \/>/);
    assert.match(o, /No hay mapa: el repositorio no tiene geometría DIVIPOLA confiable/);
    assert.match(o, /<sipra-reportes-kpis class="tira"/);
    assert.match(leer('reportes-organizaciones.component.ts'), /\.filter\(\(e\) => e\.tipo !== 'interna_cun'\)/);
    assert.match(o, /class="cun"[\s\S]*?Ver solo internas/);
    assert.match(o, /<sipra-reportes-dona titulo="Estudiantes por tipo de organización receptora"/);
    assert.match(o, /<sipra-reportes-matriz titulo="Estudiantes por programa y sector"[\s\S]*?\(elegirCelda\)="celda\(\$event\)"/);
    assert.match(o, /@if \(organizacion\(\); as o\) \{/);
    assert.match(o, />Ver estudiantes</);
    for (const t of ['Estudiantes de la organización por programa', 'Estudiantes de la organización por modalidad']) assert.ok(o.includes(t), t);
    const m = plantilla('reportes-matriz.component.ts');
    assert.match(m, /<caption class="ra-sr">/, 'la matriz es una tabla real');
    assert.match(m, /class="gm-fila" \[attr\.aria-pressed\]/);
    assert.match(m, /class="gm-col" \[attr\.aria-pressed\]="seleccionColumna\(\) !== null && c === seleccionColumna\(\)"/);
  });
  it('Estudiantes: composición académica y un explorador de cruces; organizaciones en su pestaña', () => {
    const e = plantilla('reportes-estudiantes.component.ts');
    assert.ok(e.includes('id="e-esc"'));
    for (const id of ['e-emp', 'e-sector', 'e-ciudad']) assert.ok(!e.includes(`id="${id}"`), `${id} vive en Organizaciones`);
    assert.match(e, /<sipra-reportes-cruces \/>/);
    assert.match(e, /estado\.pestana\.set\('organizaciones'\)/);
    assert.match(e, /No disponible\. SIPRA no lo guarda en la práctica|Semestre: no disponible/);
    assert.deepEqual(CRUCES.map((c) => c.id), ['programaModalidad', 'programaNivel', 'nivelModalidad', 'semestreModalidad', 'programaSector', 'programaCiudad', 'modalidadSector', 'nivelSector', 'receptorPrograma']);
    assert.ok(CRUCES.find((c) => c.id === 'semestreModalidad')?.requiereSemestre);
    const c = plantilla('reportes-cruces.component.ts');
    assert.match(c, /\[attr\.aria-pressed\]="actual\(\)\.id === c\.id"/);
    assert.equal((c.match(/<sipra-reportes-apiladas/g) ?? []).length, 1, 'una sola pila a la vez');
  });
  it('Documentos: salud documental, situación clicable, grupos afectados, tipos con volumen y tasa por separado, historial y tiempos', () => {
    const d = plantilla('reportes-documentos.component.ts');
    for (const id of ['d-resumen', 'd-sit', 'd-salud', 'd-tipo', 'd-fric', 'd-tiempo']) assert.ok(d.includes(`id="${id}"`), id);
    for (const c of ['>Pendientes<', '>% aprobación<', '>% corrección<', 'Devol./doc.', 'Versiones/doc.']) assert.ok(d.includes(c), c);
    assert.match(d, /Movimiento de las últimas 12 semanas/);
    assert.match(d, /\[seleccion\]="estado\.filtros\(\)\.situacion" \(elegir\)="situacion\(\$event\)"/);
    assert.match(leer('reportes-documentos.component.ts'), /this\.estado\.alternar\('situacion', s as SituacionExpediente\)/);
    // Una sola gráfica de correcciones con selector volumen / tasa (no dos simultáneas).
    assert.match(d, /id="d-corr"/);
    assert.match(d, />Por volumen</);
    assert.match(d, />Por tasa</);
    assert.equal((d.match(/titulo="Tipos de documento con más correcciones"/g) ?? []).length, 1);
    assert.match(d, /<sipra-reportes-lineas titulo="Cargas y decisiones por semana"/);
  });
  it('Períodos: A frente a B y evolución de hasta 5 programas', () => {
    const p = plantilla('reportes-periodos.component.ts');
    assert.equal(MAX_PROGRAMAS_EVOLUCION, 5);
    assert.match(p, /Periodo A frente a periodo B/);
    assert.match(p, /r\.cruces\.periodoModalidad/);
    // Tiempo = línea; ranking en el tiempo = bump; composición en el tiempo = stream; A/B = agrupadas. Una vista grande a la vez.
    assert.match(p, /<sipra-reportes-lineas titulo="Cobertura y aprobación documental por periodo"/);
    assert.match(p, /<sipra-reportes-bump titulo="Ranking de programas por periodo"/);
    assert.match(p, /<sipra-reportes-stream titulo="Estudiantes por modalidad y periodo"/);
    assert.match(p, /<sipra-reportes-grupos /);
    assert.match(p, /@switch \(vista\(\)\) \{/);
    assert.deepEqual(VISTAS_PERIODOS.map((v) => v.id), ['volumen', 'composicion', 'ranking', 'ab'], 'abre con el volumen por programa; el ranking es secundario');
    assert.match(leer('reportes-periodos.component.ts'), /readonly vista = signal<VistaPeriodos>\('volumen'\)/);
    assert.equal(FORMA_VOLUMEN, 'lineas', 'AreaBump evaluado y descartado por confuso');
    assert.match(p, /<sipra-reportes-lineas titulo="Estudiantes por programa y periodo"/);
    assert.match(p, /1 = el programa con más estudiantes/);
    assert.doesNotMatch(p, /barra-ev|class="doble"/);
    // El eje temporal solo lleva periodos con fecha (los «sin fecha» siguen en la tabla).
    assert.match(leer('reportes-periodos.component.ts'), /nombresPeriodo = computed\(\(\) => this\.fechados\(\)/);
  });
  it('tabla granular: columnas esenciales por defecto (todas a pedido), encabezado fijo, búsqueda y «Abrir expediente»; sin documento ni correo', () => {
    const t = plantilla('reportes-detalle.component.ts');
    assert.doesNotMatch(t, /documento de identidad|correo|\.documento\b/i);
    assert.match(t, /\[routerLink\]="\['\/practicas', f\.practicaId\]"/);
    assert.match(t, />Abrir expediente</);
    assert.match(t, /type="search"/);
    for (const c of ['Estudiante', 'Programa', 'Nivel', 'Modalidad', 'Organización', 'Sector', 'Ciudad', 'Periodo', 'Expediente', 'Avance']) assert.ok(t.includes(`>${c}</th>`), c);
    assert.match(t, /@if \(todas\(\)\) \{ <th scope="col" class="d">Pend\.<\/th><th scope="col" class="d">Devol\.<\/th>/);
    assert.match(leer('reportes-detalle.component.ts'), /\.marco-tabla thead th \{ position: sticky; top: 0;/);
    assert.match(leer('reportes-detalle.component.ts'), /\.ra-tabla \.accion \{ position: sticky; right: 0;/, '«Abrir expediente» siempre visible');
    assert.match(t, /<td class="accion"><a \[routerLink\]/);
    // Períodos: A/B por defecto entre los dos últimos periodos CON fecha (un «sin fecha» no es el más reciente).
    assert.match(leer('reportes-periodos.component.ts'), /!sinFecha\.has\(p\.periodo\)/);
    assert.doesNotMatch(t, /\bnit\b|tel[eé]fono|direcci[oó]n/i);
  });
  it('carga, vacío y error con reintento; gráficas decorativas con tabla', () => {
    const t = plantilla('reportes.component.ts');
    assert.match(t, /<sipra-carga-senal/);
    assert.match(t, /titulo="Sin prácticas para estos filtros"/);
    assert.match(t, /role="alert"[\s\S]*?Reintentar/);
    assert.match(t, /class="estado-linea" role="status" aria-live="polite"/);
    assert.match(t, /\[class\.recalculando\]="estado\.cargando\(\) && !!estado\.datos\(\)"/);
    assert.match(t, /@for \(e of empresasDelContexto\(\); track e\)/);
    assert.match(t, /@if \(migas\(\)\.length\) \{/);
  });
  it('responsive: barras, pilas y tabla se reorganizan bajo 700 px', () => {
    for (const f of ['reportes-barras.component.ts', 'reportes-apiladas.component.ts', 'reportes-detalle.component.ts', 'reportes.component.ts']) {
      assert.match(leer(f), /@media \(width < 700px\)/, f);
    }
    // Selección: lo no elegido pasa a muted (solo la marca gráfica) y lo elegido se resalta con aria-pressed y negrita.
    assert.match(leer('reportes-barras.component.ts'), /\.gb\.con-seleccion \.gb-fila\[aria-pressed='false'\] \.gb-barra \{ background: var\(--gr-muted\); \}/);
    // Hover: la señalada conserva presencia, el resto baja (sin glow).
    assert.match(leer('reportes-barras.component.ts'), /\.gb\.con-hover \.gb-fila:not\(\.activa\) \.gb-barra \{ opacity: \.42; \}/);
    // Móvil: las etiquetas pasan arriba de la barra y los rankings se limitan a Top 5.
    assert.match(leer('reportes-barras.component.ts'), /\.gb-y \{ grid-column: 1 \/ -1; grid-row: 1; \}/);
    assert.match(leer('reportes-barras.component.ts'), /this\.movil\(\) \? Math\.min\(TOP_MOVIL, this\.limite\(\)\)/);
    assert.match(plantilla('reportes-apiladas.component.ts'), /\[class\.atenuada\]="!!seleccionColumna\(\) && p\.columna !== seleccionColumna\(\)"/);
    // Regresión (1.000 filas): el texto solo para lectores (.ra-sr, absoluto) ensanchaba la página si el contenedor no estaba posicionado.
    assert.match(readFileSync(join(dir, 'reportes.estilos.ts'), 'utf8'), /\.ra-desliza \{ overflow-x: auto; position: relative; \}/);
  });
});

describe('Reportes V3.2 · universo, preset y facetas en la vista', () => {
  it('preset «Dataset v4»: la primera carga en dev aplica los periodos del servidor ANTES de pintar; «Todos» y «Limpiar»', async () => {
    const { api, estado } = crear();
    const periodos = ['2026A', '2026B', '26V04'];
    api.respuesta = reporte({ dataset: { periodos } });
    await estado.cargar();
    assert.deepEqual(api.llamadas.map((l) => l.p['periodos'] ?? ''), ['', periodos.join(',')], 'una carga sin periodos y la del dataset');
    assert.deepEqual(estado.filtros().periodos, periodos);
    assert.ok(estado.presetActivo() && estado.enInicio());
    assert.equal(ROTULO_DATASET, 'Dataset v4');
    estado.filtrar({ periodos: [] });
    assert.ok(!estado.presetActivo() && !estado.enInicio(), '«Todos» es una elección explícita');
    estado.alternar('programa', 'SIS-PRO');
    estado.limpiar();
    assert.deepEqual(estado.filtros().periodos, periodos, '«Limpiar» vuelve al contexto inicial');
    assert.equal(estado.filtros().programa, '');
    await esperar();
  });
  it('sin dataset (producción): no hay preset y el contexto inicial es todo el alcance', async () => {
    const { api, estado } = crear();
    await estado.cargar();
    assert.equal(api.llamadas.length, 1);
    assert.deepEqual(estado.filtros().periodos, []);
    assert.equal(estado.dataset(), null);
    assert.ok(estado.enInicio());
  });
  it('el contexto de dev explica 1.003 frente a 1.000 con un conteo calculado (nunca un número fijo)', () => {
    const t = plantilla('reportes.component.ts');
    assert.match(t, /@if \(estado\.dataset\(\)\) \{/);
    assert.match(t, /class="chip preset" \[attr\.aria-pressed\]="estado\.presetActivo\(\)"/);
    const c = leer('reportes.component.ts');
    assert.match(c, /const fuera = r\.universo\.practicas - enDataset;/);
    assert.doesNotMatch(c, /\b1\.?000\b|\b1\.?003\b/, 'sin cifras fijas del dataset');
  });
});

describe('Reportes V3.2 · visualizaciones (lógica pura)', () => {
  it('Composición: filas por volumen (Top 7 + «Otras»), segmentos en orden semántico, la fila elegida nunca se agrupa, la suma no cambia', () => {
    const celdas = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].flatMap((m, i) => [
      { fila: m, columna: 'completo', estudiantes: 10 - i, practicas: 10 - i }, { fila: m, columna: 'en_curso', estudiantes: 5, practicas: 5 }]);
    const f = filasComposicion(celdas, ['completo', 'en_curso'], (v) => v.toUpperCase());
    assert.equal(MAX_FILAS_COMPOSICION, 7);
    assert.equal(f.length, MAX_FILAS_COMPOSICION + 1);
    assert.equal(f.at(-1)?.clave, OTRAS_FILAS);
    assert.equal(f.at(-1)?.texto, 'Otras 2 modalidades');
    assert.ok(f.slice(0, -1).every((x, k, a) => k === 0 || a[k - 1].total >= x.total), 'de mayor a menor (la longitud es el volumen)');
    assert.equal(f.reduce((n, x) => n + x.total, 0), celdas.reduce((n, c) => n + c.practicas, 0));
    assert.ok(filasComposicion(celdas, ['completo', 'en_curso'], String, MAX_FILAS_COMPOSICION, 'i').some((x) => x.clave === 'i'));
  });
  it('Bump: puesto entre TODAS las series por periodo (1 = más), desempate estable; 5 visibles al abrir, hasta 8', () => {
    const r = rankings([{ clave: 'a', texto: 'A', valores: [5, 1] }, { clave: 'b', texto: 'B', valores: [9, 1] }, { clave: 'c', texto: 'C', valores: [0, 7] }], 2);
    assert.deepEqual(r, [[2, 2], [1, 3], [null, 1]]);
    assert.equal(INICIAL_BUMP, 5);
    assert.equal(MAX_BUMP, 8);
  });
  it('Stream: cinco bandas + «Otras» solo para el dibujo; cada periodo conserva su total', () => {
    const celdas = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].flatMap((m, i) => [{ fila: 'P1', columna: m, estudiantes: 10 + i, practicas: 0 }, { fila: 'P2', columna: m, estudiantes: 1, practicas: 0 }]);
    const b = bandas(celdas, ['P1', 'P2'], String);
    assert.equal(b.length, MAX_BANDAS + 1);
    assert.equal(b.at(-1)?.clave, OTRAS_BANDA);
    assert.deepEqual([0, 1].map((i) => b.reduce((n, x) => n + x.valores[i], 0)), [celdas.filter((c) => c.fila === 'P1').reduce((n, c) => n + c.estudiantes, 0), 7]);
  });
  it('Swarm: escala log de minutos a un mes; enjambre sin solapes dentro de la fila', () => {
    assert.ok(posLog(0.1) < posLog(1) && posLog(1) < posLog(24) && posLog(24) < posLog(720));
    assert.deepEqual(MARCAS_HORAS.map((m) => m.t), ['6 min', '1 h', '4 h', '1 d', '3 d', '1 sem', '1 mes']);
    const xs = Array.from({ length: 40 }, (_, i) => 100 + (i % 10));
    const ys = enjambre(xs, 2.6, 30);
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
      if (Math.abs(ys[i]) < 30 && Math.abs(ys[j]) < 30) assert.ok(d >= 5.2 - 1e-6, `puntos ${i} y ${j} se solapan`);
    }
  });
  it('Drilldown de Estudiantes: árbol escuela → programa → nivel → semestre; treemap squarified con área proporcional y dentro del marco', () => {
    const a = arbol([
      { escuela: 'E1', programa: 'P1', ciclo: 'tecnico', semestre: 4, estudiantes: 3 }, { escuela: 'E1', programa: 'P1', ciclo: 'profesional', semestre: 8, estudiantes: 2 },
      { escuela: 'E2', programa: 'P2', ciclo: 'tecnologo', semestre: null, estudiantes: 4 },
    ], [String, String, String, String]);
    assert.equal(a.n, 9);
    assert.deepEqual(a.hijos.map((h) => [h.clave, h.n]), [['E1', 5], ['E2', 4]]);
    assert.equal(a.hijos[1].hijos[0].hijos[0].hijos.length, 0, 'sin semestre no se inventa un nodo');
    assert.deepEqual([...NIVELES_DRILL], ['Escuelas', 'Programas', 'Nivel de formación', 'Semestre']);
    const v = [346, 319, 264, 71], R = squarify(v, 800, 400), total = v.reduce((x, y) => x + y, 0);
    R.forEach((q, i) => {
      assert.ok(Math.abs((q.w * q.h) / (800 * 400) - v[i] / total) < 1e-6, 'área ∝ estudiantes');
      assert.ok(q.x >= -1e-6 && q.y >= -1e-6 && q.x + q.w <= 800 + 1e-6 && q.y + q.h <= 400 + 1e-6, 'dentro del marco');
    });
    assert.ok(R.every((q) => Math.max(q.w / q.h, q.h / q.w) < 4), 'proporciones legibles (squarified)');
  });
  it('Circle packing: sin solapes y envolvente que contiene todo', () => {
    const { c, R } = empaquetar([10, 8, 8, 5, 3, 3, 2, 1], 1);
    for (let i = 0; i < c.length; i++) {
      assert.ok(Math.hypot(c[i].x, c[i].y) + c[i].r <= R + 1e-6);
      for (let j = i + 1; j < c.length; j++) assert.ok(Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) >= c[i].r + c[j].r + 1 - 1e-6, `${i}/${j}`);
    }
  });
  it('Radar: perfil de tasas 0–100 (nunca volumen), null sin denominador; máximo dos series', () => {
    assert.equal(EJES_PERFIL.length, 5);
    const v = perfilDe(cob({ exigidos: 20, cargados: 10, aprobados: 5, practicas: 4, completos: 1, correccion: 2, documentos: 10, conReenvio: 3 }));
    assert.deepEqual(v, [50, 25, 25, 90, 70]);
    assert.deepEqual(perfilDe(cob({ exigidos: 0, practicas: 0, documentos: 0 })), [null, null, null, null, null]);
    assert.equal(sumarCobertura([cob(), cob()]).exigidos, 36);
    assert.equal(MAX_SERIES_RADAR, 2);
  });
  it('lecturas: máximo dos por pestaña, deterministas y con su denominador', () => {
    const n = { programa: String, modalidad: String, tipo: String, escuela: String };
    const r = reporte({ niveles: [{ ciclo: 'profesional', ...cob({ estudiantes: 2 }) }, { ciclo: 'tecnico', ...cob({ estudiantes: 1 }) }],
      cruces: { ...reporte().cruces, modalidadSituacion: [{ fila: 'pasantia', columna: 'requiere_correccion', estudiantes: 5, practicas: 5 }, { fila: 'pasantia', columna: 'completo', estudiantes: 20, practicas: 20 }] } });
    assert.deepEqual(insights.general(r, n), ['Profesional concentra el 66,7 % de los estudiantes.', 'pasantia tiene la mayor proporción de expedientes que requieren corrección (20,0 %).']);
    for (const k of ['general', 'estudiantes', 'documentos', 'periodos'] as const) assert.ok(insights[k](reporte(), n).length <= MAX_INSIGHTS);
    assert.deepEqual(insights.documentos(reporte({ tiempos: { decisiones: 3, medianaHoras: 4, p90Horas: 10, porTipo: [], muestras: [] } }), n), [], 'con pocas decisiones no se afirma una mediana');
  });
});

describe('Reportes V3.2 · plantillas de las visualizaciones nuevas', () => {
  const nuevas = ['reportes-composicion', 'reportes-bump', 'reportes-stream', 'reportes-swarm', 'reportes-treemap', 'reportes-pack', 'reportes-radar'];
  it('cada visualización nueva: tooltip compartido, sin title nativo y alternativa tabular o lista', () => {
    for (const g of nuevas) {
      const t = plantilla(`${g}.component.ts`);
      assert.match(t, /<sipra-reportes-tooltip \[tip\]="tip\(\)" \/>/, g);
      assert.doesNotMatch(t, /\[title\]=/, g);
      assert.match(t, /<table class="ra-tabla|<ul class="g[iq]-lista|ra-tabla|<sipra-reportes-barras/, `${g}: tabla, lista o ranking equivalente`);
    }
  });
  it('fallback móvil: drilldown → ranking, heatmap → cruces mayores, pack → lista, bump/stream/swarm → tabla', () => {
    assert.match(plantilla('reportes-treemap.component.ts'), /@if \(modo\(\) === 'ranking' \|\| movil\(\)\) \{/);
    for (const g of ['reportes-pack', 'reportes-bump', 'reportes-stream', 'reportes-swarm', 'reportes-matriz']) {
      assert.match(plantilla(`${g}.component.ts`), /@if \(movil\(\)\) \{/, g);
      assert.match(leer(`${g}.component.ts`), /escucharMovil\(this\.movil\)/, g);
    }
  });
  it('selección accesible: composición (fila y leyenda), pack (organización), drilldown (bloques) y bump (programas) con teclado', () => {
    assert.match(plantilla('reportes-composicion.component.ts'), /class="gk-rot" \[attr\.aria-pressed\]/);
    assert.match(plantilla('reportes-composicion.component.ts'), /\[attr\.aria-pressed\]="seleccionColumna\(\) === c\.clave"/);
    assert.match(plantilla('reportes-composicion.component.ts'), /\[attr\.aria-pressed\]="modo\(\) === 'cantidad'"/, 'Cantidad | %');
    assert.match(plantilla('reportes-pack.component.ts'), /\(keydown\.enter\)="elegir\.emit\(h\.clave\)"/);
    assert.match(plantilla('reportes-treemap.component.ts'), /<button type="button" class="gt-b"[^>]*\[attr\.aria-label\]/);
    assert.match(plantilla('reportes-bump.component.ts'), /\[attr\.aria-pressed\]="visibles\(\)\.includes\(s\.clave\)"/);
  });
  it('HeatMap: % dentro de la fila y de la columna; intensidad con techo por tema y una sola polaridad de texto (AA)', () => {
    const m = leer('reportes-matriz.component.ts');
    assert.match(m, /dentro de \$\{this\.textoFila\(\)\(f\)\}`, `\$\{pct1\(v, this\.totalColumna\(\)\.get\(c\) \?\? 0\)\} dentro de/);
    assert.match(m, /\.gm \{ --gm-max: 45%; \}/);
    assert.match(m, /:host-context\(\[data-theme='light'\]\) \.gm \{ --gm-max: 65%; \}/);
    assert.doesNotMatch(m, /\.gm-celda\.fuerte \{[^}]*color:/);
  });
  it('reduced motion: ninguna transición dentro de las gráficas', () => {
    assert.match(ESTILOS_REPORTES, /@media \(prefers-reduced-motion: reduce\) \{ \.gr-marco \* \{ transition: none !important; \} \}/);
    for (const g of nuevas) if (/transition:/.test(leer(`${g}.component.ts`))) assert.match(leer(`${g}.component.ts`), /gr-marco/, `${g} usa el marco común`);
  });
});

describe('Reportes V3.3 · comprensión: reconciliación, ritmo y drilldown', () => {
  it('reconciliación visible: situaciones = prácticas; vigentes + por reenviar + sin cargar = exigidas (definición del dominio intacta)', () => {
    const r = reporte({ resumen: cob({ practicas: 1000, exigidos: 6210, cargados: 4365, aprobados: 3000 }),
      expedientes: { completo: 225, en_curso: 425, requiere_correccion: 275, sin_iniciar: 75, sin_matriz: 0 },
      documental: { sin_cargar: 1371, en_proceso: 521, en_revision: 844, correccion: 400, rechazado: 74, aprobado: 3000 } });
    const c = reconciliacion(r);
    assert.deepEqual(c.situaciones.map((x) => x.n), [225, 425, 275, 75]);
    assert.deepEqual(c.obligaciones.map((x) => [x.clave, x.n]), [['vigentes', 4365], ['reenvio', 474], ['sin_cargar', 1371]]);
    assert.ok(c.cierra, 'cierra con los datos reales del Dataset v4');
    // Con filtro de situación, la cifra de la reconciliación es la del universo filtrado (no la faceta).
    assert.deepEqual(reconciliacion(reporte({ resumen: cob({ practicas: 7 }) }), 'completo').situaciones.map((x) => [x.clave, x.n]), [['completo', 7]]);
    assert.ok(!reconciliacion(reporte({ resumen: cob({ exigidos: 10, cargados: 2 }), documental: { sin_cargar: 1, en_proceso: 0, en_revision: 0, correccion: 0, rechazado: 0, aprobado: 0 } })).cierra, 'si algo no cuadra, se detecta');
  });
  it('KPI agrupados por universo (títulos de grupo, corte visual y nombre del grupo en la etiqueta accesible)', () => {
    const k = plantilla('reportes-kpis.component.ts');
    assert.match(k, /@if \(grupos\(\)\.length\) \{/);
    assert.match(k, /\[class\.corte\]="corte\(\$index\)"/);
    assert.match(k, /\[attr\.aria-label\]="grupoDe\(\$index\) \+ k\.c\.rotulo/);
  });
  it('sistema de alturas y rejilla de 12 columnas; en pantallas estrechas todo a una columna', () => {
    assert.match(ESTILOS_REPORTES, /\.ra-g12 \{ display: grid; grid-template-columns: repeat\(12, minmax\(0, 1fr\)\); gap: 20px; align-items: stretch; margin-top: 32px; \}/);
    assert.match(ESTILOS_REPORTES, /:host \{ --alto-s: 240px; --alto-m: 340px; --alto-l: 460px; \}/);
    assert.match(ESTILOS_REPORTES, /@media \(width < 1100px\) \{ \.c4, \.c5, \.c6, \.c7, \.c8 \{ grid-column: span 12; \}/);
    for (const f of ['reportes-general.component.ts', 'reportes-estudiantes.component.ts', 'reportes-documentos.component.ts']) assert.match(plantilla(f), /class="ra-g12"/, f);
  });
  it('Estudiantes: el drilldown reemplaza al Icicle (Mapa por defecto, Ranking alternativo); se mantienen programa, nivel, semestre y el HeatMap', () => {
    const e = plantilla('reportes-estudiantes.component.ts');
    assert.doesNotMatch(e, /sipra-reportes-icicle/);
    assert.match(e, /<sipra-reportes-treemap titulo="Estudiantes por escuela, programa, nivel y semestre"/);
    for (const t of ['<sipra-reportes-barras titulo="Estudiantes por programa"', '<sipra-reportes-dona titulo="Estudiantes por nivel de formación"', '<sipra-reportes-columnas titulo="Estudiantes por semestre"', '<sipra-reportes-matriz titulo="Estudiantes por programa y semestre"']) assert.ok(e.includes(t), t);
    assert.match(leer('reportes-treemap.component.ts'), /readonly modo = signal<'mapa' \| 'ranking'>\('mapa'\)/);
    assert.match(plantilla('reportes-treemap.component.ts'), /<ol class="gt-migas" aria-label="Ubicación">/);
  });
  it('Documentos: salud → tipos con problemas → tiempos (cabecera mediana/p90/decisiones) → evolución a todo el ancho → tablas plegadas en una línea', () => {
    const d = plantilla('reportes-documentos.component.ts');
    const orden = ['d-resumen', 'd-mapa', 'd-corr', 'd-tiempo', 'd-mov', 'd-salud'].map((id) => d.indexOf(`id="${id}"`));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden);
    assert.match(d, /<dl class="cifras-t">/);
    assert.match(d, /<details class="detalle-doc">/);
    assert.match(d, /class="ra-bloque ra-zona zona-tiempo c12" aria-labelledby="d-mov"/);
    assert.ok((d.match(/ra-una-linea/g) ?? []).length >= 3, 'tablas de una línea');
    assert.match(ESTILOS_REPORTES, /\.ra-una-linea th\[scope='row'\] \{ max-width: 22rem; overflow: hidden; text-overflow: ellipsis; \}/);
  });
});

describe('Reportes · circle packing: etiquetas de sector legibles', () => {
  const medir = (t: string) => t.length * 7; // 7 px por carácter (determinista para la prueba)
  it('envolver: palabras completas en 1–2 líneas; sin «…» si cabe; nunca corta una palabra', () => {
    assert.deepEqual(envolverEtiqueta('Actividades profesionales, científicas y técnicas', 210, medir), { lineas: ['Actividades profesionales,', 'científicas y técnicas'], completa: true });
    assert.deepEqual(envolverEtiqueta('Industrias manufactureras', 210, medir), { lineas: ['Industrias manufactureras'], completa: true });
    const largo = envolverEtiqueta('Comercio al por mayor y al por menor; reparación de vehículos automotores y motocicletas', 210, medir);
    assert.equal(largo.completa, false);
    assert.equal(largo.lineas.length, 2);
    assert.ok(largo.lineas.every((l) => medir(l) <= 210), 'cada línea cabe');
    assert.ok(largo.lineas[1].endsWith('…') && !/\S…$/.test(largo.lineas[1].replace(/[\wáéíóúñ]+…$/i, '')), 'el recorte es en un límite de palabra');
    for (const l of largo.lineas) for (const w of l.replace('…', '').split(' ')) assert.ok('Comercio al por mayor y al por menor; reparación de vehículos automotores y motocicletas'.split(' ').includes(w), `«${w}» es una palabra completa`);
  });
  it('fuente mínima legible (no se reduce el texto para que quepa)', () => {
    assert.ok(FUENTE_SECTOR >= 12);
  });
  it('nombre corto de organización: quita lo común entre hermanas y la forma jurídica (regla genérica)', () => {
    const h = ['Empresa Sintética Nova 050 S.A.S.', 'Empresa Sintética Faro 040 S.A.S.', 'Empresa Sintética Ceiba 089 (exterior)'];
    assert.equal(nombreCorto(h[0], h), 'Nova 050');
    assert.equal(nombreCorto(h[2], h), 'Ceiba 089');
    assert.equal(nombreCorto('Andina Ltda.', ['Andina Ltda.']), 'Andina');
  });
  it('etiquetas laterales: sin solapes entre etiquetas y guías que evitan los demás círculos cuando hay camino', () => {
    const circulos = [
      { clave: 'a', x: 300, y: 120, r: 40 }, { clave: 'b', x: 380, y: 140, r: 35 }, { clave: 'c', x: 330, y: 210, r: 45 },
      { clave: 'd', x: 420, y: 230, r: 38 }, { clave: 'e', x: 290, y: 300, r: 30 }, { clave: 'f', x: 400, y: 320, r: 42 },
    ].map((c) => ({ ...c, lineas: ['Nombre de sector', 'en dos líneas'], completa: true }));
    const et = etiquetasLaterales(circulos, 700, 420, 200);
    assert.equal(et.length, circulos.length);
    for (const lado of ['izq', 'der'] as const) {
      const l = et.filter((e) => e.lado === lado).sort((x, y) => x.y - y.y);
      for (let i = 1; i < l.length; i++) assert.ok(l[i].y >= l[i - 1].y + l[i - 1].alto, 'sin solape vertical');
    }
    assert.ok(et.every((e) => e.y >= -1 && e.y + e.alto <= 421), 'dentro del lienzo');
    assert.ok(cruzaCirculo([0, 0], [100, 0], { x: 50, y: 5, r: 10 }));
    assert.ok(!cruzaCirculo([0, 0], [100, 0], { x: 50, y: 30, r: 10 }));
  });
  it('plantilla: sin etiquetas dentro de las burbujas de sector; nombre completo en tooltip (hover y foco), aria, leyenda, cabecera y miga', () => {
    const t = plantilla('reportes-pack.component.ts');
    assert.match(t, /\(focus\)="verGrupo\(\$event, g\); foco\.set\(g\.clave\)"/, 'tooltip también con teclado');
    assert.match(t, /\[attr\.aria-label\]="ariaGrupo\(g\) \+ '\. Enter para ver sus organizaciones'"/);
    assert.match(leer('reportes-pack.component.ts'), /`\$\{g\.texto\}: \$\{num\(g\.n\)\} estudiantes, \$\{g\.hojas\.length\} organizaciones`/);
    assert.match(t, /<ul class="gq-ley" aria-label="Sectores \(nombre completo\); elegir uno amplía el gráfico">/);
    assert.match(t, /<li><button type="button" \(click\)="zoom\.set\(''\)">Todos los sectores<\/button><\/li><li>›<\/li><li><strong>\{\{ z\.texto \}\}<\/strong><\/li>/, 'miga sin truncar');
    assert.match(t, /<div class="gq-cab"[^>]*><span>Sector<\/span><b>\{\{ z\.texto \}\}<\/b><small>\{\{ z\.hojas\.length \}\} organizaciones · \{\{ num\(z\.n\) \}\} estudiantes<\/small>/);
    assert.match(leer('reportes-pack.component.ts'), /'Clic para explorar organizaciones'/);
    assert.doesNotMatch(t, /corto\(g\.texto/, 'ya no se recorta el nombre del sector dentro del círculo');
    assert.match(leer('reportes-pack.component.ts'), /\.gq svg \{ display: block; width: 100%; overflow: hidden; \}/, 'al ampliar nada se sale del gráfico');
  });
});
