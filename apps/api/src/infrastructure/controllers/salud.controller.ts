import { Controller, Get, Header, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { FastifyReply } from 'fastify';
import { DataSource } from 'typeorm';
import { Publico } from '../auth/roles.decorator';
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

  @Publico()
  @Get('metrics')
  @ApiExcludeEndpoint()
  @Header('cache-control', 'no-store')
  async exponerMetricas(@Res() respuesta: FastifyReply): Promise<void> {
    await respuesta
      .header('content-type', this.metricas.contentType)
      .send(await this.metricas.exponer());
  }
}
