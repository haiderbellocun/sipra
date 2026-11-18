import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Matches, MaxLength, Min, MinLength,
} from 'class-validator';
import {
  CicloAcademico, ESTADOS_OPERATIVOS, EstadoOperativo, EstadoPractica, ModalidadPractica, OrigenRegistro, SenalAcompanamiento,
  RESPONSABLES_ARL_PRACTICA, ResponsableArlPractica, TipoRemuneracion,
} from '../../domain/entities/practica.entity';
import { AvanceDocumental } from '../../domain/services/avance-documental.domain-service';
import { CargueEstudianteDto } from './cargue-estudiante.dto';

export class CrearPracticaDto {
  @ApiProperty() @IsUUID() estudianteId!: string;
  @ApiProperty() @IsString() programaId!: string;
  @ApiProperty() @IsString() escuelaId!: string;
  @ApiProperty({ enum: CicloAcademico }) @IsEnum(CicloAcademico) ciclo!: CicloAcademico;
  @ApiProperty({ example: '2026-2' }) @IsString() periodoAcademico!: string;
  @ApiProperty({ enum: ModalidadPractica }) @IsEnum(ModalidadPractica) modalidad!: ModalidadPractica;
  @ApiPropertyOptional() @IsOptional() @IsUUID() empresaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() jefeInmediatoNombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() jefeInmediatoCorreo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fechaInicio?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fechaFin?: string;
}

/**
 * Formulario Único de Registro (SGP, Paso 2). Los datos básicos del estudiante
 * no vienen aquí: se toman de SINU y no son modificables. La modalidad y las
 * fechas quedan fijas una vez registradas.
 */
export class RegistrarPracticaDto {
  @ApiProperty({ example: '2026C' }) @IsString() @MaxLength(12) periodoAcademico!: string;
  @ApiProperty({ enum: ModalidadPractica }) @IsEnum(ModalidadPractica) modalidad!: ModalidadPractica;

  // ── Empresa ──
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) empresaRazonSocial!: string;
  @ApiProperty({ description: 'NIT o identificador tributario. Alfanumérico para empresas extranjeras.' })
  @IsString() @Matches(/^[A-Za-z0-9.-]{4,30}$/, { message: 'El NIT solo admite letras, números, punto y guion' })
  empresaNit!: string;

  // ── Vacante ──
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) area!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) cargo!: string;
  @ApiProperty({ enum: ['remunerada', 'no_remunerada'] })
  @IsEnum(['remunerada', 'no_remunerada'] as never) tipoRemuneracion!: TipoRemuneracion;
  @ApiProperty({
    enum: RESPONSABLES_ARL_PRACTICA,
    description: '¿Quién asume la afiliación a la ARL en esta práctica? La modalidad solo sugiere un valor en el formulario: ' +
      'quien registra lo confirma o lo cambia. El acta de iniciación no lo establece: lo confirma o lo contradice.',
  })
  @IsEnum(RESPONSABLES_ARL_PRACTICA) responsableArl!: ResponsableArlPractica;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) salario?: number;
  @ApiProperty({ example: 'Lunes a viernes, 8:00 a 17:00' }) @IsString() @MaxLength(200) horario!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(150) jefeInmediatoNombre!: string;
  @ApiProperty() @IsString() @MaxLength(120) jefeInmediatoCargo!: string;
  @ApiProperty() @IsEmail() @MaxLength(180) jefeInmediatoCorreo!: string;
  @ApiProperty() @IsString() @MaxLength(40) jefeInmediatoTelefono!: string;
  @ApiProperty() @IsString() @MaxLength(80) ciudad!: string;
  @ApiProperty() @IsString() @MinLength(20) funcionesRelevantes!: string;
  @ApiProperty() @IsDateString() fechaInicio!: string;
  @ApiProperty() @IsDateString() fechaFin!: string;

  @ApiProperty({ description: 'Debe ser true: acepta los términos y condiciones.' })
  @IsBoolean() @Equals(true, { message: 'Debe aceptar los términos y condiciones' })
  aceptaTerminos!: boolean;

  @ApiPropertyOptional({
    description: 'Solo coordinación: documento del estudiante para el registro FUR administrativo.',
  })
  @IsOptional() @IsString() @MaxLength(30) estudianteDocumento?: string;
  @ApiPropertyOptional({
    enum: CicloAcademico,
    description: 'Respaldo cuando SINU no devuelve la matrícula; en operación lo fija SINU.',
  })
  @IsOptional() @IsEnum(CicloAcademico) cicloDeclarado?: CicloAcademico;
}

/** Edición posterior al registro: solo la vacante (SGP, botón de lápiz). */
export class ActualizarVacanteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) area?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) cargo?: string;
  @ApiPropertyOptional({ enum: ['remunerada', 'no_remunerada'] })
  @IsOptional() @IsEnum(['remunerada', 'no_remunerada'] as never) tipoRemuneracion?: TipoRemuneracion;
  @ApiPropertyOptional({
    enum: RESPONSABLES_ARL_PRACTICA,
    description: 'Solo coordinación y administración lo cambian después del registro (el estudiante lo fija al registrar).',
  })
  @IsOptional() @IsEnum(RESPONSABLES_ARL_PRACTICA) responsableArl?: ResponsableArlPractica;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) salario?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) horario?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) jefeInmediatoNombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) jefeInmediatoCargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(180) jefeInmediatoCorreo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) jefeInmediatoTelefono?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) ciudad?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() funcionesRelevantes?: string;
}

/**
 * G5 · Modificación controlada de una práctica registrada (solo coordinación y analista). Lista CERRADA de campos:
 * no hay estado técnico, fechas, periodo, empresa, nota, horas ni ARL verificada. La justificación es obligatoria
 * y `actualizadaEn` (la versión que se editó) evita sobrescribir en silencio un cambio de otra persona.
 */
export class ModificarPracticaDto {
  @ApiPropertyOptional({ enum: ModalidadPractica }) @IsOptional() @IsEnum(ModalidadPractica) modalidad?: ModalidadPractica;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) area?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) cargo?: string;
  @ApiPropertyOptional({ enum: ['remunerada', 'no_remunerada'] })
  @IsOptional() @IsEnum(['remunerada', 'no_remunerada'] as never) tipoRemuneracion?: TipoRemuneracion;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() @Min(0) salario?: number | null;
  @ApiPropertyOptional({ enum: RESPONSABLES_ARL_PRACTICA }) @IsOptional() @IsEnum(RESPONSABLES_ARL_PRACTICA) responsableArl?: ResponsableArlPractica;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) horario?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) jefeInmediatoNombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) jefeInmediatoCargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(180) jefeInmediatoCorreo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) jefeInmediatoTelefono?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) ciudad?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) funcionesRelevantes?: string;
  @ApiProperty({ description: 'Motivo del cambio; queda en la auditoría (mínimo 10 caracteres).' })
  @IsString() @MinLength(10) @MaxLength(1000) justificacion!: string;
  @ApiPropertyOptional({ description: 'Versión que se editó (`gobierno.actualizadaEn`); si la práctica cambió después, 409.' })
  @IsOptional() @IsString() actualizadaEn?: string;
}

/** G5 · Cambio manual de estado OPERATIVO (Inscrito, En práctica, Anulado, Reprobado, Cerrado). */
export class CambiarEstadoOperativoDto {
  @ApiProperty({ enum: ESTADOS_OPERATIVOS }) @IsIn([...ESTADOS_OPERATIVOS]) destino!: EstadoOperativo;
  @ApiProperty({ description: 'Motivo del cambio; queda en la auditoría (mínimo 10 caracteres).' })
  @IsString() @MinLength(10) @MaxLength(1000) justificacion!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actualizadaEn?: string;
}

export class DestinoOperativoDto {
  @ApiProperty({ enum: ESTADOS_OPERATIVOS }) estado!: EstadoOperativo;
  @ApiProperty() etiqueta!: string;
  @ApiProperty() disponible!: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Por qué no está disponible, en lenguaje operativo' }) motivo!: string | null;
}

/** G5 · Gobierno de la práctica en el detalle: estado operativo para todos; acciones solo para quien modifica. */
export class GobiernoPracticaDto {
  @ApiProperty({ enum: ESTADOS_OPERATIVOS }) estadoOperativo!: EstadoOperativo;
  @ApiProperty() etiquetaEstadoOperativo!: string;
  @ApiProperty({ description: 'Versión para el control optimista de las modificaciones' }) actualizadaEn!: string;
  @ApiProperty({ description: 'Solo coordinación y analista modifican la práctica' }) puedeModificar!: boolean;
  @ApiProperty({ type: [DestinoOperativoDto] }) destinos!: DestinoOperativoDto[];
  @ApiProperty({ type: [String], description: 'Asuntos para revisar (p. ej., responsable de la ARL frente a la modalidad)' }) pendientes!: string[];
}

export class TransicionPracticaDto {
  @ApiProperty({ enum: EstadoPractica }) @IsEnum(EstadoPractica) destino!: EstadoPractica;
  @ApiProperty({ description: 'Justificación registrada en auditoría. Obligatoria.' })
  @IsString() @MinLength(10) justificacion!: string;
}

export class RegistrarArlDto {
  @ApiProperty({ description: 'Fecha de afiliación. Debe ser anterior al inicio de la práctica.' })
  @IsDateString() fechaAfiliacion!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() documentoId?: string;
}

export class RegistrarHorasDto {
  @ApiProperty() @IsInt() @Min(0) horas!: number;
}

export class AsignarTutorDto {
  @ApiProperty() @IsUUID() tutorId!: string;
}

export class PracticaRespuestaDto {
  @ApiProperty() id!: string;
  @ApiProperty() estudianteId!: string;
  @ApiProperty() estudianteNombre!: string;
  @ApiProperty() programaId!: string;
  @ApiProperty() escuelaId!: string;
  @ApiProperty({ enum: CicloAcademico }) ciclo!: CicloAcademico;
  @ApiProperty() periodoAcademico!: string;
  @ApiProperty({ enum: ModalidadPractica }) modalidad!: ModalidadPractica;
  @ApiProperty({ enum: EstadoPractica }) estado!: EstadoPractica;
  @ApiProperty({ nullable: true }) tutorId!: string | null;
  @ApiProperty({ nullable: true }) tutorNombre!: string | null;
  @ApiProperty({ nullable: true }) empresaId!: string | null;
  @ApiProperty({ nullable: true }) empresaRazonSocial!: string | null;
  @ApiProperty({ nullable: true }) empresaNit!: string | null;
  @ApiProperty({ nullable: true }) numeroFur!: number | null;
  @ApiProperty({ nullable: true }) regional!: string | null;
  @ApiProperty({ nullable: true }) asignatura!: string | null;
  @ApiProperty({ nullable: true }) area!: string | null;
  @ApiProperty({ nullable: true }) cargo!: string | null;
  @ApiProperty({ nullable: true }) tipoRemuneracion!: TipoRemuneracion | null;
  @ApiProperty({ nullable: true, enum: RESPONSABLES_ARL_PRACTICA, description: 'Quién asume la ARL en esta práctica; null en registros anteriores a este dato.' })
  responsableArl!: ResponsableArlPractica | null;
  @ApiProperty({ nullable: true }) salario!: number | null;
  @ApiProperty({ nullable: true }) horario!: string | null;
  @ApiProperty({ nullable: true }) jefeInmediatoNombre!: string | null;
  @ApiProperty({ nullable: true }) jefeInmediatoCargo!: string | null;
  @ApiProperty({ nullable: true }) jefeInmediatoCorreo!: string | null;
  @ApiProperty({ nullable: true }) jefeInmediatoTelefono!: string | null;
  @ApiProperty({ nullable: true }) ciudad!: string | null;
  @ApiProperty({ nullable: true }) funcionesRelevantes!: string | null;
  @ApiProperty({ nullable: true }) nota!: number | null;
  @ApiProperty() registradaPor!: OrigenRegistro;
  @ApiProperty({ description: 'Equivalente en el SGP: Inscrito, En práctica, Cerrado, Anulado, Reprueba.' })
  estadoSgp!: string;
  @ApiProperty({ description: 'Porcentajes de cargue y aprobación y detalle por momento.' })
  avance!: AvanceDocumental;
  @ApiPropertyOptional({
    type: () => CargueEstudianteDto,
    description: 'G2 · solo en el detalle: estado del cargue del estudiante según la ventana del periodo, calculado en el servidor',
  })
  cargueEstudiante?: CargueEstudianteDto;
  @ApiPropertyOptional({ type: () => GobiernoPracticaDto, description: 'G5 · solo en el detalle' })
  gobierno?: GobiernoPracticaDto;
  @ApiProperty({ nullable: true }) fechaInicio!: string | null;
  @ApiProperty({ nullable: true }) fechaFin!: string | null;
  @ApiProperty({ nullable: true }) horasRegistradas!: number | null;
  @ApiProperty() arlVerificada!: boolean;
  @ApiProperty({ enum: SenalAcompanamiento }) senal!: SenalAcompanamiento;
  @ApiProperty({ type: [String] }) disparadoresSenal!: string[];
  @ApiProperty({ type: [String], description: 'Estados a los que puede transicionar ahora.' })
  transicionesPosibles!: EstadoPractica[];
  @ApiProperty() ultimaActividad!: string;
}
