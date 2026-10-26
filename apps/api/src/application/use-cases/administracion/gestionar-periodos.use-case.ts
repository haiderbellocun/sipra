import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { MATRIZ_MODALIDADES, ModalidadPractica } from '../../../domain/entities/modalidad.entity';
import {
  CALENDARIOS, CalendarioPeriodo, DatosPeriodo, PeriodoAcademico, TipoVentana, Ventana,
} from '../../../domain/entities/periodo.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, PERIODO_REPOSITORY, PeriodoRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

export interface VentanaDto { desde: string; hasta: string }

export interface CronogramaDto {
  inicio: string;
  limiteRegistro: string | null;
  limiteSolicitudArl: string | null;
  jornadasInduccion: string[];
  fechaCargueDocumentos: string | null;
  cierre: string;
}

export interface PeriodoRespuesta {
  codigo: string;
  nombre: string;
  calendario: CalendarioPeriodo;
  fechaInicio: string;
  fechaFin: string;
  ventanas: Partial<Record<TipoVentana, VentanaDto>>;
  cronograma: CronogramaDto;
  /** Estado de cada ventana ahora mismo, para no recalcularlo en cada pantalla. */
  abiertas: Record<TipoVentana, boolean>;
  sincronizacionDocentes: boolean;
  modalidadesHabilitadas: ModalidadPractica[];
  /** Vacío = todas ofertadas; aquí la lista efectiva. */
  modalidadesOfertadas: ModalidadPractica[];
  activo: boolean;
  vigente: boolean;
  actualizadoEn: string;
}

export interface CrearPeriodo {
  codigo: string;
  nombre: string;
  calendario: CalendarioPeriodo;
  fechaInicio: string;
  fechaFin: string;
  /** Si no se indica, dos meses después del inicio (cronograma del proceso). */
  cierreFur?: string;
  /** Si no se indica, dos semanas antes del cierre académico. */
  fechaCargueDocumentos?: string;
  /** Si no se indican, la segunda semana del periodo. */
  jornadasInduccion?: string[];
}

export interface ActualizarPeriodo {
  nombre?: string;
  ventanas?: Partial<Record<TipoVentana, VentanaDto | null>>;
  jornadasInduccion?: string[];
  fechaCargueDocumentos?: string | null;
  sincronizacionDocentes?: boolean;
  modalidadesHabilitadas?: ModalidadPractica[];
  activo?: boolean;
}

const dia = (iso: string): Date => {
  const f = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(f.getTime())) throw new BadRequestException(`Fecha no válida: ${iso}`);
  return f;
};

/**
 * Gestión de periodos (SGP, apartado Gestión): abrir y cerrar el registro FUR,
 * el cargue del estudiante y del docente, la carta de presentación, la
 * sincronización con SINU y las modalidades ofertadas, periodo por periodo.
 */
@Injectable()
export class GestionarPeriodosUseCase {
  constructor(
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  /** Lo consultan todos los perfiles: el FUR y la carta dependen de las ventanas. */
  async listar(ahora: Date = new Date()): Promise<PeriodoRespuesta[]> {
    const lista = await this.periodos.listar();
    return lista
      .sort((a, b) => b.fechaInicio.getTime() - a.fechaInicio.getTime())
      .map((p) => this.presentar(p, ahora));
  }

  async obtener(codigo: string, ahora: Date = new Date()): Promise<PeriodoRespuesta> {
    const p = await this.periodos.buscarPorCodigo(codigo);
    if (!p) throw new NotFoundException(`El periodo ${codigo} no existe`);
    return this.presentar(p, ahora);
  }

  async crear(dto: CrearPeriodo, actor: Actor, ahora: Date = new Date()): Promise<PeriodoRespuesta> {
    this.exigirGestor(actor);
    const codigo = dto.codigo.trim().toUpperCase();
    if (!/^[0-9A-Z]{4,12}$/.test(codigo)) throw new BadRequestException('El código del periodo es alfanumérico (p. ej. 2026C o 26V04)');
    if (await this.periodos.buscarPorCodigo(codigo)) throw new ConflictException(`El periodo ${codigo} ya existe`);
    if (!CALENDARIOS.includes(dto.calendario)) throw new BadRequestException('El calendario es presencial, virtual o 335');
    const inicio = dia(dto.fechaInicio);
    const fin = dia(dto.fechaFin);
    const cierreFur = dto.cierreFur ? dia(dto.cierreFur) : PeriodoAcademico.limiteRegistroHabitual(inicio);
    const fechaCargue = dto.fechaCargueDocumentos ? dia(dto.fechaCargueDocumentos) : PeriodoAcademico.cargueHabitual(fin);
    if (fin <= inicio) throw new BadRequestException('El periodo termina antes de empezar');
    if (cierreFur < inicio || cierreFur > fin) {
      throw new BadRequestException('El cierre del registro (límite para registrar y solicitar la ARL) debe caer dentro del periodo');
    }
    if (fechaCargue < inicio || fechaCargue > fin) {
      throw new BadRequestException('La fecha de cargue de documentos debe caer dentro del periodo');
    }
    const datos: DatosPeriodo = {
      codigo, nombre: dto.nombre.trim(), calendario: dto.calendario, fechaInicio: inicio, fechaFin: fin,
      ventanas: PeriodoAcademico.ventanasHabituales(inicio, fin, cierreFur, fechaCargue),
      jornadasInduccion: dto.jornadasInduccion?.length ? dto.jornadasInduccion.map(dia) : PeriodoAcademico.jornadasHabituales(inicio),
      fechaCargueDocumentos: fechaCargue,
      sincronizacionDocentes: true, modalidadesHabilitadas: [], activo: true, creadoEn: ahora, actualizadoEn: ahora,
    };
    const guardado = await this.periodos.guardar(datos);
    await this.registrar(actor, codigo, { creado: true });
    return this.presentar(guardado, ahora);
  }

  async actualizar(codigo: string, dto: ActualizarPeriodo, actor: Actor, ahora: Date = new Date()): Promise<PeriodoRespuesta> {
    this.exigirGestor(actor);
    const periodo = await this.periodos.buscarPorCodigo(codigo);
    if (!periodo) throw new NotFoundException(`El periodo ${codigo} no existe`);
    const cambios: string[] = [];
    try {
      for (const [tipo, ventana] of Object.entries(dto.ventanas ?? {}) as [TipoVentana, VentanaDto | null][]) {
        if (!Object.values(TipoVentana).includes(tipo)) throw new BadRequestException(`Ventana desconocida: ${tipo}`);
        const valor: Ventana | null = ventana ? { desde: dia(ventana.desde), hasta: dia(ventana.hasta) } : null;
        periodo.fijarVentana(tipo, valor, ahora);
        cambios.push(`ventana:${tipo}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
    if (dto.modalidadesHabilitadas !== undefined) {
      const conocidas = new Set(MATRIZ_MODALIDADES.map((m) => m.modalidad));
      const desconocida = dto.modalidadesHabilitadas.find((m) => !conocidas.has(m));
      if (desconocida) throw new BadRequestException(`Modalidad desconocida: ${desconocida}`);
      periodo.habilitarModalidades(dto.modalidadesHabilitadas, ahora);
      cambios.push('modalidades');
    }
    if (dto.sincronizacionDocentes !== undefined) {
      periodo.fijarSincronizacionDocentes(dto.sincronizacionDocentes, ahora);
      cambios.push('sincronizacion');
    }
    if (dto.activo !== undefined) { periodo.activar(dto.activo, ahora); cambios.push('activo'); }
    if (dto.jornadasInduccion !== undefined || dto.fechaCargueDocumentos !== undefined) {
      try {
        periodo.fijarCronograma({
          jornadasInduccion: dto.jornadasInduccion?.map(dia),
          fechaCargueDocumentos: dto.fechaCargueDocumentos === undefined ? undefined
            : dto.fechaCargueDocumentos === null ? null : dia(dto.fechaCargueDocumentos),
        }, ahora);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException((error as Error).message);
      }
      cambios.push('cronograma');
    }
    const datos = periodo.instantanea();
    if (dto.nombre !== undefined) { datos.nombre = dto.nombre.trim(); datos.actualizadoEn = ahora; cambios.push('nombre'); }
    const guardado = await this.periodos.guardar(datos);
    await this.registrar(actor, codigo, { cambios });
    return this.presentar(guardado, ahora);
  }

  private presentar(p: PeriodoAcademico, ahora: Date): PeriodoRespuesta {
    const d = p.instantanea();
    const ventanas: Partial<Record<TipoVentana, VentanaDto>> = {};
    const abiertas = {} as Record<TipoVentana, boolean>;
    for (const tipo of Object.values(TipoVentana)) {
      const v = d.ventanas[tipo];
      if (v) ventanas[tipo] = { desde: v.desde.toISOString().slice(0, 10), hasta: v.hasta.toISOString().slice(0, 10) };
      abiertas[tipo] = p.ventanaAbierta(tipo, ahora);
    }
    const c = p.cronograma();
    const f = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
    return {
      codigo: d.codigo, nombre: d.nombre, calendario: d.calendario,
      fechaInicio: d.fechaInicio.toISOString().slice(0, 10), fechaFin: d.fechaFin.toISOString().slice(0, 10),
      ventanas, abiertas,
      cronograma: {
        inicio: f(c.inicio) as string, limiteRegistro: f(c.limiteRegistro), limiteSolicitudArl: f(c.limiteSolicitudArl),
        jornadasInduccion: c.jornadasInduccion.map((j) => f(j) as string), fechaCargueDocumentos: f(c.fechaCargueDocumentos),
        cierre: f(c.cierre) as string,
      },
      sincronizacionDocentes: d.sincronizacionDocentes,
      modalidadesHabilitadas: d.modalidadesHabilitadas,
      modalidadesOfertadas: d.modalidadesHabilitadas.length === 0
        ? MATRIZ_MODALIDADES.map((m) => m.modalidad) : d.modalidadesHabilitadas,
      activo: d.activo, vigente: p.esVigenteOFuturo(ahora), actualizadoEn: d.actualizadoEn.toISOString(),
    };
  }

  private exigirGestor(actor: Actor): void {
    if (actor.rol === Rol.ADMINISTRADOR) return;
    if (actor.rol === Rol.COORDINADOR && actor.escuelas.length === 0) return;
    throw new ForbiddenException('La gestión de periodos corresponde a la coordinación del Área de Prácticas o a administración');
  }

  private async registrar(actor: Actor, codigo: string, metadatos: Record<string, unknown>): Promise<void> {
    await this.auditoria.registrar({
      // `entidad_id` es uuid en la base; el código del periodo va en los metadatos.
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.PERIODO_ACTUALIZADO,
      entidad: 'periodo', entidadId: null, justificacion: null, metadatos: { periodo: codigo, ...metadatos }, ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}
