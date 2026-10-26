import { ApiProperty } from '@nestjs/swagger';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DecisionEps, EstadoProcesamientoEps, RutaValidacionEps,
} from '../../domain/entities/validacion-eps.entity';

/**
 * Lo que ve el ESTUDIANTE de la validación de su certificado: el estado del
 * procesamiento y el resultado final. Nada de evidencia interna, datos leídos,
 * discrepancias, ejes de autenticidad o afiliación, ni de quién lo atiende.
 */
export class ValidacionEpsEstudianteDto {
  @ApiProperty() documentoId!: string;
  @ApiProperty({ enum: EstadoProcesamientoEps }) estadoProcesamiento!: EstadoProcesamientoEps;
  @ApiProperty({
    enum: ['pendiente', 'aprobado', 'devuelto', 'rechazado'],
    description: 'La candidatura a autoaprobación es interna: el estudiante ve «pendiente» hasta que una persona decide.',
  })
  resultado!: 'pendiente' | 'aprobado' | 'devuelto' | 'rechazado';
}

export class DiscrepanciaEpsDto {
  @ApiProperty() campo!: string;
  @ApiProperty({ nullable: true }) esperado!: string | null;
  @ApiProperty({ nullable: true }) observado!: string | null;
  @ApiProperty() resultado!: string;
}

/** Vista de quien opera la validación (auxiliar, coordinación, administración). */
export class ValidacionEpsOperacionDto {
  @ApiProperty() id!: string;
  @ApiProperty() documentoId!: string;
  @ApiProperty() practicaId!: string;
  @ApiProperty({ enum: EstadoProcesamientoEps }) estadoProcesamiento!: EstadoProcesamientoEps;
  @ApiProperty({ enum: AutenticidadEps }) autenticidad!: AutenticidadEps;
  @ApiProperty({ enum: CoincidenciaEps }) coincidencia!: CoincidenciaEps;
  @ApiProperty({ enum: AfiliacionEps }) afiliacion!: AfiliacionEps;
  @ApiProperty({ enum: RutaValidacionEps }) ruta!: RutaValidacionEps;
  @ApiProperty({ enum: DecisionEps }) decision!: DecisionEps;
  @ApiProperty() vigenciaCertificado!: string;
  @ApiProperty({ nullable: true, description: 'Lo que el certificado DICE (normalizado). No es una verificación.' })
  datosExtraidos!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, description: 'Lo que una fuente oficial CONFIRMÓ. Vacío hasta que existan verificadores.' })
  datosVerificados!: Record<string, unknown> | null;
  @ApiProperty({ type: [DiscrepanciaEpsDto] }) discrepancias!: DiscrepanciaEpsDto[];
  @ApiProperty({ nullable: true }) asignadoA!: string | null;
  @ApiProperty({ nullable: true }) reservaHasta!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty() actualizadaEn!: string;
}

export class EvidenciaEpsDto {
  @ApiProperty() id!: string;
  @ApiProperty() tipo!: string;
  @ApiProperty() fuente!: string;
  @ApiProperty() metodo!: string;
  @ApiProperty() resultado!: string;
  @ApiProperty() fechaVerificacion!: string;
  @ApiProperty({ nullable: true }) origen!: string | null;
  @ApiProperty() datosObtenidos!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) errorCodigo!: string | null;
  @ApiProperty({ nullable: true }) verificadoPor!: string | null;
}
