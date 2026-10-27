import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  ADAPTADORES_RESPUESTA_EPS, AdaptadorRespuestaEps, CodigoErrorVerificacion, ResultadoVerificacionEps,
  SolicitudVerificacionEps, VerificadorCertificadoEpsPort,
} from '../../../domain/ports/out/verificador-certificado-eps.port';
import { REGISTRO_VERIFICADORES_EPS, RegistroVerificadoresEps } from '../../../domain/services/registro-verificadores-eps';
import { ClienteHttpSeguro, ErrorHttpSeguro, PoliticaHttp } from './cliente-http-seguro';

export const TIMEOUT_VERIFICACION_MS = 8_000;
export const MAX_BYTES_VERIFICACION = 256 * 1024;

/**
 * Verificador por HTTP contra un mecanismo OFICIAL registrado. Cada verificador
 * tiene su adaptador específico (qué campos espera, cómo reconoce éxito y rechazo);
 * no hay un lector universal de páginas. Sin adaptador, no hay consulta.
 *
 * Falla cerrado: caídas, tiempos, respuestas inesperadas o cambios del sitio
 * producen `no_verificable`, jamás «auténtico» ni «falso».
 */
@Injectable()
export class VerificadorEpsHttpAdapter implements VerificadorCertificadoEpsPort {
  private readonly log = new Logger(VerificadorEpsHttpAdapter.name);
  private readonly adaptadores = new Map<string, AdaptadorRespuestaEps>();
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    @Inject(REGISTRO_VERIFICADORES_EPS) private readonly registro: RegistroVerificadoresEps,
    private readonly cliente: ClienteHttpSeguro,
    @Inject(ADAPTADORES_RESPUESTA_EPS) adaptadores: readonly AdaptadorRespuestaEps[],
    @Optional() config?: ConfigService,
  ) {
    for (const a of adaptadores) this.adaptadores.set(a.codigoVerificador, a);
    this.timeoutMs = Number(config?.get('VERIFICACION_EPS_TIMEOUT_MS') ?? TIMEOUT_VERIFICACION_MS);
    this.maxBytes = Number(config?.get('VERIFICACION_EPS_MAX_BYTES') ?? MAX_BYTES_VERIFICACION);
  }

  async verificar(s: SolicitudVerificacionEps): Promise<ResultadoVerificacionEps> {
    const ahora = new Date();
    const v = s.verificador;
    const sinConsulta = (errorCodigo: CodigoErrorVerificacion, origen = ''): ResultadoVerificacionEps => ({
      estado: 'no_verificable', errorCodigo, verificador: v.codigo, verificadoEn: ahora, origen, hashRespuesta: null, httpStatus: null, bytes: 0,
    });

    // Defensa en profundidad: aunque quien llama ya resolvió el destino, se vuelve a resolver aquí.
    const destino = this.registro.resolver(s.url);
    if (!destino.permitido || destino.verificador.codigo !== v.codigo) return sinConsulta('host_no_permitido');
    if (!RegistroVerificadoresEps.puedeConsultarse(v)) return sinConsulta('requiere_interaccion_humana');
    const adaptador = this.adaptadores.get(v.codigo);
    if (!adaptador) return sinConsulta('verificador_no_disponible');

    const origen = `${destino.url.protocol}//${destino.url.host}${destino.url.pathname}`.replace(/[?#]/g, '');
    const politica: PoliticaHttp = {
      timeoutMs: this.timeoutMs,
      maxBytes: this.maxBytes,
      contentTypes: v.contentTypes,
      puertosPermitidos: v.puertosPermitidos ?? [443],
      maxRedirecciones: v.maxRedirecciones ?? 0,
      destinoRedireccionPermitido: (d) => d.protocol === 'https:' && (v.hostsRedireccionPermitidos ?? []).includes(d.hostname.toLowerCase())
        && this.registro.resolver(d.href).permitido,
      accept: v.formato === 'json' ? 'application/json' : 'text/html',
    };

    let r;
    try {
      r = await this.cliente.obtener(destino.url, politica);
    } catch (error) {
      const codigo = error instanceof ErrorHttpSeguro ? error.codigo : 'verificador_no_disponible';
      // Solo el código: ni la URL ni el detalle del error (podrían llevar el identificador del certificado).
      this.log.warn(`Verificador ${v.codigo}: consulta sin resultado (${codigo})`);
      return sinConsulta(codigo, origen);
    }

    const hash = createHash('sha256').update(r.cuerpo).digest('hex');
    const base = { verificador: v.codigo, verificadoEn: ahora, origen, hashRespuesta: hash, httpStatus: r.status, bytes: r.cuerpo.length };
    let interpretacion;
    try {
      interpretacion = adaptador.interpretar(r.cuerpo.toString('utf8'), s);
    } catch {
      return { ...base, estado: 'no_verificable', errorCodigo: 'respuesta_invalida' };
    }
    if (interpretacion.tipo === 'verificado') {
      return {
        ...base, estado: 'verificado',
        datosVerificados: { ...interpretacion.datos, fuente: v.codigo, verificadoEn: ahora.toISOString() },
      };
    }
    if (interpretacion.tipo === 'rechazado') return { ...base, estado: 'rechazado', errorCodigo: interpretacion.errorCodigo };
    return { ...base, estado: 'no_verificable', errorCodigo: 'respuesta_invalida' };
  }
}
