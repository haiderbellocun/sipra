import { ForbiddenException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  CATEGORIAS_AYUDA, CategoriaAyuda, PreguntaFrecuente, buscarPreguntas,
} from '../../../domain/entities/preguntas-frecuentes';
import {
  CategoriaPqrs, EstadoPqrs, PqrsError, SolicitudPqrs, TipoPqrs,
} from '../../../domain/entities/pqrs.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, FiltroPqrs, PQRS_REPOSITORY, PqrsRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { EventoNotificable } from '../../../domain/services/plantillas-notificacion.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { NotificacionesService } from '../../../infrastructure/modules/notificaciones.service';
import { Actor } from '../practicas/gestionar-practica.use-case';

export interface RadicarPqrs {
  tipo: TipoPqrs;
  categoria: CategoriaPqrs;
  asunto: string;
  descripcion: string;
  practicaId?: string | null;
}

export interface PqrsRespuesta {
  id: string;
  radicado: number | null;
  estudianteId: string;
  estudiante: { nombre: string; correo: string } | null;
  practicaId: string | null;
  tipo: TipoPqrs;
  categoria: CategoriaPqrs;
  categoriaEtiqueta: string;
  asunto: string;
  descripcion: string;
  estado: EstadoPqrs;
  respuesta: string | null;
  respondidaPor: string | null;
  respondidaEn: string | null;
  unificadaConId: string | null;
  unificadaConRadicado: number | null;
  radicadaEn: string;
  actualizadaEn: string;
  /** Preguntas de la ayuda que podrían resolver la solicitud sin esperar respuesta. */
  sugerencias?: PreguntaFrecuente[];
}

/** Perfiles que atienden la bandeja de PQRS: Área de Prácticas, auxiliares y administración. */
const ROLES_ATIENDEN: readonly Rol[] = [Rol.COORDINADOR, Rol.AUXILIAR, Rol.ADMINISTRADOR];

/**
 * Centro de ayuda y PQRS de Desarrollo Profesional. La ayuda es un catálogo del
 * dominio (123 preguntas); la PQRS es un trámite con radicado, unificación de
 * duplicados y respuesta oficial en el radicado inicial.
 */
@Injectable()
export class PqrsUseCase {
  constructor(
    @Inject(PQRS_REPOSITORY) private readonly pqrs: PqrsRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    private readonly notificaciones: NotificacionesService,
  ) {}

  // ── Centro de ayuda ──────────────────────────────────────────────────────

  categorias(): readonly CategoriaAyuda[] { return CATEGORIAS_AYUDA; }

  buscar(texto: string | undefined, categoria?: string): PreguntaFrecuente[] {
    const cat = this.categoriaValida(categoria);
    return buscarPreguntas(texto ?? '', cat);
  }

  // ── PQRS ─────────────────────────────────────────────────────────────────

  async radicar(dto: RadicarPqrs, actor: Actor, ahora: Date = new Date()): Promise<PqrsRespuesta> {
    if (actor.rol !== Rol.ESTUDIANTE) throw new ForbiddenException('Las PQRS las radica el estudiante sobre su propio proceso');
    let practicaId: string | null = null;
    if (dto.practicaId) {
      const practica = await this.practicas.buscarPorId(dto.practicaId);
      if (!practica || practica.instantanea().estudianteId !== actor.id) {
        throw new NotFoundException('La práctica indicada no existe o no es suya');
      }
      practicaId = practica.id;
    }
    let solicitud: SolicitudPqrs;
    try {
      solicitud = SolicitudPqrs.nueva({
        id: randomUUID(), radicado: null, estudianteId: actor.id, practicaId,
        tipo: dto.tipo, categoria: dto.categoria, asunto: dto.asunto, descripcion: dto.descripcion,
        estado: EstadoPqrs.RADICADA, respuesta: null, respondidaPor: null, respondidaEn: null,
        unificadaConId: null, radicadaEn: ahora, actualizadaEn: ahora,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    // Unificación: un segundo requerimiento abierto sobre la misma categoría
    // sigue en el radicado inicial (documento PQRS, "Tickets y seguimiento").
    const abierta = await this.pqrs.buscarAbierta(actor.id, dto.categoria);
    if (abierta) solicitud.unificarCon(abierta, ahora);

    const guardada = await this.pqrs.guardar(solicitud.instantanea());
    const datos = guardada.instantanea();
    await this.registrar(actor, AccionAuditada.PQRS_RADICADA, guardada.id, {
      radicado: datos.radicado, categoria: datos.categoria, tipo: datos.tipo, unificadaCon: abierta?.id ?? null,
    });
    const estudiante = await this.usuarios.buscarPorId(actor.id);
    if (estudiante && !abierta) {
      await this.notificaciones.notificar(
        EventoNotificable.PQRS_RADICADA,
        { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
        { consecutivo: datos.radicado, autor: this.etiqueta(datos.categoria), mensaje: datos.asunto },
      );
    }
    const respuesta = await this.presentar(guardada);
    respuesta.sugerencias = buscarPreguntas(`${datos.asunto} ${datos.descripcion}`, datos.categoria).slice(0, 3);
    if (respuesta.sugerencias.length === 0) respuesta.sugerencias = buscarPreguntas('', datos.categoria).slice(0, 3);
    return respuesta;
  }

  async listar(filtro: FiltroPqrs, actor: Actor): Promise<PqrsRespuesta[]> {
    let seguro: FiltroPqrs = filtro;
    if (actor.rol === Rol.ESTUDIANTE) seguro = { ...filtro, estudianteId: actor.id };
    else if (!ROLES_ATIENDEN.includes(actor.rol)) throw new ForbiddenException('Su perfil no consulta la bandeja de PQRS');
    const lista = await this.pqrs.listar(seguro);
    return Promise.all(lista.map((s) => this.presentar(s)));
  }

  async obtener(id: string, actor: Actor): Promise<PqrsRespuesta> {
    const solicitud = await this.cargarVisible(id, actor);
    return this.presentar(solicitud);
  }

  async responder(id: string, texto: string, actor: Actor, ahora: Date = new Date()): Promise<PqrsRespuesta> {
    this.exigirAtiende(actor);
    const solicitud = await this.cargarVisible(id, actor);
    try {
      solicitud.responder(actor.id, texto, ahora);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const guardada = await this.pqrs.guardar(solicitud.instantanea());
    const datos = guardada.instantanea();
    await this.registrar(actor, AccionAuditada.PQRS_RESPONDIDA, guardada.id, { radicado: datos.radicado });
    const estudiante = await this.usuarios.buscarPorId(datos.estudianteId);
    if (estudiante) {
      await this.notificaciones.notificar(
        EventoNotificable.PQRS_RESPONDIDA,
        { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
        { consecutivo: datos.radicado, mensaje: datos.respuesta ?? '' },
      );
    }
    return this.presentar(guardada);
  }

  async tomar(id: string, actor: Actor, ahora: Date = new Date()): Promise<PqrsRespuesta> {
    this.exigirAtiende(actor);
    const solicitud = await this.cargarVisible(id, actor);
    solicitud.tomar(ahora);
    return this.presentar(await this.pqrs.guardar(solicitud.instantanea()));
  }

  /** La cierra el estudiante (conforme) o quien atiende. */
  async cerrar(id: string, actor: Actor, ahora: Date = new Date()): Promise<PqrsRespuesta> {
    const solicitud = await this.cargarVisible(id, actor);
    try {
      solicitud.cerrar(ahora);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return this.presentar(await this.pqrs.guardar(solicitud.instantanea()));
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private async cargarVisible(id: string, actor: Actor): Promise<SolicitudPqrs> {
    const solicitud = await this.pqrs.buscarPorId(id);
    if (!solicitud) throw new NotFoundException('La solicitud no existe');
    if (actor.rol === Rol.ESTUDIANTE && solicitud.estudianteId !== actor.id) throw new NotFoundException('La solicitud no existe');
    if (actor.rol !== Rol.ESTUDIANTE && !ROLES_ATIENDEN.includes(actor.rol)) {
      throw new ForbiddenException('Su perfil no consulta la bandeja de PQRS');
    }
    return solicitud;
  }

  private exigirAtiende(actor: Actor): void {
    if (!ROLES_ATIENDEN.includes(actor.rol)) {
      throw new ForbiddenException('Las PQRS las atiende el Área de Prácticas, los auxiliares o administración');
    }
  }

  private categoriaValida(categoria?: string): CategoriaPqrs | undefined {
    if (!categoria) return undefined;
    const encontrada = CATEGORIAS_AYUDA.find((c) => c.clave === categoria);
    if (!encontrada) throw new BadRequestException(`Categoría de ayuda desconocida: ${categoria}`);
    return encontrada.clave;
  }

  private etiqueta(categoria: CategoriaPqrs): string {
    return CATEGORIAS_AYUDA.find((c) => c.clave === categoria)?.etiqueta ?? categoria;
  }

  private async presentar(s: SolicitudPqrs): Promise<PqrsRespuesta> {
    const d = s.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    let unificadaConRadicado: number | null = null;
    if (d.unificadaConId) unificadaConRadicado = (await this.pqrs.buscarPorId(d.unificadaConId))?.instantanea().radicado ?? null;
    return {
      id: d.id, radicado: d.radicado, estudianteId: d.estudianteId,
      estudiante: estudiante ? { nombre: estudiante.nombre, correo: estudiante.correo } : null,
      practicaId: d.practicaId, tipo: d.tipo, categoria: d.categoria, categoriaEtiqueta: this.etiqueta(d.categoria),
      asunto: d.asunto, descripcion: d.descripcion, estado: d.estado, respuesta: d.respuesta,
      respondidaPor: d.respondidaPor, respondidaEn: d.respondidaEn?.toISOString() ?? null,
      unificadaConId: d.unificadaConId, unificadaConRadicado,
      radicadaEn: d.radicadaEn.toISOString(), actualizadaEn: d.actualizadaEn.toISOString(),
    };
  }

  private async registrar(actor: Actor, accion: AccionAuditada, id: string, metadatos: Record<string, unknown>): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'pqrs', entidadId: id,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}

export { PqrsError };
