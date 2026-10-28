import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatosAdres, EstadoAdres, RecomendacionEps } from '../../../domain/entities/adres';
import { AccionAuditada, RegistroAuditoria } from '../../../domain/entities/auditoria.entity';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import { TipoEvidenciaEps } from '../../../domain/entities/evidencia-validacion-eps.entity';
import {
  AutenticidadEps, CoincidenciaEps, DatosValidacionEps, DecisionEps, EstadoProcesamientoEps,
} from '../../../domain/entities/validacion-eps.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  FilaMesaRepo, TOPE_LISTADO_MESA, VALIDACION_EPS_REPOSITORY, ValidacionEpsRepositoryPort,
} from '../../../domain/ports/out/validacion-eps.port';
import { compararTriple, esFechaDeContinuidadAdres } from '../../../domain/services/adres-resultado.domain-service';
import {
  ESTADOS_ADRES_ABIERTOS, MotivoDevolucionEps, calcularPrioridad, condicionesRecomendacion, construirDiscrepancias, evaluarApartamiento,
  evaluarFrescuraAdres, mensajeDevolucion, recomendacionActual, tieneDiscrepanciaCriticaPersistida, veredictoCertificadoVsSipra,
  ContextoMesa, DiscrepanciaLegible, JUSTIFICACION_MINIMA,
} from '../../../domain/services/mesa-eps.domain-service';
import { diasDesdeExpedicion } from '../../../domain/services/comparacion-eps.domain-service';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { normalizarDocumento } from '../../../domain/services/normalizacion-identidad';
import {
  esSupervisorEps, puedeDecidirDocumento, puedeOperarValidacionEps,
} from '../../../domain/value-objects/acceso-eps.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { DocumentoRespuestaDto } from '../../dtos/documento.dto';
import {
  CampoCertificadoDto, DecisionMesaDto, DetalleMesaDto, EventoHistorialDto, EvidenciaMesaDto, FilaMesaDto, KpisMesaDto, ListadoMesaDto,
  ReservaMesaDto, ResultadoTomarSiguienteDto, SupervisionMesaDto, TomarSiguienteDto, VersionCertificadoDto,
} from '../../dtos/mesa-eps.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { GestionarDocumentoUseCase } from './gestionar-documento.use-case';
import { DURACION_RESERVA_EPS_MS } from './validacion-eps.use-case';
import { INTERRUPTORES_EPS, exigirInterruptorEps } from '../../services/interruptores-eps';
import { MetricasService } from '../../../infrastructure/observability/metricas.service';

export const AVISO_RETENCION_EPS = 'POLÍTICA DE RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL';
const POR_VENCER_MS = 5 * 60_000;

const DATOS_ADRES_VACIOS: DatosAdres = {
  tipoDocumento: null, numeroDocumento: null, nombre: null, eps: null, regimen: null, estadoAfiliacion: null,
  fechaAfiliacion: null, fechaFinalizacion: null, fechaConsulta: null, fuenteActualizadaEn: null,
};

const ETIQUETAS_CAMPO: Record<string, string> = {
  entidad_emisora: 'Entidad emisora', nombre_afiliado: 'Nombre del afiliado', documento_afiliado: 'Documento del afiliado',
  fecha_expedicion: 'Fecha de expedición (generación)', estado_afiliacion: 'Estado que declara el certificado', regimen: 'Régimen',
  tipo_afiliado: 'Tipo de afiliado',
};

const TEXTO_RECOMENDACION: Record<RecomendacionEps, { titulo: string; explicacion: string }> = {
  [RecomendacionEps.CANDIDATO_AUTOAPROBACION]: {
    titulo: 'Candidato: cumple todos los criterios',
    explicacion: 'La autenticidad está verificada, los datos coinciden, la afiliación está activa y el certificado está vigente. Todavía no se aprueba solo: la decisión es suya.',
  },
  [RecomendacionEps.REVISION_DOCUMENTAL]: {
    titulo: 'Revisar el documento',
    explicacion: 'La afiliación está activa, pero no hay una fuente oficial que confirme que el certificado sea auténtico. Revise el documento antes de decidir.',
  },
  [RecomendacionEps.REVISION_RECHAZO]: {
    titulo: 'Revisar: posible rechazo',
    explicacion: 'La afiliación no está vigente o la fuente oficial no confirma el certificado. Revise y decida si corresponde devolver o rechazar.',
  },
  [RecomendacionEps.DISCREPANCIA_CRITICA]: {
    titulo: 'Discrepancia crítica entre fuentes',
    explicacion: 'Hay datos de identidad o de entidad que no coinciden entre SIPRA, el certificado y ADRES. Revise las discrepancias antes de decidir.',
  },
  [RecomendacionEps.DOCUMENTO_INCORRECTO]: {
    titulo: 'Documento incorrecto',
    explicacion: 'El archivo no parece corresponder a un certificado de afiliación EPS: se detectaron indicadores de otro tipo de certificación. Revise el documento y, si corresponde, devuélvalo al estudiante.',
  },
  [RecomendacionEps.CERTIFICADO_VENCIDO]: {
    titulo: 'Certificado vencido',
    explicacion: 'La fecha de expedición supera la vigencia institucional. Es información para su decisión: no se rechaza automáticamente.',
  },
  [RecomendacionEps.PENDIENTE_ADRES]: {
    titulo: 'Falta contrastar con ADRES',
    explicacion: 'La afiliación todavía no se ha contrastado. Consulte ADRES y cargue el resultado para completar la revisión.',
  },
  [RecomendacionEps.INFORMACION_INSUFICIENTE]: {
    titulo: 'Información insuficiente',
    explicacion: 'No hay datos suficientes para recomendar. Revise el certificado y, si hace falta, devuélvalo al estudiante.',
  },
};

const TITULO_EVENTO: Partial<Record<AccionAuditada, string>> = {
  [AccionAuditada.DOCUMENTO_CARGADO]: 'El estudiante cargó el certificado',
  [AccionAuditada.VALIDACION_EPS_INICIADA]: 'Se inició la validación',
  [AccionAuditada.VALIDACION_EPS_PROCESADA]: 'Se leyó y comparó el certificado',
  [AccionAuditada.VERIFICACION_EPS_INICIADA]: 'Se inició la verificación con una fuente oficial',
  [AccionAuditada.VERIFICACION_EPS_COMPLETADA]: 'Terminó la verificación con una fuente oficial',
  [AccionAuditada.VERIFICACION_EPS_FALLIDA]: 'La verificación oficial no pudo concluir',
  [AccionAuditada.CONSULTA_ADRES_PREPARADA]: 'Se preparó la consulta a ADRES',
  [AccionAuditada.EVIDENCIA_ADRES_CARGADA]: 'Se cargó el resultado de ADRES',
  [AccionAuditada.EVIDENCIA_ADRES_PROCESADA]: 'Se procesó el resultado de ADRES',
  [AccionAuditada.COMPARACION_ADRES_REALIZADA]: 'Se comparó con ADRES',
  [AccionAuditada.VALIDACION_EPS_ASIGNADA]: 'Un funcionario tomó el caso',
  [AccionAuditada.VALIDACION_EPS_LIBERADA]: 'Se liberó el caso',
  [AccionAuditada.DECISION_DOCUMENTO]: 'Decisión sobre el certificado',
  [AccionAuditada.DECISION_EPS_CONTEXTO]: 'Contexto de la decisión',
  [AccionAuditada.DOCUMENTO_VISUALIZADO]: 'Se abrió el certificado',
};

const DECISION_TEXTO: Record<string, string> = { aprobar: 'Aprobado', devolver: 'Devuelto al estudiante', rechazar: 'Rechazado' };
const textoDecision = (v: unknown): string => (typeof v === 'string' ? v : '');

function enmascarar(documento: string | null): string {
  if (!documento) return '••••';
  return documento.length > 4 ? `••••${documento.slice(-4)}` : '••••';
}

/**
 * Mesa operativa de EPS.
 *
 * No reconstruye la lógica de las fases anteriores: lee las validaciones, las
 * ordena y explica, y delega en los casos de uso existentes (reserva, decisión).
 * La recomendación del sistema se muestra como RECOMENDACIÓN; la decisión final es
 * siempre de una persona, con el caso reservado por ella.
 */
@Injectable()
export class MesaEpsUseCase {
  constructor(
    @Inject(VALIDACION_EPS_REPOSITORY) private readonly validaciones: ValidacionEpsRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly gestionar: GestionarDocumentoUseCase,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly metricas?: MetricasService,
    @Optional() private readonly parametros?: ParametrosUseCase,
  ) {}

  /** Vigencia institucional del certificado (`arl.dias_vigencia_eps`). Si no se puede leer, no se inventa: `null`. */
  private async diasVigencia(): Promise<number | null> {
    try {
      const v = await this.parametros?.numero('arl.dias_vigencia_eps');
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  }

  onModuleInit(): void {
    this.metricas?.registrarFuenteEps(() => this.validaciones.resumenMetricasEps(new Date()));
  }

  // ── Alcance y permisos ─────────────────────────────────────────────────────

  private exigirOperador(actor: Actor): void {
    if (!puedeOperarValidacionEps(actor.rol)) throw new ForbiddenException('Su perfil no opera la Mesa de EPS');
    this.exigirActiva();
  }

  /** Interruptor de incidente: se evalúa DESPUÉS del permiso (un perfil sin acceso sigue viendo 403). */
  private exigirActiva(): void {
    exigirInterruptorEps(this.config, INTERRUPTORES_EPS.validacion, 'La validación de EPS está suspendida temporalmente. Los certificados quedan en espera; no se pierde nada.');
  }

  /** Coordinación con escuelas asignadas ve solo las suyas; el resto del personal operativo, todas. */
  private alcance(actor: Actor): string[] | null {
    return actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0 ? [...actor.escuelas] : null;
  }

  private get frescuraDias(): number | null {
    const v = Number(this.config?.get('ADRES_FRESCURA_DIAS'));
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  // ── Listado ────────────────────────────────────────────────────────────────

  async listar(actor: Actor, q: Record<string, string | undefined> = {}, ahora: Date = new Date()): Promise<ListadoMesaDto> {
    this.exigirOperador(actor);
    const todas = await this.validaciones.listarAbiertasMesa(ahora, this.alcance(actor));
    // Si la bandeja topó, el total REAL sale de un conteo en SQL: los KPI no pueden subestimar el trabajo pendiente.
    const truncado = todas.length >= TOPE_LISTADO_MESA;
    const totalAbiertas = truncado ? Math.max(todas.length, await this.validaciones.contarAbiertasMesa(this.alcance(actor))) : todas.length;
    const calculadas = todas.map((f) => this.aFila(f, actor, ahora));

    const kpis: KpisMesaDto = {
      abiertas: totalAbiertas,
      pendientes: calculadas.filter((c) => c.fila.reserva.estado === 'libre' || c.fila.reserva.estado === 'vencida').length,
      enRevision: calculadas.filter((c) => c.fila.reserva.estado === 'mia' || c.fila.reserva.estado === 'ajena').length,
      pendientesAdres: calculadas.filter((c) => ESTADOS_ADRES_ABIERTOS.includes(c.datos.adres.estado)).length,
      conDiscrepancias: calculadas.filter((c) => c.fila.discrepancias.criticas + c.fila.discrepancias.informativas > 0).length,
      candidatos: calculadas.filter((c) => c.datos.decision === DecisionEps.CANDIDATO_AUTOAPROBACION).length,
      asignadosAMi: calculadas.filter((c) => c.fila.reserva.estado === 'mia').length,
      misPorVencer: calculadas.filter((c) => c.fila.reserva.estado === 'mia' && c.reservaMs !== null && c.reservaMs - ahora.getTime() < POR_VENCER_MS).length,
    };

    const busquedaDoc = normalizarDocumento(q.buscar ?? null).numero;
    const texto = (q.buscar ?? '').trim().toLowerCase();
    const filtradas = calculadas.filter(({ fila, fuente }) => {
      if (q.estadoAdres && fila.estadoAdres !== q.estadoAdres) return false;
      if (q.autenticidad && fila.autenticidad !== q.autenticidad) return false;
      if (q.afiliacion && fila.afiliacion !== q.afiliacion) return false;
      if (q.recomendacion && fila.recomendacion !== q.recomendacion) return false;
      if (q.decision && fila.decision !== q.decision) return false;
      if (q.periodo && fila.periodo !== q.periodo) return false;
      if (q.programa && fila.programa !== q.programa) return false;
      if (q.modalidad && fila.modalidad !== q.modalidad) return false;
      if (q.desde && fila.recibidaEn < q.desde) return false;
      if (q.hasta && fila.recibidaEn.slice(0, 10) > q.hasta) return false;
      const conDisc = fila.discrepancias.criticas + fila.discrepancias.informativas > 0;
      if (q.conDiscrepancias === 'si' && !conDisc) return false;
      if (q.conDiscrepancias === 'no' && conDisc) return false;
      if (q.responsable === 'sin_asignar' && !['libre', 'vencida'].includes(fila.reserva.estado)) return false;
      if (q.responsable === 'otros' && fila.reserva.estado !== 'ajena') return false;
      if ((q.responsable === 'yo' || q.soloMios === 'true') && fila.reserva.estado !== 'mia') return false;
      if (q.reserva === 'por_vencer' && !(fila.reserva.estado === 'mia' && fila.reserva.hasta && new Date(fila.reserva.hasta).getTime() - ahora.getTime() < POR_VENCER_MS)) return false;
      if (texto) {
        const coincideNombre = fila.estudiante.nombre.toLowerCase().includes(texto);
        const coincideDoc = busquedaDoc !== null && busquedaDoc.length >= 5 && fuente.estudiante.documento !== null
          && normalizarDocumento(fuente.estudiante.documento).numero === busquedaDoc;
        if (!coincideNombre && !coincideDoc) return false;
      }
      return true;
    });

    const porAntiguedad = q.orden === 'antiguedad';
    filtradas.sort((a, b) => (porAntiguedad ? 0 : b.fila.prioridad.puntaje - a.fila.prioridad.puntaje)
      || a.fila.recibidaEn.localeCompare(b.fila.recibidaEn) || a.fila.validacionId.localeCompare(b.fila.validacionId));

    const limite = Math.min(100, Math.max(1, Number(q.limite) || 25));
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const unicos = (f: (c: (typeof calculadas)[number]) => string): string[] => [...new Set(calculadas.map(f))].sort();
    return {
      kpis, total: filtradas.length, pagina, limite, truncado, mostrando: todas.length,
      filas: filtradas.slice((pagina - 1) * limite, pagina * limite).map((c) => c.fila),
      filtrosDisponibles: { periodos: unicos((c) => c.fila.periodo), programas: unicos((c) => c.fila.programa), modalidades: unicos((c) => c.fila.modalidad) },
      generadoEn: ahora.toISOString(),
    };
  }

  private estadoReserva(d: DatosValidacionEps, actorId: string, ahora: Date, nombre: string | null): { dto: ReservaMesaDto; ms: number | null } {
    if (d.asignadoA === null || d.reservaHasta === null) return { dto: { estado: 'libre', responsable: null, hasta: null }, ms: null };
    const vigente = d.reservaHasta.getTime() > ahora.getTime();
    if (!vigente) return { dto: { estado: 'vencida', responsable: null, hasta: null }, ms: null };
    return {
      dto: { estado: d.asignadoA === actorId ? 'mia' : 'ajena', responsable: d.asignadoA === actorId ? 'Usted' : nombre ?? 'Otra persona', hasta: d.reservaHasta.toISOString() },
      ms: d.reservaHasta.getTime(),
    };
  }

  private triple(d: DatosValidacionEps, estudiante: { documento: string | null; nombre: string }) {
    return compararTriple(
      d.adres.datos ?? DATOS_ADRES_VACIOS,
      { tipoDocumento: d.adres.tipoDocumento, numeroDocumento: normalizarDocumento(estudiante.documento).numero, nombre: estudiante.nombre },
      d.datosExtraidos,
    );
  }

  private aFila(f: FilaMesaRepo, actor: Actor, ahora: Date) {
    const d = f.validacion.instantanea();
    const discrepancias = construirDiscrepancias(d, this.triple(d, f.estudiante));
    const criticas = discrepancias.filter((x) => x.severidad === 'critica').length;
    const reserva = this.estadoReserva(d, actor.id, ahora, f.responsableNombre);
    const prioridad = calcularPrioridad({
      recibidaEn: d.recibidaEn ?? d.creadaEn, fechaInicioPractica: f.practica.fechaInicio, version: f.documento.version,
      discrepanciaCritica: tieneDiscrepanciaCriticaPersistida(d), adresPendiente: ESTADOS_ADRES_ABIERTOS.includes(d.adres.estado),
    }, ahora);
    const fila: FilaMesaDto = {
      validacionId: d.id, documentoId: d.documentoId,
      estudiante: { nombre: f.estudiante.nombre, documentoEnmascarado: enmascarar(f.estudiante.documento) },
      programa: f.practica.programaId, modalidad: f.practica.modalidad, periodo: f.practica.periodoAcademico,
      fechaInicioPractica: f.practica.fechaInicio?.toISOString() ?? null,
      versionDocumento: f.documento.version, totalVersiones: f.documento.totalVersiones,
      recibidaEn: (d.recibidaEn ?? d.creadaEn).toISOString(), procesamiento: d.estadoProcesamiento, autenticidad: d.autenticidad,
      afiliacion: d.afiliacion, estadoAdres: d.adres.estado,
      recomendacion: recomendacionActual(d, criticas > 0 || tieneDiscrepanciaCriticaPersistida(d)),
      discrepancias: { criticas, informativas: discrepancias.length - criticas },
      decision: d.decision, prioridad, reserva: reserva.dto,
    };
    return { fila, datos: d, fuente: f, reservaMs: reserva.ms };
  }

  // ── Tomar siguiente ────────────────────────────────────────────────────────

  /**
   * Elige y reserva el siguiente caso en UNA sentencia atómica de la base: no se lista
   * primero ni se elige en el cliente. Dos personas a la vez reciben casos distintos.
   */
  async tomarSiguiente(actor: Actor, dto: TomarSiguienteDto = {}, ahora: Date = new Date()): Promise<ResultadoTomarSiguienteDto> {
    this.exigirOperador(actor);
    const id = await this.validaciones.tomarSiguiente(
      actor.id, ahora, new Date(ahora.getTime() + DURACION_RESERVA_EPS_MS), this.alcance(actor),
      {
        periodo: dto.periodo, programa: dto.programa, modalidad: dto.modalidad,
        estadosAdres: dto.enfoque === 'pendiente_adres' ? [EstadoAdres.PENDIENTE] : undefined,
      },
    );
    if (!id) return { estado: 'sin_casos', mensaje: 'No hay casos disponibles con esos criterios.' };
    await this.auditar(AccionAuditada.VALIDACION_EPS_ASIGNADA, id, { metodo: 'siguiente', reservaHasta: new Date(ahora.getTime() + DURACION_RESERVA_EPS_MS).toISOString() }, actor, ahora);
    return { estado: 'tomado', validacionId: id };
  }

  // ── Detalle ────────────────────────────────────────────────────────────────

  private async cargarCaso(validacionId: string, actor: Actor) {
    this.exigirOperador(actor);
    const v = await this.validaciones.buscarPorId(validacionId);
    if (!v) throw new NotFoundException('Caso no encontrado');
    const practica = await this.practicas.buscarPorId(v.practicaId);
    if (!practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      throw new NotFoundException('Caso no encontrado');
    }
    const documento = await this.documentos.buscarPorId(v.documentoId);
    if (!documento || documento.tipo !== TipoDocumento.CERTIFICADO_EPS) throw new NotFoundException('Caso no encontrado');
    return { v, practica, documento };
  }

  /** ¿Puede ver los datos personales y el certificado? Con el caso tomado, siendo supervisión o habiéndolo decidido. */
  private puedeVerValores(d: DatosValidacionEps, actor: Actor, ahora: Date): boolean {
    const mia = d.asignadoA === actor.id && d.reservaHasta !== null && d.reservaHasta.getTime() > ahora.getTime();
    return mia || esSupervisorEps(actor.rol) || d.decididoPor === actor.id;
  }

  async detalle(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<DetalleMesaDto> {
    const { v, practica, documento } = await this.cargarCaso(validacionId, actor);
    const d = v.instantanea();
    const p = practica.instantanea();
    const doc = documento.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    const nombre = estudiante?.nombre ?? '(sin nombre)';
    const numero = estudiante?.instantanea().documento ?? null;
    const valores = this.puedeVerValores(d, actor, ahora);
    const responsable = d.asignadoA ? (await this.usuarios.buscarPorId(d.asignadoA))?.nombre ?? null : null;
    const reserva = this.estadoReserva(d, actor.id, ahora, responsable).dto;
    const mia = reserva.estado === 'mia';

    const todas = (await this.documentos.listarPorPractica(d.practicaId)).map((x) => x.instantanea()).filter((x) => x.tipo === TipoDocumento.CERTIFICADO_EPS);
    const maxVersion = Math.max(...todas.map((x) => x.version), doc.version);
    const esVigente = doc.version === maxVersion;
    const evidencias = await this.validaciones.listarEvidencias(d.id);

    const tripleCompleta = this.triple(d, { documento: numero, nombre });
    const diasVigencia = await this.diasVigencia();
    const tipoIncorrecto = doc.banderas.some((b) => b.codigo === 'C2_TIPO_INCORRECTO');
    const contexto: ContextoMesa = { ahora, diasVigencia, tipoIncorrecto };
    const discrepancias = construirDiscrepancias(d, tripleCompleta, contexto);
    const hayCritica = discrepancias.some((x) => x.severidad === 'critica') || tieneDiscrepanciaCriticaPersistida(d);
    const recomendacion = recomendacionActual(d, hayCritica, contexto);
    const tambien = condicionesRecomendacion(d, hayCritica, contexto).filter((c) => c !== recomendacion);
    const abierta = [DecisionEps.PENDIENTE, DecisionEps.CANDIDATO_AUTOAPROBACION].includes(d.decision);
    const prioridad = calcularPrioridad({
      recibidaEn: d.recibidaEn ?? d.creadaEn, fechaInicioPractica: p.fechaInicio, version: doc.version,
      discrepanciaCritica: tieneDiscrepanciaCriticaPersistida(d), adresPendiente: ESTADOS_ADRES_ABIERTOS.includes(d.adres.estado),
    }, ahora);

    const campos = valores ? this.camposCertificado(d) : [];
    const fuentes = new Set(Object.values(d.datosExtraidos?.fuentes ?? {}));
    const metodoExtraccion = fuentes.has('texto_nativo') && fuentes.has('ocr') ? 'mixto' : fuentes.has('ocr') ? 'ocr' : fuentes.has('texto_nativo') ? 'texto_nativo' : 'desconocido';
    const lectura = this.estadoDeLectura(d, doc.banderas.some((b) => b.codigo === 'C0_HASH_DUPLICADO'));
    const clasificacion = { tipo: d.datosExtraidos?.tipoDocumentoDetectado ?? null, motivos: d.datosExtraidos?.motivosClasificacion ?? [] };
    const qrHallados = evidencias.filter((e) => e.instantanea().tipo === TipoEvidenciaEps.QR && e.instantanea().resultado === 'detectado').length;
    const tieneAdres = d.adres.datos !== null;

    const decididoEn = d.decididoEn;
    const recibida = d.recibidaEn ?? d.creadaEn;
    return {
      caso: {
        validacionId: d.id, documentoId: d.documentoId, practicaId: d.practicaId,
        estudiante: { nombre, documento: valores ? numero : null, documentoEnmascarado: enmascarar(numero) },
        programa: p.programaId, modalidad: p.modalidad, periodo: p.periodoAcademico, fechaInicioPractica: p.fechaInicio?.toISOString() ?? null,
        esVersionVigente: esVigente, version: doc.version, totalVersiones: todas.length, decision: d.decision, decididoEn: decididoEn?.toISOString() ?? null,
      },
      acceso: {
        puedeVerValores: valores, esMia: mia, reserva,
        puedeDecidir: abierta && mia && esVigente && puedeDecidirDocumento(actor.rol, TipoDocumento.CERTIFICADO_EPS) && d.estadoProcesamiento === EstadoProcesamientoEps.PROCESADO,
        puedeConsultarAdres: abierta && mia && esVigente && [EstadoAdres.PENDIENTE, EstadoAdres.EN_CONSULTA, EstadoAdres.ERROR, EstadoAdres.NO_DETERMINABLE].includes(d.adres.estado),
        motivoSinAcceso: valores ? null : 'Tome el caso para ver los datos personales y el certificado.',
      },
      certificado: {
        nombreOriginal: doc.nombreOriginal, mime: doc.mimeReal, tamanoBytes: doc.tamanoBytes, version: doc.version, cargadoEn: doc.cargadoEn.toISOString(),
        estadoDocumento: doc.estado, metodoExtraccion, lectura, clasificacion, vigencia: d.vigenciaCertificado, campos,
        vigenciaDetalle: {
          fechaExpedicion: d.datosExtraidos?.fechaExpedicion ?? null,
          diasTranscurridos: diasDesdeExpedicion(d.datosExtraidos?.fechaExpedicion ?? null, ahora),
          diasVigencia,
        },
      },
      autenticidad: {
        estado: d.autenticidad, metodo: d.verificadorCodigo ? 'verificador_oficial' : 'ninguno', verificador: d.verificadorCodigo,
        verificadoEn: d.verificadoEn?.toISOString() ?? null, qrHallados, explicacion: this.explicarAutenticidad(d),
      },
      afiliacion: {
        estado: d.afiliacion, fuente: d.afiliacionFuente ?? 'ninguna', consultadoEn: d.adres.consultadoEn?.toISOString() ?? null,
        fuenteActualizadaEn: d.adres.fuenteActualizadaEn?.toISOString() ?? null, estadoAdres: d.adres.estado,
        frescura: evaluarFrescuraAdres(d.adres.consultadoEn, this.frescuraDias, ahora),
      },
      comparacion: tripleCompleta.map((c) => ({ ...c, certificadoVsSipra: veredictoCertificadoVsSipra(c) ?? undefined }))
        .map((c) => (valores ? c : { ...c, sipra: null, certificado: null, adres: null }))
        .map((c) => ({ ...c, adres: tieneAdres || c.adres === null ? c.adres : null })),
      discrepancias,
      recomendacion: {
        codigo: recomendacion, ...TEXTO_RECOMENDACION[recomendacion], esDecision: false,
        tambien: tambien.map((c) => ({ codigo: c, titulo: TEXTO_RECOMENDACION[c].titulo })),
      },
      adres: {
        estado: d.adres.estado, tipoDocumento: d.adres.tipoDocumento, error: d.adres.error, cargadaEn: d.adres.cargadaEn?.toISOString() ?? null,
        // Lo que se leyó del resultado, campo por campo. El documento y el nombre son datos personales: solo con el caso tomado.
        resultado: tieneAdres ? {
          tipoDocumento: d.adres.datos?.tipoDocumento ?? null,
          numeroDocumento: valores ? (d.adres.datos?.numeroDocumento ?? null) : (d.adres.datos?.numeroDocumento ? enmascarar(d.adres.datos.numeroDocumento) : null),
          nombre: valores ? (d.adres.datos?.nombre ?? null) : null,
          entidad: d.adres.datos?.eps ?? null, regimen: d.adres.datos?.regimen ?? null, estado: d.adres.datos?.estadoAfiliacion ?? null,
          tipoAfiliado: d.adres.datos?.tipoAfiliado ?? null,
          fechaAfiliacion: d.adres.datos?.fechaAfiliacion ?? null, fechaFinalizacion: d.adres.datos?.fechaFinalizacion ?? null,
          afiliacionContinua: d.adres.datos?.afiliacionContinua ?? esFechaDeContinuidadAdres(d.adres.datos?.fechaFinalizacion ?? null),
          fechaConsulta: d.adres.datos?.fechaConsulta ?? null,
        } : null,
      },
      evidencias: evidencias.map((e): EvidenciaMesaDto => {
        const x = e.instantanea();
        return { id: x.id, tipo: x.tipo, fuente: x.fuente, metodo: x.metodo, resultado: x.resultado, fecha: x.fechaVerificacion.toISOString(), error: x.errorCodigo };
      }),
      historial: await this.historial(d, todas, evidencias.map((e) => e.instantanea()), valores),
      versiones: todas.map((x): VersionCertificadoDto => ({
        documentoId: x.id, version: x.version, cargadoEn: x.cargadoEn.toISOString(), estado: x.estado, esVigente: x.version === maxVersion, esEsta: x.id === doc.id,
      })).sort((a, b) => a.version - b.version),
      metricas: {
        recibidaEn: recibida.toISOString(), primeraRevisionEn: d.primeraRevisionEn?.toISOString() ?? null, decididoEn: decididoEn?.toISOString() ?? null,
        horasHastaDecision: decididoEn ? Math.round(((decididoEn.getTime() - recibida.getTime()) / 3_600_000) * 10) / 10 : null,
        reenvios: Math.max(0, todas.length - 1),
      },
      prioridad,
      retencion: AVISO_RETENCION_EPS,
    };
  }

  private camposCertificado(d: DatosValidacionEps): CampoCertificadoDto[] {
    const x = d.datosExtraidos;
    const fuente = (k: string): string | null => x?.fuentes?.[k] ?? null;
    const campo = (clave: string, valor: string | null): CampoCertificadoDto => ({ campo: clave, etiqueta: ETIQUETAS_CAMPO[clave], valor, fuente: valor === null ? null : fuente(clave) });
    return [
      campo('entidad_emisora', x?.eps ?? null),
      campo('nombre_afiliado', x?.nombre ?? null),
      campo('documento_afiliado', x?.numeroDocumento ? `${x.tipoDocumento ? `${x.tipoDocumento} ` : ''}${x.numeroDocumento}` : null),
      campo('fecha_expedicion', x?.fechaExpedicion ?? null),
      campo('estado_afiliacion', x?.estadoReportadoCertificado ?? null),
      campo('regimen', x?.regimen ? `${x.regimen}${x.tipoAfiliado ? ` · ${x.tipoAfiliado}` : ''}` : null),
      campo('tipo_afiliado', x?.tipoAfiliado ?? null),
    ];
  }

  /**
   * ¿Llegó a leerse el certificado? Solo describe lo ya guardado (no lee ni completa nada): un caso «procesado» sin un
   * solo dato extraído no es una lectura válida con campos vacíos, es una ausencia de lectura, y se dice con su causa.
   */
  private estadoDeLectura(d: DatosValidacionEps, archivoDuplicado: boolean): { estado: 'leida' | 'sin_lectura' | 'pendiente' | 'fallida'; motivo: string | null } {
    if (d.estadoProcesamiento === EstadoProcesamientoEps.ERROR) return { estado: 'fallida', motivo: 'El procesamiento del certificado falló. Pida reprocesarlo o revise el archivo.' };
    if (d.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO) return { estado: 'pendiente', motivo: 'El certificado todavía se está procesando.' };
    // Se LEYÓ y es de otro tipo: la lectura fue correcta; lo incorrecto es el tipo documental (eso lo dice la clasificación).
    if (d.datosExtraidos?.tipoDocumentoDetectado === 'documento_incorrecto') return { estado: 'leida', motivo: null };
    const x = d.datosExtraidos;
    const hayDatos = !!x && [x.eps, x.nombre, x.numeroDocumento, x.fechaExpedicion, x.estadoReportadoCertificado, x.regimen, x.tipoAfiliado, x.tipoDocumento].some((v) => v !== null && v !== undefined && v !== '');
    if (hayDatos) return { estado: 'leida', motivo: null };
    return {
      estado: 'sin_lectura',
      motivo: archivoDuplicado
        ? 'Este archivo ya se había presentado en otro expediente: el sistema lo detuvo antes de leerlo. Revise el certificado a ojo o pida un archivo distinto.'
        : 'No se pudo leer ningún dato del certificado (PDF sin texto legible o ilegible). Revíselo a ojo.',
    };
  }

  private explicarAutenticidad(d: DatosValidacionEps): string {
    const coincide = d.coincidencia === CoincidenciaEps.COINCIDE;
    switch (d.autenticidad) {
      case AutenticidadEps.VERIFICADA: return 'Una fuente oficial confirmó el certificado.';
      case AutenticidadEps.INVALIDA: return 'La fuente oficial no confirma el certificado o contradice su contenido.';
      case AutenticidadEps.NO_VERIFICABLE:
        return `No hay una fuente oficial habilitada que pueda confirmar este certificado.${coincide ? ' Los datos coinciden con el estudiante, pero eso no prueba que el documento sea auténtico.' : ''}`;
      default:
        return `Todavía no se ha evaluado la autenticidad del certificado.${coincide ? ' Que los datos coincidan con el estudiante no prueba que sea auténtico.' : ''}`;
    }
  }

  // ── Historial ──────────────────────────────────────────────────────────────

  private async historial(
    d: DatosValidacionEps, documentos: Array<{ id: string }>, evidencias: Array<{ tipo: string; resultado: string; fechaVerificacion: Date }>, valores: boolean,
  ): Promise<EventoHistorialDto[]> {
    const registros: RegistroAuditoria[] = [...await this.auditoria.listar({ entidad: 'validacion_eps', entidadId: d.id, limite: 200 })];
    // Solo los eventos del documento de ESTA versión: con las demás versiones del certificado el historial mezclaba cargas y decisiones
    // (la v2 «aprobada» aparecía en la v1 devuelta y la devolución de la v1 en la v2). Las versiones se listan aparte, cada una con lo suyo.
    for (const doc of documentos.filter((x) => x.id === d.documentoId)) registros.push(...await this.auditoria.listar({ entidad: 'documento', entidadId: doc.id, limite: 100 }));
    const eventos: EventoHistorialDto[] = [];
    for (const r of registros) {
      const titulo = TITULO_EVENTO[r.accion];
      if (!titulo) continue;
      // Un solo registro por decisión: el del documento lleva la justificación.
      const m = r.metadatos ?? {};
      let detalle: string | null = null;
      if (r.accion === AccionAuditada.DECISION_DOCUMENTO) {
        detalle = `${DECISION_TEXTO[textoDecision(m.decision)] ?? textoDecision(m.decision)}${valores && r.justificacion ? ` — ${r.justificacion}` : ''}`;
      } else if (r.accion === AccionAuditada.VALIDACION_EPS_PROCESADA) {
        detalle = `${m.ocr === true ? 'Se usó OCR. ' : ''}${typeof m.qrHallados === 'number' && m.qrHallados > 0 ? `Se detectó ${m.qrHallados} QR (no verifica autenticidad).` : ''}`.trim() || null;
      } else if (r.accion === AccionAuditada.DECISION_EPS_CONTEXTO) {
        detalle = m.apartaDeRecomendacion === true ? 'La decisión se apartó de la recomendación del sistema.' : null;
      } else if ([AccionAuditada.VERIFICACION_EPS_COMPLETADA, AccionAuditada.VERIFICACION_EPS_FALLIDA].includes(r.accion)) {
        detalle = typeof m.resultado === 'string' ? `Resultado: ${m.resultado.replace('_', ' ')}` : null;
      } else if (r.accion === AccionAuditada.EVIDENCIA_ADRES_PROCESADA) {
        detalle = typeof m.estadoAdres === 'string' ? `Estado: ${String(m.estadoAdres).replace('_', ' ')}` : null;
      } else if (r.accion === AccionAuditada.COMPARACION_ADRES_REALIZADA) {
        detalle = typeof m.recomendacion === 'string' ? `Recomendación: ${TEXTO_RECOMENDACION[m.recomendacion as RecomendacionEps]?.titulo ?? m.recomendacion}` : null;
      }
      eventos.push({
        fecha: r.ocurridoEn.toISOString(), tipo: r.accion, titulo,
        actor: r.actorRol === 'sistema' ? 'Sistema' : r.actorRol === Rol.ESTUDIANTE ? 'Estudiante' : r.actorCorreo, detalle,
      });
    }
    for (const e of evidencias) {
      if (e.tipo === 'qr' && e.resultado === 'detectado') {
        eventos.push({ fecha: e.fechaVerificacion.toISOString(), tipo: 'qr_detectado', titulo: 'Se detectó un QR en el certificado', actor: 'Sistema', detalle: 'Un QR encontrado no prueba que el certificado sea auténtico.' });
      }
    }
    // Sin registros técnicos: solo hechos de negocio, del más antiguo al más reciente.
    return eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  // ── Certificado (visor) ────────────────────────────────────────────────────

  /**
   * Contenido del certificado para el visor, por la sesión autenticada (sin enlace
   * firmado ni credencial en la URL). Revalida rol, alcance y que el caso esté tomado
   * por quien lo pide (o sea supervisión).
   */
  async certificado(
    validacionId: string, actor: Actor, ahora: Date = new Date(),
  ): Promise<{ contenido: Buffer; mime: string; nombre: string }> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (!this.puedeVerValores(v.instantanea(), actor, ahora)) throw new ConflictException('Tome el caso antes de abrir el certificado');
    const doc = documento.instantanea();
    const contenido = await this.almacen.leer(doc.rutaAlmacenamiento);
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.DOCUMENTO_VISUALIZADO, entidad: 'documento',
      entidadId: doc.id, justificacion: null, metadatos: { tamanoBytes: contenido.length, origen: 'mesa_eps' }, ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    return { contenido, mime: doc.mimeReal, nombre: doc.nombreOriginal };
  }

  // ── Decisión ───────────────────────────────────────────────────────────────

  async decidir(validacionId: string, actor: Actor, dto: DecisionMesaDto, ahora: Date = new Date()): Promise<DocumentoRespuestaDto> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    const d = v.instantanea();
    if (![DecisionEps.PENDIENTE, DecisionEps.CANDIDATO_AUTOAPROBACION].includes(d.decision)) throw new ConflictException('El caso ya fue decidido');
    const todas = (await this.documentos.listarPorPractica(d.practicaId)).map((x) => x.instantanea()).filter((x) => x.tipo === TipoDocumento.CERTIFICADO_EPS);
    if (documento.instantanea().version < Math.max(...todas.map((x) => x.version))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del certificado: revise esa versión');
    }
    // La reserva se vuelve a validar aquí, en el servidor, aunque la pantalla creyera tenerla.
    if (d.asignadoA === null || d.reservaHasta === null || d.reservaHasta.getTime() <= ahora.getTime()) {
      throw new ConflictException('Su reserva del caso venció: tómelo de nuevo antes de decidir');
    }
    if (d.asignadoA !== actor.id) throw new ConflictException('El caso está reservado por otro funcionario');
    if (d.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO) throw new ConflictException('El certificado aún se está procesando');

    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    const triple = this.triple(d, { documento: estudiante?.instantanea().documento ?? null, nombre: estudiante?.nombre ?? '' });
    const hayCritica = construirDiscrepancias(d, triple).some((x: DiscrepanciaLegible) => x.severidad === 'critica') || tieneDiscrepanciaCriticaPersistida(d);
    const recomendacion = recomendacionActual(d, hayCritica);
    const { apartaDeRecomendacion, minimoJustificacion, motivo: motivoApartamiento } = evaluarApartamiento(dto.decision, recomendacion);

    let justificacion = (dto.justificacion ?? '').trim();
    if (dto.decision === 'devolver') {
      if (!dto.motivo) throw new BadRequestException('Elija el motivo de la devolución');
      if (dto.motivo === MotivoDevolucionEps.OTRO && justificacion.length < JUSTIFICACION_MINIMA) {
        throw new BadRequestException('Explique al estudiante qué debe corregir (al menos 10 caracteres)');
      }
      justificacion = mensajeDevolucion(dto.motivo, justificacion || null);
    } else if (dto.decision === 'rechazar') {
      if (justificacion.length < minimoJustificacion) {
        throw new BadRequestException(apartaDeRecomendacion
          ? `Esta decisión se aparta de la recomendación del sistema: la justificación debe tener al menos ${minimoJustificacion} caracteres`
          : 'El rechazo exige una justificación (al menos 10 caracteres). Si el problema se puede corregir, devuélvalo al estudiante.');
      }
    } else if (apartaDeRecomendacion) {
      if (justificacion.length < minimoJustificacion) {
        throw new BadRequestException(`${motivoApartamiento}: la justificación debe tener al menos ${minimoJustificacion} caracteres`);
      }
    } else if (justificacion.length < JUSTIFICACION_MINIMA) {
      justificacion = 'Certificado de EPS revisado y aprobado en la Mesa de EPS.';
    }

    const respuesta = await this.gestionar.decidir(d.documentoId, { decision: dto.decision, justificacion }, actor);
    await this.auditar(AccionAuditada.DECISION_EPS_CONTEXTO, d.id, {
      decision: dto.decision, recomendacion, apartaDeRecomendacion, motivoDevolucion: dto.motivo ?? null,
    }, actor, ahora);
    this.metricas?.epsDecisiones.inc({ decision: dto.decision, aparta_de_recomendacion: String(apartaDeRecomendacion) });
    const recibida = d.recibidaEn ?? null;
    if (recibida) this.metricas?.epsTiempoRevision.observe(Math.max(0, (ahora.getTime() - recibida.getTime()) / 3_600_000));
    return respuesta;
  }

  // ── Supervisión ────────────────────────────────────────────────────────────

  async supervision(actor: Actor, ahora: Date = new Date()): Promise<SupervisionMesaDto> {
    if (!esSupervisorEps(actor.rol)) throw new ForbiddenException('Solo coordinación y administración supervisan la Mesa de EPS');
    this.exigirActiva();
    const r = await this.validaciones.supervisionMesa(ahora, this.alcance(actor));
    const redondear = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);
    return {
      abiertas: r.abiertas, sinAsignar: r.sinAsignar, horasMediasHastaPrimeraRevision: redondear(r.horasMediasHastaPrimeraRevision),
      funcionarios: r.funcionarios.map((f) => ({
        funcionarioId: f.funcionarioId, nombre: f.nombre, rol: f.rol, reservasVigentes: f.reservasVigentes, reservasPorVencer: f.reservasPorVencer,
        decididas7Dias: f.decididas7Dias, horasMediasHastaDecision: redondear(f.horasMediasHastaDecision),
      })),
    };
  }

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor: Actor, ahora: Date): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'validacion_eps', entidadId, justificacion: null,
      metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
  }
}
