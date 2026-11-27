import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { ValidacionEpsUseCase } from '../src/application/use-cases/documentos/validacion-eps.use-case';
import { PipelineValidacionUseCase } from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import {
  DatosDocumento, Documento, DocumentoResueltoAutomaticamenteError, DocumentoYaDecididoError, ESTADOS_DECIDIDOS,
  ESTADOS_RESUELTOS_AUTOMATICAMENTE, EstadoDocumento, TIPOS_CON_DECISION_ESPECIALIZADA, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { AvanceDocumentalDomainService } from '../src/domain/services/avance-documental.domain-service';
import { faseEmpresarial, faseEps } from '../src/domain/services/senales-motores-documentales.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ValidacionEpsRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-eps.adapter';
import { ValidacionDocumentoEmpresarialRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-documento-empresarial.adapter';
import { actorDe, documentoDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import { AHORA_CAMARA, montarMesaCamara, tutorCamara } from './soporte-mesa-camara';
import { AHORA_RUT, montarMesaRut, tutor } from './soporte-mesa-rut';
import { ValidacionesEnMemoria } from './soporte-validacion-eps';

/**
 * Cierre de 1.6A · consistencia operacional entre el DOCUMENTO (fuente de verdad de la resolución automática) y las validaciones
 * auxiliares de EPS, RUT y Cámara, que conservan su estado interno (`pendiente`/`revision`) como evidencia histórica.
 * Casos de uso REALES con repositorios en memoria; SQL real de los adaptadores con un `query` simulado. Datos sintéticos.
 */

const AUTO = [EstadoDocumento.AUTO_APROBADO, EstadoDocumento.AUTO_DEVUELTO] as const;

describe('Semántica de la resolución automática (Documento)', () => {
  const doc = (tipo: TipoDocumento, estado: EstadoDocumento) => documentoDe(tipo, { id: 'd', estado });

  it('4. auto_devuelto no lleva actor y no es una decisión humana; es una resolución automática separada', () => {
    const d = doc(TipoDocumento.CERTIFICADO_EPS, EstadoDocumento.EN_REVISION);
    d.aplicarAutoDevolucion('Mensaje genérico.');
    expect(d.instantanea().decididoPor).toBeNull();
    expect(ESTADOS_DECIDIDOS).not.toContain(EstadoDocumento.AUTO_DEVUELTO);
    expect(ESTADOS_RESUELTOS_AUTOMATICAMENTE).toEqual([EstadoDocumento.AUTO_APROBADO, EstadoDocumento.AUTO_DEVUELTO]);
  });

  it('7. la decisión humana ORDINARIA sobre auto_devuelto está bloqueada (cualquier tipo)', () => {
    for (const tipo of [TipoDocumento.CERTIFICADO_EPS, TipoDocumento.RUT_NATURAL, TipoDocumento.CEDULA]) {
      const d = doc(tipo, EstadoDocumento.AUTO_DEVUELTO);
      expect(() => d.aprobar('u', 'justificación')).toThrow(DocumentoResueltoAutomaticamenteError);
      expect(() => d.rechazar('u', 'justificación')).toThrow(DocumentoResueltoAutomaticamenteError);
      expect(() => d.devolver('mensaje', 'u')).toThrow(DocumentoResueltoAutomaticamenteError);
      expect(d.estado).toBe(EstadoDocumento.AUTO_DEVUELTO);
    }
  });

  it('8. auto_aprobado de un tipo ESPECIALIZADO bloquea la decisión ordinaria; el auto_aprobado genérico conserva su reversión existente', () => {
    for (const tipo of TIPOS_CON_DECISION_ESPECIALIZADA) {
      const d = doc(tipo, EstadoDocumento.AUTO_APROBADO);
      expect(() => d.rechazar('u', 'justificación')).toThrow(DocumentoResueltoAutomaticamenteError);
      expect(() => d.devolver('mensaje', 'u')).toThrow(DocumentoResueltoAutomaticamenteError);
    }
    // Mecanismo existente y probado (idempotencia-pipeline.spec): una cédula aprobada por banda verde la puede revertir una persona.
    const cedula = doc(TipoDocumento.CEDULA, EstadoDocumento.AUTO_APROBADO);
    cedula.rechazar('u', 'no corresponde');
    expect(cedula.estado).toBe(EstadoDocumento.RECHAZADO);
  });

  it('la decisión humana previa sigue bloqueada como antes (DocumentoYaDecididoError)', () => {
    expect(() => doc(TipoDocumento.CEDULA, EstadoDocumento.APROBADO).rechazar('u', 'x')).toThrow(DocumentoYaDecididoError);
  });

  it('5. el pipeline NO reprocesa una versión resuelta automáticamente', async () => {
    for (const estado of AUTO) {
      let almacenado: DatosDocumento = documentoDe(TipoDocumento.CERTIFICADO_EPS, { id: 'doc-1', estado }).instantanea();
      const pipeline = new PipelineValidacionUseCase(
        { buscarPorId: () => Promise.resolve(Documento.desde(almacenado)), ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }) } as never,
        {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      );
      const r = await pipeline.procesar('doc-1');
      expect(r.ejecutado).toBe(false);
      expect(almacenado.estado).toBe(estado);
    }
  });

  it('13/14/15. conteo: auto_devuelto no es aprobado ni rechazo (exige reenvío); auto_aprobado sí cuenta como aprobado', () => {
    const avance = new AvanceDocumentalDomainService();
    const devuelto = avance.calcular(ModalidadPractica.MONITORIA, [{ tipo: TipoDocumento.CERTIFICADO_EPS, version: 1, estado: EstadoDocumento.AUTO_DEVUELTO }]);
    expect(devuelto.cargados).toBe(0);
    expect(devuelto.aprobados).toBe(0);
    const aprobado = avance.calcular(ModalidadPractica.MONITORIA, [{ tipo: TipoDocumento.CERTIFICADO_EPS, version: 1, estado: EstadoDocumento.AUTO_APROBADO }]);
    expect(aprobado.aprobados).toBe(1);
    expect(faseEps(EstadoDocumento.AUTO_DEVUELTO, null)).toBe('devuelto');
    expect(faseEmpresarial(EstadoDocumento.AUTO_DEVUELTO, null)).not.toBe('rechazado');
    expect(faseEmpresarial(EstadoDocumento.AUTO_APROBADO, null)).toBe('aprobado');
  });
});

// ── EPS ─────────────────────────────────────────────────────────────────────

function montarEps(estado: EstadoDocumento) {
  let almacenado: DatosDocumento = documentoDe(TipoDocumento.CERTIFICADO_EPS, {
    id: 'doc-eps', estado: EstadoDocumento.EN_REVISION,
    extraccion: { campos: { documento_afiliado: { valor: 'CC 1032456786', confianza: 0.95 }, nombre_afiliado: { valor: 'LAURA SINTETICA', confianza: 0.95 } } },
  }).instantanea();
  const validaciones = new ValidacionesEnMemoria();
  const documentos = {
    buscarPorId: jest.fn(() => Promise.resolve(Documento.desde(almacenado))), guardar: jest.fn(),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
  };
  const practicas = { buscarPorId: jest.fn().mockResolvedValue(practicaDe()) };
  const usuarios = { buscarPorId: jest.fn().mockResolvedValue(usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1', documento: '1032456786', nombre: 'Laura Sintetica' })) };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const parametros = new ParametrosUseCase({ listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve() });
  const eps = new ValidacionEpsUseCase(validaciones, documentos as never, practicas as never, usuarios as never, auditoria as never, parametros);
  const gestionar = new GestionarDocumentoUseCase(
    documentos as never, practicas as never, usuarios as never, auditoria as never, {} as never, { notificar: jest.fn() } as never,
    {} as never, {} as never, {} as never, { anotarDevolucion: jest.fn() } as never, {} as never, {} as never, {} as never, eps,
  );
  return {
    eps, gestionar, validaciones,
    resolver: () => { almacenado = { ...almacenado, estado }; },
    estado: () => almacenado.estado,
  };
}

const auxiliar = actorDe(Rol.AUXILIAR, { id: 'aux-1' });

describe('Consistencia Documento / EPS', () => {
  it.each(AUTO)('9/10. %s: la validación conserva su estado, pero no se reserva ni se decide por el flujo ordinario', async (estado) => {
    const m = montarEps(estado);
    const v = await m.eps.registrarProcesamiento(Documento.desde({ ...documentoDe(TipoDocumento.CERTIFICADO_EPS, { id: 'doc-eps', estado: EstadoDocumento.EN_REVISION, extraccion: { campos: {} } }).instantanea() }));
    expect(v).not.toBeNull();
    m.resolver();
    await expect(m.eps.reservar(v!.id, auxiliar)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.gestionar.decidir('doc-eps', { decision: 'aprobar', justificacion: 'Verificado manualmente' }, auxiliar)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.gestionar.decidir('doc-eps', { decision: 'rechazar', justificacion: 'No corresponde al estudiante' }, auxiliar)).rejects.toBeInstanceOf(ConflictException);
    expect(m.estado()).toBe(estado);
  });

  it('9. la cola, el «tomar siguiente» y los KPI de EPS solo ven documentos recibido/analizando/en_revision (excluye auto_*)', async () => {
    const consultas: string[] = [];
    const repo = { query: (sql: string) => { consultas.push(sql); return Promise.resolve([{}]); } } as unknown as Repository<never>;
    const adaptador = new ValidacionEpsRepositoryAdapter(repo as never, repo as never);
    await adaptador.listarAbiertasMesa(new Date(), null).catch(() => undefined);
    await adaptador.resumenMetricasEps(new Date()).catch(() => undefined);
    await adaptador.tomarSiguiente?.('aux-1', new Date(), new Date(Date.now() + 1), {} as never).catch(() => undefined);
    expect(consultas.length).toBeGreaterThan(0);
    // Las consultas de COLA/KPI unen documentos; la métrica de salud del procesamiento (atascados/con error) no es una cola.
    const deCola = consultas.filter((s) => /JOIN documentos d/.test(s));
    expect(deCola.length).toBeGreaterThan(0);
    for (const sql of deCola) {
      expect(sql.replace(/\s+/g, ' ')).toContain("d.estado IN ('recibido','analizando','en_revision')");
    }
  });
});

// ── RUT y Cámara ────────────────────────────────────────────────────────────

describe('Consistencia Documento / RUT', () => {
  it.each(AUTO)('11. %s: fuera de la bandeja pendiente, no se toma, y el estudiante ve el resultado', async (estado) => {
    const m = montarMesaRut();
    const c = await m.crear({ id: 'x', estadoDocumento: estado });
    const bandeja = await m.mesa.listar(tutor(), {}, AHORA_RUT);
    expect(bandeja.items.map((i) => i.validacionId)).not.toContain(c.validacionId);
    await expect(m.mesa.tomar(c.validacionId as string, tutor(), AHORA_RUT)).rejects.toBeInstanceOf(ConflictException);
    const vista = await m.estudiante.estado(c.practicaId, actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }));
    if (estado === EstadoDocumento.AUTO_APROBADO) expect(vista.estado).toBe('aprobado');
    else expect(vista).toMatchObject({ estado: 'necesita_correccion', puedeReenviar: true });
  });

  it('11. si el documento quedó resuelto automáticamente mientras alguien lo tenía tomado, la decisión ordinaria se bloquea', async () => {
    const m = montarMesaRut();
    const c = await m.crear({ id: 'y' });
    await m.mesa.tomar(c.validacionId as string, tutor(), AHORA_RUT);
    const fila = m.documentos.filas.get(c.documentoId)!;
    m.documentos.filas.set(c.documentoId, { ...fila, estado: EstadoDocumento.AUTO_DEVUELTO });
    await expect(m.mesa.decidir(c.validacionId as string, tutor(), { decision: 'aprobar', justificacion: 'Se verificó el RUT original contra los datos.' }, AHORA_RUT)).rejects.toBeTruthy();
    expect(m.documentos.filas.get(c.documentoId)!.estado).toBe(EstadoDocumento.AUTO_DEVUELTO);
  });

  it('la cola y la supervisión SQL de RUT/Cámara excluyen documentos auto-resueltos sin decisión humana', async () => {
    const consultas: string[] = [];
    const repo = { query: (sql: string) => { consultas.push(sql); return Promise.resolve([{}]); } } as unknown as Repository<never>;
    const adaptador = new ValidacionDocumentoEmpresarialRepositoryAdapter(repo as never, repo as never, repo as never);
    await adaptador.listarMesaRut({ estados: ['revision'], escuelas: null }).catch(() => undefined);
    await adaptador.supervisionRut(new Date(), null).catch(() => undefined);
    expect(consultas.length).toBeGreaterThanOrEqual(2);
    for (const sql of consultas.filter((x) => /JOIN documentos d/.test(x))) {
      expect(sql.replace(/\s+/g, ' ')).toContain("AND NOT (d.estado IN ('auto_aprobado','auto_devuelto') AND v.estado NOT IN ('aprobado_manual','devuelto','rechazado'))");
    }
  });
});

describe('Consistencia Documento / Cámara', () => {
  it.each(AUTO)('12. %s: fuera de la bandeja pendiente, no se toma, y el estudiante ve el resultado', async (estado) => {
    const m = montarMesaCamara();
    const c = await m.crear({ id: 'x', estadoDocumento: estado });
    const bandeja = await m.mesa.listar(tutorCamara(), {}, AHORA_CAMARA);
    expect(bandeja.items.map((i) => i.validacionId)).not.toContain(c.validacionId);
    await expect(m.mesa.tomar(c.validacionId as string, tutorCamara(), AHORA_CAMARA)).rejects.toBeInstanceOf(ConflictException);
    const vista = await m.estudiante.estado(c.practicaId, actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }));
    if (estado === EstadoDocumento.AUTO_APROBADO) expect(vista.estado).toBe('aprobado');
    else expect(vista).toMatchObject({ estado: 'necesita_correccion', puedeReenviar: true });
  });
});
