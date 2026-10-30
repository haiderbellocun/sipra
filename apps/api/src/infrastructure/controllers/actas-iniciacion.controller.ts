import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  DecisionActaDto, DetalleActaDto, EstadoActaEstudianteDto, ListadoBandejaActaDto, ReservaActaDto, ResultadoTomarSiguienteActaDto,
  SupervisionActaDto, TomarSiguienteActaDto,
} from '../../application/dtos/acta-iniciacion.dto';
import { DocumentoRespuestaDto } from '../../application/dtos/documento.dto';
import { ActaEstudianteUseCase } from '../../application/use-cases/documentos/acta-estudiante.use-case';
import { MesaActasUseCase } from '../../application/use-cases/documentos/mesa-actas.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { MotivoDevolucionActaCatalogo } from '../../domain/services/mesa-acta.domain-service';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

const MIME_VISIBLES = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Mesa de Actas de Iniciación: bandeja, detalle, reserva, decisión, supervisión y visor del archivo. Auxiliar, coordinación y
 * administración operan; docente, empresa y extensión no entran. El estudiante solo ve el estado humano de SU acta. La Mesa
 * MUESTRA la recomendación del sistema; la decisión final es siempre de una persona. Independiente de la Mesa de EPS.
 */
@ApiTags('Mesa de Actas de Iniciación')
@ApiBearerAuth()
@Controller('actas-iniciacion')
export class ActasIniciacionController {
  constructor(private readonly mesa: MesaActasUseCase, private readonly estudiante: ActaEstudianteUseCase) {}

  @Get()
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Bandeja de actas en revisión (versión vigente) con KPIs, filtros y prioridad',
    description:
      'Prioridad explicable (documento incorrecto, discrepancia crítica, firma faltante, reenvío, antigüedad, inicio cercano); ' +
      'sin IA. Solo supervisión puede pedir otros estados con `estado=`.',
  })
  @ApiQuery({ name: 'estado', required: false, description: 'Solo supervisión. Estados separados por coma.' })
  @ApiQuery({ name: 'remuneracion', required: false, enum: ['remunerada', 'no_remunerada', 'no_determinable'] })
  @ApiQuery({ name: 'responsableArl', required: false, enum: ['empresa', 'cun', 'no_determinable'] })
  @ApiQuery({ name: 'conDiscrepancias', required: false, enum: ['si', 'no'] })
  @ApiQuery({ name: 'documentoIncorrecto', required: false, enum: ['si'] })
  @ApiQuery({ name: 'firmas', required: false, enum: ['faltantes', 'no_determinables', 'completas'] })
  @ApiQuery({ name: 'reenvio', required: false, enum: ['si'] })
  @ApiQuery({ name: 'reserva', required: false, enum: ['libres', 'mias', 'otros', 'vencidas'] })
  @ApiQuery({ name: 'antiguedadMinDias', required: false })
  @ApiQuery({ name: 'prioridadMinima', required: false })
  @ApiQuery({ name: 'buscar', required: false, description: 'Nombre del estudiante.' })
  @ApiResponse({ status: 200, description: 'KPIs e ítems de la bandeja' })
  listar(@Query() q: Record<string, string | undefined>, @ActorActual() actor: Actor): Promise<ListadoBandejaActaDto> {
    return this.mesa.listar(actor, q);
  }

  @Get('supervision')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Casos libres, tomados, por vencer y vencidos; carga por funcionario; por estado y por discrepancia' })
  @ApiResponse({ status: 200, description: 'Resumen de supervisión' })
  supervision(@ActorActual() actor: Actor): Promise<SupervisionActaDto> {
    return this.mesa.supervision(actor);
  }

  @Post('tomar-siguiente')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tomar el siguiente caso disponible',
    description: 'Reserva el libre de mayor prioridad con una sentencia atómica por caso: dos personas a la vez reciben casos distintos.',
  })
  @ApiResponse({ status: 200, description: '«tomado» con el id de la validación, o «sin_casos»' })
  siguiente(@Body() dto: TomarSiguienteActaDto, @ActorActual() actor: Actor): Promise<ResultadoTomarSiguienteActaDto> {
    return this.mesa.tomarSiguiente(actor, dto);
  }

  @Get('motivos-devolucion')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Motivos de devolución permitidos para un Acta, con lo que leerá el estudiante',
    description: 'Fuente única del catálogo: código, título, mensaje al estudiante y si exige detalle. La pantalla no mantiene una copia.',
  })
  @ApiResponse({ status: 200, description: 'Catálogo de motivos' })
  motivos(@ActorActual() actor: Actor): MotivoDevolucionActaCatalogo[] {
    return this.mesa.motivosDevolucion(actor);
  }

  @Get('practica/:practicaId/estado')
  @Roles(Rol.ESTUDIANTE)
  @ApiOperation({
    summary: 'Estado de MI acta, en lenguaje humano (qué ocurrió y qué hacer)',
    description: 'Solo la práctica propia. Sin nombres internos de estado ni códigos de discrepancia.',
  })
  @ApiResponse({ status: 200, description: 'Estado humano del acta' })
  estadoDeMiActa(@Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor): Promise<EstadoActaEstudianteDto> {
    return this.estudiante.estado(practicaId, actor);
  }

  @Get(':id')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Detalle: estudiante, práctica, resumen del acta, comparación SIPRA ↔ Acta, versiones e historial de la versión',
    description: 'El documento de identidad completo solo se devuelve a quien tiene el caso tomado, a supervisión o a quien lo decidió.',
  })
  @ApiResponse({ status: 200, description: 'Detalle del caso' })
  detalle(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<DetalleActaDto> {
    return this.mesa.detalle(id, actor);
  }

  @Get(':id/archivo')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Contenido del acta para el visor',
    description: 'Se sirve por la sesión autenticada (cabecera Authorization): no hay enlace firmado ni credencial en la URL. La apertura queda auditada.',
  })
  async archivo(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor, @Res() respuesta: FastifyReply): Promise<void> {
    const { contenido, mime, nombre } = await this.mesa.archivo(id, actor);
    await respuesta
      .header('content-type', MIME_VISIBLES.includes(mime) ? mime : 'application/octet-stream')
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `inline; filename="${nombre.replace(/[^\w.\- ]/g, '_')}"`)
      .send(contenido);
  }

  @Post(':id/tomar')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reservar el caso (15 minutos). Si otra persona ya lo tiene: 409.' })
  @ApiResponse({ status: 200, description: 'Reserva vigente' })
  tomar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<ReservaActaDto> {
    return this.mesa.tomar(id, actor);
  }

  @Post(':id/liberar')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Liberar la reserva propia; coordinación y administración pueden liberar la de otra persona.' })
  @ApiResponse({ status: 200, description: 'Caso libre' })
  liberar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<ReservaActaDto> {
    return this.mesa.liberar(id, actor);
  }

  @Post(':id/decision')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Aprobar, devolver o rechazar el acta desde la Mesa',
    description:
      'Exige el caso reservado por quien decide, versión vigente y acta lista para revisión (409 si no). Aprobar contra la ' +
      'recomendación (p. ej. con una discrepancia crítica) exige al menos 40 caracteres de justificación; devolver exige un motivo ' +
      'del catálogo (con «otro», texto); rechazar exige justificación. Una sola decisión aplica; las demás reciben 409.',
  })
  @ApiResponse({ status: 200, type: DocumentoRespuestaDto })
  decidir(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionActaDto, @ActorActual() actor: Actor): Promise<DocumentoRespuestaDto> {
    return this.mesa.decidir(id, actor, dto);
  }
}
