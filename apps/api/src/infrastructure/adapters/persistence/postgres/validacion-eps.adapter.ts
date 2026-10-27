import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DatosEvidenciaEps, EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps,
} from '../../../../domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, DatosValidacionEps, DatosVerificadosEps,
  DecisionEps, DiscrepanciaEps, EstadoProcesamientoEps, RutaValidacionEps, ValidacionEps, VigenciaCertificado,
} from '../../../../domain/entities/validacion-eps.entity';
import {
  CriteriosSiguiente, FilaMesaRepo, ResumenSupervisionRepo, ValidacionEpsRepositoryPort,
} from '../../../../domain/ports/out/validacion-eps.port';
import { ESTADOS_ADRES_ABIERTOS, PESOS_PRIORIDAD } from '../../../../domain/services/mesa-eps.domain-service';
import {
  ComparacionTripleCampo, DatosAdres, EstadoAdres, OrigenTipoDocumento, RecomendacionEps,
} from '../../../../domain/entities/adres';
import {
  EvidenciaValidacionEpsOrm, ValidacionEpsOrm,
} from '../../../persistence/postgres/entities/validacion-eps.orm-entity';

const ValidacionEpsMapper = {
  aDominio(orm: ValidacionEpsOrm): ValidacionEps {
    return ValidacionEps.desde({
      id: orm.id,
      documentoId: orm.documento_id,
      practicaId: orm.practica_id,
      estudianteId: orm.estudiante_id,
      estadoProcesamiento: orm.estado_procesamiento as EstadoProcesamientoEps,
      autenticidad: orm.autenticidad as AutenticidadEps,
      coincidencia: orm.coincidencia as CoincidenciaEps,
      afiliacion: orm.afiliacion as AfiliacionEps,
      ruta: orm.ruta as RutaValidacionEps,
      decision: orm.decision as DecisionEps,
      vigenciaCertificado: orm.vigencia_certificado as VigenciaCertificado,
      hayBanderaCritica: orm.hay_bandera_critica,
      datosExtraidos: orm.datos_extraidos as unknown as DatosExtraidosEps | null,
      datosVerificados: orm.datos_verificados as unknown as DatosVerificadosEps | null,
      discrepancias: (orm.discrepancias ?? []) as unknown as DiscrepanciaEps[],
      errorCodigo: orm.error_codigo,
      verificadorCodigo: orm.verificador_codigo,
      verificacionIniciadaEn: orm.verificacion_iniciada_en,
      verificadoEn: orm.verificado_en,
      verificacionError: orm.verificacion_error,
      afiliacionFuente: orm.afiliacion_fuente as 'verificador_oficial' | 'adres_bdua' | null,
      adres: {
        estado: orm.adres_estado as EstadoAdres,
        consultaId: orm.adres_consulta_id,
        consultaVenceEn: orm.adres_consulta_vence_en,
        preparadaPor: orm.adres_preparada_por,
        preparadaEn: orm.adres_preparada_en,
        tipoDocumento: orm.tipo_documento,
        tipoDocumentoOrigen: orm.tipo_documento_origen as OrigenTipoDocumento | null,
        tipoDocumentoConfirmadoPor: orm.tipo_documento_confirmado_por,
        consultadoEn: orm.adres_consultado_en,
        fuenteActualizadaEn: orm.adres_fuente_actualizada_en,
        evidenciaHash: orm.adres_evidencia_hash,
        cargadaPor: orm.adres_cargada_por,
        cargadaEn: orm.adres_cargada_en,
        referenciaArchivo: orm.adres_referencia_archivo,
        error: orm.adres_error,
        datos: orm.adres_datos as unknown as DatosAdres | null,
        comparacion: (orm.adres_comparacion ?? []) as unknown as ComparacionTripleCampo[],
        recomendacion: orm.adres_recomendacion as RecomendacionEps | null,
      },
      asignadoA: orm.asignado_a,
      reservadoEn: orm.reservado_en,
      reservaHasta: orm.reserva_hasta,
      decididoPor: orm.decidido_por,
      decididoEn: orm.decidido_en,
      retencionHasta: orm.retencion_hasta,
      recibidaEn: orm.recibida_en,
      primeraRevisionEn: orm.primera_revision_en,
      version: orm.version,
      creadaEn: orm.creada_en,
      actualizadaEn: orm.actualizada_en,
    });
  },
  aOrm(d: DatosValidacionEps): ValidacionEpsOrm {
    const orm = new ValidacionEpsOrm();
    orm.id = d.id;
    orm.documento_id = d.documentoId;
    orm.practica_id = d.practicaId;
    orm.estudiante_id = d.estudianteId;
    Object.assign(orm, ValidacionEpsMapper.columnasMutables(d));
    orm.retencion_hasta = d.retencionHasta;
    orm.recibida_en = d.recibidaEn;
    orm.version = d.version;
    orm.creada_en = d.creadaEn;
    return orm;
  },
  /** Columnas que cambian en la vida de la validación (todas menos identidad, creación y retención). */
  columnasMutables(d: DatosValidacionEps) {
    return {
      estado_procesamiento: d.estadoProcesamiento,
      autenticidad: d.autenticidad,
      coincidencia: d.coincidencia,
      afiliacion: d.afiliacion,
      ruta: d.ruta,
      decision: d.decision,
      vigencia_certificado: d.vigenciaCertificado,
      hay_bandera_critica: d.hayBanderaCritica,
      datos_extraidos: d.datosExtraidos as unknown as Record<string, unknown> | null,
      datos_verificados: d.datosVerificados as unknown as Record<string, unknown> | null,
      discrepancias: d.discrepancias as unknown as Record<string, unknown>[],
      error_codigo: d.errorCodigo,
      verificador_codigo: d.verificadorCodigo,
      verificacion_iniciada_en: d.verificacionIniciadaEn,
      verificado_en: d.verificadoEn,
      verificacion_error: d.verificacionError,
      afiliacion_fuente: d.afiliacionFuente,
      adres_estado: d.adres.estado,
      adres_consulta_id: d.adres.consultaId,
      adres_consulta_vence_en: d.adres.consultaVenceEn,
      adres_preparada_por: d.adres.preparadaPor,
      adres_preparada_en: d.adres.preparadaEn,
      tipo_documento: d.adres.tipoDocumento,
      tipo_documento_origen: d.adres.tipoDocumentoOrigen,
      tipo_documento_confirmado_por: d.adres.tipoDocumentoConfirmadoPor,
      adres_consultado_en: d.adres.consultadoEn,
      adres_fuente_actualizada_en: d.adres.fuenteActualizadaEn,
      adres_evidencia_hash: d.adres.evidenciaHash,
      adres_cargada_por: d.adres.cargadaPor,
      adres_cargada_en: d.adres.cargadaEn,
      adres_referencia_archivo: d.adres.referenciaArchivo,
      adres_error: d.adres.error,
      adres_datos: d.adres.datos as unknown as Record<string, unknown> | null,
      adres_comparacion: d.adres.comparacion as unknown as Record<string, unknown>[],
      adres_recomendacion: d.adres.recomendacion,
      asignado_a: d.asignadoA,
      reservado_en: d.reservadoEn,
      reserva_hasta: d.reservaHasta,
      decidido_por: d.decididoPor,
      decidido_en: d.decididoEn,
      primera_revision_en: d.primeraRevisionEn,
      actualizada_en: d.actualizadaEn,
    };
  },
};

const EvidenciaMapper = {
  aDominio(orm: EvidenciaValidacionEpsOrm): EvidenciaEps {
    return EvidenciaEps.desde({
      id: orm.id,
      validacionEpsId: orm.validacion_eps_id,
      tipo: orm.tipo as TipoEvidenciaEps,
      fuente: orm.fuente as FuenteEvidenciaEps,
      metodo: orm.metodo,
      resultado: orm.resultado,
      fechaVerificacion: orm.fecha_verificacion,
      hashEvidencia: orm.hash_evidencia,
      origen: orm.origen,
      datosObtenidos: orm.datos_obtenidos ?? {},
      errorCodigo: orm.error_codigo,
      verificadoPor: orm.verificado_por,
      creadoEn: orm.creado_en,
    });
  },
  aOrm(d: DatosEvidenciaEps): EvidenciaValidacionEpsOrm {
    const orm = new EvidenciaValidacionEpsOrm();
    orm.id = d.id;
    orm.validacion_eps_id = d.validacionEpsId;
    orm.tipo = d.tipo;
    orm.fuente = d.fuente;
    orm.metodo = d.metodo;
    orm.resultado = d.resultado;
    orm.fecha_verificacion = d.fechaVerificacion;
    orm.hash_evidencia = d.hashEvidencia;
    orm.origen = d.origen;
    orm.datos_obtenidos = d.datosObtenidos;
    orm.error_codigo = d.errorCodigo;
    orm.verificado_por = d.verificadoPor;
    orm.creado_en = d.creadoEn;
    return orm;
  },
};

@Injectable()
export class ValidacionEpsRepositoryAdapter implements ValidacionEpsRepositoryPort {
  constructor(
    @InjectRepository(ValidacionEpsOrm) private readonly repo: Repository<ValidacionEpsOrm>,
    @InjectRepository(EvidenciaValidacionEpsOrm) private readonly evidencias: Repository<EvidenciaValidacionEpsOrm>,
  ) {}

  async buscarPorId(id: string): Promise<ValidacionEps | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? ValidacionEpsMapper.aDominio(orm) : null;
  }

  async buscarPorDocumento(documentoId: string): Promise<ValidacionEps | null> {
    const orm = await this.repo.findOne({ where: { documento_id: documentoId } });
    return orm ? ValidacionEpsMapper.aDominio(orm) : null;
  }

  async crearSiNoExiste(datos: DatosValidacionEps): Promise<{ validacion: ValidacionEps; creada: boolean }> {
    const resultado = await this.repo
      .createQueryBuilder()
      .insert()
      .into(ValidacionEpsOrm)
      .values(ValidacionEpsMapper.aOrm(datos) as never)
      .orIgnore() // ON CONFLICT DO NOTHING: el índice único de documento_id decide al ganador
      .returning('id')
      .execute();
    const creada = Array.isArray(resultado.raw) && resultado.raw.length === 1;
    const orm = await this.repo.findOneOrFail({ where: { documento_id: datos.documentoId } });
    return { validacion: ValidacionEpsMapper.aDominio(orm), creada };
  }

  async guardarSiVersion(datos: DatosValidacionEps, versionEsperada: number): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionEpsOrm)
      .set({ ...ValidacionEpsMapper.columnasMutables(datos), version: () => 'version + 1' } as never)
      .where('id = :id AND version = :versionEsperada', { id: datos.id, versionEsperada })
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionEpsOrm)
      .set({
        asignado_a: actorId, reservado_en: ahora, reserva_hasta: hasta, actualizada_en: ahora,
        primera_revision_en: () => 'COALESCE(primera_revision_en, :ahora)',
        version: () => 'version + 1',
      })
      .where(
        `id = :id
         AND decision IN (:...abiertas)
         AND (asignado_a IS NULL OR reserva_hasta <= :ahora OR asignado_a = :actorId)`,
        { id, abiertas: [DecisionEps.PENDIENTE, DecisionEps.CANDIDATO_AUTOAPROBACION], ahora, actorId },
      )
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionEpsOrm)
      .set({
        asignado_a: null, reservado_en: null, reserva_hasta: null, actualizada_en: ahora,
        version: () => 'version + 1',
      })
      .where(
        `id = :id AND asignado_a IS NOT NULL
         AND (asignado_a = :actorId OR :esSupervisor = true OR reserva_hasta <= :ahora)`,
        { id, actorId, esSupervisor, ahora },
      )
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async agregarEvidencia(datos: DatosEvidenciaEps): Promise<EvidenciaEps> {
    // `insert`, nunca `save`: una evidencia no se reescribe.
    await this.evidencias.insert(EvidenciaMapper.aOrm(datos) as never);
    const orm = await this.evidencias.findOneOrFail({ where: { id: datos.id } });
    return EvidenciaMapper.aDominio(orm);
  }

  async buscarEvidenciaAdresPorHash(hash: string): Promise<{ validacionEpsId: string } | null> {
    const fila = await this.evidencias.findOne({ where: { tipo: TipoEvidenciaEps.ADRES, hash_evidencia: hash } });
    return fila ? { validacionEpsId: fila.validacion_eps_id } : null;
  }

  async listarParaAdres(limite: number): Promise<ValidacionEps[]> {
    const filas = await this.repo
      .createQueryBuilder('v')
      .where('v.adres_estado IN (:...estados)', {
        estados: [EstadoAdres.PENDIENTE, EstadoAdres.EN_CONSULTA, EstadoAdres.EVIDENCIA_RECIBIDA, EstadoAdres.ERROR, EstadoAdres.NO_DETERMINABLE],
      })
      .andWhere('v.decision IN (:...decisiones)', { decisiones: [DecisionEps.PENDIENTE, DecisionEps.CANDIDATO_AUTOAPROBACION] })
      .orderBy('v.actualizada_en', 'ASC')
      .limit(limite)
      .getMany();
    return filas.map((f) => ValidacionEpsMapper.aDominio(f));
  }

  // ── Mesa operativa ────────────────────────────────────────────────────────

  /** Versión vigente del certificado, aún no decidido por una persona. */
  private static readonly ABIERTA = `
    v.decision IN ('pendiente','candidato_autoaprobacion')
    AND d.version = (SELECT max(x.version) FROM documentos x WHERE x.practica_id = d.practica_id AND x.tipo = d.tipo)
    AND d.estado IN ('recibido','analizando','en_revision')`;

  /** Consulta cruda con filas tipadas como registros: el resultado de `query` es `any`. */
  private async consultar(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>> {
    const r: unknown = await this.repo.query(sql, params);
    return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
  }

  async listarAbiertasMesa(ahora: Date, escuelasAlcance: string[] | null): Promise<FilaMesaRepo[]> {
    const params: unknown[] = [ahora];
    let escuela = '';
    if (escuelasAlcance && escuelasAlcance.length > 0) { params.push(escuelasAlcance); escuela = 'AND p.escuela_id = ANY($2)'; }
    const filas = (await this.consultar(`
      SELECT v.id AS validacion_id, u.id AS estudiante_id, u.nombre AS estudiante_nombre, u.documento AS estudiante_documento,
             p.id AS practica_id, p.programa_id, p.modalidad, p.periodo_academico, p.fecha_inicio, p.escuela_id,
             d.id AS documento_id, d.version AS documento_version, d.cargado_en, d.estado AS documento_estado, d.nombre_original,
             (SELECT count(*)::int FROM documentos x WHERE x.practica_id = d.practica_id AND x.tipo = d.tipo) AS total_versiones,
             r.nombre AS responsable_nombre
      FROM validaciones_eps v
      JOIN documentos d ON d.id = v.documento_id
      JOIN practicas p ON p.id = v.practica_id
      JOIN usuarios u ON u.id = v.estudiante_id
      LEFT JOIN usuarios r ON r.id = v.asignado_a AND v.reserva_hasta > $1
      WHERE ${ValidacionEpsRepositoryAdapter.ABIERTA} ${escuela}
      ORDER BY COALESCE(v.recibida_en, v.creada_en) ASC
      LIMIT 2000`, params));
    if (filas.length === 0) return [];
    const entidades = await this.repo.find({ where: { id: In(filas.map((f) => f.validacion_id as string)) } });
    const porId = new Map(entidades.map((e) => [e.id, e]));
    return filas.flatMap((f): FilaMesaRepo[] => {
      const orm = porId.get(f.validacion_id as string);
      if (!orm) return [];
      return [{
        validacion: ValidacionEpsMapper.aDominio(orm),
        estudiante: { id: f.estudiante_id as string, nombre: f.estudiante_nombre as string, documento: (f.estudiante_documento as string | null) ?? null },
        practica: {
          id: f.practica_id as string, programaId: f.programa_id as string, modalidad: f.modalidad as string,
          periodoAcademico: f.periodo_academico as string, fechaInicio: f.fecha_inicio ? new Date(f.fecha_inicio as string) : null, escuelaId: f.escuela_id as string,
        },
        documento: {
          id: f.documento_id as string, version: Number(f.documento_version), cargadoEn: new Date(f.cargado_en as string),
          estado: f.documento_estado as string, nombreOriginal: f.nombre_original as string, totalVersiones: Number(f.total_versiones),
        },
        responsableNombre: (f.responsable_nombre as string | null) ?? null,
      }];
    });
  }

  async tomarSiguiente(
    actorId: string, ahora: Date, hasta: Date, escuelasAlcance: string[] | null, criterios: CriteriosSiguiente = {},
  ): Promise<string | null> {
    const params: unknown[] = [actorId, ahora, hasta];
    const extra: string[] = [];
    const agregar = (condicion: string, valor: unknown): void => { params.push(valor); extra.push(condicion.replace('?', `$${params.length}`)); };
    if (escuelasAlcance && escuelasAlcance.length > 0) agregar('p.escuela_id = ANY(?)', escuelasAlcance);
    if (criterios.periodo) agregar('p.periodo_academico = ?', criterios.periodo);
    if (criterios.programa) agregar('p.programa_id = ?', criterios.programa);
    if (criterios.modalidad) agregar('p.modalidad = ?', criterios.modalidad);
    if (criterios.estadosAdres && criterios.estadosAdres.length > 0) agregar('v2.adres_estado = ANY(?)', criterios.estadosAdres);
    const abiertosAdres = ESTADOS_ADRES_ABIERTOS.map((e) => `'${e}'`).join(',');
    // Misma regla que `calcularPrioridad` (hay una prueba contra PostgreSQL que las compara).
    const prioridad = `
      LEAST(${PESOS_PRIORIDAD.antiguedadMaxDias}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - COALESCE(v2.recibida_en, v2.creada_en))) / 86400)))
      + CASE WHEN p.fecha_inicio IS NOT NULL AND p.fecha_inicio <= $2::timestamptz + interval '${PESOS_PRIORIDAD.inicioPracticaDias} days' THEN ${PESOS_PRIORIDAD.inicioPractica} ELSE 0 END
      + CASE WHEN d.version > 1 THEN ${PESOS_PRIORIDAD.reenvio} ELSE 0 END
      + CASE WHEN (v2.coincidencia = 'discrepancia' OR v2.autenticidad = 'invalida' OR v2.afiliacion = 'inactiva' OR v2.hay_bandera_critica
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(v2.adres_comparacion) e WHERE (e->>'critico')::boolean IS TRUE))
             THEN ${PESOS_PRIORIDAD.discrepanciaCritica} ELSE 0 END
      + CASE WHEN v2.adres_estado IN (${abiertosAdres}) THEN ${PESOS_PRIORIDAD.adresPendiente} ELSE 0 END`;
    const filas = (await this.repo.query(`
      UPDATE validaciones_eps v
      SET asignado_a = $1, reservado_en = $2, reserva_hasta = $3, actualizada_en = $2,
          primera_revision_en = COALESCE(v.primera_revision_en, $2), version = v.version + 1
      WHERE v.id = (
        SELECT v2.id
        FROM validaciones_eps v2
        JOIN documentos d ON d.id = v2.documento_id
        JOIN practicas p ON p.id = v2.practica_id
        WHERE v2.estado_procesamiento = 'procesado'
          AND v2.decision IN ('pendiente','candidato_autoaprobacion')
          AND (v2.asignado_a IS NULL OR v2.reserva_hasta <= $2)
          AND d.version = (SELECT max(x.version) FROM documentos x WHERE x.practica_id = d.practica_id AND x.tipo = d.tipo)
          AND d.estado IN ('recibido','analizando','en_revision')
          ${extra.map((e) => `AND ${e}`).join(' ')}
        ORDER BY (${prioridad}) DESC, COALESCE(v2.recibida_en, v2.creada_en) ASC, v2.id ASC
        FOR UPDATE OF v2 SKIP LOCKED
        LIMIT 1)
      RETURNING v.id`, params)) as unknown;
    // El controlador de pg devuelve [filas, cantidad] para UPDATE … RETURNING.
    const lista = filas as unknown[];
    const filasDevueltas = (Array.isArray(lista[0]) ? lista[0] : lista) as Array<{ id: string }>;
    return filasDevueltas[0]?.id ?? null;
  }

  async supervisionMesa(ahora: Date, escuelasAlcance: string[] | null): Promise<ResumenSupervisionRepo> {
    const params: unknown[] = [ahora];
    let escuela = '';
    if (escuelasAlcance && escuelasAlcance.length > 0) { params.push(escuelasAlcance); escuela = 'AND p.escuela_id = ANY($2)'; }
    const [resumen] = (await this.consultar(`
      SELECT count(*)::int AS abiertas,
             count(*) FILTER (WHERE v.asignado_a IS NULL OR v.reserva_hasta <= $1)::int AS sin_asignar,
             avg(extract(epoch FROM (v.primera_revision_en - COALESCE(v.recibida_en, v.creada_en))) / 3600)
               FILTER (WHERE v.primera_revision_en >= $1::timestamptz - interval '30 days') AS horas_primera
      FROM validaciones_eps v
      JOIN documentos d ON d.id = v.documento_id
      JOIN practicas p ON p.id = v.practica_id
      WHERE ${ValidacionEpsRepositoryAdapter.ABIERTA} ${escuela}`, params));
    const filas = (await this.consultar(`
      SELECT u.id, u.nombre, u.correo, u.rol,
             count(*) FILTER (WHERE v.asignado_a = u.id AND v.reserva_hasta > $1 AND v.decision IN ('pendiente','candidato_autoaprobacion'))::int AS reservas_vigentes,
             count(*) FILTER (WHERE v.asignado_a = u.id AND v.reserva_hasta > $1 AND v.reserva_hasta <= $1::timestamptz + interval '5 minutes'
                               AND v.decision IN ('pendiente','candidato_autoaprobacion'))::int AS por_vencer,
             count(*) FILTER (WHERE v.decidido_por = u.id AND v.decidido_en >= $1::timestamptz - interval '7 days')::int AS decididas7,
             avg(extract(epoch FROM (v.decidido_en - COALESCE(v.recibida_en, v.creada_en))) / 3600)
               FILTER (WHERE v.decidido_por = u.id AND v.decidido_en >= $1::timestamptz - interval '30 days') AS horas_decision
      FROM usuarios u
      JOIN validaciones_eps v ON (v.asignado_a = u.id OR v.decidido_por = u.id)
      JOIN practicas p ON p.id = v.practica_id
      WHERE u.rol IN ('auxiliar','coordinador','administrador') ${escuela}
      GROUP BY u.id, u.nombre, u.correo, u.rol
      ORDER BY reservas_vigentes DESC, u.nombre ASC`, params));
    return {
      abiertas: Number(resumen?.abiertas ?? 0),
      sinAsignar: Number(resumen?.sin_asignar ?? 0),
      horasMediasHastaPrimeraRevision: resumen?.horas_primera === null || resumen?.horas_primera === undefined ? null : Number(resumen.horas_primera),
      funcionarios: filas.map((f) => ({
        funcionarioId: f.id as string, nombre: f.nombre as string, correo: f.correo as string, rol: f.rol as string,
        reservasVigentes: Number(f.reservas_vigentes), reservasPorVencer: Number(f.por_vencer), decididas7Dias: Number(f.decididas7),
        horasMediasHastaDecision: f.horas_decision === null || f.horas_decision === undefined ? null : Number(f.horas_decision),
      })),
    };
  }

  async listarEvidencias(validacionEpsId: string): Promise<EvidenciaEps[]> {
    const filas = await this.evidencias.find({
      where: { validacion_eps_id: validacionEpsId },
      order: { creado_en: 'ASC' },
    });
    return filas.map((f) => EvidenciaMapper.aDominio(f));
  }
}
