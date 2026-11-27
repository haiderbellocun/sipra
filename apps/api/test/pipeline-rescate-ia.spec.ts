import { ConfigService } from '@nestjs/config';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { PipelineValidacionUseCase } from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { AccionAuditada, RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import { camposDe } from '../src/domain/entities/campos-extraccion';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  DocumentoRepositoryPort, PracticaRepositoryPort, SobrescrituraParametro, UsuarioRepositoryPort,
} from '../src/domain/ports/out/repositorios.port';
import {
  AlmacenamientoPort, CampoExtraido, ExtraccionIaPort, LecturaRescateIaPort, ResultadoExtraccion, ResultadoRescateIa,
  SolicitudRescateIa,
} from '../src/domain/ports/out/servicios-externos.port';
import { ImagenGris } from '../src/domain/services/hash-perceptual.domain-service';
import { RescateIaNoAutorizadoError } from '../src/domain/services/politica-rescate-ia';
import { permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import { esLecturaIaReal } from '../src/domain/services/resultado-rescate-ia';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { ErrorProveedorIa } from '../src/infrastructure/adapters/ia/openai.adapter';
import { MetricasService } from '../src/infrastructure/observability/metricas.service';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';

/**
 * IA de rescate integrada al pipeline (subfase 1.5). Todo con mocks: CERO llamadas reales a OpenAI y datos 100 %
 * sintéticos. Tipo de prueba: certificado de EPS (sensible, SOLO_LOCAL): sus campos son
 * entidad_emisora, nombre_afiliado, documento_afiliado, fecha_expedicion, estado_afiliacion y regimen.
 */

const EPS = TipoDocumento.CERTIFICADO_EPS;
const decodificador = new DecodificadorImagenAdapter();

/** Imagen inclinada, con margen y sombra: dispara pasos reales de preprocesamiento (segundo intento local). */
function imagenTorcida(ancho = 320, alto = 260): ImagenGris {
  const pixeles = new Uint8Array(ancho * alto).fill(240);
  const tangente = Math.tan((5 * Math.PI) / 180);
  for (let renglon = 0; renglon < 12; renglon += 1) {
    const yBase = 40 + Math.round((renglon * (alto - 80)) / 12);
    for (let x = 40; x < ancho - 40; x += 1) {
      const y = Math.round(yBase + (x - ancho / 2) * tangente);
      for (let g = 0; g < 4; g += 1) if (y + g >= 0 && y + g < alto) pixeles[(y + g) * ancho + x] = 30;
    }
  }
  for (let y = 0; y < alto; y += 1) for (let x = 0; x < ancho; x += 1) pixeles[y * ancho + x] = Math.round(pixeles[y * ancho + x] * (1 - 0.5 * (x / ancho)));
  return { ancho, alto, pixeles };
}
const PNG = decodificador.codificarPng(imagenTorcida());

const campo = (valor: string | null, confianza = 0.95, fuente?: CampoExtraido['fuente']): CampoExtraido =>
  ({ valor, confianza, evidencia: null, ...(fuente ? { fuente } : {}) });

/** Lectura local completa del certificado, con los campos que se indiquen sustituidos. */
function lecturaLocal(cambios: Record<string, CampoExtraido> = {}, extra: Partial<ResultadoExtraccion> = {}): ResultadoExtraccion {
  const campos: Record<string, CampoExtraido> = {};
  for (const nombre of camposDe(EPS)) campos[nombre] = campo(`valor-local-${nombre}`, 0.95, 'texto_nativo');
  return {
    tipoDetectado: EPS, campos: { ...campos, ...cambios }, ilegible: false, modelo: 'local-determinista',
    tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, hallazgos: [], resumen: 'lectura local', proveedor: 'local', ...extra,
  };
}

const ilegibleLocal = (): ResultadoExtraccion =>
  lecturaLocal({}, {
    ilegible: true, tipoDetectado: null, motivoIlegible: 'ilegible',
    campos: Object.fromEntries(camposDe(EPS).map((n) => [n, campo(null, 0, 'ocr')])),
  });

class ExtractorLocal implements ExtraccionIaPort {
  llamadas = 0;
  constructor(private readonly respuesta: (n: number) => ResultadoExtraccion) {}
  extraer(): Promise<ResultadoExtraccion> { this.llamadas += 1; return Promise.resolve(this.respuesta(this.llamadas)); }
}

class ExtractorExterno implements ExtraccionIaPort {
  llamadas = 0;
  extraer(): Promise<ResultadoExtraccion> { this.llamadas += 1; return Promise.resolve(lecturaLocal()); }
}

type Valores = Record<string, { valor: string | null; confianza?: number }>;

function respuesta(valores: Valores, extra: Partial<ResultadoRescateIa> = {}): ResultadoRescateIa {
  const campos: ResultadoRescateIa['campos'] = {};
  for (const [nombre, v] of Object.entries(valores)) campos[nombre] = { valor: v.valor, confianza: v.confianza ?? 0.9, evidencia: null };
  return {
    fuente: 'ia_rescate', invocado: true, camposSolicitados: Object.keys(valores), camposRechazados: [], campos,
    modelo: 'gpt-6-luna-2026-09-22', proveedor: 'openai', tokensEntrada: 3_000, tokensSalida: 120, tokensCache: 1_000,
    tokensRazonamiento: 40, costoUsd: 0.0021, duracionMs: 850, ...extra,
  };
}

class Rescate implements LecturaRescateIaPort {
  llamadas: SolicitudRescateIa[] = [];
  constructor(private readonly responder: (s: SolicitudRescateIa) => Promise<ResultadoRescateIa>) {}
  rescatar(s: SolicitudRescateIa): Promise<ResultadoRescateIa> { this.llamadas.push(s); return this.responder(s); }
}

const rescateCon = (valores: Valores, extra: Partial<ResultadoRescateIa> = {}) => new Rescate(() => Promise.resolve(respuesta(valores, extra)));
const rescateQueFalla = (error: Error) => new Rescate(() => Promise.reject(error));

const CONFIG_RESCATE: Record<string, unknown> = {
  SIPRA_AMBIENTE: 'dev', IA_RESCATE_HABILITADO: 'true', IA_RESCATE_EPS: 'true', IA_RESCATE_RUT: 'true',
  IA_RESCATE_CAMARA: 'true', IA_RESCATE_ACTA: 'true',
};

interface Opciones {
  tipo?: TipoDocumento;
  local?: ExtraccionIaPort;
  externo?: ExtraccionIaPort;
  rescate?: LecturaRescateIaPort;
  config?: Record<string, unknown>;
  gastoHoy?: number;
  lecturasIa?: number;
  sobrescrituras?: SobrescrituraParametro[];
  auditoriaFalla?: boolean;
}

function montar(o: Opciones = {}) {
  const tipo = o.tipo ?? EPS;
  const ahora = new Date();
  let almacenado: DatosDocumento = {
    id: 'doc-1', practicaId: 'practica-1', tipo, version: 1, estado: EstadoDocumento.RECIBIDO, nombreOriginal: 'doc.png',
    mimeReal: 'image/png', tamanoBytes: PNG.length, hashSha256: 'a'.repeat(64), hashPerceptual: null,
    rutaAlmacenamiento: 'ruta/x', calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null,
    decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora,
    purgarDespuesDe: null,
  };
  const consultas = { lecturasGenerales: 0, lecturasIa: [] as string[] };
  const documentos: DocumentoRepositoryPort = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)),
    listarPorPractica: () => Promise.resolve([]),
    contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]),
    ultimaVersion: () => Promise.resolve(1),
    guardar: (d: DatosDocumento) => { almacenado = d; return Promise.resolve(Documento.desde(d)); },
    listarParaPurga: () => Promise.resolve([]),
    gastoIaDesde: () => Promise.resolve(o.gastoHoy ?? 0),
    contarLecturasDesde: () => { consultas.lecturasGenerales += 1; return Promise.resolve(0); },
    contarLecturasIaRealesDesde: (practicaId) => { consultas.lecturasIa.push(practicaId); return Promise.resolve(o.lecturasIa ?? 0); },
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
  };
  const parametros = new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve(o.sobrescrituras ?? []), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve(),
  });
  const valores = { ...CONFIG_RESCATE, ...(o.config ?? {}) };
  const auditoria: RegistroAuditoria[] = [];
  const metricas = new MetricasService();
  const pipeline = new PipelineValidacionUseCase(
    documentos,
    { buscarPorId: () => Promise.resolve(null) } as unknown as PracticaRepositoryPort,
    { buscarPorId: () => Promise.resolve(null) } as unknown as UsuarioRepositoryPort,
    { leer: () => Promise.resolve(PNG) } as unknown as AlmacenamientoPort,
    o.externo ?? new ExtractorExterno(),
    { evaluar: () => Promise.resolve([]) },
    decodificador,
    { leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }) },
    parametros,
    { get: (k: string) => valores[k] } as unknown as ConfigService,
    o.local ?? new ExtractorLocal(() => lecturaLocal()),
    o.rescate,
    { registrar: (r: RegistroAuditoria) => { if (o.auditoriaFalla) return Promise.reject(new Error('BD caída')); auditoria.push(r); return Promise.resolve(); } } as never,
    metricas,
  );
  const extraccion = () => almacenado.extraccion as unknown as ResultadoExtraccion & { rescateIa?: Record<string, unknown> };
  return { pipeline, actual: () => almacenado, extraccion, auditoria, metricas, consultas };
}

const codigos = (d: DatosDocumento): string[] => d.banderas.map((b) => b.codigo);

async function metrica(m: MetricasService, nombre: string): Promise<{ labels: Record<string, string>; value: number }[]> {
  const json = await m.registro.getMetricsAsJSON();
  return (json.find((x) => x.name === nombre)?.values ?? []) as { labels: Record<string, string>; value: number }[];
}

describe('Pipeline · rescate con IA · compuertas (0 llamadas)', () => {
  it('1. interruptor general apagado → 0 llamadas', async () => {
    const rescate = rescateCon({ nombre_afiliado: { valor: 'x' } });
    const { pipeline, actual } = montar({
      rescate, local: new ExtractorLocal(() => lecturaLocal({ nombre_afiliado: campo(null, 0) })),
      config: { IA_RESCATE_HABILITADO: 'false', IA_RESCATE_EPS: 'false', IA_RESCATE_RUT: 'false', IA_RESCATE_CAMARA: 'false', IA_RESCATE_ACTA: 'false' },
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(0);
    expect(actual().extraccion).not.toHaveProperty('rescateIa');
  });

  it('2. general activo + interruptor del tipo apagado → 0 llamadas', async () => {
    const rescate = rescateCon({ nombre_afiliado: { valor: 'x' } });
    const { pipeline } = montar({
      rescate, local: new ExtractorLocal(() => lecturaLocal({ nombre_afiliado: campo(null, 0) })), config: { IA_RESCATE_EPS: 'false' },
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(0);
  });

  it('un tipo sensible fuera de dev tampoco arma la solicitud (aunque la configuración llegara con los interruptores)', async () => {
    const rescate = rescateCon({ nombre_afiliado: { valor: 'x' } });
    for (const ambiente of ['qa', 'pre', 'prod', undefined]) {
      const { pipeline } = montar({
        rescate, local: new ExtractorLocal(() => lecturaLocal({ nombre_afiliado: campo(null, 0) })), config: { SIPRA_AMBIENTE: ambiente },
      });
      await pipeline.procesar('doc-1');
    }
    expect(rescate.llamadas).toHaveLength(0);
  });

  it('sin proveedor de rescate registrado el flujo es el de siempre', async () => {
    const { pipeline, actual } = montar({ local: new ExtractorLocal(() => lecturaLocal({ nombre_afiliado: campo(null, 0) })) });
    await expect(pipeline.procesar('doc-1')).resolves.toMatchObject({ ejecutado: true });
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('7. lectura local suficiente → 0 rescate', async () => {
    const rescate = rescateCon({});
    const { pipeline, auditoria } = montar({ rescate });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(0);
    expect(auditoria).toHaveLength(0);
  });

  it('21. local ilegible en el primer intento pero suficiente tras el preproceso → 0 rescate', async () => {
    const local = new ExtractorLocal((n) => (n === 1 ? ilegibleLocal() : lecturaLocal()));
    const rescate = rescateCon({});
    const { pipeline, actual } = montar({ local, rescate });
    await pipeline.procesar('doc-1');
    expect(local.llamadas).toBe(2);
    expect(rescate.llamadas).toHaveLength(0);
    expect(codigos(actual())).toContain('C2_LEGIBLE_TRAS_PREPROCESO');
  });

  it('un documento de otro tipo detectado por la lectura local no se envía a un proveedor externo', async () => {
    const rescate = rescateCon({ nombre_afiliado: { valor: 'x' } });
    const { pipeline } = montar({
      rescate, local: new ExtractorLocal(() => lecturaLocal({ nombre_afiliado: campo(null, 0) }, { tipoDetectado: TipoDocumento.CEDULA })),
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(0);
  });

  it('31. un tipo NO sensible conserva su camino actual y no entra al rescate', async () => {
    const rescate = rescateCon({ total_horas: { valor: '480' } });
    const externo = new ExtractorExterno();
    const { pipeline, auditoria } = montar({ tipo: TipoDocumento.PLANILLA_HORAS, externo, rescate });
    await pipeline.procesar('doc-1');
    expect(externo.llamadas).toBe(1);
    expect(rescate.llamadas).toHaveLength(0);
    expect(auditoria).toHaveLength(0);
  });
});

describe('Pipeline · rescate con IA · qué se pide', () => {
  it('8. falta un campo → se solicita únicamente ese campo', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline } = montar({ rescate, local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) })) });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(1);
    expect(rescate.llamadas[0].camposSolicitados).toEqual(['documento_afiliado']);
    expect(rescate.llamadas[0].tipo).toBe(EPS);
  });

  it('9. dos faltantes (nulo y confianza baja) → UNA sola llamada con los dos campos', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' }, regimen: { valor: 'Contributivo' } });
    const { pipeline } = montar({
      rescate,
      local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0), regimen: campo('Contribut1vo', 0.4, 'ocr') })),
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(1);
    expect(rescate.llamadas[0].camposSolicitados).toEqual(['documento_afiliado', 'regimen']);
  });
});

describe('Pipeline · rescate con IA · ilegible', () => {
  it('10. local ilegible + rescate con todos los campos → NO termina en ilegible; sigue a revisión con datos precargados', async () => {
    const todo = Object.fromEntries(camposDe(EPS).map((n) => [n, { valor: `valor-ia-${n}`, confianza: 0.9 }]));
    const rescate = rescateCon(todo);
    const { pipeline, actual, extraccion } = montar({ rescate, local: new ExtractorLocal(() => ilegibleLocal()) });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(1);
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(actual().estado).not.toBe(EstadoDocumento.ILEGIBLE);
    expect(extraccion().ilegible).toBe(false);
    expect(extraccion().campos.regimen.valor).toBe('valor-ia-regimen');
    expect(codigos(actual())).toContain('C2_RESCATE_IA_APLICADO');
  });

  it('11. local ilegible + rescate sin ningún dato útil → conserva ilegible (nueva captura)', async () => {
    const vacio = Object.fromEntries(camposDe(EPS).map((n) => [n, { valor: null }]));
    const { pipeline, actual, extraccion } = montar({ rescate: rescateCon(vacio), local: new ExtractorLocal(() => ilegibleLocal()) });
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.ILEGIBLE);
    expect(extraccion().rescateIa).toMatchObject({ invocado: true, resultado: 'sin_datos' });
    expect(codigos(actual())).toContain('C2_RESCATE_IA_SIN_DATOS');
  });

  it('11b. local ilegible + todo lo recuperado era inválido → sigue ilegible', async () => {
    const invalido = Object.fromEntries(camposDe(EPS).map((n) => [n, { valor: n === 'fecha_expedicion' ? '2026-02-30' : null }]));
    const { pipeline, actual } = montar({ rescate: rescateCon(invalido), local: new ExtractorLocal(() => ilegibleLocal()) });
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.ILEGIBLE);
  });

  it('12. rescate parcial útil sobre una lectura ilegible → revisión humana con los datos recuperados', async () => {
    const rescate = rescateCon({ nombre_afiliado: { valor: 'Persona Sintética' }, documento_afiliado: { valor: '1000000001' } });
    const { pipeline, actual, extraccion } = montar({ rescate, local: new ExtractorLocal(() => ilegibleLocal()) });
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(extraccion().campos.nombre_afiliado.valor).toBe('Persona Sintética');
    expect(extraccion().rescateIa).toMatchObject({ resultado: 'parcial', camposRecuperados: ['nombre_afiliado', 'documento_afiliado'] });
    expect(codigos(actual())).toEqual(expect.arrayContaining(['C2_RESCATE_IA_APLICADO', 'C2_RESCATE_IA_PARCIAL']));
  });

  it('un rescate sobre una lectura local no ilegible incompleta nunca marca ilegible', async () => {
    const { pipeline, actual } = montar({
      rescate: rescateCon({ regimen: { valor: null } }), local: new ExtractorLocal(() => lecturaLocal({ regimen: campo(null, 0) })),
    });
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });
});

describe('Pipeline · rescate con IA · fusión (precedencia)', () => {
  it('13. la IA llena un campo null local y NO toca los demás; conserva lecturaLocal, hallazgos y resumen', async () => {
    const lectura = lecturaLocal(
      { documento_afiliado: campo(null, 0, 'ocr'), entidad_emisora: campo('SANITAS', 0.95, 'texto_nativo') },
      { hallazgos: [{ codigo: 'H1', enunciado: 'x', cumple: 'si', detalle: null, causalDevolucion: false }], resumen: 'resumen local' },
    );
    const conLocal = { ...lectura, lecturaLocal: { marca: 'resumen-local' } } as unknown as ResultadoExtraccion;
    const rescate = rescateCon({ documento_afiliado: { valor: '1.000.000.001' } });
    const { pipeline, extraccion } = montar({ rescate, local: new ExtractorLocal(() => conLocal) });
    await pipeline.procesar('doc-1');
    const e = extraccion();
    expect(e.campos.documento_afiliado).toMatchObject({ valor: '1000000001' });
    expect(e.campos.documento_afiliado).not.toHaveProperty('fuente');
    expect(e.campos.entidad_emisora).toMatchObject({ valor: 'SANITAS', fuente: 'texto_nativo' });
    expect(e.rescateIa).toMatchObject({ resultado: 'recuperado', camposRecuperados: ['documento_afiliado'] });
    expect((e.rescateIa as { fuentesFinales: Record<string, string> }).fuentesFinales).toMatchObject({
      documento_afiliado: 'ia_rescate', entidad_emisora: 'texto_nativo',
    });
    expect(e.hallazgos).toHaveLength(1);
    expect(e.resumen).toBe('resumen local');
    expect((e as unknown as { lecturaLocal: unknown }).lecturaLocal).toEqual({ marca: 'resumen-local' });
    expect(e.tipoDetectado).toBe(EPS);
  });

  it('14. un campo leído del QR no se pide a la IA (aunque su confianza declarada sea baja)', async () => {
    const rescate = rescateCon({ regimen: { valor: 'Subsidiado' } });
    const { pipeline, extraccion } = montar({
      rescate,
      local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo('1000000001', 0.1, 'qr'), regimen: campo(null, 0) })),
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas[0].camposSolicitados).toEqual(['regimen']);
    expect(extraccion().campos.documento_afiliado).toMatchObject({ valor: '1000000001', fuente: 'qr' });
  });

  it('14b. la IA contradice un QR (responde de más) → gana el QR, discrepancia ALTA y revisión humana', async () => {
    // El pipeline solo pide campos faltantes, pero un proveedor que responda de más no puede pisar al QR.
    const rescate = rescateCon({ regimen: { valor: 'Subsidiado' }, documento_afiliado: { valor: '1000000009' } });
    const { pipeline, actual, extraccion } = montar({
      rescate,
      local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo('1000000001', 0.1, 'qr'), regimen: campo(null, 0) })),
    });
    await pipeline.procesar('doc-1');
    expect(extraccion().campos.documento_afiliado).toMatchObject({ valor: '1000000001', fuente: 'qr' });
    expect(extraccion().rescateIa).toMatchObject({
      discrepancias: [expect.objectContaining({ campo: 'documento_afiliado', codigo: 'IA_CONTRADICE_LECTURA_CONFIABLE', fuenteConservada: 'qr' })],
      requiereRevisionHumana: true,
    });
    expect(codigos(actual())).toContain('C2_DISCREPANCIA_IA_LOCAL');
    expect(actual().banderas.find((b) => b.codigo === 'C2_DISCREPANCIA_IA_LOCAL')?.severidad).toBe('alta');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('15. la IA contradice un OCR confiable → gana lo local, discrepancia y revisión humana', async () => {
    // El OCR confiable no se pide; se fuerza que la respuesta traiga también ese campo para comprobar que no lo pisa.
    const rescate = rescateCon({ regimen: { valor: 'Subsidiado' }, nombre_afiliado: { valor: 'Otro Nombre' } });
    const { pipeline, actual, extraccion } = montar({
      rescate,
      local: new ExtractorLocal(() => lecturaLocal({ nombre_afiliado: campo('Nombre Local', 0.92, 'ocr'), regimen: campo(null, 0) })),
    });
    await pipeline.procesar('doc-1');
    expect(extraccion().campos.nombre_afiliado).toMatchObject({ valor: 'Nombre Local', fuente: 'ocr' });
    const meta = extraccion().rescateIa as { discrepancias: { campo: string; codigo: string }[]; requiereRevisionHumana: boolean };
    expect(meta.discrepancias).toEqual([expect.objectContaining({ campo: 'nombre_afiliado', codigo: 'IA_CONTRADICE_LECTURA_CONFIABLE' })]);
    expect(meta.requiereRevisionHumana).toBe(true);
    expect(codigos(actual())).toContain('C2_DISCREPANCIA_IA_LOCAL');
    expect(actual().banderas.find((b) => b.codigo === 'C2_DISCREPANCIA_IA_LOCAL')?.severidad).toBe('alta');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('16. la IA corrobora un OCR débil → no reemplaza fuente ni confianza, y no habilita autoaprobación', async () => {
    const rescate = rescateCon({ regimen: { valor: 'CONTRIBUTIVO', confianza: 1 } });
    const { pipeline, actual, extraccion } = montar({
      rescate, local: new ExtractorLocal(() => lecturaLocal({ regimen: campo('Contributivo', 0.4, 'ocr') })),
    });
    await pipeline.procesar('doc-1');
    expect(extraccion().campos.regimen).toMatchObject({ valor: 'Contributivo', fuente: 'ocr', confianza: 0.4 });
    expect(extraccion().rescateIa).toMatchObject({ camposCorroborados: ['regimen'], camposRecuperados: [], discrepancias: [] });
    expect(codigos(actual())).not.toContain('C2_DISCREPANCIA_IA_LOCAL');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(codigos(actual())).toContain('C3_AUTOAPROBACION_NO_HABILITADA');
  });

  it('30. aunque la IA recupere TODO, un tipo sensible jamás se autoaprueba: queda para una persona', async () => {
    const todo = Object.fromEntries(camposDe(EPS).map((n) => [n, { valor: `valor-ia-${n}`, confianza: 1 }]));
    const { pipeline, actual } = montar({ rescate: rescateCon(todo), local: new ExtractorLocal(() => ilegibleLocal()) });
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(actual().estado).not.toBe(EstadoDocumento.AUTO_APROBADO);
    for (const tipo of [EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO]) {
      expect(permiteAutoAprobacionDelPipeline(tipo)).toBe(false);
    }
  });
});

describe('Pipeline · rescate con IA · fallos del proveedor (degradan, no propagan)', () => {
  const faltaUno = () => new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) }));

  it('17. error del proveedor → el pipeline no lanza y termina seguro en revisión', async () => {
    const { pipeline, actual, extraccion, auditoria } = montar({
      rescate: rescateQueFalla(new ErrorProveedorIa('OpenAI respondió 500: error', true, 500)), local: faltaUno(),
    });
    await expect(pipeline.procesar('doc-1')).resolves.toMatchObject({ ejecutado: true });
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(extraccion().rescateIa).toMatchObject({ invocado: true, resultado: 'error' });
    expect(codigos(actual())).toContain('C2_RESCATE_IA_NO_DISPONIBLE');
    expect(auditoria).toHaveLength(1);
  });

  it('18. tiempo agotado → resultado «timeout» y el mismo comportamiento seguro', async () => {
    const e = new ErrorProveedorIa('The operation was aborted due to timeout', true);
    e.name = 'ErrorProveedorIa';
    const { pipeline, actual, extraccion } = montar({ rescate: rescateQueFalla(e), local: faltaUno() });
    await expect(pipeline.procesar('doc-1')).resolves.toBeDefined();
    expect(extraccion().rescateIa).toMatchObject({ resultado: 'timeout' });
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('un fallo con la lectura local ilegible conserva ilegible (comportamiento actual)', async () => {
    const { pipeline, actual } = montar({
      rescate: rescateQueFalla(new Error('fetch failed')), local: new ExtractorLocal(() => ilegibleLocal()),
    });
    await expect(pipeline.procesar('doc-1')).resolves.toBeDefined();
    expect(actual().estado).toBe(EstadoDocumento.ILEGIBLE);
  });

  it('19. una respuesta inservible facturada conserva su costo en la lectura persistida', async () => {
    const error = new ErrorProveedorIa('Respuesta incompleta del modelo (max_output_tokens)', false);
    error.uso = {
      modelo: 'gpt-6-luna', tokensEntrada: 4_000, tokensSalida: 500, tokensCache: 0, tokensRazonamiento: 300, costoUsd: 0.0035, tarifaDesconocida: false,
    };
    const { pipeline, extraccion } = montar({ rescate: rescateQueFalla(error), local: faltaUno() });
    await pipeline.procesar('doc-1');
    expect(extraccion().costoUsd).toBe(0.0035);
    expect(extraccion().tokensEntrada).toBe(4_000);
    expect(extraccion().rescateIa).toMatchObject({ resultado: 'error', costoUsd: 0.0035, tokensRazonamiento: 300 });
  });

  it('el proveedor protegido que rechaza NO es una invocación: sin auditoría, métricas ni conteo, y el documento sigue', async () => {
    const { pipeline, actual, extraccion, auditoria, metricas } = montar({
      rescate: rescateQueFalla(new RescateIaNoAutorizadoError('destino_no_permitido')), local: faltaUno(),
    });
    await expect(pipeline.procesar('doc-1')).resolves.toMatchObject({ ejecutado: true });
    expect(auditoria).toHaveLength(0);
    expect(await metrica(metricas, 'sipra_ia_rescate_invocaciones_total')).toHaveLength(0);
    expect(extraccion()).not.toHaveProperty('rescateIa');
    expect(esLecturaIaReal(extraccion())).toBe(false);
    expect(codigos(actual())).toContain('C2_RESCATE_IA_NO_DISPONIBLE');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });
});

describe('Pipeline · rescate con IA · un solo intento', () => {
  it('20. máximo UNA llamada por ejecución, sea cual sea el resultado', async () => {
    const casos: LecturaRescateIaPort[] = [
      rescateCon({ documento_afiliado: { valor: null } }),
      rescateCon({ documento_afiliado: { valor: '1000000001' } }),
      rescateQueFalla(new Error('fetch failed')),
      rescateCon({ documento_afiliado: { valor: '10A' } }),
    ];
    for (const rescate of casos) {
      const r = rescate as Rescate;
      const { pipeline } = montar({ rescate, local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) })) });
      await pipeline.procesar('doc-1');
      expect(r.llamadas).toHaveLength(1);
    }
  });

  it('32. el reintento de un trabajo ya procesado no vuelve a invocar la IA', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, auditoria } = montar({ rescate, local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) })) });
    const primera = await pipeline.procesar('doc-1');
    const segunda = await pipeline.procesar('doc-1');
    expect(primera.ejecutado).toBe(true);
    expect(segunda.ejecutado).toBe(false);
    expect(rescate.llamadas).toHaveLength(1);
    expect(auditoria).toHaveLength(1);
  });
});

describe('Pipeline · rescate con IA · presupuesto', () => {
  const faltaUno = () => new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) }));
  const sobrescritura = (clave: string, valor: number): SobrescrituraParametro =>
    ({ clave, valor, motivo: 'prueba', actualizadoPor: 'u', actualizadoEn: new Date() });

  it('22. tope diario agotado → 0 llamadas; sin invocación no hay auditoría ni métrica', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, actual, extraccion, auditoria, metricas } = montar({
      rescate, local: faltaUno(), gastoHoy: 5, sobrescrituras: [sobrescritura('ia.tope_diario_usd', 1)],
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(0);
    expect(extraccion().rescateIa).toMatchObject({ invocado: false, resultado: 'presupuesto' });
    expect(esLecturaIaReal(extraccion())).toBe(false);
    expect(codigos(actual())).toContain('C2_RESCATE_IA_NO_DISPONIBLE');
    expect(auditoria).toHaveLength(0);
    expect(await metrica(metricas, 'sipra_ia_rescate_invocaciones_total')).toHaveLength(0);
  });

  it('23. límite por práctica agotado → 0 llamadas', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, actual } = montar({
      rescate, local: faltaUno(), lecturasIa: 40, sobrescrituras: [sobrescritura('ia.lecturas_por_practica_dia', 40)],
    });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(0);
    expect(codigos(actual())).toContain('C2_RESCATE_IA_NO_DISPONIBLE');
  });

  it('con límite en cero (desactivado) el rescate procede', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline } = montar({ rescate, local: faltaUno(), lecturasIa: 500, sobrescrituras: [sobrescritura('ia.lecturas_por_practica_dia', 0)] });
    await pipeline.procesar('doc-1');
    expect(rescate.llamadas).toHaveLength(1);
  });

  it('24. el conteo del límite es el de lecturas de IA REALES: no se consulta el conteo general (que incluye lo local)', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, consultas } = montar({ rescate, local: faltaUno() });
    await pipeline.procesar('doc-1');
    expect(consultas.lecturasGenerales).toBe(0);
    expect(consultas.lecturasIa).toEqual(['practica-1']);
    expect(rescate.llamadas).toHaveLength(1);
  });

  it('24b. una lectura local o determinística no cuenta como IA real; un proveedor externo o un rescate invocado sí', () => {
    expect(esLecturaIaReal(null)).toBe(false);
    expect(esLecturaIaReal({ proveedor: 'local' })).toBe(false);
    expect(esLecturaIaReal({ proveedor: 'pdf417' })).toBe(false);
    expect(esLecturaIaReal({ proveedor: 'simulado' })).toBe(false);
    expect(esLecturaIaReal({ proveedor: 'local', rescateIa: { invocado: false } })).toBe(false);
    expect(esLecturaIaReal({ proveedor: 'openai' })).toBe(true);
    expect(esLecturaIaReal({ proveedor: 'anthropic' })).toBe(true);
    expect(esLecturaIaReal({ proveedor: 'local', rescateIa: { invocado: true } })).toBe(true);
  });

  it('25. un rescate real queda persistido como lectura de IA y cuenta UNA vez', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, extraccion } = montar({ rescate, local: faltaUno() });
    await pipeline.procesar('doc-1');
    expect(esLecturaIaReal(extraccion())).toBe(true);
    expect(extraccion().rescateIa).toMatchObject({ invocado: true });
    // El documento es una fila: una invocación = una fila contada (el conteo es COUNT(*) de documentos).
    expect([extraccion()].filter(esLecturaIaReal)).toHaveLength(1);
  });
});

describe('Pipeline · rescate con IA · costo, auditoría y métricas', () => {
  const faltaUno = () => new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) }));

  it('el costo del rescate queda en la extracción persistida (local costaba 0): se atribuye al modelo que lo facturó, sin duplicarse', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, extraccion } = montar({ rescate, local: faltaUno() });
    await pipeline.procesar('doc-1');
    expect(extraccion()).toMatchObject({
      costoUsd: 0.0021, tokensEntrada: 3_000, tokensSalida: 120, tokensCache: 1_000, tokensRazonamiento: 40,
      duracionMs: 850, modelo: 'gpt-6-luna-2026-09-22', proveedor: 'openai',
    });
    expect(extraccion().rescateIa).toMatchObject({ modeloBase: 'local-determinista', proveedorBase: 'local', costoUsd: 0.0021 });
  });

  it('un costo previo de la lectura base se suma (no se pisa)', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const local = new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0) }, { costoUsd: 0.001, tokensEntrada: 100 }));
    const { pipeline, extraccion } = montar({ rescate, local });
    await pipeline.procesar('doc-1');
    expect(extraccion().costoUsd).toBe(0.0031);
    expect(extraccion().tokensEntrada).toBe(3_100);
  });

  it('26. auditoría exactamente una vez por invocación real, con la acción LECTURA_RESCATE_IA', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, auditoria } = montar({ rescate, local: faltaUno() });
    await pipeline.procesar('doc-1');
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      accion: AccionAuditada.LECTURA_RESCATE_IA, entidad: 'documento', entidadId: 'doc-1', actorRol: 'sistema',
    });
  });

  it('27. la auditoría no contiene PII: solo códigos y conteos, ningún valor ni evidencia', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' }, nombre_afiliado: { valor: 'Valentina Sintética Ruiz' } });
    const local = new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0), nombre_afiliado: campo(null, 0), entidad_emisora: campo('EPS SINTETICA', 0.95, 'texto_nativo') }));
    const { pipeline, auditoria, extraccion } = montar({ rescate, local });
    await pipeline.procesar('doc-1');
    const registro = auditoria[0];
    expect(Object.keys(registro.metadatos ?? {}).sort()).toEqual([
      'camposRecuperados', 'camposSolicitados', 'costoUsd', 'discrepancias', 'documentoId', 'duracionMs', 'modelo', 'requiereRevisionHumana',
      'resultado', 'tipo', 'tokensEntrada', 'tokensSalida',
    ]);
    expect(registro.metadatos).toMatchObject({ camposSolicitados: 2, camposRecuperados: 2, discrepancias: 0, resultado: 'recuperado' });
    const texto = JSON.stringify(registro);
    for (const prohibido of ['1000000001', 'Valentina', 'EPS SINTETICA', 'valor-local']) expect(texto).not.toContain(prohibido);
    // La metadata persistida en la extracción tampoco lleva valores.
    const meta = JSON.stringify(extraccion().rescateIa);
    for (const prohibido of ['1000000001', 'Valentina', 'EPS SINTETICA']) expect(meta).not.toContain(prohibido);
  });

  it('las banderas del rescate no incluyen valores', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' }, nombre_afiliado: { valor: 'Valentina Sintética' } });
    const { pipeline, actual } = montar({
      rescate, local: new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0), nombre_afiliado: campo('Nombre Local', 0.92, 'ocr') })),
    });
    await pipeline.procesar('doc-1');
    const texto = JSON.stringify(actual().banderas.filter((b) => b.codigo.startsWith('C2_RESCATE') || b.codigo === 'C2_DISCREPANCIA_IA_LOCAL'));
    expect(texto).toContain('C2_RESCATE_IA_APLICADO');
    for (const prohibido of ['1000000001', 'Valentina', 'Nombre Local']) expect(texto).not.toContain(prohibido);
  });

  it('28. las métricas del rescate se incrementan correctamente', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' }, regimen: { valor: 'Contributivo' } });
    const local = new ExtractorLocal(() => lecturaLocal({ documento_afiliado: campo(null, 0), regimen: campo(null, 0) }));
    const { pipeline, metricas } = montar({ rescate, local });
    await pipeline.procesar('doc-1');
    expect(await metrica(metricas, 'sipra_ia_rescate_invocaciones_total')).toEqual([
      { labels: { tipo: EPS, resultado: 'recuperado' }, value: 1 },
    ]);
    expect(await metrica(metricas, 'sipra_ia_rescate_campos_recuperados_total')).toEqual([{ labels: { tipo: EPS }, value: 2 }]);
    expect(await metrica(metricas, 'sipra_ia_rescate_costo_usd_total')).toEqual([
      { labels: { modelo: 'gpt-6-luna-2026-09-22' }, value: 0.0021 },
    ]);
    const duracion = await metrica(metricas, 'sipra_ia_rescate_duracion_seconds');
    const observaciones = duracion.find((v) => (v as { metricName?: string }).metricName === 'sipra_ia_rescate_duracion_seconds_count');
    expect(observaciones).toMatchObject({ labels: { tipo: EPS }, value: 1 });
    // El costo general NO se incrementa en el pipeline (lo hace el trabajo al persistir, una sola vez).
    expect(await metrica(metricas, 'sipra_ia_costo_usd_total')).toHaveLength(0);
  });

  it('29. las métricas no contienen PII: solo tipo, resultado y modelo (ningún id, práctica ni valor)', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, metricas } = montar({ rescate, local: faltaUno() });
    await pipeline.procesar('doc-1');
    const salida = (await metricas.exponer()).split('\n').filter((l) => l.startsWith('sipra_ia_rescate')).join('\n');
    expect(salida).toContain('sipra_ia_rescate_invocaciones_total');
    for (const prohibido of ['doc-1', 'practica-1', '1000000001', 'valor-local']) expect(salida).not.toContain(prohibido);
    for (const linea of salida.split('\n')) {
      const etiquetas = [...linea.matchAll(/(\w+)="/g)].map((m) => m[1]).filter((e) => e !== 'le');
      for (const e of etiquetas) expect(['tipo', 'resultado', 'modelo']).toContain(e);
    }
  });

  it('un rescate no invocado (flags apagados) no escribe métricas ni auditoría', async () => {
    const { pipeline, metricas, auditoria } = montar({
      rescate: rescateCon({}), local: faltaUno(), config: { IA_RESCATE_HABILITADO: 'false', IA_RESCATE_EPS: 'false' },
    });
    await pipeline.procesar('doc-1');
    expect(auditoria).toHaveLength(0);
    expect(await metrica(metricas, 'sipra_ia_rescate_invocaciones_total')).toHaveLength(0);
  });

  it('una auditoría que falla no tumba el procesamiento ni pierde la lectura rescatada', async () => {
    const rescate = rescateCon({ documento_afiliado: { valor: '1000000001' } });
    const { pipeline, extraccion } = montar({ rescate, local: faltaUno(), auditoriaFalla: true });
    await expect(pipeline.procesar('doc-1')).resolves.toMatchObject({ ejecutado: true });
    expect(extraccion().campos.documento_afiliado.valor).toBe('1000000001');
  });
});
