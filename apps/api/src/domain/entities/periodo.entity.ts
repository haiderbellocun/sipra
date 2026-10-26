import { ModalidadPractica } from './modalidad.entity';

/**
 * Periodo académico de prácticas y sus ventanas de habilitación.
 *
 * En el SGP (manual de coordinación, «Gestión de periodos») la coordinación
 * habilita o deshabilita por periodo: el registro FUR, el cargue de documentos
 * del estudiante y del docente, la carta de presentación, la sincronización
 * con SINU y las modalidades ofertadas. El manual del portal de ARL pide
 * además que las fechas de la práctica caigan dentro del periodo, que no se
 * puedan elegir periodos cerrados y que no se acepten sábados ni domingos.
 *
 * Hay tres calendarios que corren en paralelo con fechas propias («Periodos
 * académicos y cronograma del proceso de prácticas»): presencial, con cuatro
 * periodos al año (2026A…2026D); virtual, con seis (26V01…26V06); y 335, con
 * seis (26P01…26P06). El cronograma de cada periodo fija: dos meses desde el
 * inicio para registrar la práctica y solicitar la ARL, dos jornadas de
 * inducción en la segunda semana y una fecha de cargue de documentos finales
 * unas dos semanas antes del cierre académico.
 */

export type CalendarioPeriodo = 'presencial' | 'virtual' | '335';
export const CALENDARIOS: readonly CalendarioPeriodo[] = ['presencial', 'virtual', '335'];
export const ETIQUETA_CALENDARIO: Readonly<Record<CalendarioPeriodo, string>> = {
  presencial: 'Presencial', virtual: 'Virtual', '335': '335 (P)',
};

export enum TipoVentana {
  REGISTRO_FUR = 'registro_fur',
  /** Mismo plazo que el registro: dos meses desde el inicio del periodo. */
  SOLICITUD_ARL = 'solicitud_arl',
  CARGUE_ESTUDIANTE = 'cargue_estudiante',
  CARGUE_DOCENTE = 'cargue_docente',
  CARTA_PRESENTACION = 'carta_presentacion',
}

export interface Ventana {
  desde: Date;
  hasta: Date;
}

/** Cronograma del proceso para un periodo (documento «Periodos académicos y cronograma»). */
export interface CronogramaPeriodo {
  inicio: Date;
  limiteRegistro: Date | null;
  limiteSolicitudArl: Date | null;
  jornadasInduccion: Date[];
  fechaCargueDocumentos: Date | null;
  cierre: Date;
}

export interface DatosPeriodo {
  codigo: string;
  nombre: string;
  calendario: CalendarioPeriodo;
  fechaInicio: Date;
  fechaFin: Date;
  ventanas: Partial<Record<TipoVentana, Ventana>>;
  /** Jornadas de inducción (habitualmente dos, en la segunda semana). */
  jornadasInduccion: Date[];
  /** Fecha establecida para el cargue de los documentos finales. */
  fechaCargueDocumentos: Date | null;
  sincronizacionDocentes: boolean;
  /** Vacío = todas las modalidades ofertadas. */
  modalidadesHabilitadas: ModalidadPractica[];
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
}

export class VentanaCerradaError extends Error {
  constructor(tipo: TipoVentana, periodo: string) {
    super(`La ventana «${ETIQUETA_VENTANA[tipo]}» del periodo ${periodo} no está abierta`);
    this.name = 'VentanaCerradaError';
  }
}

export class FechasFueraDelPeriodoError extends Error {
  constructor(periodo: string) {
    super(`Las fechas de la práctica deben estar dentro del periodo académico ${periodo}`);
    this.name = 'FechasFueraDelPeriodoError';
  }
}

export class FinDeSemanaError extends Error {
  constructor(cual: 'inicio' | 'fin') {
    super(`La fecha de ${cual} no puede ser sábado ni domingo`);
    this.name = 'FinDeSemanaError';
  }
}

export class PeriodoCerradoError extends Error {
  constructor(periodo: string) {
    super(`El periodo ${periodo} ya cerró: solo se admiten periodos vigentes o futuros`);
    this.name = 'PeriodoCerradoError';
  }
}

export class ModalidadNoOfertadaError extends Error {
  constructor(modalidad: string, periodo: string) {
    super(`La modalidad "${modalidad}" no está ofertada en el periodo ${periodo}`);
    this.name = 'ModalidadNoOfertadaError';
  }
}

export const ETIQUETA_VENTANA: Readonly<Record<TipoVentana, string>> = {
  [TipoVentana.REGISTRO_FUR]: 'Registro FUR',
  [TipoVentana.SOLICITUD_ARL]: 'Solicitud de ARL',
  [TipoVentana.CARGUE_ESTUDIANTE]: 'Cargue de documentos · estudiante',
  [TipoVentana.CARGUE_DOCENTE]: 'Cargue de documentos · docente',
  [TipoVentana.CARTA_PRESENTACION]: 'Carta de presentación',
};

/**
 * Días hábiles (lunes a viernes) estrictamente entre dos fechas. No descuenta
 * festivos: el calendario oficial no está en la fuente y el auxiliar lo tiene
 * en cuenta al decidir.
 */
export function diasHabilesEntre(desde: Date, hasta: Date): number {
  const inicio = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate());
  const fin = Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate());
  let habiles = 0;
  for (let dia = inicio + 86_400_000; dia < fin; dia += 86_400_000) {
    if (!esFinDeSemana(new Date(dia))) habiles += 1;
  }
  return habiles;
}

export function esFinDeSemana(fecha: Date): boolean {
  const dia = fecha.getUTCDay();
  return dia === 0 || dia === 6;
}

function diaUtc(fecha: Date): number {
  return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
}

export class PeriodoAcademico {
  private constructor(private datos: DatosPeriodo) {}

  static desde(datos: DatosPeriodo): PeriodoAcademico {
    return new PeriodoAcademico({
      ...datos,
      ventanas: { ...datos.ventanas },
      jornadasInduccion: [...(datos.jornadasInduccion ?? [])],
      fechaCargueDocumentos: datos.fechaCargueDocumentos ?? null,
      modalidadesHabilitadas: [...datos.modalidadesHabilitadas],
    });
  }

  /** Dos meses después del inicio: plazo del cronograma para registrar y solicitar la ARL. */
  static limiteRegistroHabitual(fechaInicio: Date): Date {
    const limite = new Date(fechaInicio);
    limite.setUTCMonth(limite.getUTCMonth() + 2);
    return limite;
  }

  /** Unas dos semanas antes del cierre académico, siempre que el calendario lo permita. */
  static cargueHabitual(fechaFin: Date): Date {
    return new Date(fechaFin.getTime() - 14 * 86_400_000);
  }

  /**
   * Ventanas que el cronograma del proceso describe como habituales: el
   * registro FUR y la solicitud de ARL abren con el periodo y cierran dos
   * meses después (o en la fecha que fije coordinación); la carta de
   * presentación, un mes antes y hasta ese cierre; el cargue del estudiante
   * corre hasta la fecha de cargue de documentos finales.
   */
  static ventanasHabituales(
    fechaInicio: Date,
    fechaFin: Date,
    cierreFur: Date = PeriodoAcademico.limiteRegistroHabitual(fechaInicio),
    fechaCargue: Date = PeriodoAcademico.cargueHabitual(fechaFin),
  ): Partial<Record<TipoVentana, Ventana>> {
    const unMesAntes = new Date(fechaInicio);
    unMesAntes.setUTCMonth(unMesAntes.getUTCMonth() - 1);
    const hastaCargue = fechaCargue > fechaInicio ? fechaCargue : fechaFin;
    return {
      [TipoVentana.REGISTRO_FUR]: { desde: fechaInicio, hasta: cierreFur },
      [TipoVentana.SOLICITUD_ARL]: { desde: fechaInicio, hasta: cierreFur },
      [TipoVentana.CARGUE_ESTUDIANTE]: { desde: fechaInicio, hasta: hastaCargue },
      [TipoVentana.CARTA_PRESENTACION]: { desde: unMesAntes, hasta: cierreFur },
    };
  }

  /** Jornadas habituales: la segunda semana del periodo, con cuatro días entre una y otra. */
  static jornadasHabituales(fechaInicio: Date): Date[] {
    const primera = new Date(fechaInicio.getTime() + 11 * 86_400_000);
    const segunda = new Date(fechaInicio.getTime() + 15 * 86_400_000);
    return [primera, segunda];
  }

  get codigo(): string { return this.datos.codigo; }
  get nombre(): string { return this.datos.nombre; }
  get calendario(): CalendarioPeriodo { return this.datos.calendario; }
  get fechaInicio(): Date { return this.datos.fechaInicio; }
  get fechaFin(): Date { return this.datos.fechaFin; }
  get activo(): boolean { return this.datos.activo; }

  instantanea(): DatosPeriodo {
    return {
      ...this.datos,
      ventanas: { ...this.datos.ventanas },
      jornadasInduccion: [...this.datos.jornadasInduccion],
      modalidadesHabilitadas: [...this.datos.modalidadesHabilitadas],
    };
  }

  /** Las fechas clave del cronograma del periodo, como las publica el área. */
  cronograma(): CronogramaPeriodo {
    const registro = this.datos.ventanas[TipoVentana.REGISTRO_FUR] ?? null;
    const arl = this.datos.ventanas[TipoVentana.SOLICITUD_ARL] ?? registro;
    const cargue = this.datos.ventanas[TipoVentana.CARGUE_ESTUDIANTE] ?? null;
    return {
      inicio: this.datos.fechaInicio,
      limiteRegistro: registro?.hasta ?? null,
      limiteSolicitudArl: arl?.hasta ?? null,
      jornadasInduccion: [...this.datos.jornadasInduccion],
      fechaCargueDocumentos: this.datos.fechaCargueDocumentos ?? cargue?.hasta ?? null,
      cierre: this.datos.fechaFin,
    };
  }

  fijarCronograma(cambios: { jornadasInduccion?: Date[]; fechaCargueDocumentos?: Date | null }, ahora: Date = new Date()): void {
    if (cambios.jornadasInduccion !== undefined) {
      const fuera = cambios.jornadasInduccion.find((j) => !this.contieneFechas(j, j));
      if (fuera) throw new Error('Las jornadas de inducción deben caer dentro del periodo académico');
      this.datos.jornadasInduccion = [...cambios.jornadasInduccion].sort((a, b) => a.getTime() - b.getTime());
    }
    if (cambios.fechaCargueDocumentos !== undefined) {
      if (cambios.fechaCargueDocumentos && !this.contieneFechas(cambios.fechaCargueDocumentos, cambios.fechaCargueDocumentos)) {
        throw new Error('La fecha de cargue de documentos debe caer dentro del periodo académico');
      }
      this.datos.fechaCargueDocumentos = cambios.fechaCargueDocumentos;
    }
    this.datos.actualizadoEn = ahora;
  }

  ventana(tipo: TipoVentana): Ventana | null {
    return this.datos.ventanas[tipo] ?? null;
  }

  ventanaAbierta(tipo: TipoVentana, ahora: Date = new Date()): boolean {
    const v = this.datos.ventanas[tipo];
    if (!v || !this.datos.activo) return false;
    const hoy = diaUtc(ahora);
    return diaUtc(v.desde) <= hoy && hoy <= diaUtc(v.hasta);
  }

  exigirVentana(tipo: TipoVentana, ahora: Date = new Date()): void {
    if (!this.ventanaAbierta(tipo, ahora)) throw new VentanaCerradaError(tipo, this.datos.codigo);
  }

  /** Vigente o futuro: el SGP no debería admitir registros en periodos vencidos. */
  esVigenteOFuturo(ahora: Date = new Date()): boolean {
    return diaUtc(this.datos.fechaFin) >= diaUtc(ahora);
  }

  exigirVigenteOFuturo(ahora: Date = new Date()): void {
    if (!this.esVigenteOFuturo(ahora)) throw new PeriodoCerradoError(this.datos.codigo);
  }

  modalidadHabilitada(modalidad: ModalidadPractica): boolean {
    const lista = this.datos.modalidadesHabilitadas;
    return lista.length === 0 || lista.includes(modalidad);
  }

  exigirModalidad(modalidad: ModalidadPractica): void {
    if (!this.modalidadHabilitada(modalidad)) {
      throw new ModalidadNoOfertadaError(modalidad, this.datos.codigo);
    }
  }

  contieneFechas(inicio: Date, fin: Date): boolean {
    return diaUtc(inicio) >= diaUtc(this.datos.fechaInicio)
      && diaUtc(fin) <= diaUtc(this.datos.fechaFin);
  }

  /**
   * Valida las fechas de una práctica contra el periodo: orden, fines de
   * semana y pertenencia al periodo (salvo que la modalidad esté exenta).
   */
  validarFechasDePractica(
    inicio: Date,
    fin: Date,
    opciones: { exigirDentroDelPeriodo: boolean },
  ): void {
    if (diaUtc(fin) <= diaUtc(inicio)) {
      throw new FechasFueraDelPeriodoError(this.datos.codigo);
    }
    if (esFinDeSemana(inicio)) throw new FinDeSemanaError('inicio');
    if (esFinDeSemana(fin)) throw new FinDeSemanaError('fin');
    if (opciones.exigirDentroDelPeriodo && !this.contieneFechas(inicio, fin)) {
      throw new FechasFueraDelPeriodoError(this.datos.codigo);
    }
  }

  // ── Gestión de periodos (coordinación) ─────────────────────────────────

  fijarVentana(tipo: TipoVentana, ventana: Ventana | null, ahora: Date = new Date()): void {
    if (ventana && diaUtc(ventana.hasta) < diaUtc(ventana.desde)) {
      throw new Error('La ventana termina antes de empezar');
    }
    if (ventana) this.datos.ventanas[tipo] = ventana;
    else delete this.datos.ventanas[tipo];
    this.datos.actualizadoEn = ahora;
  }

  habilitarModalidades(modalidades: ModalidadPractica[], ahora: Date = new Date()): void {
    this.datos.modalidadesHabilitadas = [...new Set(modalidades)];
    this.datos.actualizadoEn = ahora;
  }

  fijarSincronizacionDocentes(activa: boolean, ahora: Date = new Date()): void {
    this.datos.sincronizacionDocentes = activa;
    this.datos.actualizadoEn = ahora;
  }

  activar(activo: boolean, ahora: Date = new Date()): void {
    this.datos.activo = activo;
    this.datos.actualizadoEn = ahora;
  }
}
