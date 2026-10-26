import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { EstadoEmpresa } from '../../domain/entities/empresa.entity';

/** Formulario público (M6): única superficie expuesta sin autenticación. */
export class SolicitudEmpresaDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) razonSocial!: string;
  @ApiProperty({ example: '901458772-2', description: 'NIT con dígito de verificación.' })
  @IsString() @MaxLength(20) nit!: string;
  @ApiPropertyOptional({ description: 'Código CIIU Rev. 4 A.C.' })
  @IsOptional() @IsString() @MaxLength(10) ciiu?: string;
  @ApiPropertyOptional({ description: 'Código DIVIPOLA del municipio.' })
  @IsOptional() @IsString() @MaxLength(10) divipolaMunicipio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) direccion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) telefono?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(150) solicitanteNombre!: string;
  @ApiProperty() @IsEmail() @MaxLength(180) solicitanteCorreo!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) solicitanteCargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) representanteLegal?: string;

  @ApiPropertyOptional({
    description: 'Campo trampa. Debe llegar vacío; si trae valor, la solicitud se descarta.',
  })
  @IsOptional() @IsString() sitioWebAlterno?: string;
}

export class DecisionEmpresaDto {
  @ApiProperty({ enum: ['habilitar', 'rechazar', 'requerir_info', 'suspender'] })
  @IsString() decision!: 'habilitar' | 'rechazar' | 'requerir_info' | 'suspender';
  @ApiProperty({ description: 'Justificación obligatoria; queda en auditoría.' })
  @IsString() @MinLength(10) justificacion!: string;
}

export class VerificarNitDto {
  @ApiProperty({ example: '901458772' })
  @IsString() @MaxLength(20) numero!: string;
}

export class NitVerificadoDto {
  @ApiProperty() numero!: string;
  @ApiProperty() digitoVerificacion!: number;
  @ApiProperty() formateado!: string;
}

export class EmpresaRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty() razonSocial!: string;
  @ApiProperty() nit!: string;
  @ApiProperty({ enum: EstadoEmpresa }) estado!: EstadoEmpresa;
  @ApiProperty({ enum: ['verde', 'amarillo', 'rojo'] }) semaforo!: 'verde' | 'amarillo' | 'rojo';
  @ApiProperty() solicitanteNombre!: string;
  @ApiProperty() solicitanteCorreo!: string;
  @ApiProperty() solicitadaEn!: string;
  @ApiPropertyOptional({ description: 'Señales de pre-verificación. Solo roles internos.' })
  senales?: unknown[];
}

/** La respuesta al formulario público es idéntica en todos los casos. */
export class AcuseSolicitudDto {
  @ApiProperty({ example: 'recibida' }) resultado!: 'recibida';
  @ApiProperty() mensaje!: string;
}
