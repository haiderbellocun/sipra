import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CatalogoRepositoryPort, CostosIaRepositoryPort, EstadoCatalogo, FilaGastoIa, FilaReportePlaza,
  FilaReporteVacante, FiltroGastoIa, ReporteRepositoryPort,
} from '../../../../domain/ports/out/repositorios.port';

@Injectable()
export class CatalogoRepositoryAdapter implements CatalogoRepositoryPort {
  constructor(@InjectDataSource() private readonly datos: DataSource) {}

  async estados(): Promise<EstadoCatalogo[]> {
    interface Fila {
      nombre: string;
      estado: EstadoCatalogo['estado'];
      filas_cargadas: number;
      filas_esperadas: number | null;
      fuente: string | null;
      url_oficial: string | null;
      justificacion: string | null;
    }
    const filas: Fila[] = await this.datos.query(
      `SELECT nombre, estado, filas_cargadas, filas_esperadas, fuente, url_oficial, justificacion
       FROM cat_estado ORDER BY nombre`,
    );
    return filas.map((f) => ({
      nombre: f.nombre,
      estado: f.estado,
      filasCargadas: Number(f.filas_cargadas),
      filasEsperadas: f.filas_esperadas === null ? null : Number(f.filas_esperadas),
      fuente: f.fuente,
      urlOficial: f.url_oficial,
      justificacion: f.justificacion,
    }));
  }
}

@Injectable()
export class ReporteRepositoryAdapter implements ReporteRepositoryPort {
  constructor(@InjectDataSource() private readonly datos: DataSource) {}

  /**
   * Solo marco `laboral`: la vacante de práctica es un requisito académico, no
   * intermediación laboral, y por eso no entra en el reporte de vacantes.
   */
  async vacantesPendientesReporte(hasta: Date): Promise<FilaReporteVacante[]> {
    interface Fila {
      id: string; nit_numero: string; nit_dv: number; razon_social: string;
      titulo: string; descripcion: string; funciones: string; requisitos: string;
      codigo_cno: string; codigo_ciiu: string; divipola_municipio: string;
      nivel_educativo: string; vacantes_disponibles: number;
      salario_minimo: string | null; salario_maximo: string | null;
      publicada_en: Date; vigente_hasta: Date;
    }
    const filas: Fila[] = await this.datos.query(
      `SELECT v.id, e.nit_numero, e.nit_dv, e.razon_social, v.titulo, v.descripcion,
              v.funciones, v.requisitos, v.codigo_cno, v.codigo_ciiu,
              v.divipola_municipio, v.nivel_educativo, v.vacantes_disponibles,
              v.salario_minimo, v.salario_maximo, v.publicada_en, v.vigente_hasta
       FROM vacantes v
       JOIN empresas e ON e.id = v.empresa_id
       WHERE v.marco = 'laboral'
         AND v.estado = 'publicada'
         AND v.reportada_spe_en IS NULL
         AND v.publicada_en <= $1
       ORDER BY v.publicada_en`,
      [hasta],
    );
    return filas.map((f) => ({
      vacanteId: f.id,
      nitEmpresa: f.nit_numero,
      nitDv: f.nit_dv,
      razonSocial: f.razon_social,
      titulo: f.titulo,
      descripcion: f.descripcion,
      funciones: f.funciones,
      requisitos: f.requisitos,
      codigoCno: f.codigo_cno,
      codigoCiiu: f.codigo_ciiu,
      divipolaMunicipio: f.divipola_municipio,
      nivelEducativo: f.nivel_educativo,
      vacantesDisponibles: f.vacantes_disponibles,
      salarioMinimo: f.salario_minimo === null ? null : Number(f.salario_minimo),
      salarioMaximo: f.salario_maximo === null ? null : Number(f.salario_maximo),
      publicadaEn: f.publicada_en,
      vigenteHasta: f.vigente_hasta,
    }));
  }

  /** Plazas de práctica ya iniciadas (Ley 1780 de 2016, art. 17). */
  async plazasPendientesReporte(hasta: Date): Promise<FilaReportePlaza[]> {
    interface Fila {
      id: string; nit_numero: string; nit_dv: number; razon_social: string;
      documento: string | null; programa_id: string; ciclo: string;
      divipola_municipio: string | null; fecha_inicio: Date; fecha_fin: Date | null;
      modalidad: string;
    }
    const filas: Fila[] = await this.datos.query(
      `SELECT p.id, e.nit_numero, e.nit_dv, e.razon_social, u.documento,
              p.programa_id, p.ciclo, e.divipola_municipio,
              p.fecha_inicio, p.fecha_fin, p.modalidad
       FROM practicas p
       JOIN empresas e ON e.id = p.empresa_id
       JOIN usuarios u ON u.id = p.estudiante_id
       WHERE p.estado IN ('activa','finalizada','certificada')
         AND p.fecha_inicio IS NOT NULL
         AND p.fecha_inicio <= $1
       ORDER BY p.fecha_inicio`,
      [hasta],
    );
    return filas.map((f) => ({
      practicaId: f.id,
      nitEmpresa: f.nit_numero,
      nitDv: f.nit_dv,
      razonSocial: f.razon_social,
      documentoEstudiante: f.documento ?? '',
      programaId: f.programa_id,
      ciclo: f.ciclo,
      divipolaMunicipio: f.divipola_municipio,
      fechaInicio: f.fecha_inicio,
      fechaFin: f.fecha_fin,
      modalidad: f.modalidad,
    }));
  }

  async marcarVacantesReportadas(ids: readonly string[], momento: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.datos.query(
      `UPDATE vacantes SET estado = 'reportada_spe', reportada_spe_en = $2, actualizada_en = now()
       WHERE id = ANY($1::uuid[])`,
      [[...ids], momento],
    );
  }
}

/**
 * Gasto real en lectura asistida. Lee lo que el pipeline guardó en
 * `documentos.extraccion` (modelo, tokens, costo, fecha de lectura) y lo agrupa
 * por periodo, modalidad, estudiante, tipo y modelo. No recalcula precios: el
 * costo es el que regía cuando se leyó el documento.
 */
@Injectable()
export class CostosIaRepositoryAdapter implements CostosIaRepositoryPort {
  constructor(@InjectDataSource() private readonly datos: DataSource) {}

  async gastoAgrupado(filtro: FiltroGastoIa): Promise<FilaGastoIa[]> {
    interface Fila {
      periodo_academico: string; modalidad: string; estudiante_id: string; estudiante_nombre: string;
      tipo: string; modelo: string; proveedor: string;
      documentos: string; tokens_entrada: string; tokens_salida: string; costo_usd: string;
      ultima_lectura: Date;
    }
    const filas: Fila[] = await this.datos.query(
      `SELECT p.periodo_academico, p.modalidad, u.id AS estudiante_id, u.nombre AS estudiante_nombre,
              d.tipo,
              COALESCE(d.extraccion->>'modelo', 'sin_modelo') AS modelo,
              COALESCE(d.extraccion->>'proveedor', 'desconocido') AS proveedor,
              COUNT(*) AS documentos,
              COALESCE(SUM(NULLIF(d.extraccion->>'tokensEntrada', '')::numeric), 0) AS tokens_entrada,
              COALESCE(SUM(NULLIF(d.extraccion->>'tokensSalida', '')::numeric), 0) AS tokens_salida,
              COALESCE(SUM(COALESCE(NULLIF(d.extraccion->>'costoUsd', '')::numeric, 0)
                         + COALESCE(NULLIF(d.extraccion->>'gastoPrevioUsd', '')::numeric, 0)), 0) AS costo_usd,
              MAX(COALESCE((d.extraccion->>'leidoEn')::timestamptz, d.cargado_en)) AS ultima_lectura
         FROM documentos d
         JOIN practicas p ON p.id = d.practica_id
         JOIN usuarios u ON u.id = p.estudiante_id
        WHERE d.extraccion IS NOT NULL
          AND ($1::text IS NULL OR p.periodo_academico = $1)
          AND ($2::timestamptz IS NULL OR COALESCE((d.extraccion->>'leidoEn')::timestamptz, d.cargado_en) >= $2)
          AND ($3::timestamptz IS NULL OR COALESCE((d.extraccion->>'leidoEn')::timestamptz, d.cargado_en) < $3)
          AND ($4::text[] IS NULL OR p.escuela_id = ANY($4::text[]))
        GROUP BY 1, 2, 3, 4, 5, 6, 7
        ORDER BY costo_usd DESC, estudiante_nombre ASC, tipo ASC`,
      [filtro.periodoAcademico ?? null, filtro.desde ?? null, filtro.hasta ?? null, filtro.escuelaIds ? [...filtro.escuelaIds] : null],
    );
    return filas.map((f) => ({
      periodoAcademico: f.periodo_academico,
      modalidad: f.modalidad,
      estudianteId: f.estudiante_id,
      estudianteNombre: f.estudiante_nombre,
      tipo: f.tipo,
      modelo: f.modelo,
      proveedor: f.proveedor,
      documentos: Number(f.documentos),
      tokensEntrada: Number(f.tokens_entrada),
      tokensSalida: Number(f.tokens_salida),
      costoUsd: Number(f.costo_usd),
      ultimaLectura: new Date(f.ultima_lectura),
    }));
  }

  async periodosConGasto(escuelaIds?: readonly string[]): Promise<string[]> {
    const filas: { periodo_academico: string }[] = await this.datos.query(
      `SELECT DISTINCT p.periodo_academico
         FROM documentos d JOIN practicas p ON p.id = d.practica_id
        WHERE d.extraccion IS NOT NULL
          AND ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))
        ORDER BY p.periodo_academico DESC`,
      [escuelaIds ? [...escuelaIds] : null],
    );
    return filas.map((f) => f.periodo_academico);
  }
}
