import { CicloAcademico, ESTADO_OPERATIVO, EstadoPractica } from '../../../domain/entities/practica.entity';
import { MARCAS_CALIDAD, MARCAS_ORGANIZACION, MarcaCalidad, MarcaOrganizacion } from '../../../domain/historico/calidad-historico';
import { normalizarDocumentoSgp } from '../../../domain/historico/normalizacion-sgp';
import { MetricaHistorica, elegibilidadPorMetrica } from '../../../domain/historico/politica-calidad-historico';
import { EntradaInventarioPrograma, EquivalenciasProgramas, inventarioProgramas } from '../../../domain/historico/programas-sgp';
import {
  RegistroHistorico, ResumenOrganizaciones, SistemaOrigen, aplicarMarcasDeLote, exigirIdsUnicos, fechaCorteDe,
  planificarImportacion, resumenOrganizaciones, transformarFilaSgp,
} from '../../../domain/historico/registro-historico';
import { SeudonimizadorHistorico } from '../../../domain/historico/seudonimizacion-historico';
import {
  CategoriaSolapamiento, FronterasPeriodo, PoliticaSolapamiento, PracticaComparable, matrizSolapamiento, procesosContadosDosVeces,
  seleccionarParaConteo,
} from '../../../domain/historico/solapamiento-historico';
import {
  EstadisticasLectura, FuenteSgp, HistoricoRepositorio, ImportacionFallidaError, MetadatosArchivo,
} from '../../../domain/ports/out/historico-repositorio.port';

/** Versión del importador y de sus reglas (parser de periodos, normalizadores, calidad). Se guarda en cada importación. */
export const VERSION_IMPORTADOR = 'historico-sgp/1.1.0';

export type ModoImportacion = 'dry-run' | 'apply';

export class AplicacionNoAutorizadaError extends Error {
  constructor(motivo: string) {
    super(`APPLY rechazado: ${motivo}. No se escribió nada.`);
    this.name = 'AplicacionNoAutorizadaError';
  }
}

export interface OpcionesImportacion {
  modo: ModoImportacion;
  sourceSystem: SistemaOrigen;
  /** Compuerta de entorno `HISTORICO_IMPORT_APPLY=true` (la evalúa quien invoca, aquí solo se exige). */
  compuertaEntorno: boolean;
  /** Salida de progreso. Solo recibe agregados; nunca un valor de origen. */
  informar?: (linea: string) => void;
  modoCarga?: 'single' | 'batched';
  programas?: EquivalenciasProgramas;
  solapamiento?: { politica: PoliticaSolapamiento; fronteras?: FronterasPeriodo };
  /** Registra la memoria (RSS y heap) al final de cada etapa. */
  perfilMemoria?: boolean;
}

export interface EtapaPerfil { etapa: string; ms: number; rssMb: number; heapMb: number }

export interface ResumenSolapamiento {
  politica: PoliticaSolapamiento;
  practicasActuales: number;
  matriz: Record<CategoriaSolapamiento, number>;
  candidatosFuerza: { alta: number; media: number };
  conteo: { historicos: number; actuales: number; excluidosHistoricos: Record<string, number>; procesosContadosDosVeces: number };
  /** El mismo cruce bajo las tres políticas: cuántos procesos contaría dos veces cada una. */
  dobleConteoPorPolitica: Record<PoliticaSolapamiento, number>;
}

export interface ResumenImportacion {
  modo: ModoImportacion;
  resultado: 'DRY_RUN' | 'ALREADY_IMPORTED' | 'COMPLETED';
  importacionId: string | null;
  archivo: MetadatosArchivo;
  sourceSystem: SistemaOrigen;
  lectura: EstadisticasLectura;
  fechaCorte: string | null;
  hmacKeyVersion: string;
  claveEfimera: boolean;
  comparadoConBase: boolean;
  nuevos: number;
  versionados: number;
  sinCambios: number;
  ausentes: number;
  observados: number;
  limpios: number;
  /** Prácticas cuya ÚNICA marca es esta: muestra qué explica el «observed». */
  observadosSoloPor: Partial<Record<MarcaCalidad, number>>;
  marcas: Partial<Record<MarcaCalidad, number>>;
  marcasOrganizacion: Partial<Record<MarcaOrganizacion, number>>;
  organizaciones: ResumenOrganizaciones;
  agregados: AgregadosHistorico;
  elegibilidad: Record<MetricaHistorica, { elegibles: number; excluidos: number }>;
  programas: EntradaInventarioPrograma[];
  solapamiento: ResumenSolapamiento | null;
  perfil: EtapaPerfil[];
  duracionMs: number;
}

/** Agregados sin datos personales para validar contra la auditoría. */
export interface AgregadosHistorico {
  estudiantesDistintos: number;
  docentesDistintos: number;
  organizacionesDistintas: number;
  periodosDistintos: number;
  periodosPorFormato: Record<string, number>;
  /** B vs C (y A, D, I) por año: continuidad del calendario presencial, para la decisión institucional. */
  periodosPresencialesPorAnio: Record<string, Record<string, number>>;
  periodosLegado: Record<string, number>;
  estados: Record<string, number>;
  modalidadesPractica: Record<string, number>;
  empresaPropiaPorAnio: Record<string, number>;
  estadosDeCorte: number;
  nivelPorFuente: Record<string, number>;
  tiposIdentificadorOrganizacion: Record<string, number>;
  salarioPorCalidad: Record<string, number>;
}

function contar<T extends string | null>(registros: readonly RegistroHistorico[], f: (r: RegistroHistorico) => T): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of registros) { const k = f(r) ?? '(vacío)'; m[k] = (m[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

export function agregadosDe(registros: readonly RegistroHistorico[]): AgregadosHistorico {
  const distintos = (f: (r: RegistroHistorico) => string | null): number => new Set(registros.map(f).filter((x) => x !== null)).size;
  const porAnio: Record<string, Record<string, number>> = {};
  const legado: Record<string, number> = {};
  const empresaPropia: Record<string, number> = {};
  for (const r of registros) {
    if (r.periodoFormato === 'presencial' && r.periodoAnio !== null && r.periodoOrdinal) {
      const a = String(r.periodoAnio);
      porAnio[a] ??= {};
      porAnio[a][r.periodoOrdinal] = (porAnio[a][r.periodoOrdinal] ?? 0) + 1;
    }
    if (r.periodoFormato === 'intersemestral_legacy' || r.periodoFormato === 'trimestral_legacy') {
      legado[r.periodoOriginal ?? '?'] = (legado[r.periodoOriginal ?? '?'] ?? 0) + 1;
    }
    if (r.modalidadMappingStatus === 'PENDING_INSTITUTIONAL_MAPPING') {
      const a = r.fechaCreacion?.slice(0, 4) ?? 'sin fecha';
      empresaPropia[a] = (empresaPropia[a] ?? 0) + 1;
    }
  }
  return {
    estudiantesDistintos: distintos((r) => r.studentKey),
    docentesDistintos: distintos((r) => r.teacherKey),
    organizacionesDistintas: distintos((r) => r.organizationKey),
    periodosDistintos: distintos((r) => r.periodoOriginal),
    periodosPorFormato: contar(registros, (r) => r.periodoFormato),
    periodosPresencialesPorAnio: Object.fromEntries(Object.entries(porAnio).sort()),
    periodosLegado: Object.fromEntries(Object.entries(legado).sort()),
    estados: contar(registros, (r) => r.estadoOriginal),
    modalidadesPractica: contar(registros, (r) => r.modalidadPracticaNormalizada ?? `pendiente:${r.modalidadMappingStatus}`),
    empresaPropiaPorAnio: Object.fromEntries(Object.entries(empresaPropia).sort()),
    estadosDeCorte: registros.filter((r) => r.esEstadoDeCorte).length,
    nivelPorFuente: contar(registros, (r) => r.nivelFuente),
    tiposIdentificadorOrganizacion: contar(registros, (r) => r.organizationIdentifierKind),
    salarioPorCalidad: contar(registros, (r) => r.salarioCalidad),
  };
}

function conteoMarcas(registros: readonly RegistroHistorico[]): Partial<Record<MarcaCalidad, number>> {
  const m: Partial<Record<MarcaCalidad, number>> = {};
  for (const r of registros) for (const f of r.qualityFlags) m[f] = (m[f] ?? 0) + 1;
  return Object.fromEntries(MARCAS_CALIDAD.filter((k) => m[k]).map((k) => [k, m[k]]));
}

function conteoMarcasOrganizacion(registros: readonly RegistroHistorico[]): Partial<Record<MarcaOrganizacion, number>> {
  const m: Partial<Record<MarcaOrganizacion, number>> = {};
  for (const r of registros) for (const f of r.organizationFlags) m[f] = (m[f] ?? 0) + 1;
  return Object.fromEntries(MARCAS_ORGANIZACION.filter((k) => m[k]).map((k) => [k, m[k]]));
}

const ESTADOS_TECNICOS = new Set<string>(Object.values(EstadoPractica));
const CICLOS = new Set<string>(Object.values(CicloAcademico));

/**
 * Importación controlada del histórico del SGP.
 *
 *  - DRY RUN (por defecto): lee, transforma, marca, proyecta y — si hay repositorio — cruza contra SIPRA en solo
 *    lectura (solapamiento). CERO escrituras.
 *  - APPLY: exige el modo explícito, la compuerta de entorno y una clave HMAC real (no efímera). La escritura la hace
 *    el repositorio (por omisión, en lotes no vigentes con finalización atómica).
 *
 * La salida solo contiene agregados: ni documentos, ni nombres, ni NIT, ni claves.
 */
export class ImportarHistoricoUseCase {
  constructor(
    private readonly fuente: FuenteSgp,
    private readonly seudonimizador: SeudonimizadorHistorico,
    private readonly repositorio: HistoricoRepositorio | null,
  ) {}

  async ejecutar(op: OpcionesImportacion): Promise<ResumenImportacion> {
    const informar = op.informar ?? ((): void => undefined);
    const t0 = Date.now();
    const perfil: EtapaPerfil[] = [];
    let tEtapa = t0;
    const marcar = (etapa: string): void => {
      if (!op.perfilMemoria) return;
      // Con `node --expose-gc`, se mide el heap VIVO (sin basura pendiente de recolectar).
      (globalThis as { gc?: () => void }).gc?.();
      const m = process.memoryUsage();
      const ahora = Date.now();
      perfil.push({ etapa, ms: ahora - tEtapa, rssMb: Math.round(m.rss / 1_048_576), heapMb: Math.round(m.heapUsed / 1_048_576) });
      informar(`  [perfil] ${etapa}: ${ahora - tEtapa} ms · RSS ${Math.round(m.rss / 1_048_576)} MB · heap ${Math.round(m.heapUsed / 1_048_576)} MB`);
      tEtapa = ahora;
    };
    if (op.modo === 'apply') {
      if (!op.compuertaEntorno) throw new AplicacionNoAutorizadaError('falta HISTORICO_IMPORT_APPLY=true');
      if (this.seudonimizador.efimera) throw new AplicacionNoAutorizadaError('la clave HMAC es efímera (simulacro)');
      if (!this.repositorio) throw new AplicacionNoAutorizadaError('no hay base de datos configurada');
    }

    const archivo = await this.fuente.metadatos();
    informar(`Fuente: ${op.sourceSystem} · archivo ${archivo.nombre} · ${(archivo.tamanoBytes / 1_048_576).toFixed(1)} MB`);
    informar(`SHA-256: ${archivo.sha256}`);
    marcar('sha256');

    if (op.modo === 'apply' && this.repositorio) {
      const previa = await this.repositorio.importacionCompletada(op.sourceSystem, archivo.sha256);
      if (previa) {
        informar(`ALREADY_IMPORTED: este archivo ya se importó (importación ${previa}). Registros escritos: 0.`);
        return this.resumen(op, archivo, 'ALREADY_IMPORTED', previa, [], null, false, { nuevos: 0, versionados: 0, sinCambios: 0, ausentes: 0 }, null, perfil, t0);
      }
    }

    const registros: RegistroHistorico[] = [];
    let siguienteAviso = 100_000;
    for await (const fila of this.fuente.filasReales((e) => {
      if (e.filasFisicas >= siguienteAviso) {
        informar(`  … filas físicas ${e.filasFisicas.toLocaleString('es-CO')} · reales ${e.filasReales.toLocaleString('es-CO')}`);
        siguienteAviso += 100_000 * Math.ceil((e.filasFisicas - siguienteAviso + 1) / 100_000);
      }
    })) {
      registros.push(transformarFilaSgp(fila, op.sourceSystem, this.seudonimizador, { programas: op.programas }));
    }
    marcar('lectura y transformación');
    exigirIdsUnicos(registros);
    const fechaCorte = fechaCorteDe(registros);
    aplicarMarcasDeLote(registros, fechaCorte);
    const lectura = this.fuente.estadisticas();
    marcar('marcas de lote');

    const comparado = this.repositorio !== null && !this.seudonimizador.efimera;
    const vigentes = this.repositorio && comparado ? await this.repositorio.vigentes(op.sourceSystem) : new Map<string, never>();
    const plan = planificarImportacion(registros, vigentes);
    const proyeccion = { nuevos: plan.nuevos.length, versionados: plan.versionados.length, sinCambios: plan.sinCambios, ausentes: plan.ausentes };
    const solapamiento = this.repositorio && op.solapamiento ? await this.cruzar(registros, fechaCorte, op.solapamiento) : null;
    marcar('plan y solapamiento');

    const observados = registros.filter((r) => r.qualityStatus === 'observed').length;
    informar(`Filas físicas: ${lectura.filasFisicas} · reales (# no vacío): ${lectura.filasReales} · descartadas: ${lectura.filasDescartadas}`);
    informar(`Proyección${comparado ? '' : ' (sin comparar con la base)'}: nuevas ${proyeccion.nuevos} · versionadas ${proyeccion.versionados} · sin cambios ${proyeccion.sinCambios} · ausentes ${proyeccion.ausentes}`);
    informar(`Prácticas: limpias ${registros.length - observados} · observadas ${observados} · corte: ${fechaCorte ?? 'sin fecha'}`);
    if (solapamiento) {
      const m = solapamiento.matriz;
      informar(`Solapamiento (${solapamiento.politica}): solo histórico ${m.historical_only} · solo SIPRA ${m.current_only} · candidatos ${m.candidate_overlap} · confirmados ${m.confirmed_overlap} · ambiguos ${m.ambiguous_overlap} · procesos contados dos veces ${solapamiento.conteo.procesosContadosDosVeces}`);
    }

    if (op.modo === 'dry-run') {
      informar('DRY RUN: no se escribió nada.');
      const r = this.resumen(op, archivo, 'DRY_RUN', null, registros, fechaCorte, comparado, proyeccion, solapamiento, perfil, t0);
      marcar('resumen');
      return r;
    }

    const metadata = {
      hoja: 'primera', marcas: conteoMarcas(registros), marcasOrganizacion: conteoMarcasOrganizacion(registros),
      organizaciones: resumenOrganizaciones(registros), agregados: agregadosDe(registros), lectura,
      equivalenciasProgramas: op.programas?.version ?? null,
    };
    const solicitud = {
      sourceSystem: op.sourceSystem, archivo, fechaCorte, hmacKeyVersion: this.seudonimizador.versionClave,
      importerVersion: VERSION_IMPORTADOR, estadisticas: lectura, registros, metadata, modoCarga: op.modoCarga ?? 'batched' as const,
    };
    try {
      const r = await this.repositorio!.aplicar(solicitud);
      marcar('escritura');
      if (r.resultado === 'ALREADY_IMPORTED') {
        informar(`ALREADY_IMPORTED: este archivo ya se importó (importación ${r.importacionId}). Registros escritos: 0.`);
        return this.resumen(op, archivo, 'ALREADY_IMPORTED', r.importacionId, registros, fechaCorte, true, { nuevos: 0, versionados: 0, sinCambios: 0, ausentes: 0 }, solapamiento, perfil, t0);
      }
      informar(`APPLY completado · importación ${r.importacionId}: nuevas ${r.nuevos} · versionadas ${r.versionados} · sin cambios ${r.sinCambios}`);
      return this.resumen(op, archivo, 'COMPLETED', r.importacionId, registros, fechaCorte, true,
        { nuevos: r.nuevos, versionados: r.versionados, sinCambios: r.sinCambios, ausentes: r.ausentes }, solapamiento, perfil, t0);
    } catch (e) {
      if (e instanceof ImportacionFallidaError) {
        informar(`APPLY falló: la importación ${e.importacionId} quedó «failed» y sus versiones (nunca vigentes) se retiraron.`);
        throw e;
      }
      const motivo = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 500);
      const { sourceSystem, importerVersion, estadisticas, modoCarga } = solicitud;
      const constancia = { sourceSystem, archivo, fechaCorte, hmacKeyVersion: solicitud.hmacKeyVersion, importerVersion, estadisticas, metadata, modoCarga };
      const id = await this.repositorio!.registrarFallo(constancia, motivo).catch(() => null);
      informar(`APPLY falló y no escribió versiones${id ? ` (constancia ${id})` : ''}.`);
      throw e;
    }
  }

  /** Cruce de solo lectura con SIPRA: la misma clave (aunque sea efímera) en ambos lados hace comparables los procesos. */
  private async cruzar(registros: readonly RegistroHistorico[], fechaCorte: string | null, cfg: { politica: PoliticaSolapamiento; fronteras?: FronterasPeriodo }): Promise<ResumenSolapamiento> {
    const actualesCrudas = await this.repositorio!.practicasActuales();
    const historicas: PracticaComparable[] = registros.map((r) => ({
      id: r.sourceRecordId, studentKey: r.studentKey, periodo: r.periodoNormalizado, ciclo: r.nivelInferido,
      modalidad: r.modalidadPracticaNormalizada, fechaInicio: r.fechaInicio, fechaFin: r.fechaFin, estado: r.estadoAnalitico,
      creadaEn: r.fechaCreacion, sgpId: r.sourceRecordId,
    }));
    const actuales: PracticaComparable[] = actualesCrudas.map((p) => ({
      id: p.id,
      studentKey: this.seudonimizador.clave('student', normalizarDocumentoSgp(p.documento).normalizado),
      periodo: p.periodo.toUpperCase(),
      ciclo: CICLOS.has(p.ciclo) ? p.ciclo : null,
      modalidad: p.modalidad,
      fechaInicio: p.fechaInicio, fechaFin: p.fechaFin,
      estado: ESTADOS_TECNICOS.has(p.estado) ? ESTADO_OPERATIVO[p.estado as EstadoPractica] : null,
      creadaEn: p.creadaEn, sgpId: p.sgpId,
    }));
    const matriz = matrizSolapamiento(historicas, actuales);
    const opciones = { fechaCorte, fronteras: cfg.fronteras };
    const sel = seleccionarParaConteo(historicas, actuales, cfg.politica, opciones);
    const excluidos: Record<string, number> = {};
    for (const e of sel.excluidos) if (e.fuente === 'historical') excluidos[e.motivo] = (excluidos[e.motivo] ?? 0) + 1;
    const dobles = {} as Record<PoliticaSolapamiento, number>;
    for (const p of ['CUTOFF_DATE', 'IDENTIFIER', 'COMBINED'] as const) {
      dobles[p] = procesosContadosDosVeces(historicas, actuales, seleccionarParaConteo(historicas, actuales, p, opciones));
    }
    return {
      politica: cfg.politica,
      practicasActuales: actuales.length,
      matriz: matriz.conteos,
      candidatosFuerza: {
        alta: matriz.pares.filter((p) => p.fuerza === 'alta').length,
        media: matriz.pares.filter((p) => p.fuerza === 'media').length,
      },
      conteo: { historicos: sel.historicos.size, actuales: sel.actuales.size, excluidosHistoricos: excluidos, procesosContadosDosVeces: dobles[cfg.politica] },
      dobleConteoPorPolitica: dobles,
    };
  }

  private resumen(
    op: OpcionesImportacion, archivo: MetadatosArchivo, resultado: ResumenImportacion['resultado'], importacionId: string | null,
    registros: readonly RegistroHistorico[], fechaCorte: string | null, comparado: boolean,
    p: { nuevos: number; versionados: number; sinCambios: number; ausentes: number }, solapamiento: ResumenSolapamiento | null,
    perfil: EtapaPerfil[], t0: number,
  ): ResumenImportacion {
    const observados = registros.filter((r) => r.qualityStatus === 'observed').length;
    return {
      modo: op.modo, resultado, importacionId, archivo, sourceSystem: op.sourceSystem, lectura: this.fuente.estadisticas(),
      fechaCorte, hmacKeyVersion: this.seudonimizador.versionClave, claveEfimera: this.seudonimizador.efimera,
      comparadoConBase: comparado, ...p, observados, limpios: registros.length - observados,
      observadosSoloPor: Object.fromEntries(Object.entries(registros.reduce<Record<string, number>>((m, r) => {
        if (r.qualityFlags.length === 1) m[r.qualityFlags[0]] = (m[r.qualityFlags[0]] ?? 0) + 1;
        return m;
      }, {})).sort((a, b) => b[1] - a[1])),
      marcas: conteoMarcas(registros), marcasOrganizacion: conteoMarcasOrganizacion(registros),
      organizaciones: resumenOrganizaciones(registros), agregados: agregadosDe(registros),
      elegibilidad: elegibilidadPorMetrica(registros),
      programas: inventarioProgramas(registros, op.programas),
      solapamiento, perfil, duracionMs: Date.now() - t0,
    };
  }
}
