import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, autenticidadPorDefecto,
} from '../src/domain/entities/documento-empresarial';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { TipoEvidenciaDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { MENSAJES_DEVOLUCION_RUT, MotivoDevolucionRut } from '../src/domain/services/mesa-rut.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe } from './soporte-autorizacion';
import {
  AHORA_RUT as AHORA, CEDULA, MIN_RUT as MIN, TEXTO_40_RUT, adminRut, coordRut, lecturaPj, lecturaPn, montarMesaRut, tutor,
} from './soporte-mesa-rut';

type Mesa = ReturnType<typeof montarMesaRut>;
type Opciones = Parameters<Mesa['crear']>[0];

/** Un caso procesado (en revisión) y, si se pide, ya tomado por `quien`. */
async function caso(m: Mesa, id: string, opciones: Partial<Opciones> = {}, quien?: ReturnType<typeof tutor>) {
  const c = await m.crear({ id, ...opciones });
  if (quien) await m.mesa.tomar(c.validacionId as string, quien, AHORA);
  return c as { documentoId: string; validacionId: string; practicaId: string; estudianteId: string };
}
const fila = (m: Mesa, validacionId: string) => m.validaciones.filas.get(validacionId)!;
const docDe = (m: Mesa, documentoId: string) => m.documentos.filas.get(documentoId)!;
const DISCREPANTE: Partial<Opciones> = { sipra: { documento: '1000000099' } };
const OCR_DUDOSO = lecturaPn({ metodo: 'ocr', lecturaDudosa: true, confianzaDocumento: 0.77 });

describe('Mesa de RUT · decisión humana', () => {
  it('aprobar un RUT consistente NO exige justificación larga: documento y validación quedan decididos por la persona', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const respuesta = await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect(respuesta.estado).toBe(EstadoDocumento.APROBADO);
    expect(docDe(m, c.documentoId)).toMatchObject({ estado: EstadoDocumento.APROBADO, decididoPor: t.id });
    expect(fila(m, c.validacionId)).toMatchObject({ estado: Estado.APROBADO_MANUAL, decididoPor: t.id, decididoEn: AHORA, asignadoA: null, reservaHasta: null });
    expect(m.auditoria.acciones('decision_rut')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_documento')).toHaveLength(1);
  });

  it('el sistema NUNCA decide solo: un RUT consistente queda en revisión hasta que una persona decide', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
    expect(docDe(m, c.documentoId).estado).toBe(EstadoDocumento.EN_REVISION);
    expect(m.auditoria.acciones('decision_rut')).toHaveLength(0);
  });

  it('aprobar CONTRA una discrepancia exige 40 caracteres; con ellos procede y queda constancia del apartamiento', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', DISCREPANTE, t);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'corta' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: TEXTO_40_RUT }, AHORA);
    expect(fila(m, c.validacionId).estado).toBe(Estado.APROBADO_MANUAL);
    expect(m.auditoria.acciones('decision_rut')[0].metadatos).toMatchObject({ recomendacion: 'discrepancia_critica', apartaDeRecomendacion: true });
    const evidencia = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)!;
    expect(evidencia).toMatchObject({ actorId: t.id, resultado: 'aprobar', fecha: AHORA });
    expect(evidencia.datos).toMatchObject({ accion: 'aprobar', rol: Rol.TUTOR, justificacion: TEXTO_40_RUT });
  });

  it('la recomendación NUNCA bloquea una decisión humana válida: devolver/rechazar un consistente o aprobar uno dudoso se permite', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const a = await caso(m, 'a', {}, t);
    await expect(m.mesa.decidir(a.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.INFORMACION_INCOMPLETA }, AHORA)).resolves.toBeDefined();
    const b = await caso(m, 'b', { lectura: OCR_DUDOSO }, t);
    await expect(m.mesa.decidir(b.validacionId, t, { decision: 'aprobar', justificacion: TEXTO_40_RUT }, AHORA)).resolves.toBeDefined();
  });

  it('lectura dudosa: aprobar exige 40; los críticos quedan «No se pudo comparar» (nunca «Diferente») y se avisa «Leído por OCR»', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: OCR_DUDOSO, sipra: { documento: '1000000099', nombre: 'JUAN RUIZ' } }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.lectura).toMatchObject({ metodo: 'ocr', dudosa: true, aviso: 'Leído por OCR · revisar contra el documento' });
    const criticos = d.comparacion!.campos.filter((x) => x.criticidad === 'critico');
    expect(criticos.length).toBeGreaterThan(0);
    for (const campo of criticos) {
      expect(campo.resultado).toBe('informacion_insuficiente');
      expect(campo.resultadoTexto).toBe('No se pudo comparar');
      expect(campo.advertencia).toBe('Leído por OCR · revisar contra el documento');
    }
    expect(JSON.stringify(d)).not.toMatch(/0[,.]85|85 ?%|"confianza"/);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'ok' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un RUT de OTRA persona (el estudiante indicó natural y es jurídico) no se compara como natural; aprobarlo exige 40', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', { tipoDocumento: TipoDocumento.RUT_NATURAL, lectura: lecturaPj() }, t);
    expect(fila(m, c.validacionId).expectativa).toBe('persona_distinta');
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'ok' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.PERSONA_NO_COINCIDE }, AHORA)).resolves.toBeDefined();
  });

  it('RUT de un TERCERO (otra persona natural): hoy es discrepancia en el documento; no se soporta tercero', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaPn({ datos: { ...lecturaPn().datos!, numeroDocumento: '1000000099', nit: '1000000099' } }) }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.comparacion!.campos.find((x) => x.campo === 'documento')!.resultado).toBe('diferente');
    expect(d.recomendacion).toBe('discrepancia_critica');
  });

  it('documento incorrecto: no hay comparación; aprobar exige 40; devolver «no es el RUT» procede', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaPn({ tipoDetectado: C.DOCUMENTO_INCORRECTO, datos: null }) }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.recomendacion).toBe('documento_incorrecto');
    expect(d.comparacion).toBeNull();
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'ok' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.DOCUMENTO_INCORRECTO }, AHORA)).resolves.toBeDefined();
  });

  it('RUT jurídico sin empresa en SIPRA: información insuficiente, no se inventa nada', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', { persona: 'juridica', sipra: { empresa: null } }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    for (const campo of d.comparacion!.campos.filter((x) => x.criticidad === 'critico')) expect(campo.resultado).toBe('informacion_insuficiente');
    expect(d.recomendacion).not.toBe('consistente');
  });
});

describe('Mesa de RUT · devolver y rechazar', () => {
  it('devolver exige un motivo del catálogo; el motivo no aplicable al tipo de RUT se rechaza', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    // «NIT no coincide» es de persona jurídica: un RUT natural no lo admite.
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.NIT_NO_COINCIDE }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
  });

  it('devolver con motivo: queda el mensaje del catálogo, el motivo en la validación, aviso al estudiante y bitácora', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.ILEGIBLE }, AHORA);
    expect(fila(m, c.validacionId)).toMatchObject({ estado: Estado.DEVUELTO, motivoDecision: 'documento_ilegible', decididoPor: t.id });
    expect(docDe(m, c.documentoId)).toMatchObject({ estado: EstadoDocumento.DEVUELTO, motivoDevolucion: MENSAJES_DEVOLUCION_RUT[MotivoDevolucionRut.ILEGIBLE].que });
    expect(m.notificar).toHaveBeenCalled();
    expect(m.anotarDevolucion).toHaveBeenCalledTimes(1);
    const v = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)!;
    expect(v.datos).toMatchObject({ accion: 'devolver', motivo: 'documento_ilegible' });
  });

  it('con el motivo «otro» el detalle es obligatorio y es lo que lee el estudiante', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.OTRO, justificacion: 'corto' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.OTRO, justificacion: 'Falta la hoja 2 del formulario completo' }, AHORA);
    const vista = await m.estudiante.estado(c.practicaId, actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }));
    expect(vista).toMatchObject({ estado: 'necesita_correccion', etiqueta: 'Necesita corrección', puedeReenviar: true, que: 'Falta la hoja 2 del formulario completo' });
  });

  it('rechazar exige justificación; rechazar un RUT consistente exige 40; rechazar una discrepancia, la mínima', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const a = await caso(m, 'a', {}, t);
    await expect(m.mesa.decidir(a.validacionId, t, { decision: 'rechazar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(a.validacionId, t, { decision: 'rechazar', justificacion: 'no corresponde al estudiante' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(a.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_RUT }, AHORA)).resolves.toBeDefined();
    expect(fila(m, a.validacionId).estado).toBe(Estado.RECHAZADO);
    const b = await caso(m, 'b', DISCREPANTE, t);
    await expect(m.mesa.decidir(b.validacionId, t, { decision: 'rechazar', justificacion: 'no corresponde al estudiante' }, AHORA)).resolves.toBeDefined();
    expect(docDe(m, b.documentoId).estado).toBe(EstadoDocumento.RECHAZADO);
  });

  it('un caso ya decidido NO se decide otra vez: 409 y no se escribe nada más', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    const evidencias = m.validaciones.evidencias.length;
    const auditorias = m.auditoria.registros.length;
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_RUT }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(m.validaciones.evidencias).toHaveLength(evidencias);
    expect(m.auditoria.registros).toHaveLength(auditorias);
  });

  it('el camino general de decisión de documentos YA NO decide un RUT: solo la Mesa', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    await expect(m.gestionar.decidir(c.documentoId, { decision: 'aprobar', justificacion: TEXTO_40_RUT }, tutor())).rejects.toBeInstanceOf(ForbiddenException);
    expect(docDe(m, c.documentoId).estado).toBe(EstadoDocumento.EN_REVISION);
  });
});

describe('Mesa de RUT · reserva operativa', () => {
  it('tomar reserva 15 minutos a nombre de quien toma y lo audita; liberar la devuelve a la bandeja', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    await expect(m.mesa.tomar(c.validacionId, tutor('t1'), AHORA)).resolves.toMatchObject({ estado: 'mia' });
    expect(fila(m, c.validacionId)).toMatchObject({ asignadoA: 't1', reservaHasta: new Date(AHORA.getTime() + 15 * MIN) });
    expect(m.auditoria.acciones('rut_asignado')).toHaveLength(1);
    await m.mesa.liberar(c.validacionId, tutor('t1'), AHORA);
    expect(fila(m, c.validacionId)).toMatchObject({ asignadoA: null, reservaHasta: null });
    expect(m.auditoria.acciones('rut_liberado')).toHaveLength(1);
  });

  it('un segundo funcionario no toma un caso con reserva vigente (409), ni lo libera, ni lo decide por encima', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1', {}, tutor('t1'));
    const ahora = new Date(AHORA.getTime() + 5 * MIN);
    await expect(m.mesa.tomar(c.validacionId, tutor('t2'), ahora)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.liberar(c.validacionId, tutor('t2'), ahora)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.decidir(c.validacionId, tutor('t2'), { decision: 'aprobar' }, ahora)).rejects.toBeInstanceOf(ConflictException);
    expect(fila(m, c.validacionId).asignadoA).toBe('t1');
  });

  it('la reserva vence sola: otro la toma, y quien la perdió ya no puede decidir (409)', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1', {}, tutor('t1'));
    const despues = new Date(AHORA.getTime() + 16 * MIN);
    await expect(m.mesa.decidir(c.validacionId, tutor('t1'), { decision: 'aprobar' }, despues)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.tomar(c.validacionId, tutor('t2'), despues)).resolves.toMatchObject({ estado: 'mia' });
    await expect(m.mesa.decidir(c.validacionId, tutor('t1'), { decision: 'aprobar' }, despues)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sin reserva no se decide (409)', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    await expect(m.mesa.decidir(c.validacionId, tutor(), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([['coordinación', coordRut()], ['administración', adminRut()]])('%s libera la reserva de otra persona (auditado como administrativa)', async (_n, supervisor) => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1', {}, tutor('t1'));
    await m.mesa.liberar(c.validacionId, supervisor, AHORA);
    expect(fila(m, c.validacionId).asignadoA).toBeNull();
    expect(m.auditoria.acciones('rut_liberado')[0].metadatos).toMatchObject({ administrativa: true });
  });

  it('CONCURRENCIA · 25 personas toman el mismo caso a la vez: UNA gana y 24 reciben 409', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    const r = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => m.mesa.tomar(c.validacionId, tutor(`t${i}`), AHORA)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected' && x.reason instanceof ConflictException)).toHaveLength(24);
    expect(m.auditoria.acciones('rut_asignado')).toHaveLength(1);
  });

  it('«tomar siguiente»: respeta la prioridad y dos personas a la vez reciben casos distintos', async () => {
    const m = montarMesaRut();
    await caso(m, 'normal');
    const incorrecto = await caso(m, 'incorrecto', { lectura: lecturaPn({ tipoDetectado: C.DOCUMENTO_INCORRECTO, datos: null }) });
    await caso(m, 'critico', DISCREPANTE);
    const [r1, r2] = await Promise.all([m.mesa.tomarSiguiente(tutor('t1'), {}, AHORA), m.mesa.tomarSiguiente(tutor('t2'), {}, AHORA)]);
    expect([r1.estado, r2.estado]).toEqual(['tomado', 'tomado']);
    expect(r1.validacionId).not.toBe(r2.validacionId);
    expect(new Set([r1.validacionId, r2.validacionId]).has(incorrecto.validacionId)).toBe(true);
    expect((await m.mesa.tomarSiguiente(tutor('t3'), {}, AHORA)).estado).toBe('tomado');
    expect((await m.mesa.tomarSiguiente(tutor('t4'), {}, AHORA)).estado).toBe('sin_casos');
  });

  it('un caso que aún no se procesó (o falló) no se puede tomar ni decidir: 409', async () => {
    const m = montarMesaRut();
    const c = await m.crear({ id: 'c1', sinProcesar: true });
    await expect(m.mesa.tomar(c.validacionId as string, tutor(), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.decidir(c.validacionId as string, tutor(), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Mesa de RUT · decisión atómica y concurrente', () => {
  it('CONCURRENCIA · 12 decisiones simultáneas sobre el mismo caso: UNA aplica, 11 reciben 409 y no hay escrituras de más', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const r = await Promise.allSettled(Array.from({ length: 12 }, () => m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected' && x.reason instanceof ConflictException)).toHaveLength(11);
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)).toHaveLength(1);
    expect(m.auditoria.acciones('decision_rut')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_documento')).toHaveLength(1);
  });

  it('decisiones contradictorias a la vez (aprobar y devolver): gana una, la otra recibe 409', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const r = await Promise.allSettled([
      m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA),
      m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.INFORMACION_INCOMPLETA }, AHORA),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(fila(m, c.validacionId).estado).not.toBe(Estado.REVISION);
  });

  it.each(['tras_documento', 'tras_validacion', 'tras_evidencia', 'tras_auditoria_documento'] as const)(
    'ROLLBACK COMPLETO si la operación se interrumpe en «%s»: ni documento, ni validación, ni evidencia, ni auditoría',
    async (punto) => {
      const m = montarMesaRut();
      const t = tutor();
      const c = await caso(m, 'c1', {}, t);
      const antes = { doc: { ...docDe(m, c.documentoId) }, val: { ...fila(m, c.validacionId) }, ev: m.validaciones.evidencias.length, au: m.auditoria.registros.length };
      m.decision.alPunto = (p) => { if (p === punto) throw new Error('interrupción simulada'); };
      await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toThrow('interrupción simulada');
      expect(docDe(m, c.documentoId)).toEqual(antes.doc);
      expect(fila(m, c.validacionId)).toEqual(antes.val);
      expect(m.validaciones.evidencias).toHaveLength(antes.ev);
      expect(m.auditoria.registros).toHaveLength(antes.au);
      // Y el caso sigue siendo decidible: se reintenta sin tocar nada a mano.
      m.decision.alPunto = undefined;
      await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).resolves.toBeDefined();
    },
  );

  it('los avisos y la bitácora ocurren DESPUÉS del commit: si la decisión se revierte, no se avisa al estudiante', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    m.decision.alPunto = (p) => { if (p === 'tras_evidencia') throw new Error('interrupción simulada'); };
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.ILEGIBLE }, AHORA)).rejects.toThrow();
    expect(m.notificar).not.toHaveBeenCalled();
    expect(m.anotarDevolucion).not.toHaveBeenCalled();
  });

  it('la evidencia de la decisión es de solo inserción: decidir nunca modifica las evidencias anteriores', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const previas = JSON.stringify(m.validaciones.evidencias);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect(JSON.stringify(m.validaciones.evidencias.slice(0, (JSON.parse(previas) as unknown[]).length))).toBe(previas);
    // La evidencia no lleva datos personales del documento: solo rol, acción, motivo y la justificación escrita.
    const evidencia = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)!;
    expect(Object.keys(evidencia.datos).sort()).toEqual(['accion', 'justificacion', 'motivo', 'rol']);
    expect(JSON.stringify(evidencia)).not.toContain(CEDULA);
  });
});

describe('Mesa de RUT · reenvío y versiones', () => {
  it('un RUT nuevo tras la devolución es OTRA versión con SU validación; la anterior queda histórica y no se reabre', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    await m.mesa.decidir(v1.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.ILEGIBLE }, AHORA);
    const v2 = await caso(m, 'v2', { practicaId: 'p1', version: 2 });
    expect(v2.validacionId).not.toBe(v1.validacionId);
    expect(fila(m, v1.validacionId)).toMatchObject({ estado: Estado.DEVUELTO, motivoDecision: 'documento_ilegible' });
    expect(fila(m, v2.validacionId).estado).toBe(Estado.REVISION);
    const bandeja = await m.mesa.listar(coordRut(), {}, AHORA);
    expect(bandeja.items.map((i) => i.validacionId)).toEqual([v2.validacionId]);
    expect(bandeja.items[0].esReenvio).toBe(true);
    const detalle = await m.mesa.detalle(v2.validacionId, t, AHORA);
    expect(detalle.versiones.map((x) => [x.version, x.vigente])).toEqual([[2, true], [1, false]]);
  });

  it('una versión vieja que seguía abierta no se toma ni se decide: 409 «hay una más reciente»', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    await caso(m, 'v2', { practicaId: 'p1', version: 2 });
    await expect(m.mesa.decidir(v1.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toThrow(/versión más reciente/);
    await expect(m.mesa.tomar(v1.validacionId, tutor('t2'), AHORA)).rejects.toThrow(/versión más reciente/);
    expect(docDe(m, v1.documentoId).estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('el estudiante ve el estado de la versión VIGENTE: tras reenviar, «En revisión» y ya no «Necesita corrección»', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    const yo = actorDe(Rol.ESTUDIANTE, { id: v1.estudianteId });
    await m.mesa.decidir(v1.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.ILEGIBLE }, AHORA);
    expect((await m.estudiante.estado('p1', yo)).estado).toBe('necesita_correccion');
    await caso(m, 'v2', { practicaId: 'p1', version: 2, recibidaHace: -1 });
    expect((await m.estudiante.estado('p1', yo)).estado).toBe('en_revision');
  });
});

describe('Mesa de RUT · recálculo y datos de SIPRA cambiados', () => {
  it('antes de decidir un caso abierto se recalcula con la lectura existente (sin releer el PDF) y la decisión usa lo recalculado', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    expect((fila(m, c.validacionId).comparacion as unknown as { veredicto: string }).veredicto).toBe('consistente');
    m.cambiarSipra(c.practicaId, { documento: '1000000099' });
    // Con SIPRA cambiado, aprobar «porque era consistente» ya no basta: ahora es una discrepancia y exige 40.
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'ok' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect((fila(m, c.validacionId).comparacion as unknown as { veredicto: string }).veredicto).toBe('discrepancia');
    expect(m.auditoria.acciones('rut_recalculado')).toHaveLength(1);
    expect(m.almacen.leer).not.toHaveBeenCalled();
  });

  it('el detalle de un caso abierto muestra «Los datos de SIPRA cambiaron después de esta validación.» cuando se recalculó', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    expect((await m.mesa.detalle(c.validacionId, t, AHORA)).avisoDatosSipra).toBeNull();
    m.cambiarSipra(c.practicaId, { nombre: 'OTRA PERSONA DISTINTA' });
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.avisoDatosSipra).toBe('Los datos de SIPRA cambiaron después de esta validación.');
    expect(d.comparacion!.campos.find((x) => x.campo === 'nombre')!.resultado).toBe('diferente');
  });

  it('SIPRA cambia DESPUÉS de una decisión: la decisión NO se altera; se avisa y se deja constancia UNA sola vez', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    const decidida = { ...fila(m, c.validacionId) };
    m.cambiarSipra(c.practicaId, { documento: '1000000099' });
    const despues = new Date(AHORA.getTime() + 60 * MIN);
    const d1 = await m.mesa.detalle(c.validacionId, t, despues);
    expect(d1.avisoDatosSipra).toBe('Los datos de SIPRA cambiaron después de esta validación.');
    expect(d1.decision).toMatchObject({ estado: Estado.APROBADO_MANUAL });
    expect(fila(m, c.validacionId)).toMatchObject({
      estado: Estado.APROBADO_MANUAL, decididoPor: decidida.decididoPor, decididoEn: decidida.decididoEn, comparacion: decidida.comparacion, datosSipraCambiaronEn: despues,
    });
    expect(docDe(m, c.documentoId).estado).toBe(EstadoDocumento.APROBADO);
    await m.mesa.detalle(c.validacionId, t, new Date(despues.getTime() + MIN));
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA)).toHaveLength(1);
    expect(m.auditoria.acciones('rut_datos_cambiaron_tras_decision')).toHaveLength(1);
    // Un caso decidido no se recalcula ni se reabre.
    expect(m.auditoria.acciones('rut_recalculado')).toHaveLength(0);
  });

  it('un caso decidido que no cambió no genera constancia ni aviso', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.avisoDatosSipra).toBeNull();
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA)).toHaveLength(0);
  });
});

describe('Mesa de RUT · detalle del operador', () => {
  it('PN: tabla SIPRA | RUT | RESULTADO con documento y nombre críticos y los informativos aparte', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    const por = Object.fromEntries(d.comparacion!.campos.map((x) => [x.campo, x]));
    expect(por.documento).toMatchObject({ criticidad: 'critico', resultado: 'coincide', sipra: CEDULA, rut: CEDULA });
    expect(por.nombre).toMatchObject({ criticidad: 'critico', resultado: 'coincide' });
    for (const k of ['ciiu', 'divipola', 'fecha_generacion']) expect(por[k]).toMatchObject({ criticidad: 'informativo', resultado: 'informativo' });
    expect(d).toMatchObject({ tipoEsperado: TipoDocumento.RUT_NATURAL, tipoDetectado: C.RUT_PERSONA_NATURAL, tipoPersona: 'natural', puedeDecidir: true });
    expect(d.lectura).toMatchObject({ metodo: 'texto', dudosa: false, aviso: null });
  });

  it('PJ: NIT, DV y razón social críticos', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', { persona: 'juridica' }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.comparacion!.campos.filter((x) => x.criticidad === 'critico').map((x) => x.campo).sort()).toEqual(['dv', 'nit', 'razon_social']);
    expect(d.comparacion!.veredicto).toBe('consistente');
  });

  it('el documento de identidad se ve completo solo con el caso tomado o en supervisión; si no, enmascarado', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    const sinTomar = await m.mesa.detalle(c.validacionId, tutor('otro'), AHORA);
    expect(sinTomar.estudiante.documento).toBeNull();
    expect(JSON.stringify(sinTomar)).not.toContain(CEDULA);
    await m.mesa.tomar(c.validacionId, tutor('otro'), AHORA);
    expect((await m.mesa.detalle(c.validacionId, tutor('otro'), AHORA)).estudiante.documento).toBe(CEDULA);
    expect((await m.mesa.detalle(c.validacionId, adminRut(), AHORA)).estudiante.documento).toBe(CEDULA);
  });

  it('QR: solo «detectado / no determinado» y destino DIAN; NUNCA «auténtico»: la autenticidad sigue sin verificarse', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const conQr = await caso(m, 'a', { lectura: lecturaPn({ autenticidad: { ...autenticidadPorDefecto(), qrPresente: true, qrDecodificado: true, qrDestinoOficial: true } }) }, t);
    const sinQr = await caso(m, 'b', {}, t);
    const a = await m.mesa.detalle(conQr.validacionId, t, AHORA);
    const b = await m.mesa.detalle(sinQr.validacionId, t, AHORA);
    expect(a.autenticidad).toMatchObject({ estado: 'no_verificable', qr: 'detectado', destinoOficialDian: true });
    expect(b.autenticidad).toMatchObject({ estado: 'no_verificable', qr: 'no_determinado', destinoOficialDian: false });
    expect(JSON.stringify([a, b])).not.toMatch(/aut[eé]ntico\b(?! del)/i);
  });

  it('el archivo solo se sirve a quien tiene el caso tomado (o supervisa) y la apertura queda auditada', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    await expect(m.mesa.archivo(c.validacionId, tutor('otro'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await m.mesa.tomar(c.validacionId, tutor('otro'), AHORA);
    await expect(m.mesa.archivo(c.validacionId, tutor('otro'), AHORA)).resolves.toMatchObject({ mime: 'application/pdf' });
    expect(m.auditoria.acciones('documento_visualizado')).toHaveLength(1);
  });

  it('el catálogo de motivos lo sirve el servidor, con mensaje al estudiante y a qué RUT aplica', () => {
    const m = montarMesaRut();
    const catalogo = m.mesa.motivosDevolucion(tutor());
    expect(catalogo.map((x) => x.codigo)).toEqual(expect.arrayContaining(Object.values(MotivoDevolucionRut)));
    expect(catalogo.find((x) => x.codigo === MotivoDevolucionRut.OTRO)!.requiereDetalle).toBe(true);
    for (const x of catalogo) expect(x.mensajeEstudiante.que.length).toBeGreaterThan(5);
  });
});

describe('Mesa de RUT · permisos y alcance', () => {
  it.each([Rol.AUXILIAR, Rol.EMPRESA, Rol.EXTENSION, Rol.ESTUDIANTE])('%s NO opera la Mesa: ni bandeja, ni detalle, ni toma, ni decisión, ni archivo, ni supervisión', async (rol) => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    const a = actorDe(rol);
    await expect(m.mesa.listar(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.detalle(c.validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomar(c.validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomarSiguiente(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.decidir(c.validacionId, a, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.archivo(c.validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => m.mesa.motivosDevolucion(a)).toThrow(ForbiddenException);
    expect(fila(m, c.validacionId).asignadoA).toBeNull();
  });

  it('el docente no supervisa; coordinación y administración sí', async () => {
    const m = montarMesaRut();
    await caso(m, 'c1');
    await expect(m.mesa.supervision(tutor(), AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(coordRut(), AHORA)).resolves.toMatchObject({ abiertas: 1, libres: 1 });
    await expect(m.mesa.supervision(adminRut(), AHORA)).resolves.toMatchObject({ abiertas: 1 });
  });

  it('un docente de otra escuela, o sin escuelas, no ve la bandeja ni el caso («no existe»)', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    const ajeno = actorDe(Rol.TUTOR, { id: 'tutor-ajeno', escuelas: ['ESC-OTRA'] });
    const sinEscuelas = actorDe(Rol.TUTOR, { id: 'tutor-sin', escuelas: [] });
    expect((await m.mesa.listar(ajeno, {}, AHORA)).total).toBe(0);
    expect((await m.mesa.listar(sinEscuelas, {}, AHORA)).total).toBe(0);
    await expect(m.mesa.detalle(c.validacionId, ajeno, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.mesa.tomar(c.validacionId, ajeno, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.mesa.tomarSiguiente(ajeno, {}, AHORA)).resolves.toMatchObject({ estado: 'sin_casos' });
    expect((await m.mesa.listar(tutor(), {}, AHORA)).total).toBe(1);
  });

  it('solo supervisión pide otros estados en la bandeja; el docente siempre ve lo abierto', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    await caso(m, 'c2');
    expect((await m.mesa.listar(t, { estado: 'aprobado_manual' }, AHORA)).items.map((i) => i.estado)).toEqual(['revision']);
    expect((await m.mesa.listar(coordRut(), { estado: 'aprobado_manual' }, AHORA)).items.map((i) => i.estado)).toEqual(['aprobado_manual']);
  });
});

describe('RUT · lo que ve el estudiante', () => {
  it('solo ve el estado de SU práctica: la de otro estudiante «no existe» (404) y otros roles no entran (403)', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    const otro = actorDe(Rol.ESTUDIANTE, { id: 'est-otro' });
    await expect(m.estudiante.estado(c.practicaId, otro)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.estudiante.estado('no-existe', actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }))).rejects.toBeInstanceOf(NotFoundException);
    for (const rol of [Rol.TUTOR, Rol.COORDINADOR, Rol.EMPRESA, Rol.AUXILIAR]) {
      await expect(m.estudiante.estado(c.practicaId, actorDe(rol))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('los seis estados humanos, y NADA técnico: ni códigos, ni confianza, ni hashes, ni causas, ni detalle del OCR', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const yoDe = (c: { estudianteId: string }) => actorDe(Rol.ESTUDIANTE, { id: c.estudianteId });
    const procesando = await m.crear({ id: 'p', sinProcesar: true });
    expect((await m.estudiante.estado(procesando.practicaId, yoDe(procesando))).estado).toBe('en_procesamiento');
    const revision = await caso(m, 'r', { lectura: OCR_DUDOSO, sipra: { documento: '1000000099' } }, t);
    const vistaRevision = await m.estudiante.estado(revision.practicaId, yoDe(revision));
    expect(vistaRevision).toMatchObject({ estado: 'en_revision', etiqueta: 'En revisión', puedeReenviar: false });
    const aprobado = await caso(m, 'a', {}, t);
    await m.mesa.decidir(aprobado.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect(await m.estudiante.estado(aprobado.practicaId, yoDe(aprobado))).toMatchObject({ estado: 'aprobado', etiqueta: 'Aprobado' });
    const rechazado = await caso(m, 'x', {}, t);
    await m.mesa.decidir(rechazado.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_RUT }, AHORA);
    expect(await m.estudiante.estado(rechazado.practicaId, yoDe(rechazado))).toMatchObject({ estado: 'rechazado', etiqueta: 'Rechazado' });
    const devuelto = await caso(m, 'd', {}, t);
    await m.mesa.decidir(devuelto.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.DOCUMENTO_INCORRECTO }, AHORA);
    const vistaDevuelto = await m.estudiante.estado(devuelto.practicaId, yoDe(devuelto));
    expect(vistaDevuelto).toMatchObject({
      estado: 'necesita_correccion', que: MENSAJES_DEVOLUCION_RUT[MotivoDevolucionRut.DOCUMENTO_INCORRECTO].que,
      hacer: MENSAJES_DEVOLUCION_RUT[MotivoDevolucionRut.DOCUMENTO_INCORRECTO].hacer,
    });
    const todo = JSON.stringify([vistaRevision, vistaDevuelto]);
    expect(Object.keys(vistaDevuelto).sort()).toEqual(['estado', 'etiqueta', 'hacer', 'puedeReenviar', 'que']);
    expect(todo).not.toMatch(/documento_incorrecto|discrepancia|confianza|hash|C[0-3]_|\bocr\b|lecturaDudosa|aprobado_manual/i);
  });

  it('sin RUT cargado: «Pendiente de cargar»', async () => {
    const m = montarMesaRut();
    const c = await caso(m, 'c1');
    m.documentos.filas.clear();
    expect(await m.estudiante.estado(c.practicaId, actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }))).toMatchObject({ estado: 'pendiente', puedeReenviar: true });
  });
});

describe('Mesa de RUT · lo que la pantalla necesita de la bandeja y la supervisión', () => {
  it('cada ítem trae lo esperado y lo detectado; los KPI cuentan OCR dudoso y persona distinta; el filtro de persona distinta funciona', async () => {
    const m = montarMesaRut();
    await caso(m, 'normal');
    await caso(m, 'ocr', { lectura: OCR_DUDOSO });
    await caso(m, 'pd', { tipoDocumento: TipoDocumento.RUT_NATURAL, lectura: lecturaPj() });
    const l = await m.mesa.listar(coordRut(), {}, AHORA);
    expect(l.kpis).toMatchObject({ abiertas: 3, lecturaDudosa: 1, personaDistinta: 1 });
    const pd = l.items.find((i) => i.personaDistinta)!;
    expect(pd).toMatchObject({ tipoEsperado: 'rut_natural', tipoDetectado: 'rut_persona_juridica', tipoRut: 'persona_juridica' });
    expect((await m.mesa.listar(coordRut(), { personaDistinta: 'si' }, AHORA)).items.map((i) => i.validacionId)).toEqual([pd.validacionId]);
    expect((await m.mesa.listar(coordRut(), { lecturaDudosa: 'si' }, AHORA)).total).toBe(1);
    const s = await m.mesa.supervision(coordRut(), AHORA);
    expect(s).toMatchObject({ lecturaDudosa: 1, personaDistinta: 1 });
  });

  it('las versiones traen el motivo de la devolución para el historial', async () => {
    const m = montarMesaRut();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    await m.mesa.decidir(v1.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionRut.ILEGIBLE }, AHORA);
    const v2 = await caso(m, 'v2', { practicaId: 'p1', version: 2 });
    const d = await m.mesa.detalle(v2.validacionId, t, AHORA);
    expect(d.versiones.find((x) => x.version === 1)).toMatchObject({ estado: 'devuelto', motivo: 'documento_ilegible', vigente: false });
    expect(d.versiones.find((x) => x.version === 2)).toMatchObject({ motivo: null, vigente: true });
  });
});
