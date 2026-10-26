import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import {
  EstadoPostulacion, EstadoVacante, MarcoVacante,
} from '../../domain/entities/vacante.entity';

export class CrearVacanteDto {
  @ApiProperty({ enum: MarcoVacante }) @IsEnum(MarcoVacante) marco!: MarcoVacante;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(200) titulo!: string;
  @ApiProperty() @IsString() @MinLength(20) descripcion!: string;
  @ApiProperty() @IsString() @MinLength(10) funciones!: string;
  @ApiProperty() @IsString() @MinLength(10) requisitos!: string;
  @ApiProperty({ description: 'Código CNO/CIUO-08 A.C. Catálogo obligatorio, sin texto libre.' })
  @IsString() @MaxLength(10) codigoCno!: string;
  @ApiProperty({ description: 'Código CIIU Rev. 4 A.C.' })
  @IsString() @MaxLength(10) codigoCiiu!: string;
  @ApiProperty({ description: 'Código DIVIPOLA del municipio.' })
  @IsString() @MaxLength(10) divipolaMunicipio!: string;
  @ApiProperty({ description: 'Nivel educativo de la lista tasada.' })
  @IsString() @MaxLength(60) nivelEducativo!: string;
  @ApiProperty() @IsInt() @Min(1) vacantesDisponibles!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) salarioMinimo?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) salarioMaximo?: number;
}

export class ValidarTextoVacanteDto {
  @ApiProperty() @IsString() texto!: string;
}

export class HallazgoDto {
  @ApiProperty() categoria!: string;
  @ApiProperty() fragmento!: string;
  @ApiProperty() norma!: string;
}

export class ResultadoAntidiscriminacionDto {
  @ApiProperty() publicable!: boolean;
  @ApiProperty({ type: [HallazgoDto] }) hallazgos!: HallazgoDto[];
}

export class CambiarEstadoPostulacionDto {
  @ApiProperty({ enum: EstadoPostulacion }) @IsEnum(EstadoPostulacion) estado!: EstadoPostulacion;
  @ApiPropertyOptional() @IsOptional() @IsString() observacion?: string;
}

export class VacanteRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty() empresaId!: string;
  @ApiProperty({ nullable: true }) empresaRazonSocial!: string | null;
  @ApiProperty({ enum: MarcoVacante }) marco!: MarcoVacante;
  @ApiProperty() titulo!: string;
  @ApiProperty() descripcion!: string;
  @ApiProperty() funciones!: string;
  @ApiProperty() requisitos!: string;
  @ApiProperty() codigoCno!: string;
  @ApiProperty() codigoCiiu!: string;
  @ApiProperty() divipolaMunicipio!: string;
  @ApiProperty() nivelEducativo!: string;
  @ApiProperty() vacantesDisponibles!: number;
  @ApiProperty({ enum: EstadoVacante }) estado!: EstadoVacante;
  @ApiProperty({ nullable: true }) publicadaEn!: string | null;
  @ApiProperty({ nullable: true }) vigenteHasta!: string | null;
}
