/**
 * Contratos de la Mesa de Validación Documental (espejo de `expediente-documental.dto.ts` del API). Son de PRESENTACIÓN: el estado
 * humano común no cambia los estados internos de cada motor, y nada aquí decide ni valida.
 */

export type MotorDocumental = 'eps' | 'acta' | 'rut' | 'camara' | 'general';

export type EstadoHumanoDocumento =
  | 'pendiente_de_cargar' | 'procesando' | 'disponible_para_revision' | 'en_revision' | 'necesita_correccion'
  | 'aprobado' | 'rechazado' | 'error' | 'no_aplica';

export interface ReservaDocumento {
  estado: 'libre' | 'mia' | 'otro' | 'vencida';
  por: string | null;
  hasta: string | null;
  minutosRestantes: number | null;
}

export interface DocumentoDeExpediente {
  documentoId: string | null;
  practicaId: string;
  estudianteId: string;
  tipoDocumento: string;
  nombreHumano: string;
  motor: MotorDocumental;
  version: number | null;
  estadoInterno: string | null;
  estadoHumano: EstadoHumanoDocumento;
  estadoHumanoEtiqueta: string;
  fechaCarga: string | null;
  problemaPrincipal: string | null;
  requiereRevision: boolean;
  criticidad: 'critico' | 'atencion' | 'normal';
  informacionInsuficiente: boolean;
  esReenvio: boolean;
  versionesAnteriores: number;
  reserva: ReservaDocumento;
  validacionId: string | null;
  obligatorio: boolean;
  operable: boolean;
  puedeTomar: boolean;
  puedeDecidir: boolean;
}

export interface ProgresoExpediente {
  total: number;
  aprobados: number;
  pendientesDeCargar: number;
  requierenRevision: number;
  necesitanCorreccion: number;
  procesando: number;
  rechazados: number;
  errores: number;
  completo: boolean;
  porcentaje: number;
}

export interface PrioridadExpediente { grupo: 'reenvio' | 'critico' | 'insuficiente' | 'antiguo' | 'resto'; rango: number; razones: string[] }

export interface EncabezadoExpediente {
  practicaId: string;
  estudiante: { id: string; nombre: string; documentoEnmascarado: string };
  modalidad: string;
  modalidadEtiqueta: string;
  periodo: string;
  escuelaId: string;
  docente: string | null;
  empresa: string | null;
  estadoPractica: string;
  fechaInicio: string | null;
}

export interface ResumenDocumento {
  tipoDocumento: string;
  nombreHumano: string;
  motor: MotorDocumental;
  estadoHumano: EstadoHumanoDocumento;
  estadoHumanoEtiqueta: string;
  reserva: { estado: 'libre' | 'mia' | 'otro' | 'vencida'; por: string | null; minutosRestantes: number | null };
  obligatorio: boolean;
}

export interface ItemExpediente extends EncabezadoExpediente {
  progreso: ProgresoExpediente;
  indicadores: { criticos: number; informacionInsuficiente: number; reenvios: number; conDiscrepancias: number; misDocumentos: number; reservasPorVencer: number };
  documentos: ResumenDocumento[];
  funcionariosTrabajando: { nombre: string; documentos: number; esUsted: boolean }[];
  prioridad: PrioridadExpediente;
  esperandoDesde: string | null;
  diasEsperando: number;
}

export interface ListadoExpedientes {
  kpis: { expedientes: number; conPendientes: number; conProblemas: number; misDocumentos: number; reservasPorVencer: number; documentosPorRevisar: number };
  total: number;
  truncado: boolean;
  items: ItemExpediente[];
}

export interface Expediente {
  encabezado: EncabezadoExpediente;
  progreso: ProgresoExpediente;
  documentos: DocumentoDeExpediente[];
  ordenNavegacion: string[];
  siguientePendiente: string | null;
  prioridad: PrioridadExpediente;
}

export interface VersionDocumento {
  documentoId: string;
  version: number;
  vigente: boolean;
  estadoHumano: EstadoHumanoDocumento;
  estadoHumanoEtiqueta: string;
  estadoInterno: string;
  cargadaEn: string;
  motivoDevolucion: string | null;
}

export interface SupervisionDocumental {
  expedientesAbiertos: number;
  documentosPorRevisar: number;
  documentosSinCargar: number;
  aprobadosHoy: number;
  devueltos: number;
  rechazados: number;
  informacionInsuficiente: number;
  discrepancias: number;
  reservasActivas: number;
  reservasPorVencer: number;
  reservasVencidas: number;
  porMotor: Record<string, { porRevisar: number; aprobados: number; devueltos: number; rechazados: number }>;
  funcionarios: {
    funcionarioId: string; nombre: string; reservasVigentes: number; reservasPorVencer: number;
    documentos: { practicaId: string; estudiante: string; tipoDocumento: string; nombreHumano: string; motor: string; hasta: string; vencida: boolean }[];
  }[];
  conReservaVencida: { practicaId: string; estudiante: string; documentos: number }[];
}

export type VistaRapida = 'todos' | 'pendientes' | 'problemas' | 'mis_documentos' | 'por_vencer';

export interface FiltrosExpedientes {
  vista?: VistaRapida;
  escuela?: string;
  modalidad?: string;
  buscar?: string;
  estado?: 'abiertos' | 'completos' | '';
  conPendientes?: 'si' | '';
  conDiscrepancias?: 'si' | '';
  conDevueltos?: 'si' | '';
  ocr?: 'si' | '';
  reserva?: 'mias' | 'libres' | '';
  antiguedadMinDias?: string;
}
