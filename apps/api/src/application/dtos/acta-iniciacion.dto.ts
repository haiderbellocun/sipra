import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RESPONSABLES_ARL_PRACTICA, ResponsableArlPractica } from '../../domain/entities/practica.entity';
import { MotivoDevolucionActa } from '../../domain/services/mesa-acta.domain-service';

/** Decisión humana sobre el acta, desde la Mesa. Nunca automática. */
export class DecisionActaDto {
  @ApiProperty({ enum: ['aprobar', 'devolver', 'rechazar'] })
  @IsIn(['aprobar', 'devolver', 'rechazar']) decision!: 'aprobar' | 'devolver' | 'rechazar';

  @ApiPropertyOptional({
    description: 'Aprobar con una discrepancia crítica (o contra la recomendación del sistema) exige al menos 40 caracteres; ' +
      'rechazar exige justificación; con el motivo «otro», lo que el estudiante debe corregir.',
  })
  @IsOptional() @IsString() @MaxLength(2000) justificacion?: string;

  @ApiPropertyOptional({ enum: MotivoDevolucionActa, description: 'Obligatorio al devolver.' })
  @IsOptional() @IsEnum(MotivoDevolucionActa) motivo?: MotivoDevolucionActa;
}

/** «Tomar siguiente»: filtros opcionales. Sin ellos, el caso de mayor prioridad. */
export class TomarSiguienteActaDto {
  @ApiPropertyOptional({ enum: ['si', 'no'] }) @IsOptional() @IsIn(['si', 'no']) conDiscrepancias?: 'si' | 'no';
  @ApiPropertyOptional({ enum: ['si'] }) @IsOptional() @IsIn(['si']) documentoIncorrecto?: 'si';
}

/**
 * Corrección controlada de los datos de la práctica que gobiernan la comparación con el acta. Solo coordinación y
 * administración, con justificación. No modifica el acta ni una decisión ya tomada.
 */
export class CorregirDatosPracticaDto {
  @ApiPropertyOptional({ enum: ['remunerada', 'no_remunerada'] })
  @IsOptional() @IsIn(['remunerada', 'no_remunerada']) tipoRemuneracion?: 'remunerada' | 'no_remunerada';

  @ApiPropertyOptional({ enum: RESPONSABLES_ARL_PRACTICA })
  @IsOptional() @IsIn([...RESPONSABLES_ARL_PRACTICA]) responsableArl?: ResponsableArlPractica;

  @ApiProperty({ description: 'Por qué se corrige. Queda en la auditoría junto con el valor anterior y el nuevo (mínimo 10 caracteres).' })
  @IsString() @MinLength(10) @MaxLength(2000) justificacion!: string;
}

// ── Respuestas (la forma la fija el caso de uso; se documentan como objetos) ─

export interface ReservaActaDto {
  estado: 'libre' | 'mia' | 'otro' | 'vencida';
  por: string | null;
  hasta: string | null;
  minutosRestantes: number | null;
}

export interface PrioridadActaDto { puntaje: number; razones: string[] }

export interface ItemBandejaActaDto {
  validacionId: string;
  practicaId: string;
  estudiante: { nombre: string };
  empresa: string | null;
  modalidad: string;
  fechaInicio: string | null;
  version: number;
  esReenvio: boolean;
  estado: string;
  tipoActa: string | null;
  remuneracionActa: string | null;
  responsableArlActa: string | null;
  firmaEmpresa: string | null;
  firmaPracticante: string | null;
  hayDiscrepanciaCritica: boolean;
  recomendacion: string;
  prioridad: PrioridadActaDto;
  reserva: ReservaActaDto;
  recibidaEn: string | null;
  diasEnBandeja: number | null;
  datosPracticaCambiaronDespuesDeDecision: boolean;
}

export interface ListadoBandejaActaDto {
  kpis: { abiertas: number; libres: number; mias: number; conDiscrepanciaCritica: number; documentoIncorrecto: number };
  total: number;
  items: ItemBandejaActaDto[];
}

export interface CampoComparadoDto {
  campo: string;
  etiqueta: string;
  sipra: string | null;
  acta: string | null;
  resultado: string;
  criticidad: string;
  nota: string | null;
}

export interface DetalleActaDto {
  validacionId: string;
  practicaId: string;
  documentoId: string;
  version: number;
  vigente: boolean;
  estado: string;
  recomendacion: string;
  prioridad: PrioridadActaDto;
  reserva: ReservaActaDto;
  puedeDecidir: boolean;
  estudiante: { nombre: string; documento: string | null; documentoEnmascarado: string; programa: string | null };
  practica: { empresa: string | null; nit: string | null; modalidad: string; fechaInicio: string | null; fechaFin: string | null };
  /** Lo que SIPRA tiene como sugerencia por modalidad, SOLO informativo: no es el dato de la práctica. */
  responsableArlSugeridoPorModalidad: string | null;
  resumen: {
    clasificacion: string | null;
    remuneracionSipra: string | null;
    remuneracionActa: string | null;
    responsableArlSipra: string | null;
    responsableArlActa: string | null;
    firmaEmpresa: string | null;
    firmaPracticante: string | null;
  };
  comparacion: {
    veredicto: string | null;
    comparadaEn: string | null;
    /** `false` = los datos de la práctica cambiaron y la comparación guardada ya no corresponde a lo que SIPRA dice hoy. */
    vigente: boolean;
    campos: CampoComparadoDto[];
    discrepancias: { campo: string; codigo: string; severidad: string; mensaje: string }[];
  } | null;
  datosPracticaCambiaronDespuesDeDecision: string | null;
  decision: { estado: string; por: string | null; en: string | null; motivo: string | null } | null;
  versiones: {
    validacionId: string; documentoId: string; version: number; vigente: boolean; estado: string;
    tipoActa: string | null; cargadaEn: string | null; decididaEn: string | null;
  }[];
  /** Eventos de ESTA versión (no se mezclan con los de otras). Códigos y resultados; nunca el texto del documento. */
  historial: { fecha: string; tipo: string; etiqueta: string; resultado: string; ronda: number; actor: string | null }[];
}

export interface ResultadoTomarSiguienteActaDto {
  estado: 'tomado' | 'sin_casos';
  validacionId: string | null;
}

export interface SupervisionActaDto {
  abiertas: number;
  libres: number;
  tomadas: number;
  porVencer: number;
  vencidas: number;
  porEstado: Record<string, number>;
  conDiscrepanciaCritica: number;
  documentoIncorrecto: number;
  funcionarios: {
    funcionarioId: string; nombre: string; rol: string; reservasVigentes: number; reservasPorVencer: number; decididas7Dias: number;
  }[];
}

/** Lo que ve el ESTUDIANTE: estados humanos, qué ocurrió y qué hacer. Ningún nombre interno ni código. */
export interface EstadoActaEstudianteDto {
  practicaId: string;
  estado: string;
  etiqueta: string;
  que: string;
  hacer: string;
  puedeReenviar: boolean;
  versionActual: number | null;
  versiones: { version: number; etiqueta: string; cargadaEn: string }[];
}

export interface CorreccionDatosPracticaRespuestaDto {
  practicaId: string;
  tipoRemuneracion: string | null;
  responsableArl: string | null;
  /** Qué pasó con la comparación del acta: recalculada, marcada como posterior a la decisión, sin cálculo o sin acta. */
  actaIniciacion: 'sin_acta' | 'sin_calculo' | 'recalculada' | 'marcada_posterior_a_decision' | 'sin_cambios';
}
