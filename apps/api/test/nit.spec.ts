import { Nit, NitInvalidoError } from '../src/domain/value-objects/nit.vo';

describe('NIT — dígito de verificación (algoritmo DIAN)', () => {
  it('calcula el DV del caso de referencia del demo', () => {
    expect(Nit.calcularDigitoVerificacion('901458772')).toBe(2);
  });

  it.each([
    ['830045123', 2],
    ['900777001', 7],
    ['800197268', 4],
    ['899999063', 3],
  ])('calcula el DV de %s', (numero, esperado) => {
    expect(Nit.calcularDigitoVerificacion(numero)).toBe(esperado);
  });

  it('acepta la forma con guion cuando el DV coincide', () => {
    const nit = Nit.crear('901458772-2');
    expect(nit.numero).toBe('901458772');
    expect(nit.formateado).toBe('901458772-2');
  });

  it('rechaza la forma con guion cuando el DV no coincide', () => {
    expect(() => Nit.crear('901458772-9')).toThrow(NitInvalidoError);
  });

  it('rechaza valores vacíos o demasiado cortos', () => {
    expect(() => Nit.crear('')).toThrow(NitInvalidoError);
    expect(() => Nit.crear('123')).toThrow(NitInvalidoError);
  });

  it('esValido no lanza ante entradas basura', () => {
    expect(Nit.esValido('no-es-un-nit', 3)).toBe(false);
  });
});
