/** M7 — Bolsa de empleo. */
export enum EstadoVacante {
  BORRADOR = 'borrador',
  EN_VALIDACION = 'en_validacion',
  PUBLICADA = 'publicada',
  REPORTADA_SPE = 'reportada_spe',
  CERRADA = 'cerrada',
  VENCIDA = 'vencida',
}

/**
 * Marco aplicable. Acota la obligación regulatoria mediante un campo, sin
 * fragmentar la arquitectura: solo `laboral` entra en el reporte diario al SPE.
 */
export enum MarcoVacante {
  PRACTICA = 'practica',
  LABORAL = 'laboral',
}

export enum EstadoPostulacion {
  POSTULADO = 'postulado',
  EN_REVISION_EMPRESA = 'en_revision_empresa',
  PRESELECCIONADO = 'preseleccionado',
  REMITIDO = 'remitido',
  COLOCADO = 'colocado',
  DESCARTADO = 'descartado',
}

/** `remitido` y `colocado` alimentan el informe mensual al SPE. */
export const ESTADOS_REPORTABLES_SPE: readonly EstadoPostulacion[] = [
  EstadoPostulacion.REMITIDO,
  EstadoPostulacion.COLOCADO,
];

export interface DatosVacante {
  id: string;
  empresaId: string;
  marco: MarcoVacante;
  titulo: string;
  descripcion: string;
  funciones: string;
  requisitos: string;
  /** Catálogos oficiales obligatorios: sin texto libre. */
  codigoCno: string;
  codigoCiiu: string;
  divipolaMunicipio: string;
  nivelEducativo: string;
  vacantesDisponibles: number;
  salarioMinimo: number | null;
  salarioMaximo: number | null;
  estado: EstadoVacante;
  publicadaEn: Date | null;
  vigenteHasta: Date | null;
  reportadaSpeEn: Date | null;
  creadaEn: Date;
  actualizadaEn: Date;
}

export class VacanteDiscriminatoriaError extends Error {
  constructor(public readonly hallazgos: readonly string[]) {
    super(
      `La vacante no puede publicarse: contiene requisitos discriminatorios (${hallazgos.join(', ')})`,
    );
    this.name = 'VacanteDiscriminatoriaError';
  }
}

export class VacanteIncompletaError extends Error {
  constructor(public readonly faltantes: readonly string[]) {
    super(`Contenido mínimo incompleto (Resolución 2605 de 2014): ${faltantes.join(', ')}`);
    this.name = 'VacanteIncompletaError';
  }
}

/** Vigencia máxima de una vacante publicada. */
export const VIGENCIA_MAXIMA_MESES = 6;

export class Vacante {
  private constructor(private datos: DatosVacante) {}

  static desde(datos: DatosVacante): Vacante {
    return new Vacante({ ...datos });
  }

  get id(): string { return this.datos.id; }
  get empresaId(): string { return this.datos.empresaId; }
  get estado(): EstadoVacante { return this.datos.estado; }
  get marco(): MarcoVacante { return this.datos.marco; }

  instantanea(): DatosVacante { return { ...this.datos }; }

  /** Solo el marco laboral constituye intermediación y se reporta al SPE. */
  get requiereReporteSpe(): boolean {
    return this.datos.marco === MarcoVacante.LABORAL;
  }

  camposFaltantes(): string[] {
    const faltantes: string[] = [];
    if (!this.datos.titulo?.trim()) faltantes.push('título');
    if (!this.datos.descripcion?.trim()) faltantes.push('descripción');
    if (!this.datos.funciones?.trim()) faltantes.push('funciones');
    if (!this.datos.requisitos?.trim()) faltantes.push('requisitos');
    if (!this.datos.codigoCno?.trim()) faltantes.push('código CNO');
    if (!this.datos.codigoCiiu?.trim()) faltantes.push('código CIIU');
    if (!this.datos.divipolaMunicipio?.trim()) faltantes.push('municipio DIVIPOLA');
    if (!this.datos.nivelEducativo?.trim()) faltantes.push('nivel educativo');
    if (!this.datos.vacantesDisponibles || this.datos.vacantesDisponibles < 1) {
      faltantes.push('número de vacantes');
    }
    return faltantes;
  }

  /**
   * Publica la vacante. El filtro antidiscriminación es un BLOQUEO, no una
   * advertencia (Ley 931 de 2004 y concordantes).
   */
  publicar(
    hallazgosDiscriminatorios: readonly string[],
    ahora: Date = new Date(),
  ): void {
    const faltantes = this.camposFaltantes();
    if (faltantes.length > 0) throw new VacanteIncompletaError(faltantes);
    if (hallazgosDiscriminatorios.length > 0) {
      throw new VacanteDiscriminatoriaError(hallazgosDiscriminatorios);
    }
    const vigencia = new Date(ahora);
    vigencia.setUTCMonth(vigencia.getUTCMonth() + VIGENCIA_MAXIMA_MESES);

    this.datos.estado = EstadoVacante.PUBLICADA;
    this.datos.publicadaEn = ahora;
    this.datos.vigenteHasta = vigencia;
    this.datos.actualizadaEn = ahora;
  }

  marcarReportadaSpe(ahora: Date = new Date()): void {
    this.datos.estado = EstadoVacante.REPORTADA_SPE;
    this.datos.reportadaSpeEn = ahora;
    this.datos.actualizadaEn = ahora;
  }

  cerrar(ahora: Date = new Date()): void {
    this.datos.estado = EstadoVacante.CERRADA;
    this.datos.actualizadaEn = ahora;
  }

  evaluarVencimiento(ahora: Date = new Date()): boolean {
    if (!this.datos.vigenteHasta) return false;
    if (this.datos.vigenteHasta.getTime() >= ahora.getTime()) return false;
    if (this.datos.estado === EstadoVacante.CERRADA || this.datos.estado === EstadoVacante.VENCIDA) {
      return false;
    }
    this.datos.estado = EstadoVacante.VENCIDA;
    this.datos.actualizadaEn = ahora;
    return true;
  }
}
