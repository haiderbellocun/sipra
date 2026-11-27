import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { interruptoresRescateIa } from '../../../application/services/interruptores-rescate-ia';
import {
  LecturaRescateIaPort, ResultadoRescateIa, SolicitudRescateIa,
} from '../../../domain/ports/out/servicios-externos.port';
import { evaluarDestinoRescate } from '../../../domain/services/destino-rescate-ia';
import { RescateIaNoAutorizadoError, autorizarRescateIa } from '../../../domain/services/politica-rescate-ia';
import { depurarCamposSolicitados } from '../../../domain/services/solicitud-rescate-ia';
import { ExtraccionOpenAiAdapter } from './openai.adapter';

/**
 * Proveedor PROTEGIDO de la IA de rescate (`LECTURA_RESCATE_IA`). Es la segunda compuerta: el pipeline ya decidió,
 * pero este proveedor NO confía en eso y vuelve a comprobar, antes de que un solo byte salga:
 *
 *  1. hay campos válidos que pedir;
 *  2. la configuración autoriza el rescate (general encendido; interruptor del tipo si es sensible; ambiente `dev`
 *     exacto para los sensibles) con la MISMA función pura que usa el pipeline (`autorizarRescateIa`);
 *  3. el destino real del adaptador es `api.openai.com` (o la propia máquina en `dev`): a diferencia del extractor
 *     principal, el rescate no acepta cualquier host https.
 *
 * Después delega en la MISMA instancia de `ExtraccionOpenAiAdapter`, que sigue siendo el único cliente HTTP.
 * Un rechazo lanza `RescateIaNoAutorizadoError`: no es una invocación ni un fallo del proveedor. Los logs llevan
 * solo el motivo; nunca la URL (puede traer credenciales), valores ni contenido.
 */
@Injectable()
export class LecturaRescateIaSeguraAdapter implements LecturaRescateIaPort {
  private readonly log = new Logger(LecturaRescateIaSeguraAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly openai: ExtraccionOpenAiAdapter,
  ) {}

  async rescatar(solicitud: SolicitudRescateIa): Promise<ResultadoRescateIa> {
    const bloquear = (motivo: ConstructorParameters<typeof RescateIaNoAutorizadoError>[0], detalle?: string): never => {
      this.log.warn(`Rescate con IA bloqueado para ${solicitud.tipo}: ${motivo}${detalle ? ` (${detalle})` : ''}`);
      throw new RescateIaNoAutorizadoError(motivo);
    };

    if (depurarCamposSolicitados(solicitud.tipo, solicitud.camposSolicitados).solicitados.length === 0) bloquear('sin_campos');

    const ambiente = this.config.get<string>('SIPRA_AMBIENTE');
    const autorizacion = autorizarRescateIa(solicitud.tipo, interruptoresRescateIa(this.config), ambiente);
    if (!autorizacion.autorizado && autorizacion.motivo) bloquear(autorizacion.motivo);

    const destino = evaluarDestinoRescate(this.openai.urlBaseConfigurada, ambiente);
    if (!destino.permitido) bloquear('destino_no_permitido', destino.motivo ?? undefined);

    return await this.openai.rescatar(solicitud);
  }
}
