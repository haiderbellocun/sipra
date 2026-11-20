import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EstadoObligacion } from '../../../../domain/entities/obligacion.entity';
import {
  AlcanceCumplimiento, CumplimientoLecturaPort, FilaObligacionAlcance, FiltroCumplimiento, OpcionesCumplimiento,
} from '../../../../domain/ports/out/cumplimiento-lectura.port';

/** Universo: las prácticas anuladas o canceladas no generan obligaciones exigibles (G5: el registro anulado se reemplaza). */
const EXCLUIDAS = ['anulada', 'cancelada'];

/**
 * Cumplimiento V3 en PostgreSQL. Una consulta parametrizada (obligaciones ⋈ prácticas ⋈ usuarios ⋈ cat_escuela) con el
 * ALCANCE del actor en el WHERE —misma semántica que `Practica.visiblePara`: institucional, por escuelas o, para el
 * docente, también sus prácticas asignadas— y los filtros. Usa los índices existentes (obligaciones.practica_id,
 * practicas.escuela_id/periodo_academico/tutor_id).
 */
@Injectable()
export class CumplimientoLecturaPgAdapter implements CumplimientoLecturaPort {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async obligaciones(alcance: AlcanceCumplimiento, f: FiltroCumplimiento): Promise<FilaObligacionAlcance[]> {
    const filas: {
      obligacion_id: string; tipo: string; estado: string; fecha_limite: Date; practica_id: string; practica_estado: string;
      periodo: string; escuela_id: string; escuela_nombre: string | null; programa_id: string; estudiante_nombre: string;
    }[] = await this.ds.query(
      `SELECT o.id AS obligacion_id, o.tipo, o.estado, o.fecha_limite, p.id AS practica_id, p.estado AS practica_estado,
              p.periodo_academico AS periodo, p.escuela_id, ce.nombre AS escuela_nombre, p.programa_id, u.nombre AS estudiante_nombre
         FROM obligaciones o
         JOIN practicas p ON p.id = o.practica_id
         JOIN usuarios u ON u.id = p.estudiante_id
         LEFT JOIN cat_escuela ce ON ce.codigo = p.escuela_id
        WHERE p.estado <> ALL($1::varchar[])
          AND ($2::boolean OR p.escuela_id = ANY($3::varchar[]) OR ($4::uuid IS NOT NULL AND p.tutor_id = $4::uuid))
          AND ($5::varchar IS NULL OR p.periodo_academico = $5)
          AND ($6::varchar IS NULL OR p.escuela_id = $6)
          AND ($7::varchar IS NULL OR p.programa_id = $7)
          AND ($8::varchar IS NULL OR o.tipo = $8)
          AND ($9::uuid[] IS NULL OR p.estudiante_id = ANY($9::uuid[]))`,
      [EXCLUIDAS, alcance.todas, [...alcance.escuelas], alcance.tutorId, f.periodo ?? null, f.escuela ?? null, f.programa ?? null,
        f.tipo ?? null, f.estudianteIds ? [...f.estudianteIds] : null],
    );
    return filas.map((x) => ({
      obligacionId: x.obligacion_id, tipo: x.tipo, estado: x.estado as EstadoObligacion, fechaLimite: new Date(x.fecha_limite),
      practicaId: x.practica_id, practicaEstado: x.practica_estado, periodo: x.periodo, escuelaId: x.escuela_id,
      escuelaNombre: x.escuela_nombre, programaId: x.programa_id, estudianteNombre: x.estudiante_nombre,
    }));
  }

  async opciones(alcance: AlcanceCumplimiento): Promise<OpcionesCumplimiento> {
    const filas: { periodo: string; escuela_id: string; escuela_nombre: string | null; programa_id: string }[] = await this.ds.query(
      `SELECT DISTINCT p.periodo_academico AS periodo, p.escuela_id, ce.nombre AS escuela_nombre, p.programa_id
         FROM obligaciones o
         JOIN practicas p ON p.id = o.practica_id
         LEFT JOIN cat_escuela ce ON ce.codigo = p.escuela_id
        WHERE p.estado <> ALL($1::varchar[])
          AND ($2::boolean OR p.escuela_id = ANY($3::varchar[]) OR ($4::uuid IS NOT NULL AND p.tutor_id = $4::uuid))`,
      [EXCLUIDAS, alcance.todas, [...alcance.escuelas], alcance.tutorId],
    );
    const escuelas = new Map<string, string>();
    for (const f of filas) escuelas.set(f.escuela_id, f.escuela_nombre ?? f.escuela_id);
    return {
      periodos: [...new Set(filas.map((f) => f.periodo))].sort().reverse(),
      escuelas: [...escuelas.entries()].map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      programas: [...new Set(filas.map((f) => f.programa_id))].sort(),
    };
  }
}
