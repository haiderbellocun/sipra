import { EstadoOperativo } from '../../entities/practica.entity';
import { Agregados } from '../../analitica/serving-analitico';
import { SistemaOrigen } from '../../historico/registro-historico';
import { MetricaHistorica } from '../../historico/politica-calidad-historico';

export const SERVING_HISTORICO_LECTURA = Symbol('SERVING_HISTORICO_LECTURA');

/** Fila del serving: proyección derivada de una versión vigente del SGP (sin datos personales; identidad seudónima). */
export interface FilaServing {
  analyticsId: string;
  sourceRecordId: string;
  studentKey: string | null;
  hmacKeyVersion: string;
  escuelaId: string | null;
  periodoClave: string | null; periodoEtiqueta: string | null; periodoCodigo: string | null;
  programaClave: string | null; programaEtiqueta: string | null; programaMapeado: boolean;
  nivel: string | null;
  regionalClave: string | null; regionalEtiqueta: string | null;
  modalidadEstudioClave: string | null; modalidadEstudioEtiqueta: string | null;
  modalidadPracticaClave: string | null; modalidadPracticaEtiqueta: string | null; modalidadCodigo: string | null;
  estado: EstadoOperativo | null; esEstadoDeCorte: boolean; estadoAl: string | null;
  organizacionClave: string | null; organizacionEtiqueta: string | null;
  ciudadClave: string | null; ciudadEtiqueta: string | null;
  fechaInicio: string | null; fechaFin: string | null; fechaCreacion: string | null; duracionDias: number | null;
  documentosSubidosRatio: number | null; documentosAprobadosRatio: number | null;
  /** Elegibilidad por métrica ya resuelta con la política H3 (columnas `e_*`). */
  elegible: Partial<Record<MetricaHistorica, boolean>>;
}

export interface FiltroServing {
  sistema: SistemaOrigen;
  periodos?: readonly string[];
  /** Alcance efectivo por escuelas (G1 ∩ filtro). `undefined` = sin restricción. Sin equivalencia, ningún registro SGP tiene escuela. */
  escuelaIds?: readonly string[];
  programa?: string; nivel?: string; regional?: string; modalidadEstudio?: string; modalidadPractica?: string;
  estado?: EstadoOperativo; organizacion?: string; ciudad?: string;
  /** Registros SGP con correspondencia CONFIRMADA hacia una práctica actual del universo (salen de ALL). */
  excluirRegistros: readonly string[];
  /** `versión:clave` de los estudiantes actuales del universo (identidad común, solo en ALL; nunca sale del backend). */
  clavesEstudiantesActuales: readonly string[];
}

/** Registro histórico de un estudiante que también está en SIPRA: insumo mínimo para el diagnóstico de solapamiento. */
export interface FilaSolape {
  analyticsId: string; identidad: string; periodoCodigo: string | null; nivel: string | null; modalidadCodigo: string | null;
  fechaInicio: string | null; fechaFin: string | null; estado: EstadoOperativo | null; fechaCreacion: string | null;
}

export interface AgregadosServing extends Agregados {
  /** Identidades históricas (de la base filtrada) que coinciden con estudiantes actuales del universo. */
  estudiantesCompartidos: number;
  versionesClave: string[];
  solape: FilaSolape[];
  publicacion: { version: string; corte: string | null; desde: string | null; publicadoEn: string };
  cobertura: { excluidosPorAlcance: number; sinEquivalenciaPrograma: number };
}

export class ServingHistoricoNoDisponibleError extends Error {
  constructor(motivo: string) {
    super(`SERVING_HISTORICO_NO_DISPONIBLE: ${motivo}`);
    this.name = 'ServingHistoricoNoDisponibleError';
  }
}

export interface ServingHistoricoLecturaPort {
  /** Agregados de la versión PUBLICADA; lanza `ServingHistoricoNoDisponibleError` si no hay o no se puede leer. */
  agregados(f: FiltroServing): Promise<AgregadosServing>;
}

export interface ServingHistoricoEscrituraPort {
  /** Construir → validar → publicar (puntero atómico). Nunca deja una versión a medias visible. */
  publicar(sistema: SistemaOrigen, filas: readonly FilaServing[], meta: { corte: string | null; desde: string | null; practicasEsperadas: number }): Promise<{ version: string; filas: number }>;
}
