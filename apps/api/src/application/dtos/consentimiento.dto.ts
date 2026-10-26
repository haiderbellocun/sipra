import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { TipoConsentimiento } from '../../domain/entities/consentimiento.entity';

/** Lo que ve una persona de la política vigente: sin metadatos administrativos. */
export class PoliticaVigenteDto {
  @ApiProperty({ enum: TipoConsentimiento }) tipo!: TipoConsentimiento;
  @ApiProperty() version!: number;
  @ApiProperty() titulo!: string;
  @ApiProperty({ description: 'Para qué se tratan los datos.' }) finalidad!: string;
  @ApiProperty({ description: 'Texto de la política, o referencia a él, según lo publique la institución.' })
  contenido!: string;
  @ApiProperty() vigenteDesde!: string;
  @ApiProperty({ nullable: true }) vigenteHasta!: string | null;
}

/**
 * Registrar una aceptación o una revocación. El usuario NO viene aquí: sale de la
 * sesión. El ValidationPipe global rechaza cualquier campo que no esté declarado
 * (`forbidNonWhitelisted`), de modo que un `usuarioId` en el cuerpo da 400.
 */
export class RegistrarConsentimientoDto {
  @ApiProperty({ enum: TipoConsentimiento }) @IsEnum(TipoConsentimiento)
  tipo!: TipoConsentimiento;

  @ApiProperty({ description: 'Versión de la política que se acepta (debe ser la vigente) o que se revoca.' })
  @IsInt() @Min(1)
  politicaVersion!: number;

  @ApiPropertyOptional({ description: 'Práctica a la que se asocia, si aplica. Debe ser del propio estudiante.' })
  @IsOptional() @IsUUID()
  practicaId?: string;

  @ApiProperty({ description: 'true acepta; false revoca (o rechaza).' }) @IsBoolean()
  aceptado!: boolean;
}

export class ConsentimientoRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: TipoConsentimiento }) tipo!: TipoConsentimiento;
  @ApiProperty() politicaVersion!: number;
  @ApiProperty() politicaTitulo!: string;
  @ApiProperty() finalidad!: string;
  @ApiProperty({ nullable: true }) practicaId!: string | null;
  @ApiProperty() aceptado!: boolean;
  @ApiProperty() canal!: string;
  @ApiProperty() creadoEn!: string;
}

export class ResultadoConsentimientoDto {
  @ApiProperty({ type: ConsentimientoRespuestaDto }) consentimiento!: ConsentimientoRespuestaDto;
  @ApiProperty({ description: 'false si era idéntico al último evento y no se duplicó.' })
  registrado!: boolean;
}

/** Publicación de una versión nueva por el responsable institucional. */
export class PublicarPoliticaDto {
  @ApiProperty({ enum: TipoConsentimiento }) @IsEnum(TipoConsentimiento)
  tipo!: TipoConsentimiento;

  @ApiProperty({ description: 'Mayor que la última versión publicada del tipo.' })
  @IsInt() @Min(1)
  version!: number;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200)
  titulo!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500)
  finalidad!: string;

  @ApiProperty({ description: 'Texto aprobado por el responsable institucional (o referencia a él).' })
  @IsString() @IsNotEmpty() @MaxLength(200_000)
  contenido!: string;
}
