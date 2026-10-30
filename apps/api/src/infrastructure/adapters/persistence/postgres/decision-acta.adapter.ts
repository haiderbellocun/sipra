import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Documento } from '../../../../domain/entities/documento.entity';
import { DecisionActaPort } from '../../../../domain/ports/out/decision-acta.port';
import {
  ConflictoDecisionActaError, EntradaDecisionActa, planificarDecisionActa,
} from '../../../../domain/services/decision-acta.domain-service';
import { TipoDocumento } from '../../../../domain/entities/documento.entity';
import {
  AuditoriaOrm, DocumentoOrm,
} from '../../../persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionActaOrm, ValidacionActaOrm,
} from '../../../persistence/postgres/entities/validacion-acta.orm-entity';
import { DocumentoMapper } from './mappers';
import { EvidenciaActaMapper, ValidacionActaMapper } from './validacion-acta.adapter';

/** Puntos donde una prueba puede forzar un error a mitad de la operación (ver `alPunto`). */
export type PuntoDecisionActa = 'tras_documento' | 'tras_validacion' | 'tras_evidencia' | 'tras_auditoria_documento';

/**
 * Decisión humana del acta en UNA transacción de PostgreSQL.
 *
 * Límites de la transacción: la fila de la validación y la del documento (bloqueadas, en ese orden, siempre el mismo: sin
 * interbloqueos) y todo lo que la decisión escribe —documento, validación, evidencia y las dos entradas de auditoría—. Lo que
 * queda FUERA, a propósito, y se hace después del commit: avisar al estudiante y anotar el plazo en la bitácora; si esos
 * efectos fallan, la decisión sigue siendo válida y consistente.
 *
 * Concurrencia: quien llega segundo espera el bloqueo, lee la validación ya decidida y recibe `ya_decidida` (409), sin escribir
 * nada. Un reintento tras un commit cuya respuesta se perdió cae en el mismo caso: no hay segunda decisión, evidencia ni auditoría.
 */
@Injectable()
export class DecisionActaPgAdapter implements DecisionActaPort {
  /**
   * SOLO PARA PRUEBAS: si se asigna, se invoca en cada punto de la operación y puede lanzar para simular una interrupción. En
   * producción nadie la asigna.
   */
  alPunto?: (punto: PuntoDecisionActa) => void | Promise<void>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async aplicar(validacionId: string, entrada: EntradaDecisionActa): Promise<Documento> {
    return this.ds.transaction(async (m) => {
      // 1. Bloqueo de la validación (el árbitro de quién decide) y luego del documento: siempre este orden.
      const vOrm = await m.getRepository(ValidacionActaOrm).createQueryBuilder('v')
        .setLock('pessimistic_write').where('v.id = :id', { id: validacionId }).getOne();
      if (!vOrm) throw new ConflictoDecisionActaError('no_encontrada');
      const dOrm = await m.getRepository(DocumentoOrm).createQueryBuilder('d')
        .setLock('pessimistic_write').where('d.id = :id', { id: vOrm.documento_id }).getOne();
      if (!dOrm || dOrm.tipo !== (TipoDocumento.ACTA_INICIO as string)) throw new ConflictoDecisionActaError('no_encontrada');
      const maxima: { v: number }[] = await m.query(
        'SELECT coalesce(max(version), 0)::int AS v FROM documentos WHERE practica_id = $1 AND tipo = $2', [dOrm.practica_id, TipoDocumento.ACTA_INICIO],
      );

      // 2. Comprobaciones y construcción de todo lo que se escribe (puro).
      const plan = planificarDecisionActa(
        { validacion: ValidacionActaMapper.aDominio(vOrm), documento: DocumentoMapper.aDominio(dOrm), versionMaximaActa: maxima[0].v },
        entrada,
      );

      // 3. Documento (compare-and-set por estado: hay bloqueo, pero la condición queda explícita).
      const d = DocumentoMapper.aOrm(plan.documento.instantanea());
      const actualizado = await m.getRepository(DocumentoOrm).update(
        { id: d.id, estado: plan.estadoDocumentoLeido },
        {
          estado: d.estado, puntaje: d.puntaje, banda: d.banda, banderas: d.banderas as never, extraccion: d.extraccion as never,
          decidido_por: d.decidido_por, justificacion_decision: d.justificacion_decision, motivo_devolucion: d.motivo_devolucion,
          actualizado_en: d.actualizado_en,
        },
      );
      if ((actualizado.affected ?? 0) !== 1) throw new ConflictoDecisionActaError('documento_cambio');
      await this.alPunto?.('tras_documento');

      // 4. Validación (compare-and-set por versión), con quién, cuándo, motivo y la reserva liberada.
      const v = await m.getRepository(ValidacionActaOrm).createQueryBuilder().update(ValidacionActaOrm)
        .set({ ...ValidacionActaMapper.columnasMutables(plan.validacion.instantanea()), version: () => 'version + 1' } as never)
        .where('id = :id AND version = :version', { id: validacionId, version: plan.versionValidacionLeida }).execute();
      if ((v.affected ?? 0) !== 1) throw new ConflictoDecisionActaError('no_revisable');
      await this.alPunto?.('tras_validacion');

      // 5. Evidencia de la decisión.
      await m.getRepository(EvidenciaValidacionActaOrm).insert(EvidenciaActaMapper.aOrm(plan.evidencia) as never);
      await this.alPunto?.('tras_evidencia');

      // 6. Auditoría: la del documento y la de la Mesa.
      const auditoria = m.getRepository(AuditoriaOrm);
      for (const [i, r] of plan.auditorias.entries()) {
        await auditoria.insert({
          actor_id: r.actorId, actor_correo: r.actorCorreo, actor_rol: r.actorRol, accion: r.accion, entidad: r.entidad,
          entidad_id: r.entidadId, justificacion: r.justificacion, metadatos: r.metadatos as never, ip: r.ip,
          agente_usuario: r.agenteUsuario?.slice(0, 300) ?? null, ocurrido_en: r.ocurridoEn,
        });
        if (i === 0) await this.alPunto?.('tras_auditoria_documento');
      }
      return plan.documento;
    });
  }
}
