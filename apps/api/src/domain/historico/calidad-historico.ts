/**
 * Catálogos de marcas de calidad del histórico del SGP (§25.13, §26.6 y §27.1 de
 * `docs/HISTORICO-PRACTICAS-AUDITORIA.md`).
 *
 * Una marca es un HECHO técnico observable, no un veredicto: el registro no se descarta ni se corrige, y su uso en
 * cada métrica lo decide la política por métrica (`politica-calidad-historico.ts`), no la marca.
 *
 * H3 separa DOS dominios de calidad:
 *  A. PRÁCTICA (`quality_flags` → `quality_status` `clean`/`observed`): hechos del registro de práctica (fechas,
 *     nivel, periodo, modalidad, salario, estructura de la fila…).
 *  B. ORGANIZACIÓN (`organization_flags` en la versión y `quality_flags` en `historico.organizaciones`): hechos del
 *     identificador o del nombre de la empresa. Que un empleador aparezca con varias variantes de nombre bajo el mismo
 *     NIT (H2 lo marcaba en el 67 % de las prácticas) NO convierte la práctica en observada.
 *
 * Los códigos son técnicos (inglés, MAYÚSCULAS) y no dependen del idioma de la interfaz.
 */
export const MARCAS_CALIDAD = [
  // ── Estructura de la fila ──
  'TRUNCATED_SOURCE_ROW',
  // ── Identidades de personas ──
  'STUDENT_ID_MISSING',
  'STUDENT_ID_ATYPICAL',
  'TEACHER_ID_MISSING',
  'TEACHER_ID_ATYPICAL',
  // ── Académico ──
  'PROGRAM_MISSING',
  /**
   * Informativa: la equivalencia programa → código SINU es un estado de CATÁLOGO (`programa_mapping_status`), no de
   * la fila; no se pone fila a fila (marcaría el 100 % como observado).
   */
  'PROGRAM_MAPPING_PENDING',
  'MISSING_LEVEL',
  'LEVEL_CONFLICT',
  'MISSING_STUDY_MODALITY',
  'STUDY_MODALITY_UNKNOWN',
  'SEMESTER_INVALID',
  // ── Periodo ──
  'PERIOD_MISSING',
  'PERIOD_MAPPING_PENDING',
  'PERIOD_UNPARSEABLE',
  // ── Modalidad de práctica y estado ──
  'MODALITY_MAPPING_PENDING',
  'STATE_UNKNOWN',
  // ── Fechas ──
  'INVALID_START_DATE',
  'INVALID_END_DATE',
  'END_BEFORE_START',
  'DATE_OUT_OF_RANGE',
  'DURATION_EXTREME',
  'INVALID_CREATION_DATE',
  'INVALID_ACTIVITY_DATE',
  // ── Salario ──
  'SALARY_UNPARSEABLE',
  'SALARY_OUTLIER',
  // ── Seguimiento SGP ──
  'DOCUMENT_RATIO_INVALID',
  'DOCS_APPROVED_EXCEED_UPLOADED',
  'LOGBOOK_COUNT_INVALID',
  // ── Lote (se calculan sobre el archivo completo) ──
  'IDENTICAL_CONTENT',
  'DUPLICATE_ACTIVE_IN_PERIOD',
] as const;

export type MarcaCalidad = (typeof MARCAS_CALIDAD)[number];

/**
 * Marcas de ORGANIZACIÓN. Las de fila describen el identificador o el nombre tal como vinieron en ESA práctica; las
 * de catálogo (`MULTIPLE_ALIASES`, `ALIAS_SHARED_ACROSS_IDENTIFIERS`, `MAPPING_PENDING`) solo existen sobre el
 * conjunto y viven en `historico.organizaciones`.
 */
export const MARCAS_ORGANIZACION = [
  'IDENTIFIER_MISSING',
  'IDENTIFIER_INVALID',
  'IDENTIFIER_NONSTANDARD',
  'IDENTIFIER_PERSON_NATURAL',
  'NIT_DV_INVALID',
  'NAME_MISSING',
  'MULTIPLE_ALIASES',
  'ALIAS_SHARED_ACROSS_IDENTIFIERS',
  'MAPPING_PENDING',
] as const;

export type MarcaOrganizacion = (typeof MARCAS_ORGANIZACION)[number];

/** Marcas de organización que exigen revisión humana del catálogo (`MAPPING_PENDING` es un estado, no un problema). */
export const MARCAS_ORGANIZACION_REVISION: readonly MarcaOrganizacion[] = [
  'MULTIPLE_ALIASES', 'ALIAS_SHARED_ACROSS_IDENTIFIERS', 'NIT_DV_INVALID', 'IDENTIFIER_NONSTANDARD',
];

export type EstadoCalidad = 'clean' | 'observed';

/** Marcas de práctica que se ponen sobre el archivo completo (después de la transformación fila a fila). */
export const MARCAS_DE_LOTE: readonly MarcaCalidad[] = ['IDENTICAL_CONTENT', 'DUPLICATE_ACTIVE_IN_PERIOD'];

export function estadoCalidad(marcas: readonly MarcaCalidad[]): EstadoCalidad {
  return marcas.length === 0 ? 'clean' : 'observed';
}

/** Orden estable (el del catálogo) y sin repetidos. */
export function ordenarMarcas(marcas: Iterable<MarcaCalidad>): MarcaCalidad[] {
  const conjunto = new Set(marcas);
  return MARCAS_CALIDAD.filter((m) => conjunto.has(m));
}

export function ordenarMarcasOrganizacion(marcas: Iterable<MarcaOrganizacion>): MarcaOrganizacion[] {
  const conjunto = new Set(marcas);
  return MARCAS_ORGANIZACION.filter((m) => conjunto.has(m));
}
