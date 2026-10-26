import { Injectable } from '@nestjs/common';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { CodigoErrorVerificacion } from '../../../domain/ports/out/verificador-certificado-eps.port';
import { esDireccionPrivada, esHostIpLiteral, esNombreInterno } from './direcciones-ip';

/**
 * Cliente HTTP de SALIDA con defensa contra SSRF, para consultar verificadores
 * oficiales. Es la única vía por la que SIPRA se conecta a un destino tomado de
 * un documento subido por un usuario, y por eso nunca se le pasa «lo que diga el QR»:
 * quien llama ya resolvió la URL contra el registro de verificadores.
 *
 * Capas (todas obligatorias):
 *  1. esquema https, sin usuario:clave, sin IP literal ni nombres internos, puerto permitido;
 *  2. el nombre se resuelve AQUÍ y TODAS las direcciones devueltas deben ser públicas; la
 *     conexión usa esa misma respuesta (el `lookup` es el de la conexión), de modo que no hay
 *     una segunda resolución que un atacante pueda cambiar (DNS rebinding);
 *  3. sin redirecciones salvo las que la política permite, cada una revalidada de cero;
 *  4. tiempo total, tamaño máximo, Content-Type esperado y sin compresión;
 *  5. sin cookies, sin credenciales, sin ejecutar nada: se lee el cuerpo y se descarta el resto.
 */

export class ErrorHttpSeguro extends Error {
  constructor(public readonly codigo: CodigoErrorVerificacion, detalle: string) {
    super(detalle);
    this.name = 'ErrorHttpSeguro';
  }
}

export interface PoliticaHttp {
  timeoutMs: number;
  maxBytes: number;
  contentTypes: readonly string[];
  puertosPermitidos: readonly number[];
  maxRedirecciones: number;
  /** ¿Se acepta ir a este destino al seguir una redirección? (allowlist del verificador). */
  destinoRedireccionPermitido: (destino: URL) => boolean;
  accept?: string;
}

export interface RespuestaHttpSegura {
  status: number;
  contentType: string;
  cuerpo: Buffer;
  urlFinal: URL;
  redirecciones: number;
}

export type ResolverNombre = (host: string) => Promise<Array<{ address: string; family: number }>>;

export interface OpcionesClienteHttp {
  resolver?: ResolverNombre;
  /**
   * SOLO PARA PRUEBAS: permite http y direcciones internas (servidores locales
   * sintéticos). La aplicación nunca lo activa; no hay variable de entorno que lo haga.
   */
  soloPruebas?: { permitirHttp?: boolean; permitirDireccionesPrivadas?: boolean; ca?: string };
}

const AGENTE_USUARIO = 'SIPRA-Verificacion/1.0 (+Corporacion Unificada Nacional de Educacion Superior)';
const resolverDelSistema: ResolverNombre = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

@Injectable()
export class ClienteHttpSeguro {
  private readonly resolver: ResolverNombre;
  private readonly pruebas: NonNullable<OpcionesClienteHttp['soloPruebas']>;

  constructor(opciones: OpcionesClienteHttp = {}) {
    this.resolver = opciones.resolver ?? resolverDelSistema;
    this.pruebas = opciones.soloPruebas ?? {};
  }

  /** Comprobaciones de la URL ANTES de cualquier conexión. */
  validarDestino(url: URL, politica: PoliticaHttp): void {
    const esquemaOk = url.protocol === 'https:' || (this.pruebas.permitirHttp === true && url.protocol === 'http:');
    if (!esquemaOk) throw new ErrorHttpSeguro('host_no_permitido', 'esquema no permitido');
    if (url.username || url.password) throw new ErrorHttpSeguro('host_no_permitido', 'credenciales en la URL');
    const host = url.hostname;
    if (!this.pruebas.permitirDireccionesPrivadas) {
      if (esHostIpLiteral(host)) throw new ErrorHttpSeguro('host_no_permitido', 'IP literal');
      if (esNombreInterno(host)) throw new ErrorHttpSeguro('host_no_permitido', 'nombre interno');
    }
    const puerto = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
    if (!politica.puertosPermitidos.includes(puerto)) throw new ErrorHttpSeguro('host_no_permitido', 'puerto no permitido');
  }

  /**
   * `lookup` de la CONEXIÓN: resuelve, exige que todas las direcciones sean públicas
   * y devuelve exactamente esas. Una dirección privada entre las respuestas aborta.
   */
  private lookupSeguro(host: string) {
    return (
      _nombre: string, opciones: dns.LookupOptions | undefined,
      cb: (err: NodeJS.ErrnoException | null, direccion?: string | dns.LookupAddress[], familia?: number) => void,
    ): void => {
      this.resolver(host).then((direcciones) => {
        if (direcciones.length === 0) throw new ErrorHttpSeguro('verificador_no_disponible', 'sin direcciones');
        if (!this.pruebas.permitirDireccionesPrivadas && direcciones.some((d) => esDireccionPrivada(d.address))) {
          throw new ErrorHttpSeguro('host_no_permitido', 'el nombre resuelve a una dirección no pública');
        }
        if (opciones?.all) cb(null, direcciones.map((d) => ({ address: d.address, family: d.family })));
        else cb(null, direcciones[0].address, direcciones[0].family);
      }).catch((e: unknown) => cb(e as NodeJS.ErrnoException));
    };
  }

  async obtener(inicial: URL, politica: PoliticaHttp): Promise<RespuestaHttpSegura> {
    const limite = Date.now() + politica.timeoutMs;
    let url = inicial;
    for (let redirecciones = 0; ; redirecciones += 1) {
      this.validarDestino(url, politica);
      const r = await this.pedir(url, politica, limite);
      if (r.status >= 300 && r.status < 400 && r.location !== null) {
        if (redirecciones >= politica.maxRedirecciones) {
          throw new ErrorHttpSeguro('redireccion_no_permitida', 'redirección no permitida o excede el máximo');
        }
        let destino: URL;
        try { destino = new URL(r.location, url); } catch { throw new ErrorHttpSeguro('redireccion_no_permitida', 'Location inválida'); }
        // https→http nunca; y el destino debe pasar de nuevo la allowlist del verificador.
        if (url.protocol === 'https:' && destino.protocol !== 'https:') {
          throw new ErrorHttpSeguro('redireccion_no_permitida', 'degradación de https a http');
        }
        if (!politica.destinoRedireccionPermitido(destino)) {
          throw new ErrorHttpSeguro('redireccion_no_permitida', 'destino fuera de la allowlist');
        }
        url = destino;
        continue;
      }
      if (r.status >= 300 && r.status < 400) throw new ErrorHttpSeguro('redireccion_no_permitida', 'redirección sin destino');
      this.validarEstadoYContenido(r, politica);
      return { status: r.status, contentType: r.contentType, cuerpo: r.cuerpo, urlFinal: url, redirecciones };
    }
  }

  private validarEstadoYContenido(r: { status: number; contentType: string; contentEncoding: string }, p: PoliticaHttp): void {
    if (r.status >= 500 || r.status === 408 || r.status === 429) throw new ErrorHttpSeguro('verificador_no_disponible', `estado ${r.status}`);
    // 404 llega al adaptador, que puede reconocer un «no existe» explícito; otros 4xx no tienen significado.
    if (r.status >= 400 && r.status !== 404) throw new ErrorHttpSeguro('respuesta_invalida', `estado ${r.status}`);
    if (r.contentEncoding && r.contentEncoding !== 'identity') throw new ErrorHttpSeguro('contenido_no_esperado', 'respuesta comprimida');
    if (!p.contentTypes.includes(r.contentType)) throw new ErrorHttpSeguro('contenido_no_esperado', 'Content-Type no esperado');
  }

  private pedir(url: URL, politica: PoliticaHttp, limite: number): Promise<{
    status: number; contentType: string; contentEncoding: string; cuerpo: Buffer; location: string | null;
  }> {
    return new Promise((resolver, rechazar) => {
      const restante = limite - Date.now();
      if (restante <= 0) { rechazar(new ErrorHttpSeguro('timeout', 'tiempo agotado')); return; }
      const modulo = url.protocol === 'https:' ? https : http;
      let terminado = false;
      const terminar = (fn: () => void): void => { if (!terminado) { terminado = true; clearTimeout(temporizador); fn(); } };
      const peticion = modulo.request({
        protocol: url.protocol, hostname: url.hostname, port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`, method: 'GET', agent: false,
        // Sin cookies ni credenciales; sin compresión (evita bombas de descompresión).
        headers: {
          'User-Agent': AGENTE_USUARIO, Accept: politica.accept ?? 'application/json', 'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        // El nombre de host viaja en la URL: SNI y verificación del certificado TLS los hace Node con él.
        ...(isIP(url.hostname) === 0 ? { lookup: this.lookupSeguro(url.hostname) as never } : {}),
        ...(this.pruebas.ca ? { ca: this.pruebas.ca } : {}),
      }, (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        const contentType = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const contentEncoding = (res.headers['content-encoding'] ?? '').toString().toLowerCase();
        const declarado = Number(res.headers['content-length'] ?? 0);
        if (declarado > politica.maxBytes) {
          terminar(() => rechazar(new ErrorHttpSeguro('respuesta_demasiado_grande', 'Content-Length excede el máximo')));
          res.destroy();
          return;
        }
        const partes: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > politica.maxBytes) {
            // Primero se resuelve el resultado; destruir la conexión dispara otros eventos que ya no cuentan.
            terminar(() => rechazar(new ErrorHttpSeguro('respuesta_demasiado_grande', 'el cuerpo excede el máximo')));
            res.destroy();
            peticion.destroy();
            return;
          }
          partes.push(c);
        });
        res.on('end', () => terminar(() => resolver({ status, contentType, contentEncoding, cuerpo: Buffer.concat(partes), location })));
        res.on('error', () => terminar(() => rechazar(new ErrorHttpSeguro('verificador_no_disponible', 'error leyendo la respuesta'))));
        res.on('aborted', () => terminar(() => rechazar(new ErrorHttpSeguro('verificador_no_disponible', 'respuesta interrumpida'))));
      });
      const temporizador = setTimeout(() => {
        peticion.destroy();
        terminar(() => rechazar(new ErrorHttpSeguro('timeout', 'tiempo agotado')));
      }, restante);
      temporizador.unref();
      peticion.on('error', (e: Error) => {
        // Un rechazo nuestro (dirección privada) conserva su código; un fallo de red es «no disponible».
        terminar(() => rechazar(e instanceof ErrorHttpSeguro ? e : new ErrorHttpSeguro('verificador_no_disponible', 'fallo de conexión')));
      });
      peticion.end();
    });
  }
}
