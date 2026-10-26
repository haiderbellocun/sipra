import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AcuseSolicitudDto, DecisionEmpresaDto, EmpresaRespuestaDto, NitVerificadoDto,
  SolicitudEmpresaDto, VerificarNitDto,
} from '../../application/dtos/empresa.dto';
import {
  GestionarEmpresaUseCase,
} from '../../application/use-cases/empresas/gestionar-empresa.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { EstadoEmpresa } from '../../domain/entities/empresa.entity';
import { Nit } from '../../domain/value-objects/nit.vo';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Publico, Roles } from '../auth/roles.decorator';

@ApiTags('Empresas')
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly gestionar: GestionarEmpresaUseCase) {}

  @Publico()
  @Post('solicitudes')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Formulario público de solicitud de habilitación',
    description:
      'Única superficie expuesta a internet sin autenticación. Realiza una sola operación: ' +
      'insertar una solicitud. La respuesta es idéntica en todos los casos, incluso cuando el ' +
      'NIT ya está registrado: confirmarlo convertiría el formulario en un verificador público ' +
      'de qué empresas trabajan con la institución.',
  })
  @ApiResponse({ status: 202, type: AcuseSolicitudDto })
  async solicitar(@Body() dto: SolicitudEmpresaDto): Promise<AcuseSolicitudDto> {
    await this.gestionar.registrarSolicitud(dto);
    return {
      resultado: 'recibida',
      mensaje:
        'Recibimos su solicitud. Si cumple los requisitos, la Dirección de Operaciones se ' +
        'comunicará al correo registrado.',
    };
  }

  @Publico()
  @Post('nit/verificar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Calcular el dígito de verificación del NIT',
    description: 'Algoritmo DIAN. Ejemplo: 901458772 → 2. Capa 0, determinística.',
  })
  @ApiResponse({ status: 200, type: NitVerificadoDto })
  verificarNit(@Body() dto: VerificarNitDto): NitVerificadoDto {
    const nit = Nit.crear(dto.numero);
    return {
      numero: nit.numero,
      digitoVerificacion: nit.digitoVerificacion,
      formateado: nit.formateado,
    };
  }

  @ApiBearerAuth()
  @Get()
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION, Rol.EMPRESA)
  @ApiOperation({
    summary: 'Bandeja de empresas con semáforo de pre-verificación',
    description:
      'Administración, coordinación y extensión ven la bandeja; una empresa solo la suya. ' +
      'Estudiantes, docentes y auxiliares reciben los datos básicos de la empresa de su práctica ' +
      'dentro del expediente, no por aquí.',
  })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoEmpresa })
  @ApiResponse({ status: 200, type: [EmpresaRespuestaDto] })
  listar(
    @ActorActual() actor: Actor,
    @Query('estado') estado?: EstadoEmpresa,
  ): Promise<EmpresaRespuestaDto[]> {
    return this.gestionar.listar(estado, actor);
  }

  @ApiBearerAuth()
  @Get(':id')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION, Rol.EMPRESA)
  @ApiOperation({ summary: 'Detalle de una empresa' })
  obtener(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<EmpresaRespuestaDto> {
    return this.gestionar.obtener(id, actor);
  }

  @ApiBearerAuth()
  @Patch(':id/decision')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Habilitar, rechazar, pedir información o suspender una empresa',
    description:
      'La pre-verificación automática alimenta el semáforo; la decisión es humana y exige ' +
      'justificación, que queda en la auditoría inmutable.',
  })
  @ApiResponse({ status: 200, type: EmpresaRespuestaDto })
  decidir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionEmpresaDto,
    @ActorActual() actor: Actor,
  ): Promise<EmpresaRespuestaDto> {
    return this.gestionar.decidir(id, dto, actor);
  }
}
