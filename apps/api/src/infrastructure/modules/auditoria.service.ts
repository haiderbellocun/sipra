import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccionAuditada, RegistroAuditoria, UMBRAL_CONSULTAS_POR_HORA,
} from '../../domain/entities/auditoria.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort,
} from '../../domain/ports/out/repositorios.port';
import { Rol } from '../../domain/value-objects/rol.vo';
import { MetricasService } from '../observability/metricas.service';

interface ActorMinimo {
  id: string;
  correo: string;
  rol: Rol;
  escuelas: readonly string[];
  empresaId: string | null;
  ip?: string | null;
  agenteUsuario?: string | null;
}

/**
 * M11 — Punto único de escritura del registro inmutable, más la detección de
 * uso anómalo. No bloquea: notifica.
 */
@Injectable()
export class AuditoriaService {
  private readonly log = new Logger(AuditoriaService.name);

  constructor(
    @Inject(AUDITORIA_REPOSITORY) private readonly repo: AuditoriaRepositoryPort,
    private readonly metricas: MetricasService,
  ) {}

  async registrar(
    actor: ActorMinimo,
    accion: AccionAuditada,
    entidad: string,
    entidadId: string | null,
    metadatos: Record<string, unknown> | null = null,
    justificacion: string | null = null,
  ): Promise<void> {
    await this.repo.registrar({
      actorId: actor.id,
      actorCorreo: actor.correo,
      actorRol: actor.rol,
      accion,
      entidad,
      entidadId,
      justificacion,
      metadatos,
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });

    if (accion === AccionAuditada.ACCESO_FUERA_DE_ALCANCE) {
      this.metricas.accesosFueraDeAlcance.inc({ rol: actor.rol });
      this.log.warn(
        `Acceso fuera de alcance: ${actor.correo} (${actor.rol}) → ${entidad}/${entidadId}`,
      );
    }
  }

  /** Alerta cuando un usuario consulta más de 40 expedientes en una hora. */
  async verificarUsoAnomalo(actorId: string, correo: string): Promise<boolean> {
    const haceUnaHora = new Date(Date.now() - 3_600_000);
    const consultas = await this.repo.contarConsultasRecientes(actorId, haceUnaHora);
    if (consultas > UMBRAL_CONSULTAS_POR_HORA) {
      this.log.warn(
        `Uso anómalo: ${correo} consultó ${consultas} expedientes en la última hora ` +
          `(umbral ${UMBRAL_CONSULTAS_POR_HORA}). No se bloquea el acceso; queda notificado.`,
      );
      return true;
    }
    return false;
  }

  async consultar(filtro: {
    actorId?: string; entidad?: string; entidadId?: string;
    desde?: Date; hasta?: Date; limite?: number;
  }): Promise<RegistroAuditoria[]> {
    return this.repo.listar(filtro);
  }
}
