import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';
import { Permiso, ROLES_ADMINISTRATIVOS, Rol } from '../../domain/value-objects/rol.vo';

export class CrearUsuarioDto {
  @ApiProperty({ example: 'ana.lopez@cun.edu.co', description: 'Correo institucional' })
  @IsEmail() @MaxLength(160) correo!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(160) nombre!: string;
  @ApiProperty({ description: 'Número de documento; en el SGP era la contraseña inicial' })
  @IsString() @Matches(/^[A-Za-z0-9]{4,30}$/) documento!: string;
  @ApiProperty({ enum: ROLES_ADMINISTRATIVOS }) @IsIn([...ROLES_ADMINISTRATIVOS]) rol!: Rol;
  @ApiProperty({ enum: ['consulta', 'escritura'] }) @IsIn(['consulta', 'escritura']) permiso!: Permiso;
  @ApiPropertyOptional({ type: [String], description: 'Escuelas a cargo; vacío = institucional' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) escuelas?: string[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() activo?: boolean;
}

export class ActualizarUsuarioDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(160) nombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Za-z0-9]{4,30}$/) documento?: string;
  @ApiPropertyOptional({ enum: ['consulta', 'escritura'] }) @IsOptional() @IsIn(['consulta', 'escritura']) permiso?: Permiso;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) escuelas?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activo?: boolean;
}

export class UsuarioAdministrativoDto {
  @ApiProperty() id!: string;
  @ApiProperty() correo!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty({ nullable: true }) documento!: string | null;
  @ApiProperty({ enum: Rol }) rol!: Rol;
  @ApiProperty() rolEtiqueta!: string;
  @ApiProperty({ enum: ['consulta', 'escritura'] }) permiso!: Permiso;
  @ApiProperty({ type: [String] }) escuelas!: readonly string[];
  @ApiProperty() activo!: boolean;
  @ApiProperty() creadoEn!: string;
  @ApiProperty({ nullable: true }) ultimoAccesoEn!: string | null;
}

/** Nombres de actor del SGP (manual de coordinación, §3). */
export const ETIQUETA_ROL: Readonly<Record<Rol, string>> = {
  [Rol.ADMINISTRADOR]: 'Administrador',
  [Rol.COORDINADOR]: 'Coordinador de prácticas',
  [Rol.AUXILIAR]: 'Auxiliar',
  [Rol.TUTOR]: 'Docente facilitador',
  [Rol.ESTUDIANTE]: 'Practicante',
  [Rol.EMPRESA]: 'Empresa',
  [Rol.EXTENSION]: 'Extensión',
};
