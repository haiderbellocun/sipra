import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import { DocumentosController } from '../src/infrastructure/controllers/documentos.controller';
import {
  firmarEnlaceDocumento, verificarEnlaceDocumento,
} from '../src/infrastructure/adapters/storage/enlace-documento';
import { REDACCION_LOGS, redactarUrl } from '../src/infrastructure/observability/redaccion-logs';

/**
 * Enlaces de descarga de documentos: firma vinculada al documento y a quien lo
 * pidió, clave propia, comparación en tiempo constante, vencimiento corto y nada
 * sensible en los registros.
 */

const SECRETO = 'secreto-de-pruebas-con-al-menos-treinta-y-dos-caracteres';
const CTX = { documentoId: 'doc-1', solicitanteId: 'usr-1' };
const AHORA = 1_800_000_000_000;

function emitir(contexto = CTX, minutos = 10, ahora = AHORA): Record<string, string> {
  const url = firmarEnlaceDocumento(SECRETO, contexto, minutos, ahora);
  return Object.fromEntries(new URL(url, 'http://localhost').searchParams.entries());
}

describe('Enlace firmado · emisión', () => {
  it('apunta a la descarga de la API y no expone la ruta de almacenamiento', () => {
    const url = firmarEnlaceDocumento(SECRETO, CTX, 10, AHORA);
    expect(url.startsWith('/api/v1/documentos/descarga?')).toBe(true);
    const p = emitir();
    expect(Object.keys(p).sort()).toEqual(['doc', 'exp', 'sig', 'usr']);
    expect(p.doc).toBe('doc-1');
    expect(p.usr).toBe('usr-1');
    expect(Number(p.exp)).toBe(AHORA + 10 * 60_000);
    expect(url).not.toContain('ruta');
  });
});

describe('Enlace firmado · verificación', () => {
  it('firma correcta → devuelve el documento y el solicitante firmados', () => {
    expect(verificarEnlaceDocumento(SECRETO, emitir(), AHORA + 1000)).toEqual(CTX);
  });

  it.each([
    ['otro documento', { doc: 'doc-2' }],
    ['otro solicitante', { usr: 'usr-2' }],
    ['vencimiento extendido', { exp: String(AHORA + 999 * 60_000) }],
  ])('firma manipulada: %s → rechazado', (_caso, cambio) => {
    expect(verificarEnlaceDocumento(SECRETO, { ...emitir(), ...cambio }, AHORA + 1000)).toBeNull();
  });

  it('firma incorrecta (otro valor, otro largo, no hexadecimal, vacía) → rechazado', () => {
    const base = emitir();
    const alterada = `${base.sig[0] === '0' ? '1' : '0'}${base.sig.slice(1)}`;
    for (const sig of [alterada, base.sig.slice(1), `${base.sig}00`, 'zz'.repeat(32), '']) {
      expect(verificarEnlaceDocumento(SECRETO, { ...base, sig }, AHORA + 1000)).toBeNull();
    }
  });

  it('firmada con otro secreto → rechazado', () => {
    expect(verificarEnlaceDocumento('otro-secreto-distinto-de-al-menos-treinta-y-dos', emitir(), AHORA + 1000)).toBeNull();
  });

  it('expirada → rechazada; justo antes de vencer, válida', () => {
    const base = emitir(CTX, 10);
    expect(verificarEnlaceDocumento(SECRETO, base, AHORA + 10 * 60_000)).toEqual(CTX);
    expect(verificarEnlaceDocumento(SECRETO, base, AHORA + 10 * 60_000 + 1)).toBeNull();
  });

  it.each([
    ['sin doc', { doc: undefined }],
    ['sin usr', { usr: undefined }],
    ['sin exp', { exp: undefined }],
    ['sin sig', { sig: undefined }],
    ['exp no numérico', { exp: 'mañana' }],
    ['exp negativo', { exp: '-5' }],
    ['parámetros repetidos (arreglo)', { doc: ['doc-1', 'doc-2'] }],
  ])('parámetros inválidos: %s → rechazado', (_caso, cambio) => {
    expect(verificarEnlaceDocumento(SECRETO, { ...emitir(), ...cambio }, AHORA + 1000)).toBeNull();
  });

  it('usa una clave derivada propia: la firma NO coincide con un HMAC directo con JWT_SECRETO', () => {
    const { sig, exp } = emitir();
    const directa = createHmac('sha256', SECRETO).update(`doc:doc-1|usr:usr-1|exp:${exp}`).digest('hex');
    expect(sig).not.toBe(directa);
  });

  it('la comparación de la firma pasa por timingSafeEqual', () => {
    const cripto = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const espia = jest.spyOn(cripto, 'timingSafeEqual');
    verificarEnlaceDocumento(SECRETO, emitir(), AHORA + 1000);
    expect(espia).toHaveBeenCalledTimes(1);
    espia.mockRestore();
  });
});

// ── Controlador de descarga ────────────────────────────────────────────────

function montarControlador() {
  const gestionar = { descargar: jest.fn().mockResolvedValue(Buffer.from('archivo')) };
  const config = new ConfigService({ JWT_SECRETO: SECRETO });
  const controlador = new DocumentosController(gestionar as never, config);
  const respuesta = {
    cabeceras: {} as Record<string, string>,
    cuerpo: undefined as unknown,
    header(n: string, v: string) { this.cabeceras[n] = v; return this; },
    send(c: unknown) { this.cuerpo = c; return Promise.resolve(); },
  };
  const peticion = { ip: '10.1.2.3', headers: { 'user-agent': 'navegador-de-prueba' } };
  return { controlador, gestionar, respuesta, peticion };
}

describe('GET /documentos/descarga', () => {
  it('enlace válido → entrega el archivo y delega la auditoría con el solicitante firmado', async () => {
    const { controlador, gestionar, respuesta, peticion } = montarControlador();
    const url = firmarEnlaceDocumento(SECRETO, CTX, 10);
    const p = Object.fromEntries(new URL(url, 'http://localhost').searchParams.entries());

    await controlador.descargar(p.doc, p.usr, p.exp, p.sig, peticion as never, respuesta as never);

    expect(gestionar.descargar).toHaveBeenCalledWith('doc-1', 'usr-1', {
      ip: '10.1.2.3', agenteUsuario: 'navegador-de-prueba',
    });
    expect(respuesta.cuerpo).toEqual(Buffer.from('archivo'));
    expect(respuesta.cabeceras['cache-control']).toBe('private, no-store');
  });

  it('firma manipulada o vencida → 400 y NADA se entrega ni se audita', async () => {
    const { controlador, gestionar, respuesta, peticion } = montarControlador();
    const ok = Object.fromEntries(new URL(firmarEnlaceDocumento(SECRETO, CTX, 10), 'http://localhost').searchParams.entries());
    const vencido = Object.fromEntries(
      new URL(firmarEnlaceDocumento(SECRETO, CTX, 10, Date.now() - 3_600_000), 'http://localhost').searchParams.entries(),
    );
    const casos = [
      { ...ok, doc: 'doc-ajeno' },
      { ...ok, usr: 'usr-ajeno' },
      { ...ok, sig: `${ok.sig[0] === 'a' ? 'b' : 'a'}${ok.sig.slice(1)}` },
      vencido,
      {},
    ];
    for (const c of casos) {
      await expect(
        controlador.descargar(c.doc, c.usr, c.exp, c.sig, peticion as never, respuesta as never),
      ).rejects.toThrow(BadRequestException);
    }
    expect(gestionar.descargar).not.toHaveBeenCalled();
    expect(respuesta.cuerpo).toBeUndefined();
  });
});

// ── Registros ──────────────────────────────────────────────────────────────

describe('Registros · la firma del enlace no se escribe', () => {
  const FIRMA = 'f'.repeat(64);

  it('redactarUrl enmascara la firma y la ruta, y conserva el resto para diagnóstico', () => {
    const url = redactarUrl(`/api/v1/documentos/descarga?doc=doc-1&usr=usr-1&exp=123&sig=${FIRMA}`);
    expect(url).not.toContain(FIRMA);
    expect(url).toContain('/api/v1/documentos/descarga?');
    expect(url).toContain('doc=doc-1');
    expect(redactarUrl('/api/v1/documentos/descarga?ruta=practicas/x/cedula.pdf&firma=abc')).not.toMatch(/cedula\.pdf|abc/);
    expect(redactarUrl('/api/v1/salud')).toBe('/api/v1/salud');
    expect(redactarUrl('/api/v1/practicas?estado=activa')).toBe('/api/v1/practicas?estado=activa');
  });

  it('con pino real: ni la firma, ni la autorización, ni la cookie llegan a la salida', () => {
    let salida = '';
    const destino = new Writable({
      write(trozo: Buffer, _codificacion, listo) { salida += trozo.toString(); listo(); },
    });
    const log = pino({ redact: REDACCION_LOGS }, destino);
    log.info({
      req: {
        method: 'GET',
        url: `/api/v1/documentos/descarga?doc=doc-1&usr=usr-1&exp=123&sig=${FIRMA}`,
        query: { doc: 'doc-1', sig: FIRMA },
        headers: { authorization: 'Bearer TOKEN-SECRETO', cookie: 'sesion=SECRETA', host: 'api' },
      },
    }, 'petición');

    expect(salida).not.toContain(FIRMA);
    expect(salida).not.toContain('TOKEN-SECRETO');
    expect(salida).not.toContain('SECRETA');
    const registro = JSON.parse(salida) as { req: { url: string; method: string; headers: { host: string } } };
    expect(registro.req.method).toBe('GET');
    expect(registro.req.headers.host).toBe('api');
    expect(registro.req.url).toContain('/api/v1/documentos/descarga');
  });
});
