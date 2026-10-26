import {
  Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  EvidenciaEpsDto, ValidacionEpsEstudianteDto, ValidacionEpsOperacionDto,
} from '../../application/dtos/validacion-eps.dto';
import { ValidacionEpsUseCase } from '../../application/use-cases/documentos/validacion-eps.use-case';
import { ResultadoVerificarEps, VerificacionEpsUseCase } from '../../application/use-cases/documentos/verificacion-eps.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

/**
 * Validación del certificado de EPS. La decisión se toma por la ruta común de
 * documentos (`PATCH /documentos/:id/decision`), donde el auxiliar solo puede
 * decidir el certificado de EPS.
 *
 * Auxiliar, coordinación y administración operan; el estudiante ve únicamente
 * el resultado reducido. Docente, empresa y extensión no entran aquí.
 */
@ApiTags('Validación de EPS')
@ApiBearerAuth()
@ApiExtraModels(ValidacionEpsEstudianteDto, ValidacionEpsOperacionDto)
@Controller('validaciones-eps')
export class ValidacionesEpsController {
  constructor(
    private readonly validaciones: ValidacionEpsUseCase,
    private readonly verificaciones: VerificacionEpsUseCase,
  ) {}

  @Get('documento/:documentoId')
  @Roles(Rol.ESTUDIANTE, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Resultado de la validación del certificado de EPS',
    description:
      'Quien opera recibe el detalle (ejes, datos leídos, discrepancias); el estudiante, solo el ' +
      'estado del procesamiento y el resultado. 404 si el documento no es un certificado de EPS o aún no se validó.',
  })
  @ApiResponse({ status: 200, type: ValidacionEpsOperacionDto })
  consultar(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @ActorActual() actor: Actor,
  ): Promise<ValidacionEpsEstudianteDto | ValidacionEpsOperacionDto> {
    return this.validaciones.consultarPorDocumento(documentoId, actor);
  }

  @Get(':id/evidencias')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Evidencias registradas de una validación (uso interno)' })
  @ApiResponse({ status: 200, type: [EvidenciaEpsDto] })
  evidencias(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<EvidenciaEpsDto[]> {
    return this.validaciones.evidencias(id, actor);
  }

  @Post(':id/reserva')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tomar el caso (reserva)',
    description: 'Una reserva vigente por caso. Si otro funcionario ya la tiene, 409. La reserva vence sola.',
  })
  @ApiResponse({ status: 200, type: ValidacionEpsOperacionDto })
  @ApiResponse({ status: 409, description: 'Reservado por otro funcionario o ya decidido' })
  reservar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<ValidacionEpsOperacionDto> {
    return this.validaciones.reservar(id, actor);
  }

  @Post(':id/verificar')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reintentar la verificación oficial del certificado',
    description:
      'Consulta, si existe, el verificador oficial registrado para el QR del certificado. No hay petición a ningún ' +
      'destino que no esté en el registro. Devuelve el resultado del intento (p. ej. «deshabilitada», «qr_no_soportado», «verificado»).',
  })
  async verificar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<{ resultado: ResultadoVerificarEps }> {
    return { resultado: await this.verificaciones.verificarComoOperador(id, actor) };
  }

  @Delete(':id/reserva')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Liberar el caso; coordinación y administración pueden liberar el de otro' })
  @ApiResponse({ status: 200, type: ValidacionEpsOperacionDto })
  liberar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<ValidacionEpsOperacionDto> {
    return this.validaciones.liberar(id, actor);
  }
}
