import { MarcaCalidad, MarcaOrganizacion } from './calidad-historico';
import { RegistroHistorico } from './registro-historico';

/**
 * Política de calidad POR MÉTRICA del histórico del SGP (§27.6). En lugar de declarar una fila «inválida», cada
 * métrica declara qué hechos la excluyen y qué datos necesita. Es la ÚNICA definición: la capa analítica futura (H4)
 * debe consultarla (o generar su SQL desde ella) y no dispersar exclusiones en consultas.
 *
 * Reglas transversales:
 *  - solo cuentan las versiones VIGENTES de importaciones `completed` (eso lo garantiza la consulta, no esta política);
 *  - un estado abierto (`Inscrito`, `En Práctica`) es el estado AL CORTE: no entra a las tasas de resultado;
 *  - la calidad de la ORGANIZACIÓN solo afecta a las métricas de organización.
 */
export const METRICAS_HISTORICAS = [
  'practicas_por_periodo', 'practicas', 'estudiantes_unicos', 'programa', 'nivel', 'regional', 'modalidad_estudio',
  'modalidad_practica', 'estado', 'tasa_cierre', 'tasa_reprobacion', 'tasa_anulacion',
  'organizacion', 'ciudad', 'duracion', 'salario', 'indicador_documental_sgp', 'actividad',
] as const;
export type MetricaHistorica = (typeof METRICAS_HISTORICAS)[number];

export type ClaseMetrica = 'limpia' | 'condicionada';

interface ReglaMetrica {
  clase: ClaseMetrica;
  descripcion: string;
  /** Marcas de PRÁCTICA que excluyen la fila de esta métrica. */
  excluyePractica: readonly MarcaCalidad[];
  /** Marcas de ORGANIZACIÓN que excluyen la fila de esta métrica. */
  excluyeOrganizacion: readonly MarcaOrganizacion[];
  /** Datos imprescindibles: si falta alguno, la fila no aporta a la métrica. */
  requiere: readonly (keyof RegistroHistorico)[];
  /** Las tasas de resultado excluyen el estado al corte. */
  excluyeEstadoDeCorte?: boolean;
}

/** Duplicados estructurales: misma práctica registrada dos veces (filas idénticas con `#` distinto). */
const DUPLICADOS: readonly MarcaCalidad[] = ['IDENTICAL_CONTENT'];

export const POLITICA_CALIDAD: Readonly<Record<MetricaHistorica, ReglaMetrica>> = {
  practicas_por_periodo: {
    clase: 'limpia', descripcion: 'Registros por periodo del SGP (incluye fechas incoherentes: no afectan el periodo).',
    excluyePractica: ['PERIOD_MISSING', 'PERIOD_UNPARSEABLE', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['periodoOriginal'],
  },
  practicas: {
    clase: 'limpia', descripcion: 'Conteo de registros de práctica.', excluyePractica: DUPLICADOS, excluyeOrganizacion: [], requiere: [],
  },
  estudiantes_unicos: {
    clase: 'limpia', descripcion: 'Estudiantes distintos por clave seudónima.', excluyePractica: ['STUDENT_ID_MISSING', 'STUDENT_ID_ATYPICAL'],
    excluyeOrganizacion: [], requiere: ['studentKey'],
  },
  programa: {
    clase: 'limpia', descripcion: 'Por programa (nombre SGP; el código SINU solo si la equivalencia está confirmada).',
    excluyePractica: ['PROGRAM_MISSING', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['programaNormalizado'],
  },
  nivel: {
    clase: 'limpia', descripcion: 'Por ciclo inferido (la asignatura es fuente fiable; `MISSING_LEVEL` no excluye).',
    excluyePractica: [...DUPLICADOS], excluyeOrganizacion: [], requiere: ['nivelInferido'],
  },
  regional: { clase: 'limpia', descripcion: 'Por regional.', excluyePractica: DUPLICADOS, excluyeOrganizacion: [], requiere: ['regional'] },
  modalidad_estudio: {
    clase: 'limpia', descripcion: 'Virtual / presencial / a distancia (no es la modalidad de práctica).',
    excluyePractica: ['STUDY_MODALITY_UNKNOWN', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['modalidadEstudioNormalizada'],
  },
  modalidad_practica: {
    clase: 'limpia', descripcion: 'Por modalidad de SIPRA; `EMPRESA PROPIA` se reporta aparte como pendiente institucional.',
    excluyePractica: DUPLICADOS, excluyeOrganizacion: [], requiere: ['modalidadPracticaOriginal'],
  },
  estado: {
    clase: 'limpia', descripcion: 'Distribución de estados (los abiertos se rotulan «al corte»).',
    excluyePractica: ['STATE_UNKNOWN', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['estadoAnalitico'],
  },
  tasa_cierre: {
    clase: 'limpia', descripcion: 'Cerrados / (registros con resultado), sin estados al corte.',
    excluyePractica: ['STATE_UNKNOWN', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['estadoAnalitico'], excluyeEstadoDeCorte: true,
  },
  tasa_reprobacion: {
    clase: 'limpia', descripcion: 'Reprobados / (registros con resultado), sin estados al corte.',
    excluyePractica: ['STATE_UNKNOWN', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['estadoAnalitico'], excluyeEstadoDeCorte: true,
  },
  tasa_anulacion: {
    clase: 'limpia', descripcion: 'Anulados / (registros con resultado), sin estados al corte.',
    excluyePractica: ['STATE_UNKNOWN', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['estadoAnalitico'], excluyeEstadoDeCorte: true,
  },
  organizacion: {
    clase: 'condicionada', descripcion: 'Por organización receptora (clave seudónima); sin identificador válido se reporta aparte.',
    excluyePractica: DUPLICADOS, excluyeOrganizacion: ['IDENTIFIER_MISSING', 'IDENTIFIER_INVALID'], requiere: ['organizationKey'],
  },
  ciudad: {
    clase: 'condicionada', descripcion: 'Por ciudad; exige la equivalencia DIVIPOLA (pendiente): hasta entonces, solo el texto normalizado.',
    excluyePractica: DUPLICADOS, excluyeOrganizacion: [], requiere: ['ciudadNormalizada'],
  },
  duracion: {
    clase: 'condicionada', descripcion: 'Días entre inicio y fin, solo con ambas fechas válidas y coherentes.',
    excluyePractica: ['INVALID_START_DATE', 'INVALID_END_DATE', 'END_BEFORE_START', 'DATE_OUT_OF_RANGE', 'DURATION_EXTREME', 'TRUNCATED_SOURCE_ROW', ...DUPLICADOS],
    excluyeOrganizacion: [], requiere: ['duracionDias'],
  },
  salario: {
    clase: 'condicionada', descripcion: 'Solo salarios inequívocos (`exacto`) o no remunerados explícitos.',
    excluyePractica: ['SALARY_UNPARSEABLE', 'SALARY_OUTLIER', ...DUPLICADOS], excluyeOrganizacion: [], requiere: ['salarioNormalizado'],
  },
  indicador_documental_sgp: {
    clase: 'condicionada',
    descripcion: '«Indicador documental SGP»: proporción subida/aprobada del SGP. NO es Cumplimiento V3 ni comparable con su matriz.',
    excluyePractica: ['DOCUMENT_RATIO_INVALID', 'DOCS_APPROVED_EXCEED_UPLOADED', 'TRUNCATED_SOURCE_ROW', ...DUPLICADOS],
    excluyeOrganizacion: [], requiere: ['documentosSubidosRatio', 'documentosAprobadosRatio'],
  },
  actividad: {
    clase: 'condicionada', descripcion: 'Bitácora y últimos movimientos (solo el último movimiento: no hay serie temporal).',
    excluyePractica: ['INVALID_ACTIVITY_DATE', 'LOGBOOK_COUNT_INVALID', 'TRUNCATED_SOURCE_ROW', ...DUPLICADOS],
    excluyeOrganizacion: [], requiere: ['ultimoMovimientoEstudiante'],
  },
};

/**
 * Duplicados estructurales: de un grupo de filas idénticas solo cuenta el REPRESENTANTE (`duplicadoDe = null`); las
 * demás (`duplicadoDe` = `#` del representante) se excluyen de las métricas, sin borrarse del histórico.
 */
export interface Elegibilidad {
  elegible: boolean;
  motivo: string | null;
}

type ParaElegibilidad = Pick<RegistroHistorico, 'qualityFlags' | 'organizationFlags' | 'esEstadoDeCorte' | 'duplicadoDe'> & Partial<RegistroHistorico>;

export function elegibilidadHistorica(r: ParaElegibilidad, metrica: MetricaHistorica): Elegibilidad {
  const regla = POLITICA_CALIDAD[metrica];
  for (const m of regla.excluyePractica) {
    if (m === 'IDENTICAL_CONTENT') { if (r.duplicadoDe) return { elegible: false, motivo: 'DUPLICADO_DE_OTRO_REGISTRO' }; continue; }
    if (r.qualityFlags.includes(m)) return { elegible: false, motivo: m };
  }
  for (const m of regla.excluyeOrganizacion) if (r.organizationFlags.includes(m)) return { elegible: false, motivo: m };
  if (regla.excluyeEstadoDeCorte && r.esEstadoDeCorte) return { elegible: false, motivo: 'ESTADO_AL_CORTE' };
  for (const campo of regla.requiere) {
    const v = r[campo];
    if (v === null || v === undefined) return { elegible: false, motivo: `SIN_${String(campo)}` };
  }
  return { elegible: true, motivo: null };
}

/** Conteo de elegibles por métrica (simulacro y pruebas). */
export function elegibilidadPorMetrica(registros: readonly ParaElegibilidad[]): Record<MetricaHistorica, { elegibles: number; excluidos: number }> {
  const salida = {} as Record<MetricaHistorica, { elegibles: number; excluidos: number }>;
  for (const m of METRICAS_HISTORICAS) {
    let si = 0;
    for (const r of registros) if (elegibilidadHistorica(r, m).elegible) si += 1;
    salida[m] = { elegibles: si, excluidos: registros.length - si };
  }
  return salida;
}
