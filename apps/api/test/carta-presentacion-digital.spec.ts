import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  CartaPresentacionUseCase, MENSAJE_FALTA_ARL, MENSAJE_VENTANA_CERRADA, SolicitudCarta,
} from '../src/application/use-cases/practicas/carta-presentacion.use-case';
import { AccionAuditada, RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import { CartaPresentacion, DatosCarta } from '../src/domain/entities/carta-presentacion.entity';
import { ModalidadPractica, definicionModalidad } from '../src/domain/entities/modalidad.entity';
import { DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { MatriculaSinu } from '../src/domain/ports/out/servicios-externos.port';
import {
  DESTINATARIO_GENERICO, PATRON_REFERENCIA, SnapshotCarta, construirReferencia, enmascararDocumento, fechaColombia,
  fraseVigencia, nombreArchivoCarta, parrafoArl, redactarCarta,
} from '../src/domain/services/carta-presentacion.plantilla';
import { CartaPdfAdapter, qrPng } from '../src/infrastructure/adapters/pdf/carta-pdf.adapter';
import { GoneException, HttpException } from '@nestjs/common';
import {
  MENSAJE_DOCUMENTO_INVALIDO, MENSAJE_NO_VIGENTE, MENSAJE_SIN_CARTA_PUBLICA, MENSAJE_TOKEN_INVALIDO,
} from '../src/application/use-cases/practicas/carta-presentacion.use-case';
import { emitirTokenCarta, normalizarDocumento, verificarTokenCarta } from '../src/application/services/token-carta-publica';
import { LimitadorPublicoService } from '../src/infrastructure/seguridad/limitador-publico.service';
import { PdfTrabajador } from '../src/infrastructure/adapters/lectura-local/pdfjs.lector';
import { cargarZxing } from '../src/infrastructure/adapters/lectura-local/zxing.cargador';
import { LIMITES_LECTURA_ACTA } from '../src/domain/services/lectura-local-acta.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, practicaDe, usuarioDe } from './soporte-autorizacion';

// Carta de presentación digital. Datos SINTÉTICOS (ningún dato de las cartas reales de referencia).
const FRASE_EMPRESA_AFILIA = 'La empresa deberá afiliar al estudiante';

const snapshot = (o: Partial<SnapshotCarta> = {}): SnapshotCarta => ({
  referencia: 'K7QM4-X2DPR', estudianteNombre: 'Estudiante Sintético Uno', tipoDocumento: 'CC', documento: '1000000001',
  programa: 'Técnica profesional en registro de procesos productivos', ciclo: 'tecnico', nivel: 'TÉCNICO', periodoAcademico: '2026-2',
  modalidad: ModalidadPractica.PASANTIA, modalidadEtiqueta: 'Pasantía', destinatario: { tipo: 'generica', nombre: DESTINATARIO_GENERICO },
  responsableArl: 'empresa', practicaId: null, escuelaId: 'ESC-NEG', fechaExpedicion: '2026-11-18', fechaTexto: 'miércoles 18 de noviembre de 2026',
  firmante: { nombre: 'Firmante Sintético', cargo: 'Coordinador de Desarrollo Profesional', dependencia: 'Dirección de Operaciones' }, ...o,
});
const texto = (s: SnapshotCarta) => { const d = redactarCarta(s); return [...d.destinatario, ...d.parrafos].join('\n'); };

describe('Carta · redacción por modalidad (fuente: cartas institucionales vigentes)', () => {
  it('MONITORÍA, PASANTÍA y CONTRATO DE APRENDIZAJE tienen redacciones distintas y fieles a las cartas', () => {
    const m = texto(snapshot({ modalidad: ModalidadPractica.MONITORIA, modalidadEtiqueta: 'Monitoría' }));
    const p = texto(snapshot());
    const c = texto(snapshot({ modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, modalidadEtiqueta: 'Contrato de aprendizaje' }));
    expect(m).toContain('bajo la modalidad de MONITORÍA con una duración mínima de un mes y máxima de dos meses a partir de la generación de esta carta');
    expect(p).toContain('bajo la modalidad de PASANTÍA con una duración mínima de un mes y máxima de tres meses a partir de la generación de esta carta');
    expect(c).toContain('bajo la modalidad de CONTRATO DE APRENDIZAJE a partir de la firma del contrato');
    expect(new Set([m, p, c]).size).toBe(3);
  });
  it('no se limita a tres modalidades: las demás derivan la vigencia del catálogo sin inventar plazos', () => {
    expect(fraseVigencia(definicionModalidad(ModalidadPractica.PASANTIA_INTERNACIONAL))).toBe('con una duración mínima de un mes y máxima de seis meses a partir de la generación de esta carta');
    expect(fraseVigencia(definicionModalidad(ModalidadPractica.CUNBRE_NACIENTE))).toBe('con una duración mínima de tres meses a partir de la generación de esta carta');
    expect(fraseVigencia(definicionModalidad(ModalidadPractica.SOCIAL))).toBe('con la duración establecida para la modalidad, a partir de la generación de esta carta');
    for (const m of Object.values(ModalidadPractica)) expect(texto(snapshot({ modalidad: m, modalidadEtiqueta: definicionModalidad(m).etiqueta }))).toContain(definicionModalidad(m).etiqueta.toUpperCase());
  });
  it('programa y nivel salen de los datos (no fijos) y el destinatario genérico es UNO: «A QUIEN CORRESPONDA»', () => {
    const t = texto(snapshot({ programa: 'Tecnología en gestión sintética', nivel: 'TECNOLÓGICO' }));
    expect(t).toContain('del programa de TECNOLOGÍA EN GESTIÓN SINTÉTICA, correspondiente al nivel TECNOLÓGICO.');
    expect(redactarCarta(snapshot()).destinatario).toEqual(['SEÑORES:', 'A QUIEN CORRESPONDA']);
    expect(t).not.toContain('A QUIEN INTERESE');
  });
  it('destinatario empresa: el nombre de la organización vinculada', () => {
    expect(redactarCarta(snapshot({ destinatario: { tipo: 'empresa', nombre: 'ORGANIZACIÓN SINTÉTICA S.A.S.' } })).destinatario).toEqual(['SEÑORES:', 'ORGANIZACIÓN SINTÉTICA S.A.S.']);
  });
  it('conserva salud y seguro, extensión, verificación por correo y despedida', () => {
    const d = redactarCarta(snapshot());
    expect(d.parrafos.join(' ')).toMatch(/sistema de salud y contar con el seguro estudiantil de accidentes/);
    expect(d.parrafos.join(' ')).toMatch(/solicitud formal de extensión ante la Coordinación de Prácticas/);
    expect(d.notaVerificacion).toContain('practicas@cun.edu.co');
    expect(d.despedida).toBe('Quedamos atentos a su pronta respuesta.');
  });
});

describe('Carta · ARL según el responsable REAL', () => {
  it('EMPRESA: «La empresa deberá afiliar…» (Decreto 055 de 2015)', () => {
    expect(texto(snapshot({ responsableArl: 'empresa' }))).toContain(`${FRASE_EMPRESA_AFILIA} ante la Administradora de Riesgos Laborales (ARL), de acuerdo con el Decreto 055 de 2015.`);
  });
  it('CUN: la CUN asume la afiliación y NUNCA aparece «La empresa deberá afiliar…»', () => {
    const t = texto(snapshot({ responsableArl: 'cun' }));
    expect(t).toContain('estará a cargo de la Corporación Unificada Nacional de Educación Superior – CUN');
    expect(t).not.toContain(FRASE_EMPRESA_AFILIA);
  });
  it('sin práctica (carta genérica previa al registro): ni empresa ni CUN; se define al registrar', () => {
    expect(parrafoArl(null)).toMatch(/se definirá al formalizar el registro de la práctica/);
    expect(texto(snapshot({ responsableArl: null }))).not.toContain(FRASE_EMPRESA_AFILIA);
  });
});

describe('Carta · fecha, referencia, documento y archivo', () => {
  it('fecha de expedición en el calendario colombiano (UTC−5)', () => {
    expect(fechaColombia(new Date('2026-11-14T03:00:00.000Z'))).toEqual({ iso: '2026-11-13', texto: 'viernes 13 de noviembre de 2026' });
    expect(fechaColombia(new Date('2026-11-18T15:00:00.000Z')).texto).toBe('miércoles 18 de noviembre de 2026');
  });
  it('referencia: 10 símbolos sin ambiguos, formato XXXXX-XXXXX', () => {
    let i = 0; const r = construirReferencia(() => (i++ * 7) % 31);
    expect(r).toMatch(PATRON_REFERENCIA);
    expect(PATRON_REFERENCIA.test('0O1IL-ABCDE')).toBe(false);
  });
  it('documento enmascarado (solo los cuatro últimos) y nombre de archivo sin rutas', () => {
    expect(enmascararDocumento('1000000001')).toBe('••••••0001');
    expect(nombreArchivoCarta('1000000001', '2026-11-18')).toBe('Carta_presentacion_1000000001_2026-11-18.pdf');
    expect(nombreArchivoCarta('../../etc/passwd', '2026-11-18')).toBe('Carta_presentacion_etcpasswd_2026-11-18.pdf');
    expect(nombreArchivoCarta('1', '../x')).toBe('Carta_presentacion_1_fecha.pdf');
  });
});

// ── PDF real (pdfkit + membrete + QR) ──
// pdf.js del proyecto (hilo propio): el mismo lector local que usa SIPRA.
const lectorPdf = new PdfTrabajador();
afterAll(() => lectorPdf.terminar());
async function textoPdf(pdf: Buffer): Promise<{ paginas: number; texto: string }> {
  const r = await lectorPdf.extraerTexto(pdf, LIMITES_LECTURA_ACTA);
  return { paginas: r.paginas, texto: r.porPagina.map((p) => p.texto).join(' ').replace(/\s+/g, ' ') };
}
/** Rasteriza la página 1 del PDF EMITIDO y lee su QR. */
async function qrDelPdf(pdf: Buffer): Promise<string[]> {
  const { imagen } = await lectorPdf.renderizar(pdf, 1, LIMITES_LECTURA_ACTA);
  const { readBarcodes } = await cargarZxing();
  const leidos = await readBarcodes(new Blob([new Uint8Array(imagen)], { type: 'image/png' }), { formats: ['QRCode'], tryHarder: true });
  return leidos.map((x: { text: string }) => x.text);
}

describe('Carta · PDF institucional', () => {
  const generador = new CartaPdfAdapter();
  // Arranque único y costoso (hilo de pdf.js, WASM de ZXing y fuentes): fuera del tiempo de cada prueba.
  beforeAll(async () => {
    const pdf = await generador.generar(redactarCarta(snapshot()), 'http://localhost:4200/verificar-carta/K7QM4-X2DPR');
    await qrDelPdf(pdf);
  }, 180_000);
  it.each([
    ['Monitoría', ModalidadPractica.MONITORIA, 'cun' as const],
    ['Pasantía', ModalidadPractica.PASANTIA, null],
    ['Contrato de aprendizaje', ModalidadPractica.CONTRATO_APRENDIZAJE, 'empresa' as const],
  ])('%s: PDF válido de UNA página A4 con nombre, documento, programa, modalidad, fecha, referencia, QR y firmante', async (etiqueta, modalidad, arl) => {
    const s = snapshot({ modalidad, modalidadEtiqueta: etiqueta, responsableArl: arl, destinatario: arl === 'empresa' ? { tipo: 'empresa', nombre: 'ORGANIZACIÓN SINTÉTICA S.A.S.' } : { tipo: 'generica', nombre: DESTINATARIO_GENERICO } });
    const pdf = await generador.generar(redactarCarta(s), 'http://localhost:4200/verificar-carta/K7QM4-X2DPR');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const { paginas, texto: t } = await textoPdf(pdf);
    expect(paginas).toBe(1); // la referencia NO queda aislada en una segunda página
    for (const esperado of ['ESTUDIANTE SINTÉTICO UNO', '1000000001', 'REGISTRO DE PROCESOS PRODUCTIVOS', etiqueta.toUpperCase(), '18 de noviembre de 2026', 'REF: K7QM4-X2DPR', 'Firmante Sintético', 'Coordinador de Desarrollo Profesional', 'practicas@cun.edu.co']) {
      expect(t).toContain(esperado);
    }
    expect(t.includes(FRASE_EMPRESA_AFILIA)).toBe(arl === 'empresa');
    expect((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(3); // membrete, logo y QR
    expect(await qrDelPdf(pdf)).toEqual(['http://localhost:4200/verificar-carta/K7QM4-X2DPR']); // el QR impreso se lee
  }, 120_000);
  it('el QR codifica SOLO la URL de verificación con la referencia (sin datos personales) y se puede leer', async () => {
    const url = 'https://sipra.cun.edu.co/verificar-carta/K7QM4-X2DPR';
    const png = await qrPng(url);
    const requerir = createRequire(__filename);
    const lector = requerir('zxing-wasm/reader') as { readBarcodes: (b: Uint8Array, o: unknown) => Promise<{ text: string }[]>; prepareZXingModule: (o: unknown) => Promise<unknown> };
    const binario = await readFile(requerir.resolve('zxing-wasm/reader/zxing_reader.wasm'));
    await lector.prepareZXingModule({ overrides: { instantiateWasm: (imp: WebAssembly.Imports, listo: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => WebAssembly.instantiate(binario, imp).then((r) => listo(r.instance, r.module)) }, fireImmediately: true });
    const leidos = await lector.readBarcodes(new Uint8Array(png), { formats: ['QRCode'] });
    expect(leidos.map((x) => x.text)).toEqual([url]);
  }, 120_000);
  it('contenido normal largo (nombre, programa y empresa extensos) sigue en una página', async () => {
    const largo = snapshot({ estudianteNombre: 'Estudiante Sintético con Nombres y Apellidos Muy Extensos de Prueba', programa: 'Tecnología profesional en gestión integral de procesos administrativos, financieros y comerciales - virtual', destinatario: { tipo: 'empresa', nombre: 'ORGANIZACIÓN SINTÉTICA DE SERVICIOS LOGÍSTICOS, TECNOLÓGICOS Y COMERCIALES DE COLOMBIA S.A.S.' } });
    expect((await textoPdf(await generador.generar(redactarCarta(largo), 'http://localhost:4200/verificar-carta/K7QM4-X2DPR'))).paginas).toBe(1);
  }, 120_000);
});

// ── Caso de uso (repositorios en memoria; el generador de PDF es real) ──
const matricula = (o: Partial<MatriculaSinu> = {}): MatriculaSinu => ({
  documentoEstudiante: '1000000001', tipoDocumento: 'CC', nombreEstudiante: 'Estudiante Sintético Uno', correoInstitucional: 'est@cun.edu.co',
  programaId: 'REG-TEC', programaNombre: 'Técnica profesional en registro de procesos productivos', escuelaId: 'ESC-NEG', ciclo: 'tecnico',
  periodoAcademico: '2026-2', asignaturaPractica: 'Práctica I', ...o,
});

const SECRETO_PRUEBAS = 'secreto-sintetico-de-pruebas-0123456789abcdef';
function montar(o: { practicas?: Partial<DatosPractica>[]; ventana?: boolean; sinMatricula?: boolean; generadorReal?: boolean } = {}) {
  const filas = new Map<string, DatosCarta>();
  const archivos = new Map<string, Buffer>();
  const auditoria: RegistroAuditoria[] = [];
  const practicas = (o.practicas ?? []).map((p) => practicaDe({ estudianteId: 'est-1', periodoAcademico: '2026-2', estado: EstadoPractica.DOCUMENTACION, ...p }));
  const estudiante = usuarioDe(Rol.ESTUDIANTE, { id: 'est-1', nombre: 'Estudiante Sintético Uno', documento: '1000000001' });
  const caso = new CartaPresentacionUseCase(
    {
      buscarPorId: (id: string) => Promise.resolve(filas.has(id) ? CartaPresentacion.desde(filas.get(id)!) : null),
      buscarPorReferencia: (r: string) => Promise.resolve([...filas.values()].filter((c) => c.referencia === r).map((c) => CartaPresentacion.desde(c))[0] ?? null),
      listar: (f: { estudianteId?: string }) => Promise.resolve([...filas.values()].filter((c) => !f.estudianteId || c.estudianteId === f.estudianteId).map((c) => CartaPresentacion.desde(c))),
      emitir: (d: DatosCarta) => {
        const reemplazadas = [...filas.values()].filter((c) => c.estudianteId === d.estudianteId && c.periodoAcademico === d.periodoAcademico && c.modalidadCarta === d.modalidadCarta && c.practicaId === d.practicaId && c.estado === 'vigente' && c.referencia).map((c) => c.id);
        filas.set(d.id, { ...d });
        for (const id of reemplazadas) filas.set(id, { ...filas.get(id)!, estado: 'reemplazada', reemplazadaPor: d.id });
        return Promise.resolve({ carta: CartaPresentacion.desde(d), reemplazadas });
      },
      anular: (id: string, motivo: string, ahora: Date) => {
        const c = filas.get(id); if (!c || c.estado !== 'vigente') return Promise.resolve(false);
        filas.set(id, { ...c, estado: 'anulada', motivoAnulacion: motivo, anuladaEn: ahora }); return Promise.resolve(true);
      },
    } as never,
    { listar: () => Promise.resolve(practicas) } as never,
    { buscarPorCodigo: (c: string) => Promise.resolve(c === '2026-2' ? { codigo: '2026-2', ventanaAbierta: () => o.ventana ?? true, modalidadHabilitada: (m: string) => m !== String(ModalidadPractica.ESTADO_JOVEN) } : null) } as never,
    {
      buscarPorId: (id: string) => Promise.resolve(id === 'est-1' ? estudiante : null),
      buscarPorDocumento: (doc: string) => Promise.resolve(doc === '1000000001' ? estudiante : null),
    } as never,
    { registrar: (r: RegistroAuditoria) => { auditoria.push(r); return Promise.resolve(); } } as never,
    { buscarPorDocumento: () => Promise.resolve(o.sinMatricula ? null : matricula()) } as never,
    { generar: () => Promise.resolve(Buffer.from('%PDF-histórico')) },
    o.generadorReal ? new CartaPdfAdapter() : { generar: (d: { referencia: string; parrafos: readonly string[] }) => Promise.resolve(Buffer.from(`%PDF-sintético ${d.referencia} ${d.parrafos.join('|')}`)) },
    {
      guardar: (ruta: string, b: Buffer) => { archivos.set(ruta, Buffer.from(b)); return Promise.resolve(ruta); },
      leer: (ruta: string) => Promise.resolve(archivos.get(ruta)!),
      eliminar: (ruta: string) => { archivos.delete(ruta); return Promise.resolve(); },
    } as never,
    { get: (k: string) => ({ CARTA_FIRMANTE_NOMBRE: 'Firmante Sintético', URL_PUBLICA_WEB: 'https://sipra.example/', JWT_SECRETO: SECRETO_PRUEBAS } as Record<string, string>)[k] } as never,
    { buscarPorId: (id: string) => Promise.resolve(id === 'emp-1' ? { razonSocial: 'Empresa Habilitada Sintética S.A.S.' } : null) } as never,
  );
  return { caso, filas, archivos, auditoria, practicas };
}

const estudiante = actorDe(Rol.ESTUDIANTE, { id: 'est-1' });
const generica: SolicitudCarta = { periodoAcademico: '2026-2', modalidad: ModalidadPractica.MONITORIA };

describe('Carta · flujo del estudiante', () => {
  it('vista previa sin práctica: datos de SIPRA/SINU, «A QUIEN CORRESPONDA», modalidad elegida y sin escribir nada', async () => {
    const m = montar();
    const v = await m.caso.previsualizar(generica, estudiante);
    expect(v.estudiante).toEqual({ nombre: 'Estudiante Sintético Uno', tipoDocumento: 'CC', documento: '1000000001', programa: 'Técnica profesional en registro de procesos productivos', nivel: 'TÉCNICO' });
    expect(v.datos).toMatchObject({ destinatario: 'A QUIEN CORRESPONDA', tipoDestinatario: 'generica', modalidadEtiqueta: 'Monitoría', responsableArl: null });
    expect(v.puedeGenerar).toBe(true);
    expect(v.modalidadesOfertadas.some((x) => x.modalidad === String(ModalidadPractica.ESTADO_JOVEN))).toBe(false);
    expect(m.filas.size).toBe(0);
  });
  it('genérica: NO exige empresa registrada; elige modalidad ofertada', async () => {
    const m = montar();
    await expect(m.caso.previsualizar({ periodoAcademico: '2026-2' }, estudiante)).resolves.toMatchObject({ puedeGenerar: false, bloqueos: ['Elige la modalidad de práctica de la carta.'] });
    await expect(m.caso.previsualizar({ ...generica, modalidad: ModalidadPractica.ESTADO_JOVEN }, estudiante)).resolves.toMatchObject({ puedeGenerar: false });
    const r = await m.caso.generar(generica, estudiante, new Date('2026-11-18T15:00:00Z'));
    expect(r).toMatchObject({ estado: 'vigente', destinatario: 'A QUIEN CORRESPONDA', modalidadEtiqueta: 'Monitoría', digital: true, urlVerificacion: `https://sipra.example/verificar-carta/${r.referencia}` });
    expect(r.referencia).toMatch(PATRON_REFERENCIA);
  });
  it('con práctica y empresa vinculada: el destinatario es la organización (no editable) y la modalidad/ARL los de la práctica', async () => {
    const m = montar({ practicas: [{ id: 'p-1', modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, empresaRazonSocial: 'Organización Sintética S.A.S.', responsableArlPractica: 'empresa' }] });
    const v = await m.caso.previsualizar({ periodoAcademico: '2026-2', practicaId: 'p-1', modalidad: ModalidadPractica.MONITORIA }, estudiante);
    expect(v.datos).toMatchObject({ destinatario: 'ORGANIZACIÓN SINTÉTICA S.A.S.', tipoDestinatario: 'empresa', modalidadEtiqueta: 'Contrato de aprendizaje', responsableArl: 'empresa' });
    expect(v.documento!.parrafos.join(' ')).toContain(FRASE_EMPRESA_AFILIA);
    const g = await m.caso.previsualizar({ periodoAcademico: '2026-2', practicaId: 'p-1', destinatario: 'generica' }, estudiante);
    expect(g.datos!.destinatario).toBe('A QUIEN CORRESPONDA');
  });
  it('la organización vinculada por RELACIÓN (empresa habilitada) se resuelve aunque el registro no traiga el nombre', async () => {
    const m = montar({ practicas: [{ id: 'p-1', modalidad: ModalidadPractica.PASANTIA, empresaId: 'emp-1', empresaRazonSocial: null, responsableArlPractica: 'empresa' }] });
    const v = await m.caso.previsualizar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante);
    expect(v.practicas[0].empresa).toBe('Empresa Habilitada Sintética S.A.S.');
    expect(v.datos).toMatchObject({ destinatario: 'EMPRESA HABILITADA SINTÉTICA S.A.S.', tipoDestinatario: 'empresa' });
  });
  it('práctica con responsable CUN: la carta no dice que la empresa afilia', async () => {
    const m = montar({ practicas: [{ id: 'p-1', modalidad: ModalidadPractica.MONITORIA, responsableArlPractica: 'cun' }] });
    const v = await m.caso.previsualizar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante);
    expect(v.documento!.parrafos.join(' ')).not.toContain(FRASE_EMPRESA_AFILIA);
    expect(v.documento!.parrafos.join(' ')).toContain('estará a cargo de la Corporación Unificada Nacional');
  });
  it('práctica SIN responsable de ARL: «Falta definir quién asume la afiliación a ARL.» y no se genera', async () => {
    const m = montar({ practicas: [{ id: 'p-1', modalidad: ModalidadPractica.PASANTIA, responsableArlPractica: null }] });
    const v = await m.caso.previsualizar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante);
    expect(v.bloqueos).toContain(MENSAJE_FALTA_ARL);
    await expect(m.caso.generar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante)).rejects.toThrow(MENSAJE_FALTA_ARL);
    expect(m.filas.size).toBe(0);
  });
  it('destinatario «empresa» sin organización vinculada: bloqueado (el estudiante no escribe nombres de empresa)', async () => {
    const m = montar({ practicas: [{ id: 'p-1', responsableArlPractica: 'empresa', empresaRazonSocial: null }] });
    const v = await m.caso.previsualizar({ periodoAcademico: '2026-2', practicaId: 'p-1', destinatario: 'empresa' }, estudiante);
    expect(v.puedeGenerar).toBe(false);
  });
  it('ventana cerrada: «Generación de carta no disponible para este período.»; las emitidas se siguen descargando', async () => {
    const abierta = montar();
    const r = await abierta.caso.generar(generica, estudiante);
    const m = montar({ ventana: false });
    for (const [k, v] of abierta.filas) m.filas.set(k, v);
    for (const [k, v] of abierta.archivos) m.archivos.set(k, v);
    const v = await m.caso.previsualizar(generica, estudiante);
    expect(v.bloqueos).toContain(MENSAJE_VENTANA_CERRADA);
    await expect(m.caso.generar(generica, estudiante)).rejects.toThrow(MENSAJE_VENTANA_CERRADA);
    await expect(m.caso.pdf(r.id, estudiante)).resolves.toMatchObject({ nombreArchivo: expect.stringMatching(/^Carta_presentacion_1000000001_\d{4}-\d{2}-\d{2}\.pdf$/) });
  });
  it('sin matrícula en SINU: no se expide (sin programa ni nivel no hay carta)', async () => {
    const v = await montar({ sinMatricula: true }).caso.previsualizar(generica, estudiante);
    expect(v.puedeGenerar).toBe(false);
    expect(v.bloqueos.join(' ')).toMatch(/SINU/);
  });
});

describe('Carta · emisión inmutable, versionado y verificación', () => {
  it('guarda el PDF emitido con su SHA-256, el snapshot y la referencia; la descarga entrega ESE archivo', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    const d = m.filas.get(r.id)!;
    const archivo = m.archivos.get(d.rutaArchivo!)!;
    expect(d.pdfSha256).toBe(createHash('sha256').update(archivo).digest('hex'));
    expect(d.snapshot).toMatchObject({ referencia: r.referencia, documento: '1000000001', modalidad: ModalidadPractica.MONITORIA, responsableArl: null });
    expect((await m.caso.pdf(r.id, estudiante)).contenido.equals(archivo)).toBe(true);
  });
  it('si el archivo almacenado cambió, la descarga se bloquea (integridad)', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    m.archivos.set(m.filas.get(r.id)!.rutaArchivo!, Buffer.from('%PDF-alterado'));
    await expect(m.caso.pdf(r.id, estudiante)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
  it('versionado: cambia un dato de la práctica y se genera otra → referencia distinta, la anterior REEMPLAZADA con su PDF y snapshot intactos', async () => {
    const m = montar({ practicas: [{ id: 'p-1', modalidad: ModalidadPractica.PASANTIA, responsableArlPractica: 'empresa', empresaRazonSocial: 'Organización Sintética S.A.S.' }] });
    const a = await m.caso.generar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante);
    const antes = { ...m.filas.get(a.id)! };
    const pdfAntes = Buffer.from(m.archivos.get(antes.rutaArchivo!)!);
    // Cambio permitido (G5): ahora afilia la CUN.
    const p = m.practicas[0].instantanea(); m.practicas[0] = Practica.desde({ ...p, responsableArlPractica: 'cun' });
    const b = await m.caso.generar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante);
    expect(b.referencia).not.toBe(a.referencia);
    const viejo = m.filas.get(a.id)!;
    expect(viejo).toMatchObject({ estado: 'reemplazada', reemplazadaPor: b.id });
    expect(viejo.snapshot).toEqual(antes.snapshot);
    expect(viejo.snapshot!.responsableArl).toBe('empresa');
    expect(m.archivos.get(antes.rutaArchivo!)!.equals(pdfAntes)).toBe(true);
    expect(m.filas.get(b.id)!.snapshot!.responsableArl).toBe('cun');
    expect(m.auditoria.find((x) => x.entidadId === b.id)!.metadatos).toMatchObject({ reemplazadas: [a.id] });
  });
  it('verificación pública: referencia válida muestra lo mínimo (documento enmascarado); inexistente o inválida: «no encontrada»', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    const v = await m.caso.verificar(r.referencia!.toLowerCase());
    expect(v).toEqual({
      encontrada: true, referencia: r.referencia, estado: 'vigente', estudiante: 'Estudiante Sintético Uno', documento: '••••••0001',
      programa: 'Técnica profesional en registro de procesos productivos', nivel: 'TÉCNICO', modalidad: 'Monitoría', fechaExpedicion: expect.any(String),
    });
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(['practicaId', 'escuelaId', 'correo', 'firmante']));
    await expect(m.caso.verificar('AAAAA-AAAAA')).resolves.toEqual({ encontrada: false });
    await expect(m.caso.verificar("x' OR 1=1")).resolves.toEqual({ encontrada: false });
  });
  it('carta reemplazada o anulada: su estado se ve en la verificación', async () => {
    const m = montar();
    const a = await m.caso.generar(generica, estudiante);
    const b = await m.caso.generar(generica, estudiante);
    await expect(m.caso.verificar(a.referencia!)).resolves.toMatchObject({ estado: 'reemplazada' });
    const coord = actorDe(Rol.COORDINADOR);
    await expect(m.caso.anular(b.id, 'corto', coord)).rejects.toBeInstanceOf(BadRequestException);
    await m.caso.anular(b.id, 'Emitida con un programa equivocado (sintético).', coord);
    await expect(m.caso.verificar(b.referencia!)).resolves.toMatchObject({ estado: 'anulada' });
    expect(m.auditoria.some((x) => x.accion === AccionAuditada.CARTA_ANULADA && x.justificacion?.includes('programa equivocado'))).toBe(true);
  });
  it('referencias nunca reutilizadas', async () => {
    const m = montar();
    const refs = new Set<string>();
    for (let i = 0; i < 12; i++) refs.add((await m.caso.generar(generica, estudiante)).referencia!);
    expect(refs.size).toBe(12);
  });
});

describe('Carta · permisos y alcance', () => {
  it.each([Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.EMPRESA, Rol.EXTENSION])('%s NO emite (403)', async (rol) => {
    await expect(montar().caso.generar({ ...generica, estudianteDocumento: '1000000001' }, actorDe(rol))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR])('%s emite para un estudiante de su alcance (por documento)', async (rol) => {
    await expect(montar().caso.generar({ ...generica, estudianteDocumento: '1000000001' }, actorDe(rol))).resolves.toMatchObject({ estado: 'vigente' });
  });
  it('coordinación restringida a otra escuela: 403; docente: solo su escuela o sus asignados', async () => {
    await expect(montar().caso.generar({ ...generica, estudianteDocumento: '1000000001' }, actorDe(Rol.COORDINADOR, { escuelas: ['ESC-ING'] }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(montar().caso.generar({ ...generica, estudianteDocumento: '1000000001' }, actorDe(Rol.TUTOR, { escuelas: ['ESC-ING'] }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(montar().caso.generar({ ...generica, estudianteDocumento: '1000000001' }, actorDe(Rol.TUTOR, { escuelas: ['ESC-NEG'] }))).resolves.toBeDefined();
  });
  it('el estudiante solo ve y descarga SUS cartas; otro estudiante recibe 404', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    await expect(m.caso.pdf(r.id, actorDe(Rol.ESTUDIANTE, { id: 'otro' }))).rejects.toBeInstanceOf(NotFoundException);
    expect(await m.caso.listar({}, actorDe(Rol.ESTUDIANTE, { id: 'otro' }))).toEqual([]);
  });
  it('administración consulta (lectura) pero no anula; dirección no entra a cartas (matriz G1)', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    expect(await m.caso.listar({}, actorDe(Rol.ADMINISTRADOR))).toHaveLength(1);
    expect(await m.caso.listar({}, actorDe(Rol.DIRECTOR))).toEqual([]);
    await expect(m.caso.pdf(r.id, actorDe(Rol.DIRECTOR))).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.caso.anular(r.id, 'Motivo suficiente de prueba', actorDe(Rol.ADMINISTRADOR))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('auditoría: emisión (actor, estudiante, práctica, referencia, modalidad, destinatario, fecha) y descarga', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante, new Date('2026-11-18T15:00:00Z'));
    await m.caso.pdf(r.id, estudiante);
    const emision = m.auditoria.find((x) => x.accion === AccionAuditada.CARTA_PRESENTACION_GENERADA)!;
    expect(emision).toMatchObject({ actorId: 'est-1', actorRol: Rol.ESTUDIANTE, entidadId: r.id });
    expect(emision.metadatos).toMatchObject({ referencia: r.referencia, estudianteId: 'est-1', practicaId: null, modalidad: ModalidadPractica.MONITORIA, destinatario: { tipo: 'generica', nombre: 'A QUIEN CORRESPONDA' }, fechaExpedicion: '2026-11-18' });
    expect(m.auditoria.some((x) => x.accion === AccionAuditada.CARTA_DESCARGADA && x.entidadId === r.id)).toBe(true);
  });
  it('con el generador REAL: la carta emitida es un PDF de una página con su referencia', async () => {
    const m = montar({ generadorReal: true });
    const r = await m.caso.generar(generica, estudiante);
    const { paginas, texto: t } = await textoPdf((await m.caso.pdf(r.id, estudiante)).contenido);
    expect(paginas).toBe(1);
    expect(t).toContain(`REF: ${r.referencia}`);
  }, 120_000);
});

// ── Consulta y descarga PÚBLICAS por número de identificación ──
const PUBLICO = { ip: '203.0.113.7' };
describe('Carta pública · consulta por identificación', () => {
  it('identificación con carta VIGENTE → datos mínimos y token de descarga (sin hash, sin autor, sin expediente)', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    const c = await m.caso.consultarPublica('1000000001', PUBLICO);
    expect(c.mensaje).toBeNull();
    expect(c.cartas).toHaveLength(1);
    expect(c.cartas[0]).toMatchObject({
      referencia: r.referencia, estado: 'vigente', estudiante: 'Estudiante Sintético Uno', programa: 'Técnica profesional en registro de procesos productivos',
      nivel: 'TÉCNICO', modalidad: 'Monitoría', destinatario: 'A QUIEN CORRESPONDA',
    });
    expect(Object.keys(c.cartas[0]).sort()).toEqual(['destinatario', 'estado', 'estudiante', 'fechaExpedicion', 'modalidad', 'nivel', 'programa', 'referencia', 'tokenDescarga']);
    expect(JSON.stringify(c)).not.toMatch(/pdfSha256|generadaPor|rutaArchivo|est-1|practicaId|1000000001/);
  });
  it('normaliza espacios y puntos, pero exige coincidencia EXACTA (sin búsquedas parciales)', async () => {
    const m = montar();
    await m.caso.generar(generica, estudiante);
    expect((await m.caso.consultarPublica(' 1.000.000.001 ', PUBLICO)).cartas).toHaveLength(1);
    for (const parcial of ['10000', '100000000', '10000000012']) expect((await m.caso.consultarPublica(parcial, PUBLICO)).cartas).toHaveLength(0);
  });
  it('sin carta, estudiante inexistente, solo anuladas o solo reemplazadas → el MISMO mensaje genérico', async () => {
    const sinCarta = montar();
    const vacia = await sinCarta.caso.consultarPublica('1000000001', PUBLICO);
    const inexistente = await sinCarta.caso.consultarPublica('99999999', PUBLICO);
    expect(vacia).toEqual({ cartas: [], mensaje: MENSAJE_SIN_CARTA_PUBLICA });
    expect(inexistente).toEqual(vacia);
    const anulada = montar();
    const a = await anulada.caso.generar(generica, estudiante);
    await anulada.caso.anular(a.id, 'Anulada para la prueba sintética.', actorDe(Rol.COORDINADOR));
    expect(await anulada.caso.consultarPublica('1000000001', PUBLICO)).toEqual(vacia);
    const reemplazada = montar();
    const r1 = await reemplazada.caso.generar(generica, estudiante);
    const r2 = await reemplazada.caso.generar(generica, estudiante);
    await reemplazada.caso.anular(r2.id, 'Anulada para dejar solo la reemplazada.', actorDe(Rol.COORDINADOR));
    expect(reemplazada.filas.get(r1.id)!.estado).toBe('reemplazada');
    expect(await reemplazada.caso.consultarPublica('1000000001', PUBLICO)).toEqual(vacia);
    expect(MENSAJE_SIN_CARTA_PUBLICA).toBe('No encontramos una carta de presentación vigente asociada a este número de identificación.');
  });
  it('genérica y para empresa vigentes: ambas aparecen y ambas se descargan (nunca las reemplazadas)', async () => {
    const m = montar({ practicas: [{ id: 'p-1', modalidad: ModalidadPractica.PASANTIA, empresaRazonSocial: 'Organización Sintética S.A.S.', responsableArlPractica: 'empresa' }] });
    await m.caso.generar(generica, estudiante); // reemplazada luego
    await m.caso.generar(generica, estudiante);
    await m.caso.generar({ periodoAcademico: '2026-2', practicaId: 'p-1' }, estudiante);
    const c = await m.caso.consultarPublica('1000000001', PUBLICO);
    expect(c.cartas.map((x) => x.destinatario).sort()).toEqual(['A QUIEN CORRESPONDA', 'ORGANIZACIÓN SINTÉTICA S.A.S.']);
    for (const x of c.cartas) {
      const d = await m.caso.descargarPublica(x.tokenDescarga, PUBLICO);
      const fila = [...m.filas.values()].find((f) => f.referencia === x.referencia)!;
      expect(d.contenido.equals(m.archivos.get(fila.rutaArchivo!)!)).toBe(true);
      expect(d.nombreArchivo).toMatch(/^Carta_presentacion_1000000001_\d{4}-\d{2}-\d{2}\.pdf$/);
    }
  });
  it('identificación inválida o con forma de inyección → 400 con mensaje neutro (sin consultar)', async () => {
    const m = montar();
    for (const malo of ["1' OR '1'='1", '1000;DROP', '', '12', 'x'.repeat(41), '<script>', null, 123]) {
      await expect(m.caso.consultarPublica(malo, PUBLICO)).rejects.toThrow(MENSAJE_DOCUMENTO_INVALIDO);
    }
    expect(normalizarDocumento('AB123456')).toBe('AB123456');
    expect(normalizarDocumento('1 013 115 164')).toBe('1013115164');
  });
  it('auditoría mínima: consulta y descarga públicas, sin la identificación consultada', async () => {
    const m = montar();
    await m.caso.generar(generica, estudiante);
    const c = await m.caso.consultarPublica('1000000001', PUBLICO);
    await m.caso.descargarPublica(c.cartas[0].tokenDescarga, PUBLICO);
    const consulta = m.auditoria.find((x) => x.accion === AccionAuditada.CARTA_CONSULTADA_PUBLICAMENTE)!;
    const descarga = m.auditoria.find((x) => x.accion === AccionAuditada.CARTA_DESCARGADA_PUBLICAMENTE)!;
    expect(consulta).toMatchObject({ actorId: null, actorRol: 'publico', ip: PUBLICO.ip, metadatos: { referencias: [c.cartas[0].referencia], estudianteId: 'est-1' } });
    expect(descarga).toMatchObject({ actorId: null, actorRol: 'publico', metadatos: { referencia: c.cartas[0].referencia } });
    expect(JSON.stringify([consulta, descarga])).not.toContain('1000000001');
    // Sin resultado: nada en auditoría (solo la métrica).
    const antes = m.auditoria.length;
    await m.caso.consultarPublica('99999999', PUBLICO);
    expect(m.auditoria.length).toBe(antes);
  });
});

describe('Carta pública · token de descarga', () => {
  const ahora = new Date('2026-11-18T15:00:00Z').getTime();
  it('token válido descarga; vencido (10 min) o alterado se rechaza', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    const token = emitirTokenCarta(SECRETO_PRUEBAS, r.id, ahora);
    expect(verificarTokenCarta(SECRETO_PRUEBAS, token, ahora + 9 * 60_000)).toBe(r.id);
    expect(verificarTokenCarta(SECRETO_PRUEBAS, token, ahora + 11 * 60_000)).toBeNull();
    expect(verificarTokenCarta('otro-secreto', token, ahora)).toBeNull();
    const crudo = Buffer.from(token, 'base64url').toString('utf8');
    const alterado = Buffer.from(crudo.replace(/^.{8}/, 'ffffffff')).toString('base64url');
    expect(verificarTokenCarta(SECRETO_PRUEBAS, alterado, ahora)).toBeNull();
    const masTiempo = Buffer.from(crudo.replace(/\.(\d+)\./, (_x, n: string) => `.${Number(n) + 3_600_000}.`)).toString('base64url');
    expect(verificarTokenCarta(SECRETO_PRUEBAS, masTiempo, ahora)).toBeNull();
    await expect(m.caso.descargarPublica('basura', PUBLICO)).rejects.toThrow(MENSAJE_TOKEN_INVALIDO);
  });
  it('el UUID de otra carta (o un id «secuencial») no sirve sin su firma', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    await expect(m.caso.descargarPublica(r.id, PUBLICO)).rejects.toThrow(MENSAJE_TOKEN_INVALIDO);
    await expect(m.caso.descargarPublica(Buffer.from(`${r.id}.9999999999999.${'0'.repeat(64)}`).toString('base64url'), PUBLICO)).rejects.toThrow(MENSAJE_TOKEN_INVALIDO);
  });
  it('carta ANULADA o REEMPLAZADA después de emitir el token → «La carta consultada ya no se encuentra vigente.»', async () => {
    const m = montar();
    const a = await m.caso.generar(generica, estudiante);
    const tokenA = (await m.caso.consultarPublica('1000000001', PUBLICO)).cartas[0].tokenDescarga;
    await m.caso.generar(generica, estudiante); // reemplaza la A
    await expect(m.caso.descargarPublica(tokenA, PUBLICO)).rejects.toBeInstanceOf(GoneException);
    await expect(m.caso.descargarPublica(tokenA, PUBLICO)).rejects.toThrow(MENSAJE_NO_VIGENTE);
    const tokenB = (await m.caso.consultarPublica('1000000001', PUBLICO)).cartas[0].tokenDescarga;
    const b = [...m.filas.values()].find((f) => f.estado === 'vigente')!;
    await m.caso.anular(b.id, 'Anulada después de consultar (prueba).', actorDe(Rol.COORDINADOR));
    await expect(m.caso.descargarPublica(tokenB, PUBLICO)).rejects.toThrow(MENSAJE_NO_VIGENTE);
    expect(a.id).not.toBe(b.id);
  });
  it('si el PDF almacenado cambió, la descarga pública se bloquea (SHA-256)', async () => {
    const m = montar();
    const r = await m.caso.generar(generica, estudiante);
    const token = (await m.caso.consultarPublica('1000000001', PUBLICO)).cartas[0].tokenDescarga;
    m.archivos.set(m.filas.get(r.id)!.rutaArchivo!, Buffer.from('%PDF-alterado'));
    await expect(m.caso.descargarPublica(token, PUBLICO)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe('Carta pública · límite de solicitudes', () => {
  const t0 = 1_000_000;
  it('consulta: 10 por minuto por IP; la 11.ª → 429; otra IP no se ve afectada; al minuto se recupera', () => {
    const l = new LimitadorPublicoService();
    for (let i = 0; i < 10; i++) l.exigir('consulta_minuto', '1.1.1.1', t0 + i);
    expect(() => l.exigir('consulta_minuto', '1.1.1.1', t0 + 20)).toThrow(HttpException);
    expect(() => l.exigir('consulta_minuto', '2.2.2.2', t0 + 20)).not.toThrow();
    expect(() => l.exigir('consulta_minuto', '1.1.1.1', t0 + 61_000)).not.toThrow();
  });
  it('8 consultas sin resultado en 15 min → pausa de la IP (protección contra barrido de cédulas)', () => {
    const l = new LimitadorPublicoService();
    for (let i = 0; i < 8; i++) l.contar('fallidas', '3.3.3.3', t0 + i);
    expect(() => l.verificarSinContar('fallidas', '3.3.3.3', t0 + 100)).toThrow(HttpException);
    expect(() => l.verificarSinContar('fallidas', '3.3.3.3', t0 + 15 * 60_000 + 1)).not.toThrow();
  });
  it('descarga: 30 por minuto; verificación: 60 por minuto', () => {
    const l = new LimitadorPublicoService();
    for (let i = 0; i < 30; i++) l.exigir('descarga', '4.4.4.4', t0);
    expect(() => l.exigir('descarga', '4.4.4.4', t0)).toThrow(HttpException);
    for (let i = 0; i < 60; i++) l.exigir('verificacion', '4.4.4.4', t0);
    expect(() => l.exigir('verificacion', '4.4.4.4', t0)).toThrow(HttpException);
  });
});
