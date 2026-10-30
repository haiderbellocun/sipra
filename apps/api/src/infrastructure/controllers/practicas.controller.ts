import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { CorregirDatosPracticaDto, CorreccionDatosPracticaRespuestaDto } from '../../application/dtos/acta-iniciacion.dto';
import {
  ActualizarVacanteDto, AsignarTutorDto, CrearPracticaDto, PracticaRespuestaDto, RegistrarArlDto,
  RegistrarHorasDto, RegistrarPracticaDto, TransicionPracticaDto,
} from '../../application/dtos/practica.dto';
import {
  Actor, GestionarPracticaUseCase,
} from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  RegistrarPracticaUseCase,
} from '../../application/use-cases/practicas/registrar-practica.use-case';
import { EstadoPractica } from '../../domain/entities/practica.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Autenticado, Roles } from '../auth/roles.decorator';
import { AuditoriaService } from '../modules/auditoria.service';

@ApiTags('Prácticas')
@ApiBearerAuth()
@Controller('practicas')
export class PracticasController {
  constructor(
    private readonly gestionar: GestionarPracticaUseCase,
    private readonly registrar: RegistrarPracticaUseCase,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  @Autenticado()
  @ApiOperation({
    summary: 'Listar prácticas dentro del alcance del actor',
    description:
      'El alcance se aplica acotando la consulta en el servidor, no filtrando resultados. Un ' +
      'estudiante solo obtiene su expediente; una empresa, los de sus practicantes.',
  })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoPractica })
  @ApiQuery({ name: 'periodo', required: false, example: '2026C' })
  @ApiQuery({ name: 'programa', required: false })
  @ApiQuery({ name: 'regional', required: false })
  @ApiQuery({ name: 'modalidad', required: false })
  @ApiQuery({ name: 'nivel', required: false, description: 'tecnico | tecnologo | profesional' })
  @ApiQuery({ name: 'asignacion', required: false, description: 'asignado | sin_asignacion' })
  @ApiQuery({ name: 'busqueda', required: false, description: 'Documento, correo o nombre del estudiante' })
  @ApiQuery({ name: 'movimientoDesde', required: false })
  @ApiQuery({ name: 'movimientoHasta', required: false })
  @ApiQuery({ name: 'cargadoMinimo', required: false, description: '% mínimo de documentos cargados' })
  @ApiQuery({ name: 'aprobadoMinimo', required: false, description: '% mínimo de documentos aprobados' })
  @ApiQuery({ name: 'cantidad', required: false, description: 'Máximo de registros (por defecto 200)' })
  @ApiResponse({ status: 200, type: [PracticaRespuestaDto] })
  async listar(
    @ActorActual() actor: Actor,
    @Query('estado') estado?: EstadoPractica,
    @Query('periodo') periodo?: string,
    @Query('programa') programa?: string,
    @Query('regional') regional?: string,
    @Query('modalidad') modalidad?: string,
    @Query('nivel') nivel?: string,
    @Query('asignacion') asignacion?: string,
    @Query('busqueda') busqueda?: string,
    @Query('movimientoDesde') movimientoDesde?: string,
    @Query('movimientoHasta') movimientoHasta?: string,
    @Query('cargadoMinimo') cargadoMinimo?: string,
    @Query('aprobadoMinimo') aprobadoMinimo?: string,
    @Query('cantidad') cantidad?: string,
  ): Promise<PracticaRespuestaDto[]> {
    await this.auditoria.verificarUsoAnomalo(actor.id, actor.correo);
    const numero = (v?: string) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
    return this.gestionar.listar(
      {
        estados: estado ? [estado] : undefined,
        periodoAcademico: periodo,
        programaId: programa,
        regional,
        modalidad,
        ciclo: nivel,
        conTutor: asignacion === 'asignado' ? true : asignacion === 'sin_asignacion' ? false : undefined,
        busqueda,
        movimientoDesde: movimientoDesde ? new Date(movimientoDesde) : undefined,
        movimientoHasta: movimientoHasta ? new Date(movimientoHasta) : undefined,
        porcentajeCargadoMinimo: numero(cargadoMinimo),
        porcentajeAprobadoMinimo: numero(aprobadoMinimo),
        limite: Math.min(numero(cantidad) ?? 200, 1000),
      },
      actor,
    );
  }

  @Post('registro')
  @Roles(Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Formulario Único de Registro (FUR)',
    description:
      'Un registro por estudiante y periodo, solo dentro de la ventana de registro. Los datos ' +
      'básicos vienen de SINU. La modalidad y las fechas no se modifican después. Coordinación ' +
      'registra excepciones indicando el documento del estudiante.',
  })
  @ApiResponse({ status: 201, type: PracticaRespuestaDto })
  @ApiResponse({ status: 409, description: 'Ya existe un registro para el periodo' })
  registrarFur(@Body() dto: RegistrarPracticaDto, @ActorActual() actor: Actor): Promise<PracticaRespuestaDto> {
    return this.registrar.registrar(dto, actor);
  }

  @Patch(':id/vacante')
  @Roles(Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR)
  @ApiOperation({
    summary: 'Actualizar los datos de la vacante',
    description: 'Solo los campos habilitados por el SGP: área, cargo, salario, horario, jefe inmediato, ' +
      'ciudad y funciones. La modalidad y las fechas no se tocan por aquí.',
  })
  @ApiResponse({ status: 200, type: PracticaRespuestaDto })
  actualizarVacante(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarVacanteDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.actualizarVacante(id, dto, actor);
  }

  @Patch(':id/datos-gobernantes')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Corregir la remuneración y/o quién asume la ARL (con acta de iniciación cargada o no)',
    description:
      'Solo coordinación y administración, con justificación y auditoría (valor anterior, nuevo, actor y motivo). No modifica el ' +
      'acta ni una decisión ya tomada: si la validación está sin decidir, su comparación se recalcula en una ronda nueva; si ya ' +
      'estaba decidida, solo queda constancia de que los datos cambiaron después. Con un acta cargada, la edición común de la ' +
      'vacante ya no admite estos dos campos.',
  })
  @ApiResponse({ status: 200, description: 'Datos vigentes y qué pasó con la comparación del acta' })
  corregirDatosGobernantes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorregirDatosPracticaDto,
    @ActorActual() actor: Actor,
  ): Promise<CorreccionDatosPracticaRespuestaDto> {
    return this.gestionar.corregirDatosGobernantes(id, dto, actor);
  }

  @Get(':id')
  @Autenticado()
  @ApiOperation({ summary: 'Obtener un expediente de práctica' })
  @ApiResponse({ status: 200, type: PracticaRespuestaDto })
  @ApiResponse({ status: 404, description: 'Expediente no encontrado o fuera del alcance' })
  obtener(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.obtener(id, actor);
  }

  @Post()
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
  @ApiOperation({
    summary: 'Crear una práctica',
    description: 'Al crearse, el motor de obligaciones genera automáticamente sus obligaciones normativas.',
  })
  @ApiResponse({ status: 201, type: PracticaRespuestaDto })
  crear(@Body() dto: CrearPracticaDto, @ActorActual() actor: Actor): Promise<PracticaRespuestaDto> {
    return this.gestionar.crear(dto, actor);
  }

  @Patch(':id/estado')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR)
  @ApiOperation({
    summary: 'Cambiar el estado de la práctica',
    description:
      'El paso de `en_validacion` a `activa` está bloqueado por la compuerta de afiliación a ' +
      'ARL (Decreto 055 de 2015). Ninguna configuración permite omitirla.',
  })
  @ApiResponse({ status: 200, type: PracticaRespuestaDto })
  @ApiResponse({ status: 400, description: 'Transición no permitida o compuerta ARL no superada' })
  transicionar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransicionPracticaDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.transicionar(id, dto.destino, dto.justificacion, actor);
  }

  @Patch(':id/arl')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
  @ApiOperation({
    summary: 'Registrar la afiliación a ARL',
    description:
      'La CUN afilia y paga; el riesgo no es la falsificación sino la omisión. La fecha debe ' +
      'ser anterior al inicio de la práctica, no el mismo día.',
  })
  @ApiResponse({ status: 200, type: PracticaRespuestaDto })
  registrarArl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarArlDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.registrarArl(
      id, new Date(dto.fechaAfiliacion), dto.documentoId ?? null, actor,
    );
  }

  @Patch(':id/horas')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.TUTOR)
  @ApiOperation({ summary: 'Registrar las horas al cierre de la práctica' })
  registrarHoras(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarHorasDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.registrarHoras(id, dto.horas, actor);
  }

  @Patch(':id/tutor')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
  @ApiOperation({ summary: 'Asignar tutor académico' })
  asignarTutor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarTutorDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.asignarTutor(id, dto.tutorId, actor);
  }
}
