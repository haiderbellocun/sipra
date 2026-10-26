import https from 'node:https';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AdaptadorRespuestaEps, InterpretacionRespuestaEps,
} from '../src/domain/ports/out/verificador-certificado-eps.port';
import { VerificadorEpsDefinicion } from '../src/domain/services/registro-verificadores-eps';
import { ClienteHttpSeguro } from '../src/infrastructure/adapters/verificacion-eps/cliente-http-seguro';
import { crearCertificadoAutofirmado } from './soporte-certificado';

/**
 * Verificadores SINTÉTICOS para las pruebas: servidores HTTPS locales y un
 * adaptador de ejemplo. Ninguna prueba toca un portal real ni depende de Internet.
 */

export const HOST_PRUEBA = 'verificador.eps-prueba.test';
export const HOST_REDIRECCION = 'redirigido.eps-prueba.test';
export const HOST_AJENO = 'otro.eps-prueba.test';

const tls = crearCertificadoAutofirmado([HOST_PRUEBA, HOST_REDIRECCION, HOST_AJENO]);

export type Manejador = (req: IncomingMessage, res: ServerResponse) => void;

export interface ServidorPrueba {
  puerto: number;
  /** Peticiones recibidas (método, ruta con query, cabeceras). */
  peticiones: Array<{ metodo: string; url: string; cabeceras: IncomingMessage['headers'] }>;
  cerrar(): Promise<void>;
}

export async function servidorHttps(manejador: Manejador): Promise<ServidorPrueba> {
  const peticiones: ServidorPrueba['peticiones'] = [];
  const servidor = https.createServer({ key: tls.clave, cert: tls.certificado }, (req, res) => {
    peticiones.push({ metodo: req.method ?? '', url: req.url ?? '', cabeceras: req.headers });
    manejador(req, res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  return {
    puerto: (servidor.address() as AddressInfo).port,
    peticiones,
    cerrar: () => new Promise<void>((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); }),
  };
}

export const json = (res: ServerResponse, estado: number, cuerpo: unknown, tipo = 'application/json'): void => {
  res.writeHead(estado, { 'Content-Type': tipo });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
};

/** Cliente de pruebas: todos los nombres de prueba resuelven a 127.0.0.1 y confía en el certificado sintético. */
export function clientePruebas(): ClienteHttpSeguro {
  return new ClienteHttpSeguro({
    resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    soloPruebas: { permitirDireccionesPrivadas: true, ca: tls.certificado },
  });
}

export function definicionPrueba(puerto: number, extra: Partial<VerificadorEpsDefinicion> = {}): VerificadorEpsDefinicion {
  return {
    codigo: 'verificador_prueba',
    emisor: 'EPS Sintetica',
    aliasesEmisor: ['EPS SINTETICA S.A.S.', 'Sintetica Salud'],
    hostsPermitidos: [HOST_PRUEBA],
    puertosPermitidos: [puerto],
    prefijosRuta: ['/verificar/'],
    formato: 'json',
    contentTypes: ['application/json'],
    autenticaCertificado: true,
    confirmaAfiliacion: true,
    requiereInteraccionHumana: false,
    requiereCredenciales: false,
    fuenteOficial: 'Documento de prueba (sintético, no es un portal real)',
    aprobadoPor: 'pruebas automatizadas',
    aprobadoEn: '2026-10-26',
    ...extra,
  };
}

/**
 * Adaptador de EJEMPLO para el verificador sintético: reconoce POSITIVAMENTE
 * `{"estado":"VALIDO", ...}`, `{"estado":"NO_EXISTE"}` y `{"estado":"INVALIDO"}`.
 * Cualquier otra estructura es «no reconocida» (falla cerrado).
 */
export class AdaptadorJsonSintetico implements AdaptadorRespuestaEps {
  constructor(readonly codigoVerificador = 'verificador_prueba') {}

  interpretar(cuerpo: string): InterpretacionRespuestaEps {
    let o: unknown;
    try { o = JSON.parse(cuerpo); } catch { return { tipo: 'estructura_no_reconocida' }; }
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return { tipo: 'estructura_no_reconocida' };
    const r = o as Record<string, unknown>;
    const texto = (k: string): string | null => (typeof r[k] === 'string' && (r[k]).length > 0 ? (r[k]) : null);
    if (r.version !== 1) return { tipo: 'estructura_no_reconocida' };
    if (r.estado === 'NO_EXISTE') return { tipo: 'rechazado', errorCodigo: 'certificado_no_encontrado' };
    if (r.estado === 'INVALIDO') return { tipo: 'rechazado', errorCodigo: 'certificado_invalido' };
    if (r.estado !== 'VALIDO') return { tipo: 'estructura_no_reconocida' };
    return {
      tipo: 'verificado',
      datos: {
        numeroDocumento: texto('documento'), nombre: texto('nombre'), eps: texto('eps'), regimen: texto('regimen'),
        estadoAfiliacion: texto('estado_afiliacion'), fechaExpedicion: texto('fecha_expedicion'),
      },
    };
  }
}

export const RESPUESTA_VALIDA = {
  version: 1, estado: 'VALIDO', documento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ',
  eps: 'EPS Sintetica', regimen: 'Contributivo', estado_afiliacion: 'ACTIVO', fecha_expedicion: '2026-10-20',
};
