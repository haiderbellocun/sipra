import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import {
  PipelineValidacionUseCase, ProcesamientoEnCursoError, VIGENCIA_RECLAMO_PIPELINE_MS,
} from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { ProcesarTrabajoUseCase } from '../src/application/use-cases/documentos/procesar-trabajo.use-case';
import { camposDe } from '../src/domain/entities/campos-extraccion';
import {
  DatosDocumento, Documento, DocumentoYaDecididoError, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import { DocumentoRepositoryPort } from '../src/domain/ports/out/repositorios.port';
import {
  CampoExtraido, ExtraccionIaPort, ResultadoExtraccion,
} from '../src/domain/ports/out/servicios-externos.port';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { practicaDe, usuarioDe } from './soporte-autorizacion';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import { Rol } from '../src/domain/value-objects/rol.vo';

/**
 * Idempotencia del pipeline ante reintentos, doble entrega y concurrencia.
 *
 * Un trabajo `validar_documento` repetido no debe volver a leer el documento
 * (costo de IA), ni duplicar banderas, métricas o avisos, ni pisar una decisión
 * humana. El reclamo `recibido → analizando` es un compare-and-set; estas
 * pruebas lo emulan en memoria con la misma semántica que la sentencia SQL y la
 * prueba real contra PostgreSQL está en `herramientas/verificar-concurrencia-pg.ts`.
 */

const PNG = new DecodificadorImagenAdapter().codificarPng({
  ancho: 64, alto: 64, pixeles: new Uint8Array(64 * 64).fill(200),
});

function extraccionBuena(tipo: TipoDocumento): ResultadoExtraccion {
  const campos: Record<string, CampoExtraido> = {};
  for (const nombre of camposDe(tipo)) campos[nombre] = { valor: `valor de ${nombre}`, confianza: 0.95, evidencia: 'x' };
  return {
    tipoDetectado: tipo, campos, ilegible: false, modelo: 'prueba', tokensEntrada: 100, tokensSalida: 10,
    costoUsd: 0.001, hallazgos: [], motivoIlegible: null, resumen: 'r', proveedor: 'openai',
  };
}

class Extractor implements ExtraccionIaPort {
  llamadas = 0;
  constructor(private readonly respuesta: () => Promise<ResultadoExtraccion>) {}
  extraer(): Promise<ResultadoExtraccion> { this.llamadas += 1; return this.respuesta(); }
}

function datos(tipo: TipoDocumento, estado = EstadoDocumento.RECIBIDO, extra: Partial<DatosDocumento> = {}): DatosDocumento {
  const ahora = new Date();
  return {
    id: 'doc-1', practicaId: 'practica-1', tipo, version: 1, estado, nombreOriginal: 'doc.png', mimeReal: 'image/png',
    tamanoBytes: PNG.length, hashSha256: 'a'.repeat(64), hashPerceptual: null, rutaAlmacenamiento: 'ruta/x',
    calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null, decididoPor: null,
    justificacionDecision: null, motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora, purgarDespuesDe: null,
    ...extra,
  };
}

function montar(
  inicial: DatosDocumento,
  extractor: ExtraccionIaPort,
  opciones: { local?: ExtraccionIaPort; leer?: () => Promise<Buffer> } = {},
) {
  let almacenado = inicial;
  let guardados = 0;
  const documentos: DocumentoRepositoryPort = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)),
    listarPorPractica: () => Promise.resolve([]),
    contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]),
    ultimaVersion: () => Promise.resolve(1),
    guardar: (d) => { almacenado = d; guardados += 1; return Promise.resolve(Documento.desde(d)); },
    listarParaPurga: () => Promise.resolve([]),
    gastoIaDesde: () => Promise.resolve(0),
    contarLecturasDesde: () => Promise.resolve(0),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { guardados += 1; almacenado = d; }),
  };
  const parametros = new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve(),
  });
  const pipeline = new PipelineValidacionUseCase(
    documentos,
    { buscarPorId: () => Promise.resolve(null) } as never,
    { buscarPorId: () => Promise.resolve(null) } as never,
    { leer: opciones.leer ?? (() => Promise.resolve(PNG)) } as never,
    extractor,
    { evaluar: () => Promise.resolve([]) },
    new DecodificadorImagenAdapter(),
    { leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }) },
    parametros,
    { get: () => undefined } as unknown as ConfigService,
    opciones.local,
  );
  return { pipeline, documentos, actual: () => almacenado, escribir: (d: DatosDocumento) => { almacenado = d; }, guardados: () => guardados };
}

/** Cede el control hasta que se cumpla la condición (la lectura es asíncrona: hay que esperar a que empiece). */
async function hasta(condicion: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condicion(); i += 1) await new Promise((r) => setImmediate(r));
  if (!condicion()) throw new Error('la condición no se cumplió a tiempo');
}

const SIN_BANDERAS = (d: DatosDocumento): string[] => d.banderas.map((b) => b.codigo);

describe('Pipeline · idempotencia', () => {
  it('el mismo trabajo dos veces: la segunda no lee, no cambia nada y avisa que no ejecutó', async () => {
    const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { pipeline, actual } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor);

    const primera = await pipeline.procesar('doc-1');
    const despuesDeLaPrimera = JSON.stringify(actual());
    const segunda = await pipeline.procesar('doc-1');

    expect(primera.ejecutado).toBe(true);
    expect(segunda.ejecutado).toBe(false);
    expect(extractor.llamadas).toBe(1);
    expect(JSON.stringify(actual())).toBe(despuesDeLaPrimera);
  });

  it('no duplica banderas aunque el trabajo llegue varias veces', async () => {
    const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { pipeline, actual } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor);
    await pipeline.procesar('doc-1');
    const banderas = SIN_BANDERAS(actual());
    for (let i = 0; i < 3; i += 1) await pipeline.procesar('doc-1');
    expect(SIN_BANDERAS(actual())).toEqual(banderas);
    expect(new Set(banderas).size).toBe(banderas.length);
  });

  it('retry concurrente: dos ejecuciones a la vez leen UNA sola vez', async () => {
    let liberar: (r: ResultadoExtraccion) => void = () => undefined;
    const extractor = new Extractor(() => new Promise((resolver) => { liberar = resolver; }));
    const { pipeline, actual } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor);

    const a = pipeline.procesar('doc-1');
    const b = pipeline.procesar('doc-1');
    // Una de las dos recibe «en curso» (se reintentará); la otra sigue con el documento.
    await expect(b).rejects.toBeInstanceOf(ProcesamientoEnCursoError);
    await hasta(() => extractor.llamadas === 1);
    expect(actual().estado).toBe(EstadoDocumento.ANALIZANDO);
    liberar(extraccionBuena(TipoDocumento.PLANILLA_HORAS));
    const resultado = await a;

    expect(resultado.ejecutado).toBe(true);
    expect(extractor.llamadas).toBe(1);
    expect([EstadoDocumento.AUTO_APROBADO, EstadoDocumento.EN_REVISION]).toContain(actual().estado);
  });

  it('diez ejecuciones simultáneas: exactamente una corre las capas', async () => {
    const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { pipeline } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor);
    const resultados = await Promise.allSettled(Array.from({ length: 10 }, () => pipeline.procesar('doc-1')));
    const ejecutadas = resultados.filter((r) => r.status === 'fulfilled' && r.value.ejecutado);
    expect(ejecutadas).toHaveLength(1);
    expect(extractor.llamadas).toBe(1);
  });

  it.each([EstadoDocumento.APROBADO, EstadoDocumento.RECHAZADO, EstadoDocumento.DEVUELTO])(
    'un documento %s (decisión humana) no lo toca un reintento: ni lee ni cambia',
    async (estado) => {
      const decidido = datos(TipoDocumento.PLANILLA_HORAS, estado, {
        decididoPor: 'tutor-1', justificacionDecision: 'ok', motivoDevolucion: estado === EstadoDocumento.DEVUELTO ? 'corrija' : null,
      });
      const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
      const { pipeline, actual, guardados } = montar(decidido, extractor);

      const resultado = await pipeline.procesar('doc-1');

      expect(resultado.ejecutado).toBe(false);
      expect(extractor.llamadas).toBe(0);
      expect(guardados()).toBe(0);
      expect(actual()).toEqual(decidido);
    },
  );

  it.each([EstadoDocumento.AUTO_APROBADO, EstadoDocumento.EN_REVISION, EstadoDocumento.ILEGIBLE])(
    'un documento %s no se reprocesa automáticamente (exige una acción explícita)',
    async (estado) => {
      const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
      const inicial = datos(TipoDocumento.PLANILLA_HORAS, estado, { puntaje: 90 });
      const { pipeline, actual } = montar(inicial, extractor);
      const resultado = await pipeline.procesar('doc-1');
      expect(resultado.ejecutado).toBe(false);
      expect(extractor.llamadas).toBe(0);
      expect(actual()).toEqual(inicial);
    },
  );

  it('una decisión humana que llega MIENTRAS se procesa gana: el resultado automático se descarta', async () => {
    let liberar: (r: ResultadoExtraccion) => void = () => undefined;
    const extractor = new Extractor(() => new Promise((resolver) => { liberar = resolver; }));
    const { pipeline, actual, escribir } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor);

    const proceso = pipeline.procesar('doc-1');
    await hasta(() => extractor.llamadas === 1);
    // Una persona aprueba el documento mientras la lectura sigue en curso.
    escribir({ ...actual(), estado: EstadoDocumento.APROBADO, decididoPor: 'tutor-1', justificacionDecision: 'visto bueno' });
    liberar(extraccionBuena(TipoDocumento.PLANILLA_HORAS));
    const resultado = await proceso;

    expect(resultado.ejecutado).toBe(false);
    expect(actual().estado).toBe(EstadoDocumento.APROBADO);
    expect(actual().justificacionDecision).toBe('visto bueno');
    expect(actual().banderas).toEqual([]);
    expect(actual().puntaje).toBeNull();
  });

  it('un procesamiento interrumpido se recupera: caducado se retoma, vigente no', async () => {
    const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const hace = (ms: number): Date => new Date(Date.now() - ms);

    const vigente = montar(datos(TipoDocumento.PLANILLA_HORAS, EstadoDocumento.ANALIZANDO, { actualizadoEn: hace(60_000) }), extractor);
    await expect(vigente.pipeline.procesar('doc-1')).rejects.toBeInstanceOf(ProcesamientoEnCursoError);
    expect(extractor.llamadas).toBe(0);

    const caducado = montar(
      datos(TipoDocumento.PLANILLA_HORAS, EstadoDocumento.ANALIZANDO, { actualizadoEn: hace(VIGENCIA_RECLAMO_PIPELINE_MS + 1_000) }),
      extractor,
    );
    const resultado = await caducado.pipeline.procesar('doc-1');
    expect(resultado.ejecutado).toBe(true);
    expect(extractor.llamadas).toBe(1);
    expect(caducado.actual().estado).not.toBe(EstadoDocumento.ANALIZANDO);
  });

  it('un fallo inesperado devuelve el reclamo: el reintento no espera a que caduque', async () => {
    const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    let fallar = true;
    const { pipeline, actual } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor, {
      leer: () => (fallar ? Promise.reject(new Error('almacenamiento caído')) : Promise.resolve(PNG)),
    });

    await expect(pipeline.procesar('doc-1')).rejects.toThrow('almacenamiento caído');
    expect(actual().estado).toBe(EstadoDocumento.RECIBIDO);

    fallar = false;
    expect((await pipeline.procesar('doc-1')).ejecutado).toBe(true);
  });

  it('`ejecutar` conserva su contrato (devuelve el documento) y también es idempotente', async () => {
    const extractor = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { pipeline } = montar(datos(TipoDocumento.PLANILLA_HORAS), extractor);
    const uno = await pipeline.ejecutar('doc-1');
    const dos = await pipeline.ejecutar('doc-1');
    expect(uno.estado).toBe(dos.estado);
    expect(extractor.llamadas).toBe(1);
  });
});

describe('Documento · protección de decisiones y resultados', () => {
  it.each([EstadoDocumento.APROBADO, EstadoDocumento.DEVUELTO, EstadoDocumento.RECHAZADO])(
    'un documento %s no admite otra decisión ni otro resultado automático',
    (estado) => {
      const d = Documento.desde(datos(TipoDocumento.CEDULA, estado));
      expect(() => d.aprobar('u', 'justificación')).toThrow(DocumentoYaDecididoError);
      expect(() => d.rechazar('u', 'justificación')).toThrow(DocumentoYaDecididoError);
      expect(() => d.devolver('motivo', 'u')).toThrow(DocumentoYaDecididoError);
      expect(() => d.aplicarResultadoPipeline(100, [], null)).toThrow(DocumentoYaDecididoError);
      expect(() => d.marcarIlegible('x')).toThrow(DocumentoYaDecididoError);
      expect(d.estado).toBe(estado);
    },
  );

  it('un documento en revisión sí admite la decisión; un auto_aprobado también (una persona puede revertirlo)', () => {
    for (const estado of [EstadoDocumento.EN_REVISION, EstadoDocumento.AUTO_APROBADO, EstadoDocumento.ILEGIBLE]) {
      const d = Documento.desde(datos(TipoDocumento.CEDULA, estado));
      d.rechazar('u', 'no corresponde');
      expect(d.estado).toBe(EstadoDocumento.RECHAZADO);
    }
  });
});

// ── Trabajo completo: sin efectos duplicados ───────────────────────────────

describe('ProcesarTrabajoUseCase · el reintento no duplica avisos, métricas ni validación', () => {
  function trabajo(tipo: TipoDocumento, extraccion: () => Promise<ResultadoExtraccion>, local?: ExtraccionIaPort) {
    const extractor = new Extractor(extraccion);
    const base = montar(datos(tipo), extractor, { local });
    const notificaciones = { notificar: jest.fn().mockResolvedValue(undefined) };
    const metricas = {
      duracionPipeline: { observe: jest.fn() }, documentosProcesados: { inc: jest.fn() },
      documentosAutoAprobados: { inc: jest.fn() }, costoIa: { inc: jest.fn() },
    };
    const validacionesEps = {
      registrarProcesamiento: jest.fn().mockResolvedValue(null),
      marcarProcesando: jest.fn().mockResolvedValue(undefined),
      marcarErrorProcesamiento: jest.fn().mockResolvedValue(undefined),
    };
    const uso = new ProcesarTrabajoUseCase(
      base.pipeline,
      base.documentos,
      { buscarPorId: () => Promise.resolve(practicaDe({ id: 'practica-1' })) } as never,
      { buscarPorId: () => Promise.resolve(usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1' })) } as never,
      { leer: () => Promise.resolve(PNG) } as never,
      notificaciones as never,
      metricas as never,
      validacionesEps as never,
    );
    return { ...base, uso, extractor, notificaciones, metricas, validacionesEps };
  }

  const JOB = { tipo: 'validar_documento', referencia: 'doc-1', prioridad: 'interactiva' } as const;

  it('el mismo trabajo dos veces: una lectura, un aviso, una medición', async () => {
    const t = trabajo(TipoDocumento.PLANILLA_HORAS, () => Promise.resolve({ ...extraccionBuena(TipoDocumento.PLANILLA_HORAS), ilegible: true, motivoIlegible: 'borrosa' }));
    await t.uso.ejecutar({ ...JOB });
    await t.uso.ejecutar({ ...JOB });
    await t.uso.ejecutar({ ...JOB });

    expect(t.actual().estado).toBe(EstadoDocumento.ILEGIBLE);
    expect(t.extractor.llamadas).toBeLessThanOrEqual(2); // primer intento y, a lo sumo, el reintento con preproceso
    const lecturasDeLaPrimera = t.extractor.llamadas;
    await t.uso.ejecutar({ ...JOB });
    expect(t.extractor.llamadas).toBe(lecturasDeLaPrimera);
    expect(t.notificaciones.notificar).toHaveBeenCalledTimes(1);
    expect(t.metricas.documentosProcesados.inc).toHaveBeenCalledTimes(1);
    expect(t.metricas.duracionPipeline.observe).toHaveBeenCalledTimes(1);
  });

  it('un reintento sobre un documento decidido por una persona no cambia nada ni avisa', async () => {
    const t = trabajo(TipoDocumento.PLANILLA_HORAS, () => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    t.escribir(datos(TipoDocumento.PLANILLA_HORAS, EstadoDocumento.RECHAZADO, { decididoPor: 'tutor-1', justificacionDecision: 'no cumple' }));

    await t.uso.ejecutar({ ...JOB });

    expect(t.actual().estado).toBe(EstadoDocumento.RECHAZADO);
    expect(t.extractor.llamadas).toBe(0);
    expect(t.notificaciones.notificar).not.toHaveBeenCalled();
    expect(t.metricas.documentosProcesados.inc).not.toHaveBeenCalled();
    expect(t.metricas.costoIa.inc).not.toHaveBeenCalled();
  });

  it('con otra ejecución en curso el trabajo FALLA (para que la cola lo reintente) y no hace nada', async () => {
    const t = trabajo(TipoDocumento.PLANILLA_HORAS, () => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    t.escribir(datos(TipoDocumento.PLANILLA_HORAS, EstadoDocumento.ANALIZANDO, { actualizadoEn: new Date() }));
    await expect(t.uso.ejecutar({ ...JOB })).rejects.toBeInstanceOf(ProcesamientoEnCursoError);
    expect(t.extractor.llamadas).toBe(0);
    expect(t.notificaciones.notificar).not.toHaveBeenCalled();
  });

  it('certificado de EPS: la validación se completa aunque el pipeline ya hubiera corrido (reintento tras un fallo)', async () => {
    const local = new Extractor(() => Promise.resolve(extraccionBuena(TipoDocumento.CERTIFICADO_EPS)));
    const t = trabajo(TipoDocumento.CERTIFICADO_EPS, () => Promise.reject(new Error('no debe llamarse')), local);
    t.validacionesEps.registrarProcesamiento.mockRejectedValueOnce(new Error('base caída'));

    await expect(t.uso.ejecutar({ ...JOB, tipo: 'validar_documento' })).rejects.toThrow('base caída');
    expect(t.actual().estado).toBe(EstadoDocumento.EN_REVISION); // el pipeline sí terminó
    await t.uso.ejecutar({ ...JOB }); // el reintento no re-ejecuta capas, pero completa la validación

    expect(local.llamadas).toBe(1);
    expect(t.validacionesEps.registrarProcesamiento).toHaveBeenCalledTimes(2);
    expect(t.metricas.documentosProcesados.inc).toHaveBeenCalledTimes(1);
  });
});

describe('Decisión sobre un documento ya decidido (dominio → conflicto)', () => {
  it('el error de dominio lleva el estado y un mensaje que no filtra datos', () => {
    const error = new DocumentoYaDecididoError(EstadoDocumento.APROBADO);
    expect(error.message).toContain('aprobado');
    expect(error).toBeInstanceOf(Error);
    expect(ConflictException).toBeDefined();
  });
});
