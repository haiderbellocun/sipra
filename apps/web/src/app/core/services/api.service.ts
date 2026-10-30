import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { entorno } from '../../../environments/environment';
import {
  Carta, CatalogoProceso, ConsolidadoArl, Documento, Empresa, EntradaBitacora, EscribirBitacora, EstadoCierre,
  EstadoPractica, FilaMatriculaSinu, FiltroPracticas, ModalidadCatalogo, Periodo, Practica, RadicarArl, RegistroFur,
  ReporteTabla, ResultadoAntidiscriminacion, ResumenSincronizacion, SolicitudArl, TableroCumplimiento,
  UsuarioAdministrativo, VacanteEditable, Vacante, VistaEstudianteSinu,
  CategoriaAyuda, PreguntaFrecuente, Pqrs, RadicarPqrs,
  ComparativaModeloIa, ConfiguracionIa, EstimacionIa, ResumenGastoIa, TarifaIa,
  ConsultaAdresPreparada, FilaBandejaAdres, ResultadoAdres,
  DecisionMesa, DetalleMesa, FiltrosMesa, ListadoMesa, ResultadoTomarSiguiente, SupervisionMesa,
  CorreccionDatosPractica, DecisionActa, DetalleActa, EstadoActaEstudiante, FiltrosActas, ListadoBandejaActa, ReservaActa, SupervisionActa,
} from '../models/modelos';

const aParams = (valores: Record<string, string | number | boolean | null | undefined>): HttpParams => {
  let params = new HttpParams();
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor !== undefined && valor !== null && valor !== '') params = params.set(clave, String(valor));
  }
  return params;
};

/** Cliente único de la API. Los componentes no arman URLs. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = entorno.apiBase;

  // ── Mesa operativa de EPS ──────────────────────────────────────────────
  listarMesaEps(filtros: FiltrosMesa = {}): Observable<ListadoMesa> {
    return this.http.get<ListadoMesa>(`${this.base}/mesa-eps`, { params: aParams({ ...filtros }) });
  }

  detalleMesaEps(id: string): Observable<DetalleMesa> {
    return this.http.get<DetalleMesa>(`${this.base}/mesa-eps/${id}`);
  }

  /** El certificado llega por la sesión autenticada (cabecera Authorization): no hay enlace firmado ni credencial en la URL. */
  certificadoMesaEps(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/mesa-eps/${id}/certificado`, { responseType: 'blob' });
  }

  tomarSiguienteEps(criterios: { periodo?: string; programa?: string; modalidad?: string; enfoque?: 'pendiente_adres' } = {}): Observable<ResultadoTomarSiguiente> {
    return this.http.post<ResultadoTomarSiguiente>(`${this.base}/mesa-eps/siguiente`, criterios);
  }

  decidirMesaEps(id: string, dto: DecisionMesa): Observable<unknown> {
    return this.http.post(`${this.base}/mesa-eps/${id}/decision`, dto);
  }

  supervisionMesaEps(): Observable<SupervisionMesa> {
    return this.http.get<SupervisionMesa>(`${this.base}/mesa-eps/supervision`);
  }

  // ── Mesa de Actas de Iniciación ────────────────────────────────────────
  listarMesaActas(filtros: FiltrosActas = {}): Observable<ListadoBandejaActa> {
    return this.http.get<ListadoBandejaActa>(`${this.base}/actas-iniciacion`, { params: aParams({ ...filtros }) });
  }

  detalleActa(id: string): Observable<DetalleActa> {
    return this.http.get<DetalleActa>(`${this.base}/actas-iniciacion/${id}`);
  }

  /** El acta llega por la sesión autenticada (cabecera Authorization): sin enlace firmado ni credencial en la URL. */
  archivoActa(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/actas-iniciacion/${id}/archivo`, { responseType: 'blob' });
  }

  tomarActa(id: string): Observable<ReservaActa> {
    return this.http.post<ReservaActa>(`${this.base}/actas-iniciacion/${id}/tomar`, {});
  }

  liberarActa(id: string): Observable<ReservaActa> {
    return this.http.post<ReservaActa>(`${this.base}/actas-iniciacion/${id}/liberar`, {});
  }

  tomarSiguienteActa(criterios: { conDiscrepancias?: 'si' | 'no'; documentoIncorrecto?: 'si' } = {}): Observable<{ estado: 'tomado' | 'sin_casos'; validacionId: string | null }> {
    return this.http.post<{ estado: 'tomado' | 'sin_casos'; validacionId: string | null }>(`${this.base}/actas-iniciacion/tomar-siguiente`, criterios);
  }

  decidirActa(id: string, dto: DecisionActa): Observable<unknown> {
    return this.http.post(`${this.base}/actas-iniciacion/${id}/decision`, dto);
  }

  supervisionActas(): Observable<SupervisionActa> {
    return this.http.get<SupervisionActa>(`${this.base}/actas-iniciacion/supervision`);
  }

  estadoDeMiActa(practicaId: string): Observable<EstadoActaEstudiante> {
    return this.http.get<EstadoActaEstudiante>(`${this.base}/actas-iniciacion/practica/${practicaId}/estado`);
  }

  /** Corrección controlada (coordinación/administración): remuneración y/o quién asume la ARL, con justificación. */
  corregirDatosGobernantes(practicaId: string, dto: { tipoRemuneracion?: string; responsableArl?: string; justificacion: string }): Observable<CorreccionDatosPractica> {
    return this.http.patch<CorreccionDatosPractica>(`${this.base}/practicas/${practicaId}/datos-gobernantes`, dto);
  }

  // ── Validación de EPS · consulta ADRES asistida ────────────────────────
  // La persona consulta el portal oficial y resuelve ella misma la verificación; la API nunca llama a ADRES.
  bandejaAdres(): Observable<FilaBandejaAdres[]> {
    return this.http.get<FilaBandejaAdres[]>(`${this.base}/validaciones-eps/adres/bandeja`);
  }

  tomarCasoEps(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/validaciones-eps/${id}/reserva`, {});
  }

  liberarCasoEps(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/validaciones-eps/${id}/reserva`);
  }

  prepararAdres(id: string, tipoDocumento?: string): Observable<ConsultaAdresPreparada> {
    return this.http.post<ConsultaAdresPreparada>(`${this.base}/validaciones-eps/${id}/adres/preparar`, tipoDocumento ? { tipoDocumento } : {});
  }

  cargarResultadoAdres(id: string, formulario: FormData): Observable<ResultadoAdres> {
    return this.http.post<ResultadoAdres>(`${this.base}/validaciones-eps/${id}/adres/resultado`, formulario);
  }

  procesarResultadoAdres(id: string): Observable<ResultadoAdres> {
    return this.http.post<ResultadoAdres>(`${this.base}/validaciones-eps/${id}/adres/procesar`, {});
  }

  // ── Prácticas ──────────────────────────────────────────────────────────
  listarPracticas(filtro: FiltroPracticas = {}): Observable<Practica[]> {
    return this.http.get<Practica[]>(`${this.base}/practicas`, { params: aParams({ ...filtro }) });
  }

  registrarPractica(dto: RegistroFur): Observable<Practica> {
    return this.http.post<Practica>(`${this.base}/practicas/registro`, dto);
  }

  actualizarVacante(id: string, cambios: VacanteEditable): Observable<Practica> {
    return this.http.patch<Practica>(`${this.base}/practicas/${id}/vacante`, cambios);
  }

  // ── Periodos y catálogo ────────────────────────────────────────────────
  listarPeriodos(): Observable<Periodo[]> {
    return this.http.get<Periodo[]>(`${this.base}/periodos`);
  }

  crearPeriodo(dto: { codigo: string; nombre: string; calendario: string; fechaInicio: string; fechaFin: string; cierreFur?: string; fechaCargueDocumentos?: string }): Observable<Periodo> {
    return this.http.post<Periodo>(`${this.base}/periodos`, dto);
  }

  actualizarPeriodo(codigo: string, cambios: Record<string, unknown>): Observable<Periodo> {
    return this.http.patch<Periodo>(`${this.base}/periodos/${codigo}`, cambios);
  }

  catalogoModalidades(): Observable<ModalidadCatalogo[]> {
    return this.http.get<ModalidadCatalogo[]>(`${this.base}/catalogo/modalidades`);
  }

  catalogoProceso(): Observable<CatalogoProceso> {
    return this.http.get<CatalogoProceso>(`${this.base}/catalogo/proceso`);
  }

  // ── Centro de ayuda y PQRS ─────────────────────────────────────────────
  categoriasAyuda(): Observable<CategoriaAyuda[]> {
    return this.http.get<CategoriaAyuda[]>(`${this.base}/catalogo/categorias-ayuda`);
  }

  buscarPreguntas(texto: string, categoria?: string): Observable<PreguntaFrecuente[]> {
    return this.http.get<PreguntaFrecuente[]>(`${this.base}/catalogo/preguntas`, { params: aParams({ texto: texto || undefined, categoria: categoria || undefined }) });
  }

  listarPqrs(filtro: { estado?: string; categoria?: string } = {}): Observable<Pqrs[]> {
    return this.http.get<Pqrs[]>(`${this.base}/pqrs`, { params: aParams(filtro) });
  }

  radicarPqrs(dto: RadicarPqrs): Observable<Pqrs> {
    return this.http.post<Pqrs>(`${this.base}/pqrs`, dto);
  }

  tomarPqrs(id: string): Observable<Pqrs> {
    return this.http.patch<Pqrs>(`${this.base}/pqrs/${id}/tomar`, {});
  }

  responderPqrs(id: string, respuesta: string): Observable<Pqrs> {
    return this.http.patch<Pqrs>(`${this.base}/pqrs/${id}/responder`, { respuesta });
  }

  cerrarPqrs(id: string): Observable<Pqrs> {
    return this.http.patch<Pqrs>(`${this.base}/pqrs/${id}/cerrar`, {});
  }

  // ── Cartas de presentación ─────────────────────────────────────────────
  listarCartas(periodo?: string): Observable<Carta[]> {
    return this.http.get<Carta[]>(`${this.base}/cartas-presentacion`, { params: aParams({ periodo }) });
  }

  generarCarta(dto: { periodoAcademico: string; practicaId?: string; empresaRazonSocial?: string; estudianteDocumento?: string }): Observable<Carta> {
    return this.http.post<Carta>(`${this.base}/cartas-presentacion`, dto);
  }

  urlCartaPdf(id: string): string {
    return `${this.base}/cartas-presentacion/${id}/pdf`;
  }

  descargarCartaPdf(id: string): Observable<Blob> {
    return this.http.get(this.urlCartaPdf(id), { responseType: 'blob' });
  }

  // ── Bitácora y cierre ──────────────────────────────────────────────────
  listarBitacora(practicaId: string): Observable<EntradaBitacora[]> {
    return this.http.get<EntradaBitacora[]>(`${this.base}/practicas/${practicaId}/bitacora`);
  }

  escribirBitacora(practicaId: string, dto: EscribirBitacora): Observable<EntradaBitacora> {
    return this.http.post<EntradaBitacora>(`${this.base}/practicas/${practicaId}/bitacora`, dto);
  }

  estadoCierre(practicaId: string): Observable<EstadoCierre> {
    return this.http.get<EstadoCierre>(`${this.base}/practicas/${practicaId}/cierre`);
  }

  cerrarPractica(practicaId: string): Observable<{ cerrada: boolean; estado: EstadoPractica; nota: number | null }> {
    return this.http.post<{ cerrada: boolean; estado: EstadoPractica; nota: number | null }>(`${this.base}/practicas/${practicaId}/cierre`, {});
  }

  // ── Solicitudes de ARL ─────────────────────────────────────────────────
  listarSolicitudesArl(filtro: { estado?: string; periodo?: string } = {}): Observable<SolicitudArl[]> {
    return this.http.get<SolicitudArl[]>(`${this.base}/solicitudes-arl`, { params: aParams(filtro) });
  }

  obtenerSolicitudArl(id: string): Observable<SolicitudArl> {
    return this.http.get<SolicitudArl>(`${this.base}/solicitudes-arl/${id}`);
  }

  radicarSolicitudArl(dto: RadicarArl): Observable<SolicitudArl> {
    return this.http.post<SolicitudArl>(`${this.base}/solicitudes-arl`, dto);
  }

  decidirSolicitudArl(id: string, dto: { decision: 'aprobar' | 'rechazar'; motivos?: string[]; observacion?: string }): Observable<SolicitudArl> {
    return this.http.patch<SolicitudArl>(`${this.base}/solicitudes-arl/${id}/decision`, dto);
  }

  enviarCertificadoArl(id: string, formulario: FormData): Observable<SolicitudArl> {
    return this.http.post<SolicitudArl>(`${this.base}/solicitudes-arl/${id}/certificado`, formulario);
  }

  anularSolicitudArl(id: string): Observable<SolicitudArl> {
    return this.http.patch<SolicitudArl>(`${this.base}/solicitudes-arl/${id}/anular`, {});
  }

  consolidadoArl(fecha?: string): Observable<ConsolidadoArl> {
    return this.http.get<ConsolidadoArl>(`${this.base}/solicitudes-arl/consolidado`, { params: aParams({ fecha }) });
  }

  // ── Usuarios administrativos ───────────────────────────────────────────
  listarUsuarios(filtro: { nombre?: string; perfil?: string; estado?: string } = {}): Observable<UsuarioAdministrativo[]> {
    return this.http.get<UsuarioAdministrativo[]>(`${this.base}/usuarios`, { params: aParams(filtro) });
  }

  crearUsuario(dto: Record<string, unknown>): Observable<UsuarioAdministrativo> {
    return this.http.post<UsuarioAdministrativo>(`${this.base}/usuarios`, dto);
  }

  actualizarUsuario(id: string, dto: Record<string, unknown>): Observable<UsuarioAdministrativo> {
    return this.http.patch<UsuarioAdministrativo>(`${this.base}/usuarios/${id}`, dto);
  }

  eliminarUsuario(id: string): Observable<UsuarioAdministrativo> {
    return this.http.delete<UsuarioAdministrativo>(`${this.base}/usuarios/${id}`);
  }

  // ── Vistas SINU ────────────────────────────────────────────────────────
  vistaEstudianteSinu(documento: string): Observable<VistaEstudianteSinu> {
    return this.http.get<VistaEstudianteSinu>(`${this.base}/vistas/sinu/estudiante`, { params: aParams({ documento }) });
  }

  matriculasSinu(periodo: string): Observable<FilaMatriculaSinu[]> {
    return this.http.get<FilaMatriculaSinu[]>(`${this.base}/vistas/sinu/matriculas`, { params: aParams({ periodo }) });
  }

  sincronizarDocentes(periodoAcademico: string): Observable<ResumenSincronizacion> {
    return this.http.post<ResumenSincronizacion>(`${this.base}/vistas/sincronizar-docentes`, { periodoAcademico });
  }

  // ── Reportes SGP ───────────────────────────────────────────────────────
  reporteSgpTabla(reporte: 'practicas' | 'bitacoras' | 'cartas', filtro: Record<string, string | undefined>): Observable<ReporteTabla> {
    return this.http.get<ReporteTabla>(`${this.base}/reportes/sgp/${reporte}`, { params: aParams({ ...filtro, formato: 'json' }) });
  }

  reporteSgpExcel(reporte: 'practicas' | 'bitacoras' | 'cartas', filtro: Record<string, string | undefined>) {
    return this.http.get(`${this.base}/reportes/sgp/${reporte}`, {
      params: aParams(filtro), observe: 'response', responseType: 'blob',
    });
  }

  obtenerPractica(id: string): Observable<Practica> {
    return this.http.get<Practica>(`${this.base}/practicas/${id}`);
  }

  transicionarPractica(
    id: string, destino: EstadoPractica, justificacion: string,
  ): Observable<Practica> {
    return this.http.patch<Practica>(`${this.base}/practicas/${id}/estado`, {
      destino, justificacion,
    });
  }

  registrarArl(id: string, fechaAfiliacion: string): Observable<Practica> {
    return this.http.patch<Practica>(`${this.base}/practicas/${id}/arl`, { fechaAfiliacion });
  }

  // ── Documentos ─────────────────────────────────────────────────────────
  listarDocumentos(practicaId: string): Observable<Documento[]> {
    return this.http.get<Documento[]>(`${this.base}/documentos/practica/${practicaId}`);
  }

  cargarDocumento(practicaId: string, formulario: FormData): Observable<Documento> {
    return this.http.post<Documento>(`${this.base}/documentos/practica/${practicaId}`, formulario);
  }

  decidirDocumento(
    id: string, decision: 'aprobar' | 'rechazar' | 'devolver', justificacion: string,
  ): Observable<Documento> {
    return this.http.patch<Documento>(`${this.base}/documentos/${id}/decision`, {
      decision, justificacion,
    });
  }

  enlaceDocumento(id: string): Observable<{ url: string; expiraEn: string }> {
    return this.http.get<{ url: string; expiraEn: string }>(`${this.base}/documentos/${id}/enlace`);
  }

  // ── Empresas ───────────────────────────────────────────────────────────
  listarEmpresas(estado?: string): Observable<Empresa[]> {
    const params = estado ? new HttpParams().set('estado', estado) : undefined;
    return this.http.get<Empresa[]>(`${this.base}/empresas`, { params });
  }

  decidirEmpresa(
    id: string,
    decision: 'habilitar' | 'rechazar' | 'requerir_info' | 'suspender',
    justificacion: string,
  ): Observable<Empresa> {
    return this.http.patch<Empresa>(`${this.base}/empresas/${id}/decision`, {
      decision, justificacion,
    });
  }

  verificarNit(numero: string): Observable<{
    numero: string; digitoVerificacion: number; formateado: string;
  }> {
    return this.http.post<{ numero: string; digitoVerificacion: number; formateado: string }>(
      `${this.base}/empresas/nit/verificar`, { numero },
    );
  }

  // ── Cumplimiento ───────────────────────────────────────────────────────
  tableroCumplimiento(dias = 60): Observable<TableroCumplimiento> {
    return this.http.get<TableroCumplimiento>(`${this.base}/cumplimiento/tablero`, {
      params: new HttpParams().set('dias', dias),
    });
  }

  catalogoObligaciones(): Observable<
    { tipo: string; norma: string; responsable: string; efecto: string; descripcion: string }[]
  > {
    return this.http.get<
      { tipo: string; norma: string; responsable: string; efecto: string; descripcion: string }[]
    >(`${this.base}/cumplimiento/catalogo`);
  }

  auditoria(entidad?: string, limite = 60): Observable<Record<string, unknown>[]> {
    let params = new HttpParams().set('limite', limite);
    if (entidad) params = params.set('entidad', entidad);
    return this.http.get<Record<string, unknown>[]>(`${this.base}/cumplimiento/auditoria`, { params });
  }

  // ── Bolsa de empleo ────────────────────────────────────────────────────
  listarVacantes(filtro: { estado?: string; marco?: string } = {}): Observable<Vacante[]> {
    let params = new HttpParams();
    if (filtro.estado) params = params.set('estado', filtro.estado);
    if (filtro.marco) params = params.set('marco', filtro.marco);
    return this.http.get<Vacante[]>(`${this.base}/bolsa/vacantes`, { params });
  }

  validarTextoVacante(texto: string): Observable<ResultadoAntidiscriminacion> {
    return this.http.post<ResultadoAntidiscriminacion>(
      `${this.base}/bolsa/vacantes/validar-texto`, { texto },
    );
  }

  publicarVacante(id: string): Observable<Vacante> {
    return this.http.post<Vacante>(`${this.base}/bolsa/vacantes/${id}/publicar`, {});
  }

  // ── Costos de IA ───────────────────────────────────────────────────────
  configuracionIa(): Observable<ConfiguracionIa> {
    return this.http.get<ConfiguracionIa>(`${this.base}/costos-ia/configuracion`);
  }

  tarifasIa(): Observable<TarifaIa[]> {
    return this.http.get<TarifaIa[]>(`${this.base}/costos-ia/tarifas`);
  }

  estimacionIa(
    modelo?: string,
    ajustes: { factorReenvios?: number; tokensTextoPorPagina?: number; tokensRazonamiento?: number } = {},
  ): Observable<EstimacionIa> {
    return this.http.get<EstimacionIa>(`${this.base}/costos-ia/estimacion`, { params: aParams({ modelo, ...ajustes }) });
  }

  comparativaIa(factorReenvios?: number): Observable<ComparativaModeloIa[]> {
    return this.http.get<ComparativaModeloIa[]>(`${this.base}/costos-ia/comparativa`, { params: aParams({ factorReenvios }) });
  }

  resumenCostosIa(filtro: { periodo?: string; desde?: string; hasta?: string } = {}): Observable<ResumenGastoIa> {
    return this.http.get<ResumenGastoIa>(`${this.base}/costos-ia/resumen`, { params: aParams(filtro) });
  }
}
