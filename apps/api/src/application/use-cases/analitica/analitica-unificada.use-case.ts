import { ESTADO_OPERATIVO, EstadoOperativo, EstadoPractica } from '../../../domain/entities/practica.entity';
import {
  CorrespondenciaConfirmada, calcularMetricas, cumpleFiltro, resolverIdentidades, unirFuentes,
} from '../../../domain/analitica/analitica-unificada.service';
import { FilaAnalitica, FiltroAnaliticoUnificado, ResultadoAnaliticoUnificado, ValorDimension } from '../../../domain/analitica/modelo-analitico';
import { MARCAS_CALIDAD, MARCAS_ORGANIZACION, MarcaCalidad, MarcaOrganizacion } from '../../../domain/historico/calidad-historico';
import { claveTexto, normalizarDocumentoSgp } from '../../../domain/historico/normalizacion-sgp';
import { parsearPeriodoSgp } from '../../../domain/historico/periodo-sgp.parser';
import { SistemaOrigen } from '../../../domain/historico/registro-historico';
import { FronterasPeriodo } from '../../../domain/historico/solapamiento-historico';
import {
  FilaActualCruda, FilaHistoricaCruda, IdentidadAnaliticaPort, LecturaAnaliticaUnificadaPort,
} from '../../../domain/ports/out/analitica-unificada.port';

const ESTADOS_TECNICOS = new Set<string>(Object.values(EstadoPractica));
const ESTADOS_OPERATIVOS = new Set<string>(['inscrito', 'en_practica', 'anulado', 'reprobado', 'cerrado']);
const MARCAS_P = new Set<string>(MARCAS_CALIDAD);
const MARCAS_O = new Set<string>(MARCAS_ORGANIZACION);

const dim = (clave: string | null, etiqueta: string | null): ValorDimension | null => (clave ? { clave, etiqueta: etiqueta ?? clave } : null);

function diasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

export interface OpcionesAnaliticaUnificada {
  sistema?: SistemaOrigen;
  fronteras?: FronterasPeriodo;
  /** Reloj inyectable (pruebas). */
  ahora?: () => Date;
}

/**
 * Capa analítica unificada (H4): lee SIPRA y el SGP por separado, los proyecta a un modelo común, une con la regla de
 * precedencia (solo lo confirmado se deduplica) y calcula métricas con la política de calidad H3.
 *
 * No está conectada a ningún controlador (H5). Su salida es el contrato `ResultadoAnaliticoUnificado`: sin claves
 * seudónimas, sin documentos, sin marcas internas.
 */
export class AnaliticaUnificadaUseCase {
  constructor(
    private readonly lectura: LecturaAnaliticaUnificadaPort,
    private readonly identidad: IdentidadAnaliticaPort,
    private readonly opciones: OpcionesAnaliticaUnificada = {},
  ) {}

  async consultar(filtro: FiltroAnaliticoUnificado): Promise<ResultadoAnaliticoUnificado> {
    const sistema = this.opciones.sistema ?? 'SGP';
    const advertencias: string[] = [];
    const versiones = this.identidad.versiones();
    const identidadComparable = versiones.length > 0;
    const conActual = filtro.fuente !== 'historical';
    // El histórico no tiene escuela: con alcance restringido no se puede atribuir y no entra (nunca se filtra de más).
    const alcanceRestringido = filtro.escuelaIds !== undefined;
    const conHistorico = filtro.fuente !== 'current' && !alcanceRestringido;
    if (filtro.fuente !== 'current' && alcanceRestringido) advertencias.push('HISTORICO_FUERA_DE_ALCANCE: el SGP no registra escuela; con alcance por escuelas solo cuenta SIPRA');

    const crudasActuales = conActual
      ? await this.lectura.practicasActuales({ periodos: filtro.periodos, escuelaIds: filtro.escuelaIds, conDocumento: identidadComparable && filtro.fuente === 'all' })
      : [];
    const crudasHistoricas = conHistorico ? await this.lectura.practicasHistoricas({ sistema, periodos: filtro.periodos }) : [];

    // Identidad: claves del documento actual en memoria, una por estudiante y versión; el documento se descarta.
    const clavesActuales = new Map<string, Map<string, string>>();
    for (const a of crudasActuales) {
      if (!a.documento || clavesActuales.has(a.estudianteId)) continue;
      const normal = normalizarDocumentoSgp(a.documento).normalizado;
      const claves = new Map<string, string>();
      for (const v of versiones) { const k = this.identidad.claveEstudiante(v, normal); if (k) claves.set(v, k); }
      clavesActuales.set(a.estudianteId, claves);
    }
    const versionesHistoricas = new Set(crudasHistoricas.map((h) => h.hmacKeyVersion));
    const sinClave = [...versionesHistoricas].filter((v) => !versiones.includes(v));
    if (filtro.fuente === 'all' && sinClave.length) advertencias.push(`IDENTIDAD_NO_COMPARABLE: sin clave para la(s) versión(es) ${sinClave.join(', ')}; los estudiantes únicos de ALL son una cota superior`);
    const identidad = resolverIdentidades([...clavesActuales.entries()].map(([usuarioId, clavesPorVersion]) => ({ usuarioId, clavesPorVersion })));

    const actuales = crudasActuales.map((a) => this.proyectarActual(a)).filter((f) => cumpleFiltro(f, filtro));
    const historicas = crudasHistoricas.map((h) => this.proyectarHistorica(h, sistema, filtro.fuente === 'all' ? identidad : null)).filter((f) => cumpleFiltro(f, filtro));
    const ahora = (this.opciones.ahora ?? (() => new Date()))().toISOString();
    const corte = crudasHistoricas.reduce<string | null>((m, h) => (h.estadoFechaCorte && (!m || h.estadoFechaCorte > m) ? h.estadoFechaCorte : m), null);

    if (filtro.fuente === 'current') return calcularMetricas(actuales, 'current', { identidadComparable, estadoAlActual: ahora, corteHistorico: null, advertencias });
    if (filtro.fuente === 'historical') return calcularMetricas(historicas, 'historical', { identidadComparable, estadoAlActual: null, corteHistorico: corte, advertencias });

    const historicaPorId = new Map(historicas.map((h) => [h.idOrigen, h]));
    const confirmadas: CorrespondenciaConfirmada[] = (await this.lectura.correspondenciasConfirmadas(sistema)).flatMap((c) => {
      const h = historicaPorId.get(c.sourceRecordId);
      return h ? [{ historicoAnalyticsId: h.analyticsId, actualAnalyticsId: `current:${c.practicaId}` }] : [];
    });
    const union = unirFuentes(actuales, historicas, confirmadas, { despuesDeFrontera: (f) => this.despuesDeFrontera(f) });
    return calcularMetricas(union.filas, 'all', {
      identidadComparable: identidadComparable && sinClave.length === 0, estadoAlActual: ahora, corteHistorico: corte, union, advertencias,
    });
  }

  private despuesDeFrontera(f: FilaAnalitica): boolean {
    const fr = this.opciones.fronteras;
    if (!fr || !f.periodoCodigo) return false;
    const p = parsearPeriodoSgp(f.periodoCodigo);
    const cal = p.formato === 'presencial' || p.formato === 'virtual' || p.formato === '335' ? p.formato : null;
    const limite = cal ? fr[cal] : null;
    if (!limite || p.anio === null) return false;
    const l = parsearPeriodoSgp(limite);
    return l.anio !== null && (p.anio > l.anio || (p.anio === l.anio && (p.ordinal ?? '') >= (l.ordinal ?? '')));
  }

  private proyectarActual(a: FilaActualCruda): FilaAnalitica {
    const estado = ESTADOS_TECNICOS.has(a.estado) ? ESTADO_OPERATIVO[a.estado as EstadoPractica] : null;
    const regional = claveTexto(a.regional);
    const fur = claveTexto(a.empresa);
    return {
      analyticsId: `current:${a.id}`, origen: 'current', idOrigen: a.id,
      identidadEstudiante: `current:${a.estudianteId}`,
      periodo: dim(a.periodo, a.periodo),
      programa: dim(`sinu:${a.programaId}`, a.programaId),
      nivel: dim(a.ciclo, a.ciclo),
      regional: regional ? dim(`regional:${regional}`, regional) : null,
      modalidadEstudio: null,
      modalidadPractica: dim(`modalidad:${a.modalidad}`, a.modalidad),
      estado, estadoAl: null, esEstadoDeCorte: false,
      organizacion: a.empresaId ? dim(`empresa:${a.empresaId}`, a.empresa) : fur ? dim(`fur:${fur}`, a.empresa) : null,
      ciudad: a.ciudadCodigo ? dim(`divipola:${a.ciudadCodigo}`, a.ciudadNombre ?? a.ciudadCodigo) : null,
      fechaInicio: a.fechaInicio, fechaFin: a.fechaFin, duracionDias: diasEntre(a.fechaInicio, a.fechaFin),
      documentosSubidosRatio: null, documentosAprobadosRatio: null, bitacoraCount: null,
      qualityFlags: [], organizationFlags: [], duplicadoDe: null,
      periodoCodigo: a.periodo.toUpperCase(), ciclo: a.ciclo, modalidadCodigo: a.modalidad, creadaEn: a.creadaEn,
    };
  }

  private proyectarHistorica(h: FilaHistoricaCruda, sistema: SistemaOrigen, identidad: ((v: string, k: string | null) => string | null) | null): FilaAnalitica {
    const estado = h.estadoAnalitico && ESTADOS_OPERATIVOS.has(h.estadoAnalitico) ? h.estadoAnalitico as EstadoOperativo : null;
    const periodo = h.periodoNormalizado
      ? dim(h.periodoNormalizado, h.periodoNormalizado)
      : h.periodoOriginal ? dim(`sgp:${h.periodoOriginal}`, `${h.periodoOriginal} (SGP, legado)`) : null;
    const modalidad = h.modalidadPracticaNormalizada
      ? dim(`modalidad:${h.modalidadPracticaNormalizada}`, h.modalidadPracticaNormalizada)
      : h.modalidadPracticaOriginal ? dim(`sgp:${claveTexto(h.modalidadPracticaOriginal)}`, `${h.modalidadPracticaOriginal} (SGP, sin equivalente)`) : null;
    const regional = claveTexto(h.regional);
    return {
      analyticsId: `historical:${sistema}:${h.sourceRecordId}:${h.version}`, origen: 'historical', idOrigen: h.sourceRecordId,
      // Sin unión, la identidad histórica es propia; en ALL se resuelve contra los estudiantes actuales.
      identidadEstudiante: identidad ? identidad(h.hmacKeyVersion, h.studentKey) : h.studentKey ? `historical:${h.hmacKeyVersion}:${h.studentKey}` : null,
      periodo,
      programa: h.codigoSinu ? dim(`sinu:${h.codigoSinu}`, h.codigoSinu) : h.programaNormalizado ? dim(`sgp:${h.programaNormalizado}`, h.programaNormalizado) : null,
      nivel: dim(h.nivelInferido, h.nivelInferido),
      regional: regional ? dim(`regional:${regional}`, regional) : null,
      modalidadEstudio: dim(h.modalidadEstudio ? `estudio:${h.modalidadEstudio}` : null, h.modalidadEstudio),
      modalidadPractica: modalidad,
      estado, estadoAl: h.estadoFechaCorte, esEstadoDeCorte: h.esEstadoDeCorte,
      organizacion: h.empresaConfirmadaId
        ? dim(`empresa:${h.empresaConfirmadaId}`, h.empresaConfirmadaNombre)
        : h.organizacionId ? dim(`org-historica:${h.organizacionId}`, 'Organización histórica sin correspondencia') : null,
      ciudad: h.ciudadNormalizada ? dim(`sgp-texto:${h.ciudadNormalizada}`, h.ciudadNormalizada) : null,
      fechaInicio: h.fechaInicio, fechaFin: h.fechaFin, duracionDias: h.duracionDias,
      documentosSubidosRatio: h.documentosSubidosRatio, documentosAprobadosRatio: h.documentosAprobadosRatio, bitacoraCount: h.bitacoraCount,
      qualityFlags: h.qualityFlags.filter((m): m is MarcaCalidad => MARCAS_P.has(m)),
      organizationFlags: h.organizationFlags.filter((m): m is MarcaOrganizacion => MARCAS_O.has(m)),
      duplicadoDe: h.duplicadoDe,
      periodoCodigo: h.periodoNormalizado, ciclo: h.nivelInferido, modalidadCodigo: h.modalidadPracticaNormalizada, creadaEn: h.fechaCreacion,
    };
  }
}
