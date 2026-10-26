import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { camposDe } from '../../../domain/entities/campos-extraccion';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  MODELO_OPENAI_PREDETERMINADO, TARIFA_RESPALDO, TarifaModelo, costoDe, esfuerzoEfectivo, tarifaDe,
} from '../../../domain/entities/tarifas-ia';
import { esquemaLectura } from '../../../domain/services/esquema-lectura';
import {
  ExtraccionIaPort, HallazgoCriterio, ResultadoExtraccion,
} from '../../../domain/ports/out/servicios-externos.port';
import {
  ConocimientoDocumentalDomainService,
} from '../../../domain/services/conocimiento-documental.domain-service';
import { DecodificadorImagenAdapter } from '../imagen/decodificador.adapter';

/**
 * Adaptador de OpenAI (Responses API) para la capa 2 del pipeline.
 *
 * Se activa con `IA_DRIVER=openai` y la llave inyectada desde Secret Manager.
 * Mismo puerto que el simulado y el de Anthropic: cambiar de proveedor no toca
 * el dominio. Lo que hace:
 *  · envía el documento (PDF o imagen) en base64 junto con la instrucción
 *    institucional de la base de conocimiento documental;
 *  · exige salida estructurada (`json_schema` estricto): el modelo no puede
 *    devolver campos inventados ni tipos fuera del catálogo;
 *  · valora cada lectura con la tarifa vigente a partir del `usage` real;
 *  · distingue fallos transitorios (429, 5xx, tiempo agotado) de definitivos
 *    (llave inválida, cuota agotada, esquema rechazado) y reintenta solo los
 *    primeros, una vez.
 *
 * Lo que NO hace: decidir. Si el modelo rehúsa, se corta o devuelve algo que no
 * cumple el esquema, el adaptador lanza y el pipeline manda el documento a
 * revisión humana.
 */

export const OPENAI_URL_BASE_PREDETERMINADA = 'https://api.openai.com/v1';

/** Formatos de imagen que la API admite tal cual; el resto se convierte a PNG. */
const MIME_IMAGEN_ADMITIDOS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Códigos 429 que no son de ritmo sino de saldo: reintentar no sirve. */
const CODIGOS_SIN_CUOTA = new Set([
  'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'billing_hard_limit_reached',
]);

/** Tokens que el proveedor facturó aunque la lectura no sirviera. */
export interface UsoFacturado {
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCache: number;
  tokensRazonamiento: number;
  costoUsd: number;
  /** El modelo no está en la tabla: se valoró con la tarifa de respaldo. */
  tarifaDesconocida: boolean;
}

export class ErrorProveedorIa extends Error {
  /** Segundos que pidió esperar el proveedor (cabecera Retry-After), si los dio. */
  retryAfterMs: number | null = null;
  /** Lo facturado por una respuesta inservible, para que el gasto no se pierda. */
  uso: UsoFacturado | null = null;
  /** Parámetro que el proveedor señaló como inválido (`error.param`). */
  parametro: string | null = null;

  constructor(
    mensaje: string,
    readonly transitorio: boolean,
    readonly estadoHttp: number | null = null,
    readonly codigo: string | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorProveedorIa';
  }
}

interface ParteArchivo {
  type: 'input_file' | 'input_image';
  filename?: string;
  file_data?: string;
  image_url?: string;
  detail?: 'high';
}

interface RespuestaOpenAi {
  id?: string;
  status?: 'completed' | 'incomplete' | 'failed' | 'in_progress' | 'cancelled' | 'queued';
  model?: string;
  error?: { message?: string; code?: string | null } | null;
  incomplete_details?: { reason?: string } | null;
  output?: {
    type: string;
    content?: { type: string; text?: string; refusal?: string }[];
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

interface LecturaModelo {
  tipo_detectado: string | null;
  ilegible: boolean;
  motivo_ilegible: string | null;
  campos: { nombre: string; valor: string | null; confianza: number; evidencia: string | null }[];
  criterios: { codigo: string; cumple: 'si' | 'no' | 'no_determinable'; detalle: string | null }[];
  resumen: string;
}

export { esquemaLectura };

@Injectable()
export class ExtraccionOpenAiAdapter implements ExtraccionIaPort {
  private readonly log = new Logger(ExtraccionOpenAiAdapter.name);
  private readonly conocimiento = new ConocimientoDocumentalDomainService();
  private readonly modelo: string;
  private readonly apiKey: string;
  private readonly urlBase: string;
  private readonly esfuerzo: string;
  private readonly tiempoMaximoMs: number;
  private readonly maxTokensSalida: number;
  private tarifaAvisada = false;
  private esfuerzoAvisado = false;

  constructor(
    config: ConfigService,
    private readonly decodificador: DecodificadorImagenAdapter,
  ) {
    this.modelo = config.get<string>('OPENAI_MODELO') ?? MODELO_OPENAI_PREDETERMINADO;
    this.apiKey = config.get<string>('OPENAI_API_KEY') ?? '';
    this.urlBase = (config.get<string>('OPENAI_URL_BASE') ?? OPENAI_URL_BASE_PREDETERMINADA).replace(/\/+$/, '');
    this.esfuerzo = config.get<string>('OPENAI_ESFUERZO') ?? 'low';
    this.tiempoMaximoMs = Number(config.get<string>('OPENAI_TIEMPO_MAXIMO_MS') ?? 120_000);
    this.maxTokensSalida = Number(config.get<string>('OPENAI_MAX_TOKENS_SALIDA') ?? 4_000);
  }

  get modeloConfigurado(): string {
    return this.modelo;
  }

  async extraer(
    contenido: Buffer,
    mime: string,
    tipoEsperado: TipoDocumento,
  ): Promise<ResultadoExtraccion> {
    const inicio = Date.now();
    const archivo = this.parteArchivo(contenido, mime);
    const criterios = this.conocimiento.criteriosEvaluables(tipoEsperado);
    const cuerpo = this.cuerpoPeticion(tipoEsperado, archivo, criterios.map((c) => c.codigo));
    const respuesta = await this.llamar(cuerpo);
    return this.interpretar(respuesta, tipoEsperado, criterios, Date.now() - inicio);
  }

  /**
   * Comprueba que la llave sirve, que el modelo existe (`GET /models/{modelo}`)
   * y que los parámetros configurados se aceptan, con una petición mínima real
   * de unos veinte tokens. Lo usa el diagnóstico de administración.
   */
  async verificarAcceso(): Promise<{ ok: boolean; detalle: string }> {
    if (!this.apiKey) return { ok: false, detalle: 'OPENAI_API_KEY no está configurada' };
    try {
      const respuesta = await fetch(`${this.urlBase}/models/${encodeURIComponent(this.modelo)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!respuesta.ok) {
        const cuerpo = await this.leerError(respuesta);
        return { ok: false, detalle: `OpenAI respondió ${respuesta.status}: ${cuerpo.mensaje}` };
      }
      // Una petición mínima de verdad (unos 20 tokens): detecta parámetros que
      // el modelo rechaza y que un GET /models nunca revelaría.
      const { razonador, esfuerzo } = this.razonamiento();
      const prueba = await fetch(`${this.urlBase}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.modelo,
          input: 'Responde solo: ok',
          max_output_tokens: 16,
          store: false,
          ...(razonador && esfuerzo ? { reasoning: { effort: esfuerzo } } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!prueba.ok) {
        const cuerpo = await this.leerError(prueba);
        return { ok: false, detalle: `Llave válida pero la petición de prueba falló (${prueba.status}): ${cuerpo.mensaje}` };
      }
      const sinTarifa = tarifaDe(this.modelo) ? '' : ' (sin tarifa registrada: se valorará con la tarifa de respaldo)';
      return { ok: true, detalle: `Llave válida; modelo ${this.modelo} responde con esfuerzo ${esfuerzo ?? 'sin razonamiento'}${sinTarifa}` };
    } catch (error) {
      return { ok: false, detalle: `Sin conexión con OpenAI: ${sanear((error as Error).message)}` };
    }
  }

  private parteArchivo(contenido: Buffer, mime: string): ParteArchivo {
    if (mime === 'application/pdf') {
      return {
        type: 'input_file',
        filename: 'documento.pdf',
        file_data: `data:application/pdf;base64,${contenido.toString('base64')}`,
        detail: 'high',
      };
    }
    if (mime.startsWith('image/')) {
      // HEIC, TIFF, BMP…: la API los rechaza y el decodificador local solo
      // entiende PNG y JPEG, así que no hay conversión posible: a revisión.
      if (!MIME_IMAGEN_ADMITIDOS.has(mime)) {
        throw new ErrorProveedorIa(`Formato de imagen no admitido por el proveedor: ${mime}`, false);
      }
      return {
        type: 'input_image',
        image_url: `data:${mime};base64,${contenido.toString('base64')}`,
        detail: 'high',
      };
    }
    throw new ErrorProveedorIa(`Tipo de archivo no admitido para lectura automática: ${mime}`, false);
  }

  private cuerpoPeticion(
    tipo: TipoDocumento,
    archivo: ParteArchivo,
    codigosCriterios: readonly string[],
  ): Record<string, unknown> {
    const { razonador, esfuerzo } = this.razonamiento();
    const cuerpo: Record<string, unknown> = {
      model: this.modelo,
      instructions: this.conocimiento.instruccionesPara(tipo),
      input: [
        {
          role: 'user',
          content: [
            archivo,
            {
              type: 'input_text',
              text:
                `Lee el documento adjunto, que el estudiante cargó como «${this.conocimiento.nombreDe(tipo)}» ` +
                `(código ${tipo}), y responde únicamente con el JSON del esquema.`,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'lectura_documento', strict: true, schema: esquemaLectura(tipo, codigosCriterios) },
        ...(razonador ? { verbosity: 'low' } : {}),
      },
      max_output_tokens: this.maxTokensSalida,
      store: false,
    };
    if (razonador && esfuerzo) cuerpo.reasoning = { effort: esfuerzo };
    else if (!razonador) cuerpo.temperature = 0;
    return cuerpo;
  }

  /**
   * Esfuerzo que admite el modelo configurado. Si el pedido no está entre los
   * admitidos (p. ej. `none` en gpt-6-astra) se degrada al vecino válido y se
   * avisa una vez; así una variable mal puesta no manda todo a revisión.
   */
  private razonamiento(): { razonador: boolean; esfuerzo: string | null } {
    const tarifa = tarifaDe(this.modelo)?.tarifa;
    if (!tarifa) {
      const razonador = /^(gpt-5|gpt-6|o\d)/.test(this.modelo);
      return { razonador, esfuerzo: razonador ? this.esfuerzo : null };
    }
    const { efectivo, degradado } = esfuerzoEfectivo(tarifa, this.esfuerzo);
    if (degradado && !this.esfuerzoAvisado) {
      this.esfuerzoAvisado = true;
      this.log.warn(`El modelo ${this.modelo} no admite OPENAI_ESFUERZO=${this.esfuerzo}; se usa ${efectivo ?? 'sin razonamiento'}`);
    }
    return { razonador: tarifa.razonador, esfuerzo: efectivo };
  }

  private async llamar(cuerpo: Record<string, unknown>): Promise<RespuestaOpenAi> {
    if (!this.apiKey) throw new ErrorProveedorIa('OPENAI_API_KEY no está configurada', false);
    let ultimo: ErrorProveedorIa | null = null;
    let sinDetalle = false;
    for (let intento = 1; intento <= 2; intento += 1) {
      try {
        return await this.peticion(cuerpo);
      } catch (error) {
        const e = error instanceof ErrorProveedorIa
          ? error
          : new ErrorProveedorIa((error as Error).message, this.esTransitorio(error as Error));
        ultimo = e;
        // Salvaguarda: si esta versión de la API no admite `detail` en el
        // archivo, se quita y se reintenta una sola vez. No cuenta como intento.
        if (e.estadoHttp === 400 && !sinDetalle && /unknown parameter.*detail/i.test(e.message)) {
          sinDetalle = true;
          quitarDetalleDeArchivos(cuerpo);
          this.log.warn('OpenAI rechazó `detail` en el archivo; se reintenta sin ese parámetro');
          intento -= 1;
          continue;
        }
        // Salvaguarda: un modelo que no admite el esfuerzo configurado (p. ej.
        // `none` en gpt-6-astra) baja a `low`; si tampoco, se omite el parámetro.
        if (
          e.estadoHttp === 400 && cuerpo.reasoning &&
          (e.parametro === 'reasoning.effort' || e.codigo === 'unsupported_value' || /reasoning|effort|supported values/i.test(e.message))
        ) {
          const actual = (cuerpo.reasoning as { effort?: string }).effort;
          if (actual !== 'low') cuerpo.reasoning = { effort: 'low' };
          else delete cuerpo.reasoning;
          this.log.warn(`OpenAI rechazó reasoning.effort=${actual}; se reintenta con ${cuerpo.reasoning ? 'low' : 'el valor por defecto del modelo'}`);
          intento -= 1;
          continue;
        }
        if (!e.transitorio || intento === 2) throw e;
        this.log.warn(`OpenAI: fallo transitorio (${e.message}); se reintenta una vez`);
        await esperar(Math.min(e.retryAfterMs ?? (e.estadoHttp === 429 ? 3_000 : 1_500), 15_000));
      }
    }
    throw ultimo ?? new ErrorProveedorIa('Fallo desconocido al llamar a OpenAI', false);
  }

  private async peticion(cuerpo: Record<string, unknown>): Promise<RespuestaOpenAi> {
    const respuesta = await fetch(`${this.urlBase}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(this.tiempoMaximoMs),
    });
    if (!respuesta.ok) {
      const { mensaje, codigo, parametro } = await this.leerError(respuesta);
      const estado = respuesta.status;
      const transitorio =
        estado >= 500 || estado === 408 || (estado === 429 && !(codigo && CODIGOS_SIN_CUOTA.has(codigo)));
      const error = new ErrorProveedorIa(`OpenAI respondió ${estado}: ${mensaje}`, transitorio, estado, codigo);
      error.parametro = parametro;
      const retryAfter = Number(respuesta.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.round(retryAfter * 1000);
      throw error;
    }
    const cuerpoRespuesta = (await respuesta.json()) as RespuestaOpenAi;
    // Un 200 con `error` o `status: failed` es un fallo como cualquier otro:
    // se clasifica aquí para que el reintento lo cubra, y lleva lo facturado.
    if (cuerpoRespuesta.error?.message || cuerpoRespuesta.status === 'failed') {
      const codigo = cuerpoRespuesta.error?.code ?? null;
      const mensaje = cuerpoRespuesta.error?.message ?? 'El proveedor marcó la respuesta como fallida';
      const transitorio = !cuerpoRespuesta.error?.message
        || /server_error|overloaded|service_unavailable/i.test(`${codigo ?? ''} ${mensaje}`);
      const error = new ErrorProveedorIa(`OpenAI devolvió error: ${mensaje}`, transitorio, null, codigo);
      error.uso = this.usoFacturado(cuerpoRespuesta.model ?? this.modelo, cuerpoRespuesta);
      throw error;
    }
    return cuerpoRespuesta;
  }

  private async leerError(respuesta: Response): Promise<{ mensaje: string; codigo: string | null; parametro: string | null }> {
    const texto = await respuesta.text();
    try {
      const json = JSON.parse(texto) as {
        error?: { message?: string; code?: string | null; type?: string; param?: string | null };
      };
      return {
        mensaje: sanear(json.error?.message ?? texto.slice(0, 300)),
        codigo: json.error?.code ?? json.error?.type ?? null,
        parametro: json.error?.param ?? null,
      };
    } catch {
      return { mensaje: sanear(texto.slice(0, 300)), codigo: null, parametro: null };
    }
  }

  private esTransitorio(error: Error): boolean {
    return /TimeoutError|AbortError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i.test(
      `${error.name} ${error.message}`,
    );
  }

  private interpretar(
    respuesta: RespuestaOpenAi,
    tipoEsperado: TipoDocumento,
    criterios: ReturnType<ConocimientoDocumentalDomainService['criteriosEvaluables']>,
    duracionMs: number,
  ): ResultadoExtraccion {
    // Una respuesta inservible también se facturó: el error lleva el uso para
    // que el pipeline lo registre y el tope diario no lo pierda.
    const modelo = respuesta.model ?? this.modelo;
    const facturado = this.usoFacturado(modelo, respuesta);
    const fallo = (mensaje: string): ErrorProveedorIa => {
      const error = new ErrorProveedorIa(mensaje, false);
      error.uso = facturado;
      return error;
    };
    if (respuesta.status === 'incomplete') {
      const motivo = respuesta.incomplete_details?.reason ?? 'desconocido';
      throw fallo(`Respuesta incompleta del modelo (${motivo})`);
    }
    const mensaje = respuesta.output?.find((o) => o.type === 'message');
    const rehusado = mensaje?.content?.find((c) => c.type === 'refusal');
    if (rehusado) throw fallo(`El modelo rehusó leer el documento: ${rehusado.refusal ?? ''}`);
    const texto = mensaje?.content?.find((c) => c.type === 'output_text')?.text;
    if (!texto) throw fallo('La respuesta del modelo no trae texto');

    let lectura: LecturaModelo;
    try {
      lectura = JSON.parse(texto) as LecturaModelo;
    } catch {
      throw fallo('La respuesta del modelo no es JSON válido');
    }

    const campos: ResultadoExtraccion['campos'] = {};
    const porNombre = new Map((lectura.campos ?? []).map((c) => [c.nombre, c]));
    for (const nombre of camposDe(tipoEsperado)) {
      const leido = porNombre.get(nombre);
      const valor = typeof leido?.valor === 'string' && leido.valor.trim() !== '' ? leido.valor.trim() : null;
      campos[nombre] = {
        valor,
        confianza: valor === null ? 0 : acotar(Number(leido?.confianza ?? 0)),
        evidencia: typeof leido?.evidencia === 'string' && leido.evidencia.trim() !== '' ? leido.evidencia : null,
      };
    }

    // Un código por hallazgo: si el modelo repite uno, vale la última respuesta
    // (igual que con los campos), para que no pese dos veces en el puntaje.
    const porCodigo = new Map(criterios.map((c) => [c.codigo, c]));
    const respondidos = new Map<string, HallazgoCriterio>();
    for (const respondido of lectura.criterios ?? []) {
      const criterio = porCodigo.get(respondido.codigo);
      if (!criterio) continue;
      respondidos.set(criterio.codigo, {
        codigo: criterio.codigo,
        enunciado: criterio.enunciado,
        cumple: ['si', 'no', 'no_determinable'].includes(respondido.cumple) ? respondido.cumple : 'no_determinable',
        detalle: respondido.detalle ?? null,
        causalDevolucion: criterio.causalDevolucion,
      });
    }
    // Un criterio que el modelo no respondió no desaparece: queda como «no
    // determinable» y el revisor lo ve en la lista de chequeo.
    for (const criterio of criterios) {
      if (respondidos.has(criterio.codigo)) continue;
      respondidos.set(criterio.codigo, {
        codigo: criterio.codigo,
        enunciado: criterio.enunciado,
        cumple: 'no_determinable',
        detalle: 'El modelo no respondió este criterio',
        causalDevolucion: criterio.causalDevolucion,
      });
    }
    const hallazgos = [...respondidos.values()];

    const tipos = new Set<string>(Object.values(TipoDocumento));
    const tipoDetectado = lectura.tipo_detectado && tipos.has(lectura.tipo_detectado)
      ? (lectura.tipo_detectado as TipoDocumento)
      : null;

    this.log.debug(
      `OpenAI ${tipoEsperado} con ${modelo}: ${facturado.tokensEntrada} entrada (${facturado.tokensCache} caché) / ` +
        `${facturado.tokensSalida} salida (${facturado.tokensRazonamiento} razonamiento), ${facturado.costoUsd} USD, ${duracionMs} ms`,
    );

    return {
      tipoDetectado,
      campos,
      ilegible: lectura.ilegible === true,
      modelo,
      tokensEntrada: facturado.tokensEntrada,
      tokensSalida: facturado.tokensSalida,
      costoUsd: facturado.costoUsd,
      hallazgos,
      motivoIlegible: lectura.motivo_ilegible ?? null,
      resumen: typeof lectura.resumen === 'string' ? lectura.resumen.slice(0, 500) : null,
      proveedor: 'openai',
      tokensCache: facturado.tokensCache,
      tokensRazonamiento: facturado.tokensRazonamiento,
      duracionMs,
      ...(facturado.tarifaDesconocida ? { tarifaDesconocida: true } : {}),
    };
  }

  private usoFacturado(modelo: string, respuesta: RespuestaOpenAi): UsoFacturado {
    const uso = respuesta.usage ?? {};
    const entrada = uso.input_tokens ?? 0;
    const salida = uso.output_tokens ?? 0;
    const cache = uso.input_tokens_details?.cached_tokens ?? 0;
    const escrituraCache = uso.input_tokens_details?.cache_write_tokens ?? 0;
    const { costoUsd, tarifaDesconocida } = this.valorar(modelo, { entrada, salida, cache, escrituraCache });
    return {
      modelo,
      tokensEntrada: entrada,
      tokensSalida: salida,
      tokensCache: cache,
      tokensRazonamiento: uso.output_tokens_details?.reasoning_tokens ?? 0,
      costoUsd,
      tarifaDesconocida,
    };
  }

  /**
   * Valora la lectura. Un modelo fuera de la tabla no vale 0 (eso anularía el
   * tope diario): se cobra con la tarifa de respaldo y queda marcado.
   */
  private valorar(
    modelo: string,
    uso: { entrada: number; salida: number; cache: number; escrituraCache: number },
  ): { costoUsd: number; tarifaDesconocida: boolean } {
    const resuelta = tarifaDe(modelo);
    if (!resuelta) {
      if (!this.tarifaAvisada) {
        this.tarifaAvisada = true;
        this.log.warn(
          `Sin tarifa registrada para el modelo ${modelo}: se valora con la tarifa de respaldo ` +
            `(${TARIFA_RESPALDO.entradaUsdPorMillon}/${TARIFA_RESPALDO.salidaUsdPorMillon} USD por millón) hasta actualizar la tabla`,
        );
      }
      return { costoUsd: costoDe(TARIFA_RESPALDO, uso), tarifaDesconocida: true };
    }
    const tarifa: TarifaModelo = resuelta.tarifa;
    return { costoUsd: costoDe(tarifa, uso), tarifaDesconocida: false };
  }
}

/** Ningún texto del proveedor viaja a banderas o logs con una llave dentro. */
function sanear(texto: string): string {
  return texto.replace(/sk-[A-Za-z0-9_\-*…]{4,}/g, 'sk-***');
}

function quitarDetalleDeArchivos(cuerpo: Record<string, unknown>): void {
  const entrada = cuerpo.input as { content?: Record<string, unknown>[] }[] | undefined;
  for (const mensaje of entrada ?? []) {
    for (const parte of mensaje.content ?? []) {
      if (parte.type === 'input_file' || parte.type === 'input_image') delete parte.detail;
    }
  }
}

function acotar(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}
