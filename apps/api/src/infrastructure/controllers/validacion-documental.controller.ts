import { Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  DocumentoDeExpediente, ExpedienteDto, ListadoExpedientesDto, SupervisionDocumentalDto, VersionDocumentoDto,
} from '../../application/dtos/expediente-documental.dto';
import { ExpedienteDocumentalUseCase } from '../../application/use-cases/documentos/expediente-documental.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { TipoDocumento } from '../../domain/entities/documento.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

/**
 * Mesa de Validación Documental: orquestación por ESTUDIANTE + PRÁCTICA. Solo CONSULTA y normaliza: no valida, no reserva y no
 * decide. Para ver el resultado de un motor (comparación, visor, evidencia), tomar o decidir se usan los endpoints del propio motor
 * (`/mesa-eps`, `/validaciones-eps`, `/actas-iniciacion`, `/mesa-rut`, `/mesa-camara`) con el `validacionId` que trae cada documento.
 */
@ApiTags('Validación documental')
@ApiBearerAuth()
@Controller('validacion-documental')
export class ValidacionDocumentalController {
  constructor(private readonly expedientes: ExpedienteDocumentalUseCase) {}

  @Get()
  @Roles(Rol.TUTOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Cola por expediente (estudiante + práctica) con progreso, indicadores y quién trabaja cada documento',
    description:
      'Cada fila es un expediente. Las obligaciones salen de la modalidad; solo la versión vigente de cada documento es operable. ' +
      'Orden: reenvíos, críticos, información insuficiente, más antiguos y el resto. Respeta el alcance del rol; el auxiliar solo ve sus tipos de documento.',
  })
  @ApiQuery({ name: 'vista', required: false, enum: ['todos', 'pendientes', 'problemas', 'mis_documentos', 'por_vencer'] })
  @ApiQuery({ name: 'escuela', required: false })
  @ApiQuery({ name: 'modalidad', required: false })
  @ApiQuery({ name: 'buscar', required: false, description: 'Nombre del estudiante o su documento exacto.' })
  @ApiQuery({ name: 'estado', required: false, enum: ['abiertos', 'completos'] })
  @ApiQuery({ name: 'conPendientes', required: false, enum: ['si'] })
  @ApiQuery({ name: 'conDiscrepancias', required: false, enum: ['si'] })
  @ApiQuery({ name: 'conDevueltos', required: false, enum: ['si'] })
  @ApiQuery({ name: 'ocr', required: false, enum: ['si'] })
  @ApiQuery({ name: 'reserva', required: false, enum: ['mias', 'libres'] })
  @ApiQuery({ name: 'antiguedadMinDias', required: false })
  @ApiResponse({ status: 200, description: 'KPIs y expedientes' })
  listar(@Query() q: Record<string, string | undefined>, @ActorActual() actor: Actor): Promise<ListadoExpedientesDto> {
    return this.expedientes.listar(actor, q);
  }

  @Get('supervision')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Vista agregada: expedientes abiertos, documentos por revisar, aprobados hoy, devueltos, reservas y carga por funcionario' })
  @ApiResponse({ status: 200, description: 'Resumen de supervisión' })
  supervision(@ActorActual() actor: Actor): Promise<SupervisionDocumentalDto> {
    return this.expedientes.supervision(actor);
  }

  @Get(':practicaId')
  @Roles(Rol.TUTOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Expediente: encabezado, progreso y los metadatos de todos los documentos (sin PDF ni resultados pesados)',
    description: 'Cada documento trae su motor, su estado humano común, su reserva por documento y `validacionId` para usar el endpoint del motor.',
  })
  @ApiResponse({ status: 200, description: 'Expediente' })
  expediente(@Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor): Promise<ExpedienteDto> {
    return this.expedientes.expediente(practicaId, actor);
  }

  @Get(':practicaId/documentos')
  @Roles(Rol.TUTOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Lista de documentos del expediente (contrato normalizado)' })
  @ApiResponse({ status: 200, description: 'Documentos' })
  async documentos(@Param('practicaId', ParseUUIDPipe) practicaId: string, @ActorActual() actor: Actor): Promise<DocumentoDeExpediente[]> {
    return (await this.expedientes.expediente(practicaId, actor)).documentos;
  }

  @Get(':practicaId/documentos/:tipo/versiones')
  @Roles(Rol.TUTOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Versiones anteriores de un documento (históricas), bajo demanda' })
  @ApiResponse({ status: 200, description: 'Versiones, la vigente primero' })
  versiones(
    @Param('practicaId', ParseUUIDPipe) practicaId: string, @Param('tipo', new ParseEnumPipe(TipoDocumento)) tipo: TipoDocumento, @ActorActual() actor: Actor,
  ): Promise<VersionDocumentoDto[]> {
    return this.expedientes.versiones(practicaId, tipo, actor);
  }
}
