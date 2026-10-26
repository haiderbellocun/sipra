import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { DURACION_RESERVA_EPS_MS, ValidacionEpsUseCase } from '../src/application/use-cases/documentos/validacion-eps.use-case';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import {
  DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import { DatosEvidenciaEps, EvidenciaEps, TipoEvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosValidacionEps, DecisionEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { ValidacionEpsRepositoryPort } from '../src/domain/ports/out/validacion-eps.port';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ESC_A, actorDe, documentoDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';

/**
 * Caso de uso de validación de EPS con repositorios en memoria. Las operaciones
 * atómicas (crear si no existe, versión, reserva) emulan la semántica de la
 * sentencia SQL; la prueba contra PostgreSQL está en
 * `herramientas/verificar-concurrencia-pg.ts`.
 */

const AHORA = new Date('2026-10-26T15:00:00Z');
const CEDULA = '1032456786';
const NOMBRE = 'Laura Sofía Ramírez Ortiz';

class ValidacionesEnMemoria implements ValidacionEpsRepositoryPort {
  filas = new Map<string, DatosValidacionEps>();
  evidencias: DatosEvidenciaEps[] = [];
  buscarPorId(id: string) {
    const d = this.filas.get(id);
    return Promise.resolve(d ? ValidacionEps.desde({ ...d }) : null);
  }
  buscarPorDocumento(documentoId: string) {
    const d = [...this.filas.values()].find((f) => f.documentoId === documentoId);
    return Promise.resolve(d ? ValidacionEps.desde({ ...d }) : null);
  }
  crearSiNoExiste(datos: DatosValidacionEps) {
    const existente = [...this.filas.values()].find((f) => f.documentoId === datos.documentoId);
    if (existente) return Promise.resolve({ validacion: ValidacionEps.desde({ ...existente }), creada: false });
    this.filas.set(datos.id, { ...datos });
    return Promise.resolve({ validacion: ValidacionEps.desde({ ...datos }), creada: true });
  }
  guardarSiVersion(datos: DatosValidacionEps, versionEsperada: number) {
    const actual = this.filas.get(datos.id);
    if (!actual || actual.version !== versionEsperada) return Promise.resolve(false);
    this.filas.set(datos.id, { ...datos, version: versionEsperada + 1 });
    return Promise.resolve(true);
  }
  reservar(id: string, actorId: string, ahora: Date, hasta: Date) {
    const f = this.filas.get(id);
    if (!f || [DecisionEps.APROBADO_MANUAL, DecisionEps.DEVUELTO, DecisionEps.RECHAZADO].includes(f.decision)) {
      return Promise.resolve(false);
    }
    const ajena = f.asignadoA && f.asignadoA !== actorId && f.reservaHasta && f.reservaHasta > ahora;
    if (ajena) return Promise.resolve(false);
    this.filas.set(id, { ...f, asignadoA: actorId, reservadoEn: ahora, reservaHasta: hasta, version: f.version + 1 });
    return Promise.resolve(true);
  }
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean) {
    const f = this.filas.get(id);
    if (!f || !f.asignadoA) return Promise.resolve(false);
    const vencida = !f.reservaHasta || f.reservaHasta <= ahora;
    if (!(f.asignadoA === actorId || esSupervisor || vencida)) return Promise.resolve(false);
    this.filas.set(id, { ...f, asignadoA: null, reservadoEn: null, reservaHasta: null, version: f.version + 1 });
    return Promise.resolve(true);
  }
  agregarEvidencia(datos: DatosEvidenciaEps) {
    this.evidencias.push(datos);
    return Promise.resolve(EvidenciaEps.desde(datos));
  }
  listarEvidencias(id: string) {
    return Promise.resolve(this.evidencias.filter((e) => e.validacionEpsId === id).map((e) => EvidenciaEps.desde(e)));
  }
}

const CAMPOS = {
  documento_afiliado: { valor: `CC ${CEDULA}`, confianza: 0.95 },
  nombre_afiliado: { valor: 'LAURA SOFIA RAMIREZ ORTIZ', confianza: 0.95 },
  entidad_emisora: { valor: 'Nueva EPS S.A.', confianza: 0.95 },
  regimen: { valor: 'Contributivo - Beneficiario', confianza: 0.95 },
  estado_afiliacion: { valor: 'ACTIVO', confianza: 0.95 },
  fecha_expedicion: { valor: '2026-10-20', confianza: 0.95 },
};

function epsEnRevision(extra: Partial<DatosDocumento> = {}): Documento {
  return documentoDe(TipoDocumento.CERTIFICADO_EPS, {
    id: 'doc-eps', estado: EstadoDocumento.EN_REVISION, extraccion: { campos: CAMPOS }, ...extra,
  });
}

function montar(documento: Documento = epsEnRevision()) {
  let almacenado: DatosDocumento = documento.instantanea();
  const validaciones = new ValidacionesEnMemoria();
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const estudiante = usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1', documento: CEDULA, nombre: NOMBRE });
  const practicas = { buscarPorId: jest.fn().mockResolvedValue(practicaDe()) };
  const usuarios = { buscarPorId: jest.fn().mockResolvedValue(estudiante) };
  const documentos = {
    buscarPorId: jest.fn(() => Promise.resolve(Documento.desde(almacenado))),
    guardar: jest.fn(),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
  };
  const parametros = new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve(),
  });
  const eps = new ValidacionEpsUseCase(
    validaciones, documentos as never, practicas as never, usuarios as never, auditoria as never, parametros,
  );
  const gestionar = new GestionarDocumentoUseCase(
    documentos as never, practicas as never, usuarios as never, auditoria as never,
    {} as never, { notificar: jest.fn() } as never, {} as never, {} as never, {} as never,
    { anotarDevolucion: jest.fn() } as never, {} as never, {} as never, {} as never, eps,
  );
  return { eps, gestionar, validaciones, auditoria, documentos, actual: () => almacenado };
}

const auxiliar = (id = 'aux-1') => actorDe(Rol.AUXILIAR, { id });
const coordinador = actorDe(Rol.COORDINADOR, { escuelas: [ESC_A] });

describe('ValidacionEps · procesamiento local', () => {
  it('no hace nada con documentos que no son certificado de EPS ni con los aún sin procesar', async () => {
    const { eps, validaciones } = montar();
    expect(await eps.registrarProcesamiento(documentoDe(TipoDocumento.CEDULA), AHORA)).toBeNull();
    expect(await eps.registrarProcesamiento(epsEnRevision({ estado: EstadoDocumento.ANALIZANDO }), AHORA)).toBeNull();
    expect(validaciones.filas.size).toBe(0);
  });

  it('crea la validación, compara con el estudiante y deja la ruta en revisión manual', async () => {
    const { eps, validaciones } = montar();
    const v = await eps.registrarProcesamiento(epsEnRevision(), AHORA);
    expect(v?.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(v?.autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
    expect(v?.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v?.decision).toBe(DecisionEps.PENDIENTE);
    expect(validaciones.filas.size).toBe(1);
  });

  it('es idempotente: repetirlo no duplica validación, evidencia ni auditoría', async () => {
    const { eps, validaciones, auditoria } = montar();
    for (let i = 0; i < 3; i += 1) await eps.registrarProcesamiento(epsEnRevision(), AHORA);
    expect(validaciones.filas.size).toBe(1);
    expect(validaciones.evidencias).toHaveLength(1);
    const acciones = accionesDe(auditoria);
    expect(acciones.filter((a) => a === String(AccionAuditada.VALIDACION_EPS_PROCESADA))).toHaveLength(1);
    expect(acciones.filter((a) => a === String(AccionAuditada.EVIDENCIA_EPS_REGISTRADA))).toHaveLength(1);
  });

  it('dos procesamientos simultáneos dejan UNA validación y UNA evidencia', async () => {
    const { eps, validaciones } = montar();
    await Promise.all([eps.registrarProcesamiento(epsEnRevision(), AHORA), eps.registrarProcesamiento(epsEnRevision(), AHORA)]);
    expect(validaciones.filas.size).toBe(1);
    expect(validaciones.evidencias).toHaveLength(1);
  });

  it('un reintento tardío NO sobrescribe la decisión humana de la validación', async () => {
    const { eps, validaciones } = montar();
    await eps.registrarProcesamiento(epsEnRevision(), AHORA);
    const id = [...validaciones.filas.keys()][0];
    validaciones.filas.set(id, {
      ...validaciones.filas.get(id)!, decision: DecisionEps.RECHAZADO, decididoPor: 'aux-1', decididoEn: AHORA,
      estadoProcesamiento: 'pendiente' as never,
    });
    const antes = JSON.stringify(validaciones.filas.get(id));
    await eps.registrarProcesamiento(epsEnRevision(), AHORA);
    expect(JSON.stringify(validaciones.filas.get(id))).toBe(antes);
  });

  it('la auditoría y las evidencias no llevan cédula, nombre ni contenido del certificado', async () => {
    const { eps, validaciones, auditoria } = montar();
    await eps.registrarProcesamiento(epsEnRevision(), AHORA);
    const salida = JSON.stringify([auditoria.registrar.mock.calls, validaciones.evidencias]);
    for (const secreto of [CEDULA, 'RAMIREZ', 'Ramírez', 'Nueva EPS']) expect(salida).not.toContain(secreto);
    expect(validaciones.evidencias[0].tipo).toBe(TipoEvidenciaEps.TEXTO_PDF);
  });
});

describe('ValidacionEps · consulta y autorización', () => {
  async function conValidacion() {
    const m = montar();
    const v = await m.eps.registrarProcesamiento(epsEnRevision(), AHORA);
    return { ...m, id: v!.id };
  }

  it('el estudiante recibe solo el resultado reducido, sin ejes, datos ni discrepancias', async () => {
    const { eps } = await conValidacion();
    const r = await eps.consultarPorDocumento('doc-eps', actorDe(Rol.ESTUDIANTE, { id: 'estudiante-1' }));
    expect(Object.keys(r).sort()).toEqual(['documentoId', 'estadoProcesamiento', 'resultado']);
    expect((r as { resultado: string }).resultado).toBe('pendiente');
  });

  it('otro estudiante no ve la de un tercero (404 genérico)', async () => {
    const { eps } = await conValidacion();
    await expect(eps.consultarPorDocumento('doc-eps', actorDe(Rol.ESTUDIANTE, { id: 'otro' })))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([Rol.EMPRESA, Rol.EXTENSION, Rol.TUTOR])('%s no consulta ni opera la validación de EPS', async (rol) => {
    const { eps, id } = await conValidacion();
    const actor = actorDe(rol);
    await expect(eps.consultarPorDocumento('doc-eps', actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(eps.evidencias(id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(eps.reservar(id, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el estudiante no ve la evidencia interna ni reserva', async () => {
    const { eps, id } = await conValidacion();
    const actor = actorDe(Rol.ESTUDIANTE, { id: 'estudiante-1' });
    await expect(eps.evidencias(id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(eps.reservar(id, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('auxiliar y coordinación ven el detalle y la evidencia', async () => {
    const { eps, id } = await conValidacion();
    const detalle = await eps.consultarPorDocumento('doc-eps', auxiliar());
    expect(detalle).toMatchObject({ coincidencia: CoincidenciaEps.COINCIDE, afiliacion: AfiliacionEps.NO_CONTRASTADA });
    expect(await eps.evidencias(id, coordinador)).toHaveLength(1);
  });

  it('un documento que no es certificado de EPS no se consulta por esta vía', async () => {
    const { eps } = await conValidacion();
    await expect(eps.consultarPorDocumento('doc-inexistente', auxiliar())).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ValidacionEps · reserva y concurrencia', () => {
  async function conValidacion() {
    const m = montar();
    const v = await m.eps.registrarProcesamiento(epsEnRevision(), AHORA);
    return { ...m, id: v!.id };
  }

  it('una sola reserva por caso: de dos funcionarios simultáneos gana uno y el otro recibe 409', async () => {
    const { eps, id } = await conValidacion();
    const resultados = await Promise.allSettled([
      eps.reservar(id, auxiliar('aux-1'), AHORA), eps.reservar(id, auxiliar('aux-2'), AHORA),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(ConflictException);
  });

  it('quien reservó puede renovarla; la reserva queda auditada', async () => {
    const { eps, id, auditoria } = await conValidacion();
    await eps.reservar(id, auxiliar('aux-1'), AHORA);
    const r = await eps.reservar(id, auxiliar('aux-1'), new Date(AHORA.getTime() + 60_000));
    expect(r.asignadoA).toBe('aux-1');
    expect(accionesDe(auditoria)).toContain(AccionAuditada.VALIDACION_EPS_ASIGNADA);
  });

  it('la reserva vence sola: tras el plazo otro funcionario puede tomar el caso', async () => {
    const { eps, id } = await conValidacion();
    await eps.reservar(id, auxiliar('aux-1'), AHORA);
    const tarde = new Date(AHORA.getTime() + DURACION_RESERVA_EPS_MS + 1);
    expect((await eps.reservar(id, auxiliar('aux-2'), tarde)).asignadoA).toBe('aux-2');
  });

  it('liberar: ajeno no (409), supervisor sí; queda auditado', async () => {
    const { eps, id, auditoria } = await conValidacion();
    await eps.reservar(id, auxiliar('aux-1'), AHORA);
    await expect(eps.liberar(id, auxiliar('aux-2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect((await eps.liberar(id, coordinador, AHORA)).asignadoA).toBeNull();
    expect(accionesDe(auditoria)).toContain(AccionAuditada.VALIDACION_EPS_LIBERADA);
  });

  it('un caso ya decidido no se reserva', async () => {
    const { eps, id, gestionar } = await conValidacion();
    await gestionar.decidir('doc-eps', { decision: 'aprobar', justificacion: 'Verificado manualmente' }, auxiliar());
    await expect(eps.reservar(id, auxiliar('aux-2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Decisión sobre el certificado de EPS', () => {
  async function listo(documento: Documento = epsEnRevision()) {
    const m = montar(documento);
    await m.eps.registrarProcesamiento(documento, AHORA);
    return m;
  }
  const aprobar = { decision: 'aprobar', justificacion: 'Verificado manualmente' } as const;

  it('el auxiliar decide el certificado de EPS: el documento y la validación quedan sincronizados', async () => {
    const { gestionar, validaciones, actual } = await listo();
    await gestionar.decidir('doc-eps', aprobar, auxiliar());
    expect(actual().estado).toBe(EstadoDocumento.APROBADO);
    const v = [...validaciones.filas.values()][0];
    expect(v).toMatchObject({ decision: DecisionEps.APROBADO_MANUAL, decididoPor: 'aux-1' });
    expect(validaciones.evidencias.map((e) => e.tipo)).toContain(TipoEvidenciaEps.REVISION_HUMANA);
  });

  it('aprobar manualmente NO convierte la afiliación en activa ni la autenticidad en verificada', async () => {
    const { gestionar, validaciones } = await listo();
    await gestionar.decidir('doc-eps', aprobar, auxiliar());
    const v = [...validaciones.filas.values()][0];
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v.autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
  });

  it.each([TipoDocumento.CEDULA, TipoDocumento.CERTIFICADO_ARL, TipoDocumento.RUT_NATURAL])(
    'el auxiliar NO decide %s (documento de su proceso, pero sin capacidad genérica)', async (tipo) => {
      const doc = documentoDe(tipo, { id: 'doc-x', estado: EstadoDocumento.EN_REVISION });
      const { gestionar, actual } = montar(doc);
      await expect(gestionar.decidir('doc-x', aprobar, auxiliar())).rejects.toBeInstanceOf(ForbiddenException);
      expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    },
  );

  it.each([TipoDocumento.PLANILLA_HORAS, TipoDocumento.PLAN_MEJORAMIENTO, TipoDocumento.CARTA_FINALIZACION])(
    'el auxiliar ni siquiera ve %s: 404 y sin cambios', async (tipo) => {
      const doc = documentoDe(tipo, { id: 'doc-x', estado: EstadoDocumento.EN_REVISION });
      const { gestionar, actual } = montar(doc);
      await expect(gestionar.decidir('doc-x', aprobar, auxiliar())).rejects.toBeInstanceOf(NotFoundException);
      expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    },
  );

  it.each([Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION])('%s no decide documentos', async (rol) => {
    const { gestionar } = await listo();
    await expect(gestionar.decidir('doc-eps', aprobar, actorDe(rol, { id: 'estudiante-1' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dos funcionarios deciden a la vez: una decisión se aplica y la otra recibe 409', async () => {
    const { gestionar, actual } = await listo();
    const resultados = await Promise.allSettled([
      gestionar.decidir('doc-eps', aprobar, auxiliar('aux-1')),
      gestionar.decidir('doc-eps', { decision: 'rechazar', justificacion: 'No corresponde' }, coordinador),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(ConflictException);
    expect([EstadoDocumento.APROBADO, EstadoDocumento.RECHAZADO]).toContain(actual().estado);
  });

  it('decidir de nuevo un documento ya decidido es 409 y no cambia nada', async () => {
    const { gestionar, actual } = await listo();
    await gestionar.decidir('doc-eps', aprobar, auxiliar());
    await expect(gestionar.decidir('doc-eps', { decision: 'rechazar', justificacion: 'Otra' }, coordinador))
      .rejects.toBeInstanceOf(ConflictException);
    expect(actual().estado).toBe(EstadoDocumento.APROBADO);
  });

  it('un caso reservado por otro funcionario no se decide por encima (409)', async () => {
    const { gestionar, eps, validaciones, actual } = await listo();
    const id = [...validaciones.filas.keys()][0];
    await eps.reservar(id, auxiliar('aux-1'));
    await expect(gestionar.decidir('doc-eps', aprobar, auxiliar('aux-2'))).rejects.toBeInstanceOf(ConflictException);
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    await gestionar.decidir('doc-eps', aprobar, auxiliar('aux-1'));
    expect(actual().estado).toBe(EstadoDocumento.APROBADO);
  });

  it('un reintento de Cloud Tasks después de la decisión humana no cambia la validación', async () => {
    const { eps, gestionar, validaciones, actual } = await listo();
    await gestionar.decidir('doc-eps', aprobar, auxiliar());
    const antes = JSON.stringify([...validaciones.filas.values()]);
    await eps.registrarProcesamiento(Documento.desde(actual()), new Date(AHORA.getTime() + 600_000));
    expect(JSON.stringify([...validaciones.filas.values()])).toBe(antes);
    expect(validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaEps.TEXTO_PDF)).toHaveLength(1);
  });

  it('la decisión queda auditada en el documento y en la validación, sin datos personales', async () => {
    const { gestionar, auditoria } = await listo();
    await gestionar.decidir('doc-eps', aprobar, auxiliar());
    const acciones = accionesDe(auditoria);
    expect(acciones).toEqual(expect.arrayContaining([AccionAuditada.DECISION_DOCUMENTO, AccionAuditada.DECISION_EPS]));
    expect(JSON.stringify(auditoria.registrar.mock.calls)).not.toContain(CEDULA);
  });
});

function accionesDe(auditoria: { registrar: jest.Mock }): string[] {
  return (auditoria.registrar.mock.calls as Array<[{ accion: string }]>).map((c) => c[0].accion);
}
