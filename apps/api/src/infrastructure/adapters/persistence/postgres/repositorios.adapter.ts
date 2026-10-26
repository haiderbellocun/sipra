import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between, ILike, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not, Repository,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { RegistroAuditoria } from '../../../../domain/entities/auditoria.entity';
import {
  DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../../../../domain/entities/documento.entity';
import { DatosEmpresa, Empresa, EstadoEmpresa } from '../../../../domain/entities/empresa.entity';
import { DatosObligacion, EstadoObligacion, Obligacion } from '../../../../domain/entities/obligacion.entity';
import { DatosPractica, Practica } from '../../../../domain/entities/practica.entity';
import { DatosUsuario, Usuario } from '../../../../domain/entities/usuario.entity';
import { DatosPeriodo, PeriodoAcademico } from '../../../../domain/entities/periodo.entity';
import { CartaPresentacion, DatosCarta } from '../../../../domain/entities/carta-presentacion.entity';
import {
  DatosEntradaBitacora, EntradaBitacora, TipoEntradaBitacora,
} from '../../../../domain/entities/bitacora.entity';
import { DatosSolicitudArl, EstadoSolicitudArl, SolicitudArl } from '../../../../domain/entities/solicitud-arl.entity';
import { CategoriaPqrs, DatosPqrs, EstadoPqrs, SolicitudPqrs } from '../../../../domain/entities/pqrs.entity';
import { DatosVacante, EstadoVacante, Vacante } from '../../../../domain/entities/vacante.entity';
import {
  AuditoriaRepositoryPort, CartaRepositoryPort, DocumentoRepositoryPort, EmpresaRepositoryPort,
  FiltroCartas, FiltroPracticas,
  ObligacionRepositoryPort, PeriodoRepositoryPort, PracticaRepositoryPort, UsuarioRepositoryPort,
  VacanteRepositoryPort,
  BitacoraRepositoryPort, FiltroBitacora, FiltroSolicitudesArl, SolicitudArlRepositoryPort, FiltroPqrs, PqrsRepositoryPort,
} from '../../../../domain/ports/out/repositorios.port';
import {
  AuditoriaOrm, CartaOrm, DocumentoOrm, EmpresaOrm, ObligacionOrm, PeriodoOrm, PracticaOrm,
  UsuarioOrm, VacanteOrm,
  BitacoraOrm, SolicitudArlOrm, PqrsOrm,
} from '../../../persistence/postgres/entities/todas.orm-entity';
import {
  CartaMapper, DocumentoMapper, EmpresaMapper, ObligacionMapper, PeriodoMapper, PracticaMapper,
  UsuarioMapper, VacanteMapper,
  BitacoraMapper, SolicitudArlMapper, PqrsMapper,
} from './mappers';

@Injectable()
export class UsuarioRepositoryAdapter implements UsuarioRepositoryPort {
  constructor(@InjectRepository(UsuarioOrm) private readonly repo: Repository<UsuarioOrm>) {}

  async buscarPorId(id: string): Promise<Usuario | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? UsuarioMapper.aDominio(orm) : null;
  }

  async buscarPorCorreo(correo: string): Promise<Usuario | null> {
    const orm = await this.repo.findOne({ where: { correo: correo.toLowerCase() } });
    return orm ? UsuarioMapper.aDominio(orm) : null;
  }

  async buscarPorDocumento(documento: string): Promise<Usuario | null> {
    const orm = await this.repo.findOne({ where: { documento } });
    return orm ? UsuarioMapper.aDominio(orm) : null;
  }

  async buscarTexto(texto: string, limite = 50): Promise<Usuario[]> {
    const patron = `%${texto.replace(/[%_]/g, '')}%`;
    const filas = await this.repo.find({
      where: [{ documento: ILike(patron) }, { correo: ILike(patron) }, { nombre: ILike(patron) }],
      order: { nombre: 'ASC' },
      take: limite,
    });
    return filas.map((fila) => UsuarioMapper.aDominio(fila));
  }

  async listarPorRol(rol: string): Promise<Usuario[]> {
    const filas = await this.repo.find({ where: { rol }, order: { nombre: 'ASC' } });
    return filas.map((fila) => UsuarioMapper.aDominio(fila));
  }

  async listar(filtro: { roles?: readonly string[]; activo?: boolean } = {}): Promise<Usuario[]> {
    const where: Record<string, unknown> = {};
    if (filtro.roles && filtro.roles.length > 0) where.rol = In([...filtro.roles]);
    if (filtro.activo !== undefined) where.activo = filtro.activo;
    const filas = await this.repo.find({ where, order: { nombre: 'ASC' } });
    return filas.map((fila) => UsuarioMapper.aDominio(fila));
  }

  async guardar(datos: DatosUsuario): Promise<Usuario> {
    const guardado = await this.repo.save(UsuarioMapper.aOrm(datos));
    return UsuarioMapper.aDominio(guardado);
  }
}

@Injectable()
export class PracticaRepositoryAdapter implements PracticaRepositoryPort {
  constructor(@InjectRepository(PracticaOrm) private readonly repo: Repository<PracticaOrm>) {}

  async buscarPorId(id: string): Promise<Practica | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? PracticaMapper.aDominio(orm) : null;
  }

  async listar(filtro: FiltroPracticas): Promise<Practica[]> {
    const filas = await this.repo.find({
      where: this.condiciones(filtro),
      order: { ultima_actividad: 'DESC' },
      take: filtro.limite ?? 200,
      skip: filtro.desplazamiento ?? 0,
    });
    return filas.map((fila) => PracticaMapper.aDominio(fila));
  }

  async contar(filtro: FiltroPracticas): Promise<number> {
    return this.repo.count({ where: this.condiciones(filtro) });
  }

  async buscarRegistroVigente(estudianteId: string, periodoAcademico: string): Promise<Practica | null> {
    const orm = await this.repo.findOne({
      where: { estudiante_id: estudianteId, periodo_academico: periodoAcademico, estado: Not('anulada') },
      order: { creada_en: 'DESC' },
    });
    return orm ? PracticaMapper.aDominio(orm) : null;
  }

  async guardar(datos: DatosPractica): Promise<Practica> {
    const guardada = await this.repo.save(PracticaMapper.aOrm(datos));
    return PracticaMapper.aDominio(guardada);
  }

  /**
   * El alcance se traduce a condiciones SQL. No se consultan todas las
   * prácticas para filtrarlas después: el aislamiento ocurre en la consulta.
   */
  private condiciones(filtro: FiltroPracticas): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (filtro.estudianteId) where.estudiante_id = filtro.estudianteId;
    if (filtro.tutorId) where.tutor_id = filtro.tutorId;
    if (filtro.empresaId) where.empresa_id = filtro.empresaId;
    if (filtro.escuelaIds && filtro.escuelaIds.length > 0) {
      where.escuela_id = In([...filtro.escuelaIds]);
    }
    if (filtro.estudianteIds) where.estudiante_id = In([...filtro.estudianteIds]);
    if (filtro.estados && filtro.estados.length > 0) where.estado = In([...filtro.estados]);
    if (filtro.periodoAcademico) where.periodo_academico = filtro.periodoAcademico;
    if (filtro.programaId) where.programa_id = filtro.programaId;
    if (filtro.regional) where.regional = filtro.regional;
    if (filtro.modalidad) where.modalidad = filtro.modalidad;
    if (filtro.ciclo) where.ciclo = filtro.ciclo;
    if (filtro.conTutor === true) where.tutor_id = Not(IsNull());
    if (filtro.conTutor === false) where.tutor_id = IsNull();
    if (filtro.movimientoDesde && filtro.movimientoHasta) {
      where.ultima_actividad = Between(filtro.movimientoDesde, filtro.movimientoHasta);
    } else if (filtro.movimientoDesde) {
      where.ultima_actividad = MoreThanOrEqual(filtro.movimientoDesde);
    } else if (filtro.movimientoHasta) {
      where.ultima_actividad = LessThanOrEqual(filtro.movimientoHasta);
    }
    return where;
  }
}

@Injectable()
export class DocumentoRepositoryAdapter implements DocumentoRepositoryPort {
  constructor(@InjectRepository(DocumentoOrm) private readonly repo: Repository<DocumentoOrm>) {}

  async buscarPorId(id: string): Promise<Documento | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? DocumentoMapper.aDominio(orm) : null;
  }

  async listarPorPractica(practicaId: string): Promise<Documento[]> {
    const filas = await this.repo.find({
      where: { practica_id: practicaId },
      order: { tipo: 'ASC', version: 'DESC' },
    });
    return filas.map((fila) => DocumentoMapper.aDominio(fila));
  }

  async contarPorHash(hashSha256: string, excluirDocumentoId?: string): Promise<number> {
    return this.repo.count({
      where: excluirDocumentoId
        ? { hash_sha256: hashSha256, id: Not(excluirDocumentoId) }
        : { hash_sha256: hashSha256 },
    });
  }

  async listarHashesPerceptuales(
    tipo: TipoDocumento,
    excluirPracticaId: string,
  ): Promise<{ id: string; practicaId: string; hashPerceptual: string }[]> {
    const filas = await this.repo
      .createQueryBuilder('d')
      .select(['d.id AS id', 'd.practica_id AS practica_id', 'd.hash_perceptual AS hash_perceptual'])
      .where('d.tipo = :tipo', { tipo })
      .andWhere('d.practica_id <> :practicaId', { practicaId: excluirPracticaId })
      .andWhere('d.hash_perceptual IS NOT NULL')
      .limit(5000)
      .getRawMany<{ id: string; practica_id: string; hash_perceptual: string }>();
    return filas.map((f) => ({
      id: f.id,
      practicaId: f.practica_id,
      hashPerceptual: f.hash_perceptual,
    }));
  }

  async ultimaVersion(practicaId: string, tipo: TipoDocumento): Promise<number> {
    const fila = await this.repo.findOne({
      where: { practica_id: practicaId, tipo },
      order: { version: 'DESC' },
    });
    return fila?.version ?? 0;
  }

  async guardar(datos: DatosDocumento): Promise<Documento> {
    const guardado = await this.repo.save(DocumentoMapper.aOrm(datos));
    return DocumentoMapper.aDominio(guardado);
  }

  async reclamarProcesamiento(id: string, ahora: Date, caducidadMs: number): Promise<boolean> {
    const limite = new Date(ahora.getTime() - caducidadMs);
    const resultado = await this.repo
      .createQueryBuilder()
      .update(DocumentoOrm)
      .set({ estado: EstadoDocumento.ANALIZANDO, actualizado_en: ahora })
      .where(
        'id = :id AND (estado = :recibido OR (estado = :analizando AND actualizado_en <= :limite))',
        { id, recibido: EstadoDocumento.RECIBIDO, analizando: EstadoDocumento.ANALIZANDO, limite },
      )
      .execute();
    return (resultado.affected ?? 0) === 1;
  }

  async liberarReclamo(id: string, ahora: Date): Promise<boolean> {
    const resultado = await this.repo.update(
      { id, estado: EstadoDocumento.ANALIZANDO },
      { estado: EstadoDocumento.RECIBIDO, actualizado_en: ahora },
    );
    return (resultado.affected ?? 0) === 1;
  }

  async guardarSiEstado(datos: DatosDocumento, estadoEsperado: EstadoDocumento): Promise<boolean> {
    const orm = DocumentoMapper.aOrm(datos);
    // Solo las columnas del ciclo de vida: nunca se reescribe lo que no cambió.
    const resultado = await this.repo.update(
      { id: datos.id, estado: estadoEsperado },
      {
        estado: orm.estado,
        puntaje: orm.puntaje,
        banda: orm.banda,
        // jsonb: el tipado de TypeORM no lo admite sin conversión.
        banderas: orm.banderas as never,
        extraccion: orm.extraccion as never,
        decidido_por: orm.decidido_por,
        justificacion_decision: orm.justificacion_decision,
        motivo_devolucion: orm.motivo_devolucion,
        actualizado_en: orm.actualizado_en,
      },
    );
    return (resultado.affected ?? 0) === 1;
  }

  async listarProcesamientoCaducado(antesDe: Date, limite: number): Promise<Documento[]> {
    const filas = await this.repo.find({
      where: { estado: EstadoDocumento.ANALIZANDO, actualizado_en: LessThanOrEqual(antesDe) },
      order: { actualizado_en: 'ASC' },
      take: limite,
    });
    return filas.map((fila) => DocumentoMapper.aDominio(fila));
  }

  async listarParaPurga(ahora: Date): Promise<Documento[]> {
    const filas = await this.repo.find({ where: { purgar_despues_de: LessThanOrEqual(ahora) } });
    return filas.map((fila) => DocumentoMapper.aDominio(fila));
  }

  /**
   * Suma el costo guardado en cada lectura desde la fecha dada. La fecha de la
   * lectura viaja dentro de `extraccion.leidoEn`; para documentos leídos antes
   * de que existiera ese dato se usa la fecha de cargue.
   */
  async gastoIaDesde(desde: Date): Promise<number> {
    const filas: { total: string | null }[] = await this.repo.manager.query(
      `SELECT COALESCE(SUM(
                COALESCE(NULLIF(extraccion->>'costoUsd', '')::numeric, 0)
              + COALESCE(NULLIF(extraccion->>'gastoPrevioUsd', '')::numeric, 0)), 0) AS total
         FROM documentos
        WHERE extraccion IS NOT NULL
          AND COALESCE((extraccion->>'leidoEn')::timestamptz, cargado_en) >= $1`,
      [desde],
    );
    return Number(filas[0]?.total ?? 0);
  }

  async contarLecturasDesde(practicaId: string, desde: Date): Promise<number> {
    const filas: { total: string | null }[] = await this.repo.manager.query(
      `SELECT COUNT(*) AS total
         FROM documentos
        WHERE practica_id = $1
          AND extraccion IS NOT NULL
          AND COALESCE((extraccion->>'leidoEn')::timestamptz, cargado_en) >= $2`,
      [practicaId, desde],
    );
    return Number(filas[0]?.total ?? 0);
  }
}

@Injectable()
export class EmpresaRepositoryAdapter implements EmpresaRepositoryPort {
  constructor(@InjectRepository(EmpresaOrm) private readonly repo: Repository<EmpresaOrm>) {}

  async buscarPorId(id: string): Promise<Empresa | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? EmpresaMapper.aDominio(orm) : null;
  }

  async buscarPorNit(nitNumero: string): Promise<Empresa | null> {
    const orm = await this.repo.findOne({ where: { nit_numero: nitNumero } });
    return orm ? EmpresaMapper.aDominio(orm) : null;
  }

  async listar(estado?: EstadoEmpresa): Promise<Empresa[]> {
    const filas = await this.repo.find({
      where: estado ? { estado } : {},
      order: { solicitada_en: 'DESC' },
    });
    return filas.map((fila) => EmpresaMapper.aDominio(fila));
  }

  async guardar(datos: DatosEmpresa): Promise<Empresa> {
    const guardada = await this.repo.save(EmpresaMapper.aOrm(datos));
    return EmpresaMapper.aDominio(guardada);
  }
}

@Injectable()
export class ObligacionRepositoryAdapter implements ObligacionRepositoryPort {
  constructor(@InjectRepository(ObligacionOrm) private readonly repo: Repository<ObligacionOrm>) {}

  async listarPorPractica(practicaId: string): Promise<Obligacion[]> {
    const filas = await this.repo.find({
      where: { practica_id: practicaId },
      order: { fecha_limite: 'ASC' },
    });
    return filas.map((fila) => ObligacionMapper.aDominio(fila));
  }

  async listarPendientes(hasta: Date): Promise<Obligacion[]> {
    const filas = await this.repo.find({
      where: {
        estado: In([EstadoObligacion.PENDIENTE, EstadoObligacion.VENCIDA]),
        fecha_limite: LessThanOrEqual(hasta),
      },
      order: { fecha_limite: 'ASC' },
      take: 2000,
    });
    return filas.map((fila) => ObligacionMapper.aDominio(fila));
  }

  async guardar(datos: DatosObligacion): Promise<Obligacion> {
    const guardada = await this.repo.save(ObligacionMapper.aOrm(datos));
    return ObligacionMapper.aDominio(guardada);
  }

  async guardarLote(datos: DatosObligacion[]): Promise<Obligacion[]> {
    if (datos.length === 0) return [];
    const guardadas = await this.repo.save(datos.map((fila) => ObligacionMapper.aOrm(fila)));
    return guardadas.map((fila) => ObligacionMapper.aDominio(fila));
  }
}

@Injectable()
export class VacanteRepositoryAdapter implements VacanteRepositoryPort {
  constructor(@InjectRepository(VacanteOrm) private readonly repo: Repository<VacanteOrm>) {}

  async buscarPorId(id: string): Promise<Vacante | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? VacanteMapper.aDominio(orm) : null;
  }

  async listar(filtro: { empresaId?: string; estado?: EstadoVacante; marco?: string }): Promise<Vacante[]> {
    const where: Record<string, unknown> = {};
    if (filtro.empresaId) where.empresa_id = filtro.empresaId;
    if (filtro.estado) where.estado = filtro.estado;
    if (filtro.marco) where.marco = filtro.marco;
    const filas = await this.repo.find({ where, order: { creada_en: 'DESC' }, take: 200 });
    return filas.map((fila) => VacanteMapper.aDominio(fila));
  }

  async listarPendientesReporteSpe(): Promise<Vacante[]> {
    const filas = await this.repo.find({
      where: { estado: EstadoVacante.PUBLICADA, marco: 'laboral' },
      order: { publicada_en: 'ASC' },
    });
    return filas.map((fila) => VacanteMapper.aDominio(fila));
  }

  async guardar(datos: DatosVacante): Promise<Vacante> {
    const guardada = await this.repo.save(VacanteMapper.aOrm(datos));
    return VacanteMapper.aDominio(guardada);
  }
}

@Injectable()
export class AuditoriaRepositoryAdapter implements AuditoriaRepositoryPort {
  constructor(@InjectRepository(AuditoriaOrm) private readonly repo: Repository<AuditoriaOrm>) {}

  /**
   * Solo escribe hacia adelante: el identificador se genera en la base, de modo
   * que esta operación siempre inserta. La inmutabilidad la garantizan además
   * el trigger y la revocación de UPDATE/DELETE al rol de aplicación.
   */
  async registrar(registro: RegistroAuditoria): Promise<void> {
    const orm = this.repo.create({
      actor_id: registro.actorId,
      actor_correo: registro.actorCorreo,
      actor_rol: registro.actorRol,
      accion: registro.accion,
      entidad: registro.entidad,
      entidad_id: registro.entidadId,
      justificacion: registro.justificacion,
      metadatos: registro.metadatos,
      ip: registro.ip,
      agente_usuario: registro.agenteUsuario?.slice(0, 300) ?? null,
      ocurrido_en: registro.ocurridoEn,
    });
    await this.repo.save(orm);
  }

  async contarConsultasRecientes(actorId: string, desde: Date): Promise<number> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.actor_id = :actorId', { actorId })
      .andWhere('a.ocurrido_en >= :desde', { desde })
      .andWhere('a.accion IN (:...acciones)', {
        acciones: ['expediente_consultado', 'documento_visualizado', 'documento_descargado'],
      })
      .getCount();
  }

  async listar(filtro: {
    actorId?: string; entidad?: string; entidadId?: string;
    desde?: Date; hasta?: Date; limite?: number;
  }): Promise<RegistroAuditoria[]> {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.ocurrido_en', 'DESC');
    if (filtro.actorId) qb.andWhere('a.actor_id = :actorId', { actorId: filtro.actorId });
    if (filtro.entidad) qb.andWhere('a.entidad = :entidad', { entidad: filtro.entidad });
    if (filtro.entidadId) qb.andWhere('a.entidad_id = :entidadId', { entidadId: filtro.entidadId });
    if (filtro.desde) qb.andWhere('a.ocurrido_en >= :desde', { desde: filtro.desde });
    if (filtro.hasta) qb.andWhere('a.ocurrido_en <= :hasta', { hasta: filtro.hasta });
    qb.take(filtro.limite ?? 200);

    const filas = await qb.getMany();
    return filas.map((a) => ({
      id: a.id,
      actorId: a.actor_id,
      actorCorreo: a.actor_correo,
      actorRol: a.actor_rol,
      accion: a.accion as RegistroAuditoria['accion'],
      entidad: a.entidad,
      entidadId: a.entidad_id,
      justificacion: a.justificacion,
      metadatos: a.metadatos ?? null,
      ip: a.ip,
      agenteUsuario: a.agente_usuario,
      ocurridoEn: a.ocurrido_en,
    }));
  }
}

@Injectable()
export class PeriodoRepositoryAdapter implements PeriodoRepositoryPort {
  constructor(@InjectRepository(PeriodoOrm) private readonly repo: Repository<PeriodoOrm>) {}

  async buscarPorCodigo(codigo: string): Promise<PeriodoAcademico | null> {
    const orm = await this.repo.findOne({ where: { codigo } });
    return orm ? PeriodoMapper.aDominio(orm) : null;
  }

  async listar(filtro: { activo?: boolean; calendario?: string } = {}): Promise<PeriodoAcademico[]> {
    const where: Record<string, unknown> = {};
    if (filtro.activo !== undefined) where.activo = filtro.activo;
    if (filtro.calendario) where.calendario = filtro.calendario;
    const filas = await this.repo.find({ where, order: { fecha_inicio: 'DESC' } });
    return filas.map((fila) => PeriodoMapper.aDominio(fila));
  }

  async guardar(datos: DatosPeriodo): Promise<PeriodoAcademico> {
    const guardado = await this.repo.save(PeriodoMapper.aOrm(datos));
    return PeriodoMapper.aDominio(guardado);
  }
}

@Injectable()
export class CartaRepositoryAdapter implements CartaRepositoryPort {
  constructor(@InjectRepository(CartaOrm) private readonly repo: Repository<CartaOrm>) {}

  async buscarPorId(id: string): Promise<CartaPresentacion | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? CartaMapper.aDominio(orm) : null;
  }

  async listar(filtro: FiltroCartas): Promise<CartaPresentacion[]> {
    const where: Record<string, unknown> = {};
    if (filtro.estudianteId) where.estudiante_id = filtro.estudianteId;
    if (filtro.periodoAcademico) where.periodo_academico = filtro.periodoAcademico;
    if (filtro.desde && filtro.hasta) where.generada_en = Between(filtro.desde, filtro.hasta);
    const filas = await this.repo.find({ where, order: { generada_en: 'DESC' }, take: filtro.limite ?? 500 });
    return filas.map((f) => CartaMapper.aDominio(f));
  }

  async guardar(datos: DatosCarta): Promise<CartaPresentacion> {
    const guardada = await this.repo.save(CartaMapper.aOrm(datos));
    return CartaMapper.aDominio(guardada);
  }
}

@Injectable()
export class BitacoraRepositoryAdapter implements BitacoraRepositoryPort {
  constructor(@InjectRepository(BitacoraOrm) private readonly repo: Repository<BitacoraOrm>) {}

  async listarPorPractica(practicaId: string): Promise<EntradaBitacora[]> {
    const filas = await this.repo.find({ where: { practica_id: practicaId }, order: { creada_en: 'ASC' } });
    return filas.map((f) => BitacoraMapper.aDominio(f));
  }

  async listar(filtro: FiltroBitacora): Promise<EntradaBitacora[]> {
    const consulta = this.repo.createQueryBuilder('b')
      .innerJoin('practicas', 'p', 'p.id = b.practica_id')
      .orderBy('b.creada_en', 'DESC')
      .take(filtro.limite ?? 2000);
    if (filtro.practicaId) consulta.andWhere('b.practica_id = :practicaId', { practicaId: filtro.practicaId });
    if (filtro.periodoAcademico) consulta.andWhere('p.periodo_academico = :periodo', { periodo: filtro.periodoAcademico });
    if (filtro.tipo) consulta.andWhere('b.tipo = :tipo', { tipo: filtro.tipo });
    if (filtro.desde) consulta.andWhere('b.creada_en >= :desde', { desde: filtro.desde });
    if (filtro.hasta) consulta.andWhere('b.creada_en <= :hasta', { hasta: filtro.hasta });
    const filas = await consulta.getMany();
    return filas.map((f) => BitacoraMapper.aDominio(f));
  }

  async ultimaPorTipo(practicaId: string, tipo: TipoEntradaBitacora): Promise<EntradaBitacora | null> {
    const orm = await this.repo.findOne({ where: { practica_id: practicaId, tipo }, order: { creada_en: 'DESC' } });
    return orm ? BitacoraMapper.aDominio(orm) : null;
  }

  /** INSERT explícito: la tabla no concede UPDATE al rol de aplicación. */
  async agregar(datos: DatosEntradaBitacora): Promise<EntradaBitacora> {
    const orm = BitacoraMapper.aOrm(datos);
    await this.repo.insert(orm as QueryDeepPartialEntity<BitacoraOrm>);
    return BitacoraMapper.aDominio(orm);
  }
}

@Injectable()
export class SolicitudArlRepositoryAdapter implements SolicitudArlRepositoryPort {
  constructor(@InjectRepository(SolicitudArlOrm) private readonly repo: Repository<SolicitudArlOrm>) {}

  async buscarPorId(id: string): Promise<SolicitudArl | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? SolicitudArlMapper.aDominio(orm) : null;
  }

  async buscarVigente(practicaId: string): Promise<SolicitudArl | null> {
    const orm = await this.repo.findOne({
      where: { practica_id: practicaId, estado: In([EstadoSolicitudArl.RADICADA, EstadoSolicitudArl.APROBADA]) },
      order: { radicada_en: 'DESC' },
    });
    return orm ? SolicitudArlMapper.aDominio(orm) : null;
  }

  async listar(filtro: FiltroSolicitudesArl): Promise<SolicitudArl[]> {
    const where: Record<string, unknown> = {};
    if (filtro.estado) {
      where.estado = typeof filtro.estado === 'string'
        ? filtro.estado
        : In(filtro.estado.map((e: EstadoSolicitudArl) => e));
    }
    if (filtro.periodoAcademico) where.periodo_academico = filtro.periodoAcademico;
    if (filtro.estudianteId) where.estudiante_id = filtro.estudianteId;
    if (filtro.practicaId) where.practica_id = filtro.practicaId;
    if (filtro.radicadaDesde && filtro.radicadaHasta) where.radicada_en = Between(filtro.radicadaDesde, filtro.radicadaHasta);
    if (filtro.decididaDesde && filtro.decididaHasta) where.decidida_en = Between(filtro.decididaDesde, filtro.decididaHasta);
    const filas = await this.repo.find({ where, order: { radicada_en: 'DESC' }, take: filtro.limite ?? 500 });
    return filas.map((f) => SolicitudArlMapper.aDominio(f));
  }

  async guardar(datos: DatosSolicitudArl): Promise<SolicitudArl> {
    await this.repo.save(SolicitudArlMapper.aOrm(datos));
    const releida = await this.repo.findOneOrFail({ where: { id: datos.id } });
    return SolicitudArlMapper.aDominio(releida);
  }
}

@Injectable()
export class PqrsRepositoryAdapter implements PqrsRepositoryPort {
  constructor(@InjectRepository(PqrsOrm) private readonly repo: Repository<PqrsOrm>) {}

  async buscarPorId(id: string): Promise<SolicitudPqrs | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? PqrsMapper.aDominio(orm) : null;
  }

  async buscarAbierta(estudianteId: string, categoria: CategoriaPqrs): Promise<SolicitudPqrs | null> {
    const orm = await this.repo.findOne({
      where: { estudiante_id: estudianteId, categoria, estado: In([EstadoPqrs.RADICADA, EstadoPqrs.EN_TRAMITE]) },
      order: { radicada_en: 'ASC' },
    });
    return orm ? PqrsMapper.aDominio(orm) : null;
  }

  async listar(filtro: FiltroPqrs): Promise<SolicitudPqrs[]> {
    const where: Record<string, unknown> = {};
    if (filtro.estudianteId) where.estudiante_id = filtro.estudianteId;
    if (filtro.categoria) where.categoria = filtro.categoria;
    if (filtro.estado) {
      where.estado = typeof filtro.estado === 'string' ? filtro.estado : In(filtro.estado.map((e: EstadoPqrs) => e));
    }
    const filas = await this.repo.find({ where, order: { radicada_en: 'DESC' }, take: filtro.limite ?? 500 });
    return filas.map((f) => PqrsMapper.aDominio(f));
  }

  async guardar(datos: DatosPqrs): Promise<SolicitudPqrs> {
    await this.repo.save(PqrsMapper.aOrm(datos));
    const releida = await this.repo.findOneOrFail({ where: { id: datos.id } });
    return PqrsMapper.aDominio(releida);
  }
}
