import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ProcesarTrabajoUseCase,
} from '../../application/use-cases/documentos/procesar-trabajo.use-case';
import {
  COLA, ColaPort, PrioridadTrabajo, Trabajo,
} from '../../domain/ports/out/servicios-externos.port';
import { Rol } from '../../domain/value-objects/rol.vo';
import { Publico, Roles } from '../auth/roles.decorator';
import { OidcService } from '../auth/oidc.service';

const TIPOS: Trabajo['tipo'][] = ['validar_documento', 'reporte_spe', 'purga_documento'];
const PRIORIDADES: PrioridadTrabajo[] = ['interactiva', 'lote'];

@ApiTags('Operación')
@Controller('trabajos')
export class TrabajosController {
  constructor(
    private readonly procesar: ProcesarTrabajoUseCase,
    @Inject(COLA) private readonly cola: ColaPort,
    private readonly config: ConfigService,
    private readonly oidc: OidcService,
  ) {}

  /**
   * Endpoint que invoca Cloud Tasks. No lo llama un usuario: lo llama la cola
   * con un token OIDC de la cuenta de servicio. Se marca `@Publico` para
   * saltar el guard de sesión y se verifica la identidad de servicio aquí.
   */
  @Publico()
  @Post('procesar')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  async procesarTrabajo(
    @Body() trabajo: Trabajo,
    @Headers('authorization') autorizacion?: string,
  ): Promise<void> {
    await this.verificarIdentidadDeServicio(autorizacion);

    if (!TIPOS.includes(trabajo?.tipo)) {
      throw new BadRequestException('Tipo de trabajo no reconocido');
    }
    if (!trabajo.referencia || typeof trabajo.referencia !== 'string') {
      throw new BadRequestException('El trabajo no indica sobre qué opera');
    }
    if (!PRIORIDADES.includes(trabajo.prioridad)) {
      throw new BadRequestException('Prioridad no reconocida');
    }

    // Si esto lanza, Cloud Tasks reintenta con espera creciente.
    await this.procesar.ejecutar(trabajo);
  }

  @Get('profundidad')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Profundidad de las colas de trabajo',
    description:
      'La cola interactiva atiende el cargue en curso; la de lote, el procesamiento diferido. ' +
      'Son colas separadas porque el escalado debe responder al estudiante que carga hoy, no ' +
      'al lote nocturno.',
  })
  profundidad(): Promise<Record<PrioridadTrabajo, number>> {
    return this.cola.profundidad();
  }

  /**
   * En Google Cloud la petición trae un id_token OIDC de la cuenta de servicio
   * de la aplicación. Fuera de GCP —desarrollo— la cola corre en proceso y este
   * endpoint no se usa, así que exigirlo allí solo estorbaría.
   */
  private async verificarIdentidadDeServicio(autorizacion?: string): Promise<void> {
    if (this.config.get<string>('COLA_DRIVER') !== 'cloud_tasks') return;

    const token = autorizacion?.startsWith('Bearer ') ? autorizacion.slice(7) : null;
    if (!token) throw new UnauthorizedException('El worker solo acepta llamadas de la cola');

    const esperado = this.config.getOrThrow<string>('GCP_CUENTA_SERVICIO');
    const identidad = await this.oidc.verificarTokenDeServicio(token, esperado);
    if (!identidad) {
      throw new UnauthorizedException('La identidad de servicio no corresponde a esta aplicación');
    }
  }
}
