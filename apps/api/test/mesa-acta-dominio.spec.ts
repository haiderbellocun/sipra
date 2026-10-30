import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EstadoDocumento } from '../src/domain/entities/documento.entity';
import { EstadoValidacionActa } from '../src/domain/entities/validacion-acta.entity';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from '../src/domain/services/justificacion-decision';
import {
  MENSAJES_DEVOLUCION_ACTA, MotivoDevolucionActa, PESOS_PRIORIDAD_ACTA, RecomendacionActa, calcularPrioridadActa,
  estadoActaParaEstudiante, evaluarApartamientoActa, mensajeDevolucionActa, recomendacionActa,
} from '../src/domain/services/mesa-acta.domain-service';
import { JUSTIFICACION_MINIMA as MINIMA_EPS, JUSTIFICACION_REFORZADA as REFORZADA_EPS } from '../src/domain/services/mesa-eps.domain-service';
import { esSupervisorMesaActas, puedeCorregirDatosConActa, puedeOperarMesaActas, puedeVerEstadoActaPropio } from '../src/domain/value-objects/acceso-acta.vo';
import { Rol } from '../src/domain/value-objects/rol.vo';

const AHORA = new Date('2026-08-10T15:00:00.000Z');
const DIA = 86_400_000;
const base = {
  tipoActaDetectada: 'iniciacion_practicas' as const, hayDiscrepanciaCritica: false, firmaEmpresa: 'si' as const, firmaPracticante: 'si' as const,
  version: 1, recibidaEn: AHORA, fechaInicio: new Date(AHORA.getTime() + 60 * DIA),
};

describe('Mesa de Actas · roles (no se amplían permisos por accidente)', () => {
  it('operan auxiliar, coordinación y administración; el resto no', () => {
    for (const rol of Object.values(Rol)) {
      expect(puedeOperarMesaActas(rol)).toBe([Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR].includes(rol));
    }
  });
  it('supervisan y corrigen datos de la práctica solo coordinación y administración', () => {
    for (const rol of Object.values(Rol)) {
      const esperado = [Rol.COORDINADOR, Rol.ADMINISTRADOR].includes(rol);
      expect(esSupervisorMesaActas(rol)).toBe(esperado);
      expect(puedeCorregirDatosConActa(rol)).toBe(esperado);
    }
  });
  it('el estudiante solo ve el estado de su acta', () => {
    expect(Object.values(Rol).filter(puedeVerEstadoActaPropio)).toEqual([Rol.ESTUDIANTE]);
  });
});

describe('Mesa de Actas · justificación: una sola regla institucional', () => {
  it('es la MISMA definición que usa la Mesa de EPS (10 y 40), no una regla paralela', () => {
    expect([JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA]).toEqual([10, 40]);
    expect([MINIMA_EPS, REFORZADA_EPS]).toEqual([JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA]);
  });

  it('apartarse de la recomendación exige la reforzada: aprobar con algo crítico, ajeno, sin firma o indeterminado; rechazar lo consistente', () => {
    for (const r of [RecomendacionActa.DISCREPANCIA_CRITICA, RecomendacionActa.DOCUMENTO_INCORRECTO, RecomendacionActa.FIRMA_FALTANTE, RecomendacionActa.NO_DETERMINABLE]) {
      expect(evaluarApartamientoActa('aprobar', r)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: 40 });
    }
    expect(evaluarApartamientoActa('rechazar', RecomendacionActa.CONSISTENTE)).toMatchObject({ apartaDeRecomendacion: true, minimoJustificacion: 40 });
  });

  it('lo demás pide la mínima: aprobar lo consistente o por revisar; devolver o rechazar lo problemático', () => {
    expect(evaluarApartamientoActa('aprobar', RecomendacionActa.CONSISTENTE)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: 10 });
    expect(evaluarApartamientoActa('aprobar', RecomendacionActa.REVISAR)).toMatchObject({ apartaDeRecomendacion: false });
    expect(evaluarApartamientoActa('devolver', RecomendacionActa.DISCREPANCIA_CRITICA)).toMatchObject({ apartaDeRecomendacion: false });
    expect(evaluarApartamientoActa('rechazar', RecomendacionActa.DOCUMENTO_INCORRECTO)).toMatchObject({ apartaDeRecomendacion: false, minimoJustificacion: 10 });
  });
});

describe('Mesa de Actas · recomendación del sistema', () => {
  const v = (cambios: Partial<Parameters<typeof recomendacionActa>[0]> = {}) => recomendacionActa({
    tipoActaDetectada: 'iniciacion_practicas', hayDiscrepanciaCritica: false, firmaEmpresa: 'si', firmaPracticante: 'si',
    comparacion: { veredicto: 'consistente' } as never, ...cambios,
  });
  it('una recomendación para cada situación, en orden de gravedad', () => {
    expect(v()).toBe(RecomendacionActa.CONSISTENTE);
    expect(v({ tipoActaDetectada: 'documento_incorrecto' })).toBe(RecomendacionActa.DOCUMENTO_INCORRECTO);
    expect(v({ tipoActaDetectada: 'no_determinable' })).toBe(RecomendacionActa.NO_DETERMINABLE);
    expect(v({ tipoActaDetectada: null })).toBe(RecomendacionActa.NO_DETERMINABLE);
    expect(v({ hayDiscrepanciaCritica: true })).toBe(RecomendacionActa.DISCREPANCIA_CRITICA);
    expect(v({ firmaEmpresa: 'no' })).toBe(RecomendacionActa.FIRMA_FALTANTE);
    expect(v({ comparacion: { veredicto: 'revision_necesaria' } as never })).toBe(RecomendacionActa.REVISAR);
    // Una firma «no determinable» no es una firma faltante: lo ve una persona.
    expect(v({ firmaPracticante: 'no_determinable' })).toBe(RecomendacionActa.CONSISTENTE);
  });
});

describe('Mesa de Actas · prioridad: simple, explicable y sin IA', () => {
  it('sin señales vale 0 y no tiene razones', () => {
    expect(calcularPrioridadActa(base, AHORA)).toEqual({ puntaje: 0, razones: [] });
  });

  it('suma señales visibles, cada una con su razón', () => {
    const p = calcularPrioridadActa({
      ...base, tipoActaDetectada: 'documento_incorrecto', hayDiscrepanciaCritica: true, firmaEmpresa: 'no', version: 3,
      recibidaEn: new Date(AHORA.getTime() - 4 * DIA), fechaInicio: new Date(AHORA.getTime() + 3 * DIA),
    }, AHORA);
    const P = PESOS_PRIORIDAD_ACTA;
    expect(p.puntaje).toBe(P.documentoIncorrecto + P.discrepanciaCritica + P.firmaFaltante + P.reenvio + 4 * P.porDiaEnBandeja + P.inicioEnUnaSemana);
    expect(p.razones).toEqual([
      'Parece otro documento', 'Hay una discrepancia crítica', 'Falta una firma', 'Reenvío (versión 3)', '4 día(s) en bandeja',
      'La práctica inicia en una semana o menos',
    ]);
  });

  it('la antigüedad tiene tope y la fecha de inicio pesa más cuanto más cerca está (o si ya pasó)', () => {
    const P = PESOS_PRIORIDAD_ACTA;
    expect(calcularPrioridadActa({ ...base, recibidaEn: new Date(AHORA.getTime() - 90 * DIA) }, AHORA).puntaje).toBe(P.topeDiasEnBandeja * P.porDiaEnBandeja);
    expect(calcularPrioridadActa({ ...base, fechaInicio: new Date(AHORA.getTime() + 10 * DIA) }, AHORA).puntaje).toBe(P.inicioEnDosSemanas);
    expect(calcularPrioridadActa({ ...base, fechaInicio: new Date(AHORA.getTime() - 5 * DIA) }, AHORA).puntaje).toBe(P.inicioYaPasado);
  });

  it('una firma que no se pudo determinar suma poco; una faltante, más; un documento ajeno no suma por firma', () => {
    expect(calcularPrioridadActa({ ...base, firmaPracticante: 'no_determinable' }, AHORA).puntaje).toBe(PESOS_PRIORIDAD_ACTA.firmaSinDeterminar);
    expect(calcularPrioridadActa({ ...base, tipoActaDetectada: 'documento_incorrecto', firmaEmpresa: 'no_determinable', firmaPracticante: 'no_determinable' }, AHORA).puntaje)
      .toBe(PESOS_PRIORIDAD_ACTA.documentoIncorrecto);
  });
});

describe('Mesa de Actas · motivos de devolución', () => {
  it('cada motivo tiene qué ocurrió y qué hacer, en lenguaje humano y sin códigos', () => {
    for (const motivo of Object.values(MotivoDevolucionActa)) {
      const m = MENSAJES_DEVOLUCION_ACTA[motivo];
      expect(m.que.length).toBeGreaterThan(15);
      expect(m.hacer.length).toBeGreaterThan(15);
      expect(`${m.que} ${m.hacer}`).not.toMatch(/_|[A-Z]{3,}_|código|C[0-3]_/);
    }
  });

  it('el motivo de la ARL dice exactamente lo que el estudiante debe entender y hacer', () => {
    expect(MENSAJES_DEVOLUCION_ACTA[MotivoDevolucionActa.ARL_NO_COINCIDE]).toEqual({
      que: 'El responsable de la ARL indicado en el acta no coincide con la información registrada en tu práctica.',
      hacer: 'Contacta a coordinación o carga el documento correcto, según corresponda.',
    });
  });

  it('con «otro» manda la explicación de quien revisó; con los demás, el mensaje del catálogo más la nota opcional', () => {
    expect(mensajeDevolucionActa(MotivoDevolucionActa.OTRO, ' Falta la hoja 2. ')).toBe('Falta la hoja 2.');
    expect(mensajeDevolucionActa(MotivoDevolucionActa.FALTA_FIRMA_EMPRESA, null)).toBe('Al acta le falta la firma de la empresa.');
    expect(mensajeDevolucionActa(MotivoDevolucionActa.FALTA_FIRMA_EMPRESA, 'Es la de la página 2.')).toBe('Al acta le falta la firma de la empresa. Es la de la página 2.');
  });

  it('el catálogo de la base (CHECK de la migración) es el mismo que el del dominio', () => {
    const sql = readFileSync(join(__dirname, '../src/infrastructure/persistence/postgres/migrations/1756000018000-MesaActas.ts'), 'utf8');
    const bloque = /ck_vacta_motivo CHECK \(motivo_decision IS NULL OR motivo_decision IN\s*\(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
    const enBase = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enBase).toEqual(Object.values(MotivoDevolucionActa).sort());
  });
});

describe('Estado del acta para el estudiante (dominio)', () => {
  const e = (documento: EstadoDocumento | null, validacion: EstadoValidacionActa | null, motivo: string | null = null, motivoDoc: string | null = null) =>
    estadoActaParaEstudiante({ documento: documento ? { estado: documento, motivoDevolucion: motivoDoc } : null, validacion: validacion ? { estado: validacion, motivoDecision: motivo } : null });

  it.each([
    [null, null, 'Acta pendiente de cargar'],
    [EstadoDocumento.RECIBIDO, EstadoValidacionActa.PENDIENTE, 'Acta pendiente de procesar'],
    [EstadoDocumento.RECIBIDO, null, 'Acta pendiente de procesar'],
    [EstadoDocumento.ANALIZANDO, EstadoValidacionActa.PROCESANDO, 'Estamos revisando tu acta'],
    [EstadoDocumento.EN_REVISION, EstadoValidacionActa.REVISION, 'Acta en revisión'],
    [EstadoDocumento.DEVUELTO, EstadoValidacionActa.DEVUELTO, 'Necesita corrección'],
    [EstadoDocumento.APROBADO, EstadoValidacionActa.APROBADO_MANUAL, 'Acta validada'],
    [EstadoDocumento.RECHAZADO, EstadoValidacionActa.RECHAZADO, 'Acta rechazada'],
    [EstadoDocumento.ILEGIBLE, EstadoValidacionActa.REVISION, 'Necesita revisión'],
    [EstadoDocumento.EN_REVISION, EstadoValidacionActa.ERROR, 'Necesita revisión'],
  ])('documento %s + validación %s → «%s»', (doc, val, etiqueta) => {
    const r = e(doc, val);
    expect(r.etiqueta).toBe(etiqueta);
    expect(r.que.length).toBeGreaterThan(10);
    expect(r.hacer.length).toBeGreaterThan(10);
    expect(JSON.stringify(r)).not.toMatch(/aprobado_manual|devuelto|"revision"|procesando|_manual|C[0-3]_|documento_incorrecto/);
  });

  it('solo puede reenviar cuando algo debe corregirse o rehacerse', () => {
    expect(e(EstadoDocumento.DEVUELTO, EstadoValidacionActa.DEVUELTO, 'otro').puedeReenviar).toBe(true);
    expect(e(EstadoDocumento.RECHAZADO, EstadoValidacionActa.RECHAZADO).puedeReenviar).toBe(true);
    expect(e(null, null).puedeReenviar).toBe(true);
    expect(e(EstadoDocumento.EN_REVISION, EstadoValidacionActa.REVISION).puedeReenviar).toBe(false);
    expect(e(EstadoDocumento.APROBADO, EstadoValidacionActa.APROBADO_MANUAL).puedeReenviar).toBe(false);
  });

  it('una devolución sin motivo reconocido cae en el mensaje general, con lo que escribió quien revisó', () => {
    expect(e(EstadoDocumento.DEVUELTO, EstadoValidacionActa.DEVUELTO, null, 'Revisa el formato.').que).toBe('Revisa el formato.');
  });
});
