import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { cumpleFiltro } from '../../../domain/analitica/analitica-unificada.service';
import { FuenteAnalitica, ResultadoAnaliticoUnificado } from '../../../domain/analitica/modelo-analitico';
import {
  CeldaCruceFuente, CruceAnalitico, PeriodoPorFuente, agregarFilas, fusionarAgregados, fusionarCruces,
} from '../../../domain/analitica/serving-analitico';
import { EstadoOperativo } from '../../../domain/entities/practica.entity';
import { normalizarDocumentoSgp } from '../../../domain/historico/normalizacion-sgp';
import { SistemaOrigen } from '../../../domain/historico/registro-historico';
import { PracticaComparable, matrizSolapamiento } from '../../../domain/historico/solapamiento-historico';
import {
  IdentidadAnaliticaPort, LECTURA_ANALITICA_UNIFICADA, LecturaAnaliticaUnificadaPort,
} from '../../../domain/ports/out/analitica-unificada.port';
import {
  AgregadosServing, SERVING_HISTORICO_LECTURA, ServingHistoricoLecturaPort, ServingHistoricoNoDisponibleError,
} from '../../../domain/ports/out/serving-analitico.port';
import { proyectarFilaActual } from '../analitica/analitica-unificada.use-case';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { escuelasDeReportes, exigirReportes } from './alcance-reportes';

export const IDENTIDAD_ANALITICA = Symbol('IDENTIDAD_ANALITICA');
export const SISTEMA_HISTORICO = Symbol('SISTEMA_HISTORICO');

export const FUENTES: readonly FuenteAnalitica[] = ['current', 'historical', 'all'];
const ESTADOS: readonly EstadoOperativo[] = ['inscrito', 'en_practica', 'anulado', 'reprobado', 'cerrado'];

/** Filtros de la vista por fuente (claves seguras del modelo común). */
export interface FiltroFuentes {
  fuente: FuenteAnalitica;
  periodos?: string[];
  escuela?: string;
  programa?: string;
  nivel?: string;
  regional?: string;
  modalidadEstudio?: string;
  modalidadPractica?: string;
  estado?: EstadoOperativo;
  organizacion?: string;
  ciudad?: string;
}

/** Contrato de Reportes V3 por fuente: el de H4 más cobertura (rangos y lo que el histórico aún no puede atribuir). */
export interface ReporteFuentes extends ResultadoAnaliticoUnificado {
  generadoEn: string;
  /** Cruces comparables (en prácticas) para dibujar Histórico y Todos con las mismas gráficas que Actual (§32). */
  cruces: Record<CruceAnalitico, CeldaCruceFuente[]>;
  /** Prácticas por periodo y fuente: en Todos, las series Actual e Histórico sobre el mismo eje. */
  periodoPorFuente: PeriodoPorFuente[];
  cobertura: {
    actual: { desde: string | null; hasta: string | null } | null;
    historico: { desde: string | null; corte: string | null; publicadoEn: string } | null;
    /** Registros SGP que el alcance o el filtro de escuela no pueden incluir (sin equivalencia académica). */
    historicoFueraDeAlcance: number;
    /** Registros SGP mostrados sin equivalencia de programa a código SINU. */
    historicoSinEquivalenciaPrograma: number;
  };
}

/** Valida los parámetros HTTP. `source` inválido → 400 (nunca un valor por omisión silencioso). */
export function filtroFuentesDe(q: Record<string, string | undefined>): FiltroFuentes {
  const v = (k: string): string | undefined => (typeof q[k] === 'string' && q[k] ? q[k] : undefined);
  const fuente = v('source') ?? 'current';
  if (!FUENTES.includes(fuente as FuenteAnalitica)) throw new BadRequestException('source debe ser current, historical o all');
  const estado = v('estado');
  if (estado && !ESTADOS.includes(estado as EstadoOperativo)) throw new BadRequestException('estado no válido');
  return {
    fuente: fuente as FuenteAnalitica,
    periodos: (v('periodos') ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    escuela: v('escuela'), programa: v('programa'), nivel: v('nivel'), regional: v('regional'),
    modalidadEstudio: v('modalidadEstudio'), modalidadPractica: v('modalidadPractica'), estado: estado as EstadoOperativo | undefined,
    organizacion: v('organizacion'), ciudad: v('ciudad'),
  };
}

/**
 * Reportes V3 por fuente (H5). Actual = SIPRA en vivo; Histórico = serving del SGP (precomputado, agregado en SQL);
 * Todos = ambos, con la regla de H4: solo lo CONFIRMADO se deduplica (SIPRA gana), candidatos y ambiguos se informan.
 *
 * Mismo alcance G1 que la analítica actual. El histórico no tiene escuela: con alcance o filtro de escuela solo entra lo
 * que tenga equivalencia confirmada (hoy, nada) y se informa cuánto queda fuera. Si el serving no está disponible, Actual
 * sigue respondiendo y Histórico/Todos devuelven un error controlado (503), nunca datos degradados en silencio.
 */
@Injectable()
export class ReportesFuentesUseCase {
  constructor(
    @Inject(LECTURA_ANALITICA_UNIFICADA) private readonly lectura: LecturaAnaliticaUnificadaPort,
    @Inject(SERVING_HISTORICO_LECTURA) private readonly serving: ServingHistoricoLecturaPort,
    @Inject(IDENTIDAD_ANALITICA) private readonly identidad: IdentidadAnaliticaPort,
    @Inject(SISTEMA_HISTORICO) private readonly sistema: SistemaOrigen,
  ) {}

  async consultar(filtro: FiltroFuentes, actor: Actor, ahora = new Date()): Promise<ReporteFuentes> {
    exigirReportes(actor);
    const alcance = escuelasDeReportes(actor);
    let escuelaIds = alcance;
    if (filtro.escuela) escuelaIds = alcance && !alcance.includes(filtro.escuela) ? [] : [filtro.escuela];
    const advertencias: string[] = [];
    const conActual = filtro.fuente !== 'historical';
    const conHistorico = filtro.fuente !== 'current';
    const versiones = this.identidad.versiones();
    const conIdentidad = filtro.fuente === 'all' && versiones.length > 0;
    const filtroComun = { fuente: filtro.fuente, programa: filtro.programa, nivel: filtro.nivel, regional: filtro.regional,
      modalidadEstudio: filtro.modalidadEstudio, modalidadPractica: filtro.modalidadPractica, estado: filtro.estado,
      organizacion: filtro.organizacion, ciudad: filtro.ciudad, periodos: filtro.periodos?.length ? filtro.periodos : undefined };

    // ── Actual: en vivo (independiente del serving) ─────────────────────────
    const crudas = conActual ? await this.lectura.practicasActuales({ periodos: filtroComun.periodos, escuelaIds, conDocumento: conIdentidad }) : [];
    const actuales = crudas.map(proyectarFilaActual).filter((f) => cumpleFiltro(f, filtroComun));
    const agregadoActual = conActual ? agregarFilas(actuales) : null;
    const coberturaActual = crudas.length
      ? { desde: crudas.reduce((m, a) => (a.creadaEn < m ? a.creadaEn : m), crudas[0].creadaEn).slice(0, 10), hasta: ahora.toISOString().slice(0, 10) }
      : null;

    let historico: AgregadosServing | null = null;
    let solapamiento: ReporteFuentes['solapamiento'] = null;
    let estudiantesUnicos = agregadoActual?.estudiantes ?? 0;
    let precision: 'exacta' | 'cota_superior' = 'exacta';
    if (conHistorico) {
      // Claves de los estudiantes actuales del universo (solo en memoria; el documento se descarta).
      const claves = new Set<string>();
      const clavePorEstudiante = new Map<string, string[]>();
      if (conIdentidad) {
        const elegibles = new Set(actuales.map((a) => a.identidadEstudiante));
        for (const c of crudas) {
          if (!c.documento || !elegibles.has(`current:${c.estudianteId}`) || clavePorEstudiante.has(c.estudianteId)) continue;
          const normal = normalizarDocumentoSgp(c.documento).normalizado;
          const ks = versiones.map((v) => { const k = this.identidad.claveEstudiante(v, normal); return k ? `${v}:${k}` : null; }).filter((k): k is string => k !== null);
          clavePorEstudiante.set(c.estudianteId, ks);
          ks.forEach((k) => claves.add(k));
        }
      }
      // Correspondencias CONFIRMADAS hacia prácticas actuales del universo: SIPRA gana en Todos.
      const idsActuales = new Set(actuales.map((a) => a.idOrigen));
      const confirmadas = filtro.fuente === 'all'
        ? (await this.lectura.correspondenciasConfirmadas(this.sistema).catch(() => { throw new ServiceUnavailableException('SERVING_HISTORICO_NO_DISPONIBLE: correspondencias no disponibles'); }))
          .filter((c) => idsActuales.has(c.practicaId))
        : [];
      try {
        historico = await this.serving.agregados({
          sistema: this.sistema, periodos: filtroComun.periodos, escuelaIds, programa: filtro.programa, nivel: filtro.nivel,
          regional: filtro.regional, modalidadEstudio: filtro.modalidadEstudio, modalidadPractica: filtro.modalidadPractica,
          estado: filtro.estado, organizacion: filtro.organizacion, ciudad: filtro.ciudad,
          excluirRegistros: confirmadas.map((c) => c.sourceRecordId), clavesEstudiantesActuales: [...claves],
        });
      } catch (e) {
        if (e instanceof ServingHistoricoNoDisponibleError) throw new ServiceUnavailableException(e.message);
        throw e;
      }
      if (escuelaIds !== undefined && historico.cobertura.excluidosPorAlcance > 0) {
        advertencias.push('HISTORICO_FUERA_DE_ALCANCE: algunos registros históricos aún no cuentan con equivalencia académica actual');
      }
      if (filtro.fuente === 'historical') {
        estudiantesUnicos = historico.estudiantes;
      } else {
        const sinClave = historico.versionesClave.filter((v) => !versiones.includes(v));
        if (!conIdentidad || sinClave.length) {
          precision = 'cota_superior';
          advertencias.push(`IDENTIDAD_NO_COMPARABLE: ${conIdentidad ? `sin clave para ${sinClave.join(', ')}` : 'sin clave HMAC configurada'}; los estudiantes únicos de Todos son una cota superior`);
          estudiantesUnicos = (agregadoActual?.estudiantes ?? 0) + historico.estudiantes;
        } else {
          estudiantesUnicos = (agregadoActual?.estudiantes ?? 0) + historico.estudiantes - historico.estudiantesCompartidos;
        }
        solapamiento = this.diagnostico(actuales, historico, clavePorEstudiante, new Set(confirmadas.map((c) => c.practicaId)));
      }
    }
    const resultado = fusionarAgregados(filtro.fuente, agregadoActual, historico, {
      estudiantesUnicos, precisionEstudiantes: precision,
      estadoAl: { current: conActual ? ahora.toISOString() : null, historical: historico?.publicacion.corte ?? null },
      solapamiento, advertencias,
    });
    return {
      ...resultado,
      ...fusionarCruces(agregadoActual, historico),
      generadoEn: ahora.toISOString(),
      cobertura: {
        actual: conActual ? coberturaActual : null,
        historico: historico ? { desde: historico.publicacion.desde, corte: historico.publicacion.corte, publicadoEn: historico.publicacion.publicadoEn } : null,
        historicoFueraDeAlcance: historico?.cobertura.excluidosPorAlcance ?? 0,
        historicoSinEquivalenciaPrograma: historico?.cobertura.sinEquivalenciaPrograma ?? 0,
      },
    };
  }

  /** Matriz H3 solo sobre los registros SGP de estudiantes presentes en SIPRA (acotado; el resto es solo histórico). */
  private diagnostico(
    actuales: ReturnType<typeof proyectarFilaActual>[], h: AgregadosServing, clavePorEstudiante: Map<string, string[]>, confirmadas: ReadonlySet<string>,
  ): ReporteFuentes['solapamiento'] {
    const identidadDe = new Map<string, string>();
    for (const [usuario, ks] of clavePorEstudiante) for (const k of ks) identidadDe.set(k, `current:${usuario}`);
    const hist: PracticaComparable[] = h.solape.map((s) => ({
      id: s.analyticsId, studentKey: identidadDe.get(s.identidad) ?? s.identidad, periodo: s.periodoCodigo, ciclo: s.nivel, modalidad: s.modalidadCodigo,
      fechaInicio: s.fechaInicio, fechaFin: s.fechaFin, estado: s.estado, creadaEn: s.fechaCreacion, sgpId: s.analyticsId,
    }));
    // Las prácticas con correspondencia confirmada ya están emparejadas (H4 las categoriza «matched»): fuera de la matriz.
    const act: PracticaComparable[] = actuales.filter((a) => !confirmadas.has(a.idOrigen)).map((a) => ({
      id: a.analyticsId, studentKey: a.identidadEstudiante, periodo: a.periodoCodigo, ciclo: a.ciclo, modalidad: a.modalidadCodigo,
      fechaInicio: a.fechaInicio, fechaFin: a.fechaFin, estado: a.estado, creadaEn: a.creadaEn, sgpId: null,
    }));
    const m = matrizSolapamiento(hist, act);
    return {
      categorias: {
        historical_only: h.filas - h.solape.length + m.conteos.historical_only,
        current_only: m.conteos.current_only,
        matched: confirmadas.size,
        candidate_overlap: m.conteos.candidate_overlap,
        ambiguous_overlap: m.conteos.ambiguous_overlap,
      },
      excluidosDeAll: confirmadas.size ? { CORRESPONDENCIA_CONFIRMADA_CON_SIPRA: confirmadas.size } : {},
    };
  }
}
