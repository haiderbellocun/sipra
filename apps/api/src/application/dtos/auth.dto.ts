import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Rol } from '../../domain/value-objects/rol.vo';

export class OidcCallbackDto {
  @ApiProperty({ description: 'Código de autorización que el proveedor entregó al frontend.' })
  @IsString() @IsNotEmpty() @MaxLength(2048)
  code!: string;

  @ApiProperty({ description: 'El `state` completo que emitió GET /auth/oidc/inicio.' })
  @IsString() @IsNotEmpty() @MaxLength(1024)
  state!: string;
}

export class InicioOidcDto {
  @ApiProperty() url!: string;
  @ApiProperty({ description: 'Valor firmado que el frontend conserva y compara al regresar.' })
  state!: string;
}

export class IngresoAbiertoDto {
  @ApiProperty({
    enum: Rol,
    description:
      'Perfil con el que se ingresa. Solo disponible con AUTH_MODO=abierto, AUTH_ABIERTO_CONFIRMADO=true y SIPRA_AMBIENTE=dev.',
  })
  @IsEnum(Rol)
  rol!: Rol;

  @ApiPropertyOptional({
    description: 'Correo de un usuario semilla concreto. Si se omite, se toma el primero del rol.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  correo?: string;
}

export class SesionDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() expiraEn!: string;
  @ApiProperty() id!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() correo!: string;
  @ApiProperty({ enum: Rol }) rol!: Rol;
  @ApiProperty({ enum: ['consulta', 'escritura'] }) permiso!: 'consulta' | 'escritura';
  @ApiProperty({ type: [String] }) escuelas!: string[];
  @ApiProperty({ nullable: true }) empresaId!: string | null;
  @ApiProperty({ description: 'Modo de autenticación activo en el ambiente.' })
  modo!: 'abierto' | 'oidc';
}

export class UsuarioDePerfilDto {
  @ApiProperty() id!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() correo!: string;
  /** Qué lo distingue de los demás del mismo perfil: escuelas, permiso, programa. */
  @ApiProperty() detalle!: string;
}

export class PerfilDisponibleDto {
  @ApiProperty({ enum: Rol }) rol!: Rol;
  @ApiProperty() id!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() correo!: string;
  @ApiProperty() descripcion!: string;
  /** Todos los usuarios activos del perfil, el predeterminado primero: el selector deja elegir. */
  @ApiProperty({ type: [UsuarioDePerfilDto] }) usuarios!: UsuarioDePerfilDto[];
}
