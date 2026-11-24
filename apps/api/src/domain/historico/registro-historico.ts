import { createHash } from 'node:crypto';
import { CicloAcademico, EstadoOperativo } from '../entities/practica.entity';
import { ModalidadPractica } from '../entities/modalidad.entity';
import {
  EstadoCalidad, MarcaCalidad, MarcaOrganizacion, estadoCalidad, ordenarMarcas, ordenarMarcasOrganizacion,
} from './calidad-historico';
import { Celda, diasEntre, parsearFechaSgp, parsearMarcaTiempoSgp } from './fechas-sgp.parser';
import {
  CalidadSalario, EstadoMapeo, FuenteNivel, ModalidadEstudio, TipoIdentificadorOrganizacion,
  analizarIdentificadorOrganizacion, claveTexto, conteoNoNegativo, inferirNivelSgp, mapearEstadoSgp,
  mapearModalidadPracticaSgp, nombreEmpresaCanonico, normalizarDocumentoSgp, normalizarModalidadEstudio,
  parsearSalarioSgp, proporcion, textoCelda,
} from './normalizacion-sgp';
import { EquivalenciasProgramas, resolverPrograma } from './programas-sgp';
import { EstadoMapeoPeriodo, FormatoPeriodo, parsearPeriodoSgp } from './periodo-sgp.parser';
import { SeudonimizadorHistorico } from './seudonimizacion-historico';
import { esSalarioConPii, sanearTextoLibre } from './saneamiento-pii-historico';

/** Sistemas de origen admitidos. `SGP_SINTETICO` aísla los fixtures de prueba del histórico real. */
export const SISTEMAS_ORIGEN = ['SGP', 'SGP_SINTETICO'] as const;
export type SistemaOrigen = (typeof SISTEMAS_ORIGEN)[number];

/**
 * Las 38 columnas de la exportación del SGP, con su nombre exacto (Unicode NFC). El lector exige todas.
 */
export const COLUMNAS_SGP = [
  '#', 'Documento', 'Nombre Estudiante', 'Email Estudiante', 'Telefono Estudiante', 'Programa', 'Regional',
  'Nivel Formación', 'Semestre Segun Creditos', 'Modalidad', 'Codigo Asignatura', 'Nombre Asignatura',
  'Estado Práctica', 'Periodo Inscripción Asignatura', 'Modalidad Práctica', 'Nombre Docente', 'Documento Docente',
  'Nit Empresa', 'Nombre Empresa', 'Cargo Estudiante', 'Horario', 'Salario', 'Funciones Relevantes', 'Área',
  'Cargo Jefe Inmediato', 'Nombre Jefe Inmediato', 'Email Jefe Inmediato', 'Telefono Jefe Inmediato', 'Ciudad',
  'Fecha inicio Práctica', 'Fecha Finalización Práctica', 'Documentos Subidos', 'Documentos Aprobados',
  'Registros Bitacora', 'Fecha Creación', 'Ultimo movimiento Estudiante', 'Ultimo movimiento Docente', 'Pensum',
] as const;
export type ColumnaSgp = (typeof COLUMNAS_SGP)[number];

/**
 * Columnas que la variante MINIMIZADA nunca lee del archivo (§26): datos personales directos y texto libre. El lector
 * ni siquiera las extrae de la hoja, así que no pueden llegar a memoria del importador, a la base ni a un log.
 */
export const COLUMNAS_EXCLUIDAS: readonly ColumnaSgp[] = [
  'Nombre Estudiante', 'Email Estudiante', 'Telefono Estudiante', 'Nombre Docente', 'Funciones Relevantes',
  'Cargo Jefe Inmediato', 'Nombre Jefe Inmediato', 'Email Jefe Inmediato', 'Telefono Jefe Inmediato',
];
export const COLUMNAS_LEIDAS: readonly ColumnaSgp[] = COLUMNAS_SGP.filter((c) => !COLUMNAS_EXCLUIDAS.includes(c));

/**
 * Columnas que solo sirven para calcular una clave seudónima: se leen, se transforman en memoria y se descartan.
 * No entran al `content_hash` (que podría revertirse por fuerza bruta junto con los demás campos conocidos).
 */
const COLUMNAS_SOLO_CLAVE: readonly ColumnaSgp[] = ['Documento', 'Documento Docente', 'Nit Empresa', 'Nombre Empresa'];

/** Columnas posteriores a `Nit Empresa`: si todas faltan, la fila de origen está truncada (3 filas reales). */
const COLUMNAS_TRAS_NIT: readonly ColumnaSgp[] = COLUMNAS_SGP.slice(COLUMNAS_SGP.indexOf('Nit Empresa') + 1);

export type FilaSgp = Partial<Record<ColumnaSgp, Celda>>;

export type PistaTipoOrganizacion = 'LEGAL_ENTITY' | 'NATURAL_PERSON' | 'UNKNOWN';

/** Contexto opcional de la transformación: equivalencias institucionales APROBADAS (nunca por similitud). */
export interface ContextoTransformacion {
  programas?: EquivalenciasProgramas;
}

/**
 * Internado de cadenas de baja cardinalidad (programa, periodo, ciudad…): 143.659 filas repiten unos pocos miles de
 * valores; sin internar, cada fila guarda su propia copia. Acotado para no crecer sin límite.
 */
const INTERNADAS = new Map<string, string>();
const MAXIMO_INTERNADAS = 300_000;
function i<T extends string | null>(v: T): T {
  if (v === null) return v;
  const ya = INTERNADAS.get(v);
  if (ya !== undefined) return ya as T;
  if (INTERNADAS.size < MAXIMO_INTERNADAS) INTERNADAS.set(v, v);
  return v;
}

export interface FilaFuente {
  /** Número de fila en la hoja (la cabecera es la 1). */
  filaOrigen: number;
  celdas: FilaSgp;
}

/** Una versión de un registro del SGP, ya minimizada: ningún campo contiene un dato personal directo. */
export interface RegistroHistorico {
  sourceSystem: SistemaOrigen;
  sourceRecordId: string;
  sourceRow: number;
  contentHash: string;
  /** Huella del contenido SIN el id de origen: detecta filas idénticas con `#` distinto. */
  huellaSinId: string;
  hmacKeyVersion: string;
  studentKey: string | null;
  teacherKey: string | null;

  programaOriginal: string | null;
  programaNormalizado: string | null;
  codigoSinu: string | null;
  programaMappingStatus: EstadoMapeo;
  regionalOriginal: string | null;
  regional: string | null;
  nivelOriginal: string | null;
  nivelInferido: CicloAcademico | null;
  nivelFuente: FuenteNivel;
  asignaturaOriginal: string | null;
  codigoAsignatura: string | null;
  semestreCreditos: number | null;
  modalidadEstudioOriginal: string | null;
  modalidadEstudioNormalizada: ModalidadEstudio | null;
  pensum: string | null;

  periodoOriginal: string | null;
  periodoNormalizado: string | null;
  periodoFormato: FormatoPeriodo;
  periodoAnio: number | null;
  periodoOrdinal: string | null;
  periodoMappingStatus: EstadoMapeoPeriodo;

  modalidadPracticaOriginal: string | null;
  modalidadPracticaNormalizada: ModalidadPractica | null;
  modalidadMappingStatus: EstadoMapeo;
  estadoOriginal: string | null;
  estadoAnalitico: EstadoOperativo | null;
  estadoMappingStatus: EstadoMapeo;
  esEstadoDeCorte: boolean;
  /** Fecha de corte del archivo: a ella se refiere el estado. La fija el lote. */
  estadoFechaCorte: string | null;

  organizationKey: string | null;
  organizationIdentifierKind: TipoIdentificadorOrganizacion;
  nitDvValid: boolean | null;
  nitJuridica: string | null;
  empresaAliasHash: string | null;
  /** Solo cuando se puede determinar técnicamente (§27.2); `null` si la fila no trae identificador. */
  organizationTypeHint: PistaTipoOrganizacion | null;
  /** Calidad del identificador/nombre de la empresa EN ESTA FILA: no afecta `qualityStatus`. */
  organizationFlags: MarcaOrganizacion[];

  area: string | null;
  cargoEstudiante: string | null;
  horario: string | null;
  ciudadOriginal: string | null;
  ciudadNormalizada: string | null;

  fechaInicioOriginal: string | null;
  fechaInicio: string | null;
  fechaFinOriginal: string | null;
  fechaFin: string | null;
  duracionDias: number | null;
  fechaCreacion: string | null;
  ultimoMovimientoEstudiante: string | null;
  ultimoMovimientoDocente: string | null;

  salarioOriginal: string | null;
  salarioNormalizado: number | null;
  salarioCalidad: CalidadSalario;

  documentosSubidosRatio: number | null;
  documentosAprobadosRatio: number | null;
  bitacoraCount: number | null;

  qualityFlags: MarcaCalidad[];
  qualityStatus: EstadoCalidad;
  /**
   * Si la fila es una copia de otra (`IDENTICAL_CONTENT`), el `#` del representante del grupo (el menor). El
   * representante lleva `null`: así las métricas cuentan cada práctica UNA vez sin borrar ninguna fila.
   */
  duplicadoDe: string | null;
}

export class FilaSinIdentificadorError extends Error {
  constructor(filaOrigen: number) {
    super(`La fila ${filaOrigen} no tiene «#»: no es un registro del SGP y no debía llegar al transformador`);
    this.name = 'FilaSinIdentificadorError';
  }
}

const DURACION_EXTREMA_DIAS = 730;

/** `#` como texto: entero exacto si vino numérico; `null` si la fila no es un registro real. */
export function idRegistroSgp(celda: Celda | undefined): string | null {
  if (celda === null || celda === undefined) return null;
  if (typeof celda === 'number') return Number.isFinite(celda) && Number.isInteger(celda) ? BigInt(celda).toString() : String(celda);
  const t = textoCelda(celda);
  return t;
}

/** ¿Es una fila real? La ÚNICA condición es `#` no vacío (nunca un `dropna` genérico). */
export function esFilaReal(celdas: FilaSgp): boolean {
  return idRegistroSgp(celdas['#']) !== null;
}

/** SHA-256 de una serialización canónica: pares [clave, valor] en orden fijo, sin metadatos del proceso. */
function huella(pares: readonly (readonly [string, string | null])[]): string {
  return createHash('sha256').update(JSON.stringify(pares), 'utf8').digest('hex');
}

/**
 * Marcador fijo con el que una celda saneada (§31) entra a la huella. El valor original no participa: el resto de la
 * fila se persiste, así que un hash que lo incluyera permitiría recuperarlo por fuerza bruta (p. ej. 10⁹ celulares).
 */
const CELDA_SANEADA = '[SANEADO]';

function representacionCanonica(celdas: FilaSgp, incluirId: boolean, saneadas: ReadonlySet<ColumnaSgp> = new Set()): [string, string | null][] {
  const pares: [string, string | null][] = [];
  for (const columna of COLUMNAS_LEIDAS) {
    if (COLUMNAS_SOLO_CLAVE.includes(columna)) continue;
    if (columna === '#' && !incluirId) continue;
    if (saneadas.has(columna)) { pares.push([columna, CELDA_SANEADA]); continue; }
    const c = celdas[columna] ?? null;
    pares.push([columna, c instanceof Date ? c.toISOString() : textoCelda(c)]);
  }
  return pares;
}

/**
 * Transforma una fila REAL en un registro minimizado. Nunca lanza por un dato extraño (lo marca); solo lanza si se le
 * entrega una fila sin `#`, que es un error de programación del lector.
 */
export function transformarFilaSgp(
  fila: FilaFuente, sistema: SistemaOrigen, seud: SeudonimizadorHistorico, contexto: ContextoTransformacion = {},
): RegistroHistorico {
  const c = fila.celdas;
  const id = idRegistroSgp(c['#']);
  if (id === null) throw new FilaSinIdentificadorError(fila.filaOrigen);
  const marcas = new Set<MarcaCalidad>();
  const t = (col: ColumnaSgp): string | null => textoCelda(c[col] ?? null);

  if (COLUMNAS_TRAS_NIT.every((col) => textoCelda(c[col] ?? null) === null)) marcas.add('TRUNCATED_SOURCE_ROW');

  const doc = normalizarDocumentoSgp(c['Documento'] ?? null);
  if (doc.observacion === 'ausente') marcas.add('STUDENT_ID_MISSING');
  if (doc.observacion === 'atipico') marcas.add('STUDENT_ID_ATYPICAL');
  const docDocente = normalizarDocumentoSgp(c['Documento Docente'] ?? null);
  if (docDocente.observacion === 'ausente') marcas.add('TEACHER_ID_MISSING');
  if (docDocente.observacion === 'atipico') marcas.add('TEACHER_ID_ATYPICAL');

  const programa = t('Programa');
  if (!programa) marcas.add('PROGRAM_MISSING');

  const nivelOriginal = t('Nivel Formación');
  const asignatura = t('Nombre Asignatura');
  const nivel = inferirNivelSgp(nivelOriginal, asignatura);
  if (nivel.faltante) marcas.add('MISSING_LEVEL');
  if (nivel.conflicto) marcas.add('LEVEL_CONFLICT');

  const semestre = conteoNoNegativo(c['Semestre Segun Creditos'] ?? null);
  const semestreValido = semestre.valor !== null && semestre.valor >= 1 && semestre.valor <= 12 ? semestre.valor : null;
  if (semestre.invalido || (semestre.valor !== null && semestreValido === null)) marcas.add('SEMESTER_INVALID');

  const modalidadEstudio = t('Modalidad');
  const modalidadEstudioNorm = normalizarModalidadEstudio(modalidadEstudio);
  if (!modalidadEstudio) marcas.add('MISSING_STUDY_MODALITY');
  else if (!modalidadEstudioNorm) marcas.add('STUDY_MODALITY_UNKNOWN');

  const periodo = parsearPeriodoSgp(t('Periodo Inscripción Asignatura'));
  if (periodo.estadoMapeo === 'MISSING') marcas.add('PERIOD_MISSING');
  if (periodo.estadoMapeo === 'LEGACY') marcas.add('PERIOD_MAPPING_PENDING');
  if (periodo.estadoMapeo === 'UNPARSEABLE') marcas.add('PERIOD_UNPARSEABLE');

  const modalidadPractica = t('Modalidad Práctica');
  const modalidad = mapearModalidadPracticaSgp(modalidadPractica);
  if (modalidad.estadoMapeo !== 'MAPPED') marcas.add('MODALITY_MAPPING_PENDING');

  const estadoOriginal = t('Estado Práctica');
  const estado = mapearEstadoSgp(estadoOriginal);
  if (estado.estadoMapeo !== 'MAPPED') marcas.add('STATE_UNKNOWN');

  const org = analizarIdentificadorOrganizacion(c['Nit Empresa'] ?? null);
  // Calidad de ORGANIZACIÓN (dominio B): no toca la calidad de la práctica.
  const marcasOrg = new Set<MarcaOrganizacion>();
  if (org.tipo === 'ausente') marcasOrg.add('IDENTIFIER_MISSING');
  if (org.tipo === 'invalido') marcasOrg.add('IDENTIFIER_INVALID');
  if (org.tipo === 'no_estandar') marcasOrg.add('IDENTIFIER_NONSTANDARD');
  if (org.tipo === 'persona_natural') marcasOrg.add('IDENTIFIER_PERSON_NATURAL');
  if (org.dvValido === false) marcasOrg.add('NIT_DV_INVALID');
  const nombreEmpresa = nombreEmpresaCanonico(c['Nombre Empresa'] ?? null);
  if (!nombreEmpresa) marcasOrg.add('NAME_MISSING');
  const pista: PistaTipoOrganizacion | null = org.tipo === 'ausente' || org.tipo === 'invalido' ? null
    : org.tipo === 'juridica' ? 'LEGAL_ENTITY' : org.tipo === 'persona_natural' ? 'NATURAL_PERSON' : 'UNKNOWN';
  const programaResuelto = resolverPrograma(claveTexto(programa), contexto.programas);

  const inicio = parsearFechaSgp(c['Fecha inicio Práctica'] ?? null);
  const fin = parsearFechaSgp(c['Fecha Finalización Práctica'] ?? null);
  if (inicio.estado === 'invalida') marcas.add('INVALID_START_DATE');
  if (fin.estado === 'invalida') marcas.add('INVALID_END_DATE');
  if (inicio.estado === 'fuera_de_rango' || fin.estado === 'fuera_de_rango') marcas.add('DATE_OUT_OF_RANGE');
  let duracion: number | null = null;
  if (inicio.fecha && fin.fecha) {
    const d = diasEntre(inicio.fecha, fin.fecha);
    if (d < 0) marcas.add('END_BEFORE_START');
    else if (d > DURACION_EXTREMA_DIAS) marcas.add('DURATION_EXTREME');
    if (d >= 0 && inicio.estado === 'valida' && fin.estado === 'valida') duracion = d;
  }
  const creacion = parsearFechaSgp(c['Fecha Creación'] ?? null);
  if (creacion.estado === 'invalida') marcas.add('INVALID_CREATION_DATE');
  const movEst = parsearMarcaTiempoSgp(c['Ultimo movimiento Estudiante'] ?? null);
  const movDoc = parsearMarcaTiempoSgp(c['Ultimo movimiento Docente'] ?? null);
  if (movEst.estado === 'invalida' || movDoc.estado === 'invalida') marcas.add('INVALID_ACTIVITY_DATE');

  // §31: un celular o un correo en la columna Salario no se guarda ni como texto ni como monto.
  const celdaSalario = c['Salario'] ?? null;
  const salarioConPii = esSalarioConPii(typeof celdaSalario === 'string' || typeof celdaSalario === 'number' ? String(celdaSalario) : null);
  const salario: ReturnType<typeof parsearSalarioSgp> = salarioConPii
    ? { original: null, normalizado: null, calidad: 'no_interpretable' }
    : parsearSalarioSgp(celdaSalario);
  if (salarioConPii) marcas.add('PII_SUSPECT_SALARY');
  else if (salario.calidad === 'no_interpretable') marcas.add('SALARY_UNPARSEABLE');
  if (salario.calidad === 'atipico') marcas.add('SALARY_OUTLIER');

  const subidos = proporcion(c['Documentos Subidos'] ?? null);
  const aprobados = proporcion(c['Documentos Aprobados'] ?? null);
  if (subidos.invalida || aprobados.invalida) marcas.add('DOCUMENT_RATIO_INVALID');
  if (subidos.valor !== null && aprobados.valor !== null && aprobados.valor > subidos.valor) marcas.add('DOCS_APPROVED_EXCEED_UPLOADED');
  const bitacora = conteoNoNegativo(c['Registros Bitacora'] ?? null);
  if (bitacora.invalido) marcas.add('LOGBOOK_COUNT_INVALID');

  // §31: saneamiento de datos personales en texto libre ANTES de persistir. Un campo contaminado queda en NULL entero
  // (la ciudad, además, sin versión normalizada: la normalización no debe conservar el dato transformado).
  const ciudad = sanearTextoLibre(t('Ciudad')?.slice(0, 200) ?? null);
  const cargo = sanearTextoLibre(t('Cargo Estudiante')?.slice(0, 300) ?? null);
  const horario = sanearTextoLibre(horarioTexto(c['Horario'] ?? null));
  const area = sanearTextoLibre(t('Área'));
  const ciudadNormalizada = ciudad.valor ? sanearTextoLibre(claveTexto(ciudad.valor)?.slice(0, 200) ?? null) : { valor: null, saneado: false };
  if (ciudad.saneado || ciudadNormalizada.saneado) marcas.add('PII_SUSPECT_CITY');
  if (cargo.saneado) marcas.add('PII_SUSPECT_STUDENT_POSITION');
  if (horario.saneado) marcas.add('PII_SUSPECT_SCHEDULE');
  if (area.saneado) marcas.add('PII_SUSPECT_AREA');
  const ciudadLimpia = ciudadNormalizada.saneado ? null : ciudad.valor;
  const saneadas = new Set<ColumnaSgp>();
  if (ciudad.saneado || ciudadNormalizada.saneado) saneadas.add('Ciudad');
  if (cargo.saneado) saneadas.add('Cargo Estudiante');
  if (horario.saneado) saneadas.add('Horario');
  if (area.saneado) saneadas.add('Área');
  if (salarioConPii) saneadas.add('Salario');
  const regional = t('Regional');
  const flags = ordenarMarcas(marcas);
  return {
    sourceSystem: sistema,
    sourceRecordId: id,
    sourceRow: fila.filaOrigen,
    contentHash: huella(representacionCanonica(c, true, saneadas)),
    huellaSinId: huella(representacionCanonica(c, false, saneadas)),
    hmacKeyVersion: seud.versionClave,
    studentKey: seud.clave('student', doc.normalizado),
    teacherKey: seud.clave('teacher', docDocente.normalizado),

    programaOriginal: i(programa),
    programaNormalizado: i(claveTexto(programa)),
    codigoSinu: programaResuelto.codigoSinu,
    programaMappingStatus: programa ? programaResuelto.estado : 'MISSING',
    regionalOriginal: i(regional),
    regional: i(regional ? regional.toUpperCase() : null),
    nivelOriginal: i(nivelOriginal),
    nivelInferido: nivel.inferido,
    nivelFuente: nivel.fuente,
    asignaturaOriginal: i(asignatura),
    codigoAsignatura: i(t('Codigo Asignatura')),
    semestreCreditos: semestreValido,
    modalidadEstudioOriginal: i(modalidadEstudio),
    modalidadEstudioNormalizada: modalidadEstudioNorm,
    pensum: i(t('Pensum')),

    periodoOriginal: i(periodo.original),
    periodoNormalizado: i(periodo.normalizado),
    periodoFormato: periodo.formato,
    periodoAnio: periodo.anio,
    periodoOrdinal: periodo.ordinal,
    periodoMappingStatus: periodo.estadoMapeo,

    modalidadPracticaOriginal: i(modalidadPractica),
    modalidadPracticaNormalizada: modalidad.normalizada,
    modalidadMappingStatus: modalidad.estadoMapeo,
    estadoOriginal: i(estadoOriginal),
    estadoAnalitico: estado.analitico,
    estadoMappingStatus: estado.estadoMapeo,
    esEstadoDeCorte: estado.esEstadoDeCorte,
    estadoFechaCorte: null,

    organizationKey: seud.clave('organization', org.normalizado),
    organizationIdentifierKind: org.tipo,
    nitDvValid: org.dvValido,
    nitJuridica: org.nitJuridica,
    empresaAliasHash: seud.clave('organization-alias', nombreEmpresa),
    organizationTypeHint: pista,
    organizationFlags: ordenarMarcasOrganizacion(marcasOrg),

    area: i(area.valor),
    cargoEstudiante: i(cargo.valor),
    horario: horario.valor,
    ciudadOriginal: i(ciudadLimpia),
    ciudadNormalizada: i(ciudadNormalizada.valor),

    fechaInicioOriginal: inicio.original,
    fechaInicio: inicio.fecha,
    fechaFinOriginal: fin.original,
    fechaFin: fin.fecha,
    duracionDias: duracion,
    fechaCreacion: creacion.fecha,
    ultimoMovimientoEstudiante: movEst.instante,
    ultimoMovimientoDocente: movDoc.instante,

    salarioOriginal: salario.original,
    salarioNormalizado: salario.normalizado,
    salarioCalidad: salario.calidad,

    documentosSubidosRatio: subidos.valor,
    documentosAprobadosRatio: aprobados.valor,
    bitacoraCount: bitacora.valor,

    qualityFlags: flags,
    qualityStatus: estadoCalidad(flags),
    duplicadoDe: null,
  };
}

/** Excel convierte a veces «8:00» en una hora o una fecha: se reconstruye texto legible, sin inventar. */
function horarioTexto(celda: Celda): string | null {
  if (celda instanceof Date) {
    if (Number.isNaN(celda.getTime())) return null;
    const hh = String(celda.getUTCHours()).padStart(2, '0');
    const mm = String(celda.getUTCMinutes()).padStart(2, '0');
    return celda.getUTCFullYear() <= 1900 ? `${hh}:${mm}` : celda.toISOString().slice(0, 16).replace('T', ' ');
  }
  return textoCelda(celda)?.slice(0, 300) ?? null;
}

// ── Lote: marcas que solo se ven sobre el archivo completo ──────────────────

/**
 * Fija la fecha de corte y agrega las marcas de lote DE PRÁCTICA:
 *  - `IDENTICAL_CONTENT`: mismo contenido y mismas identidades con `#` distinto (se conservan TODOS: son registros
 *    distintos del SGP);
 *  - `DUPLICATE_ACTIVE_IN_PERIOD`: más de un registro no anulado del mismo estudiante en el mismo periodo (violaría
 *    la unicidad operativa de SIPRA; es historia válida del SGP y no se corrige).
 *
 * La ambigüedad de empresa (un NIT con varios nombres, un nombre con varios NIT) YA NO se marca en la práctica (H3,
 * §27.1): es calidad de la ORGANIZACIÓN y vive en `historico.organizaciones` (ver `resumenOrganizaciones`).
 * La huella sin id solo sirve aquí: se libera al terminar para no retenerla en memoria.
 */
export function aplicarMarcasDeLote(registros: RegistroHistorico[], fechaCorte: string | null): void {
  const porContenido = new Map<string, number>();
  const porEstudiantePeriodo = new Map<string, number>();
  const claveContenido = (r: RegistroHistorico): string => `${r.huellaSinId}|${r.studentKey}|${r.teacherKey}|${r.organizationKey}|${r.empresaAliasHash}`;
  const claveActivo = (r: RegistroHistorico): string | null =>
    r.studentKey && r.periodoOriginal && r.estadoAnalitico !== 'anulado' ? `${r.studentKey}|${r.periodoOriginal}` : null;
  for (const r of registros) {
    const k = claveContenido(r);
    porContenido.set(k, (porContenido.get(k) ?? 0) + 1);
    const a = claveActivo(r);
    if (a) porEstudiantePeriodo.set(a, (porEstudiantePeriodo.get(a) ?? 0) + 1);
  }
  const representante = new Map<string, string>();
  const numerico = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
  for (const r of registros) {
    const k = claveContenido(r);
    if ((porContenido.get(k) ?? 0) > 1) {
      const actual = representante.get(k);
      if (actual === undefined || numerico(r.sourceRecordId, actual) < 0) representante.set(k, r.sourceRecordId);
    }
  }
  for (const r of registros) {
    r.estadoFechaCorte = fechaCorte;
    const extra: MarcaCalidad[] = [];
    const rep = representante.get(claveContenido(r));
    if (rep !== undefined) {
      extra.push('IDENTICAL_CONTENT');
      r.duplicadoDe = rep === r.sourceRecordId ? null : rep;
    }
    const a = claveActivo(r);
    if (a && (porEstudiantePeriodo.get(a) ?? 0) > 1) extra.push('DUPLICATE_ACTIVE_IN_PERIOD');
    if (extra.length) {
      r.qualityFlags = ordenarMarcas([...r.qualityFlags, ...extra]);
      r.qualityStatus = estadoCalidad(r.qualityFlags);
    }
  }
  for (const r of registros) r.huellaSinId = '';
}

/** Resumen del catálogo de organizaciones que resultaría del lote (lo mismo que deriva la base al aplicar). */
export interface ResumenOrganizaciones {
  organizaciones: number;
  porPista: Record<PistaTipoOrganizacion, number>;
  conVariosAlias: number;
  conAliasCompartido: number;
  conDvInvalido: number;
  noEstandar: number;
  requierenRevision: number;
  practicasSinIdentificador: number;
  /** Prácticas cuya organización tiene varios alias (antes, en H2, quedaban observadas por esto). */
  practicasConOrganizacionMultiAlias: number;
}

export function resumenOrganizaciones(registros: readonly RegistroHistorico[]): ResumenOrganizaciones {
  const alias = new Map<string, Set<string>>();
  const orgsDeAlias = new Map<string, Set<string>>();
  const pista = new Map<string, Map<PistaTipoOrganizacion, number>>();
  const dvInvalido = new Set<string>();
  const noEstandar = new Set<string>();
  let sinIdentificador = 0;
  for (const r of registros) {
    const k = r.organizationKey;
    if (!k) { sinIdentificador += 1; continue; }
    if (!alias.has(k)) alias.set(k, new Set());
    if (r.empresaAliasHash) {
      alias.get(k)!.add(r.empresaAliasHash);
      if (!orgsDeAlias.has(r.empresaAliasHash)) orgsDeAlias.set(r.empresaAliasHash, new Set());
      orgsDeAlias.get(r.empresaAliasHash)!.add(k);
    }
    const p = r.organizationTypeHint ?? 'UNKNOWN';
    if (!pista.has(k)) pista.set(k, new Map());
    pista.get(k)!.set(p, (pista.get(k)!.get(p) ?? 0) + 1);
    if (r.organizationFlags.includes('NIT_DV_INVALID')) dvInvalido.add(k);
    if (r.organizationFlags.includes('IDENTIFIER_NONSTANDARD')) noEstandar.add(k);
  }
  const porPista: Record<PistaTipoOrganizacion, number> = { LEGAL_ENTITY: 0, NATURAL_PERSON: 0, UNKNOWN: 0 };
  for (const conteo of pista.values()) {
    const [moda] = [...conteo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    porPista[moda] += 1;
  }
  const varios = new Set([...alias].filter(([, s]) => s.size > 1).map(([k]) => k));
  const compartido = new Set<string>();
  for (const orgs of orgsDeAlias.values()) if (orgs.size > 1) for (const k of orgs) compartido.add(k);
  const revision = new Set([...varios, ...compartido, ...dvInvalido, ...noEstandar]);
  return {
    organizaciones: alias.size, porPista, conVariosAlias: varios.size, conAliasCompartido: compartido.size,
    conDvInvalido: dvInvalido.size, noEstandar: noEstandar.size, requierenRevision: revision.size,
    practicasSinIdentificador: sinIdentificador,
    practicasConOrganizacionMultiAlias: registros.filter((r) => r.organizationKey && varios.has(r.organizationKey)).length,
  };
}

/** Fecha de corte = el último movimiento (estudiante o docente) presente en el archivo. */
export function fechaCorteDe(registros: readonly RegistroHistorico[]): string | null {
  let max: string | null = null;
  for (const r of registros) {
    for (const v of [r.ultimoMovimientoEstudiante, r.ultimoMovimientoDocente]) if (v && (!max || v > max)) max = v;
  }
  return max;
}

// ── Planificación del versionado ────────────────────────────────────────────

export interface VersionVigente {
  id: string;
  version: number;
  contentHash: string;
  hmacKeyVersion: string;
  studentKey: string | null;
  teacherKey: string | null;
  organizationKey: string | null;
  empresaAliasHash: string | null;
}

export interface PlanImportacion {
  nuevos: RegistroHistorico[];
  versionados: { registro: RegistroHistorico; anterior: VersionVigente }[];
  sinCambios: number;
  /** Vigentes en la base que no vienen en este archivo: se conservan y solo se cuentan. */
  ausentes: number;
}

/**
 * §18 del encargo H2:
 *  A. id nuevo → versión 1;
 *  B. id existente con el mismo contenido → sin cambios (no se escribe);
 *  C. id existente con contenido distinto → nueva versión; la anterior deja de ser la vigente, nunca se sobrescribe.
 *
 * «Contenido» = `content_hash` (campos no identificadores) Y las claves seudónimas: un cambio de documento, de NIT o de
 * nombre de empresa también es un cambio, aunque esos valores no entren al hash (ver `COLUMNAS_SOLO_CLAVE`). Solo es
 * comparable con la misma versión de clave; otra versión es una rotación, que H2 no implementa.
 */
export function planificarImportacion(registros: readonly RegistroHistorico[], vigentes: ReadonlyMap<string, VersionVigente>): PlanImportacion {
  const plan: PlanImportacion = { nuevos: [], versionados: [], sinCambios: 0, ausentes: 0 };
  const vistos = new Set<string>();
  for (const r of registros) {
    vistos.add(r.sourceRecordId);
    const anterior = vigentes.get(r.sourceRecordId);
    if (!anterior) { plan.nuevos.push(r); continue; }
    const igual = anterior.contentHash === r.contentHash
      && anterior.studentKey === r.studentKey && anterior.teacherKey === r.teacherKey
      && anterior.organizationKey === r.organizationKey && anterior.empresaAliasHash === r.empresaAliasHash;
    if (igual) plan.sinCambios += 1;
    else plan.versionados.push({ registro: r, anterior });
  }
  for (const id of vigentes.keys()) if (!vistos.has(id)) plan.ausentes += 1;
  return plan;
}

export class RegistroDuplicadoEnArchivoError extends Error {
  constructor(public readonly sourceRecordId: string) {
    super(`El archivo trae dos veces el registro SGP «${sourceRecordId}»: la identidad del origen no es única y no se importa`);
    this.name = 'RegistroDuplicadoEnArchivoError';
  }
}

export function exigirIdsUnicos(registros: readonly RegistroHistorico[]): void {
  const vistos = new Set<string>();
  for (const r of registros) {
    if (vistos.has(r.sourceRecordId)) throw new RegistroDuplicadoEnArchivoError(r.sourceRecordId);
    vistos.add(r.sourceRecordId);
  }
}
