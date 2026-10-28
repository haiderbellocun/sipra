import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { MesaEpsUseCase, AVISO_RETENCION_EPS } from '../src/application/use-cases/documentos/mesa-eps.use-case';
import { ValidacionEpsUseCase } from '../src/application/use-cases/documentos/validacion-eps.use-case';
import { EstadoAdres, RecomendacionEps } from '../src/domain/entities/adres';
import { AccionAuditada, RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import { DatosDocumento, Documento, EstadoDocumento, SeveridadBandera, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, DecisionEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { MotivoDevolucionEps, MENSAJES_DEVOLUCION_EPS } from '../src/domain/services/mesa-eps.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { TOPE_LISTADO_MESA } from '../src/domain/ports/out/validacion-eps.port';
import { MetricasService } from '../src/infrastructure/observability/metricas.service';
import { ESC_A, ESC_B, actorDe, documentoDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { ValidacionesEnMemoria } from './soporte-validacion-eps';

/**
 * Mesa operativa de EPS con repositorios en memoria (las operaciones atómicas
 * emulan la semántica SQL; la prueba contra PostgreSQL está en
 * `herramientas/verificar-concurrencia-pg.ts`).
 */

const AHORA = new Date('2026-10-26T15:00:00Z');
const MIN = 60_000;
const DIA = 86_400_000;
const CEDULA = '1032456786';

const CERT: DatosExtraidosEps = {
  tipoDocumento: 'CC', numeroDocumento: CEDULA, nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS Sintetica', epsClave: 'SINTETICA',
  regimen: 'contributivo', tipoAfiliado: 'beneficiario', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
  fuentes: { nombre_afiliado: 'texto_nativo', documento_afiliado: 'texto_nativo', entidad_emisora: 'ocr' },
};

class DocumentosEnMemoria {
  filas = new Map<string, DatosDocumento>();
  buscarPorId = (id: string) => Promise.resolve(this.filas.has(id) ? Documento.desde(this.filas.get(id) as DatosDocumento) : null);
  listarPorPractica = (practicaId: string) => Promise.resolve([...this.filas.values()].filter((d) => d.practicaId === practicaId).map((d) => Documento.desde(d)));
  guardarSiEstado = (datos: DatosDocumento, esperado: EstadoDocumento) => {
    if (this.filas.get(datos.id)?.estado !== esperado) return Promise.resolve(false);
    this.filas.set(datos.id, datos);
    return Promise.resolve(true);
  };
  guardar = (d: DatosDocumento) => { this.filas.set(d.id, d); return Promise.resolve(Documento.desde(d)); };
}

class AuditoriaEnMemoria {
  registros: RegistroAuditoria[] = [];
  registrar = jest.fn((r: RegistroAuditoria) => { this.registros.push(r); return Promise.resolve(); });
  listar = (f: { entidad?: string; entidadId?: string }) => Promise.resolve(this.registros.filter((r) => (!f.entidad || r.entidad === f.entidad) && (!f.entidadId || r.entidadId === f.entidadId)));
}

interface OpcionesCaso {
  id: string; version?: number; recibidaHace?: number; inicioEnDias?: number | null; escuela?: string; practicaId?: string; estudianteId?: string;
  nombre?: string; documento?: string; adres?: EstadoAdres; afiliacion?: AfiliacionEps; autenticidad?: AutenticidadEps; critica?: boolean;
  reservaPara?: string; reservaVence?: Date; mime?: string; candidato?: boolean;
}

function montar(config: Record<string, unknown> = {}, metricas?: MetricasService) {
  const validaciones = new ValidacionesEnMemoria();
  const documentos = new DocumentosEnMemoria();
  const auditoria = new AuditoriaEnMemoria();
  const almacen = { leer: jest.fn((ruta: string) => Promise.resolve(Buffer.from(`contenido:${ruta}`))), guardar: jest.fn(), eliminar: jest.fn() };
  const estudiantes = new Map<string, ReturnType<typeof usuarioDe>>();
  const personal = new Map<string, ReturnType<typeof usuarioDe>>();
  const practicasPorId = new Map<string, ReturnType<typeof practicaDe>>();
  const usuarios = { buscarPorId: jest.fn((id: string) => Promise.resolve(estudiantes.get(id) ?? personal.get(id) ?? null)) };
  const practicas = { buscarPorId: jest.fn((id: string) => Promise.resolve(practicasPorId.get(id) ?? null)) };
  const parametros = new ParametrosUseCase({ listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve() });
  const eps = new ValidacionEpsUseCase(validaciones, documentos as never, practicas as never, usuarios as never, auditoria as never, parametros);
  const gestionar = new GestionarDocumentoUseCase(
    documentos as never, practicas as never, usuarios as never, auditoria as never, almacen as never, { notificar: jest.fn() } as never,
    {} as never, {} as never, {} as never, { anotarDevolucion: jest.fn() } as never, {} as never, {} as never, {} as never, eps,
  );
  const mesa = new MesaEpsUseCase(
    validaciones, documentos as never, practicas as never, usuarios as never, auditoria as never, almacen as never, gestionar,
    { get: (k: string) => config[k] } as never,
    metricas,
  );

  const crear = async (o: OpcionesCaso): Promise<void> => {
    const estudianteId = o.estudianteId ?? `est-${o.id}`;
    const practicaId = o.practicaId ?? `pra-${o.id}`;
    estudiantes.set(estudianteId, usuarioDe(Rol.ESTUDIANTE, { id: estudianteId, documento: o.documento ?? CEDULA, nombre: o.nombre ?? 'Laura Sofía Ramírez Ortiz' }));
    const inicio = o.inicioEnDias === undefined || o.inicioEnDias === null ? null : new Date(AHORA.getTime() + o.inicioEnDias * DIA);
    if (!practicasPorId.has(practicaId)) {
      practicasPorId.set(practicaId, practicaDe({ id: practicaId, estudianteId, escuelaId: o.escuela ?? ESC_A, fechaInicio: inicio, periodoAcademico: '2026-2' }));
    }
    const recibida = new Date(AHORA.getTime() - (o.recibidaHace ?? 0) * DIA);
    const documentoId = `doc-${o.id}`;
    documentos.filas.set(documentoId, documentoDe(TipoDocumento.CERTIFICADO_EPS, {
      id: documentoId, practicaId, version: o.version ?? 1, estado: EstadoDocumento.EN_REVISION, mimeReal: o.mime ?? 'application/pdf',
      rutaAlmacenamiento: `ruta/${o.id}`, nombreOriginal: `certificado-${o.id}.pdf`, cargadoEn: recibida, extraccion: null,
    }).instantanea());
    const v = ValidacionEps.pendiente({ id: o.id, documentoId, practicaId, estudianteId, ahora: recibida, recibidaEn: recibida });
    const certificado = { ...CERT, nombre: (o.nombre ?? 'Laura Sofía Ramírez Ortiz').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), numeroDocumento: o.documento ?? CEDULA };
    v.registrarProcesamiento({ datosExtraidos: certificado, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: o.critica ?? false }, recibida);
    if (o.autenticidad === AutenticidadEps.VERIFICADA) {
      v.registrarVerificacionOficial({ verificador: 'v', autenticidad: AutenticidadEps.VERIFICADA, ruta: v.ruta, datosVerificados: null, discrepancias: [] }, recibida);
    }
    const datos = v.instantanea();
    if (o.adres) datos.adres = { ...datos.adres, estado: o.adres };
    if (o.afiliacion) {
      datos.afiliacion = o.afiliacion; datos.afiliacionFuente = 'adres_bdua'; datos.adres = { ...datos.adres, estado: EstadoAdres.PROCESADO };
      if (o.autenticidad === AutenticidadEps.VERIFICADA && o.afiliacion === AfiliacionEps.ACTIVA) datos.decision = DecisionEps.CANDIDATO_AUTOAPROBACION;
    }
    if (o.reservaPara) { datos.asignadoA = o.reservaPara; datos.reservadoEn = AHORA; datos.reservaHasta = o.reservaVence ?? new Date(AHORA.getTime() + 10 * MIN); datos.primeraRevisionEn = AHORA; }
    await validaciones.crearSiNoExiste(datos);
    const practica = practicasPorId.get(practicaId)?.instantanea();
    validaciones.contexto.set(o.id, {
      estudiante: { id: estudianteId, nombre: o.nombre ?? 'Laura Sofía Ramírez Ortiz', documento: o.documento ?? CEDULA },
      practica: { id: practicaId, programaId: 'ADM-PRO', modalidad: 'pasantia', periodoAcademico: '2026-2', fechaInicio: practica?.fechaInicio ?? null, escuelaId: o.escuela ?? ESC_A },
      documento: { id: documentoId, version: o.version ?? 1, cargadoEn: recibida, estado: 'en_revision', nombreOriginal: `certificado-${o.id}.pdf`, totalVersiones: o.version ?? 1 },
    });
  };
  const registrarPersona = (id: string, nombre: string, rol: Rol = Rol.AUXILIAR): void => {
    personal.set(id, usuarioDe(rol, { id, nombre, correo: `${id}@cun.edu.co` }));
    validaciones.nombresDeUsuarios.set(id, nombre);
  };
  return { mesa, validaciones, documentos, auditoria, almacen, crear, registrarPersona, fila: (id: string) => validaciones.filas.get(id) as DatosDocFila };
}
type DatosDocFila = NonNullable<ReturnType<ValidacionesEnMemoria['filas']['get']>>;

const aux = (id = 'aux-1') => actorDe(Rol.AUXILIAR, { id, correo: `${id}@cun.edu.co` });
const coord = (id = 'coord-1') => actorDe(Rol.COORDINADOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
const admin = actorDe(Rol.ADMINISTRADOR, { id: 'admin-1', correo: 'admin@cun.edu.co' });

// ── Permisos ────────────────────────────────────────────────────────────────

describe('Mesa EPS · permisos', () => {
  it.each([Rol.TUTOR, Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION])('%s no entra a la Mesa operativa', async (rol) => {
    const m = montar();
    await m.crear({ id: 'c1' });
    const a = actorDe(rol);
    await expect(m.mesa.listar(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.detalle('c1', a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomarSiguiente(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.certificado('c1', a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.decidir('c1', a, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([['auxiliar', aux()], ['coordinación', coord()], ['administración', admin]])('%s sí entra y lista', async (_n, actor) => {
    const m = montar();
    await m.crear({ id: 'c1' });
    expect((await m.mesa.listar(actor, {}, AHORA)).total).toBe(1);
  });

  it('la supervisión es solo de coordinación y administración (el auxiliar no)', async () => {
    const m = montar();
    await expect(m.mesa.supervision(aux(), AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(coord(), AHORA)).resolves.toBeDefined();
    await expect(m.mesa.supervision(admin, AHORA)).resolves.toBeDefined();
  });

  it('coordinación con escuelas asignadas solo ve las suyas; auxiliar y administración, todas', async () => {
    const m = montar();
    await m.crear({ id: 'a', escuela: ESC_A });
    await m.crear({ id: 'b', escuela: ESC_B });
    expect((await m.mesa.listar(coord(), {}, AHORA)).filas.map((f) => f.validacionId)).toEqual(['a']);
    expect((await m.mesa.listar(aux(), {}, AHORA)).total).toBe(2);
    expect((await m.mesa.listar(admin, {}, AHORA)).total).toBe(2);
  });

  it('un caso fuera del alcance de la coordinación responde 404', async () => {
    const m = montar();
    await m.crear({ id: 'b', escuela: ESC_B });
    await expect(m.mesa.detalle('b', coord(), AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── Bandeja, KPIs, filtros, prioridad ───────────────────────────────────────

describe('Mesa EPS · bandeja, KPIs y filtros', () => {
  async function escenario() {
    const m = montar();
    m.registrarPersona('aux-1', 'Ana Auxiliar');
    m.registrarPersona('aux-2', 'Beto Auxiliar');
    await m.crear({ id: 'viejo', recibidaHace: 20 });
    await m.crear({ id: 'adres', recibidaHace: 3, adres: EstadoAdres.EN_CONSULTA });
    await m.crear({ id: 'cand', recibidaHace: 1, autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA });
    await m.crear({ id: 'disc', recibidaHace: 2, critica: true, nombre: 'Carlos Pérez Gómez', documento: '555000111' });
    await m.crear({ id: 'mio', recibidaHace: 5, reservaPara: 'aux-1', nombre: 'Marta Gómez López', documento: '777888999' });
    await m.crear({ id: 'ajeno', recibidaHace: 4, reservaPara: 'aux-2', nombre: 'Pedro Ruiz', documento: '123123123' });
    await m.crear({ id: 'vencido', recibidaHace: 6, reservaPara: 'aux-2', reservaVence: new Date(AHORA.getTime() - MIN) });
    return m;
  }

  it('los KPIs salen de los datos reales', async () => {
    const m = await escenario();
    const { kpis } = await m.mesa.listar(aux('aux-1'), {}, AHORA);
    expect(kpis).toEqual({
      abiertas: 7, pendientes: 5, enRevision: 2, pendientesAdres: 6, conDiscrepancias: 1, candidatos: 1, asignadosAMi: 1, misPorVencer: 0,
    });
  });

  it('«mis reservas por vencer»: las que vencen en menos de 5 minutos', async () => {
    const m = montar();
    m.registrarPersona('aux-1', 'Ana');
    await m.crear({ id: 'x', reservaPara: 'aux-1', reservaVence: new Date(AHORA.getTime() + 3 * MIN) });
    await m.crear({ id: 'y', reservaPara: 'aux-1', reservaVence: new Date(AHORA.getTime() + 12 * MIN) });
    const l = await m.mesa.listar(aux('aux-1'), {}, AHORA);
    expect(l.kpis.misPorVencer).toBe(1);
    expect((await m.mesa.listar(aux('aux-1'), { reserva: 'por_vencer' }, AHORA)).filas.map((f) => f.validacionId)).toEqual(['x']);
  });

  it('cada fila trae el estado de la reserva: libre, mía, ajena o vencida', async () => {
    const m = await escenario();
    const por = Object.fromEntries((await m.mesa.listar(aux('aux-1'), {}, AHORA)).filas.map((f) => [f.validacionId, f.reserva]));
    expect(por.viejo.estado).toBe('libre');
    expect(por.mio).toMatchObject({ estado: 'mia', responsable: 'Usted' });
    expect(por.ajeno).toMatchObject({ estado: 'ajena', responsable: 'Beto Auxiliar' });
    expect(por.vencido).toEqual({ estado: 'vencida', responsable: null, hasta: null });
  });

  it('ordena por prioridad y explica cada puntaje', async () => {
    const m = await escenario();
    const filas = (await m.mesa.listar(aux('aux-1'), {}, AHORA)).filas;
    const puntajes = filas.map((f) => f.prioridad.puntaje);
    expect(puntajes).toEqual([...puntajes].sort((a, b) => b - a));
    expect(filas[0].validacionId).toBe('viejo');
    expect(filas[0].prioridad.razones[0]).toBe('Antigüedad: 20 días (+20)');
    const orden = (await m.mesa.listar(aux('aux-1'), { orden: 'antiguedad' }, AHORA)).filas.map((f) => f.validacionId);
    expect(orden[0]).toBe('viejo');
  });

  it('el estudiante se muestra reducido: documento enmascarado, nunca completo', async () => {
    const m = await escenario();
    const filas = (await m.mesa.listar(aux('aux-1'), {}, AHORA)).filas;
    expect(filas.find((f) => f.validacionId === 'mio')?.estudiante).toEqual({ nombre: 'Marta Gómez López', documentoEnmascarado: '••••8999' });
    expect(JSON.stringify(filas)).not.toMatch(/777888999|555000111|123123123|1032456786/);
  });

  it.each([
    ['estadoAdres', { estadoAdres: 'en_consulta' }, ['adres']],
    ['responsable yo', { responsable: 'yo' }, ['mio']],
    ['soloMios', { soloMios: 'true' }, ['mio']],
    ['responsable otros', { responsable: 'otros' }, ['ajeno']],
    ['sin asignar (libres y vencidas)', { responsable: 'sin_asignar' }, ['viejo', 'adres', 'cand', 'disc', 'vencido']],
    ['decisión candidata', { decision: 'candidato_autoaprobacion' }, ['cand']],
    ['afiliación activa', { afiliacion: 'activa' }, ['cand']],
    ['autenticidad verificada', { autenticidad: 'verificada' }, ['cand']],
    ['periodo', { periodo: '2026-2' }, ['viejo', 'adres', 'cand', 'disc', 'mio', 'ajeno', 'vencido']],
    ['periodo inexistente', { periodo: '2020-1' }, []],
    ['programa', { programa: 'ADM-PRO' }, ['viejo', 'adres', 'cand', 'disc', 'mio', 'ajeno', 'vencido']],
    ['modalidad inexistente', { modalidad: 'monitoria' }, []],
    ['con discrepancias', { conDiscrepancias: 'si' }, ['disc']],
    ['recomendación', { recomendacion: 'candidato_autoaprobacion' }, ['cand']],
  ] as Array<[string, Record<string, string>, string[]]>)('filtro %s', async (_n, q, esperados) => {
    const m = await escenario();
    const ids = (await m.mesa.listar(aux('aux-1'), q, AHORA)).filas.map((f) => f.validacionId);
    expect([...ids].sort()).toEqual([...esperados].sort());
  });

  it('filtra por fecha de recepción', async () => {
    const m = await escenario();
    const desde = new Date(AHORA.getTime() - 2.5 * DIA).toISOString();
    expect((await m.mesa.listar(aux('aux-1'), { desde }, AHORA)).filas.map((f) => f.validacionId).sort()).toEqual(['cand', 'disc']);
    expect((await m.mesa.listar(aux('aux-1'), { hasta: '2026-10-07' }, AHORA)).filas.map((f) => f.validacionId)).toEqual(['viejo']);
  });

  it('busca por nombre y por documento exacto; un documento parcial no devuelve nada', async () => {
    const m = await escenario();
    expect((await m.mesa.listar(aux('aux-1'), { buscar: 'marta' }, AHORA)).filas.map((f) => f.validacionId)).toEqual(['mio']);
    expect((await m.mesa.listar(aux('aux-1'), { buscar: '555.000.111' }, AHORA)).filas.map((f) => f.validacionId)).toEqual(['disc']);
    expect((await m.mesa.listar(aux('aux-1'), { buscar: '5550001' }, AHORA)).filas).toEqual([]);
  });

  it('pagina y reporta el total y los valores de filtro disponibles', async () => {
    const m = await escenario();
    const p1 = await m.mesa.listar(aux('aux-1'), { limite: '3', pagina: '1' }, AHORA);
    const p3 = await m.mesa.listar(aux('aux-1'), { limite: '3', pagina: '3' }, AHORA);
    expect(p1).toMatchObject({ total: 7, pagina: 1, limite: 3 });
    expect(p1.filas).toHaveLength(3);
    expect(p3.filas).toHaveLength(1);
    expect(p1.filtrosDisponibles).toEqual({ periodos: ['2026-2'], programas: ['ADM-PRO'], modalidades: ['pasantia'] });
  });

  it('solo aparece la versión VIGENTE y los casos ya decididos salen de la bandeja', async () => {
    const m = await escenario();
    m.validaciones.filas.set('viejo', { ...m.fila('viejo'), decision: DecisionEps.RECHAZADO, decididoPor: 'aux-1', decididoEn: AHORA });
    const ids = (await m.mesa.listar(aux('aux-1'), {}, AHORA)).filas.map((f) => f.validacionId);
    expect(ids).not.toContain('viejo');
  });
});

// ── Tomar siguiente: concurrencia ───────────────────────────────────────────

describe('Mesa EPS · tomar siguiente', () => {
  const seis = (): Array<ReturnType<typeof aux>> => ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => aux(id));

  it('entrega el de mayor prioridad y lo reserva a nombre de quien lo pide', async () => {
    const m = montar();
    await m.crear({ id: 'poco', recibidaHace: 1 });
    await m.crear({ id: 'mucho', recibidaHace: 15 });
    const r = await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA);
    expect(r).toEqual({ estado: 'tomado', validacionId: 'mucho' });
    expect(m.fila('mucho')).toMatchObject({ asignadoA: 'f1', primeraRevisionEn: AHORA });
    expect(m.fila('mucho').reservaHasta?.getTime()).toBe(AHORA.getTime() + 15 * MIN);
    expect(m.auditoria.registros.map((x) => x.accion)).toContain(AccionAuditada.VALIDACION_EPS_ASIGNADA);
  });

  it('SEIS funcionarios a la vez con seis casos: seis casos DIFERENTES, sin duplicación', async () => {
    const m = montar();
    for (let i = 1; i <= 6; i += 1) await m.crear({ id: `c${i}`, recibidaHace: i });
    const r = await Promise.all(seis().map((a) => m.mesa.tomarSiguiente(a, {}, AHORA)));
    const ids = r.map((x) => x.validacionId);
    expect(r.every((x) => x.estado === 'tomado')).toBe(true);
    expect(new Set(ids).size).toBe(6);
    // Cada caso quedó con exactamente quien lo recibió.
    r.forEach((x, i) => expect(m.fila(x.validacionId as string).asignadoA).toBe(`f${i + 1}`));
  });

  it('seis funcionarios y solo 3 casos: 3 reciben caso y 3 reciben «sin casos disponibles»', async () => {
    const m = montar();
    for (let i = 1; i <= 3; i += 1) await m.crear({ id: `c${i}`, recibidaHace: i });
    const r = await Promise.all(seis().map((a) => m.mesa.tomarSiguiente(a, {}, AHORA)));
    expect(r.filter((x) => x.estado === 'tomado')).toHaveLength(3);
    expect(r.filter((x) => x.estado === 'sin_casos')).toHaveLength(3);
    expect(new Set(r.filter((x) => x.estado === 'tomado').map((x) => x.validacionId)).size).toBe(3);
    expect(r.find((x) => x.estado === 'sin_casos')?.mensaje).toMatch(/No hay casos disponibles/);
  });

  it('una persona que lo pide varias veces recibe casos distintos cada vez', async () => {
    const m = montar();
    for (let i = 1; i <= 3; i += 1) await m.crear({ id: `c${i}`, recibidaHace: i });
    const ids = [];
    for (let i = 0; i < 3; i += 1) ids.push((await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA)).validacionId);
    expect(new Set(ids).size).toBe(3);
    expect((await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA)).estado).toBe('sin_casos');
  });

  it('no entrega casos con reserva vigente de otra persona, pero sí con reserva vencida', async () => {
    const m = montar();
    await m.crear({ id: 'ajeno', recibidaHace: 30, reservaPara: 'f9' });
    await m.crear({ id: 'vencido', recibidaHace: 10, reservaPara: 'f9', reservaVence: new Date(AHORA.getTime() - MIN) });
    await m.crear({ id: 'libre', recibidaHace: 1 });
    expect((await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA)).validacionId).toBe('vencido');
    expect((await m.mesa.tomarSiguiente(aux('f2'), {}, AHORA)).validacionId).toBe('libre');
    expect((await m.mesa.tomarSiguiente(aux('f3'), {}, AHORA)).estado).toBe('sin_casos');
  });

  it('respeta los criterios (periodo, enfoque ADRES) y el alcance de la coordinación', async () => {
    const m = montar();
    await m.crear({ id: 'a', recibidaHace: 9, escuela: ESC_B });
    await m.crear({ id: 'b', recibidaHace: 2, adres: EstadoAdres.PENDIENTE });
    await m.crear({ id: 'c', recibidaHace: 12, adres: EstadoAdres.PROCESADO });
    expect((await m.mesa.tomarSiguiente(coord('k1'), {}, AHORA)).validacionId).toBe('c'); // 'a' es de otra escuela
    // El auxiliar ve todas las escuelas: primero 'a' (más antiguo), luego 'b'; 'c' ya tiene ADRES procesado y no entra en este enfoque.
    expect((await m.mesa.tomarSiguiente(aux('f1'), { enfoque: 'pendiente_adres' }, AHORA)).validacionId).toBe('a');
    expect((await m.mesa.tomarSiguiente(aux('f3'), { enfoque: 'pendiente_adres' }, AHORA)).validacionId).toBe('b');
    expect((await m.mesa.tomarSiguiente(aux('f4'), { enfoque: 'pendiente_adres' }, AHORA)).estado).toBe('sin_casos');
    expect((await m.mesa.tomarSiguiente(aux('f2'), { periodo: '1999-1' }, AHORA)).estado).toBe('sin_casos');
  });

  it('solo toma casos procesados y no decididos', async () => {
    const m = montar();
    await m.crear({ id: 'sin_procesar' });
    m.validaciones.filas.set('sin_procesar', { ...m.fila('sin_procesar'), estadoProcesamiento: 'pendiente' as never });
    await m.crear({ id: 'decidido' });
    m.validaciones.filas.set('decidido', { ...m.fila('decidido'), decision: DecisionEps.RECHAZADO, decididoPor: 'x', decididoEn: AHORA });
    expect((await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA)).estado).toBe('sin_casos');
  });
});

// ── Detalle ─────────────────────────────────────────────────────────────────

describe('Mesa EPS · detalle del caso', () => {
  it('sin tener el caso: no hay datos personales ni valores; con el caso tomado, sí', async () => {
    const m = montar();
    m.registrarPersona('aux-1', 'Ana');
    await m.crear({ id: 'c1', adres: EstadoAdres.PENDIENTE });
    const sin = await m.mesa.detalle('c1', aux('aux-1'), AHORA);
    expect(sin.acceso).toMatchObject({ puedeVerValores: false, puedeDecidir: false, motivoSinAcceso: expect.stringMatching(/Tome el caso/) });
    expect(sin.caso.estudiante).toEqual({ nombre: 'Laura Sofía Ramírez Ortiz', documento: null, documentoEnmascarado: '••••6786' });
    expect(sin.certificado.campos).toEqual([]);
    for (const c of sin.comparacion) expect([c.sipra, c.certificado, c.adres]).toEqual([null, null, null]);
    await m.mesa.tomarSiguiente(aux('aux-1'), {}, AHORA);
    const con = await m.mesa.detalle('c1', aux('aux-1'), AHORA);
    expect(con.acceso).toMatchObject({ puedeVerValores: true, esMia: true, puedeDecidir: true, puedeConsultarAdres: true });
    expect(con.caso.estudiante.documento).toBe(CEDULA);
    expect(con.certificado.campos.find((c) => c.campo === 'nombre_afiliado')).toMatchObject({ valor: 'LAURA SOFIA RAMIREZ ORTIZ', fuente: 'texto_nativo' });
    expect(con.certificado.campos.find((c) => c.campo === 'entidad_emisora')?.fuente).toBe('ocr');
    expect(con.certificado.metodoExtraccion).toBe('mixto');
  });

  describe('lectura del certificado: una ausencia de lectura no se presenta como un resultado', () => {
    const SINTETICO: DatosExtraidosEps = {
      tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'PERSONA FICTICIA', eps: 'EPS PRUEBA', epsClave: 'PRUEBA',
      regimen: null, tipoAfiliado: 'cotizante', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
      fuentes: { entidad_emisora: 'texto_nativo', nombre_afiliado: 'texto_nativo', documento_afiliado: 'texto_nativo', fecha_expedicion: 'texto_nativo', estado_afiliacion: 'texto_nativo', tipo_afiliado: 'texto_nativo' },
    };
    const VACIO: DatosExtraidosEps = {
      tipoDocumento: null, numeroDocumento: null, nombre: null, eps: null, epsClave: null, regimen: null, tipoAfiliado: null,
      estadoReportadoCertificado: null, fechaExpedicion: null,
    };

    it('certificado sintético con datos (PDF con texto): la Mesa los devuelve todos y la lectura es «leída»', async () => {
      const m = montar();
      await m.crear({ id: 'c1', nombre: 'Persona Ficticia', documento: '123456789' });
      m.validaciones.filas.set('c1', { ...m.fila('c1'), datosExtraidos: SINTETICO });
      const d = await m.mesa.detalle('c1', coord(), AHORA);
      expect(d.certificado.lectura).toEqual({ estado: 'leida', motivo: null });
      expect(d.certificado.metodoExtraccion).toBe('texto_nativo');
      const valor = (c: string) => d.certificado.campos.find((x) => x.campo === c)?.valor;
      expect(valor('entidad_emisora')).toBe('EPS PRUEBA');
      expect(valor('nombre_afiliado')).toBe('PERSONA FICTICIA');
      expect(valor('documento_afiliado')).toBe('CC 123456789');
      expect(valor('fecha_expedicion')).toBe('2026-10-20');
      expect(valor('estado_afiliacion')).toBe('ACTIVO');
      expect(valor('tipo_afiliado')).toBe('cotizante');
    });

    it('certificado leído por OCR: la lectura es «leída» y el método es OCR', async () => {
      const m = montar();
      await m.crear({ id: 'c1' });
      m.validaciones.filas.set('c1', { ...m.fila('c1'), datosExtraidos: { ...SINTETICO, fuentes: { entidad_emisora: 'ocr', nombre_afiliado: 'ocr', documento_afiliado: 'ocr' } } });
      const d = await m.mesa.detalle('c1', coord(), AHORA);
      expect(d.certificado.lectura.estado).toBe('leida');
      expect(d.certificado.metodoExtraccion).toBe('ocr');
    });

    it('procesado pero sin un solo dato: «sin lectura» con su causa; NO se rellena con datos de otra versión', async () => {
      const m = montar();
      await m.crear({ id: 'c1' });
      m.validaciones.filas.set('c1', { ...m.fila('c1'), datosExtraidos: VACIO });
      const d = await m.mesa.detalle('c1', coord(), AHORA);
      expect(d.certificado.lectura.estado).toBe('sin_lectura');
      expect(d.certificado.lectura.motivo).toMatch(/No se pudo leer ningún dato/);
      expect(d.certificado.metodoExtraccion).toBe('desconocido');
      expect(d.certificado.campos.every((c) => c.valor === null)).toBe(true);
    });

    it('archivo duplicado que el pipeline detuvo antes de leer: «sin lectura» y la causa lo dice', async () => {
      const m = montar();
      await m.crear({ id: 'c1' });
      m.validaciones.filas.set('c1', { ...m.fila('c1'), datosExtraidos: VACIO });
      const doc = m.documentos.filas.get('doc-c1') as DatosDocumento;
      m.documentos.filas.set('doc-c1', { ...doc, banderas: [{ codigo: 'C0_HASH_DUPLICADO', capa: 0, severidad: SeveridadBandera.CRITICA, mensaje: 'duplicado', mensajeUsuario: 'duplicado' }] });
      const d = await m.mesa.detalle('c1', coord(), AHORA);
      expect(d.certificado.lectura.estado).toBe('sin_lectura');
      expect(d.certificado.lectura.motivo).toMatch(/ya se había presentado/);
    });

    it.each([['pendiente', 'pendiente', /todavía se está procesando/], ['procesando', 'pendiente', /todavía se está procesando/], ['error', 'fallida', /falló/]])(
      'procesamiento «%s»: la lectura es «%s», no un resultado vacío', async (procesamiento, estado, motivo) => {
        const m = montar();
        await m.crear({ id: 'c1' });
        m.validaciones.filas.set('c1', { ...m.fila('c1'), estadoProcesamiento: procesamiento as never, datosExtraidos: null });
        const d = await m.mesa.detalle('c1', coord(), AHORA);
        expect(d.certificado.lectura.estado).toBe(estado);
        expect(d.certificado.lectura.motivo).toMatch(motivo);
        expect(d.acceso.puedeDecidir).toBe(false);
      },
    );
  });

  describe('documento incorrecto (clasificación por contenido)', () => {
    it('la Mesa muestra «documento incorrecto» como recomendación única, la lectura como correcta y ADRES como no aplicable', async () => {
      const m = montar();
      m.registrarPersona('aux-1', 'Ana');
      await m.crear({ id: 'c1' });
      const f = m.fila('c1');
      m.validaciones.filas.set('c1', {
        ...f, datosExtraidos: { ...(f.datosExtraidos as DatosExtraidosEps), tipoDocumentoDetectado: 'documento_incorrecto', motivosClasificacion: ['contiene_indicadores_laborales'] },
        adres: { ...f.adres, estado: EstadoAdres.NO_REQUERIDO },
      });
      await m.mesa.tomarSiguiente(aux('aux-1'), {}, AHORA);
      const d = await m.mesa.detalle('c1', aux('aux-1'), AHORA);
      expect(d.recomendacion).toMatchObject({ codigo: 'documento_incorrecto', tambien: [] });
      expect(d.discrepancias).toHaveLength(1);
      expect(d.discrepancias[0]).toMatchObject({ titulo: 'Documento incorrecto', severidad: 'critica' });
      expect(d.certificado.lectura).toEqual({ estado: 'leida', motivo: null }); // se leyó: lo incorrecto es el tipo, no la lectura
      expect(d.certificado.clasificacion).toEqual({ tipo: 'documento_incorrecto', motivos: ['contiene_indicadores_laborales'] });
      expect(d.acceso.puedeConsultarAdres).toBe(false);
      expect(d.adres.estado).toBe('no_requerido');
    });

    it('en la bandeja el caso tampoco aparece pendiente de ADRES y su recomendación es «documento incorrecto»', async () => {
      const m = montar();
      await m.crear({ id: 'c1' });
      const f = m.fila('c1');
      m.validaciones.filas.set('c1', { ...f, datosExtraidos: { ...(f.datosExtraidos as DatosExtraidosEps), tipoDocumentoDetectado: 'documento_incorrecto' }, adres: { ...f.adres, estado: EstadoAdres.NO_REQUERIDO } });
      const l = await m.mesa.listar(aux(), {}, AHORA);
      expect(l.filas[0]).toMatchObject({ recomendacion: 'documento_incorrecto', estadoAdres: 'no_requerido' });
    });

    it('no determinable NO es documento incorrecto: la lectura sigue sin lectura y la recomendación es información insuficiente', async () => {
      const m = montar();
      await m.crear({ id: 'c1' });
      const f = m.fila('c1');
      m.validaciones.filas.set('c1', {
        ...f, datosExtraidos: { tipoDocumento: null, numeroDocumento: null, nombre: null, eps: null, epsClave: null, regimen: null, tipoAfiliado: null, estadoReportadoCertificado: null, fechaExpedicion: null, tipoDocumentoDetectado: 'no_determinable' },
        adres: { ...f.adres, estado: EstadoAdres.NO_REQUERIDO },
      });
      const d = await m.mesa.detalle('c1', coord(), AHORA);
      expect(d.certificado.clasificacion.tipo).toBe('no_determinable');
      expect(d.certificado.lectura.estado).toBe('sin_lectura');
      expect(d.recomendacion.codigo).toBe('informacion_insuficiente');
    });
  });

  it('coordinación y administración ven los valores sin tomar el caso (supervisión)', async () => {
    const m = montar();
    await m.crear({ id: 'c1' });
    expect((await m.mesa.detalle('c1', coord(), AHORA)).acceso.puedeVerValores).toBe(true);
    expect((await m.mesa.detalle('c1', admin, AHORA)).acceso.puedeVerValores).toBe(true);
  });

  it('la comparación triple tiene SIPRA, certificado y ADRES por campo, y «sin información» donde falta', async () => {
    const m = montar();
    await m.crear({ id: 'c1' });
    const d = await m.mesa.detalle('c1', coord(), AHORA);
    expect(d.comparacion.map((c) => c.campo)).toEqual(['numero_documento', 'tipo_documento', 'nombre', 'eps', 'regimen', 'estado']);
    const doc = d.comparacion.find((c) => c.campo === 'numero_documento');
    expect(doc).toMatchObject({ sipra: CEDULA, certificado: CEDULA, adres: null, resultado: 'no_disponible' });
  });

  it('autenticidad: nunca dice «certificado válido» si solo coinciden los datos', async () => {
    const m = montar();
    await m.crear({ id: 'c1' });
    const a = (await m.mesa.detalle('c1', coord(), AHORA)).autenticidad;
    expect(a).toMatchObject({ estado: 'no_evaluada', metodo: 'ninguno', verificador: null, qrHallados: 0 });
    expect(a.explicacion).toMatch(/no prueba que sea auténtico/);
    expect(a.explicacion).not.toMatch(/certificado válido/i);
  });

  it('afiliación: fuente, fechas separadas y frescura sin política (nada vencido)', async () => {
    const m = montar();
    await m.crear({ id: 'c1', afiliacion: AfiliacionEps.ACTIVA });
    const f = m.fila('c1');
    m.validaciones.filas.set('c1', { ...f, adres: { ...f.adres, consultadoEn: new Date('2026-09-01T12:00:00Z'), fuenteActualizadaEn: new Date('2026-08-31T12:00:00Z') } });
    const a = (await m.mesa.detalle('c1', coord(), AHORA)).afiliacion;
    expect(a).toMatchObject({ estado: 'activa', fuente: 'adres_bdua', consultadoEn: '2026-09-01T12:00:00.000Z', fuenteActualizadaEn: '2026-08-31T12:00:00.000Z' });
    expect(a.frescura).toMatchObject({ politicaDefinida: false, dias: null, vencida: null });
    expect(a.frescura.diasDesdeConsulta).toBe(55); // 1-sep 12:00 → 26-oct 15:00: «consultada hace 55 días», sin declarar vencida
  });

  it('con un plazo de frescura configurado (futuro) lo aplica', async () => {
    const m = montar({ ADRES_FRESCURA_DIAS: 30 });
    await m.crear({ id: 'c1', afiliacion: AfiliacionEps.ACTIVA });
    const f = m.fila('c1');
    m.validaciones.filas.set('c1', { ...f, adres: { ...f.adres, consultadoEn: new Date('2026-08-01T12:00:00Z') } });
    expect((await m.mesa.detalle('c1', coord(), AHORA)).afiliacion.frescura).toEqual({ politicaDefinida: true, dias: 30, vencida: true, diasDesdeConsulta: 86 });
  });

  it('muestra la recomendación COMO recomendación (no como decisión) y las discrepancias críticas aparte', async () => {
    const m = montar();
    await m.crear({ id: 'c1', critica: true });
    const d = await m.mesa.detalle('c1', coord(), AHORA);
    expect(d.recomendacion).toMatchObject({ codigo: RecomendacionEps.DISCREPANCIA_CRITICA, esDecision: false });
    expect(d.recomendacion.explicacion).toMatch(/Revise/);
    expect(d.discrepancias.some((x) => x.severidad === 'critica')).toBe(true);
  });

  it('versiones: identifica la vigente y las anteriores; el caso viejo no es decidible', async () => {
    const m = montar();
    m.registrarPersona('aux-1', 'Ana');
    await m.crear({ id: 'v1', version: 1, practicaId: 'pra-x', estudianteId: 'est-x', recibidaHace: 8 });
    await m.crear({ id: 'v2', version: 2, practicaId: 'pra-x', estudianteId: 'est-x', recibidaHace: 1 });
    m.validaciones.filas.set('v1', { ...m.fila('v1'), asignadoA: 'aux-1', reservaHasta: new Date(AHORA.getTime() + 10 * MIN), reservadoEn: AHORA });
    const viejo = await m.mesa.detalle('v1', aux('aux-1'), AHORA);
    expect(viejo.versiones.map((v) => [v.version, v.esVigente, v.esEsta])).toEqual([[1, false, true], [2, true, false]]);
    expect(viejo.caso).toMatchObject({ esVersionVigente: false, totalVersiones: 2 });
    expect(viejo.acceso.puedeDecidir).toBe(false);
    expect(viejo.metricas.reenvios).toBe(1);
    const nuevo = await m.mesa.detalle('v2', coord(), AHORA);
    expect(nuevo.caso.esVersionVigente).toBe(true);
  });

  it('métricas de negocio y aviso de retención', async () => {
    const m = montar();
    await m.crear({ id: 'c1', recibidaHace: 2 });
    await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA);
    const d = await m.mesa.detalle('c1', coord(), AHORA);
    expect(d.metricas).toMatchObject({ recibidaEn: new Date(AHORA.getTime() - 2 * DIA).toISOString(), primeraRevisionEn: AHORA.toISOString(), decididoEn: null, horasHastaDecision: null, reenvios: 0 });
    expect(d.retencion).toBe(AVISO_RETENCION_EPS);
    expect(d.retencion).toBe('POLÍTICA DE RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL');
  });

  it('el historial muestra hechos de negocio (sin registros técnicos, tokens ni URLs)', async () => {
    const m = montar();
    m.registrarPersona('aux-1', 'Ana');
    await m.crear({ id: 'c1' });
    m.auditoria.registros.push(
      { actorId: null, actorCorreo: 'sistema', actorRol: 'sistema', accion: AccionAuditada.VALIDACION_EPS_PROCESADA, entidad: 'validacion_eps', entidadId: 'c1', justificacion: null, metadatos: { ocr: true, qrHallados: 1, token: 'SECRETO', url: 'https://x/?t=1' }, ip: '10.0.0.1', agenteUsuario: 'agente', ocurridoEn: new Date(AHORA.getTime() - 3 * MIN) },
      { actorId: 'aux-1', actorCorreo: 'aux-1@cun.edu.co', actorRol: Rol.AUXILIAR, accion: AccionAuditada.VALIDACION_EPS_ASIGNADA, entidad: 'validacion_eps', entidadId: 'c1', justificacion: null, metadatos: { metodo: 'siguiente' }, ip: '10.0.0.2', agenteUsuario: 'agente', ocurridoEn: new Date(AHORA.getTime() - 2 * MIN) },
      { actorId: null, actorCorreo: 'x', actorRol: 'sistema', accion: AccionAuditada.PARAMETRO_CAMBIADO, entidad: 'validacion_eps', entidadId: 'c1', justificacion: null, metadatos: null, ip: null, agenteUsuario: null, ocurridoEn: AHORA },
    );
    const h = (await m.mesa.detalle('c1', coord(), AHORA)).historial;
    expect(h.map((e) => e.titulo)).toEqual(['Se leyó y comparó el certificado', 'Un funcionario tomó el caso']);
    expect(h[0]).toMatchObject({ actor: 'Sistema', detalle: 'Se usó OCR. Se detectó 1 QR (no verifica autenticidad).' });
    const texto = JSON.stringify(h);
    for (const prohibido of ['SECRETO', 'https://', '10.0.0.', 'agente', 'token']) expect(texto).not.toContain(prohibido);
  });

  it('un caso inexistente o de un documento que no es el certificado de EPS: 404', async () => {
    const m = montar();
    await expect(m.mesa.detalle('no-existe', aux(), AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── Visor del certificado ───────────────────────────────────────────────────

describe('Mesa EPS · visor del certificado (contenido por sesión autenticada)', () => {
  it.each([['application/pdf'], ['image/png'], ['image/jpeg']])('entrega %s con su tipo real, y queda auditado', async (mime) => {
    const m = montar();
    await m.crear({ id: 'c1', reservaPara: 'f1', mime });
    const r = await m.mesa.certificado('c1', aux('f1'), AHORA);
    expect(r).toMatchObject({ mime, nombre: 'certificado-c1.pdf' });
    expect(r.contenido.toString()).toBe('contenido:ruta/c1');
    expect(m.auditoria.registros.find((x) => x.accion === AccionAuditada.DOCUMENTO_VISUALIZADO)).toMatchObject({ entidad: 'documento', entidadId: 'doc-c1', actorId: 'f1' });
  });

  it('sin tener el caso: 409 «tome el caso» y no se lee el archivo', async () => {
    const m = montar();
    await m.crear({ id: 'c1' });
    await expect(m.mesa.certificado('c1', aux('f1'), AHORA)).rejects.toThrow(/Tome el caso/);
    expect(m.almacen.leer).not.toHaveBeenCalled();
  });

  it('con el caso de OTRA persona: 409 para el auxiliar; supervisión sí puede', async () => {
    const m = montar();
    await m.crear({ id: 'c1', reservaPara: 'f2' });
    await expect(m.mesa.certificado('c1', aux('f1'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.certificado('c1', coord(), AHORA)).resolves.toBeDefined();
  });

  it('con la reserva vencida ya no lo ve (la pantalla no puede creer que lo controla)', async () => {
    const m = montar();
    await m.crear({ id: 'c1', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + MIN) });
    await expect(m.mesa.certificado('c1', aux('f1'), new Date(AHORA.getTime() + 2 * MIN))).rejects.toBeInstanceOf(ConflictException);
  });

  it('el archivo ya no existe en el almacén: el error no filtra la ruta', async () => {
    const m = montar();
    await m.crear({ id: 'c1', reservaPara: 'f1' });
    m.almacen.leer.mockRejectedValueOnce(new Error('NoSuchKey: ruta/c1'));
    await expect(m.mesa.certificado('c1', aux('f1'), AHORA)).rejects.toThrow();
  });

  it('un caso de otra escuela no se abre (404) ni para la coordinación', async () => {
    const m = montar();
    await m.crear({ id: 'c1', escuela: ESC_B });
    await expect(m.mesa.certificado('c1', coord(), AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('una versión anterior se puede abrir (historial) con permiso; no se mezcla con la vigente', async () => {
    const m = montar();
    await m.crear({ id: 'v1', version: 1, practicaId: 'pra-x', estudianteId: 'est-x', recibidaHace: 6 });
    await m.crear({ id: 'v2', version: 2, practicaId: 'pra-x', estudianteId: 'est-x' });
    expect((await m.mesa.certificado('v1', coord(), AHORA)).contenido.toString()).toBe('contenido:ruta/v1');
    expect((await m.mesa.certificado('v2', coord(), AHORA)).contenido.toString()).toBe('contenido:ruta/v2');
  });
});

// ── Decisiones ──────────────────────────────────────────────────────────────

describe('Mesa EPS · decisiones', () => {
  async function conCaso(cambio: Partial<OpcionesCaso> = {}, config: Record<string, unknown> = {}) {
    const m = montar(config);
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'c1', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN), ...cambio });
    return m;
  }

  it('aprobar normal: sin justificación se registra una estándar; el documento y la validación quedan aprobados', async () => {
    const m = await conCaso({ adres: EstadoAdres.PROCESADO });
    const r = await m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, AHORA);
    expect(r.estado).toBe(EstadoDocumento.APROBADO);
    expect(m.fila('c1')).toMatchObject({ decision: DecisionEps.APROBADO_MANUAL, decididoPor: 'f1' });
    expect(m.fila('c1').asignadoA).toBeNull();
    const contexto = m.auditoria.registros.find((x) => x.accion === AccionAuditada.DECISION_EPS_CONTEXTO);
    expect(contexto?.metadatos).toMatchObject({ decision: 'aprobar', apartaDeRecomendacion: false });
  });

  it('aprobar CONTRA la recomendación: exige justificación reforzada (40 caracteres) y deja constancia', async () => {
    const m = await conCaso({ critica: true });
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar', justificacion: 'Lo reviso yo, está bien' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.fila('c1').decision).toBe(DecisionEps.PENDIENTE);
    await m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar', justificacion: 'Hablé con el estudiante y el certificado es el correcto; la alerta es un error del archivo.' }, AHORA);
    expect(m.fila('c1').decision).toBe(DecisionEps.APROBADO_MANUAL);
    expect(m.auditoria.registros.find((x) => x.accion === AccionAuditada.DECISION_EPS_CONTEXTO)?.metadatos)
      .toMatchObject({ recomendacion: RecomendacionEps.DISCREPANCIA_CRITICA, apartaDeRecomendacion: true });
  });

  it('devolver: exige el motivo y el mensaje al estudiante sale del catálogo', async () => {
    const m = await conCaso();
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'devolver' }, AHORA)).rejects.toThrow(/motivo de la devolución/);
    const r = await m.mesa.decidir('c1', aux('f1'), { decision: 'devolver', motivo: MotivoDevolucionEps.VENCIDO }, AHORA);
    expect(r.estado).toBe(EstadoDocumento.DEVUELTO);
    expect(r.motivoDevolucion).toBe(MENSAJES_DEVOLUCION_EPS[MotivoDevolucionEps.VENCIDO]);
    expect(m.fila('c1').decision).toBe(DecisionEps.DEVUELTO);
  });

  it('devolver con motivo «otro»: exige explicar qué corregir', async () => {
    const m = await conCaso();
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'devolver', motivo: MotivoDevolucionEps.OTRO }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    const r = await m.mesa.decidir('c1', aux('f1'), { decision: 'devolver', motivo: MotivoDevolucionEps.OTRO, justificacion: 'Falta la firma del representante.' }, AHORA);
    expect(r.motivoDevolucion).toMatch(/Falta la firma del representante\.$/);
  });

  it('rechazar: exige justificación; rechazar un candidato exige la reforzada', async () => {
    const m = await conCaso();
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'rechazar' }, AHORA)).rejects.toThrow(/exige una justificación/);
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'rechazar', justificacion: 'no corresponde' }, AHORA)).resolves.toMatchObject({ estado: EstadoDocumento.RECHAZADO });
    const c = montar();
    c.registrarPersona('f1', 'Ana');
    await c.crear({ id: 'cand', reservaPara: 'f1', autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA });
    await expect(c.mesa.decidir('cand', aux('f1'), { decision: 'rechazar', justificacion: 'no me convence' }, AHORA)).rejects.toThrow(/aparta de la recomendación/);
  });

  it('la reserva de OTRA persona bloquea la decisión (409)', async () => {
    const m = await conCaso({ reservaPara: 'f2' });
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, AHORA)).rejects.toThrow(/otro funcionario/);
    // Ni siquiera la coordinación decide sin tener el caso tomado.
    await expect(m.mesa.decidir('c1', coord(), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(m.fila('c1').decision).toBe(DecisionEps.PENDIENTE);
  });

  it('con la reserva VENCIDA el servidor la revalida y no deja decidir', async () => {
    const m = await conCaso();
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, new Date(AHORA.getTime() + 11 * MIN))).rejects.toThrow(/reserva del caso venció/);
    expect(m.fila('c1').decision).toBe(DecisionEps.PENDIENTE);
  });

  it('sin haber tomado el caso: 409', async () => {
    const m = montar();
    await m.crear({ id: 'c1' });
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('versión anterior: no se decide (el estudiante cargó una nueva)', async () => {
    const m = montar();
    await m.crear({ id: 'v1', version: 1, practicaId: 'pra-x', estudianteId: 'est-x', recibidaHace: 8, reservaPara: 'f1' });
    await m.crear({ id: 'v2', version: 2, practicaId: 'pra-x', estudianteId: 'est-x' });
    await expect(m.mesa.decidir('v1', aux('f1'), { decision: 'aprobar' }, AHORA)).rejects.toThrow(/versión más reciente/);
  });

  it('dos decisiones a la vez sobre el mismo caso: una se aplica y la otra recibe 409', async () => {
    const m = await conCaso({ adres: EstadoAdres.PROCESADO });
    const r = await Promise.allSettled([
      m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, AHORA),
      m.mesa.decidir('c1', aux('f1'), { decision: 'devolver', motivo: MotivoDevolucionEps.ILEGIBLE }, AHORA),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(ConflictException);
  });

  it('reintentar una decisión ya tomada: 409 y nada cambia', async () => {
    const m = await conCaso();
    await m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, AHORA);
    const antes = JSON.stringify(m.fila('c1'));
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(JSON.stringify(m.fila('c1'))).toBe(antes);
  });

  it('coordinación y administración también deciden (con el caso tomado)', async () => {
    for (const actor of [coord('k1'), actorDe(Rol.ADMINISTRADOR, { id: 'k2', correo: 'k2@cun.edu.co' })]) {
      const m = montar();
      await m.crear({ id: 'c1', reservaPara: actor.id, reservaVence: new Date(AHORA.getTime() + 10 * MIN) });
      await expect(m.mesa.decidir('c1', actor, { decision: 'aprobar' }, AHORA)).resolves.toMatchObject({ estado: EstadoDocumento.APROBADO });
    }
  });

  it('el motivo de devolución desconocido no llega: la validación del DTO lo rechaza', async () => {
    const m = await conCaso();
    await expect(m.mesa.decidir('c1', aux('f1'), { decision: 'devolver', motivo: 'inventado' as MotivoDevolucionEps }, AHORA)).rejects.toThrow();
  });

  it('un caso ya decidido sale de la bandeja y el detalle conserva su historial de decisión', async () => {
    const m = await conCaso();
    await m.mesa.decidir('c1', aux('f1'), { decision: 'rechazar', justificacion: 'El certificado no corresponde al estudiante.' }, AHORA);
    expect((await m.mesa.listar(aux('f1'), {}, AHORA)).total).toBe(0);
    const d = await m.mesa.detalle('c1', aux('f1'), AHORA);
    expect(d.caso.decision).toBe(DecisionEps.RECHAZADO);
    expect(d.acceso.puedeDecidir).toBe(false);
    expect(d.historial.some((e) => e.titulo === 'Decisión sobre el certificado' && /Rechazado/.test(e.detalle ?? ''))).toBe(true);
  });
});

// ── Supervisión ─────────────────────────────────────────────────────────────

describe('Mesa EPS · supervisión', () => {
  it('muestra abiertas, sin asignar y la carga por funcionario', async () => {
    const m = montar();
    m.registrarPersona('f1', 'Ana');
    m.registrarPersona('f2', 'Beto');
    await m.crear({ id: 'a', reservaPara: 'f1' });
    await m.crear({ id: 'b', reservaPara: 'f1' });
    await m.crear({ id: 'c', reservaPara: 'f2' });
    await m.crear({ id: 'd' });
    const s = await m.mesa.supervision(coord(), AHORA);
    expect(s).toMatchObject({ abiertas: 4, sinAsignar: 1 });
    expect(s.funcionarios.map((f) => [f.nombre, f.reservasVigentes]).sort()).toEqual([['Ana', 2], ['Beto', 1]]);
  });
});

describe('Mesa EPS · interruptor de incidente (EPS_VALIDACION_HABILITADA)', () => {
  it('apagado: todas las operaciones de la Mesa responden 503 y no cambian ningún dato', async () => {
    const m = montar({ EPS_VALIDACION_HABILITADA: 'false' });
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'a' });
    const antes = JSON.stringify([...m.validaciones.filas.entries()]);
    await expect(m.mesa.listar(coord(), {}, AHORA)).rejects.toMatchObject({ status: 503 });
    await expect(m.mesa.tomarSiguiente(coord(), {}, AHORA)).rejects.toMatchObject({ status: 503 });
    await expect(m.mesa.detalle('a', coord(), AHORA)).rejects.toMatchObject({ status: 503 });
    await expect(m.mesa.decidir('a', coord(), { decision: 'aprobar' }, AHORA)).rejects.toMatchObject({ status: 503 });
    await expect(m.mesa.supervision(coord(), AHORA)).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify([...m.validaciones.filas.entries()])).toBe(antes); // apagar NO borra ni reasigna nada
  });

  it('el permiso se evalúa antes que el interruptor: un perfil sin acceso sigue recibiendo 403', async () => {
    const m = montar({ EPS_VALIDACION_HABILITADA: 'false' });
    await expect(m.mesa.listar(actorDe(Rol.ESTUDIANTE), {}, AHORA)).rejects.toMatchObject({ status: 403 });
  });

  it('reencendido (valor ausente o true) vuelve a operar con los mismos datos', async () => {
    for (const config of [{}, { EPS_VALIDACION_HABILITADA: true }, { EPS_VALIDACION_HABILITADA: 'true' }]) {
      const m = montar(config);
      await m.crear({ id: 'a' });
      expect((await m.mesa.listar(coord(), {}, AHORA)).total).toBe(1);
    }
  });
});

describe('Mesa EPS · la recomendación NO es la decisión', () => {
  async function candidato(id = 'cand') {
    const m = montar();
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id, reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN), autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA });
    return m;
  }

  it('un candidato a autoaprobación sigue PENDIENTE de una persona, por más que se liste, abra o recalcule', async () => {
    const m = await candidato();
    expect((await m.mesa.listar(aux('f1'), {}, AHORA)).kpis.candidatos).toBe(1);
    for (let i = 0; i < 3; i += 1) {
      const d = await m.mesa.detalle('cand', aux('f1'), AHORA);
      expect(d.recomendacion).toMatchObject({ codigo: RecomendacionEps.CANDIDATO_AUTOAPROBACION, esDecision: false });
    }
    expect(m.fila('cand').decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION); // solo etiqueta
    expect(m.fila('cand').decididoPor).toBeNull();
    expect(m.auditoria.registros.some((r) => r.accion === AccionAuditada.DECISION_DOCUMENTO || r.accion === AccionAuditada.DECISION_EPS_CONTEXTO)).toBe(false);
    expect(DecisionEps.APROBADO_AUTOMATICO).toBe('aprobado_automatico');
    expect(m.fila('cand').decision).not.toBe(DecisionEps.APROBADO_AUTOMATICO);
  });

  it('recomendación «candidato» → la persona DEVUELVE: se respeta, sin justificación reforzada', async () => {
    const m = await candidato();
    const r = await m.mesa.decidir('cand', aux('f1'), { decision: 'devolver', motivo: MotivoDevolucionEps.FALTA_INFORMACION }, AHORA);
    expect(r.estado).toBe(EstadoDocumento.DEVUELTO);
    expect(m.fila('cand')).toMatchObject({ decision: DecisionEps.DEVUELTO, decididoPor: 'f1' });
    expect(m.auditoria.registros.find((x) => x.accion === AccionAuditada.DECISION_EPS_CONTEXTO)?.metadatos)
      .toMatchObject({ recomendacion: RecomendacionEps.CANDIDATO_AUTOAPROBACION, decision: 'devolver', apartaDeRecomendacion: false });
  });

  it('recomendación «revisión documental» → la persona APRUEBA con justificación normal', async () => {
    const m = montar();
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'rev', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN), adres: EstadoAdres.PROCESADO, afiliacion: AfiliacionEps.ACTIVA });
    const d = await m.mesa.detalle('rev', aux('f1'), AHORA);
    expect(d.recomendacion.codigo).not.toBe(RecomendacionEps.CANDIDATO_AUTOAPROBACION);
    await m.mesa.decidir('rev', aux('f1'), { decision: 'aprobar', justificacion: 'Revisé el documento completo.' }, AHORA);
    expect(m.fila('rev').decision).toBe(DecisionEps.APROBADO_MANUAL);
  });

  it('recomendación «crítica»: aprobarla es posible SOLO con justificación reforzada y queda constancia; rechazarla no exige más', async () => {
    const m = montar();
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'crit', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN), critica: true });
    expect((await m.mesa.detalle('crit', aux('f1'), AHORA)).recomendacion.codigo).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
    await m.mesa.decidir('crit', aux('f1'), { decision: 'rechazar', justificacion: 'El documento no coincide.' }, AHORA);
    expect(m.fila('crit').decision).toBe(DecisionEps.RECHAZADO);
  });

  it('el candidato no se aprueba solo ni por el mero paso del tiempo: sin decidir(), nada cambia entre dos lecturas distantes', async () => {
    const m = await candidato();
    const antes = JSON.stringify(m.fila('cand'));
    await m.mesa.listar(aux('f1'), {}, AHORA);
    await m.mesa.listar(aux('f1'), {}, new Date(AHORA.getTime() + 30 * 24 * 3_600_000));
    expect(JSON.stringify(m.fila('cand'))).toBe(antes);
  });
});

describe('Mesa EPS · matriz de autorización por perfil (regresión Fase 6)', () => {
  const OPERADORES = new Set([Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR]);
  const SUPERVISORES = new Set([Rol.COORDINADOR, Rol.ADMINISTRADOR]);
  const actor = (rol: Rol) => actorDe(rol, { id: `${rol}-1`, correo: `${rol}@cun.edu.co`, escuelas: rol === Rol.COORDINADOR ? [ESC_A] : [] });
  const esProhibido = async (p: Promise<unknown>): Promise<boolean> => p.then(() => false, (e: unknown) => e instanceof ForbiddenException);

  it.each(Object.values(Rol))('%s: acceso a cada operación de la Mesa según su perfil', async (rol) => {
    const m = montar();
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'c1', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN) });
    const antes = JSON.stringify([...m.validaciones.filas.entries()]);
    const a = actor(rol);
    const resultados = {
      listar: await esProhibido(m.mesa.listar(a, {}, AHORA)),
      detalle: await esProhibido(m.mesa.detalle('c1', a, AHORA)),
      certificado: await esProhibido(m.mesa.certificado('c1', a, AHORA)),
      decidir: await esProhibido(m.mesa.decidir('c1', a, { decision: 'aprobar' }, AHORA)),
      siguiente: await esProhibido(m.mesa.tomarSiguiente(a, {}, AHORA)),
      supervision: await esProhibido(m.mesa.supervision(a, AHORA)),
    };
    const operaba = OPERADORES.has(rol);
    expect(resultados).toEqual({
      listar: !operaba, detalle: !operaba, certificado: !operaba, decidir: !operaba, siguiente: !operaba, supervision: !SUPERVISORES.has(rol),
    });
    if (!operaba) expect(JSON.stringify([...m.validaciones.filas.entries()])).toBe(antes); // un perfil sin acceso no cambia nada
  });

  it('IDOR: la coordinación de una escuela no alcanza un caso de OTRA por id (404 en detalle, certificado y decisión) y no lo altera', async () => {
    const m = montar();
    await m.crear({ id: 'ajeno', escuela: ESC_B });
    const antes = JSON.stringify(m.fila('ajeno'));
    await expect(m.mesa.detalle('ajeno', coord(), AHORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.mesa.certificado('ajeno', coord(), AHORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.mesa.decidir('ajeno', coord(), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    expect((await m.mesa.listar(coord(), {}, AHORA)).total).toBe(0);
    expect(JSON.stringify(m.fila('ajeno'))).toBe(antes);
  });

  it('IDOR: un id inexistente y uno ajeno responden IGUAL (no confirma qué casos existen)', async () => {
    const m = montar();
    await m.crear({ id: 'ajeno', escuela: ESC_B });
    const ajeno = await m.mesa.detalle('ajeno', coord(), AHORA).catch((e: Error) => e);
    const inexistente = await m.mesa.detalle('no-existe', coord(), AHORA).catch((e: Error) => e);
    expect(ajeno).toBeInstanceOf(NotFoundException);
    expect(inexistente).toBeInstanceOf(NotFoundException);
    expect((ajeno as Error).message).toBe((inexistente as Error).message);
  });

  it('IDOR: un funcionario que NO tiene el caso no ve valores personales ni abre el certificado, aunque conozca el id', async () => {
    const m = montar();
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'c1', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN) });
    const d = await m.mesa.detalle('c1', aux('f2'), AHORA);
    expect(d.acceso.puedeVerValores).toBe(false);
    expect(JSON.stringify(d)).not.toContain('1032456786');
    await expect(m.mesa.certificado('c1', aux('f2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Mesa EPS · bandeja con más casos que el tope (regresión Fase 6)', () => {
  it('sobre el tope: los KPI usan el total REAL, la bandeja avisa que está truncada y «tomar siguiente» alcanza todos', async () => {
    const m = montar();
    const TOPE = TOPE_LISTADO_MESA;
    for (let i = 0; i < TOPE + 25; i += 1) await m.crear({ id: `c${i}`, recibidaHace: 1 + (i % 20) });
    const l = await m.mesa.listar(aux('f1'), {}, AHORA);
    expect(l.truncado).toBe(true);
    expect(l.mostrando).toBe(TOPE);
    expect(l.kpis.abiertas).toBe(TOPE + 25); // antes de la corrección decía 2.000
    expect(l.total).toBeLessThanOrEqual(TOPE);
    const siguiente = await m.mesa.tomarSiguiente(aux('f1'), {}, AHORA);
    expect(siguiente.estado).toBe('tomado');
  });

  it('bajo el tope: no se marca truncada y el total coincide', async () => {
    const m = montar();
    for (let i = 0; i < 12; i += 1) await m.crear({ id: `c${i}` });
    const l = await m.mesa.listar(aux('f1'), {}, AHORA);
    expect(l).toMatchObject({ truncado: false, mostrando: 12, total: 12 });
    expect(l.kpis.abiertas).toBe(12);
  });
});

describe('Mesa EPS · métricas operativas (sin PII)', () => {
  const lineas = async (met: MetricasService, prefijo: string): Promise<string[]> => (await met.exponer()).split('\n').filter((l) => l.startsWith(prefijo));

  it('los gauges salen de la base en cada lectura: pendientes, ADRES, sin asignar y candidatos (modo sombra)', async () => {
    const met = new MetricasService();
    const m = montar({}, met);
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'a', adres: EstadoAdres.PENDIENTE });
    await m.crear({ id: 'b', reservaPara: 'f1', reservaVence: new Date(Date.now() + 10 * MIN) });
    await m.crear({ id: 'cand', autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA });
    m.mesa.onModuleInit();
    const texto = await met.exponer();
    expect(texto).toMatch(/^sipra_eps_pendientes_revision 3$/m);
    expect(texto).toMatch(/^sipra_eps_pendientes_adres [1-9]\d*$/m);
    expect(texto).toMatch(/^sipra_eps_candidatos_autoaprobacion 1$/m); // se mide; NO se aprueba
    expect(texto).toMatch(/^sipra_eps_procesamiento_atascado 0$/m);
    expect(m.fila('cand').decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION);
  });

  it('cada decisión cuenta (con o sin apartarse de la recomendación) y mide el tiempo hasta decidir', async () => {
    const met = new MetricasService();
    const m = montar({}, met);
    m.registrarPersona('f1', 'Ana');
    await m.crear({ id: 'a', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN), recibidaHace: 3 });
    await m.mesa.decidir('a', aux('f1'), { decision: 'devolver', motivo: MotivoDevolucionEps.FALTA_INFORMACION }, AHORA);
    const decisiones = await lineas(met, 'sipra_eps_decisiones_total');
    expect(decisiones).toEqual(['sipra_eps_decisiones_total{decision="devolver",aparta_de_recomendacion="false"} 1']);
    expect((await lineas(met, 'sipra_eps_tiempo_revision_horas_count'))[0]).toMatch(/ 1$/);
  });

  it('ninguna métrica EPS lleva datos personales: solo etiquetas de una lista acotada y valores numéricos', async () => {
    const met = new MetricasService();
    const m = montar({}, met);
    m.registrarPersona('f1', 'Ana Persona');
    await m.crear({ id: 'a', reservaPara: 'f1', reservaVence: new Date(AHORA.getTime() + 10 * MIN), nombre: 'PERSONAPRUEBAEPS', documento: '9990001112' });
    m.mesa.onModuleInit();
    await m.mesa.decidir('a', aux('f1'), { decision: 'aprobar' }, AHORA);
    const eps = (await met.exponer()).split('\n').filter((l) => l.startsWith('sipra_eps_'));
    expect(eps.length).toBeGreaterThan(8);
    const texto = eps.join('\n');
    for (const s of ['PERSONAPRUEBAEPS', '9990001112', 'Ana Persona', 'f1', 'a@', '@cun']) expect(texto).not.toContain(s);
    const etiquetas = new Set(eps.flatMap((l) => [...l.matchAll(/(\w+)="/g)].map((x) => x[1])));
    expect([...etiquetas].every((e) => ['decision', 'aparta_de_recomendacion', 'ruta', 'ocr', 'le'].includes(e))).toBe(true);
  });
});
