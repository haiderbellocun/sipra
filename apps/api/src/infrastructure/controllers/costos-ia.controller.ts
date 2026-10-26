import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { ActorActual } from '../auth/actor.decorator';
import {
  ConfiguracionIa, CostosIaUseCase, ResumenGastoIa,
} from '../../application/use-cases/administracion/costos-ia.use-case';
import { TarifaModelo } from '../../domain/entities/tarifas-ia';
import {
  ComparativaModelo, EstimacionPorEstudiante, SupuestosEstimacion,
} from '../../domain/services/costos-ia.domain-service';
import { Rol } from '../../domain/value-objects/rol.vo';
import { Roles } from '../auth/roles.decorator';

/** Parámetros de consulta validados: nada de arreglos inesperados ni números absurdos. */
export class AjustesEstimacionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) modelo?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(10) factorReenvios?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100_000) tokensTextoPorPagina?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100_000) tokensRazonamiento?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(100_000) tokensRespuesta?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(32) @Max(10_000) anchoPaginaPx?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(32) @Max(10_000) altoPaginaPx?: number;
}

export class FiltroResumenCostosDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) periodo?: string;
  @ApiPropertyOptional({ description: 'Fecha ISO inclusive' }) @IsOptional() @IsISO8601() desde?: string;
  @ApiPropertyOptional({ description: 'Fecha ISO exclusive' }) @IsOptional() @IsISO8601() hasta?: string;
}

/**
 * Costos de la lectura asistida: tarifas vigentes, estimación por estudiante y
 * gasto real. Lo consultan administración y coordinación; el estudiante no
 * tiene nada que ver aquí.
 */
@ApiTags('Costos de IA')
@ApiBearerAuth()
@Controller('costos-ia')
@Roles(Rol.ADMINISTRADOR, Rol.COORDINADOR)
export class CostosIaController {
  constructor(private readonly costos: CostosIaUseCase) {}

  @Get('configuracion')
  @ApiOperation({ summary: 'Proveedor, modelo, esfuerzo y tope diario vigentes' })
  configuracion(): Promise<ConfiguracionIa> {
    return this.costos.configuracion();
  }

  @Get('tarifas')
  @ApiOperation({ summary: 'Tabla de tarifas por modelo (USD por millón de tokens) y su vigencia' })
  tarifas(): readonly TarifaModelo[] {
    return this.costos.tarifas();
  }

  @Get('estimacion')
  @ApiOperation({
    summary: 'Costo estimado por estudiante y modalidad para un modelo',
    description:
      'Aplica la matriz documental de cada modalidad, páginas típicas por tipo, la regla de ' +
      'tokens por imagen del proveedor y la tarifa vigente. Los supuestos se devuelven con el ' +
      'resultado y se pueden ajustar por consulta.',
  })
  estimacion(@Query() consulta: AjustesEstimacionDto): EstimacionPorEstudiante {
    const estimacion = this.costos.estimacion(consulta.modelo, ajustesDe(consulta));
    if (!estimacion) throw new BadRequestException(`El modelo "${consulta.modelo}" no está en la tabla de tarifas`);
    return estimacion;
  }

  @Get('comparativa')
  @ApiOperation({ summary: 'La misma estimación para todos los modelos de la tabla, del más barato al más caro' })
  comparativa(@Query() consulta: AjustesEstimacionDto): ComparativaModelo[] {
    return this.costos.comparativa(ajustesDe(consulta));
  }

  @Get('resumen')
  @ApiOperation({
    summary: 'Gasto real registrado por el pipeline: totales, por modelo, tipo, modalidad, periodo y estudiante',
  })
  resumen(@Query() filtro: FiltroResumenCostosDto, @ActorActual() actor: Actor): Promise<ResumenGastoIa> {
    const desde = fecha(filtro.desde, 'desde');
    const hasta = fecha(filtro.hasta, 'hasta');
    if (desde && hasta && desde > hasta) throw new BadRequestException('«desde» no puede ser posterior a «hasta»');
    return this.costos.resumen({ periodoAcademico: filtro.periodo?.trim() || undefined, desde, hasta }, actor);
  }
}

/** Solo los supuestos numéricos; el modelo va aparte. */
function ajustesDe(consulta: AjustesEstimacionDto): Partial<SupuestosEstimacion> {
  const ajustes: Partial<SupuestosEstimacion> = {};
  if (consulta.factorReenvios !== undefined) ajustes.factorReenvios = consulta.factorReenvios;
  if (consulta.tokensTextoPorPagina !== undefined) ajustes.tokensTextoPorPagina = consulta.tokensTextoPorPagina;
  if (consulta.tokensRazonamiento !== undefined) ajustes.tokensRazonamiento = consulta.tokensRazonamiento;
  if (consulta.tokensRespuesta !== undefined) ajustes.tokensRespuesta = consulta.tokensRespuesta;
  if (consulta.anchoPaginaPx !== undefined) ajustes.anchoPaginaPx = consulta.anchoPaginaPx;
  if (consulta.altoPaginaPx !== undefined) ajustes.altoPaginaPx = consulta.altoPaginaPx;
  return ajustes;
}

/**
 * Una fecha sin hora («2026-10-01») es un día de Colombia, no medianoche UTC:
 * se interpreta como las 00:00 de Bogotá (UTC−5). Con hora explícita se
 * respeta tal cual.
 */
function fecha(valor: string | undefined, nombre: string): Date | undefined {
  if (!valor?.trim()) return undefined;
  const texto = valor.trim();
  const f = new Date(/^\d{4}-\d{2}-\d{2}$/.test(texto) ? `${texto}T00:00:00-05:00` : texto);
  if (Number.isNaN(f.getTime())) throw new BadRequestException(`El parámetro ${nombre} no es una fecha válida`);
  return f;
}
