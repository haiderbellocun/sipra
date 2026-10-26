import { ModalidadPractica } from './modalidad.entity';

/** Modalidades sin colocación nueva: la cobertura viene del empleo vigente. */
const SIN_AFILIACION_NUEVA: readonly ModalidadPractica[] = [
  ModalidadPractica.VALIDACION_EXPERIENCIA,
  ModalidadPractica.COMBINACION_FUNCIONES,
];
import { Rol } from '../value-objects/rol.vo';

/** Estados del ciclo de vida de la práctica (M2). */
export enum EstadoPractica {
  INSCRITA = 'inscrita',
  DOCUMENTACION = 'documentacion',
  EN_VALIDACION = 'en_validacion',
  ACTIVA = 'activa',
  FINALIZADA = 'finalizada',
  CERTIFICADA = 'certificada',
  SUSPENDIDA = 'suspendida',
  CANCELADA = 'cancelada',
  /** SGP «Anulado»: el registro tenía inconsistencias; se anula para habilitar uno nuevo. */
  ANULADA = 'anulada',
  /** SGP «Reprueba»: registró pero no cumplió el proceso ni los parámetros de aprobación. */
  REPROBADA = 'reprobada',
}

/**
 * Equivalencia con los estados del Sistema de Gestión de Prácticas (SGP), la
 * plataforma que SIPRA reemplaza. Los estados intermedios de SIPRA
 * (documentacion, en_validacion) caben todos dentro del «Inscrito» del SGP.
 */
export const EQUIVALENCIA_SGP: Readonly<Record<EstadoPractica, string>> = {
  [EstadoPractica.INSCRITA]: 'Inscrito',
  [EstadoPractica.DOCUMENTACION]: 'Inscrito',
  [EstadoPractica.EN_VALIDACION]: 'Inscrito',
  [EstadoPractica.ACTIVA]: 'En práctica',
  [EstadoPractica.FINALIZADA]: 'En práctica',
  [EstadoPractica.CERTIFICADA]: 'Cerrado',
  [EstadoPractica.SUSPENDIDA]: 'En práctica',
  [EstadoPractica.CANCELADA]: 'Anulado',
  [EstadoPractica.ANULADA]: 'Anulado',
  [EstadoPractica.REPROBADA]: 'Reprueba',
};

export const ESTADOS_TERMINALES_PRACTICA: readonly EstadoPractica[] = [
  EstadoPractica.CERTIFICADA, EstadoPractica.CANCELADA,
  EstadoPractica.ANULADA, EstadoPractica.REPROBADA,
];

/** Modalidades vigentes de práctica en la CUN. */
// Las modalidades y su matriz documental viven en `modalidad.entity.ts`: son
// un catálogo institucional con reglas propias, no una lista dentro de la
// entidad práctica. Se reexportan para no romper a quien ya las importaba.
export { ModalidadPractica };

export enum CicloAcademico {
  TECNICO = 'tecnico',
  TECNOLOGO = 'tecnologo',
  PROFESIONAL = 'profesional',
}

/** Señal de acompañamiento (M8): no es un estado, es un cálculo sobre la práctica. */
export enum SenalAcompanamiento {
  AL_DIA = 'al_dia',
  REQUIERE_ATENCION = 'requiere_atencion',
  EN_RIESGO = 'en_riesgo',
}

export type TipoRemuneracion = 'remunerada' | 'no_remunerada';
export type OrigenRegistro = 'estudiante' | 'coordinacion';

/**
 * Datos de la vacante que el estudiante puede actualizar después del registro
 * (SGP, botón de edición). La modalidad y las fechas no están aquí a propósito:
 * el manual del estudiante las declara inmodificables una vez registradas.
 */
export interface DatosVacantePractica {
  area: string | null;
  cargo: string | null;
  tipoRemuneracion: TipoRemuneracion | null;
  salario: number | null;
  horario: string | null;
  jefeInmediatoNombre: string | null;
  jefeInmediatoCargo: string | null;
  jefeInmediatoCorreo: string | null;
  jefeInmediatoTelefono: string | null;
  ciudad: string | null;
  funcionesRelevantes: string | null;
}

export interface DatosPractica extends DatosVacantePractica {
  id: string;
  /** Consecutivo del Formulario Único de Registro; lo asigna la base. */
  numeroFur: number | null;
  estudianteId: string;
  programaId: string;
  escuelaId: string;
  regional: string | null;
  asignatura: string | null;
  ciclo: CicloAcademico;
  periodoAcademico: string;
  modalidad: ModalidadPractica;
  estado: EstadoPractica;
  tutorId: string | null;
  /** Empresa habilitada en SIPRA, cuando el NIT coincide con una. */
  empresaId: string | null;
  /** Lo que el estudiante escribió en el FUR; el identificador puede ser alfanumérico. */
  empresaRazonSocial: string | null;
  empresaNit: string | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  horasRegistradas: number | null;
  arlVerificada: boolean;
  arlFechaAfiliacion: Date | null;
  terminosAceptadosEn: Date | null;
  registradaPor: OrigenRegistro;
  /** Calificación docente de 0,0 a 5,0; la mínima aprobatoria es 3,0. */
  nota: number | null;
  cerradaEn: Date | null;
  ultimaActividad: Date;
  creadaEn: Date;
  actualizadaEn: Date;
}

/** Escala del SGP: de 0,0 a 5,0; aprueba desde 3,0. Regla institucional, no parámetro. */
export const NOTA_MINIMA_APROBACION = 3.0;

export class CalificacionInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Calificación no válida: ${motivo}`);
    this.name = 'CalificacionInvalidaError';
  }
}

export class CierreNoPermitidoError extends Error {
  constructor(motivo: string) {
    super(`No es posible cerrar la práctica: ${motivo}`);
    this.name = 'CierreNoPermitidoError';
  }
}

export class TransicionInvalidaError extends Error {
  constructor(desde: EstadoPractica, hacia: EstadoPractica, motivo?: string) {
    super(
      `Transición no permitida: ${desde} → ${hacia}${motivo ? `. ${motivo}` : ''}`,
    );
    this.name = 'TransicionInvalidaError';
  }
}

export class CompuertaArlError extends Error {
  constructor(motivo: string) {
    super(`Compuerta de afiliación a ARL: ${motivo}`);
    this.name = 'CompuertaArlError';
  }
}

/**
 * Grafo de transiciones permitidas. Ninguna configuración puede ampliarlo:
 * está codificado en el dominio, no parametrizado.
 */
const TRANSICIONES: Readonly<Record<EstadoPractica, readonly EstadoPractica[]>> = {
  [EstadoPractica.INSCRITA]: [
    EstadoPractica.DOCUMENTACION,
    EstadoPractica.FINALIZADA, // solo vía homologación por experiencia laboral aprobada
    EstadoPractica.CANCELADA,
    EstadoPractica.ANULADA,
    EstadoPractica.REPROBADA,
  ],
  [EstadoPractica.DOCUMENTACION]: [
    EstadoPractica.EN_VALIDACION,
    EstadoPractica.CANCELADA,
    EstadoPractica.ANULADA,
    EstadoPractica.REPROBADA,
  ],
  [EstadoPractica.EN_VALIDACION]: [
    EstadoPractica.ACTIVA, // bloqueado por la compuerta ARL
    EstadoPractica.DOCUMENTACION,
    EstadoPractica.CANCELADA,
    EstadoPractica.ANULADA,
    EstadoPractica.REPROBADA,
  ],
  [EstadoPractica.ACTIVA]: [
    EstadoPractica.FINALIZADA, EstadoPractica.SUSPENDIDA, EstadoPractica.REPROBADA,
  ],
  [EstadoPractica.FINALIZADA]: [EstadoPractica.CERTIFICADA, EstadoPractica.REPROBADA],
  [EstadoPractica.CERTIFICADA]: [],
  [EstadoPractica.SUSPENDIDA]: [
    EstadoPractica.ACTIVA, EstadoPractica.CANCELADA, EstadoPractica.REPROBADA,
  ],
  [EstadoPractica.CANCELADA]: [],
  // Anulada y reprobada son finales: el SGP habilita un registro nuevo, no
  // reabre el anterior.
  [EstadoPractica.ANULADA]: [],
  [EstadoPractica.REPROBADA]: [],
};

/** Modelo de negocio puro: sin decoradores de ORM ni dependencias de framework. */
export class Practica {
  private constructor(private datos: DatosPractica) {}

  static desde(datos: DatosPractica): Practica {
    return new Practica({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get estado(): EstadoPractica { return this.datos.estado; }
  get estudianteId(): string { return this.datos.estudianteId; }
  get escuelaId(): string { return this.datos.escuelaId; }
  get tutorId(): string | null { return this.datos.tutorId; }
  get empresaId(): string | null { return this.datos.empresaId; }
  get modalidad(): ModalidadPractica { return this.datos.modalidad; }
  get fechaInicio(): Date | null { return this.datos.fechaInicio; }
  get arlVerificada(): boolean { return this.datos.arlVerificada; }
  get periodoAcademico(): string { return this.datos.periodoAcademico; }
  get ciclo(): CicloAcademico { return this.datos.ciclo; }
  get programaId(): string { return this.datos.programaId; }
  get numeroFur(): number | null { return this.datos.numeroFur; }
  get nota(): number | null { return this.datos.nota; }
  get esTerminal(): boolean { return ESTADOS_TERMINALES_PRACTICA.includes(this.datos.estado); }

  instantanea(): DatosPractica { return { ...this.datos }; }

  puedeTransicionarA(destino: EstadoPractica): boolean {
    return TRANSICIONES[this.datos.estado].includes(destino);
  }

  /**
   * Compuerta de la ARL (M5, Decreto 055 de 2015).
   * Ninguna práctica pasa a `activa` sin afiliación vigente con fecha ANTERIOR
   * al inicio. La verificación vive en el dominio: no hay bandera de
   * configuración ni rol que la omita.
   */
  verificarCompuertaArl(): void {
    // Donde el estudiante ya está vinculado laboralmente no hay colocación
    // nueva que afiliar: su cobertura proviene de esa relación.
    if (SIN_AFILIACION_NUEVA.includes(this.datos.modalidad)) return;
    if (!this.datos.arlVerificada) {
      throw new CompuertaArlError('no hay afiliación verificada para esta práctica');
    }
    if (!this.datos.arlFechaAfiliacion) {
      throw new CompuertaArlError('la afiliación no registra fecha');
    }
    if (!this.datos.fechaInicio) {
      throw new CompuertaArlError('la práctica no registra fecha de inicio');
    }
    const afiliacion = truncarDia(this.datos.arlFechaAfiliacion);
    const inicio = truncarDia(this.datos.fechaInicio);
    if (afiliacion >= inicio) {
      throw new CompuertaArlError(
        'la afiliación debe ser anterior a la fecha de inicio (no el mismo día)',
      );
    }
  }

  transicionarA(destino: EstadoPractica, ahora: Date = new Date()): void {
    if (!this.puedeTransicionarA(destino)) {
      throw new TransicionInvalidaError(this.datos.estado, destino);
    }
    if (
      destino === EstadoPractica.FINALIZADA &&
      this.datos.estado === EstadoPractica.INSCRITA &&
      !SIN_AFILIACION_NUEVA.includes(this.datos.modalidad)
    ) {
      throw new TransicionInvalidaError(
        this.datos.estado,
        destino,
        'solo la homologación por experiencia laboral aterriza en finalizada desde inscrita',
      );
    }
    if (destino === EstadoPractica.ACTIVA && this.datos.estado === EstadoPractica.EN_VALIDACION) {
      this.verificarCompuertaArl();
    }
    this.datos.estado = destino;
    this.datos.actualizadaEn = ahora;
    this.datos.ultimaActividad = ahora;
  }

  registrarAfiliacionArl(fechaAfiliacion: Date, ahora: Date = new Date()): void {
    this.datos.arlVerificada = true;
    this.datos.arlFechaAfiliacion = fechaAfiliacion;
    this.datos.actualizadaEn = ahora;
    this.datos.ultimaActividad = ahora;
  }

  registrarHoras(horas: number, ahora: Date = new Date()): void {
    if (horas < 0) throw new Error('Las horas registradas no pueden ser negativas');
    this.datos.horasRegistradas = horas;
    this.datos.actualizadaEn = ahora;
    this.datos.ultimaActividad = ahora;
  }

  /**
   * Edición posterior al registro (SGP, botón de lápiz): solo los datos de la
   * vacante. La modalidad y las fechas no se tocan por aquí; no hay método que
   * lo permita.
   */
  actualizarVacante(cambios: Partial<DatosVacantePractica>, ahora: Date = new Date()): void {
    if (this.esTerminal) {
      throw new Error('La práctica ya cerró: sus datos no se modifican');
    }
    const claves: (keyof DatosVacantePractica)[] = [
      'area', 'cargo', 'tipoRemuneracion', 'salario', 'horario', 'jefeInmediatoNombre',
      'jefeInmediatoCargo', 'jefeInmediatoCorreo', 'jefeInmediatoTelefono', 'ciudad',
      'funcionesRelevantes',
    ];
    for (const clave of claves) {
      if (cambios[clave] !== undefined) {
        (this.datos as unknown as Record<string, unknown>)[clave] = cambios[clave];
      }
    }
    this.datos.actualizadaEn = ahora;
    this.datos.ultimaActividad = ahora;
  }

  /**
   * Calificación docente del SGP: escala de 0,0 a 5,0 con un decimal. Solo
   * mientras la práctica está en curso («En práctica»); la nota puede
   * corregirse hasta el cierre y después queda fija.
   */
  calificar(nota: number, ahora: Date = new Date()): void {
    if (![EstadoPractica.ACTIVA, EstadoPractica.FINALIZADA].includes(this.datos.estado)) {
      throw new CalificacionInvalidaError('la práctica no está en curso');
    }
    if (!Number.isFinite(nota) || nota < 0 || nota > 5) {
      throw new CalificacionInvalidaError('la nota va de 0,0 a 5,0');
    }
    if (Math.round(nota * 10) !== nota * 10) {
      throw new CalificacionInvalidaError('la nota admite un solo decimal');
    }
    this.datos.nota = nota;
    this.datos.actualizadaEn = ahora;
    this.datos.ultimaActividad = ahora;
  }

  get aprobada(): boolean | null {
    return this.datos.nota === null ? null : this.datos.nota >= NOTA_MINIMA_APROBACION;
  }

  /**
   * Cierre del SGP: «En práctica» → «Cerrado» con nota aprobatoria, o
   * «Reprueba» si no la alcanza. Las condiciones documentales y el «Evalúa tu
   * proceso» las comprueba el caso de uso; aquí se exige la nota y el estado.
   */
  cerrar(ahora: Date = new Date()): EstadoPractica.CERTIFICADA | EstadoPractica.REPROBADA {
    if (this.datos.nota === null) throw new CierreNoPermitidoError('no hay calificación registrada');
    if (![EstadoPractica.ACTIVA, EstadoPractica.FINALIZADA].includes(this.datos.estado)) {
      throw new CierreNoPermitidoError('la práctica no está en curso');
    }
    const destino = this.datos.nota >= NOTA_MINIMA_APROBACION
      ? EstadoPractica.CERTIFICADA
      : EstadoPractica.REPROBADA;
    if (destino === EstadoPractica.CERTIFICADA && this.datos.estado === EstadoPractica.ACTIVA) {
      this.transicionarA(EstadoPractica.FINALIZADA, ahora);
    }
    this.transicionarA(destino, ahora);
    this.datos.cerradaEn = ahora;
    return destino;
  }

  asignarTutor(tutorId: string, ahora: Date = new Date()): void {
    this.datos.tutorId = tutorId;
    this.datos.actualizadaEn = ahora;
  }

  tocar(ahora: Date = new Date()): void {
    this.datos.ultimaActividad = ahora;
  }

  /** ¿Este actor puede ver el expediente? Se evalúa en el servidor, siempre. */
  visiblePara(actor: { id: string; rol: Rol; escuelas: readonly string[]; empresaId: string | null }): boolean {
    switch (actor.rol) {
      case Rol.ESTUDIANTE:
        return actor.id === this.datos.estudianteId;
      case Rol.EMPRESA:
        return actor.empresaId !== null && actor.empresaId === this.datos.empresaId;
      case Rol.TUTOR:
        return actor.id === this.datos.tutorId || actor.escuelas.includes(this.datos.escuelaId);
      case Rol.COORDINADOR:
        // Sin escuelas asignadas es la coordinación del Área de Prácticas.
        return actor.escuelas.length === 0 || actor.escuelas.includes(this.datos.escuelaId);
      case Rol.ADMINISTRADOR:
      case Rol.EXTENSION:
      case Rol.AUXILIAR:
        return true;
    }
  }
}

export function truncarDia(fecha: Date): number {
  return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
}
