import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { EstadoPractica } from '../src/domain/entities/practica.entity';
import { EstadoValidacionActa, TipoEvidenciaActa } from '../src/domain/entities/validacion-acta.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe } from './soporte-autorizacion';
import { AHORA_MESA as AHORA, MIN, TEXTO_40, aux, admin, coord, montarMesaActas } from './soporte-mesa-actas';
import { TEXTO_CEDULA } from './soporte-acta';
import { MENSAJES_DEVOLUCION_ACTA, MotivoDevolucionActa } from '../src/domain/services/mesa-acta.domain-service';

type Mesa = ReturnType<typeof montarMesaActas>;

/** Un caso procesado (en revisión) y, si se pide, ya tomado por `quien`. */
async function caso(m: Mesa, id: string, opciones: Parameters<Mesa['crear']>[0] extends infer O ? Partial<O> : never = {}, quien?: ReturnType<typeof aux>) {
  const c = await m.crear({ id, ...opciones });
  if (quien) await m.mesa.tomar(c.validacionId as string, quien, AHORA);
  return c as { documentoId: string; validacionId: string };
}
const fila = (m: Mesa, validacionId: string) => m.validaciones.filas.get(validacionId)!;
const DISCREPANTE = { practica: { responsableArlPractica: 'cun' as const } };

describe('Mesa de Actas · reserva operativa', () => {
  it('1 · un auxiliar toma un caso libre: queda reservado a su nombre y la toma se audita', async () => {
    const m = montarMesaActas();
    const a = aux('a1');
    const { validacionId } = await caso(m, 'c1');
    const reserva = await m.mesa.tomar(validacionId, a, AHORA);
    expect(reserva).toMatchObject({ estado: 'mia' });
    expect(fila(m, validacionId)).toMatchObject({ asignadoA: 'a1', reservaHasta: new Date(AHORA.getTime() + 15 * MIN) });
    expect(m.auditoria.acciones('acta_asignada')).toHaveLength(1);
  });

  it('2 · un segundo funcionario no puede tomar un caso con reserva vigente: 409', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await expect(m.mesa.tomar(validacionId, aux('a2'), new Date(AHORA.getTime() + 5 * MIN))).rejects.toBeInstanceOf(ConflictException);
    expect(fila(m, validacionId).asignadoA).toBe('a1');
  });

  it('dos personas que tomar a la vez: una gana (200) y la otra recibe 409', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1');
    const r = await Promise.allSettled([m.mesa.tomar(validacionId, aux('a1'), AHORA), m.mesa.tomar(validacionId, aux('a2'), AHORA)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazada = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazada.reason).toBeInstanceOf(ConflictException);
  });

  it('3 · la reserva vence sola a los 15 minutos y otro funcionario puede tomar el caso', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    const despues = new Date(AHORA.getTime() + 16 * MIN);
    await expect(m.mesa.tomar(validacionId, aux('a2'), despues)).resolves.toMatchObject({ estado: 'mia' });
    expect(fila(m, validacionId).asignadoA).toBe('a2');
  });

  it('4 · el titular libera su reserva y el caso vuelve a estar libre', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await m.mesa.liberar(validacionId, aux('a1'), AHORA);
    expect(fila(m, validacionId)).toMatchObject({ asignadoA: null, reservaHasta: null });
    await expect(m.mesa.tomar(validacionId, aux('a2'), AHORA)).resolves.toBeDefined();
    expect(m.auditoria.acciones('acta_liberada')).toHaveLength(1);
  });

  it('un auxiliar NO libera la reserva vigente de otro: 409', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await expect(m.mesa.liberar(validacionId, aux('a2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(fila(m, validacionId).asignadoA).toBe('a1');
  });

  it.each([['coordinación', coord()], ['administración', admin()]])('5 · %s libera la reserva de otra persona (liberación administrativa, auditada)', async (_n, supervisor) => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await m.mesa.liberar(validacionId, supervisor, AHORA);
    expect(fila(m, validacionId).asignadoA).toBeNull();
    expect(m.auditoria.acciones('acta_liberada')[0].metadatos).toMatchObject({ administrativa: true });
  });

  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.EMPRESA, Rol.EXTENSION])('6, 7 y 8 · %s NO opera la Mesa: ni bandeja, ni detalle, ni toma, ni decisión', async (rol) => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1');
    const a = actorDe(rol);
    await expect(m.mesa.listar(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.detalle(validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomar(validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomarSiguiente(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.decidir(validacionId, a, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.archivo(validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(fila(m, validacionId).asignadoA).toBeNull();
  });

  it('el auxiliar no supervisa; coordinación y administración sí', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1');
    await expect(m.mesa.supervision(aux(), AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(coord(), AHORA)).resolves.toMatchObject({ abiertas: 1, libres: 1 });
    await expect(m.mesa.supervision(admin(), AHORA)).resolves.toMatchObject({ abiertas: 1 });
  });

  it('«tomar siguiente»: dos personas a la vez reciben casos distintos y el de mayor prioridad va primero', async () => {
    const m = montarMesaActas();
    await caso(m, 'normal');
    const incorrecto = await caso(m, 'incorrecto', { textoPlano: TEXTO_CEDULA });
    await caso(m, 'critico', DISCREPANTE);
    const [r1, r2] = await Promise.all([m.mesa.tomarSiguiente(aux('a1'), {}, AHORA), m.mesa.tomarSiguiente(aux('a2'), {}, AHORA)]);
    expect([r1.estado, r2.estado]).toEqual(['tomado', 'tomado']);
    expect(r1.validacionId).not.toBe(r2.validacionId);
    // El documento incorrecto (40) y la discrepancia crítica (30) pesan más que un caso sin señales.
    expect(new Set([r1.validacionId, r2.validacionId]).has(incorrecto.validacionId)).toBe(true);
    const r3 = await m.mesa.tomarSiguiente(aux('a3'), {}, AHORA);
    expect(r3.estado).toBe('tomado');
    expect((await m.mesa.tomarSiguiente(aux('a4'), {}, AHORA)).estado).toBe('sin_casos');
  });
});

describe('Mesa de Actas · decisión', () => {
  it('9 · aprobar un acta consistente: una sola decisión, con evidencia, auditoría y quién/cuándo', async () => {
    const m = montarMesaActas();
    const { validacionId, documentoId } = await caso(m, 'c1', {}, aux('a1'));
    const r = await m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA);
    expect(r.estado).toBe(EstadoDocumento.APROBADO);
    expect(m.documentos.filas.get(documentoId)).toMatchObject({ estado: EstadoDocumento.APROBADO, decididoPor: 'a1' });
    expect(fila(m, validacionId)).toMatchObject({ estado: EstadoValidacionActa.APROBADO_MANUAL, decididoPor: 'a1', asignadoA: null });
    expect(fila(m, validacionId).decididoEn).toBeInstanceOf(Date);
    expect(m.validaciones.evid.filter((e) => e.tipo === TipoEvidenciaActa.DECISION_HUMANA)).toHaveLength(1);
    expect(m.auditoria.acciones('decision_acta')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_documento')).toHaveLength(1);
  });

  it('nunca se autoaprueba: el acta consistente queda en «revision» hasta que una persona decide', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1');
    expect(fila(m, validacionId)).toMatchObject({ estado: EstadoValidacionActa.REVISION, decididoPor: null });
  });

  it('10 · aprobar con una discrepancia crítica sin justificación → 400', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(fila(m, validacionId).estado).toBe(EstadoValidacionActa.REVISION);
  });

  it('11 y 12 · 39 caracteres no alcanzan para apartarse de la recomendación; 40 sí (la misma regla de EPS)', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar', justificacion: 'x'.repeat(39) }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(TEXTO_40).toHaveLength(40);
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar', justificacion: TEXTO_40 }, AHORA)).resolves.toBeDefined();
    expect(fila(m, validacionId).estado).toBe(EstadoValidacionActa.APROBADO_MANUAL);
  });

  it('13 · devolver con un motivo del catálogo: el estudiante recibe un mensaje humano, no un código', async () => {
    const m = montarMesaActas();
    const { validacionId, documentoId } = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    await m.mesa.decidir(validacionId, aux('a1'), { decision: 'devolver', motivo: 'arl_no_coincide' as never }, AHORA);
    expect(fila(m, validacionId)).toMatchObject({ estado: EstadoValidacionActa.DEVUELTO, motivoDecision: 'arl_no_coincide' });
    const doc = m.documentos.filas.get(documentoId)!;
    expect(doc.estado).toBe(EstadoDocumento.DEVUELTO);
    expect(doc.motivoDevolucion).toBe('El responsable de la ARL indicado en el acta no coincide con la información registrada en tu práctica.');
  });

  it('14 · devolver con «otro» exige texto; sin motivo, 400', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'devolver', motivo: 'otro' as never }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'devolver' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'devolver', motivo: 'otro' as never, justificacion: 'Falta la hoja de la página dos del formato.' }, AHORA)).resolves.toBeDefined();
    expect(m.documentos.filas.get('doc-c1')!.motivoDevolucion).toBe('Falta la hoja de la página dos del formato.');
  });

  it('15 · rechazar sin justificación → 400; con ella, es terminal para esa versión', async () => {
    const m = montarMesaActas();
    const { validacionId, documentoId } = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'rechazar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await m.mesa.decidir(validacionId, aux('a1'), { decision: 'rechazar', justificacion: 'El documento no corresponde a la práctica registrada.' }, AHORA);
    expect(m.documentos.filas.get(documentoId)!.estado).toBe(EstadoDocumento.RECHAZADO);
    expect(fila(m, validacionId).estado).toBe(EstadoValidacionActa.RECHAZADO);
  });

  it('rechazar un acta que el sistema ve consistente exige la justificación reforzada', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'rechazar', justificacion: 'Rechazada por criterio del revisor.' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('16 · tres decisiones simultáneas: solo una aplica, las otras reciben 409 y queda UNA evidencia y UNA auditoría', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    const r = await Promise.allSettled([
      m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA),
      m.mesa.decidir(validacionId, aux('a1'), { decision: 'devolver', motivo: 'informacion_incompleta' as never }, AHORA),
      m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const x of r.filter((y): y is PromiseRejectedResult => y.status === 'rejected')) expect(x.reason).toBeInstanceOf(ConflictException);
    expect(m.validaciones.evid.filter((e) => e.tipo === TipoEvidenciaActa.DECISION_HUMANA)).toHaveLength(1);
    expect(m.auditoria.acciones('decision_acta')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_documento')).toHaveLength(1);
    expect(fila(m, validacionId).decididoPor).toBe('a1');
  });

  it('una decisión ya tomada no se repite (409), ni se pisa', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1', {}, aux('a1'));
    await m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA);
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'rechazar', justificacion: 'x'.repeat(50) }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(fila(m, validacionId).estado).toBe(EstadoValidacionActa.APROBADO_MANUAL);
  });

  it('decidir exige tener el caso reservado: sin reserva, con reserva vencida o ajena → 409', async () => {
    const m = montarMesaActas();
    const { validacionId } = await caso(m, 'c1');
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    await m.mesa.tomar(validacionId, aux('a1'), AHORA);
    await expect(m.mesa.decidir(validacionId, aux('a2'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, new Date(AHORA.getTime() + 16 * MIN))).rejects.toBeInstanceOf(ConflictException);
    expect(fila(m, validacionId).estado).toBe(EstadoValidacionActa.REVISION);
  });

  it('17 · decidir antes del procesamiento → 409 controlado (no 500) y NO se crea una validación artificial', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', { sinProcesar: true });
    expect(fila(m, c.validacionId).estado).toBe(EstadoValidacionActa.PROCESANDO);
    await expect(m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.tomar(c.validacionId, aux('a1'), AHORA)).rejects.toBeInstanceOf(ConflictException);

    // Un documento que ni siquiera tiene validación: decidirlo por el camino de documentos tampoco la crea.
    const m2 = montarMesaActas();
    await m2.crear({ id: 'x', sinProcesar: true });
    m2.validaciones.filas.clear();
    await expect(m2.gestionar.decidir('doc-x', { decision: 'aprobar', justificacion: 'x'.repeat(40) }, aux('a1'), { mesaActa: { motivo: null, contexto: {}, ahora: AHORA } }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(m2.validaciones.filas.size).toBe(0);
  });

  it('el acta NO se decide por el camino general de documentos: ni el docente (403)', async () => {
    const m = montarMesaActas();
    const { documentoId } = await caso(m, 'c1');
    const tutor = actorDe(Rol.TUTOR, { id: 'tutor-asignado', escuelas: ['ESC-NEG'] });
    await expect(m.gestionar.decidir(documentoId, { decision: 'aprobar', justificacion: 'x'.repeat(40) }, tutor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.gestionar.decidir(documentoId, { decision: 'aprobar', justificacion: 'x'.repeat(40) }, coord())).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.documentos.filas.get(documentoId)!.estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('un acta cuya lectura falló (error) no se decide hasta reintentarse: 409', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', { sinProcesar: true });
    await m.acta.marcarErrorProcesamiento(c.documentoId, 'PROCESAMIENTO_FALLIDO', AHORA);
    await expect(m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('18 · una versión vieja no se toma ni se decide: 409 (el estudiante cargó una más reciente)', async () => {
    const m = montarMesaActas();
    const v1 = await caso(m, 'v1', { practicaId: 'p', version: 1 }, aux('a1'));
    await m.crear({ id: 'v2', practicaId: 'p', version: 2 });
    await expect(m.mesa.decidir(v1.validacionId, aux('a1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.tomar(v1.validacionId, aux('a2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    // La bandeja solo muestra la versión vigente.
    const bandeja = await m.mesa.listar(aux('a1'), {}, AHORA);
    expect(bandeja.items.map((i) => i.version)).toEqual([2]);
  });

  it('19 · una versión nueva tiene su propia validación, lectura, firmas, comparación y reserva; no hereda nada de la anterior', async () => {
    const m = montarMesaActas();
    const v1 = await caso(m, 'v1', { practicaId: 'p', ...DISCREPANTE }, aux('a1'));
    await m.mesa.decidir(v1.validacionId, aux('a1'), { decision: 'devolver', motivo: 'arl_no_coincide' as never }, AHORA);
    const antes = JSON.stringify(fila(m, v1.validacionId));
    const v2 = await m.crear({ id: 'v2', practicaId: 'p', version: 2, lectura: { firmas: { firmaEmpresaPresente: 'no', firmaPracticantePresente: 'si' } }, acta: { encabezadoArl: 'cun', obligacionArl: 'institucion' } });
    const nueva = fila(m, v2.validacionId as string);
    expect(nueva.id).not.toBe(v1.validacionId);
    expect(nueva).toMatchObject({ estado: EstadoValidacionActa.REVISION, decididoPor: null, motivoDecision: null, asignadoA: null, firmaEmpresa: 'no', responsableArlDetectado: 'cun' });
    expect(JSON.stringify(fila(m, v1.validacionId))).toBe(antes);
    expect((await m.validaciones.listarEvidencias(v2.validacionId as string)).every((e) => e.instantanea().validacionActaId === v2.validacionId)).toBe(true);
    // Se puede tomar y revisar la nueva aunque la anterior estuviera devuelta.
    await expect(m.mesa.tomar(v2.validacionId as string, aux('a2'), AHORA)).resolves.toMatchObject({ estado: 'mia' });
  });

  it('29 · volver a procesar después de la decisión no la sobrescribe', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', {}, aux('a1'));
    await m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'aprobar' }, AHORA);
    const antes = JSON.stringify(fila(m, c.validacionId));
    await m.acta.registrarProcesamiento((await m.documentos.buscarPorId(c.documentoId))!, new Date(AHORA.getTime() + 60 * MIN));
    await m.acta.marcarProcesando(c.documentoId, new Date(AHORA.getTime() + 60 * MIN));
    await m.acta.marcarErrorProcesamiento(c.documentoId, 'X', new Date(AHORA.getTime() + 60 * MIN));
    expect(JSON.stringify(fila(m, c.validacionId))).toBe(antes);
  });
});

describe('Mesa de Actas · bandeja, detalle y archivo', () => {
  it('la bandeja trae KPIs, prioridad con razones y se filtra por remuneración, ARL, discrepancias, firmas y reserva', async () => {
    const m = montarMesaActas();
    await caso(m, 'ok');
    await caso(m, 'critico', { ...DISCREPANTE, recibidaHace: 3 });
    await caso(m, 'sinfirma', { lectura: { firmas: { firmaEmpresaPresente: 'no', firmaPracticantePresente: 'si' } } });
    await caso(m, 'ajeno', { textoPlano: TEXTO_CEDULA });
    const todo = await m.mesa.listar(aux('a1'), {}, AHORA);
    expect(todo.kpis).toMatchObject({ abiertas: 4, libres: 4, mias: 0, conDiscrepanciaCritica: 1, documentoIncorrecto: 1, tomadas: 0, porVencer: 0, firmasPendientes: 1 });
    expect(todo.items[0].tipoActa).toBe('documento_incorrecto');
    expect(todo.items.map((i) => i.prioridad.puntaje)).toEqual([...todo.items.map((i) => i.prioridad.puntaje)].sort((a, b) => b - a));
    expect(todo.items.find((i) => i.validacionId.length > 0 && i.hayDiscrepanciaCritica)!.prioridad.razones.join(' ')).toContain('discrepancia crítica');
    expect((await m.mesa.listar(aux('a1'), { conDiscrepancias: 'si' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(aux('a1'), { documentoIncorrecto: 'si' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(aux('a1'), { firmas: 'faltantes' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(aux('a1'), { responsableArl: 'empresa' }, AHORA)).total).toBe(3);
    expect((await m.mesa.listar(aux('a1'), { remuneracion: 'no_remunerada' }, AHORA)).total).toBe(3);
    expect((await m.mesa.listar(aux('a1'), { antiguedadMinDias: '2' }, AHORA)).total).toBe(1);
    await m.mesa.tomar(todo.items[0].validacionId, aux('a1'), AHORA);
    expect((await m.mesa.listar(aux('a1'), { reserva: 'mias' }, AHORA)).total).toBe(1);
    // Tomado = reserva vigente de cualquier persona; «por vencer» = vence en los próximos 5 minutos.
    expect((await m.mesa.listar(aux('a2'), {}, AHORA)).kpis).toMatchObject({ libres: 3, tomadas: 1, porVencer: 0 });
    expect((await m.mesa.listar(aux('a2'), {}, new Date(AHORA.getTime() + 11 * MIN))).kpis).toMatchObject({ tomadas: 1, porVencer: 1 });
    expect((await m.mesa.listar(aux('a2'), {}, new Date(AHORA.getTime() + 16 * MIN))).kpis).toMatchObject({ tomadas: 0, porVencer: 0, libres: 4 });
    expect((await m.mesa.listar(aux('a2'), { reserva: 'otros' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(aux('a2'), { reserva: 'libres' }, AHORA)).total).toBe(3);
  });

  it('la bandeja operativa solo lista actas en revisión; los demás estados solo los pide supervisión', async () => {
    const m = montarMesaActas();
    await caso(m, 'rev');
    await caso(m, 'proc', { sinProcesar: true });
    // Un auxiliar que pide otro estado igual recibe solo lo revisable.
    expect((await m.mesa.listar(aux(), { estado: 'procesando' }, AHORA)).items.map((i) => i.estado)).toEqual(['revision']);
    expect((await m.mesa.listar(coord(), { estado: 'procesando' }, AHORA)).items.map((i) => i.estado)).toEqual(['procesando']);
  });

  it('el detalle trae estudiante, práctica, resumen SIPRA ↔ Acta, comparación, versiones e historial; el documento completo solo con el caso tomado', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', DISCREPANTE);
    m.persona('a1', 'Ana Auxiliar', Rol.AUXILIAR);
    const sinTomar = await m.mesa.detalle(c.validacionId, aux('a1'), AHORA);
    expect(sinTomar.estudiante.documento).toBeNull();
    expect(sinTomar.estudiante.documentoEnmascarado).toBe('••••0001');
    expect(sinTomar.comparacion!.campos.find((x) => x.campo === 'documento')).toMatchObject({ sipra: '••••0001', acta: '••••0001' });
    expect(sinTomar.puedeDecidir).toBe(false);

    await m.mesa.tomar(c.validacionId, aux('a1'), AHORA);
    const d = await m.mesa.detalle(c.validacionId, aux('a1'), AHORA);
    expect(d.estudiante).toMatchObject({ nombre: 'Ana Maria Prueba Sintetica', documento: '1000000001', programa: 'Administración de Empresas' });
    expect(d.practica).toMatchObject({ empresa: 'Empresa Sintética SAS', nit: '900123456-8', modalidad: 'Contrato de aprendizaje', fechaInicio: '2026-09-01' });
    expect(d.resumen).toMatchObject({
      clasificacion: 'iniciacion_practicas', remuneracionSipra: 'No remunerada', remuneracionActa: 'No remunerada',
      responsableArlSipra: 'CUN', responsableArlActa: 'Empresa', firmaEmpresa: 'si', firmaPracticante: 'si',
    });
    expect(d.comparacion!.campos.find((x) => x.campo === 'responsable_arl')).toMatchObject({ sipra: 'CUN', acta: 'Empresa', resultado: 'diferente', criticidad: 'critica' });
    expect(d.comparacion!.campos.find((x) => x.campo === 'remuneracion')).toMatchObject({ resultado: 'coincide' });
    expect(d.comparacion!.vigente).toBe(true);
    expect(d.recomendacion).toBe('discrepancia_critica');
    expect(d.puedeDecidir).toBe(true);
    expect(d.versiones).toEqual([expect.objectContaining({ version: 1, vigente: true, estado: 'revision' })]);
    expect(d.historial.map((h) => h.tipo)).toEqual(expect.arrayContaining(['lectura_documento', 'clasificacion_documental', 'comparacion', 'medicion_firmas', 'procesamiento']));
    // Nunca el texto del documento.
    expect(JSON.stringify(d)).not.toMatch(/OBLIGACIONES DE LA EMPRESA|Afiliar el estudiante/);
  });

  it('23 · el responsable de la ARL histórico (null) se muestra como no informado y la sugerencia por modalidad va aparte', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', { practica: { responsableArlPractica: null, modalidad: ModalidadPractica.PASANTIA } }, aux('a1'));
    const d = await m.mesa.detalle(c.validacionId, aux('a1'), AHORA);
    expect(d.resumen.responsableArlSipra).toBeNull();
    expect(d.comparacion!.campos.find((x) => x.campo === 'responsable_arl')).toMatchObject({ sipra: null, resultado: 'informacion_insuficiente' });
    expect(d.responsableArlSugeridoPorModalidad).toBe('empresa');
    expect(m.practicas.get('pra-c1')!.responsableArlPractica).toBeNull();
  });

  it('30 · el historial de cada versión no mezcla eventos de las demás', async () => {
    const m = montarMesaActas();
    const v1 = await caso(m, 'v1', { practicaId: 'p' }, aux('a1'));
    await m.mesa.decidir(v1.validacionId, aux('a1'), { decision: 'devolver', motivo: 'documento_ilegible' as never }, AHORA);
    const v2 = await m.crear({ id: 'v2', practicaId: 'p', version: 2 });
    const d1 = await m.mesa.detalle(v1.validacionId, admin(), AHORA);
    const d2 = await m.mesa.detalle(v2.validacionId as string, admin(), AHORA);
    expect(d1.historial.some((h) => h.tipo === 'decision_humana')).toBe(true);
    expect(d2.historial.some((h) => h.tipo === 'decision_humana')).toBe(false);
    expect(d1.historial.length).toBe(m.validaciones.evid.filter((e) => e.validacionActaId === v1.validacionId).length);
    expect(d2.historial.length).toBe(m.validaciones.evid.filter((e) => e.validacionActaId === v2.validacionId).length);
    // Las dos versiones aparecen en la lista de versiones de cualquiera de ellas, marcando la vigente.
    expect(d1.versiones.map((v) => [v.version, v.vigente])).toEqual([[2, true], [1, false]]);
    expect(d1.vigente).toBe(false);
    expect(d2.vigente).toBe(true);
  });

  it('el archivo se sirve solo a quien tiene el caso tomado (o supervisa) y su apertura queda auditada', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1');
    await expect(m.mesa.archivo(c.validacionId, aux('a1'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await m.mesa.tomar(c.validacionId, aux('a1'), AHORA);
    const f = await m.mesa.archivo(c.validacionId, aux('a1'), AHORA);
    expect(f.nombre).toBe('acta-c1.pdf');
    expect(m.auditoria.acciones('documento_visualizado')[0].metadatos).toMatchObject({ origen: 'mesa_actas' });
    await expect(m.mesa.archivo(c.validacionId, aux('a2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.archivo(c.validacionId, coord(), AHORA)).resolves.toBeDefined();
  });

  it('la supervisión cuenta libres, tomados, por vencer, vencidos, por estado y por discrepancia', async () => {
    const m = montarMesaActas();
    const a = await caso(m, 'a', {}, aux('a1'));
    await caso(m, 'b', DISCREPANTE);
    const c = await caso(m, 'c', { textoPlano: TEXTO_CEDULA });
    await m.mesa.tomar(c.validacionId, aux('a2'), new Date(AHORA.getTime() - 14 * MIN)); // vence en 1 minuto
    await m.mesa.tomar((await caso(m, 'd')).validacionId, aux('a3'), new Date(AHORA.getTime() - 20 * MIN)); // ya venció
    void a;
    const s = await m.mesa.supervision(coord(), AHORA);
    expect(s).toMatchObject({ abiertas: 4, tomadas: 2, porVencer: 1, vencidas: 1, libres: 2, conDiscrepanciaCritica: 1, documentoIncorrecto: 1 });
    expect(s.porEstado).toEqual({ revision: 4 });
  });
});

describe('Estado del acta para el estudiante', () => {
  const PROHIBIDO = /aprobado_manual|devuelto|rechazado\b|"revision"|procesando|pendiente\b|error|_DIFERENTE|_NO_VERIFICABLE|C[0-3]_|documento_incorrecto|stack|ARL_ENCABEZADO|REMUNERACION_AMBIGUA/;
  const estudianteDe = (p = 'pra-c1') => actorDe(Rol.ESTUDIANTE, { id: `est-${p}` });

  it('traduce cada estado a lenguaje humano, con qué ocurrió y qué hacer', async () => {
    const m = montarMesaActas();
    expect(await m.estudiante.estado('pra-vacia', estudianteDe('pra-vacia')).catch((e: Error) => e.constructor.name)).toBe('NotFoundException');
    m.practicas.set('pra-nueva', (await (async () => { await m.crear({ id: 'tmp', practicaId: 'pra-nueva', sinProcesar: true }); return m.practicas.get('pra-nueva')!; })()));
    const cola = await m.estudiante.estado('pra-nueva', estudianteDe('pra-nueva'));
    expect(cola).toMatchObject({ estado: 'leyendo', etiqueta: 'Estamos revisando tu acta', puedeReenviar: false });
    await m.crear({ id: 'rev', practicaId: 'pra-rev' });
    expect(await m.estudiante.estado('pra-rev', estudianteDe('pra-rev'))).toMatchObject({ estado: 'con_el_equipo', etiqueta: 'Acta en revisión', puedeReenviar: false });
  });

  it('20 · tras una devolución ve qué ocurrió y qué debe hacer (mensaje humano) y puede reenviar', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    await m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'devolver', motivo: 'arl_no_coincide' as never }, AHORA);
    const e = await m.estudiante.estado('pra-c1', estudianteDe());
    expect(e).toMatchObject({
      estado: 'por_corregir', etiqueta: 'Necesita corrección', puedeReenviar: true, versionActual: 1,
      que: 'El responsable de la ARL indicado en el acta no coincide con la información registrada en tu práctica.',
      hacer: 'Contacta a coordinación o carga el documento correcto, según corresponda.',
    });
  });

  it('con el motivo «otro» ve lo que escribió quien revisó', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', {}, aux('a1'));
    await m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'devolver', motivo: 'otro' as never, justificacion: 'Hace falta la hoja de la página dos del formato.' }, AHORA);
    expect((await m.estudiante.estado('pra-c1', estudianteDe())).que).toBe('Hace falta la hoja de la página dos del formato.');
  });

  it('aprobada → «Acta validada»; rechazada → «Acta rechazada»; ilegible o con error → «Necesita revisión»', async () => {
    const m1 = montarMesaActas();
    const c1 = await caso(m1, 'c1', {}, aux('a1'));
    await m1.mesa.decidir(c1.validacionId, aux('a1'), { decision: 'aprobar' }, AHORA);
    expect(await m1.estudiante.estado('pra-c1', estudianteDe())).toMatchObject({ estado: 'validada', etiqueta: 'Acta validada', puedeReenviar: false });
    const m2 = montarMesaActas();
    const c2 = await caso(m2, 'c1', DISCREPANTE, aux('a1'));
    await m2.mesa.decidir(c2.validacionId, aux('a1'), { decision: 'rechazar', justificacion: 'No corresponde a la práctica registrada.' }, AHORA);
    expect(await m2.estudiante.estado('pra-c1', estudianteDe())).toMatchObject({ estado: 'rechazada', etiqueta: 'Acta rechazada' });
    const m3 = montarMesaActas();
    await m3.crear({ id: 'c1', estadoDocumento: EstadoDocumento.ILEGIBLE });
    expect(await m3.estudiante.estado('pra-c1', estudianteDe())).toMatchObject({ estado: 'por_revisar', etiqueta: 'Necesita revisión', puedeReenviar: true });
  });

  it('21 · jamás recibe nombres internos de estado, códigos de discrepancia, códigos de capas ni la lectura', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    const vistas = [JSON.stringify(await m.estudiante.estado('pra-c1', estudianteDe()))];
    await m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'devolver', motivo: 'informacion_no_coincide' as never }, AHORA);
    vistas.push(JSON.stringify(await m.estudiante.estado('pra-c1', estudianteDe())));
    for (const v of vistas) {
      expect(v).not.toMatch(PROHIBIDO);
      expect(v).not.toMatch(/OBLIGACIONES|Afiliar el estudiante|1000000001|Prueba Sintetica/);
    }
  });

  it('solo ve la suya; los demás perfiles no usan este endpoint; una práctica ajena «no existe»', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1');
    await expect(m.estudiante.estado('pra-c1', actorDe(Rol.ESTUDIANTE, { id: 'otro-estudiante' }))).rejects.toThrow('Práctica no encontrada');
    await expect(m.estudiante.estado('pra-c1', aux())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.estudiante.estado('pra-c1', actorDe(Rol.TUTOR))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('varias versiones: la actual y el historial, cada una con su etiqueta; la anterior sigue como estaba', async () => {
    const m = montarMesaActas();
    const v1 = await caso(m, 'v1', { practicaId: 'pra-c1' }, aux('a1'));
    await m.mesa.decidir(v1.validacionId, aux('a1'), { decision: 'devolver', motivo: 'falta_firma_practicante' as never }, AHORA);
    await m.crear({ id: 'v2', practicaId: 'pra-c1', version: 2 });
    const e = await m.estudiante.estado('pra-c1', estudianteDe('pra-c1'));
    expect(e).toMatchObject({ versionActual: 2, etiqueta: 'Acta en revisión' });
    expect(e.versiones.map((v) => [v.version, v.etiqueta])).toEqual([[2, 'Acta en revisión'], [1, 'Necesita corrección']]);
  });
});

describe('Datos de la práctica que gobiernan la comparación (remuneración y responsable de la ARL)', () => {
  const estudiante = (p: string) => actorDe(Rol.ESTUDIANTE, { id: `est-${p}` });

  it('24 · con un acta cargada, ni la empresa, ni el estudiante, ni el docente, ni el auxiliar los cambian (403)', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1');
    const intentos: [string, ReturnType<typeof actorDe>][] = [
      ['empresa', actorDe(Rol.EMPRESA, { empresaId: 'empresa-a' })], ['estudiante', estudiante('pra-c1')],
      ['tutor', actorDe(Rol.TUTOR, { id: 'tutor-asignado' })], ['auxiliar', aux()],
    ];
    for (const [, actor] of intentos) {
      for (const dto of [{ responsableArl: 'cun' as const }, { tipoRemuneracion: 'remunerada' as const }]) {
        await expect(m.gestionarPractica.actualizarVacante('pra-c1', dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
      }
    }
    expect(m.practicas.get('pra-c1')!.instantanea()).toMatchObject({ responsableArlPractica: 'empresa', tipoRemuneracion: 'no_remunerada' });
  });

  it('con un acta cargada, ni coordinación los cambia por la edición común: debe usar la corrección controlada', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1');
    await expect(m.gestionarPractica.actualizarVacante('pra-c1', { responsableArl: 'cun' }, coord())).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.gestionarPractica.actualizarVacante('pra-c1', { tipoRemuneracion: 'remunerada' }, admin())).rejects.toBeInstanceOf(BadRequestException);
    // Los demás datos de la vacante siguen editándose.
    await expect(m.gestionarPractica.actualizarVacante('pra-c1', { cargo: 'Analista' }, estudiante('pra-c1'))).resolves.toBeDefined();
  });

  it('antes de existir un acta se conservan las reglas actuales (el estudiante edita la remuneración)', async () => {
    const m = montarMesaActas();
    m.usuarios.set('est-pra-x', (await (async () => { await m.crear({ id: 'x', practicaId: 'pra-x', sinProcesar: true }); return m.usuarios.get('est-pra-x')!; })()));
    m.documentos.filas.clear();
    await expect(m.gestionarPractica.actualizarVacante('pra-x', { tipoRemuneracion: 'remunerada' }, estudiante('pra-x'))).resolves.toBeDefined();
    expect(m.practicas.get('pra-x')!.instantanea().tipoRemuneracion).toBe('remunerada');
  });

  it('25 · coordinación y administración corrigen con justificación; sin ella (o los demás perfiles) no', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1', DISCREPANTE);
    await expect(m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'empresa', justificacion: 'corto' }, coord())).rejects.toBeInstanceOf(BadRequestException);
    for (const actor of [estudiante('pra-c1'), aux(), actorDe(Rol.TUTOR), actorDe(Rol.EMPRESA)]) {
      await expect(m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'empresa', justificacion: 'Corrección acordada con la empresa.' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    }
    const r = await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'empresa', justificacion: 'Corrección acordada con la empresa.' }, coord());
    expect(r).toMatchObject({ responsableArl: 'empresa', tipoRemuneracion: 'no_remunerada' });
    const r2 = await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { tipoRemuneracion: 'remunerada', justificacion: 'Se pactó apoyo de sostenimiento.' }, admin());
    expect(r2.tipoRemuneracion).toBe('remunerada');
    // Sin cambios reales: no se audita ni se recalcula nada.
    const r3 = await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'empresa', justificacion: 'Se confirma el mismo valor.' }, coord());
    expect(r3.actaIniciacion).toBe('sin_cambios');
  });

  it('26 · el cambio recalcula una validación sin decidir en una ronda nueva y conserva las evidencias anteriores', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    const antes = fila(m, c.validacionId);
    expect(antes.hayDiscrepanciaCritica).toBe(true);
    const evidenciasAntes = m.validaciones.evid.filter((e) => e.validacionActaId === c.validacionId).map((e) => e.id);

    const r = await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'empresa', justificacion: 'El acuerdo con la empresa es que ella afilia.' }, coord());
    expect(r.actaIniciacion).toBe('recalculada');
    const despues = fila(m, c.validacionId);
    expect(despues).toMatchObject({ estado: EstadoValidacionActa.REVISION, hayDiscrepanciaCritica: false, intentos: antes.intentos + 1, asignadoA: 'a1' });
    expect(despues.comparacion!.veredicto).toBe('consistente');
    expect(despues.comparacion!.campos.find((x) => x.campo === 'responsable_arl')!.resultado).toBe('coincide');
    // Historial intacto + evidencias nuevas en la ronda nueva (nada se borra ni se pisa).
    for (const id of evidenciasAntes) expect(m.validaciones.evid.some((e) => e.id === id)).toBe(true);
    const nuevas = m.validaciones.evid.filter((e) => e.validacionActaId === c.validacionId && e.intento === despues.intentos).map((e) => e.tipo);
    expect(nuevas).toEqual(expect.arrayContaining([TipoEvidenciaActa.COMPARACION, TipoEvidenciaActa.CAMBIO_DATOS_PRACTICA]));
    // No hay una segunda versión documental: el archivo no cambió.
    expect([...m.documentos.filas.values()].filter((d) => d.tipo === TipoDocumento.ACTA_INICIO)).toHaveLength(1);
  });

  it('el cambio que NO resuelve la discrepancia la deja visible (se recalcula, no se oculta)', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', DISCREPANTE);
    await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { tipoRemuneracion: 'remunerada', justificacion: 'Se pactó apoyo de sostenimiento.' }, coord());
    const f = fila(m, c.validacionId);
    expect(f.hayDiscrepanciaCritica).toBe(true);
    expect(f.comparacion!.campos.find((x) => x.campo === 'remuneracion')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
    expect(f.comparacion!.campos.find((x) => x.campo === 'responsable_arl')).toMatchObject({ resultado: 'diferente' });
  });

  it('27 · el cambio NO altera una decisión terminal: solo deja constancia de que los datos cambiaron después', async () => {
    const m = montarMesaActas();
    const c = await caso(m, 'c1', {}, aux('a1'));
    await m.mesa.decidir(c.validacionId, aux('a1'), { decision: 'aprobar' }, AHORA);
    const decidida = fila(m, c.validacionId);
    const r = await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'cun', justificacion: 'Cambio de convenio posterior a la decisión.' }, coord());
    expect(r.actaIniciacion).toBe('marcada_posterior_a_decision');
    const despues = fila(m, c.validacionId);
    for (const k of ['estado', 'decididoPor', 'decididoEn', 'motivoDecision', 'comparacion', 'hayDiscrepanciaCritica', 'tipoActaDetectada', 'responsableArlDetectado', 'datosExtraidos'] as const) {
      expect(despues[k]).toEqual(decidida[k]);
    }
    expect(despues.datosPracticaCambiaronEn).toBeInstanceOf(Date);
    expect(m.documentos.filas.get(c.documentoId)!.estado).toBe(EstadoDocumento.APROBADO);
    const detalle = await m.mesa.detalle(c.validacionId, admin(), AHORA);
    expect(detalle.datosPracticaCambiaronDespuesDeDecision).not.toBeNull();
    expect(detalle.comparacion!.vigente).toBe(false);
    // El resultado que vale es el de la decisión (no el recalculado con los datos nuevos).
    expect(detalle.comparacion!.campos.find((x) => x.campo === 'responsable_arl')!.resultado).toBe('coincide');
    expect(m.auditoria.acciones('acta_datos_cambiaron_tras_decision')).toHaveLength(1);
  });

  it('un acta aún sin procesar usará los datos nuevos al procesarse: no hay nada que recalcular', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1', { sinProcesar: true });
    const r = await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'cun', justificacion: 'Se corrige el acuerdo de la ARL.' }, coord());
    expect(r.actaIniciacion).toBe('sin_calculo');
  });

  it('sin acta cargada no hay validación que tocar', async () => {
    const m = montarMesaActas();
    await m.crear({ id: 'x', practicaId: 'pra-x', sinProcesar: true });
    m.documentos.filas.clear();
    const r = await m.gestionarPractica.corregirDatosGobernantes('pra-x', { responsableArl: 'cun', justificacion: 'Se corrige el acuerdo de la ARL.' }, coord());
    expect(r.actaIniciacion).toBe('sin_acta');
  });

  it('28 · el cambio queda auditado: valor anterior, nuevo, quién, cuándo y por qué', async () => {
    const m = montarMesaActas();
    await caso(m, 'c1', DISCREPANTE);
    await m.gestionarPractica.corregirDatosGobernantes('pra-c1', { responsableArl: 'empresa', tipoRemuneracion: 'remunerada', justificacion: 'Acuerdo firmado con la organización.' }, coord('coord-9'));
    const a = m.auditoria.acciones('datos_practica_corregidos_acta');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      actorId: 'coord-9', actorRol: 'coordinador', entidad: 'practica', entidadId: 'pra-c1', justificacion: 'Acuerdo firmado con la organización.',
      metadatos: { responsableArl: { de: 'cun', a: 'empresa' }, remuneracion: { de: 'no_remunerada', a: 'remunerada' } },
    });
    expect(a[0].ocurridoEn).toBeInstanceOf(Date);
    expect(m.auditoria.acciones('acta_recalculada')).toHaveLength(1);
  });

  it('22 · el flujo de la práctica no avanza sin responsable de la ARL, con el mensaje humano, y no lo infiere de la modalidad', async () => {
    const m = montarMesaActas();
    m.practicas.set('pra-n', (await (async () => { await m.crear({ id: 'n', practicaId: 'pra-n', sinProcesar: true, practica: { estado: EstadoPractica.INSCRITA, responsableArlPractica: null, modalidad: ModalidadPractica.PASANTIA } }); return m.practicas.get('pra-n')!; })()));
    await expect(m.gestionarPractica.transicionar('pra-n', EstadoPractica.DOCUMENTACION, 'Inicia el proceso documental.', coord())).rejects.toThrow('Debes indicar quién asume la ARL antes de continuar.');
    expect(m.practicas.get('pra-n')!.estado).toBe(EstadoPractica.INSCRITA);
    expect(m.practicas.get('pra-n')!.responsableArlPractica).toBeNull();
    await m.gestionarPractica.corregirDatosGobernantes('pra-n', { responsableArl: 'empresa', justificacion: 'Se confirma con la organización.' }, coord());
    await expect(m.gestionarPractica.transicionar('pra-n', EstadoPractica.DOCUMENTACION, 'Inicia el proceso documental.', coord())).resolves.toBeDefined();
  });
});

describe('Mesa de Actas · catálogo de motivos de devolución (fuente única)', () => {
  it('el API entrega todos los motivos del dominio, con título, mensaje al estudiante y si exige detalle', () => {
    const m = montarMesaActas();
    const catalogo = m.mesa.motivosDevolucion(aux('a1'));
    expect(catalogo.map((c) => c.codigo).sort()).toEqual(Object.values(MotivoDevolucionActa).sort());
    for (const c of catalogo) {
      expect(c.titulo.length).toBeGreaterThan(5);
      expect(c.mensajeEstudiante).toEqual(MENSAJES_DEVOLUCION_ACTA[c.codigo]);
      expect(c.requiereDetalle).toBe(c.codigo === MotivoDevolucionActa.OTRO);
    }
    expect(Object.keys(catalogo[0]).sort()).toEqual(['codigo', 'mensajeEstudiante', 'requiereDetalle', 'titulo']);
  });
  it('lo que lee el estudiante al devolver sale del mismo catálogo', async () => {
    const m = montarMesaActas();
    const { validacionId, documentoId } = await caso(m, 'c1', DISCREPANTE, aux('a1'));
    const motivo = m.mesa.motivosDevolucion(aux('a1')).find((c) => c.codigo === MotivoDevolucionActa.ARL_NO_COINCIDE)!;
    await m.mesa.decidir(validacionId, aux('a1'), { decision: 'devolver', motivo: motivo.codigo }, AHORA);
    expect(m.documentos.filas.get(documentoId)!.motivoDevolucion).toBe(motivo.mensajeEstudiante.que);
  });
  it('solo quien opera la Mesa lo consulta', () => {
    const m = montarMesaActas();
    expect(() => m.mesa.motivosDevolucion(actorDe(Rol.ESTUDIANTE))).toThrow(ForbiddenException);
    expect(() => m.mesa.motivosDevolucion(actorDe(Rol.TUTOR))).toThrow(ForbiddenException);
    expect(m.mesa.motivosDevolucion(coord()).length).toBeGreaterThan(0);
  });
});
