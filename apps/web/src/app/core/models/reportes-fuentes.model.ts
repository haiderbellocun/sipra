/** Contrato de `GET /reportes/analitica/unificada` (H5): Reportes V3 por fuente. Sin claves seudónimas, documentos ni marcas internas. */
export type FuenteReporte = 'current' | 'historical' | 'all';
export type DimensionFuente = 'periodo' | 'programa' | 'nivel' | 'regional' | 'modalidadEstudio' | 'modalidadPractica' | 'estado' | 'organizacion' | 'ciudad';
export type EstadoAnalitico = 'inscrito' | 'en_practica' | 'cerrado' | 'reprobado' | 'anulado';
export type CategoriaUnion = 'historical_only' | 'current_only' | 'matched' | 'candidate_overlap' | 'ambiguous_overlap';
export interface ConteoFuente { clave: string; etiqueta: string; origen: 'current' | 'historical' | 'comun'; valor: number }
export interface TasaFuente { numerador: number; denominador: number; valor: number | null }

/** Cruce comparable (en prácticas) para dibujar Histórico y Todos con las mismas gráficas que Actual. */
export type CruceFuente = 'periodoPrograma' | 'periodoModalidad' | 'modalidadEstado';
export interface CeldaCruceFuente { fila: string; filaEtiqueta: string; columna: string; columnaEtiqueta: string; valor: number; origen: 'current' | 'historical' | 'comun' }
export interface PeriodoPorFuente { clave: string; etiqueta: string; current: number; historical: number }

export interface ReporteFuentes {
  fuente: FuenteReporte;
  generadoEn: string;
  cruces: Record<CruceFuente, CeldaCruceFuente[]>;
  periodoPorFuente: PeriodoPorFuente[];
  estadoAl: { current: string | null; historical: string | null };
  totales: { practicas: number; estudiantesUnicos: number; precisionEstudiantes: 'exacta' | 'cota_superior' };
  dimensiones: Record<DimensionFuente, ConteoFuente[]>;
  tasas: { cierre: TasaFuente; reprobacion: TasaFuente; anulacion: TasaFuente };
  duracion: { casos: number; p25: number | null; mediana: number | null; p75: number | null };
  indicadorDocumentalSgp: { casos: number; subidoPromedio: number | null; aprobadoPromedio: number | null } | null;
  solapamiento: { categorias: Record<CategoriaUnion, number>; excluidosDeAll: Record<string, number> } | null;
  elegibilidad: Record<string, { elegibles: number; excluidos: number }>;
  advertencias: string[];
  cobertura: {
    actual: { desde: string | null; hasta: string | null } | null;
    historico: { desde: string | null; corte: string | null; publicadoEn: string } | null;
    historicoFueraDeAlcance: number;
    historicoSinEquivalenciaPrograma: number;
  };
}
