import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  CartaPresentacion, CartaPresentacionDomainService, DatosCarta,
} from '../../../domain/entities/carta-presentacion.entity';
import { definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { TipoVentana, VentanaCerradaError } from '../../../domain/entities/periodo.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, CARTA_REPOSITORY, CartaRepositoryPort,
  FiltroCartas, PERIODO_REPOSITORY, PeriodoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  GENERADOR_PDF, GeneradorPdfPort, SINU, SinuPort,
} from '../../../domain/ports/out/servicios-externos.port';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from './gestionar-practica.use-case';

export interface SolicitudCarta {
  periodoAcademico: string;
  /** Si se indica, la carta va dirigida a la empresa del registro. */
  practicaId?: string;
  /** Carta dirigida a una organización sin registro previo. */
  empresaRazonSocial?: string;
  /** Solo perfiles internos: documento del estudiante. */
  estudianteDocumento?: string;
}

export interface CartaRespuesta {
  id: string;
  numeroFur: number | null;
  practicaId: string | null;
  estudianteId: string;
  estudianteNombre: string;
  estudianteDocumento: string | null;
  periodoAcademico: string;
  modalidadCarta: 'abierta' | 'con_empresa';
  empresaRazonSocial: string | null;
  generadaEn: string;
  generadaPor: string;
}

/**
 * Carta de presentación (SGP, Paso 1 del estudiante; también la genera el
 * docente o coordinación buscando al estudiante). La ventana la fija el
 * periodo; los perfiles internos no dependen de ella.
 */
@Injectable()
export class CartaPresentacionUseCase {
  private readonly composicion = new CartaPresentacionDomainService();

  constructor(
    @Inject(CARTA_REPOSITORY) private readonly cartas: CartaRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(SINU) private readonly sinu: SinuPort,
    @Inject(GENERADOR_PDF) private readonly generadorPdf: GeneradorPdfPort,
  ) {}

  async generar(solicitud: SolicitudCarta, actor: Actor, ahora: Date = new Date()): Promise<CartaRespuesta> {
    if (actor.rol === Rol.EMPRESA) {
      throw new ForbiddenException('Las empresas no generan cartas de presentación');
    }

    const estudiante = actor.rol === Rol.ESTUDIANTE
      ? await this.usuarios.buscarPorId(actor.id)
      : solicitud.estudianteDocumento
        ? await this.usuarios.buscarPorDocumento(solicitud.estudianteDocumento.trim())
        : null;
    if (!estudiante || estudiante.rol !== Rol.ESTUDIANTE) {
      throw new NotFoundException('No se encontró el estudiante');
    }

    const periodo = await this.periodos.buscarPorCodigo(solicitud.periodoAcademico);
    if (!periodo) throw new BadRequestException(`El periodo ${solicitud.periodoAcademico} no existe`);
    if (actor.rol === Rol.ESTUDIANTE) {
      try {
        periodo.exigirVentana(TipoVentana.CARTA_PRESENTACION, ahora);
      } catch (error) {
        if (error instanceof VentanaCerradaError) throw new BadRequestException(error.message);
        throw error;
      }
    }

    // Con registro: la carta va dirigida y con fechas. Sin él: carta abierta.
    let practicaId: string | null = null;
    let numeroFur: number | null = null;
    let modalidad: string | null = null;
    let empresa: string | null = solicitud.empresaRazonSocial?.trim() || null;
    let fechaInicio: Date | null = null;
    let fechaFin: Date | null = null;
    if (solicitud.practicaId) {
      const practica = await this.practicas.buscarPorId(solicitud.practicaId);
      if (!practica || practica.estudianteId !== estudiante.id) {
        throw new NotFoundException('Expediente no encontrado');
      }
      const d = practica.instantanea();
      practicaId = d.id;
      numeroFur = d.numeroFur;
      modalidad = definicionModalidad(d.modalidad).etiqueta;
      empresa = d.empresaRazonSocial ?? empresa;
      fechaInicio = d.fechaInicio;
      fechaFin = d.fechaFin;
    }

    const perfil = estudiante.instantanea();
    const matricula = perfil.documento ? await this.sinu.buscarPorDocumento(perfil.documento) : null;
    const consecutivo = `CP-${periodo.codigo}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const contenido = this.composicion.componer({
      estudianteNombre: estudiante.nombre,
      estudianteDocumento: perfil.documento,
      programa: matricula?.programaNombre ?? perfil.programaId ?? 'programa académico',
      ciclo: matricula?.ciclo ?? 'profesional',
      periodoAcademico: periodo.codigo,
      asignatura: matricula?.asignaturaPractica ?? null,
      modalidad,
      empresaRazonSocial: empresa,
      fechaInicio,
      fechaFin,
      numeroFur,
      fecha: ahora,
      consecutivo,
    });

    const datos: DatosCarta = {
      id: randomUUID(),
      numeroFur,
      practicaId,
      estudianteId: estudiante.id,
      periodoAcademico: periodo.codigo,
      modalidadCarta: empresa ? 'con_empresa' : 'abierta',
      empresaRazonSocial: empresa,
      contenido,
      hashSha256: createHash('sha256').update(JSON.stringify(contenido)).digest('hex'),
      generadaPor: actor.id,
      generadaEn: ahora,
    };
    const carta = await this.cartas.guardar(datos);

    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol,
      accion: AccionAuditada.CARTA_PRESENTACION_GENERADA, entidad: 'carta_presentacion',
      entidadId: carta.id, justificacion: null,
      metadatos: { estudianteId: estudiante.id, periodo: periodo.codigo, modalidadCarta: datos.modalidadCarta },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });

    return this.aRespuesta(carta, estudiante.nombre, perfil.documento);
  }

  /** Reimpresión: mismo contenido, mismo hash. */
  async pdf(id: string, actor: Actor): Promise<{ nombreArchivo: string; contenido: Buffer }> {
    const carta = await this.exigirVisible(id, actor);
    const contenido = await this.generadorPdf.generar(carta.contenido);
    return { nombreArchivo: `carta-presentacion-${carta.id.slice(0, 8)}.pdf`, contenido };
  }

  async listar(filtro: FiltroCartas, actor: Actor): Promise<CartaRespuesta[]> {
    const seguro: FiltroCartas = actor.rol === Rol.ESTUDIANTE
      ? { ...filtro, estudianteId: actor.id }
      : filtro;
    if (actor.rol === Rol.EMPRESA) return [];
    const cartas = await this.cartas.listar(seguro);
    return Promise.all(cartas.map(async (c) => {
      const u = await this.usuarios.buscarPorId(c.estudianteId);
      return this.aRespuesta(c, u?.nombre ?? '—', u?.instantanea().documento ?? null);
    }));
  }

  private async exigirVisible(id: string, actor: Actor): Promise<CartaPresentacion> {
    const carta = await this.cartas.buscarPorId(id);
    if (!carta) throw new NotFoundException('Carta no encontrada');
    if (actor.rol === Rol.ESTUDIANTE && carta.estudianteId !== actor.id) {
      throw new NotFoundException('Carta no encontrada');
    }
    if (actor.rol === Rol.EMPRESA) throw new NotFoundException('Carta no encontrada');
    return carta;
  }

  private aRespuesta(c: CartaPresentacion, nombre: string, documento: string | null): CartaRespuesta {
    const d = c.instantanea();
    return {
      id: d.id, numeroFur: d.numeroFur, practicaId: d.practicaId, estudianteId: d.estudianteId,
      estudianteNombre: nombre, estudianteDocumento: documento, periodoAcademico: d.periodoAcademico,
      modalidadCarta: d.modalidadCarta, empresaRazonSocial: d.empresaRazonSocial,
      generadaEn: d.generadaEn.toISOString(), generadaPor: d.generadaPor,
    };
  }
}
