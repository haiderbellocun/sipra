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
import {
  AplicarDistribucionDto, ResultadoDistribucionDto, VistaPreviaDistribucionDto,
} from '../../application/dtos/distribucion-docentes.dto';
import { DistribucionDocentesUseCase } from '../../application/use-cases/practicas/distribucion-docentes.use-case';
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
    private readonly distribucion: DistribucionDocentesUseCase,
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

  @Get('distribucion-docentes')
  @Roles(Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({
    summary: 'G6 · Vista previa de la distribución de estudiantes por docente facilitador (sin escrituras)',
    description:
      'Siempre sobre un periodo. Reparte solo prácticas no terminales SIN docente, entre docentes activos con permiso de ' +
      'escritura y alcance en la escuela de cada práctica, «menos cargado primero» contando la carga que ya tienen en el ' +
      'periodo. Determinística. Devuelve carga actual, nuevos y final por docente, no asignables y la huella para aplicar.',
  })
  @ApiQuery({ name: 'periodo', required: true })
  @ApiQuery({ name: 'escuela', required: false, description: 'Una escuela; ausente = todas las del alcance' })
  @ApiResponse({ status: 200, type: VistaPreviaDistribucionDto })
  previsualizarDistribucion(
    @ActorActual() actor: Actor,
    @Query('periodo') periodo: string,
    @Query('escuela') escuela?: string,
  ): Promise<VistaPreviaDistribucionDto> {
    return this.distribucion.previsualizar(periodo, escuela || undefined, actor);
  }

  @Post('distribucion-docentes')
  @Roles(Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({
    summary: 'G6 · Aplicar la distribución (transaccional; 409 si cambió desde la vista previa)',
    description:
      'Recalcula con datos frescos y exige la huella de la vista previa. Asigna en una transacción, solo donde `tutor_id` ' +
      'sigue vacío; las asignaciones existentes no se modifican. Auditoría de lote y por práctica, y nota en la bitácora.',
  })
  @ApiResponse({ status: 201, type: ResultadoDistribucionDto })
  @ApiResponse({ status: 409, description: 'Las asignaciones cambiaron desde la vista previa' })
  aplicarDistribucion(
    @Body() dto: AplicarDistribucionDto,
    @ActorActual() actor: Actor,
  ): Promise<ResultadoDistribucionDto> {
    return this.distribucion.aplicar(dto, actor);
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
  @Roles(Rol.COORDINADOR, Rol.ANALISTA)
  @ApiOperation({
    summary: 'G6 · Asignar docente facilitador (manual)',
    description:
      'Solo coordinación y analista. El docente debe existir, ser docente facilitador, estar activo, tener permiso de escritura ' +
      'y la escuela de la práctica en su alcance. Reemplazar un docente ya asignado exige justificación. Auditado.',
  })
  asignarTutor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarTutorDto,
    @ActorActual() actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    return this.gestionar.asignarTutor(id, dto.tutorId, actor, dto.justificacion);
  }
}
