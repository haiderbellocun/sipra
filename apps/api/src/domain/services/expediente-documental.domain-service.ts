import { TipoDocumento } from '../entities/documento.entity';

/**
 * Mesa de Validación Documental: capa de ORQUESTACIÓN y de PRESENTACIÓN (dominio puro).
 *
 * La entidad operativa es ESTUDIANTE + PRÁCTICA (el expediente), no un tipo de documento. Esta capa NO valida, NO compara y NO
 * decide: consulta lo que ya dicen los motores especializados (EPS, Actas, RUT, Cámara) y lo normaliza para mostrarlo en un solo
 * lugar. Los estados internos de cada motor no cambian: el «estado humano común» es solo presentación y se calcula con adaptadores.
 */

// ── Motores ─────────────────────────────────────────────────────────────────

export type MotorDocumental = 'eps' | 'acta' | 'rut' | 'camara' | 'general';

const MOTOR_POR_TIPO: Readonly<Partial<Record<TipoDocumento, MotorDocumental>>> = {
  [TipoDocumento.CERTIFICADO_EPS]: 'eps',
  [TipoDocumento.ACTA_INICIO]: 'acta',
  [TipoDocumento.RUT_NATURAL]: 'rut',
  [TipoDocumento.RUT_JURIDICO]: 'rut',
  [TipoDocumento.CAMARA_COMERCIO]: 'camara',
};

/** Qué motor revisa y decide un tipo documental. Todo lo demás sigue el flujo general. */
export function motorDe(tipo: TipoDocumento): MotorDocumental {
  return MOTOR_POR_TIPO[tipo] ?? 'general';
}

/** Los motores especializados deciden por su Mesa: el camino general NO debe ofrecer decisiones sobre sus tipos. */
export function tieneMotorEspecializado(tipo: TipoDocumento): boolean {
  return motorDe(tipo) !== 'general';
}

/** Tipos cuya decisión pertenece a un motor especializado (para que ninguna pantalla ofrezca la decisión general). */
export const TIPOS_CON_MOTOR_ESPECIALIZADO: readonly TipoDocumento[] = (Object.keys(MOTOR_POR_TIPO) as TipoDocumento[]);

// ── Estado humano común (presentación) ──────────────────────────────────────

/** Fase NORMALIZADA de un documento, calculada por el adaptador de cada motor a partir de su estado interno. */
export type FaseDocumento = 'sin_cargar' | 'procesando' | 'listo_para_revisar' | 'aprobado' | 'devuelto' | 'rechazado' | 'error' | 'no_aplica';

export type EstadoHumanoDocumento =
  | 'pendiente_de_cargar' | 'procesando' | 'disponible_para_revision' | 'en_revision' | 'necesita_correccion'
  | 'aprobado' | 'rechazado' | 'error' | 'no_aplica';

export const ETIQUETA_ESTADO_HUMANO: Readonly<Record<EstadoHumanoDocumento, string>> = {
  pendiente_de_cargar: 'Pendiente de cargar',
  procesando: 'Procesando',
  disponible_para_revision: 'Disponible para revisión',
  en_revision: 'En revisión',
  necesita_correccion: 'Necesita corrección',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  error: 'Error',
  no_aplica: 'No aplica',
};

/**
 * «Disponible para revisión» = leído y esperando a una persona; «En revisión» = una persona lo tiene reservado (la reserva es por
 * DOCUMENTO: el expediente nunca se reserva completo).
 */
export function estadoHumanoDe(fase: FaseDocumento, reservaVigente: boolean): EstadoHumanoDocumento {
  switch (fase) {
    case 'sin_cargar': return 'pendiente_de_cargar';
    case 'procesando': return 'procesando';
    case 'listo_para_revisar': return reservaVigente ? 'en_revision' : 'disponible_para_revision';
    case 'devuelto': return 'necesita_correccion';
    case 'aprobado': return 'aprobado';
    case 'rechazado': return 'rechazado';
    case 'error': return 'error';
    case 'no_aplica': return 'no_aplica';
  }
}

/** Estados en que el estudiante tiene algo que hacer (el funcionario no puede operar ese documento). */
export const ESTADOS_ESPERAN_AL_ESTUDIANTE: readonly EstadoHumanoDocumento[] = ['pendiente_de_cargar', 'necesita_correccion'];

/** Estados en que una persona del equipo tiene algo que hacer. */
export const ESTADOS_REQUIEREN_REVISION: readonly EstadoHumanoDocumento[] = ['disponible_para_revision', 'en_revision'];

// ── Señales normalizadas de cada motor ──────────────────────────────────────

/**
 * Lo que un motor dice de un documento, normalizado SIN copiar sus reglas: cada adaptador llama a la recomendación del propio
 * motor y la traduce a estas tres señales.
 */
export interface SenalDocumento {
  /** `critico` = algo que el motor considera grave; `atencion` = conviene mirar; `normal` = nada que destacar. */
  criticidad: 'critico' | 'atencion' | 'normal';
  /** Lectura dudosa (OCR) o datos que no se pudieron comparar. */
  informacionInsuficiente: boolean;
  problemaPrincipal: string | null;
}

export const SENAL_NORMAL: SenalDocumento = { criticidad: 'normal', informacionInsuficiente: false, problemaPrincipal: null };

// ── Contrato normalizado de un documento del expediente ─────────────────────

export interface ReservaDocumento {
  estado: 'libre' | 'mia' | 'otro' | 'vencida';
  por: string | null;
  hasta: string | null;
  minutosRestantes: number | null;
}

export const RESERVA_LIBRE: ReservaDocumento = { estado: 'libre', por: null, hasta: null, minutosRestantes: null };

/** Reserva de un documento a partir de lo que dice SU motor (quién y hasta cuándo). La reserva es por documento. */
export function reservaDe(asignadoA: string | null, hasta: Date | null, nombre: string | null, actorId: string, ahora: Date): ReservaDocumento {
  if (!asignadoA || !hasta) return RESERVA_LIBRE;
  if (hasta.getTime() <= ahora.getTime()) return { estado: 'vencida', por: nombre, hasta: hasta.toISOString(), minutosRestantes: 0 };
  return {
    estado: asignadoA === actorId ? 'mia' : 'otro', por: nombre, hasta: hasta.toISOString(),
    minutosRestantes: Math.ceil((hasta.getTime() - ahora.getTime()) / 60_000),
  };
}

export const reservaVigente = (r: ReservaDocumento): boolean => r.estado === 'mia' || r.estado === 'otro';

export interface DocumentoDeExpediente {
  /** `null` si la obligación aún no tiene documento cargado. */
  documentoId: string | null;
  practicaId: string;
  estudianteId: string;
  tipoDocumento: TipoDocumento;
  nombreHumano: string;
  motor: MotorDocumental;
  /** Versión vigente (la última cargada); las anteriores son históricas y se piden bajo demanda. */
  version: number | null;
  /** Estado propio del motor (o del documento, en el flujo general). NO se modifica ni se iguala entre motores. */
  estadoInterno: string | null;
  estadoHumano: EstadoHumanoDocumento;
  estadoHumanoEtiqueta: string;
  fechaCarga: string | null;
  problemaPrincipal: string | null;
  /** Una persona del equipo tiene algo que hacer con él (disponible o en revisión). */
  requiereRevision: boolean;
  criticidad: SenalDocumento['criticidad'];
  informacionInsuficiente: boolean;
  /** Es un reenvío: versión posterior a una devolución, esperando revisión. */
  esReenvio: boolean;
  /** Cuántas versiones anteriores hay (históricas, bajo demanda). */
  versionesAnteriores: number;
  reserva: ReservaDocumento;
  /** Id de la validación del motor (para abrir su detalle y usar sus endpoints). `null` en el flujo general. */
  validacionId: string | null;
  /** Una obligación de la modalidad (cuenta para el progreso) o un documento adicional cargado. */
  obligatorio: boolean;
  /** La persona tiene el rol que opera el motor de este documento. */
  operable: boolean;
  puedeTomar: boolean;
  puedeDecidir: boolean;
}

// ── Progreso del expediente ─────────────────────────────────────────────────

export interface ProgresoExpediente {
  /** Obligaciones de la modalidad (los documentos adicionales no cuentan). */
  total: number;
  aprobados: number;
  pendientesDeCargar: number;
  requierenRevision: number;
  necesitanCorreccion: number;
  procesando: number;
  rechazados: number;
  errores: number;
  /** Todas las obligaciones aprobadas. No es una decisión académica global: solo el estado documental. */
  completo: boolean;
  porcentaje: number;
}

export function progresoExpediente(documentos: ReadonlyArray<Pick<DocumentoDeExpediente, 'estadoHumano' | 'obligatorio'>>): ProgresoExpediente {
  const obligaciones = documentos.filter((d) => d.obligatorio && d.estadoHumano !== 'no_aplica');
  const cuenta = (...estados: EstadoHumanoDocumento[]): number => obligaciones.filter((d) => estados.includes(d.estadoHumano)).length;
  const total = obligaciones.length;
  const aprobados = cuenta('aprobado');
  return {
    total, aprobados,
    pendientesDeCargar: cuenta('pendiente_de_cargar'),
    requierenRevision: cuenta('disponible_para_revision', 'en_revision'),
    necesitanCorreccion: cuenta('necesita_correccion'),
    procesando: cuenta('procesando'),
    rechazados: cuenta('rechazado'),
    errores: cuenta('error'),
    // Sin obligaciones no hay nada que dar por completo: no se marca «completo» por vacío.
    completo: total > 0 && aprobados === total,
    porcentaje: total === 0 ? 0 : Math.round((100 * aprobados) / total),
  };
}

// ── Orden inicial de la cola (sin scoring complejo) ─────────────────────────

export type GrupoPrioridad = 'reenvio' | 'critico' | 'insuficiente' | 'antiguo' | 'resto';

export interface PrioridadExpediente { grupo: GrupoPrioridad; rango: number; razones: string[] }

const RANGO: Readonly<Record<GrupoPrioridad, number>> = { reenvio: 0, critico: 1, insuficiente: 2, antiguo: 3, resto: 4 };

/**
 * Orden inicial: 1) reenvíos (documentos devueltos que volvieron), 2) críticos, 3) información insuficiente, 4) más antiguos y 5) el
 * resto. Si un motor ya calcula su propia prioridad, no se duplica aquí: esto solo ordena EXPEDIENTES por lo que ya señalan sus
 * documentos.
 */
export function prioridadExpediente(
  documentos: ReadonlyArray<Pick<DocumentoDeExpediente, 'requiereRevision' | 'esReenvio' | 'criticidad' | 'informacionInsuficiente' | 'fechaCarga'>>,
  ahora: Date, diasAntiguo = 3,
): PrioridadExpediente {
  const porRevisar = documentos.filter((d) => d.requiereRevision);
  const razones: string[] = [];
  if (porRevisar.some((d) => d.esReenvio)) razones.push('Hay un reenvío por revisar');
  if (porRevisar.some((d) => d.criticidad === 'critico')) razones.push('Hay un documento con una señal crítica');
  if (porRevisar.some((d) => d.informacionInsuficiente)) razones.push('Hay lectura dudosa o información insuficiente');
  const masAntiguo = porRevisar.map((d) => (d.fechaCarga ? new Date(d.fechaCarga).getTime() : ahora.getTime())).sort((a, b) => a - b)[0];
  const dias = masAntiguo === undefined ? 0 : Math.max(0, Math.floor((ahora.getTime() - masAntiguo) / 86_400_000));
  if (dias >= diasAntiguo) razones.push(`${dias} día(s) esperando revisión`);
  const grupo: GrupoPrioridad = porRevisar.some((d) => d.esReenvio) ? 'reenvio'
    : porRevisar.some((d) => d.criticidad === 'critico') ? 'critico'
      : porRevisar.some((d) => d.informacionInsuficiente) ? 'insuficiente'
        : dias >= diasAntiguo ? 'antiguo' : 'resto';
  return { grupo, rango: RANGO[grupo], razones };
}

/** Ordena por grupo de prioridad y, dentro de cada grupo, el expediente que más lleva esperando primero. */
export function compararExpedientes(
  a: { prioridad: PrioridadExpediente; esperandoDesde: string | null }, b: { prioridad: PrioridadExpediente; esperandoDesde: string | null },
): number {
  if (a.prioridad.rango !== b.prioridad.rango) return a.prioridad.rango - b.prioridad.rango;
  return (a.esperandoDesde ?? '9999').localeCompare(b.esperandoDesde ?? '9999');
}

/** Documento siguiente / anterior / siguiente pendiente dentro de un expediente (la navegación no vuelve a la cola). */
export function siguienteDocumento<T extends Pick<DocumentoDeExpediente, 'tipoDocumento' | 'requiereRevision' | 'reserva'>>(
  lista: readonly T[], actual: TipoDocumento | null, modo: 'siguiente' | 'anterior' | 'pendiente',
): T | null {
  if (lista.length === 0) return null;
  const i = actual === null ? -1 : lista.findIndex((d) => d.tipoDocumento === actual);
  if (modo === 'siguiente') return lista[(i + 1) % lista.length];
  if (modo === 'anterior') return lista[(i - 1 + lista.length) % lista.length];
  // «Siguiente pendiente»: el próximo que una persona puede revisar (disponible, o ya tomado por quien navega).
  for (let paso = 1; paso <= lista.length; paso += 1) {
    const d = lista[(i + paso) % lista.length];
    if (d.requiereRevision && d.reserva.estado !== 'otro') return d;
  }
  return null;
}
