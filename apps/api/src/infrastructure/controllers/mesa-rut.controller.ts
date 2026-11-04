import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { DocumentoRespuestaDto } from '../../application/dtos/documento.dto';
import {
  DecisionRutDto, DetalleRutDto, EstadoRutEstudianteDto, ListadoBandejaRutDto, ReservaRutDto, ResultadoTomarSiguienteRutDto,
  SupervisionRutDto, TomarSiguienteRutDto,
} from '../../application/dtos/rut-mesa.dto';
import { MesaRutUseCase } from '../../application/use-cases/documentos/mesa-rut.use-case';
import { RutEstudianteUseCase } from '../../application/use-cases/documentos/rut-estudiante.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { MotivoDevolucionRutCatalogo } from '../../domain/services/mesa-rut.domain-service';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

const MIME_VISIBLES = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Mesa de RUT: bandeja, detalle, reserva, decisión, supervisión y visor del archivo. Operan docente (tutor), coordinación y
 * administración —quienes ya deciden el RUT—; auxiliar, empresa y extensión no entran. El estudiante solo ve el estado humano de
 * SU RUT. La Mesa MUESTRA la recomendación del sistema; la decisión final es siempre de una persona.
 */
@ApiTags('Mesa de RUT')
@ApiBearerAuth()
@Controller('mesa-rut')
export class MesaRutController {
  constructor(private readonly mesa: MesaRutUseCase, private readonly estudiante: RutEstudianteUseCase) {}

  @Get()
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Bandeja de RUT en revisión (versión vigente) con KPIs, filtros y prioridad',
    description: 'Prioridad explicable (documento incorrecto, discrepancia, persona distinta, lectura dudosa, reenvío, antigüedad); sin IA. Solo supervisión puede pedir otros estados con `estado=`.',
  })
  @ApiQuery({ name: 'estado', required: false, description: 'Solo supervisión. Estados separados por coma.' })
  @ApiQuery({ name: 'tipoPersona', required: false, enum: ['natural', 'juridica'] })
  @ApiQuery({ name: 'conDiscrepancias', required: false, enum: ['si', 'no'] })
  @ApiQuery({ name: 'documentoIncorrecto', required: false, enum: ['si'] })
  @ApiQuery({ name: 'lecturaDudosa', required: false, enum: ['si'] })
  @ApiQuery({ name: 'reenvio', required: false, enum: ['si'] })
  @ApiQuery({ name: 'reserva', required: false, enum: ['libres', 'mias', 'otros', 'vencidas'] })
  @ApiQuery({ name: 'antiguedadMinDias', required: false })
  @ApiQuery({ name: 'prioridadMinima', required: false })
  @ApiQuery({ name: 'buscar', required: false, description: 'Nombre del estudiante.' })
  @ApiResponse({ status: 200, description: 'KPIs e ítems de la bandeja' })
  listar(@Query() q: Record<string, string | undefined>, @ActorActual() actor: Actor): Promise<ListadoBandejaRutDto> {
    return this.mesa.listar(actor, q);
  }

  @Get('supervision')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Casos libres, tomados, por vencer y vencidos; carga por funcionario; por estado' })
  @ApiResponse({ status: 200, description: 'Resumen de supervisión' })
  supervision(@ActorActual() actor: Actor): Promise<SupervisionRutDto> {
    return this.mesa.supervision(actor);
  }

  @Post('tomar-siguiente')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tomar el siguiente caso disponible',
    description: 'Reserva el libre de mayor prioridad con una sentencia atómica por caso: dos personas a la vez reciben casos distintos.',
  })
  @ApiResponse({ status: 200, description: '«tomado» con el id de la validación, o «sin_casos»' })
  siguiente(@Body() dto: TomarSiguienteRutDto, @ActorActual() actor: Actor): Promise<ResultadoTomarSiguienteRutDto> {
    return this.mesa.tomarSiguiente(actor, dto);
  }

  @Get('motivos-devolucion')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Motivos de devolución permitidos para un RUT, con lo que leerá el estudiante',
    description: 'Fuente única del catálogo: código, título, mensaje al estudiante, si exige detalle y a qué RUT aplica.',
  })
  @ApiResponse({ status: 200, description: 'Catálogo de motivos' })
  motivos(@ActorActual() actor: Actor): MotivoDevolucionRutCatalogo[] {
    return this.mesa.motivosDevolucion(actor);
  }

  @Get('practica/:practicaId/estado')
  @Roles(Rol.ESTUDIANTE)
  @ApiOperation({
    summary: 'Estado de MI RUT, en lenguaje humano (qué ocurrió y qué hacer)',
    description: 'Solo la práctica propia. Sin nombres internos de estado, códigos de discrepancia, confianza ni detalle del OCR.',
  })
  @ApiResponse({ status: 200, description: 'Estado humano del RUT' })
  estadoDeMiRut(@Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor): Promise<EstadoRutEstudianteDto> {
    return this.estudiante.estado(practicaId, actor);
  }

  @Get(':id')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Detalle: tabla SIPRA | RUT | RESULTADO, lectura, QR, versiones e historial',
    description:
      'Recalcula la comparación de un caso abierto con la lectura ya guardada (sin releer el PDF). El documento de identidad completo ' +
      'solo se devuelve a quien tiene el caso tomado, a supervisión o a quien lo decidió. La autenticidad no se verifica.',
  })
  @ApiResponse({ status: 200, description: 'Detalle del caso' })
  detalle(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<DetalleRutDto> {
    return this.mesa.detalle(id, actor);
  }

  @Get(':id/archivo')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Contenido del RUT para el visor',
    description: 'Se sirve por la sesión autenticada (cabecera Authorization): sin enlace firmado ni credencial en la URL. La apertura queda auditada.',
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
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reservar el caso (15 minutos). Si otra persona ya lo tiene: 409.' })
  @ApiResponse({ status: 200, description: 'Reserva vigente' })
  tomar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<ReservaRutDto> {
    return this.mesa.tomar(id, actor);
  }

  @Post(':id/liberar')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Liberar la reserva propia; coordinación y administración pueden liberar la de otra persona.' })
  @ApiResponse({ status: 200, description: 'Caso libre' })
  liberar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<ReservaRutDto> {
    return this.mesa.liberar(id, actor);
  }

  @Post(':id/decision')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Aprobar, devolver o rechazar el RUT desde la Mesa',
    description:
      'Exige el caso reservado por quien decide, versión vigente y RUT listo para revisión (409 si no). Aprobar lo que el sistema no ve ' +
      'consistente, o rechazar lo que sí, exige al menos 40 caracteres de justificación; devolver exige un motivo del catálogo (con ' +
      '«otro», texto); rechazar exige justificación. Una sola decisión aplica; las demás reciben 409.',
  })
  @ApiResponse({ status: 200, type: DocumentoRespuestaDto })
  decidir(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionRutDto, @ActorActual() actor: Actor): Promise<DocumentoRespuestaDto> {
    return this.mesa.decidir(id, actor, dto);
  }
}
