import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  ESTADOS_OBLIGACION, EstadoObligacion, FiltroReporteAnalitica, ReporteAnalitica, ReportesAnaliticaUseCase, SITUACIONES,
  SegmentoDetalle, SituacionExpediente,
} from '../../application/use-cases/reportes/reportes-analitica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

/**
 * Analítica de Reportes: solo lectura, con el mismo alcance por escuelas que los reportes del SGP. Endpoints separados:
 * agregados para la pantalla y detalle por práctica (JSON o CSV auditado), nunca un volcado completo sin filtros de alcance.
 */
@ApiTags('Reportes analítica')
@ApiBearerAuth()
@Controller('reportes/analitica')
@Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.AUXILIAR, Rol.TUTOR)
export class ReportesAnaliticaController {
  constructor(private readonly reportes: ReportesAnaliticaUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Agregados de prácticas, documentos y periodos', description: 'Estudiantes únicos, cobertura documental, fricción, tiempos y tendencia semanal (hora de Bogotá).' })
  @ApiQuery({ name: 'periodos', required: false, description: 'Periodos separados por coma' })
  @ApiQuery({ name: 'escuela', required: false })
  @ApiQuery({ name: 'programa', required: false })
  @ApiQuery({ name: 'modalidad', required: false })
  @ApiQuery({ name: 'estado', required: false })
  analitica(
    @ActorActual() actor: Actor,
    @Query('periodos') periodos?: string,
    @Query('escuela') escuela?: string,
    @Query('programa') programa?: string,
    @Query('modalidad') modalidad?: string,
    @Query('estado') estado?: string,
  ): Promise<ReporteAnalitica> {
    return this.reportes.analitica(filtroDe(periodos, escuela, programa, modalidad, estado), actor);
  }

  @Get('detalle')
  @ApiOperation({ summary: 'Detalle por práctica de un segmento', description: '`formato=csv` descarga el detalle filtrado y lo audita. Sin documento ni correo.' })
  @ApiQuery({ name: 'periodos', required: false })
  @ApiQuery({ name: 'escuela', required: false })
  @ApiQuery({ name: 'programa', required: false })
  @ApiQuery({ name: 'modalidad', required: false })
  @ApiQuery({ name: 'estado', required: false })
  @ApiQuery({ name: 'situacion', required: false, enum: SITUACIONES })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'estadoDocumental', required: false, enum: ESTADOS_OBLIGACION })
  @ApiQuery({ name: 'formato', required: false, enum: ['json', 'csv'] })
  async detalle(
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
    @Query('periodos') periodos?: string,
    @Query('escuela') escuela?: string,
    @Query('programa') programa?: string,
    @Query('modalidad') modalidad?: string,
    @Query('estado') estado?: string,
    @Query('situacion') situacion?: string,
    @Query('tipo') tipo?: string,
    @Query('estadoDocumental') estadoDocumental?: string,
    @Query('formato') formato?: string,
  ): Promise<void> {
    const filtro = filtroDe(periodos, escuela, programa, modalidad, estado);
    const segmento: SegmentoDetalle = {
      situacion: (situacion || undefined) as SituacionExpediente | undefined,
      tipo: tipo || undefined,
      estadoDocumental: (estadoDocumental || undefined) as EstadoObligacion | undefined,
    };
    if (formato !== 'csv') {
      await respuesta.header('Cache-Control', 'private, no-store').send(await this.reportes.detalle(filtro, segmento, actor));
      return;
    }
    const archivo = await this.reportes.csv(filtro, segmento, actor);
    await respuesta
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${archivo.nombreArchivo}"`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Filas', String(archivo.filas))
      .send(archivo.contenido);
  }
}

function filtroDe(periodos?: string, escuela?: string, programa?: string, modalidad?: string, estado?: string): FiltroReporteAnalitica {
  return {
    periodos: (periodos ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    escuela: escuela || undefined, programa: programa || undefined, modalidad: modalidad || undefined, estado: estado || undefined,
  };
}
