import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  DatosVacante, EstadoVacante, MarcoVacante, Vacante,
  VacanteDiscriminatoriaError, VacanteIncompletaError,
} from '../../../domain/entities/vacante.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, EMPRESA_REPOSITORY, EmpresaRepositoryPort,
  VACANTE_REPOSITORY, VacanteRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  AntidiscriminacionDomainService,
} from '../../../domain/services/antidiscriminacion.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  CrearVacanteDto, ResultadoAntidiscriminacionDto, VacanteRespuestaDto,
} from '../../dtos/vacante.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

@Injectable()
export class GestionarVacanteUseCase {
  private readonly antidiscriminacion = new AntidiscriminacionDomainService();

  constructor(
    @Inject(VACANTE_REPOSITORY) private readonly vacantes: VacanteRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  /** Analiza un texto sin persistir: alimenta la validación en vivo del formulario. */
  validarTexto(texto: string): ResultadoAntidiscriminacionDto {
    const hallazgos = this.antidiscriminacion.analizar(texto);
    return { publicable: hallazgos.length === 0, hallazgos };
  }

  async crear(dto: CrearVacanteDto, actor: Actor): Promise<VacanteRespuestaDto> {
    const empresaId = this.exigirEmpresa(actor);
    const empresa = await this.empresas.buscarPorId(empresaId);
    if (!empresa?.habilitada) {
      throw new ForbiddenException('Solo una empresa habilitada puede publicar vacantes');
    }

    const ahora = new Date();
    const datos: DatosVacante = {
      id: randomUUID(),
      empresaId,
      marco: dto.marco,
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      funciones: dto.funciones,
      requisitos: dto.requisitos,
      codigoCno: dto.codigoCno,
      codigoCiiu: dto.codigoCiiu,
      divipolaMunicipio: dto.divipolaMunicipio,
      nivelEducativo: dto.nivelEducativo,
      vacantesDisponibles: dto.vacantesDisponibles,
      salarioMinimo: dto.salarioMinimo ?? null,
      salarioMaximo: dto.salarioMaximo ?? null,
      estado: EstadoVacante.BORRADOR,
      publicadaEn: null,
      vigenteHasta: null,
      reportadaSpeEn: null,
      creadaEn: ahora,
      actualizadaEn: ahora,
    };

    const vacante = await this.vacantes.guardar(datos);
    return this.aRespuesta(vacante, empresa.razonSocial);
  }

  /**
   * Publicación. El filtro antidiscriminación bloquea; no advierte.
   * Cada bloqueo queda en auditoría como evidencia de la validación aplicada.
   */
  async publicar(id: string, actor: Actor): Promise<VacanteRespuestaDto> {
    const vacante = await this.vacantes.buscarPorId(id);
    if (!vacante) throw new NotFoundException('Vacante no encontrada');
    if (actor.rol === Rol.EMPRESA && vacante.empresaId !== actor.empresaId) {
      throw new NotFoundException('Vacante no encontrada');
    }

    const datos = vacante.instantanea();
    const hallazgos = this.antidiscriminacion.analizar(
      datos.titulo, datos.descripcion, datos.funciones, datos.requisitos,
    );

    try {
      vacante.publicar(hallazgos.map((h) => `${h.categoria}: "${h.fragmento}"`));
    } catch (error) {
      if (error instanceof VacanteDiscriminatoriaError) {
        await this.registrar(actor, AccionAuditada.VACANTE_BLOQUEADA_ANTIDISCRIMINACION, id, {
          hallazgos,
        });
        throw new BadRequestException({
          mensaje: error.message,
          hallazgos,
        });
      }
      if (error instanceof VacanteIncompletaError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const guardada = await this.vacantes.guardar(vacante.instantanea());
    await this.registrar(actor, AccionAuditada.VACANTE_PUBLICADA, id, {
      marco: datos.marco,
      requiereReporteSpe: vacante.requiereReporteSpe,
    });

    const empresa = await this.empresas.buscarPorId(datos.empresaId);
    return this.aRespuesta(guardada, empresa?.razonSocial ?? null);
  }

  async listar(
    filtro: { estado?: EstadoVacante; marco?: MarcoVacante },
    actor: Actor,
  ): Promise<VacanteRespuestaDto[]> {
    // Un estudiante solo ve vacantes publicadas y vigentes; una empresa, las suyas.
    const consulta =
      actor.rol === Rol.EMPRESA
        ? { empresaId: actor.empresaId ?? '__sin_empresa__', ...filtro }
        : actor.rol === Rol.ESTUDIANTE
          ? { estado: EstadoVacante.PUBLICADA, marco: filtro.marco }
          : filtro;

    const vacantes = await this.vacantes.listar(consulta);
    const razones = new Map<string, string>();
    for (const v of vacantes) {
      if (!razones.has(v.empresaId)) {
        const empresa = await this.empresas.buscarPorId(v.empresaId);
        razones.set(v.empresaId, empresa?.razonSocial ?? '—');
      }
    }
    return vacantes.map((v) => this.aRespuesta(v, razones.get(v.empresaId) ?? null));
  }

  private exigirEmpresa(actor: Actor): string {
    if (actor.rol !== Rol.EMPRESA || !actor.empresaId) {
      throw new ForbiddenException('Solo una empresa habilitada publica vacantes');
    }
    return actor.empresaId;
  }

  private aRespuesta(vacante: Vacante, razonSocial: string | null): VacanteRespuestaDto {
    const d = vacante.instantanea();
    return {
      id: d.id,
      empresaId: d.empresaId,
      empresaRazonSocial: razonSocial,
      marco: d.marco,
      titulo: d.titulo,
      descripcion: d.descripcion,
      funciones: d.funciones,
      requisitos: d.requisitos,
      codigoCno: d.codigoCno,
      codigoCiiu: d.codigoCiiu,
      divipolaMunicipio: d.divipolaMunicipio,
      nivelEducativo: d.nivelEducativo,
      vacantesDisponibles: d.vacantesDisponibles,
      estado: d.estado,
      publicadaEn: d.publicadaEn?.toISOString() ?? null,
      vigenteHasta: d.vigenteHasta?.toISOString() ?? null,
    };
  }

  private async registrar(
    actor: Actor,
    accion: AccionAuditada,
    entidadId: string,
    metadatos: Record<string, unknown>,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id,
      actorCorreo: actor.correo,
      actorRol: actor.rol,
      accion,
      entidad: 'vacante',
      entidadId,
      justificacion: null,
      metadatos,
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
  }
}
