import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import {
  FilaMatriculaSinu, ResumenSincronizacion, VistaEstudianteSinu, VistasSinuUseCase,
} from '../../application/use-cases/administracion/vistas-sinu.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

export class SincronizarDocentesDto {
  @ApiProperty({ example: '2026C' }) @IsString() @MaxLength(12) periodoAcademico!: string;
}

@ApiTags('Vistas SINU')
@ApiBearerAuth()
@Controller('vistas')
export class VistasController {
  constructor(private readonly vistas: VistasSinuUseCase) {}

  @Get('sinu/estudiante')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR, Rol.TUTOR)
  @ApiOperation({ summary: 'Consulta: el estudiante en SINU y en SGP, con su correspondencia' })
  @ApiQuery({ name: 'documento', required: true })
  estudiante(@ActorActual() actor: Actor, @Query('documento') documento?: string): Promise<VistaEstudianteSinu> {
    if (!documento) throw new BadRequestException('Indique el número de documento');
    return this.vistas.consultarEstudiante(documento, actor);
  }

  @Get('sinu/matriculas')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR, Rol.TUTOR)
  @ApiOperation({ summary: 'Matrículas de práctica del periodo en SINU y si ya registraron en SGP' })
  @ApiQuery({ name: 'periodo', required: true })
  matriculas(@ActorActual() actor: Actor, @Query('periodo') periodo?: string): Promise<FilaMatriculaSinu[]> {
    if (!periodo) throw new BadRequestException('Indique el periodo académico');
    return this.vistas.listarMatriculas(periodo, actor);
  }

  @Post('sincronizar-docentes')
  @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Sincronizador prácticas–docente: refleja la asignación de SINU en las prácticas del periodo' })
  sincronizar(@Body() dto: SincronizarDocentesDto, @ActorActual() actor: Actor): Promise<ResumenSincronizacion> {
    return this.vistas.sincronizarDocentes(dto.periodoAcademico, actor);
  }
}
