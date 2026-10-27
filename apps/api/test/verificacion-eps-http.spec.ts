import dns from 'node:dns';
import net from 'node:net';
import { ErrorHttpSeguro, PoliticaHttp, ClienteHttpSeguro } from '../src/infrastructure/adapters/verificacion-eps/cliente-http-seguro';
import { esDireccionPrivada, esHostIpLiteral, esNombreInterno } from '../src/infrastructure/adapters/verificacion-eps/direcciones-ip';
import { VerificadorEpsHttpAdapter } from '../src/infrastructure/adapters/verificacion-eps/verificador-eps-http.adapter';
import { RegistroVerificadoresEps } from '../src/domain/services/registro-verificadores-eps';
import {
  AdaptadorJsonSintetico, HOST_AJENO, HOST_PRUEBA, HOST_REDIRECCION, RESPUESTA_VALIDA, clientePruebas, definicionPrueba, json,
  servidorHttps,
} from './soporte-verificacion-eps';

/**
 * Defensa SSRF y límites del cliente HTTP, y comportamiento del verificador
 * contra servidores HTTPS locales sintéticos. Sin Internet.
 */

const politica = (puerto: number, extra: Partial<PoliticaHttp> = {}): PoliticaHttp => ({
  timeoutMs: 3000, maxBytes: 4096, contentTypes: ['application/json'], puertosPermitidos: [puerto], maxRedirecciones: 0,
  destinoRedireccionPermitido: () => false, ...extra,
});

describe('Direcciones que nunca se alcanzan (SSRF)', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '169.254.0.1', '100.64.0.1', '192.0.2.10', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3',
    '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2001:db8::1', '[::1]',
  ])('%s es privada', (d) => expect(esDireccionPrivada(d)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '11.0.0.1', '193.168.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s es pública', (d) => expect(esDireccionPrivada(d)).toBe(false));

  it('lo que no es una IP interpretable se trata como privado (no se confía)', () => {
    for (const x of ['', 'abc', '999.1.1.1', '1.2.3', '::g']) expect(esDireccionPrivada(x)).toBe(true);
  });

  it.each(['127.0.0.1', '10.0.0.1', '2130706433', '0x7f000001', '0x7f.0.0.1', '017700000001', '[::1]', '::1'])(
    'IP literal en cualquier notación: %s', (h) => expect(esHostIpLiteral(h)).toBe(true));

  it.each(['verificador.eps.example', 'a1.example.com'])('un nombre normal no es IP literal: %s', (h) => expect(esHostIpLiteral(h)).toBe(false));

  it.each(['localhost', 'LOCALHOST', 'foo.localhost', 'metadata.google.internal', 'servicio.internal', 'impresora.local', 'metadata', 'sinpunto'])(
    'nombre interno: %s', (h) => expect(esNombreInterno(h)).toBe(true));
});

describe('ClienteHttpSeguro · rechazo ANTES de conectar', () => {
  let conexiones = 0;
  let resoluciones = 0;
  const espias: jest.SpyInstance[] = [];
  const estricto = new ClienteHttpSeguro({ resolver: () => { resoluciones += 1; return Promise.resolve([{ address: '8.8.8.8', family: 4 }]); } });

  beforeEach(() => {
    conexiones = 0; resoluciones = 0;
    espias.push(
      jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { conexiones += 1; throw new Error('no debería conectar'); }),
      jest.spyOn(dns, 'lookup').mockImplementation(((..._a: unknown[]) => { conexiones += 1; throw new Error('no debería resolver'); })),
    );
  });
  afterEach(() => { while (espias.length) espias.pop()?.mockRestore(); });

  it.each([
    'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://metadata.google.internal/computeMetadata/v1',
    'https://10.0.0.5/x', 'https://172.16.0.9/x', 'https://192.168.0.1/x', 'https://[::1]/x', 'https://[fe80::1]/x', 'https://2130706433/x',
    'https://0x7f.0.0.1/x', 'https://servicio.internal/x',
  ])('%s: sin resolver y sin conectar', async (u) => {
    await expect(estricto.obtener(new URL(u), politica(443))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    expect(conexiones).toBe(0);
    expect(resoluciones).toBe(0);
  });

  it.each(['http://verificador.eps.example/x', 'ftp://verificador.eps.example/x', 'file:///etc/passwd'])('esquema no permitido: %s', async (u) => {
    await expect(estricto.obtener(new URL(u), politica(443))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    expect(conexiones).toBe(0);
  });

  it('usuario:clave en la URL y puertos inesperados se rechazan', async () => {
    await expect(estricto.obtener(new URL('https://u:p@verificador.eps.example/x'), politica(443))).rejects.toBeInstanceOf(ErrorHttpSeguro);
    await expect(estricto.obtener(new URL('https://verificador.eps.example:8443/x'), politica(443))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    expect(conexiones).toBe(0);
  });
});

describe('ClienteHttpSeguro · DNS que apunta a una dirección no pública', () => {
  it.each([
    ['10.0.0.5'], ['172.16.5.5'], ['192.168.1.20'], ['169.254.169.254'], ['127.0.0.1'], ['::1'], ['fe80::2'], ['fd00::1'], ['::ffff:10.0.0.1'],
  ])('el nombre resuelve a %s: se rechaza antes de conectar', async (ip) => {
    const c = new ClienteHttpSeguro({ resolver: () => Promise.resolve([{ address: ip, family: ip.includes(':') ? 6 : 4 }]) });
    await expect(c.obtener(new URL('https://verificador.eps.example/x'), politica(443))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
  });

  it('con un destino REAL en loopback: el nombre apunta a él y no recibe ni una conexión', async () => {
    let conexiones = 0;
    const objetivo = net.createServer((sock) => { conexiones += 1; sock.destroy(); });
    await new Promise<void>((ok) => objetivo.listen(0, '127.0.0.1', ok));
    const puerto = (objetivo.address() as net.AddressInfo).port;
    try {
      const c = new ClienteHttpSeguro({ resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]) });
      await expect(c.obtener(new URL(`https://verificador.eps.example:${puerto}/x`), politica(puerto))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
      expect(conexiones).toBe(0);
    } finally { await new Promise<void>((ok) => objetivo.close(() => ok())); }
  });

  it('una respuesta DNS mixta (una pública y una privada) también se rechaza', async () => {
    const c = new ClienteHttpSeguro({ resolver: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]) });
    await expect(c.obtener(new URL('https://verificador.eps.example/x'), politica(443))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
  });

  it('un nombre que no resuelve es «verificador_no_disponible», no un certificado falso', async () => {
    const c = new ClienteHttpSeguro({ resolver: () => Promise.reject(new Error('ENOTFOUND')) });
    await expect(c.obtener(new URL('https://verificador.eps.example/x'), politica(443))).rejects.toMatchObject({ codigo: 'verificador_no_disponible' });
  });
});

describe('ClienteHttpSeguro · contra un servidor HTTPS sintético', () => {
  it('respuesta válida: se lee, con User-Agent institucional, sin cookies ni compresión', async () => {
    const s = await servidorHttps((_q, res) => { res.setHeader('Set-Cookie', 'sesion=abc'); json(res, 200, { ok: true }); });
    try {
      const r = await clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`), politica(s.puerto));
      expect(r.status).toBe(200);
      expect(JSON.parse(r.cuerpo.toString())).toEqual({ ok: true });
      const cab = s.peticiones[0].cabeceras;
      expect(cab['user-agent']).toMatch(/^SIPRA-Verificacion\/1\.0/);
      expect(cab['accept-encoding']).toBe('identity');
      expect(cab.cookie).toBeUndefined();
      expect(cab.authorization).toBeUndefined();
      expect(s.peticiones[0].metodo).toBe('GET');
    } finally { await s.cerrar(); }
  });

  it('sin redirecciones permitidas, una redirección es un error (aunque apunte al mismo host)', async () => {
    const s = await servidorHttps((_q, res) => { res.writeHead(302, { Location: '/verificar/2' }); res.end(); });
    try {
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`), politica(s.puerto)))
        .rejects.toMatchObject({ codigo: 'redireccion_no_permitida' });
      expect(s.peticiones).toHaveLength(1);
    } finally { await s.cerrar(); }
  });

  it('redirección declarada y permitida: se sigue, revalidada, hasta el máximo', async () => {
    const s = await servidorHttps((q, res) => {
      if (q.url === '/verificar/1') { res.writeHead(302, { Location: `https://${HOST_REDIRECCION}:${(q.socket.localPort as number)}/verificar/2` }); res.end(); return; }
      json(res, 200, { final: true });
    });
    try {
      const permitido = (d: URL): boolean => d.hostname === HOST_REDIRECCION && d.protocol === 'https:';
      const r = await clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`),
        politica(s.puerto, { maxRedirecciones: 1, destinoRedireccionPermitido: permitido }));
      expect(r.redirecciones).toBe(1);
      expect(r.urlFinal.hostname).toBe(HOST_REDIRECCION);
      expect(JSON.parse(r.cuerpo.toString())).toEqual({ final: true });
    } finally { await s.cerrar(); }
  });

  it('una redirección a un host fuera de la allowlist se rechaza SIN pedirlo', async () => {
    const s = await servidorHttps((q, res) => { res.writeHead(302, { Location: `https://${HOST_AJENO}:${(q.socket.localPort as number)}/x` }); res.end(); });
    try {
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`),
        politica(s.puerto, { maxRedirecciones: 2, destinoRedireccionPermitido: (d) => d.hostname === HOST_REDIRECCION })))
        .rejects.toMatchObject({ codigo: 'redireccion_no_permitida' });
      expect(s.peticiones).toHaveLength(1);
    } finally { await s.cerrar(); }
  });

  it.each([
    ['http://verificador.eps-prueba.test/x'], ['https://127.0.0.1/x'], ['https://169.254.169.254/latest/meta-data'],
    ['https://localhost/x'], ['https://metadata.google.internal/x'], ['//atacante.test/x'],
  ])('una redirección a %s no sale de la allowlist ni de https', async (destino) => {
    const s = await servidorHttps((_q, res) => { res.writeHead(302, { Location: destino }); res.end(); });
    try {
      // Aun si la allowlist del verificador «permitiera» todo, http y las IP privadas no pasan.
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`),
        politica(s.puerto, { maxRedirecciones: 2, destinoRedireccionPermitido: (d) => d.hostname === HOST_PRUEBA })))
        .rejects.toBeInstanceOf(ErrorHttpSeguro);
      expect(s.peticiones).toHaveLength(1);
    } finally { await s.cerrar(); }
  });

  it('degradar de https a http en una redirección permitida se rechaza', async () => {
    const s = await servidorHttps((q, res) => { res.writeHead(302, { Location: `http://${HOST_REDIRECCION}:${(q.socket.localPort as number)}/x` }); res.end(); });
    try {
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`),
        politica(s.puerto, { maxRedirecciones: 1, destinoRedireccionPermitido: () => true })))
        .rejects.toMatchObject({ codigo: 'redireccion_no_permitida' });
    } finally { await s.cerrar(); }
  });

  it('un bucle de redirecciones se corta en el máximo', async () => {
    const s = await servidorHttps((q, res) => { res.writeHead(302, { Location: `https://${HOST_PRUEBA}:${(q.socket.localPort as number)}/otra` }); res.end(); });
    try {
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`),
        politica(s.puerto, { maxRedirecciones: 2, destinoRedireccionPermitido: (d) => d.hostname === HOST_PRUEBA })))
        .rejects.toMatchObject({ codigo: 'redireccion_no_permitida' });
      expect(s.peticiones).toHaveLength(3);
    } finally { await s.cerrar(); }
  });

  it('tiempo agotado: error «timeout», no un resultado', async () => {
    const s = await servidorHttps(() => { /* nunca responde */ });
    try {
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/verificar/1`), politica(s.puerto, { timeoutMs: 300 })))
        .rejects.toMatchObject({ codigo: 'timeout' });
    } finally { await s.cerrar(); }
  });

  it('respuesta demasiado grande: por Content-Length y por flujo sin longitud', async () => {
    const s = await servidorHttps((q, res) => {
      if (q.url?.includes('declarado')) { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '999999' }); res.end('x'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const t = setInterval(() => res.write('x'.repeat(1000)), 5);
      res.on('close', () => clearInterval(t));
    });
    try {
      const c = clientePruebas();
      await expect(c.obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/declarado`), politica(s.puerto))).rejects.toMatchObject({ codigo: 'respuesta_demasiado_grande' });
      await expect(c.obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/sin-longitud`), politica(s.puerto))).rejects.toMatchObject({ codigo: 'respuesta_demasiado_grande' });
    } finally { await s.cerrar(); }
  });

  it('Content-Type distinto del esperado y respuestas comprimidas se rechazan', async () => {
    const s = await servidorHttps((q, res) => {
      if (q.url === '/html') { json(res, 200, '<html></html>', 'text/html'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }); res.end('{}');
    });
    try {
      const c = clientePruebas();
      await expect(c.obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/html`), politica(s.puerto))).rejects.toMatchObject({ codigo: 'contenido_no_esperado' });
      await expect(c.obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/gz`), politica(s.puerto))).rejects.toMatchObject({ codigo: 'contenido_no_esperado' });
    } finally { await s.cerrar(); }
  });

  it.each([[500, 'verificador_no_disponible'], [503, 'verificador_no_disponible'], [429, 'verificador_no_disponible'], [403, 'respuesta_invalida'], [401, 'respuesta_invalida']])(
    'estado HTTP %i → %s', async (estado, codigo) => {
      const s = await servidorHttps((_q, res) => json(res, estado, { x: 1 }));
      try {
        await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/x`), politica(s.puerto))).rejects.toMatchObject({ codigo });
      } finally { await s.cerrar(); }
    });

  it('el servidor que cierra la conexión sin responder es «verificador_no_disponible»', async () => {
    const s = await servidorHttps((q) => { q.socket.destroy(); });
    try {
      await expect(clientePruebas().obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/x`), politica(s.puerto))).rejects.toMatchObject({ codigo: 'verificador_no_disponible' });
    } finally { await s.cerrar(); }
  });

  it('un certificado TLS que no es de confianza se rechaza (no se desactiva la verificación)', async () => {
    const s = await servidorHttps((_q, res) => json(res, 200, {}));
    try {
      const sinConfianza = new ClienteHttpSeguro({
        resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
        soloPruebas: { permitirDireccionesPrivadas: true },
      });
      await expect(sinConfianza.obtener(new URL(`https://${HOST_PRUEBA}:${s.puerto}/x`), politica(s.puerto))).rejects.toBeInstanceOf(ErrorHttpSeguro);
    } finally { await s.cerrar(); }
  });
});

describe('VerificadorEpsHttpAdapter', () => {
  const solicitud = (puerto: number, ruta = '/verificar/ABC123?t=SECRETO', def = definicionPrueba(puerto)) => ({
    url: `https://${HOST_PRUEBA}:${puerto}${ruta}`, verificador: def, datosCertificado: null,
  });
  const montar = (puerto: number, adaptadores = [new AdaptadorJsonSintetico()], def = definicionPrueba(puerto)) =>
    new VerificadorEpsHttpAdapter(new RegistroVerificadoresEps([def]), clientePruebas(), adaptadores);

  it('certificado verificado: datos de la fuente, hash de la respuesta y origen sin parámetros', async () => {
    const s = await servidorHttps((_q, res) => json(res, 200, RESPUESTA_VALIDA));
    try {
      const r = await montar(s.puerto).verificar(solicitud(s.puerto));
      expect(r.estado).toBe('verificado');
      if (r.estado !== 'verificado') return;
      expect(r.datosVerificados).toMatchObject({ fuente: 'verificador_prueba', numeroDocumento: '1032456786', estadoAfiliacion: 'ACTIVO' });
      expect(r.hashRespuesta).toMatch(/^[0-9a-f]{64}$/);
      expect(r.origen).toBe(`https://${HOST_PRUEBA}:${s.puerto}/verificar/ABC123`);
      expect(r.origen).not.toMatch(/[?#]/);
      expect(JSON.stringify(r)).not.toContain('SECRETO');
    } finally { await s.cerrar(); }
  });

  it('«NO_EXISTE» e «INVALIDO» solo cuando la fuente lo afirma de forma explícita', async () => {
    for (const [estado, codigo] of [['NO_EXISTE', 'certificado_no_encontrado'], ['INVALIDO', 'certificado_invalido']] as const) {
      const s = await servidorHttps((_q, res) => json(res, 200, { version: 1, estado }));
      try {
        const r = await montar(s.puerto).verificar(solicitud(s.puerto));
        expect(r).toMatchObject({ estado: 'rechazado', errorCodigo: codigo });
      } finally { await s.cerrar(); }
    }
  });

  it('un 404 con el JSON explícito de «no existe» se reconoce; un 404 sin él no es «falso»', async () => {
    const s = await servidorHttps((q, res) => (q.url?.includes('conocido') ? json(res, 404, { version: 1, estado: 'NO_EXISTE' }) : json(res, 404, { mensaje: 'x' })));
    try {
      const a = montar(s.puerto);
      expect(await a.verificar(solicitud(s.puerto, '/verificar/conocido'))).toMatchObject({ estado: 'rechazado', errorCodigo: 'certificado_no_encontrado' });
      expect(await a.verificar(solicitud(s.puerto, '/verificar/otro'))).toMatchObject({ estado: 'no_verificable', errorCodigo: 'respuesta_invalida' });
    } finally { await s.cerrar(); }
  });

  it.each([
    ['JSON inválido', '{no es json'],
    ['estructura cambiada (sitio rediseñado)', JSON.stringify({ resultado: 'ok', datos: { nombre: 'X' } })],
    ['versión desconocida', JSON.stringify({ version: 2, estado: 'VALIDO' })],
    ['estado desconocido', JSON.stringify({ version: 1, estado: 'QUIZAS' })],
    ['arreglo en vez de objeto', '[]'],
  ])('%s: no_verificable (respuesta_invalida), NUNCA auténtico', async (_c, cuerpo) => {
    const s = await servidorHttps((_q, res) => json(res, 200, cuerpo));
    try {
      expect(await montar(s.puerto).verificar(solicitud(s.puerto))).toMatchObject({ estado: 'no_verificable', errorCodigo: 'respuesta_invalida' });
    } finally { await s.cerrar(); }
  });

  it('portal caído, tiempo agotado y respuesta enorme → no_verificable con su código', async () => {
    const caido = await servidorHttps((_q, res) => json(res, 503, {}));
    const lento = await servidorHttps(() => { /* sin respuesta */ });
    const grande = await servidorHttps((_q, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '99999999' }); res.end('x'); });
    try {
      expect(await montar(caido.puerto).verificar(solicitud(caido.puerto))).toMatchObject({ estado: 'no_verificable', errorCodigo: 'verificador_no_disponible' });
      const impaciente = new VerificadorEpsHttpAdapter(new RegistroVerificadoresEps([definicionPrueba(lento.puerto)]), clientePruebas(), [new AdaptadorJsonSintetico()],
        { get: (k: string) => (k === 'VERIFICACION_EPS_TIMEOUT_MS' ? 300 : undefined) } as never);
      expect(await impaciente.verificar(solicitud(lento.puerto))).toMatchObject({ estado: 'no_verificable', errorCodigo: 'timeout' });
      expect(await montar(grande.puerto).verificar(solicitud(grande.puerto))).toMatchObject({ estado: 'no_verificable', errorCodigo: 'respuesta_demasiado_grande' });
    } finally { await Promise.all([caido.cerrar(), lento.cerrar(), grande.cerrar()]); }
  });

  it('sin adaptador específico no hay consulta; con interacción humana o credenciales tampoco', async () => {
    const s = await servidorHttps((_q, res) => json(res, 200, RESPUESTA_VALIDA));
    try {
      expect(await montar(s.puerto, []).verificar(solicitud(s.puerto))).toMatchObject({ estado: 'no_verificable', errorCodigo: 'verificador_no_disponible' });
      const humano = definicionPrueba(s.puerto, { requiereInteraccionHumana: true });
      expect(await montar(s.puerto, [new AdaptadorJsonSintetico()], humano).verificar(solicitud(s.puerto, undefined, humano)))
        .toMatchObject({ estado: 'no_verificable', errorCodigo: 'requiere_interaccion_humana' });
      const cred = definicionPrueba(s.puerto, { requiereCredenciales: true });
      expect(await montar(s.puerto, [new AdaptadorJsonSintetico()], cred).verificar(solicitud(s.puerto, undefined, cred)))
        .toMatchObject({ estado: 'no_verificable', errorCodigo: 'requiere_interaccion_humana' });
      expect(s.peticiones).toHaveLength(0);
    } finally { await s.cerrar(); }
  });

  it('una URL que no corresponde al verificador NO se consulta (host parecido, otro puerto, http)', async () => {
    const s = await servidorHttps((_q, res) => json(res, 200, RESPUESTA_VALIDA));
    try {
      const a = montar(s.puerto);
      for (const url of [
        `https://${HOST_PRUEBA}.atacante.test:${s.puerto}/verificar/1`, `https://${HOST_AJENO}:${s.puerto}/verificar/1`,
        `https://${HOST_PRUEBA}:${s.puerto + 1}/verificar/1`, `http://${HOST_PRUEBA}:${s.puerto}/verificar/1`, `https://${HOST_PRUEBA}:${s.puerto}/otra-ruta`,
      ]) {
        expect(await a.verificar({ url, verificador: definicionPrueba(s.puerto), datosCertificado: null })).toMatchObject({ estado: 'no_verificable', errorCodigo: 'host_no_permitido' });
      }
      expect(s.peticiones).toHaveLength(0);
    } finally { await s.cerrar(); }
  });
});

describe('Regresión Fase 6 · SSRF ampliada', () => {
  it.each([
    '192.0.0.1', '192.88.99.1', '240.0.0.1', '198.19.255.255', '203.0.113.7', '0.1.2.3',
    '2002:7f00:1::', '2002:a00:1::', '2001::1', '::ffff:0:127.0.0.1', '64:ff9b::a00:1', 'fec0::1', 'ff00::', '100::1',
  ])('rango reservado o de transición hacia una dirección interna: %s es privado', (d) => expect(esDireccionPrivada(d)).toBe(true));

  it.each(['169.254.169.254', '::ffff:169.254.169.254', '[fd00:ec2::254]', '100.100.100.200'])('metadatos de nube (%s) siempre bloqueados', (d) => expect(esDireccionPrivada(d)).toBe(true));

  it('DNS rebinding: cada petición resuelve UNA vez y usa esa resolución para conectar; un nombre que cambia a privado en la segunda se rechaza', async () => {
    let llamadas = 0;
    const c = new ClienteHttpSeguro({
      resolver: () => { llamadas += 1; return Promise.resolve([{ address: llamadas === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }]); },
    });
    // 1.ª resolución pública: pasa la validación (la conexión real falla o expira, no importa: nunca alcanza 127.0.0.1).
    await c.obtener(new URL('https://verificador.eps.example/x'), politica(443, { timeoutMs: 300 })).catch(() => undefined);
    // 2.ª resolución, ahora privada: se rechaza antes de conectar.
    await expect(c.obtener(new URL('https://verificador.eps.example/x'), politica(443))).rejects.toMatchObject({ codigo: 'host_no_permitido' });
    expect(llamadas).toBeGreaterThanOrEqual(2);
  });

  it.each([
    'https://127.0.0.1/x', 'https://[::1]/x', 'https://2130706433/x', 'https://0x7f.1/x', 'https://localhost/x', 'https://metadata.google.internal/x',
    'https://169.254.169.254/latest/meta-data', 'https://verificador.eps.example.atacante.test@127.0.0.1/x',
  ])('URL peligrosa %s: se rechaza sin conectar', async (u) => {
    const c = new ClienteHttpSeguro({ resolver: () => Promise.reject(new Error('no debe resolver')) });
    await expect(c.obtener(new URL(u), politica(443))).rejects.toBeInstanceOf(ErrorHttpSeguro);
  });

  it('INVENTARIO VACÍO ⇒ CERO SALIDA HTTP: con el registro real, ni resolver DNS ni abrir un socket', async () => {
    const { VERIFICADORES_EPS_OFICIALES } = await import('../src/domain/services/registro-verificadores-eps');
    expect(VERIFICADORES_EPS_OFICIALES).toEqual([]);
    let resoluciones = 0;
    const espiaDns = jest.spyOn(dns.promises, 'lookup').mockImplementation(() => { resoluciones += 1; return Promise.reject(new Error('sin red')); });
    const espiaRed = jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { resoluciones += 1; throw new Error('sin red'); });
    try {
      const adaptador = new VerificadorEpsHttpAdapter(new RegistroVerificadoresEps(VERIFICADORES_EPS_OFICIALES), new ClienteHttpSeguro(), []);
      const r = await adaptador.verificar({
        url: 'https://cualquier.eps.example/verificar/123', datosCertificado: null,
        verificador: { codigo: 'inexistente', emisor: 'X', aliasesEmisor: [], hostsPermitidos: ['cualquier.eps.example'], puertosPermitidos: [443], rutasPermitidas: ['/'], requiereInteraccionHumana: false, requiereCredenciales: false } as never,
      });
      expect(r).toMatchObject({ estado: 'no_verificable' });
      expect(resoluciones).toBe(0);
    } finally { espiaDns.mockRestore(); espiaRed.mockRestore(); }
  });
});
