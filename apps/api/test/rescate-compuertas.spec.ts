import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { LECTURA_RESCATE_IA, LecturaRescateIaPort } from '../src/domain/ports/out/servicios-externos.port';
import { evaluarDestinoRescate } from '../src/domain/services/destino-rescate-ia';
import {
  INTERRUPTORES_RESCATE_POR_DEFECTO, InterruptoresRescateIa, RescateIaNoAutorizadoError, autorizarRescateIa, decidirRescateIa,
} from '../src/domain/services/politica-rescate-ia';
import { permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import { SuficienciaLectura } from '../src/domain/services/suficiencia-lectura';
import { LecturaRescateIaSeguraAdapter } from '../src/infrastructure/adapters/ia/lectura-rescate-ia-segura.adapter';
import { ExtraccionOpenAiAdapter } from '../src/infrastructure/adapters/ia/openai.adapter';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';

/**
 * Defensa en profundidad de la IA de rescate (subfase 1.5): la segunda compuerta (proveedor protegido) y la política
 * de destino. Todo contra un `fetch` simulado; ningún byte sale a la red.
 */

type Fetch = typeof fetch;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1');
const LLAVE = 'sk-ficticia-rescate-0123456789';
const TODO: InterruptoresRescateIa = { habilitado: true, eps: true, rut: true, camara: true, acta: true };

function configDe(valores: Record<string, unknown>): ConfigService {
  return { get: (k: string) => valores[k] } as unknown as ConfigService;
}

function valoresDe(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    SIPRA_AMBIENTE: 'dev', OPENAI_API_KEY: LLAVE, OPENAI_MODELO: 'gpt-6-luna', OPENAI_URL_BASE: 'https://api.openai.com/v1',
    IA_RESCATE_HABILITADO: 'true', IA_RESCATE_EPS: 'true', IA_RESCATE_RUT: 'true', IA_RESCATE_CAMARA: 'true', IA_RESCATE_ACTA: 'true',
    ...extra,
  };
}

function protegido(extra: Record<string, unknown> = {}) {
  const config = configDe(valoresDe(extra));
  const openai = new ExtraccionOpenAiAdapter(config, new DecodificadorImagenAdapter());
  return { proveedor: new LecturaRescateIaSeguraAdapter(config, openai), openai };
}

const solicitud = (tipo: TipoDocumento, campos: string[]) => ({ contenido: PDF, mime: 'application/pdf', tipo, camposSolicitados: campos });

const fetchOriginal: Fetch = global.fetch;
let fetchSimulado: jest.Mock<ReturnType<Fetch>, Parameters<Fetch>>;

function respuestaOk(): Response {
  return new Response(JSON.stringify({
    status: 'completed', model: 'gpt-6-luna',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ regimen: { valor: null, confianza: 0, evidencia: null } }) }] }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchSimulado = jest.fn<ReturnType<Fetch>, Parameters<Fetch>>().mockImplementation(() => Promise.resolve(respuestaOk()));
  global.fetch = fetchSimulado;
});
afterEach(() => { global.fetch = fetchOriginal; jest.restoreAllMocks(); });

/** La URL de una llamada a `fetch`, venga como cadena, `URL` o `Request`. */
function urlDe(entrada: Parameters<Fetch>[0]): string {
  if (typeof entrada === 'string') return entrada;
  return entrada instanceof URL ? entrada.href : entrada.url;
}

async function rechazo(promesa: Promise<unknown>): Promise<RescateIaNoAutorizadoError> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof RescateIaNoAutorizadoError) return e;
    throw e;
  }
  throw new Error('Se esperaba un rechazo de la compuerta');
}

describe('Política de destino del rescate (dominio)', () => {
  it('5. api.openai.com por https → permitido (con ruta, sin puerto)', () => {
    for (const url of ['https://api.openai.com/v1', 'https://api.openai.com', 'https://API.OPENAI.COM/v1/', 'https://api.openai.com/v1?x=1']) {
      expect(evaluarDestinoRescate(url, 'prod')).toEqual({ permitido: true, motivo: null });
    }
  });

  it('6. localhost, 127.0.0.1 y [::1] → permitidos solo con ambiente dev', () => {
    for (const url of ['http://localhost:4555/v1', 'http://127.0.0.1:4555/v1', 'http://[::1]:4555/v1', 'http://localhost/v1']) {
      expect(evaluarDestinoRescate(url, 'dev')).toEqual({ permitido: true, motivo: null });
      for (const ambiente of ['qa', 'pre', 'prod', undefined, null, 'DEV']) {
        expect(evaluarDestinoRescate(url, ambiente)).toEqual({ permitido: false, motivo: 'local_solo_en_dev' });
      }
    }
  });

  it('4. cualquier otro host https se rechaza, incluidos los trucos de URL', () => {
    const casos: [string, string][] = [
      ['https://otro-host.example/v1', 'host_no_permitido'],
      ['https://api.openai.com.evil.com/v1', 'host_no_permitido'],
      ['https://evil.com/api.openai.com', 'host_no_permitido'],
      ['https://api.openai.com@evil.com/v1', 'credenciales_en_url'],
      ['https://usuario:clave@api.openai.com/v1', 'credenciales_en_url'],
      ['https://api.openai.com.:443/v1', 'host_no_permitido'],
      ['https://api.openai.com:8443/v1', 'puerto_no_permitido'],
      ['http://api.openai.com/v1', 'protocolo_no_permitido'],
      ['ftp://api.openai.com/v1', 'protocolo_no_permitido'],
      ['https://localhost.evil.com/v1', 'host_no_permitido'],
      ['http://127.0.0.1.evil.com/v1', 'host_no_permitido'],
      ['no es una url', 'url_invalida'],
      ['', 'url_invalida'],
    ];
    for (const [url, motivo] of casos) expect(evaluarDestinoRescate(url, 'dev')).toEqual({ permitido: false, motivo });
    expect(evaluarDestinoRescate(undefined, 'dev').motivo).toBe('url_invalida');
  });

  it('el resultado nunca contiene la URL (puede traer credenciales)', () => {
    expect(JSON.stringify(evaluarDestinoRescate('https://usuario:clave-secreta@evil.com/v1', 'dev'))).not.toContain('clave-secreta');
  });
});

describe('Autorización del rescate (compuerta de configuración, dominio)', () => {
  const SENSIBLES: [TipoDocumento, keyof InterruptoresRescateIa][] = [
    [TipoDocumento.CERTIFICADO_EPS, 'eps'], [TipoDocumento.ACTA_INICIO, 'acta'], [TipoDocumento.RUT_NATURAL, 'rut'],
    [TipoDocumento.RUT_JURIDICO, 'rut'], [TipoDocumento.CAMARA_COMERCIO, 'camara'],
  ];

  it('sensibles: solo con general + interruptor del tipo + ambiente dev EXACTO', () => {
    for (const [tipo, clave] of SENSIBLES) {
      expect(autorizarRescateIa(tipo, TODO, 'dev')).toEqual({ autorizado: true, motivo: null });
      expect(autorizarRescateIa(tipo, { ...TODO, habilitado: false }, 'dev').motivo).toBe('rescate_deshabilitado');
      expect(autorizarRescateIa(tipo, { ...TODO, [clave]: false }, 'dev').motivo).toBe('tipo_sensible_no_autorizado');
      for (const ambiente of ['qa', 'pre', 'prod', undefined, null, '', 'DEV', 'desarrollo']) {
        expect(autorizarRescateIa(tipo, TODO, ambiente)).toEqual({ autorizado: false, motivo: 'ambiente_no_permitido' });
      }
    }
  });

  it('un interruptor que no es `true` estricto no autoriza', () => {
    const raro = { ...TODO, eps: 'true' } as unknown as InterruptoresRescateIa;
    expect(autorizarRescateIa(TipoDocumento.CERTIFICADO_EPS, raro, 'dev').autorizado).toBe(false);
    expect(autorizarRescateIa(TipoDocumento.CERTIFICADO_EPS, INTERRUPTORES_RESCATE_POR_DEFECTO, 'dev').autorizado).toBe(false);
  });

  it('decidirRescateIa conserva su contrato de 1.1 (no conoce el ambiente)', () => {
    const insuficiente: SuficienciaLectura = { estado: 'insuficiente', suficiente: false, faltantes: [{ campo: 'regimen', motivo: 'nulo' }] };
    expect(decidirRescateIa(TipoDocumento.CERTIFICADO_EPS, TODO, insuficiente)).toMatchObject({ permitido: true, camposSolicitados: ['regimen'] });
    expect(decidirRescateIa(TipoDocumento.CERTIFICADO_EPS, { ...TODO, eps: false }, insuficiente).motivo).toBe('tipo_sensible_no_autorizado');
  });

  it('los cinco tipos sensibles siguen sin autoaprobación del pipeline', () => {
    for (const [tipo] of SENSIBLES) expect(permiteAutoAprobacionDelPipeline(tipo)).toBe(false);
  });
});

describe('Proveedor protegido (segunda compuerta)', () => {
  const EPS = TipoDocumento.CERTIFICADO_EPS;

  it('3. un tipo sensible fuera de dev se rechaza aunque se llame directamente y los flags estén encendidos; no sale un byte', async () => {
    for (const ambiente of ['qa', 'pre', 'prod', undefined]) {
      const { proveedor } = protegido({ SIPRA_AMBIENTE: ambiente });
      const e = await rechazo(proveedor.rescatar(solicitud(EPS, ['regimen'])));
      expect(e.motivo).toBe('ambiente_no_permitido');
    }
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('el general apagado y el interruptor del tipo apagado se rechazan sin salir', async () => {
    expect((await rechazo(protegido({ IA_RESCATE_HABILITADO: 'false' }).proveedor.rescatar(solicitud(EPS, ['regimen'])))).motivo)
      .toBe('rescate_deshabilitado');
    expect((await rechazo(protegido({ IA_RESCATE_EPS: 'false' }).proveedor.rescatar(solicitud(EPS, ['regimen'])))).motivo)
      .toBe('tipo_sensible_no_autorizado');
    expect((await rechazo(protegido({ IA_RESCATE_HABILITADO: undefined, IA_RESCATE_EPS: undefined }).proveedor.rescatar(solicitud(EPS, ['regimen'])))).motivo)
      .toBe('rescate_deshabilitado');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('campos vacíos o inválidos se rechazan antes de cualquier comprobación de red', async () => {
    const { proveedor } = protegido();
    expect((await rechazo(proveedor.rescatar(solicitud(EPS, [])))).motivo).toBe('sin_campos');
    expect((await rechazo(proveedor.rescatar(solicitud(EPS, ['nit', 'inventado'])))).motivo).toBe('sin_campos');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('4. un host https no autorizado se rechaza ANTES de enviar bytes (el extractor principal no cambia)', async () => {
    for (const url of ['https://otro-host.example/v1', 'https://api.openai.com@evil.com/v1', 'https://api.openai.com.evil.com/v1']) {
      const { proveedor, openai } = protegido({ OPENAI_URL_BASE: url });
      expect((await rechazo(proveedor.rescatar(solicitud(EPS, ['regimen'])))).motivo).toBe('destino_no_permitido');
      // Se valida lo que el adaptador usa de verdad.
      expect(openai.urlBaseConfigurada).toBe(url);
    }
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('un rechazo por destino no filtra la URL (ni sus credenciales) al error ni al log', async () => {
    const lineas: string[] = [];
    const { Logger } = await import('@nestjs/common');
    for (const m of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => { lineas.push(a.map(String).join(' ')); });
    const { proveedor } = protegido({ OPENAI_URL_BASE: 'https://usuario:clave-secreta@evil.com/v1' });
    const e = await rechazo(proveedor.rescatar(solicitud(EPS, ['regimen'])));
    for (const texto of [e.message, lineas.join('\n')]) {
      expect(texto).not.toContain('clave-secreta');
      expect(texto).not.toContain('evil.com');
    }
    expect(lineas.join('\n')).toContain('credenciales_en_url');
  });

  it('5. api.openai.com → permitido: delega y envía a /responses', async () => {
    const { proveedor } = protegido();
    const r = await proveedor.rescatar(solicitud(EPS, ['regimen']));
    expect(r.invocado).toBe(true);
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(urlDe(fetchSimulado.mock.calls[0][0])).toBe('https://api.openai.com/v1/responses');
  });

  it('6. localhost en dev → permitido; en otro ambiente no (para un tipo no sensible tampoco)', async () => {
    const { proveedor } = protegido({ OPENAI_URL_BASE: 'http://localhost:4555/v1' });
    await expect(proveedor.rescatar(solicitud(EPS, ['regimen']))).resolves.toMatchObject({ invocado: true });
    expect(urlDe(fetchSimulado.mock.calls[0][0])).toBe('http://localhost:4555/v1/responses');

    fetchSimulado.mockClear();
    const noSensible = protegido({ OPENAI_URL_BASE: 'http://127.0.0.1:4555/v1', SIPRA_AMBIENTE: 'qa' });
    expect((await rechazo(noSensible.proveedor.rescatar(solicitud(TipoDocumento.CEDULA, ['nombres'])))).motivo).toBe('destino_no_permitido');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('un tipo no sensible con el general encendido no necesita interruptor propio (la política de 1.1)', async () => {
    const { proveedor } = protegido({ IA_RESCATE_EPS: 'false', IA_RESCATE_RUT: 'false', IA_RESCATE_CAMARA: 'false', IA_RESCATE_ACTA: 'false' });
    await expect(proveedor.rescatar(solicitud(TipoDocumento.CEDULA, ['nombres']))).resolves.toMatchObject({ invocado: true });
  });

  it('34. delega en la MISMA instancia de ExtraccionOpenAiAdapter (único cliente HTTP), y 33: el token apunta al protegido', async () => {
    const config = configDe(valoresDe());
    const modulo = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config },
        DecodificadorImagenAdapter,
        ExtraccionOpenAiAdapter,
        { provide: LECTURA_RESCATE_IA, useClass: LecturaRescateIaSeguraAdapter },
      ],
    }).compile();
    const rescate = modulo.get<LecturaRescateIaPort>(LECTURA_RESCATE_IA);
    expect(rescate).toBeInstanceOf(LecturaRescateIaSeguraAdapter);
    expect(rescate).not.toBeInstanceOf(ExtraccionOpenAiAdapter);
    expect((rescate as unknown as { openai: unknown }).openai).toBe(modulo.get(ExtraccionOpenAiAdapter));
  });
});

describe('Estructura: nadie salvo el proveedor protegido y el pipeline invoca el rescate', () => {
  const RAIZ = join(__dirname, '..', 'src');
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const ruta = join(dir, n);
      return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith('.ts') ? [ruta] : [];
    });
  }
  const todos = archivos(RAIZ).map((ruta) => ({ ruta: ruta.slice(RAIZ.length + 1).replace(/\\/g, '/'), texto: readFileSync(ruta, 'utf8') }));

  it('`.rescatar(` solo aparece en el pipeline (vía el puerto) y en el proveedor protegido', () => {
    const llamadas = todos.filter((f) => /\.rescatar\(/.test(f.texto)).map((f) => f.ruta).sort();
    expect(llamadas).toEqual([
      'application/use-cases/documentos/pipeline-validacion.use-case.ts',
      'infrastructure/adapters/ia/lectura-rescate-ia-segura.adapter.ts',
    ]);
  });

  it('la capa de aplicación nunca inyecta el adaptador de OpenAI: solo el token del puerto', () => {
    for (const f of todos.filter((x) => x.ruta.startsWith('application/') && !x.ruta.endsWith('.spec.ts'))) {
      expect(f.texto).not.toMatch(/ExtraccionOpenAiAdapter/);
    }
    const pipeline = todos.find((f) => f.ruta.endsWith('pipeline-validacion.use-case.ts'));
    expect(pipeline?.texto).toMatch(/@Inject\(LECTURA_RESCATE_IA\)/);
  });

  it('el dominio no importa nada de infraestructura en los módulos del rescate', () => {
    for (const nombre of ['politica-rescate-ia', 'destino-rescate-ia', 'resultado-rescate-ia', 'fusion-lecturas', 'suficiencia-lectura']) {
      const f = todos.find((x) => x.ruta === `domain/services/${nombre}.ts`);
      expect(f?.texto).not.toMatch(/@nestjs|typeorm|fastify|infrastructure\//);
    }
  });
});
