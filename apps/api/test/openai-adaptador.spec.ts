import { ConfigService } from '@nestjs/config';
import { CAMPOS_POR_TIPO, camposDe } from '../src/domain/entities/campos-extraccion';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { TARIFA_RESPALDO, costoDe } from '../src/domain/entities/tarifas-ia';
import {
  ConocimientoDocumentalDomainService,
} from '../src/domain/services/conocimiento-documental.domain-service';
import {
  ErrorProveedorIa, ExtraccionOpenAiAdapter, esquemaLectura,
} from '../src/infrastructure/adapters/ia/openai.adapter';
import {
  DecodificadorImagenAdapter,
} from '../src/infrastructure/adapters/imagen/decodificador.adapter';

/**
 * El adaptador de OpenAI se prueba contra un `fetch` simulado: lo que envía
 * (documento, instrucción, esquema estricto), cómo interpreta lo que recibe
 * (campos, criterios, costo) y cómo distingue un fallo transitorio de uno
 * definitivo. Ninguna prueba sale a la red.
 */

type Fetch = typeof fetch;

const decodificador = new DecodificadorImagenAdapter();
const conocimiento = new ConocimientoDocumentalDomainService();

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1');
const PNG = decodificador.codificarPng({ ancho: 16, alto: 8, pixeles: new Uint8Array(16 * 8).fill(200) });
const JPEG_FALSO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function configDe(valores: Record<string, string>): ConfigService {
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService;
}

function adaptadorDePrueba(extra: Record<string, string> = {}): ExtraccionOpenAiAdapter {
  return new ExtraccionOpenAiAdapter(
    configDe({ OPENAI_API_KEY: 'sk-prueba', OPENAI_MODELO: 'gpt-6-luna', OPENAI_ESFUERZO: 'low', ...extra }),
    decodificador,
  );
}

function respuestaHttp(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

const USO_TIPICO = {
  input_tokens: 10_000,
  output_tokens: 500,
  input_tokens_details: { cached_tokens: 2_000, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 200 },
};

/** Respuesta completa de la Responses API con la lectura dada como JSON. */
function respuestaModelo(lectura: unknown, extra: Record<string, unknown> = {}): Response {
  return respuestaHttp(200, {
    status: 'completed',
    model: 'gpt-6-luna-2026-09-22',
    output: [
      { type: 'reasoning' },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(lectura) }] },
    ],
    usage: USO_TIPICO,
    ...extra,
  });
}

const LECTURA_EPS = {
  tipo_detectado: 'factura',
  ilegible: false,
  motivo_ilegible: null,
  campos: [
    { nombre: 'entidad_emisora', valor: 'Nueva EPS', confianza: 1.7, evidencia: 'NUEVA EPS S.A.' },
    { nombre: 'nombre_afiliado', valor: '   ', confianza: 0.9, evidencia: null },
    { nombre: 'fecha_expedicion', valor: ' 2026-09-30 ', confianza: -2, evidencia: '' },
  ],
  criterios: [
    { codigo: 'CRIT_1', cumple: 'si', detalle: null },
    { codigo: 'NOACEPTA_3', cumple: 'no', detalle: 'Es una consulta del Sisbén' },
    { codigo: 'INVENTADO', cumple: 'no', detalle: null },
    { codigo: 'VIGENCIA', cumple: 'tal_vez', detalle: null },
  ],
  resumen: 'Certificado de afiliación de Nueva EPS',
};

const LECTURA_LIMPIA = {
  tipo_detectado: 'certificado_eps',
  ilegible: false,
  motivo_ilegible: null,
  campos: [],
  criterios: [],
  resumen: 'Lectura de prueba',
};

/** Forma del cuerpo que el adaptador envía; solo lo que las pruebas miran. */
interface ParteContenido {
  type: string;
  filename?: string;
  file_data?: string;
  image_url?: string;
  detail?: string;
  text?: string;
}

interface NodoEsquema {
  type?: string | string[];
  properties?: Record<string, NodoEsquema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: NodoEsquema;
  anyOf?: NodoEsquema[];
  enum?: string[];
}

interface CuerpoPeticion {
  model: string;
  instructions: string;
  input: { role: string; content: ParteContenido[] }[];
  text: { format: { type: string; name: string; strict: boolean; schema: NodoEsquema }; verbosity?: string };
  reasoning?: { effort: string };
  temperature?: number;
  max_output_tokens: number;
  store: boolean;
}

async function capturar(promesa: Promise<unknown>): Promise<ErrorProveedorIa> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorProveedorIa) return error;
    throw new Error(`Se esperaba ErrorProveedorIa y llegó ${(error as Error).name}: ${(error as Error).message}`);
  }
  throw new Error('La promesa resolvió y se esperaba un rechazo');
}

/** La URL de una llamada a `fetch`, venga como cadena, `URL` o `Request`. */
function urlDe(entrada: Parameters<Fetch>[0]): string {
  if (typeof entrada === 'string') return entrada;
  return entrada instanceof URL ? entrada.href : entrada.url;
}

function recorrer(nodo: NodoEsquema, visitar: (n: NodoEsquema) => void): void {
  visitar(nodo);
  for (const hijo of Object.values(nodo.properties ?? {})) recorrer(hijo, visitar);
  if (nodo.items) recorrer(nodo.items, visitar);
  for (const alternativa of nodo.anyOf ?? []) recorrer(alternativa, visitar);
}

/** Espera, con el reloj real, a que el adaptador haya programado la espera del reintento. */
async function esperarTemporizadorPendiente(): Promise<void> {
  for (let i = 0; i < 1_000 && jest.getTimerCount() === 0; i += 1) {
    await new Promise<void>((resolver) => setImmediate(resolver));
  }
}

const fetchOriginal: Fetch = global.fetch;
let fetchSimulado: jest.Mock<ReturnType<Fetch>, Parameters<Fetch>>;

beforeEach(() => {
  fetchSimulado = jest.fn<ReturnType<Fetch>, Parameters<Fetch>>();
  global.fetch = fetchSimulado;
});

afterEach(() => {
  global.fetch = fetchOriginal;
  jest.useRealTimers();
});

function cuerpoEnviado(indice = 0): { url: string; init: RequestInit; cuerpo: CuerpoPeticion } {
  const llamada = fetchSimulado.mock.calls[indice];
  const init = llamada[1] ?? {};
  const cuerpo = JSON.parse(init.body as string) as CuerpoPeticion;
  return { url: urlDe(llamada[0]), init, cuerpo };
}

describe('Adaptador OpenAI · petición', () => {
  it('envía un PDF como input_file con la instrucción y el esquema estricto del tipo', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));
    const adaptador = adaptadorDePrueba();

    await adaptador.extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    const { url, init, cuerpo } = cuerpoEnviado();
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-prueba');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');

    expect(cuerpo.model).toBe('gpt-6-luna');
    expect(cuerpo.instructions).toContain('Sisbén');
    expect(cuerpo.instructions).toBe(cuerpo.instructions.trim());

    const [archivo, texto] = cuerpo.input[0].content;
    expect(cuerpo.input[0].role).toBe('user');
    expect(archivo.type).toBe('input_file');
    expect(archivo.filename).toBe('documento.pdf');
    expect(archivo.file_data!.startsWith('data:application/pdf;base64,')).toBe(true);
    expect(Buffer.from(archivo.file_data!.split(',')[1], 'base64').equals(PDF)).toBe(true);
    expect(texto.type).toBe('input_text');
    expect(texto.text).toContain('Certificado de afiliación a EPS');
    expect(texto.text).toContain(`código ${TipoDocumento.CERTIFICADO_EPS}`);

    expect(cuerpo.text.format.type).toBe('json_schema');
    expect(cuerpo.text.format.strict).toBe(true);
    expect(cuerpo.text.format.schema.properties!.campos.items!.properties!.nombre.enum)
      .toEqual([...CAMPOS_POR_TIPO[TipoDocumento.CERTIFICADO_EPS]!]);
    expect(cuerpo.text.format.schema.properties!.criterios.items!.properties!.codigo.enum)
      .toEqual(conocimiento.criteriosEvaluables(TipoDocumento.CERTIFICADO_EPS).map((c) => c.codigo));

    expect(cuerpo.reasoning).toEqual({ effort: 'low' });
    expect(cuerpo.text.verbosity).toBe('low');
    expect(cuerpo.temperature).toBeUndefined();
    expect(cuerpo.store).toBe(false);
    expect(cuerpo.max_output_tokens).toBe(4_000);
  });

  it('envía una imagen PNG como input_image en alta resolución', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba().extraer(PNG, 'image/png', TipoDocumento.CERTIFICADO_EPS);

    const [archivo] = cuerpoEnviado().cuerpo.input[0].content;
    expect(archivo.type).toBe('input_image');
    expect(archivo.image_url!.startsWith('data:image/png;base64,')).toBe(true);
    expect(archivo.detail).toBe('high');
    expect(archivo.file_data).toBeUndefined();
  });

  it('un JPEG se envía tal cual, sin reencodificar', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba().extraer(JPEG_FALSO, 'image/jpeg', TipoDocumento.CEDULA);

    const [archivo] = cuerpoEnviado().cuerpo.input[0].content;
    expect(archivo.image_url).toBe(`data:image/jpeg;base64,${JPEG_FALSO.toString('base64')}`);
  });

  it('un modelo sin razonamiento recibe temperatura cero y ningún esfuerzo', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));
    const adaptador = adaptadorDePrueba({ OPENAI_MODELO: 'gpt-4.1-mini' });
    expect(adaptador.modeloConfigurado).toBe('gpt-4.1-mini');

    await adaptador.extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    const { cuerpo } = cuerpoEnviado();
    expect(cuerpo.model).toBe('gpt-4.1-mini');
    expect(cuerpo.temperature).toBe(0);
    expect(cuerpo.reasoning).toBeUndefined();
    expect(cuerpo.text.verbosity).toBeUndefined();
  });

  it('respeta una URL base distinta (sin barra final duplicada)', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_URL_BASE: 'https://pasarela.cun.edu.co/openai/v1/' })
      .extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(cuerpoEnviado().url).toBe('https://pasarela.cun.edu.co/openai/v1/responses');
  });

  it('un formato de imagen no admitido que no se puede convertir se rechaza sin llamar', async () => {
    const error = await capturar(
      adaptadorDePrueba().extraer(Buffer.from('basura tiff'), 'image/tiff', TipoDocumento.CEDULA),
    );
    expect(error.transitorio).toBe(false);
    expect(error.message).toContain('image/tiff');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('un tipo de archivo que no es PDF ni imagen se rechaza sin llamar', async () => {
    const error = await capturar(
      adaptadorDePrueba().extraer(Buffer.from('hola'), 'text/plain', TipoDocumento.CEDULA),
    );
    expect(error.transitorio).toBe(false);
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('sin llave configurada se rechaza sin llamar', async () => {
    const adaptador = new ExtraccionOpenAiAdapter(configDe({}), decodificador);
    const error = await capturar(adaptador.extraer(PDF, 'application/pdf', TipoDocumento.CEDULA));
    expect(error.transitorio).toBe(false);
    expect(error.message).toContain('OPENAI_API_KEY');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });
});

describe('Adaptador OpenAI · interpretación de la respuesta', () => {
  it('normaliza campos, criterios, tipo y costo a partir del uso real', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_EPS));

    const resultado = await adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    // Todos los campos del tipo, aunque el modelo no los haya devuelto.
    expect(Object.keys(resultado.campos)).toEqual([...camposDe(TipoDocumento.CERTIFICADO_EPS)]);
    expect(resultado.campos.entidad_emisora).toEqual({ valor: 'Nueva EPS', confianza: 1, evidencia: 'NUEVA EPS S.A.' });
    expect(resultado.campos.nombre_afiliado).toEqual({ valor: null, confianza: 0, evidencia: null });
    expect(resultado.campos.fecha_expedicion).toEqual({ valor: '2026-09-30', confianza: 0, evidencia: null });
    expect(resultado.campos.documento_afiliado).toEqual({ valor: null, confianza: 0, evidencia: null });

    // Criterios: enunciado y causal salen del dominio; el código desconocido se ignora.
    const criterios = conocimiento.criteriosEvaluables(TipoDocumento.CERTIFICADO_EPS);
    // Los tres respondidos van primero; los que el modelo omitió quedan como
    // «no determinable» con su motivo, uno por cada criterio del manual.
    expect(resultado.hallazgos).toHaveLength(criterios.length);
    const omitidos = resultado.hallazgos!.slice(3);
    expect(omitidos.every((h) => h.cumple === 'no_determinable' && h.detalle === 'El modelo no respondió este criterio')).toBe(true);
    expect(new Set(resultado.hallazgos!.map((h) => h.codigo)).size).toBe(criterios.length);
    expect(resultado.hallazgos![0]).toEqual({
      codigo: 'CRIT_1', enunciado: criterios[0].enunciado, cumple: 'si', detalle: null, causalDevolucion: false,
    });
    expect(resultado.hallazgos![1].codigo).toBe('NOACEPTA_3');
    expect(resultado.hallazgos![1].cumple).toBe('no');
    expect(resultado.hallazgos![1].causalDevolucion).toBe(true);
    expect(resultado.hallazgos![1].enunciado).toContain('Sisbén');
    expect(resultado.hallazgos![1].detalle).toBe('Es una consulta del Sisbén');
    expect(resultado.hallazgos![2]).toMatchObject({ codigo: 'VIGENCIA', cumple: 'no_determinable' });

    expect(resultado.tipoDetectado).toBeNull();
    expect(resultado.ilegible).toBe(false);
    expect(resultado.motivoIlegible).toBeNull();
    expect(resultado.resumen).toBe('Certificado de afiliación de Nueva EPS');

    // (8 000 × 0,10 + 2 000 × 0,01 + 500 × 0,50) / 1e6 = 0,00107 USD.
    expect(resultado.costoUsd).toBeCloseTo(0.00107, 8);
    expect(resultado.proveedor).toBe('openai');
    expect(resultado.modelo).toBe('gpt-6-luna-2026-09-22');
    expect(resultado.tokensEntrada).toBe(10_000);
    expect(resultado.tokensSalida).toBe(500);
    expect(resultado.tokensCache).toBe(2_000);
    expect(resultado.tokensRazonamiento).toBe(200);
    expect(typeof resultado.duracionMs).toBe('number');
    expect(resultado.duracionMs).toBeGreaterThanOrEqual(0);
  });

  it('acepta un tipo detectado del catálogo y un motivo de ilegibilidad', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo({
      ...LECTURA_LIMPIA, tipo_detectado: 'planilla_aportes', ilegible: true, motivo_ilegible: 'borroso',
    }));

    const resultado = await adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(resultado.tipoDetectado).toBe(TipoDocumento.PLANILLA_APORTES);
    expect(resultado.ilegible).toBe(true);
    expect(resultado.motivoIlegible).toBe('borroso');
  });

  it('un modelo sin tarifa registrada se valora con la tarifa de respaldo y queda marcado', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA, { model: 'modelo-desconocido' }));

    const resultado = await adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(resultado.modelo).toBe('modelo-desconocido');
    // Respaldo (2 / 0,2 / 10 USD por millón) sobre USO_TIPICO: 8000×2 + 2000×0,2 + 500×10 = 0,0214 USD.
    expect(resultado.costoUsd).toBeCloseTo(0.0214, 6);
    expect(resultado.tarifaDesconocida).toBe(true);
  });

  it('sin «usage» los tokens y el costo quedan en cero', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA, { usage: undefined }));

    const resultado = await adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(resultado.tokensEntrada).toBe(0);
    expect(resultado.tokensSalida).toBe(0);
    expect(resultado.costoUsd).toBe(0);
  });

  it('una respuesta incompleta se rechaza como fallo definitivo', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA, {
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(false);
    expect(error.message).toContain('max_output_tokens');
  });

  it('si el modelo rehúsa, se rechaza', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(200, {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No puedo leer este documento' }] }],
      usage: USO_TIPICO,
    }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(false);
    expect(error.message).toContain('rehusó');
  });

  it('un texto que no es JSON se rechaza', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(200, {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'esto no es JSON' }] }],
    }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(false);
    expect(error.message).toContain('JSON');
  });

  it('un error de servidor dentro del cuerpo 200 se trata como transitorio y se reintenta', async () => {
    // Una Response solo se puede leer una vez: cada llamada recibe la suya.
    fetchSimulado.mockImplementation(() => Promise.resolve(respuestaHttp(200, {
      status: 'failed', error: { message: 'server_error interno', code: 'server_error' },
      usage: { input_tokens: 5000, output_tokens: 0 },
    })));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(true);
    expect(error.codigo).toBe('server_error');
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    // Lo facturado viaja en el error para que el pipeline registre el gasto.
    expect(error.uso?.tokensEntrada).toBe(5000);
    expect(error.uso?.costoUsd).toBeCloseTo(0.0005, 6);
  });

  it('un error definitivo dentro del cuerpo 200 se rechaza sin reintentar', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(200, {
      status: 'failed', error: { message: 'Esquema inválido', code: 'invalid_request_error' },
    }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(false);
    expect(error.codigo).toBe('invalid_request_error');
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });
});

describe('Adaptador OpenAI · reintento ante fallos transitorios', () => {
  const TEMPORIZADORES_REALES = { doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] as const };

  it('un 429 de ritmo se reintenta una vez y resuelve', async () => {
    jest.useFakeTimers({ doNotFake: [...TEMPORIZADORES_REALES.doNotFake] });
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit' } }))
      .mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    const promesa = adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);
    await esperarTemporizadorPendiente();
    await jest.advanceTimersByTimeAsync(3_000);

    const resultado = await promesa;
    expect(resultado.proveedor).toBe('openai');
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });

  it('un 429 por cuota agotada no se reintenta', async () => {
    fetchSimulado.mockResolvedValueOnce(
      respuestaHttp(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }),
    );

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(false);
    expect(error.estadoHttp).toBe(429);
    expect(error.codigo).toBe('insufficient_quota');
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('un 401 es definitivo: una sola llamada', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(401, { error: { message: 'Incorrect API key provided' } }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    expect(error.transitorio).toBe(false);
    expect(error.estadoHttp).toBe(401);
    expect(error.message).toContain('401');
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('dos 500 seguidos agotan el reintento y se rechaza como transitorio', async () => {
    jest.useFakeTimers({ doNotFake: [...TEMPORIZADORES_REALES.doNotFake] });
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(500, { error: { message: 'Internal error' } }))
      .mockResolvedValueOnce(respuestaHttp(500, { error: { message: 'Internal error' } }));

    const promesa = capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    await esperarTemporizadorPendiente();
    await jest.advanceTimersByTimeAsync(1_500);

    const error = await promesa;
    expect(error.transitorio).toBe(true);
    expect(error.estadoHttp).toBe(500);
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });

  it('un fallo de red se reintenta y, si persiste, se rechaza como transitorio', async () => {
    jest.useFakeTimers({ doNotFake: [...TEMPORIZADORES_REALES.doNotFake] });
    fetchSimulado
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const promesa = capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    await esperarTemporizadorPendiente();
    await jest.advanceTimersByTimeAsync(1_500);

    const error = await promesa;
    expect(error.transitorio).toBe(true);
    expect(error.estadoHttp).toBeNull();
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });
});

describe('Adaptador OpenAI · esquema de salida estructurada', () => {
  const esquema = esquemaLectura(
    TipoDocumento.CERTIFICADO_EPS,
    conocimiento.criteriosEvaluables(TipoDocumento.CERTIFICADO_EPS).map((c) => c.codigo),
  ) as NodoEsquema;

  it('todo objeto cierra propiedades adicionales y exige todas sus claves', () => {
    let objetos = 0;
    recorrer(esquema, (nodo) => {
      if (nodo.type !== 'object') return;
      objetos += 1;
      expect(nodo.additionalProperties).toBe(false);
      expect([...(nodo.required ?? [])].sort()).toEqual(Object.keys(nodo.properties ?? {}).sort());
    });
    // Raíz, elemento de campos y elemento de criterios.
    expect(objetos).toBe(3);
  });

  it('tipo_detectado solo acepta códigos del catálogo o null', () => {
    const alternativas = esquema.properties!.tipo_detectado.anyOf!;
    expect(alternativas).toHaveLength(2);
    expect(alternativas[0].enum).toEqual(Object.values(TipoDocumento));
    expect(alternativas[1].type).toBe('null');
  });

  it('el nombre de campo y el código de criterio se restringen a los del tipo', () => {
    expect(esquema.properties!.campos.items!.properties!.nombre.enum)
      .toEqual([...CAMPOS_POR_TIPO[TipoDocumento.CERTIFICADO_EPS]!]);
    expect(esquema.properties!.criterios.items!.properties!.cumple.enum).toEqual(['si', 'no', 'no_determinable']);
  });

  it('un tipo sin campos ni criterios deja los nombres libres pero el esquema cerrado', () => {
    const libre = esquemaLectura(TipoDocumento.SOPORTE_RELACION_LABORAL, []) as NodoEsquema;
    expect(libre.properties!.criterios.items!.properties!.codigo.enum).toBeUndefined();
    expect(libre.properties!.criterios.items!.additionalProperties).toBe(false);
    const sinCampos = esquemaLectura(TipoDocumento.INFORME_1, ['CRIT_1']) as NodoEsquema;
    expect(sinCampos.properties!.campos.items!.properties!.nombre.enum).toBeUndefined();
    expect(sinCampos.properties!.criterios.items!.properties!.codigo.enum).toEqual(['CRIT_1']);
  });
});

describe('Adaptador OpenAI · verificarAcceso', () => {
  it('sin llave responde que no está configurada, sin salir a la red', async () => {
    const adaptador = new ExtraccionOpenAiAdapter(configDe({ OPENAI_MODELO: 'gpt-6-luna' }), decodificador);
    const resultado = await adaptador.verificarAcceso();
    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toContain('OPENAI_API_KEY');
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it('con 200 en el modelo y en una petición mínima, la llave y el modelo valen', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'gpt-6-luna', object: 'model' }))
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'resp_1', status: 'completed', output: [] }));

    const resultado = await adaptadorDePrueba().verificarAcceso();

    expect(resultado.ok).toBe(true);
    expect(resultado.detalle).toContain('gpt-6-luna');
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSimulado.mock.calls[0];
    expect(urlDe(url)).toBe('https://api.openai.com/v1/models/gpt-6-luna');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-prueba');
    // La prueba real es diminuta y no se guarda.
    const [urlPrueba, initPrueba] = fetchSimulado.mock.calls[1];
    expect(urlDe(urlPrueba)).toBe('https://api.openai.com/v1/responses');
    const cuerpo = JSON.parse(initPrueba!.body as string) as { max_output_tokens: number; store: boolean; reasoning?: { effort: string } };
    expect(cuerpo.max_output_tokens).toBe(16);
    expect(cuerpo.store).toBe(false);
    expect(cuerpo.reasoning?.effort).toBe('low');
  });

  it('una petición mínima rechazada (400) revela la configuración inválida aunque la llave sirva', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'gpt-6-luna', object: 'model' }))
      .mockResolvedValueOnce(respuestaHttp(400, { error: { message: "Unsupported value: 'minimal'…", code: 'unsupported_value', param: 'reasoning.effort' } }));

    const resultado = await adaptadorDePrueba().verificarAcceso();

    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toContain('400');
  });

  it('con 401 informa el estado y el mensaje del proveedor', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(401, { error: { message: 'Incorrect API key' } }));

    const resultado = await adaptadorDePrueba().verificarAcceso();

    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toContain('401');
    expect(resultado.detalle).toContain('Incorrect API key');
  });

  it('sin conexión no lanza: devuelve el motivo', async () => {
    fetchSimulado.mockRejectedValueOnce(new TypeError('fetch failed'));

    const resultado = await adaptadorDePrueba().verificarAcceso();

    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toContain('Sin conexión');
  });
});

// ── Robustez: esfuerzo degradado, salvaguarda ante rechazo y saneamiento ────

describe('Adaptador OpenAI · esfuerzo de razonamiento efectivo', () => {
  it('un esfuerzo que el modelo no admite se degrada al vecino válido en la petición', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_ESFUERZO: 'minimal' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    const { cuerpo } = cuerpoEnviado();
    expect(cuerpo.model).toBe('gpt-6-luna');
    expect(cuerpo.reasoning).toEqual({ effort: 'low' });
    expect(cuerpo.text.verbosity).toBe('low');
    expect(cuerpo.temperature).toBeUndefined();
  });

  it('un esfuerzo admitido viaja tal cual', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_ESFUERZO: 'high' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(cuerpoEnviado().cuerpo.reasoning).toEqual({ effort: 'high' });
  });

  it('none en gpt-6-astra sube a low y en gpt-5-mini a minimal', async () => {
    fetchSimulado.mockResolvedValue(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_MODELO: 'gpt-6-astra', OPENAI_ESFUERZO: 'none' })
      .extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);
    fetchSimulado.mockResolvedValue(respuestaModelo(LECTURA_LIMPIA));
    await adaptadorDePrueba({ OPENAI_MODELO: 'gpt-5-mini', OPENAI_ESFUERZO: 'none' })
      .extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(cuerpoEnviado(0).cuerpo.reasoning).toEqual({ effort: 'low' });
    expect(cuerpoEnviado(1).cuerpo.reasoning).toEqual({ effort: 'minimal' });
  });

  it('un snapshot con fecha hereda los esfuerzos del modelo base', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_MODELO: 'gpt-6-luna-2026-09-22', OPENAI_ESFUERZO: 'minimal' })
      .extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(cuerpoEnviado().cuerpo.reasoning).toEqual({ effort: 'low' });
  });

  it('con gpt-4.1-mini no viaja reasoning aunque haya esfuerzo configurado, y sí temperatura cero', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_MODELO: 'gpt-4.1-mini', OPENAI_ESFUERZO: 'high' })
      .extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    const { cuerpo } = cuerpoEnviado();
    expect(cuerpo.reasoning).toBeUndefined();
    expect(cuerpo.temperature).toBe(0);
    expect(cuerpo.text.verbosity).toBeUndefined();
  });

  it('en verificarAcceso la petición mínima lleva el esfuerzo efectivo y el detalle lo dice', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'gpt-6-luna', object: 'model' }))
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'resp_1', status: 'completed', output: [] }));

    const resultado = await adaptadorDePrueba({ OPENAI_ESFUERZO: 'minimal' }).verificarAcceso();

    expect(resultado.ok).toBe(true);
    expect(resultado.detalle).toContain('esfuerzo low');
    const cuerpo = JSON.parse(fetchSimulado.mock.calls[1][1]!.body as string) as { reasoning?: { effort: string } };
    expect(cuerpo.reasoning).toEqual({ effort: 'low' });
  });

  it('en verificarAcceso con un modelo sin razonamiento no viaja reasoning', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'gpt-4.1-mini', object: 'model' }))
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'resp_1', status: 'completed', output: [] }));

    const resultado = await adaptadorDePrueba({ OPENAI_MODELO: 'gpt-4.1-mini', OPENAI_ESFUERZO: 'high' }).verificarAcceso();

    expect(resultado.ok).toBe(true);
    expect(resultado.detalle).toContain('sin razonamiento');
    const cuerpo = JSON.parse(fetchSimulado.mock.calls[1][1]!.body as string) as { reasoning?: unknown; model: string };
    expect(cuerpo.model).toBe('gpt-4.1-mini');
    expect(cuerpo.reasoning).toBeUndefined();
  });

  it('verificarAcceso avisa cuando el modelo configurado no tiene tarifa registrada', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'modelo-raro', object: 'model' }))
      .mockResolvedValueOnce(respuestaHttp(200, { id: 'resp_1', status: 'completed', output: [] }));

    const resultado = await adaptadorDePrueba({ OPENAI_MODELO: 'modelo-raro' }).verificarAcceso();

    expect(resultado.ok).toBe(true);
    expect(resultado.detalle).toContain('sin tarifa registrada');
    expect(urlDe(fetchSimulado.mock.calls[0][0])).toBe('https://api.openai.com/v1/models/modelo-raro');
  });
});

describe('Adaptador OpenAI · salvaguarda ante un esfuerzo rechazado por la API', () => {
  /** Respuesta real de OpenAI ante un esfuerzo que el modelo no admite. */
  const RECHAZO_ESFUERZO = {
    error: {
      message:
        "Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model. " +
        "Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.",
      type: 'invalid_request_error',
      code: 'unsupported_value',
      param: 'reasoning.effort',
    },
  };
  /** Un 400 cuyo mensaje no delata el parámetro: solo `param` o `code` lo dicen. */
  const RECHAZO_MUDO = (code: string, param: string | null) => ({
    error: { message: 'Invalid value.', type: 'invalid_request_error', code, param },
  });

  it('un 400 por reasoning.effort reintenta de inmediato con low y resuelve', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(400, RECHAZO_ESFUERZO))
      .mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    const resultado = await adaptadorDePrueba({ OPENAI_ESFUERZO: 'high' })
      .extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(resultado.proveedor).toBe('openai');
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(cuerpoEnviado(0).cuerpo.reasoning).toEqual({ effort: 'high' });
    const segunda = cuerpoEnviado(1).cuerpo;
    expect(segunda.reasoning).toEqual({ effort: 'low' });
    // El resto de la petición no cambia.
    expect(segunda.text.verbosity).toBe('low');
    expect(segunda.text.format.strict).toBe(true);
    expect(segunda.input[0].content[0].detail).toBe('high');
  });

  it('si el pedido ya era low, el reintento va sin reasoning', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(400, RECHAZO_ESFUERZO))
      .mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_ESFUERZO: 'low' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(cuerpoEnviado(0).cuerpo.reasoning).toEqual({ effort: 'low' });
    const segunda = cuerpoEnviado(1).cuerpo;
    expect(segunda.reasoning).toBeUndefined();
    expect(segunda.temperature).toBeUndefined();
  });

  it('high rechazado y low rechazado: la tercera petición va sin reasoning', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(400, RECHAZO_ESFUERZO))
      .mockResolvedValueOnce(respuestaHttp(400, RECHAZO_ESFUERZO))
      .mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_ESFUERZO: 'high' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(fetchSimulado).toHaveBeenCalledTimes(3);
    expect(cuerpoEnviado(0).cuerpo.reasoning).toEqual({ effort: 'high' });
    expect(cuerpoEnviado(1).cuerpo.reasoning).toEqual({ effort: 'low' });
    expect(cuerpoEnviado(2).cuerpo.reasoning).toBeUndefined();
  });

  it('sin reasoning que quitar, un tercer 400 ya no se reintenta: la salvaguarda no entra en bucle', async () => {
    fetchSimulado.mockImplementation(() => Promise.resolve(respuestaHttp(400, RECHAZO_ESFUERZO)));

    const error = await capturar(
      adaptadorDePrueba({ OPENAI_ESFUERZO: 'high' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS),
    );

    expect(fetchSimulado).toHaveBeenCalledTimes(3);
    expect(error.estadoHttp).toBe(400);
    expect(error.transitorio).toBe(false);
    expect(error.codigo).toBe('unsupported_value');
    expect(error.parametro).toBe('reasoning.effort');
  });

  it('basta `param` para disparar la salvaguarda aunque el mensaje no mencione el esfuerzo', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(400, RECHAZO_MUDO('invalid_value', 'reasoning.effort')))
      .mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_ESFUERZO: 'medium' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(cuerpoEnviado(1).cuerpo.reasoning).toEqual({ effort: 'low' });
  });

  it('basta el código unsupported_value, sin `param`', async () => {
    fetchSimulado
      .mockResolvedValueOnce(respuestaHttp(400, RECHAZO_MUDO('unsupported_value', null)))
      .mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA));

    await adaptadorDePrueba({ OPENAI_ESFUERZO: 'medium' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(cuerpoEnviado(1).cuerpo.reasoning).toEqual({ effort: 'low' });
  });

  it('un 400 por otro parámetro no se reintenta y el error conserva el parámetro señalado', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(400, RECHAZO_MUDO('invalid_value', 'max_output_tokens')));

    const error = await capturar(
      adaptadorDePrueba({ OPENAI_ESFUERZO: 'medium' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS),
    );

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(error.estadoHttp).toBe(400);
    expect(error.transitorio).toBe(false);
    expect(error.codigo).toBe('invalid_value');
    expect(error.parametro).toBe('max_output_tokens');
    expect(error.message).toContain('400');
  });

  it('con un modelo sin razonamiento el rechazo no se reintenta: no hay reasoning que degradar', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(400, RECHAZO_ESFUERZO));

    const error = await capturar(
      adaptadorDePrueba({ OPENAI_MODELO: 'gpt-4.1-mini' }).extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS),
    );

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(error.estadoHttp).toBe(400);
    expect(error.parametro).toBe('reasoning.effort');
  });

  it('un 400 sin cuerpo JSON no tiene parámetro ni código, y no se reintenta', async () => {
    fetchSimulado.mockResolvedValueOnce(new Response('Bad Request', { status: 400, headers: { 'content-type': 'text/plain' } }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(error.codigo).toBeNull();
    expect(error.parametro).toBeNull();
    expect(error.message).toContain('Bad Request');
  });
});

describe('Adaptador OpenAI · saneamiento de llaves en los mensajes del proveedor', () => {
  const LLAVE = 'sk-proj-abc123xyz…';
  const MENSAJE_401 =
    `Incorrect API key provided: ${LLAVE}. You can find your API key at https://platform.openai.com/account/api-keys.`;

  it('un 401 cuyo mensaje trae la llave la enmascara en el error', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(401, { error: { message: MENSAJE_401, code: 'invalid_api_key' } }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));

    expect(error.estadoHttp).toBe(401);
    expect(error.transitorio).toBe(false);
    expect(error.codigo).toBe('invalid_api_key');
    expect(error.message).toContain('Incorrect API key provided: sk-***');
    expect(error.message).not.toContain(LLAVE);
    expect(error.message).not.toContain('sk-proj');
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('en verificarAcceso el detalle tampoco expone la llave', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(401, { error: { message: MENSAJE_401 } }));

    const resultado = await adaptadorDePrueba().verificarAcceso();

    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toContain('401');
    expect(resultado.detalle).toContain('sk-***');
    expect(resultado.detalle).not.toContain(LLAVE);
  });

  it('un cuerpo que no es JSON también se sanea', async () => {
    fetchSimulado.mockResolvedValueOnce(
      new Response(`Bad gateway while authenticating sk-live-ABCDEF123456`, { status: 502, headers: { 'content-type': 'text/plain' } }),
    );
    fetchSimulado.mockResolvedValueOnce(
      new Response(`Bad gateway while authenticating sk-live-ABCDEF123456`, { status: 502, headers: { 'content-type': 'text/plain' } }),
    );
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    const promesa = capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));
    await esperarTemporizadorPendiente();
    await jest.advanceTimersByTimeAsync(1_500);

    const error = await promesa;
    expect(error.estadoHttp).toBe(502);
    expect(error.message).toContain('sk-***');
    expect(error.message).not.toContain('sk-live');
  });

  it('un fallo de conexión cuyo mensaje arrastra la llave se sanea en verificarAcceso', async () => {
    fetchSimulado.mockRejectedValueOnce(new TypeError(`fetch failed (authorization: Bearer ${LLAVE})`));

    const resultado = await adaptadorDePrueba().verificarAcceso();

    expect(resultado.ok).toBe(false);
    expect(resultado.detalle).toContain('Sin conexión');
    expect(resultado.detalle).toContain('sk-***');
    expect(resultado.detalle).not.toContain(LLAVE);
  });

  it('una llave corta (menos de cuatro caracteres tras el prefijo) no es una llave y no se toca', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(400, { error: { message: 'Campo sk-1 inválido' } }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));

    expect(error.message).toContain('sk-1');
  });
});

describe('Adaptador OpenAI · tarifa de respaldo', () => {
  it('el costo de un modelo sin tarifa coincide con costoDe(TARIFA_RESPALDO)', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA, { model: 'modelo-desconocido' }));

    const resultado = await adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(resultado.tarifaDesconocida).toBe(true);
    expect(resultado.costoUsd).toBe(costoDe(TARIFA_RESPALDO, { entrada: 10_000, salida: 500, cache: 2_000, escrituraCache: 0 }));
    // Más caro que lo que habría costado con Luna: el tope diario se alcanza antes, nunca después.
    expect(resultado.costoUsd).toBeGreaterThan(0.00107);
  });

  it('lo facturado por una respuesta fallida de un modelo sin tarifa también se valora con el respaldo', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaHttp(200, {
      status: 'failed', model: 'modelo-desconocido',
      error: { message: 'Esquema inválido', code: 'invalid_request_error' },
      usage: { input_tokens: 5_000, output_tokens: 0 },
    }));

    const error = await capturar(adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS));

    expect(error.uso).not.toBeNull();
    expect(error.uso!.modelo).toBe('modelo-desconocido');
    expect(error.uso!.tarifaDesconocida).toBe(true);
    // 5 000 × 2 USD por millón = 0,01 USD.
    expect(error.uso!.costoUsd).toBeCloseTo(0.01, 6);
  });

  it('un snapshot con fecha del modelo configurado no es tarifa desconocida', async () => {
    fetchSimulado.mockResolvedValueOnce(respuestaModelo(LECTURA_LIMPIA, { model: 'gpt-6-luna-2026-09-22' }));

    const resultado = await adaptadorDePrueba().extraer(PDF, 'application/pdf', TipoDocumento.CERTIFICADO_EPS);

    expect(resultado.tarifaDesconocida).toBeUndefined();
    expect(resultado.costoUsd).toBeCloseTo(0.00107, 8);
  });
});
