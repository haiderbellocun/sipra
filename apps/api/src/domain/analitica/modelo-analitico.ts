import { EstadoOperativo } from '../entities/practica.entity';
import { MarcaCalidad, MarcaOrganizacion } from '../historico/calidad-historico';
import { MetricaHistorica } from '../historico/politica-calidad-historico';

/**
 * Capa analítica unificada (H4, §28 de `docs/HISTORICO-PRACTICAS-AUDITORIA.md`).
 *
 * Proyección homogénea de dos fuentes que NUNCA se mezclan físicamente: la operación de SIPRA (`public.practicas`) y
 * el histórico del SGP (`historico.practicas`, solo versiones vigentes de importaciones `completed`). Este módulo es
 * dominio puro: no conoce SQL, tablas, versionado ni HMAC.
 */
export type FuenteAnalitica = 'current' | 'historical' | 'all';
export type OrigenFila = 'current' | 'historical';

/** Dimensión con clave SEGURA (nunca un HMAC ni un documento) y etiqueta mostrable. */
export interface ValorDimension {
  /** Prefijo de espacio + valor: `sinu:ADM-PRO`, `sgp:ADMINISTRACION DE EMPRESAS`, `empresa:<uuid>`, `org-historica:<uuid>`… */
  clave: string;
  etiqueta: string;
}

/**
 * Fila analítica interna. `identidad*` y las marcas viven solo dentro del backend analítico: el contrato hacia
 * Reportes (`ResultadoAnaliticoUnificado`) no las expone.
 */
export interface FilaAnalitica {
  /** Estable y sin PK compartida: `current:<uuid>` o `historical:<sistema>:<#>:<versión>`. */
  analyticsId: string;
  origen: OrigenFila;
  /** `#` del SGP o id de la práctica de SIPRA. */
  idOrigen: string;
  /** Identidad analítica interna del estudiante (resuelta entre fuentes cuando hay clave). Nunca sale del backend. */
  identidadEstudiante: string | null;
  periodo: ValorDimension | null;
  programa: ValorDimension | null;
  nivel: ValorDimension | null;
  regional: ValorDimension | null;
  modalidadEstudio: ValorDimension | null;
  modalidadPractica: ValorDimension | null;
  estado: EstadoOperativo | null;
  /** Fecha a la que se refiere el estado: ahora (SIPRA) o el corte del archivo (SGP). */
  estadoAl: string | null;
  /** El estado es una foto al corte (SGP abierto), no la situación actual. */
  esEstadoDeCorte: boolean;
  organizacion: ValorDimension | null;
  ciudad: ValorDimension | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  duracionDias: number | null;
  /** «Indicador documental SGP»: solo histórico. Nunca se combina con Cumplimiento. */
  documentosSubidosRatio: number | null;
  documentosAprobadosRatio: number | null;
  bitacoraCount: number | null;
  qualityFlags: readonly MarcaCalidad[];
  organizationFlags: readonly MarcaOrganizacion[];
  /** SGP: `#` del representante si la fila es copia idéntica de otra. */
  duplicadoDe: string | null;
  /** Para el cruce de solapamiento (proceso = estudiante + periodo + ciclo). */
  periodoCodigo: string | null;
  ciclo: string | null;
  modalidadCodigo: string | null;
  creadaEn: string | null;
}

export interface FiltroAnaliticoUnificado {
  fuente: FuenteAnalitica;
  periodos?: readonly string[];
  /** Alcance del actor (escuelas). El histórico no tiene escuela: con alcance restringido, el histórico no entra. */
  escuelaIds?: readonly string[];
  programa?: string;
  nivel?: string;
  regional?: string;
  modalidadEstudio?: string;
  modalidadPractica?: string;
  estado?: EstadoOperativo;
  organizacion?: string;
  ciudad?: string;
}

export type CategoriaUnion = 'historical_only' | 'current_only' | 'matched' | 'candidate_overlap' | 'ambiguous_overlap';

export interface ConteoDimension { clave: string; etiqueta: string; origen: OrigenFila | 'comun'; valor: number }
export interface Tasa { numerador: number; denominador: number; valor: number | null }

/** Contrato estable hacia Reportes: sin SQL, sin versionado, sin claves seudónimas ni marcas internas. */
export interface ResultadoAnaliticoUnificado {
  fuente: FuenteAnalitica;
  estadoAl: { current: string | null; historical: string | null };
  totales: {
    practicas: number;
    estudiantesUnicos: number;
    /** `exacta` si la identidad entre fuentes es comparable; `cota_superior` si no hay clave (se cuentan por separado). */
    precisionEstudiantes: 'exacta' | 'cota_superior';
  };
  dimensiones: Record<'periodo' | 'programa' | 'nivel' | 'regional' | 'modalidadEstudio' | 'modalidadPractica' | 'estado' | 'organizacion' | 'ciudad', ConteoDimension[]>;
  tasas: { cierre: Tasa; reprobacion: Tasa; anulacion: Tasa };
  duracion: { casos: number; p25: number | null; mediana: number | null; p75: number | null };
  /** Solo filas del SGP; para `current` es `null`. NO es Cumplimiento. */
  indicadorDocumentalSgp: { casos: number; subidoPromedio: number | null; aprobadoPromedio: number | null } | null;
  /** Solo para `all`: cómo se unieron las fuentes y qué quedó fuera (con motivo). */
  solapamiento: { categorias: Record<CategoriaUnion, number>; excluidosDeAll: Record<string, number> } | null;
  /** Elegibles por métrica según la política de calidad (una sola definición). */
  elegibilidad: Partial<Record<MetricaHistorica, { elegibles: number; excluidos: number }>>;
  advertencias: string[];
}
