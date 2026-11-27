import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { interruptoresRescateIa } from '../src/application/services/interruptores-rescate-ia';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModoProcesamiento, modoProcesamientoDe, permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import { VariablesEntorno, validarEntorno } from '../src/infrastructure/config/configuracion';

/**
 * Configuración fail-closed de la IA de rescate (subfase 1.4). Se prueba el comportamiento de `validarEntorno`
 * (lo que decide si el proceso arranca), no el texto exacto de los mensajes. Fixtures 100 % sintéticos; la llave
 * es ficticia y ninguna prueba sale a la red.
 */

const BASE: Record<string, unknown> = {
  SIPRA_AMBIENTE: 'dev',
  AUTH_MODO: 'abierto',
  AUTH_ABIERTO_CONFIRMADO: 'true',
  JWT_SECRETO: 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres',
  DB_HOST: 'localhost',
  DB_USER: 'sipra',
  DB_PASSWORD: 'sipra',
  DB_NAME: 'sipra',
};
const LLAVE = 'sk-ficticia-solo-para-pruebas-123456';
const RESCATE_OK = { IA_RESCATE_HABILITADO: 'true', OPENAI_API_KEY: LLAVE };
const OIDC = {
  AUTH_MODO: 'oidc', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 's', OIDC_REDIRECT_URI: 'http://localhost:4200/ingreso/callback',
};
const SENSIBLES = ['IA_RESCATE_EPS', 'IA_RESCATE_RUT', 'IA_RESCATE_CAMARA', 'IA_RESCATE_ACTA'] as const;

function entorno(extra: Record<string, unknown> = {}): VariablesEntorno {
  return validarEntorno({ ...BASE, ...extra });
}

/** Un ConfigService cuyo `get` devuelve lo que `validarEntorno` normalizó (no valores ya mascados a mano). */
function configDe(extra: Record<string, unknown>): ConfigService {
  const config = entorno(extra);
  return { get: (clave: string) => (config as unknown as Record<string, unknown>)[clave] } as unknown as ConfigService;
}

describe('IA de rescate · valores por defecto y normalización', () => {
  it('1. todos los flags ausentes → todos false', () => {
    const c = entorno();
    expect([c.IA_RESCATE_HABILITADO, c.IA_RESCATE_EPS, c.IA_RESCATE_RUT, c.IA_RESCATE_CAMARA, c.IA_RESCATE_ACTA])
      .toEqual([false, false, false, false, false]);
  });

  it('2. «true» y «false» se normalizan con el mecanismo BOOLEANOS (también «TRUE»); lo demás es false', () => {
    const c = entorno({ ...RESCATE_OK, IA_RESCATE_EPS: 'TRUE', IA_RESCATE_RUT: 'false' });
    expect([c.IA_RESCATE_HABILITADO, c.IA_RESCATE_EPS, c.IA_RESCATE_RUT]).toEqual([true, true, false]);
    for (const raro of ['1', 'yes', 'si', 'ture', 'on']) {
      expect(entorno({ IA_RESCATE_ACTA: raro }).IA_RESCATE_ACTA).toBe(false);
    }
  });

  it('un flag declarado vacío equivale a no declararlo (false)', () => {
    expect(entorno({ IA_RESCATE_HABILITADO: '' }).IA_RESCATE_HABILITADO).toBe(false);
  });
});

describe('IA de rescate · general apagado', () => {
  it('3. general apagado + todos los específicos apagados → válido', () => {
    expect(() => entorno({ IA_RESCATE_HABILITADO: 'false' })).not.toThrow();
  });

  it.each([
    ['4. EPS', 'IA_RESCATE_EPS'], ['5. RUT', 'IA_RESCATE_RUT'], ['6. Cámara', 'IA_RESCATE_CAMARA'], ['7. Acta', 'IA_RESCATE_ACTA'],
  ])('%s encendido con el general apagado → el arranque falla', (_n, flag) => {
    expect(() => entorno({ [flag]: 'true' })).toThrow(new RegExp(`${flag}.*IA_RESCATE_HABILITADO`));
    expect(() => entorno({ [flag]: 'true', IA_RESCATE_HABILITADO: 'false' })).toThrow(/IA_RESCATE_HABILITADO/);
  });
});

describe('IA de rescate · el general exige OpenAI, con independencia de IA_DRIVER', () => {
  it('8. sin OPENAI_API_KEY → falla aunque IA_DRIVER=simulado (y con llave de solo espacios)', () => {
    expect(() => entorno({ IA_DRIVER: 'simulado', IA_RESCATE_HABILITADO: 'true' })).toThrow(/OPENAI_API_KEY/);
    expect(() => entorno({ IA_RESCATE_HABILITADO: 'true', OPENAI_API_KEY: '   ' })).toThrow(/OPENAI_API_KEY/);
  });

  it('9. modelo sin tarifa → falla aunque IA_DRIVER=simulado', () => {
    expect(() => entorno({ ...RESCATE_OK, OPENAI_MODELO: 'gpt-modelo-sin-tarifa' })).toThrow(/no está en la tabla de tarifas/);
  });

  it('10. URL insegura → falla aunque IA_DRIVER=simulado; localhost y https valen', () => {
    expect(() => entorno({ ...RESCATE_OK, OPENAI_URL_BASE: 'http://ejemplo.com/v1' })).toThrow(/OPENAI_URL_BASE/);
    expect(() => entorno({ ...RESCATE_OK, OPENAI_URL_BASE: 'http://localhost.ejemplo.com/v1' })).toThrow(/OPENAI_URL_BASE/);
    expect(() => entorno({ ...RESCATE_OK, OPENAI_URL_BASE: 'http://localhost:4555/v1' })).not.toThrow();
    expect(() => entorno({ ...RESCATE_OK, OPENAI_URL_BASE: 'https://pasarela.cun.edu.co/openai/v1' })).not.toThrow();
  });

  it('con el general apagado esas tres exigencias no aplican (el driver simulado arranca sin llave)', () => {
    expect(() => entorno({ IA_DRIVER: 'simulado', OPENAI_MODELO: 'gpt-modelo-sin-tarifa', OPENAI_URL_BASE: 'http://ejemplo.com' }))
      .not.toThrow();
  });

  it('19. IA_DRIVER=simulado + rescate activo + OpenAI válido → válido en dev', () => {
    const c = entorno({ IA_DRIVER: 'simulado', ...RESCATE_OK });
    expect(c.IA_DRIVER).toBe('simulado');
    expect(c.IA_RESCATE_HABILITADO).toBe(true);
  });

  it('20. IA_DRIVER=anthropic + rescate activo + OpenAI válido → no obliga a cambiar el driver; respeta sus exigencias', () => {
    expect(() => entorno({ IA_DRIVER: 'anthropic', ANTHROPIC_API_KEY: 'clave-ficticia-anthropic', ...RESCATE_OK })).not.toThrow();
    expect(entorno({ IA_DRIVER: 'anthropic', ANTHROPIC_API_KEY: 'clave-ficticia-anthropic', ...RESCATE_OK }).IA_DRIVER).toBe('anthropic');
    // Sus propias exigencias siguen vigentes.
    expect(() => entorno({ IA_DRIVER: 'anthropic', ...RESCATE_OK })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('con IA_DRIVER=openai y rescate activo el error no se duplica y el comportamiento previo se conserva', () => {
    expect(() => entorno({ IA_DRIVER: 'openai' })).toThrow(/IA_DRIVER=openai exige OPENAI_API_KEY/);
    let mensaje = '';
    try {
      entorno({ IA_DRIVER: 'openai', IA_RESCATE_HABILITADO: 'true', OPENAI_URL_BASE: 'http://ejemplo.com' });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje.match(/OPENAI_API_KEY/g)).toHaveLength(1);
    expect(mensaje.match(/OPENAI_URL_BASE debe ser/g)).toHaveLength(1);
  });
});

describe('IA de rescate · tipos sensibles solo en dev', () => {
  it.each([
    ['12. EPS', 'IA_RESCATE_EPS'], ['13. RUT', 'IA_RESCATE_RUT'], ['14. Cámara', 'IA_RESCATE_CAMARA'], ['15. Acta', 'IA_RESCATE_ACTA'],
  ])('%s: dev + general + llave + modelo + URL válidos → válido técnicamente', (_n, flag) => {
    const c = entorno({ ...RESCATE_OK, [flag]: 'true' });
    expect((c as unknown as Record<string, unknown>)[flag]).toBe(true);
  });

  it('11. dev + general + llave + modelo conocido + URL válida → válido', () => {
    expect(() => entorno({ ...RESCATE_OK, OPENAI_MODELO: 'gpt-6-luna', OPENAI_URL_BASE: 'https://api.openai.com/v1' })).not.toThrow();
  });

  const AMBIENTES: [string, string][] = [['16', 'qa'], ['17', 'pre'], ['18', 'prod']];
  describe.each(AMBIENTES)('%s. ambiente %s', (_n, ambiente) => {
    const cerrado = { ...OIDC, SIPRA_AMBIENTE: ambiente };

    it.each(SENSIBLES)('%s encendido (aun con general y OpenAI válidos) → el arranque falla por el ambiente', (flag) => {
      expect(() => entorno({ ...cerrado, ...RESCATE_OK, [flag]: 'true' })).toThrow(new RegExp(`${flag}.*"dev"`));
    });

    it('con el general encendido pero sin flags por tipo, la regla de sensibles no se activa', () => {
      let mensaje = '';
      try {
        entorno({ ...cerrado, ...RESCATE_OK });
      } catch (e) {
        mensaje = (e as Error).message;
      }
      expect(mensaje).not.toMatch(/IA_RESCATE_(EPS|RUT|CAMARA|ACTA)/);
    });
  });

  it('qa: control — sin ningún flag de rescate arranca; con uno sensible no', () => {
    const qa = { ...OIDC, SIPRA_AMBIENTE: 'qa', METRICAS_HABILITADAS: 'false' };
    expect(() => entorno(qa)).not.toThrow();
    expect(() => entorno({ ...qa, ...RESCATE_OK })).not.toThrow();
    expect(() => entorno({ ...qa, ...RESCATE_OK, IA_RESCATE_EPS: 'true' })).toThrow();
  });

  it('varias violaciones se informan juntas y nombran las variables, nunca sus valores', () => {
    let mensaje = '';
    try {
      entorno({ ...OIDC, SIPRA_AMBIENTE: 'prod', IA_RESCATE_EPS: 'true', IA_RESCATE_ACTA: 'true', OPENAI_API_KEY: LLAVE, OPENAI_URL_BASE: 'http://usuario:clave-secreta@ejemplo.com' });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toMatch(/IA_RESCATE_EPS, IA_RESCATE_ACTA/);
    expect(mensaje).not.toContain(LLAVE);
    expect(mensaje).not.toContain('clave-secreta');
  });

  it('el error de llave faltante no revela ninguna llave', () => {
    let mensaje = '';
    try {
      entorno({ IA_RESCATE_HABILITADO: 'true', OPENAI_API_KEY: '  ' });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toMatch(/OPENAI_API_KEY/);
    expect(mensaje).not.toMatch(/sk-/);
  });
});

describe('IA de rescate · helper de interruptores de la aplicación', () => {
  it('21. devuelve exactamente los booleanos configurados (alimentado con la salida real de validarEntorno)', () => {
    expect(interruptoresRescateIa(configDe({}))).toEqual({ habilitado: false, eps: false, rut: false, camara: false, acta: false });
    expect(interruptoresRescateIa(configDe({ ...RESCATE_OK, IA_RESCATE_EPS: 'true', IA_RESCATE_ACTA: 'TRUE' })))
      .toEqual({ habilitado: true, eps: true, rut: false, camara: false, acta: true });
    expect(interruptoresRescateIa(configDe({ ...RESCATE_OK, IA_RESCATE_RUT: 'true', IA_RESCATE_CAMARA: 'true' })))
      .toEqual({ habilitado: true, eps: false, rut: true, camara: true, acta: false });
  });

  it('fallo cerrado ante cualquier valor que no sea true / «true»; sin ConfigService, todo apagado', () => {
    const crudo = (valores: Record<string, unknown>) => ({ get: (k: string) => valores[k] }) as unknown as ConfigService;
    expect(interruptoresRescateIa(crudo({ IA_RESCATE_HABILITADO: 'true', IA_RESCATE_EPS: ' TRUE ' })))
      .toMatchObject({ habilitado: true, eps: true });
    expect(interruptoresRescateIa(crudo({
      IA_RESCATE_HABILITADO: 1, IA_RESCATE_EPS: 'yes', IA_RESCATE_RUT: 'false', IA_RESCATE_CAMARA: null, IA_RESCATE_ACTA: {},
    }))).toEqual({ habilitado: false, eps: false, rut: false, camara: false, acta: false });
    expect(interruptoresRescateIa(undefined)).toEqual({ habilitado: false, eps: false, rut: false, camara: false, acta: false });
  });
});

describe('IA de rescate · lo que no cambia', () => {
  const SENSIBLES_TIPO = [
    TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.RUT_NATURAL,
    TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO,
  ];

  it('22. los flags no alteran modoProcesamientoDe(): los cinco siguen locales', () => {
    // La configuración activa todo lo permitido en dev y aun así la política de procesamiento es la misma.
    entorno({ ...RESCATE_OK, IA_RESCATE_EPS: 'true', IA_RESCATE_RUT: 'true', IA_RESCATE_CAMARA: 'true', IA_RESCATE_ACTA: 'true' });
    for (const tipo of SENSIBLES_TIPO) expect(modoProcesamientoDe(tipo)).toBe(ModoProcesamiento.LOCAL);
    expect(modoProcesamientoDe(TipoDocumento.CEDULA)).toBe(ModoProcesamiento.CONFIGURADO);
  });

  it('23. los cinco tipos sensibles siguen sin autoaprobación del pipeline', () => {
    for (const tipo of SENSIBLES_TIPO) expect(permiteAutoAprobacionDelPipeline(tipo)).toBe(false);
  });

  it('24. (1.5) LECTURA_RESCATE_IA ya está registrado, y solo con el proveedor protegido (nunca el adaptador directo)', () => {
    const modulo = readFileSync(join(__dirname, '..', 'src', 'infrastructure', 'modules', 'app.module.ts'), 'utf8');
    expect(modulo).toMatch(/provide:\s*LECTURA_RESCATE_IA\s*,\s*useClass:\s*LecturaRescateIaSeguraAdapter/);
    expect(modulo).not.toMatch(/provide:\s*LECTURA_RESCATE_IA\s*,\s*(useClass|useExisting|useValue):\s*ExtraccionOpenAiAdapter/);
  });
});
