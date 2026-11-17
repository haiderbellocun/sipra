import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoDocumento } from '../../domain/entities/documento.entity';
import { EstadoCargueEstudiante } from '../../domain/entities/periodo.entity';

export class SubsanacionCargueDto {
  @ApiProperty({ enum: TipoDocumento }) tipo!: TipoDocumento;
  @ApiProperty({ description: 'Último día (inclusivo) para cargar una nueva versión de este tipo' }) vence!: string;
  @ApiProperty({ enum: ['devolucion', 'bitacora'] }) origen!: 'devolucion' | 'bitacora';
}

/** Proyección del cargue del estudiante: la interfaz la muestra tal cual, sin recalcular reglas. */
export class CargueEstudianteDto {
  @ApiProperty({ description: 'Cargue ordinario permitido hoy' }) permitido!: boolean;
  @ApiProperty({ enum: EstadoCargueEstudiante }) estado!: EstadoCargueEstudiante;
  @ApiPropertyOptional({ nullable: true }) desde!: string | null;
  @ApiPropertyOptional({ nullable: true }) hasta!: string | null;
  @ApiProperty() mensaje!: string;
  @ApiProperty({ type: [SubsanacionCargueDto], description: 'Excepciones por tipo; solo aplican con la ventana cerrada por fecha' })
  subsanaciones!: SubsanacionCargueDto[];
}

