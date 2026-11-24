import { elegibleAnalitica } from '../../../domain/analitica/analitica-unificada.service';
import { METRICAS_SERVING } from '../../../domain/analitica/serving-analitico';
import { SistemaOrigen } from '../../../domain/historico/registro-historico';
import { LecturaAnaliticaUnificadaPort } from '../../../domain/ports/out/analitica-unificada.port';
import { FilaServing, ServingHistoricoEscrituraPort } from '../../../domain/ports/out/serving-analitico.port';
import { proyectarFilaHistorica } from './analitica-unificada.use-case';

/**
 * Construye y publica el serving del histórico (H5, §29): lee las versiones vigentes de importaciones `completed`
 * (lectura H4), las proyecta al modelo común con las MISMAS funciones de H4 y resuelve la elegibilidad por métrica con la
 * política H3. Se ejecuta desde la CLI con el rol de carga, al publicar o revertir una importación; la API nunca escribe.
 */
export class ConstruirServingHistoricoUseCase {
  constructor(
    private readonly lectura: LecturaAnaliticaUnificadaPort,
    private readonly escritura: ServingHistoricoEscrituraPort,
    /** Escuela de un programa con equivalencia SINU confirmada (hoy ninguno: el histórico no se atribuye a escuelas). */
    private readonly escuelaDePrograma: (codigoSinu: string) => string | null = () => null,
  ) {}

  async ejecutar(sistema: SistemaOrigen): Promise<{ version: string; filas: number; practicas: number }> {
    const crudas = await this.lectura.practicasHistoricas({ sistema });
    let practicas = 0;
    let corte: string | null = null;
    let desde: string | null = null;
    const filas: FilaServing[] = crudas.map((h) => {
      const f = proyectarFilaHistorica(h, sistema, null);
      const elegible: FilaServing['elegible'] = {};
      for (const m of METRICAS_SERVING) elegible[m] = elegibleAnalitica(f, m);
      if (elegible.practicas) practicas += 1;
      if (h.estadoFechaCorte && (!corte || h.estadoFechaCorte > corte)) corte = h.estadoFechaCorte;
      if (h.fechaCreacion && (!desde || h.fechaCreacion < desde)) desde = h.fechaCreacion;
      return {
        analyticsId: f.analyticsId, sourceRecordId: h.sourceRecordId, studentKey: h.studentKey, hmacKeyVersion: h.hmacKeyVersion,
        escuelaId: h.codigoSinu ? this.escuelaDePrograma(h.codigoSinu) : null,
        periodoClave: f.periodo?.clave ?? null, periodoEtiqueta: f.periodo?.etiqueta ?? null, periodoCodigo: f.periodoCodigo,
        programaClave: f.programa?.clave ?? null, programaEtiqueta: f.programa?.etiqueta ?? null, programaMapeado: h.codigoSinu !== null,
        nivel: f.nivel?.clave ?? null,
        regionalClave: f.regional?.clave ?? null, regionalEtiqueta: f.regional?.etiqueta ?? null,
        modalidadEstudioClave: f.modalidadEstudio?.clave ?? null, modalidadEstudioEtiqueta: f.modalidadEstudio?.etiqueta ?? null,
        modalidadPracticaClave: f.modalidadPractica?.clave ?? null, modalidadPracticaEtiqueta: f.modalidadPractica?.etiqueta ?? null,
        modalidadCodigo: f.modalidadCodigo, estado: f.estado, esEstadoDeCorte: f.esEstadoDeCorte, estadoAl: f.estadoAl,
        organizacionClave: f.organizacion?.clave ?? null, organizacionEtiqueta: f.organizacion?.etiqueta ?? null,
        ciudadClave: f.ciudad?.clave ?? null, ciudadEtiqueta: f.ciudad?.etiqueta ?? null,
        fechaInicio: f.fechaInicio, fechaFin: f.fechaFin, fechaCreacion: h.fechaCreacion, duracionDias: f.duracionDias,
        documentosSubidosRatio: f.documentosSubidosRatio, documentosAprobadosRatio: f.documentosAprobadosRatio,
        elegible,
      };
    });
    const r = await this.escritura.publicar(sistema, filas, { corte, desde, practicasEsperadas: practicas });
    return { ...r, practicas };
  }
}
