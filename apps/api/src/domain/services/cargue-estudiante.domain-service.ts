import { EstadoDocumento, TipoDocumento } from '../entities/documento.entity';
import { EstadoCargueEstudiante, PeriodoAcademico, TipoVentana } from '../entities/periodo.entity';
import { diaAcademicoColombia } from './fechas-colombia';

/**
 * Cargue de documentos del ESTUDIANTE (G2). Regla autoritativa: la ventana del periodo.
 *
 *  · Cargue ordinario: solo con el periodo activo, el cargue habilitado y `desde ≤ hoy ≤ hasta`
 *    (día académico de Colombia, inclusivo). Sin periodo o sin ventana: falla cerrada.
 *  · Subsanación: excepción ESTRECHA, por tipo de documento, solo cuando la ventana cerró por fecha.
 *    Nace de (a) un documento devuelto o ilegible —hasta el día de la devolución más
 *    `documentos.dias_subsanacion` (manual del docente facilitador: ocho días calendario)— o
 *    (b) un «plazo de subsanación» que el docente registra en la bitácora para documentos concretos.
 *    Nunca reabre el expediente: solo habilita ese tipo. Con el cargue inhabilitado o el periodo
 *    inactivo no hay excepción: es una decisión de gobierno.
 *  · El «fin de la práctica + N días» ya NO extiende el cargue ordinario (antes de G2 sí lo hacía).
 */

export interface EvaluacionCargue {
  estado: EstadoCargueEstudiante;
  permitido: boolean;
  desde: Date | null;
  hasta: Date | null;
}

export interface Subsanacion {
  tipo: TipoDocumento;
  /** Último día (académico, inclusivo) en que puede cargar una nueva versión de ese tipo. */
  vence: Date;
  origen: 'devolucion' | 'bitacora';
}

export interface VersionDocumental {
  tipo: TipoDocumento;
  version: number;
  estado: EstadoDocumento;
  actualizadoEn: Date;
}

export interface PlazoBitacora {
  documentos: readonly TipoDocumento[];
  venceEl: Date;
}

export function evaluarCargueEstudiante(periodo: PeriodoAcademico | null, ahora: Date): EvaluacionCargue {
  if (!periodo) return { estado: EstadoCargueEstudiante.SIN_PERIODO, permitido: false, desde: null, hasta: null };
  const estado = periodo.estadoCargueEstudiante(ahora);
  const v = periodo.ventana(TipoVentana.CARGUE_ESTUDIANTE);
  return { estado, permitido: estado === EstadoCargueEstudiante.ABIERTO, desde: v?.desde ?? null, hasta: v?.hasta ?? null };
}

const diaUtc = (f: Date): number => Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
/** Instantes (devolución, plazo de bitácora) → su día en Colombia; más `dias` calendario. */
const diaDeInstante = (f: Date, dias = 0): Date => new Date(diaAcademicoColombia(f) + dias * 86_400_000);

/**
 * Subsanaciones vigentes por tipo. Solo cuenta la ÚLTIMA versión de cada tipo: si el estudiante ya
 * cargó una corrección, la devolución anterior deja de abrir nada.
 */
export function subsanacionesVigentes(
  versiones: readonly VersionDocumental[],
  plazos: readonly PlazoBitacora[],
  diasSubsanacion: number,
  ahora: Date,
): Subsanacion[] {
  const hoy = diaAcademicoColombia(ahora);
  const ultima = new Map<TipoDocumento, VersionDocumental>();
  for (const v of versiones) {
    const actual = ultima.get(v.tipo);
    if (!actual || v.version > actual.version) ultima.set(v.tipo, v);
  }
  const porTipo = new Map<TipoDocumento, Subsanacion>();
  const proponer = (s: Subsanacion) => {
    if (diaUtc(s.vence) < hoy) return;
    const previa = porTipo.get(s.tipo);
    if (!previa || s.vence > previa.vence) porTipo.set(s.tipo, s);
  };
  for (const v of ultima.values()) {
    if (v.estado === EstadoDocumento.DEVUELTO || v.estado === EstadoDocumento.ILEGIBLE) {
      proponer({ tipo: v.tipo, vence: diaDeInstante(v.actualizadoEn, diasSubsanacion), origen: 'devolucion' });
    }
  }
  for (const p of plazos) {
    for (const tipo of p.documentos) proponer({ tipo, vence: diaDeInstante(p.venceEl), origen: 'bitacora' });
  }
  return [...porTipo.values()].sort((a, b) => a.tipo.localeCompare(b.tipo));
}

/** ¿Puede el estudiante cargar ESTE tipo ahora? La excepción solo aplica con la ventana cerrada por fecha. */
export function decidirCargueDeTipo(
  evaluacion: EvaluacionCargue,
  tipo: TipoDocumento,
  subsanaciones: readonly Subsanacion[],
): { permitido: boolean; porSubsanacion: Subsanacion | null } {
  if (evaluacion.permitido) return { permitido: true, porSubsanacion: null };
  if (evaluacion.estado !== EstadoCargueEstudiante.CERRADO_POR_FECHA) return { permitido: false, porSubsanacion: null };
  const s = subsanaciones.find((x) => x.tipo === tipo) ?? null;
  return { permitido: s !== null, porSubsanacion: s };
}

/** ¿Hay algo que el estudiante pueda cargar? (prevalidación antes de recibir el archivo). */
export function hayAlgunCarguePosible(evaluacion: EvaluacionCargue, subsanaciones: readonly Subsanacion[]): boolean {
  return evaluacion.permitido
    || (evaluacion.estado === EstadoCargueEstudiante.CERRADO_POR_FECHA && subsanaciones.length > 0);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const fechaLarga = (f: Date): string => `${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;

/** Mensaje operativo (sin tecnicismos ni «error») para cada estado. */
export function mensajeCargue(e: EvaluacionCargue): string {
  switch (e.estado) {
    case EstadoCargueEstudiante.ABIERTO:
      return e.hasta ? `Puedes cargar documentos hasta el ${fechaLarga(e.hasta)}.` : 'Puedes cargar documentos.';
    case EstadoCargueEstudiante.AUN_NO_ABRE:
      return e.desde && e.hasta
        ? `El período de cargue aún no inicia. Podrás cargar documentos del ${fechaLarga(e.desde)} al ${fechaLarga(e.hasta)}.`
        : 'El período de cargue aún no inicia.';
    case EstadoCargueEstudiante.CERRADO_POR_FECHA:
      return `El período de entrega finalizó${e.hasta ? ` el ${fechaLarga(e.hasta)}` : ''}. Puedes consultar tus documentos, pero ya no cargar nuevas versiones.`;
    case EstadoCargueEstudiante.INHABILITADO:
      return 'El Área de Prácticas ha restringido temporalmente el cargue para este período.';
    case EstadoCargueEstudiante.PERIODO_INACTIVO:
      return 'Tu período académico no está activo. Comunícate con el Área de Prácticas.';
    case EstadoCargueEstudiante.SIN_VENTANA:
    case EstadoCargueEstudiante.SIN_PERIODO:
      return 'No encontramos una ventana de cargue habilitada para tu período académico. Comunícate con el Área de Prácticas.';
  }
}
