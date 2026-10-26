import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
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
  @ApiProperty({ nullable: true, enum: ['verificador_oficial', 'adres_bdua'], description: 'Quién estableció la afiliación.' })
  afiliacionFuente!: string | null;
  @ApiProperty({ description: 'Estado de la consulta ADRES asistida y su comparación triple.' })
  adres!: {
    estado: string; tipoDocumento: string | null; origenTipoDocumento: string | null; consultadoEn: string | null;
    cargadaEn: string | null; fuenteActualizadaEn: string | null; error: string | null; recomendacion: string | null;
    comparacion: ComparacionTripleDto[]; datos: Record<string, unknown> | null;
  };
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

// ── Consulta ADRES asistida ─────────────────────────────────────────────────

export class PrepararConsultaAdresDto {
  @ApiProperty({
    required: false,
    enum: ['CC', 'TI', 'CE', 'PA'],
    description: 'Solo cuando SIPRA no conoce el tipo de documento: lo confirma la persona. Nunca se infiere del número.',
  })
  @IsOptional()
  @IsIn(['CC', 'TI', 'CE', 'PA'])
  tipoDocumento?: string;
}

/** Lo que el frontend necesita para que la persona haga la consulta en el portal oficial. */
export class ConsultaAdresPreparadaDto {
  @ApiProperty({ enum: ['preparada', 'requiere_tipo_documento'] }) estado!: 'preparada' | 'requiere_tipo_documento';
  @ApiProperty({ required: false, description: 'Identificador de UN SOLO USO de la consulta; se devuelve al cargar el resultado.' })
  consultaId?: string;
  @ApiProperty({ required: false }) tipoDocumento?: string;
  @ApiProperty({ required: false, description: 'Solo se devuelve a quien opera el caso; no viaja en ninguna URL.' })
  numeroDocumento?: string;
  @ApiProperty({ required: false, description: 'Portal OFICIAL de ADRES (enlace público; SIPRA no construye ninguna otra URL).' })
  portalUrl?: string;
  @ApiProperty({ required: false }) venceEn?: string;
  @ApiProperty({ required: false, type: [String] }) instrucciones?: string[];
  @ApiProperty({ required: false, type: [String], description: 'Tipos de documento entre los que la persona puede confirmar.' })
  opciones?: string[];
  @ApiProperty({ required: false, nullable: true, description: 'Lo que dice el certificado, solo como sugerencia: no es una fuente válida.' })
  sugerencia?: string | null;
}

export class ComparacionTripleDto {
  @ApiProperty() campo!: string;
  @ApiProperty({ nullable: true }) sipra!: string | null;
  @ApiProperty({ nullable: true }) certificado!: string | null;
  @ApiProperty({ nullable: true }) adres!: string | null;
  @ApiProperty({ enum: ['coincide', 'diferente', 'no_disponible'] }) resultado!: string;
  @ApiProperty({ type: [String] }) conflictos!: string[];
  @ApiProperty() critico!: boolean;
}

export class ResultadoAdresDto {
  @ApiProperty() validacionId!: string;
  @ApiProperty() estadoAdres!: string;
  @ApiProperty() afiliacion!: string;
  @ApiProperty({ nullable: true }) recomendacion!: string | null;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty({ description: 'true si el mismo archivo ya estaba cargado en este caso: no se registró nada nuevo.' }) duplicada!: boolean;
  @ApiProperty({ type: [ComparacionTripleDto] }) comparacion!: ComparacionTripleDto[];
}

export class FilaBandejaAdresDto {
  @ApiProperty() validacionId!: string;
  @ApiProperty() documentoId!: string;
  @ApiProperty({ description: 'Reducido: nombre y documento enmascarado.' }) estudiante!: { nombre: string; documentoEnmascarado: string };
  @ApiProperty({ enum: ['qr_oficial', 'sin_verificar'] }) metodoValidacion!: string;
  @ApiProperty() afiliacion!: string;
  @ApiProperty() estadoAdres!: string;
  @ApiProperty({ nullable: true }) recomendacion!: string | null;
  @ApiProperty({ nullable: true }) responsable!: string | null;
  @ApiProperty({ nullable: true }) reservaHasta!: string | null;
  @ApiProperty() actualizadaEn!: string;
}
