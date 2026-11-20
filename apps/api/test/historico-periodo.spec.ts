import { parsearPeriodoSgp } from '../src/domain/historico/periodo-sgp.parser';

describe('Histórico SGP · parser de periodos', () => {
  it.each([
    ['2024A', 'presencial', 2024, 'A'], ['2024B', 'presencial', 2024, 'B'], ['2025C', 'presencial', 2025, 'C'], ['2026D', 'presencial', 2026, 'D'],
  ])('presencial %s conserva su código', (v, formato, anio, ordinal) => {
    const p = parsearPeriodoSgp(v);
    expect(p).toMatchObject({ normalizado: v, formato, anio, ordinal, estadoMapeo: 'FORMAT_COMPATIBLE' });
  });

  it('B y C NO se fusionan: son códigos distintos', () => {
    expect(parsearPeriodoSgp('2024B').normalizado).toBe('2024B');
    expect(parsearPeriodoSgp('2025C').normalizado).toBe('2025C');
    expect(parsearPeriodoSgp('2024B').ordinal).not.toBe(parsearPeriodoSgp('2024C').ordinal);
  });

  it.each(['01', '02', '03', '04', '05', '06'])('virtual V%s y 335 P%s', (n) => {
    expect(parsearPeriodoSgp(`23V${n}`)).toMatchObject({ normalizado: `23V${n}`, formato: 'virtual', anio: 2023, ordinal: n });
    expect(parsearPeriodoSgp(`25P${n}`)).toMatchObject({ normalizado: `25P${n}`, formato: '335', anio: 2025, ordinal: n });
  });

  it('I y T son de legado: sin normalizado', () => {
    expect(parsearPeriodoSgp('2023I')).toMatchObject({ normalizado: null, formato: 'intersemestral_legacy', anio: 2023, estadoMapeo: 'LEGACY' });
    expect(parsearPeriodoSgp('22T01')).toMatchObject({ normalizado: null, formato: 'trimestral_legacy', anio: 2022, estadoMapeo: 'LEGACY' });
  });

  it.each(['23V07', '25P00', '2024E', 'XYZ', '2024', '24V1'])('desconocido «%s» → UNPARSEABLE sin lanzar', (v) => {
    expect(parsearPeriodoSgp(v)).toMatchObject({ normalizado: null, formato: 'unknown', estadoMapeo: 'UNPARSEABLE' });
  });

  it('vacío → MISSING; minúsculas y espacios se toleran', () => {
    expect(parsearPeriodoSgp('  ').estadoMapeo).toBe('MISSING');
    expect(parsearPeriodoSgp(null).estadoMapeo).toBe('MISSING');
    expect(parsearPeriodoSgp(' 26v04 ').normalizado).toBe('26V04');
    expect(parsearPeriodoSgp(' 26v04 ').original).toBe('26v04');
  });

  it('reconoce los 79 valores observados en la auditoría (solo 2023I…/T son legado)', () => {
    const observados = [
      '2020A', '2020B', '2020I', '2021A', '2021B', '2021I', '2022A', '2022B', '2023A', '2023B', '2023I', '2024A', '2024B', '2024I',
      '2025A', '2025B', '2025C', '2026A', '2026C', '20V01', '20V02', '20V03', '20V04', '20V05', '20V06', '21T04', '21T05',
      '21V01', '21V02', '21V03', '21V04', '21V05', '21V06', '22T01', '22T04', '22V01', '22V02', '22V03', '22V04', '22V05', '22V06',
      '23V01', '23V02', '23V03', '23V04', '23V05', '23V06', '24P01', '24P02', '24P03', '24P04', '24P05', '24P06', '24V01', '24V02',
      '24V03', '24V04', '24V05', '24V06', '25P01', '25P02', '25P03', '25P04', '25P05', '25P06', '25V01', '25V02', '25V03', '25V04',
      '25V05', '25V06', '26P01', '26P02', '26P03', '26P04', '26V01', '26V02', '26V03', '26V04',
    ];
    expect(observados).toHaveLength(79);
    const estados = observados.map((v) => parsearPeriodoSgp(v).estadoMapeo);
    expect(estados.filter((e) => e === 'UNPARSEABLE')).toHaveLength(0);
    expect(estados.filter((e) => e === 'LEGACY')).toHaveLength(8);
  });
});
