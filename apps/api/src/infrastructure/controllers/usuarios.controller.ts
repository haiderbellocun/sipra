import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActualizarUsuarioDto, CrearUsuarioDto, UsuarioAdministrativoDto } from '../../application/dtos/usuario.dto';
import { GestionarUsuariosUseCase } from '../../application/use-cases/administracion/gestionar-usuarios.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Gestión de usuarios')
@ApiBearerAuth()
@Controller('usuarios')
@Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
export class UsuariosController {
  constructor(private readonly usuarios: GestionarUsuariosUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Usuarios administrativos (búsqueda por nombre, perfil y estado)' })
  @ApiQuery({ name: 'nombre', required: false })
  @ApiQuery({ name: 'perfil', required: false, enum: Rol })
  @ApiQuery({ name: 'estado', required: false, description: 'activo | inactivo' })
  @ApiResponse({ status: 200, type: [UsuarioAdministrativoDto] })
  listar(
    @ActorActual() actor: Actor,
    @Query('nombre') nombre?: string,
    @Query('perfil') perfil?: Rol,
    @Query('estado') estado?: string,
  ): Promise<UsuarioAdministrativoDto[]> {
    const activo = estado === 'activo' ? true : estado === 'inactivo' ? false : undefined;
    return this.usuarios.listar({ nombre, rol: perfil, activo }, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un usuario administrativo (correo institucional, actor y permiso)' })
  @ApiResponse({ status: 201, type: UsuarioAdministrativoDto })
  crear(@Body() dto: CrearUsuarioDto, @ActorActual() actor: Actor): Promise<UsuarioAdministrativoDto> {
    return this.usuarios.crear(dto, actor);
  }

  @Get(':id')
  @ApiResponse({ status: 200, type: UsuarioAdministrativoDto })
  obtener(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<UsuarioAdministrativoDto> {
    return this.usuarios.obtener(id, actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar o cambiar el estado de un usuario' })
  actualizar(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarUsuarioDto, @ActorActual() actor: Actor,
  ): Promise<UsuarioAdministrativoDto> {
    return this.usuarios.actualizar(id, dto, actor);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar (inhabilitar) un usuario; el histórico lo conserva' })
  eliminar(@Param('id', ParseUUIDPipe) id: string, @ActorActual() actor: Actor): Promise<UsuarioAdministrativoDto> {
    return this.usuarios.eliminar(id, actor);
  }
}
