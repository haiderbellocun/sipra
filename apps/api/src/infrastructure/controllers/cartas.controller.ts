import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { FastifyReply } from 'fastify';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  CartaPresentacionUseCase, CartaRespuesta,
} from '../../application/use-cases/practicas/carta-presentacion.use-case';
import { ActorActual } from '../auth/actor.decorator';

export class SolicitarCartaDto {
  @ApiProperty({ example: '2026C' }) @IsString() @MaxLength(12) periodoAcademico!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() practicaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) empresaRazonSocial?: string;
  @ApiPropertyOptional({ description: 'Solo perfiles internos: documento del estudiante.' })
  @IsOptional() @IsString() @MaxLength(30) estudianteDocumento?: string;
}

@ApiTags('Cartas de presentación')
@ApiBearerAuth()
@Controller('cartas-presentacion')
export class CartasController {
  constructor(private readonly cartas: CartaPresentacionUseCase) {}

  @Post()
  @ApiOperation({
    summary: 'Generar una carta de presentación',
    description:
      'Paso 1 del proceso del estudiante en el SGP. El estudiante solo dentro de la ventana del ' +
      'periodo; el docente y coordinación en cualquier momento, ubicando al estudiante por documento.',
  })
  generar(@Body() dto: SolicitarCartaDto, @ActorActual() actor: Actor): Promise<CartaRespuesta> {
    return this.cartas.generar(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'Cartas generadas (reporte de cartas)' })
  @ApiQuery({ name: 'periodo', required: false })
  listar(@ActorActual() actor: Actor, @Query('periodo') periodo?: string): Promise<CartaRespuesta[]> {
    return this.cartas.listar({ periodoAcademico: periodo }, actor);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Descargar la carta en PDF (reimpresión idéntica)' })
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
  ): Promise<void> {
    const { nombreArchivo, contenido } = await this.cartas.pdf(id, actor);
    await respuesta
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${nombreArchivo}"`)
      .header('Cache-Control', 'private, no-store')
      .send(contenido);
  }
}
