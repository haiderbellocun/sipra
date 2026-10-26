import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PqrsUseCase } from '../src/application/use-cases/administracion/pqrs.use-case';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import {
  CATEGORIAS_AYUDA, PREGUNTAS_FRECUENTES, buscarPreguntas,
} from '../src/domain/entities/preguntas-frecuentes';
import {
  CATEGORIAS_PQRS, DatosPqrs, EstadoPqrs, SolicitudPqrs,
} from '../src/domain/entities/pqrs.entity';
import { Usuario } from '../src/domain/entities/usuario.entity';
import { FiltroPqrs } from '../src/domain/ports/out/repositorios.port';
import { EventoNotificable } from '../src/domain/services/plantillas-notificacion.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';

const HOY = new Date('2026-10-05T12:00:00.000Z');

describe('Centro de ayuda (documento PQRS de Desarrollo Profesional)', () => {
  it('trae las 123 preguntas en las dieciséis categorías, y cada categoría tiene al menos una', () => {
    expect(PREGUNTAS_FRECUENTES).toHaveLength(123);
    expect(CATEGORIAS_AYUDA.map((c) => c.clave)).toEqual([...CATEGORIAS_PQRS]);
    for (const c of CATEGORIAS_AYUDA) {
      expect(PREGUNTAS_FRECUENTES.some((p) => p.categoria === c.clave)).toBe(true);
      expect(c.pantallas.length).toBeGreaterThan(0);
    }
    const numeros = PREGUNTAS_FRECUENTES.map((p) => p.numero);
    expect(new Set(numeros).size).toBe(123);
  });

  it('busca sin tildes ni mayúsculas, y filtra por categoría', () => {
    const arl = buscarPreguntas('AFILIACION arl');
    expect(arl.length).toBeGreaterThan(0);
    expect(arl.every((p) => /arl/i.test(`${p.pregunta} ${p.respuesta}`))).toBe(true);
    const soloCarta = buscarPreguntas('', 'carta_de_presentacion');
    expect(soloCarta.every((p) => p.categoria === 'carta_de_presentacion')).toBe(true);
    expect(buscarPreguntas('zzzz-nada-que-ver')).toHaveLength(0);
  });

  it('las respuestas hablan de SIPRA, no de rutas del SGP anterior', () => {
    expect(PREGUNTAS_FRECUENTES.some((p) => /sgp\.cun\.edu\.co|sgp\/login/i.test(p.respuesta))).toBe(false);
  });
});

describe('Entidad SolicitudPqrs', () => {
  const datos = (extra: Partial<DatosPqrs> = {}): DatosPqrs => ({
    id: 'q1', radicado: 1, estudianteId: 'est-1', practicaId: null, tipo: 'peticion', categoria: 'fechas_y_cronograma',
    asunto: 'Fecha límite de registro', descripcion: 'Quiero saber hasta cuándo puedo registrar mi práctica este periodo.',
    estado: EstadoPqrs.RADICADA, respuesta: null, respondidaPor: null, respondidaEn: null, unificadaConId: null,
    radicadaEn: HOY, actualizadaEn: HOY, ...extra,
  });

  it('exige asunto y descripción con contenido, categoría y tipo conocidos', () => {
    expect(() => SolicitudPqrs.nueva(datos({ asunto: 'ok' }))).toThrow(/asunto/);
    expect(() => SolicitudPqrs.nueva(datos({ descripcion: 'corta' }))).toThrow(/mínimo 20/);
    expect(() => SolicitudPqrs.nueva(datos({ categoria: 'otra' as never }))).toThrow(/Categoría/);
    expect(() => SolicitudPqrs.nueva(datos({ tipo: 'otro' as never }))).toThrow(/Tipo/);
    expect(SolicitudPqrs.nueva(datos()).estado).toBe(EstadoPqrs.RADICADA);
  });

  it('se responde en el radicado, se puede complementar y solo se cierra respondida', () => {
    const s = SolicitudPqrs.nueva(datos());
    expect(() => s.cerrar()).toThrow(/respondida/);
    s.tomar(HOY);
    expect(s.estado).toBe(EstadoPqrs.EN_TRAMITE);
    expect(() => s.responder('coo-1', 'corta')).toThrow(/mínimo 10/);
    s.responder('coo-1', 'El registro cierra dos meses después del inicio del periodo.', HOY);
    s.responder('coo-1', 'Complemento: para 2026C, el 21 de septiembre.', HOY);
    expect(s.estado).toBe(EstadoPqrs.RESPONDIDA);
    s.cerrar(HOY);
    expect(s.estado).toBe(EstadoPqrs.CERRADA);
    expect(() => s.responder('coo-1', 'Ya no se puede responder esto')).toThrow(/cerrada/);
  });

  it('la duplicada se unifica con el radicado inicial y queda cerrada allí', () => {
    const inicial = SolicitudPqrs.nueva(datos());
    const repetida = SolicitudPqrs.nueva(datos({ id: 'q2', radicado: 2 }));
    expect(() => inicial.unificarCon(inicial)).toThrow(/consigo misma/);
    repetida.unificarCon(inicial, HOY);
    expect(repetida.estado).toBe(EstadoPqrs.UNIFICADA);
    expect(repetida.instantanea().unificadaConId).toBe('q1');
    expect(repetida.instantanea().respuesta).toMatch(/radicado n.º 1/);
    expect(() => repetida.cerrar()).toThrow(/unificada/);
  });
});

describe('PqrsUseCase', () => {
  const estudiante = Usuario.desde({
    id: 'est-1', correo: 'laura@estudiante.cun.edu.co', nombre: 'Laura Ramírez', documento: '1032456786', rol: Rol.ESTUDIANTE,
    permiso: 'escritura', escuelas: ['ESC-NEG'], empresaId: null, programaId: 'ADM-PRO', activo: true, creadoEn: HOY, ultimoAccesoEn: null,
  });
  const actorEstudiante = { id: 'est-1', correo: estudiante.correo, rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };
  const otroEstudiante = { ...actorEstudiante, id: 'est-2', correo: 'otro@estudiante.cun.edu.co' };
  const actorCoordinacion = { id: 'coo-1', correo: 'coordinacion@cun.edu.co', rol: Rol.COORDINADOR, permiso: 'escritura' as const, escuelas: [], empresaId: null };
  const actorTutor = { ...actorCoordinacion, id: 'doc-1', rol: Rol.TUTOR };

  function armar() {
    const filas: DatosPqrs[] = [];
    const notificaciones: { evento: EventoNotificable; datos: Record<string, unknown> }[] = [];
    const auditoria: { accion: string; metadatos: Record<string, unknown> }[] = [];
    const caso = new PqrsUseCase(
      {
        buscarPorId: async (id: string) => { const d = filas.find((f) => f.id === id); return d ? SolicitudPqrs.desde(d) : null; },
        buscarAbierta: async (estudianteId: string, categoria: string) => {
          const d = filas.find((f) => f.estudianteId === estudianteId && f.categoria === categoria && ['radicada', 'en_tramite'].includes(f.estado));
          return d ? SolicitudPqrs.desde(d) : null;
        },
        listar: async (f: FiltroPqrs) => filas
          .filter((d) => (!f.estudianteId || d.estudianteId === f.estudianteId) && (!f.estado || d.estado === f.estado))
          .map((d) => SolicitudPqrs.desde(d)),
        guardar: async (d: DatosPqrs) => {
          const i = filas.findIndex((f) => f.id === d.id);
          const con = { ...d, radicado: d.radicado ?? filas.length + 1 };
          if (i >= 0) filas[i] = con; else filas.push(con);
          return SolicitudPqrs.desde(con);
        },
      },
      { buscarPorId: async (id: string) => (id === 'est-1' ? estudiante : null) } as never,
      { buscarPorId: async () => null } as never,
      { registrar: async (r: { accion: string; metadatos: Record<string, unknown> }) => { auditoria.push(r); } } as never,
      { notificar: async (evento: EventoNotificable, _d: unknown, datos: Record<string, unknown>) => { notificaciones.push({ evento, datos }); } } as never,
    );
    return { caso, filas, notificaciones, auditoria };
  }

  const solicitud = {
    tipo: 'peticion' as const, categoria: 'afiliacion_y_cobertura_de_arl_y_eps' as const,
    asunto: 'No me llega el certificado de ARL',
    descripcion: 'Radiqué la solicitud de ARL hace una semana y todavía no veo el certificado en mi expediente.',
  };

  it('el estudiante radica, recibe radicado, correo y sugerencias de la ayuda; queda en auditoría', async () => {
    const { caso, notificaciones, auditoria } = armar();
    const r = await caso.radicar(solicitud, actorEstudiante, HOY);
    expect(r.radicado).toBe(1);
    expect(r.estado).toBe(EstadoPqrs.RADICADA);
    expect(r.categoriaEtiqueta).toMatch(/ARL/);
    expect(r.sugerencias?.length).toBeGreaterThan(0);
    expect(r.sugerencias?.every((p) => p.categoria === solicitud.categoria)).toBe(true);
    expect(notificaciones.map((n) => n.evento)).toEqual([EventoNotificable.PQRS_RADICADA]);
    expect(notificaciones[0].datos.consecutivo).toBe(1);
    expect(auditoria[0].accion).toBe(AccionAuditada.PQRS_RADICADA);
    await expect(caso.radicar({ ...solicitud, descripcion: 'corta' }, actorEstudiante, HOY)).rejects.toBeInstanceOf(BadRequestException);
    await expect(caso.radicar(solicitud, actorCoordinacion, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.radicar({ ...solicitud, practicaId: 'p-ajena' }, actorEstudiante, HOY)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un segundo requerimiento abierto sobre el mismo tema se unifica con el radicado inicial, sin nuevo correo', async () => {
    const { caso, notificaciones } = armar();
    const inicial = await caso.radicar(solicitud, actorEstudiante, HOY);
    const repetida = await caso.radicar({ ...solicitud, asunto: 'Insisto con la ARL' }, actorEstudiante, HOY);
    expect(repetida.estado).toBe(EstadoPqrs.UNIFICADA);
    expect(repetida.unificadaConId).toBe(inicial.id);
    expect(repetida.unificadaConRadicado).toBe(1);
    expect(notificaciones).toHaveLength(1);
    const otroTema = await caso.radicar({ ...solicitud, categoria: 'fechas_y_cronograma' }, actorEstudiante, HOY);
    expect(otroTema.estado).toBe(EstadoPqrs.RADICADA);
  });

  it('coordinación responde en el radicado y el estudiante recibe la respuesta; luego se cierra', async () => {
    const { caso, notificaciones, auditoria } = armar();
    const r = await caso.radicar(solicitud, actorEstudiante, HOY);
    await expect(caso.responder(r.id, 'Ya quedó.', actorEstudiante, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.responder(r.id, 'Ya quedó.', actorTutor, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    const tomada = await caso.tomar(r.id, actorCoordinacion, HOY);
    expect(tomada.estado).toBe(EstadoPqrs.EN_TRAMITE);
    const respondida = await caso.responder(r.id, 'El certificado se envía al expediente al día siguiente de la aprobación del auxiliar.', actorCoordinacion, HOY);
    expect(respondida.estado).toBe(EstadoPqrs.RESPONDIDA);
    expect(respondida.respondidaPor).toBe('coo-1');
    expect(notificaciones.at(-1)?.evento).toBe(EventoNotificable.PQRS_RESPONDIDA);
    expect(auditoria.at(-1)?.accion).toBe(AccionAuditada.PQRS_RESPONDIDA);
    const cerrada = await caso.cerrar(r.id, actorEstudiante, HOY);
    expect(cerrada.estado).toBe(EstadoPqrs.CERRADA);
  });

  it('cada estudiante ve solo las suyas; la bandeja la ven coordinación, auxiliares y administración', async () => {
    const { caso } = armar();
    const r = await caso.radicar(solicitud, actorEstudiante, HOY);
    expect(await caso.listar({}, actorEstudiante)).toHaveLength(1);
    expect(await caso.listar({}, otroEstudiante)).toHaveLength(0);
    await expect(caso.obtener(r.id, otroEstudiante)).rejects.toBeInstanceOf(NotFoundException);
    expect(await caso.listar({}, actorCoordinacion)).toHaveLength(1);
    expect(await caso.listar({}, { ...actorCoordinacion, rol: Rol.AUXILIAR })).toHaveLength(1);
    await expect(caso.listar({}, actorTutor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(caso.categorias()).toHaveLength(16);
    expect(caso.buscar('carta', 'carta_de_presentacion').length).toBeGreaterThan(0);
    expect(() => caso.buscar('x', 'inventada')).toThrow(BadRequestException);
  });
});
