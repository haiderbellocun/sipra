import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  ESTADOS_OBLIGACION, EstadoObligacion, FiltroReporteAnalitica, LIMITE_FILAS_JSON, ReporteAnalitica, ReportesAnaliticaUseCase, SITUACIONES, SIN_EMPRESA,
  SegmentoDetalle, SituacionExpediente, TipoReceptor,
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
  @ApiQuery({ name: 'ciclo', required: false, description: 'Nivel de formación (practicas.ciclo)' })
  @ApiQuery({ name: 'empresa', required: false, description: `Razón social, o ${SIN_EMPRESA}` })
  @ApiQuery({ name: 'situacion', required: false, enum: SITUACIONES })
  @ApiQuery({ name: 'semestre', required: false, description: 'Solo con el overlay sintético de pruebas (dev); en otro caso, 400' })
  @ApiQuery({ name: 'sector', required: false, description: 'Sección CIIU de la empresa receptora, o __sin_dato__' })
  @ApiQuery({ name: 'ciudad', required: false, description: 'Municipio DIVIPOLA de la empresa receptora, o __sin_dato__' })
  @ApiQuery({ name: 'tipoReceptor', required: false, enum: ['interna_cun', 'externa'] })
  analitica(@ActorActual() actor: Actor, @Query() q: Record<string, string | undefined>): Promise<ReporteAnalitica> {
    return this.reportes.analitica(filtroDe(q), actor);
  }

  @Get('detalle')
  @ApiOperation({ summary: 'Detalle por práctica de un segmento', description: '`formato=csv` descarga el detalle filtrado y lo audita. Sin documento ni correo.' })
  @ApiQuery({ name: 'periodos', required: false })
  @ApiQuery({ name: 'escuela', required: false })
  @ApiQuery({ name: 'programa', required: false })
  @ApiQuery({ name: 'modalidad', required: false })
  @ApiQuery({ name: 'estado', required: false })
  @ApiQuery({ name: 'ciclo', required: false })
  @ApiQuery({ name: 'empresa', required: false })
  @ApiQuery({ name: 'situacion', required: false, enum: SITUACIONES })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'estadoDocumental', required: false, enum: ESTADOS_OBLIGACION })
  @ApiQuery({ name: 'buscar', required: false, description: 'Nombre del estudiante, programa o empresa (sin documento de identidad)' })
  @ApiQuery({ name: 'formato', required: false, enum: ['json', 'csv'] })
  async detalle(@ActorActual() actor: Actor, @Res() respuesta: FastifyReply, @Query() q: Record<string, string | undefined>): Promise<void> {
    const filtro = filtroDe(q);
    const segmento: SegmentoDetalle = {
      tipo: q['tipo'] || undefined,
      estadoDocumental: (q['estadoDocumental'] || undefined) as EstadoObligacion | undefined,
    };
    const buscar = q['buscar'] ?? '';
    if (q['formato'] !== 'csv') {
      await respuesta.header('Cache-Control', 'private, no-store').send(await this.reportes.detalle(filtro, segmento, actor, buscar, LIMITE_FILAS_JSON));
      return;
    }
    const archivo = await this.reportes.csv(filtro, segmento, actor, buscar);
    await respuesta
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${archivo.nombreArchivo}"`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Filas', String(archivo.filas))
      .send(archivo.contenido);
  }
}

/** Un único contexto de filtros para agregados, detalle y CSV (los vacíos no filtran). */
function filtroDe(q: Record<string, string | undefined>): FiltroReporteAnalitica {
  const v = (k: string) => (typeof q[k] === 'string' && q[k] ? q[k] : undefined);
  return {
    periodos: (v('periodos') ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    escuela: v('escuela'), programa: v('programa'), modalidad: v('modalidad'), estado: v('estado'),
    ciclo: v('ciclo'), empresa: v('empresa'), situacion: v('situacion') as SituacionExpediente | undefined,
    semestre: v('semestre') === undefined ? undefined : Number(v('semestre')),
    sector: v('sector'), ciudad: v('ciudad'), tipoReceptor: v('tipoReceptor') as TipoReceptor | undefined,
  };
}
