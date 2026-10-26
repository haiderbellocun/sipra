import {
  DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../../entities/documento.entity';
import { DatosEmpresa, Empresa, EstadoEmpresa } from '../../entities/empresa.entity';
import { DatosObligacion, Obligacion } from '../../entities/obligacion.entity';
import { DatosPractica, EstadoPractica, Practica } from '../../entities/practica.entity';
import { DatosUsuario, Usuario } from '../../entities/usuario.entity';
import { DatosVacante, EstadoVacante, Vacante } from '../../entities/vacante.entity';
import { RegistroAuditoria } from '../../entities/auditoria.entity';
import { ValorParametro } from '../../entities/parametro.entity';
import { DatosPeriodo, PeriodoAcademico } from '../../entities/periodo.entity';
import { CartaPresentacion, DatosCarta } from '../../entities/carta-presentacion.entity';
import { DatosEntradaBitacora, EntradaBitacora, TipoEntradaBitacora } from '../../entities/bitacora.entity';
import { DatosSolicitudArl, EstadoSolicitudArl, SolicitudArl } from '../../entities/solicitud-arl.entity';
import { CategoriaPqrs, DatosPqrs, EstadoPqrs, SolicitudPqrs } from '../../entities/pqrs.entity';

/**
 * Puertos de salida. El dominio los define; la infraestructura los implementa.
 * Regla de dependencia: nada aquí conoce TypeORM, Postgres ni Nest.
 */

export interface FiltroPracticas {
  estudianteId?: string;
  /** Resultado de una búsqueda por documento, correo o nombre. */
  estudianteIds?: readonly string[];
  tutorId?: string;
  empresaId?: string;
  escuelaIds?: readonly string[];
  estados?: readonly EstadoPractica[];
  periodoAcademico?: string;
  programaId?: string;
  regional?: string;
  modalidad?: string;
  ciclo?: string;
  /** true = con docente asignado; false = sin asignación (filtro del SGP). */
  conTutor?: boolean;
  movimientoDesde?: Date;
  movimientoHasta?: Date;
  limite?: number;
  desplazamiento?: number;
}

export interface UsuarioRepositoryPort {
  buscarPorId(id: string): Promise<Usuario | null>;
  buscarPorCorreo(correo: string): Promise<Usuario | null>;
  buscarPorDocumento(documento: string): Promise<Usuario | null>;
  /** Búsqueda del SGP: por número de documento, correo o nombre. */
  buscarTexto(texto: string, limite?: number): Promise<Usuario[]>;
  listarPorRol(rol: string): Promise<Usuario[]>;
  listar(filtro?: { roles?: readonly string[]; activo?: boolean }): Promise<Usuario[]>;
  guardar(datos: DatosUsuario): Promise<Usuario>;
}
export const USUARIO_REPOSITORY = Symbol('USUARIO_REPOSITORY');

export interface PracticaRepositoryPort {
  buscarPorId(id: string): Promise<Practica | null>;
  listar(filtro: FiltroPracticas): Promise<Practica[]>;
  contar(filtro: FiltroPracticas): Promise<number>;
  /** El registro no anulado del estudiante en ese periodo: el SGP admite uno solo. */
  buscarRegistroVigente(estudianteId: string, periodoAcademico: string): Promise<Practica | null>;
  guardar(datos: DatosPractica): Promise<Practica>;
}
export const PRACTICA_REPOSITORY = Symbol('PRACTICA_REPOSITORY');

export interface DocumentoRepositoryPort {
  buscarPorId(id: string): Promise<Documento | null>;
  listarPorPractica(practicaId: string): Promise<Documento[]>;
  contarPorHash(hashSha256: string, excluirDocumentoId?: string): Promise<number>;
  /** Candidatos para comparar por similitud perceptual dentro del mismo tipo. */
  listarHashesPerceptuales(
    tipo: TipoDocumento,
    excluirPracticaId: string,
  ): Promise<{ id: string; practicaId: string; hashPerceptual: string }[]>;
  ultimaVersion(practicaId: string, tipo: TipoDocumento): Promise<number>;
  guardar(datos: DatosDocumento): Promise<Documento>;
  listarParaPurga(ahora: Date): Promise<Documento[]>;
  /** Gasto en IA (USD) de las lecturas hechas desde esa fecha; sostiene el tope diario. */
  gastoIaDesde(desde: Date): Promise<number>;
  /** Lecturas automáticas de una práctica desde esa fecha; sostiene el límite por práctica y día. */
  contarLecturasDesde(practicaId: string, desde: Date): Promise<number>;

  // ── Concurrencia: compare-and-set en la base (correcto con varias instancias) ──

  /**
   * Reclama el procesamiento: pasa a `analizando` SOLO si estaba `recibido`, o
   * `analizando` desde hace al menos `caducidadMs` (ejecución interrumpida). Es
   * una única sentencia condicional: de N intentos simultáneos, exactamente uno
   * recibe `true`.
   */
  reclamarProcesamiento(id: string, ahora: Date, caducidadMs: number): Promise<boolean>;
  /** Devuelve un reclamo propio a `recibido` (fallo inesperado), solo si sigue `analizando`. */
  liberarReclamo(id: string, ahora: Date): Promise<boolean>;
  /**
   * Guarda las columnas del ciclo de vida (estado, puntaje, banda, banderas,
   * extracción, decisión) SOLO si el estado en la base sigue siendo el esperado.
   * `false` = alguien lo cambió antes (p. ej. una decisión humana): no se pisa.
   */
  guardarSiEstado(datos: DatosDocumento, estadoEsperado: EstadoDocumento): Promise<boolean>;
  /** Documentos `analizando` desde antes de la fecha dada: procesamientos interrumpidos. */
  listarProcesamientoCaducado(antesDe: Date, limite: number): Promise<Documento[]>;
}
export const DOCUMENTO_REPOSITORY = Symbol('DOCUMENTO_REPOSITORY');

/** Gasto real en lectura asistida, agrupado como lo necesita la página «Costos de IA». */
export interface FilaGastoIa {
  periodoAcademico: string;
  modalidad: string;
  estudianteId: string;
  estudianteNombre: string;
  tipo: string;
  modelo: string;
  proveedor: string;
  documentos: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  ultimaLectura: Date;
}

export interface FiltroGastoIa {
  periodoAcademico?: string;
  desde?: Date;
  hasta?: Date;
  /** Alcance por escuelas (coordinación de escuela); ausente = institucional. */
  escuelaIds?: readonly string[];
}

export interface CostosIaRepositoryPort {
  gastoAgrupado(filtro: FiltroGastoIa): Promise<FilaGastoIa[]>;
  periodosConGasto(escuelaIds?: readonly string[]): Promise<string[]>;
}
export const COSTOS_IA_REPOSITORY = Symbol('COSTOS_IA_REPOSITORY');

export interface EmpresaRepositoryPort {
  buscarPorId(id: string): Promise<Empresa | null>;
  buscarPorNit(nitNumero: string): Promise<Empresa | null>;
  listar(estado?: EstadoEmpresa): Promise<Empresa[]>;
  guardar(datos: DatosEmpresa): Promise<Empresa>;
}
export const EMPRESA_REPOSITORY = Symbol('EMPRESA_REPOSITORY');

export interface ObligacionRepositoryPort {
  listarPorPractica(practicaId: string): Promise<Obligacion[]>;
  listarPendientes(hasta: Date): Promise<Obligacion[]>;
  guardar(datos: DatosObligacion): Promise<Obligacion>;
  guardarLote(datos: DatosObligacion[]): Promise<Obligacion[]>;
}
export const OBLIGACION_REPOSITORY = Symbol('OBLIGACION_REPOSITORY');

export interface VacanteRepositoryPort {
  buscarPorId(id: string): Promise<Vacante | null>;
  listar(filtro: { empresaId?: string; estado?: EstadoVacante; marco?: string }): Promise<Vacante[]>;
  listarPendientesReporteSpe(): Promise<Vacante[]>;
  guardar(datos: DatosVacante): Promise<Vacante>;
}
export const VACANTE_REPOSITORY = Symbol('VACANTE_REPOSITORY');

export interface AuditoriaRepositoryPort {
  registrar(registro: RegistroAuditoria): Promise<void>;
  contarConsultasRecientes(actorId: string, desde: Date): Promise<number>;
  listar(filtro: {
    actorId?: string;
    entidad?: string;
    entidadId?: string;
    desde?: Date;
    hasta?: Date;
    limite?: number;
  }): Promise<RegistroAuditoria[]>;
}
export const AUDITORIA_REPOSITORY = Symbol('AUDITORIA_REPOSITORY');

/** Estado de un catálogo oficial, tal como lo dejó el ingestor. */
export interface EstadoCatalogo {
  nombre: string;
  estado: 'completo' | 'parcial' | 'ausente';
  filasCargadas: number;
  filasEsperadas: number | null;
  fuente: string | null;
  urlOficial: string | null;
  justificacion: string | null;
}

export interface CatalogoRepositoryPort {
  estados(): Promise<EstadoCatalogo[]>;
}
export const CATALOGO_REPOSITORY = Symbol('CATALOGO_REPOSITORY');

/** Datos que alimentan los archivos planos del SPE. */
export interface FilaReporteVacante {
  vacanteId: string;
  nitEmpresa: string;
  nitDv: number;
  razonSocial: string;
  titulo: string;
  descripcion: string;
  funciones: string;
  requisitos: string;
  codigoCno: string;
  codigoCiiu: string;
  divipolaMunicipio: string;
  nivelEducativo: string;
  vacantesDisponibles: number;
  salarioMinimo: number | null;
  salarioMaximo: number | null;
  publicadaEn: Date;
  vigenteHasta: Date;
}

export interface FilaReportePlaza {
  practicaId: string;
  nitEmpresa: string;
  nitDv: number;
  razonSocial: string;
  documentoEstudiante: string;
  programaId: string;
  ciclo: string;
  divipolaMunicipio: string | null;
  fechaInicio: Date;
  fechaFin: Date | null;
  modalidad: string;
}

export interface ReporteRepositoryPort {
  /** Vacantes en marco laboral publicadas y aún no reportadas. */
  vacantesPendientesReporte(hasta: Date): Promise<FilaReporteVacante[]>;
  /** Plazas de práctica que iniciaron y no se han reportado. */
  plazasPendientesReporte(hasta: Date): Promise<FilaReportePlaza[]>;
  marcarVacantesReportadas(ids: readonly string[], momento: Date): Promise<void>;
}
export const REPORTE_REPOSITORY = Symbol('REPORTE_REPOSITORY');

/**
 * M12. Solo guarda lo que se apartó del valor por defecto: el catálogo, con sus
 * tipos y rangos, vive en el dominio y no en la base.
 */
export interface SobrescrituraParametro {
  clave: string;
  valor: ValorParametro;
  motivo: string;
  actualizadoPor: string;
  actualizadoEn: Date;
}

export interface ParametroRepositoryPort {
  listarSobrescrituras(): Promise<SobrescrituraParametro[]>;
  guardar(sobrescritura: Omit<SobrescrituraParametro, 'actualizadoEn'>): Promise<void>;
  restaurar(clave: string): Promise<void>;
}
export const PARAMETRO_REPOSITORY = Symbol('PARAMETRO_REPOSITORY');

/** Periodos académicos y sus ventanas (gestión de periodos del SGP). */
export interface PeriodoRepositoryPort {
  buscarPorCodigo(codigo: string): Promise<PeriodoAcademico | null>;
  listar(filtro?: { activo?: boolean; calendario?: string }): Promise<PeriodoAcademico[]>;
  guardar(datos: DatosPeriodo): Promise<PeriodoAcademico>;
}
export const PERIODO_REPOSITORY = Symbol('PERIODO_REPOSITORY');

/** Cartas de presentación generadas (reporte de cartas del SGP). */
export interface FiltroCartas {
  estudianteId?: string;
  periodoAcademico?: string;
  desde?: Date;
  hasta?: Date;
  limite?: number;
}

export interface CartaRepositoryPort {
  buscarPorId(id: string): Promise<CartaPresentacion | null>;
  listar(filtro: FiltroCartas): Promise<CartaPresentacion[]>;
  guardar(datos: DatosCarta): Promise<CartaPresentacion>;
}
export const CARTA_REPOSITORY = Symbol('CARTA_REPOSITORY');

/** Bitácora de la práctica (SGP): solo se agrega, nunca se edita ni se borra. */
export interface FiltroBitacora {
  practicaId?: string;
  periodoAcademico?: string;
  tipo?: TipoEntradaBitacora;
  desde?: Date;
  hasta?: Date;
  limite?: number;
}

export interface BitacoraRepositoryPort {
  listarPorPractica(practicaId: string): Promise<EntradaBitacora[]>;
  /** Consulta transversal (reporte de bitácoras): filtra por periodo de la práctica. */
  listar(filtro: FiltroBitacora): Promise<EntradaBitacora[]>;
  ultimaPorTipo(practicaId: string, tipo: TipoEntradaBitacora): Promise<EntradaBitacora | null>;
  agregar(datos: DatosEntradaBitacora): Promise<EntradaBitacora>;
}
export const BITACORA_REPOSITORY = Symbol('BITACORA_REPOSITORY');

/** Solicitudes de ARL del portal (prácticas articuladas). */
export interface FiltroSolicitudesArl {
  estado?: EstadoSolicitudArl | readonly EstadoSolicitudArl[];
  periodoAcademico?: string;
  estudianteId?: string;
  practicaId?: string;
  radicadaDesde?: Date;
  radicadaHasta?: Date;
  decididaDesde?: Date;
  decididaHasta?: Date;
  limite?: number;
}

export interface SolicitudArlRepositoryPort {
  buscarPorId(id: string): Promise<SolicitudArl | null>;
  /** La solicitud radicada o aprobada de una práctica, si la hay. */
  buscarVigente(practicaId: string): Promise<SolicitudArl | null>;
  listar(filtro: FiltroSolicitudesArl): Promise<SolicitudArl[]>;
  guardar(datos: DatosSolicitudArl): Promise<SolicitudArl>;
}
export const SOLICITUD_ARL_REPOSITORY = Symbol('SOLICITUD_ARL_REPOSITORY');

/** Solicitudes PQRS de Desarrollo Profesional. */
export interface FiltroPqrs {
  estudianteId?: string;
  estado?: EstadoPqrs | readonly EstadoPqrs[];
  categoria?: CategoriaPqrs;
  limite?: number;
}

export interface PqrsRepositoryPort {
  buscarPorId(id: string): Promise<SolicitudPqrs | null>;
  /** La solicitud abierta del estudiante en la misma categoría, si existe (unificación). */
  buscarAbierta(estudianteId: string, categoria: CategoriaPqrs): Promise<SolicitudPqrs | null>;
  listar(filtro: FiltroPqrs): Promise<SolicitudPqrs[]>;
  guardar(datos: DatosPqrs): Promise<SolicitudPqrs>;
}
export const PQRS_REPOSITORY = Symbol('PQRS_REPOSITORY');
