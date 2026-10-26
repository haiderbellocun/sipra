import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BitacoraUseCase } from '../src/application/use-cases/practicas/bitacora.use-case';
import {
  DatosEntradaBitacora, EntradaBitacora, EntradaBitacoraInvalidaError, PREGUNTAS_EVALUA_TU_PROCESO,
  TipoEntradaBitacora, promedioEvaluaTuProceso,
} from '../src/domain/entities/bitacora.entity';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica, documentosExigidos } from '../src/domain/entities/modalidad.entity';
import {
  CalificacionInvalidaError, CicloAcademico, CierreNoPermitidoError, DatosPractica, EstadoPractica, Practica,
} from '../src/domain/entities/practica.entity';
import { CierreDomainService } from '../src/domain/services/cierre.domain-service';
import { EventoNotificable } from '../src/domain/services/plantillas-notificacion.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOY = dia('2026-11-20');

function practicaBase(sobrescribir: Partial<DatosPractica> = {}): Practica {
  return Practica.desde({
    id: 'p1', numeroFur: 7, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG',
    regional: 'Bogotá', asignatura: 'Práctica Profesional I', ciclo: CicloAcademico.PROFESIONAL,
    periodoAcademico: '2026C', modalidad: ModalidadPractica.PASANTIA, estado: EstadoPractica.ACTIVA,
    tutorId: 'doc-1', empresaId: 'emp-1', empresaRazonSocial: 'Andina S.A.S.', empresaNit: '901458772',
    area: null, cargo: 'Practicante', tipoRemuneracion: null, salario: null, horario: null,
    jefeInmediatoNombre: 'Jefe', jefeInmediatoCargo: null, jefeInmediatoCorreo: 'jefe@andina.co',
    jefeInmediatoTelefono: null, ciudad: 'Bogotá', funcionesRelevantes: null,
    fechaInicio: dia('2026-08-10'), fechaFin: dia('2026-11-27'), horasRegistradas: null,
    arlVerificada: true, arlFechaAfiliacion: dia('2026-08-05'), terminosAceptadosEn: dia('2026-08-03'),
    registradaPor: 'estudiante', nota: null, cerradaEn: null,
    ultimaActividad: HOY, creadaEn: HOY, actualizadaEn: HOY, ...sobrescribir,
  });
}

const entradaBase = (sobrescribir: Partial<DatosEntradaBitacora> = {}): DatosEntradaBitacora => ({
  id: 'b1', practicaId: 'p1', tipo: TipoEntradaBitacora.MENSAJE_LIBRE, autor: 'docente', autorId: 'doc-1',
  mensaje: 'Hola', detalle: null, venceEl: null, creadaEn: HOY, ...sobrescribir,
});

describe('Entrada de bitácora', () => {
  it('el mensaje libre no va vacío', () => {
    expect(() => EntradaBitacora.nueva(entradaBase({ mensaje: '   ' }))).toThrow(EntradaBitacoraInvalidaError);
  });

  it('el estudiante no registra seguimientos ni calificaciones', () => {
    expect(() => EntradaBitacora.nueva(entradaBase({ autor: 'estudiante', tipo: TipoEntradaBitacora.SEGUIMIENTO })))
      .toThrow(/no registra entradas/);
    expect(() => EntradaBitacora.nueva(entradaBase({ autor: 'estudiante', tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE })))
      .toThrow(/no registra entradas/);
  });

  it('el seguimiento exige fecha, modalidad de visita y contacto', () => {
    const detalle = {
      fechaVisita: '2026-10-05T14:00:00.000Z', modalidadVisita: 'virtual' as const, contactoNombre: 'Ana Ruiz',
      contactoCargo: 'Líder', contactoArea: 'Logística', sugerenciasPlanMejoramiento: null, evaluacionJefeInmediato: null,
    };
    expect(EntradaBitacora.nueva(entradaBase({ tipo: TipoEntradaBitacora.SEGUIMIENTO, detalle })).tipo)
      .toBe(TipoEntradaBitacora.SEGUIMIENTO);
    expect(() => EntradaBitacora.nueva(entradaBase({
      tipo: TipoEntradaBitacora.SEGUIMIENTO, detalle: { ...detalle, modalidadVisita: 'correo' as never },
    }))).toThrow(/presencial, virtual o telefónica/);
    expect(() => EntradaBitacora.nueva(entradaBase({
      tipo: TipoEntradaBitacora.SEGUIMIENTO, detalle: { ...detalle, contactoNombre: '' },
    }))).toThrow(/con quién/);
  });

  it('«Evalúa tu proceso» tiene cuatro preguntas y todas se responden de 1 a 5', () => {
    expect(PREGUNTAS_EVALUA_TU_PROCESO).toHaveLength(4);
    const respuestas = PREGUNTAS_EVALUA_TU_PROCESO.map((pregunta) => ({ pregunta, valor: 4 }));
    const e = EntradaBitacora.nueva(entradaBase({
      autor: 'estudiante', autorId: 'est-1', tipo: TipoEntradaBitacora.EVALUA_TU_PROCESO,
      mensaje: '', detalle: { respuestas, comentario: null },
    }));
    expect(promedioEvaluaTuProceso({ respuestas, comentario: null })).toBe(4);
    expect(e.autor).toBe('estudiante');
    expect(() => EntradaBitacora.nueva(entradaBase({
      autor: 'estudiante', tipo: TipoEntradaBitacora.EVALUA_TU_PROCESO,
      detalle: { respuestas: respuestas.slice(0, 3), comentario: null },
    }))).toThrow(/4 preguntas/);
    expect(() => EntradaBitacora.nueva(entradaBase({
      autor: 'estudiante', tipo: TipoEntradaBitacora.EVALUA_TU_PROCESO,
      detalle: { respuestas: respuestas.map((r) => ({ ...r, valor: 6 })), comentario: null },
    }))).toThrow(/de 1 a 5/);
  });
});

describe('Calificación y cierre en la práctica', () => {
  it('la nota va de 0,0 a 5,0 con un decimal y solo en práctica', () => {
    const p = practicaBase();
    expect(() => p.calificar(5.5)).toThrow(CalificacionInvalidaError);
    expect(() => p.calificar(4.25)).toThrow(/un solo decimal/);
    p.calificar(4.5, HOY);
    expect(p.nota).toBe(4.5);
    expect(p.aprobada).toBe(true);
    expect(() => practicaBase({ estado: EstadoPractica.INSCRITA }).calificar(4)).toThrow(/no está en curso/);
  });

  it('sin nota no hay cierre', () => {
    expect(() => practicaBase().cerrar(HOY)).toThrow(CierreNoPermitidoError);
  });

  it('con 3,0 o más cierra en «Cerrado»; con menos, en «Reprueba»', () => {
    const aprobada = practicaBase();
    aprobada.calificar(3.0, HOY);
    expect(aprobada.cerrar(HOY)).toBe(EstadoPractica.CERTIFICADA);
    expect(aprobada.estado).toBe(EstadoPractica.CERTIFICADA);
    expect(aprobada.instantanea().cerradaEn).toEqual(HOY);

    const reprobada = practicaBase();
    reprobada.calificar(2.9, HOY);
    expect(reprobada.cerrar(HOY)).toBe(EstadoPractica.REPROBADA);
    expect(reprobada.esTerminal).toBe(true);
    expect(() => reprobada.calificar(4)).toThrow(CalificacionInvalidaError);
  });

  it('el servicio de cierre enumera lo que falta en el orden del manual', () => {
    const servicio = new CierreDomainService();
    const sinNada = servicio.evaluar(practicaBase(), { porcentajeAprobado: 60, evaluaTuProcesoRespondido: false, nota: null });
    expect(sinNada.puedeCerrar).toBe(false);
    expect(sinNada.faltantes).toEqual([
      'Documentos aprobados: 60 % de 100 %',
      'El estudiante no ha respondido «Evalúa tu proceso»',
      'El docente no ha registrado la calificación',
    ]);
    const listo = servicio.evaluar(practicaBase(), { porcentajeAprobado: 100, evaluaTuProcesoRespondido: true, nota: 2.5 });
    expect(listo.puedeCerrar).toBe(true);
    expect(listo.resultado).toBe(EstadoPractica.REPROBADA);
  });
});

// ── Caso de uso con dobles en memoria ────────────────────────────────────
const actorDocente = { id: 'doc-1', correo: 'docente@cun.edu.co', rol: Rol.TUTOR, permiso: 'escritura' as const, escuelas: ['ESC-NEG'], empresaId: null };
const actorEstudiante = { id: 'est-1', correo: 'laura@estudiante.cun.edu.co', rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const actorEmpresa = { id: 'emp-u', correo: 'rrhh@andina.co', rol: Rol.EMPRESA, permiso: 'escritura' as const, escuelas: [], empresaId: 'emp-1' };

function armar(opciones: { aprobados?: number; practica?: Partial<DatosPractica> } = {}) {
  let practica = practicaBase(opciones.practica);
  const entradas: DatosEntradaBitacora[] = [];
  const notificaciones: { evento: EventoNotificable; datos: Record<string, unknown> }[] = [];
  const auditoria: string[] = [];
  const exigidos = documentosExigidos(ModalidadPractica.PASANTIA);
  const aprobados = opciones.aprobados ?? exigidos.length;
  const documentos = exigidos.map((tipo: TipoDocumento, i: number) => ({
    instantanea: () => ({ tipo, version: 1, estado: i < aprobados ? EstadoDocumento.APROBADO : EstadoDocumento.EN_REVISION }),
  }));
  const usuarios: Record<string, { id: string; nombre: string; correo: string }> = {
    'est-1': { id: 'est-1', nombre: 'Laura Ramírez', correo: actorEstudiante.correo },
    'doc-1': { id: 'doc-1', nombre: 'Carlos Pérez', correo: actorDocente.correo },
  };
  const caso = new BitacoraUseCase(
    {
      listarPorPractica: async () => entradas.map((e) => EntradaBitacora.desde(e)),
      listar: async () => entradas.map((e) => EntradaBitacora.desde(e)),
      ultimaPorTipo: async (_p: string, tipo: TipoEntradaBitacora) => {
        const e = [...entradas].reverse().find((x) => x.tipo === tipo);
        return e ? EntradaBitacora.desde(e) : null;
      },
      agregar: async (d: DatosEntradaBitacora) => { entradas.push(d); return EntradaBitacora.desde(d); },
    },
    {
      buscarPorId: async () => practica,
      guardar: async (d: DatosPractica) => { practica = Practica.desde(d); return practica; },
    } as never,
    { listarPorPractica: async () => documentos } as never,
    { buscarPorId: async (id: string) => usuarios[id] ?? null } as never,
    { registrar: async (r: { accion: string }) => { auditoria.push(r.accion); } } as never,
    { notificar: async (evento: EventoNotificable, _d: unknown, datos: Record<string, unknown>) => { notificaciones.push({ evento, datos }); } } as never,
    { numero: async () => 8 } as never,
  );
  return { caso, entradas, notificaciones, auditoria, practica: () => practica };
}

const evalua = () => ({
  tipo: TipoEntradaBitacora.EVALUA_TU_PROCESO,
  evaluaTuProceso: { respuestas: [0, 1, 2, 3].map((pregunta) => ({ pregunta, valor: 5 })), comentario: 'Excelente acompañamiento' },
});

describe('BitacoraUseCase', () => {
  it('la empresa no entra a la bitácora', async () => {
    const { caso } = armar();
    await expect(caso.listar('p1', actorEmpresa)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un mensaje del docente avisa al estudiante y viceversa', async () => {
    const { caso, notificaciones } = armar();
    await caso.escribir('p1', { tipo: TipoEntradaBitacora.MENSAJE_LIBRE, mensaje: 'Recuerde cargar el plan' }, actorDocente, HOY);
    await caso.escribir('p1', { tipo: TipoEntradaBitacora.MENSAJE_LIBRE, mensaje: 'Listo, profe' }, actorEstudiante, HOY);
    expect(notificaciones.map((n) => n.evento)).toEqual([EventoNotificable.MENSAJE_BITACORA, EventoNotificable.MENSAJE_BITACORA]);
    const lista = await caso.listar('p1', actorEstudiante);
    expect(lista.map((e) => [e.autorNombre, e.propia])).toEqual([['Carlos Pérez', false], ['Laura Ramírez', true]]);
  });

  it('el plazo de subsanación vence ocho días después y queda en la entrada', async () => {
    const { caso } = armar();
    const e = await caso.escribir('p1', {
      tipo: TipoEntradaBitacora.PLAZO_SUBSANACION, mensaje: 'Falta el certificado de EPS vigente',
      subsanacion: { documentos: [TipoDocumento.CERTIFICADO_EPS] },
    }, actorDocente, HOY);
    expect(e.venceEl).toBe(dia('2026-11-28').toISOString());
  });

  it('no se califica sin el 100 % de los documentos aprobados', async () => {
    const { caso } = armar({ aprobados: 2 });
    await expect(caso.escribir('p1', {
      tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 4.5 },
    }, actorDocente, HOY)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo el docente asignado califica; el estudiante nunca', async () => {
    const { caso } = armar();
    const otroDocente = { ...actorDocente, id: 'doc-2' };
    await expect(caso.escribir('p1', { tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 4 } }, otroDocente, HOY))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.escribir('p1', { tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 4 } }, actorEstudiante, HOY))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('calificar sin «Evalúa tu proceso» guarda la nota y deja el proceso abierto', async () => {
    const { caso, practica, notificaciones } = armar();
    await caso.escribir('p1', { tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 4.2 } }, actorDocente, HOY);
    expect(practica().nota).toBe(4.2);
    expect(practica().estado).toBe(EstadoPractica.ACTIVA);
    const cierre = await caso.estadoCierre('p1', actorDocente);
    expect(cierre.puedeCerrar).toBe(false);
    expect(cierre.faltantes).toEqual(['El estudiante no ha respondido «Evalúa tu proceso»']);
    expect(notificaciones.some((n) => n.evento === EventoNotificable.PROCESO_CERRADO)).toBe(false);
  });

  it('cuando concurren las tres condiciones el proceso cierra solo, con anotación y correo', async () => {
    const { caso, practica, entradas, notificaciones, auditoria } = armar();
    await caso.escribir('p1', { tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 4.2 } }, actorDocente, HOY);
    await caso.escribir('p1', evalua(), actorEstudiante, HOY);

    expect(practica().estado).toBe(EstadoPractica.CERTIFICADA);
    expect(practica().instantanea().cerradaEn).toEqual(HOY);
    expect(entradas.at(-1)?.tipo).toBe(TipoEntradaBitacora.SISTEMA);
    expect(entradas.at(-1)?.mensaje).toMatch(/Proceso cerrado. Calificación final 4,2: aprobado/);
    expect(auditoria).toContain('practica_cerrada');
    const cerrado = notificaciones.find((n) => n.evento === EventoNotificable.PROCESO_CERRADO);
    expect(cerrado?.datos).toMatchObject({ nota: 4.2, aprobada: true, periodo: '2026C' });
    expect((await caso.estadoCierre('p1', actorEstudiante)).estadoSgp).toBe('Cerrado');
  });

  it('con nota inferior a 3,0 cierra en «Reprueba»', async () => {
    const { caso, practica } = armar();
    await caso.escribir('p1', evalua(), actorEstudiante, HOY);
    await caso.escribir('p1', { tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 2.5 } }, actorDocente, HOY);
    expect(practica().estado).toBe(EstadoPractica.REPROBADA);
    expect((await caso.estadoCierre('p1', actorDocente)).estadoSgp).toBe('Reprueba');
  });

  it('«Evalúa tu proceso» se responde una sola vez', async () => {
    const { caso } = armar();
    await caso.escribir('p1', evalua(), actorEstudiante, HOY);
    await expect(caso.escribir('p1', evalua(), actorEstudiante, HOY)).rejects.toBeInstanceOf(ConflictException);
  });

  it('el cierre explícito exige las condiciones y lo hace coordinación', async () => {
    const { caso, practica } = armar();
    const coordinacion = { ...actorDocente, id: 'coo-1', rol: Rol.COORDINADOR, escuelas: [] };
    await expect(caso.cerrar('p1', coordinacion, HOY)).rejects.toBeInstanceOf(BadRequestException);
    await caso.escribir('p1', evalua(), actorEstudiante, HOY);
    await caso.escribir('p1', { tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, calificacion: { nota: 3.8 } }, coordinacion, HOY);
    expect(practica().estado).toBe(EstadoPractica.CERTIFICADA);
    await expect(caso.escribir('p1', { tipo: TipoEntradaBitacora.SEGUIMIENTO, mensaje: 'x' }, actorDocente, HOY))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('la devolución de un documento deja el plazo en la bitácora y avisa al estudiante', async () => {
    const { caso, entradas, notificaciones } = armar();
    await caso.anotarDevolucion('p1', TipoDocumento.CERTIFICADO_EPS, 'Tiene más de 30 días', actorDocente, HOY);
    expect(entradas[0].tipo).toBe(TipoEntradaBitacora.SISTEMA);
    expect(entradas[0].venceEl).toEqual(dia('2026-11-28'));
    expect(notificaciones[0]).toMatchObject({ evento: EventoNotificable.PLAZO_SUBSANACION });
  });
});
