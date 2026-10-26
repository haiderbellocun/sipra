import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  ConsolidadoArl, DecidirSolicitudArlDto, RadicarSolicitudArlDto, SolicitudArlRespuestaDto,
} from '../../application/dtos/solicitud-arl.dto';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { SolicitudArlUseCase } from '../../application/use-cases/practicas/solicitud-arl.use-case';
import { EstadoSolicitudArl } from '../../domain/entities/solicitud-arl.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Solicitudes de ARL')
@ApiBearerAuth()
@Controller('solicitudes-arl')
export class SolicitudesArlController {
  constructor(private readonly solicitudes: SolicitudArlUseCase) {}

  @Post()
  @Roles(Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR)
  @ApiOperation({
    summary: 'Radicar la solicitud de afiliación a ARL (prácticas articuladas)',
    description:
      'Toma los soportes ya cargados en el expediente (EPS, identificación y acta o RUT/Cámara), ' +
      'ejecuta la validación automática del manual del portal y deja la recomendación para el auxiliar.',
  })
  @ApiResponse({ status: 201, type: SolicitudArlRespuestaDto })
  radicar(@Body() dto: RadicarSolicitudArlDto, @ActorActual() actor: Actor): Promise<SolicitudArlRespuestaDto> {
    return this.solicitudes.radicar(dto, actor);
  }

  @Get()
  @Roles(Rol.ESTUDIANTE, Rol.AUXILIAR, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Bandeja de solicitudes (el estudiante ve las suyas)' })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoSolicitudArl })
  @ApiQuery({ name: 'periodo', required: false })
  @ApiResponse({ status: 200, type: [SolicitudArlRespuestaDto] })
  listar(
    @ActorActual() actor: Actor,
    @Query('estado') estado?: EstadoSolicitudArl,
    @Query('periodo') periodo?: string,
  ): Promise<SolicitudArlRespuestaDto[]> {
    return this.solicitudes.listar({ estado, periodoAcademico: periodo }, actor);
  }

  @Get('consolidado')
  @Roles(Rol.AUXILIAR, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Consolidado diario: aprobadas para Capital Social, rechazadas y certificados' })
  @ApiQuery({ name: 'fecha', required: false, description: 'AAAA-MM-DD; por defecto hoy' })
  consolidado(@ActorActual() actor: Actor, @Query('fecha') fecha?: string): Promise<ConsolidadoArl> {
    const dia = fecha ? new Date(`${fecha}T00:00:00.000Z`) : new Date();
    if (Number.isNaN(dia.getTime())) throw new BadRequestException('Fecha no válida');
    return this.solicitudes.consolidado(dia, actor);
  }

  @Get(':id')
  @Roles(Rol.ESTUDIANTE, Rol.AUXILIAR, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiResponse({ status: 200, type: SolicitudArlRespuestaDto })
  obtener(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<SolicitudArlRespuestaDto> {
    return this.solicitudes.obtener(id, actor);
  }

  @Patch(':id/decision')
  @Roles(Rol.AUXILIAR, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Aprobar o rechazar la solicitud (con motivos del catálogo)' })
  decidir(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecidirSolicitudArlDto, @ActorActual() actor: Actor,
  ): Promise<SolicitudArlRespuestaDto> {
    return this.solicitudes.decidir(id, dto, actor);
  }

  @Post(':id/certificado')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Remitir el certificado de ARL',
    description: 'Queda en el expediente como documento aprobado, registra la afiliación y avisa al estudiante.',
  })
  @ApiBody({
    schema: {
      type: 'object', required: ['archivo', 'fechaAfiliacion'],
      properties: {
        archivo: { type: 'string', format: 'binary' },
        fechaAfiliacion: { type: 'string', format: 'date', description: 'Inicio de cobertura (anterior al inicio de la práctica)' },
      },
    },
  })
  async certificado(
    @Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @ActorActual() actor: Actor,
  ): Promise<SolicitudArlRespuestaDto> {
    let archivo: { nombreOriginal: string; contenido: Buffer } | null = null;
    let fechaAfiliacion: Date | null = null;
    for await (const parte of request.parts()) {
      if (parte.type === 'file') {
        archivo = { nombreOriginal: parte.filename ?? 'certificado-arl.pdf', contenido: await parte.toBuffer() };
      } else if (parte.fieldname === 'fechaAfiliacion' && typeof parte.value === 'string') {
        fechaAfiliacion = new Date(`${parte.value.slice(0, 10)}T00:00:00.000Z`);
      }
    }
    if (!archivo) throw new BadRequestException('No se recibió el certificado');
    if (!fechaAfiliacion || Number.isNaN(fechaAfiliacion.getTime())) {
      throw new BadRequestException('Indique la fecha de afiliación');
    }
    return this.solicitudes.enviarCertificado(id, archivo, fechaAfiliacion, actor);
  }

  @Patch(':id/anular')
  @Roles(Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR)
  @ApiOperation({ summary: 'Anular una solicitud radicada y sin decisión' })
  anular(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<SolicitudArlRespuestaDto> {
    return this.solicitudes.anular(id, actor);
  }
}
