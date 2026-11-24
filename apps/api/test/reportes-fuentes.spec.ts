import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AnaliticaUnificadaUseCase } from '../src/application/use-cases/analitica/analitica-unificada.use-case';
import { ConstruirServingHistoricoUseCase } from '../src/application/use-cases/analitica/construir-serving.use-case';
import { ReportesFuentesUseCase, filtroFuentesDe } from '../src/application/use-cases/reportes/reportes-fuentes.use-case';
import { Actor } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { CRUCES, CeldaCruce, DIMENSIONES, METRICAS_SERVING, NOMBRES_CRUCES } from '../src/domain/analitica/serving-analitico';
import { MARCAS_CALIDAD, MARCAS_ORGANIZACION } from '../src/domain/historico/calidad-historico';
import { normalizarDocumentoSgp } from '../src/domain/historico/normalizacion-sgp';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import {
  CorrespondenciaPracticaConfirmada, FilaActualCruda, FilaHistoricaCruda, LecturaAnaliticaUnificadaPort,
} from '../src/domain/ports/out/analitica-unificada.port';
import {
  AgregadosServing, FilaServing, FiltroServing, ServingHistoricoLecturaPort, ServingHistoricoNoDisponibleError,
} from '../src/domain/ports/out/serving-analitico.port';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { IdentidadAnaliticaHmac } from '../src/infrastructure/historico/identidad-analitica.adapter';

const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-fuentes-'.padEnd(48, 'f'), 'v1');
const k = (doc: string): string => seud.clave('student', normalizarDocumentoSgp(doc).normalizado)!;
const A = (id: string, est: string, doc: string, o: Partial<FilaActualCruda> = {}): FilaActualCruda => ({
  id, estudianteId: est, documento: doc, periodo: '26V04', programaId: 'ADM-PRO', ciclo: 'profesional', regional: 'Regional Bogotá',
  modalidad: 'pasantia', estado: 'activa', empresaId: null, empresa: 'Empresa Sintética', ciudadCodigo: '11001', ciudadNombre: 'Bogotá',
  fechaInicio: '2026-08-01', fechaFin: '2026-11-01', creadaEn: '2026-08-01T00:00:00.000Z', ...o,
});
const H = (id: string, doc: string | null, o: Partial<FilaHistoricaCruda> = {}): FilaHistoricaCruda => ({
  sourceSystem: 'SGP_SINTETICO', sourceRecordId: id, version: 1, hmacKeyVersion: 'v1', studentKey: doc ? k(doc) : null,
  periodoOriginal: '25V05', periodoNormalizado: '25V05', programaNormalizado: 'ADMINISTRACION DE EMPRESAS', codigoSinu: null,
  nivelInferido: 'profesional', regional: 'REGIONAL BOGOTÁ', modalidadEstudio: 'virtual', modalidadPracticaNormalizada: 'pasantia',
  modalidadPracticaOriginal: 'PASANTÍA', estadoAnalitico: 'cerrado', esEstadoDeCorte: false, estadoFechaCorte: '2026-09-22T17:25:54Z',
  organizacionId: '00000000-0000-4000-8000-0000000000a1', empresaConfirmadaId: null, empresaConfirmadaNombre: null,
  ciudadNormalizada: 'BOGOTA', fechaInicio: '2025-08-01', fechaFin: '2025-11-01', duracionDias: 92,
  documentosSubidosRatio: 1, documentosAprobadosRatio: 0.83, bitacoraCount: 7, qualityFlags: [], organizationFlags: [],
  duplicadoDe: null, fechaCreacion: '2025-08-01', ...o,
});

const actuales = [
  A('a1', 'u1', '1000000001', { periodo: '25V05' }),
  A('a2', 'u2', '1000000002', { periodo: '25V05', estado: 'certificada' }),
  A('a3', 'u3', '1000000003', { periodo: '25P01' }),
  A('a4', 'u1', '1000000001', { periodo: '2026C', estado: 'inscrita' }),
  A('a5', 'u5', '1000000005', { periodo: '2026C' }),
];
const historicas = [
  H('h1', '1000000001'),
  H('h2', '1000000002'),
  H('h3', '1000000003', { periodoNormalizado: '25P01', periodoOriginal: '25P01' }),
  H('h4', '1000000003', { periodoNormalizado: '25P01', periodoOriginal: '25P01', estadoAnalitico: 'reprobado' }),
  H('h5', '1000000099', { periodoNormalizado: '2024B', periodoOriginal: '2024B', modalidadPracticaNormalizada: null, modalidadPracticaOriginal: 'EMPRESA PROPIA' }),
  H('h6', '1000000099', { periodoNormalizado: '2025C', periodoOriginal: '2025C', qualityFlags: ['END_BEFORE_START'], duracionDias: null }),
  H('h7', '1000000099', { periodoNormalizado: '2025C', periodoOriginal: '2025C', duplicadoDe: 'h6', qualityFlags: ['IDENTICAL_CONTENT'] }),
  H('h8', '1000000077', { estadoAnalitico: 'en_practica', esEstadoDeCorte: true, periodoNormalizado: '26V04', periodoOriginal: '26V04' }),
];
const confirmadas: CorrespondenciaPracticaConfirmada[] = [{ sourceRecordId: 'h1', practicaId: 'a1' }];

function lectura(acts = actuales, hist = historicas, conf = confirmadas): LecturaAnaliticaUnificadaPort & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    practicasActuales: async (f) => {
      llamadas.push(`actuales:${f.conDocumento}`);
      return acts.filter(() => f.escuelaIds === undefined || f.escuelaIds.includes('ESC-NEG'))
        .filter((a) => !f.periodos || f.periodos.includes(a.periodo)).map((a) => ({ ...a, documento: f.conDocumento ? a.documento : null }));
    },
    practicasHistoricas: async () => hist,
    correspondenciasConfirmadas: async () => conf,
  };
}

/** Serving en memoria con la MISMA semántica que la consulta SQL (filtros, escuela, exclusiones, agregados). */
async function construir(hist = historicas): Promise<FilaServing[]> {
  let filas: FilaServing[] = [];
  await new ConstruirServingHistoricoUseCase(lectura([], hist, []), { publicar: async (_s, f) => { filas = [...f]; return { version: 'v', filas: f.length }; } }).ejecutar('SGP_SINTETICO');
  return filas;
}
function servingFalso(filas: FilaServing[], disponible = true): ServingHistoricoLecturaPort & { pedidos: FiltroServing[] } {
  const pedidos: FiltroServing[] = [];
  return {
    pedidos,
    agregados: async (f): Promise<AgregadosServing> => {
      pedidos.push(f);
      if (!disponible) throw new ServingHistoricoNoDisponibleError('no hay una publicación del histórico para este sistema');
      const ok = (v: string | null, e?: string): boolean => e === undefined || v === e;
      const alcance = filas.filter((r) => (!f.periodos || f.periodos.includes(r.periodoClave ?? '') || f.periodos.includes(r.periodoCodigo ?? ''))
        && ok(r.programaClave, f.programa) && ok(r.nivel, f.nivel) && ok(r.regionalClave, f.regional) && ok(r.modalidadEstudioClave, f.modalidadEstudio)
        && ok(r.modalidadPracticaClave, f.modalidadPractica) && ok(r.estado, f.estado) && ok(r.organizacionClave, f.organizacion) && ok(r.ciudadClave, f.ciudad)
        && !f.excluirRegistros.includes(r.sourceRecordId));
      const base = alcance.filter((r) => f.escuelaIds === undefined || (r.escuelaId !== null && f.escuelaIds.includes(r.escuelaId)));
      const col: Record<string, [keyof FilaServing, keyof FilaServing, string]> = {
        periodo: ['periodoClave', 'periodoEtiqueta', 'practicas_por_periodo'], programa: ['programaClave', 'programaEtiqueta', 'programa'], nivel: ['nivel', 'nivel', 'nivel'],
        regional: ['regionalClave', 'regionalEtiqueta', 'regional'], modalidadEstudio: ['modalidadEstudioClave', 'modalidadEstudioEtiqueta', 'modalidad_estudio'],
        modalidadPractica: ['modalidadPracticaClave', 'modalidadPracticaEtiqueta', 'modalidad_practica'], estado: ['estado', 'estado', 'estado'],
        organizacion: ['organizacionClave', 'organizacionEtiqueta', 'organizacion'], ciudad: ['ciudadClave', 'ciudadEtiqueta', 'ciudad'],
      };
      const dimensiones = Object.fromEntries(DIMENSIONES.map((d) => {
        const m = new Map<string, { clave: string; etiqueta: string; valor: number }>();
        for (const r of base) {
          const [c, e, met] = col[d];
          if (!r.elegible[met as keyof FilaServing['elegible']] || r[c] === null) continue;
          const x = m.get(r[c] as string) ?? { clave: r[c] as string, etiqueta: (r[e] as string) ?? (r[c] as string), valor: 0 };
          x.valor += 1;
          m.set(x.clave, x);
        }
        return [d, [...m.values()]];
      })) as AgregadosServing['dimensiones'];
      // Cruces (§32): mismas columnas y elegibilidad de las dos dimensiones, como el SQL del adaptador.
      const crucesDe = (filas: FilaServing[]): AgregadosServing['cruces'] => Object.fromEntries(NOMBRES_CRUCES.map((x) => {
        const [dA, dB] = CRUCES[x];
        const m = new Map<string, CeldaCruce>();
        for (const r of filas) {
          const [ca, ea, ma] = col[dA], [cb, eb, mb] = col[dB];
          if (!r.elegible[ma as keyof FilaServing['elegible']] || !r.elegible[mb as keyof FilaServing['elegible']] || r[ca] === null || r[cb] === null) continue;
          const fila = r[ca] as string, columna = r[cb] as string;
          const kk = `${fila}|${columna}`;
          const e = m.get(kk) ?? { fila, filaEtiqueta: (r[ea] as string | null) ?? fila, columna, columnaEtiqueta: (r[eb] as string | null) ?? columna, valor: 0 };
          e.valor += 1;
          m.set(kk, e);
        }
        return [x, [...m.values()]];
      })) as AgregadosServing['cruces'];
      const id = (r: FilaServing): string => `${r.hmacKeyVersion}:${r.studentKey}`;
      const est = new Set(base.filter((r) => r.elegible.estudiantes_unicos).map(id));
      const tasa = base.filter((r) => r.elegible.tasa_cierre);
      const dur = new Map<number, number>();
      for (const r of base.filter((x) => x.elegible.duracion)) dur.set(r.duracionDias!, (dur.get(r.duracionDias!) ?? 0) + 1);
      const docs = base.filter((r) => r.elegible.indicador_documental_sgp);
      return {
        publicacion: { version: 'v', corte: '2026-09-22T17:25:54Z', desde: '2025-08-01', publicadoEn: '2026-11-20T00:00:00Z' },
        filas: base.length, practicas: base.filter((r) => r.elegible.practicas).length, estudiantes: est.size,
        estudiantesCompartidos: [...est].filter((x) => f.clavesEstudiantesActuales.includes(x)).length,
        versionesClave: [...new Set(base.map((r) => r.hmacKeyVersion))], dimensiones, cruces: crucesDe(base),
        tasas: { denominador: tasa.length, cerrado: tasa.filter((r) => r.estado === 'cerrado').length, reprobado: tasa.filter((r) => r.estado === 'reprobado').length, anulado: tasa.filter((r) => r.estado === 'anulado').length },
        duracion: [...dur], documentos: { casos: docs.length, sumaSubido: docs.reduce((s, r) => s + r.documentosSubidosRatio!, 0), sumaAprobado: docs.reduce((s, r) => s + r.documentosAprobadosRatio!, 0) },
        elegibles: Object.fromEntries(METRICAS_SERVING.map((m) => [m, base.filter((r) => r.elegible[m]).length])),
        solape: base.filter((r) => f.clavesEstudiantesActuales.includes(id(r))).map((r) => ({
          analyticsId: r.analyticsId, identidad: id(r), periodoCodigo: r.periodoCodigo, nivel: r.nivel, modalidadCodigo: r.modalidadCodigo,
          fechaInicio: r.fechaInicio, fechaFin: r.fechaFin, estado: r.estado, fechaCreacion: r.fechaCreacion,
        })),
        cobertura: { excluidosPorAlcance: alcance.filter((r) => r.elegible.practicas).length - base.filter((r) => r.elegible.practicas).length, sinEquivalenciaPrograma: base.filter((r) => r.elegible.practicas && !r.programaMapeado).length },
      };
    },
  };
}

const actor = (rol: Rol, escuelas: string[] = []): Actor => ({ id: 'x', correo: 'x@cun.edu.co', rol, permiso: 'consulta', escuelas, empresaId: null });
const ADMIN = actor(Rol.ADMINISTRADOR);
async function caso(o: { conClave?: boolean; disponible?: boolean } = {}) {
  const lect = lectura();
  const serv = servingFalso(await construir(), o.disponible ?? true);
  const uc = new ReportesFuentesUseCase(lect, serv, new IdentidadAnaliticaHmac(o.conClave === false ? [] : [seud]), 'SGP_SINTETICO');
  return { uc, lect, serv };
}
const AHORA = new Date('2026-11-20T00:00:00Z');

describe('Reportes por fuente · parámetros', () => {
  it('source omitido = Actual (compatibilidad); inválido → 400', () => {
    expect(filtroFuentesDe({}).fuente).toBe('current');
    expect(() => filtroFuentesDe({ source: 'ALL' })).toThrow(BadRequestException);
    expect(() => filtroFuentesDe({ source: 'historical', estado: 'activa' })).toThrow(BadRequestException);
    expect(filtroFuentesDe({ source: 'all', periodos: '25V05, 2026C' }).periodos).toEqual(['25V05', '2026C']);
  });
});

describe('Reportes por fuente · H5 da exactamente lo mismo que la capa H4', () => {
  // El último caso es la regresión hallada en PostgreSQL: un periodo sin filas del SGP (H4 da indicador documental null).
  const casos = [{ fuente: 'current' }, { fuente: 'historical' }, { fuente: 'all' }, { fuente: 'all', periodos: ['2026C'] }, { fuente: 'historical', periodos: ['2026C'] }] as const;
  for (const filtro of casos) {
    it(`${JSON.stringify(filtro)}: totales, dimensiones, tasas, duración, indicador y solapamiento idénticos a H4`, async () => {
      const { uc } = await caso();
      const h5 = await uc.consultar({ ...filtro, periodos: 'periodos' in filtro ? [...filtro.periodos] : undefined }, ADMIN, AHORA);
      const h4 = await new AnaliticaUnificadaUseCase(lectura(), new IdentidadAnaliticaHmac([seud]), { sistema: 'SGP_SINTETICO', ahora: () => AHORA })
        .consultar({ fuente: filtro.fuente, periodos: 'periodos' in filtro ? [...filtro.periodos] : undefined });
      expect(h5.totales).toEqual(h4.totales);
      expect(h5.tasas).toEqual(h4.tasas);
      expect(h5.duracion).toEqual(h4.duracion);
      expect(h5.indicadorDocumentalSgp).toEqual(h4.indicadorDocumentalSgp);
      expect(h5.solapamiento).toEqual(h4.solapamiento);
      for (const d of DIMENSIONES) expect([...h5.dimensiones[d]].sort((a, b) => a.clave.localeCompare(b.clave))).toEqual([...h4.dimensiones[d]].sort((a, b) => a.clave.localeCompare(b.clave)));
    });
  }
});

describe('Reportes por fuente · semántica', () => {
  it('Actual no toca el serving (y sigue respondiendo si el serving no está)', async () => {
    const { uc, serv } = await caso({ disponible: false });
    const r = await uc.consultar({ fuente: 'current' }, ADMIN, AHORA);
    expect(r.totales.practicas).toBe(5);
    expect(serv.pedidos).toHaveLength(0);
  });
  it('Histórico y Todos sin serving → 503 controlado (sin datos degradados)', async () => {
    const { uc } = await caso({ disponible: false });
    await expect(uc.consultar({ fuente: 'historical' }, ADMIN, AHORA)).rejects.toThrow(ServiceUnavailableException);
    await expect(uc.consultar({ fuente: 'all' }, ADMIN, AHORA)).rejects.toThrow(/SERVING_HISTORICO_NO_DISPONIBLE/);
  });
  it('Todos: solo lo confirmado se deduplica; candidatos y ambiguos se cuentan e informan', async () => {
    const { uc, serv } = await caso();
    const r = await uc.consultar({ fuente: 'all' }, ADMIN, AHORA);
    expect(serv.pedidos[0].excluirRegistros).toEqual(['h1']);
    expect(r.totales.practicas).toBe(5 + 7 - 1); // h7 es copia idéntica de h6 (no cuenta); h1 confirmado sale
    expect(r.solapamiento?.categorias).toMatchObject({ matched: 1, candidate_overlap: 1, ambiguous_overlap: 2 });
  });
  it('estudiantes únicos por identidad: u1, u2, u3, u5 + …99 + …77 = 6, exacta', async () => {
    const { uc } = await caso();
    const r = await uc.consultar({ fuente: 'all' }, ADMIN, AHORA);
    expect(r.totales).toMatchObject({ estudiantesUnicos: 6, precisionEstudiantes: 'exacta' });
  });
  it('sin HMAC: cota superior explícita y no se leen documentos', async () => {
    const { uc, lect } = await caso({ conClave: false });
    const r = await uc.consultar({ fuente: 'all' }, ADMIN, AHORA);
    expect(r.totales.precisionEstudiantes).toBe('cota_superior');
    expect(r.advertencias.join(' ')).toMatch(/IDENTIDAD_NO_COMPARABLE/);
    expect(lect.llamadas).toEqual(['actuales:false']);
  });
  it('estado al corte: el SGP abierto no entra a las tasas y se fecha con el corte', async () => {
    const { uc } = await caso();
    const r = await uc.consultar({ fuente: 'historical' }, ADMIN, AHORA);
    expect(r.estadoAl).toEqual({ current: null, historical: '2026-09-22T17:25:54Z' });
    expect(r.tasas.cierre.denominador).toBe(6); // h1..h6 (fechas inválidas solo anulan la duración); fuera: h7 copia, h8 al corte
  });
  it('EMPRESA PROPIA como categoría histórica separada; B y C no se unifican; programa sin SINU no se fusiona', async () => {
    const { uc } = await caso();
    const h = await uc.consultar({ fuente: 'historical' }, ADMIN, AHORA);
    expect(h.dimensiones.modalidadPractica.some((d) => d.clave === 'sgp:EMPRESA PROPIA')).toBe(true);
    expect(h.dimensiones.periodo.map((d) => d.clave)).toEqual(expect.arrayContaining(['2024B', '2025C']));
    const all = await uc.consultar({ fuente: 'all' }, ADMIN, AHORA);
    expect(all.dimensiones.programa.map((d) => d.clave).sort()).toEqual(['sgp:ADMINISTRACION DE EMPRESAS', 'sinu:ADM-PRO']);
  });
  it('filtros con la misma semántica en ambas fuentes', async () => {
    const { uc } = await caso();
    const r = await uc.consultar({ fuente: 'all', periodos: ['25V05'], nivel: 'profesional', modalidadPractica: 'modalidad:pasantia' }, ADMIN, AHORA);
    expect(r.totales.practicas).toBe(2 + 1); // a1, a2 + h2 (h1 confirmado sale)
  });
});

describe('Reportes por fuente · alcance G1', () => {
  it('coordinador con escuelas: el histórico sin equivalencia queda fuera y se informa (no se inventa escuela)', async () => {
    const { uc, serv } = await caso();
    const r = await uc.consultar({ fuente: 'all' }, actor(Rol.COORDINADOR, ['ESC-NEG']), AHORA);
    expect(serv.pedidos[0].escuelaIds).toEqual(['ESC-NEG']);
    expect(r.cobertura.historicoFueraDeAlcance).toBe(6); // h2..h8 menos la copia idéntica h7 (no es una práctica contable); h1 confirmado ya salió
    expect(r.advertencias.join(' ')).toMatch(/equivalencia académica/);
    expect(r.solapamiento?.categorias.historical_only).toBe(0);
  });
  it('filtro de escuela fuera del alcance: nada', async () => {
    const { uc, serv } = await caso();
    await uc.consultar({ fuente: 'historical', escuela: 'ESC-OTRA' }, actor(Rol.COORDINADOR, ['ESC-NEG']), AHORA);
    expect(serv.pedidos[0].escuelaIds).toEqual([]);
  });
  it('perfil sin reportes → 403', async () => {
    const { uc } = await caso();
    await expect(uc.consultar({ fuente: 'all' }, actor(Rol.ESTUDIANTE), AHORA)).rejects.toThrow(ForbiddenException);
  });
});

describe('Reportes por fuente · cruces para la paridad visual (§32)', () => {
  const suma = (xs: { valor: number }[]): number => xs.reduce((s, x) => s + x.valor, 0);
  it.each(['current', 'historical', 'all'] as const)('%s: cada cruce suma, por fila, lo mismo que su dimensión (misma elegibilidad)', async (fuente) => {
    const { uc } = await caso();
    const r = await uc.consultar({ fuente }, ADMIN, AHORA);
    for (const [cruce, dim] of [['periodoPrograma', 'periodo'], ['periodoModalidad', 'periodo'], ['modalidadEstado', 'modalidadPractica']] as const) {
      for (const fila of new Set(r.cruces[cruce].map((c) => c.fila))) {
        const enCruce = suma(r.cruces[cruce].filter((c) => c.fila === fila));
        const enDim = r.dimensiones[dim].find((d) => d.clave === fila)?.valor ?? 0;
        expect(enCruce).toBeLessThanOrEqual(enDim);
      }
    }
    expect(suma(r.periodoPorFuente.map((p) => ({ valor: p.current + p.historical })))).toBe(suma(r.dimensiones.periodo));
  });
  it('Todos: las series por periodo separan Actual e Histórico; Histórico no trae serie actual', async () => {
    const { uc } = await caso();
    const all = await uc.consultar({ fuente: 'all' }, ADMIN, AHORA);
    expect(all.periodoPorFuente.some((p) => p.current > 0)).toBe(true);
    expect(all.periodoPorFuente.some((p) => p.historical > 0)).toBe(true);
    const hist = await uc.consultar({ fuente: 'historical' }, ADMIN, AHORA);
    expect(hist.periodoPorFuente.every((p) => p.current === 0)).toBe(true);
    expect(hist.cruces.periodoPrograma.every((c) => c.origen === 'historical')).toBe(true);
  });
  it('un filtro se aplica también a los cruces', async () => {
    const { uc } = await caso();
    const r = await uc.consultar({ fuente: 'all', estado: 'cerrado' }, ADMIN, AHORA);
    expect(r.cruces.modalidadEstado.every((c) => c.columna === 'cerrado')).toBe(true);
  });
});

describe('Reportes por fuente · sin datos personales', () => {
  it('la respuesta no contiene claves, documentos, identidades ni marcas internas', async () => {
    const { uc } = await caso();
    for (const fuente of ['current', 'historical', 'all'] as const) {
      const t = JSON.stringify(await uc.consultar({ fuente }, ADMIN, AHORA));
      expect(t).not.toMatch(/[0-9a-f]{64}/);
      expect(t).not.toMatch(/100000000\d/);
      expect(t).not.toMatch(/current:u\d|historical:v1:|"(studentKey|student_key|teacher_key|organization_key|identidad)"/);
      for (const m of [...MARCAS_CALIDAD, ...MARCAS_ORGANIZACION]) expect(t).not.toContain(`"${m}"`);
    }
  });
});
