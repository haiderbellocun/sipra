/**
 * M5 — Una obligación no es una validación sobre un documento: es un estado
 * con fecha límite que puede estar vencido sin que nadie haya cargado nada.
 */
export enum TipoObligacion {
  AFILIACION_ARL = 'afiliacion_arl',
  CERTIFICACION_PRACTICA = 'certificacion_practica',
  REPORTE_PLAZA_PRACTICA = 'reporte_plaza_practica',
  AUTORIZACION_TRATAMIENTO = 'autorizacion_tratamiento',
}

export enum EstadoObligacion {
  PENDIENTE = 'pendiente',
  CUMPLIDA = 'cumplida',
  VENCIDA = 'vencida',
  NO_APLICA = 'no_aplica',
}

export enum ResponsableObligacion {
  CUN = 'cun',
  EMPRESA = 'empresa',
  ESTUDIANTE = 'estudiante',
}

export enum EfectoObligacion {
  BLOQUEA_ACTIVA = 'bloquea_activa',
  BLOQUEA_CERTIFICADA = 'bloquea_certificada',
  BLOQUEA_CARGUE = 'bloquea_cargue',
  ALERTA = 'alerta',
}

export interface CatalogoObligacion {
  tipo: TipoObligacion;
  norma: string;
  responsable: ResponsableObligacion;
  efecto: EfectoObligacion;
  descripcion: string;
}

export const CATALOGO_OBLIGACIONES: Readonly<Record<TipoObligacion, CatalogoObligacion>> = {
  [TipoObligacion.AFILIACION_ARL]: {
    tipo: TipoObligacion.AFILIACION_ARL,
    norma: 'Decreto 055 de 2015',
    responsable: ResponsableObligacion.CUN,
    efecto: EfectoObligacion.BLOQUEA_ACTIVA,
    descripcion: 'Afiliación al Sistema General de Riesgos Laborales antes del inicio',
  },
  [TipoObligacion.CERTIFICACION_PRACTICA]: {
    tipo: TipoObligacion.CERTIFICACION_PRACTICA,
    norma: 'Ley 2043 de 2020',
    responsable: ResponsableObligacion.EMPRESA,
    efecto: EfectoObligacion.BLOQUEA_CERTIFICADA,
    descripcion: 'Certificación de la práctica dentro de los 30 días siguientes al cierre',
  },
  [TipoObligacion.REPORTE_PLAZA_PRACTICA]: {
    tipo: TipoObligacion.REPORTE_PLAZA_PRACTICA,
    norma: 'Ley 1780 de 2016, art. 17',
    responsable: ResponsableObligacion.CUN,
    efecto: EfectoObligacion.ALERTA,
    descripcion: 'Reporte diario de plazas de práctica a la Unidad del SPE',
  },
  [TipoObligacion.AUTORIZACION_TRATAMIENTO]: {
    tipo: TipoObligacion.AUTORIZACION_TRATAMIENTO,
    norma: 'Ley 1581 de 2012',
    responsable: ResponsableObligacion.ESTUDIANTE,
    efecto: EfectoObligacion.BLOQUEA_CARGUE,
    descripcion: 'Autorización de tratamiento de datos personales',
  },
};

export interface DatosObligacion {
  id: string;
  practicaId: string;
  tipo: TipoObligacion;
  estado: EstadoObligacion;
  fechaLimite: Date;
  cumplidaEn: Date | null;
  evidenciaDocumentoId: string | null;
  observacion: string | null;
  creadaEn: Date;
  actualizadaEn: Date;
}

export class Obligacion {
  private constructor(private datos: DatosObligacion) {}

  static desde(datos: DatosObligacion): Obligacion {
    return new Obligacion({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get tipo(): TipoObligacion { return this.datos.tipo; }
  get estado(): EstadoObligacion { return this.datos.estado; }
  get fechaLimite(): Date { return this.datos.fechaLimite; }
  get catalogo(): CatalogoObligacion { return CATALOGO_OBLIGACIONES[this.datos.tipo]; }

  instantanea(): DatosObligacion { return { ...this.datos }; }

  diasRestantes(ahora: Date = new Date()): number {
    const ms = this.datos.fechaLimite.getTime() - ahora.getTime();
    return Math.floor(ms / 86_400_000);
  }

  /** Semáforo del tablero de cumplimiento. */
  semaforo(ahora: Date = new Date()): 'cumplida' | 'vencida' | 'critica' | 'alerta' | 'vigente' {
    if (this.datos.estado === EstadoObligacion.CUMPLIDA) return 'cumplida';
    const dias = this.diasRestantes(ahora);
    if (dias < 0) return 'vencida';
    if (dias <= 3) return 'critica';
    if (dias <= 10) return 'alerta';
    return 'vigente';
  }

  cumplir(documentoId: string | null, ahora: Date = new Date()): void {
    this.datos.estado = EstadoObligacion.CUMPLIDA;
    this.datos.cumplidaEn = ahora;
    this.datos.evidenciaDocumentoId = documentoId;
    this.datos.actualizadaEn = ahora;
  }

  /** Ejecutado por el proceso programado del motor de obligaciones. */
  evaluarVencimiento(ahora: Date = new Date()): boolean {
    if (this.datos.estado !== EstadoObligacion.PENDIENTE) return false;
    if (this.datos.fechaLimite.getTime() >= ahora.getTime()) return false;
    this.datos.estado = EstadoObligacion.VENCIDA;
    this.datos.actualizadaEn = ahora;
    return true;
  }
}
