import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { DatosValidacionActa } from '../../../domain/entities/validacion-acta.entity';
import { DatosValidacionDocumentoEmpresarial } from '../../../domain/entities/validacion-documento-empresarial.entity';
import { DatosValidacionEps, DecisionEps } from '../../../domain/entities/validacion-eps.entity';
import { EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { ModalidadPractica, definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { criteriosDe } from '../../../domain/entities/criterios-documentales';
import { AUDITORIA_REPOSITORY, AuditoriaRepositoryPort } from '../../../domain/ports/out/repositorios.port';
import {
  DocumentoDeLectura, EXPEDIENTE_DOCUMENTAL_LECTURA, ExpedienteDocumentalLecturaPort, FiltroExpedientes, LecturaExpedientes, PracticaDeExpediente,
} from '../../../domain/ports/out/expediente-documental.port';
import { MINUTOS_RESERVA_POR_VENCER } from '../../../domain/ports/out/validacion-acta.port';
import { AvanceDocumentalDomainService } from '../../../domain/services/avance-documental.domain-service';
import {
  DocumentoDeExpediente, ETIQUETA_ESTADO_HUMANO, FaseDocumento, MotorDocumental, PrioridadExpediente, RESERVA_LIBRE, ReservaDocumento, SENAL_NORMAL,
  SenalDocumento, compararExpedientes, estadoHumanoDe, motorDe, prioridadExpediente, progresoExpediente, reservaDe, reservaVigente, siguienteDocumento,
} from '../../../domain/services/expediente-documental.domain-service';
import {
  faseActa, faseEmpresarial, faseEps, faseGeneral, senalActa, senalCamara, senalEps, senalRut,
} from '../../../domain/services/senales-motores-documentales.domain-service';
import { puedeDecidirDocumento } from '../../../domain/value-objects/acceso-eps.vo';
import { puedeVerDocumento } from '../../../domain/value-objects/acceso-documental.vo';
import {
  esSupervisorValidacionDocumental, puedeOperarMotor, puedeUsarValidacionDocumental,
} from '../../../domain/value-objects/acceso-validacion-documental.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  EncabezadoExpedienteDto, ExpedienteDto, ItemExpedienteDto, ListadoExpedientesDto, ResumenDocumentoDto, SupervisionDocumentalDto, VersionDocumentoDto,
} from '../../dtos/expediente-documental.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

const TOPE_EXPEDIENTES = 300;
const TOPE_SUPERVISION = 1000;
/** Día calendario de Colombia (UTC-5) para «aprobados hoy». */
const diaColombia = (d: Date): string => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

/** Solo los últimos 4 caracteres (nunca la forma en que se escribió el documento). */
function enmascarar(documento: string | null): string {
  const limpio = (documento ?? '').replace(/[^A-Za-z0-9]/g, '');
  return limpio.length > 4 ? `••••${limpio.slice(-4)}` : '••••';
}

function nombreHumanoDe(tipo: TipoDocumento): string {
  if (tipo.startsWith('entregable_mentoria_')) return `Entregable de mentoría ${tipo.slice('entregable_mentoria_'.length)}`;
  return criteriosDe(tipo)?.nombre ?? tipo.replace(/_/g, ' ');
}

/** Expediente armado en memoria: lo que la cola, el detalle y la supervisión necesitan, calculado UNA vez. */
interface ExpedienteArmado {
  practica: PracticaDeExpediente;
  documentos: DocumentoDeExpediente[];
  progreso: ReturnType<typeof progresoExpediente>;
  prioridad: PrioridadExpediente;
  esperandoDesde: string | null;
}

/**
 * Mesa de Validación Documental: orquestación por ESTUDIANTE + PRÁCTICA. CONSULTA los motores especializados (EPS, Actas, RUT y
 * Cámara) y el flujo general, NORMALIZA su presentación y ORDENA. No valida, no compara, no reserva y no decide: tomar y decidir
 * siguen siendo del motor de cada documento (con su reserva por documento, su transacción y su auditoría). Cada acción exige el
 * rol que ya exige ese motor; el agregador no eleva privilegios.
 */
@Injectable()
export class ExpedienteDocumentalUseCase {
  private readonly avance = new AvanceDocumentalDomainService();

  constructor(
    @Inject(EXPEDIENTE_DOCUMENTAL_LECTURA) private readonly lectura: ExpedienteDocumentalLecturaPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  // ── Autorización y alcance ───────────────────────────────────────────────

  private exigirUso(actor: Actor): void {
    if (!puedeUsarValidacionDocumental(actor.rol)) throw new ForbiddenException('Su perfil no usa la Mesa de Validación Documental');
  }

  /**
   * Prácticas que la persona alcanza: el docente, las suyas y las de sus escuelas; coordinación con escuelas asignadas, las suyas;
   * coordinación del Área, administración y auxiliar, todas (igual que `Practica.visiblePara`).
   */
  private alcance(actor: Actor): FiltroExpedientes['alcance'] {
    if (actor.rol === Rol.TUTOR) return { escuelas: [...actor.escuelas], tutorId: actor.id };
    if (actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0) return { escuelas: [...actor.escuelas], tutorId: null };
    return null;
  }

  // ── Armado de un expediente ──────────────────────────────────────────────

  private fase(motor: MotorDocumental, doc: DocumentoDeLectura, lectura: LecturaExpedientes): { fase: FaseDocumento; senal: SenalDocumento; interno: string; validacionId: string | null; asignadoA: string | null; reservaHasta: Date | null } {
    let fase: FaseDocumento;
    let senalF: () => SenalDocumento = () => SENAL_NORMAL;
    let interno: string = doc.estado;
    let validacionId: string | null = null;
    let asignadoA: string | null = null;
    let reservaHasta: Date | null = null;
    if (motor === 'eps') {
      const v: DatosValidacionEps | null = lectura.eps.get(doc.id)?.instantanea() ?? null;
      fase = faseEps(doc.estado, v);
      if (v) { interno = v.decision === DecisionEps.PENDIENTE || v.decision === DecisionEps.CANDIDATO_AUTOAPROBACION ? v.estadoProcesamiento : v.decision; validacionId = v.id; asignadoA = v.asignadoA; reservaHasta = v.reservaHasta; senalF = () => senalEps(v); }
    } else if (motor === 'acta') {
      const v: DatosValidacionActa | null = lectura.actas.get(doc.id)?.instantanea() ?? null;
      fase = faseActa(doc.estado, v);
      if (v) { interno = v.estado; validacionId = v.id; asignadoA = v.asignadoA; reservaHasta = v.reservaHasta; senalF = () => senalActa(v); }
    } else if (motor === 'rut' || motor === 'camara') {
      const v: DatosValidacionDocumentoEmpresarial | null = lectura.empresariales.get(doc.id)?.instantanea() ?? null;
      fase = faseEmpresarial(doc.estado, v);
      if (v) { interno = v.estado; validacionId = v.id; asignadoA = v.asignadoA; reservaHasta = v.reservaHasta; senalF = () => (motor === 'rut' ? senalRut(v) : senalCamara(v)); }
    } else {
      fase = faseGeneral(doc.estado);
    }
    // La señal del motor solo importa mientras una persona tiene algo que revisar; la reserva, también.
    const listo = fase === 'listo_para_revisar';
    return { fase, senal: listo ? senalF() : SENAL_NORMAL, interno, validacionId, asignadoA: listo ? asignadoA : null, reservaHasta: listo ? reservaHasta : null };
  }

  private operable(rol: Rol, motor: MotorDocumental, tipo: TipoDocumento): boolean {
    return motor === 'general' ? puedeDecidirDocumento(rol, tipo) : puedeOperarMotor(motor, rol);
  }

  private documento(
    p: PracticaDeExpediente, tipo: TipoDocumento, obligatorio: boolean, versiones: DocumentoDeLectura[], lectura: LecturaExpedientes, actor: Actor, ahora: Date,
  ): DocumentoDeExpediente {
    const motor = motorDe(tipo);
    const vigente = versiones[0] ?? null;
    const base = { practicaId: p.id, estudianteId: p.estudianteId, tipoDocumento: tipo, nombreHumano: nombreHumanoDe(tipo), motor, obligatorio, operable: this.operable(actor.rol, motor, tipo) };
    if (!vigente) {
      return {
        ...base, documentoId: null, version: null, estadoInterno: null, estadoHumano: 'pendiente_de_cargar', estadoHumanoEtiqueta: ETIQUETA_ESTADO_HUMANO.pendiente_de_cargar,
        fechaCarga: null, problemaPrincipal: null, requiereRevision: false, criticidad: 'normal', informacionInsuficiente: false, esReenvio: false, versionesAnteriores: 0,
        reserva: RESERVA_LIBRE, validacionId: null, puedeTomar: false, puedeDecidir: false,
      };
    }
    const f = this.fase(motor, vigente, lectura);
    const reserva: ReservaDocumento = reservaDe(f.asignadoA, f.reservaHasta, f.asignadoA ? lectura.nombres.get(f.asignadoA) ?? null : null, actor.id, ahora);
    const estadoHumano = estadoHumanoDe(f.fase, reservaVigente(reserva));
    const requiereRevision = estadoHumano === 'disponible_para_revision' || estadoHumano === 'en_revision';
    const esGeneral = motor === 'general';
    // Tomar y decidir dependen del motor: aquí solo se informa si la persona PUEDE (rol del motor + estado + reserva); no se hace.
    const puedeTomar = !esGeneral && base.operable && f.fase === 'listo_para_revisar' && f.validacionId !== null && (reserva.estado === 'libre' || reserva.estado === 'vencida');
    const puedeDecidir = base.operable && f.fase === 'listo_para_revisar'
      && (esGeneral ? vigente.estado === EstadoDocumento.EN_REVISION : reserva.estado === 'mia');
    return {
      ...base, documentoId: vigente.id, version: vigente.version, estadoInterno: f.interno, estadoHumano, estadoHumanoEtiqueta: ETIQUETA_ESTADO_HUMANO[estadoHumano],
      fechaCarga: vigente.cargadoEn.toISOString(), problemaPrincipal: requiereRevision ? f.senal.problemaPrincipal : null, requiereRevision,
      criticidad: requiereRevision ? f.senal.criticidad : 'normal', informacionInsuficiente: requiereRevision && f.senal.informacionInsuficiente,
      esReenvio: vigente.version > 1 && f.fase === 'listo_para_revisar', versionesAnteriores: versiones.length - 1, reserva, validacionId: f.validacionId,
      puedeTomar, puedeDecidir,
    };
  }

  /** Las obligaciones salen de la matriz de la modalidad (el servicio de avance existente), más lo cargado que no sea obligación. */
  private armar(p: PracticaDeExpediente, porTipo: Map<TipoDocumento, DocumentoDeLectura[]>, lectura: LecturaExpedientes, actor: Actor, ahora: Date): ExpedienteArmado {
    const todos = [...porTipo.values()].flat();
    const avance = this.avance.calcular(p.modalidad as ModalidadPractica, todos.map((d) => ({ tipo: d.tipo, version: d.version, estado: d.estado })));
    const obligaciones: TipoDocumento[] = [];
    for (const m of avance.momentos) for (const d of m.documentos) if (!obligaciones.includes(d.tipo)) obligaciones.push(d.tipo);
    const adicionales = [...porTipo.keys()].filter((t) => !obligaciones.includes(t));
    const documentos = [
      ...obligaciones.map((t) => this.documento(p, t, true, porTipo.get(t) ?? [], lectura, actor, ahora)),
      ...adicionales.map((t) => this.documento(p, t, false, porTipo.get(t) ?? [], lectura, actor, ahora)),
    ].filter((d) => puedeVerDocumento(actor.rol, d.tipoDocumento));
    const porRevisar = documentos.filter((d) => d.requiereRevision && d.fechaCarga);
    const esperandoDesde = porRevisar.map((d) => d.fechaCarga as string).sort()[0] ?? null;
    return { practica: p, documentos, progreso: progresoExpediente(documentos), prioridad: prioridadExpediente(documentos, ahora), esperandoDesde };
  }

  private armarTodos(lectura: LecturaExpedientes, actor: Actor, ahora: Date): ExpedienteArmado[] {
    const porPractica = new Map<string, Map<TipoDocumento, DocumentoDeLectura[]>>();
    for (const d of lectura.documentos) {
      const m = porPractica.get(d.practicaId) ?? new Map<TipoDocumento, DocumentoDeLectura[]>();
      m.set(d.tipo, [...(m.get(d.tipo) ?? []), d]);
      porPractica.set(d.practicaId, m);
    }
    // Versiones de cada tipo de la más reciente a la más antigua: solo la primera es operable; las demás, historia.
    for (const m of porPractica.values()) for (const [t, l] of m) m.set(t, [...l].sort((a, b) => b.version - a.version));
    return lectura.practicas.map((p) => this.armar(p, porPractica.get(p.id) ?? new Map<TipoDocumento, DocumentoDeLectura[]>(), lectura, actor, ahora));
  }

  private encabezado(p: PracticaDeExpediente): EncabezadoExpedienteDto {
    let etiqueta = p.modalidad;
    try { etiqueta = definicionModalidad(p.modalidad as ModalidadPractica).etiquetaSgp; } catch { /* modalidad histórica: se muestra su código */ }
    return {
      practicaId: p.id, estudiante: { id: p.estudianteId, nombre: p.estudianteNombre, documentoEnmascarado: enmascarar(p.estudianteDocumento) },
      modalidad: p.modalidad, modalidadEtiqueta: etiqueta, periodo: p.periodoAcademico, escuelaId: p.escuelaId, docente: p.tutorNombre, empresa: p.empresaRazonSocial,
      estadoPractica: p.estado, fechaInicio: p.fechaInicio ? p.fechaInicio.toISOString() : null,
    };
  }

  // ── Cola por expediente ──────────────────────────────────────────────────

  private aItem(e: ExpedienteArmado, actor: Actor, ahora: Date): ItemExpedienteDto {
    const docs = e.documentos;
    const porRevisar = docs.filter((d) => d.requiereRevision);
    const mias = docs.filter((d) => d.reserva.estado === 'mia');
    const ajenos = docs.filter((d) => d.reserva.estado === 'mia' || d.reserva.estado === 'otro');
    const trabajando = new Map<string, { nombre: string; documentos: number; esUsted: boolean }>();
    for (const d of ajenos) {
      const nombre = d.reserva.estado === 'mia' ? 'Usted' : d.reserva.por ?? 'Otra persona';
      const previo = trabajando.get(nombre) ?? { nombre, documentos: 0, esUsted: d.reserva.estado === 'mia' };
      previo.documentos += 1;
      trabajando.set(nombre, previo);
    }
    const resumen = docs.map((d): ResumenDocumentoDto => ({
      tipoDocumento: d.tipoDocumento, nombreHumano: d.nombreHumano, motor: d.motor, estadoHumano: d.estadoHumano, estadoHumanoEtiqueta: d.estadoHumanoEtiqueta,
      reserva: { estado: d.reserva.estado, por: d.reserva.por, minutosRestantes: d.reserva.minutosRestantes }, obligatorio: d.obligatorio,
    }));
    const dias = e.esperandoDesde ? Math.max(0, Math.floor((ahora.getTime() - new Date(e.esperandoDesde).getTime()) / 86_400_000)) : 0;
    const criticos = porRevisar.filter((d) => d.criticidad === 'critico').length;
    return {
      ...this.encabezado(e.practica), progreso: e.progreso,
      indicadores: {
        criticos, informacionInsuficiente: porRevisar.filter((d) => d.informacionInsuficiente).length, reenvios: porRevisar.filter((d) => d.esReenvio).length,
        conDiscrepancias: criticos, misDocumentos: mias.length,
        reservasPorVencer: mias.filter((d) => (d.reserva.minutosRestantes ?? Infinity) <= MINUTOS_RESERVA_POR_VENCER).length,
      },
      documentos: resumen, funcionariosTrabajando: [...trabajando.values()], prioridad: e.prioridad, esperandoDesde: e.esperandoDesde, diasEsperando: dias,
    };
  }

  private pasaFiltros(i: ItemExpedienteDto, q: Record<string, string | undefined>): boolean {
    const p = i.progreso;
    const v = q.vista ?? 'todos';
    if (v === 'pendientes' && p.requierenRevision === 0) return false;
    if (v === 'problemas' && i.indicadores.criticos + i.indicadores.informacionInsuficiente === 0) return false;
    if (v === 'mis_documentos' && i.indicadores.misDocumentos === 0) return false;
    if (v === 'por_vencer' && i.indicadores.reservasPorVencer === 0) return false;
    if (q.estado === 'abiertos' && p.completo) return false;
    if (q.estado === 'completos' && !p.completo) return false;
    if (q.conPendientes === 'si' && p.requierenRevision === 0) return false;
    if (q.conDiscrepancias === 'si' && i.indicadores.conDiscrepancias === 0) return false;
    if (q.conDevueltos === 'si' && p.necesitanCorreccion === 0) return false;
    if (q.ocr === 'si' && i.indicadores.informacionInsuficiente === 0) return false;
    if (q.reserva === 'mias' && i.indicadores.misDocumentos === 0) return false;
    if (q.reserva === 'libres' && !i.documentos.some((d) => d.estadoHumano === 'disponible_para_revision')) return false;
    if (q.antiguedadMinDias && i.diasEsperando < Number(q.antiguedadMinDias)) return false;
    return true;
  }

  async listar(actor: Actor, q: Record<string, string | undefined> = {}, ahora: Date = new Date()): Promise<ListadoExpedientesDto> {
    this.exigirUso(actor);
    const lectura = await this.lectura.cargar({
      alcance: this.alcance(actor), escuela: q.escuela, modalidad: q.modalidad, buscar: q.buscar, incluirSinDocumentos: q.sinDocumentos === 'si', limite: TOPE_EXPEDIENTES + 1,
    });
    const truncado = lectura.practicas.length > TOPE_EXPEDIENTES;
    if (truncado) lectura.practicas = lectura.practicas.slice(0, TOPE_EXPEDIENTES);
    const todos = this.armarTodos(lectura, actor, ahora).map((e) => ({ e, i: this.aItem(e, actor, ahora) }));
    const filtrados = todos.filter(({ i }) => this.pasaFiltros(i, q));
    filtrados.sort((a, b) => compararExpedientes(a.i, b.i));
    const items = filtrados.map((x) => x.i);
    return {
      kpis: {
        expedientes: todos.length,
        conPendientes: todos.filter(({ i }) => i.progreso.requierenRevision > 0).length,
        conProblemas: todos.filter(({ i }) => i.indicadores.criticos + i.indicadores.informacionInsuficiente > 0).length,
        misDocumentos: todos.reduce((n, { i }) => n + i.indicadores.misDocumentos, 0),
        reservasPorVencer: todos.reduce((n, { i }) => n + i.indicadores.reservasPorVencer, 0),
        documentosPorRevisar: todos.reduce((n, { i }) => n + i.progreso.requierenRevision, 0),
      },
      total: items.length, truncado, items,
    };
  }

  // ── Expediente abierto ───────────────────────────────────────────────────

  /** Metadatos de TODOS los documentos de la práctica; el PDF, el resultado del motor, la evidencia y el historial se piden aparte. */
  async expediente(practicaId: string, actor: Actor, ahora: Date = new Date()): Promise<ExpedienteDto> {
    this.exigirUso(actor);
    const lectura = await this.lectura.cargar({ alcance: this.alcance(actor), practicaId, limite: 1 });
    const [armado] = this.armarTodos(lectura, actor, ahora);
    // Una práctica fuera del alcance «no existe» para esta persona.
    if (!armado) throw new NotFoundException('Expediente no encontrado');
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.EXPEDIENTE_CONSULTADO, entidad: 'practica', entidadId: practicaId,
      justificacion: null, metadatos: { origen: 'mesa_documental' }, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    const siguiente = siguienteDocumento(armado.documentos, null, 'pendiente');
    return {
      encabezado: this.encabezado(armado.practica), progreso: armado.progreso, documentos: armado.documentos,
      ordenNavegacion: armado.documentos.map((d) => d.tipoDocumento), siguientePendiente: siguiente?.tipoDocumento ?? null, prioridad: armado.prioridad,
    };
  }

  /** Versiones anteriores de un documento, bajo demanda. La vigente es la única operable; el resto es historia. */
  async versiones(practicaId: string, tipo: TipoDocumento, actor: Actor): Promise<VersionDocumentoDto[]> {
    this.exigirUso(actor);
    if (!puedeVerDocumento(actor.rol, tipo)) throw new NotFoundException('Documento no encontrado');
    const lectura = await this.lectura.cargar({ alcance: this.alcance(actor), practicaId, limite: 1 });
    if (lectura.practicas.length === 0) throw new NotFoundException('Expediente no encontrado');
    const motor = motorDe(tipo);
    const docs = lectura.documentos.filter((d) => d.tipo === tipo).sort((a, b) => b.version - a.version);
    return docs.map((d, i) => {
      const f = this.fase(motor, d, lectura);
      const estadoHumano = estadoHumanoDe(f.fase, false);
      return {
        documentoId: d.id, version: d.version, vigente: i === 0, estadoHumano, estadoHumanoEtiqueta: ETIQUETA_ESTADO_HUMANO[estadoHumano], estadoInterno: f.interno,
        cargadaEn: d.cargadoEn.toISOString(), motivoDevolucion: d.motivoDevolucion,
      };
    });
  }

  // ── Supervisión ──────────────────────────────────────────────────────────

  async supervision(actor: Actor, ahora: Date = new Date()): Promise<SupervisionDocumentalDto> {
    if (!esSupervisorValidacionDocumental(actor.rol)) throw new ForbiddenException('Solo coordinación y administración supervisan la Mesa de Validación Documental');
    const lectura = await this.lectura.cargar({ alcance: this.alcance(actor), incluirSinDocumentos: false, limite: TOPE_SUPERVISION });
    const expedientes = this.armarTodos(lectura, actor, ahora);
    const hoy = diaColombia(ahora);
    const porMotor: SupervisionDocumentalDto['porMotor'] = {};
    const carga = new Map<string, SupervisionDocumentalDto['funcionarios'][number]>();
    const conVencida = new Map<string, { practicaId: string; estudiante: string; documentos: number }>();
    const r = { documentosPorRevisar: 0, sinCargar: 0, aprobadosHoy: 0, devueltos: 0, rechazados: 0, insuficiente: 0, discrepancias: 0, activas: 0, porVencer: 0, vencidas: 0 };
    const fechaDecision = new Map<string, Date>();
    for (const [id, v] of lectura.actas) fechaDecision.set(id, v.instantanea().decididoEn ?? new Date(0));
    for (const [id, v] of lectura.empresariales) fechaDecision.set(id, v.instantanea().decididoEn ?? new Date(0));
    for (const [id, v] of lectura.eps) fechaDecision.set(id, v.instantanea().decididoEn ?? new Date(0));
    const docPorId = new Map(lectura.documentos.map((x) => [x.id, x]));
    const decididoHoy = (d: DocumentoDeExpediente): boolean => {
      if (!d.documentoId) return false;
      const cuando = fechaDecision.get(d.documentoId) ?? docPorId.get(d.documentoId)?.actualizadoEn ?? null;
      return cuando !== null && diaColombia(cuando) === hoy;
    };
    let abiertos = 0;
    for (const e of expedientes) {
      if (!e.progreso.completo) abiertos += 1;
      for (const d of e.documentos) {
        const m = (porMotor[d.motor] ??= { porRevisar: 0, aprobados: 0, devueltos: 0, rechazados: 0 });
        if (d.requiereRevision) { r.documentosPorRevisar += 1; m.porRevisar += 1; }
        if (d.estadoHumano === 'pendiente_de_cargar' && d.obligatorio) r.sinCargar += 1;
        if (d.estadoHumano === 'aprobado') { m.aprobados += 1; if (decididoHoy(d)) r.aprobadosHoy += 1; }
        if (d.estadoHumano === 'necesita_correccion') { r.devueltos += 1; m.devueltos += 1; }
        if (d.estadoHumano === 'rechazado') { r.rechazados += 1; m.rechazados += 1; }
        if (d.informacionInsuficiente) r.insuficiente += 1;
        if (d.requiereRevision && d.criticidad === 'critico') r.discrepancias += 1;
        const res = d.reserva;
        if ((res.estado === 'mia' || res.estado === 'otro' || res.estado === 'vencida') && res.hasta) {
          const vencida = res.estado === 'vencida';
          if (vencida) {
            r.vencidas += 1;
            const c = conVencida.get(e.practica.id) ?? { practicaId: e.practica.id, estudiante: e.practica.estudianteNombre, documentos: 0 };
            c.documentos += 1; conVencida.set(e.practica.id, c);
          } else {
            r.activas += 1;
            if ((res.minutosRestantes ?? Infinity) <= MINUTOS_RESERVA_POR_VENCER) r.porVencer += 1;
          }
          // Quién tiene qué (la reserva es por documento): se agrupa por la persona del motor, con enlace al expediente.
          const por = res.por ?? 'Otra persona';
          const clave = res.estado === 'mia' ? actor.id : por;
          const f = carga.get(clave) ?? { funcionarioId: clave, nombre: res.estado === 'mia' ? 'Usted' : por, reservasVigentes: 0, reservasPorVencer: 0, documentos: [] };
          if (!vencida) { f.reservasVigentes += 1; if ((res.minutosRestantes ?? Infinity) <= MINUTOS_RESERVA_POR_VENCER) f.reservasPorVencer += 1; }
          f.documentos.push({ practicaId: e.practica.id, estudiante: e.practica.estudianteNombre, tipoDocumento: d.tipoDocumento, nombreHumano: d.nombreHumano, motor: d.motor, hasta: res.hasta, vencida });
          carga.set(clave, f);
        }
      }
    }
    return {
      expedientesAbiertos: abiertos, documentosPorRevisar: r.documentosPorRevisar, documentosSinCargar: r.sinCargar, aprobadosHoy: r.aprobadosHoy, devueltos: r.devueltos,
      rechazados: r.rechazados, informacionInsuficiente: r.insuficiente, discrepancias: r.discrepancias, reservasActivas: r.activas, reservasPorVencer: r.porVencer,
      reservasVencidas: r.vencidas, porMotor, funcionarios: [...carga.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      conReservaVencida: [...conVencida.values()],
    };
  }
}
