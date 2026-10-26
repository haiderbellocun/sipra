import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CrearVacanteDto, ResultadoAntidiscriminacionDto, ValidarTextoVacanteDto, VacanteRespuestaDto,
} from '../../application/dtos/vacante.dto';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  GestionarVacanteUseCase,
} from '../../application/use-cases/vacantes/gestionar-vacante.use-case';
import { EstadoVacante, MarcoVacante } from '../../domain/entities/vacante.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Autenticado, Roles } from '../auth/roles.decorator';

/**
 * M7 — Bolsa de empleo.
 *
 * Nota de operación: el módulo queda CONSTRUIDO pero no debe activarse
 * públicamente sin el acto administrativo de modificación de la autorización
 * ante la Unidad del Servicio Público de Empleo (sección 3.1). El marco
 * `practica` no constituye intermediación laboral y no entra en el reporte.
 */
@ApiTags('Bolsa de empleo')
@ApiBearerAuth()
@Controller('bolsa')
export class BolsaController {
  constructor(private readonly gestionar: GestionarVacanteUseCase) {}

  @Post('vacantes/validar-texto')
  @Autenticado()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Filtro antidiscriminación sobre un texto',
    description:
      'Valida en vivo mientras la empresa redacta. Bloquea edad, sexo, fotografía, raza, ' +
      'religión, origen, estado civil y apariencia (Ley 931 de 2004 y concordantes).',
  })
  @ApiResponse({ status: 200, type: ResultadoAntidiscriminacionDto })
  validarTexto(@Body() dto: ValidarTextoVacanteDto): ResultadoAntidiscriminacionDto {
    return this.gestionar.validarTexto(dto.texto);
  }

  @Get('vacantes')
  @Autenticado()
  @ApiOperation({ summary: 'Listar vacantes según el perfil' })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoVacante })
  @ApiQuery({ name: 'marco', required: false, enum: MarcoVacante })
  @ApiResponse({ status: 200, type: [VacanteRespuestaDto] })
  listar(
    @ActorActual() actor: Actor,
    @Query('estado') estado?: EstadoVacante,
    @Query('marco') marco?: MarcoVacante,
  ): Promise<VacanteRespuestaDto[]> {
    return this.gestionar.listar({ estado, marco }, actor);
  }

  @Post('vacantes')
  @Roles(Rol.EMPRESA)
  @ApiOperation({
    summary: 'Crear una vacante en borrador',
    description:
      'Solo una empresa habilitada publica. La empresa ya superó la verificación documental ' +
      'construida para prácticas: NIT validado, RUES, certificado de existencia y aprobación humana.',
  })
  @ApiResponse({ status: 201, type: VacanteRespuestaDto })
  crear(@Body() dto: CrearVacanteDto, @ActorActual() actor: Actor): Promise<VacanteRespuestaDto> {
    return this.gestionar.crear(dto, actor);
  }

  @Post('vacantes/:id/publicar')
  @HttpCode(200)
  @Roles(Rol.EMPRESA, Rol.EXTENSION, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Publicar una vacante',
    description:
      'El filtro antidiscriminación es un bloqueo, no una advertencia. Cada bloqueo queda en ' +
      'la auditoría como evidencia de la validación aplicada.',
  })
  @ApiResponse({ status: 200, type: VacanteRespuestaDto })
  @ApiResponse({ status: 400, description: 'Contenido mínimo incompleto o requisitos discriminatorios' })
  publicar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<VacanteRespuestaDto> {
    return this.gestionar.publicar(id, actor);
  }
}
