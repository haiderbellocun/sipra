import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  CartaPresentacionUseCase, CartaPublica, CartaRespuesta, ROLES_ANULAN_CARTA, ROLES_CONSULTAN_CARTA, ROLES_EMITEN_CARTA,
  VerificacionCarta, VistaPreviaCarta,
} from '../../application/use-cases/practicas/carta-presentacion.use-case';
import { ActorActual } from '../auth/actor.decorator';
import { Publico, Roles } from '../auth/roles.decorator';
import { LimitadorPublicoService } from '../seguridad/limitador-publico.service';

export class SolicitarCartaDto {
  @ApiProperty({ example: '2026C' }) @IsString() @Matches(/^[0-9A-Za-z-]{2,12}$/) periodoAcademico!: string;
  @ApiPropertyOptional({ description: 'Carta ligada a una práctica registrada del estudiante en el periodo.' })
  @IsOptional() @IsUUID() practicaId?: string;
  @ApiPropertyOptional({ enum: ['generica', 'empresa'], description: '«empresa» exige una organización vinculada a la práctica.' })
  @IsOptional() @IsIn(['generica', 'empresa']) destinatario?: 'generica' | 'empresa';
  @ApiPropertyOptional({ description: 'Solo carta genérica sin práctica: modalidad ofertada en el periodo.' })
  @IsOptional() @IsString() @MaxLength(40) modalidad?: string;
  @ApiPropertyOptional({ description: 'Solo perfiles internos: documento del estudiante.' })
  @IsOptional() @IsString() @MaxLength(30) estudianteDocumento?: string;
}

export class ConsultarCartaPublicaDto {
  @ApiProperty({ description: 'Número de identificación del estudiante (único dato de búsqueda; coincidencia exacta).' })
  @IsString() @MaxLength(40) documento!: string;
}

export class AnularCartaDto {
  @ApiProperty() @IsString() @MaxLength(1000) motivo!: string;
}

@ApiTags('Cartas de presentación')
@ApiBearerAuth()
@Controller('cartas-presentacion')
export class CartasController {
  constructor(private readonly cartas: CartaPresentacionUseCase) {}

  @Post('vista-previa')
  @Roles(...ROLES_EMITEN_CARTA)
  @ApiOperation({ summary: 'Vista previa de la carta (sin emitir): datos, texto, bloqueos y advertencias' })
  previsualizar(@Body() dto: SolicitarCartaDto, @ActorActual() actor: Actor): Promise<VistaPreviaCarta> {
    return this.cartas.previsualizar(dto, actor);
  }

  @Post()
  @Roles(...ROLES_EMITEN_CARTA)
  @ApiOperation({
    summary: 'Emitir la carta de presentación (PDF institucional con referencia y QR)',
    description:
      'El estudiante, la suya y dentro de la ventana del periodo; docente, auxiliar, coordinación y analista, en su alcance. ' +
      'Los datos salen de SIPRA/SINU; el PDF emitido se guarda con su SHA-256 y reemplaza la carta vigente equivalente.',
  })
  generar(@Body() dto: SolicitarCartaDto, @ActorActual() actor: Actor): Promise<CartaRespuesta> {
    return this.cartas.generar(dto, actor);
  }

  @Get()
  @Roles(...ROLES_CONSULTAN_CARTA)
  @ApiOperation({ summary: 'Cartas emitidas (historial y reporte de cartas), según el alcance' })
  @ApiQuery({ name: 'periodo', required: false })
  listar(@ActorActual() actor: Actor, @Query('periodo') periodo?: string): Promise<CartaRespuesta[]> {
    return this.cartas.listar({ periodoAcademico: periodo }, actor);
  }

  @Get(':id/pdf')
  @Roles(...ROLES_CONSULTAN_CARTA)
  @ApiOperation({ summary: 'Descargar la carta emitida (el mismo PDF, verificado por SHA-256)' })
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

  @Patch(':id/anular')
  @Roles(...ROLES_ANULAN_CARTA)
  @ApiOperation({ summary: 'Anular una carta emitida (coordinación y analista, con motivo). No se borra.' })
  anular(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AnularCartaDto, @ActorActual() actor: Actor): Promise<CartaRespuesta> {
    return this.cartas.anular(id, dto.motivo, actor);
  }
}

/** Verificación pública de cartas (el QR apunta a la web, que consulta aquí). Solo datos mínimos. */
@ApiTags('Cartas de presentación')
@Controller('verificacion-cartas')
export class VerificacionCartasController {
  constructor(private readonly cartas: CartaPresentacionUseCase, private readonly limitador: LimitadorPublicoService) {}

  @Get(':referencia')
  @Publico()
  @ApiOperation({
    summary: 'Verificar una carta de presentación por su referencia (público)',
    description: 'Devuelve solo: estado, estudiante, documento enmascarado, programa, nivel, modalidad y fecha de expedición.',
  })
  verificar(@Param('referencia') referencia: string, @Req() solicitud: FastifyRequest): Promise<VerificacionCarta> {
    this.limitador.exigir('verificacion', solicitud.ip);
    return this.cartas.verificar(referencia);
  }
}

/**
 * Consulta y descarga PÚBLICAS de la carta vigente por número de identificación (requerimiento funcional: la empresa
 * no necesita cuenta). La identificación viaja en el CUERPO de un POST (no en la URL); la descarga exige el token
 * firmado y temporal que devuelve la consulta. Límite de solicitudes por IP y pausa tras consultas sin resultado.
 */
@ApiTags('Cartas de presentación')
@Controller('cartas-presentacion/publica')
export class CartasPublicasController {
  constructor(private readonly cartas: CartaPresentacionUseCase, private readonly limitador: LimitadorPublicoService) {}

  @Post('consultar')
  @Publico()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Consultar la carta vigente por número de identificación (público)',
    description:
      'Coincidencia exacta. Devuelve solo cartas VIGENTES con datos mínimos y un token de descarga de 10 minutos. ' +
      'Sin resultado (o estudiante inexistente, o solo cartas anuladas/reemplazadas): el mismo mensaje genérico.',
  })
  async consultar(@Body() dto: ConsultarCartaPublicaDto, @Req() solicitud: FastifyRequest): Promise<{ cartas: CartaPublica[]; mensaje: string | null }> {
    const ip = solicitud.ip;
    this.limitador.verificarSinContar('fallidas', ip);
    this.limitador.exigir('consulta_minuto', ip);
    this.limitador.exigir('consulta_hora', ip);
    try {
      const r = await this.cartas.consultarPublica(dto.documento, { ip });
      if (r.cartas.length === 0) this.limitador.contar('fallidas', ip);
      return r;
    } catch (error) {
      this.limitador.contar('fallidas', ip); // identificaciones inválidas también cuentan para la pausa
      throw error;
    }
  }

  @Get('descargar')
  @Publico()
  @ApiOperation({ summary: 'Descargar la carta vigente con el token de la consulta (público)' })
  @ApiQuery({ name: 'token', required: true })
  async descargar(@Query('token') token: string, @Req() solicitud: FastifyRequest, @Res() respuesta: FastifyReply): Promise<void> {
    this.limitador.exigir('descarga', solicitud.ip);
    const { nombreArchivo, contenido } = await this.cartas.descargarPublica(token, { ip: solicitud.ip });
    await respuesta
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${nombreArchivo}"`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Robots-Tag', 'noindex')
      .send(contenido);
  }
}
