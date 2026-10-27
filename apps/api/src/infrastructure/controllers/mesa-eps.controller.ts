import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { DocumentoRespuestaDto } from '../../application/dtos/documento.dto';
import {
  DecisionMesaDto, DetalleMesaDto, ListadoMesaDto, ResultadoTomarSiguienteDto, SupervisionMesaDto, TomarSiguienteDto,
} from '../../application/dtos/mesa-eps.dto';
import { MesaEpsUseCase } from '../../application/use-cases/documentos/mesa-eps.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

const MIME_VISIBLES = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Mesa operativa de EPS: bandeja, detalle, visor del certificado, «tomar siguiente»,
 * decisión y supervisión. Auxiliar, coordinación y administración; docente,
 * estudiante, empresa y extensión no entran. La Mesa MUESTRA la recomendación del
 * sistema; la decisión final es siempre de una persona.
 */
@ApiTags('Mesa de EPS')
@ApiBearerAuth()
@Controller('mesa-eps')
export class MesaEpsController {
  constructor(private readonly mesa: MesaEpsUseCase) {}

  @Get()
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Bandeja de la Mesa de EPS con KPIs, filtros y prioridad',
    description:
      'Casos abiertos de la versión vigente de cada certificado, ordenados por una prioridad con reglas explicables ' +
      '(antigüedad, inicio de la práctica, reenvío, discrepancia crítica, ADRES pendiente). Estudiante reducido.',
  })
  @ApiQuery({ name: 'estadoAdres', required: false })
  @ApiQuery({ name: 'autenticidad', required: false })
  @ApiQuery({ name: 'afiliacion', required: false })
  @ApiQuery({ name: 'recomendacion', required: false })
  @ApiQuery({ name: 'responsable', required: false, enum: ['yo', 'sin_asignar', 'otros'] })
  @ApiQuery({ name: 'conDiscrepancias', required: false, enum: ['si', 'no'] })
  @ApiQuery({ name: 'buscar', required: false, description: 'Nombre del estudiante o documento exacto.' })
  @ApiResponse({ status: 200, type: ListadoMesaDto })
  listar(@Query() q: Record<string, string | undefined>, @ActorActual() actor: Actor): Promise<ListadoMesaDto> {
    return this.mesa.listar(actor, q);
  }

  @Get('supervision')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Carga por funcionario, reservas y tiempos (coordinación y administración)' })
  @ApiResponse({ status: 200, type: SupervisionMesaDto })
  supervision(@ActorActual() actor: Actor): Promise<SupervisionMesaDto> {
    return this.mesa.supervision(actor);
  }

  @Post('siguiente')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tomar el siguiente caso disponible',
    description:
      'Elige y reserva el caso de mayor prioridad en una sola sentencia atómica: dos personas que lo piden a la vez ' +
      'reciben casos distintos; si no hay casos, responde «sin_casos».',
  })
  @ApiResponse({ status: 200, type: ResultadoTomarSiguienteDto })
  siguiente(@Body() dto: TomarSiguienteDto, @ActorActual() actor: Actor): Promise<ResultadoTomarSiguienteDto> {
    return this.mesa.tomarSiguiente(actor, dto);
  }

  @Get(':id')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Detalle del caso: certificado, autenticidad, afiliación, comparación triple, discrepancias, recomendación e historial',
    description: 'Los datos personales solo se devuelven a quien tiene el caso tomado, a coordinación/administración o a quien lo decidió.',
  })
  @ApiResponse({ status: 200, type: DetalleMesaDto })
  detalle(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<DetalleMesaDto> {
    return this.mesa.detalle(id, actor);
  }

  @Get(':id/certificado')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Contenido del certificado para el visor',
    description:
      'Se sirve por la sesión autenticada (cabecera Authorization): no hay enlace firmado ni credencial en la URL. Revalida ' +
      'rol, alcance y que el caso esté tomado. La apertura queda auditada.',
  })
  async certificado(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
  ): Promise<void> {
    const { contenido, mime, nombre } = await this.mesa.certificado(id, actor);
    await respuesta
      .header('content-type', MIME_VISIBLES.includes(mime) ? mime : 'application/octet-stream')
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `inline; filename="${nombre.replace(/[^\w.\- ]/g, '_')}"`)
      .send(contenido);
  }

  @Post(':id/decision')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Aprobar, devolver o rechazar el certificado desde la Mesa',
    description:
      'Exige tener el caso reservado (se revalida aquí), que sea la versión vigente y, si se aparta de la recomendación del sistema, ' +
      'una justificación reforzada. Devolver exige un motivo del catálogo. Reutiliza la decisión de documentos (conflictos 409).',
  })
  @ApiResponse({ status: 200, type: DocumentoRespuestaDto })
  decidir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionMesaDto,
    @ActorActual() actor: Actor,
  ): Promise<DocumentoRespuestaDto> {
    return this.mesa.decidir(id, actor, dto);
  }
}
