import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MotivoDevolucionEps } from '../../domain/services/mesa-eps.domain-service';
import { ComparacionTripleDto } from './validacion-eps.dto';

/**
 * DTO de la Mesa operativa de EPS. La Mesa MUESTRA lo que decidieron los casos
 * de uso de las fases anteriores; nada aquí es una decisión automática.
 */

export class KpisMesaDto {
  @ApiProperty({ description: 'Casos abiertos (versión vigente, sin decisión humana).' }) abiertas!: number;
  @ApiProperty({ description: 'Abiertos que nadie tiene tomados.' }) pendientes!: number;
  @ApiProperty({ description: 'Abiertos con una reserva vigente.' }) enRevision!: number;
  @ApiProperty() pendientesAdres!: number;
  @ApiProperty() conDiscrepancias!: number;
  @ApiProperty({ description: 'Candidatos: cumplen todos los criterios, pero decide una persona.' }) candidatos!: number;
  @ApiProperty() asignadosAMi!: number;
  @ApiProperty({ description: 'Mis reservas que vencen en menos de 5 minutos.' }) misPorVencer!: number;
}

export class ReservaMesaDto {
  @ApiProperty({ enum: ['libre', 'mia', 'ajena', 'vencida'] }) estado!: 'libre' | 'mia' | 'ajena' | 'vencida';
  @ApiProperty({ nullable: true }) responsable!: string | null;
  @ApiProperty({ nullable: true }) hasta!: string | null;
}

export class PrioridadDto {
  @ApiProperty() puntaje!: number;
  @ApiProperty({ type: [String], description: 'Cada regla que sumó puntos, con sus puntos.' }) razones!: string[];
}

export class FilaMesaDto {
  @ApiProperty() validacionId!: string;
  @ApiProperty() documentoId!: string;
  @ApiProperty({ description: 'Reducido: nombre y documento enmascarado.' }) estudiante!: { nombre: string; documentoEnmascarado: string };
  @ApiProperty() programa!: string;
  @ApiProperty() modalidad!: string;
  @ApiProperty() periodo!: string;
  @ApiProperty({ nullable: true }) fechaInicioPractica!: string | null;
  @ApiProperty() versionDocumento!: number;
  @ApiProperty() totalVersiones!: number;
  @ApiProperty() recibidaEn!: string;
  @ApiProperty() procesamiento!: string;
  @ApiProperty() autenticidad!: string;
  @ApiProperty() afiliacion!: string;
  @ApiProperty() estadoAdres!: string;
  @ApiProperty() recomendacion!: string;
  @ApiProperty() discrepancias!: { criticas: number; informativas: number };
  @ApiProperty({ enum: ['pendiente', 'candidato_autoaprobacion'] }) decision!: string;
  @ApiProperty({ type: PrioridadDto }) prioridad!: PrioridadDto;
  @ApiProperty({ type: ReservaMesaDto }) reserva!: ReservaMesaDto;
}

export class ListadoMesaDto {
  @ApiProperty({ type: KpisMesaDto }) kpis!: KpisMesaDto;
  @ApiProperty() total!: number;
  @ApiProperty() pagina!: number;
  @ApiProperty() limite!: number;
  /** true si hay más casos abiertos que los que la bandeja carga: se muestran los más antiguos; los KPI usan el total real. */
  @ApiProperty() truncado!: boolean;
  @ApiProperty() mostrando!: number;
  @ApiProperty({ type: [FilaMesaDto] }) filas!: FilaMesaDto[];
  @ApiProperty() filtrosDisponibles!: { periodos: string[]; programas: string[]; modalidades: string[] };
  @ApiProperty() generadoEn!: string;
}

export class DiscrepanciaLegibleDto {
  @ApiProperty({ enum: ['critica', 'informativa', 'insuficiente'] }) severidad!: 'critica' | 'informativa' | 'insuficiente';
  @ApiProperty() campo!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty() explicacion!: string;
}

export class CampoCertificadoDto {
  @ApiProperty() campo!: string;
  @ApiProperty() etiqueta!: string;
  @ApiProperty({ nullable: true }) valor!: string | null;
  @ApiProperty({ enum: ['texto_nativo', 'ocr', 'qr'], nullable: true }) fuente!: string | null;
}

export class EvidenciaMesaDto {
  @ApiProperty() id!: string;
  @ApiProperty() tipo!: string;
  @ApiProperty() fuente!: string;
  @ApiProperty() metodo!: string;
  @ApiProperty() resultado!: string;
  @ApiProperty() fecha!: string;
  @ApiProperty({ nullable: true }) error!: string | null;
}

export class EventoHistorialDto {
  @ApiProperty() fecha!: string;
  @ApiProperty() tipo!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty({ nullable: true }) actor!: string | null;
  @ApiProperty({ nullable: true }) detalle!: string | null;
}

export class VersionCertificadoDto {
  @ApiProperty() documentoId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() cargadoEn!: string;
  @ApiProperty() estado!: string;
  @ApiProperty() esVigente!: boolean;
  @ApiProperty() esEsta!: boolean;
}

export class CondicionRecomendacionDto {
  @ApiProperty() codigo!: string;
  @ApiProperty() titulo!: string;
}

export class RecomendacionMesaDto {
  @ApiProperty() codigo!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty() explicacion!: string;
  @ApiProperty() esDecision!: false;
  /** Las demás condiciones que también aplican, en orden de importancia (la principal es `codigo`). */
  @ApiProperty({ type: [CondicionRecomendacionDto] }) tambien!: CondicionRecomendacionDto[];
}

export class DetalleMesaDto {
  @ApiProperty() caso!: {
    validacionId: string; documentoId: string; practicaId: string;
    estudiante: { nombre: string; documento: string | null; documentoEnmascarado: string };
    programa: string; modalidad: string; periodo: string; fechaInicioPractica: string | null;
    esVersionVigente: boolean; version: number; totalVersiones: number; decision: string; decididoEn: string | null;
  };
  @ApiProperty() acceso!: {
    puedeVerValores: boolean; esMia: boolean; reserva: ReservaMesaDto; puedeDecidir: boolean; puedeConsultarAdres: boolean;
    motivoSinAcceso: string | null;
  };
  @ApiProperty() certificado!: {
    nombreOriginal: string; mime: string; tamanoBytes: number; version: number; cargadoEn: string; estadoDocumento: string;
    metodoExtraccion: 'texto_nativo' | 'ocr' | 'mixto' | 'desconocido'; vigencia: string; campos: CampoCertificadoDto[];
    /** Si el certificado llegó a leerse: sin esto «—» en todos los campos parece un resultado y no una ausencia de lectura. */
    lectura: { estado: 'leida' | 'sin_lectura' | 'pendiente' | 'fallida'; motivo: string | null };
    /** Vigencia explicada: fecha de expedición, antigüedad y regla institucional (días). */
    vigenciaDetalle: { fechaExpedicion: string | null; diasTranscurridos: number | null; diasVigencia: number | null };
  };
  @ApiProperty() autenticidad!: {
    estado: string; metodo: 'verificador_oficial' | 'ninguno'; verificador: string | null; verificadoEn: string | null;
    qrHallados: number; explicacion: string;
  };
  @ApiProperty() afiliacion!: {
    estado: string; fuente: 'adres_bdua' | 'verificador_oficial' | 'ninguna'; consultadoEn: string | null; fuenteActualizadaEn: string | null;
    estadoAdres: string; frescura: { politicaDefinida: boolean; dias: number | null; vencida: boolean | null; diasDesdeConsulta: number | null };
  };
  @ApiProperty({ type: [ComparacionTripleDto] }) comparacion!: ComparacionTripleDto[];
  @ApiProperty({ type: [DiscrepanciaLegibleDto] }) discrepancias!: DiscrepanciaLegibleDto[];
  @ApiProperty({ type: RecomendacionMesaDto }) recomendacion!: RecomendacionMesaDto;
  @ApiProperty() adres!: { estado: string; tipoDocumento: string | null; error: string | null; cargadaEn: string | null };
  @ApiProperty({ type: [EvidenciaMesaDto] }) evidencias!: EvidenciaMesaDto[];
  @ApiProperty({ type: [EventoHistorialDto] }) historial!: EventoHistorialDto[];
  @ApiProperty({ type: [VersionCertificadoDto] }) versiones!: VersionCertificadoDto[];
  @ApiProperty() metricas!: {
    recibidaEn: string | null; primeraRevisionEn: string | null; decididoEn: string | null; horasHastaDecision: number | null; reenvios: number;
  };
  @ApiProperty({ type: PrioridadDto }) prioridad!: PrioridadDto;
  @ApiProperty() retencion!: string;
}

export class TomarSiguienteDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(12) periodo?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(60) programa?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) modalidad?: string;
  @ApiProperty({ required: false, description: 'Solo casos con la afiliación por contrastar con ADRES.' })
  @IsOptional() @IsIn(['pendiente_adres']) enfoque?: 'pendiente_adres';
}

export class ResultadoTomarSiguienteDto {
  @ApiProperty({ enum: ['tomado', 'sin_casos'] }) estado!: 'tomado' | 'sin_casos';
  @ApiProperty({ required: false }) validacionId?: string;
  @ApiProperty({ required: false }) mensaje?: string;
}

export class DecisionMesaDto {
  @ApiProperty({ enum: ['aprobar', 'devolver', 'rechazar'] }) @IsIn(['aprobar', 'devolver', 'rechazar'])
  decision!: 'aprobar' | 'devolver' | 'rechazar';

  @ApiProperty({ required: false, enum: MotivoDevolucionEps, description: 'Obligatorio al devolver: el mensaje que lee el estudiante sale del catálogo.' })
  @IsOptional() @IsEnum(MotivoDevolucionEps)
  motivo?: MotivoDevolucionEps;

  @ApiProperty({
    required: false,
    description:
      'Rechazar exige justificación. Aprobar apartándose de la recomendación del sistema exige una justificación reforzada. ' +
      'Al devolver con motivo «otro» es el texto para el estudiante.',
  })
  @IsOptional() @IsString() @MaxLength(2000)
  justificacion?: string;
}

export class FilaSupervisionDto {
  @ApiProperty() funcionarioId!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() rol!: string;
  @ApiProperty() reservasVigentes!: number;
  @ApiProperty() reservasPorVencer!: number;
  @ApiProperty() decididas7Dias!: number;
  @ApiProperty({ nullable: true }) horasMediasHastaDecision!: number | null;
}

export class SupervisionMesaDto {
  @ApiProperty() abiertas!: number;
  @ApiProperty() sinAsignar!: number;
  @ApiProperty({ nullable: true }) horasMediasHastaPrimeraRevision!: number | null;
  @ApiProperty({ type: [FilaSupervisionDto] }) funcionarios!: FilaSupervisionDto[];
}
