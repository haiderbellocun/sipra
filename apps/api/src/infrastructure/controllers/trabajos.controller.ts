import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Post,
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
   *
   * Solo existe con `COLA_DRIVER=cloud_tasks`. Con la cola en proceso el
   * trabajo se ejecuta dentro del propio servicio y este endpoint no se usa:
   * dejarlo abierto permitiría a cualquiera disparar el pipeline (y el gasto de
   * IA) sobre un identificador, así que allí responde 404.
   */
  @Publico()
  @Post('procesar')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  async procesarTrabajo(
    @Body() trabajo: Trabajo,
    @Headers('authorization') autorizacion?: string,
  ): Promise<void> {
    if (this.config.get<string>('COLA_DRIVER') !== 'cloud_tasks') {
      throw new NotFoundException();
    }
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
   * La petición trae un id_token OIDC de la cuenta de servicio de la aplicación,
   * emitido para la URL del worker. Falla cerrada: sin token, o con uno que no
   * se puede comprobar, no se ejecuta nada.
   */
  private async verificarIdentidadDeServicio(autorizacion?: string): Promise<void> {
    const token = autorizacion?.startsWith('Bearer ') ? autorizacion.slice(7) : null;
    if (!token) throw new UnauthorizedException('El worker solo acepta llamadas de la cola');

    const esperado = this.config.get<string>('GCP_CUENTA_SERVICIO');
    const audiencia = this.config.get<string>('WORKER_URL');
    if (!esperado || !audiencia) {
      throw new UnauthorizedException('El worker no tiene configurada la identidad de servicio');
    }
    const identidad = await this.oidc.verificarTokenDeServicio(token, esperado, audiencia);
    if (!identidad) {
      throw new UnauthorizedException('La identidad de servicio no corresponde a esta aplicación');
    }
  }
}
