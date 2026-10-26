import {
  BadRequestException, Body, Controller, Get, HttpCode, Post, Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import {
  ApiBearerAuth, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { IngresarAbiertoUseCase } from '../../application/use-cases/auth/ingresar-abierto.use-case';
import {
  ListarPerfilesDisponiblesUseCase,
} from '../../application/use-cases/auth/listar-perfiles.use-case';
import {
  IngresoAbiertoDto, PerfilDisponibleDto, SesionDto,
} from '../../application/dtos/auth.dto';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { AccionAuditada } from '../../domain/entities/auditoria.entity';
import { Usuario } from '../../domain/entities/usuario.entity';
import { ActorActual } from '../auth/actor.decorator';
import { OidcService } from '../auth/oidc.service';
import { Publico } from '../auth/roles.decorator';
import { AuditoriaService } from '../modules/auditoria.service';
import { UsuarioRepositoryAdapter } from '../adapters/persistence/postgres/repositorios.adapter';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly ingresarAbierto: IngresarAbiertoUseCase,
    private readonly listarPerfiles: ListarPerfilesDisponiblesUseCase,
    private readonly usuarios: UsuarioRepositoryAdapter,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly oidc: OidcService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Publico()
  @Get('modo')
  @ApiOperation({
    summary: 'Modo de autenticación del ambiente',
    description:
      'Permite al frontend decidir si muestra el selector de perfil (dev/qa) o el botón de ' +
      'ingreso con Google Workspace (pre/prod).',
  })
  modo(): { modo: string; ambiente: string; permiteSelectorDePerfil: boolean } {
    const modo = this.config.get<string>('AUTH_MODO') ?? 'abierto';
    return {
      modo,
      ambiente: this.config.get<string>('SIPRA_AMBIENTE') ?? 'dev',
      permiteSelectorDePerfil: modo === 'abierto',
    };
  }

  @Publico()
  @Get('perfiles')
  @ApiOperation({
    summary: 'Perfiles disponibles para ingresar sin contraseña',
    description:
      'Solo responde cuando AUTH_MODO=abierto. En preproducción y producción la ' +
      'configuración prohíbe ese modo y el arranque falla antes de exponer esta ruta.',
  })
  @ApiResponse({ status: 200, type: [PerfilDisponibleDto] })
  async perfiles(): Promise<PerfilDisponibleDto[]> {
    this.exigirModoAbierto();
    return this.listarPerfiles.ejecutar();
  }

  @Publico()
  @Post('ingresar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ingresar seleccionando un perfil (ambiente de pruebas)',
    description:
      'Emite exactamente el mismo token que el flujo OIDC. Activar Google Workspace no exige ' +
      'cambiar una sola línea de lógica de negocio.',
  })
  @ApiResponse({ status: 200, type: SesionDto })
  async ingresar(@Body() dto: IngresoAbiertoDto): Promise<SesionDto> {
    this.exigirModoAbierto();
    const usuario = await this.ingresarAbierto.ejecutar(dto.rol, dto.correo);
    return this.emitirSesion(usuario, 'abierto');
  }

  @Publico()
  @Get('oidc/inicio')
  @ApiOperation({ summary: 'URL de autorización de Google Workspace' })
  iniciarOidc(): { url: string; state: string; nonce: string } {
    if (!this.oidc.habilitado) {
      throw new BadRequestException('El ingreso institucional no está activo en este ambiente');
    }
    return this.oidc.urlAutorizacion();
  }

  @Publico()
  @Get('oidc/callback')
  @ApiOperation({ summary: 'Retorno de Google Workspace: canjea el código por una sesión' })
  @ApiResponse({ status: 200, type: SesionDto })
  async callbackOidc(
    @Query('code') codigo: string,
    @Query('nonce') nonce: string,
  ): Promise<SesionDto> {
    if (!this.oidc.habilitado) {
      throw new BadRequestException('El ingreso institucional no está activo en este ambiente');
    }
    const identidad = await this.oidc.intercambiarCodigo(codigo, nonce);

    // El perfil institucional se resuelve contra la base, no contra el token.
    const usuario = await this.usuarios.buscarPorCorreo(identidad.correo);
    if (!usuario || !usuario.activo) {
      throw new BadRequestException(
        'La cuenta no tiene un perfil activo en SIPRA. Solicite su habilitación a la Dirección de Operaciones.',
      );
    }
    usuario.registrarAcceso();
    await this.usuarios.guardar(usuario.instantanea());
    return this.emitirSesion(usuario, 'oidc');
  }

  @ApiBearerAuth()
  @Get('yo')
  @ApiOperation({ summary: 'Identidad de la sesión activa' })
  yo(@ActorActual() actor: Actor): Actor {
    return actor;
  }

  private exigirModoAbierto(): void {
    if (this.config.get<string>('AUTH_MODO') !== 'abierto') {
      throw new BadRequestException(
        'El ingreso por selección de perfil está deshabilitado en este ambiente',
      );
    }
  }

  private async emitirSesion(usuario: Usuario, modo: 'abierto' | 'oidc'): Promise<SesionDto> {
    const expiracion = this.config.get<string>('JWT_EXPIRACION') ?? '8h';
    const token = await this.jwt.signAsync(
      {
        sub: usuario.id,
        correo: usuario.correo,
        rol: usuario.rol,
        permiso: usuario.permiso,
        escuelas: [...usuario.escuelas],
        empresaId: usuario.empresaId,
      },
      { expiresIn: expiracion as JwtSignOptions['expiresIn'] },
    );

    await this.auditoria.registrar(
      {
        id: usuario.id, correo: usuario.correo, rol: usuario.rol,
        escuelas: usuario.escuelas, empresaId: usuario.empresaId,
      },
      AccionAuditada.SESION_INICIADA,
      'usuario',
      usuario.id,
      { modo },
    );

    return {
      accessToken: token,
      expiraEn: expiracion,
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
      permiso: usuario.permiso,
      escuelas: [...usuario.escuelas],
      empresaId: usuario.empresaId,
      modo,
    };
  }
}
