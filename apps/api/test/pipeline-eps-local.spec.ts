import { ConfigService } from '@nestjs/config';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { PipelineValidacionUseCase } from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { camposDe } from '../src/domain/entities/campos-extraccion';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  CampoExtraido, ExtraccionIaPort, ResultadoExtraccion,
} from '../src/domain/ports/out/servicios-externos.port';
import { ModoProcesamiento, modoProcesamientoDe, permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import { TEXTO_CEDULA, actaSintetica, lecturaPersistibleSintetica } from './soporte-acta';

/**
 * Política de procesamiento por tipo: el certificado de EPS se procesa SIEMPRE en
 * local, nunca llega a un proveedor externo de IA y nunca se autoaprueba.
 */

const PNG = new DecodificadorImagenAdapter().codificarPng({
  ancho: 64, alto: 64, pixeles: new Uint8Array(64 * 64).fill(200),
});

function extraccion(tipo: TipoDocumento, proveedor: string): ResultadoExtraccion {
  const campos: Record<string, CampoExtraido> = {};
  for (const nombre of camposDe(tipo)) campos[nombre] = { valor: `valor de ${nombre}`, confianza: 0.95, evidencia: 'x' };
  return {
    tipoDetectado: tipo, campos, ilegible: false, modelo: 'prueba', tokensEntrada: 0, tokensSalida: 0,
    costoUsd: 0, hallazgos: [], motivoIlegible: null, resumen: 'r', proveedor: proveedor,
  };
}

class Extractor implements ExtraccionIaPort {
  llamadas = 0;
  constructor(private readonly proveedor: string, private readonly tipo: TipoDocumento) {}
  extraer(): Promise<ResultadoExtraccion> { this.llamadas += 1; return Promise.resolve(extraccion(this.tipo, this.proveedor)); }
}

function datos(tipo: TipoDocumento): DatosDocumento {
  const ahora = new Date();
  return {
    id: 'doc-1', practicaId: 'practica-1', tipo, version: 1, estado: EstadoDocumento.RECIBIDO, nombreOriginal: 'doc.png',
    mimeReal: 'image/png', tamanoBytes: PNG.length, hashSha256: 'a'.repeat(64), hashPerceptual: null,
    rutaAlmacenamiento: 'ruta/x', calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null,
    decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora,
    purgarDespuesDe: null,
  };
}

function montar(tipo: TipoDocumento, externo: ExtraccionIaPort, local?: ExtraccionIaPort) {
  let almacenado = datos(tipo);
  const documentos = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)),
    listarPorPractica: () => Promise.resolve([]),
    contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]),
    ultimaVersion: () => Promise.resolve(1),
    guardar: (d: DatosDocumento) => { almacenado = d; return Promise.resolve(Documento.desde(d)); },
    listarParaPurga: () => Promise.resolve([]),
    gastoIaDesde: () => Promise.resolve(0),
    contarLecturasDesde: () => Promise.resolve(0),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
  };
  const parametros = new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve(),
  });
  const pipeline = new PipelineValidacionUseCase(
    documentos,
    { buscarPorId: () => Promise.resolve(null) } as never,
    { buscarPorId: () => Promise.resolve(null) } as never,
    { leer: () => Promise.resolve(PNG) } as never,
    externo,
    { evaluar: () => Promise.resolve([]) },
    new DecodificadorImagenAdapter(),
    { leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }) },
    parametros,
    { get: () => undefined } as unknown as ConfigService,
    local,
  );
  return { pipeline, actual: () => almacenado };
}

describe('Política de procesamiento por tipo (dominio)', () => {
  it('el certificado de EPS es local y no se autoaprueba', () => {
    expect(modoProcesamientoDe(TipoDocumento.CERTIFICADO_EPS)).toBe(ModoProcesamiento.LOCAL);
    expect(permiteAutoAprobacionDelPipeline(TipoDocumento.CERTIFICADO_EPS)).toBe(false);
  });

  it('el acta de iniciación también es local y no se autoaprueba (lleva datos personales)', () => {
    expect(modoProcesamientoDe(TipoDocumento.ACTA_INICIO)).toBe(ModoProcesamiento.LOCAL);
    expect(permiteAutoAprobacionDelPipeline(TipoDocumento.ACTA_INICIO)).toBe(false);
  });

  it('el resto de los tipos conserva el procesamiento existente', () => {
    const locales = [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO];
    for (const tipo of Object.values(TipoDocumento).filter((t) => !locales.includes(t))) {
      expect(modoProcesamientoDe(tipo)).not.toBe(ModoProcesamiento.LOCAL);
      expect(permiteAutoAprobacionDelPipeline(tipo)).toBe(true);
    }
  });
});

describe('Pipeline · certificado de EPS', () => {
  it('NUNCA llama al extractor externo (OpenAI/Anthropic): usa el local', async () => {
    const externo = new Extractor('openai', TipoDocumento.CERTIFICADO_EPS);
    const local = new Extractor('local', TipoDocumento.CERTIFICADO_EPS);
    const { pipeline } = montar(TipoDocumento.CERTIFICADO_EPS, externo, local);
    await pipeline.procesar('doc-1');
    expect(externo.llamadas).toBe(0);
    expect(local.llamadas).toBe(1);
  });

  it('sin extractor local NO hay fallback al externo: queda en revisión con la bandera de procesamiento no disponible', async () => {
    const externo = new Extractor('openai', TipoDocumento.CERTIFICADO_EPS);
    const { pipeline, actual } = montar(TipoDocumento.CERTIFICADO_EPS, externo, undefined);
    await pipeline.procesar('doc-1');
    expect(externo.llamadas).toBe(0);
    expect(actual().estado).not.toBe(EstadoDocumento.AUTO_APROBADO);
    expect(actual().banderas.map((b) => b.codigo)).toContain('C2_PROCESAMIENTO_LOCAL_NO_DISPONIBLE');
  });

  it('aunque todo salga perfecto, jamás queda AUTO_APROBADO: espera a una persona', async () => {
    const local = new Extractor('local', TipoDocumento.CERTIFICADO_EPS);
    const { pipeline, actual } = montar(TipoDocumento.CERTIFICADO_EPS, new Extractor('openai', TipoDocumento.CERTIFICADO_EPS), local);
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(actual().banderas.map((b) => b.codigo)).toContain('C3_AUTOAPROBACION_NO_HABILITADA');
  });

  it('otro tipo documental conserva su extractor configurado (la política no lo toca)', async () => {
    const externo = new Extractor('openai', TipoDocumento.PLANILLA_HORAS);
    const local = new Extractor('local', TipoDocumento.PLANILLA_HORAS);
    const { pipeline } = montar(TipoDocumento.PLANILLA_HORAS, externo, local);
    await pipeline.procesar('doc-1');
    expect(externo.llamadas).toBe(1);
    expect(local.llamadas).toBe(0);
  });
});

describe('Pipeline · acta de iniciación (procesamiento local)', () => {
  /** Extractor local que responde como el del acta: con su veredicto compacto. */
  class ExtractorActa implements ExtraccionIaPort {
    llamadas = 0;
    constructor(private readonly tipoActa: 'iniciacion_practicas' | 'documento_incorrecto') {}
    extraer(): Promise<ResultadoExtraccion> {
      this.llamadas += 1;
      const correcta = this.tipoActa === 'iniciacion_practicas';
      return Promise.resolve({
        ...extraccion(TipoDocumento.ACTA_INICIO, 'local'),
        tipoDetectado: correcta ? TipoDocumento.ACTA_INICIO : null,
        lecturaActa: lecturaPersistibleSintetica(correcta ? actaSintetica() : TEXTO_CEDULA),
      });
    }
  }

  it('NUNCA llama al extractor externo (OpenAI/Anthropic): usa el local', async () => {
    const externo = new Extractor('openai', TipoDocumento.ACTA_INICIO);
    const local = new ExtractorActa('iniciacion_practicas');
    const { pipeline } = montar(TipoDocumento.ACTA_INICIO, externo, local);
    await pipeline.procesar('doc-1');
    expect(externo.llamadas).toBe(0);
    expect(local.llamadas).toBe(1);
  });

  it('sin extractor local no hay fallback al externo: revisión humana con la bandera de procesamiento no disponible', async () => {
    const externo = new Extractor('openai', TipoDocumento.ACTA_INICIO);
    const { pipeline, actual } = montar(TipoDocumento.ACTA_INICIO, externo, undefined);
    await pipeline.procesar('doc-1');
    expect(externo.llamadas).toBe(0);
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(actual().banderas.map((b) => b.codigo)).toContain('C2_PROCESAMIENTO_LOCAL_NO_DISPONIBLE');
  });

  it('un acta perfectamente leída jamás se autoaprueba: la decide una persona', async () => {
    const { pipeline, actual } = montar(TipoDocumento.ACTA_INICIO, new Extractor('openai', TipoDocumento.ACTA_INICIO), new ExtractorActa('iniciacion_practicas'));
    await pipeline.procesar('doc-1');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(actual().banderas.map((b) => b.codigo)).toContain('C3_AUTOAPROBACION_NO_HABILITADA');
  });

  it('un documento que se LEYÓ y no es un acta queda marcado como tipo incorrecto', async () => {
    const { pipeline, actual } = montar(TipoDocumento.ACTA_INICIO, new Extractor('openai', TipoDocumento.ACTA_INICIO), new ExtractorActa('documento_incorrecto'));
    await pipeline.procesar('doc-1');
    const incorrecto = actual().banderas.filter((b) => b.codigo === 'C2_TIPO_INCORRECTO');
    expect(incorrecto).toHaveLength(1);
    expect(incorrecto[0].mensaje).toContain('acta de iniciación');
  });
});
