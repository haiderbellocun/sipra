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
  @Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION, Rol.TUTOR)
  @ApiOperation({
    summary: 'Tablero de obligaciones próximas a vencer',
    description:
      'Una obligación no es una validación sobre un documento: es un estado con fecha límite ' +
      'que puede estar vencido sin que nadie haya cargado nada.',
  })
  @ApiQuery({ name: 'dias', required: false, example: 60 })
  tableroCumplimiento(
    @ActorActual() actor: Actor,
    @Query('dias') dias?: string,
  ): Promise<TableroCumplimiento> {
    return this.tablero.construir(actor, dias ? Number(dias) : 60);
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
