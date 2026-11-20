import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  TableroCumplimiento, TableroCumplimientoUseCase,
} from '../../application/use-cases/obligaciones/tablero-cumplimiento.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { CATALOGO_OBLIGACIONES } from '../../domain/entities/obligacion.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Autenticado, Roles } from '../auth/roles.decorator';
import { AuditoriaService } from '../modules/auditoria.service';

@ApiTags('Cumplimiento normativo')
@ApiBearerAuth()
@Controller('cumplimiento')
export class CumplimientoController {
  constructor(
    private readonly tablero: TableroCumplimientoUseCase,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('catalogo')
  @Autenticado()
  @ApiOperation({
    summary: 'Catálogo de obligaciones normativas administradas',
    description: 'Norma, responsable, efecto y descripción de cada obligación.',
  })
  catalogo(): unknown[] {
    return Object.values(CATALOGO_OBLIGACIONES);
  }

  @Get('tablero')
  @Roles(Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.EXTENSION, Rol.TUTOR)
  @ApiOperation({
    summary: 'Tablero de cumplimiento: indicadores, por tipo, requiere atención y listado paginado (alcance G1)',
    description:
      'Una obligación no es una validación sobre un documento: es un estado con fecha límite ' +
      'que puede estar vencido sin que nadie haya cargado nada.',
  })
  @ApiQuery({ name: 'dias', required: false, description: 'Compatibilidad: se acepta y se ignora (el tablero V3 cubre todo el universo).' })
  @ApiQuery({ name: 'periodo', required: false })
  @ApiQuery({ name: 'escuela', required: false })
  @ApiQuery({ name: 'programa', required: false })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'estado', required: false, enum: ['cumplida', 'vencida', 'proxima', 'en_plazo'] })
  @ApiQuery({ name: 'busqueda', required: false })
  @ApiQuery({ name: 'pagina', required: false, example: 1 })
  tableroCumplimiento(
    @ActorActual() actor: Actor,
    @Query('periodo') periodo?: string,
    @Query('escuela') escuela?: string,
    @Query('programa') programa?: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
    @Query('busqueda') busqueda?: string,
    @Query('pagina') pagina?: string,
  ): Promise<TableroCumplimiento> {
    return this.tablero.construir(actor, {
      periodo, escuela, programa, tipo, estado, busqueda, pagina: pagina ? Number(pagina) : undefined,
    });
  }

  @Get('auditoria')
  @Roles(Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Consultar el registro inmutable de auditoría',
    description: 'La tabla no admite UPDATE ni DELETE: ni la aplicación ni el motor lo permiten.',
  })
  @ApiQuery({ name: 'entidad', required: false })
  @ApiQuery({ name: 'entidadId', required: false })
  @ApiQuery({ name: 'limite', required: false, example: 100 })
  consultarAuditoria(
    @Query('entidad') entidad?: string,
    @Query('entidadId') entidadId?: string,
    @Query('limite') limite?: string,
  ): Promise<unknown[]> {
    return this.auditoria.consultar({
      entidad, entidadId, limite: limite ? Number(limite) : 100,
    });
  }
}
