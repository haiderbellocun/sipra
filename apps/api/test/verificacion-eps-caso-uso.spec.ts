import { ForbiddenException } from '@nestjs/common';
import { VerificacionEpsUseCase, VENTANA_REINTENTO_VERIFICACION_MS } from '../src/application/use-cases/documentos/verificacion-eps.use-case';
import { ValidacionEpsUseCase } from '../src/application/use-cases/documentos/validacion-eps.use-case';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { FuenteEvidenciaEps, TipoEvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, DecisionEps, RutaValidacionEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { AdaptadorRespuestaEps } from '../src/domain/ports/out/verificador-certificado-eps.port';
import { RegistroVerificadoresEps, VerificadorEpsDefinicion } from '../src/domain/services/registro-verificadores-eps';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { VerificadorEpsHttpAdapter } from '../src/infrastructure/adapters/verificacion-eps/verificador-eps-http.adapter';
import { actorDe, documentoDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { pdfDigital, pngQr } from './soporte-lectura-local';
import { ValidacionesEnMemoria } from './soporte-validacion-eps';
import {
  AdaptadorJsonSintetico, HOST_AJENO, HOST_PRUEBA, HOST_REDIRECCION, RESPUESTA_VALIDA, ServidorPrueba, clientePruebas, definicionPrueba,
  json, servidorHttps,
} from './soporte-verificacion-eps';

/**
 * Verificación oficial de punta a punta: documento con QR → registro de
 * verificadores → servidor HTTPS sintético → ejes de la validación, evidencia y
 * auditoría. Lector de QR real; sin Internet.
 */

jest.setTimeout(240_000);

const AHORA = new Date('2026-10-26T15:00:00Z');
const CEDULA = '1032456786';
const CERTIFICADO: DatosExtraidosEps = {
  tipoDocumento: 'CC', numeroDocumento: CEDULA, nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS Sintetica S.A.S.', epsClave: 'SINTETICA',
  regimen: 'contributivo', tipoAfiliado: 'beneficiario', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
};

const real = new LectorDocumentoLocalAdapter();
afterAll(async () => { await real.onModuleDestroy(); });

interface Montaje {
  verificaciones: VerificacionEpsUseCase;
  validaciones: ValidacionesEnMemoria;
  auditoria: { registrar: jest.Mock };
  idValidacion: string;
  estadoDocumento: () => EstadoDocumento;
  almacen: { leer: jest.Mock };
}

async function montar(opciones: {
  qr?: string[]; pdf?: Buffer; def?: VerificadorEpsDefinicion; adaptadores?: AdaptadorRespuestaEps[]; habilitada?: boolean;
  certificado?: DatosExtraidosEps; interno?: { documento: string; nombre: string }; puerto: number;
}): Promise<Montaje> {
  const pdf = opciones.pdf ?? await pdfDigital(undefined, { qrs: await Promise.all((opciones.qr ?? []).map((q) => pngQr(q))) });
  const documento = documentoDe(TipoDocumento.CERTIFICADO_EPS, {
    id: 'doc-eps', estado: EstadoDocumento.EN_REVISION, mimeReal: 'application/pdf', rutaAlmacenamiento: 'ruta/eps.pdf',
  });
  const validaciones = new ValidacionesEnMemoria();
  const v = ValidacionEps.pendiente({ id: 'v-1', documentoId: 'doc-eps', practicaId: 'practica-1', estudianteId: 'estudiante-1', ahora: AHORA });
  v.registrarProcesamiento({
    datosExtraidos: opciones.certificado ?? CERTIFICADO, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false,
  }, AHORA);
  await validaciones.crearSiNoExiste(v.instantanea());
  const interno = opciones.interno ?? { documento: CEDULA, nombre: 'Laura Sofía Ramírez Ortiz' };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const almacen = { leer: jest.fn().mockResolvedValue(pdf) };
  const def = opciones.def ?? definicionPrueba(opciones.puerto);
  const registro = new RegistroVerificadoresEps([def]);
  const adaptador = new VerificadorEpsHttpAdapter(registro, clientePruebas(), opciones.adaptadores ?? [new AdaptadorJsonSintetico()]);
  const verificaciones = new VerificacionEpsUseCase(
    validaciones, { buscarPorId: jest.fn().mockResolvedValue(documento) } as never,
    { buscarPorId: jest.fn().mockResolvedValue(practicaDe()) } as never,
    { buscarPorId: jest.fn().mockResolvedValue(usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1', documento: interno.documento, nombre: interno.nombre })) } as never,
    auditoria as never, almacen as never, real, registro, adaptador,
    { get: (k: string) => (k === 'VERIFICACION_EPS_HABILITADA' ? (opciones.habilitada === false ? 'false' : 'true') : undefined) } as never,
  );
  return { verificaciones, validaciones, auditoria, idValidacion: 'v-1', estadoDocumento: () => documento.estado, almacen };
}

const urlQr = (puerto: number, ruta = '/verificar/ABC123?t=SECRETO'): string => `https://${HOST_PRUEBA}:${puerto}${ruta}`;
const fila = (m: Montaje) => m.validaciones.filas.get(m.idValidacion)!;
const acciones = (m: Montaje): string[] => (m.auditoria.registrar.mock.calls as Array<[{ accion: string }]>).map((c) => c[0].accion);

async function conServidor<T>(manejador: Parameters<typeof servidorHttps>[0], f: (s: ServidorPrueba) => Promise<T>): Promise<T> {
  const s = await servidorHttps(manejador);
  try { return await f(s); } finally { await s.cerrar(); }
}

describe('Verificación oficial · resultados', () => {
  it('certificado verificado con afiliación activa confirmada: verificada + activa + candidato (el documento NO cambia)', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('verificado');
      expect(fila(m)).toMatchObject({
        autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA, ruta: RutaValidacionEps.QR,
        decision: DecisionEps.CANDIDATO_AUTOAPROBACION, verificadorCodigo: 'verificador_prueba', verificacionError: null,
      });
      expect(fila(m).datosVerificados).toMatchObject({ fuente: 'verificador_prueba', estadoAfiliacion: 'ACTIVO' });
      // Sigue sin autoaprobarse: es solo una etiqueta; el documento queda en revisión.
      expect(m.estadoDocumento()).toBe(EstadoDocumento.EN_REVISION);
      expect(s.peticiones).toHaveLength(1);
    });
  });

  it('autentica pero la fuente NO confirma estado de afiliación: verificada + no contrastada, sin candidato (listo para ADRES asistido)', async () => {
    await conServidor((_q, res) => json(res, 200, { ...RESPUESTA_VALIDA, estado_afiliacion: undefined }), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.NO_CONTRASTADA, decision: DecisionEps.PENDIENTE });
    });
  });

  it('verificador que NO confirma afiliación (aunque la respuesta traiga «ACTIVO»): afiliación no contrastada', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)], def: definicionPrueba(s.puerto, { confirmaAfiliacion: false }) });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.NO_CONTRASTADA, decision: DecisionEps.PENDIENTE });
    });
  });

  it('afiliación inactiva confirmada: no es candidato', async () => {
    await conServidor((_q, res) => json(res, 200, { ...RESPUESTA_VALIDA, estado_afiliacion: 'RETIRADO' }), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(fila(m)).toMatchObject({ afiliacion: AfiliacionEps.INACTIVA, decision: DecisionEps.PENDIENTE });
    });
  });

  it.each([['NO_EXISTE', 'certificado_no_encontrado'], ['INVALIDO', 'certificado_invalido']])(
    'la fuente responde %s: autenticidad inválida, ruta qr, sin candidato', async (estado, codigo) => {
      await conServidor((_q, res) => json(res, 200, { version: 1, estado }), async (s) => {
        const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
        expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('rechazado');
        expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.INVALIDA, afiliacion: AfiliacionEps.NO_CONTRASTADA, decision: DecisionEps.PENDIENTE });
        expect(m.validaciones.evidencias[0]).toMatchObject({ resultado: 'rechazado', errorCodigo: codigo });
      });
    });

  it.each([
    ['nombre distinto en la fuente', { nombre: 'CARLOS PEREZ GOMEZ' }],
    ['documento distinto en la fuente', { documento: '1032456787' }],
    ['EPS distinta en la fuente', { eps: 'Otra Entidad Distinta' }],
  ])('%s: el certificado no corresponde al registro oficial → inválida (datos_inconsistentes)', async (_c, cambio) => {
    await conServidor((_q, res) => json(res, 200, { ...RESPUESTA_VALIDA, ...cambio }), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(fila(m).autenticidad).toBe(AutenticidadEps.INVALIDA);
      expect(fila(m).decision).toBe(DecisionEps.PENDIENTE);
      expect(fila(m).discrepancias.some((d) => d.comparacion === 'oficial_vs_certificado')).toBe(true);
    });
  });

  it('certificado auténtico de OTRA persona: verificada, pero la coincidencia pasa a discrepancia y no es candidato', async () => {
    const otro = { ...CERTIFICADO, numeroDocumento: '555000111', nombre: 'MARTA GOMEZ LOPEZ' };
    await conServidor((_q, res) => json(res, 200, { ...RESPUESTA_VALIDA, documento: '555000111', nombre: 'MARTA GOMEZ LOPEZ' }), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)], certificado: otro });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.VERIFICADA, coincidencia: CoincidenciaEps.DISCREPANCIA, decision: DecisionEps.PENDIENTE });
    });
  });

  it('EPS con alias APROBADO: no es discrepancia', async () => {
    await conServidor((_q, res) => json(res, 200, { ...RESPUESTA_VALIDA, eps: 'Sintetica Salud' }), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(fila(m).autenticidad).toBe(AutenticidadEps.VERIFICADA);
      expect(fila(m).discrepancias.some((d) => d.campo === 'eps')).toBe(false);
    });
  });
});

describe('Verificación oficial · destinos no permitidos: NINGUNA petición', () => {
  it.each([
    ['host desconocido', 'https://desconocido.eps-prueba.test/verificar/1'],
    ['host parecido al permitido', `https://${HOST_PRUEBA}.atacante.test/verificar/1`],
    ['otro host de prueba no registrado', `https://${HOST_AJENO}/verificar/1`],
    ['IP interna', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', 'https://localhost/verificar/1'],
    ['http', `http://${HOST_PRUEBA}/verificar/1`],
    ['usuario:clave', `https://usuario:clave@${HOST_PRUEBA}/verificar/1`],
    ['javascript:', 'javascript:alert(1)'],
    ['texto', 'AFILIADO-1032456786'],
  ])('QR con %s: qr_no_soportado, no_verificable y cero peticiones', async (_c, contenido) => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [contenido] });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('qr_no_soportado');
      expect(s.peticiones).toHaveLength(0);
      expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.NO_VERIFICABLE, afiliacion: AfiliacionEps.NO_CONTRASTADA, verificacionError: 'qr_no_soportado', decision: DecisionEps.PENDIENTE });
      expect(fila(m).ruta).toBe(RutaValidacionEps.REVISION_MANUAL);
    });
  });

  it('certificado SIN QR: no se consulta nada; autenticidad no verificable y afiliación sin contrastar', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('sin_qr');
      expect(s.peticiones).toHaveLength(0);
      expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.NO_VERIFICABLE, afiliacion: AfiliacionEps.NO_CONTRASTADA, verificacionError: 'sin_qr', decision: DecisionEps.PENDIENTE });
    });
  });

  it('dos QR oficiales distintos: no se elige ninguno (qr_ambiguo) y no hay peticiones', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto, '/verificar/UNO'), urlQr(s.puerto, '/verificar/DOS')] });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('qr_ambiguo');
      expect(s.peticiones).toHaveLength(0);
    });
  });

  it('un QR oficial junto a uno desconocido: solo el oficial se consulta', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: ['https://publicidad.example/promo', urlQr(s.puerto)] });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('verificado');
      expect(s.peticiones.map((p) => p.url.split('?')[0])).toEqual(['/verificar/ABC123']);
    });
  });

  it('verificador que requiere interacción humana: nunca se consulta', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)], def: definicionPrueba(s.puerto, { requiereInteraccionHumana: true }) });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('requiere_interaccion_humana');
      expect(s.peticiones).toHaveLength(0);
    });
  });

  it('apagada por configuración: no lee el archivo ni consulta nada', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)], habilitada: false });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('deshabilitada');
      expect(s.peticiones).toHaveLength(0);
      expect(m.almacen.leer).not.toHaveBeenCalled();
      expect(fila(m).autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
    });
  });
});

describe('Verificación oficial · el portal falla: nunca «certificado falso»', () => {
  it.each([
    ['portal caído (503)', (_q: unknown, res: Parameters<Parameters<typeof servidorHttps>[0]>[1]) => json(res, 503, {}), 'verificador_no_disponible'],
    ['HTML cambiado / estructura desconocida', (_q: unknown, res: Parameters<Parameters<typeof servidorHttps>[0]>[1]) => json(res, 200, { pagina: 'nueva' }), 'respuesta_invalida'],
    ['JSON inválido', (_q: unknown, res: Parameters<Parameters<typeof servidorHttps>[0]>[1]) => json(res, 200, '{roto'), 'respuesta_invalida'],
    ['Content-Type inesperado', (_q: unknown, res: Parameters<Parameters<typeof servidorHttps>[0]>[1]) => json(res, 200, '<html/>', 'text/html'), 'contenido_no_esperado'],
    ['redirección no permitida', (_q: unknown, res: Parameters<Parameters<typeof servidorHttps>[0]>[1]) => { res.writeHead(302, { Location: `https://${HOST_REDIRECCION}/x` }); res.end(); }, 'redireccion_no_permitida'],
  ])('%s → no_verificable (%s); la autenticidad NO es inválida y la afiliación sigue sin contrastar', async (_c, manejador, codigo) => {
    await conServidor(manejador, async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('no_verificable');
      expect(fila(m)).toMatchObject({ autenticidad: AutenticidadEps.NO_VERIFICABLE, afiliacion: AfiliacionEps.NO_CONTRASTADA, verificacionError: codigo, decision: DecisionEps.PENDIENTE });
      expect(fila(m).verificadorCodigo).toBeNull(); // no hay resultado definitivo
      expect(acciones(m)).toContain(AccionAuditada.VERIFICACION_EPS_FALLIDA);
    });
  });

  it('tiempo agotado: no_verificable (timeout)', async () => {
    const s = await servidorHttps(() => { /* sin respuesta */ });
    try {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      // El adaptador de este montaje usa el tiempo por defecto (8 s); se reemplaza por uno impaciente.
      const impaciente = new VerificadorEpsHttpAdapter(new RegistroVerificadoresEps([definicionPrueba(s.puerto)]), clientePruebas(), [new AdaptadorJsonSintetico()],
        { get: (k: string) => (k === 'VERIFICACION_EPS_TIMEOUT_MS' ? 300 : undefined) } as never);
      Object.assign(m.verificaciones as unknown as { verificador: unknown }, { verificador: impaciente });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('no_verificable');
      expect(fila(m).verificacionError).toBe('timeout');
    } finally { await s.cerrar(); }
  });

  it('un documento que ya no se puede leer del almacén: no_verificable (documento_no_disponible)', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      m.almacen.leer.mockRejectedValueOnce(new Error('purgado'));
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('no_verificable');
      expect(fila(m).verificacionError).toBe('documento_no_disponible');
      expect(s.peticiones).toHaveLength(0);
    });
  });
});

describe('Verificación oficial · idempotencia, concurrencia y frescura', () => {
  it('un resultado definitivo no se repite: el reintento no vuelve a consultar el portal ni duplica evidencia', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      const evidencias = m.validaciones.evidencias.length;
      for (let i = 0; i < 3; i += 1) expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('ya_verificada');
      expect(s.peticiones).toHaveLength(1);
      expect(m.validaciones.evidencias).toHaveLength(evidencias);
      expect(acciones(m).filter((a) => a === String(AccionAuditada.VERIFICACION_EPS_COMPLETADA))).toHaveLength(1);
    });
  });

  it('tras un fallo, un retry inmediato NO golpea otra vez el portal; pasada la ventana sí; «forzar» también', async () => {
    let estado = 503;
    await conServidor((_q, res) => json(res, estado, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('no_verificable');
      expect(await m.verificaciones.verificar('doc-eps', { ahora: new Date(AHORA.getTime() + 1000) })).toBe('reciente');
      expect(s.peticiones).toHaveLength(1);
      estado = 200;
      const despues = new Date(AHORA.getTime() + VENTANA_REINTENTO_VERIFICACION_MS + 1000);
      expect(await m.verificaciones.verificar('doc-eps', { ahora: despues })).toBe('verificado');
      expect(s.peticiones).toHaveLength(2);
    });
  });

  it('dos workers a la vez: el reclamo (compare-and-set) deja pasar a UNO; el portal se consulta una sola vez', async () => {
    await conServidor((_q, res) => setTimeout(() => json(res, 200, RESPUESTA_VALIDA), 100), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      const r = await Promise.all([m.verificaciones.verificar('doc-eps', { ahora: AHORA }), m.verificaciones.verificar('doc-eps', { ahora: AHORA })]);
      expect([...r].sort()).toEqual(['en_curso', 'verificado']);
      expect(s.peticiones).toHaveLength(1);
      expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaEps.RESPUESTA_EPS)).toHaveLength(1);
    });
  });

  it('un reclamo abandonado (proceso caído) deja de bloquear pasado su plazo', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      m.validaciones.filas.set(m.idValidacion, { ...fila(m), verificacionIniciadaEn: AHORA });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: new Date(AHORA.getTime() + 30_000) })).toBe('en_curso');
      expect(await m.verificaciones.verificar('doc-eps', { ahora: new Date(AHORA.getTime() + 180_000) })).toBe('verificado');
    });
  });

  it('una decisión humana previa gana: no se verifica ni se pisa nada', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      m.validaciones.filas.set(m.idValidacion, { ...fila(m), decision: DecisionEps.RECHAZADO, decididoPor: 'aux-1', decididoEn: AHORA });
      expect(await m.verificaciones.verificar('doc-eps', { ahora: AHORA })).toBe('no_aplica');
      expect(s.peticiones).toHaveLength(0);
      expect(fila(m).decision).toBe(DecisionEps.RECHAZADO);
    });
  });
});

describe('Verificación oficial · evidencia, auditoría y datos sensibles', () => {
  it('registra UNA evidencia respuesta_eps de fuente eps_oficial, con hash, origen saneado y sin el token del QR', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      const [e] = m.validaciones.evidencias;
      expect(e).toMatchObject({ tipo: TipoEvidenciaEps.RESPUESTA_EPS, fuente: FuenteEvidenciaEps.EPS_OFICIAL, resultado: 'verificado', errorCodigo: null });
      expect(e.metodo).toBe('verificador_verificador_prueba');
      expect(e.hashEvidencia).toMatch(/^[0-9a-f]{64}$/);
      expect(e.origen).toBe(`https://${HOST_PRUEBA}:${s.puerto}/verificar/ABC123`);
      expect(e.datosObtenidos).toMatchObject({ httpStatus: 200, camposObtenidos: expect.arrayContaining(['numeroDocumento', 'nombre']) });
      expect(JSON.stringify(e)).not.toContain('SECRETO');
      // Ni el HTML/JSON completo ni valores personales dentro de la evidencia.
      for (const prohibido of [CEDULA, 'RAMIREZ', 'LAURA']) expect(JSON.stringify(e)).not.toContain(prohibido);
    });
  });

  it('audita iniciada y completada por identificadores, sin la URL del QR ni datos personales', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      expect(acciones(m)).toEqual([AccionAuditada.VERIFICACION_EPS_INICIADA, AccionAuditada.VERIFICACION_EPS_COMPLETADA]);
      const todo = JSON.stringify(m.auditoria.registrar.mock.calls);
      for (const prohibido of [CEDULA, 'RAMIREZ', 'LAURA', 'SECRETO', 'ABC123', HOST_PRUEBA]) expect(todo).not.toContain(prohibido);
    });
  });

  it('los registros técnicos del verificador no llevan la URL, el token ni datos personales', async () => {
    const { Logger } = await import('@nestjs/common');
    const salidas: string[] = [];
    const espias = (['log', 'debug', 'warn', 'error', 'verbose'] as const).map((n) =>
      jest.spyOn(Logger.prototype, n).mockImplementation((...a: unknown[]) => { salidas.push(a.map(String).join(' ')); }));
    try {
      await conServidor((_q, res) => json(res, 503, {}), async (s) => {
        const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
        await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      });
    } finally { espias.forEach((e) => e.mockRestore()); }
    const registro = salidas.join('\n');
    expect(registro).toContain('verificador_prueba');
    for (const prohibido of [CEDULA, 'SECRETO', 'ABC123', HOST_PRUEBA, '127.0.0.1']) expect(registro).not.toContain(prohibido);
  });
});

describe('Verificación oficial · API', () => {
  it('el DTO de operación expone método, verificador y fecha; el estudiante solo el resultado reducido', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      const ver = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      void ver;
      await m.verificaciones.verificar('doc-eps', { ahora: AHORA });
      const eps = new ValidacionEpsUseCase(
        m.validaciones, { buscarPorId: jest.fn().mockResolvedValue(documentoDe(TipoDocumento.CERTIFICADO_EPS, { id: 'doc-eps', estado: EstadoDocumento.EN_REVISION })) } as never,
        { buscarPorId: jest.fn().mockResolvedValue(practicaDe()) } as never, {} as never, {} as never,
        new ParametrosUseCase({ listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve() }),
      );
      const op = await eps.consultarPorDocumento('doc-eps', actorDe(Rol.AUXILIAR)) as unknown as Record<string, unknown>;
      expect(op).toMatchObject({ metodoValidacion: 'qr_oficial', verificador: 'verificador_prueba', autenticidad: 'verificada', afiliacion: 'activa', verificacionError: null });
      expect(typeof op.verificadoEn).toBe('string');
      const est = await eps.consultarPorDocumento('doc-eps', actorDe(Rol.ESTUDIANTE, { id: 'estudiante-1' }));
      expect(Object.keys(est).sort()).toEqual(['documentoId', 'estadoProcesamiento', 'resultado']);
    });
  });

  it('el reintento manual: solo auxiliar, coordinación y administración; el docente no', async () => {
    await conServidor((_q, res) => json(res, 200, RESPUESTA_VALIDA), async (s) => {
      const m = await montar({ puerto: s.puerto, qr: [urlQr(s.puerto)] });
      await expect(m.verificaciones.verificarComoOperador(m.idValidacion, actorDe(Rol.TUTOR))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(m.verificaciones.verificarComoOperador(m.idValidacion, actorDe(Rol.ESTUDIANTE, { id: 'estudiante-1' }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(s.peticiones).toHaveLength(0);
      expect(await m.verificaciones.verificarComoOperador(m.idValidacion, actorDe(Rol.AUXILIAR))).toBe('verificado');
    });
  });
});
