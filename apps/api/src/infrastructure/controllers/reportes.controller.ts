import { BadRequestException, Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  GenerarReporteSpeUseCase, ReporteBloqueadoError,
} from '../../application/use-cases/reportes/generar-reporte-spe.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  CATALOGO_REPOSITORY, CatalogoRepositoryPort, EstadoCatalogo,
} from '../../domain/ports/out/repositorios.port';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Reportes regulatorios')
@ApiBearerAuth()
@Controller('reportes')
export class ReportesController {
  constructor(
    private readonly generar: GenerarReporteSpeUseCase,
    @Inject(CATALOGO_REPOSITORY) private readonly catalogos: CatalogoRepositoryPort,
  ) {}

  @Get('catalogos')
  @Roles(Rol.ADMINISTRADOR, Rol.EXTENSION, Rol.COORDINADOR)
  @ApiOperation({
    summary: 'Estado de los catálogos oficiales',
    description:
      'Un archivo con códigos fuera de la nomenclatura oficial se radica, queda en firme y ' +
      'luego hay que corregirlo ante la entidad. Por eso los reportes quedan bloqueados en ' +
      'preproducción y producción mientras un catálogo requerido siga incompleto.',
  })
  estadoCatalogos(): Promise<EstadoCatalogo[]> {
    return this.catalogos.estados();
  }

  @Get('spe/vacantes')
  @Roles(Rol.ADMINISTRADOR, Rol.EXTENSION)
  @ApiOperation({
    summary: 'Archivo diario de vacantes para la Unidad del SPE',
    description:
      'Solo entran las vacantes en marco laboral. Las de marco práctica son un requisito ' +
      'académico, no constituyen intermediación laboral y no se reportan.',
  })
  @ApiQuery({ name: 'fecha', required: false, example: '2026-08-28' })
  @ApiResponse({ status: 200, description: 'Archivo plano con separador |$$|' })
  vacantes(
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
    @Query('fecha') fecha?: string,
  ): Promise<void> {
    return this.emitir(() => this.generar.vacantes(actor, this.aFecha(fecha)), respuesta);
  }

  @Get('spe/plazas')
  @Roles(Rol.ADMINISTRADOR, Rol.EXTENSION)
  @ApiOperation({
    summary: 'Archivo diario de plazas de práctica para la Unidad del SPE',
    description: 'Obligación derivada de la Ley 1780 de 2016, artículo 17.',
  })
  @ApiQuery({ name: 'fecha', required: false, example: '2026-08-28' })
  plazas(
    @ActorActual() actor: Actor,
    @Res() respuesta: FastifyReply,
    @Query('fecha') fecha?: string,
  ): Promise<void> {
    return this.emitir(() => this.generar.plazas(actor, this.aFecha(fecha)), respuesta);
  }

  private aFecha(valor?: string): Date {
    if (!valor) return new Date();
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) throw new BadRequestException('Fecha no válida');
    return fecha;
  }

  private async emitir(
    generar: () => Promise<{
      archivo: { nombre: string; contenido: string; registros: number; hash: string };
      esBorrador: boolean;
      advertencias: string[];
    }>,
    respuesta: FastifyReply,
  ): Promise<void> {
    try {
      const { archivo, esBorrador, advertencias } = await generar();
      await respuesta
        .header('content-type', 'text/plain; charset=utf-8')
        .header('content-disposition', `attachment; filename="${archivo.nombre}"`)
        // El hash viaja en la respuesta: es lo que se conserva con el acuse
        // para poder demostrar después qué archivo exacto se envió.
        .header('x-sipra-hash', archivo.hash)
        .header('x-sipra-registros', String(archivo.registros))
        .header('x-sipra-radicable', String(!esBorrador && advertencias.length === 0))
        .header('cache-control', 'no-store')
        .send(archivo.contenido);
    } catch (error) {
      if (error instanceof ReporteBloqueadoError) {
        throw new BadRequestException({
          mensaje: error.message,
          catalogos: error.catalogos,
        });
      }
      throw error;
    }
  }
}
