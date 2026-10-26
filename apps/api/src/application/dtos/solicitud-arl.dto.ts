import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { TipoDocumento } from '../../domain/entities/documento.entity';
import { ModalidadPractica } from '../../domain/entities/modalidad.entity';
import {
  CriterioEvaluado, EstadoSolicitudArl, MotivoRechazoArl, REGIMENES_EPS, Recomendacion, RegimenEps,
  TIPOS_IDENTIFICACION, TipoIdentificacion,
} from '../../domain/entities/solicitud-arl.entity';

export class RadicarSolicitudArlDto {
  @ApiPropertyOptional({ description: 'Perfiles internos: práctica sobre la que se radica. El estudiante usa la suya.' })
  @IsOptional() @IsUUID() practicaId?: string;
  @ApiProperty({ enum: TIPOS_IDENTIFICACION }) @IsIn([...TIPOS_IDENTIFICACION]) tipoIdentificacion!: TipoIdentificacion;
  @ApiProperty() @IsString() @MinLength(4) @MaxLength(30) numeroIdentificacion!: string;
  @ApiProperty({ example: 'Nueva EPS' }) @IsString() @MinLength(2) @MaxLength(120) epsNombre!: string;
  @ApiProperty({ enum: REGIMENES_EPS }) @IsIn([...REGIMENES_EPS]) epsRegimen!: RegimenEps;
  @ApiPropertyOptional({ description: 'Fecha de expedición del certificado de EPS (AAAA-MM-DD)' })
  @IsOptional() @IsDateString() fechaExpedicionEps?: string;
  @ApiPropertyOptional({ description: 'CUNbre: fecha de expedición del RUT' })
  @IsOptional() @IsDateString() fechaExpedicionRut?: string;
  @ApiPropertyOptional({ description: 'CUNbre consolidado: fecha de expedición de la Cámara de Comercio' })
  @IsOptional() @IsDateString() fechaExpedicionCamara?: string;
}

export class DecidirSolicitudArlDto {
  @ApiProperty({ enum: ['aprobar', 'rechazar'] }) @IsIn(['aprobar', 'rechazar']) decision!: 'aprobar' | 'rechazar';
  @ApiPropertyOptional({ enum: MotivoRechazoArl, isArray: true, description: 'Obligatorio al rechazar' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsEnum(MotivoRechazoArl, { each: true }) motivos?: MotivoRechazoArl[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) observacion?: string;
}

export class DocumentoAportadoDto {
  @ApiProperty({ enum: TipoDocumento }) tipo!: TipoDocumento;
  @ApiProperty() documentoId!: string;
  @ApiProperty() estado!: string;
}

export class CriterioEvaluadoDto implements CriterioEvaluado {
  @ApiProperty() criterio!: string;
  @ApiProperty({ enum: ['cumple', 'no_cumple', 'revision_manual'] }) resultado!: 'cumple' | 'no_cumple' | 'revision_manual';
  @ApiProperty() detalle!: string;
  @ApiProperty({ enum: MotivoRechazoArl, nullable: true }) motivo!: MotivoRechazoArl | null;
}

export class SolicitudArlRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) consecutivo!: number | null;
  @ApiProperty() practicaId!: string;
  @ApiProperty() estudianteId!: string;
  @ApiProperty() estudianteNombre!: string;
  @ApiProperty() estudianteCorreo!: string;
  @ApiProperty({ nullable: true }) programaId!: string | null;
  @ApiProperty() periodoAcademico!: string;
  @ApiProperty({ enum: ModalidadPractica }) modalidad!: ModalidadPractica;
  @ApiProperty() modalidadEtiqueta!: string;
  @ApiProperty() tipoIdentificacion!: TipoIdentificacion;
  @ApiProperty() numeroIdentificacion!: string;
  @ApiProperty() fechaInicio!: string;
  @ApiProperty() fechaFin!: string;
  @ApiProperty() epsNombre!: string;
  @ApiProperty() epsRegimen!: RegimenEps;
  @ApiProperty({ nullable: true }) fechaExpedicionEps!: string | null;
  @ApiProperty({ nullable: true }) fechaExpedicionRut!: string | null;
  @ApiProperty({ nullable: true }) fechaExpedicionCamara!: string | null;
  @ApiProperty({ type: [String] }) documentosExigidos!: readonly TipoDocumento[];
  @ApiProperty({ type: [DocumentoAportadoDto] }) documentos!: readonly DocumentoAportadoDto[];
  @ApiProperty({ enum: ['aprobar', 'rechazar', 'revision_manual'], nullable: true }) recomendacion!: Recomendacion | null;
  @ApiProperty({ type: [CriterioEvaluadoDto] }) criterios!: readonly CriterioEvaluadoDto[];
  @ApiProperty({ enum: EstadoSolicitudArl }) estado!: EstadoSolicitudArl;
  @ApiProperty({ enum: MotivoRechazoArl, isArray: true }) motivosRechazo!: readonly MotivoRechazoArl[];
  @ApiProperty({ type: [String] }) motivosRechazoEtiquetas!: readonly string[];
  @ApiProperty({ nullable: true }) observacion!: string | null;
  @ApiProperty({ nullable: true }) decididaPor!: string | null;
  @ApiProperty({ nullable: true }) decididaEn!: string | null;
  @ApiProperty({ nullable: true }) certificadoDocumentoId!: string | null;
  @ApiProperty({ nullable: true }) certificadoEnviadoEn!: string | null;
  @ApiProperty() radicadaEn!: string;
}

export interface FilaConsolidadoArl {
  consecutivo: number | null;
  estado: EstadoSolicitudArl;
  estudianteNombre: string;
  numeroIdentificacion: string;
  estudianteCorreo: string;
  programaId: string | null;
  periodoAcademico: string;
  modalidad: string;
  fechaInicio: string;
  fechaFin: string;
  epsNombre: string;
  motivos: readonly string[];
  decididaEn: string | null;
}

export interface ConsolidadoArl {
  fecha: string;
  aprobadas: FilaConsolidadoArl[];
  rechazadas: FilaConsolidadoArl[];
  certificadosEnviados: FilaConsolidadoArl[];
}
