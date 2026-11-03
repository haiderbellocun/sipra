import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AutenticidadDocumento, ClasificacionDocumentoEmpresarial, DatosExtraidosEmpresariales, EstadoValidacionDocumentoEmpresarial,
  FamiliaDocumentoEmpresarial, MetodoLecturaEmpresarial, TipoPersona,
} from '../../../../domain/entities/documento-empresarial';
import {
  DatosEvidenciaDocumentoEmpresarial, DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial,
  TipoEvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
} from '../../../../domain/entities/validacion-documento-empresarial.entity';
import type { ComparacionDocumentoEmpresarial } from '../../../../domain/services/comparacion-documento-empresarial.domain-service';
import {
  DocumentoConHuella, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../../domain/ports/out/validacion-documento-empresarial.port';
import { DocumentoOrm } from '../../../persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../../../persistence/postgres/entities/validacion-documento-empresarial.orm-entity';

export const ValidacionDocumentoEmpresarialMapper = {
  aDominio(orm: ValidacionDocumentoEmpresarialOrm): ValidacionDocumentoEmpresarial {
    return ValidacionDocumentoEmpresarial.desde({
      id: orm.id, documentoId: orm.documento_id, practicaId: orm.practica_id, estudianteId: orm.estudiante_id,
      tipoEsperado: orm.tipo_esperado,
      familiaDocumento: orm.familia_documento as FamiliaDocumentoEmpresarial | null,
      tipoDetectado: orm.tipo_detectado as ClasificacionDocumentoEmpresarial | null,
      tipoPersona: orm.tipo_persona as TipoPersona | null, expectativa: orm.expectativa,
      estado: orm.estado as EstadoValidacionDocumentoEmpresarial, intentos: orm.intentos, errorCodigo: orm.error_codigo,
      metodoLectura: orm.metodo_lectura as MetodoLecturaEmpresarial | null,
      // `numeric` llega como texto.
      confianza: orm.confianza === null ? null : Number(orm.confianza),
      lecturaDudosa: orm.lectura_dudosa, hashDocumento: orm.hash_documento, duplicadoDeDocumentoId: orm.duplicado_de_documento_id,
      datosExtraidos: orm.datos_extraidos as unknown as DatosExtraidosEmpresariales | null,
      comparacion: orm.comparacion as unknown as ComparacionDocumentoEmpresarial | null,
      autenticidad: orm.autenticidad as unknown as AutenticidadDocumento,
      recibidaEn: orm.recibida_en, procesadaEn: orm.procesada_en,
      version: orm.version, creadaEn: orm.creada_en, actualizadaEn: orm.actualizada_en,
    });
  },
  /** Columnas que cambian en la vida de la validación (todas menos identidad y creación). */
  columnasMutables(d: DatosValidacionDocumentoEmpresarial) {
    return {
      tipo_esperado: d.tipoEsperado, familia_documento: d.familiaDocumento, tipo_detectado: d.tipoDetectado, tipo_persona: d.tipoPersona,
      expectativa: d.expectativa, estado: d.estado, intentos: d.intentos, error_codigo: d.errorCodigo, metodo_lectura: d.metodoLectura,
      confianza: d.confianza === null ? null : d.confianza.toFixed(3), lectura_dudosa: d.lecturaDudosa,
      hash_documento: d.hashDocumento, duplicado_de_documento_id: d.duplicadoDeDocumentoId,
      datos_extraidos: d.datosExtraidos as unknown as Record<string, unknown> | null,
      comparacion: d.comparacion as unknown as Record<string, unknown> | null,
      autenticidad_estado: d.autenticidad.estado, autenticidad: d.autenticidad as unknown as Record<string, unknown>,
      recibida_en: d.recibidaEn, procesada_en: d.procesadaEn, actualizada_en: d.actualizadaEn,
    };
  },
  aOrm(d: DatosValidacionDocumentoEmpresarial): ValidacionDocumentoEmpresarialOrm {
    const orm = new ValidacionDocumentoEmpresarialOrm();
    orm.id = d.id;
    orm.documento_id = d.documentoId;
    orm.practica_id = d.practicaId;
    orm.estudiante_id = d.estudianteId;
    Object.assign(orm, ValidacionDocumentoEmpresarialMapper.columnasMutables(d));
    orm.version = d.version;
    orm.creada_en = d.creadaEn;
    return orm;
  },
};

export const EvidenciaDocumentoEmpresarialMapper = {
  aDominio(orm: EvidenciaValidacionDocEmpresarialOrm): EvidenciaDocumentoEmpresarial {
    return EvidenciaDocumentoEmpresarial.desde({
      id: orm.id, validacionId: orm.validacion_id, intento: orm.intento, tipo: orm.tipo as TipoEvidenciaDocumentoEmpresarial,
      resultado: orm.resultado, metodo: orm.metodo, fecha: orm.fecha, actorId: orm.actor_id, hashDocumento: orm.hash_documento,
      datos: orm.datos ?? {}, errorCodigo: orm.error_codigo, creadoEn: orm.creado_en,
    });
  },
  aOrm(d: DatosEvidenciaDocumentoEmpresarial): EvidenciaValidacionDocEmpresarialOrm {
    const orm = new EvidenciaValidacionDocEmpresarialOrm();
    orm.id = d.id;
    orm.validacion_id = d.validacionId;
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
export class ValidacionDocumentoEmpresarialRepositoryAdapter implements ValidacionDocumentoEmpresarialRepositoryPort {
  constructor(
    @InjectRepository(ValidacionDocumentoEmpresarialOrm) private readonly repo: Repository<ValidacionDocumentoEmpresarialOrm>,
    @InjectRepository(EvidenciaValidacionDocEmpresarialOrm) private readonly evidencias: Repository<EvidenciaValidacionDocEmpresarialOrm>,
    @InjectRepository(DocumentoOrm) private readonly documentos: Repository<DocumentoOrm>,
  ) {}

  async buscarPorId(id: string): Promise<ValidacionDocumentoEmpresarial | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? ValidacionDocumentoEmpresarialMapper.aDominio(orm) : null;
  }

  async buscarPorDocumento(documentoId: string): Promise<ValidacionDocumentoEmpresarial | null> {
    const orm = await this.repo.findOne({ where: { documento_id: documentoId } });
    return orm ? ValidacionDocumentoEmpresarialMapper.aDominio(orm) : null;
  }

  async listarPorPractica(practicaId: string): Promise<ValidacionDocumentoEmpresarial[]> {
    const filas = await this.repo.find({ where: { practica_id: practicaId }, order: { creada_en: 'ASC' } });
    return filas.map((o) => ValidacionDocumentoEmpresarialMapper.aDominio(o));
  }

  async crearSiNoExiste(datos: DatosValidacionDocumentoEmpresarial): Promise<{ validacion: ValidacionDocumentoEmpresarial; creada: boolean }> {
    const resultado = await this.repo
      .createQueryBuilder()
      .insert()
      .into(ValidacionDocumentoEmpresarialOrm)
      .values(ValidacionDocumentoEmpresarialMapper.aOrm(datos) as never)
      .orIgnore() // ON CONFLICT DO NOTHING: la restricción única de documento_id decide al ganador
      .returning('id')
      .execute();
    const creada = Array.isArray(resultado.raw) && resultado.raw.length === 1;
    const orm = await this.repo.findOneOrFail({ where: { documento_id: datos.documentoId } });
    return { validacion: ValidacionDocumentoEmpresarialMapper.aDominio(orm), creada };
  }

  async guardarSiVersion(datos: DatosValidacionDocumentoEmpresarial, versionEsperada: number): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionDocumentoEmpresarialOrm)
      .set({ ...ValidacionDocumentoEmpresarialMapper.columnasMutables(datos), version: () => 'version + 1' } as never)
      .where('id = :id AND version = :versionEsperada', { id: datos.id, versionEsperada })
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async agregarEvidencia(datos: DatosEvidenciaDocumentoEmpresarial): Promise<boolean> {
    // `insert ... ON CONFLICT DO NOTHING` sobre (validación, intento, tipo): repetir un procesamiento no duplica. Nunca `save`.
    const resultado = await this.evidencias
      .createQueryBuilder()
      .insert()
      .into(EvidenciaValidacionDocEmpresarialOrm)
      .values(EvidenciaDocumentoEmpresarialMapper.aOrm(datos) as never)
      .orIgnore()
      .returning('id')
      .execute();
    return Array.isArray(resultado.raw) && resultado.raw.length === 1;
  }

  async listarEvidencias(validacionId: string): Promise<EvidenciaDocumentoEmpresarial[]> {
    const filas = await this.evidencias.find({ where: { validacion_id: validacionId }, order: { creado_en: 'ASC', intento: 'ASC' } });
    return filas.map((o) => EvidenciaDocumentoEmpresarialMapper.aDominio(o));
  }

  async buscarDuplicados(practicaId: string, tipoDocumento: string, hashDocumento: string, excluirDocumentoId: string): Promise<DocumentoConHuella[]> {
    const filas = await this.documentos
      .createQueryBuilder('d')
      .leftJoin(ValidacionDocumentoEmpresarialOrm, 'v', 'v.documento_id = d.id')
      .select(['d.id AS documento_id', 'd.version AS version', 'd.hash_sha256 AS hash', 'v.id AS validacion_id'])
      .where('d.practica_id = :practicaId AND d.tipo = :tipoDocumento AND d.hash_sha256 = :hashDocumento AND d.id <> :excluirDocumentoId',
        { practicaId, tipoDocumento, hashDocumento, excluirDocumentoId })
      .orderBy('d.cargado_en', 'ASC')
      .getRawMany<{ documento_id: string; version: number; hash: string; validacion_id: string | null }>();
    return filas.map((f) => ({ documentoId: f.documento_id, validacionId: f.validacion_id ?? '', version: Number(f.version), hashDocumento: f.hash }));
  }
}
