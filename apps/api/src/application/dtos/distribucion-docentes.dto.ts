import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Códigos reales: «2026C», «26P05», «26V06» (la columna admite 12). La existencia la verifica el caso de uso. */
const PERIODO = /^[0-9A-Za-z-]{2,12}$/;

export class AplicarDistribucionDto {
  @ApiProperty({ example: '2026C' }) @IsString() @Matches(PERIODO, { message: 'Periodo académico inválido' }) periodoAcademico!: string;
  @ApiPropertyOptional({ description: 'Una escuela concreta; ausente = todas las escuelas del alcance del actor.' })
  @IsOptional() @IsString() @MaxLength(60) escuelaId?: string;
  @ApiProperty({ description: 'Huella devuelta por la vista previa: si los datos cambiaron, 409.' })
  @IsString() @MaxLength(128) huella!: string;
}

export class FilaDocenteDistribucionDto {
  @ApiProperty() id!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty({ type: [String] }) escuelas!: string[];
  @ApiProperty() actual!: number;
  @ApiProperty() nuevos!: number;
  @ApiProperty() final!: number;
}

export class NoAsignablesDto {
  @ApiProperty() escuelaId!: string;
  @ApiProperty() cantidad!: number;
  @ApiProperty() motivo!: string;
}

export class DocenteExcluidoDto {
  @ApiProperty() id!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() motivo!: string;
}

export class VistaPreviaDistribucionDto {
  @ApiProperty() periodoAcademico!: string;
  @ApiProperty() periodoActivo!: boolean;
  @ApiProperty({ type: [String], nullable: true, description: 'null = todas las escuelas (alcance institucional)' })
  escuelas!: string[] | null;
  @ApiProperty() pendientes!: number;
  @ApiProperty() asignables!: number;
  @ApiProperty() sinDocenteCompatible!: number;
  @ApiProperty({ type: [FilaDocenteDistribucionDto] }) docentes!: FilaDocenteDistribucionDto[];
  @ApiProperty({ type: [NoAsignablesDto] }) noAsignables!: NoAsignablesDto[];
  @ApiProperty({ type: [DocenteExcluidoDto] }) docentesExcluidos!: DocenteExcluidoDto[];
  @ApiProperty() huella!: string;
  @ApiProperty() puedeAplicar!: boolean;
  @ApiProperty({ nullable: true }) motivoNoAplicable!: string | null;
}

export class ResultadoDistribucionDto {
  @ApiProperty() periodoAcademico!: string;
  @ApiProperty() asignados!: number;
  @ApiProperty() docentes!: number;
  @ApiProperty() sinDocenteCompatible!: number;
}
