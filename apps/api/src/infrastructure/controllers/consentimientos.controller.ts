import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import {
  ConsentimientoRespuestaDto, PoliticaVigenteDto, PublicarPoliticaDto, RegistrarConsentimientoDto,
  ResultadoConsentimientoDto,
} from '../../application/dtos/consentimiento.dto';
import { ConsentimientoUseCase } from '../../application/use-cases/consentimientos/consentimiento.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { TipoConsentimiento } from '../../domain/entities/consentimiento.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Autenticado, Roles } from '../auth/roles.decorator';

class ConsultaPoliticaDto {
  @IsEnum(TipoConsentimiento) tipo!: TipoConsentimiento;
}

/**
 * Consentimiento de tratamiento de datos. La persona que acepta es SIEMPRE la
 * de la sesión: ningún endpoint recibe un usuario en el cuerpo.
 */
@ApiTags('Consentimientos')
@ApiBearerAuth()
@Controller('consentimientos')
export class ConsentimientosController {
  constructor(private readonly consentimientos: ConsentimientoUseCase) {}

  @Get('politica-vigente')
  @Autenticado()
  @ApiOperation({ summary: 'Política vigente de un tipo de consentimiento' })
  @ApiQuery({ name: 'tipo', enum: TipoConsentimiento })
  @ApiResponse({ status: 200, type: PoliticaVigenteDto })
  @ApiResponse({ status: 404, description: 'No hay política vigente publicada' })
  politicaVigente(@Query() consulta: ConsultaPoliticaDto): Promise<PoliticaVigenteDto> {
    return this.consentimientos.politicaVigente(consulta.tipo);
  }

  @Post()
  @Autenticado()
  @ApiOperation({
    summary: 'Aceptar o revocar un consentimiento',
    description:
      'Registra un evento append-only a nombre de la persona de la sesión. Aceptar exige la ' +
      'versión vigente (409 en otro caso). Un evento idéntico al último no se duplica.',
  })
  @ApiResponse({ status: 201, type: ResultadoConsentimientoDto })
  @ApiResponse({ status: 409, description: 'La versión no es la vigente' })
  registrar(
    @Body() dto: RegistrarConsentimientoDto,
    @ActorActual() actor: Actor,
  ): Promise<ResultadoConsentimientoDto> {
    // La IP y el agente ya vienen en el actor: los fija el guard de sesión.
    return this.consentimientos.registrar(dto, actor);
  }

  @Get('mios')
  @Autenticado()
  @ApiOperation({ summary: 'Mi historial de consentimientos' })
  @ApiResponse({ status: 200, type: [ConsentimientoRespuestaDto] })
  mios(@ActorActual() actor: Actor): Promise<ConsentimientoRespuestaDto[]> {
    return this.consentimientos.misConsentimientos(actor);
  }

  @Get('usuarios/:usuarioId')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
  @ApiOperation({
    summary: 'Historial de consentimientos de una persona',
    description: 'Consulta puntual para administración y el Área de Prácticas; no existe búsqueda masiva.',
  })
  @ApiResponse({ status: 200, type: [ConsentimientoRespuestaDto] })
  deUsuario(
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
    @ActorActual() actor: Actor,
  ): Promise<ConsentimientoRespuestaDto[]> {
    return this.consentimientos.consultarDeUsuario(usuarioId, actor);
  }

  @Post('politicas')
  @Roles(Rol.ADMINISTRADOR)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Publicar una versión de política',
    description:
      'El texto lo aporta el responsable institucional. Una versión publicada no se edita: ' +
      'cambiar el texto es publicar otra versión, que retira la anterior.',
  })
  @ApiResponse({ status: 201, type: PoliticaVigenteDto })
  publicarPolitica(@Body() dto: PublicarPoliticaDto, @ActorActual() actor: Actor): Promise<PoliticaVigenteDto> {
    return this.consentimientos.publicarPolitica(dto, actor);
  }
}
