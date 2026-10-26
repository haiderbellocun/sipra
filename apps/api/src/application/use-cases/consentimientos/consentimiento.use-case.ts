import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  CanalConsentimiento, Consentimiento, PoliticaConsentimiento, TipoConsentimiento,
} from '../../../domain/entities/consentimiento.entity';
import { EstadoObligacion, TipoObligacion } from '../../../domain/entities/obligacion.entity';
import {
  CONSENTIMIENTO_REPOSITORY, ConsentimientoRepositoryPort, POLITICA_CONSENTIMIENTO_REPOSITORY,
  PoliticaConsentimientoRepositoryPort,
} from '../../../domain/ports/out/consentimiento.port';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, OBLIGACION_REPOSITORY, ObligacionRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  ConsentimientoRespuestaDto, PoliticaVigenteDto, PublicarPoliticaDto, RegistrarConsentimientoDto,
  ResultadoConsentimientoDto,
} from '../../dtos/consentimiento.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

const MAXIMO_HISTORIAL = 200;

/**
 * Consentimiento versionado.
 *
 * Reglas:
 *  · La persona sale SIEMPRE de la sesión; el cuerpo de la petición no la fija.
 *  · Aceptar exige la política VIGENTE (si no, 409). Revocar se admite sobre
 *    cualquier versión publicada: retirar el consentimiento no depende de que la
 *    política siga vigente.
 *  · Los eventos son append-only. Un evento idéntico al último no se duplica;
 *    aceptar → revocar → aceptar deja tres filas.
 *  · Aceptar la política de tratamiento cumple la obligación
 *    AUTORIZACION_TRATAMIENTO. NO bloquea la carga de documentos mientras
 *    CONSENTIMIENTO_BLOQUEA_CARGUE sea false (valor de fábrica).
 *  · Nunca se registra el texto de la política en la auditoría.
 */
@Injectable()
export class ConsentimientoUseCase {
  constructor(
    @Inject(POLITICA_CONSENTIMIENTO_REPOSITORY) private readonly politicas: PoliticaConsentimientoRepositoryPort,
    @Inject(CONSENTIMIENTO_REPOSITORY) private readonly consentimientos: ConsentimientoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(OBLIGACION_REPOSITORY) private readonly obligaciones: ObligacionRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    private readonly config: ConfigService,
  ) {}

  // ── Políticas ────────────────────────────────────────────────────────────

  async politicaVigente(tipo: TipoConsentimiento, ahora: Date = new Date()): Promise<PoliticaVigenteDto> {
    const politica = await this.politicas.buscarActiva(tipo);
    if (!politica || !politica.vigenteEn(ahora)) {
      throw new NotFoundException('No hay una política vigente publicada para este tipo');
    }
    return this.aPoliticaDto(politica);
  }

  /** Publica una versión nueva y retira la anterior. Solo administración. */
  async publicarPolitica(
    dto: PublicarPoliticaDto, actor: Actor, ahora: Date = new Date(),
  ): Promise<PoliticaVigenteDto> {
    if (actor.rol !== Rol.ADMINISTRADOR) {
      throw new ForbiddenException('Solo administración publica políticas de consentimiento');
    }
    if (!dto.contenido.trim()) throw new BadRequestException('La política no tiene contenido');

    if (await this.politicas.buscarPorTipoYVersion(dto.tipo, dto.version)) {
      throw new ConflictException(`La versión ${dto.version} ya existe: publique una versión nueva`);
    }
    const ultima = await this.politicas.ultimaVersion(dto.tipo);
    if (dto.version <= ultima) {
      throw new ConflictException(`La versión debe ser mayor que la última publicada (${ultima})`);
    }

    const publicada = await this.politicas.publicar({
      id: randomUUID(),
      tipo: dto.tipo,
      version: dto.version,
      titulo: dto.titulo.trim(),
      finalidad: dto.finalidad.trim(),
      contenido: dto.contenido,
      textoSha256: createHash('sha256').update(dto.contenido, 'utf8').digest('hex'),
      vigenteDesde: ahora,
      vigenteHasta: null,
      activa: true,
      publicadaPor: actor.id,
      creadaEn: ahora,
    });

    await this.registrarAuditoria(actor, AccionAuditada.POLITICA_CONSENTIMIENTO_PUBLICADA, publicada.id, {
      tipo: dto.tipo, version: dto.version,
    });
    return this.aPoliticaDto(publicada);
  }

  // ── Consentimientos ──────────────────────────────────────────────────────

  async registrar(
    dto: RegistrarConsentimientoDto, actor: Actor, ahora: Date = new Date(),
  ): Promise<ResultadoConsentimientoDto> {
    const politica = await this.politicas.buscarPorTipoYVersion(dto.tipo, dto.politicaVersion);
    if (!politica) throw new NotFoundException('La política indicada no existe');

    if (dto.aceptado && !politica.vigenteEn(ahora)) {
      const activa = await this.politicas.buscarActiva(dto.tipo);
      throw new ConflictException(
        activa?.vigenteEn(ahora)
          ? `La versión ${dto.politicaVersion} no es la vigente; la vigente es la ${activa.version}`
          : `La versión ${dto.politicaVersion} no está vigente`,
      );
    }

    const practicaId = dto.practicaId ?? null;
    if (practicaId) await this.exigirPracticaPropia(practicaId, actor);

    // Idempotencia: el mismo evento seguido del mismo evento no se duplica.
    const ultimo = await this.consentimientos.ultimo(actor.id, dto.tipo, practicaId);
    if (ultimo && ultimo.aceptado === dto.aceptado && ultimo.politicaId === politica.id) {
      return { consentimiento: await this.aDto(ultimo, new Map([[politica.id, politica]])), registrado: false };
    }

    const guardado = await this.consentimientos.agregar({
      id: randomUUID(),
      usuarioId: actor.id,
      practicaId,
      tipo: dto.tipo,
      finalidad: politica.finalidad,
      politicaId: politica.id,
      aceptado: dto.aceptado,
      canal: CanalConsentimiento.WEB,
      registradoPor: actor.id,
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      creadoEn: ahora,
    });

    await this.registrarAuditoria(
      actor,
      dto.aceptado ? AccionAuditada.CONSENTIMIENTO_ACEPTADO : AccionAuditada.CONSENTIMIENTO_REVOCADO,
      guardado.id,
      { tipo: dto.tipo, version: politica.version, practicaId, aceptado: dto.aceptado, resultado: 'registrado' },
    );

    if (dto.aceptado && dto.tipo === TipoConsentimiento.TRATAMIENTO_DATOS) {
      await this.cumplirObligacion(actor, practicaId, ahora);
    }
    return { consentimiento: await this.aDto(guardado, new Map([[politica.id, politica]])), registrado: true };
  }

  async misConsentimientos(actor: Actor): Promise<ConsentimientoRespuestaDto[]> {
    return this.historial(actor.id);
  }

  /** Historial de UNA persona, para quien gestiona el Área. No es un buscador masivo. */
  async consultarDeUsuario(usuarioId: string, actor: Actor): Promise<ConsentimientoRespuestaDto[]> {
    const gestiona = actor.rol === Rol.ADMINISTRADOR || (actor.rol === Rol.COORDINADOR && actor.escuelas.length === 0);
    if (!gestiona) {
      throw new ForbiddenException('La consulta de consentimientos de otra persona corresponde a administración o al Área de Prácticas');
    }
    if (!(await this.usuarios.buscarPorId(usuarioId))) throw new NotFoundException('Usuario no encontrado');
    return this.historial(usuarioId);
  }

  /**
   * Compuerta de la carga documental. Con CONSENTIMIENTO_BLOQUEA_CARGUE=false
   * (de fábrica) no hace nada: ni consulta ni bloquea. Encendida, exige que el
   * estudiante tenga aceptada la política VIGENTE (para esa práctica o general).
   */
  async exigirParaCargar(estudianteId: string, practicaId: string, ahora: Date = new Date()): Promise<void> {
    if (this.config.get<boolean>('CONSENTIMIENTO_BLOQUEA_CARGUE') !== true) return;

    const tipo = TipoConsentimiento.TRATAMIENTO_DATOS;
    const vigente = await this.politicas.buscarActiva(tipo);
    if (!vigente || !vigente.vigenteEn(ahora)) {
      throw new ForbiddenException('La política de tratamiento de datos aún no está publicada; no es posible cargar documentos');
    }
    const ultimo = await this.consentimientos.ultimoAplicable(estudianteId, tipo, practicaId);
    if (!ultimo || !ultimo.aceptado || ultimo.politicaId !== vigente.id) {
      throw new ForbiddenException('Debe aceptar la política de tratamiento de datos vigente antes de cargar documentos');
    }
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private async exigirPracticaPropia(practicaId: string, actor: Actor): Promise<void> {
    const practica = await this.practicas.buscarPorId(practicaId);
    // Mismo error para «no existe» y «es de otro»: no confirma la existencia ajena.
    if (!practica || actor.rol !== Rol.ESTUDIANTE || practica.estudianteId !== actor.id) {
      throw new NotFoundException('Expediente no encontrado');
    }
  }

  /** Cumple AUTORIZACION_TRATAMIENTO de la práctica indicada o de todas las del estudiante. */
  private async cumplirObligacion(actor: Actor, practicaId: string | null, ahora: Date): Promise<void> {
    let practicaIds: string[];
    if (practicaId) {
      practicaIds = [practicaId];
    } else if (actor.rol === Rol.ESTUDIANTE) {
      practicaIds = (await this.practicas.listar({ estudianteId: actor.id, limite: 50 })).map((p) => p.id);
    } else {
      return;
    }

    for (const id of practicaIds) {
      const obligacion = (await this.obligaciones.listarPorPractica(id))
        .find((o) => o.tipo === TipoObligacion.AUTORIZACION_TRATAMIENTO);
      if (!obligacion || obligacion.estado === EstadoObligacion.CUMPLIDA) continue;
      obligacion.cumplir(null, ahora);
      await this.obligaciones.guardar(obligacion.instantanea());
      await this.registrarAuditoria(actor, AccionAuditada.OBLIGACION_CUMPLIDA, id, {
        tipo: TipoObligacion.AUTORIZACION_TRATAMIENTO, origen: 'consentimiento',
      }, 'practica');
    }
  }

  private async historial(usuarioId: string): Promise<ConsentimientoRespuestaDto[]> {
    const eventos = await this.consentimientos.listarPorUsuario(usuarioId, MAXIMO_HISTORIAL);
    const cache = new Map<string, PoliticaConsentimiento>();
    return Promise.all(eventos.map((e) => this.aDto(e, cache)));
  }

  private async aDto(
    evento: Consentimiento, cache: Map<string, PoliticaConsentimiento>,
  ): Promise<ConsentimientoRespuestaDto> {
    let politica = cache.get(evento.politicaId);
    if (!politica) {
      const buscada = await this.politicas.buscarPorId(evento.politicaId);
      if (!buscada) throw new NotFoundException('La política del consentimiento no se encuentra');
      politica = buscada;
      cache.set(evento.politicaId, politica);
    }
    const datos = evento.instantanea();
    return {
      id: datos.id,
      tipo: datos.tipo,
      politicaVersion: politica.version,
      politicaTitulo: politica.titulo,
      finalidad: datos.finalidad,
      practicaId: datos.practicaId,
      aceptado: datos.aceptado,
      canal: datos.canal,
      creadoEn: datos.creadoEn.toISOString(),
    };
  }

  private aPoliticaDto(p: PoliticaConsentimiento): PoliticaVigenteDto {
    return {
      tipo: p.tipo,
      version: p.version,
      titulo: p.titulo,
      finalidad: p.finalidad,
      contenido: p.contenido,
      vigenteDesde: p.vigenteDesde.toISOString(),
      vigenteHasta: p.vigenteHasta?.toISOString() ?? null,
    };
  }

  private async registrarAuditoria(
    actor: Actor,
    accion: AccionAuditada,
    entidadId: string,
    metadatos: Record<string, unknown>,
    entidad = 'consentimiento',
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id,
      actorCorreo: actor.correo,
      actorRol: actor.rol,
      accion,
      entidad: accion === AccionAuditada.POLITICA_CONSENTIMIENTO_PUBLICADA ? 'politica_consentimiento' : entidad,
      entidadId,
      justificacion: null,
      metadatos,
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
  }
}
