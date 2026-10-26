import {
  BadRequestException, Body, Controller, Get, HttpCode, Post,
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
  IngresoAbiertoDto, InicioOidcDto, OidcCallbackDto, PerfilDisponibleDto, SesionDto,
} from '../../application/dtos/auth.dto';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { AccionAuditada } from '../../domain/entities/auditoria.entity';
import { Usuario } from '../../domain/entities/usuario.entity';
import { ingresoAbiertoPermitido } from '../config/configuracion';
import { ActorActual } from '../auth/actor.decorator';
import { OidcService } from '../auth/oidc.service';
import { Autenticado, Publico } from '../auth/roles.decorator';
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
      'Permite al frontend decidir si muestra el selector de perfil (solo dev local) o el botón de ' +
      'ingreso con Google Workspace (cualquier otro ambiente).',
  })
  modo(): { modo: string; ambiente: string; permiteSelectorDePerfil: boolean } {
    return {
      modo: this.config.getOrThrow<string>('AUTH_MODO'),
      ambiente: this.config.getOrThrow<string>('SIPRA_AMBIENTE'),
      permiteSelectorDePerfil: ingresoAbiertoPermitido(this.valoresAbierto()),
    };
  }

  @Publico()
  @Get('perfiles')
  @ApiOperation({
    summary: 'Perfiles disponibles para ingresar sin contraseña',
    description:
      'Solo responde con AUTH_MODO=abierto, AUTH_ABIERTO_CONFIRMADO=true y SIPRA_AMBIENTE=dev. En el resto la ' +
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
  @ApiOperation({ summary: 'URL de autorización de Google Workspace y `state` firmado' })
  @ApiResponse({ status: 200, type: InicioOidcDto })
  iniciarOidc(): InicioOidcDto {
    if (!this.oidc.habilitado) {
      throw new BadRequestException('El ingreso institucional no está activo en este ambiente');
    }
    return this.oidc.urlAutorizacion();
  }

  @Publico()
  @Post('oidc/callback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Completa el ingreso institucional',
    description:
      'El proveedor regresa al frontend (/ingreso/callback); este lo reenvía aquí por POST con ' +
      'el código y el `state`. Se verifica el `state`, se canjea el código y se exige el nonce.',
  })
  @ApiResponse({ status: 200, type: SesionDto })
  async callbackOidc(@Body() dto: OidcCallbackDto): Promise<SesionDto> {
    if (!this.oidc.habilitado) {
      throw new BadRequestException('El ingreso institucional no está activo en este ambiente');
    }
    const identidad = await this.oidc.intercambiarCodigo(dto.code, dto.state);

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
  @Autenticado()
  @Get('yo')
  @ApiOperation({ summary: 'Identidad de la sesión activa' })
  yo(@ActorActual() actor: Actor): Actor {
    return actor;
  }

  private exigirModoAbierto(): void {
    if (!ingresoAbiertoPermitido(this.valoresAbierto())) {
      throw new BadRequestException(
        'El ingreso por selección de perfil está deshabilitado en este ambiente',
      );
    }
  }

  private valoresAbierto(): Record<string, unknown> {
    return {
      AUTH_MODO: this.config.get('AUTH_MODO'),
      AUTH_ABIERTO_CONFIRMADO: this.config.get('AUTH_ABIERTO_CONFIRMADO'),
      SIPRA_AMBIENTE: this.config.get('SIPRA_AMBIENTE'),
    };
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
