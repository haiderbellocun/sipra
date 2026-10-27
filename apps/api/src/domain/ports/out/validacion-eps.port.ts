import { DatosEvidenciaEps, EvidenciaEps } from '../../entities/evidencia-validacion-eps.entity';
import { DatosValidacionEps, ValidacionEps } from '../../entities/validacion-eps.entity';

export interface ValidacionEpsRepositoryPort {
  buscarPorId(id: string): Promise<ValidacionEps | null>;
  buscarPorDocumento(documentoId: string): Promise<ValidacionEps | null>;
  /**
   * Crea la validación del documento si aún no existe (`ON CONFLICT DO NOTHING`
   * sobre `documento_id`): dos procesos simultáneos terminan con UNA sola fila.
   */
  crearSiNoExiste(datos: DatosValidacionEps): Promise<{ validacion: ValidacionEps; creada: boolean }>;
  /**
   * Compare-and-set por versión: actualiza solo si la fila sigue en
   * `versionEsperada` y la incrementa. `false` = otro proceso la modificó antes.
   */
  guardarSiVersion(datos: DatosValidacionEps, versionEsperada: number): Promise<boolean>;
  /**
   * Reserva atómica: una sola sentencia condicional que tiene éxito si el caso
   * no está decidido y no tiene reserva vigente de otro. `false` = ya lo tiene otro.
   */
  reservar(id: string, actorId: string, ahora: Date, hasta: Date): Promise<boolean>;
  /** Libera la reserva propia (o cualquiera si es supervisor, o una vencida). */
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean): Promise<boolean>;
  /** Solo inserta: las evidencias son append-only. */
  agregarEvidencia(datos: DatosEvidenciaEps): Promise<EvidenciaEps>;
  listarEvidencias(validacionEpsId: string): Promise<EvidenciaEps[]>;
  /** ¿Ya existe evidencia ADRES con este hash (en cualquier validación)? Evita adjuntar el mismo archivo dos veces. */
  buscarEvidenciaAdresPorHash(hash: string): Promise<{ validacionEpsId: string } | null>;
  /** Casos con contraste ADRES abierto, los más antiguos primero. */
  listarParaAdres(limite: number): Promise<ValidacionEps[]>;
  /**
   * Todas las validaciones ABIERTAS (sin decisión humana) de la versión vigente de cada
   * certificado, dentro del alcance. Tope de seguridad: 2000.
   */
  /** Hasta `TOPE_LISTADO_MESA` casos abiertos (los más antiguos). Si hay más, `contarAbiertasMesa` da el total real. */
  listarAbiertasMesa(ahora: Date, escuelasAlcance: string[] | null): Promise<FilaMesaRepo[]>;
  /** Total REAL de casos abiertos (sin tope), para que los KPI no mientan cuando el listado se trunca. */
  contarAbiertasMesa(escuelasAlcance: string[] | null): Promise<number>;
  /** Conteos para métricas (un solo recorrido agregado). */
  resumenMetricasEps(ahora: Date): Promise<ResumenMetricasEps>;
  /**
   * «Tomar siguiente»: elige y reserva, en UNA sentencia atómica (`FOR UPDATE SKIP LOCKED`), el
   * caso disponible de mayor prioridad. Dos personas a la vez reciben casos distintos.
   * Devuelve el id de la validación o `null` si no hay casos disponibles.
   */
  tomarSiguiente(
    actorId: string, ahora: Date, hasta: Date, escuelasAlcance: string[] | null, criterios?: CriteriosSiguiente,
  ): Promise<string | null>;
  supervisionMesa(ahora: Date, escuelasAlcance: string[] | null): Promise<ResumenSupervisionRepo>;
}

// ── Lectura para la Mesa operativa ──────────────────────────────────────────

/** Una validación abierta con lo necesario para mostrarla en la bandeja (un solo viaje a la base). */
export interface FilaMesaRepo {
  validacion: ValidacionEps;
  estudiante: { id: string; nombre: string; documento: string | null };
  practica: { id: string; programaId: string; modalidad: string; periodoAcademico: string; fechaInicio: Date | null; escuelaId: string };
  documento: { id: string; version: number; cargadoEn: Date; estado: string; nombreOriginal: string; totalVersiones: number };
  /** Nombre de quien tiene el caso, solo si su reserva sigue vigente. */
  responsableNombre: string | null;
}

export interface FilaSupervisionRepo {
  funcionarioId: string;
  nombre: string;
  correo: string;
  rol: string;
  reservasVigentes: number;
  reservasPorVencer: number;
  decididas7Dias: number;
  /** Horas desde que llegó el certificado hasta la decisión (últimos 30 días); nulo si no hay datos. */
  horasMediasHastaDecision: number | null;
}

export interface ResumenSupervisionRepo {
  abiertas: number;
  sinAsignar: number;
  /** Horas medias entre la llegada del certificado y la primera vez que una persona lo tomó (últimos 30 días). */
  horasMediasHastaPrimeraRevision: number | null;
  funcionarios: FilaSupervisionRepo[];
}

export interface CriteriosSiguiente {
  periodo?: string;
  programa?: string;
  modalidad?: string;
  /** Solo casos con la afiliación por contrastar (o con ADRES en estos estados). */
  estadosAdres?: string[];
}
/** Conteos agregados para las métricas operativas del flujo EPS (sin datos personales). */
export interface ResumenMetricasEps {
  abiertas: number; pendientesAdres: number; sinAsignar: number; candidatos: number;
  procesamientoAtascado: number; procesamientoError: number;
}

/** Tope de filas que la bandeja carga en memoria (filtros y orden se aplican sobre ellas). «Tomar siguiente» NO tiene tope: es SQL. */
export const TOPE_LISTADO_MESA = 2000;

export const VALIDACION_EPS_REPOSITORY = Symbol('VALIDACION_EPS_REPOSITORY');
