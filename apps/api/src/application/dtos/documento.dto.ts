import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, MinLength } from 'class-validator';
import {
  BandaPuntaje, EstadoDocumento, TipoDocumento,
} from '../../domain/entities/documento.entity';

export class MetricasCapturaDto {
  @ApiProperty({ description: 'Varianza del Laplaciano calculada en el dispositivo.' })
  @IsNumber() varianzaLaplaciano!: number;
  @ApiProperty() @IsNumber() luminanciaMedia!: number;
  @ApiProperty() @IsNumber() porcentajeSaturados!: number;
  @ApiProperty() @IsNumber() anchoPx!: number;
  @ApiProperty() @IsNumber() altoPx!: number;
}

export class DecisionDocumentoDto {
  @ApiProperty({ enum: ['aprobar', 'rechazar', 'devolver'] })
  @IsEnum(['aprobar', 'rechazar', 'devolver'] as never)
  decision!: 'aprobar' | 'rechazar' | 'devolver';

  @ApiProperty({
    description:
      'Justificación obligatoria. En devoluciones se envía al estudiante: debe explicar qué corregir.',
  })
  @IsString() @MinLength(10) justificacion!: string;
}

export class DocumentoRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty() practicaId!: string;
  @ApiProperty({ enum: TipoDocumento }) tipo!: TipoDocumento;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: EstadoDocumento }) estado!: EstadoDocumento;
  @ApiProperty() nombreOriginal!: string;
  @ApiProperty() tamanoBytes!: number;
  @ApiProperty({ nullable: true }) puntaje!: number | null;
  @ApiProperty({ enum: BandaPuntaje, nullable: true }) banda!: BandaPuntaje | null;
  @ApiProperty({ nullable: true }) motivoDevolucion!: string | null;
  @ApiProperty() cargadoEn!: string;
  @ApiPropertyOptional({
    description:
      'Solo se envía a roles internos. El estudiante NO recibe banderas ni puntaje interno.',
  })
  banderas?: unknown[];
  @ApiPropertyOptional({
    description:
      'Resumen de la lectura asistida (modelo, criterios respondidos, costo). Solo roles internos.',
  })
  lectura?: LecturaAsistidaDto | null;
}

export class HallazgoLecturaDto {
  @ApiProperty() codigo!: string;
  @ApiProperty() enunciado!: string;
  @ApiProperty({ enum: ['si', 'no', 'no_determinable'] }) cumple!: 'si' | 'no' | 'no_determinable';
  @ApiProperty({ nullable: true }) detalle!: string | null;
  @ApiProperty() causalDevolucion!: boolean;
}

export class LecturaAsistidaDto {
  @ApiProperty() proveedor!: string;
  @ApiProperty() modelo!: string;
  @ApiProperty({ nullable: true }) tipoDetectado!: string | null;
  @ApiProperty() ilegible!: boolean;
  @ApiProperty({ nullable: true }) motivoIlegible!: string | null;
  @ApiProperty({ nullable: true }) resumen!: string | null;
  @ApiProperty({ type: [HallazgoLecturaDto] }) hallazgos!: HallazgoLecturaDto[];
  @ApiProperty() tokensEntrada!: number;
  @ApiProperty() tokensSalida!: number;
  @ApiProperty() costoUsd!: number;
  @ApiProperty({ nullable: true }) leidoEn!: string | null;
  /** Campos leídos con su confianza, para la lista de chequeo del revisor. */
  @ApiProperty() campos!: Record<string, { valor: string | null; confianza: number; evidencia: string | null }>;
}
