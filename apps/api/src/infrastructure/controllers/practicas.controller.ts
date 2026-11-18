import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import {
  AsignarTutorDto, CambiarEstadoOperativoDto, CrearPracticaDto, ModificarPracticaDto, PracticaRespuestaDto, RegistrarArlDto,
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
  @Roles(Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ANALISTA, Rol.ADMINISTRADOR)
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

  @Patch(':id/datos')
  @Roles(Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({
    summary: 'G5 · Modificar una práctica registrada (coordinación y analista)',
    description:
      'Única edición posterior al registro. Lista cerrada de campos (vacante, remuneración, responsable de la ARL y modalidad), ' +
      'justificación obligatoria y control optimista con `actualizadaEn` (409 si la práctica cambió). Un solo evento de ' +
      'auditoría con los cambios (de → a). El cambio de modalidad reconcilia las obligaciones sin borrar nada y no infiere el ' +
      'responsable de la ARL. Con un acta de iniciación cargada, la comparación se recalcula o queda constancia. ' +
      'Administración y dirección NO modifican prácticas.',
  })
  @ApiResponse({ status: 200, type: PracticaRespuestaDto })
  @ApiResponse({ status: 409, description: 'La práctica cambió mientras se editaba' })
  modificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificarPracticaDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.modificarPractica(id, dto, actor);
  }

  @Patch(':id/estado-operativo')
  @Roles(Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({
    summary: 'G5 · Cambiar el estado operativo (Inscrito, En práctica, Anulado, Reprobado, Cerrado)',
    description:
      'Solo coordinación y analista, con justificación. Sin atajos: usa la máquina de estados (responsable y compuerta ARL, ' +
      'obligaciones) y, para «Cerrado», el flujo de cierre (condiciones y nota aprobatoria). «Inscrito» no admite retroceso.',
  })
  @ApiResponse({ status: 200, type: PracticaRespuestaDto })
  @ApiResponse({ status: 400, description: 'Destino bloqueado, con el motivo en lenguaje operativo' })
  cambiarEstadoOperativo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoOperativoDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.cambiarEstadoOperativo(id, dto, actor);
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
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({
    summary: 'Crear una práctica',
    description: 'Al crearse, el motor de obligaciones genera automáticamente sus obligaciones normativas.',
  })
  @ApiResponse({ status: 201, type: PracticaRespuestaDto })
  crear(@Body() dto: CrearPracticaDto, @ActorActual() actor: Actor): Promise<PracticaRespuestaDto> {
    return this.gestionar.crear(dto, actor);
  }

  @Patch(':id/estado')
  @Roles(Rol.COORDINADOR, Rol.ANALISTA)
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
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ANALISTA)
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
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.TUTOR)
  @ApiOperation({ summary: 'Registrar las horas al cierre de la práctica' })
  registrarHoras(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarHorasDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.registrarHoras(id, dto.horas, actor);
  }

  @Patch(':id/tutor')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({ summary: 'Asignar tutor académico' })
  asignarTutor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarTutorDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.asignarTutor(id, dto.tutorId, actor);
  }
}
