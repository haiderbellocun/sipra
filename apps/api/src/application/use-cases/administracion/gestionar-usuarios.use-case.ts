import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { DatosUsuario, Usuario } from '../../../domain/entities/usuario.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ROLES_ADMINISTRATIVOS, Rol } from '../../../domain/value-objects/rol.vo';
import { ActualizarUsuarioDto, CrearUsuarioDto, ETIQUETA_ROL, UsuarioAdministrativoDto } from '../../dtos/usuario.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

const DOMINIOS_INSTITUCIONALES = ['cun.edu.co'];

/**
 * Gestión de usuarios administrativos (SGP, apartado Gestión → Gestión de
 * usuarios): crear, consultar, editar, activar o inhabilitar. El estudiante
 * no se crea aquí: existe desde la matrícula (SINU). La «eliminación» del
 * SGP es una inhabilitación: la auditoría sigue apuntando a quien actuó.
 */
@Injectable()
export class GestionarUsuariosUseCase {
  constructor(
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  async listar(
    filtro: { nombre?: string; rol?: Rol; activo?: boolean }, actor: Actor,
  ): Promise<UsuarioAdministrativoDto[]> {
    this.exigirGestor(actor);
    const lista = filtro.nombre?.trim()
      ? await this.usuarios.buscarTexto(filtro.nombre.trim(), 200)
      : await this.usuarios.listar({ roles: ROLES_ADMINISTRATIVOS, activo: filtro.activo });
    return lista
      .filter((u) => ROLES_ADMINISTRATIVOS.includes(u.rol))
      .filter((u) => !filtro.rol || u.rol === filtro.rol)
      .filter((u) => filtro.activo === undefined || u.activo === filtro.activo)
      .map((u) => this.presentar(u));
  }

  async obtener(id: string, actor: Actor): Promise<UsuarioAdministrativoDto> {
    this.exigirGestor(actor);
    return this.presentar(await this.exigirAdministrativo(id));
  }

  async crear(dto: CrearUsuarioDto, actor: Actor, ahora: Date = new Date()): Promise<UsuarioAdministrativoDto> {
    this.exigirGestor(actor);
    const correo = dto.correo.trim().toLowerCase();
    if (!DOMINIOS_INSTITUCIONALES.some((d) => correo.endsWith(`@${d}`))) {
      throw new BadRequestException('Los usuarios administrativos se registran con el correo institucional (@cun.edu.co)');
    }
    if (!ROLES_ADMINISTRATIVOS.includes(dto.rol)) {
      throw new BadRequestException('El rol no corresponde a un usuario administrativo');
    }
    if (dto.rol === Rol.ADMINISTRADOR && actor.rol !== Rol.ADMINISTRADOR) {
      throw new ForbiddenException('Solo un administrador crea administradores');
    }
    if (await this.usuarios.buscarPorCorreo(correo)) throw new ConflictException('Ya existe un usuario con ese correo');
    if (await this.usuarios.buscarPorDocumento(dto.documento.trim())) {
      throw new ConflictException('Ya existe un usuario con ese documento');
    }
    const datos: DatosUsuario = {
      id: randomUUID(),
      correo,
      nombre: dto.nombre.trim(),
      documento: dto.documento.trim(),
      rol: dto.rol,
      permiso: dto.permiso,
      escuelas: dto.escuelas ?? [],
      empresaId: null,
      programaId: null,
      activo: dto.activo ?? true,
      creadoEn: ahora,
      ultimoAccesoEn: null,
    };
    const guardado = await this.usuarios.guardar(datos);
    await this.registrar(actor, AccionAuditada.USUARIO_CREADO, guardado.id, { rol: dto.rol, permiso: dto.permiso });
    return this.presentar(guardado);
  }

  async actualizar(id: string, dto: ActualizarUsuarioDto, actor: Actor): Promise<UsuarioAdministrativoDto> {
    this.exigirGestor(actor);
    const usuario = await this.exigirAdministrativo(id);
    if (usuario.rol === Rol.ADMINISTRADOR && actor.rol !== Rol.ADMINISTRADOR) {
      throw new ForbiddenException('Solo un administrador modifica a otro administrador');
    }
    if (dto.documento && dto.documento !== usuario.instantanea().documento) {
      const otro = await this.usuarios.buscarPorDocumento(dto.documento.trim());
      if (otro && otro.id !== id) throw new ConflictException('Ya existe un usuario con ese documento');
    }
    if (dto.activo === false && actor.id === id) {
      throw new BadRequestException('No puede inhabilitar su propio usuario');
    }
    usuario.actualizar({
      nombre: dto.nombre?.trim(),
      documento: dto.documento?.trim(),
      permiso: dto.permiso,
      escuelas: dto.escuelas,
      activo: dto.activo,
    });
    const guardado = await this.usuarios.guardar(usuario.instantanea());
    await this.registrar(actor, AccionAuditada.USUARIO_ACTUALIZADO, id, {
      campos: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
    });
    return this.presentar(guardado);
  }

  /** «Eliminar» del SGP: inhabilita. El histórico conserva al usuario. */
  async eliminar(id: string, actor: Actor): Promise<UsuarioAdministrativoDto> {
    return this.actualizar(id, { activo: false }, actor);
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private exigirGestor(actor: Actor): void {
    if (actor.rol === Rol.ADMINISTRADOR) return;
    if (actor.rol === Rol.COORDINADOR && actor.escuelas.length === 0) return;
    throw new ForbiddenException('La gestión de usuarios corresponde a la coordinación del Área de Prácticas o a administración');
  }

  private async exigirAdministrativo(id: string): Promise<Usuario> {
    const usuario = await this.usuarios.buscarPorId(id);
    if (!usuario || !ROLES_ADMINISTRATIVOS.includes(usuario.rol)) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  private presentar(u: Usuario): UsuarioAdministrativoDto {
    const d = u.instantanea();
    return {
      id: d.id, correo: d.correo, nombre: d.nombre, documento: d.documento, rol: d.rol,
      rolEtiqueta: ETIQUETA_ROL[d.rol], permiso: d.permiso, escuelas: d.escuelas, activo: d.activo,
      creadoEn: d.creadoEn.toISOString(), ultimoAccesoEn: d.ultimoAccesoEn?.toISOString() ?? null,
    };
  }

  private async registrar(actor: Actor, accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'usuario', entidadId,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}
