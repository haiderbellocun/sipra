import { minimizarLectura } from '../src/application/use-cases/documentos/procesar-trabajo.use-case';

/**
 * Cuando el archivo se purga por retención, de la lectura asistida solo queda
 * lo que sostiene los costos. Los textos literales del documento (campos,
 * evidencias, resumen, motivo, detalle del error) se van con el archivo.
 */

const LECTURA_COMPLETA: Record<string, unknown> = {
  modelo: 'gpt-6-luna-2026-09-22',
  proveedor: 'openai',
  tokensEntrada: 10_000,
  tokensSalida: 500,
  tokensCache: 2_000,
  tokensRazonamiento: 200,
  costoUsd: 0.00107,
  gastoPrevioUsd: 0.002,
  leidoEn: '2026-10-09T15:00:00.000Z',
  intentos: 2,
  ilegible: false,
  tipoDetectado: 'certificado_eps',
  fallida: false,
  tarifaDesconocida: false,
  duracionMs: 1_234,
  campos: { nombre_afiliado: { valor: 'Ana Pérez', confianza: 0.9, evidencia: 'ANA PÉREZ' } },
  hallazgos: [{ codigo: 'CRIT_1', cumple: 'si', detalle: 'Aparece la cédula 1.234.567' }],
  resumen: 'Certificado de afiliación de Ana Pérez a Nueva EPS',
  motivoIlegible: null,
};

describe('minimizarLectura', () => {
  it('con null devuelve null', () => {
    expect(minimizarLectura(null)).toBeNull();
  });

  it('conserva solo lo que sostiene los costos y marca la lectura como purgada', () => {
    const reducida = minimizarLectura(LECTURA_COMPLETA)!;
    expect(reducida).toEqual({
      purgada: true,
      modelo: 'gpt-6-luna-2026-09-22',
      proveedor: 'openai',
      tokensEntrada: 10_000,
      tokensSalida: 500,
      tokensCache: 2_000,
      tokensRazonamiento: 200,
      costoUsd: 0.00107,
      gastoPrevioUsd: 0.002,
      leidoEn: '2026-10-09T15:00:00.000Z',
      intentos: 2,
      ilegible: false,
      tipoDetectado: 'certificado_eps',
      fallida: false,
      tarifaDesconocida: false,
    });
  });

  it('elimina campos, hallazgos, resumen y motivo: el contenido del documento', () => {
    const reducida = minimizarLectura(LECTURA_COMPLETA)!;
    for (const clave of ['campos', 'hallazgos', 'resumen', 'motivoIlegible', 'duracionMs']) {
      expect(clave in reducida).toBe(false);
    }
    expect(JSON.stringify(reducida)).not.toContain('Ana Pérez');
    expect(JSON.stringify(reducida)).not.toContain('1.234.567');
  });

  it('no inventa claves que la lectura no traía', () => {
    const reducida = minimizarLectura({ modelo: 'simulado', costoUsd: 0, leidoEn: '2026-10-09T15:00:00.000Z' })!;
    expect(reducida).toEqual({ purgada: true, modelo: 'simulado', costoUsd: 0, leidoEn: '2026-10-09T15:00:00.000Z' });
    expect('gastoPrevioUsd' in reducida).toBe(false);
    expect('intentos' in reducida).toBe(false);
  });

  it('conserva valores falsos y ceros: son datos, no ausencias', () => {
    const reducida = minimizarLectura({ ilegible: false, tarifaDesconocida: false, costoUsd: 0, tokensEntrada: 0 })!;
    expect(reducida.ilegible).toBe(false);
    expect(reducida.tarifaDesconocida).toBe(false);
    expect(reducida.costoUsd).toBe(0);
    expect(reducida.tokensEntrada).toBe(0);
  });

  it('de una lectura fallida conserva la marca y el gasto, pero no el texto del error del proveedor', () => {
    const reducida = minimizarLectura({
      fallida: true, error: 'OpenAI respondió 400: Invalid value for input[0]', modelo: 'gpt-6-luna',
      tokensEntrada: 5_000, tokensSalida: 0, costoUsd: 0.0005, leidoEn: '2026-10-09T15:00:00.000Z',
    })!;
    expect(reducida.fallida).toBe(true);
    expect(reducida.costoUsd).toBe(0.0005);
    expect('error' in reducida).toBe(false);
  });

  it('no muta la lectura original', () => {
    const original = { ...LECTURA_COMPLETA };
    minimizarLectura(original);
    expect(original).toEqual(LECTURA_COMPLETA);
    expect('purgada' in original).toBe(false);
  });
});
