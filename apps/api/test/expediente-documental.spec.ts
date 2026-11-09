import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpedienteDocumentalUseCase } from '../src/application/use-cases/documentos/expediente-documental.use-case';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as EstadoEmp, TipoPersona,
} from '../src/domain/entities/documento-empresarial';
import { ModalidadPractica, documentosExigidos } from '../src/domain/entities/modalidad.entity';
import { EstadoValidacionActa, ValidacionActa } from '../src/domain/entities/validacion-acta.entity';
import { ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { DecisionEps, EstadoProcesamientoEps, ValidacionEps } from '../src/domain/entities/validacion-eps.entity';
import {
  DocumentoDeLectura, ExpedienteDocumentalLecturaPort, FiltroExpedientes, LecturaExpedientes, PracticaDeExpediente,
} from '../src/domain/ports/out/expediente-documental.port';
import {
  ETIQUETA_ESTADO_HUMANO, EstadoHumanoDocumento, TIPOS_CON_MOTOR_ESPECIALIZADO, compararExpedientes, estadoHumanoDe, motorDe, prioridadExpediente,
  progresoExpediente, reservaDe, siguienteDocumento,
} from '../src/domain/services/expediente-documental.domain-service';
import {
  faseActa, faseEmpresarial, faseEps, faseGeneral, senalActa, senalCamara, senalEps, senalRut,
} from '../src/domain/services/senales-motores-documentales.domain-service';
import { puedeOperarMotor } from '../src/domain/value-objects/acceso-validacion-documental.vo';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ESC_A, actorDe } from './soporte-autorizacion';
import { AuditoriaMemoria } from './soporte-mesa-actas';

const AHORA = new Date('2026-11-09T15:00:00.000Z');
const MIN = 60_000;
const DIA = 86_400_000;

// ── Escenario (lectura en memoria con el puerto real) ───────────────────────────────────

class LecturaFalsa implements ExpedienteDocumentalLecturaPort {
  llamadas = 0;
  filtros: FiltroExpedientes[] = [];
  practicas: PracticaDeExpediente[] = [];
  documentos: DocumentoDeLectura[] = [];
  eps = new Map<string, ValidacionEps>();
  actas = new Map<string, ValidacionActa>();
  empresariales = new Map<string, ValidacionDocumentoEmpresarial>();
  nombres = new Map<string, string>([['ana', 'Ana'], ['juan', 'Juan'], ['coord-1', 'Coordinación']]);

  cargar(f: FiltroExpedientes): Promise<LecturaExpedientes> {
    this.llamadas += 1;
    this.filtros.push(f);
    const alcance = f.alcance;
    const practicas = this.practicas
      .filter((p) => f.practicaId === undefined || p.id === f.practicaId)
      .filter((p) => !alcance || alcance.escuelas.includes(p.escuelaId) || (alcance.tutorId !== null && p.tutorId === alcance.tutorId))
      .filter((p) => !f.buscar || p.estudianteNombre.toLowerCase().includes(f.buscar.toLowerCase()))
      .slice(0, f.limite);
    const ids = new Set(practicas.map((p) => p.id));
    return Promise.resolve({
      practicas, documentos: this.documentos.filter((d) => ids.has(d.practicaId)), eps: this.eps, actas: this.actas, empresariales: this.empresariales, nombres: this.nombres,
    });
  }
}

function practica(id: string, sobre: Partial<PracticaDeExpediente> = {}): PracticaDeExpediente {
  return {
    id, estudianteId: `est-${id}`, estudianteNombre: `Estudiante ${id}`, estudianteDocumento: '1000000001', modalidad: ModalidadPractica.CUNBRE_CONSOLIDADO,
    periodoAcademico: '2026-2', escuelaId: ESC_A, empresaId: 'emp-1', empresaRazonSocial: 'EMPRESA PRUEBA CUNBRE S.A.S.', tutorId: 'tutor-1', tutorNombre: 'Docente Uno',
    estado: 'documentacion', fechaInicio: null, ...sobre,
  };
}

let secuencia = 0;
function documento(practicaId: string, tipo: TipoDocumento, sobre: Partial<DocumentoDeLectura> = {}): DocumentoDeLectura {
  secuencia += 1;
  return {
    id: `doc-${secuencia}`, practicaId, tipo, version: 1, estado: EstadoDocumento.EN_REVISION, nombreOriginal: `${tipo}.pdf`, cargadoEn: new Date(AHORA.getTime() - DIA),
    actualizadoEn: AHORA, motivoDevolucion: null, ...sobre,
  };
}

function empresarial(d: DocumentoDeLectura, tipo: C, sobre: Record<string, unknown> = {}, esperado = d.tipo): ValidacionDocumentoEmpresarial {
  const persona = tipo.includes('juridica') || tipo === C.CAMARA_EXISTENCIA_REPRESENTACION || tipo === C.CAMARA_MATRICULA_SOCIEDAD ? TipoPersona.JURIDICA : TipoPersona.NATURAL;
  return ValidacionDocumentoEmpresarial.desde({
    ...ValidacionDocumentoEmpresarial.pendiente({ id: `val-${d.id}`, documentoId: d.id, practicaId: d.practicaId, estudianteId: `est-${d.practicaId}`, tipoEsperado: esperado, recibidaEn: d.cargadoEn, ahora: AHORA }).instantanea(),
    estado: EstadoEmp.REVISION, tipoDetectado: tipo, tipoPersona: persona, expectativa: 'coincide', metodoLectura: 'texto', hashDocumento: 'a'.repeat(64), procesadaEn: AHORA,
    comparacion: { version: 1, veredicto: 'consistente', campos: [], hayDiscrepancia: false, discrepanciaImportante: false, senales: [], huellaSipra: 'h', calculadaEn: AHORA.toISOString() } as never,
    ...sobre,
  });
}

function acta(d: DocumentoDeLectura, sobre: Record<string, unknown> = {}): ValidacionActa {
  return ValidacionActa.desde({
    ...ValidacionActa.pendiente({ id: `val-${d.id}`, documentoId: d.id, practicaId: d.practicaId, estudianteId: `est-${d.practicaId}`, recibidaEn: d.cargadoEn, ahora: AHORA }).instantanea(),
    estado: EstadoValidacionActa.REVISION, tipoActaDetectada: 'iniciacion_practicas', procesadaEn: AHORA, comparacion: { veredicto: 'consistente' } as never, ...sobre,
  });
}

function eps(d: DocumentoDeLectura, sobre: Record<string, unknown> = {}): ValidacionEps {
  return ValidacionEps.desde({
    ...ValidacionEps.pendiente({ id: `val-${d.id}`, documentoId: d.id, practicaId: d.practicaId, estudianteId: `est-${d.practicaId}`, ahora: AHORA, recibidaEn: d.cargadoEn }).instantanea(),
    estadoProcesamiento: EstadoProcesamientoEps.PROCESADO, ...sobre,
  });
}

const reservada = (por: string, minutos: number) => ({ asignadoA: por, reservadoEn: new Date(AHORA.getTime() - MIN), reservaHasta: new Date(AHORA.getTime() + minutos * MIN) });

const tutor = (id = 'tutor-1') => actorDe(Rol.TUTOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
const aux = (id = 'aux-1') => actorDe(Rol.AUXILIAR, { id, correo: `${id}@cun.edu.co` });
const coord = (id = 'coord-1') => actorDe(Rol.COORDINADOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
const admin = (id = 'admin-1') => actorDe(Rol.ADMINISTRADOR, { id, correo: `${id}@cun.edu.co` });

function montar() {
  const lectura = new LecturaFalsa();
  const auditoria = new AuditoriaMemoria();
  const caso = new ExpedienteDocumentalUseCase(lectura, auditoria as never);
  return { lectura, auditoria, caso };
}

/** El expediente de «Estudiante Prueba CUNbre»: EPS, RUT jurídico y Cámara con motores propios; lo demás pendiente. */
function expedientePruebaCunbre(m: ReturnType<typeof montar>, id = 'cunbre') {
  m.lectura.practicas.push(practica(id, { estudianteNombre: 'Estudiante Prueba CUNbre' }));
  const dEps = documento(id, TipoDocumento.CERTIFICADO_EPS);
  const dRut = documento(id, TipoDocumento.RUT_JURIDICO, { estado: EstadoDocumento.APROBADO });
  const dCam = documento(id, TipoDocumento.CAMARA_COMERCIO);
  m.lectura.documentos.push(dEps, dRut, dCam);
  m.lectura.eps.set(dEps.id, eps(dEps, reservada('ana', 4)));
  m.lectura.empresariales.set(dRut.id, empresarial(dRut, C.RUT_PERSONA_JURIDICA, { estado: EstadoEmp.APROBADO_MANUAL, decididoPor: 'juan', decididoEn: AHORA }));
  m.lectura.empresariales.set(dCam.id, empresarial(dCam, C.CAMARA_EXISTENCIA_REPRESENTACION));
  return { dEps, dRut, dCam };
}

// ── Dominio ─────────────────────────────────────────────────────────────────────────────

describe('Mesa documental · estado humano común (solo presentación)', () => {
  it('traduce cada fase a uno de los nueve estados humanos y distingue «disponible» de «en revisión» por la reserva', () => {
    expect(estadoHumanoDe('sin_cargar', false)).toBe('pendiente_de_cargar');
    expect(estadoHumanoDe('procesando', false)).toBe('procesando');
    expect(estadoHumanoDe('listo_para_revisar', false)).toBe('disponible_para_revision');
    expect(estadoHumanoDe('listo_para_revisar', true)).toBe('en_revision');
    expect(estadoHumanoDe('devuelto', false)).toBe('necesita_correccion');
    expect(estadoHumanoDe('aprobado', false)).toBe('aprobado');
    expect(estadoHumanoDe('rechazado', false)).toBe('rechazado');
    expect(estadoHumanoDe('error', false)).toBe('error');
    expect(estadoHumanoDe('no_aplica', false)).toBe('no_aplica');
  });

  it('las etiquetas son las pedidas, con texto para cada estado', () => {
    expect(Object.values(ETIQUETA_ESTADO_HUMANO)).toEqual([
      'Pendiente de cargar', 'Procesando', 'Disponible para revisión', 'En revisión', 'Necesita corrección', 'Aprobado', 'Rechazado', 'Error', 'No aplica',
    ]);
  });

  it('cada motor traduce SU estado interno sin que el agregador lo cambie', () => {
    const d = (e: EstadoDocumento) => e;
    // EPS: la fase sale de procesamiento + decisión.
    expect(faseEps(d(EstadoDocumento.EN_REVISION), eps(documento('p', TipoDocumento.CERTIFICADO_EPS)).instantanea())).toBe('listo_para_revisar');
    expect(faseEps(d(EstadoDocumento.ANALIZANDO), eps(documento('p', TipoDocumento.CERTIFICADO_EPS), { estadoProcesamiento: EstadoProcesamientoEps.PROCESANDO }).instantanea())).toBe('procesando');
    expect(faseEps(d(EstadoDocumento.EN_REVISION), eps(documento('p', TipoDocumento.CERTIFICADO_EPS), { estadoProcesamiento: EstadoProcesamientoEps.ERROR }).instantanea())).toBe('error');
    for (const [decision, fase] of [[DecisionEps.APROBADO_MANUAL, 'aprobado'], [DecisionEps.DEVUELTO, 'devuelto'], [DecisionEps.RECHAZADO, 'rechazado']] as const) {
      expect(faseEps(d(EstadoDocumento.EN_REVISION), eps(documento('p', TipoDocumento.CERTIFICADO_EPS), { decision }).instantanea())).toBe(fase);
    }
    expect(faseEps(d(EstadoDocumento.RECIBIDO), null)).toBe('procesando');
    // Actas y empresariales: el estado de la validación.
    const da = documento('p', TipoDocumento.ACTA_INICIO);
    for (const [estado, fase] of [
      [EstadoValidacionActa.PENDIENTE, 'procesando'], [EstadoValidacionActa.PROCESANDO, 'procesando'], [EstadoValidacionActa.REVISION, 'listo_para_revisar'],
      [EstadoValidacionActa.APROBADO_MANUAL, 'aprobado'], [EstadoValidacionActa.DEVUELTO, 'devuelto'], [EstadoValidacionActa.RECHAZADO, 'rechazado'], [EstadoValidacionActa.ERROR, 'error'],
    ] as const) expect(faseActa(EstadoDocumento.EN_REVISION, acta(da, { estado }).instantanea())).toBe(fase);
    const dr = documento('p', TipoDocumento.RUT_JURIDICO);
    for (const [estado, fase] of [
      [EstadoEmp.PENDIENTE, 'procesando'], [EstadoEmp.PROCESANDO, 'procesando'], [EstadoEmp.REVISION, 'listo_para_revisar'], [EstadoEmp.APROBADO_MANUAL, 'aprobado'],
      [EstadoEmp.DEVUELTO, 'devuelto'], [EstadoEmp.RECHAZADO, 'rechazado'], [EstadoEmp.ERROR, 'error'],
    ] as const) expect(faseEmpresarial(EstadoDocumento.EN_REVISION, empresarial(dr, C.RUT_PERSONA_JURIDICA, { estado, decididoPor: 'x', decididoEn: AHORA }).instantanea())).toBe(fase);
    // Un documento ilegible vuelve al estudiante aunque el motor no haya llegado a decidir.
    expect(faseEmpresarial(EstadoDocumento.ILEGIBLE, null)).toBe('devuelto');
    expect(faseActa(EstadoDocumento.ILEGIBLE, null)).toBe('devuelto');
    // General: el estado del documento.
    for (const [estado, fase] of [
      [EstadoDocumento.RECIBIDO, 'procesando'], [EstadoDocumento.ANALIZANDO, 'procesando'], [EstadoDocumento.EN_REVISION, 'listo_para_revisar'],
      [EstadoDocumento.AUTO_APROBADO, 'aprobado'], [EstadoDocumento.APROBADO, 'aprobado'], [EstadoDocumento.DEVUELTO, 'devuelto'], [EstadoDocumento.ILEGIBLE, 'devuelto'],
      [EstadoDocumento.RECHAZADO, 'rechazado'],
    ] as const) expect(faseGeneral(estado)).toBe(fase);
  });

  it('las señales salen de la recomendación del PROPIO motor (RUT, Cámara, Acta, EPS) y no se reescriben reglas', () => {
    const dr = documento('p', TipoDocumento.RUT_JURIDICO);
    const cmp = (sobre: Record<string, unknown>) => ({ version: 1, veredicto: 'consistente', campos: [], hayDiscrepancia: false, huellaSipra: 'h', calculadaEn: AHORA.toISOString(), ...sobre });
    expect(senalRut(empresarial(dr, C.RUT_PERSONA_JURIDICA).instantanea())).toMatchObject({ criticidad: 'normal', informacionInsuficiente: false });
    expect(senalRut(empresarial(dr, C.RUT_PERSONA_JURIDICA, { comparacion: cmp({ veredicto: 'discrepancia', hayDiscrepancia: true }) }).instantanea())).toMatchObject({ criticidad: 'critico' });
    expect(senalRut(empresarial(dr, C.RUT_PERSONA_JURIDICA, { lecturaDudosa: true, comparacion: cmp({ veredicto: 'revision_necesaria' }) }).instantanea())).toMatchObject({ criticidad: 'atencion', informacionInsuficiente: true });
    expect(senalRut(empresarial(dr, C.DOCUMENTO_INCORRECTO, { comparacion: null }).instantanea())).toMatchObject({ criticidad: 'critico' });
    const dc = documento('p', TipoDocumento.CAMARA_COMERCIO);
    expect(senalCamara(empresarial(dc, C.CAMARA_EXISTENCIA_REPRESENTACION).instantanea())).toMatchObject({ criticidad: 'normal' });
    expect(senalCamara(empresarial(dc, C.CAMARA_EXISTENCIA_REPRESENTACION, { comparacion: cmp({ veredicto: 'revision_necesaria', discrepanciaImportante: true, senales: [] }) }).instantanea()))
      .toMatchObject({ criticidad: 'atencion', informacionInsuficiente: false });
    expect(senalCamara(empresarial(dc, C.CAMARA_EXISTENCIA_REPRESENTACION, { comparacion: cmp({ veredicto: 'discrepancia', hayDiscrepancia: true, senales: ['estado_registral_cancelado'] }) }).instantanea()))
      .toMatchObject({ criticidad: 'critico', problemaPrincipal: 'El certificado declara que la matrícula está cancelada' });
    const da = documento('p', TipoDocumento.ACTA_INICIO);
    expect(senalActa(acta(da).instantanea())).toMatchObject({ criticidad: 'normal' });
    expect(senalActa(acta(da, { hayDiscrepanciaCritica: true }).instantanea())).toMatchObject({ criticidad: 'critico' });
    expect(senalActa(acta(da, { firmaEmpresa: 'no' }).instantanea())).toMatchObject({ criticidad: 'critico' });
    expect(senalEps(eps(documento('p', TipoDocumento.CERTIFICADO_EPS)).instantanea()).criticidad).toBeDefined();
  });
});

describe('Mesa documental · progreso del expediente', () => {
  const doc = (estadoHumano: EstadoHumanoDocumento, obligatorio = true) => ({ estadoHumano, obligatorio });

  it('«X de Y aprobados» cuenta solo obligaciones; los adicionales no cuentan', () => {
    const p = progresoExpediente([doc('aprobado'), doc('aprobado'), doc('disponible_para_revision'), doc('necesita_correccion'), doc('pendiente_de_cargar'), doc('aprobado', false)]);
    expect(p).toMatchObject({ total: 5, aprobados: 2, requierenRevision: 1, necesitanCorreccion: 1, pendientesDeCargar: 1, completo: false, porcentaje: 40 });
  });

  it('solo es «completo» cuando TODAS las obligaciones están aprobadas, y un expediente vacío no se da por completo', () => {
    expect(progresoExpediente([doc('aprobado'), doc('aprobado')]).completo).toBe(true);
    expect(progresoExpediente([doc('aprobado'), doc('en_revision')]).completo).toBe(false);
    expect(progresoExpediente([]).completo).toBe(false);
    expect(progresoExpediente([doc('aprobado', false)]).completo).toBe(false);
  });

  it('en revisión y disponible cuentan como «requieren revisión»; procesando, rechazado y error van aparte', () => {
    const p = progresoExpediente([doc('en_revision'), doc('disponible_para_revision'), doc('procesando'), doc('rechazado'), doc('error')]);
    expect(p).toMatchObject({ requierenRevision: 2, procesando: 1, rechazados: 1, errores: 1, aprobados: 0 });
  });
});

describe('Mesa documental · orden inicial y navegación', () => {
  const d = (sobre: Record<string, unknown> = {}) => ({ requiereRevision: true, esReenvio: false, criticidad: 'normal' as const, informacionInsuficiente: false, fechaCarga: new Date(AHORA.getTime() - DIA).toISOString(), ...sobre });

  it('orden: reenvíos, críticos, información insuficiente, más antiguos y el resto', () => {
    const grupos = {
      reenvio: prioridadExpediente([d({ esReenvio: true })], AHORA),
      critico: prioridadExpediente([d({ criticidad: 'critico' })], AHORA),
      insuficiente: prioridadExpediente([d({ informacionInsuficiente: true })], AHORA),
      antiguo: prioridadExpediente([d({ fechaCarga: new Date(AHORA.getTime() - 5 * DIA).toISOString() })], AHORA),
      resto: prioridadExpediente([d()], AHORA),
    };
    expect(Object.entries(grupos).map(([k, v]) => [k, v.grupo])).toEqual([['reenvio', 'reenvio'], ['critico', 'critico'], ['insuficiente', 'insuficiente'], ['antiguo', 'antiguo'], ['resto', 'resto']]);
    const orden = [grupos.resto, grupos.antiguo, grupos.insuficiente, grupos.critico, grupos.reenvio].map((p) => ({ prioridad: p, esperandoDesde: null })).sort(compararExpedientes).map((x) => x.prioridad.grupo);
    expect(orden).toEqual(['reenvio', 'critico', 'insuficiente', 'antiguo', 'resto']);
  });

  it('dentro de un grupo, el expediente que más lleva esperando va primero', () => {
    const p = prioridadExpediente([d()], AHORA);
    const orden = [{ prioridad: p, esperandoDesde: '2026-11-08T00:00:00.000Z' }, { prioridad: p, esperandoDesde: '2026-11-01T00:00:00.000Z' }].sort(compararExpedientes);
    expect(orden.map((x) => x.esperandoDesde)).toEqual(['2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z']);
  });

  it('anterior / siguiente / siguiente pendiente recorren el expediente sin volver a la cola y saltan lo tomado por otra persona', () => {
    const lista = [
      { tipoDocumento: TipoDocumento.CERTIFICADO_EPS, requiereRevision: true, reserva: reservaDe('ana', new Date(AHORA.getTime() + 5 * MIN), 'Ana', 'yo', AHORA) },
      { tipoDocumento: TipoDocumento.RUT_JURIDICO, requiereRevision: false, reserva: reservaDe(null, null, null, 'yo', AHORA) },
      { tipoDocumento: TipoDocumento.CAMARA_COMERCIO, requiereRevision: true, reserva: reservaDe(null, null, null, 'yo', AHORA) },
      { tipoDocumento: TipoDocumento.ACTA_INICIO, requiereRevision: true, reserva: reservaDe('yo', new Date(AHORA.getTime() + 5 * MIN), 'Yo', 'yo', AHORA) },
    ];
    expect(siguienteDocumento(lista, TipoDocumento.CERTIFICADO_EPS, 'siguiente')?.tipoDocumento).toBe(TipoDocumento.RUT_JURIDICO);
    expect(siguienteDocumento(lista, TipoDocumento.CERTIFICADO_EPS, 'anterior')?.tipoDocumento).toBe(TipoDocumento.ACTA_INICIO);
    expect(siguienteDocumento(lista, TipoDocumento.CERTIFICADO_EPS, 'pendiente')?.tipoDocumento).toBe(TipoDocumento.CAMARA_COMERCIO);
    expect(siguienteDocumento(lista, TipoDocumento.CAMARA_COMERCIO, 'pendiente')?.tipoDocumento).toBe(TipoDocumento.ACTA_INICIO);
    // Desde la última, da la vuelta; el EPS tomado por otra persona no es «pendiente» para mí.
    expect(siguienteDocumento(lista, TipoDocumento.ACTA_INICIO, 'pendiente')?.tipoDocumento).toBe(TipoDocumento.CAMARA_COMERCIO);
    expect(siguienteDocumento([], null, 'pendiente')).toBeNull();
    expect(siguienteDocumento([{ ...lista[1] }], null, 'pendiente')).toBeNull();
  });
});

describe('Mesa documental · motores y permisos delegados', () => {
  it('cada tipo con motor se asigna a SU motor y el resto sigue el flujo general', () => {
    expect([TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO].map(motorDe))
      .toEqual(['eps', 'acta', 'rut', 'rut', 'camara']);
    for (const t of [TipoDocumento.CEDULA, TipoDocumento.CERTIFICADO_ARL, TipoDocumento.PLANILLA_HORAS, TipoDocumento.ENTREGABLE_MENTORIA_1]) expect(motorDe(t)).toBe('general');
  });

  it('REGRESIÓN del hueco del RUT: la lista de tipos con motor especializado es exactamente EPS, acta, RUT natural, RUT jurídico y Cámara', () => {
    expect([...TIPOS_CON_MOTOR_ESPECIALIZADO].sort()).toEqual([
      TipoDocumento.ACTA_INICIO, TipoDocumento.CAMARA_COMERCIO, TipoDocumento.CERTIFICADO_EPS, TipoDocumento.RUT_JURIDICO, TipoDocumento.RUT_NATURAL,
    ].sort());
  });

  it('los permisos por motor son los de cada motor (auxiliar: EPS y actas; docente: RUT y Cámara; coordinación y administración: todos)', () => {
    const matriz: [Rol, boolean, boolean, boolean, boolean][] = [
      [Rol.AUXILIAR, true, true, false, false], [Rol.TUTOR, false, false, true, true], [Rol.COORDINADOR, true, true, true, true], [Rol.ADMINISTRADOR, true, true, true, true],
      [Rol.ESTUDIANTE, false, false, false, false], [Rol.EMPRESA, false, false, false, false], [Rol.EXTENSION, false, false, false, false],
    ];
    for (const [rol, eps, actas, rut, camara] of matriz) {
      expect([puedeOperarMotor('eps', rol), puedeOperarMotor('acta', rol), puedeOperarMotor('rut', rol), puedeOperarMotor('camara', rol)]).toEqual([eps, actas, rut, camara]);
    }
  });
});

// ── Agregador ───────────────────────────────────────────────────────────────────────────

describe('Mesa documental · el expediente de «Estudiante Prueba CUNbre»', () => {
  it('muestra TODAS las obligaciones reales de la modalidad (no una lista fija) y el progreso «1 de N aprobados»', async () => {
    const m = montar();
    const { dEps, dRut, dCam } = expedientePruebaCunbre(m);
    const e = await m.caso.expediente('cunbre', coord(), AHORA);
    const obligaciones = [...new Set(documentosExigidos(ModalidadPractica.CUNBRE_CONSOLIDADO))];
    expect(e.documentos.filter((d) => d.obligatorio).map((d) => d.tipoDocumento)).toEqual(expect.arrayContaining(obligaciones));
    expect(e.documentos.filter((d) => d.obligatorio)).toHaveLength(obligaciones.length);
    expect(e.progreso).toMatchObject({ total: obligaciones.length, aprobados: 1, requierenRevision: 2, completo: false });
    expect(e.progreso.pendientesDeCargar).toBe(obligaciones.length - 3);
    const porTipo = new Map(e.documentos.map((d) => [d.tipoDocumento, d]));
    expect(porTipo.get(TipoDocumento.CERTIFICADO_EPS)).toMatchObject({ motor: 'eps', documentoId: dEps.id, estadoHumano: 'en_revision', validacionId: `val-${dEps.id}` });
    expect(porTipo.get(TipoDocumento.RUT_JURIDICO)).toMatchObject({ motor: 'rut', documentoId: dRut.id, estadoHumano: 'aprobado', estadoInterno: 'aprobado_manual' });
    expect(porTipo.get(TipoDocumento.CAMARA_COMERCIO)).toMatchObject({ motor: 'camara', documentoId: dCam.id, estadoHumano: 'disponible_para_revision', estadoInterno: 'revision' });
    expect(porTipo.get(TipoDocumento.SOPORTE_ACEPTACION_CUNBRE)).toMatchObject({ documentoId: null, estadoHumano: 'pendiente_de_cargar', validacionId: null, motor: 'general' });
    // CUNbre consolidado no exige acta de iniciación: no se inventa una obligación que la modalidad no tiene.
    expect(porTipo.has(TipoDocumento.ACTA_INICIO)).toBe(false);
    expect(e.encabezado).toMatchObject({ estudiante: { nombre: 'Estudiante Prueba CUNbre', documentoEnmascarado: '••••0001' }, modalidadEtiqueta: 'Emprendimiento CUNBRE – Consolidado', empresa: 'EMPRESA PRUEBA CUNBRE S.A.S.', docente: 'Docente Uno' });
  });

  it('otra modalidad tiene otras obligaciones: la lista sale de la matriz de la modalidad, no está cableada', async () => {
    const m = montar();
    m.lectura.practicas.push(practica('pasantia', { modalidad: ModalidadPractica.PASANTIA }));
    m.lectura.documentos.push(documento('pasantia', TipoDocumento.CERTIFICADO_EPS));
    const e = await m.caso.expediente('pasantia', coord(), AHORA);
    const esperadas = [...new Set(documentosExigidos(ModalidadPractica.PASANTIA))];
    expect(e.documentos.filter((d) => d.obligatorio).map((d) => d.tipoDocumento)).toEqual(expect.arrayContaining(esperadas));
    expect(e.documentos.some((d) => d.tipoDocumento === TipoDocumento.CAMARA_COMERCIO)).toBe(esperadas.includes(TipoDocumento.CAMARA_COMERCIO));
  });

  it('un documento cargado que no es obligación de la modalidad aparece como adicional y no cuenta para el progreso', async () => {
    const m = montar();
    expedientePruebaCunbre(m);
    const extra = documento('cunbre', TipoDocumento.PLANILLA_HORAS, { estado: EstadoDocumento.APROBADO });
    m.lectura.documentos.push(extra);
    const e = await m.caso.expediente('cunbre', coord(), AHORA);
    const adicional = e.documentos.find((d) => d.tipoDocumento === TipoDocumento.PLANILLA_HORAS);
    if (documentosExigidos(ModalidadPractica.CUNBRE_CONSOLIDADO).includes(TipoDocumento.PLANILLA_HORAS)) return;
    expect(adicional).toMatchObject({ obligatorio: false, estadoHumano: 'aprobado', motor: 'general' });
    expect(e.progreso.aprobados).toBe(1);
  });

  it('reserva POR DOCUMENTO: EPS tomado por Ana, RUT por Juan y la Cámara disponible para otra persona; nadie reserva el expediente', async () => {
    const m = montar();
    const { dEps, dRut, dCam } = expedientePruebaCunbre(m);
    // El RUT vuelve a estar en revisión, tomado por Juan; EPS por Ana (4 min).
    m.lectura.empresariales.set(dRut.id, empresarial(dRut, C.RUT_PERSONA_JURIDICA, reservada('juan', 8)));
    m.lectura.documentos.find((d) => d.id === dRut.id)!.estado = EstadoDocumento.EN_REVISION;
    const e = await m.caso.expediente('cunbre', coord(), AHORA);
    const por = new Map(e.documentos.map((d) => [d.tipoDocumento, d]));
    expect(por.get(TipoDocumento.CERTIFICADO_EPS)).toMatchObject({ estadoHumano: 'en_revision', reserva: { estado: 'otro', por: 'Ana', minutosRestantes: 4 }, puedeTomar: false, puedeDecidir: false });
    expect(por.get(TipoDocumento.RUT_JURIDICO)).toMatchObject({ estadoHumano: 'en_revision', reserva: { estado: 'otro', por: 'Juan', minutosRestantes: 8 }, puedeTomar: false });
    expect(por.get(TipoDocumento.CAMARA_COMERCIO)).toMatchObject({ estadoHumano: 'disponible_para_revision', reserva: { estado: 'libre' }, puedeTomar: true, puedeDecidir: false });
    expect(dEps.id).not.toBe(dCam.id);
    const lista = await m.caso.listar(coord(), {}, AHORA);
    expect(lista.items[0].funcionariosTrabajando.map((f) => [f.nombre, f.documentos]).sort()).toEqual([['Ana', 1], ['Juan', 1]]);
    expect(lista.items[0].documentos.find((d) => String(d.tipoDocumento) === String(TipoDocumento.RUT_JURIDICO))!.reserva).toMatchObject({ estado: 'otro', por: 'Juan', minutosRestantes: 8 });
  });

  it('con el documento reservado por MÍ, puedo decidir (lo hace su motor) y no puedo tomarlo otra vez', async () => {
    const m = montar();
    const { dCam } = expedientePruebaCunbre(m);
    m.lectura.empresariales.set(dCam.id, empresarial(dCam, C.CAMARA_EXISTENCIA_REPRESENTACION, reservada('coord-1', 10)));
    const e = await m.caso.expediente('cunbre', coord('coord-1'), AHORA);
    expect(e.documentos.find((d) => d.tipoDocumento === TipoDocumento.CAMARA_COMERCIO)).toMatchObject({ reserva: { estado: 'mia' }, puedeTomar: false, puedeDecidir: true, estadoHumano: 'en_revision' });
  });

  it('una reserva vencida se muestra vencida y el documento vuelve a poder tomarse', async () => {
    const m = montar();
    const { dCam } = expedientePruebaCunbre(m);
    m.lectura.empresariales.set(dCam.id, empresarial(dCam, C.CAMARA_EXISTENCIA_REPRESENTACION, reservada('juan', -3)));
    const e = await m.caso.expediente('cunbre', coord(), AHORA);
    expect(e.documentos.find((d) => d.tipoDocumento === TipoDocumento.CAMARA_COMERCIO)).toMatchObject({ estadoHumano: 'disponible_para_revision', reserva: { estado: 'vencida' }, puedeTomar: true });
  });
});

describe('Mesa documental · versiones', () => {
  it('solo la versión vigente es operable; tras una devolución y un reenvío, la nueva versión sustituye a la devuelta y el histórico es bajo demanda', async () => {
    const m = montar();
    m.lectura.practicas.push(practica('p1'));
    const v1 = documento('p1', TipoDocumento.CAMARA_COMERCIO, { version: 1, estado: EstadoDocumento.DEVUELTO, motivoDevolucion: 'La razón social no coincide.' });
    const v2 = documento('p1', TipoDocumento.CAMARA_COMERCIO, { version: 2 });
    m.lectura.documentos.push(v1, v2);
    m.lectura.empresariales.set(v1.id, empresarial(v1, C.CAMARA_EXISTENCIA_REPRESENTACION, { estado: EstadoEmp.DEVUELTO, decididoPor: 'juan', decididoEn: AHORA, motivoDecision: 'razon_social_no_coincide' }));
    m.lectura.empresariales.set(v2.id, empresarial(v2, C.CAMARA_EXISTENCIA_REPRESENTACION));
    const e = await m.caso.expediente('p1', coord(), AHORA);
    expect(e.documentos.find((d) => d.tipoDocumento === TipoDocumento.CAMARA_COMERCIO)).toMatchObject({
      documentoId: v2.id, version: 2, esReenvio: true, versionesAnteriores: 1, estadoHumano: 'disponible_para_revision', validacionId: `val-${v2.id}`,
    });
    const versiones = await m.caso.versiones('p1', TipoDocumento.CAMARA_COMERCIO, coord());
    expect(versiones.map((v) => [v.version, v.vigente, v.estadoHumano])).toEqual([[2, true, 'disponible_para_revision'], [1, false, 'necesita_correccion']]);
    expect(versiones[1].motivoDevolucion).toBe('La razón social no coincide.');
  });

  it('un documento devuelto sin reenvío se muestra «Necesita corrección» y no es operable por el equipo', async () => {
    const m = montar();
    m.lectura.practicas.push(practica('p1'));
    const v1 = documento('p1', TipoDocumento.RUT_JURIDICO, { estado: EstadoDocumento.DEVUELTO });
    m.lectura.documentos.push(v1);
    m.lectura.empresariales.set(v1.id, empresarial(v1, C.RUT_PERSONA_JURIDICA, { estado: EstadoEmp.DEVUELTO, decididoPor: 'juan', decididoEn: AHORA }));
    const e = await m.caso.expediente('p1', coord(), AHORA);
    expect(e.documentos.find((d) => d.tipoDocumento === TipoDocumento.RUT_JURIDICO)).toMatchObject({ estadoHumano: 'necesita_correccion', requiereRevision: false, puedeTomar: false, puedeDecidir: false });
    expect(e.progreso.necesitanCorreccion).toBe(1);
  });
});

describe('Mesa documental · documentos sin motor especializado', () => {
  it('muestran estado, versión y la decisión general SOLO a quien ya la tenía; sin reserva', async () => {
    const m = montar();
    m.lectura.practicas.push(practica('p1', { modalidad: ModalidadPractica.PASANTIA }));
    m.lectura.documentos.push(documento('p1', TipoDocumento.CERTIFICADO_ARL, { estado: EstadoDocumento.EN_REVISION, version: 2 }), documento('p1', TipoDocumento.CEDULA, { estado: EstadoDocumento.APROBADO }));
    const e = await m.caso.expediente('p1', tutor(), AHORA);
    expect(e.documentos.find((d) => d.tipoDocumento === TipoDocumento.CERTIFICADO_ARL)).toMatchObject({
      motor: 'general', version: 2, estadoHumano: 'disponible_para_revision', validacionId: null, reserva: { estado: 'libre' }, puedeTomar: false, operable: true, puedeDecidir: true,
    });
    expect(e.documentos.find((d) => d.tipoDocumento === TipoDocumento.CEDULA)).toMatchObject({ estadoHumano: 'aprobado', puedeDecidir: false });
    const delAuxiliar = await m.caso.expediente('p1', aux(), AHORA);
    expect(delAuxiliar.documentos.find((d) => d.tipoDocumento === TipoDocumento.CERTIFICADO_ARL)).toMatchObject({ puedeDecidir: false });
  });
});

describe('Mesa documental · permisos: el agregador no eleva privilegios', () => {
  it.each([Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION])('%s no usa la Mesa: ni cola, ni expediente, ni versiones, ni supervisión', async (rol) => {
    const m = montar();
    expedientePruebaCunbre(m);
    const a = actorDe(rol);
    await expect(m.caso.listar(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.caso.expediente('cunbre', a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.caso.versiones('cunbre', TipoDocumento.CAMARA_COMERCIO, a)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.caso.supervision(a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.lectura.llamadas).toBe(0);
  });

  it('en el MISMO expediente cada rol opera solo los motores que ya opera: docente (RUT, Cámara), auxiliar (EPS), coordinación (todos)', async () => {
    const m = montar();
    expedientePruebaCunbre(m);
    const operables = async (a: ReturnType<typeof tutor>) =>
      (await m.caso.expediente('cunbre', a, AHORA)).documentos.filter((d) => d.documentoId !== null && d.operable).map((d) => d.motor).sort();
    expect(await operables(tutor())).toEqual(['camara', 'rut']);
    expect(await operables(aux())).toEqual(['eps']);
    expect(await operables(coord())).toEqual(['camara', 'eps', 'rut']);
    expect(await operables(admin())).toEqual(['camara', 'eps', 'rut']);
  });

  it('puedeTomar nunca es verdadero para un documento de un motor que la persona no opera', async () => {
    const m = montar();
    expedientePruebaCunbre(m);
    const d = (await m.caso.expediente('cunbre', tutor(), AHORA)).documentos;
    expect(d.find((x) => x.motor === 'eps')).toMatchObject({ operable: false, puedeTomar: false, puedeDecidir: false });
    expect(d.find((x) => x.motor === 'camara')).toMatchObject({ operable: true, puedeTomar: true });
  });

  it('el auxiliar solo ve los tipos de documento de su proceso; el resto no aparece en su expediente', async () => {
    const m = montar();
    m.lectura.practicas.push(practica('p1', { modalidad: ModalidadPractica.PASANTIA }));
    m.lectura.documentos.push(documento('p1', TipoDocumento.CERTIFICADO_EPS), documento('p1', TipoDocumento.PLANILLA_HORAS), documento('p1', TipoDocumento.PLAN_MEJORAMIENTO));
    const tipos = (await m.caso.expediente('p1', aux(), AHORA)).documentos.map((d) => d.tipoDocumento);
    expect(tipos).toContain(TipoDocumento.CERTIFICADO_EPS);
    expect(tipos).not.toContain(TipoDocumento.PLANILLA_HORAS);
    expect(tipos).not.toContain(TipoDocumento.PLAN_MEJORAMIENTO);
    await expect(m.caso.versiones('p1', TipoDocumento.PLANILLA_HORAS, aux())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el alcance se aplica al armar la consulta: un docente de otra escuela no ve el expediente («no existe»), ni lo lista', async () => {
    const m = montar();
    expedientePruebaCunbre(m);
    const ajeno = actorDe(Rol.TUTOR, { id: 'tutor-ajeno', escuelas: ['ESC-OTRA'] });
    await expect(m.caso.expediente('cunbre', ajeno, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    expect((await m.caso.listar(ajeno, {}, AHORA)).total).toBe(0);
    expect(m.lectura.filtros.at(-1)!.alcance).toEqual({ escuelas: ['ESC-OTRA'], tutorId: 'tutor-ajeno' });
    // Coordinación con escuelas: las suyas; administración y auxiliar: sin restricción.
    await m.caso.listar(coord(), {}, AHORA);
    expect(m.lectura.filtros.at(-1)!.alcance).toEqual({ escuelas: [ESC_A], tutorId: null });
    await m.caso.listar(admin(), {}, AHORA);
    expect(m.lectura.filtros.at(-1)!.alcance).toBeNull();
    await m.caso.listar(aux(), {}, AHORA);
    expect(m.lectura.filtros.at(-1)!.alcance).toBeNull();
  });

  it('solo coordinación y administración supervisan', async () => {
    const m = montar();
    await expect(m.caso.supervision(tutor(), AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.caso.supervision(aux(), AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.caso.supervision(coord(), AHORA)).resolves.toBeDefined();
    await expect(m.caso.supervision(admin(), AHORA)).resolves.toBeDefined();
  });
});

describe('Mesa documental · la cola por expediente', () => {
  function variosExpedientes(m: ReturnType<typeof montar>) {
    const crear = (id: string, nombre: string, f: (dCam: DocumentoDeLectura) => void, version = 1, edadDias = 1) => {
      m.lectura.practicas.push(practica(id, { estudianteNombre: nombre }));
      const dCam = documento(id, TipoDocumento.CAMARA_COMERCIO, { version, cargadoEn: new Date(AHORA.getTime() - edadDias * DIA) });
      m.lectura.documentos.push(dCam);
      f(dCam);
    };
    const cmpCritico = { version: 1, veredicto: 'discrepancia', campos: [], hayDiscrepancia: true, discrepanciaImportante: false, senales: [], huellaSipra: 'h', calculadaEn: AHORA.toISOString() };
    crear('normal', 'Normal', (d) => m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION)));
    crear('critico', 'Crítico', (d) => m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION, { comparacion: cmpCritico })));
    crear('dudoso', 'Dudoso', (d) => m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION, { lecturaDudosa: true, metodoLectura: 'ocr' })));
    crear('reenvio', 'Reenvío', (d) => m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION)), 2);
    crear('viejo', 'Viejo', (d) => m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION)), 1, 9);
    crear('mio', 'Mío', (d) => m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION, reservada('coord-1', 2))));
  }

  it('ordena: reenvíos, críticos, información insuficiente, más antiguos y el resto; cada fila trae progreso e indicadores', async () => {
    const m = montar();
    variosExpedientes(m);
    const lista = await m.caso.listar(coord('coord-1'), {}, AHORA);
    expect(lista.items.map((i) => i.estudiante.nombre)).toEqual(['Reenvío', 'Crítico', 'Dudoso', 'Viejo', 'Normal', 'Mío']);
    expect(lista.items[0].prioridad).toMatchObject({ grupo: 'reenvio' });
    expect(lista.items[1].indicadores).toMatchObject({ criticos: 1, conDiscrepancias: 1 });
    expect(lista.items[2].indicadores).toMatchObject({ informacionInsuficiente: 1 });
    expect(lista.items[0].progreso).toMatchObject({ total: new Set(documentosExigidos(ModalidadPractica.CUNBRE_CONSOLIDADO)).size, aprobados: 0, requierenRevision: 1 });
    expect(lista.kpis).toMatchObject({ expedientes: 6, conPendientes: 6, conProblemas: 2, misDocumentos: 1, reservasPorVencer: 1, documentosPorRevisar: 6 });
  });

  it('vistas rápidas y filtros: pendientes, problemas, mis documentos, por vencer, devueltos, OCR, reservas y antigüedad', async () => {
    const m = montar();
    variosExpedientes(m);
    const nombres = async (q: Record<string, string>) => (await m.caso.listar(coord('coord-1'), q, AHORA)).items.map((i) => i.estudiante.nombre).sort();
    expect(await nombres({ vista: 'problemas' })).toEqual(['Crítico', 'Dudoso']);
    expect(await nombres({ vista: 'mis_documentos' })).toEqual(['Mío']);
    expect(await nombres({ vista: 'por_vencer' })).toEqual(['Mío']);
    expect(await nombres({ reserva: 'mias' })).toEqual(['Mío']);
    expect(await nombres({ ocr: 'si' })).toEqual(['Dudoso']);
    expect(await nombres({ conDiscrepancias: 'si' })).toEqual(['Crítico']);
    expect(await nombres({ antiguedadMinDias: '5' })).toEqual(['Viejo']);
    expect(await nombres({ reserva: 'libres' })).toHaveLength(5);
    expect(await nombres({ conDevueltos: 'si' })).toEqual([]);
    expect(await nombres({ estado: 'completos' })).toEqual([]);
    expect(await nombres({ vista: 'pendientes' })).toHaveLength(6);
  });

  it('«mis documentos» puede reunir documentos de DISTINTOS estudiantes', async () => {
    const m = montar();
    for (const id of ['a', 'b']) {
      m.lectura.practicas.push(practica(id, { estudianteNombre: `Estudiante ${id}` }));
      const d = documento(id, TipoDocumento.CAMARA_COMERCIO);
      m.lectura.documentos.push(d);
      m.lectura.empresariales.set(d.id, empresarial(d, C.CAMARA_EXISTENCIA_REPRESENTACION, reservada('coord-1', 10)));
    }
    const lista = await m.caso.listar(coord('coord-1'), { vista: 'mis_documentos' }, AHORA);
    expect(lista.items.map((i) => i.estudiante.nombre)).toEqual(['Estudiante a', 'Estudiante b']);
    expect(lista.kpis.misDocumentos).toBe(2);
  });

  it('NO hay N+1: la cola de 60 expedientes con 3 motores hace UNA sola lectura por lotes', async () => {
    const m = montar();
    for (let i = 0; i < 60; i += 1) {
      const id = `p${i}`;
      m.lectura.practicas.push(practica(id));
      const dCam = documento(id, TipoDocumento.CAMARA_COMERCIO); const dRut = documento(id, TipoDocumento.RUT_JURIDICO); const dEps = documento(id, TipoDocumento.CERTIFICADO_EPS);
      m.lectura.documentos.push(dCam, dRut, dEps);
      m.lectura.empresariales.set(dCam.id, empresarial(dCam, C.CAMARA_EXISTENCIA_REPRESENTACION));
      m.lectura.empresariales.set(dRut.id, empresarial(dRut, C.RUT_PERSONA_JURIDICA));
      m.lectura.eps.set(dEps.id, eps(dEps));
    }
    await m.caso.listar(coord(), {}, AHORA);
    expect(m.lectura.llamadas).toBe(1);
    await m.caso.expediente('p7', coord(), AHORA);
    expect(m.lectura.llamadas).toBe(2);
    await m.caso.supervision(coord(), AHORA);
    expect(m.lectura.llamadas).toBe(3);
  });

  it('el estado interno de cada motor se conserva tal cual: EPS por su procesamiento/decisión, empresariales por su estado', async () => {
    const m = montar();
    const { dEps } = expedientePruebaCunbre(m);
    const e = await m.caso.expediente('cunbre', coord(), AHORA);
    expect(e.documentos.find((d) => d.documentoId === dEps.id)!.estadoInterno).toBe('procesado');
    expect(new Set(e.documentos.filter((d) => d.documentoId).map((d) => d.estadoInterno))).toEqual(new Set(['procesado', 'aprobado_manual', 'revision']));
  });
});

describe('Mesa documental · supervisión y auditoría', () => {
  it('agrega documentos por revisar, aprobados hoy, devueltos, reservas activas, por vencer y vencidas, con la carga por funcionario y enlace al expediente', async () => {
    const m = montar();
    const { dRut } = expedientePruebaCunbre(m);
    // Otro expediente con una reserva vencida y un documento devuelto.
    m.lectura.practicas.push(practica('otro', { estudianteNombre: 'Otro Estudiante' }));
    const dc = documento('otro', TipoDocumento.CAMARA_COMERCIO);
    const dr = documento('otro', TipoDocumento.RUT_JURIDICO, { estado: EstadoDocumento.DEVUELTO });
    m.lectura.documentos.push(dc, dr);
    m.lectura.empresariales.set(dc.id, empresarial(dc, C.CAMARA_EXISTENCIA_REPRESENTACION, reservada('juan', -2)));
    m.lectura.empresariales.set(dr.id, empresarial(dr, C.RUT_PERSONA_JURIDICA, { estado: EstadoEmp.DEVUELTO, decididoPor: 'juan', decididoEn: AHORA }));
    const s = await m.caso.supervision(coord(), AHORA);
    expect(dRut.id).toBeDefined();
    expect(s).toMatchObject({ expedientesAbiertos: 2, aprobadosHoy: 1, devueltos: 1, reservasActivas: 1, reservasPorVencer: 1, reservasVencidas: 1 });
    expect(s.documentosPorRevisar).toBe(3);
    expect(s.porMotor['camara']).toMatchObject({ porRevisar: 2 });
    expect(s.funcionarios.map((f) => [f.nombre, f.reservasVigentes])).toEqual([['Ana', 1], ['Juan', 0]]);
    expect(s.funcionarios.find((f) => f.nombre === 'Juan')!.documentos[0]).toMatchObject({ practicaId: 'otro', vencida: true });
    expect(s.conReservaVencida).toEqual([{ practicaId: 'otro', estudiante: 'Otro Estudiante', documentos: 1 }]);
  });

  it('abrir un expediente deja un evento liviano de auditoría; listar no; la apertura de PDF y las decisiones son de cada motor', async () => {
    const m = montar();
    expedientePruebaCunbre(m);
    await m.caso.listar(coord(), {}, AHORA);
    expect(m.auditoria.registros).toHaveLength(0);
    await m.caso.expediente('cunbre', coord(), AHORA);
    expect(m.auditoria.acciones('expediente_consultado')).toHaveLength(1);
    expect(m.auditoria.acciones('expediente_consultado')[0].metadatos).toEqual({ origen: 'mesa_documental' });
    expect(m.auditoria.registros).toHaveLength(1);
  });
});

describe('Mesa documental · el agregador NO decide ni reserva', () => {
  const fuente = (ruta: string) => readFileSync(join(__dirname, '..', 'src', ruta), 'utf8');

  it('el caso de uso, el puerto y el adaptador de lectura no contienen escrituras, reservas ni decisiones', () => {
    for (const ruta of [
      'application/use-cases/documentos/expediente-documental.use-case.ts', 'domain/ports/out/expediente-documental.port.ts',
      'infrastructure/adapters/persistence/postgres/expediente-documental.adapter.ts', 'infrastructure/controllers/validacion-documental.controller.ts',
    ]) {
      const texto = fuente(ruta).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(texto).not.toMatch(/\.reservar\(|liberarReserva|\.decidir\(|\.aplicar\(|registrarDecision|\.aprobar\(|\.rechazar\(|\.devolver\(/);
      expect(texto).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
      expect(texto).not.toMatch(/@(Post|Patch|Put|Delete)\(/);
    }
  });

  it('no copia reglas de los motores: no menciona comparación de NIT, firmas, motivos de devolución ni OCR', () => {
    const sinComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const texto = sinComentarios(fuente('application/use-cases/documentos/expediente-documental.use-case.ts') + fuente('domain/services/expediente-documental.domain-service.ts'));
    expect(texto).not.toMatch(/controlarNitLeido|compararNombres|compararRut|compararCamara|MotivoDevolucion|catalogoMotivos|detectarFirma|autenticidad/);
  });
});
