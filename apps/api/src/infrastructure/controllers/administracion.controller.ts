import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ALMACENAMIENTO, AlmacenamientoPort, EXTRACCION_IA, ExtraccionIaPort,
} from '../../domain/ports/out/servicios-externos.port';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDefined, IsString, MinLength } from 'class-validator';
import {
  ParametroVigente, ParametrosUseCase,
} from '../../application/use-cases/administracion/parametros.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { AccionAuditada } from '../../domain/entities/auditoria.entity';
import {
  ParametroDesconocidoError, ParametroNormativoError, ValorParametroInvalidoError,
} from '../../domain/entities/parametro.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';
import { AuditoriaService } from '../modules/auditoria.service';

export class CambiarParametroDto {
  @IsDefined()
  valor!: number | boolean | string;

  @IsString()
  @MinLength(10, {
    message: 'El motivo debe explicar el cambio: mínimo 10 caracteres',
  })
  motivo!: string;
}

@ApiTags('Administración')
@ApiBearerAuth()
@Controller('administracion')
export class AdministracionController {
  constructor(
    private readonly parametros: ParametrosUseCase,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(EXTRACCION_IA) private readonly extraccion: ExtraccionIaPort,
  ) {}

  @Get('diagnostico')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Diagnóstico operativo: almacenamiento de documentos y drivers activos',
    description:
      'Escribe, lee y borra un objeto de prueba en el almacenamiento configurado y devuelve la causa ' +
      'exacta si falla (bucket inexistente, permiso denegado…). Solo para administración.',
  })
  async diagnostico(): Promise<{
    ambiente: string;
    drivers: { almacenamiento: string; bucket: string | null; ia: string; cola: string; correo: string; sinu: string };
    almacenamiento: { ok: boolean; detalle: string; milisegundos: number };
    ia: { ok: boolean; detalle: string; modelo: string | null };
  }> {
    const driver = this.config.get<string>('STORAGE_DRIVER') ?? 'local';
    const bucket = driver === 'gcs' ? (this.config.get<string>('GCS_BUCKET') ?? null) : null;
    const ruta = `diagnostico/${randomUUID()}.txt`;
    const inicio = Date.now();
    let ok = false; let detalle = '';
    try {
      await this.almacen.guardar(ruta, Buffer.from(`sipra diagnostico ${new Date().toISOString()}`), 'text/plain');
      const leido = await this.almacen.leer(ruta);
      await this.almacen.eliminar(ruta);
      ok = leido.length > 0;
      detalle = ok ? `Escritura, lectura y borrado correctos en ${driver}${bucket ? ` (gs://${bucket})` : ''}.` : 'La lectura devolvió un objeto vacío.';
    } catch (error) {
      const e = error as { message?: string; code?: number | string };
      detalle = `Falló en ${driver}${bucket ? ` (gs://${bucket})` : ''}: ${e.code ? `[${e.code}] ` : ''}${(e.message ?? String(error)).slice(0, 300)}`;
    }
    return {
      ambiente: this.config.get<string>('SIPRA_AMBIENTE') ?? 'dev',
      drivers: {
        almacenamiento: driver, bucket,
        ia: this.config.get<string>('IA_DRIVER') ?? 'simulado',
        cola: this.config.get<string>('COLA_DRIVER') ?? 'en_proceso',
        correo: this.config.get<string>('CORREO_DRIVER') ?? 'consola',
        sinu: this.config.get<string>('SINU_DRIVER') ?? 'simulado',
      },
      almacenamiento: { ok, detalle, milisegundos: Date.now() - inicio },
      ia: await this.diagnosticoIa(),
    };
  }

  /** Con `openai`, comprueba llave y modelo sin gastar tokens; con otros drivers solo informa. */
  private async diagnosticoIa(): Promise<{ ok: boolean; detalle: string; modelo: string | null }> {
    const driver = this.config.get<string>('IA_DRIVER') ?? 'simulado';
    const verificable = this.extraccion as Partial<{
      verificarAcceso: () => Promise<{ ok: boolean; detalle: string }>;
      modeloConfigurado: string;
    }>;
    if (driver === 'openai' && typeof verificable.verificarAcceso === 'function') {
      const resultado = await verificable.verificarAcceso();
      return { ...resultado, modelo: verificable.modeloConfigurado ?? null };
    }
    if (driver === 'anthropic') {
      return { ok: true, detalle: 'Driver anthropic configurado (sin comprobación remota)', modelo: this.config.get<string>('IA_MODELO') ?? null };
    }
    return { ok: true, detalle: 'Lectura simulada: sin proveedor externo; los documentos sin capa de texto van a revisión humana', modelo: 'simulado-deterministico' };
  }

  @Get('parametros')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Parámetros de operación y su valor vigente',
    description:
      'Los operativos los mueve la Dirección según lo que observe. Los normativos aparecen ' +
      'con la norma que los fija y el sistema se niega a cambiarlos: dejar que una pantalla ' +
      'de administración relaje la compuerta de ARL convertiría el incumplimiento en un ' +
      'descuido de dos clics.',
  })
  listar(): Promise<ParametroVigente[]> {
    return this.parametros.listar();
  }

  @Put('parametros/:clave')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Cambiar un parámetro operativo',
    description:
      'Exige un motivo escrito. Un umbral movido sin razón registrada es un cambio que ' +
      'nadie puede revisar después. El cambio queda en la auditoría inmutable con el valor ' +
      'anterior y el nuevo.',
  })
  @ApiResponse({ status: 200, description: 'Valor anterior y valor nuevo' })
  async cambiar(
    @Param('clave') clave: string,
    @Body() dto: CambiarParametroDto,
    @ActorActual() actor: Actor,
  ): Promise<{ clave: string; anterior: unknown; nuevo: unknown }> {
    try {
      const { anterior, nuevo } = await this.parametros.cambiar({
        clave, valor: dto.valor, motivo: dto.motivo, actorId: actor.id,
      });
      await this.auditoria.registrar(
        actor, AccionAuditada.PARAMETRO_CAMBIADO, 'parametro', null,
        { clave, anterior, nuevo }, dto.motivo,
      );
      return { clave, anterior, nuevo };
    } catch (error) {
      throw this.traducir(error);
    }
  }

  @Delete('parametros/:clave')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Volver un parámetro a su valor de fábrica',
    description: 'Borra la sobrescritura. El valor de fábrica vive en el código.',
  })
  async restaurar(
    @Param('clave') clave: string,
    @ActorActual() actor: Actor,
  ): Promise<{ clave: string; anterior: unknown; nuevo: unknown }> {
    try {
      const { anterior, nuevo } = await this.parametros.restaurar(clave);
      await this.auditoria.registrar(
        actor, AccionAuditada.PARAMETRO_CAMBIADO, 'parametro', null,
        { clave, anterior, nuevo, restaurado: true }, 'Restauración al valor de fábrica',
      );
      return { clave, anterior, nuevo };
    } catch (error) {
      throw this.traducir(error);
    }
  }

  /**
   * Los errores del dominio ya explican qué pasó y por qué; se conservan tal
   * cual en vez de sustituirlos por un mensaje genérico que obligue a quien
   * administra a adivinar.
   */
  private traducir(error: unknown): Error {
    if (
      error instanceof ParametroDesconocidoError ||
      error instanceof ParametroNormativoError ||
      error instanceof ValorParametroInvalidoError
    ) {
      return new BadRequestException(error.message);
    }
    return error as Error;
  }
}
