import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional,
  IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import {
  AutorBitacora, MODALIDADES_VISITA, ModalidadVisita, PREGUNTAS_EVALUA_TU_PROCESO, TipoEntradaBitacora,
} from '../../domain/entities/bitacora.entity';
import { TipoDocumento } from '../../domain/entities/documento.entity';
import { EstadoPractica } from '../../domain/entities/practica.entity';

export class SeguimientoDto {
  @ApiProperty({ description: 'Fecha y hora de la visita (ISO 8601)' }) @IsDateString() fechaVisita!: string;
  @ApiProperty({ enum: MODALIDADES_VISITA }) @IsIn([...MODALIDADES_VISITA]) modalidadVisita!: ModalidadVisita;
  @ApiProperty() @IsString() @MaxLength(160) contactoNombre!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactoCargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contactoArea?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) sugerenciasPlanMejoramiento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) evaluacionJefeInmediato?: string;
}

export class EvaluacionFinalDto {
  @ApiProperty() @IsString() @MaxLength(4000) desempeno!: string;
  @ApiProperty() @IsString() @MaxLength(4000) satisfaccionEmpresa!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) retroalimentacionPlanMejoramiento?: string;
}

export class RespuestaEvaluaDto {
  @ApiProperty({ description: 'Índice de la pregunta (0 a 3)' }) @IsInt() @Min(0) @Max(3) pregunta!: number;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) valor!: number;
}

export class EvaluaTuProcesoDto {
  @ApiProperty({ type: [RespuestaEvaluaDto] })
  @IsArray() @ArrayMinSize(PREGUNTAS_EVALUA_TU_PROCESO.length) @ArrayMaxSize(PREGUNTAS_EVALUA_TU_PROCESO.length)
  @ValidateNested({ each: true }) @Type(() => RespuestaEvaluaDto)
  respuestas!: RespuestaEvaluaDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comentario?: string;
}

export class CalificacionDto {
  @ApiProperty({ minimum: 0, maximum: 5, example: 4.5, description: 'Un decimal; aprueba desde 3,0' })
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(5) nota!: number;
}

export class SubsanacionDto {
  @ApiProperty({ enum: TipoDocumento, isArray: true }) @IsArray() @IsEnum(TipoDocumento, { each: true })
  documentos!: TipoDocumento[];
}

export class EscribirBitacoraDto {
  @ApiProperty({ enum: TipoEntradaBitacora }) @IsEnum(TipoEntradaBitacora) tipo!: TipoEntradaBitacora;
  @ApiPropertyOptional({ description: 'Texto del mensaje u observación' })
  @IsOptional() @IsString() @MaxLength(6000) mensaje?: string;
  @ApiPropertyOptional({ type: SeguimientoDto }) @IsOptional() @ValidateNested() @Type(() => SeguimientoDto)
  seguimiento?: SeguimientoDto;
  @ApiPropertyOptional({ type: EvaluacionFinalDto }) @IsOptional() @ValidateNested() @Type(() => EvaluacionFinalDto)
  evaluacionFinal?: EvaluacionFinalDto;
  @ApiPropertyOptional({ type: EvaluaTuProcesoDto }) @IsOptional() @ValidateNested() @Type(() => EvaluaTuProcesoDto)
  evaluaTuProceso?: EvaluaTuProcesoDto;
  @ApiPropertyOptional({ type: CalificacionDto }) @IsOptional() @ValidateNested() @Type(() => CalificacionDto)
  calificacion?: CalificacionDto;
  @ApiPropertyOptional({ type: SubsanacionDto }) @IsOptional() @ValidateNested() @Type(() => SubsanacionDto)
  subsanacion?: SubsanacionDto;
}

export class EntradaBitacoraRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty() practicaId!: string;
  @ApiProperty({ enum: TipoEntradaBitacora }) tipo!: TipoEntradaBitacora;
  @ApiProperty() etiqueta!: string;
  @ApiProperty() autor!: AutorBitacora;
  @ApiProperty({ nullable: true }) autorId!: string | null;
  @ApiProperty() autorNombre!: string;
  @ApiProperty() mensaje!: string;
  @ApiProperty({ nullable: true }) detalle!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true }) venceEl!: string | null;
  @ApiProperty() creadaEn!: string;
  /** Verdadero cuando la escribió el actor que consulta. */
  @ApiProperty() propia!: boolean;
}

export class EstadoCierreDto {
  @ApiProperty({ enum: EstadoPractica }) estado!: EstadoPractica;
  @ApiProperty() estadoSgp!: string;
  @ApiProperty() porcentajeAprobado!: number;
  @ApiProperty() documentosAprobados!: boolean;
  @ApiProperty() evaluaTuProceso!: boolean;
  @ApiProperty() calificacion!: boolean;
  @ApiProperty({ nullable: true }) nota!: number | null;
  @ApiProperty({ nullable: true }) aprobada!: boolean | null;
  @ApiProperty() puedeCerrar!: boolean;
  @ApiProperty({ type: [String] }) faltantes!: readonly string[];
  @ApiProperty({ nullable: true }) cerradaEn!: string | null;
  @ApiProperty({ type: [String] }) preguntasEvaluaTuProceso!: readonly string[];
}

export interface RespuestaCierre {
  practicaId: string;
  cerrada: boolean;
  estado: EstadoPractica;
  nota: number | null;
}
