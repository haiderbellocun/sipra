import { diasEntre, parsearFechaSgp, parsearMarcaTiempoSgp } from '../src/domain/historico/fechas-sgp.parser';

const utc = (a: number, m: number, d: number, h = 0, mi = 0): Date => {
  const f = new Date(Date.UTC(2000, m - 1, d, h, mi));
  f.setUTCFullYear(a);
  return f;
};

describe('Histórico SGP · fechas', () => {
  it('fecha válida (celda de Excel y texto ISO)', () => {
    expect(parsearFechaSgp(utc(2024, 3, 15))).toEqual({ original: '2024-03-15', fecha: '2024-03-15', estado: 'valida' });
    expect(parsearFechaSgp('2024-03-15')).toEqual({ original: '2024-03-15', fecha: '2024-03-15', estado: 'valida' });
  });

  it('0000-00-00 (fecha cero de MySQL) → original conservado, fecha NULL', () => {
    expect(parsearFechaSgp('0000-00-00')).toEqual({ original: '0000-00-00', fecha: null, estado: 'invalida' });
  });

  it('año 0001 y años como 0020 → NULL, sin inventar', () => {
    expect(parsearFechaSgp('0001-01-01')).toMatchObject({ fecha: null, estado: 'invalida' });
    expect(parsearFechaSgp('0020-02-17')).toMatchObject({ fecha: null, estado: 'invalida' });
    expect(parsearFechaSgp(utc(1, 1, 1))).toMatchObject({ fecha: null, estado: 'invalida' });
  });

  it('año 2223 → NULL', () => {
    expect(parsearFechaSgp(utc(2223, 3, 9))).toEqual({ original: '2223-03-09', fecha: null, estado: 'invalida' });
    expect(parsearFechaSgp('2223-05-09')).toMatchObject({ fecha: null, estado: 'invalida' });
  });

  it('fecha real pero fuera de la ventana del proceso: se conserva y se informa', () => {
    expect(parsearFechaSgp(utc(1979, 7, 17))).toEqual({ original: '1979-07-17', fecha: '1979-07-17', estado: 'fuera_de_rango' });
    expect(parsearFechaSgp(utc(2050, 1, 1))).toMatchObject({ fecha: '2050-01-01', estado: 'fuera_de_rango' });
  });

  it('fecha de calendario imposible y textos libres → NULL', () => {
    expect(parsearFechaSgp('2023-02-30')).toMatchObject({ fecha: null, estado: 'invalida' });
    expect(parsearFechaSgp('mañana')).toMatchObject({ original: 'mañana', fecha: null, estado: 'invalida' });
    expect(parsearFechaSgp(45123)).toMatchObject({ fecha: null, estado: 'invalida' }); // número sin formato: ambiguo
  });

  it('vacía', () => {
    expect(parsearFechaSgp(null)).toEqual({ original: null, fecha: null, estado: 'vacia' });
    expect(parsearFechaSgp('   ')).toEqual({ original: null, fecha: null, estado: 'vacia' });
  });

  it('fin antes de inicio: la diferencia es negativa (la marca la pone el transformador, no se rechaza)', () => {
    expect(diasEntre('2024-06-01', '2024-03-01')).toBeLessThan(0);
    expect(diasEntre('2024-01-01', '2024-03-12')).toBe(71);
  });

  it('marca de tiempo: hora de pared de Colombia → instante UTC', () => {
    expect(parsearMarcaTiempoSgp(utc(2026, 9, 22, 12, 25))).toMatchObject({ instante: '2026-09-22T17:25:00.000Z', estado: 'valida' });
    expect(parsearMarcaTiempoSgp('2026-09-22 12:25:54')).toMatchObject({ instante: '2026-09-22T17:25:54.000Z' });
    expect(parsearMarcaTiempoSgp('0000-00-00 00:00:00')).toMatchObject({ instante: null, estado: 'invalida' });
  });
});
