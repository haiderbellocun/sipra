import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PqrsRespuesta, PqrsUseCase, RadicarPqrs } from '../../application/use-cases/administracion/pqrs.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { CATEGORIAS_PQRS, CategoriaPqrs, EstadoPqrs, TIPOS_PQRS, TipoPqrs } from '../../domain/entities/pqrs.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

export class RadicarPqrsDto implements RadicarPqrs {
  @ApiProperty({ enum: TIPOS_PQRS }) @IsIn([...TIPOS_PQRS]) tipo!: TipoPqrs;
  @ApiProperty({ enum: CATEGORIAS_PQRS }) @IsIn([...CATEGORIAS_PQRS]) categoria!: CategoriaPqrs;
  @ApiProperty({ example: 'No puedo cargar la EPS' }) @IsString() @MinLength(5) @MaxLength(160) asunto!: string;
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(4000) descripcion!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() practicaId?: string | null;
}

export class ResponderPqrsDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(4000) respuesta!: string;
}

/**
 * PQRS de Desarrollo Profesional: el estudiante radica y consulta las suyas;
 * el Área de Prácticas, los auxiliares y administración atienden la bandeja.
 */
@ApiTags('PQRS')
@ApiBearerAuth()
@Controller('pqrs')
export class PqrsController {
  constructor(private readonly pqrs: PqrsUseCase) {}

  @Post()
  @Roles(Rol.ESTUDIANTE)
  @ApiOperation({ summary: 'Radicar una PQRS (si hay otra abierta en la misma categoría, se unifica con ella)' })
  radicar(@Body() dto: RadicarPqrsDto, @ActorActual() actor: Actor): Promise<PqrsRespuesta> {
    return this.pqrs.radicar(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'Mis solicitudes (estudiante) o bandeja completa (quien atiende)' })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoPqrs })
  @ApiQuery({ name: 'categoria', required: false, enum: CATEGORIAS_PQRS })
  listar(
    @ActorActual() actor: Actor,
    @Query('estado') estado?: EstadoPqrs,
    @Query('categoria') categoria?: CategoriaPqrs,
  ): Promise<PqrsRespuesta[]> {
    return this.pqrs.listar({ estado, categoria }, actor);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<PqrsRespuesta> {
    return this.pqrs.obtener(id, actor);
  }

  @Patch(':id/tomar')
  @Roles(Rol.COORDINADOR, Rol.AUXILIAR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Marcar la solicitud en trámite' })
  tomar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<PqrsRespuesta> {
    return this.pqrs.tomar(id, actor);
  }

  @Patch(':id/responder')
  @Roles(Rol.COORDINADOR, Rol.AUXILIAR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Responder en el radicado (se notifica al estudiante)' })
  responder(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResponderPqrsDto, @ActorActual() actor: Actor,
  ): Promise<PqrsRespuesta> {
    return this.pqrs.responder(id, dto.respuesta, actor);
  }

  @Patch(':id/cerrar')
  @ApiOperation({ summary: 'Cerrar una solicitud ya respondida' })
  cerrar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<PqrsRespuesta> {
    return this.pqrs.cerrar(id, actor);
  }
}
