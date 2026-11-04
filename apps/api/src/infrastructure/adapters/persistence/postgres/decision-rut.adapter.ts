import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Documento, TipoDocumento } from '../../../../domain/entities/documento.entity';
import { DecisionRutPort } from '../../../../domain/ports/out/decision-rut.port';
import {
  ConflictoDecisionRutError, EntradaDecisionRut, planificarDecisionRut,
} from '../../../../domain/services/decision-rut.domain-service';
import { AuditoriaOrm, DocumentoOrm } from '../../../persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../../../persistence/postgres/entities/validacion-documento-empresarial.orm-entity';
import { DocumentoMapper } from './mappers';
import {
  EvidenciaDocumentoEmpresarialMapper, ValidacionDocumentoEmpresarialMapper,
} from './validacion-documento-empresarial.adapter';

/** Puntos donde una prueba puede forzar un error a mitad de la operación (ver `alPunto`). */
export type PuntoDecisionRut = 'tras_documento' | 'tras_validacion' | 'tras_evidencia' | 'tras_auditoria_documento';

const TIPOS_RUT: readonly string[] = [TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO];

/**
 * Decisión humana del RUT en UNA transacción de PostgreSQL (mismo diseño que la del acta).
 *
 * Se bloquean, siempre en este orden, la fila de la validación y la del documento; dentro se escribe todo: documento, validación
 * (con quién, cuándo, motivo y reserva liberada), evidencia y las dos entradas de auditoría. Fuera, tras el commit: avisos y bitácora.
 *
 * Concurrencia: quien llega segundo espera el bloqueo, lee la validación ya decidida y recibe `ya_decidida` (409) sin escribir nada.
 */
@Injectable()
export class DecisionRutPgAdapter implements DecisionRutPort {
  /** SOLO PARA PRUEBAS: se invoca en cada punto y puede lanzar para simular una interrupción. En producción nadie la asigna. */
  alPunto?: (punto: PuntoDecisionRut) => void | Promise<void>;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async aplicar(validacionId: string, entrada: EntradaDecisionRut): Promise<Documento> {
    return this.ds.transaction(async (m) => {
      const vOrm = await m.getRepository(ValidacionDocumentoEmpresarialOrm).createQueryBuilder('v')
        .setLock('pessimistic_write').where('v.id = :id', { id: validacionId }).getOne();
      if (!vOrm) throw new ConflictoDecisionRutError('no_encontrada');
      const dOrm = await m.getRepository(DocumentoOrm).createQueryBuilder('d')
        .setLock('pessimistic_write').where('d.id = :id', { id: vOrm.documento_id }).getOne();
      if (!dOrm || !TIPOS_RUT.includes(dOrm.tipo)) throw new ConflictoDecisionRutError('no_encontrada');
      const maxima: { v: number }[] = await m.query(
        'SELECT coalesce(max(version), 0)::int AS v FROM documentos WHERE practica_id = $1 AND tipo = $2', [dOrm.practica_id, dOrm.tipo],
      );

      const plan = planificarDecisionRut(
        { validacion: ValidacionDocumentoEmpresarialMapper.aDominio(vOrm), documento: DocumentoMapper.aDominio(dOrm), versionMaximaRut: maxima[0].v },
        entrada,
      );

      const d = DocumentoMapper.aOrm(plan.documento.instantanea());
      const actualizado = await m.getRepository(DocumentoOrm).update(
        { id: d.id, estado: plan.estadoDocumentoLeido },
        {
          estado: d.estado, puntaje: d.puntaje, banda: d.banda, banderas: d.banderas as never, extraccion: d.extraccion as never,
          decidido_por: d.decidido_por, justificacion_decision: d.justificacion_decision, motivo_devolucion: d.motivo_devolucion,
          actualizado_en: d.actualizado_en,
        },
      );
      if ((actualizado.affected ?? 0) !== 1) throw new ConflictoDecisionRutError('documento_cambio');
      await this.alPunto?.('tras_documento');

      const v = await m.getRepository(ValidacionDocumentoEmpresarialOrm).createQueryBuilder().update(ValidacionDocumentoEmpresarialOrm)
        .set({ ...ValidacionDocumentoEmpresarialMapper.columnasMutables(plan.validacion.instantanea()), version: () => 'version + 1' } as never)
        .where('id = :id AND version = :version', { id: validacionId, version: plan.versionValidacionLeida }).execute();
      if ((v.affected ?? 0) !== 1) throw new ConflictoDecisionRutError('no_revisable');
      await this.alPunto?.('tras_validacion');

      await m.getRepository(EvidenciaValidacionDocEmpresarialOrm).insert(EvidenciaDocumentoEmpresarialMapper.aOrm(plan.evidencia) as never);
      await this.alPunto?.('tras_evidencia');

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
