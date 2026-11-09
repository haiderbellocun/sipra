import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { ValidacionActa } from '../../../../domain/entities/validacion-acta.entity';
import { ValidacionDocumentoEmpresarial } from '../../../../domain/entities/validacion-documento-empresarial.entity';
import { ValidacionEps } from '../../../../domain/entities/validacion-eps.entity';
import {
  DocumentoDeLectura, ExpedienteDocumentalLecturaPort, FiltroExpedientes, LecturaExpedientes, PracticaDeExpediente,
} from '../../../../domain/ports/out/expediente-documental.port';
import { ValidacionActaOrm } from '../../../persistence/postgres/entities/validacion-acta.orm-entity';
import { ValidacionDocumentoEmpresarialOrm } from '../../../persistence/postgres/entities/validacion-documento-empresarial.orm-entity';
import { ValidacionEpsOrm } from '../../../persistence/postgres/entities/validacion-eps.orm-entity';
import { ValidacionActaMapper } from './validacion-acta.adapter';
import { ValidacionDocumentoEmpresarialMapper } from './validacion-documento-empresarial.adapter';
import { ValidacionEpsMapper } from './validacion-eps.adapter';

/**
 * Lectura de la Mesa de Validación Documental: SOLO LECTURA y por lotes. Siempre las mismas consultas, sin importar cuántas prácticas
 * o documentos haya: prácticas (con estudiante, empresa y docente), documentos de esas prácticas, validaciones de cada motor (EPS,
 * Actas, RUT/Cámara) y los nombres de quienes aparecen en reservas y decisiones. Las validaciones se leen con los mapeadores de
 * cada motor: aquí no se interpreta nada.
 */
@Injectable()
export class ExpedienteDocumentalLecturaAdapter implements ExpedienteDocumentalLecturaPort {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async cargar(f: FiltroExpedientes): Promise<LecturaExpedientes> {
    const practicas = await this.practicas(f);
    const ids = practicas.map((p) => p.id);
    if (ids.length === 0) return { practicas, documentos: [], eps: new Map(), actas: new Map(), empresariales: new Map(), nombres: new Map() };

    const documentos = await this.documentos(ids);
    const docIds = documentos.map((d) => d.id);
    const [epsOrm, actaOrm, empOrm] = docIds.length === 0 ? [[], [], []] : await Promise.all([
      this.ds.getRepository(ValidacionEpsOrm).find({ where: { documento_id: In(docIds) } }),
      this.ds.getRepository(ValidacionActaOrm).find({ where: { documento_id: In(docIds) } }),
      this.ds.getRepository(ValidacionDocumentoEmpresarialOrm).find({ where: { documento_id: In(docIds) } }),
    ]);
    const eps = new Map<string, ValidacionEps>(epsOrm.map((o) => [o.documento_id, ValidacionEpsMapper.aDominio(o)]));
    const actas = new Map<string, ValidacionActa>(actaOrm.map((o) => [o.documento_id, ValidacionActaMapper.aDominio(o)]));
    const empresariales = new Map<string, ValidacionDocumentoEmpresarial>(empOrm.map((o) => [o.documento_id, ValidacionDocumentoEmpresarialMapper.aDominio(o)]));

    // Nombres de quien tiene un documento reservado o lo decidió (un solo viaje).
    const personas = new Set<string>();
    for (const v of eps.values()) { const d = v.instantanea(); if (d.asignadoA) personas.add(d.asignadoA); if (d.decididoPor) personas.add(d.decididoPor); }
    for (const v of actas.values()) { const d = v.instantanea(); if (d.asignadoA) personas.add(d.asignadoA); if (d.decididoPor) personas.add(d.decididoPor); }
    for (const v of empresariales.values()) { const d = v.instantanea(); if (d.asignadoA) personas.add(d.asignadoA); if (d.decididoPor) personas.add(d.decididoPor); }
    const nombres = new Map<string, string>();
    if (personas.size > 0) {
      const filas: { id: string; nombre: string }[] = await this.ds.query('SELECT id, nombre FROM usuarios WHERE id = ANY($1::uuid[])', [[...personas]]);
      for (const u of filas) nombres.set(u.id, u.nombre);
    }
    return { practicas, documentos, eps, actas, empresariales, nombres };
  }

  private async practicas(f: FiltroExpedientes): Promise<PracticaDeExpediente[]> {
    const alcance = f.alcance;
    const filas: Record<string, unknown>[] = await this.ds.query(
      `SELECT p.id, p.estudiante_id, u.nombre AS estudiante_nombre, u.documento AS estudiante_documento, p.modalidad, p.periodo_academico,
              p.escuela_id, p.empresa_id, COALESCE(e.razon_social, p.empresa_razon_social) AS empresa_razon_social, p.tutor_id,
              t.nombre AS tutor_nombre, p.estado, p.fecha_inicio
         FROM practicas p
         JOIN usuarios u ON u.id = p.estudiante_id
         LEFT JOIN empresas e ON e.id = p.empresa_id
         LEFT JOIN usuarios t ON t.id = p.tutor_id
        WHERE ($1::uuid IS NULL OR p.id = $1::uuid)
          AND ($2::boolean = false OR (p.escuela_id = ANY($3::text[]) OR ($4::uuid IS NOT NULL AND p.tutor_id = $4::uuid)))
          AND ($5::text IS NULL OR p.escuela_id = $5)
          AND ($6::text IS NULL OR p.modalidad = $6)
          AND ($7::text IS NULL OR u.nombre ILIKE '%' || $7 || '%' OR u.documento = $7)
          AND ($8::boolean = true OR EXISTS (SELECT 1 FROM documentos d WHERE d.practica_id = p.id))
        ORDER BY p.creada_en DESC, p.id
        LIMIT $9`,
      [
        f.practicaId ?? null, alcance !== null, alcance ? [...alcance.escuelas] : [], alcance?.tutorId ?? null,
        f.escuela ?? null, f.modalidad ?? null, f.buscar?.trim() || null, f.incluirSinDocumentos === true || f.practicaId !== undefined, f.limite,
      ],
    );
    return filas.map((r) => ({
      id: r.id as string, estudianteId: r.estudiante_id as string, estudianteNombre: r.estudiante_nombre as string,
      estudianteDocumento: (r.estudiante_documento as string | null) ?? null, modalidad: r.modalidad as string,
      periodoAcademico: r.periodo_academico as string, escuelaId: r.escuela_id as string, empresaId: (r.empresa_id as string | null) ?? null,
      empresaRazonSocial: (r.empresa_razon_social as string | null) ?? null, tutorId: (r.tutor_id as string | null) ?? null,
      tutorNombre: (r.tutor_nombre as string | null) ?? null, estado: r.estado as string, fechaInicio: (r.fecha_inicio as Date | null) ?? null,
    }));
  }

  private async documentos(practicaIds: string[]): Promise<DocumentoDeLectura[]> {
    const filas: Record<string, unknown>[] = await this.ds.query(
      `SELECT id, practica_id, tipo, version, estado, nombre_original, cargado_en, actualizado_en, motivo_devolucion
         FROM documentos WHERE practica_id = ANY($1::uuid[]) ORDER BY practica_id, tipo, version DESC`,
      [practicaIds],
    );
    return filas.map((r) => ({
      id: r.id as string, practicaId: r.practica_id as string, tipo: r.tipo as DocumentoDeLectura['tipo'], version: Number(r.version),
      estado: r.estado as DocumentoDeLectura['estado'], nombreOriginal: r.nombre_original as string, cargadoEn: r.cargado_en as Date,
      actualizadoEn: r.actualizado_en as Date, motivoDevolucion: (r.motivo_devolucion as string | null) ?? null,
    }));
  }
}
