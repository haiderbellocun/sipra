import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  ReporteTabla, ReportesSgpUseCase, TipoReporteBitacora,
} from '../../application/use-cases/reportes/reportes-sgp.use-case';
import { EstadoPractica } from '../../domain/entities/practica.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

const TIPOS_BITACORA: readonly TipoReporteBitacora[] = ['seguimiento', 'evalua_tu_proceso', 'mensaje_libre', 'calificacion_docente'];

@ApiTags('Reportes SGP')
@ApiBearerAuth()
@Controller('reportes/sgp')
@Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.AUXILIAR, Rol.TUTOR)
export class ReportesSgpController {
  constructor(private readonly reportes: ReportesSgpUseCase) {}

  @Get('practicas')
  @ApiOperation({
    summary: 'Reporte de prácticas (Excel)',
    description: 'Los siete bloques del manual de coordinación, por periodos, modalidad y estado. `formato=json` devuelve la tabla.',
  })
  @ApiQuery({ name: 'periodos', required: true, description: 'Códigos separados por coma, p. ej. 2026A,2026C' })
  @ApiQuery({ name: 'modalidad', required: false })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoPractica })
  @ApiQuery({ name: 'formato', required: false, enum: ['xlsx', 'json'] })
  async practicas(
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
    @Query('periodos') periodos?: string,
    @Query('modalidad') modalidad?: string,
    @Query('estado') estado?: EstadoPractica,
    @Query('formato') formato?: string,
  ): Promise<void> {
    const lista = (periodos ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const tabla = await this.reportes.reportePracticas({ periodos: lista, modalidad, estado }, actor);
    await this.emitir('Reporte de prácticas', tabla, actor, { periodos: lista, modalidad, estado }, formato, respuesta);
  }

  @Get('bitacoras')
  @ApiOperation({ summary: 'Reporte de bitácoras: seguimiento, Evalúa tu proceso, mensaje libre o calificación docente' })
  @ApiQuery({ name: 'tipo', required: true, enum: TIPOS_BITACORA })
  @ApiQuery({ name: 'periodo', required: false })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoPractica })
  @ApiQuery({ name: 'formato', required: false, enum: ['xlsx', 'json'] })
  async bitacoras(
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
    @Query('tipo') tipo?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: EstadoPractica,
    @Query('formato') formato?: string,
  ): Promise<void> {
    if (!tipo || !TIPOS_BITACORA.includes(tipo as TipoReporteBitacora)) {
      throw new BadRequestException(`Indique el tipo: ${TIPOS_BITACORA.join(', ')}`);
    }
    const tabla = await this.reportes.reporteBitacoras({ periodo, tipo: tipo as TipoReporteBitacora, estado }, actor);
    await this.emitir(`Reporte bitácoras ${tipo}`, tabla, actor, { tipo, periodo, estado }, formato, respuesta);
  }

  @Get('cartas')
  @ApiOperation({ summary: 'Reporte de cartas de presentación' })
  @ApiQuery({ name: 'periodo', required: false })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'formato', required: false, enum: ['xlsx', 'json'] })
  async cartas(
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
    @Query('periodo') periodo?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('formato') formato?: string,
  ): Promise<void> {
    const tabla = await this.reportes.reporteCartas({
      periodo, desde: desde ? new Date(`${desde}T00:00:00.000Z`) : undefined,
      hasta: hasta ? new Date(`${hasta}T23:59:59.999Z`) : undefined,
    }, actor);
    await this.emitir('Reporte de cartas', tabla, actor, { periodo, desde, hasta }, formato, respuesta);
  }

  private async emitir(
    nombre: string, tabla: ReporteTabla, actor: Actor, metadatos: Record<string, unknown>,
    formato: string | undefined, respuesta: FastifyReply,
  ): Promise<void> {
    if (formato === 'json') {
      await respuesta.send({ columnas: tabla.columnas, filas: tabla.filas, total: tabla.filas.length });
      return;
    }
    const archivo = await this.reportes.excel(nombre, tabla, actor, metadatos);
    await respuesta
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${archivo.nombreArchivo}"`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Filas', String(archivo.filas))
      .send(archivo.contenido);
  }
}
