import { ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona } from '../src/domain/entities/documento-empresarial';
import { Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { ConflictoDecisionRutError, planificarDecisionRut } from '../src/domain/services/decision-rut.domain-service';
import {
  MENSAJES_DEVOLUCION_RUT, MotivoDevolucionRut, RecomendacionRut, calcularPrioridadRut, catalogoMotivosDevolucionRut, esMotivoDevolucionRut,
  estadoRutParaEstudiante, evaluarApartamientoRut, mensajeDevolucionRut, motivoAplicaA, recomendacionRut,
} from '../src/domain/services/mesa-rut.domain-service';
import { esSupervisorRevisionRut, puedeOperarRevisionRut, puedeVerEstadoRutPropio } from '../src/domain/value-objects/acceso-rut.vo';
import { puedeDecidirDocumento } from '../src/domain/value-objects/acceso-eps.vo';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { documentoDe } from './soporte-autorizacion';

const AHORA = new Date('2026-11-04T15:00:00.000Z');
const ENTRADA = { tipoDetectado: C.RUT_PERSONA_NATURAL, expectativa: 'coincide', lecturaDudosa: false, comparacion: { veredicto: 'consistente', hayDiscrepancia: false } };

describe('RUT · recomendación del sistema (una recomendación, no una decisión)', () => {
  it.each([
    [{}, RecomendacionRut.CONSISTENTE],
    [{ comparacion: { veredicto: 'discrepancia', hayDiscrepancia: true } }, RecomendacionRut.DISCREPANCIA_CRITICA],
    [{ lecturaDudosa: true, comparacion: { veredicto: 'revision_necesaria', hayDiscrepancia: false } }, RecomendacionRut.LECTURA_DUDOSA],
    [{ comparacion: { veredicto: 'revision_necesaria', hayDiscrepancia: false } }, RecomendacionRut.INFORMACION_INSUFICIENTE],
    [{ expectativa: 'persona_distinta', comparacion: { veredicto: 'no_aplica', hayDiscrepancia: false } }, RecomendacionRut.PERSONA_DISTINTA],
    [{ tipoDetectado: C.DOCUMENTO_INCORRECTO, comparacion: null }, RecomendacionRut.DOCUMENTO_INCORRECTO],
    [{ tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION, comparacion: null }, RecomendacionRut.DOCUMENTO_INCORRECTO],
    [{ tipoDetectado: C.NO_DETERMINABLE, comparacion: null }, RecomendacionRut.NO_DETERMINABLE],
    [{ tipoDetectado: null, comparacion: null }, RecomendacionRut.NO_DETERMINABLE],
  ])('%j → %s', (sobre, esperada) => {
    expect(recomendacionRut({ ...ENTRADA, ...sobre })).toBe(esperada);
  });

  it('una discrepancia pesa más que una lectura dudosa (la lectura confiable manda)', () => {
    expect(recomendacionRut({ ...ENTRADA, lecturaDudosa: true, comparacion: { veredicto: 'discrepancia', hayDiscrepancia: true } })).toBe(RecomendacionRut.DISCREPANCIA_CRITICA);
  });
});

describe('RUT · justificación según la decisión', () => {
  it('aprobar un RUT consistente: la mínima (no exige una larga)', () => {
    expect(evaluarApartamientoRut('aprobar', RecomendacionRut.CONSISTENTE)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: 10 });
  });
  it.each(Object.values(RecomendacionRut).filter((r) => r !== RecomendacionRut.CONSISTENTE))('aprobar con «%s»: reforzada (40)', (r) => {
    expect(evaluarApartamientoRut('aprobar', r)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: 40 });
  });
  it('rechazar un RUT consistente: ampliada (40); rechazar cualquier otro: la mínima', () => {
    expect(evaluarApartamientoRut('rechazar', RecomendacionRut.CONSISTENTE)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: 40 });
    expect(evaluarApartamientoRut('rechazar', RecomendacionRut.DISCREPANCIA_CRITICA)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: 10 });
  });
  it('devolver nunca se aparta de la recomendación: el motivo y el mensaje son lo que cuenta', () => {
    for (const r of Object.values(RecomendacionRut)) expect(evaluarApartamientoRut('devolver', r).apartaDeRecomendacion).toBe(false);
  });
});

describe('RUT · catálogo canónico de motivos de devolución (vive en el dominio)', () => {
  const catalogo = catalogoMotivosDevolucionRut();
  it('tiene los once motivos iniciales, cada uno con código, título, mensaje al estudiante y si exige detalle', () => {
    expect(catalogo.map((c) => c.codigo).sort()).toEqual([
      'documento_incorrecto', 'documento_ilegible', 'documento_no_coincide', 'dv_no_coincide', 'informacion_incompleta', 'nit_no_coincide',
      'nombre_no_coincide', 'otro', 'persona_no_coincide', 'razon_social_no_coincide', 'rut_no_corresponde',
    ].sort());
    for (const c of catalogo) {
      expect(c.titulo.length).toBeGreaterThan(3);
      expect(c.mensajeEstudiante.que.length).toBeGreaterThan(5);
      expect(c.mensajeEstudiante.hacer.length).toBeGreaterThan(5);
    }
  });
  it('solo «otro» requiere detalle', () => {
    expect(catalogo.filter((c) => c.requiereDetalle).map((c) => c.codigo)).toEqual([MotivoDevolucionRut.OTRO]);
  });
  it('aplica por tipo de RUT: documento/nombre a persona natural; NIT/DV/razón social a jurídica; el resto a ambos', () => {
    for (const m of [MotivoDevolucionRut.DOCUMENTO_NO_COINCIDE, MotivoDevolucionRut.NOMBRE_NO_COINCIDE]) {
      expect(motivoAplicaA(m, TipoPersona.NATURAL)).toBe(true);
      expect(motivoAplicaA(m, TipoPersona.JURIDICA)).toBe(false);
    }
    for (const m of [MotivoDevolucionRut.NIT_NO_COINCIDE, MotivoDevolucionRut.DV_NO_COINCIDE, MotivoDevolucionRut.RAZON_SOCIAL_NO_COINCIDE]) {
      expect(motivoAplicaA(m, TipoPersona.JURIDICA)).toBe(true);
      expect(motivoAplicaA(m, TipoPersona.NATURAL)).toBe(false);
    }
    for (const m of [MotivoDevolucionRut.PERSONA_NO_COINCIDE, MotivoDevolucionRut.ILEGIBLE, MotivoDevolucionRut.DOCUMENTO_INCORRECTO, MotivoDevolucionRut.OTRO]) {
      expect(motivoAplicaA(m, TipoPersona.NATURAL) && motivoAplicaA(m, TipoPersona.JURIDICA)).toBe(true);
    }
    // Sin persona determinable (p. ej. un documento incorrecto) se admite cualquiera.
    expect(motivoAplicaA(MotivoDevolucionRut.NIT_NO_COINCIDE, null)).toBe(true);
  });
  it('el mensaje al estudiante sale del catálogo; con «otro» es el detalle escrito', () => {
    expect(mensajeDevolucionRut(MotivoDevolucionRut.ILEGIBLE, null)).toBe(MENSAJES_DEVOLUCION_RUT[MotivoDevolucionRut.ILEGIBLE].que);
    expect(mensajeDevolucionRut(MotivoDevolucionRut.OTRO, 'Falta la segunda hoja')).toBe('Falta la segunda hoja');
    expect(esMotivoDevolucionRut('otro')).toBe(true);
    expect(esMotivoDevolucionRut('inventado')).toBe(false);
  });
  it('lo que lee el estudiante no menciona códigos internos', () => {
    for (const c of catalogo) expect(JSON.stringify(c.mensajeEstudiante)).not.toMatch(/_|C[0-3]\b|hash|confianza/i);
  });
});

describe('RUT · prioridad explicable', () => {
  it('suma señales: documento incorrecto > discrepancia > persona distinta > lectura dudosa; reenvío y antigüedad suman', () => {
    const p = (recomendacion: RecomendacionRut, version = 1, recibidaEn: Date | null = AHORA) => calcularPrioridadRut({ recomendacion, version, recibidaEn, fechaInicio: null }, AHORA).puntaje;
    expect(p(RecomendacionRut.DOCUMENTO_INCORRECTO)).toBeGreaterThan(p(RecomendacionRut.DISCREPANCIA_CRITICA));
    expect(p(RecomendacionRut.DISCREPANCIA_CRITICA)).toBeGreaterThan(p(RecomendacionRut.PERSONA_DISTINTA));
    expect(p(RecomendacionRut.PERSONA_DISTINTA)).toBeGreaterThan(p(RecomendacionRut.LECTURA_DUDOSA));
    expect(p(RecomendacionRut.CONSISTENTE, 2)).toBeGreaterThan(p(RecomendacionRut.CONSISTENTE, 1));
    expect(p(RecomendacionRut.CONSISTENTE, 1, new Date(AHORA.getTime() - 3 * 86_400_000))).toBe(6);
    expect(calcularPrioridadRut({ recomendacion: RecomendacionRut.CONSISTENTE, version: 1, recibidaEn: AHORA, fechaInicio: null }, AHORA).razones).toEqual([]);
  });
});

describe('RUT · estados humanos del estudiante', () => {
  const doc = (estado: EstadoDocumento, motivo: string | null = null) => ({ estado, motivoDevolucion: motivo });
  it.each([
    [{ documento: null, validacion: null }, 'pendiente'],
    [{ documento: doc(EstadoDocumento.EN_REVISION), validacion: { estado: Estado.PROCESANDO, motivoDecision: null } }, 'en_procesamiento'],
    [{ documento: doc(EstadoDocumento.EN_REVISION), validacion: { estado: Estado.REVISION, motivoDecision: null } }, 'en_revision'],
    [{ documento: doc(EstadoDocumento.EN_REVISION), validacion: { estado: Estado.ERROR, motivoDecision: null } }, 'en_revision'],
    [{ documento: doc(EstadoDocumento.ILEGIBLE), validacion: null }, 'necesita_correccion'],
    [{ documento: doc(EstadoDocumento.DEVUELTO, 'x'), validacion: { estado: Estado.DEVUELTO, motivoDecision: 'documento_ilegible' } }, 'necesita_correccion'],
    [{ documento: doc(EstadoDocumento.APROBADO), validacion: { estado: Estado.APROBADO_MANUAL, motivoDecision: null } }, 'aprobado'],
    [{ documento: doc(EstadoDocumento.RECHAZADO), validacion: { estado: Estado.RECHAZADO, motivoDecision: null } }, 'rechazado'],
  ])('%j → %s', (entrada, esperado) => {
    expect(estadoRutParaEstudiante(entrada as never).estado).toBe(esperado);
  });
  it('solo puede reenviar cuando necesita corrección, no cargó, o fue rechazado; no mientras se revisa ni si está aprobado', () => {
    const r = (estado: Estado, ed = EstadoDocumento.EN_REVISION) => estadoRutParaEstudiante({ documento: doc(ed), validacion: { estado, motivoDecision: null } }).puedeReenviar;
    expect([r(Estado.PROCESANDO), r(Estado.REVISION), r(Estado.APROBADO_MANUAL, EstadoDocumento.APROBADO)]).toEqual([false, false, false]);
    expect([r(Estado.DEVUELTO, EstadoDocumento.DEVUELTO), r(Estado.RECHAZADO, EstadoDocumento.RECHAZADO)]).toEqual([true, true]);
  });
});

describe('RUT · quién opera (NO amplía permisos: reproduce a quien ya decide el RUT)', () => {
  it('operan docente, coordinación y administración; supervisan coordinación y administración', () => {
    expect([Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR].map(puedeOperarRevisionRut)).toEqual([true, true, true]);
    expect([Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION, Rol.AUXILIAR].map(puedeOperarRevisionRut)).toEqual([false, false, false, false]);
    expect([Rol.COORDINADOR, Rol.ADMINISTRADOR].map(esSupervisorRevisionRut)).toEqual([true, true]);
    expect([Rol.TUTOR, Rol.AUXILIAR, Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION].map(esSupervisorRevisionRut)).toEqual([false, false, false, false, false]);
    expect(puedeVerEstadoRutPropio(Rol.ESTUDIANTE)).toBe(true);
    expect(puedeVerEstadoRutPropio(Rol.TUTOR)).toBe(false);
  });
  it('coincide EXACTAMENTE con quien ya decidía el RUT antes de la Mesa (`puedeDecidirDocumento`)', () => {
    for (const rol of Object.values(Rol)) {
      for (const tipo of [TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO]) {
        expect(puedeOperarRevisionRut(rol)).toBe(puedeDecidirDocumento(rol, tipo));
      }
    }
  });
});

/** El motivo del conflicto que lanza el planificador (o `undefined` si no lanza). */
const motivoDe = (accion: () => unknown): string | undefined => {
  try { accion(); } catch (e) { return (e as ConflictoDecisionRutError).motivo; }
  return undefined;
};

describe('RUT · decisión atómica (núcleo puro)', () => {
  const validacionRevisable = (sobre: { asignadoA?: string | null; reservaHasta?: Date | null; reservadoEn?: Date | null } = {}) => {
    const v = ValidacionDocumentoEmpresarial.pendiente({ id: 'v1', documentoId: 'd1', practicaId: 'p1', estudianteId: 'e1', tipoEsperado: TipoDocumento.RUT_NATURAL, recibidaEn: AHORA, ahora: AHORA });
    return ValidacionDocumentoEmpresarial.desde({
      ...v.instantanea(), estado: Estado.REVISION, tipoDetectado: C.RUT_PERSONA_NATURAL, tipoPersona: TipoPersona.NATURAL, hashDocumento: 'a'.repeat(64), procesadaEn: AHORA,
      asignadoA: 't1', reservadoEn: AHORA, reservaHasta: new Date(AHORA.getTime() + 15 * 60_000), ...sobre,
    });
  };
  const documento = (estado = EstadoDocumento.EN_REVISION, version = 1) => documentoDe(TipoDocumento.RUT_NATURAL, { id: 'd1', practicaId: 'p1', estado, version, decididoPor: null });
  const entrada = { decision: 'aprobar' as const, justificacion: 'RUT revisado', motivo: null, ahora: AHORA, contextoAuditoria: {}, actor: { id: 't1', correo: 't1@cun.edu.co', rol: Rol.TUTOR } };

  it('construye TODO lo que se escribe: documento decidido, validación decidida sin reserva, una evidencia y dos auditorías', () => {
    const plan = planificarDecisionRut({ validacion: validacionRevisable(), documento: documento(), versionMaximaRut: 1 }, entrada);
    expect(plan.documento.estado).toBe(EstadoDocumento.APROBADO);
    expect(plan.validacion.instantanea()).toMatchObject({ estado: Estado.APROBADO_MANUAL, decididoPor: 't1', decididoEn: AHORA, asignadoA: null, reservadoEn: null, reservaHasta: null });
    expect(plan.evidencia).toMatchObject({ tipo: 'decision_humana', actorId: 't1', resultado: 'aprobar', fecha: AHORA });
    expect(plan.auditorias.map((a) => a.accion)).toEqual(['decision_documento', 'decision_rut']);
  });

  it.each([
    ['ya_decidida', () => ({
      validacion: ValidacionDocumentoEmpresarial.desde({
        ...validacionRevisable().instantanea(), estado: Estado.APROBADO_MANUAL, decididoPor: 't1', decididoEn: AHORA, asignadoA: null, reservadoEn: null, reservaHasta: null,
      }),
      documento: documento(EstadoDocumento.APROBADO), versionMaximaRut: 1,
    })],
    // El documento tiene decisión pero la validación sigue en revisión: se detecta, nunca se corrige solo.
    ['inconsistente', () => ({ validacion: validacionRevisable(), documento: documento(EstadoDocumento.RECHAZADO), versionMaximaRut: 1 })],
    ['version_vieja', () => ({ validacion: validacionRevisable(), documento: documento(EstadoDocumento.EN_REVISION, 1), versionMaximaRut: 2 })],
    ['reserva', () => ({ validacion: validacionRevisable({ asignadoA: 'otro' }), documento: documento(), versionMaximaRut: 1 })],
    ['reserva', () => ({ validacion: validacionRevisable({ reservaHasta: new Date(AHORA.getTime() - 1) , reservadoEn: new Date(AHORA.getTime() - 2) }), documento: documento(), versionMaximaRut: 1 })],
  ])('conflicto «%s»: no procede y no escribe', (motivo, leer) => {
    expect(motivoDe(() => planificarDecisionRut(leer() as never, entrada))).toBe(motivo);
    expect(() => planificarDecisionRut(leer() as never, entrada)).toThrow(ConflictoDecisionRutError);
  });

  it('una validación que no está en revisión (procesando, error, ya decidida) no es revisable', () => {
    const v = ValidacionDocumentoEmpresarial.desde({ ...validacionRevisable().instantanea(), estado: Estado.PROCESANDO, asignadoA: null, reservadoEn: null, reservaHasta: null });
    expect(motivoDe(() => planificarDecisionRut({ validacion: v, documento: documento(), versionMaximaRut: 1 }, entrada))).toBe('no_revisable');
  });
});

describe('RUT · la validación decidida', () => {
  const revisable = () => ValidacionDocumentoEmpresarial.desde({
    ...ValidacionDocumentoEmpresarial.pendiente({ id: 'v1', documentoId: 'd1', practicaId: 'p1', estudianteId: 'e1', tipoEsperado: 'rut_natural', recibidaEn: AHORA, ahora: AHORA }).instantanea(),
    estado: Estado.REVISION, tipoDetectado: C.RUT_PERSONA_NATURAL, hashDocumento: 'a'.repeat(64), procesadaEn: AHORA,
  });
  it('devolver exige motivo; el motivo solo se conserva al devolver; toda decisión libera la reserva', () => {
    const v = revisable();
    expect(() => v.registrarDecision('devolver', 't1', AHORA, null)).toThrow();
    const a = revisable();
    a.registrarDecision('aprobar', 't1', AHORA, 'documento_ilegible');
    expect(a.instantanea()).toMatchObject({ estado: Estado.APROBADO_MANUAL });
    const d = revisable();
    d.registrarDecision('devolver', 't1', AHORA, 'documento_ilegible');
    expect(d.instantanea()).toMatchObject({ estado: Estado.DEVUELTO, motivoDecision: 'documento_ilegible', asignadoA: null });
  });
  it('una decisión terminal NO se reabre ni se decide otra vez; solo admite la constancia de cambio de datos de SIPRA', () => {
    const v = revisable();
    v.registrarDecision('aprobar', 't1', AHORA, null);
    expect(() => v.registrarDecision('rechazar', 't2', AHORA, null)).toThrow();
    expect(() => v.aplicarRecalculoComparacion({ version: 1, campos: [], hayDiscrepancia: false } as never, AHORA)).toThrow();
    const antes = v.instantanea();
    v.marcarCambioDeDatosPosterior(new Date(AHORA.getTime() + 1000));
    expect(v.instantanea()).toMatchObject({ estado: Estado.APROBADO_MANUAL, decididoPor: 't1', decididoEn: AHORA, comparacion: antes.comparacion });
    expect(() => revisable().marcarCambioDeDatosPosterior(AHORA)).toThrow();
  });
  it('estaProcesada incluye lo decidido (no se vuelve a leer ni a procesar); solo «revision» es revisable', () => {
    const v = revisable();
    expect([v.estaProcesada, v.estaRevisable, v.estaDecidida]).toEqual([true, true, false]);
    v.registrarDecision('aprobar', 't1', AHORA, null);
    expect([v.estaProcesada, v.estaRevisable, v.estaDecidida]).toEqual([true, false, true]);
  });
});

// Evita un import sin uso si el soporte cambia: el documento de prueba debe poder construirse con el modelo real.
void Documento;
