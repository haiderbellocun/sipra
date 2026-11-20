import {
  PoliticaSolapamiento, PracticaComparable, matrizSolapamiento, procesosContadosDosVeces, seleccionarParaConteo,
} from '../src/domain/historico/solapamiento-historico';

const P = (id: string, o: Partial<PracticaComparable> = {}): PracticaComparable => ({
  id, studentKey: 'k1', periodo: '26V04', ciclo: 'tecnico', modalidad: 'pasantia', fechaInicio: '2026-08-01', fechaFin: '2026-11-01',
  estado: 'inscrito', creadaEn: '2026-08-01T00:00:00.000Z', sgpId: null, ...o,
});
const CORTE = '2026-09-22T17:25:54.000Z';

describe('Histórico SGP · matriz de solapamiento', () => {
  it('solo histórico, solo SIPRA, candidato, confirmado y ambiguo', () => {
    const h = [
      P('h-solo', { studentKey: 'a' }),
      P('h-cand', { studentKey: 'b', sgpId: 'h-cand' }),
      P('h-conf', { studentKey: 'c', sgpId: 'h-conf' }),
      P('h-amb1', { studentKey: 'd', sgpId: 'h-amb1' }), P('h-amb2', { studentKey: 'd', sgpId: 'h-amb2' }),
    ];
    const a = [
      P('a-solo', { studentKey: 'z' }),
      P('a-cand', { studentKey: 'b' }),
      P('a-conf', { studentKey: 'otro', sgpId: 'h-conf' }),
      P('a-amb', { studentKey: 'd' }),
    ];
    const m = matrizSolapamiento(h, a);
    expect(m.conteos).toEqual({ historical_only: 1, current_only: 1, candidate_overlap: 1, confirmed_overlap: 1, ambiguous_overlap: 2 });
    expect(m.pares.find((p) => p.categoria === 'candidate_overlap')?.fuerza).toBe('alta');
  });

  it('un candidato NUNCA se declara confirmado sin identificador del SGP', () => {
    const m = matrizSolapamiento([P('h')], [P('a')]);
    expect(m.conteos.confirmed_overlap).toBe(0);
    expect(m.conteos.candidate_overlap).toBe(1);
  });

  it('anulados y registros sin estudiante, periodo o ciclo no se cruzan', () => {
    const m = matrizSolapamiento([P('h', { estado: 'anulado' }), P('h2', { studentKey: null })], [P('a')]);
    expect(m.conteos.candidate_overlap).toBe(0);
  });
});

describe('Histórico SGP · doble conteo según la política', () => {
  // Proceso que empezó en el SGP antes del corte y continuó en SIPRA (registro nuevo después del corte).
  const h = [P('h1', { sgpId: 'h1' }), P('h2', { studentKey: 'k2', periodo: '25V05', sgpId: 'h2' })];
  const a = [P('a1', { creadaEn: '2026-10-01T00:00:00.000Z' }), P('a2', { studentKey: 'k9' })];

  it('CUTOFF_DATE cuenta dos veces el proceso que continuó en SIPRA', () => {
    const sel = seleccionarParaConteo(h, a, 'CUTOFF_DATE', { fechaCorte: CORTE });
    expect(procesosContadosDosVeces(h, a, sel)).toBe(1);
  });

  it('IDENTIFIER sin el # del SGP en SIPRA (P-42) también cuenta dos veces', () => {
    const sel = seleccionarParaConteo(h, a, 'IDENTIFIER', { fechaCorte: CORTE });
    expect(procesosContadosDosVeces(h, a, sel)).toBe(1);
  });

  it('IDENTIFIER con el # conservado excluye el histórico confirmado', () => {
    const conId = [{ ...a[0], sgpId: 'h1' }, a[1]];
    const sel = seleccionarParaConteo(h, conId, 'IDENTIFIER', { fechaCorte: CORTE });
    expect(sel.historicos.has('h1')).toBe(false);
    expect(procesosContadosDosVeces(h, conId, sel)).toBe(0);
  });

  it('COMBINED (recomendada): cero procesos contados dos veces y SIPRA gana', () => {
    const sel = seleccionarParaConteo(h, a, 'COMBINED', { fechaCorte: CORTE });
    expect(procesosContadosDosVeces(h, a, sel)).toBe(0);
    expect(sel.actuales.has('a1')).toBe(true);
    expect(sel.historicos.has('h1')).toBe(false);
    expect(sel.historicos.has('h2')).toBe(true);
  });

  it('COMBINED con frontera: el histórico desde la frontera queda fuera', () => {
    const sel = seleccionarParaConteo(h, [], 'COMBINED', { fechaCorte: CORTE, fronteras: { virtual: '26V01' } });
    expect(sel.historicos.has('h1')).toBe(false);
    expect(sel.excluidos.find((e) => e.id === 'h1')?.motivo).toBe('DESPUES_DE_LA_FRONTERA');
    expect(sel.historicos.has('h2')).toBe(true);
  });

  it('propiedad: con datos aleatorios COMBINED nunca cuenta un proceso dos veces', () => {
    let semilla = 7;
    const azar = (n: number): number => { semilla = (semilla * 1103515245 + 12345) % 2 ** 31; return semilla % n; };
    for (let ronda = 0; ronda < 50; ronda += 1) {
      const gen = (pref: string, n: number): PracticaComparable[] => Array.from({ length: n }, (_, i) => P(`${pref}${i}`, {
        studentKey: `k${azar(8)}`, periodo: ['26V03', '26V04', '2026C'][azar(3)], ciclo: ['tecnico', 'tecnologo'][azar(2)],
        estado: (['inscrito', 'cerrado', 'anulado', 'en_practica'] as const)[azar(4)], sgpId: pref === 'h' ? `h${i}` : (azar(5) === 0 ? `h${azar(10)}` : null),
      }));
      const hh = gen('h', 10);
      const aa = gen('a', 10);
      for (const pol of ['COMBINED'] as PoliticaSolapamiento[]) {
        expect(procesosContadosDosVeces(hh, aa, seleccionarParaConteo(hh, aa, pol, { fechaCorte: CORTE }))).toBe(0);
      }
    }
  });
});
