import { Nit } from '../value-objects/nit.vo';

/** Estados de la habilitación de empresa (M6). */
export enum EstadoEmpresa {
  SOLICITUD_RECIBIDA = 'solicitud_recibida',
  EN_VERIFICACION = 'en_verificacion',
  REQUIERE_INFO = 'requiere_info',
  HABILITADA = 'habilitada',
  RECHAZADA = 'rechazada',
  SUSPENDIDA = 'suspendida',
}

export interface SenalPreverificacion {
  codigo: string;
  resultado: 'ok' | 'advertencia' | 'critico';
  detalle: string;
}

export interface DatosEmpresa {
  id: string;
  razonSocial: string;
  nitNumero: string;
  nitDv: number;
  ciiu: string | null;
  divipolaMunicipio: string | null;
  direccion: string | null;
  telefono: string | null;
  solicitanteNombre: string;
  solicitanteCorreo: string;
  solicitanteCargo: string | null;
  representanteLegal: string | null;
  estado: EstadoEmpresa;
  senales: SenalPreverificacion[];
  decididaPor: string | null;
  justificacionDecision: string | null;
  solicitadaEn: Date;
  actualizadaEn: Date;
}

export class DecisionEmpresaSinJustificacionError extends Error {
  constructor() {
    super('La habilitación o el rechazo de una empresa exige justificación registrada');
    this.name = 'DecisionEmpresaSinJustificacionError';
  }
}

const TRANSICIONES: Readonly<Record<EstadoEmpresa, readonly EstadoEmpresa[]>> = {
  [EstadoEmpresa.SOLICITUD_RECIBIDA]: [EstadoEmpresa.EN_VERIFICACION],
  [EstadoEmpresa.EN_VERIFICACION]: [
    EstadoEmpresa.REQUIERE_INFO,
    EstadoEmpresa.HABILITADA,
    EstadoEmpresa.RECHAZADA,
  ],
  [EstadoEmpresa.REQUIERE_INFO]: [EstadoEmpresa.EN_VERIFICACION, EstadoEmpresa.RECHAZADA],
  [EstadoEmpresa.HABILITADA]: [EstadoEmpresa.SUSPENDIDA],
  [EstadoEmpresa.RECHAZADA]: [],
  [EstadoEmpresa.SUSPENDIDA]: [EstadoEmpresa.HABILITADA],
};

export class Empresa {
  private constructor(private datos: DatosEmpresa) {}

  static desde(datos: DatosEmpresa): Empresa {
    return new Empresa({ ...datos, senales: [...datos.senales] });
  }

  get id(): string { return this.datos.id; }
  get estado(): EstadoEmpresa { return this.datos.estado; }
  get razonSocial(): string { return this.datos.razonSocial; }
  get nit(): Nit { return Nit.crear(`${this.datos.nitNumero}-${this.datos.nitDv}`); }
  get senales(): readonly SenalPreverificacion[] { return this.datos.senales; }

  instantanea(): DatosEmpresa {
    return { ...this.datos, senales: [...this.datos.senales] };
  }

  get habilitada(): boolean {
    return this.datos.estado === EstadoEmpresa.HABILITADA;
  }

  registrarSenales(senales: SenalPreverificacion[], ahora: Date = new Date()): void {
    this.datos.senales = senales;
    this.datos.actualizadaEn = ahora;
    if (this.datos.estado === EstadoEmpresa.SOLICITUD_RECIBIDA) {
      this.datos.estado = EstadoEmpresa.EN_VERIFICACION;
    }
  }

  /** Semáforo agregado que ve el administrador en la bandeja. */
  get semaforo(): 'verde' | 'amarillo' | 'rojo' {
    if (this.datos.senales.some((s) => s.resultado === 'critico')) return 'rojo';
    if (this.datos.senales.some((s) => s.resultado === 'advertencia')) return 'amarillo';
    return 'verde';
  }

  /** La decisión es SIEMPRE humana y SIEMPRE justificada. */
  habilitar(actorId: string, justificacion: string, ahora: Date = new Date()): void {
    this.exigirTransicion(EstadoEmpresa.HABILITADA);
    if (!justificacion?.trim()) throw new DecisionEmpresaSinJustificacionError();
    this.datos.estado = EstadoEmpresa.HABILITADA;
    this.datos.decididaPor = actorId;
    this.datos.justificacionDecision = justificacion;
    this.datos.actualizadaEn = ahora;
  }

  rechazar(actorId: string, justificacion: string, ahora: Date = new Date()): void {
    this.exigirTransicion(EstadoEmpresa.RECHAZADA);
    if (!justificacion?.trim()) throw new DecisionEmpresaSinJustificacionError();
    this.datos.estado = EstadoEmpresa.RECHAZADA;
    this.datos.decididaPor = actorId;
    this.datos.justificacionDecision = justificacion;
    this.datos.actualizadaEn = ahora;
  }

  requerirInformacion(actorId: string, detalle: string, ahora: Date = new Date()): void {
    this.exigirTransicion(EstadoEmpresa.REQUIERE_INFO);
    if (!detalle?.trim()) throw new DecisionEmpresaSinJustificacionError();
    this.datos.estado = EstadoEmpresa.REQUIERE_INFO;
    this.datos.decididaPor = actorId;
    this.datos.justificacionDecision = detalle;
    this.datos.actualizadaEn = ahora;
  }

  suspender(actorId: string, justificacion: string, ahora: Date = new Date()): void {
    this.exigirTransicion(EstadoEmpresa.SUSPENDIDA);
    if (!justificacion?.trim()) throw new DecisionEmpresaSinJustificacionError();
    this.datos.estado = EstadoEmpresa.SUSPENDIDA;
    this.datos.decididaPor = actorId;
    this.datos.justificacionDecision = justificacion;
    this.datos.actualizadaEn = ahora;
  }

  private exigirTransicion(destino: EstadoEmpresa): void {
    if (!TRANSICIONES[this.datos.estado].includes(destino)) {
      throw new Error(`Transición no permitida: ${this.datos.estado} → ${destino}`);
    }
  }
}
