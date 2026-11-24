import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { ReporteFuentes } from '@core/models/reportes-fuentes.model';
import {
  CLAVE_ORG_SIN_CORRESPONDENCIA, COMPATIBILIDAD_VISTA, FILTROS_FUENTE_VACIOS, FUENTES_REPORTE, ORG_SIN_CORRESPONDENCIA, avisosFuente, barrasDimension,
  cantidadFiltrosFuente, fecha, lecturaSolape, mensajeErrorFuente, parametrosFuente, periodosOrdenados, rangos, rotuloFuente,
} from '../src/app/features/reportes/reportes-fuentes.util';
import { destinoTecla } from '../src/app/features/reportes/reportes-fuente.component';
import { metricasFuente } from '../src/app/features/reportes/reportes-unificado.component';
import {
  GRAFICA_POR_METRICA, NO_DISPONIBLE_HISTORICO, anioPeriodo, categoriasEstado, celdasCruce, comparacionAB, ejePeriodos, gruposAB, partesNivel, rotulador, seriesPeriodo,
  seriesProgramas,
} from '../src/app/features/reportes/reportes-paridad.util';
import { pasoEtiquetas, rotulaEn } from '../src/app/features/reportes/reportes-graficos.util';
import { PESTANAS, migasFuente } from '../src/app/features/reportes/reportes.component';
import { ReportesEstado } from '../src/app/features/reportes/reportes.estado';

const vacias = { periodo: [], programa: [], nivel: [], regional: [], modalidadEstudio: [], modalidadPractica: [], estado: [], organizacion: [], ciudad: [] };
function reporte(s: Partial<ReporteFuentes> = {}): ReporteFuentes {
  return {
    fuente: 'all', generadoEn: '2026-11-20T15:00:00.000Z', estadoAl: { current: '2026-11-20T15:00:00.000Z', historical: '2026-09-21T16:45:00.000Z' },
    totales: { practicas: 299, estudiantesUnicos: 173, precisionEstudiantes: 'exacta' },
    dimensiones: {
      ...vacias,
      periodo: [{ clave: '2026C', etiqueta: '2026C', origen: 'current', valor: 40 }, { clave: '24V03', etiqueta: '24V03', origen: 'historical', valor: 100 }, { clave: '25V05', etiqueta: '25V05', origen: 'comun', valor: 159 }],
      nivel: [{ clave: 'tecnologo', etiqueta: 'Tecnólogo', origen: 'comun', valor: 200 }, { clave: 'profesional', etiqueta: 'Profesional', origen: 'comun', valor: 99 }],
      estado: [{ clave: 'cerrado', etiqueta: 'cerrado', origen: 'comun', valor: 150 }, { clave: 'en_practica', etiqueta: 'en_practica', origen: 'comun', valor: 149 }],
      organizacion: [
        { clave: 'empresa:00000000-0000-4000-8000-000000000001', etiqueta: 'Empresa Sintética', origen: 'current', valor: 40 },
        { clave: 'org-historica:a', etiqueta: ORG_SIN_CORRESPONDENCIA, origen: 'historical', valor: 30 },
        { clave: 'org-historica:b', etiqueta: ORG_SIN_CORRESPONDENCIA, origen: 'historical', valor: 25 },
      ],
      modalidadPractica: [{ clave: 'sgp:EMPRESA PROPIA', etiqueta: 'EMPRESA PROPIA', origen: 'historical', valor: 12 }],
    },
    tasas: { cierre: { numerador: 90, denominador: 120, valor: 0.75 }, reprobacion: { numerador: 6, denominador: 120, valor: 0.05 }, anulacion: { numerador: 0, denominador: 120, valor: 0 } },
    duracion: { casos: 120, p25: 80, mediana: 92, p75: 120 },
    indicadorDocumentalSgp: { casos: 200, subidoPromedio: 0.91, aprobadoPromedio: 0.8 },
    solapamiento: { categorias: { historical_only: 252, current_only: 45, matched: 1, candidate_overlap: 1, ambiguous_overlap: 0 }, excluidosDeAll: { CORRESPONDENCIA_CONFIRMADA_CON_SIPRA: 1 } },
    elegibilidad: {}, advertencias: [],
    cruces: {
      periodoPrograma: [
        { fila: "24V03", filaEtiqueta: "24V03", columna: "sgp:ADMINISTRACION", columnaEtiqueta: "ADMINISTRACION", valor: 60, origen: "historical" },
        { fila: "24V03", filaEtiqueta: "24V03", columna: "sinu:SIS-PRO", columnaEtiqueta: "SIS-PRO", valor: 40, origen: "historical" },
        { fila: "25V05", filaEtiqueta: "25V05", columna: "sgp:ADMINISTRACION", columnaEtiqueta: "ADMINISTRACION", valor: 100, origen: "historical" },
        { fila: "2026C", filaEtiqueta: "2026C", columna: "sinu:SIS-PRO", columnaEtiqueta: "SIS-PRO", valor: 40, origen: "current" },
      ],
      periodoModalidad: [{ fila: "24V03", filaEtiqueta: "24V03", columna: "modalidad:pasantia", columnaEtiqueta: "pasantia", valor: 100, origen: "historical" }],
      modalidadEstado: [
        { fila: "modalidad:pasantia", filaEtiqueta: "pasantia", columna: "cerrado", columnaEtiqueta: "cerrado", valor: 150, origen: "comun" },
        { fila: "sgp:EMPRESA PROPIA", filaEtiqueta: "EMPRESA PROPIA", columna: "en_practica", columnaEtiqueta: "en_practica", valor: 12, origen: "historical" },
      ],
    },
    periodoPorFuente: [
      { clave: "24V03", etiqueta: "24V03", current: 0, historical: 100 },
      { clave: "25V05", etiqueta: "25V05", current: 59, historical: 100 },
      { clave: "2026C", etiqueta: "2026C", current: 40, historical: 0 },
    ],
    cobertura: { actual: { desde: '2025-08-01', hasta: '2026-11-01' }, historico: { desde: '2024-02-01', corte: '2026-09-21T16:45:00.000Z', publicadoEn: '2026-11-20T15:00:00.000Z' }, historicoFueraDeAlcance: 0, historicoSinEquivalenciaPrograma: 253 },
    ...s,
  };
}

class ApiFalsa {
  llamadas: { metodo: string; p: Record<string, string> }[] = [];
  error: number | null = null;
  pendiente: Subject<ReporteFuentes> | null = null;
  reporteAnalitica(p: Record<string, string>): Observable<never> { this.llamadas.push({ metodo: 'analitica', p }); return new Subject<never>(); }
  reporteFuentes(p: Record<string, string>): Observable<ReporteFuentes> {
    this.llamadas.push({ metodo: 'fuentes', p });
    if (this.error) return throwError(() => new HttpErrorResponse({ status: this.error!, error: { message: 'SERVING_HISTORICO_NO_DISPONIBLE: no hay publicación' } }));
    if (this.pendiente) return this.pendiente;
    return of(reporte({ fuente: p['source'] as ReporteFuentes['fuente'] }));
  }
}
function crear() {
  const api = new ApiFalsa();
  const injector = Injector.create({ providers: [
    { provide: ReportesEstado, useClass: ReportesEstado }, { provide: ApiService, useValue: api },
    { provide: AvisosService, useValue: { exito() { /* */ }, error() { /* */ } } }, { provide: SesionService, useValue: { rol: signal('coordinador') } },
  ] });
  return { api, estado: injector.get(ReportesEstado) };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));
const fuentes = (api: ApiFalsa) => api.llamadas.filter((l) => l.metodo === 'fuentes');

describe('Reportes por fuente · lógica pura', () => {
  it('rótulos humanos y fuente explícita en los parámetros; vacíos fuera', () => {
    assert.deepEqual(FUENTES_REPORTE.map((f) => f.texto), ['Actual', 'Histórico', 'Todos']);
    assert.equal(rotuloFuente('historical'), 'Histórico');
    assert.deepEqual(parametrosFuente('all', FILTROS_FUENTE_VACIOS), { source: 'all' });
    assert.deepEqual(parametrosFuente('historical', { ...FILTROS_FUENTE_VACIOS, periodos: ['24V03', '25V05'], nivel: 'tecnologo', estado: 'cerrado' }),
      { source: 'historical', periodos: '24V03,25V05', nivel: 'tecnologo', estado: 'cerrado' });
    assert.equal(cantidadFiltrosFuente({ ...FILTROS_FUENTE_VACIOS, periodos: ['a', 'b'], ciudad: 'x' }), 2);
  });

  it('pestañas: General, Organizaciones y Períodos comunes; Estudiantes y Documentos solo Actual; Exportaciones regulatorias', () => {
    assert.deepEqual(PESTANAS.map((p) => COMPATIBILIDAD_VISTA[p.id]), ['comun', 'solo_actual', 'comun', 'solo_actual', 'comun', 'regulatoria']);
  });

  it('organizaciones sin correspondencia: UNA barra agrupada, sin nombres, no filtrable', () => {
    const b = barrasDimension(reporte(), 'organizacion');
    const g = b.find((x) => x.clave === CLAVE_ORG_SIN_CORRESPONDENCIA)!;
    assert.equal(g.texto, 'Organización histórica sin correspondencia');
    assert.equal(g.n, 55);
    assert.match(g.detalle![0], /2 organizaciones/);
    assert.equal(b.filter((x) => x.clave.startsWith('org-historica:') && x.clave !== CLAVE_ORG_SIN_CORRESPONDENCIA).length, 0);
  });

  it('periodos en orden académico y origen visible en Todos; EMPRESA PROPIA separada', () => {
    assert.deepEqual(periodosOrdenados(reporte()).map((p) => p.clave), ['24V03', '25V05', '2026C']);
    assert.deepEqual(periodosOrdenados(reporte())[1].detalle, ['Actual e Histórico']);
    assert.deepEqual(periodosOrdenados(reporte({ fuente: 'historical' }))[0].detalle, []);
    assert.equal(barrasDimension(reporte(), 'modalidadPractica')[0].texto, 'EMPRESA PROPIA');
    assert.equal(barrasDimension(reporte(), 'estado').find((x) => x.clave === 'en_practica')!.texto, 'En práctica');
  });

  it('rango temporal y tooltip de estado al corte', () => {
    const g = rangos(reporte());
    assert.deepEqual(g.map((x) => x.fuente), ['Actual', 'Histórico']);
    assert.match(g[1].texto, /corte/);
    assert.match(g[1].ayuda, /Estado al corte del archivo SGP/);
    assert.deepEqual(rangos(reporte({ cobertura: { ...reporte().cobertura, actual: null } })).map((x) => x.fuente), ['Histórico']);
  });

  it('una fecha sin hora no se corre al día anterior en la hora de Colombia', () => {
    assert.match(fecha('2024-01-01')!, /^1 .*2024$/);
    assert.match(fecha('2026-09-21T16:45:00.000Z')!, /^21 /);
    assert.equal(fecha(null), null);
  });

  it('avisos de cobertura en lenguaje claro (sin códigos técnicos)', () => {
    const a = avisosFuente(reporte({ totales: { practicas: 1, estudiantesUnicos: 1, precisionEstudiantes: 'cota_superior' }, cobertura: { ...reporte().cobertura, historicoFueraDeAlcance: 7 } }));
    assert.equal(a.length, 3);
    for (const x of a) assert.doesNotMatch(x, /[A-Z]{4,}_[A-Z_]+/);
    assert.match(a[0], /no se atribuyen a su alcance/);
    assert.match(a[2], /cota superior/);
  });

  it('unión de fuentes: confirmadas una vez; posibles y ambiguas se informan', () => {
    const u = lecturaSolape(reporte());
    assert.deepEqual(u.map((x) => [x.clave, x.n]), [['current_only', 45], ['historical_only', 252], ['matched', 1], ['candidate_overlap', 1], ['ambiguous_overlap', 0]]);
    assert.deepEqual(lecturaSolape(reporte({ solapamiento: null })), []);
  });

  it('cifras de la tira: estudiantes con cota superior se marcan; Cumplimiento no aparece', () => {
    const m = metricasFuente(reporte());
    assert.deepEqual(m.map((x) => x.t), ['Prácticas', 'Estudiantes únicos', 'Cierre %', 'Reprobación %', 'Anulación %', 'Duración mediana']);
    assert.equal(m[2].n, 75);
    assert.match(metricasFuente(reporte({ totales: { practicas: 2, estudiantesUnicos: 2, precisionEstudiantes: 'cota_superior' } }))[1].contexto, /cota superior/);
    assert.ok(!m.some((x) => /cumplimiento|cobertura vigente/i.test(x.t)));
  });

  it('errores: 503 del histórico no se presenta como falla general', () => {
    assert.match(mensajeErrorFuente(503, ''), /La vista Actual sigue funcionando/);
    assert.match(mensajeErrorFuente(null, 'SERVING_HISTORICO_NO_DISPONIBLE: x'), /histórico no está disponible/);
    assert.equal(mensajeErrorFuente(500, 'Base caída'), 'Base caída');
  });

  it('teclado del selector: flechas en ciclo, Inicio y Fin; otras teclas no hacen nada', () => {
    assert.equal(destinoTecla('ArrowRight', 2, 3), 0);
    assert.equal(destinoTecla('ArrowLeft', 0, 3), 2);
    assert.equal(destinoTecla('ArrowDown', 0, 3), 1);
    assert.equal(destinoTecla('Home', 2, 3), 0);
    assert.equal(destinoTecla('End', 0, 3), 2);
    assert.equal(destinoTecla('Tab', 0, 3), null);
  });

  it('migas del contexto por fuente con etiquetas de la respuesta (sin prefijos técnicos)', () => {
    const m = migasFuente({ ...FILTROS_FUENTE_VACIOS, periodos: ['24V03'], estado: 'en_practica', modalidadPractica: 'sgp:EMPRESA PROPIA', nivel: 'tecnologo' }, reporte().dimensiones);
    assert.deepEqual(m.map((x) => x.valor), ['24V03', 'Tecnólogo', 'EMPRESA PROPIA', 'En práctica']);
    assert.equal(migasFuente({ ...FILTROS_FUENTE_VACIOS, ciudad: 'sgp:BOGOTA' }).at(0)!.valor, 'BOGOTA');
  });
});

describe('Reportes por fuente · estado', () => {
  it('por omisión Actual: no consulta la ruta por fuentes; Histórico y Todos la consultan con source explícito', async () => {
    const { api, estado } = crear();
    assert.equal(estado.fuente(), 'current');
    assert.equal(estado.porFuente(), false);
    estado.cambiarFuente('current');
    assert.equal(fuentes(api).length, 0);
    estado.cambiarFuente('historical');
    await esperar();
    assert.deepEqual(fuentes(api).map((l) => l.p['source']), ['historical']);
    assert.equal(estado.datosFuente()!.fuente, 'historical');
    estado.cambiarFuente('all');
    assert.equal(estado.datosFuente(), null, 'no muestra cifras de otra fuente mientras llega la nueva');
    await esperar();
    assert.equal(estado.datosFuente()!.fuente, 'all');
    assert.deepEqual(estado.periodosFuente().map((p) => p.clave), ['24V03', '25V05', '2026C']);
  });

  it('volver a Actual no recarga ni toca la vista operativa; una respuesta tardía de otra fuente se descarta', async () => {
    const { api, estado } = crear();
    api.pendiente = new Subject<ReporteFuentes>();
    estado.cambiarFuente('historical');
    estado.cambiarFuente('current');
    api.pendiente.next(reporte({ fuente: 'historical' }));
    api.pendiente.complete();
    await esperar();
    assert.equal(estado.cargandoFuente(), false);
    assert.equal(estado.datosFuente(), null);
    assert.equal(api.llamadas.filter((l) => l.metodo === 'analitica').length, 0);
  });

  it('serving no disponible: error controlado y Actual intacto', async () => {
    const { api, estado } = crear();
    api.error = 503;
    estado.cambiarFuente('all');
    await esperar();
    assert.match(estado.errorFuente()!, /La vista Actual sigue funcionando/);
    estado.cambiarFuente('current');
    assert.equal(estado.errorFuente(), null);
    api.error = null;
    estado.cambiarFuente('historical');
    await esperar();
    assert.equal(estado.errorFuente(), null);
    assert.ok(estado.datosFuente());
  });

  it('cross-filter por fuente: alternar, periodos, quitar y limpiar recalculan en el servidor', async () => {
    const { api, estado } = crear();
    estado.cambiarFuente('all');
    estado.alternarFuente('nivel', 'tecnologo');
    estado.alternarPeriodoFuente('24V03');
    await esperar();
    assert.deepEqual(fuentes(api).at(-1)!.p, { source: 'all', periodos: '24V03', nivel: 'tecnologo' });
    estado.alternarFuente('nivel', 'tecnologo');
    estado.quitarFuente('periodos');
    await esperar();
    assert.deepEqual(fuentes(api).at(-1)!.p, { source: 'all' });
    estado.filtrarFuente({ ciudad: 'sgp:BOGOTA' });
    assert.equal(estado.activosFuente(), 1);
    estado.limpiarFuente();
    assert.equal(estado.activosFuente(), 0);
  });
});

describe('Reportes por fuente · reglas del código', () => {
  // Las pruebas corren con cwd = apps/web.
  const raiz = join(process.cwd(), 'src');
  const leer = (f: string) => readFileSync(join(raiz, 'app', 'features', 'reportes', f), 'utf8');
  it('componentes nuevos OnPush; el selector es un radiogroup accesible', () => {
    for (const f of ['reportes-fuente.component.ts', 'reportes-unificado.component.ts']) assert.match(leer(f), /ChangeDetectionStrategy\.OnPush/, f);
    const s = leer('reportes-fuente.component.ts');
    assert.match(s, /role="radiogroup"/);
    assert.match(s, /role="radio"/);
    assert.match(s, /aria-checked/);
    assert.match(s, /focus-visible/);
    assert.match(s, /<svg[^>]*aria-hidden="true"><path d="M2\.5 6\.5/, 'el elegido lleva marca, no solo color');
  });
  it('sin morado ni índigo en la vista por fuente', () => {
    for (const f of ['reportes-fuente.component.ts', 'reportes-unificado.component.ts']) assert.doesNotMatch(leer(f), /purple|indigo|violet|#7c3aed|#6366f1|#8b5cf6/i, f);
  });
  it('el frontend no contiene el secreto HMAC ni nombres de variables de clave', () => {
    const archivos = (d: string): string[] => readdirSync(d).flatMap((n) => { const r = join(d, n); return statSync(r).isDirectory() ? archivos(r) : [r]; });
    for (const f of archivos(raiz)) assert.doesNotMatch(readFileSync(f, 'utf8'), /HISTORICO_HMAC_KEY|hmac_key|student_key|studentKey/, f);
  });
});

describe('Reportes por fuente · paridad visual con Actual (§32)', () => {
  const raiz = join(process.cwd(), 'src', 'app', 'features', 'reportes');
  const leer = (f: string) => readFileSync(join(raiz, f), 'utf8');
  const unificado = leer('reportes-unificado.component.ts');
  /** Bloque del @case de una vista en la plantilla unificada. */
  const caso = (vista: string): string => unificado.split(`@case ('${vista}')`)[1].split(/@case \('(?:general|organizaciones|periodos)'\)/)[0];
  const graficas = (src: string): string[] => [...src.matchAll(/<sipra-reportes-(composicion|barras|dona|proporcion|lineas|bump|stream|grupos|pack|matriz|columnas|no-disponible)\b/g)].map((m) => m[1]);
  const tipos = (src: string): string[] => [...new Set(graficas(src))].sort();
  const rejilla = (src: string): string[] => [...src.matchAll(/class="ra-bloque[^"]*\b(c\d+)\b[^"]*"/g)].map((m) => m[1]);

  it('Actual conserva sus visualizaciones de siempre', () => {
    assert.deepEqual(tipos(leer('reportes-general.component.ts')), ['barras', 'columnas', 'composicion', 'dona', 'proporcion']);
    assert.deepEqual(tipos(leer('reportes-periodos.component.ts')), ['bump', 'grupos', 'lineas', 'stream']);
    assert.deepEqual(tipos(leer('reportes-organizaciones.component.ts')), ['barras', 'dona', 'matriz', 'pack']);
  });

  it('misma métrica = misma gráfica en Histórico y Todos; lo no comparable se declara no disponible', () => {
    for (const [metrica, g] of Object.entries(GRAFICA_POR_METRICA)) if (g.fuente !== 'no-disponible') assert.equal(g.fuente, g.actual, metrica);
    assert.deepEqual(tipos(caso('general')), ['barras', 'composicion', 'dona', 'no-disponible']);
    assert.deepEqual(tipos(caso('periodos')), ['bump', 'grupos', 'lineas', 'stream']);
    assert.deepEqual(tipos(caso('organizaciones')), ['barras', 'no-disponible']);
  });

  it('no es una versión simplificada solo con barras', () => {
    const t = tipos(unificado);
    for (const g of ['composicion', 'dona', 'lineas', 'bump', 'stream', 'grupos']) assert.ok(t.includes(g), `falta ${g}`);
    const todas = graficas(unificado);
    assert.ok(todas.filter((g) => g === 'barras').length < todas.length / 2, 'las barras no deben dominar el reporte');
  });

  it('misma rejilla que Actual en General (7/5 y luego 4/4/4) y mismos títulos de sección', () => {
    assert.deepEqual(rejilla(caso('general')), ['c7', 'c5', 'c4', 'c4', 'c4']);
    assert.deepEqual(rejilla(leer('reportes-general.component.ts')).filter((_, i) => i !== 3), ['c7', 'c5', 'c4', 'c4', 'c4']);
    for (const t of ['Nivel de formación', 'Documentación', 'Interna CUN y externa', 'Comparación de periodos', 'Sectores y organizaciones', 'Programa × sector']) {
      assert.match(unificado, new RegExp(`>${t}</h2>`), t);
    }
  });

  it('métricas no comparables: «No disponible para información histórica», nunca cero', () => {
    assert.match(leer('reportes-no-disponible.component.ts'), /NO_DISPONIBLE_HISTORICO/);
    assert.equal(NO_DISPONIBLE_HISTORICO, 'No disponible para información histórica');
    const cob = comparacionAB(reporte({ fuente: 'historical' }), '24V03', '25V05').find((f) => f.texto === 'Cobertura cargada')!;
    assert.equal(cob.delta, null);
    assert.equal(cob.deltaTexto, NO_DISPONIBLE_HISTORICO);
    assert.notEqual(cob.va, '0');
    assert.doesNotMatch(caso('general'), />Cumplimiento</);
  });

  it('Todos: Actual e Histórico como dos series de la MISMA línea temporal; Histórico, una serie', () => {
    const all = seriesPeriodo(reporte({ fuente: 'all' }));
    assert.deepEqual(all.map((s) => [s.texto, s.valores]), [['Actual', [0, 59, 40]], ['Histórico', [100, 100, 0]]]);
    assert.deepEqual(all.map((s) => s.tono), ['principal', 'comparacion']);
    const hist = seriesPeriodo(reporte({ fuente: 'historical' }));
    assert.equal(hist.length, 1);
    assert.deepEqual(hist[0].valores, [100, 100, 0]);
    assert.deepEqual(ejePeriodos(reporte()), ['24V03', '25V05', '2026C']);
  });

  it('cruces → insumos de las gráficas de Actual (composición, bandas, ranking, A/B, dona)', () => {
    const r = reporte();
    assert.deepEqual(celdasCruce(r, 'modalidadEstado')[0], { fila: 'modalidad:pasantia', columna: 'cerrado', estudiantes: 150, practicas: 150 });
    assert.deepEqual(seriesProgramas(r).find((s) => s.clave === 'sgp:ADMINISTRACION')?.valores, [60, 100, 0]);
    assert.deepEqual(gruposAB(r, '24V03', '25V05')[0], { clave: 'sgp:ADMINISTRACION', texto: 'ADMINISTRACION', a: 60, b: 100 });
    assert.deepEqual(partesNivel(r).map((p) => p.clave), ['tecnologo', 'profesional']);
    const texto = rotulador(r, 'modalidadEstado', 'fila', (c) => `«${c}»`);
    assert.equal(texto('modalidad:pasantia'), '«pasantia»');
    assert.equal(texto('sgp:EMPRESA PROPIA'), 'EMPRESA PROPIA');
    assert.deepEqual(categoriasEstado().map((c) => c.clave), ['inscrito', 'en_practica', 'cerrado', 'reprobado', 'anulado']);
  });

  it('eje temporal cronológico por año (no alfabético) y etiquetas que no se montan', () => {
    const r = reporte({ periodoPorFuente: ['2021A', '20V01', '26V04', '2020A', '21V03', 'X'].map((clave) => ({ clave, etiqueta: clave, current: 0, historical: 1 })) });
    assert.deepEqual(ejePeriodos(r), ['20V01', '2020A', '21V03', '2021A', '26V04', 'X']);
    assert.equal(anioPeriodo('2024B'), 2024);
    assert.equal(anioPeriodo('24V03'), 2024);
    assert.equal(pasoEtiquetas(5, 1000), 1, 'con pocas categorías (Actual) se rotulan todas');
    const paso = pasoEtiquetas(83, 1000);
    assert.ok(paso >= 4);
    assert.ok(rotulaEn(0, 83, paso) && rotulaEn(82, 83, paso));
    assert.ok([...Array(83).keys()].filter((i) => rotulaEn(i, 83, paso)).length <= Math.ceil(1000 / 52) + 1);
  });

  it('cambiar de fuente conserva filtros y pestaña', async () => {
    const { api, estado } = crear();
    estado.pestana.set('periodos');
    estado.cambiarFuente('historical');
    await esperar();
    estado.filtrarFuente({ nivel: 'tecnologo', periodos: ['24V03'] });
    await esperar();
    estado.cambiarFuente('all');
    await esperar();
    assert.deepEqual(estado.filtrosFuente(), { ...FILTROS_FUENTE_VACIOS, nivel: 'tecnologo', periodos: ['24V03'] });
    assert.equal(estado.pestana(), 'periodos');
    assert.deepEqual(fuentes(api).at(-1)!.p, { source: 'all', periodos: '24V03', nivel: 'tecnologo' });
  });

  it('componentes nuevos: OnPush y paleta V3 (sin morado ni índigo)', () => {
    for (const f of ['reportes-no-disponible.component.ts', 'reportes-paridad.util.ts', 'reportes-unificado.component.ts']) assert.doesNotMatch(leer(f), /purple|indigo|violet|#7c3aed|#6366f1|#8b5cf6/i, f);
    assert.match(leer('reportes-no-disponible.component.ts'), /ChangeDetectionStrategy\.OnPush/);
  });
});
