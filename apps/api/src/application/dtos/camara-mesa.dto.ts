import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MotivoDevolucionCamara, RecomendacionCamara } from '../../domain/services/mesa-camara.domain-service';

/** Decisión humana sobre el certificado de Cámara de Comercio, desde la Mesa. Nunca automática. */
export class DecisionCamaraDto {
  @ApiProperty({ enum: ['aprobar', 'devolver', 'rechazar'] })
  @IsIn(['aprobar', 'devolver', 'rechazar']) decision!: 'aprobar' | 'devolver' | 'rechazar';

  @ApiPropertyOptional({
    description: 'Aprobar lo que el sistema no ve consistente, o rechazar lo que sí, exige al menos 40 caracteres; rechazar exige ' +
      'justificación; con el motivo «otro», lo que el estudiante debe corregir.',
  })
  @IsOptional() @IsString() @MaxLength(2000) justificacion?: string;

  @ApiPropertyOptional({ enum: MotivoDevolucionCamara, description: 'Obligatorio al devolver.' })
  @IsOptional() @IsEnum(MotivoDevolucionCamara) motivo?: MotivoDevolucionCamara;

  @ApiPropertyOptional({ description: 'Rechazar cierra la versión: exige confirmación explícita (`true`).' })
  @IsOptional() @IsBoolean() confirmar?: boolean;
}

/** «Tomar siguiente»: filtros opcionales. Sin ellos, el caso de mayor prioridad. */
export class TomarSiguienteCamaraDto {
  @ApiPropertyOptional({ enum: ['si', 'no'] }) @IsOptional() @IsIn(['si', 'no']) conDiscrepancias?: 'si' | 'no';
  @ApiPropertyOptional({ enum: ['si'] }) @IsOptional() @IsIn(['si']) documentoIncorrecto?: 'si';
}

export interface ReservaCamaraDto {
  estado: 'libre' | 'mia' | 'otro' | 'vencida';
  por: string | null;
  hasta: string | null;
  minutosRestantes: number | null;
}

export interface PrioridadCamaraDto { puntaje: number; razones: string[] }

/** Lo que el sistema ve del caso, en lenguaje de quien revisa (sin códigos internos). */
export interface ResumenCamaraDto {
  etiqueta: string;
  nivel: 'ok' | 'atencion' | 'alerta';
  problemaPrincipal: string | null;
}

/**
 * Un caso de la bandeja. Los primeros campos (`practicaId` … `fechaCarga`) son el contrato común que una futura Mesa Documental
 * puede consumir sin conocer el dominio de la Cámara; el resto es propio de esta Mesa.
 */
export interface ItemBandejaCamaraDto {
  // ── contrato común ──
  validacionId: string;
  practicaId: string;
  estudianteId: string;
  documentoId: string;
  tipo: 'camara_comercio';
  /** Estado interno de la validación. */
  estado: string;
  estadoHumano: { etiqueta: string; nivel: 'ok' | 'atencion' | 'alerta' };
  reserva: ReservaCamaraDto;
  problemaPrincipal: string | null;
  fechaCarga: string;
  // ── propios de la Cámara ──
  estudiante: { nombre: string };
  modalidad: string | null;
  /** Empresa o titular de la práctica. */
  empresa: string | null;
  tipoEsperado: string;
  tipoDetectado: string | null;
  tipoCertificado: 'persona_natural' | 'persona_juridica' | null;
  personaDistinta: boolean;
  version: number;
  esReenvio: boolean;
  hayDiscrepancia: boolean;
  representanteDiferente: boolean;
  matriculaCancelada: boolean;
  lecturaDudosa: boolean;
  /** Se leyó por OCR (o de forma híbrida). */
  lecturaOcr: boolean;
  recomendacion: RecomendacionCamara;
  prioridad: PrioridadCamaraDto;
  diasEnBandeja: number;
  datosSipraCambiaronDespuesDeDecision: boolean;
  inconsistenciaOperativa: boolean;
}

export interface ListadoBandejaCamaraDto {
  kpis: {
    abiertas: number; libres: number; mias: number; tomadas: number; porVencer: number; conDiscrepancia: number; documentoIncorrecto: number;
    lecturaDudosa: number; personaDistinta: number;
  };
  total: number;
  items: ItemBandejaCamaraDto[];
}

export interface ResultadoTomarSiguienteCamaraDto { estado: 'tomado' | 'sin_casos'; validacionId: string | null }

export type ResultadoCampoCamaraDto = 'coincide' | 'diferente' | 'informacion_insuficiente' | 'no_aplica' | 'informativo';

/** Una fila CAMPO | SIPRA | CÁMARA | RESULTADO. Los valores se enmascaran si quien mira no tiene el caso tomado. */
export interface CampoComparadoCamaraDto {
  campo: string;
  etiqueta: string;
  sipra: string | null;
  camara: string | null;
  resultado: ResultadoCampoCamaraDto;
  /** Texto para quien revisa: «Coincide», «No coincide», «Información insuficiente», «No aplica». */
  resultadoTexto: string;
  criticidad: 'critico' | 'importante' | 'informativo';
  /** Por qué no se pudo comparar o qué conviene mirar, en lenguaje humano. */
  causa: string | null;
  /** «Leído por OCR · revisar contra el documento» cuando la lectura es dudosa y el campo es crítico. */
  advertencia: string | null;
}

export interface CampoInformativoCamaraDto { campo: string; etiqueta: string; valor: string | null }

export interface DetalleCamaraDto {
  // ── contrato común ──
  validacionId: string;
  practicaId: string;
  estudianteId: string;
  documentoId: string;
  tipo: 'camara_comercio';
  estado: string;
  estadoHumano: { etiqueta: string; nivel: 'ok' | 'atencion' | 'alerta' };
  reserva: ReservaCamaraDto;
  problemaPrincipal: string | null;
  fechaCarga: string;
  // ── propios de la Cámara ──
  version: number;
  vigente: boolean;
  recomendacion: RecomendacionCamara;
  resumen: ResumenCamaraDto;
  prioridad: PrioridadCamaraDto;
  puedeDecidir: boolean;
  /** Aprobar exige justificación reforzada (el sistema no ve el certificado consistente). */
  aprobarExigeJustificacion: boolean;
  minimoJustificacionAprobar: number;
  minimoJustificacionRechazar: number;
  tipoEsperado: string | null;
  tipoDetectado: string | null;
  tipoCertificado: 'persona_natural' | 'persona_juridica' | null;
  /** Qué certificado es, en palabras: matrícula mercantil o existencia y representación. */
  certificado: string | null;
  lectura: { metodo: 'texto' | 'ocr' | null; dudosa: boolean; aviso: string | null };
  estudiante: { nombre: string };
  practica: { empresa: string | null; nit: string | null; modalidad: string | null };
  /** Campos críticos: identificación/NIT, DV y nombre o razón social. */
  criticos: CampoComparadoCamaraDto[];
  /** El representante legal: sección importante (no crítica al nivel de NIT/DV). `null` en persona natural. */
  representante: (CampoComparadoCamaraDto & { aviso: string | null }) | null;
  /** Matrícula, Cámara, fecha de matrícula, domicilio y CIIU: informativos. */
  informativos: CampoInformativoCamaraDto[];
  estadoRegistral: { estado: 'activo' | 'cancelado' | 'otro' | 'no_determinable'; etiqueta: string; alerta: string | null };
  renovacion: { ultimoAnioRenovado: number | null; fechaRenovacion: string | null };
  /** Solo la fecha (y, si algún día hay política institucional, lo que ella diga); nunca «vencido» por antigüedad. */
  expedicion: { fecha: string | null; diasDesdeExpedicion: number | null; politicaDias: number | null; cumplePolitica: boolean | null };
  verificacion: {
    codigoDetectado: boolean; urlDetectada: boolean; firmaPdfPresente: boolean | null;
    /** «Código de verificación disponible hasta …» (no es vigencia del certificado). */
    disponibleHasta: string | null;
    /** Nunca «auténtico»: la autenticidad no se verifica. */
    autenticidad: { estado: string; etiqueta: string; aviso: string };
  };
  comparacion: { veredicto: string | null; calculadaEn: string | null } | null;
  avisoDatosSipra: string | null;
  datosSipraCambiaronEn: string | null;
  decision: { estado: string; por: string | null; en: string; motivo: string | null } | null;
  versiones: { validacionId: string; documentoId: string; version: number; vigente: boolean; estado: string; motivo: string | null; cargadaEn: string; decididaEn: string | null }[];
  historial: { fecha: string; tipo: string; etiqueta: string; resultado: string; ronda: number; actor: string | null }[];
  inconsistenciaOperativa: { estadoDocumento: string; mensaje: string } | null;
}

export interface SupervisionCamaraDto {
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

/** Lo ÚNICO que ve el estudiante de su certificado: estado humano, qué pasó y qué hacer. */
export interface EstadoCamaraEstudianteDto {
  estado: 'pendiente' | 'en_procesamiento' | 'en_revision' | 'necesita_correccion' | 'aprobado' | 'rechazado';
  etiqueta: string;
  que: string;
  hacer: string;
  puedeReenviar: boolean;
}
