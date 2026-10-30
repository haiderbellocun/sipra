import { ConflictException } from '@nestjs/common';
import { EstadoDocumento } from '../src/domain/entities/documento.entity';
import { EstadoValidacionActa, TipoEvidenciaActa } from '../src/domain/entities/validacion-acta.entity';
import { PuntoDecisionActa } from '../src/infrastructure/adapters/persistence/postgres/decision-acta.adapter';
import { AHORA_MESA as AHORA, aux, coord, montarMesaActas } from './soporte-mesa-actas';

type Mesa = ReturnType<typeof montarMesaActas>;

async function casoTomado(m: Mesa, id: string) {
  const c = await m.crear({ id });
  await m.mesa.tomar(c.validacionId as string, aux('a1'), AHORA);
  return c as { documentoId: string; validacionId: string };
}

const decisiones = (m: Mesa) => m.validaciones.evid.filter((e) => e.tipo === TipoEvidenciaActa.DECISION_HUMANA).length;
const auditoriasDecision = (m: Mesa) => m.auditoria.acciones('decision_acta').length + m.auditoria.acciones('decision_documento').length;

describe('Decisión del acta · una sola operación atómica', () => {
  const PUNTOS: [string, PuntoDecisionActa][] = [
    ['A · después de actualizar el documento y antes de la validación', 'tras_documento'],
    ['B · después de la validación y antes de la evidencia', 'tras_validacion'],
    ['C · después de la evidencia y antes de la auditoría', 'tras_evidencia'],
    ['D · entre las dos entradas de auditoría', 'tras_auditoria_documento'],
  ];

  for (const decision of ['aprobar', 'devolver', 'rechazar'] as const) {
    for (const [titulo, punto] of PUNTOS) {
      it(`${titulo} (${decision}): todo se revierte`, async () => {
        const m = montarMesaActas();
        const { validacionId, documentoId } = await casoTomado(m, 'c1');
        const antesDoc = { ...(m.documentos.filas.get(documentoId) as object) };
        const antesVal = { ...(m.validaciones.filas.get(validacionId) as object) };
        const evidAntes = m.validaciones.evid.length;
        const audAntes = m.auditoria.registros.length;

        m.decision.alPunto = (p) => { if (p === punto) throw new Error('fallo forzado'); };
        await expect(m.mesa.decidir(validacionId, aux('a1'), {
          decision, motivo: decision === 'devolver' ? ('informacion_incompleta' as never) : undefined,
          justificacion: decision === 'rechazar' ? 'x'.repeat(50) : undefined,
        }, AHORA)).rejects.toThrow('fallo forzado');

        expect(m.documentos.filas.get(documentoId)).toEqual(antesDoc);
        expect(m.validaciones.filas.get(validacionId)).toEqual(antesVal);
        expect(m.validaciones.filas.get(validacionId)).toMatchObject({ estado: EstadoValidacionActa.REVISION, asignadoA: 'a1', decididoEn: null });
        expect(m.validaciones.evid).toHaveLength(evidAntes);
        expect(m.auditoria.registros).toHaveLength(audAntes);
        expect(decisiones(m)).toBe(0);
        expect(auditoriasDecision(m)).toBe(0);

        // La reserva sigue intacta: tras el fallo se puede decidir de nuevo y esta vez confirma.
        m.decision.alPunto = undefined;
        await m.mesa.decidir(validacionId, aux('a1'), {
          decision, motivo: decision === 'devolver' ? ('informacion_incompleta' as never) : undefined,
          justificacion: decision === 'rechazar' ? 'x'.repeat(50) : undefined,
        }, AHORA);
        expect(decisiones(m)).toBe(1);
        expect(auditoriasDecision(m)).toBe(2);
      });
    }
  }

  it('retry tras un commit exitoso: 409 controlado, sin segunda evidencia, auditoría ni nuevo decididoEn', async () => {
    const m = montarMesaActas();
    const { validacionId } = await casoTomado(m, 'c1');
    await m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, AHORA);
    const decididoEn = m.validaciones.filas.get(validacionId)?.decididoEn;
    const version = m.validaciones.filas.get(validacionId)?.version;

    await expect(m.mesa.decidir(validacionId, aux('a1'), { decision: 'aprobar' }, new Date(AHORA.getTime() + 60_000))).rejects.toBeInstanceOf(ConflictException);
    expect(decisiones(m)).toBe(1);
    expect(auditoriasDecision(m)).toBe(2);
    expect(m.validaciones.filas.get(validacionId)?.decididoEn).toEqual(decididoEn);
    expect(m.validaciones.filas.get(validacionId)?.version).toBe(version);
  });

  it('10 decisiones simultáneas: solo una confirma, las demás 409, una evidencia y dos auditorías', async () => {
    const m = montarMesaActas();
    const { validacionId } = await casoTomado(m, 'c1');
    const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => m.mesa.decidir(validacionId, aux('a1'), (i % 2
      ? { decision: 'devolver', motivo: 'informacion_incompleta' as never } : { decision: 'aprobar' }), AHORA)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazadas = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(rechazadas).toHaveLength(9);
    for (const x of rechazadas) expect(x.reason).toBeInstanceOf(ConflictException);
    expect(decisiones(m)).toBe(1);
    expect(auditoriasDecision(m)).toBe(2);
  });

  it('una decisión ajena al responsable de la reserva se rechaza dentro de la transacción y no escribe nada', async () => {
    const m = montarMesaActas();
    const { validacionId } = await casoTomado(m, 'c1');
    await expect(m.mesa.decidir(validacionId, aux('a2'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(decisiones(m)).toBe(0);
    expect(auditoriasDecision(m)).toBe(0);
  });
});

describe('Decisión del acta · inconsistencia heredada (Documento decidido + Validación en revisión)', () => {
  async function inconsistente(m: Mesa) {
    const c = await casoTomado(m, 'c1');
    const d = m.documentos.filas.get(c.documentoId) as object;
    m.documentos.filas.set(c.documentoId, { ...d, estado: EstadoDocumento.APROBADO } as never);
    return c;
  }

  it('la supervisión la cuenta y la lista, sin corregirla', async () => {
    const m = montarMesaActas();
    const { validacionId, documentoId } = await inconsistente(m);
    const s = await m.mesa.supervision(coord(), AHORA);
    expect(s.inconsistentes).toBe(1);
    expect(s.inconsistencias[0]).toMatchObject({ validacionId, documentoId, estadoDocumento: EstadoDocumento.APROBADO });
    expect(m.validaciones.filas.get(validacionId)?.estado).toBe(EstadoValidacionActa.REVISION);
  });

  it('el detalle la marca como inconsistencia operativa y no permite decidir', async () => {
    const m = montarMesaActas();
    const { validacionId } = await inconsistente(m);
    const d = await m.mesa.detalle(validacionId, aux('a1'), AHORA);
    expect(d.inconsistenciaOperativa).toMatchObject({ estadoDocumento: EstadoDocumento.APROBADO });
    expect(d.puedeDecidir).toBe(false);
  });

  it('la bandeja la señala; no se puede tomar ni «tomar siguiente» la entrega; decidir da 409 sin escribir', async () => {
    const m = montarMesaActas();
    const c = await m.crear({ id: 'c1' });
    const d = m.documentos.filas.get(c.documentoId) as object;
    m.documentos.filas.set(c.documentoId, { ...d, estado: EstadoDocumento.RECHAZADO } as never);
    const lista = await m.mesa.listar(aux('a1'), {}, AHORA);
    expect(lista.items[0].inconsistenciaOperativa).toBe(true);
    await expect(m.mesa.tomar(c.validacionId as string, aux('a1'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(await m.mesa.tomarSiguiente(aux('a1'), {}, AHORA)).toEqual({ estado: 'sin_casos', validacionId: null });
    await expect(m.mesa.decidir(c.validacionId as string, aux('a1'), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(decisiones(m)).toBe(0);
    expect(auditoriasDecision(m)).toBe(0);
  });
});
