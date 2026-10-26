import { BadRequestException, ConflictException, ForbiddenException, GoneException, Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {
  ConsultaAdresUseCase, PORTAL_ADRES_OFICIAL, VIGENCIA_CONSULTA_ADRES_MS,
} from '../src/application/use-cases/documentos/consulta-adres.use-case';
import { EstadoAdres, RecomendacionEps } from '../src/domain/entities/adres';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { FuenteEvidenciaEps, TipoEvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, DecisionEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { ESC_A, actorDe, documentoDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { imagenCertificado, pdfDigital, pdfEscaneado } from './soporte-lectura-local';
import { ValidacionesEnMemoria } from './soporte-validacion-eps';

/**
 * Consulta ADRES asistida de punta a punta, con PDFs de ADRES SINTÉTICOS y el
 * lector local real (pdf.js + Tesseract). Nada de esto toca ADRES ni Internet:
 * un espía de red lo comprueba en cada prueba.
 */

jest.setTimeout(240_000);

const AHORA = new Date('2026-10-26T15:00:00Z');
const MIN = 60_000;
const CEDULA = '1032456786';
const CERTIFICADO: DatosExtraidosEps = {
  tipoDocumento: 'CC', numeroDocumento: CEDULA, nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS Sintetica S.A.', epsClave: 'SINTETICA',
  regimen: 'contributivo', tipoAfiliado: 'beneficiario', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
};

const real = new LectorDocumentoLocalAdapter();
afterAll(async () => { await real.onModuleDestroy(); });

// ── PDFs sintéticos de ADRES ────────────────────────────────────────────────

function lineasAdres(c: Partial<Record<string, string | null>> = {}): string[] {
  const v = {
    tipo: 'CC', numero: '1032456786', nombres: 'LAURA SOFIA', apellidos: 'RAMIREZ ORTIZ', eps: 'EPS SINTETICA', regimen: 'CONTRIBUTIVO',
    estado: 'ACTIVO', afiliacion: '05/02/2024', consulta: '26/10/2026', corte: '30/09/2026', ...c,
  };
  const fila = (etiqueta: string, valor: string | null | undefined): string[] => (valor ? [`${etiqueta}: ${valor}`] : []);
  return [
    'ADRES - Administradora de los Recursos del Sistema General de Seguridad Social en Salud', 'Consulta de afiliados a la BDUA',
    ...fila('Tipo de documento', v.tipo), ...fila('Número de documento', v.numero), ...fila('Nombres', v.nombres), ...fila('Apellidos', v.apellidos),
    ...fila('Entidad', v.eps), ...fila('Régimen', v.regimen), ...fila('Estado de afiliación', v.estado), ...fila('Fecha de afiliación', v.afiliacion),
    ...fila('Fecha de consulta', v.consulta), ...fila('Fecha de corte', v.corte),
  ];
}
const pdfAdres = (c: Partial<Record<string, string | null>> = {}) => pdfDigital(lineasAdres(c));

// ── Montaje ─────────────────────────────────────────────────────────────────

class AlmacenEnMemoria {
  archivos = new Map<string, Buffer>();
  guardar = jest.fn((ruta: string, contenido: Buffer, _mime: string) => { this.archivos.set(ruta, contenido); return Promise.resolve(ruta); });
  leer = jest.fn((ruta: string) => (this.archivos.has(ruta) ? Promise.resolve(this.archivos.get(ruta) as Buffer) : Promise.reject(new Error('no existe'))));
  eliminar = jest.fn((ruta: string) => { this.archivos.delete(ruta); return Promise.resolve(); });
}

const aux = (id = 'aux-1') => actorDe(Rol.AUXILIAR, { id });
const coordinador = actorDe(Rol.COORDINADOR, { id: 'coord-1', escuelas: [ESC_A] });

interface Opciones {
  sinuTipo?: string | null; documentoEstudiante?: string | null; reservaPara?: string | null;
  certificado?: DatosExtraidosEps; config?: Record<string, unknown>; autenticidadVerificada?: boolean; afiliacionOficial?: boolean;
}

async function montar(o: Opciones = {}) {
  const validaciones = new ValidacionesEnMemoria();
  const v = ValidacionEps.pendiente({ id: 'v-1', documentoId: 'doc-eps', practicaId: 'practica-1', estudianteId: 'estudiante-1', ahora: AHORA });
  v.registrarProcesamiento({
    datosExtraidos: o.certificado ?? CERTIFICADO, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false,
  }, AHORA);
  if (o.autenticidadVerificada) {
    v.registrarVerificacionOficial({ verificador: 'verificador_prueba', autenticidad: AutenticidadEps.VERIFICADA, ruta: v.ruta, datosVerificados: null, discrepancias: [] }, AHORA);
  }
  if (o.afiliacionOficial) {
    v.registrarVerificacionOficial({
      verificador: 'verificador_prueba', autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA, ruta: v.ruta, datosVerificados: null, discrepancias: [],
    }, AHORA);
  }
  if (o.reservaPara !== null) v.reservar(o.reservaPara ?? 'aux-1', AHORA, 15 * MIN);
  await validaciones.crearSiNoExiste(v.instantanea());

  const almacen = new AlmacenEnMemoria();
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const estudiante = usuarioDe(Rol.ESTUDIANTE, {
    id: 'estudiante-1', documento: o.documentoEstudiante === undefined ? CEDULA : o.documentoEstudiante, nombre: 'Laura Sofía Ramírez Ortiz',
  });
  const sinu = { buscarPorDocumento: jest.fn().mockResolvedValue(o.sinuTipo === undefined ? null : { tipoDocumento: o.sinuTipo }) };
  const uc = new ConsultaAdresUseCase(
    validaciones,
    { buscarPorId: jest.fn().mockResolvedValue(documentoDe(TipoDocumento.CERTIFICADO_EPS, { id: 'doc-eps', estado: EstadoDocumento.EN_REVISION })) } as never,
    { buscarPorId: jest.fn().mockResolvedValue(practicaDe()) } as never,
    { buscarPorId: jest.fn().mockResolvedValue(estudiante) } as never,
    auditoria as never, almacen as never, real, sinu as never,
    { get: (k: string) => o.config?.[k] } as never,
  );
  const fila = () => validaciones.filas.get('v-1')!;
  const acciones = (): string[] => (auditoria.registrar.mock.calls as Array<[{ accion: string }]>).map((c) => c[0].accion);
  /** Prepara y devuelve el identificador de la consulta. */
  const preparar = async (actor = aux(), ahora = AHORA) => {
    const r = await uc.preparar('v-1', actor, { tipoDocumento: 'CC' }, ahora);
    if (r.estado !== 'preparada') throw new Error('no se preparó');
    return r.consultaId as string;
  };
  return { uc, validaciones, almacen, auditoria, sinu, fila, acciones, preparar };
}

/** Todas las pruebas comprueban que NO hubo ninguna salida a la red. */
let llamadasDeRed: string[] = [];
const espiasRed: jest.SpyInstance[] = [];
beforeEach(() => {
  llamadasDeRed = [];
  espiasRed.push(
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => { llamadasDeRed.push('fetch'); throw new Error('sin red'); }),
    jest.spyOn(http, 'request').mockImplementation(() => { llamadasDeRed.push('http'); throw new Error('sin red'); }),
    jest.spyOn(https, 'request').mockImplementation(() => { llamadasDeRed.push('https'); throw new Error('sin red'); }),
    jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { llamadasDeRed.push('net'); throw new Error('sin red'); }),
  );
});
afterEach(() => {
  while (espiasRed.length) espiasRed.pop()?.mockRestore();
  expect(llamadasDeRed).toEqual([]);
});

// ── Preparar ────────────────────────────────────────────────────────────────

describe('Preparar la consulta ADRES', () => {
  it('con el tipo de SINU: devuelve tipo, número, portal oficial e identificador; no llama a nadie', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    expect(m.fila().adres.estado).toBe(EstadoAdres.PENDIENTE);
    const r = await m.uc.preparar('v-1', aux(), {}, AHORA);
    expect(r).toMatchObject({ estado: 'preparada', tipoDocumento: 'CC', numeroDocumento: CEDULA, portalUrl: PORTAL_ADRES_OFICIAL });
    expect(r.consultaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.venceEn).toBe(new Date(AHORA.getTime() + VIGENCIA_CONSULTA_ADRES_MS).toISOString());
    expect(m.fila().adres).toMatchObject({ estado: EstadoAdres.EN_CONSULTA, tipoDocumento: 'CC', tipoDocumentoOrigen: 'sinu', preparadaPor: 'aux-1' });
    expect(m.acciones()).toEqual([AccionAuditada.CONSULTA_ADRES_PREPARADA]);
    expect(r.portalUrl).not.toContain(CEDULA); // el documento no viaja en ninguna URL
  });

  it('sin una fuente válida del tipo: pide confirmación humana, sugiere lo del certificado y NO lo infiere ni cambia el estado', async () => {
    const m = await montar({ sinuTipo: null });
    const r = await m.uc.preparar('v-1', aux(), {}, AHORA);
    expect(r).toMatchObject({ estado: 'requiere_tipo_documento', opciones: ['CC', 'TI', 'CE', 'PA'], sugerencia: 'CC' });
    expect(r.numeroDocumento).toBeUndefined();
    expect(r.consultaId).toBeUndefined();
    expect(m.fila().adres.estado).toBe(EstadoAdres.PENDIENTE);
    expect(m.fila().adres.tipoDocumento).toBeNull();
    expect(m.acciones()).toEqual([]);
  });

  it('el número parece una cédula, pero eso no basta: nunca se asume CC', async () => {
    const m = await montar({ sinuTipo: null, certificado: { ...CERTIFICADO, tipoDocumento: null } });
    const r = await m.uc.preparar('v-1', aux(), {}, AHORA);
    expect(r).toMatchObject({ estado: 'requiere_tipo_documento', sugerencia: null });
  });

  it('un tipo que SINU devuelve fuera del catálogo se ignora (cae a la confirmación humana)', async () => {
    const m = await montar({ sinuTipo: 'XX' });
    expect((await m.uc.preparar('v-1', aux(), {}, AHORA)).estado).toBe('requiere_tipo_documento');
  });

  it('SINU caído: no se supone nada, se pide confirmación', async () => {
    const m = await montar();
    m.sinu.buscarPorDocumento.mockRejectedValueOnce(new Error('SINU caído'));
    expect((await m.uc.preparar('v-1', aux(), {}, AHORA)).estado).toBe('requiere_tipo_documento');
  });

  it('la persona confirma el tipo: queda registrado quién lo confirmó, y la siguiente preparación lo reutiliza', async () => {
    const m = await montar();
    const r = await m.uc.preparar('v-1', aux(), { tipoDocumento: 'TI' }, AHORA);
    expect(r).toMatchObject({ estado: 'preparada', tipoDocumento: 'TI' });
    expect(m.fila().adres).toMatchObject({ tipoDocumentoOrigen: 'confirmacion_humana', tipoDocumentoConfirmadoPor: 'aux-1' });
    const otra = await m.uc.preparar('v-1', aux(), {}, AHORA);
    expect(otra).toMatchObject({ estado: 'preparada', tipoDocumento: 'TI' });
    expect(otra.consultaId).not.toBe(r.consultaId);
  });

  it('SINU prevalece sobre la confirmación humana', async () => {
    const m = await montar({ sinuTipo: 'CE' });
    const r = await m.uc.preparar('v-1', aux(), { tipoDocumento: 'CC' }, AHORA);
    expect(r.tipoDocumento).toBe('CE');
    expect(m.fila().adres.tipoDocumentoOrigen).toBe('sinu');
  });

  it('un tipo desconocido se rechaza (400)', async () => {
    const m = await montar();
    await expect(m.uc.preparar('v-1', aux(), { tipoDocumento: 'XX' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('estudiante sin número de documento: 409', async () => {
    const m = await montar({ documentoEstudiante: null, sinuTipo: 'CC' });
    await expect(m.uc.preparar('v-1', aux(), {}, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('el portal configurado solo vale si es de adres.gov.co; si no, se usa el oficial', async () => {
    const malo = await montar({ sinuTipo: 'CC', config: { ADRES_PORTAL_URL: 'https://adres.gov.co.atacante.test/consulta' } });
    expect((await malo.uc.preparar('v-1', aux(), {}, AHORA)).portalUrl).toBe(PORTAL_ADRES_OFICIAL);
    const http = await montar({ sinuTipo: 'CC', config: { ADRES_PORTAL_URL: 'http://www.adres.gov.co/x' } });
    expect((await http.uc.preparar('v-1', aux(), {}, AHORA)).portalUrl).toBe(PORTAL_ADRES_OFICIAL);
    const bueno = await montar({ sinuTipo: 'CC', config: { ADRES_PORTAL_URL: 'https://www.adres.gov.co/otra-ruta' } });
    expect((await bueno.uc.preparar('v-1', aux(), {}, AHORA)).portalUrl).toBe('https://www.adres.gov.co/otra-ruta');
  });

  it('una afiliación ya establecida por una fuente oficial no necesita ADRES: 409', async () => {
    const m = await montar({ sinuTipo: 'CC', afiliacionOficial: true });
    expect(m.fila().adres.estado).toBe(EstadoAdres.NO_REQUERIDO);
    await expect(m.uc.preparar('v-1', aux(), {}, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('un caso ya decidido por una persona: 409', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    m.validaciones.filas.set('v-1', { ...m.fila(), decision: DecisionEps.RECHAZADO, decididoPor: 'aux-1', decididoEn: AHORA });
    await expect(m.uc.preparar('v-1', aux(), {}, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });
});

// ── Permisos y reserva ──────────────────────────────────────────────────────

describe('Permisos y reserva', () => {
  it.each([Rol.TUTOR, Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION])('%s no opera ADRES (preparar, cargar, procesar, bandeja)', async (rol) => {
    const m = await montar({ sinuTipo: 'CC' });
    const actor = actorDe(rol, { id: 'estudiante-1' });
    await expect(m.uc.preparar('v-1', actor, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.uc.cargarEvidencia('v-1', actor, { consultaId: 'x', contenido: await pdfAdres() }, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.uc.procesar('v-1', actor, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.uc.bandeja(actor, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.fila().adres.estado).toBe(EstadoAdres.PENDIENTE);
  });

  it('coordinación y administración también operan (con el caso tomado)', async () => {
    for (const actor of [coordinador, actorDe(Rol.ADMINISTRADOR, { id: 'admin-1' })]) {
      const m = await montar({ sinuTipo: 'CC', reservaPara: actor.id });
      expect((await m.uc.preparar('v-1', actor, {}, AHORA)).estado).toBe('preparada');
    }
  });

  it('sin tomar el caso: 409 «tome el caso»', async () => {
    const m = await montar({ sinuTipo: 'CC', reservaPara: null });
    await expect(m.uc.preparar('v-1', aux(), {}, AHORA)).rejects.toThrow(/Tome el caso/);
  });

  it('el caso lo tiene otro funcionario: 409 en preparar, cargar y procesar', async () => {
    const m = await montar({ sinuTipo: 'CC', reservaPara: 'aux-2' });
    await expect(m.uc.preparar('v-1', aux('aux-1'), {}, AHORA)).rejects.toThrow(/otro funcionario/);
    await expect(m.uc.cargarEvidencia('v-1', aux('aux-1'), { consultaId: randomId(), contenido: await pdfAdres() }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.uc.procesar('v-1', aux('aux-1'), AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('si la reserva venció no se puede seguir; otro funcionario toma el caso y entonces sí opera', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const tarde = new Date(AHORA.getTime() + 16 * MIN);
    await expect(m.uc.preparar('v-1', aux('aux-1'), {}, tarde)).rejects.toThrow(/Tome el caso/);
    const v = (await m.validaciones.buscarPorId('v-1')) as ValidacionEps;
    v.reservar('aux-2', tarde, 15 * MIN);
    m.validaciones.filas.set('v-1', v.instantanea());
    expect((await m.uc.preparar('v-1', aux('aux-2'), {}, tarde)).estado).toBe('preparada');
    await expect(m.uc.preparar('v-1', aux('aux-1'), {}, tarde)).rejects.toThrow(/otro funcionario/);
  });

  it('el funcionario no puede falsear al estudiante: lo consultado sale de la validación, no del llamador', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.preparar('v-1', aux(), { tipoDocumento: 'CC', estudianteId: 'otro', numeroDocumento: '1' } as never, AHORA);
    expect(r.numeroDocumento).toBe(CEDULA);
  });

  it('una validación inexistente o fuera de alcance responde 404', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await expect(m.uc.preparar('no-existe', aux(), {}, AHORA)).rejects.toMatchObject({ status: 404 });
  });
});

const randomId = (): string => '11111111-2222-4333-8444-555555555555';

// ── Cargar y procesar el resultado ──────────────────────────────────────────

describe('Cargar el resultado ADRES (PDF) y procesarlo', () => {
  it('resultado vigente: procesado, afiliación activa por ADRES, la autenticidad NO cambia y queda evidencia', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const consultaId = await m.preparar();
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres(), fechaConsulta: '2026-10-26' }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'procesado', afiliacion: 'activa', recomendacion: RecomendacionEps.REVISION_DOCUMENTAL, error: null, duplicada: false });
    expect(m.fila()).toMatchObject({ autenticidad: AutenticidadEps.NO_EVALUADA, afiliacionFuente: 'adres_bdua', decision: DecisionEps.PENDIENTE });
    expect(m.fila().adres).toMatchObject({ estado: EstadoAdres.PROCESADO, error: null, consultaId: null });
    expect(m.fila().adres.consultadoEn?.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(m.fila().adres.fuenteActualizadaEn?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(m.fila().adres.cargadaEn).toEqual(AHORA);
    expect(m.fila().adres.evidenciaHash).toMatch(/^[0-9a-f]{64}$/);

    const evidencias = m.validaciones.evidencias;
    expect(evidencias.map((e) => e.resultado)).toEqual(['cargada', 'procesado']);
    for (const e of evidencias) {
      expect(e).toMatchObject({ tipo: TipoEvidenciaEps.ADRES, fuente: FuenteEvidenciaEps.ADRES, metodo: 'pdf_importado_adres_bdua', verificadoPor: 'aux-1', hashEvidencia: m.fila().adres.evidenciaHash });
    }
    expect(m.acciones()).toEqual([
      AccionAuditada.CONSULTA_ADRES_PREPARADA, AccionAuditada.EVIDENCIA_ADRES_CARGADA, AccionAuditada.EVIDENCIA_ADRES_PROCESADA, AccionAuditada.COMPARACION_ADRES_REALIZADA,
    ]);
  });

  it('el archivo queda en almacenamiento PRIVADO, bajo una ruta propia de la validación, y no se devuelve ninguna URL', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const consultaId = await m.preparar();
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres() }, AHORA);
    const [ruta] = [...m.almacen.archivos.keys()];
    expect(ruta).toMatch(/^evidencias\/adres\/v-1\/[0-9a-f]{16}-[0-9a-f]{16}\.pdf$/);
    expect(m.fila().adres.referenciaArchivo).toBe(ruta);
    expect(JSON.stringify(r)).not.toMatch(/https?:\/\//);
    expect(m.almacen.guardar.mock.calls[0][2]).toBe('application/pdf');
  });

  it('resultado no vigente: afiliación inactiva', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres({ estado: 'NO VIGENTE' }) }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'procesado', afiliacion: 'inactiva', recomendacion: RecomendacionEps.REVISION_RECHAZO });
    expect(m.fila().decision).toBe(DecisionEps.PENDIENTE);
  });

  it('EPS distinta a la del certificado: discrepancia crítica', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres({ eps: 'OTRA ENTIDAD' }) }, AHORA);
    expect(r.recomendacion).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
    expect(r.comparacion.find((c) => c.campo === 'eps')).toMatchObject({ sipra: null, certificado: 'EPS Sintetica S.A.', adres: 'OTRA ENTIDAD', resultado: 'diferente', critico: true });
  });

  it('régimen distinto: se muestra la diferencia pero no es crítica', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres({ regimen: 'SUBSIDIADO' }) }, AHORA);
    expect(r.comparacion.find((c) => c.campo === 'regimen')).toMatchObject({ resultado: 'diferente', critico: false });
    expect(r.recomendacion).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
  });

  it.each([
    ['documento distinto', { numero: '999888777' }, 'documento_no_corresponde'],
    ['nombre distinto', { nombres: 'CARLOS', apellidos: 'PEREZ GOMEZ' }, 'nombre_no_corresponde'],
    ['tipo de documento distinto', { tipo: 'TI' }, 'tipo_documento_no_corresponde'],
    ['sin número de documento', { numero: null }, 'sin_documento_en_resultado'],
  ])('%s: no queda atado al estudiante; la afiliación NO se actualiza', async (_c, cambio, error) => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres(cambio) }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'no_determinable', error, afiliacion: 'no_contrastada' });
    expect(m.fila().afiliacionFuente).toBeNull();
  });

  it('resultado sin estado de afiliación: no determinable; la afiliación queda «no determinable», no se infiere', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres({ estado: null }) }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'no_determinable', afiliacion: 'no_determinable', recomendacion: RecomendacionEps.INFORMACION_INSUFICIENTE });
    expect(m.fila().afiliacionFuente).toBeNull();
  });

  it('PDF escaneado: OCR local y mismo resultado', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const pdf = await pdfEscaneado([await imagenCertificado(lineasAdres())]);
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: pdf }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'procesado', afiliacion: 'activa' });
    expect(m.validaciones.evidencias.find((e) => e.resultado === 'procesado')?.datosObtenidos).toMatchObject({ ocr: true });
  });

  it('PDF sin texto y sin nada que leer: error «sin_texto»; no se inventa nada', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfDigital([]) }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'error', error: 'sin_texto', afiliacion: 'no_contrastada' });
    expect(m.fila().adres.datos).toBeNull();
  });

  it('PDF corrupto: error «pdf_ilegible»', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const bueno = await pdfAdres();
    const corrupto = Buffer.concat([Buffer.from('%PDF-1.4\n'), bueno.subarray(20, 200)]);
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: corrupto }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'error', error: 'pdf_ilegible' });
  });

  it('un PDF que NO es un resultado de ADRES (p. ej. el propio certificado) no establece afiliación', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const certificado = await pdfDigital(['Entidad Promotora de Salud EPS SINTETICA', 'Nombre: LAURA SOFIA RAMIREZ ORTIZ', 'Documento: CC 1.032.456.786', 'Estado: ACTIVO']);
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: certificado }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'error', error: 'no_es_resultado_adres', afiliacion: 'no_contrastada' });
    expect(m.fila().afiliacionFuente).toBeNull();
  });

  it('tras un error se puede preparar de nuevo y cargar OTRO resultado', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfDigital([]) }, AHORA);
    expect(m.fila().adres.estado).toBe(EstadoAdres.ERROR);
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'procesado', afiliacion: 'activa' });
  });

  it('si el archivo ya no está en el almacén al procesar: error «archivo_no_disponible»', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    m.almacen.leer.mockRejectedValueOnce(new Error('purgado'));
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    expect(r).toMatchObject({ estadoAdres: 'error', error: 'archivo_no_disponible' });
    // Y el reintento de procesamiento lo resuelve (el archivo vuelve a estar).
    const ruta = m.fila().adres.referenciaArchivo as string;
    expect(m.almacen.archivos.has(ruta)).toBe(true);
    expect(await m.uc.procesar('v-1', aux(), AHORA)).toMatchObject({ estadoAdres: 'procesado', afiliacion: 'activa' });
  });

  it('validaciones del archivo: vacío (400), demasiado grande (400), no PDF (415)', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const consultaId = await m.preparar();
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: Buffer.alloc(0) }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(6 * 1_048_576)]) }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: Buffer.from('<html>no soy un pdf</html>') }, AHORA)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres(), fechaConsulta: 'mañana' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres(), fechaConsulta: '2030-01-01' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.almacen.archivos.size).toBe(0);
    expect(m.validaciones.evidencias).toHaveLength(0);
    expect(m.fila().adres.estado).toBe(EstadoAdres.EN_CONSULTA); // nada cambió: la consulta sigue vigente
  });
});

// ── Identificador de un solo uso (antirreutilización) ───────────────────────

describe('Identificador de consulta: un solo uso, vida corta, ligado al caso y a la persona', () => {
  it('sin consulta preparada, o con un identificador cualquiera: 410', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId: randomId(), contenido: await pdfAdres() }, AHORA)).rejects.toBeInstanceOf(GoneException);
    await m.preparar();
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId: randomId(), contenido: await pdfAdres() }, AHORA)).rejects.toBeInstanceOf(GoneException);
    expect(m.almacen.archivos.size).toBe(0);
  });

  it('vencido: 410', async () => {
    const m = await montar({ sinuTipo: 'CC', config: {} });
    const consultaId = await m.preparar();
    // La reserva del caso dura 15 min; se renueva para aislar el vencimiento de la CONSULTA (30 min).
    const tarde = new Date(AHORA.getTime() + VIGENCIA_CONSULTA_ADRES_MS + MIN);
    const v = (await m.validaciones.buscarPorId('v-1')) as ValidacionEps;
    v.reservar('aux-1', tarde, 15 * MIN);
    m.validaciones.filas.set('v-1', v.instantanea());
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres() }, tarde)).rejects.toBeInstanceOf(GoneException);
  });

  it('se consume al cargar: no se puede reutilizar para otro archivo', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const consultaId = await m.preparar();
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres() }, AHORA);
    await expect(m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: await pdfAdres({ estado: 'RETIRADO' }) }, AHORA)).rejects.toBeInstanceOf(GoneException);
    expect(m.fila().afiliacion).toBe('activa'); // el segundo no pisó nada
  });

  it('no sirve para otra validación: cambiar el id del caso no adjunta evidencia a otro estudiante', async () => {
    const a = await montar({ sinuTipo: 'CC' });
    const consultaDeA = await a.preparar();
    // Segunda validación (otro estudiante) en el mismo repositorio, con el caso tomado por la misma persona.
    const b = ValidacionEps.pendiente({ id: 'v-2', documentoId: 'doc-2', practicaId: 'practica-1', estudianteId: 'estudiante-1', ahora: AHORA });
    b.registrarProcesamiento({ datosExtraidos: CERTIFICADO, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false }, AHORA);
    b.reservar('aux-1', AHORA, 15 * MIN);
    a.validaciones.filas.set('v-2', b.instantanea());
    await expect(a.uc.cargarEvidencia('v-2', aux(), { consultaId: consultaDeA, contenido: await pdfAdres() }, AHORA)).rejects.toBeInstanceOf(GoneException);
    expect(a.validaciones.filas.get('v-2')?.adres.evidenciaHash).toBeNull();
  });

  it('de otra persona: aunque conozca el identificador, el caso y la consulta son de quien los tomó', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const consultaId = await m.preparar(aux('aux-1'));
    await expect(m.uc.cargarEvidencia('v-1', aux('aux-2'), { consultaId, contenido: await pdfAdres() }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    // Aun si aux-2 tuviera el caso, la consulta preparada por aux-1 no le sirve.
    const v = (await m.validaciones.buscarPorId('v-1')) as ValidacionEps;
    expect(v.consultaAdresVigente(consultaId, 'aux-2', AHORA)).toBe(false);
  });
});

// ── Duplicados, reintentos y concurrencia ───────────────────────────────────

describe('Duplicados, reintentos y concurrencia', () => {
  it('el mismo PDF dos veces en el mismo caso: no se registra otra evidencia ni se repite nada', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const pdf = await pdfAdres();
    const consultaId = await m.preparar();
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: pdf }, AHORA);
    const evidencias = m.validaciones.evidencias.length;
    const acciones = m.acciones().length;
    const archivos = m.almacen.archivos.size;
    const repetido = await m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: pdf }, AHORA);
    expect(repetido).toMatchObject({ duplicada: true, estadoAdres: 'procesado' });
    expect(m.validaciones.evidencias).toHaveLength(evidencias);
    expect(m.acciones()).toHaveLength(acciones);
    expect(m.almacen.archivos.size).toBe(archivos);
  });

  it('el mismo PDF en OTRA validación: 409 (no se reutiliza el resultado de un estudiante en otro caso)', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const pdf = await pdfAdres();
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: pdf }, AHORA);
    const otra = ValidacionEps.pendiente({ id: 'v-2', documentoId: 'doc-2', practicaId: 'practica-1', estudianteId: 'estudiante-1', ahora: AHORA });
    otra.registrarProcesamiento({ datosExtraidos: CERTIFICADO, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false }, AHORA);
    otra.reservar('aux-1', AHORA, 15 * MIN);
    otra.prepararConsultaAdres({ consultaId: randomId(), actorId: 'aux-1', ahora: AHORA, venceEn: new Date(AHORA.getTime() + 30 * MIN), tipoDocumento: 'CC', origenTipoDocumento: 'sinu', confirmadoPor: null });
    m.validaciones.filas.set('v-2', otra.instantanea());
    await expect(m.uc.cargarEvidencia('v-2', aux(), { consultaId: randomId(), contenido: pdf }, AHORA)).rejects.toThrow(/otro caso/);
  });

  it('procesar de nuevo un resultado ya procesado: idempotente, sin evidencia nueva', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    const evidencias = m.validaciones.evidencias.length;
    for (let i = 0; i < 3; i += 1) expect(await m.uc.procesar('v-1', aux(), AHORA)).toMatchObject({ duplicada: true, estadoAdres: 'procesado' });
    expect(m.validaciones.evidencias).toHaveLength(evidencias);
  });

  it('reintentar un resultado que sigue fallando no acumula evidencia de error', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfDigital([]) }, AHORA);
    const evidencias = m.validaciones.evidencias.length;
    for (let i = 0; i < 3; i += 1) expect(await m.uc.procesar('v-1', aux(), AHORA)).toMatchObject({ estadoAdres: 'error', error: 'sin_texto' });
    expect(m.validaciones.evidencias).toHaveLength(evidencias);
  });

  it('dos cargas simultáneas del mismo archivo: una sola serie de evidencia y un solo archivo guardado', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const pdf = await pdfAdres();
    const consultaId = await m.preparar();
    const r = await Promise.allSettled([
      m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: pdf }, AHORA),
      m.uc.cargarEvidencia('v-1', aux(), { consultaId, contenido: pdf }, AHORA),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const x of r) if (x.status === 'rejected') expect([409, 410]).toContain((x.reason as { status: number }).status);
    expect(m.validaciones.evidencias.filter((e) => e.resultado === 'cargada')).toHaveLength(1);
    expect(m.validaciones.evidencias.filter((e) => e.resultado === 'procesado')).toHaveLength(1);
    expect(m.almacen.archivos.size).toBe(1);
    expect(m.fila().adres.estado).toBe(EstadoAdres.PROCESADO);
  });

  it('dos procesamientos simultáneos: una sola evidencia procesada', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    // Se deja el caso como «evidencia recibida» para forzar la carrera.
    const f = m.fila();
    m.validaciones.filas.set('v-1', { ...f, adres: { ...f.adres, estado: EstadoAdres.EVIDENCIA_RECIBIDA, datos: null, comparacion: [], recomendacion: null }, afiliacion: AfiliacionEps.NO_CONTRASTADA, afiliacionFuente: null });
    m.validaciones.evidencias.splice(0, m.validaciones.evidencias.length);
    await Promise.all([m.uc.procesar('v-1', aux(), AHORA), m.uc.procesar('v-1', aux(), AHORA)]);
    expect(m.validaciones.evidencias.filter((e) => e.resultado === 'procesado')).toHaveLength(1);
  });
});

// ── Candidatura y recomendaciones (sin aprobación real) ─────────────────────

describe('Candidatura y recomendación', () => {
  it('autenticidad verificada por una fuente oficial + ADRES activa → candidato (solo etiqueta; el documento no se aprueba)', async () => {
    const m = await montar({ sinuTipo: 'CC', autenticidadVerificada: true });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    expect(r.recomendacion).toBe(RecomendacionEps.CANDIDATO_AUTOAPROBACION);
    expect(m.fila().decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION);
    expect(m.fila().decision).not.toBe(DecisionEps.APROBADO_AUTOMATICO);
  });

  it('autenticidad no verificable + ADRES activa + certificado coincide → revisión documental (sin candidatura)', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const r = await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    expect(r.recomendacion).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
    expect(m.fila()).toMatchObject({ autenticidad: AutenticidadEps.NO_EVALUADA, decision: DecisionEps.PENDIENTE });
  });
});

// ── Bandeja mínima ──────────────────────────────────────────────────────────

describe('Bandeja mínima', () => {
  it('lista los casos con ADRES abierto con el estudiante REDUCIDO (documento enmascarado) y el responsable', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const filas = await m.uc.bandeja(aux(), AHORA);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      validacionId: 'v-1', estudiante: { nombre: 'Laura Sofía Ramírez Ortiz', documentoEnmascarado: '••••6786' },
      metodoValidacion: 'sin_verificar', afiliacion: 'no_contrastada', estadoAdres: 'pendiente', responsable: 'aux-1',
    });
    expect(JSON.stringify(filas)).not.toContain(CEDULA);
  });

  it('un caso sin reserva vigente no muestra responsable; uno decidido o sin necesidad de ADRES no aparece', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    expect((await m.uc.bandeja(aux(), new Date(AHORA.getTime() + 20 * MIN)))[0].responsable).toBeNull();
    m.validaciones.filas.set('v-1', { ...m.fila(), decision: DecisionEps.RECHAZADO, decididoPor: 'aux-1', decididoEn: AHORA });
    expect(await m.uc.bandeja(aux(), AHORA)).toEqual([]);
    const sin = await montar({ afiliacionOficial: true });
    expect(await sin.uc.bandeja(aux(), AHORA)).toEqual([]);
  });
});

// ── Seguridad y privacidad ──────────────────────────────────────────────────

describe('Seguridad y privacidad', () => {
  it('ni los registros técnicos ni la auditoría ni la evidencia llevan cédula, nombre, contenido del PDF, CAPTCHA, cookies ni tokens', async () => {
    const salidas: string[] = [];
    const espias = (['log', 'debug', 'warn', 'error', 'verbose'] as const).map((n) =>
      jest.spyOn(Logger.prototype, n).mockImplementation((...a: unknown[]) => { salidas.push(a.map(String).join(' ')); }));
    const out = jest.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { salidas.push(String(c)); return true; });
    let m;
    try {
      m = await montar({ sinuTipo: 'CC' });
      await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
      await m.uc.cargarEvidencia('v-1', aux(), { consultaId: randomId(), contenido: await pdfAdres() }, AHORA).catch(() => undefined);
    } finally { espias.forEach((e) => e.mockRestore()); out.mockRestore(); }
    const todo = salidas.join('\n') + JSON.stringify(m.auditoria.registrar.mock.calls) + JSON.stringify(m.validaciones.evidencias);
    for (const prohibido of [CEDULA, '1.032.456.786', 'RAMIREZ', 'LAURA', 'Administradora de los Recursos']) expect(todo).not.toContain(prohibido);
    for (const prohibido of ['captcha', 'cookie', 'token', 'sessionid', 'recaptcha']) expect(todo.toLowerCase()).not.toContain(prohibido);
  });

  it('el estado guardado no tiene ningún campo para CAPTCHA, cookies, sesión ni tokens', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    const claves = JSON.stringify(Object.keys(m.fila())) + JSON.stringify(Object.keys(m.fila().adres)) + JSON.stringify(Object.keys(m.validaciones.evidencias[0].datosObtenidos));
    expect(claves.toLowerCase()).not.toMatch(/captcha|cookie|token|sesion|session/);
  });

  it('la copia guardada es la SANEADA: una acción activa del PDF queda neutralizada', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    const original = await pdfAdres();
    const conAccion = Buffer.from(original.toString('latin1').replace('/Type /Catalog', '/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>'), 'latin1');
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: conAccion }, AHORA);
    const guardado = [...m.almacen.archivos.values()][0].toString('latin1');
    expect(guardado).not.toContain('/JavaScript');
    expect(guardado).not.toContain('/OpenAction');
  });

  it('no llama a ADRES ni a nadie durante todo el flujo (el espía de red lo comprueba al terminar cada prueba)', async () => {
    const m = await montar({ sinuTipo: 'CC' });
    await m.uc.cargarEvidencia('v-1', aux(), { consultaId: await m.preparar(), contenido: await pdfAdres() }, AHORA);
    expect(llamadasDeRed).toEqual([]);
  });
});
