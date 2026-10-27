import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { exigirInterruptorEps, interruptorEps } from '../src/application/services/interruptores-eps';
import { INTERRUPTORES_EPS, interruptorActivo } from '../src/domain/services/interruptores-eps';
import { VariablesEntorno, validarEntorno } from '../src/infrastructure/config/configuracion';

/**
 * Interruptores de incidente del flujo EPS y políticas institucionales pendientes
 * (frescura de ADRES, retención). Apagar una pieza no debe borrar nada ni exigir un despliegue.
 */

const BASE: Record<string, unknown> = {
  SIPRA_AMBIENTE: 'dev', AUTH_MODO: 'abierto', AUTH_ABIERTO_CONFIRMADO: 'true', NODE_ENV: 'development',
  DB_HOST: '127.0.0.1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n',
  JWT_SECRETO: 'secreto-de-prueba-de-al-menos-32-caracteres',
};
const entorno = (extra: Record<string, unknown> = {}): VariablesEntorno => validarEntorno({ ...BASE, ...extra });
const config = (valores: Record<string, unknown>): ConfigService => ({ get: (k: string) => valores[k] }) as unknown as ConfigService;

describe('Interruptores EPS · lectura', () => {
  it('por defecto: validación, ADRES y OCR encendidos; la verificación externa APAGADA', () => {
    expect(interruptorEps(undefined, INTERRUPTORES_EPS.validacion)).toBe(true);
    expect(interruptorEps(undefined, INTERRUPTORES_EPS.adres)).toBe(true);
    expect(interruptorEps(undefined, INTERRUPTORES_EPS.ocr)).toBe(true);
    expect(interruptorEps(undefined, INTERRUPTORES_EPS.verificacion)).toBe(false);
  });

  it.each([['false', false], [false, false], ['FALSE', false], ['true', true], [true, true], ['', true]])(
    'valor %p → %p para un interruptor con encendido por defecto',
    (v, esperado) => { expect(interruptorActivo(v, INTERRUPTORES_EPS.validacion)).toBe(esperado); },
  );

  it('se lee en cada uso (no se cachea): apagar a mitad de camino surte efecto', () => {
    const valores: Record<string, unknown> = { [INTERRUPTORES_EPS.adres]: true };
    const c = config(valores);
    expect(interruptorEps(c, INTERRUPTORES_EPS.adres)).toBe(true);
    valores[INTERRUPTORES_EPS.adres] = 'false';
    expect(interruptorEps(c, INTERRUPTORES_EPS.adres)).toBe(false);
  });

  it('apagado responde 503 con un mensaje claro; encendido no hace nada', () => {
    const apagado = config({ [INTERRUPTORES_EPS.validacion]: 'false' });
    expect(() => exigirInterruptorEps(apagado, INTERRUPTORES_EPS.validacion, 'suspendida')).toThrow(ServiceUnavailableException);
    expect(() => exigirInterruptorEps(config({}), INTERRUPTORES_EPS.validacion, 'suspendida')).not.toThrow();
  });
});

describe('Configuración EPS · validación del arranque', () => {
  it('trae los valores seguros de fábrica', () => {
    const c = entorno();
    expect(c).toMatchObject({
      EPS_VALIDACION_HABILITADA: true, ADRES_ASISTIDO_HABILITADO: true, EPS_OCR_HABILITADO: true,
      VERIFICACION_EPS_HABILITADA: false, EPS_AUTOAPROBACION_HABILITADA: false,
    });
    expect(c.ADRES_FRESCURA_DIAS).toBeUndefined(); // FRESCURA ADRES PENDIENTE DE DEFINICIÓN DEL PROCESO
    expect(c.EPS_RETENCION_DIAS).toBeUndefined(); // RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL
  });

  it.each(['dev', 'qa', 'pre', 'prod'])('la autoaprobación en true impide el arranque en %s', (ambiente) => {
    const extra: Record<string, unknown> = { SIPRA_AMBIENTE: ambiente, EPS_AUTOAPROBACION_HABILITADA: 'true' };
    if (ambiente !== 'dev') Object.assign(extra, { AUTH_MODO: 'oidc', METRICAS_TOKEN: 'x'.repeat(40), COLA_DRIVER: 'cloud_tasks' });
    expect(() => entorno(extra)).toThrow(/EPS_AUTOAPROBACION_HABILITADA=true no está permitido/);
  });

  it('variables de política declaradas VACÍAS equivalen a «pendiente» (no rompen el arranque)', () => {
    const c = entorno({ ADRES_FRESCURA_DIAS: '', EPS_RETENCION_DIAS: '' });
    expect(c.ADRES_FRESCURA_DIAS).toBeUndefined();
    expect(c.EPS_RETENCION_DIAS).toBeUndefined();
  });

  it('acepta valores explícitos y los convierte a número', () => {
    const c = entorno({ ADRES_FRESCURA_DIAS: '30', EPS_RETENCION_DIAS: '365' });
    expect(c.ADRES_FRESCURA_DIAS).toBe(30);
    expect(c.EPS_RETENCION_DIAS).toBe(365);
  });

  it.each([['ADRES_FRESCURA_DIAS', '0'], ['ADRES_FRESCURA_DIAS', '-5'], ['ADRES_FRESCURA_DIAS', 'abc'], ['EPS_RETENCION_DIAS', '0'], ['EPS_RETENCION_DIAS', '1.5']])(
    '%s=%s es inválido', (clave, valor) => { expect(() => entorno({ [clave]: valor })).toThrow(/Configuración de entorno inválida/); },
  );

  it('los interruptores se pueden apagar con «false» sin desplegar código', () => {
    const c = entorno({ EPS_VALIDACION_HABILITADA: 'false', ADRES_ASISTIDO_HABILITADO: 'false', EPS_OCR_HABILITADO: 'false' });
    expect(c).toMatchObject({ EPS_VALIDACION_HABILITADA: false, ADRES_ASISTIDO_HABILITADO: false, EPS_OCR_HABILITADO: false });
  });
});
