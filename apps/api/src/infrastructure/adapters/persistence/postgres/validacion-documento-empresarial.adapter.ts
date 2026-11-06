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
  DocumentoConHuella, FiltroMesaRut, FilaMesaRut, ResumenSupervisionRut, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../../domain/ports/out/validacion-documento-empresarial.port';

const TOPE_LISTADO_MESA_RUT = 200;
const MINUTOS_RESERVA_POR_VENCER_RUT = 3;
const TIPOS_RUT_POR_DEFECTO: readonly string[] = ['rut_natural', 'rut_juridico'];

/**
 * Lista de tipos documentales para el SQL. Los valores salen de código (nunca de la petición) y aun así se validan: solo minúsculas y
 * guion bajo, así que no hay forma de inyectar nada.
 */
function listaTipos(tipos: readonly string[] | undefined): string {
  const lista = tipos && tipos.length > 0 ? tipos : TIPOS_RUT_POR_DEFECTO;
  if (!lista.every((t) => /^[a-z_]+$/.test(t))) throw new Error('Tipo documental no válido para la bandeja');
  return lista.map((t) => `'${t}'`).join(',');
}
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
      decididoPor: orm.decidido_por, decididoEn: orm.decidido_en, motivoDecision: orm.motivo_decision,
      asignadoA: orm.asignado_a, reservadoEn: orm.reservado_en, reservaHasta: orm.reserva_hasta, datosSipraCambiaronEn: orm.datos_sipra_cambiaron_en,
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
      recibida_en: d.recibidaEn, procesada_en: d.procesadaEn,
      decidido_por: d.decididoPor, decidido_en: d.decididoEn, motivo_decision: d.motivoDecision,
      asignado_a: d.asignadoA, reservado_en: d.reservadoEn, reserva_hasta: d.reservaHasta, datos_sipra_cambiaron_en: d.datosSipraCambiaronEn,
      actualizada_en: d.actualizadaEn,
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

  async reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean> {
    const resultado = await this.repo
      .createQueryBuilder()
      .update(ValidacionDocumentoEmpresarialOrm)
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
      .update(ValidacionDocumentoEmpresarialOrm)
      .set({ asignado_a: null, reservado_en: null, reserva_hasta: null, actualizada_en: ahora, version: () => 'version + 1' })
      .where(
        `id = :id AND asignado_a IS NOT NULL
         AND (asignado_a = :actorId OR :esSupervisor = true OR reserva_hasta <= :ahora)`,
        { id, actorId, esSupervisor, ahora },
      )
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async listarMesaRut(filtro: FiltroMesaRut): Promise<FilaMesaRut[]> {
    const filas: Record<string, unknown>[] = await this.repo.query(
      `SELECT v.id AS validacion_id, v.documento_id, v.practica_id, v.estudiante_id, u.nombre AS estudiante_nombre,
              p.escuela_id, COALESCE(e.razon_social, p.empresa_razon_social) AS empresa_razon_social, d.tipo AS tipo_documento,
              p.fecha_inicio, d.version AS doc_version, d.cargado_en, v.estado, v.tipo_detectado, v.tipo_persona, v.expectativa, v.lectura_dudosa,
              v.comparacion->>'veredicto' AS veredicto, COALESCE((v.comparacion->>'hayDiscrepancia')::boolean, false) AS hay_discrepancia,
              v.asignado_a, a.nombre AS asignado_nombre, v.reserva_hasta, v.recibida_en, v.procesada_en,
              v.datos_sipra_cambiaron_en, d.estado AS doc_estado, p.modalidad, v.metodo_lectura,
              COALESCE((v.comparacion->>'discrepanciaImportante')::boolean, false) AS discrepancia_importante,
              COALESCE((v.comparacion->'senales') @> '"estado_registral_cancelado"'::jsonb, false) AS estado_cancelado
         FROM validaciones_documento_empresarial v
         JOIN documentos d ON d.id = v.documento_id
         JOIN practicas p ON p.id = v.practica_id
         LEFT JOIN empresas e ON e.id = p.empresa_id
         JOIN usuarios u ON u.id = v.estudiante_id
         LEFT JOIN usuarios a ON a.id = v.asignado_a
        WHERE d.tipo IN (${listaTipos(filtro.tipos)})
          AND d.version = (SELECT max(d2.version) FROM documentos d2 WHERE d2.practica_id = d.practica_id AND d2.tipo = d.tipo)
          AND v.estado = ANY($1::text[])
          AND ($2::text[] IS NULL OR p.escuela_id = ANY($2::text[]))
        ORDER BY v.recibida_en ASC NULLS LAST, v.creada_en ASC
        LIMIT ${TOPE_LISTADO_MESA_RUT}`,
      [[...filtro.estados], filtro.escuelas ? [...filtro.escuelas] : null],
    );
    return filas.map((f) => ({
      validacionId: f.validacion_id as string, documentoId: f.documento_id as string, practicaId: f.practica_id as string,
      estudianteId: f.estudiante_id as string, estudianteNombre: f.estudiante_nombre as string, escuelaId: f.escuela_id as string,
      empresaRazonSocial: (f.empresa_razon_social as string | null) ?? null, tipoDocumento: f.tipo_documento as string, fechaInicio: (f.fecha_inicio as Date | null) ?? null,
      version: f.doc_version as number, cargadoEn: f.cargado_en as Date, estado: f.estado as string,
      tipoDetectado: (f.tipo_detectado as string | null) ?? null, tipoPersona: (f.tipo_persona as string | null) ?? null,
      expectativa: (f.expectativa as string | null) ?? null, lecturaDudosa: f.lectura_dudosa as boolean, veredicto: (f.veredicto as string | null) ?? null,
      hayDiscrepancia: f.hay_discrepancia as boolean, asignadoA: (f.asignado_a as string | null) ?? null,
      asignadoNombre: (f.asignado_nombre as string | null) ?? null, reservaHasta: (f.reserva_hasta as Date | null) ?? null,
      recibidaEn: (f.recibida_en as Date | null) ?? null, procesadaEn: (f.procesada_en as Date | null) ?? null,
      datosSipraCambiaronEn: (f.datos_sipra_cambiaron_en as Date | null) ?? null, estadoDocumento: f.doc_estado as string,
      modalidad: (f.modalidad as string | null) ?? null, metodoLectura: (f.metodo_lectura as string | null) ?? null,
      discrepanciaImportante: f.discrepancia_importante as boolean, estadoCancelado: f.estado_cancelado as boolean,
    }));
  }

  async supervisionRut(ahora: Date, escuelas: readonly string[] | null, tipos?: readonly string[]): Promise<ResumenSupervisionRut> {
    const alcance = escuelas ? [...escuelas] : null;
    const tiposSql = listaTipos(tipos);
    const base = `FROM validaciones_documento_empresarial v
         JOIN documentos d ON d.id = v.documento_id
         JOIN practicas p ON p.id = v.practica_id
        WHERE d.tipo IN (${tiposSql})
          AND d.version = (SELECT max(d2.version) FROM documentos d2 WHERE d2.practica_id = d.practica_id AND d2.tipo = d.tipo)
          AND ($1::text[] IS NULL OR p.escuela_id = ANY($1::text[]))`;
    const resumen: Record<string, number>[] = await this.repo.query(
      `SELECT count(*) FILTER (WHERE v.estado = 'revision')::int AS abiertas,
              count(*) FILTER (WHERE v.estado = 'revision' AND (v.asignado_a IS NULL OR v.reserva_hasta <= $2))::int AS libres,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.asignado_a IS NOT NULL AND v.reserva_hasta > $2)::int AS tomadas,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.asignado_a IS NOT NULL AND v.reserva_hasta > $2
                               AND v.reserva_hasta <= $2::timestamptz + make_interval(mins => $3))::int AS por_vencer,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.asignado_a IS NOT NULL AND v.reserva_hasta <= $2)::int AS vencidas,
              count(*) FILTER (WHERE v.estado = 'revision' AND COALESCE((v.comparacion->>'hayDiscrepancia')::boolean, false))::int AS con_discrepancia,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.tipo_detectado = 'documento_incorrecto')::int AS incorrectos,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.lectura_dudosa)::int AS dudosas,
              count(*) FILTER (WHERE v.estado = 'revision' AND v.expectativa = 'persona_distinta')::int AS personas_distintas
         ${base}`,
      [alcance, ahora, MINUTOS_RESERVA_POR_VENCER_RUT],
    );
    const porEstado: { estado: string; n: number }[] = await this.repo.query(`SELECT v.estado, count(*)::int AS n ${base} GROUP BY v.estado`, [alcance]);
    const funcionarios: { id: string; nombre: string; rol: string; vigentes: number; por_vencer: number; decididas: number }[] = await this.repo.query(
      `SELECT u.id, u.nombre, u.rol,
              count(v.id) FILTER (WHERE v.estado = 'revision' AND v.asignado_a = u.id AND v.reserva_hasta > $1)::int AS vigentes,
              count(v.id) FILTER (WHERE v.estado = 'revision' AND v.asignado_a = u.id AND v.reserva_hasta > $1
                                  AND v.reserva_hasta <= $1::timestamptz + make_interval(mins => $2))::int AS por_vencer,
              count(v.id) FILTER (WHERE v.decidido_por = u.id AND v.decidido_en >= $1::timestamptz - interval '7 days')::int AS decididas
         FROM usuarios u
         LEFT JOIN validaciones_documento_empresarial v ON (v.asignado_a = u.id OR v.decidido_por = u.id)
              AND v.documento_id IN (SELECT id FROM documentos WHERE tipo IN (${tiposSql}))
        WHERE u.rol IN ('tutor','coordinador','administrador') AND u.activo = true
        GROUP BY u.id, u.nombre, u.rol
       HAVING count(v.id) > 0
        ORDER BY u.nombre`,
      [ahora, MINUTOS_RESERVA_POR_VENCER_RUT],
    );
    const r = resumen[0];
    return {
      abiertas: r.abiertas, libres: r.libres, tomadas: r.tomadas, porVencer: r.por_vencer, vencidas: r.vencidas,
      conDiscrepancia: r.con_discrepancia, documentoIncorrecto: r.incorrectos, lecturaDudosa: r.dudosas, personaDistinta: r.personas_distintas,
      porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e.n])),
      funcionarios: funcionarios.map((f) => ({
        funcionarioId: f.id, nombre: f.nombre, rol: f.rol, reservasVigentes: f.vigentes, reservasPorVencer: f.por_vencer,
        decididas7Dias: f.decididas,
      })),
    };
  }

  async versionMaximaDocumento(practicaId: string, tipoDocumento: string): Promise<number> {
    const filas: { v: number | null }[] = await this.documentos.query(
      'SELECT max(version)::int AS v FROM documentos WHERE practica_id = $1 AND tipo = $2', [practicaId, tipoDocumento],
    );
    return filas[0]?.v ?? 0;
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
