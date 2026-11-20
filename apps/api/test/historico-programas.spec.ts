import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  inventarioProgramas, resolverPrograma, similitudProgramas, validarEquivalenciasProgramas,
} from '../src/domain/historico/programas-sgp';
import { parsearPeriodoSgp } from '../src/domain/historico/periodo-sgp.parser';
import { mapearModalidadPracticaSgp } from '../src/domain/historico/normalizacion-sgp';
import { transformarFilaSgp } from '../src/domain/historico/registro-historico';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { cargarEquivalenciasProgramas, configuracionSolapamiento } from '../src/infrastructure/historico/configuracion-historico';
import { filasFixtureSgp } from './soporte-historico-sgp';

describe('Histórico SGP · programa → código SINU', () => {
  const eq = validarEquivalenciasProgramas({
    version: 't', programas: [
      { programaSgp: 'PROGRAMA SINTETICO A', codigoSinu: 'SIN-A', estado: 'confirmado' },
      { programaSgp: 'PROGRAMA SINTETICO B', codigoSinu: null, estado: 'pendiente' },
    ],
  });

  it('solo una equivalencia CONFIRMADA asigna código; pendiente o ausente nunca', () => {
    expect(resolverPrograma('PROGRAMA SINTETICO A', eq)).toEqual({ codigoSinu: 'SIN-A', estado: 'MAPPED' });
    expect(resolverPrograma('PROGRAMA SINTETICO B', eq)).toEqual({ codigoSinu: null, estado: 'PENDING_INSTITUTIONAL_MAPPING' });
    expect(resolverPrograma('PROGRAMA SINTETICO A2', eq).codigoSinu).toBeNull(); // parecido NO es igual
  });

  it('el importador aplica la equivalencia confirmada y deja pendiente lo demás', () => {
    const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-programas-'.padEnd(48, 'q'), 'v1');
    const filas = filasFixtureSgp(1);
    const a = transformarFilaSgp({ filaOrigen: 2, celdas: filas[0] }, 'SGP_SINTETICO', seud, { programas: eq });
    const b = transformarFilaSgp({ filaOrigen: 3, celdas: filas[1] }, 'SGP_SINTETICO', seud, { programas: eq });
    expect(a).toMatchObject({ programaNormalizado: 'PROGRAMA SINTETICO A', codigoSinu: 'SIN-A', programaMappingStatus: 'MAPPED' });
    expect(b).toMatchObject({ codigoSinu: null, programaMappingStatus: 'PENDING_INSTITUTIONAL_MAPPING' });
  });

  it('la configuración rechaza: nombre no normalizado, repetido, confirmado sin código y pendiente con código', () => {
    const v = (programas: unknown[]): unknown => validarEquivalenciasProgramas({ version: 'x', programas });
    expect(() => v([{ programaSgp: 'Programa a', estado: 'pendiente' }])).toThrow(/normalizado/);
    expect(() => v([{ programaSgp: 'A', estado: 'pendiente' }, { programaSgp: 'A', estado: 'pendiente' }])).toThrow(/repetido/);
    expect(() => v([{ programaSgp: 'A', estado: 'confirmado' }])).toThrow(/código SINU/);
    expect(() => v([{ programaSgp: 'A', estado: 'pendiente', codigoSinu: 'X1' }])).toThrow(/no lleva código/);
  });

  it('la similitud solo SUGIERE: el inventario la muestra pero nunca asigna', () => {
    expect(similitudProgramas('ADMINISTRACION DE EMPRESAS', 'ADMINISTRACION DE EMPRESAS AGROINDUSTRIALES')).toBeGreaterThan(0.5);
    const inv = inventarioProgramas([
      { programaNormalizado: 'ADMINISTRACION DE EMPRESAS', nivelInferido: 'tecnico', regional: 'R1', pensum: '1' },
      { programaNormalizado: 'ADMINISTRACION DE EMPRESAS AGROINDUSTRIALES', nivelInferido: 'tecnico', regional: 'R1', pensum: '2' },
    ]);
    expect(inv[0].sugerencias.length).toBe(1);
    expect(inv.every((e) => e.codigoSinu === null)).toBe(true);
  });

  it('el archivo versionado es válido, no tiene datos personales y hoy NO confirma ningún programa', () => {
    const eqReal = cargarEquivalenciasProgramas();
    expect(eqReal.programas.size).toBe(19);
    expect([...eqReal.programas.values()].every((p) => p.estado === 'pendiente' && p.codigoSinu === null)).toBe(true);
    const texto = readFileSync(join(__dirname, '..', 'config', 'historico', 'programas-sgp.json'), 'utf8');
    expect(texto).not.toMatch(/@|\b\d{7,}\b/);
  });
});

describe('Histórico SGP · decisiones institucionales pendientes', () => {
  it('B y C NO se unifican: códigos y ordinales distintos', () => {
    expect(parsearPeriodoSgp('2024B')).toMatchObject({ normalizado: '2024B', ordinal: 'B' });
    expect(parsearPeriodoSgp('2025C')).toMatchObject({ normalizado: '2025C', ordinal: 'C' });
  });
  it('I y T siguen como legado', () => {
    expect(parsearPeriodoSgp('2023I').estadoMapeo).toBe('LEGACY');
    expect(parsearPeriodoSgp('22T01').estadoMapeo).toBe('LEGACY');
  });
  it('EMPRESA PROPIA sigue pendiente (ni validación de experiencia ni emprendimiento)', () => {
    expect(mapearModalidadPracticaSgp('EMPRESA PROPIA')).toEqual({ normalizada: null, estadoMapeo: 'PENDING_INSTITUTIONAL_MAPPING' });
  });
  it('política de solapamiento: COMBINED por omisión; HISTORICO_OVERLAP_POLICY manda; valor desconocido falla', () => {
    expect(configuracionSolapamiento({}).politica).toBe('COMBINED');
    expect(configuracionSolapamiento({ HISTORICO_OVERLAP_POLICY: 'CUTOFF_DATE' }).politica).toBe('CUTOFF_DATE');
    expect(() => configuracionSolapamiento({ HISTORICO_OVERLAP_POLICY: 'NAME' })).toThrow(/HISTORICO_OVERLAP_POLICY/);
    expect(configuracionSolapamiento({}).fronteras).toEqual({ presencial: null, virtual: null, '335': null });
  });
});
