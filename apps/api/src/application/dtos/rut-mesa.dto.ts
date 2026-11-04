import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MotivoDevolucionRut, RecomendacionRut } from '../../domain/services/mesa-rut.domain-service';

/** Decisión humana sobre el RUT, desde la Mesa. Nunca automática. */
export class DecisionRutDto {
  @ApiProperty({ enum: ['aprobar', 'devolver', 'rechazar'] })
  @IsIn(['aprobar', 'devolver', 'rechazar']) decision!: 'aprobar' | 'devolver' | 'rechazar';

  @ApiPropertyOptional({
    description: 'Aprobar un RUT que el sistema no ve consistente, o rechazar uno que sí, exige al menos 40 caracteres; ' +
      'rechazar exige justificación; con el motivo «otro», lo que el estudiante debe corregir.',
  })
  @IsOptional() @IsString() @MaxLength(2000) justificacion?: string;

  @ApiPropertyOptional({ enum: MotivoDevolucionRut, description: 'Obligatorio al devolver.' })
  @IsOptional() @IsEnum(MotivoDevolucionRut) motivo?: MotivoDevolucionRut;
}

/** «Tomar siguiente»: filtros opcionales. Sin ellos, el caso de mayor prioridad. */
export class TomarSiguienteRutDto {
  @ApiPropertyOptional({ enum: ['si', 'no'] }) @IsOptional() @IsIn(['si', 'no']) conDiscrepancias?: 'si' | 'no';
  @ApiPropertyOptional({ enum: ['si'] }) @IsOptional() @IsIn(['si']) documentoIncorrecto?: 'si';
}

export interface ReservaRutDto {
  estado: 'libre' | 'mia' | 'otro' | 'vencida';
  por: string | null;
  hasta: string | null;
  minutosRestantes: number | null;
}

export interface PrioridadRutDto { puntaje: number; razones: string[] }

export interface ItemBandejaRutDto {
  validacionId: string;
  practicaId: string;
  estudiante: { nombre: string };
  empresa: string | null;
  tipoRut: 'persona_natural' | 'persona_juridica' | null;
  /** Lo que el estudiante indicó (tipo de documento cargado) y lo que el sistema detectó en el archivo. */
  tipoEsperado: string;
  tipoDetectado: string | null;
  /** Se compara contra el tipo de persona esperado y salió el otro (natural ↔ jurídica). */
  personaDistinta: boolean;
  version: number;
  esReenvio: boolean;
  estado: string;
  hayDiscrepancia: boolean;
  lecturaDudosa: boolean;
  recomendacion: RecomendacionRut;
  prioridad: PrioridadRutDto;
  reserva: ReservaRutDto;
  recibidaEn: string;
  diasEnBandeja: number;
  datosSipraCambiaronDespuesDeDecision: boolean;
  inconsistenciaOperativa: boolean;
}

export interface ListadoBandejaRutDto {
  kpis: {
    abiertas: number; libres: number; mias: number; tomadas: number; porVencer: number; conDiscrepancia: number; documentoIncorrecto: number;
    lecturaDudosa: number; personaDistinta: number;
  };
  total: number;
  items: ItemBandejaRutDto[];
}

export interface ResultadoTomarSiguienteRutDto { estado: 'tomado' | 'sin_casos'; validacionId: string | null }

/** Una fila de la tabla SIPRA | RUT | RESULTADO. Los valores se enmascaran si quien mira no tiene el caso tomado. */
export interface CampoComparadoRutDto {
  campo: string;
  etiqueta: string;
  sipra: string | null;
  rut: string | null;
  resultado: 'coincide' | 'diferente' | 'informacion_insuficiente' | 'no_aplica' | 'informativo';
  /** Texto para quien revisa; nunca «diferente» cuando en realidad no se pudo comparar. */
  resultadoTexto: string;
  criticidad: 'critico' | 'informativo';
  /** «Leído por OCR · revisar contra el documento» cuando la lectura es dudosa. */
  advertencia: string | null;
}

export interface DetalleRutDto {
  validacionId: string;
  practicaId: string;
  documentoId: string;
  version: number;
  vigente: boolean;
  estado: string;
  recomendacion: RecomendacionRut;
  prioridad: PrioridadRutDto;
  reserva: ReservaRutDto;
  puedeDecidir: boolean;
  tipoEsperado: string | null;
  tipoDetectado: string | null;
  tipoPersona: string | null;
  lectura: { metodo: 'texto' | 'ocr' | null; dudosa: boolean; aviso: string | null };
  /** Solo señales de presencia; NUNCA «RUT auténtico»: la autenticidad sigue sin verificarse. */
  autenticidad: { estado: string; qr: 'detectado' | 'no_determinado'; destinoOficialDian: boolean; aviso: string };
  estudiante: { nombre: string; documento: string | null; documentoEnmascarado: string };
  practica: { empresa: string | null; nit: string | null };
  comparacion: { veredicto: string | null; calculadaEn: string | null; campos: CampoComparadoRutDto[] } | null;
  /** «Los datos de SIPRA cambiaron después de esta validación.» cuando aplica. */
  avisoDatosSipra: string | null;
  datosSipraCambiaronEn: string | null;
  decision: { estado: string; por: string | null; en: string; motivo: string | null } | null;
  versiones: { validacionId: string; documentoId: string; version: number; vigente: boolean; estado: string; motivo: string | null; cargadaEn: string; decididaEn: string | null }[];
  historial: { fecha: string; tipo: string; etiqueta: string; resultado: string; ronda: number; actor: string | null }[];
  inconsistenciaOperativa: { estadoDocumento: string; mensaje: string } | null;
}

export interface SupervisionRutDto {
  abiertas: number;
  libres: number;
  tomadas: number;
  porVencer: number;
  vencidas: number;
  conDiscrepancia: number;
  documentoIncorrecto: number;
  lecturaDudosa: number;
  personaDistinta: number;
  porEstado: Record<string, number>;
  funcionarios: { funcionarioId: string; nombre: string; rol: string; reservasVigentes: number; reservasPorVencer: number; decididas7Dias: number }[];
}

/** Lo ÚNICO que ve el estudiante de su RUT: estado humano, qué pasó y qué hacer. */
export interface EstadoRutEstudianteDto {
  estado: 'pendiente' | 'en_procesamiento' | 'en_revision' | 'necesita_correccion' | 'aprobado' | 'rechazado';
  etiqueta: string;
  que: string;
  hacer: string;
  puedeReenviar: boolean;
}
