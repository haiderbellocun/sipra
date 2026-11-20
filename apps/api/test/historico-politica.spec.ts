import { METRICAS_HISTORICAS, POLITICA_CALIDAD, elegibilidadHistorica, elegibilidadPorMetrica } from '../src/domain/historico/politica-calidad-historico';
import { MarcaCalidad, MarcaOrganizacion, MARCAS_CALIDAD, MARCAS_ORGANIZACION } from '../src/domain/historico/calidad-historico';
import { RegistroHistorico, aplicarMarcasDeLote, transformarFilaSgp } from '../src/domain/historico/registro-historico';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { filasFixtureSgp } from './soporte-historico-sgp';

const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-politica-'.padEnd(48, 'p'), 'v1');
const lote = (): RegistroHistorico[] => {
  const l = filasFixtureSgp(1).map((c, i) => transformarFilaSgp({ filaOrigen: i + 2, celdas: c }, 'SGP_SINTETICO', seud));
  aplicarMarcasDeLote(l, '2026-09-22T17:25:00.000Z');
  return l;
};
const con = (r: RegistroHistorico, q: MarcaCalidad[] = [], o: MarcaOrganizacion[] = [], extra: Partial<RegistroHistorico> = {}): RegistroHistorico =>
  ({ ...r, qualityFlags: q, organizationFlags: o, ...extra });

describe('Histórico SGP · política de calidad por métrica', () => {
  const base = lote()[40];

  it('existe una regla para cada métrica y solo usa marcas del catálogo', () => {
    for (const m of METRICAS_HISTORICAS) {
      const r = POLITICA_CALIDAD[m];
      for (const f of r.excluyePractica) expect(MARCAS_CALIDAD).toContain(f);
      for (const f of r.excluyeOrganizacion) expect(MARCAS_ORGANIZACION).toContain(f);
    }
  });

  it('prácticas por periodo INCLUYE fechas incoherentes (END_BEFORE_START) y MISSING_LEVEL', () => {
    expect(elegibilidadHistorica(con(base, ['END_BEFORE_START', 'MISSING_LEVEL']), 'practicas_por_periodo').elegible).toBe(true);
  });

  it('duración EXCLUYE END_BEFORE_START, INVALID_START_DATE e INVALID_END_DATE', () => {
    for (const f of ['END_BEFORE_START', 'INVALID_START_DATE', 'INVALID_END_DATE'] as const) {
      expect(elegibilidadHistorica(con(base, [f]), 'duracion')).toEqual({ elegible: false, motivo: f });
    }
    expect(elegibilidadHistorica(con(base), 'duracion').elegible).toBe(true);
  });

  it('empresa: excluye identificador ausente o inválido; varios alias NO excluye ni afecta otras métricas', () => {
    expect(elegibilidadHistorica(con(base, [], ['IDENTIFIER_INVALID']), 'organizacion').elegible).toBe(false);
    expect(elegibilidadHistorica(con(base, [], ['IDENTIFIER_MISSING']), 'organizacion').elegible).toBe(false);
    expect(elegibilidadHistorica(con(base, [], ['MULTIPLE_ALIASES']), 'organizacion').elegible).toBe(true);
    expect(elegibilidadHistorica(con(base, [], ['IDENTIFIER_INVALID']), 'practicas').elegible).toBe(true);
  });

  it('tasas de resultado excluyen el estado al corte; la distribución de estados no', () => {
    const abierto = con(base, [], [], { esEstadoDeCorte: true, estadoAnalitico: 'inscrito' });
    expect(elegibilidadHistorica(abierto, 'tasa_cierre')).toEqual({ elegible: false, motivo: 'ESTADO_AL_CORTE' });
    expect(elegibilidadHistorica(abierto, 'estado').elegible).toBe(true);
  });

  it('duplicado idéntico: el representante cuenta, la copia no (en ninguna métrica de conteo)', () => {
    const copia = con(base, ['IDENTICAL_CONTENT'], [], { duplicadoDe: '9000001' });
    const representante = con(base, ['IDENTICAL_CONTENT'], [], { duplicadoDe: null });
    expect(elegibilidadHistorica(copia, 'practicas')).toEqual({ elegible: false, motivo: 'DUPLICADO_DE_OTRO_REGISTRO' });
    expect(elegibilidadHistorica(representante, 'practicas').elegible).toBe(true);
  });

  it('salario: solo inequívoco; indicador documental SGP aparte de Cumplimiento', () => {
    expect(elegibilidadHistorica(con(base, ['SALARY_OUTLIER']), 'salario').elegible).toBe(false);
    expect(POLITICA_CALIDAD.indicador_documental_sgp.descripcion).toMatch(/NO es Cumplimiento V3/);
  });

  it('sobre el fixture: cada métrica deja fuera solo lo que su regla dice', () => {
    const e = elegibilidadPorMetrica(lote());
    expect(e.practicas.excluidos).toBe(1); // la copia idéntica
    expect(e.duracion.excluidos).toBeGreaterThan(e.practicas.excluidos);
    expect(e.organizacion.excluidos).toBe(2); // NIT «123» + la copia idéntica
  });
});
