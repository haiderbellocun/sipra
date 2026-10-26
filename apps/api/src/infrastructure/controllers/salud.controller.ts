import {
  Controller, Get, Headers, NotFoundException, Res, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { FastifyReply } from 'fastify';
import { DataSource } from 'typeorm';
import { Publico } from '../auth/roles.decorator';
import { tokenMetricasValido } from '../observability/acceso-metricas';
import { MetricasService } from '../observability/metricas.service';

@ApiTags('Operación')
@Controller()
export class SaludController {
  constructor(
    @InjectDataSource() private readonly datos: DataSource,
    private readonly metricas: MetricasService,
    private readonly config: ConfigService,
  ) {}

  /** Sonda de disponibilidad de Cloud Run. */
  @Publico()
  @Get('salud')
  @ApiOperation({ summary: 'Estado del servicio y de sus dependencias' })
  async salud(): Promise<{ estado: string; ambiente: string; base: string; version: string }> {
    let base = 'no disponible';
    try {
      await this.datos.query('SELECT 1');
      base = 'ok';
    } catch {
      base = 'error';
    }
    return {
      estado: base === 'ok' ? 'ok' : 'degradado',
      ambiente: this.config.get<string>('SIPRA_AMBIENTE') ?? 'dev',
      base,
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }

  /**
   * Métricas de Prometheus. Es `@Publico` solo en el sentido de que no usa la sesión
   * de un usuario: la credencial es un token de servicio (`METRICAS_TOKEN`).
   * Deshabilitadas, o sin token configurado, el endpoint no existe (404): no hay
   * ninguna configuración en la que quede abierto.
   */
  @Publico()
  @Get('metrics')
  @ApiExcludeEndpoint()
  async exponerMetricas(
    @Headers('authorization') autorizacion: string | undefined,
    @Res() respuesta: FastifyReply,
  ): Promise<void> {
    const token = this.config.get<string>('METRICAS_TOKEN');
    if (this.config.get<boolean>('METRICAS_HABILITADAS') !== true || !token) {
      throw new NotFoundException();
    }
    if (!tokenMetricasValido(autorizacion, token)) {
      throw new UnauthorizedException('Credencial de métricas inválida');
    }
    await respuesta
      .header('content-type', this.metricas.contentType)
      .header('cache-control', 'no-store')
      .send(await this.metricas.exponer());
  }
}
