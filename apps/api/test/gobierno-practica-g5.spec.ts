import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { GestionarPracticaUseCase } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { DatosObligacion, EstadoObligacion, Obligacion, TipoObligacion } from '../src/domain/entities/obligacion.entity';
import { DatosPractica, ESTADO_OPERATIVO, EQUIVALENCIA_SGP, EstadoPractica, ModalidadPractica, Practica } from '../src/domain/entities/practica.entity';
import { ObligacionesDomainService } from '../src/domain/services/obligaciones.domain-service';
import { ModalidadNoOfertadaError } from '../src/domain/entities/periodo.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, empresaDe, practicaDe, usuarioDe } from './soporte-autorizacion';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const JUST = 'Corrección acordada con la organización receptora.';
const coord = actorDe(Rol.COORDINADOR);
const analista = actorDe(Rol.ANALISTA);

function montar(inicial: Partial<DatosPractica> = {}, opciones: { cierre?: { puedeCerrar: boolean; faltantes: string[]; aprobada: boolean | null }; obligaciones?: DatosObligacion[]; ofertadas?: ModalidadPractica[] } = {}) {
  let actual: DatosPractica = practicaDe({
    estado: EstadoPractica.INSCRITA, responsableArlPractica: 'empresa', arlVerificada: false,
    fechaInicio: dia('2026-08-18'), fechaFin: dia('2026-11-27'), actualizadaEn: dia('2026-08-01'), ...inicial,
  }).instantanea();
  const obligaciones = new Map<string, DatosObligacion>((opciones.obligaciones ?? []).map((o) => [o.id, o]));
  const auditorias: { accion: string; metadatos: Record<string, unknown> | null; justificacion: string | null; actorRol: string }[] = [];
  const notas: string[] = [];
  const actas: unknown[] = [];
  let guardados = 0;
  let cierres = 0;
  const caso = new GestionarPracticaUseCase(
    {
      buscarPorId: () => Promise.resolve(Practica.desde(actual)),
      guardar: (d: DatosPractica) => { actual = { ...d }; guardados += 1; return Promise.resolve(Practica.desde(d)); },
    } as never,
    {
      listarPorPractica: () => Promise.resolve([...obligaciones.values()].map((o) => Obligacion.desde(o))),
      guardar: (o: DatosObligacion) => { obligaciones.set(o.id, o); return Promise.resolve(Obligacion.desde(o)); },
      guardarLote: (l: DatosObligacion[]) => { l.forEach((o) => obligaciones.set(o.id, o)); return Promise.resolve(l.map((o) => Obligacion.desde(o))); },
    } as never,
    { listarPorPractica: () => Promise.resolve([]) } as never,
    { buscarPorId: () => Promise.resolve(empresaDe('empresa-a')) } as never,
    { buscarPorId: (id: string) => Promise.resolve(usuarioDe(Rol.COORDINADOR, { id, nombre: 'Laura Gómez' })) } as never,
    { registrar: (r: { accion: string; metadatos: Record<string, unknown> | null; justificacion: string | null; actorRol: string }) => { auditorias.push(r); return Promise.resolve(); } } as never,
    { numero: () => Promise.resolve(15), booleano: () => Promise.resolve(false) } as never,
    { alCambiarDatosDeLaPractica: (_id: string, cambios: unknown) => { actas.push(cambios); return Promise.resolve('recalculada'); } } as never,
    undefined,
    {
      buscarPorCodigo: () => Promise.resolve({
        codigo: '2026-2', exigirModalidad: (m: ModalidadPractica) => {
          if (opciones.ofertadas && !opciones.ofertadas.includes(m)) throw new ModalidadNoOfertadaError(m, '2026-2');
        },
        contieneFechas: () => true,
      }),
    } as never,
    {
      estadoCierre: () => Promise.resolve({ puedeCerrar: false, faltantes: ['falta la calificación'], aprobada: null, ...opciones.cierre }),
      cerrar: () => { cierres += 1; actual = { ...actual, estado: EstadoPractica.CERTIFICADA, cerradaEn: new Date() }; return Promise.resolve({ cerrada: true }); },
      anotarCambioDeGobierno: (_p: string, m: string) => { notas.push(m); return Promise.resolve(); },
    } as never,
  );
  return { caso, estado: () => actual, auditorias, notas, actas, obligaciones, guardados: () => guardados, cierres: () => cierres };
}

const obligacion = (tipo: TipoObligacion, estado: EstadoObligacion): DatosObligacion => ({
  id: `o-${tipo}`, practicaId: 'practica-1', tipo, estado, fechaLimite: dia('2026-09-01'), cumplidaEn: null,
  evidenciaDocumentoId: null, observacion: null, creadaEn: dia('2026-08-01'), actualizadaEn: dia('2026-08-01'),
});

describe('G5 · permisos: solo coordinación y analista modifican la práctica', () => {
  it.each([Rol.COORDINADOR, Rol.ANALISTA])('%s puede modificar', async (rol) => {
    const { caso, estado } = montar();
    await caso.modificarPractica('practica-1', { cargo: 'Analista junior', justificacion: JUST }, actorDe(rol));
    expect(estado().cargo).toBe('Analista junior');
  });

  it.each([Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.TUTOR, Rol.AUXILIAR, Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION])('%s → 403 (sin guardar ni auditar)', async (rol) => {
    const { caso, guardados, auditorias } = montar();
    const actor = actorDe(rol, rol === Rol.ESTUDIANTE ? { id: 'estudiante-1' } : rol === Rol.EMPRESA ? { empresaId: 'empresa-a' } : {});
    await expect(caso.modificarPractica('practica-1', { cargo: 'X cargo', justificacion: JUST }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.cambiarEstadoOperativo('practica-1', { destino: 'anulado', justificacion: JUST }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.transicionar('practica-1', EstadoPractica.ANULADA, JUST, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(guardados()).toBe(0);
    expect(auditorias).toHaveLength(0);
  });
});

describe('G5 · edición controlada', () => {
  it('varios campos: UN evento de auditoría con { campo: { de, a } } y la justificación', async () => {
    const { caso, auditorias, notas } = montar({ cargo: 'Auxiliar', horario: 'Lunes a viernes' });
    await caso.modificarPractica('practica-1', { cargo: 'Analista junior', horario: 'Lunes a jueves', justificacion: JUST }, coord);
    const evento = auditorias.filter((a) => a.accion === 'practica_modificada');
    expect(evento).toHaveLength(1);
    expect(evento[0].metadatos?.cambios).toEqual({ cargo: { de: 'Auxiliar', a: 'Analista junior' }, horario: { de: 'Lunes a viernes', a: 'Lunes a jueves' } });
    expect(evento[0].justificacion).toBe(JUST);
    expect(notas[0]).toMatch(/Laura Gómez modificó datos de la práctica \(cargo, horario\)/);
  });

  it('sin cambios reales: no guarda ni audita', async () => {
    const { caso, guardados, auditorias } = montar({ cargo: 'Auxiliar' });
    await caso.modificarPractica('practica-1', { cargo: 'Auxiliar', justificacion: JUST }, coord);
    expect(guardados()).toBe(0);
    expect(auditorias).toHaveLength(0);
  });

  it('justificación corta → 400', async () => {
    const { caso } = montar();
    await expect(caso.modificarPractica('practica-1', { cargo: 'Otro', justificacion: 'corto' }, coord)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('control optimista: si la práctica cambió después de abrir el editor → 409', async () => {
    const { caso } = montar();
    await expect(caso.modificarPractica('practica-1', { cargo: 'Otro', justificacion: JUST, actualizadaEn: '2026-07-01T00:00:00.000Z' }, coord)).rejects.toBeInstanceOf(ConflictException);
    await expect(caso.modificarPractica('practica-1', { cargo: 'Otro', justificacion: JUST, actualizadaEn: '2026-08-01T00:00:00.000Z' }, coord)).resolves.toBeDefined();
  });

  it('una práctica terminal no se modifica', async () => {
    const { caso } = montar({ estado: EstadoPractica.ANULADA });
    await expect(caso.modificarPractica('practica-1', { cargo: 'Otro', justificacion: JUST }, coord)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pasar a no remunerada limpia el salario y lo deja en los cambios; remuneración/ARL avisan al acta', async () => {
    const { caso, estado, auditorias, actas } = montar({ tipoRemuneracion: 'remunerada', salario: 1_300_000 });
    await caso.modificarPractica('practica-1', { tipoRemuneracion: 'no_remunerada', responsableArl: 'cun', justificacion: JUST }, analista);
    expect(estado()).toMatchObject({ tipoRemuneracion: 'no_remunerada', salario: null, responsableArlPractica: 'cun' });
    expect(auditorias[0].metadatos?.cambios).toMatchObject({ salario: { de: 1_300_000, a: null } });
    expect(actas[0]).toEqual({ remuneracion: { de: 'remunerada', a: 'no_remunerada' }, responsableArl: { de: 'empresa', a: 'cun' } });
  });
});

describe('G5 · cambio de modalidad', () => {
  it('válido: auditado (anterior, nueva, rol, justificación), nota legible y acta avisada', async () => {
    const { caso, estado, auditorias, notas, actas } = montar();
    await caso.modificarPractica('practica-1', { modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, justificacion: JUST }, coord);
    expect(estado().modalidad).toBe(ModalidadPractica.CONTRATO_APRENDIZAJE);
    const e = auditorias.find((a) => a.accion === 'practica_modificada')!;
    expect(e.metadatos?.cambios).toEqual({ modalidad: { de: ModalidadPractica.PASANTIA, a: ModalidadPractica.CONTRATO_APRENDIZAJE } });
    expect(e.actorRol).toBe(Rol.COORDINADOR);
    expect(e.justificacion).toBe(JUST);
    expect(notas[0]).toMatch(/^Laura Gómez cambió Modalidad: .+ → .+\. Motivo:/);
    expect(actas[0]).toEqual({ modalidad: { de: ModalidadPractica.PASANTIA, a: ModalidadPractica.CONTRATO_APRENDIZAJE } });
  });

  it('misma modalidad → sin cambios', async () => {
    const { caso, guardados } = montar();
    await caso.modificarPractica('practica-1', { modalidad: ModalidadPractica.PASANTIA, justificacion: JUST }, coord);
    expect(guardados()).toBe(0);
  });

  it('no ofertada en el periodo → 400', async () => {
    const { caso } = montar({}, { ofertadas: [ModalidadPractica.PASANTIA] });
    await expect(caso.modificarPractica('practica-1', { modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, justificacion: JUST }, coord)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('obligaciones: cumplidas intactas; las que ya no aplican pasan a «no aplica» (sin borrar); faltantes se crean', async () => {
    const { caso, obligaciones } = montar({}, { obligaciones: [
      obligacion(TipoObligacion.AUTORIZACION_TRATAMIENTO, EstadoObligacion.CUMPLIDA),
      obligacion(TipoObligacion.AFILIACION_ARL, EstadoObligacion.PENDIENTE),
      obligacion(TipoObligacion.REPORTE_PLAZA_PRACTICA, EstadoObligacion.CUMPLIDA),
      obligacion(TipoObligacion.CERTIFICACION_PRACTICA, EstadoObligacion.VENCIDA),
    ] });
    // Validación de experiencia: sin colocación nueva → no hay ARL, reporte de plaza ni certificación.
    await caso.modificarPractica('practica-1', { modalidad: ModalidadPractica.VALIDACION_EXPERIENCIA, justificacion: JUST }, coord);
    const por = (t: TipoObligacion) => obligaciones.get(`o-${t}`)!;
    expect(obligaciones.size).toBe(4);
    expect(por(TipoObligacion.AUTORIZACION_TRATAMIENTO).estado).toBe(EstadoObligacion.CUMPLIDA);
    expect(por(TipoObligacion.REPORTE_PLAZA_PRACTICA).estado).toBe(EstadoObligacion.CUMPLIDA);
    expect(por(TipoObligacion.AFILIACION_ARL).estado).toBe(EstadoObligacion.NO_APLICA);
    expect(por(TipoObligacion.CERTIFICACION_PRACTICA).estado).toBe(EstadoObligacion.NO_APLICA);
    expect(por(TipoObligacion.AFILIACION_ARL).observacion).toMatch(/No aplica tras el cambio de modalidad/);
  });

  it('volver a una modalidad con ARL crea la obligación nueva (la «no aplica» queda como histórico)', () => {
    const p = practicaDe({ fechaInicio: dia('2026-08-18'), fechaFin: dia('2026-11-27') });
    const { nuevas, dejanDeAplicar } = new ObligacionesDomainService().reconciliar(p, [
      Obligacion.desde(obligacion(TipoObligacion.AFILIACION_ARL, EstadoObligacion.NO_APLICA)),
    ]);
    expect(dejanDeAplicar).toEqual([]);
    expect(nuevas.map((n) => n.tipo)).toContain(TipoObligacion.AFILIACION_ARL);
  });

  it('el responsable de la ARL NO se infiere: si no coincide con la sugerencia de la nueva modalidad, queda pendiente', async () => {
    const { caso, estado } = montar({ responsableArlPractica: 'empresa' });
    const r = await caso.modificarPractica('practica-1', { modalidad: ModalidadPractica.MONITORIA, justificacion: JUST }, coord);
    expect(estado().responsableArlPractica).toBe('empresa');
    expect(estado().arlVerificada).toBe(false);
    expect(r.gobierno?.pendientes.join(' ')).toMatch(/Revisar quién asume la ARL/);
  });
});

describe('G5 · estados operativos', () => {
  it('el mapeo operativo coincide con la equivalencia del SGP', () => {
    const sgp: Record<string, string> = { Inscrito: 'inscrito', 'En práctica': 'en_practica', Anulado: 'anulado', Reprueba: 'reprobado', Cerrado: 'cerrado' };
    for (const e of Object.values(EstadoPractica)) expect(ESTADO_OPERATIVO[e]).toBe(sgp[EQUIVALENCIA_SGP[e]]);
  });

  it('Inscrito: no hay retroceso desde una práctica avanzada', async () => {
    const { caso } = montar({ estado: EstadoPractica.ACTIVA, arlVerificada: true, arlFechaAfiliacion: dia('2026-08-10') });
    await expect(caso.cambiarEstadoOperativo('practica-1', { destino: 'inscrito', justificacion: JUST }, coord)).rejects.toThrow(/No se retrocede/);
  });

  it('En práctica con ARL correcta: recorre documentación → validación → activa, auditado y anotado', async () => {
    const { caso, estado, auditorias, notas } = montar({ arlVerificada: true, arlFechaAfiliacion: dia('2026-08-10') });
    await caso.cambiarEstadoOperativo('practica-1', { destino: 'en_practica', justificacion: JUST }, analista);
    expect(estado().estado).toBe(EstadoPractica.ACTIVA);
    expect(auditorias[0]).toMatchObject({ accion: 'estado_operativo_cambiado', justificacion: JUST, metadatos: { de: 'inscrito', a: 'en_practica', tecnico: { de: 'inscrita', a: 'activa' } } });
    expect(notas[0]).toMatch(/cambió el estado operativo: Inscrito → En práctica/);
  });

  it('En práctica sin ARL verificada → bloqueado con motivo y SIN cambios (no hay bypass)', async () => {
    const { caso, estado, guardados } = montar({ arlVerificada: false });
    await expect(caso.cambiarEstadoOperativo('practica-1', { destino: 'en_practica', justificacion: JUST }, coord)).rejects.toThrow(/No se puede pasar a «En práctica».*afiliación/);
    expect(estado().estado).toBe(EstadoPractica.INSCRITA);
    expect(guardados()).toBe(0);
  });

  it('En práctica sin responsable de la ARL → bloqueado', async () => {
    const { caso } = montar({ responsableArlPractica: null, arlVerificada: true, arlFechaAfiliacion: dia('2026-08-10') });
    await expect(caso.cambiarEstadoOperativo('practica-1', { destino: 'en_practica', justificacion: JUST }, coord)).rejects.toThrow(/falta definir quién asume la ARL/);
  });

  it('Anulado: queda anulada (terminal), con justificación; desde suspendida, cancelada (también «Anulado»)', async () => {
    const a = montar();
    await a.caso.cambiarEstadoOperativo('practica-1', { destino: 'anulado', justificacion: JUST }, coord);
    expect(a.estado().estado).toBe(EstadoPractica.ANULADA);
    const b = montar({ estado: EstadoPractica.SUSPENDIDA });
    await b.caso.cambiarEstadoOperativo('practica-1', { destino: 'anulado', justificacion: JUST }, coord);
    expect(b.estado().estado).toBe(EstadoPractica.CANCELADA);
  });

  it('Reprobado: justificación obligatoria; coexiste con la regla de nota (no la toca)', async () => {
    const { caso, estado } = montar({ estado: EstadoPractica.ACTIVA, nota: null });
    await expect(caso.cambiarEstadoOperativo('practica-1', { destino: 'reprobado', justificacion: 'corto' }, coord)).rejects.toBeInstanceOf(BadRequestException);
    await caso.cambiarEstadoOperativo('practica-1', { destino: 'reprobado', justificacion: JUST }, coord);
    expect(estado()).toMatchObject({ estado: EstadoPractica.REPROBADA, nota: null });
  });

  it('Cerrado con requisitos: usa el flujo de cierre (no escribe certificada directo)', async () => {
    const { caso, estado, cierres } = montar({ estado: EstadoPractica.FINALIZADA, nota: 4.2 }, { cierre: { puedeCerrar: true, faltantes: [], aprobada: true } });
    await caso.cambiarEstadoOperativo('practica-1', { destino: 'cerrado', justificacion: JUST }, coord);
    expect(cierres()).toBe(1);
    expect(estado().estado).toBe(EstadoPractica.CERTIFICADA);
  });

  it('Cerrado sin requisitos → bloqueado con lo que falta; con nota no aprobatoria → bloqueado', async () => {
    const a = montar({ estado: EstadoPractica.ACTIVA }, { cierre: { puedeCerrar: false, faltantes: ['falta la calificación'], aprobada: null } });
    await expect(a.caso.cambiarEstadoOperativo('practica-1', { destino: 'cerrado', justificacion: JUST }, coord)).rejects.toThrow(/No se puede cerrar todavía: falta la calificación/);
    expect(a.cierres()).toBe(0);
    const b = montar({ estado: EstadoPractica.ACTIVA, nota: 2.5 }, { cierre: { puedeCerrar: true, faltantes: [], aprobada: false } });
    await expect(b.caso.cambiarEstadoOperativo('practica-1', { destino: 'cerrado', justificacion: JUST }, coord)).rejects.toThrow(/no es aprobatoria/);
  });

  it('transición no permitida → bloqueada (anulada no se reabre)', async () => {
    const { caso } = montar({ estado: EstadoPractica.ANULADA });
    await expect(caso.cambiarEstadoOperativo('practica-1', { destino: 'en_practica', justificacion: JUST }, coord)).rejects.toThrow(/ya terminó/);
  });

  it('proyección: destinos con disponibilidad y motivo SOLO para quien modifica; admin y director ven el estado sin acciones', async () => {
    const { caso } = montar({ arlVerificada: false });
    const c = await caso.obtener('practica-1', coord);
    expect(c.gobierno?.estadoOperativo).toBe('inscrito');
    const enPractica = c.gobierno!.destinos.find((d) => d.estado === 'en_practica')!;
    expect(enPractica.disponible).toBe(false);
    expect(enPractica.motivo).toMatch(/afiliación/);
    expect(c.gobierno!.destinos.find((d) => d.estado === 'anulado')!.disponible).toBe(true);
    for (const rol of [Rol.ADMINISTRADOR, Rol.DIRECTOR]) {
      const r = await caso.obtener('practica-1', actorDe(rol));
      expect(r.gobierno).toMatchObject({ estadoOperativo: 'inscrito', puedeModificar: false, destinos: [] });
    }
  });
});
