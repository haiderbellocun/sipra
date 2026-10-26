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
  @ApiProperty({ required: false, enum: ['certificado_vs_interno', 'oficial_vs_certificado', 'oficial_vs_interno'] })
  comparacion?: string;
  @ApiProperty({ required: false, nullable: true }) interno?: string | null;
  @ApiProperty({ required: false, nullable: true }) certificado?: string | null;
  @ApiProperty({ required: false, nullable: true }) oficial?: string | null;
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
  @ApiProperty({
    enum: ['qr_oficial', 'sin_verificar'],
    description: 'Cómo se validó: «qr_oficial» solo si un verificador oficial registrado dio un resultado definitivo.',
  })
  metodoValidacion!: 'qr_oficial' | 'sin_verificar';
  @ApiProperty({ nullable: true, description: 'Verificador oficial que respalda la autenticidad o la afiliación.' })
  verificador!: string | null;
  @ApiProperty({ nullable: true, description: 'Cuándo se obtuvo el último resultado definitivo del verificador.' })
  verificadoEn!: string | null;
  @ApiProperty({ nullable: true, description: 'Código del último intento que no concluyó (portal caído, sin QR…).' })
  verificacionError!: string | null;
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
