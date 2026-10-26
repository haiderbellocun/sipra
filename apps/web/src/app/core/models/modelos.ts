/** Contratos compartidos con la API. Reflejan los DTO del backend. */

export type Rol = 'estudiante' | 'tutor' | 'coordinador' | 'administrador' | 'empresa' | 'extension' | 'auxiliar';

export type Permiso = 'consulta' | 'escritura';

export type EstadoPractica =
  | 'inscrita' | 'documentacion' | 'en_validacion' | 'activa'
  | 'finalizada' | 'certificada' | 'suspendida' | 'cancelada' | 'anulada' | 'reprobada';

export type SenalAcompanamiento = 'al_dia' | 'requiere_atencion' | 'en_riesgo';

export type EstadoDocumento =
  | 'recibido' | 'analizando' | 'auto_aprobado' | 'en_revision'
  | 'ilegible' | 'devuelto' | 'aprobado' | 'rechazado';

export type EstadoEmpresa =
  | 'solicitud_recibida' | 'en_verificacion' | 'requiere_info'
  | 'habilitada' | 'rechazada' | 'suspendida';

export type EstadoVacante =
  | 'borrador' | 'en_validacion' | 'publicada' | 'reportada_spe' | 'cerrada' | 'vencida';

export interface Sesion {
  accessToken: string;
  expiraEn: string;
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  permiso?: Permiso;
  escuelas: string[];
  empresaId: string | null;
  modo: 'abierto' | 'oidc';
}

export interface UsuarioDePerfil { id: string; nombre: string; correo: string; detalle: string }

export interface PerfilDisponible {
  rol: Rol;
  id: string;
  nombre: string;
  correo: string;
  descripcion: string;
  /** Todos los usuarios activos del perfil, el predeterminado primero. */
  usuarios: UsuarioDePerfil[];
}

export interface ModoAutenticacion {
  modo: 'abierto' | 'oidc';
  ambiente: string;
  permiteSelectorDePerfil: boolean;
}

export interface DocumentoDelMomento {
  tipo: string;
  estado: EstadoDocumento | null;
  version: number | null;
  aprobado: boolean;
}

export interface AvanceMomento {
  momento: 1 | 2 | 3;
  etiqueta: string;
  documentos: DocumentoDelMomento[];
  exigidos: number;
  cargados: number;
  aprobados: number;
  completo: boolean;
}

export interface AvanceDocumental {
  exigidos: number;
  cargados: number;
  aprobados: number;
  porcentajeCargado: number;
  porcentajeAprobado: number;
  momentos: AvanceMomento[];
  pendientes: string[];
  momentoActual: 1 | 2 | 3 | null;
}

export interface Practica {
  id: string;
  estudianteId: string;
  estudianteNombre: string;
  programaId: string;
  escuelaId: string;
  ciclo: string;
  periodoAcademico: string;
  modalidad: string;
  estado: EstadoPractica;
  estadoSgp: string;
  tutorId: string | null;
  tutorNombre: string | null;
  empresaId: string | null;
  empresaRazonSocial: string | null;
  empresaNit: string | null;
  numeroFur: number | null;
  regional: string | null;
  asignatura: string | null;
  area: string | null;
  cargo: string | null;
  tipoRemuneracion: 'remunerada' | 'no_remunerada' | null;
  salario: number | null;
  horario: string | null;
  jefeInmediatoNombre: string | null;
  jefeInmediatoCargo: string | null;
  jefeInmediatoCorreo: string | null;
  jefeInmediatoTelefono: string | null;
  ciudad: string | null;
  funcionesRelevantes: string | null;
  nota: number | null;
  registradaPor: 'estudiante' | 'coordinacion';
  avance: AvanceDocumental;
  fechaInicio: string | null;
  fechaFin: string | null;
  horasRegistradas: number | null;
  arlVerificada: boolean;
  senal: SenalAcompanamiento;
  disparadoresSenal: string[];
  transicionesPosibles: EstadoPractica[];
  ultimaActividad: string;
}

export interface FiltroPracticas {
  estado?: string; periodo?: string; programa?: string; regional?: string; modalidad?: string;
  nivel?: string; asignacion?: 'asignado' | 'sin_asignacion' | ''; busqueda?: string;
  movimientoDesde?: string; movimientoHasta?: string; cargadoMinimo?: number | null;
  aprobadoMinimo?: number | null; cantidad?: number;
}

export interface RegistroFur {
  periodoAcademico: string; modalidad: string; empresaRazonSocial: string; empresaNit: string;
  area: string; cargo: string; tipoRemuneracion: 'remunerada' | 'no_remunerada'; salario?: number;
  horario: string; jefeInmediatoNombre: string; jefeInmediatoCargo: string; jefeInmediatoCorreo: string;
  jefeInmediatoTelefono: string; ciudad: string; funcionesRelevantes: string; fechaInicio: string;
  fechaFin: string; aceptaTerminos: boolean; estudianteDocumento?: string;
}

export type VacanteEditable = Partial<Pick<RegistroFur,
  'area' | 'cargo' | 'tipoRemuneracion' | 'salario' | 'horario' | 'jefeInmediatoNombre' | 'jefeInmediatoCargo'
  | 'jefeInmediatoCorreo' | 'jefeInmediatoTelefono' | 'ciudad' | 'funcionesRelevantes'>>;

// ── Periodos y catálogo ──────────────────────────────────────────────────
export type TipoVentana = 'registro_fur' | 'solicitud_arl' | 'cargue_estudiante' | 'cargue_docente' | 'carta_presentacion';
export type CalendarioPeriodo = 'presencial' | 'virtual' | '335';

/** Fechas clave del proceso en el periodo (documento «Periodos académicos y cronograma»). */
export interface CronogramaPeriodo {
  inicio: string;
  limiteRegistro: string | null;
  limiteSolicitudArl: string | null;
  jornadasInduccion: string[];
  fechaCargueDocumentos: string | null;
  cierre: string;
}

export interface Periodo {
  codigo: string; nombre: string; calendario: CalendarioPeriodo;
  fechaInicio: string; fechaFin: string;
  ventanas: Partial<Record<TipoVentana, { desde: string; hasta: string }>>;
  cronograma: CronogramaPeriodo;
  abiertas: Record<TipoVentana, boolean>;
  sincronizacionDocentes: boolean;
  modalidadesHabilitadas: string[];
  modalidadesOfertadas: string[];
  activo: boolean; vigente: boolean; actualizadoEn: string;
}

export interface ModalidadCatalogo {
  modalidad: string; etiqueta: string; etiquetaSgp: string; descripcion: string; articulada: boolean;
  responsableArl: string; solicitudArl: 'si' | 'no' | 'segun_cobertura';
  documentosPorMomento: { momento: 1 | 2 | 3; etiqueta: string; documentos: string[] }[];
  documentosArl: string[]; duracionMesesMinima: number | null; duracionMesesMaxima: number | null;
  fechasDentroDelPeriodo: boolean; condicionesAdicionales: string[];
}

export interface CatalogoProceso {
  estadosSgp: Record<string, string>;
  motivosRechazoArl: { codigo: string; etiqueta: string }[];
  preguntasEvaluaTuProceso: string[];
}

// ── Carta de presentación ────────────────────────────────────────────────
export interface Carta {
  id: string; numeroFur: number | null; practicaId: string | null; estudianteId: string; estudianteNombre: string;
  estudianteDocumento: string | null; periodoAcademico: string; modalidadCarta: 'abierta' | 'con_empresa';
  empresaRazonSocial: string | null; generadaEn: string; generadaPor: string;
}

// ── Bitácora y cierre ────────────────────────────────────────────────────
export type TipoEntradaBitacora =
  | 'mensaje_libre' | 'seguimiento' | 'evaluacion_final' | 'evalua_tu_proceso'
  | 'calificacion_docente' | 'plazo_subsanacion' | 'sistema';

export interface EntradaBitacora {
  id: string; practicaId: string; tipo: TipoEntradaBitacora; etiqueta: string;
  autor: 'estudiante' | 'docente' | 'coordinacion' | 'sistema'; autorId: string | null; autorNombre: string;
  mensaje: string; detalle: Record<string, unknown> | null; venceEl: string | null; creadaEn: string; propia: boolean;
}

export interface EscribirBitacora {
  tipo: TipoEntradaBitacora; mensaje?: string;
  seguimiento?: { fechaVisita: string; modalidadVisita: 'presencial' | 'virtual' | 'telefonica'; contactoNombre: string;
    contactoCargo?: string; contactoArea?: string; sugerenciasPlanMejoramiento?: string; evaluacionJefeInmediato?: string };
  evaluacionFinal?: { desempeno: string; satisfaccionEmpresa: string; retroalimentacionPlanMejoramiento?: string };
  evaluaTuProceso?: { respuestas: { pregunta: number; valor: number }[]; comentario?: string };
  calificacion?: { nota: number };
  subsanacion?: { documentos: string[] };
}

export interface EstadoCierre {
  estado: EstadoPractica; estadoSgp: string; porcentajeAprobado: number; documentosAprobados: boolean;
  evaluaTuProceso: boolean; calificacion: boolean; nota: number | null; aprobada: boolean | null;
  puedeCerrar: boolean; faltantes: string[]; cerradaEn: string | null; preguntasEvaluaTuProceso: string[];
}

// ── Solicitud de ARL ─────────────────────────────────────────────────────
export type EstadoSolicitudArl = 'radicada' | 'aprobada' | 'rechazada' | 'certificado_enviado' | 'anulada';

export interface CriterioArl {
  criterio: string; resultado: 'cumple' | 'no_cumple' | 'revision_manual'; detalle: string; motivo: string | null;
}

export interface SolicitudArl {
  id: string; consecutivo: number | null; practicaId: string; estudianteId: string; estudianteNombre: string;
  estudianteCorreo: string; programaId: string | null; periodoAcademico: string; modalidad: string;
  modalidadEtiqueta: string; tipoIdentificacion: string; numeroIdentificacion: string; fechaInicio: string;
  fechaFin: string; epsNombre: string; epsRegimen: string; fechaExpedicionEps: string | null;
  fechaExpedicionRut: string | null; fechaExpedicionCamara: string | null; documentosExigidos: string[];
  documentos: { tipo: string; documentoId: string; estado: string }[];
  recomendacion: 'aprobar' | 'rechazar' | 'revision_manual' | null; criterios: CriterioArl[];
  estado: EstadoSolicitudArl; motivosRechazo: string[]; motivosRechazoEtiquetas: string[];
  observacion: string | null; decididaPor: string | null; decididaEn: string | null;
  certificadoDocumentoId: string | null; certificadoEnviadoEn: string | null; radicadaEn: string;
}

export interface RadicarArl {
  practicaId?: string; tipoIdentificacion: 'CC' | 'TI' | 'CE' | 'PA'; numeroIdentificacion: string;
  epsNombre: string; epsRegimen: 'convencional' | 'regimen_especial' | 'fomag' | 'epsi';
  fechaExpedicionEps?: string; fechaExpedicionRut?: string; fechaExpedicionCamara?: string;
}

export interface FilaConsolidadoArl {
  consecutivo: number | null; estado: EstadoSolicitudArl; estudianteNombre: string; numeroIdentificacion: string;
  estudianteCorreo: string; programaId: string | null; periodoAcademico: string; modalidad: string;
  fechaInicio: string; fechaFin: string; epsNombre: string; motivos: string[]; decididaEn: string | null;
}

export interface ConsolidadoArl {
  fecha: string; aprobadas: FilaConsolidadoArl[]; rechazadas: FilaConsolidadoArl[]; certificadosEnviados: FilaConsolidadoArl[];
}

// ── Usuarios administrativos, vistas SINU ────────────────────────────────
export interface UsuarioAdministrativo {
  id: string; correo: string; nombre: string; documento: string | null; rol: Rol; rolEtiqueta: string;
  permiso: Permiso; escuelas: string[]; activo: boolean; creadoEn: string; ultimoAccesoEn: string | null;
}

export interface MatriculaSinu {
  documentoEstudiante: string; nombreEstudiante: string; correoInstitucional: string; programaId: string;
  programaNombre: string; escuelaId: string; ciclo: string; periodoAcademico: string; asignaturaPractica: string;
  codigoAsignatura?: string | null; regional?: string | null; telefono?: string | null; semestre?: number | null;
  pensum?: string | null;
}

export interface VistaEstudianteSinu {
  documento: string; matricula: MatriculaSinu | null;
  usuarioSgp: { id: string; nombre: string; correo: string; programaId: string | null; activo: boolean } | null;
  practica: { id: string; numeroFur: number | null; periodoAcademico: string; modalidad: string; estado: EstadoPractica;
    estadoSgp: string; tutorId: string | null; tutorNombre: string | null } | null;
  correspondencia: { campo: string; sinu: string | null; sgp: string | null; coincide: boolean }[];
}

export interface FilaMatriculaSinu {
  matricula: MatriculaSinu; registradaEnSgp: boolean; practicaId: string | null; estadoSgp: string | null; tutorNombre: string | null;
}

export interface ResumenSincronizacion {
  periodoAcademico: string; practicasRevisadas: number; asignadas: number; sinCambios: number; docentesCreados: number;
  sinDocenteEnSinu: { practicaId: string; estudianteDocumento: string | null }[];
}

export interface ReporteTabla {
  columnas: { clave: string; encabezado: string; ancho?: number }[];
  filas: Record<string, string | number | boolean | null>[];
  total: number;
}

export interface Bandera {
  codigo: string;
  capa: number;
  severidad: 'informativa' | 'media' | 'alta' | 'critica';
  mensaje: string;
  mensajeUsuario?: string;
}

export interface Documento {
  id: string;
  practicaId: string;
  tipo: string;
  version: number;
  estado: EstadoDocumento;
  nombreOriginal: string;
  tamanoBytes: number;
  puntaje: number | null;
  banda: 'verde' | 'amarillo' | 'rojo' | null;
  motivoDevolucion: string | null;
  cargadoEn: string;
  banderas?: Bandera[];
  /** Solo roles internos; el estudiante nunca lo recibe. */
  lectura?: LecturaAsistida | null;
}

export interface SenalPreverificacion {
  codigo: string;
  resultado: 'ok' | 'advertencia' | 'critico';
  detalle: string;
}

export interface Empresa {
  id: string;
  razonSocial: string;
  nit: string;
  estado: EstadoEmpresa;
  semaforo: 'verde' | 'amarillo' | 'rojo';
  solicitanteNombre: string;
  solicitanteCorreo: string;
  solicitadaEn: string;
  senales?: SenalPreverificacion[];
}

export interface FilaTablero {
  practicaId: string;
  estudianteId: string;
  escuelaId: string;
  obligacionId: string;
  tipo: string;
  norma: string;
  responsable: string;
  efecto: string;
  estado: string;
  fechaLimite: string;
  diasRestantes: number;
  semaforo: 'cumplida' | 'vencida' | 'critica' | 'alerta' | 'vigente';
}

export interface TableroCumplimiento {
  resumen: Record<'cumplida' | 'vencida' | 'critica' | 'alerta' | 'vigente', number>;
  filas: FilaTablero[];
  practicasBloqueadas: number;
}

export interface Vacante {
  id: string;
  empresaId: string;
  empresaRazonSocial: string | null;
  marco: 'practica' | 'laboral';
  titulo: string;
  descripcion: string;
  funciones: string;
  requisitos: string;
  codigoCno: string;
  codigoCiiu: string;
  divipolaMunicipio: string;
  nivelEducativo: string;
  vacantesDisponibles: number;
  estado: EstadoVacante;
  publicadaEn: string | null;
  vigenteHasta: string | null;
}

export interface Hallazgo {
  categoria: string;
  fragmento: string;
  norma: string;
}

export interface ResultadoAntidiscriminacion {
  publicable: boolean;
  hallazgos: Hallazgo[];
}

export interface MetricasCaptura {
  varianzaLaplaciano: number;
  luminanciaMedia: number;
  porcentajeSaturados: number;
  anchoPx: number;
  altoPx: number;
}

export interface EstadoCatalogo {
  nombre: string;
  estado: 'completo' | 'parcial' | 'ausente';
  filasCargadas: number;
  filasEsperadas: number | null;
  fuente: string | null;
  urlOficial: string | null;
  justificacion: string | null;
}

// ── Centro de ayuda y PQRS ──────────────────────────────────────────────
export type CategoriaPqrs =
  | 'inicio_y_requisitos_de_practicas' | 'modalidades_y_duracion_de_practicas' | 'carta_de_presentacion'
  | 'registro_y_documentos_en_sgp' | 'afiliacion_y_cobertura_de_arl_y_eps' | 'acta_de_inicio_y_fechas'
  | 'acompanamiento_y_seguimiento_de_practicas' | 'plan_de_mejoramiento' | 'notas_y_situacion_academica'
  | 'contrato_de_aprendizaje_y_cadena_de_formacion' | 'certificados_y_experiencia_profesional'
  | 'soporte_tecnico_del_sgp' | 'fechas_y_cronograma' | 'tickets_y_seguimiento_de_solicitudes'
  | 'apoyo_laboral' | 'convenios';

export interface CategoriaAyuda { clave: CategoriaPqrs; etiqueta: string; pantallas: string[] }

export interface PreguntaFrecuente { numero: number; categoria: CategoriaPqrs; pregunta: string; respuesta: string }

export type TipoPqrs = 'peticion' | 'queja' | 'reclamo' | 'sugerencia';
export type EstadoPqrs = 'radicada' | 'en_tramite' | 'respondida' | 'cerrada' | 'unificada';

export interface RadicarPqrs { tipo: TipoPqrs; categoria: CategoriaPqrs | ''; asunto: string; descripcion: string; practicaId?: string | null }

export interface Pqrs {
  id: string; radicado: number | null; estudianteId: string;
  estudiante: { nombre: string; correo: string } | null;
  practicaId: string | null; tipo: TipoPqrs; categoria: CategoriaPqrs; categoriaEtiqueta: string;
  asunto: string; descripcion: string; estado: EstadoPqrs;
  respuesta: string | null; respondidaPor: string | null; respondidaEn: string | null;
  unificadaConId: string | null; unificadaConRadicado: number | null;
  radicadaEn: string; actualizadaEn: string;
  sugerencias?: PreguntaFrecuente[];
}

// ── Costos de IA y lectura asistida ─────────────────────────────────────
export type RecomendacionModeloIa = 'principal' | 'alternativa' | 'escalamiento' | 'no_recomendado';

/** Cómo cobra el modelo las imágenes (y las páginas de un PDF, que viajan como imagen). */
export type ReglaImagenIa =
  | { tipo: 'parches'; multiplicador: number; topeParches: number; publicada: boolean }
  | { tipo: 'mosaicos'; base: number; porMosaico: number };

export interface ConfiguracionIa {
  driver: string; modelo: string; esfuerzo: string; topeDiarioUsd: number;
  tarifasVigentesDesde: string; fuenteTarifas: string;
}

export interface TarifaIa {
  id: string; proveedor: 'openai' | 'anthropic'; familia: string;
  entradaUsdPorMillon: number; entradaCacheUsdPorMillon: number; factorEscrituraCache: number;
  salidaUsdPorMillon: number; descuentoLotePorcentaje: number; razonador: boolean; imagen: ReglaImagenIa;
  retiro: string | null; recomendacion: RecomendacionModeloIa; nota: string;
}

export interface SupuestosEstimacionIa {
  anchoPaginaPx: number; altoPaginaPx: number; tokensTextoPorPagina: number;
  tokensRespuesta: number; tokensRazonamiento: number; factorReenvios: number;
}

export interface EstimacionDocumentoIa {
  tipo: string; nombre: string; paginas: number; tokensEntrada: number; tokensSalida: number; costoUsd: number;
}

export interface EstimacionModalidadIa {
  modalidad: string; etiqueta: string; articulada: boolean; documentos: EstimacionDocumentoIa[];
  totalDocumentos: number; totalPaginas: number; tokensEntrada: number; tokensSalida: number;
  /** Una sola lectura por documento. */
  costoUsd: number;
  /** Con el factor de reenvíos: la cifra que conviene presupuestar. */
  costoConReenviosUsd: number;
}

export interface EstimacionIa {
  modelo: string; tarifa: TarifaIa; tarifaExacta: boolean; supuestos: SupuestosEstimacionIa;
  tokensImagenPorPagina: number; modalidades: EstimacionModalidadIa[];
  promedioEstudianteUsd: number; minimoEstudianteUsd: number; maximoEstudianteUsd: number; porMilEstudiantesUsd: number;
}

export interface ComparativaModeloIa {
  modelo: string; familia: string; recomendacion: RecomendacionModeloIa; retiro: string | null;
  entradaUsdPorMillon: number; salidaUsdPorMillon: number; costoPorPaginaUsd: number;
  promedioEstudianteUsd: number; minimoEstudianteUsd: number; maximoEstudianteUsd: number; porMilEstudiantesUsd: number;
}

export interface GastoPorClave {
  clave: string; etiqueta: string; documentos: number; tokensEntrada: number; tokensSalida: number; costoUsd: number;
}

export interface GastoPorEstudiante {
  estudianteId: string; nombre: string; periodoAcademico: string;
  modalidad: string; modalidadEtiqueta: string; documentos: number; tokensEntrada: number; tokensSalida: number;
  costoUsd: number; ultimaLectura: string;
}

export interface ResumenGastoIa {
  filtro: { periodoAcademico: string | null; desde: string | null; hasta: string | null };
  periodosDisponibles: string[];
  totales: {
    costoUsd: number; documentos: number; estudiantes: number; tokensEntrada: number; tokensSalida: number;
    costoPromedioDocumentoUsd: number; costoPromedioEstudianteUsd: number;
    /** Documentos leídos sin costo (simulado, PDF417): el pipeline corrió sin IA. */
    documentosSinCosto: number;
  };
  gastoHoyUsd: number; topeDiarioUsd: number;
  porModelo: GastoPorClave[]; porTipo: GastoPorClave[]; porModalidad: GastoPorClave[]; porPeriodo: GastoPorClave[];
  porEstudiante: GastoPorEstudiante[];
}

export interface HallazgoLectura {
  codigo: string; enunciado: string; cumple: 'si' | 'no' | 'no_determinable'; detalle: string | null; causalDevolucion: boolean;
}

export interface CampoLectura { valor: string | null; confianza: number; evidencia: string | null }

/** Resumen de la lectura asistida de un documento. Solo llega a roles internos. */
export interface LecturaAsistida {
  proveedor: string; modelo: string; tipoDetectado: string | null; ilegible: boolean; motivoIlegible: string | null;
  resumen: string | null; hallazgos: HallazgoLectura[]; tokensEntrada: number; tokensSalida: number; costoUsd: number;
  leidoEn: string | null; campos: Record<string, CampoLectura>;
}
