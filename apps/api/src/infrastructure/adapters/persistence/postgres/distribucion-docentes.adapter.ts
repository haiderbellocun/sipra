import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ESTADOS_TERMINALES_PRACTICA } from '../../../../domain/entities/practica.entity';
import { DistribucionDocentesPort } from '../../../../domain/ports/out/distribucion-docentes.port';
import { CargaDocenteEscuela, PracticaPorDistribuir } from '../../../../domain/services/distribucion-docentes.domain-service';
import { AuditoriaOrm, BitacoraOrm } from '../../../persistence/postgres/entities/todas.orm-entity';
import { BitacoraMapper } from './mappers';

class LoteObsoleto extends Error {}

const TERMINALES = [...ESTADOS_TERMINALES_PRACTICA] as string[];
const TAMANO_INSERCION = 500;

/**
 * G6 · Distribución de docentes en PostgreSQL.
 *
 * Aplicación en UNA transacción:
 *  1. Bloquea las prácticas del lote en orden de id (`FOR UPDATE`, siempre el mismo orden: sin interbloqueos entre
 *     dos distribuciones simultáneas).
 *  2. `UPDATE … WHERE tutor_id IS NULL AND estado <> terminales` para todo el lote; si no se actualizaron TODAS las
 *     filas, alguien asignó (o cerró) una práctica desde la vista previa: se revierte todo y se devuelve `false`.
 *  3. Inserta la auditoría (evento de lote + uno por práctica) y las notas de bitácora en inserciones por bloques.
 * Quien llega segundo espera el bloqueo, ve `tutor_id` ya ocupado y recibe `false` sin escribir nada.
 */
@Injectable()
export class DistribucionDocentesPgAdapter implements DistribucionDocentesPort {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async practicasSinDocente(periodoAcademico: string, escuelas: readonly string[] | null): Promise<PracticaPorDistribuir[]> {
    const filas: { id: string; escuela_id: string; programa_id: string; estudiante_id: string }[] = await this.ds.query(
      `SELECT id, escuela_id, programa_id, estudiante_id FROM practicas
        WHERE periodo_academico = $1 AND tutor_id IS NULL AND estado <> ALL($2::varchar[])
          AND ($3::varchar[] IS NULL OR escuela_id = ANY($3::varchar[]))`,
      [periodoAcademico, TERMINALES, escuelas === null ? null : [...escuelas]],
    );
    return filas.map((f) => ({ id: f.id, escuelaId: f.escuela_id, programaId: f.programa_id, estudianteId: f.estudiante_id }));
  }

  async cargas(periodoAcademico: string): Promise<CargaDocenteEscuela[]> {
    const filas: { tutor_id: string; escuela_id: string; cantidad: number }[] = await this.ds.query(
      `SELECT tutor_id, escuela_id, count(*)::int AS cantidad FROM practicas
        WHERE periodo_academico = $1 AND tutor_id IS NOT NULL AND estado <> ALL($2::varchar[])
        GROUP BY tutor_id, escuela_id`,
      [periodoAcademico, TERMINALES],
    );
    return filas.map((f) => ({ tutorId: f.tutor_id, escuelaId: f.escuela_id, cantidad: Number(f.cantidad) }));
  }

  async aplicar(lote: Parameters<DistribucionDocentesPort['aplicar']>[0]): Promise<boolean> {
    if (lote.asignaciones.length === 0) return true;
    const ordenadas = [...lote.asignaciones].sort((a, b) => (a.practicaId < b.practicaId ? -1 : 1));
    const ids = ordenadas.map((a) => a.practicaId);
    const tutores = ordenadas.map((a) => a.tutorId);
    try {
      await this.ds.transaction(async (m) => {
        await m.query('SELECT id FROM practicas WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
        const r: unknown = await m.query(
          `UPDATE practicas p SET tutor_id = v.tutor_id, actualizada_en = $3
             FROM unnest($1::uuid[], $2::uuid[]) AS v(id, tutor_id)
            WHERE p.id = v.id AND p.tutor_id IS NULL AND p.estado <> ALL($4::varchar[])
           RETURNING p.id`,
          [ids, tutores, lote.ahora, TERMINALES],
        );
        if (filasAfectadas(r) !== ids.length) throw new LoteObsoleto();

        const auditoria = m.getRepository(AuditoriaOrm);
        for (const bloque of trozos(lote.auditoria)) {
          await auditoria.insert(bloque.map((a) => ({
            actor_id: a.actorId, actor_correo: a.actorCorreo, actor_rol: a.actorRol, accion: a.accion, entidad: a.entidad,
            entidad_id: a.entidadId, justificacion: a.justificacion, metadatos: a.metadatos, ip: a.ip,
            agente_usuario: a.agenteUsuario?.slice(0, 300) ?? null, ocurrido_en: a.ocurridoEn,
          })) as QueryDeepPartialEntity<AuditoriaOrm>[]);
        }
        const bitacora = m.getRepository(BitacoraOrm);
        for (const bloque of trozos(lote.bitacora)) {
          await bitacora.insert(bloque.map((b) => BitacoraMapper.aOrm(b)) as QueryDeepPartialEntity<BitacoraOrm>[]);
        }
      });
      return true;
    } catch (error) {
      if (error instanceof LoteObsoleto) return false;
      throw error;
    }
  }
}

/** `query()` de TypeORM en PostgreSQL devuelve `[filas, cantidad]` para UPDATE y las filas para lo demás. */
function filasAfectadas(r: unknown): number {
  if (Array.isArray(r) && r.length === 2 && Array.isArray(r[0]) && typeof r[1] === 'number') return r[1];
  return Array.isArray(r) ? r.length : 0;
}

function trozos<T>(lista: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += TAMANO_INSERCION) salida.push(lista.slice(i, i + TAMANO_INSERCION));
  return salida;
}
