import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DatosEvidenciaEps, EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps,
} from '../../../../domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, DatosValidacionEps, DatosVerificadosEps,
  DecisionEps, DiscrepanciaEps, EstadoProcesamientoEps, RutaValidacionEps, ValidacionEps, VigenciaCertificado,
} from '../../../../domain/entities/validacion-eps.entity';
import { ValidacionEpsRepositoryPort } from '../../../../domain/ports/out/validacion-eps.port';
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
      asignadoA: orm.asignado_a,
      reservadoEn: orm.reservado_en,
      reservaHasta: orm.reserva_hasta,
      decididoPor: orm.decidido_por,
      decididoEn: orm.decidido_en,
      retencionHasta: orm.retencion_hasta,
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
      asignado_a: d.asignadoA,
      reservado_en: d.reservadoEn,
      reserva_hasta: d.reservaHasta,
      decidido_por: d.decididoPor,
      decidido_en: d.decididoEn,
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

  async listarEvidencias(validacionEpsId: string): Promise<EvidenciaEps[]> {
    const filas = await this.evidencias.find({
      where: { validacion_eps_id: validacionEpsId },
      order: { creado_en: 'ASC' },
    });
    return filas.map((f) => EvidenciaMapper.aDominio(f));
  }
}
