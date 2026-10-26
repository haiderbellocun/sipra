import { Injectable, Logger } from '@nestjs/common';
import { inflateSync } from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import { Bandera, SeveridadBandera, TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  CoherenciaCruzadaPort, ExtraccionIaPort, HallazgoCriterio, ResultadoExtraccion,
} from '../../../domain/ports/out/servicios-externos.port';
import { CAMPOS_POR_TIPO as CAMPOS } from '../../../domain/entities/campos-extraccion';
import {
  ConocimientoDocumentalDomainService,
} from '../../../domain/services/conocimiento-documental.domain-service';

/**
 * El esquema de campos por tipo vive en el dominio (`campos-extraccion.ts`) y la
 * instrucción institucional sale de la base de conocimiento documental. Se
 * reexportan aquí para no romper a quien ya los importaba del adaptador.
 */
export { CAMPOS_POR_TIPO } from '../../../domain/entities/campos-extraccion';

const conocimiento = new ConocimientoDocumentalDomainService();

/** Instrucción completa para un tipo documental (criterios del manual incluidos). */
export function construirPrompt(tipo: TipoDocumento): string {
  return conocimiento.instruccionesPara(tipo);
}

/**
 * Forma del JSON para proveedores sin salida estructurada por esquema: la
 * instrucción institucional dice QUÉ leer; esto dice CÓMO devolverlo.
 */
export function formatoJsonLibre(tipo: TipoDocumento): string {
  const campos = conocimiento.tiposConConocimiento().includes(tipo) ? CAMPOS[tipo] ?? [] : [];
  const criterios = conocimiento.criteriosEvaluables(tipo).map((c) => c.codigo);
  return [
    '',
    '══ FORMA EXACTA DE LA RESPUESTA (solo JSON, sin comentarios ni bloques de código) ══',
    '{',
    '  "tipo_detectado": "<código del catálogo o null>",',
    '  "ilegible": <true|false>,',
    '  "motivo_ilegible": "<texto o null>",',
    '  "campos": {',
    ...campos.map((c, i) =>
      `    "${c}": { "valor": <string|null>, "confianza": <0.0-1.0>, "evidencia": <string|null> }${i < campos.length - 1 ? ',' : ''}`),
    '  },',
    '  "criterios": [',
    ...criterios.map((c, i) =>
      `    { "codigo": "${c}", "cumple": "si"|"no"|"no_determinable", "detalle": <string|null> }${i < criterios.length - 1 ? ',' : ''}`),
    '  ],',
    '  "resumen": "<una frase sobre qué es el documento>"',
    '}',
  ].join('\n');
}

/**
 * Adaptador simulado. Es el driver por defecto del ambiente de pruebas y el
 * que permite operar sin llave de API. Extrae de la capa de texto del PDF con
 * reglas determinísticas: no inventa valores.
 */
@Injectable()
export class ExtraccionSimuladaAdapter implements ExtraccionIaPort {
  private readonly log = new Logger(ExtraccionSimuladaAdapter.name);

  async extraer(
    contenido: Buffer,
    mime: string,
    tipoEsperado: TipoDocumento,
  ): Promise<ResultadoExtraccion> {
    const campos: ResultadoExtraccion['campos'] = {};
    const esperados = CAMPOS[tipoEsperado] ?? [];

    // Sin OCR ni modelo, este adaptador solo lee la capa de texto de un PDF.
    // Lo que no puede leer (una imagen, un PDF escaneado, un texto sin los
    // campos esperados) NO es "ilegible": es "sin lectura automática", y el
    // documento pasa a revisión humana con confianza cero en cada campo.
    // Reservar "ilegible" para archivos vacíos o truncados evita devolverle al
    // estudiante documentos perfectamente válidos en el ambiente de pruebas.
    const vacio = contenido.length < 600;
    if (mime !== 'application/pdf') {
      for (const campo of esperados) {
        campos[campo] = { valor: null, confianza: 0, evidencia: null };
      }
      return this.resultado(null, campos, vacio);
    }

    const texto = this.textoPlano(contenido);
    if (texto.trim().length < 40) {
      for (const campo of esperados) campos[campo] = { valor: null, confianza: 0, evidencia: null };
      return this.resultado(null, campos, vacio);
    }

    for (const campo of esperados) {
      campos[campo] = this.buscarCampo(texto, campo);
    }

    const conValor = Object.values(campos).filter((c) => c.valor !== null).length;
    this.log.debug(`Extracción simulada ${tipoEsperado}: ${conValor}/${esperados.length} campos`);

    return this.resultado(this.detectarTipo(texto), campos, false);
  }

  private resultado(
    tipoDetectado: TipoDocumento | null,
    campos: ResultadoExtraccion['campos'],
    ilegible: boolean,
  ): ResultadoExtraccion {
    return {
      tipoDetectado,
      campos,
      ilegible,
      modelo: 'simulado-deterministico',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
      proveedor: 'simulado',
    };
  }

  /**
   * Capa de texto del PDF: descomprime los flujos (la mayoría de generadores,
   * pdfkit incluido, los comprimen con Flate) y recoge las cadenas de los
   * operadores Tj y TJ. Sin OCR: lo que esté solo en imagen no se lee.
   */
  private textoPlano(buffer: Buffer): string {
    const crudo = buffer.toString('latin1');
    const contenidos: string[] = [crudo];
    for (const flujo of crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        contenidos.push(inflateSync(Buffer.from(flujo[1], 'latin1')).toString('latin1'));
      } catch {
        // Flujo sin comprimir o con otro filtro: ya está en `crudo` o no es texto.
      }
    }
    // Las cadenas van entre paréntesis (literales) o entre ángulos (hexadecimal,
    // que es como las escribe pdfkit); el operador es Tj o TJ (arreglo).
    const lineas: string[] = [];
    for (const contenido of contenidos) {
      for (const m of contenido.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) lineas.push(desescapar(m[1]));
      for (const m of contenido.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) lineas.push(desdeHex(m[1]));
      for (const m of contenido.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
        const trozos = [...m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>/g)].map((t) =>
          (t[1] !== undefined ? desescapar(t[1]) : desdeHex(t[2])),
        );
        if (trozos.length > 0) lineas.push(trozos.join(''));
      }
    }
    return lineas.join('\n');
  }

  private detectarTipo(texto: string): TipoDocumento | null {
    const t = texto.toLowerCase();
    if (/planilla\s+integrada|liquidaci[oó]n\s+de\s+aportes|\bpila\b/.test(t)) return TipoDocumento.PLANILLA_APORTES;
    // «ARL» a secas aparece en certificados de EPS, actas y contratos: solo
    // cuenta cuando el documento se presenta como el certificado de riesgos.
    if (/riesgos\s+laborales|afiliaci[oó]n\s+a\s+(la\s+)?arl|certificado\s+de\s+(afiliaci[oó]n\s+)?arl|administradora\s+de\s+riesgos/.test(t)) {
      return TipoDocumento.CERTIFICADO_ARL;
    }
    if (/entidad\s+promotora\s+de\s+salud|\beps\b.*afiliaci|afiliaci[oó]n.*\beps\b|\beps\b/.test(t)) {
      return TipoDocumento.CERTIFICADO_EPS;
    }
    if (/c[aá]mara\s+de\s+comercio|existencia\s+y\s+representaci[oó]n/.test(t)) {
      return TipoDocumento.CERTIFICADO_EXISTENCIA;
    }
    if (/acta\s+de\s+inicio/.test(t)) return TipoDocumento.ACTA_INICIO;
    if (/planilla\s+de\s+horas|registro\s+de\s+horas/.test(t)) return TipoDocumento.PLANILLA_HORAS;
    if (/plan\s+de\s+mejoramiento/.test(t)) return TipoDocumento.PLAN_MEJORAMIENTO;
    if (/carta\s+de\s+aceptaci[oó]n/.test(t)) return TipoDocumento.CARTA_ACEPTACION;
    if (/carta\s+de\s+finalizaci[oó]n/.test(t)) return TipoDocumento.CARTA_FINALIZACION;
    if (/contrato\s+de\s+aprendizaje/.test(t)) return TipoDocumento.CONTRATO_APRENDIZAJE;
    if (/informe\s+final\s+de\s+monitor/.test(t)) return TipoDocumento.INFORME_FINAL;
    if (/informe\s+2\s+de\s+monitor/.test(t)) return TipoDocumento.INFORME_2;
    if (/informe\s+1\s+de\s+monitor/.test(t)) return TipoDocumento.INFORME_1;
    if (/convenio/.test(t)) return TipoDocumento.CONVENIO_PRACTICA;
    if (/registro\s+[uú]nico\s+tributario|\brut\b/.test(t)) return null;
    return null;
  }

  private buscarCampo(texto: string, campo: string): ResultadoExtraccion['campos'][string] {
    const patrones: Record<string, RegExp> = {
      nit_empresa: /nit[:\s]*([\d.-]{6,20})/i,
      documento_afiliado: /(?:c\.?c\.?|documento)[:\s]*([\d.]{6,15})/i,
      numero_documento: /(?:c\.?c\.?|n[uú]mero)[:\s]*([\d.]{6,15})/i,
      total_horas: /(?:total\s+de\s+horas|total\s+horas|horas)[:\s]*(\d{1,5})/i,
      fecha_afiliacion: /fecha\s+de\s+afiliaci[oó]n[:\s]*([\d]{1,2}[/-][\d]{1,2}[/-][\d]{2,4}|\d{4}-\d{2}-\d{2})/i,
      fecha_inicio: /fecha\s+de\s+inicio[:\s]*([\d]{1,2}[/-][\d]{1,2}[/-][\d]{2,4}|\d{4}-\d{2}-\d{2})/i,
      fecha_fin: /fecha\s+de\s+(?:fin|terminaci[oó]n)[:\s]*([\d]{1,2}[/-][\d]{1,2}[/-][\d]{2,4}|\d{4}-\d{2}-\d{2})/i,
      fecha_expedicion: /fecha\s+de\s+expedici[oó]n[:\s]*([\d]{1,2}[/-][\d]{1,2}[/-][\d]{2,4}|\d{4}-\d{2}-\d{2})/i,
      razon_social: /(?:raz[oó]n\s+social|empresa)[:\s]*(.{3,90})/i,
      nombre_estudiante: /(?:estudiante|practicante|monitora?)[:\s]*(.{3,90})/i,
      entidad_emisora: /^(.*\b(?:eps|e\.p\.s\.|salud)\b.*)$/im,
      estado_afiliacion: /estado(?:\s+de\s+afiliaci[oó]n)?[:\s]*([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,20})/i,
      regimen: /r[eé]gimen[:\s]*([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,20})/i,
      modalidad: /modalidad[:\s]*(.{3,60})/i,
      nombre_responsable: /(?:jefe\s+inmediato|responsable)[:\s]*([^—\-\n]{3,90})/i,
      cargo_responsable: /(?:jefe\s+inmediato|responsable)[^\n]*?cargo[:\s]*(.{3,80})/i,
      cargo_firmante: /(?:firmado\s+por|firma)[^\n]*?cargo[:\s]*(.{3,80})/i,
      nombre_afiliado_eps: /nombre\s+del\s+afiliado[:\s]*(.{3,90})/i,
      nombre_afiliado: /(?:nombre\s+del\s+afiliado|afiliado|trabajador)[:\s]*(.{3,90})/i,
      representante_legal: /representante\s+legal[:\s]*(.{3,90})/i,
      nombre_firmante: /(?:firma|firmado\s+por|jefe\s+inmediato)[:\s]*(.{3,90})/i,
      cargo: /cargo[:\s]*(.{3,80})/i,
      arl: /arl[:\s]*([A-Za-zÁÉÍÓÚÑáéíóúñ\s]{3,40})/i,
      tipo_cotizante: /tipo\s+de\s+cotizante[:\s]*(\d{1,2})/i,
    };

    const patron = patrones[campo];
    if (!patron) return { valor: null, confianza: 0, evidencia: null };

    const coincidencia = texto.match(patron);
    if (!coincidencia) return { valor: null, confianza: 0, evidencia: null };

    const valor = coincidencia[1].trim();
    // La confianza refleja lo que se leyó, no lo que se supone.
    const confianza = /^[\d./-]+$/.test(valor) ? 0.95 : 0.82;
    return { valor, confianza, evidencia: coincidencia[0].slice(0, 120) };
  }
}

/**
 * Adaptador Anthropic. Se activa con `IA_DRIVER=anthropic` y la llave inyectada
 * desde Secret Manager. Mismo puerto: cambiar de proveedor no toca el dominio.
 */
@Injectable()
export class ExtraccionAnthropicAdapter implements ExtraccionIaPort {
  private readonly log = new Logger(ExtraccionAnthropicAdapter.name);
  private readonly modelo: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.modelo = config.get<string>('IA_MODELO') ?? 'claude-sonnet-5';
    this.apiKey = config.get<string>('ANTHROPIC_API_KEY') ?? '';
  }

  async extraer(
    contenido: Buffer,
    mime: string,
    tipoEsperado: TipoDocumento,
  ): Promise<ResultadoExtraccion> {
    const bloque =
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: mime, data: contenido.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: contenido.toString('base64') } };

    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.modelo,
        max_tokens: 2048,
        temperature: 0,
        system: construirPrompt(tipoEsperado) + formatoJsonLibre(tipoEsperado),
        messages: [
          {
            role: 'user',
            content: [bloque, { type: 'text', text: 'Lee el documento adjunto y devuelve solo el JSON con la forma indicada.' }],
          },
        ],
      }),
    });

    if (!respuesta.ok) {
      throw new Error(`Anthropic respondió ${respuesta.status}: ${await respuesta.text()}`);
    }

    const cuerpo = (await respuesta.json()) as {
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };
    const texto = cuerpo.content.find((c) => c.type === 'text')?.text ?? '{}';
    const json = JSON.parse(texto.replace(/^```json\s*|\s*```$/g, '')) as {
      tipo_detectado?: string | null;
      ilegible?: boolean;
      motivo_ilegible?: string | null;
      campos?: Record<string, { valor: string | null; confianza: number; evidencia: string | null }>;
      criterios?: { codigo: string; cumple: string; detalle: string | null }[];
      resumen?: string | null;
    };

    // Mismas garantías que el adaptador de OpenAI: solo campos esperados,
    // solo tipos del catálogo, un hallazgo por criterio del manual.
    const campos: ResultadoExtraccion['campos'] = {};
    for (const nombre of CAMPOS[tipoEsperado] ?? []) {
      const leido = json.campos?.[nombre];
      const valor = typeof leido?.valor === 'string' && leido.valor.trim() !== '' ? leido.valor.trim() : null;
      campos[nombre] = {
        valor,
        confianza: valor === null ? 0 : Math.min(1, Math.max(0, Number(leido?.confianza ?? 0) || 0)),
        evidencia: typeof leido?.evidencia === 'string' && leido.evidencia.trim() !== '' ? leido.evidencia : null,
      };
    }
    const porCodigo = new Map((json.criterios ?? []).map((c) => [c.codigo, c]));
    const hallazgos: HallazgoCriterio[] = conocimiento.criteriosEvaluables(tipoEsperado).map((criterio) => {
      const r = porCodigo.get(criterio.codigo);
      const cumple = r && ['si', 'no', 'no_determinable'].includes(r.cumple)
        ? (r.cumple as HallazgoCriterio['cumple'])
        : 'no_determinable';
      return {
        codigo: criterio.codigo,
        enunciado: criterio.enunciado,
        cumple,
        detalle: r?.detalle ?? (r ? null : 'El modelo no respondió este criterio'),
        causalDevolucion: criterio.causalDevolucion,
      };
    });
    const tipos = new Set<string>(Object.values(TipoDocumento));
    const tipoDetectado = json.tipo_detectado && tipos.has(json.tipo_detectado)
      ? (json.tipo_detectado as TipoDocumento)
      : null;

    const entrada = cuerpo.usage.input_tokens;
    const salida = cuerpo.usage.output_tokens;
    this.log.debug(`Extracción ${tipoEsperado}: ${entrada} entrada / ${salida} salida`);

    return {
      tipoDetectado,
      campos,
      ilegible: json.ilegible === true,
      modelo: this.modelo,
      tokensEntrada: entrada,
      tokensSalida: salida,
      // Tarifa de referencia; el costo real se concilia contra la facturación.
      costoUsd: (entrada / 1e6) * 3 + (salida / 1e6) * 15,
      hallazgos,
      motivoIlegible: json.motivo_ilegible ?? null,
      resumen: typeof json.resumen === 'string' ? json.resumen.slice(0, 500) : null,
      proveedor: 'anthropic',
    };
  }
}

/** Capa 3 — coherencia cruzada. Determinística sobre extracciones ya obtenidas. */
@Injectable()
export class CoherenciaCruzadaAdapter implements CoherenciaCruzadaPort {
  async evaluar(
    extracciones: Record<string, ResultadoExtraccion>,
    contexto: { nitEmpresa: string | null; fechaInicio: Date | null; nombreEstudiante: string },
  ): Promise<Bandera[]> {
    const banderas: Bandera[] = [];
    const valor = (tipo: string, campo: string): string | null =>
      extracciones[tipo]?.campos?.[campo]?.valor ?? null;

    // NIT coincidente entre documentos.
    const nits = Object.entries(extracciones)
      .map(([tipo, e]) => [tipo, e.campos?.nit_empresa?.valor] as const)
      .filter(([, v]) => Boolean(v))
      .map(([tipo, v]) => [tipo, (v as string).replace(/\D/g, '')] as const);

    const distintos = new Set(nits.map(([, v]) => v));
    if (distintos.size > 1) {
      banderas.push({
        codigo: 'C3_NIT_INCONSISTENTE',
        capa: 3,
        severidad: SeveridadBandera.ALTA,
        mensaje: `El NIT difiere entre documentos: ${nits.map(([t, v]) => `${t}=${v}`).join(', ')}`,
      });
    }
    if (contexto.nitEmpresa && distintos.size === 1) {
      const declarado = contexto.nitEmpresa.replace(/\D/g, '');
      const leido = [...distintos][0];
      if (declarado && leido && !declarado.startsWith(leido) && !leido.startsWith(declarado)) {
        banderas.push({
          codigo: 'C3_NIT_NO_CORRESPONDE_EMPRESA',
          capa: 3,
          severidad: SeveridadBandera.ALTA,
          mensaje: `El NIT de los documentos (${leido}) no corresponde a la empresa registrada (${declarado})`,
        });
      }
    }

    // Decreto 055 de 2015: la afiliación debe ser anterior al inicio.
    const fechaArl = this.aFecha(valor('certificado_arl', 'fecha_afiliacion'));
    if (fechaArl && contexto.fechaInicio) {
      if (fechaArl.getTime() >= contexto.fechaInicio.getTime()) {
        banderas.push({
          codigo: 'C3_ARL_NO_ANTERIOR_AL_INICIO',
          capa: 3,
          severidad: SeveridadBandera.CRITICA,
          mensaje:
            `La afiliación a ARL (${fechaArl.toISOString().slice(0, 10)}) no es anterior al ` +
            `inicio de la práctica (${contexto.fechaInicio.toISOString().slice(0, 10)})`,
        });
      }
    }

    // El firmante de la planilla debe ser el jefe inmediato declarado.
    const firmantePlanilla = valor('planilla_horas', 'nombre_firmante');
    const firmanteCarta = valor('carta_aceptacion', 'firma_representante');
    if (firmantePlanilla && firmanteCarta && !this.parecido(firmantePlanilla, firmanteCarta)) {
      banderas.push({
        codigo: 'C3_FIRMANTE_DISCREPANTE',
        capa: 3,
        severidad: SeveridadBandera.MEDIA,
        mensaje: `Firmante de la planilla "${firmantePlanilla}" ≠ representante declarado "${firmanteCarta}"`,
      });
    }

    // El afiliado debe ser el estudiante matriculado.
    const afiliado = valor('certificado_arl', 'nombre_afiliado');
    if (afiliado && contexto.nombreEstudiante && !this.parecido(afiliado, contexto.nombreEstudiante)) {
      banderas.push({
        codigo: 'C3_AFILIADO_NO_CORRESPONDE',
        capa: 3,
        severidad: SeveridadBandera.ALTA,
        mensaje: `El afiliado "${afiliado}" no corresponde al estudiante "${contexto.nombreEstudiante}"`,
      });
    }

    // Vigencia del certificado de existencia (práctica común: 30 días).
    const expedicion = this.aFecha(valor('certificado_existencia', 'fecha_expedicion'));
    if (expedicion) {
      const dias = (Date.now() - expedicion.getTime()) / 86_400_000;
      if (dias > 90) {
        banderas.push({
          codigo: 'C3_CERTIFICADO_EXISTENCIA_VENCIDO',
          capa: 3,
          severidad: SeveridadBandera.MEDIA,
          mensaje: `El certificado de existencia tiene ${Math.round(dias)} días de expedido`,
        });
      }
    }

    return banderas;
  }

  private aFecha(valor: string | null): Date | null {
    if (!valor) return null;
    const iso = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    const latino = valor.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (latino) {
      const anio = latino[3].length === 2 ? 2000 + +latino[3] : +latino[3];
      return new Date(Date.UTC(anio, +latino[2] - 1, +latino[1]));
    }
    return null;
  }

  private parecido(a: string, b: string): boolean {
    const n = (t: string) =>
      t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
    const [x, y] = [n(a), n(b)];
    if (!x || !y) return true;
    return x.includes(y) || y.includes(x) || this.tokensComunes(a, b) >= 2;
  }

  private tokensComunes(a: string, b: string): number {
    const tokens = (t: string) =>
      new Set(
        t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
          .split(/\s+/).filter((p) => p.length > 2),
      );
    const [x, y] = [tokens(a), tokens(b)];
    return [...x].filter((p) => y.has(p)).length;
  }
}

/** Deshace los escapes de una cadena literal de PDF: \( \) \\ y octales. */
function desescapar(texto: string): string {
  return texto
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\([()\\])/g, '$1');
}

/** Cadena hexadecimal de PDF (<48656c6c6f>) a texto; fuentes estándar usan WinAnsi ≈ latin1. */
function desdeHex(hex: string): string {
  const limpio = hex.replace(/\s+/g, '');
  return Buffer.from(limpio.length % 2 ? `${limpio}0` : limpio, 'hex').toString('latin1');
}
