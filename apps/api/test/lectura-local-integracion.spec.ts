import { ConfigService } from '@nestjs/config';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { PipelineValidacionUseCase } from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { ValidacionEpsUseCase } from '../src/application/use-cases/documentos/validacion-eps.use-case';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import {
  DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import { TipoEvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DecisionEps, EstadoProcesamientoEps, RutaValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { LectorDocumentoLocalPort } from '../src/domain/ports/out/lector-documento-local.port';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { ExtraccionLocalAdapter } from '../src/infrastructure/adapters/ia/extraccion-local.adapter';
import { ExtraccionSimuladaAdapter } from '../src/infrastructure/adapters/ia/extraccion.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { practicaDe, usuarioDe } from './soporte-autorizacion';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import { imagenCertificado, pdfDigital, pdfEscaneado, pngQr } from './soporte-lectura-local';
import { ValidacionesEnMemoria } from './soporte-validacion-eps';

/**
 * Del archivo a la ValidacionEps: pipeline → extractor local (lector real) →
 * comparación → evidencias. Comprueba lo que NO debe pasar: que un QR o un
 * «ACTIVO» impreso se tomen por autenticidad o afiliación, y que un reintento
 * repita OCR, duplique evidencia o pise una decisión humana.
 */

jest.setTimeout(240_000);

const AHORA = new Date('2026-10-26T15:00:00Z');
const CEDULA = '1032456786';

/** Lector real con contadores: cuántas veces se rasteriza, se busca QR y se hace OCR. */
function contado(real: LectorDocumentoLocalPort) {
  const llamadas = { texto: 0, render: 0, qr: 0, ocr: 0, imagen: 0 };
  const lector: LectorDocumentoLocalPort = {
    extraerTextoNativo: (...a) => { llamadas.texto += 1; return real.extraerTextoNativo(...a); },
    renderizarPagina: (...a) => { llamadas.render += 1; return real.renderizarPagina(...a); },
    prepararImagen: (...a) => { llamadas.imagen += 1; return real.prepararImagen(...a); },
    detectarQr: (...a) => { llamadas.qr += 1; return real.detectarQr(...a); },
    ejecutarOcr: (...a) => { llamadas.ocr += 1; return real.ejecutarOcr(...a); },
  };
  return { lector, llamadas };
}

const real = new LectorDocumentoLocalAdapter();
afterAll(async () => { await real.onModuleDestroy(); });

function montar(contenido: Buffer, mime: string, opciones: { duplicados?: number } = {}) {
  const { lector, llamadas } = contado(real);
  const local = new ExtraccionLocalAdapter(lector, new ExtraccionSimuladaAdapter());
  const externo = { extraer: jest.fn() };
  const ahora = new Date();
  let almacenado: DatosDocumento = {
    id: 'doc-eps', practicaId: 'practica-1', tipo: TipoDocumento.CERTIFICADO_EPS, version: 1, estado: EstadoDocumento.RECIBIDO,
    nombreOriginal: 'eps', mimeReal: mime, tamanoBytes: contenido.length, hashSha256: 'a'.repeat(64), hashPerceptual: null,
    rutaAlmacenamiento: 'ruta/eps', calidadCaptura: null, banderas: [], puntaje: null, banda: null, extraccion: null,
    decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora, purgarDespuesDe: null,
  };
  const documentos = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)),
    listarPorPractica: () => Promise.resolve([]),
    contarPorHash: () => Promise.resolve(opciones.duplicados ?? 0),
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
    { leer: () => Promise.resolve(contenido) } as never,
    externo,
    { evaluar: () => Promise.resolve([]) },
    new DecodificadorImagenAdapter(),
    { leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }) },
    parametros,
    { get: () => undefined } as unknown as ConfigService,
    local,
  );
  const validaciones = new ValidacionesEnMemoria();
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const estudiante = usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1', documento: CEDULA, nombre: 'Laura Sofía Ramírez Ortiz' });
  const eps = new ValidacionEpsUseCase(
    validaciones, documentos, { buscarPorId: jest.fn().mockResolvedValue(practicaDe()) } as never,
    { buscarPorId: jest.fn().mockResolvedValue(estudiante) } as never, auditoria as never, parametros,
  );
  return { pipeline, eps, validaciones, auditoria, llamadas, externo, actual: () => almacenado };
}

async function procesar(m: ReturnType<typeof montar>) {
  const { documento, ejecutado } = await m.pipeline.procesar('doc-eps');
  const v = await m.eps.registrarProcesamiento(documento, AHORA);
  return { documento, ejecutado, validacion: v };
}

describe('Certificado digital con QR → ValidacionEps', () => {
  it('compara con el estudiante pero NO declara autenticidad ni afiliación por el QR ni por el «ACTIVO» impreso', async () => {
    const pdf = await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/validar?id=1')] });
    const m = montar(pdf, 'application/pdf');
    const { validacion, documento } = await procesar(m);

    expect(validacion?.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESADO);
    expect(validacion?.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(validacion?.autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
    expect(validacion?.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(validacion?.ruta).toBe(RutaValidacionEps.REVISION_MANUAL);
    expect(validacion?.decision).toBe(DecisionEps.PENDIENTE);
    expect(validacion?.instantanea().datosExtraidos?.estadoReportadoCertificado).toBe('ACTIVO');
    expect(validacion?.instantanea().datosVerificados).toBeNull();
    // Nunca se autoaprueba y nunca sale a un extractor externo.
    expect(documento.estado).toBe(EstadoDocumento.EN_REVISION);
    expect(m.externo.extraer).not.toHaveBeenCalled();
  });

  it('registra una evidencia por hecho: texto digital y QR (saneado, sin parámetros)', async () => {
    const m = montar(await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/validar?token=SECRETO')] }), 'application/pdf');
    await procesar(m);
    const tipos = m.validaciones.evidencias.map((e) => e.tipo).sort();
    expect(tipos).toEqual([TipoEvidenciaEps.QR, TipoEvidenciaEps.TEXTO_PDF].sort());
    const qr = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaEps.QR)!;
    expect(qr.origen).toBe('https://eps.example/validar');
    expect(qr.datosObtenidos).toMatchObject({ verificado: false, tieneParametros: true, tipoContenido: 'url' });
    const texto = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaEps.TEXTO_PDF)!;
    expect(texto.datosObtenidos.camposLeidos).toEqual(expect.arrayContaining(['nombre_afiliado', 'documento_afiliado']));
    // Ninguna evidencia lleva valores personales, el texto del certificado ni el token del QR.
    const todo = JSON.stringify(m.validaciones.evidencias) + JSON.stringify(m.auditoria.registrar.mock.calls);
    for (const prohibido of [CEDULA, '1.032.456.786', 'RAMIREZ', 'LAURA', 'SECRETO']) expect(todo).not.toContain(prohibido);
  });

  it('cada campo del resultado dice de qué fuente salió', async () => {
    const m = montar(await pdfDigital(), 'application/pdf');
    const { validacion } = await procesar(m);
    expect(validacion?.instantanea().datosExtraidos?.fuentes).toMatchObject({
      nombre_afiliado: 'texto_nativo', documento_afiliado: 'texto_nativo', entidad_emisora: 'texto_nativo',
    });
  });

  it('PDF con texto nativo: NO se ejecuta OCR', async () => {
    const m = montar(await pdfDigital(), 'application/pdf');
    await procesar(m);
    expect(m.llamadas.ocr).toBe(0);
    expect(m.validaciones.evidencias.some((e) => e.tipo === TipoEvidenciaEps.OCR)).toBe(false);
  });
});

describe('Certificado escaneado → OCR como respaldo', () => {
  it('PDF escaneado: OCR local, evidencia de OCR y fuente «ocr» en los datos', async () => {
    const m = montar(await pdfEscaneado([await imagenCertificado()]), 'application/pdf');
    const { validacion } = await procesar(m);
    expect(m.llamadas.ocr).toBe(1);
    expect(validacion?.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(validacion?.instantanea().datosExtraidos?.fuentes?.documento_afiliado).toBe('ocr');
    const ocr = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaEps.OCR)!;
    expect(ocr.datosObtenidos).toMatchObject({ paginas: [1], procesamiento: 'local' });
    expect(ocr.fuente).toBe('certificado');
    expect(m.externo.extraer).not.toHaveBeenCalled();
  });

  it('imagen (PNG): OCR y QR; sin QR se deja constancia de que no se encontró', async () => {
    const m = montar(await imagenCertificado(), 'image/png');
    await procesar(m);
    const qr = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaEps.QR)!;
    expect(qr.resultado).toBe('no_encontrado');
  });

  it('OCR sin lectura útil: queda en revisión humana, sin coincidencia y sin aprobar nada', async () => {
    const m = montar(await imagenCertificado(['Hoja en blanco con una nota ilegible'], { fuente: 20 }), 'image/png');
    const { validacion, documento } = await procesar(m);
    expect(validacion?.coincidencia).toBe(CoincidenciaEps.INSUFICIENTE);
    expect(validacion?.decision).toBe(DecisionEps.PENDIENTE);
    expect([EstadoDocumento.EN_REVISION, EstadoDocumento.ILEGIBLE]).toContain(documento.estado);
  });

  it('un archivo corrupto se devuelve como ilegible (reenvío), no se aprueba', async () => {
    const pdf = await pdfDigital();
    const m = montar(pdf.subarray(0, 200), 'application/pdf');
    const { documento } = await m.pipeline.procesar('doc-eps');
    expect(documento.estado).toBe(EstadoDocumento.ILEGIBLE);
  });
});

// Regresión: «Datos extraídos» vacíos en la Mesa. Un certificado sintético legible DEBE terminar con todos sus campos.
const LINEAS_SINTETICAS = [
  'Entidad Promotora de Salud EPS PRUEBA S.A.',
  'CERTIFICADO DE AFILIACION',
  'Nombre: PERSONA FICTICIA',
  'Documento: CC 123456789',
  'Tipo de afiliado: COTIZANTE',
  'Estado: ACTIVO',
  'Fecha de expedición: 20/10/2026',
];

describe('Regresión · certificado sintético completo (EPS PRUEBA / PERSONA FICTICIA / CC 123456789)', () => {
  const esperado = {
    eps: expect.stringMatching(/EPS PRUEBA/), nombre: 'PERSONA FICTICIA', tipoDocumento: 'CC', numeroDocumento: '123456789',
    estadoReportadoCertificado: 'ACTIVO', tipoAfiliado: 'cotizante', fechaExpedicion: '2026-10-20',
  };

  it('PDF con texto: todos los campos llegan a la validación', async () => {
    const m = montar(await pdfDigital(LINEAS_SINTETICAS), 'application/pdf');
    const { validacion } = await procesar(m);
    expect(validacion?.instantanea().datosExtraidos).toMatchObject(esperado);
    expect(m.llamadas.ocr).toBe(0);
  });

  it('PDF que requiere OCR: los campos llegan con fuente «ocr»', async () => {
    const m = montar(await pdfEscaneado([await imagenCertificado(LINEAS_SINTETICAS)]), 'application/pdf');
    const { validacion } = await procesar(m);
    expect(m.llamadas.ocr).toBe(1);
    const x = validacion?.instantanea().datosExtraidos;
    expect(x).toMatchObject({ nombre: 'PERSONA FICTICIA', numeroDocumento: '123456789', estadoReportadoCertificado: 'ACTIVO' });
    expect(x?.fuentes?.documento_afiliado).toBe('ocr');
  });

  describe('escaneado SINTÉTICO tipo «ALIAN SALUD» (rasterizado: sin capa de texto) → render → OCR → parser → datosExtraidos → Mesa', () => {
    const FICHA = [
      'ALIAN SALUD EPS', 'CERTIFICA QUE:', 'PERSONA PRUEBA EJEMPLO', 'CC 123456789',
      'Fecha de afiliación: 01/02/2024', 'Fecha de generación: 20/10/2026', 'Estado: ACTIVO', 'Tipo afiliado: COTIZANTE',
    ];
    const CARTA = [
      'Alian Salud', 'EPS', 'CERTIFICA QUE:', 'El(La) Señor(a) PERSONA PRUEBA EJEMPLO identificado con CC 123456789',
      'se encuentra afiliado(a) a nuestra EPS', 'Fecha de Afiliación: 01/02/2024', 'Estado: ACTIVO', 'Tipo de Afiliado: COTIZANTE',
      'La presente certificación se expide a los 20 días del mes de octubre del año 2026', 'ALIAN SALUD EPS.',
    ];

    it.each([['ficha', FICHA], ['carta', CARTA]])('%s: sin capa de texto, con OCR local, y todos los campos clave llegan a la Mesa', async (_n, lineas) => {
      const pdf = await pdfEscaneado([await imagenCertificado(lineas, { ancho: 1500, fuente: 30 })]);
      const m = montar(pdf, 'application/pdf');
      const { validacion } = await procesar(m);
      // Es una imagen: no hay texto nativo y SÍ hubo OCR local.
      expect(m.llamadas.ocr).toBeGreaterThanOrEqual(1);
      expect(m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaEps.TEXTO_PDF)?.resultado).toBe('sin_texto');
      const ocr = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaEps.OCR)!;
      expect(ocr.datosObtenidos).toMatchObject({ procesamiento: 'local', suficiencia: 'procesable' });
      const x = validacion?.instantanea().datosExtraidos;
      expect(x).toMatchObject({
        nombre: 'PERSONA PRUEBA EJEMPLO', tipoDocumento: 'CC', numeroDocumento: '123456789', estadoReportadoCertificado: 'ACTIVO',
        tipoAfiliado: 'cotizante', fechaExpedicion: '2026-10-20',
      });
      expect(x?.eps).toMatch(/ALIAN\s+SALUD/i);
      // Mesa: método «ocr» (todas las fuentes son OCR) y la fecha de afiliación no se confunde con la de expedición.
      expect(new Set(Object.values(x?.fuentes ?? {}))).toEqual(new Set(['ocr']));
      expect(x?.fechaExpedicion).not.toBe('2024-02-01');
      expect(m.externo.extraer).not.toHaveBeenCalled();
    });
  });

  it('archivo ya presentado en otros expedientes: el pipeline lo detiene ANTES de leer (causa de «datos vacíos»), sin inventar campos', async () => {
    const m = montar(await pdfDigital(LINEAS_SINTETICAS), 'application/pdf', { duplicados: 2 });
    const { validacion, documento } = await procesar(m);
    expect(documento.banderas.map((b) => b.codigo)).toContain('C0_HASH_DUPLICADO');
    const x = validacion?.instantanea().datosExtraidos;
    expect(Object.entries(x ?? {}).filter(([k, v]) => k !== 'fuentes' && v !== null)).toEqual([]);
    expect(m.llamadas.texto).toBe(0);
  });

  it('extracción fallida (PDF dañado): queda en revisión humana, con bandera, sin campos y sin aprobar', async () => {
    const caido = montar(Buffer.from('%PDF-1.4\n'), 'application/pdf');
    const { validacion, documento } = await procesar(caido);
    expect([EstadoDocumento.ILEGIBLE, EstadoDocumento.EN_REVISION]).toContain(documento.estado);
    expect(validacion === null || validacion.decision === DecisionEps.PENDIENTE).toBe(true);
    expect(Object.values(validacion?.instantanea().datosExtraidos ?? {}).filter((v) => typeof v === 'string' && v !== '')).toEqual([]);
  });
});

describe('Idempotencia de la lectura local', () => {
  it('un reintento NO repite la lectura ni el OCR', async () => {
    const m = montar(await pdfEscaneado([await imagenCertificado()]), 'application/pdf');
    await procesar(m);
    const antes = { ...m.llamadas };
    const segundo = await procesar(m);
    expect(segundo.ejecutado).toBe(false);
    expect(m.llamadas).toEqual(antes);
    expect(m.llamadas.ocr).toBe(1);
  });

  it('un reintento NO duplica evidencia, validación ni auditoría', async () => {
    const m = montar(await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/v')] }), 'application/pdf');
    await procesar(m);
    const evidencias = m.validaciones.evidencias.length;
    const auditorias = m.auditoria.registrar.mock.calls.length;
    for (let i = 0; i < 3; i += 1) await procesar(m);
    expect(m.validaciones.filas.size).toBe(1);
    expect(m.validaciones.evidencias).toHaveLength(evidencias);
    expect(m.auditoria.registrar.mock.calls).toHaveLength(auditorias);
  });

  it('dos registros simultáneos de la misma lectura dejan una sola serie de evidencias', async () => {
    const m = montar(await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/v')] }), 'application/pdf');
    const { documento } = await m.pipeline.procesar('doc-eps');
    await Promise.all([m.eps.registrarProcesamiento(documento, AHORA), m.eps.registrarProcesamiento(documento, AHORA)]);
    expect(m.validaciones.filas.size).toBe(1);
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaEps.TEXTO_PDF)).toHaveLength(1);
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaEps.QR)).toHaveLength(1);
  });

  it('una decisión humana permanece aunque el trabajo se reintente después', async () => {
    const m = montar(await pdfDigital(), 'application/pdf');
    const { documento, validacion } = await procesar(m);
    const id = validacion!.id;
    const fila = m.validaciones.filas.get(id)!;
    m.validaciones.filas.set(id, { ...fila, decision: DecisionEps.RECHAZADO, decididoPor: 'aux-1', decididoEn: AHORA });
    const antes = JSON.stringify([...m.validaciones.filas.values()]);
    const evidencias = m.validaciones.evidencias.length;
    await m.eps.registrarProcesamiento(documento, new Date(AHORA.getTime() + 600_000));
    expect(JSON.stringify([...m.validaciones.filas.values()])).toBe(antes);
    expect(m.validaciones.evidencias).toHaveLength(evidencias);
  });

  it('procesando → procesado: el estado avanza y un error queda registrado y se reanuda', async () => {
    const m = montar(await pdfDigital(), 'application/pdf');
    await m.eps.marcarProcesando('doc-eps');
    const id = [...m.validaciones.filas.keys()][0];
    expect(m.validaciones.filas.get(id)?.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESANDO);
    await m.eps.marcarErrorProcesamiento('doc-eps', 'PROCESAMIENTO_FALLIDO');
    expect(m.validaciones.filas.get(id)).toMatchObject({ estadoProcesamiento: EstadoProcesamientoEps.ERROR, errorCodigo: 'PROCESAMIENTO_FALLIDO' });
    const r = await procesar(m);
    expect(r.validacion?.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESADO);
    expect(m.auditoria.registrar.mock.calls.map((c: unknown[]) => (c[0] as { accion: string }).accion))
      .toContain(AccionAuditada.VALIDACION_EPS_PROCESADA);
  });
});
