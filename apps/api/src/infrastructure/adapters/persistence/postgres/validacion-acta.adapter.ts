import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComparacionActaPersistida, Presencia, Remuneracion, ResponsableArlActa, TipoActaDetectada } from '../../../../domain/entities/acta-iniciacion';
import {
  DatosEvidenciaActa, DatosValidacionActa, EstadoValidacionActa, EvidenciaActa, TipoEvidenciaActa, ValidacionActa,
} from '../../../../domain/entities/validacion-acta.entity';
import { ValidacionActaRepositoryPort } from '../../../../domain/ports/out/validacion-acta.port';
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
      decidido_por: d.decididoPor, decidido_en: d.decididoEn, actualizada_en: d.actualizadaEn,
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

  async listarEvidencias(validacionActaId: string): Promise<EvidenciaActa[]> {
    const filas = await this.evidencias.find({ where: { validacion_acta_id: validacionActaId }, order: { creado_en: 'ASC' } });
    return filas.map((f) => EvidenciaMapper.aDominio(f));
  }
}
