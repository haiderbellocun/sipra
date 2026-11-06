import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { PipelineValidacionUseCase } from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { ProcesarTrabajoUseCase } from '../src/application/use-cases/documentos/procesar-trabajo.use-case';
import { ValidacionRutUseCase } from '../src/application/use-cases/documentos/validacion-rut.use-case';
import {
  BandaPuntaje, DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona, autenticidadPorDefecto,
} from '../src/domain/entities/documento-empresarial';
import { ResultadoExtraccion } from '../src/domain/ports/out/servicios-externos.port';
import { LecturaLocalRutService, LecturaRutPersistible } from '../src/domain/services/lectura-local-rut.domain-service';
import { ModoProcesamiento, modoProcesamientoDe, permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { ExtraccionLocalAdapter } from '../src/infrastructure/adapters/ia/extraccion-local.adapter';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import { RepoMemoria } from './soporte-repo-documento-empresarial';
import { puertosRutSinteticos, rutSintetico } from './soporte-rut-sintetico';

const PRACTICA = '00000000-0000-4000-8000-0000000000a1';
const ESTUDIANTE = '00000000-0000-4000-8000-0000000000b1';
const AHORA = new Date('2026-11-03T15:00:00Z');
const HASH = 'a'.repeat(64);
const CEDULA = '1000000001';
const dv = (n: string): string => String(Nit.calcularDigitoVerificacion(n));

const lecturaPn = (sobre: Partial<LecturaRutPersistible> = {}): LecturaRutPersistible => ({
  hashSha256: HASH, tipoDetectado: C.RUT_PERSONA_NATURAL, motivosClasificacion: ['rut_tipo_contribuyente'], metodo: 'texto', confianzaDocumento: 1, lecturaDudosa: false,
  datos: {
    tipoPersona: TipoPersona.NATURAL, nit: CEDULA, dv: dv(CEDULA), fechaGeneracion: '2024-03-15', tipoDocumento: 'CC', numeroDocumento: CEDULA,
    nombres: 'MARIA CAMILA', apellidos: 'PEREZ GOMEZ', ciiuPrincipal: '4711', divipolaMunicipio: '11001', controlNit: 'confiable',
    confianzaCampos: { nit: 1, dv: 1, nombre: 1, fechaGeneracion: 1, divipola: 1, tipoPersona: 1 },
  },
  autenticidad: autenticidadPorDefecto(), resumen: { metodo: 'texto', paginas: 1, paginasOcr: 0, confianzaOcrMedia: null, lecturaDudosa: false }, motivos: [], ...sobre,
});

function datosDocumento(tipo: TipoDocumento, extraccion: Record<string, unknown> | null, estado = EstadoDocumento.EN_REVISION, id: string = randomUUID()): DatosDocumento {
  return {
    id, practicaId: PRACTICA, tipo, version: 1, estado, nombreOriginal: 'rut.pdf', mimeReal: 'application/pdf', tamanoBytes: 10, hashSha256: HASH, hashPerceptual: null,
    rutaAlmacenamiento: `ruta/${id}.pdf`, calidadCaptura: null, banderas: [], puntaje: 90, banda: BandaPuntaje.VERDE, extraccion, decididoPor: null,
    justificacionDecision: null, motivoDevolucion: null, cargadoEn: AHORA, actualizadoEn: AHORA, purgarDespuesDe: null,
  };
}

describe('ValidacionRutUseCase · flujo de carga y comparación con SIPRA', () => {
  function entorno(opciones: { sipra?: { documento: string; nombre: string; empresa?: { nitNumero: string; nitDv: number; razonSocial: string } | null } } = {}) {
    const sipra = { documento: CEDULA, nombre: 'MARÍA CAMILA PÉREZ GÓMEZ', empresa: null as null | { nitNumero: string; nitDv: number; razonSocial: string }, ...opciones.sipra };
    const repo = new RepoMemoria();
    const lecturasDelArchivo = jest.fn();
    const usuarios = { buscarPorId: async () => ({ nombre: sipra.nombre, instantanea: () => ({ documento: sipra.documento }) }) };
    const empresas = { buscarPorId: async () => (sipra.empresa ? { instantanea: () => sipra.empresa } : null) };
    const practicas = {
      buscarPorId: async () => ({ estudianteId: ESTUDIANTE, instantanea: () => ({ empresaId: sipra.empresa ? 'e-1' : null, empresaRazonSocial: null, empresaNit: null }) }),
    };
    const docs = new Map<string, Documento>();
    const agregar = (tipo: TipoDocumento, extraccion: Record<string, unknown> | null, estado = EstadoDocumento.EN_REVISION): string => {
      const d = datosDocumento(tipo, extraccion, estado);
      docs.set(d.id, Documento.desde(d));
      repo.documentos.push({ documentoId: d.id, practicaId: PRACTICA, tipo, hash: HASH });
      return d.id;
    };
    const caso = new ValidacionRutUseCase(
      repo, { buscarPorId: async (id: string) => docs.get(id) ?? null } as never, practicas as never,
      { leer: async () => Buffer.from('pdf') } as never,
      { leer: async () => { lecturasDelArchivo(); throw new Error('no debería releer el archivo'); } },
      usuarios as never, empresas as never,
    );
    return { caso, repo, sipra, docs, agregar, lecturasDelArchivo };
  }

  it('registra la lectura que dejó el pipeline SIN releer el archivo: revisión, comparación y tres evidencias', async () => {
    const { caso, repo, docs, agregar, lecturasDelArchivo } = entorno();
    const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn() });
    const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
    expect(v).toMatchObject({ estado: Estado.REVISION, tipoDetectado: C.RUT_PERSONA_NATURAL, expectativa: 'coincide', lecturaDudosa: false, procesadaEn: AHORA });
    expect(v.comparacion).toMatchObject({ veredicto: 'consistente', hayDiscrepancia: false });
    expect(repo.evidencias.map((e) => e.tipo).sort()).toEqual(['clasificacion', 'comparacion', 'lectura_documento']);
    expect(lecturasDelArchivo).not.toHaveBeenCalled();
    // Idempotente: repetirlo no duplica nada.
    await caso.registrarProcesamiento(docs.get(id)!, new Date('2026-11-04T00:00:00Z'));
    expect(repo.filas.size).toBe(1);
    expect(repo.evidencias).toHaveLength(3);
  });

  it('con una discrepancia real en el documento: veredicto discrepancia, solo en ese campo; NO hay decisión', async () => {
    const { caso, docs, agregar } = entorno({ sipra: { documento: '1000000099', nombre: 'MARIA CAMILA PEREZ GOMEZ' } });
    const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn() });
    const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
    expect(v.estado).toBe(Estado.REVISION);
    expect((v.comparacion as { campos: { campo: string; resultado: string }[] }).campos.filter((c) => c.resultado === 'diferente').map((c) => c.campo)).toEqual(['documento']);
  });

  it('lectura dudosa: la comparación queda en información insuficiente (no usa un OCR dudoso para discrepancias)', async () => {
    const { caso, docs, agregar } = entorno({ sipra: { documento: '1000000099', nombre: 'JUAN RUIZ' } });
    const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn({ lecturaDudosa: true, metodo: 'ocr', confianzaDocumento: 0.77 }) });
    const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
    expect(v.comparacion).toMatchObject({ veredicto: 'revision_necesaria', hayDiscrepancia: false });
    expect(v.lecturaDudosa).toBe(true);
  });

  it('persona distinta a la esperada: no se compara como PN; se informa la expectativa', async () => {
    const { caso, docs, agregar } = entorno({ sipra: { documento: CEDULA, nombre: 'MARIA', empresa: { nitNumero: '900123456', nitDv: Number(dv('900123456')), razonSocial: 'EMPRESA SAS' } } });
    const pj = lecturaPn({
      tipoDetectado: C.RUT_PERSONA_JURIDICA,
      datos: { tipoPersona: TipoPersona.JURIDICA, nit: '900123456', dv: dv('900123456'), fechaGeneracion: '2024-03-15', razonSocial: 'EMPRESA SAS', controlNit: 'confiable' },
    });
    const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: pj });
    const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
    expect(v).toMatchObject({ tipoDetectado: C.RUT_PERSONA_JURIDICA, expectativa: 'persona_distinta' });
    expect(v.comparacion).toMatchObject({ veredicto: 'no_aplica', hayDiscrepancia: false });
  });

  it('documento incorrecto o no determinable: sin comparación (nunca falsos «diferente») y solo dos evidencias', async () => {
    for (const tipoDetectado of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE]) {
      const { caso, repo, docs, agregar } = entorno();
      const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn({ tipoDetectado, datos: null }) });
      const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
      expect(v).toMatchObject({ estado: Estado.REVISION, tipoDetectado, comparacion: null, datosExtraidos: null });
      expect(repo.evidencias.map((e) => e.tipo).sort()).toEqual(['clasificacion', 'lectura_documento']);
    }
  });

  it('sin lectura del pipeline lee el archivo en local; si el documento ya volvió al estudiante, no registra nada', async () => {
    const { caso, docs, agregar, lecturasDelArchivo } = entorno();
    const sinLectura = agregar(TipoDocumento.RUT_NATURAL, null);
    const v = (await caso.registrarProcesamiento(docs.get(sinLectura)!, AHORA))!.instantanea();
    expect(lecturasDelArchivo).toHaveBeenCalled();
    expect(v).toMatchObject({ estado: Estado.ERROR, errorCodigo: 'error_procesamiento' });
    const devuelto = agregar(TipoDocumento.RUT_NATURAL, null, EstadoDocumento.ILEGIBLE);
    expect(await caso.registrarProcesamiento(docs.get(devuelto)!, AHORA)).toBeNull();
    // Mientras el pipeline no termina, no hay nada que registrar.
    expect(await caso.registrarProcesamiento(docs.get(agregar(TipoDocumento.RUT_NATURAL, null, EstadoDocumento.ANALIZANDO))!, AHORA)).toBeNull();
    // Otros tipos no se procesan aquí.
    expect(await caso.registrarProcesamiento(docs.get(agregar(TipoDocumento.CEDULA, null))!, AHORA)).toBeNull();
  });

  it('un error técnico queda en «error» con un código controlado y un reintento con lectura lo completa', async () => {
    const { caso, docs, agregar } = entorno();
    const id = agregar(TipoDocumento.RUT_NATURAL, null);
    await caso.marcarProcesando(id, AHORA);
    await caso.marcarErrorProcesamiento(id, 'PROCESAMIENTO_FALLIDO', AHORA);
    expect((await caso.procesar(id, AHORA).catch(() => null))?.estado).toBe(Estado.ERROR);
    const conLectura = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn() });
    await caso.marcarProcesando(conLectura, AHORA);
    await caso.marcarErrorProcesamiento(conLectura, 'PROCESAMIENTO_FALLIDO', AHORA);
    const v = (await caso.registrarProcesamiento(docs.get(conLectura)!, AHORA))!.instantanea();
    expect(v).toMatchObject({ estado: Estado.REVISION, errorCodigo: null });
  });

  describe('recálculo y «datos de SIPRA cambiaron después»', () => {
    it('recalcula SIN releer el archivo, en una ronda nueva, conservando las evidencias anteriores', async () => {
      const { caso, repo, sipra, docs, agregar, lecturasDelArchivo } = entorno();
      const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn() });
      const primera = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
      expect(primera.comparacion).toMatchObject({ veredicto: 'consistente' });
      const evidenciasAntes = JSON.stringify(repo.evidencias);
      expect(await caso.datosSipraCambiaron(id)).toBe(false);

      sipra.documento = '1000000099';
      expect(await caso.datosSipraCambiaron(id)).toBe(true);
      const v = (await caso.recalcularComparacion(id, new Date('2026-11-04T10:00:00Z')))!.instantanea();
      expect(v.comparacion).toMatchObject({ veredicto: 'discrepancia' });
      expect(v.intentos).toBe(primera.intentos + 1);
      expect(v.estado).toBe(Estado.REVISION);
      // La lectura no cambió; las evidencias previas siguen idénticas y hay UNA nueva de comparación.
      expect(v.datosExtraidos).toEqual(primera.datosExtraidos);
      expect(JSON.stringify(repo.evidencias.slice(0, 3))).toBe(evidenciasAntes);
      expect(repo.evidencias).toHaveLength(4);
      expect(repo.evidencias[3]).toMatchObject({ tipo: 'comparacion', intento: v.intentos });
      expect(lecturasDelArchivo).not.toHaveBeenCalled();
      // Ya está al día: otro recálculo no hace nada.
      await caso.recalcularComparacion(id, new Date('2026-11-05T10:00:00Z'));
      expect(repo.evidencias).toHaveLength(4);
      expect(await caso.datosSipraCambiaron(id)).toBe(false);
    });

    it('sin cambio en SIPRA el recálculo es un no-op; un documento incorrecto no tiene qué recalcular', async () => {
      const { caso, repo, docs, agregar } = entorno();
      const id = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn() });
      await caso.registrarProcesamiento(docs.get(id)!, AHORA);
      const antes = JSON.stringify((await caso.recalcularComparacion(id, AHORA))!.instantanea());
      expect(JSON.stringify((await caso.recalcularComparacion(id, AHORA))!.instantanea())).toBe(antes);
      expect(repo.evidencias).toHaveLength(3);
      const malo = agregar(TipoDocumento.RUT_NATURAL, { lecturaRut: lecturaPn({ tipoDetectado: C.DOCUMENTO_INCORRECTO, datos: null }) });
      await caso.registrarProcesamiento(docs.get(malo)!, AHORA);
      expect((await caso.recalcularComparacion(malo, AHORA))!.instantanea().comparacion).toBeNull();
    });
  });
});

// ── Worker de procesamiento: el RUT entra al flujo real de carga ──────────────────────────

describe('ProcesarTrabajoUseCase · el RUT entra al flujo de carga', () => {
  function montar(tipo: TipoDocumento, pipelineFalla = false) {
    const d = datosDocumento(tipo, null);
    const documento = Documento.desde(d);
    const llamadas: string[] = [];
    const rut = {
      marcarProcesando: jest.fn(async () => { llamadas.push('rut:procesando'); }),
      registrarProcesamiento: jest.fn(async () => { llamadas.push('rut:registrar'); return null; }),
      marcarErrorProcesamiento: jest.fn(async () => { llamadas.push('rut:error'); }),
    };
    const pipeline = { procesar: jest.fn(async () => { llamadas.push('pipeline'); if (pipelineFalla) throw new Error('falló'); return { documento, ejecutado: true }; }) };
    const contador = { observe: jest.fn(), inc: jest.fn() };
    const caso = new ProcesarTrabajoUseCase(
      pipeline as never, { buscarPorId: async () => documento } as never, {} as never, {} as never, {} as never,
      { notificar: jest.fn() } as never,
      { duracionPipeline: contador, documentosProcesados: contador, documentosAutoAprobados: contador, costoIa: contador } as never,
      { marcarProcesando: jest.fn(), registrarProcesamiento: jest.fn(), marcarErrorProcesamiento: jest.fn() } as never,
      undefined, undefined, undefined, rut as never,
    );
    return { caso, rut, llamadas, id: d.id };
  }

  it.each([TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO])('%s: «procesando» → pipeline → validación del RUT (lectura, clasificación, persistencia, comparación)', async (tipo) => {
    const { caso, rut, llamadas, id } = montar(tipo);
    await caso.ejecutar({ tipo: 'validar_documento', referencia: id } as never);
    expect(llamadas).toEqual(['rut:procesando', 'pipeline', 'rut:registrar']);
    expect(rut.registrarProcesamiento).toHaveBeenCalledTimes(1);
  });

  it('un error del pipeline deja la validación en «error» con un código controlado y relanza para el reintento', async () => {
    const { caso, rut, id } = montar(TipoDocumento.RUT_NATURAL, true);
    await expect(caso.ejecutar({ tipo: 'validar_documento', referencia: id } as never)).rejects.toThrow('falló');
    expect(rut.marcarErrorProcesamiento).toHaveBeenCalledWith(id, 'PROCESAMIENTO_FALLIDO');
    expect(rut.registrarProcesamiento).not.toHaveBeenCalled();
  });

  it('los demás tipos documentales no pasan por la validación del RUT', async () => {
    const { caso, rut, id } = montar(TipoDocumento.CEDULA);
    await caso.ejecutar({ tipo: 'validar_documento', referencia: id } as never);
    expect(rut.marcarProcesando).not.toHaveBeenCalled();
    expect(rut.registrarProcesamiento).not.toHaveBeenCalled();
  });
});

// ── Pipeline y política: local, sin autoaprobación ────────────────────────────────────────

const PNG = new DecodificadorImagenAdapter().codificarPng({ ancho: 64, alto: 64, pixeles: new Uint8Array(64 * 64).fill(200) });

function montarPipeline(tipo: TipoDocumento, externo: { extraer: () => Promise<ResultadoExtraccion> }, local: { extraer: () => Promise<ResultadoExtraccion> }) {
  let almacenado: DatosDocumento = { ...datosDocumento(tipo, null, EstadoDocumento.RECIBIDO, 'doc-rut'), mimeReal: 'image/png', tamanoBytes: PNG.length };
  const documentos = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)), listarPorPractica: () => Promise.resolve([]), contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]), ultimaVersion: () => Promise.resolve(1),
    guardar: (d: DatosDocumento) => { almacenado = d; return Promise.resolve(Documento.desde(d)); },
    listarParaPurga: () => Promise.resolve([]), gastoIaDesde: () => Promise.resolve(0), contarLecturasDesde: () => Promise.resolve(0),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
  };
  const parametros = new ParametrosUseCase({ listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve() });
  const pipeline = new PipelineValidacionUseCase(
    documentos, { buscarPorId: () => Promise.resolve(null) } as never, { buscarPorId: () => Promise.resolve(null) } as never,
    { leer: () => Promise.resolve(PNG) } as never, externo, { evaluar: () => Promise.resolve([]) }, new DecodificadorImagenAdapter(),
    { leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }) }, parametros, { get: () => undefined } as unknown as ConfigService, local,
  );
  return { pipeline, actual: () => almacenado };
}

function extraccionRut(lectura: LecturaRutPersistible, tipoDetectado: TipoDocumento | null): ResultadoExtraccion {
  return {
    tipoDetectado, campos: { nit: { valor: lectura.datos?.nit ?? null, confianza: 1, evidencia: null } }, ilegible: false, modelo: 'local-pdfjs-tesseract-rut',
    tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, proveedor: 'local', lecturaRut: lectura,
  };
}

describe('Política y pipeline del RUT: solo local, jamás autoaprobado', () => {
  it('el RUT se procesa solo en local y nunca se autoaprueba; los demás tipos conservan su política', () => {
    for (const t of [TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO]) {
      expect(modoProcesamientoDe(t)).toBe(ModoProcesamiento.LOCAL);
      expect(permiteAutoAprobacionDelPipeline(t)).toBe(false);
    }
    expect(permiteAutoAprobacionDelPipeline(TipoDocumento.CEDULA)).toBe(true);
    expect(permiteAutoAprobacionDelPipeline(TipoDocumento.CERTIFICADO_ARL)).toBe(true);
    // La Cámara de Comercio también es solo local desde su Bloque 2 (ver camara-lector.spec.ts).
    expect(modoProcesamientoDe(TipoDocumento.CAMARA_COMERCIO)).toBe(ModoProcesamiento.LOCAL);
    expect(modoProcesamientoDe(TipoDocumento.CERTIFICADO_EPS)).toBe(ModoProcesamiento.LOCAL);
  });

  it('un RUT consistente y de banda verde queda EN REVISIÓN (no auto_aprobado), no sale a un proveedor externo y guarda su lectura', async () => {
    const externo = { extraer: jest.fn(async () => { throw new Error('el RUT nunca sale a un proveedor externo'); }) };
    const local = { extraer: jest.fn(async () => extraccionRut(lecturaPn(), TipoDocumento.RUT_NATURAL)) };
    const { pipeline, actual } = montarPipeline(TipoDocumento.RUT_NATURAL, externo, local);
    await pipeline.procesar('doc-rut');
    expect(externo.extraer).not.toHaveBeenCalled();
    expect(local.extraer).toHaveBeenCalledTimes(1);
    const d = actual();
    expect(d.estado).toBe(EstadoDocumento.EN_REVISION);
    expect(d.estado).not.toBe(EstadoDocumento.AUTO_APROBADO);
    expect(d.banderas.map((b) => b.codigo)).toContain('C3_AUTOAPROBACION_NO_HABILITADA');
    expect((d.extraccion as { lecturaRut?: LecturaRutPersistible }).lecturaRut?.tipoDetectado).toBe(C.RUT_PERSONA_NATURAL);
  });

  it('el flujo nuevo NO produce la causal «año en curso» ni RUT_NO_VIGENTE, aunque el RUT sea de 2019', async () => {
    const antiguo = lecturaPn();
    antiguo.datos = { ...antiguo.datos!, fechaGeneracion: '2019-02-01' };
    const local = { extraer: jest.fn(async () => extraccionRut(antiguo, TipoDocumento.RUT_NATURAL)) };
    const { pipeline, actual } = montarPipeline(TipoDocumento.RUT_NATURAL, { extraer: jest.fn() }, local);
    await pipeline.procesar('doc-rut');
    const texto = JSON.stringify(actual().banderas);
    expect(texto).not.toMatch(/VIGENTE|ANO_EN_CURSO|a[nñ]o en curso|vencid/i);
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('un documento que no es un RUT (factura, certificado de cámara) se marca C2_TIPO_INCORRECTO y queda en revisión', async () => {
    for (const tipoDetectado of [C.DOCUMENTO_INCORRECTO, C.CAMARA_EXISTENCIA_REPRESENTACION]) {
      const local = { extraer: jest.fn(async () => extraccionRut(lecturaPn({ tipoDetectado, datos: null }), null)) };
      const { pipeline, actual } = montarPipeline(TipoDocumento.RUT_JURIDICO, { extraer: jest.fn() }, local);
      await pipeline.procesar('doc-rut');
      expect(actual().banderas.map((b) => b.codigo)).toContain('C2_TIPO_INCORRECTO');
      expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    }
  });

  it('un RUT jurídico cargado como natural: el pipeline lo marca como tipo distinto y NO lo autoaprueba', async () => {
    const pj = lecturaPn({ tipoDetectado: C.RUT_PERSONA_JURIDICA });
    const local = { extraer: jest.fn(async () => extraccionRut(pj, TipoDocumento.RUT_JURIDICO)) };
    const { pipeline, actual } = montarPipeline(TipoDocumento.RUT_NATURAL, { extraer: jest.fn() }, local);
    await pipeline.procesar('doc-rut');
    expect(actual().banderas.map((b) => b.codigo)).toContain('C2_TIPO_INCORRECTO');
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });
});

// ── El extractor local del pipeline para el RUT ───────────────────────────────────────────

describe('ExtraccionLocalAdapter · RUT', () => {
  const { lector, geometria } = puertosRutSinteticos([{ nativo: rutSintetico({ persona: 'natural' }) }], { 1: ['https://muisca.dian.gov.co/x?c=SECRETO'] });
  const rutAdapter = { leer: (c: Buffer, m: string) => new LecturaLocalRutService(lector, geometria).leer(c, m) };
  const respaldo = { extraer: jest.fn() };
  const adaptador = new ExtraccionLocalAdapter(lector, respaldo as never, undefined, undefined, rutAdapter as never);

  it('lee en local, traduce a la forma del pipeline y deja la lectura minimizada, sin pasar por el extractor de respaldo', async () => {
    const r = await adaptador.extraer(Buffer.from('%PDF'), 'application/pdf', TipoDocumento.RUT_NATURAL);
    expect(respaldo.extraer).not.toHaveBeenCalled();
    expect(r).toMatchObject({ proveedor: 'local', costoUsd: 0, ilegible: false, tipoDetectado: TipoDocumento.RUT_NATURAL, modelo: 'local-pdfjs-tesseract-rut' });
    expect(r.campos.nit.valor).toBe('1000000001');
    expect(r.lecturaRut).toMatchObject({ tipoDetectado: C.RUT_PERSONA_NATURAL, metodo: 'texto', lecturaDudosa: false });
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    // No hay criterios de «vigencia»: el extractor local no produce hallazgos de «año en curso».
    expect(r).not.toHaveProperty('criterios');
  });

  it('un RUT jurídico se informa como tal (el pipeline decide si es el tipo esperado); un no-RUT no trae tipo', async () => {
    const pj = puertosRutSinteticos([{ nativo: rutSintetico({ persona: 'juridica' }) }]);
    const a = new ExtraccionLocalAdapter(pj.lector, respaldo as never, undefined, undefined, { leer: (c: Buffer, m: string) => new LecturaLocalRutService(pj.lector, pj.geometria).leer(c, m) } as never);
    expect((await a.extraer(Buffer.from('x'), 'application/pdf', TipoDocumento.RUT_NATURAL)).tipoDetectado).toBe(TipoDocumento.RUT_JURIDICO);
    const factura = puertosRutSinteticos([{ nativo: 'FACTURA ELECTRONICA DE VENTA forma de pago contado medio de pago efectivo cliente persona de prueba emisor camara de comercio'.split(' ').map((t, i) => ({ texto: t, x: 0.05 + (i % 10) * 0.08, y: 0.1 + Math.floor(i / 10) * 0.02, ancho: 0.05, alto: 0.01, confianza: 100 })) }]);
    const b = new ExtraccionLocalAdapter(factura.lector, respaldo as never, undefined, undefined, { leer: (c: Buffer, m: string) => new LecturaLocalRutService(factura.lector, factura.geometria).leer(c, m) } as never);
    const r = await b.extraer(Buffer.from('x'), 'application/pdf', TipoDocumento.RUT_NATURAL);
    expect(r.tipoDetectado).toBeNull();
    expect(r.lecturaRut?.tipoDetectado).toBe(C.DOCUMENTO_INCORRECTO);
  });
});
