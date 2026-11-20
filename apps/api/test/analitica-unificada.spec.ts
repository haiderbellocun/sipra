import { AnaliticaUnificadaUseCase } from '../src/application/use-cases/analitica/analitica-unificada.use-case';
import { FiltroAnaliticoUnificado, ResultadoAnaliticoUnificado } from '../src/domain/analitica/modelo-analitico';
import { MARCAS_CALIDAD, MARCAS_ORGANIZACION } from '../src/domain/historico/calidad-historico';
import { normalizarDocumentoSgp } from '../src/domain/historico/normalizacion-sgp';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import {
  CorrespondenciaPracticaConfirmada, FilaActualCruda, FilaHistoricaCruda, LecturaAnaliticaUnificadaPort,
} from '../src/domain/ports/out/analitica-unificada.port';
import { IdentidadAnaliticaHmac } from '../src/infrastructure/historico/identidad-analitica.adapter';

/** Clave SINTÉTICA de la corrida. Los documentos son sintéticos. */
const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-analitica-'.padEnd(48, 'z'), 'v1');
const k = (doc: string): string => seud.clave('student', normalizarDocumentoSgp(doc).normalizado)!;

const A = (id: string, estudiante: string, documento: string, o: Partial<FilaActualCruda> = {}): FilaActualCruda => ({
  id, estudianteId: estudiante, documento, periodo: '26V04', programaId: 'ADM-PRO', ciclo: 'profesional', regional: 'Regional Bogotá',
  modalidad: 'pasantia', estado: 'activa', empresaId: null, empresa: 'Empresa Sintética', ciudadCodigo: '11001', ciudadNombre: 'Bogotá',
  fechaInicio: '2026-08-01', fechaFin: '2026-11-01', creadaEn: '2026-08-01T00:00:00.000Z', ...o,
});
const H = (id: string, doc: string | null, o: Partial<FilaHistoricaCruda> = {}): FilaHistoricaCruda => ({
  sourceSystem: 'SGP', sourceRecordId: id, version: 1, hmacKeyVersion: 'v1', studentKey: doc ? k(doc) : null,
  periodoOriginal: '25V05', periodoNormalizado: '25V05', programaNormalizado: 'ADMINISTRACION DE EMPRESAS', codigoSinu: null,
  nivelInferido: 'profesional', regional: 'REGIONAL BOGOTÁ', modalidadEstudio: 'virtual', modalidadPracticaNormalizada: 'pasantia',
  modalidadPracticaOriginal: 'PASANTÍA', estadoAnalitico: 'cerrado', esEstadoDeCorte: false, estadoFechaCorte: '2026-09-22T17:25:54Z',
  organizacionId: '00000000-0000-4000-8000-0000000000a1', empresaConfirmadaId: null, empresaConfirmadaNombre: null,
  ciudadNormalizada: 'BOGOTA', fechaInicio: '2025-08-01', fechaFin: '2025-11-01', duracionDias: 92,
  documentosSubidosRatio: 1, documentosAprobadosRatio: 0.83, bitacoraCount: 7, qualityFlags: [], organizationFlags: [],
  duplicadoDe: null, fechaCreacion: '2025-08-01', ...o,
});

function repo(actuales: FilaActualCruda[], historicas: FilaHistoricaCruda[], confirmadas: CorrespondenciaPracticaConfirmada[] = []): LecturaAnaliticaUnificadaPort & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    practicasActuales: async (f) => { llamadas.push(`actuales:${f.conDocumento}`); return actuales.map((a) => ({ ...a, documento: f.conDocumento ? a.documento : null })); },
    practicasHistoricas: async () => { llamadas.push('historicas'); return historicas; },
    correspondenciasConfirmadas: async () => confirmadas,
  };
}
const consultar = (r: LecturaAnaliticaUnificadaPort, filtro: FiltroAnaliticoUnificado, conClave = true): Promise<ResultadoAnaliticoUnificado> =>
  new AnaliticaUnificadaUseCase(r, new IdentidadAnaliticaHmac(conClave ? [seud] : []), { ahora: () => new Date('2026-11-20T00:00:00Z') }).consultar(filtro);

// Escenario: 4 prácticas actuales (3 estudiantes), 6 registros SGP.
const actuales = [
  A('a1', 'u1', '1000000001'),                                   // actual con histórico CONFIRMADO (h1)
  A('a2', 'u2', '1000000002', { periodo: '25V05', estado: 'certificada' }), // candidato con h2 (mismo estudiante, periodo y ciclo)
  A('a3', 'u3', '1000000003', { periodo: '25P01' }),            // ambiguo con h3 y h4
  A('a4', 'u1', '1000000001', { periodo: '2026C', estado: 'inscrita' }), // segundo registro del estudiante u1
];
const historicas = [
  H('h1', '1000000001', { periodoNormalizado: '26V04', periodoOriginal: '26V04', estadoAnalitico: 'en_practica', esEstadoDeCorte: true }),
  H('h2', '1000000002'),
  H('h3', '1000000003', { periodoNormalizado: '25P01', periodoOriginal: '25P01' }),
  H('h4', '1000000003', { periodoNormalizado: '25P01', periodoOriginal: '25P01', estadoAnalitico: 'reprobado' }),
  H('h5', '1000000099', { periodoNormalizado: '2024B', periodoOriginal: '2024B', modalidadPracticaNormalizada: null, modalidadPracticaOriginal: 'EMPRESA PROPIA' }),
  H('h6', '1000000099', { periodoNormalizado: '2025C', periodoOriginal: '2025C', duplicadoDe: null, qualityFlags: ['END_BEFORE_START'], duracionDias: null }),
];
const confirmadas = [{ sourceRecordId: 'h1', practicaId: 'a1' }];

describe('Analítica unificada · CURRENT', () => {
  it('cuenta exactamente las prácticas de SIPRA, sin leer el histórico ni documentos', async () => {
    const r = repo(actuales, historicas, confirmadas);
    const res = await consultar(r, { fuente: 'current' });
    expect(res.totales).toEqual({ practicas: 4, estudiantesUnicos: 3, precisionEstudiantes: 'exacta' });
    expect(r.llamadas).toEqual(['actuales:false']);
    expect(res.indicadorDocumentalSgp).toBeNull();
    expect(res.estadoAl.historical).toBeNull();
  });
  it('tasas de resultado solo sobre estados finales (una certificada → cerrado)', async () => {
    const res = await consultar(repo(actuales, []), { fuente: 'current' });
    expect(res.tasas.cierre).toEqual({ numerador: 1, denominador: 1, valor: 1 });
  });
});

describe('Analítica unificada · HISTORICAL (fixture sintético)', () => {
  it('cuenta los registros SGP vigentes con su estado al corte', async () => {
    const res = await consultar(repo([], historicas), { fuente: 'historical' });
    expect(res.totales.practicas).toBe(6);
    expect(res.totales.estudiantesUnicos).toBe(4);
    expect(res.estadoAl).toEqual({ current: null, historical: '2026-09-22T17:25:54Z' });
  });
  it('estado al corte NO es resultado: h1 (en práctica al corte) no entra a las tasas', async () => {
    const res = await consultar(repo([], historicas), { fuente: 'historical' });
    expect(res.tasas.cierre.denominador).toBe(5);
    expect(res.tasas.reprobacion.numerador).toBe(1);
  });
  it('duración excluye END_BEFORE_START; EMPRESA PROPIA aparece sin mapearse; B y C separados', async () => {
    const res = await consultar(repo([], historicas), { fuente: 'historical' });
    expect(res.duracion.casos).toBe(5);
    expect(res.dimensiones.modalidadPractica.find((d) => d.clave === 'sgp:EMPRESA PROPIA')?.etiqueta).toMatch(/sin equivalente/);
    const periodos = res.dimensiones.periodo.map((d) => d.clave);
    expect(periodos).toEqual(expect.arrayContaining(['2024B', '2025C']));
  });
  it('organización sin correspondencia: etiqueta neutra, sin reconstruir nombres; ciudad como texto SGP', async () => {
    const res = await consultar(repo([], historicas), { fuente: 'historical' });
    expect(res.dimensiones.organizacion[0]).toMatchObject({ clave: 'org-historica:00000000-0000-4000-8000-0000000000a1', etiqueta: 'Organización histórica sin correspondencia' });
    expect(res.dimensiones.ciudad[0].clave).toBe('sgp-texto:BOGOTA');
  });
  it('copia idéntica de otro registro no cuenta dos veces', async () => {
    const copia = H('h7', '1000000099', { duplicadoDe: 'h6', qualityFlags: ['IDENTICAL_CONTENT'] });
    const res = await consultar(repo([], [...historicas, copia]), { fuente: 'historical' });
    expect(res.totales.practicas).toBe(6);
  });
  it('indicador documental SGP aparte (no es Cumplimiento)', async () => {
    const res = await consultar(repo([], historicas), { fuente: 'historical' });
    expect(res.indicadorDocumentalSgp).toMatchObject({ casos: 6, subidoPromedio: 1 });
  });
});

describe('Analítica unificada · ALL', () => {
  it('solo el solapamiento CONFIRMADO se deduplica; candidatos y ambiguos se cuentan en ambos lados', async () => {
    const res = await consultar(repo(actuales, historicas, confirmadas), { fuente: 'all' });
    expect(res.totales.practicas).toBe(4 + 6 - 1);
    expect(res.solapamiento?.excluidosDeAll).toEqual({ CORRESPONDENCIA_CONFIRMADA_CON_SIPRA: 1 });
    expect(res.solapamiento?.categorias).toMatchObject({ matched: 1, candidate_overlap: 1, ambiguous_overlap: 2 });
  });
  it('SIPRA gana en lo confirmado: el estado de h1 (al corte) no aparece; el de a1 sí', async () => {
    const res = await consultar(repo(actuales, historicas, confirmadas), { fuente: 'all' });
    const enPractica = res.dimensiones.estado.find((d) => d.clave === 'en_practica');
    expect(enPractica?.origen).toBe('current');
  });
  it('una correspondencia hacia una práctica que no está en el universo no deduplica', async () => {
    const res = await consultar(repo(actuales.slice(1), historicas, confirmadas), { fuente: 'all' });
    expect(res.solapamiento?.excluidosDeAll).toEqual({});
  });
  it('dimensión común: el nivel se combina; un programa sin código SINU confirmado NO se fusiona', async () => {
    const res = await consultar(repo(actuales, historicas, confirmadas), { fuente: 'all' });
    expect(res.dimensiones.nivel.find((d) => d.clave === 'profesional')?.origen).toBe('comun');
    expect(res.dimensiones.programa.map((d) => d.clave).sort()).toEqual(['sgp:ADMINISTRACION DE EMPRESAS', 'sinu:ADM-PRO']);
    const conCodigo = await consultar(repo(actuales, historicas.map((h) => ({ ...h, codigoSinu: 'ADM-PRO' }))), { fuente: 'all' });
    expect(conCodigo.dimensiones.programa).toEqual([expect.objectContaining({ clave: 'sinu:ADM-PRO', origen: 'comun' })]);
  });
  it('frontera institucional: el histórico desde la frontera sale de ALL con motivo', async () => {
    const r = repo(actuales, historicas);
    const res = await new AnaliticaUnificadaUseCase(r, new IdentidadAnaliticaHmac([seud]), { fronteras: { virtual: '26V01' } }).consultar({ fuente: 'all' });
    expect(res.solapamiento?.excluidosDeAll.DESPUES_DE_LA_FRONTERA).toBe(1);
  });
  it('alcance por escuelas: el histórico no entra (no tiene escuela) y se advierte', async () => {
    const r = repo(actuales, historicas);
    const res = await consultar(r, { fuente: 'all', escuelaIds: ['ESC-NEG'] });
    expect(r.llamadas).not.toContain('historicas');
    expect(res.advertencias.join(' ')).toMatch(/HISTORICO_FUERA_DE_ALCANCE/);
  });
});

describe('Analítica unificada · estudiantes únicos (identidad, no filas)', () => {
  it('ALL: la misma persona en SIPRA y en el SGP, con varias prácticas y periodos, cuenta UNA vez', async () => {
    const res = await consultar(repo(actuales, historicas, confirmadas), { fuente: 'all' });
    // u1, u2, u3 (presentes en ambas fuentes) + el estudiante solo histórico (…99) = 4.
    expect(res.totales.estudiantesUnicos).toBe(4);
    expect(res.totales.precisionEstudiantes).toBe('exacta');
  });
  it('sin clave HMAC no se puede comparar: ALL informa cota superior y no lee documentos', async () => {
    const r = repo(actuales, historicas, confirmadas);
    const res = await consultar(r, { fuente: 'all' }, false);
    expect(res.totales.precisionEstudiantes).toBe('cota_superior');
    // 3 actuales + 3 identidades históricas propias (h1 sale de ALL por la correspondencia confirmada, que no depende de la clave).
    expect(res.totales.estudiantesUnicos).toBe(3 + 3);
    expect(r.llamadas).toContain('actuales:false');
  });
  it('versión de clave del histórico sin secreto disponible (v2): advertencia y cota superior', async () => {
    const res = await consultar(repo(actuales, historicas.map((h) => ({ ...h, hmacKeyVersion: 'v2' }))), { fuente: 'all' });
    expect(res.advertencias.join(' ')).toMatch(/IDENTIDAD_NO_COMPARABLE.*v2/);
    expect(res.totales.precisionEstudiantes).toBe('cota_superior');
  });
});

describe('Analítica unificada · filtros y privacidad', () => {
  it('filtros sobre el modelo común con la misma semántica en ambas fuentes', async () => {
    const res = await consultar(repo(actuales, historicas, confirmadas), { fuente: 'all', nivel: 'profesional', modalidadPractica: 'modalidad:pasantia', periodos: ['25V05'] });
    expect(res.totales.practicas).toBe(2); // a2 + h2
  });
  it('el contrato no expone claves seudónimas, documentos, marcas internas ni identidades', async () => {
    for (const fuente of ['current', 'historical', 'all'] as const) {
      const texto = JSON.stringify(await consultar(repo(actuales, historicas, confirmadas), { fuente }));
      expect(texto).not.toMatch(/[0-9a-f]{64}/);
      expect(texto).not.toMatch(/100000000\d/);
      expect(texto).not.toMatch(/"(identidadEstudiante|studentKey|student_key|teacher_key|organization_key)"/);
      for (const m of [...MARCAS_CALIDAD, ...MARCAS_ORGANIZACION]) expect(texto).not.toContain(`"${m}"`);
      expect(texto).not.toMatch(/current:u\d|historical:v1:/);
    }
  });
});
