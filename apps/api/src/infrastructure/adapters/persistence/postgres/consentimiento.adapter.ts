import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  CanalConsentimiento, Consentimiento, DatosConsentimiento, DatosPolitica, PoliticaConsentimiento,
  TipoConsentimiento,
} from '../../../../domain/entities/consentimiento.entity';
import {
  ConsentimientoRepositoryPort, PoliticaConsentimientoRepositoryPort,
} from '../../../../domain/ports/out/consentimiento.port';
import {
  ConsentimientoOrm, PoliticaConsentimientoOrm,
} from '../../../persistence/postgres/entities/consentimiento.orm-entity';

const VIOLACION_UNICIDAD = '23505';

const PoliticaMapper = {
  aDominio(orm: PoliticaConsentimientoOrm): PoliticaConsentimiento {
    return PoliticaConsentimiento.desde({
      id: orm.id,
      tipo: orm.tipo as TipoConsentimiento,
      version: orm.version,
      titulo: orm.titulo,
      finalidad: orm.finalidad,
      contenido: orm.contenido,
      textoSha256: orm.texto_sha256,
      vigenteDesde: orm.vigente_desde,
      vigenteHasta: orm.vigente_hasta,
      activa: orm.activa,
      publicadaPor: orm.publicada_por,
      creadaEn: orm.creada_en,
    });
  },
  aOrm(d: DatosPolitica): PoliticaConsentimientoOrm {
    const orm = new PoliticaConsentimientoOrm();
    orm.id = d.id;
    orm.tipo = d.tipo;
    orm.version = d.version;
    orm.titulo = d.titulo;
    orm.finalidad = d.finalidad;
    orm.contenido = d.contenido;
    orm.texto_sha256 = d.textoSha256;
    orm.vigente_desde = d.vigenteDesde;
    orm.vigente_hasta = d.vigenteHasta;
    orm.activa = d.activa;
    orm.publicada_por = d.publicadaPor;
    orm.creada_en = d.creadaEn;
    return orm;
  },
};

const ConsentimientoMapper = {
  aDominio(orm: ConsentimientoOrm): Consentimiento {
    return Consentimiento.desde({
      id: orm.id,
      usuarioId: orm.usuario_id,
      practicaId: orm.practica_id,
      tipo: orm.tipo as TipoConsentimiento,
      finalidad: orm.finalidad,
      politicaId: orm.politica_id,
      aceptado: orm.aceptado,
      canal: orm.canal as CanalConsentimiento,
      registradoPor: orm.registrado_por,
      ip: orm.ip,
      agenteUsuario: orm.agente_usuario,
      creadoEn: orm.creado_en,
    });
  },
  aOrm(d: DatosConsentimiento): ConsentimientoOrm {
    const orm = new ConsentimientoOrm();
    orm.id = d.id;
    orm.usuario_id = d.usuarioId;
    orm.practica_id = d.practicaId;
    orm.tipo = d.tipo;
    orm.finalidad = d.finalidad;
    orm.politica_id = d.politicaId;
    orm.aceptado = d.aceptado;
    orm.canal = d.canal;
    orm.registrado_por = d.registradoPor;
    orm.ip = d.ip;
    orm.agente_usuario = d.agenteUsuario;
    orm.creado_en = d.creadoEn;
    return orm;
  },
};

@Injectable()
export class PoliticaConsentimientoRepositoryAdapter implements PoliticaConsentimientoRepositoryPort {
  constructor(
    @InjectRepository(PoliticaConsentimientoOrm) private readonly repo: Repository<PoliticaConsentimientoOrm>,
  ) {}

  async buscarPorId(id: string): Promise<PoliticaConsentimiento | null> {
    const orm = await this.repo.findOne({ where: { id } });
    return orm ? PoliticaMapper.aDominio(orm) : null;
  }

  async buscarPorTipoYVersion(tipo: TipoConsentimiento, version: number): Promise<PoliticaConsentimiento | null> {
    const orm = await this.repo.findOne({ where: { tipo, version } });
    return orm ? PoliticaMapper.aDominio(orm) : null;
  }

  async buscarActiva(tipo: TipoConsentimiento): Promise<PoliticaConsentimiento | null> {
    const orm = await this.repo.findOne({ where: { tipo, activa: true } });
    return orm ? PoliticaMapper.aDominio(orm) : null;
  }

  async ultimaVersion(tipo: TipoConsentimiento): Promise<number> {
    const orm = await this.repo.findOne({ where: { tipo }, order: { version: 'DESC' } });
    return orm?.version ?? 0;
  }

  async publicar(nueva: DatosPolitica): Promise<PoliticaConsentimiento> {
    try {
      await this.repo.manager.transaction(async (m) => {
        // Retira la activa del tipo; el índice único parcial impide que queden dos.
        await m.update(
          PoliticaConsentimientoOrm,
          { tipo: nueva.tipo, activa: true },
          { activa: false, vigente_hasta: nueva.vigenteDesde },
        );
        await m.insert(PoliticaConsentimientoOrm, PoliticaMapper.aOrm(nueva));
      });
    } catch (error) {
      if ((error as { code?: string }).code === VIOLACION_UNICIDAD) {
        throw new ConflictException('Esa versión de la política ya existe o se publicó al mismo tiempo');
      }
      throw error;
    }
    const guardada = await this.repo.findOneOrFail({ where: { id: nueva.id } });
    return PoliticaMapper.aDominio(guardada);
  }
}

@Injectable()
export class ConsentimientoRepositoryAdapter implements ConsentimientoRepositoryPort {
  constructor(@InjectRepository(ConsentimientoOrm) private readonly repo: Repository<ConsentimientoOrm>) {}

  async agregar(datos: DatosConsentimiento): Promise<Consentimiento> {
    // `insert`, nunca `save`: un `save` sobre un id existente actualizaría la fila.
    await this.repo.insert(ConsentimientoMapper.aOrm(datos));
    const releido = await this.repo.findOneOrFail({ where: { id: datos.id } });
    return ConsentimientoMapper.aDominio(releido);
  }

  async ultimo(usuarioId: string, tipo: TipoConsentimiento, practicaId: string | null): Promise<Consentimiento | null> {
    const orm = await this.repo.findOne({
      where: { usuario_id: usuarioId, tipo, practica_id: practicaId === null ? IsNull() : practicaId },
      order: { creado_en: 'DESC' },
    });
    return orm ? ConsentimientoMapper.aDominio(orm) : null;
  }

  async ultimoAplicable(usuarioId: string, tipo: TipoConsentimiento, practicaId: string): Promise<Consentimiento | null> {
    const orm = await this.repo.findOne({
      where: [
        { usuario_id: usuarioId, tipo, practica_id: practicaId },
        { usuario_id: usuarioId, tipo, practica_id: IsNull() },
      ],
      order: { creado_en: 'DESC' },
    });
    return orm ? ConsentimientoMapper.aDominio(orm) : null;
  }

  async listarPorUsuario(usuarioId: string, limite: number): Promise<Consentimiento[]> {
    const filas = await this.repo.find({
      where: { usuario_id: usuarioId },
      order: { creado_en: 'DESC' },
      take: limite,
    });
    return filas.map((f) => ConsentimientoMapper.aDominio(f));
  }
}
