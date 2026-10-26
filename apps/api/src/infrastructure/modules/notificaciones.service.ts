import { huellaCorreo } from '../auth/oidc.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccionAuditada } from '../../domain/entities/auditoria.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort,
} from '../../domain/ports/out/repositorios.port';
import {
  NOTIFICACION, NotificacionPort,
} from '../../domain/ports/out/servicios-externos.port';
import {
  DatosNotificacion, EventoNotificable, PlantillasNotificacionDomainService,
} from '../../domain/services/plantillas-notificacion.domain-service';

/**
 * Punto único de envío de notificaciones.
 *
 * Compone con las plantillas del dominio, envía por el adaptador configurado y
 * deja constancia del intento en la auditoría —haya salido bien o mal—. Que el
 * envío falle no puede tumbar la operación que lo originó: el documento ya se
 * procesó y su estado es correcto.
 */
@Injectable()
export class NotificacionesService {
  private readonly log = new Logger(NotificacionesService.name);
  private readonly plantillas = new PlantillasNotificacionDomainService();

  constructor(
    @Inject(NOTIFICACION) private readonly canal: NotificacionPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  async notificar(
    evento: EventoNotificable,
    destinatario: { correo: string; nombre: string; id?: string },
    datos: Omit<DatosNotificacion, 'nombreDestinatario'> = {},
  ): Promise<void> {
    const mensaje = this.plantillas.componer(evento, {
      ...datos,
      nombreDestinatario: destinatario.nombre,
    });

    const resultado = await this.canal.enviar({
      destinatario: destinatario.correo,
      asunto: mensaje.asunto,
      cuerpo: mensaje.texto,
      html: mensaje.html,
      plantilla: evento,
    });

    if (!resultado.enviado) {
      this.log.warn(
        `No se pudo notificar "${evento}" al destinatario ${huellaCorreo(destinatario.correo)}: ${resultado.motivo ?? 'sin detalle'}`,
      );
    }

    // Queda registro del intento aunque falle: ante un reclamo hay que poder
    // decir si se avisó al estudiante y cuándo.
    await this.auditoria.registrar({
      actorId: null,
      actorCorreo: 'sistema',
      actorRol: 'sistema',
      accion: AccionAuditada.NOTIFICACION_ENVIADA,
      entidad: 'notificacion',
      entidadId: destinatario.id ?? null,
      justificacion: null,
      metadatos: {
        evento,
        destinatario: destinatario.correo,
        asunto: mensaje.asunto,
        enviado: resultado.enviado,
        referencia: resultado.referencia,
        motivo: resultado.motivo,
      },
      ip: null,
      agenteUsuario: null,
      ocurridoEn: new Date(),
    });
  }
}
