import {
  Ambiente, ModoAutenticacion, VariablesEntorno, validarEntorno,
} from '../src/infrastructure/config/configuracion';

/**
 * Un ambiente mal configurado debe fallar al arrancar, no en la primera
 * petición. Aquí se fija lo que la validación de entorno acepta y rechaza
 * para la lectura documental con OpenAI: modelo con tarifa, esfuerzo
 * conocido, URL base cifrada (salvo hacia la propia máquina) y llave presente.
 */

/** Lo mínimo que exige la validación: secreto de firma y conexión a la base. */
const BASE: Record<string, unknown> = {
  JWT_SECRETO: 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres',
  DB_HOST: 'localhost',
  DB_USER: 'sipra',
  DB_PASSWORD: 'sipra',
  DB_NAME: 'sipra',
};

const OPENAI: Record<string, unknown> = { ...BASE, IA_DRIVER: 'openai', OPENAI_API_KEY: 'sk-prueba' };

function entorno(extra: Record<string, unknown> = {}, base: Record<string, unknown> = BASE): VariablesEntorno {
  return validarEntorno({ ...base, ...extra });
}

describe('validarEntorno · entorno mínimo', () => {
  it('arranca con los valores de fábrica', () => {
    const config = entorno();
    expect(config.SIPRA_AMBIENTE).toBe(Ambiente.DEV);
    expect(config.AUTH_MODO).toBe(ModoAutenticacion.ABIERTO);
    expect(config.IA_DRIVER).toBe('simulado');
    expect(config.OPENAI_MODELO).toBe('gpt-6-luna');
    expect(config.OPENAI_ESFUERZO).toBe('low');
    expect(config.OPENAI_URL_BASE).toBe('https://api.openai.com/v1');
    expect(config.IA_TOPE_DIARIO_USD).toBe(50);
  });

  it('convierte los enteros que llegan como texto y rechaza los que no son números', () => {
    expect(entorno({ IA_TOPE_DIARIO_USD: '75' }).IA_TOPE_DIARIO_USD).toBe(75);
    expect(() => entorno({ IA_TOPE_DIARIO_USD: 'setenta' })).toThrow(/IA_TOPE_DIARIO_USD/);
  });

  it('sin secreto de firma suficiente no arranca', () => {
    expect(() => entorno({ JWT_SECRETO: 'corto' })).toThrow(/JWT_SECRETO/);
  });

  it('el ingreso abierto está prohibido en preproducción y producción', () => {
    expect(() => entorno({ SIPRA_AMBIENTE: 'prod' })).toThrow(/AUTH_MODO=abierto está prohibido/);
    expect(() => entorno({ SIPRA_AMBIENTE: 'pre' })).toThrow(/AUTH_MODO=abierto está prohibido/);
  });
});

describe('validarEntorno · lectura documental con OpenAI', () => {
  it('IA_DRIVER=openai exige la llave', () => {
    expect(() => entorno({ IA_DRIVER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('acepta el modelo predeterminado, un snapshot con fecha y latest', () => {
    expect(entorno({}, OPENAI).OPENAI_MODELO).toBe('gpt-6-luna');
    expect(entorno({ OPENAI_MODELO: 'gpt-6-luna-2026-09-22' }, OPENAI).OPENAI_MODELO).toBe('gpt-6-luna-2026-09-22');
    expect(entorno({ OPENAI_MODELO: 'gpt-6-luna-latest' }, OPENAI).OPENAI_MODELO).toBe('gpt-6-luna-latest');
    expect(entorno({ OPENAI_MODELO: 'gpt-4.1-mini' }, OPENAI).OPENAI_MODELO).toBe('gpt-4.1-mini');
  });

  it('rechaza un modelo que no está en la tabla de tarifas y lista los conocidos', () => {
    expect(() => entorno({ OPENAI_MODELO: 'gpt-6.2-luna' }, OPENAI)).toThrow(/no está en la tabla de tarifas/);
    expect(() => entorno({ OPENAI_MODELO: 'gpt-6.2-luna' }, OPENAI)).toThrow(/gpt-6-luna/);
    expect(() => entorno({ OPENAI_MODELO: 'gpt-5.5-pro' }, OPENAI)).toThrow(/no está en la tabla de tarifas/);
  });

  it('con el proveedor simulado un modelo desconocido no impide arrancar', () => {
    expect(entorno({ OPENAI_MODELO: 'gpt-6.2-luna' }).OPENAI_MODELO).toBe('gpt-6.2-luna');
  });

  it('rechaza un modelo vacío', () => {
    expect(() => entorno({ OPENAI_MODELO: '' }, OPENAI)).toThrow(/OPENAI_MODELO/);
    expect(() => entorno({ OPENAI_MODELO: '' })).toThrow(/OPENAI_MODELO/);
  });

  it('acepta todos los esfuerzos de la API, incluido xhigh, y rechaza uno inventado', () => {
    for (const esfuerzo of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(entorno({ OPENAI_ESFUERZO: esfuerzo }, OPENAI).OPENAI_ESFUERZO).toBe(esfuerzo);
    }
    expect(() => entorno({ OPENAI_ESFUERZO: 'ultra' }, OPENAI)).toThrow(/OPENAI_ESFUERZO/);
  });

  it('la URL base debe ser https, salvo hacia la propia máquina', () => {
    expect(entorno({ OPENAI_URL_BASE: 'http://127.0.0.1:4555/v1' }, OPENAI).OPENAI_URL_BASE).toBe('http://127.0.0.1:4555/v1');
    expect(entorno({ OPENAI_URL_BASE: 'http://localhost:4555/v1' }, OPENAI).OPENAI_URL_BASE).toBe('http://localhost:4555/v1');
    expect(entorno({ OPENAI_URL_BASE: 'http://localhost' }, OPENAI).OPENAI_URL_BASE).toBe('http://localhost');
    expect(entorno({ OPENAI_URL_BASE: 'https://pasarela.cun.edu.co/openai/v1' }, OPENAI).OPENAI_URL_BASE)
      .toBe('https://pasarela.cun.edu.co/openai/v1');

    expect(() => entorno({ OPENAI_URL_BASE: 'http://ejemplo.com/v1' }, OPENAI)).toThrow(/OPENAI_URL_BASE debe ser una URL https/);
    // Un dominio que empieza por «localhost» no es la propia máquina.
    expect(() => entorno({ OPENAI_URL_BASE: 'http://localhost.ejemplo.com/v1' }, OPENAI)).toThrow(/https/);
    expect(() => entorno({ OPENAI_URL_BASE: 'http://127.0.0.1.ejemplo.com/v1' }, OPENAI)).toThrow(/https/);
    expect(() => entorno({ OPENAI_URL_BASE: 'ftp://api.openai.com/v1' }, OPENAI)).toThrow(/https/);
  });

  it('la regla de la URL solo aplica cuando el proveedor es OpenAI', () => {
    expect(entorno({ OPENAI_URL_BASE: 'http://ejemplo.com/v1' }).OPENAI_URL_BASE).toBe('http://ejemplo.com/v1');
  });

  it('los límites de tiempo y de salida tienen rango', () => {
    expect(() => entorno({ OPENAI_TIEMPO_MAXIMO_MS: '1000' }, OPENAI)).toThrow(/OPENAI_TIEMPO_MAXIMO_MS/);
    expect(() => entorno({ OPENAI_MAX_TOKENS_SALIDA: '100' }, OPENAI)).toThrow(/OPENAI_MAX_TOKENS_SALIDA/);
    expect(entorno({ OPENAI_TIEMPO_MAXIMO_MS: '60000', OPENAI_MAX_TOKENS_SALIDA: '8000' }, OPENAI))
      .toMatchObject({ OPENAI_TIEMPO_MAXIMO_MS: 60_000, OPENAI_MAX_TOKENS_SALIDA: 8_000 });
  });
});
