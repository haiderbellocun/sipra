import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  EntradaBitacoraRespuestaDto, EscribirBitacoraDto, EstadoCierreDto, RespuestaCierre,
} from '../../application/dtos/bitacora.dto';
import { BitacoraUseCase } from '../../application/use-cases/practicas/bitacora.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Bitácora y cierre')
@ApiBearerAuth()
@Controller('practicas/:practicaId')
export class BitacoraController {
  constructor(private readonly bitacora: BitacoraUseCase) {}

  @Get('bitacora')
  @Roles(Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Bitácora de la práctica',
    description: 'Conversación entre el estudiante y el docente facilitador, más las anotaciones de la plataforma.',
  })
  @ApiResponse({ status: 200, type: [EntradaBitacoraRespuestaDto] })
  listar(
    @Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor,
  ): Promise<EntradaBitacoraRespuestaDto[]> {
    return this.bitacora.listar(practicaId, actor);
  }

  @Post('bitacora')
  @Roles(Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Escribir en la bitácora',
    description:
      'Tipos: mensaje libre (ambos), seguimiento y evaluación final (docente), «Evalúa tu proceso» ' +
      '(estudiante, una sola vez), plazo de subsanación y calificación docente (docente o coordinación). ' +
      'La calificación exige el 100 % de documentos aprobados; si el estudiante ya evaluó, cierra el proceso.',
  })
  @ApiResponse({ status: 201, type: EntradaBitacoraRespuestaDto })
  escribir(
    @Param('practicaId', ParseUUIDPipe) practicaId: string,
    @Body() dto: EscribirBitacoraDto,
    @ActorActual() actor: Actor,
  ): Promise<EntradaBitacoraRespuestaDto> {
    return this.bitacora.escribir(practicaId, dto, actor);
  }

  @Get('cierre')
  @Roles(Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Condiciones de cierre: documentos, «Evalúa tu proceso» y calificación' })
  @ApiResponse({ status: 200, type: EstadoCierreDto })
  estadoCierre(
    @Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor,
  ): Promise<EstadoCierreDto> {
    return this.bitacora.estadoCierre(practicaId, actor);
  }

  @Post('cierre')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Cerrar el proceso cuando las tres condiciones ya se cumplen' })
  cerrar(
    @Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor,
  ): Promise<RespuestaCierre> {
    return this.bitacora.cerrar(practicaId, actor);
  }
}
