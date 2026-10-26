import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ActualizarPeriodo, CrearPeriodo, GestionarPeriodosUseCase, PeriodoRespuesta, VentanaDto,
} from '../../application/use-cases/administracion/gestionar-periodos.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { ModalidadPractica } from '../../domain/entities/modalidad.entity';
import { CalendarioPeriodo, TipoVentana } from '../../domain/entities/periodo.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

export class CrearPeriodoDto implements CrearPeriodo {
  @ApiProperty({ example: '2027A' }) @IsString() @MaxLength(12) codigo!: string;
  @ApiProperty() @IsString() @MaxLength(120) nombre!: string;
  @ApiProperty({ enum: ['presencial', 'virtual', '335'] }) @IsIn(['presencial', 'virtual', '335']) calendario!: CalendarioPeriodo;
  @ApiProperty() @IsDateString() fechaInicio!: string;
  @ApiProperty() @IsDateString() fechaFin!: string;
  @ApiPropertyOptional({ description: 'Último día para registrar y solicitar la ARL; por defecto dos meses después del inicio' })
  @IsOptional() @IsDateString() cierreFur?: string;
  @ApiPropertyOptional({ description: 'Fecha de cargue de documentos finales; por defecto dos semanas antes del cierre' })
  @IsOptional() @IsDateString() fechaCargueDocumentos?: string;
  @ApiPropertyOptional({ type: [String], description: 'Jornadas de inducción; por defecto la segunda semana' })
  @IsOptional() @IsArray() @IsDateString({}, { each: true }) jornadasInduccion?: string[];
}

export class ActualizarPeriodoDto implements ActualizarPeriodo {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  @ApiPropertyOptional({ description: 'Ventanas por tipo: {desde, hasta} o null para cerrarla' })
  @IsOptional() @IsObject() ventanas?: Partial<Record<TipoVentana, VentanaDto | null>>;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsDateString({}, { each: true }) jornadasInduccion?: string[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() fechaCargueDocumentos?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sincronizacionDocentes?: boolean;
  @ApiPropertyOptional({ enum: ModalidadPractica, isArray: true }) @IsOptional() modalidadesHabilitadas?: ModalidadPractica[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
}

@ApiTags('Periodos académicos')
@ApiBearerAuth()
@Controller('periodos')
export class PeriodosController {
  constructor(private readonly periodos: GestionarPeriodosUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Periodos con sus ventanas y su estado actual' })
  listar(): Promise<PeriodoRespuesta[]> {
    return this.periodos.listar();
  }

  @Get(':codigo')
  obtener(@Param('codigo') codigo: string): Promise<PeriodoRespuesta> {
    return this.periodos.obtener(codigo);
  }

  @Post()
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
  @ApiOperation({ summary: 'Crear un periodo con las ventanas habituales' })
  crear(@Body() dto: CrearPeriodoDto, @ActorActual() actor: Actor): Promise<PeriodoRespuesta> {
    return this.periodos.crear(dto, actor);
  }

  @Patch(':codigo')
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
  @ApiOperation({ summary: 'Gestión de periodos: ventanas, modalidades ofertadas, sincronización, estado' })
  actualizar(
    @Param('codigo') codigo: string, @Body() dto: ActualizarPeriodoDto, @ActorActual() actor: Actor,
  ): Promise<PeriodoRespuesta> {
    return this.periodos.actualizar(codigo, dto, actor);
  }
}
