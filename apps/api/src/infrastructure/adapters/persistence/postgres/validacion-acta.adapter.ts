import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComparacionActaPersistida, Presencia, Remuneracion, ResponsableArlActa, TipoActaDetectada } from '../../../../domain/entities/acta-iniciacion';
import {
  DatosEvidenciaActa, DatosValidacionActa, EstadoValidacionActa, EvidenciaActa, TipoEvidenciaActa, ValidacionActa,
} from '../../../../domain/entities/validacion-acta.entity';
import {
  FilaMesaActa, FiltroMesaActa, MINUTOS_RESERVA_POR_VENCER, ResumenSupervisionActa, TOPE_LISTADO_MESA_ACTA,
  ValidacionActaRepositoryPort,
} from '../../../../domain/ports/out/validacion-acta.port';
import {
  EvidenciaValidacionActaOrm, ValidacionActaOrm,
} from '../../../persistence/postgres/entities/validacion-acta.orm-entity';

const Mapper = {
  aDominio(orm: ValidacionActaOrm): ValidacionActa {
    return ValidacionActa.desde({
      id: orm.id, documentoId: orm.documento_id, practicaId: orm.practica_id, estudianteId: orm.estudiante_id,
      estado: orm.estado as EstadoValidacionActa, intentos: orm.intentos, errorCodigo: orm.error_codigo,
      tipoActaDetectada: orm.tipo_acta_detectada as TipoActaDetectada | null,
      remuneracionDetectada: orm.remuneracion_detectada as Remuneracion | null,
      responsableArlDetectado: orm.responsable_arl_detectado as ResponsableArlActa | null,
      firmaEmpresa: orm.firma_empresa as Presencia | null,
      firmaPracticante: orm.firma_practicante as Presencia | null,
      metodoLectura: orm.metodo_lectura as 'texto' | 'ocr' | null,
      // `numeric` llega como texto.
      confianza: orm.confianza === null ? null : Number(orm.confianza),
      motivosClasificacion: orm.motivos_clasificacion ?? [],
      datosExtraidos: orm.datos_extraidos as unknown as DatosValidacionActa['datosExtraidos'],
      comparacion: orm.comparacion as unknown as ComparacionActaPersistida | null,
      hayDiscrepanciaCritica: orm.hay_discrepancia_critica,
      recibidaEn: orm.recibida_en, procesadaEn: orm.procesada_en, decididoPor: orm.decidido_por, decididoEn: orm.decidido_en,
      motivoDecision: orm.motivo_decision, asignadoA: orm.asignado_a, reservadoEn: orm.reservado_en, reservaHasta: orm.reserva_hasta,
      datosPracticaCambiaronEn: orm.datos_practica_cambiaron_en,
      version: orm.version, creadaEn: orm.creada_en, actualizadaEn: orm.actualizada_en,
    });
  },
  /** Columnas que cambian en la vida de la validación (todas menos identidad y creación). */
  columnasMutables(d: DatosValidacionActa) {
    return {
      estado: d.estado, intentos: d.intentos, error_codigo: d.errorCodigo,
      tipo_acta_detectada: d.tipoActaDetectada, remuneracion_detectada: d.remuneracionDetectada,
      responsable_arl_detectado: d.responsableArlDetectado, firma_empresa: d.firmaEmpresa, firma_practicante: d.firmaPracticante,
      metodo_lectura: d.metodoLectura, confianza: d.confianza === null ? null : d.confianza.toFixed(3),
      motivos_clasificacion: d.motivosClasificacion,
      datos_extraidos: d.datosExtraidos as unknown as Record<string, unknown> | null,
      comparacion: d.comparacion as unknown as Record<string, unknown> | null,
      hay_discrepancia_critica: d.hayDiscrepanciaCritica, recibida_en: d.recibidaEn, procesada_en: d.procesadaEn,
      decidido_por: d.decididoPor, decidido_en: d.decididoEn, motivo_decision: d.motivoDecision, asignado_a: d.asignadoA,
      reservado_en: d.reservadoEn, reserva_hasta: d.reservaHasta, datos_practica_cambiaron_en: d.datosPracticaCambiaronEn,
      actualizada_en: d.actualizadaEn,
    };
  },
  aOrm(d: DatosValidacionActa): ValidacionActaOrm {
    const orm = new ValidacionActaOrm();
    orm.id = d.id;
    orm.documento_id = d.documentoId;
    orm.practica_id = d.practicaId;
    orm.estudiante_id = d.estudianteId;
    Object.assign(orm, Mapper.columnasMutables(d));
    orm.version = d.version;
    orm.creada_en = d.creadaEn;
    return orm;
  },
};

const EvidenciaMapper = {
  aDominio(orm: EvidenciaValidacionActaOrm): EvidenciaActa {
    return EvidenciaActa.desde({
      id: orm.id, validacionActaId: orm.validacion_acta_id, intento: orm.intento, tipo: orm.tipo as TipoEvidenciaActa,
      resultado: orm.resultado, metodo: orm.metodo, fecha: orm.fecha, actorId: orm.actor_id, hashDocumento: orm.hash_documento,
      datos: orm.datos ?? {}, errorCodigo: orm.error_codigo, creadoEn: orm.creado_en,
    });
  },
  aOrm(d: DatosEvidenciaActa): EvidenciaValidacionActaOrm {
    const orm = new EvidenciaValidacionActaOrm();
    orm.id = d.id;
    orm.validacion_acta_id = d.validacionActaId;
    orm.intento = d.intento;
    orm.tipo = d.tipo;
    orm.resultado = d.resultado;
    orm.metodo = d.metodo;
    orm.fecha = d.fecha;
    orm.actor_id = d.actorId;
    orm.hash_documento = d.hashDocumento;
    orm.datos = d.datos;
    orm.error_codigo = d.errorCodigo;
    orm.creado_en = d.creadoEn;
    return orm;
  },
};

@Injectable()
export class ValidacionActaRepositoryAdapter implements ValidacionActaRepositoryPort {
  constructor(
    @InjectRepository(ValidacionActaOrm) private readonly repo: Repository<ValidacionActaOrm>,
    @InjectRepository(EvidenciaValidacionActaOrm) private readonly evidencias: Repository<EvidenciaValidacionActaOrm>,
  ) {}

  async buscarPorId(id: string): Promise<ValidacionActa | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? Mapper.aDominio(orm) : null;
  }

  async buscarPorDocumento(documentoId: string): Promise<ValidacionActa | null> {
    const orm = await this.repo.findOne({ where: { documento_id: documentoId } });
    return orm ? Mapper.aDominio(orm) : null;
  }

  async listarPorPractica(practicaId: string): Promise<ValidacionActa[]> {
    return (await this.repo.find({ where: { practica_id: practicaId }, order: { creada_en: 'ASC' } })).map((o) => Mapper.aDominio(o));
  }

  async crearSiNoExiste(datos: DatosValidacionActa): Promise<{ validacion: ValidacionActa; creada: boolean }> {
    const resultado = await this.repo
      .createQueryBuilder()
      .insert()
      .into(ValidacionActaOrm)
      .values(Mapper.aOrm(datos) as never)
      .orIgnore() // ON CONFLICT DO NOTHING: la restricción única de documento_id decide al ganador
      .returning('id')
      .execute();
    const creada = Array.isArray(resultado.raw) && resultado.raw.length === 1;
    const orm = await this.repo.findOneOrFail({ where: { documento_id: datos.documentoId } });
    return { validacion: Mapper.aDominio(orm), creada };
  }

  async guardarSiVersion(datos: DatosValidacionActa, versionEsperada: number): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionActaOrm)
      .set({ ...Mapper.columnasMutables(datos), version: () => 'version + 1' } as never)
      .where('id = :id AND version = :versionEsperada', { id: datos.id, versionEsperada })
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async agregarEvidencia(datos: DatosEvidenciaActa): Promise<boolean> {
    // `insert ... ON CONFLICT DO NOTHING` sobre (validación, intento, tipo): repetir un procesamiento no duplica. Nunca `save`.
    const resultado = await this.evidencias
      .createQueryBuilder()
      .insert()
      .into(EvidenciaValidacionActaOrm)
      .values(EvidenciaMapper.aOrm(datos) as never)
      .orIgnore()
      .returning('id')
      .execute();
    return Array.isArray(resultado.raw) && resultado.raw.length === 1;
  }

  async reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionActaOrm)
      .set({ asignado_a: actorId, reservado_en: ahora, reserva_hasta: hasta, actualizada_en: ahora, version: () => 'version + 1' })
      .where(
        `id = :id AND estado = 'revision'
         AND (asignado_a IS NULL OR reserva_hasta <= :ahora OR asignado_a = :actorId)`,
        { id, ahora, actorId },
      )
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionActaOrm)
      .set({ asignado_a: null, reservado_en: null, reserva_hasta: null, actualizada_en: ahora, version: () => 'version + 1' })
      .where(
        `id = :id AND asignado_a IS NOT NULL
         AND (asignado_a = :actorId OR :esSupervisor = true OR reserva_hasta <= :ahora)`,
        { id, actorId, esSupervisor, ahora },
      )
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async listarMesa(filtro: FiltroMesaActa): Promise<FilaMesaActa[]> {
    const filas: Record<string, unknown>[] = await this.repo.query(
      `SELECT v.id AS validacion_id, v.documento_id, v.practica_id, v.estudiante_id, u.nombre AS estudiante_nombre,
              p.escuela_id, p.empresa_razon_social, p.modalidad, p.fecha_inicio, d.version AS doc_version, d.cargado_en,
              v.estado, v.tipo_acta_detectada, v.remuneracion_detectada, v.responsable_arl_detectado, v.firma_empresa,
              v.firma_practicante, v.hay_discrepancia_critica, v.comparacion->>'veredicto' AS veredicto, v.asignado_a, a.nombre AS asignado_nombre, v.reserva_hasta,
              v.recibida_en, v.procesada_en, v.datos_practica_cambiaron_en
         FROM validaciones_acta_iniciacion v
         JOIN documentos d ON d.id = v.documento_id
         JOIN practicas p ON p.id = v.practica_id
         JOIN usuarios u ON u.id = v.estudiante_id
         LEFT JOIN usuarios a ON a.id = v.asignado_a
        WHERE d.version = (SELECT max(d2.version) FROM documentos d2 WHERE d2.practica_id = d.practica_id AND d2.tipo = 'acta_inicio')
          AND v.estado = ANY($1::text[])
          AND ($2::text[] IS NULL OR p.escuela_id = ANY($2::text[]))
        ORDER BY v.recibida_en ASC NULLS LAST, v.creada_en ASC
        LIMIT ${TOPE_LISTADO_MESA_ACTA}`,
      [[...filtro.estados], filtro.escuelas ? [...filtro.escuelas] : null],
    );
    return filas.map((f) => ({
      validacionId: f.validacion_id as string, documentoId: f.documento_id as string, practicaId: f.practica_id as string,
      estudianteId: f.estudiante_id as string, estudianteNombre: f.estudiante_nombre as string, escuelaId: f.escuela_id as string,
      empresaRazonSocial: (f.empresa_razon_social as string | null) ?? null, modalidad: f.modalidad as string,
      fechaInicio: (f.fecha_inicio as Date | null) ?? null, version: f.doc_version as number, cargadoEn: f.cargado_en as Date,
      estado: f.estado as EstadoValidacionActa, tipoActaDetectada: f.tipo_acta_detectada as TipoActaDetectada | null,
      remuneracionDetectada: f.remuneracion_detectada as Remuneracion | null,
      responsableArlDetectado: f.responsable_arl_detectado as ResponsableArlActa | null,
      firmaEmpresa: f.firma_empresa as Presencia | null, firmaPracticante: f.firma_practicante as Presencia | null,
      hayDiscrepanciaCritica: f.hay_discrepancia_critica as boolean, veredicto: (f.veredicto as string | null) ?? null, asignadoA: (f.asignado_a as string | null) ?? null,
      asignadoNombre: (f.asignado_nombre as string | null) ?? null, reservaHasta: (f.reserva_hasta as Date | null) ?? null,
      recibidaEn: (f.recibida_en as Date | null) ?? null, procesadaEn: (f.procesada_en as Date | null) ?? null,
      datosPracticaCambiaronEn: (f.datos_practica_cambiaron_en as Date | null) ?? null,
    }));
  }

  async supervisionMesa(ahora: Date, escuelas: readonly string[] | null): Promise<ResumenSupervisionActa> {
    const alcance = escuelas ? [...escuelas] : null;
    const base = `FROM validaciones_acta_iniciacion v
         JOIN documentos d ON d.id = v.documento_id
         JOIN practicas p ON p.id = v.practica_id
        WHERE d.version = (SELECT max(d2.version) FROM documentos d2 WHERE d2.practica_id = d.practica_id AND d2.tipo = 'acta_inicio')
          AND ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))`;
    const resumen: Record<string, number>[] = await this.repo.query(
      `SELECT count(*) FILTER (WHERE v.estado = 'revision')::int AS abiertas,
              count(*) FILTER (WHERE v.estado = 'revision' AND (v.asignado_a IS NULL OR v.reserva_hasta <= $2))::int AS libres,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.asignado_a IS NOT NULL AND v.reserva_hasta > $2)::int AS tomadas,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.asignado_a IS NOT NULL AND v.reserva_hasta > $2
                               AND v.reserva_hasta <= $2::timestamptz + make_interval(mins => $3))::int AS por_vencer,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.asignado_a IS NOT NULL AND v.reserva_hasta <= $2)::int AS vencidas,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.hay_discrepancia_critica)::int AS criticas,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.tipo_acta_detectada = 'documento_incorrecto')::int AS incorrectos
         ${base}`,
      [alcance, ahora, MINUTOS_RESERVA_POR_VENCER],
    );
    const r = resumen[0];
    const porEstado: { estado: string; n: number }[] = await this.repo.query(`SELECT v.estado, count(*)::int AS n ${base} GROUP BY v.estado`, [alcance]);
    const funcionarios: { id: string; nombre: string; rol: string; vigentes: number; por_vencer: number; decididas: number }[] = await this.repo.query(
      `SELECT u.id, u.nombre, u.rol,
              count(v.id) FILTER (WHERE v.estado = 'revision' AND v.asignado_a = u.id AND v.reserva_hasta > $1)::int AS vigentes,
              count(v.id) FILTER (WHERE v.estado = 'revision' AND v.asignado_a = u.id AND v.reserva_hasta > $1
                                  AND v.reserva_hasta <= $1::timestamptz + make_interval(mins => $2))::int AS por_vencer,
              count(v.id) FILTER (WHERE v.decidido_por = u.id AND v.decidido_en >= $1::timestamptz - interval '7 days')::int AS decididas
         FROM usuarios u
         LEFT JOIN validaciones_acta_iniciacion v ON v.asignado_a = u.id OR v.decidido_por = u.id
        WHERE u.rol IN ('auxiliar','coordinador','administrador') AND u.activo = true
        GROUP BY u.id, u.nombre, u.rol
       HAVING count(v.id) > 0
        ORDER BY u.nombre`,
      [ahora, MINUTOS_RESERVA_POR_VENCER],
    );
    return {
      abiertas: r.abiertas, libres: r.libres, tomadas: r.tomadas, porVencer: r.por_vencer, vencidas: r.vencidas,
      porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e.n])),
      conDiscrepanciaCritica: r.criticas, documentoIncorrecto: r.incorrectos,
      funcionarios: funcionarios.map((f) => ({
        funcionarioId: f.id, nombre: f.nombre, rol: f.rol, reservasVigentes: f.vigentes, reservasPorVencer: f.por_vencer,
        decididas7Dias: f.decididas,
      })),
    };
  }

  async listarEvidencias(validacionActaId: string): Promise<EvidenciaActa[]> {
    const filas = await this.evidencias.find({ where: { validacion_acta_id: validacionActaId }, order: { creado_en: 'ASC' } });
    return filas.map((f) => EvidenciaMapper.aDominio(f));
  }
}
