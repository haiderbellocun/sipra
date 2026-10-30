import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { Documento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { Practica, responsableArlSugerido } from '../../../domain/entities/practica.entity';
import {
  DatosValidacionActa, EstadoValidacionActa, ESTADOS_DECIDIDOS_ACTA, TipoEvidenciaActa, ValidacionActa,
} from '../../../domain/entities/validacion-acta.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, EMPRESA_REPOSITORY,
  EmpresaRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort, SINU, SinuPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  FilaMesaActa, VALIDACION_ACTA_REPOSITORY, ValidacionActaRepositoryPort,
} from '../../../domain/ports/out/validacion-acta.port';
import { JUSTIFICACION_MINIMA } from '../../../domain/services/justificacion-decision';
import {
  DURACION_RESERVA_ACTA_MS, MotivoDevolucionActa, calcularPrioridadActa, evaluarApartamientoActa,
  mensajeDevolucionActa, recomendacionActa,
} from '../../../domain/services/mesa-acta.domain-service';
import { datosSipraDePractica, recalcularComparacion } from '../../../domain/services/validacion-acta.domain-service';
import { esSupervisorMesaActas, puedeOperarMesaActas } from '../../../domain/value-objects/acceso-acta.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  CampoComparadoDto, DecisionActaDto, DetalleActaDto, ItemBandejaActaDto, ListadoBandejaActaDto, PrioridadActaDto, ReservaActaDto,
  ResultadoTomarSiguienteActaDto, SupervisionActaDto, TomarSiguienteActaDto,
} from '../../dtos/acta-iniciacion.dto';
import { DocumentoRespuestaDto } from '../../dtos/documento.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { GestionarDocumentoUseCase } from './gestionar-documento.use-case';

const TEXTO_REMUNERACION: Record<string, string> = { remunerada: 'Remunerada', no_remunerada: 'No remunerada', no_determinable: 'No determinable' };
const TEXTO_ARL: Record<string, string> = { empresa: 'Empresa', cun: 'CUN', no_determinable: 'No determinable' };
const ETIQUETA_EVENTO: Record<TipoEvidenciaActa, string> = {
  [TipoEvidenciaActa.LECTURA_DOCUMENTO]: 'Lectura del documento',
  [TipoEvidenciaActa.CLASIFICACION_DOCUMENTAL]: 'Clasificación del documento',
  [TipoEvidenciaActa.COMPARACION]: 'Comparación con la práctica',
  [TipoEvidenciaActa.MEDICION_FIRMAS]: 'Revisión de las zonas de firma',
  [TipoEvidenciaActa.PROCESAMIENTO]: 'Procesamiento',
  [TipoEvidenciaActa.DECISION_HUMANA]: 'Decisión de una persona',
  [TipoEvidenciaActa.CAMBIO_DATOS_PRACTICA]: 'Cambio de datos de la práctica',
};
const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;

/** Solo los últimos 4 caracteres alfanuméricos: «C.C. 1.000.000.001» y «1000000001» se ven igual (nunca la forma en que se escribió). */
function enmascarar(documento: string | null): string {
  const limpio = (documento ?? '').replace(/[^A-Za-z0-9]/g, '');
  return limpio.length > 4 ? `••••${limpio.slice(-4)}` : '••••';
}

/**
 * Mesa de Actas de Iniciación: bandeja, detalle, reserva, decisión, supervisión y visor del archivo.
 *
 * Independiente de la Mesa de EPS: lee las validaciones del acta, las ordena con una prioridad explicable y delega la
 * decisión en la decisión general de documentos (compare-and-set sobre el documento: una sola decisión aplica).
 * La recomendación del sistema es una RECOMENDACIÓN; decide siempre una persona, con el caso reservado por ella.
 * Operan auxiliar, coordinación y administración; el docente, el estudiante, la empresa y la extensión no.
 */
@Injectable()
export class MesaActasUseCase {
  constructor(
    @Inject(VALIDACION_ACTA_REPOSITORY) private readonly validaciones: ValidacionActaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly gestionar: GestionarDocumentoUseCase,
    @Inject(SINU) private readonly sinu?: SinuPort,
  ) {}

  // ── Autorización y alcance ───────────────────────────────────────────────

  private exigirOperador(actor: Actor): void {
    if (!puedeOperarMesaActas(actor.rol)) throw new ForbiddenException('Su perfil no opera la Mesa de Actas de Iniciación');
  }

  private alcance(actor: Actor): string[] | null {
    return actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0 ? [...actor.escuelas] : null;
  }

  /** Datos personales completos: solo a quien tiene el caso tomado (reserva vigente), a supervisión o a quien lo decidió. */
  private puedeVerValores(d: DatosValidacionActa, actor: Actor, ahora: Date): boolean {
    const mia = d.asignadoA === actor.id && d.reservaHasta !== null && d.reservaHasta.getTime() > ahora.getTime();
    return mia || esSupervisorMesaActas(actor.rol) || d.decididoPor === actor.id;
  }

  private async cargarCaso(validacionId: string, actor: Actor): Promise<{ v: ValidacionActa; practica: Practica; documento: Documento }> {
    this.exigirOperador(actor);
    const v = await this.validaciones.buscarPorId(validacionId);
    if (!v) throw new NotFoundException('Caso no encontrado');
    const d = v.instantanea();
    const practica = await this.practicas.buscarPorId(d.practicaId);
    if (!practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      throw new NotFoundException('Caso no encontrado');
    }
    const documento = await this.documentos.buscarPorId(d.documentoId);
    if (!documento || documento.tipo !== TipoDocumento.ACTA_INICIO) throw new NotFoundException('Caso no encontrado');
    return { v, practica, documento };
  }

  private async versionVigente(practicaId: string): Promise<number> {
    const actas = (await this.documentos.listarPorPractica(practicaId)).filter((x) => x.tipo === TipoDocumento.ACTA_INICIO);
    return Math.max(0, ...actas.map((x) => x.instantanea().version));
  }

  // ── Reserva ──────────────────────────────────────────────────────────────

  private reservaDe(asignadoA: string | null, hasta: Date | null, nombre: string | null, actorId: string, ahora: Date): ReservaActaDto {
    if (!asignadoA || !hasta) return { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
    if (hasta.getTime() <= ahora.getTime()) return { estado: 'vencida', por: nombre, hasta: hasta.toISOString(), minutosRestantes: 0 };
    return {
      estado: asignadoA === actorId ? 'mia' : 'otro', por: nombre, hasta: hasta.toISOString(),
      minutosRestantes: Math.ceil((hasta.getTime() - ahora.getTime()) / MINUTO_MS),
    };
  }

  async tomar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ReservaActaDto> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (v.estaDecidida) throw new ConflictException('El caso ya fue decidido');
    if (!v.estaRevisable) throw new ConflictException('El acta todavía no está lista para revisión');
    if (documento.instantanea().version < (await this.versionVigente(v.instantanea().practicaId))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del acta: revise esa versión');
    }
    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_ACTA_MS);
    if (!(await this.validaciones.reservar(validacionId, actor.id, ahora, hasta))) {
      throw new ConflictException('El caso ya está reservado por otro funcionario');
    }
    await this.auditar(AccionAuditada.ACTA_ASIGNADA, validacionId, { reservaHasta: hasta.toISOString() }, actor, ahora);
    return this.reservaDe(actor.id, hasta, actor.correo, actor.id, ahora);
  }

  /** Libera la reserva propia; coordinación y administración pueden liberar la de otra persona. */
  async liberar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ReservaActaDto> {
    await this.cargarCaso(validacionId, actor);
    if (!(await this.validaciones.liberarReserva(validacionId, actor.id, ahora, esSupervisorMesaActas(actor.rol)))) {
      throw new ConflictException('El caso no tiene una reserva que usted pueda liberar');
    }
    await this.auditar(AccionAuditada.ACTA_LIBERADA, validacionId, { administrativa: esSupervisorMesaActas(actor.rol) }, actor, ahora);
    return { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
  }

  /**
   * Elige y reserva el caso libre de mayor prioridad. Cada reserva es atómica en la base: si otra persona se adelanta con el
   * primero, se prueba el siguiente; dos personas a la vez nunca terminan con el mismo caso.
   */
  async tomarSiguiente(actor: Actor, dto: TomarSiguienteActaDto = {}, ahora: Date = new Date()): Promise<ResultadoTomarSiguienteActaDto> {
    this.exigirOperador(actor);
    const filas = await this.validaciones.listarMesa({ estados: [EstadoValidacionActa.REVISION], escuelas: this.alcance(actor) });
    const candidatos = filas
      .filter((f) => !this.reservaVigenteAjena(f, actor.id, ahora))
      .filter((f) => (dto.conDiscrepancias ? f.hayDiscrepanciaCritica === (dto.conDiscrepancias === 'si') : true))
      .filter((f) => (dto.documentoIncorrecto === 'si' ? f.tipoActaDetectada === 'documento_incorrecto' : true))
      .map((f) => ({ f, p: this.prioridadDe(f, ahora) }))
      .sort((a, b) => b.p.puntaje - a.p.puntaje || (a.f.recibidaEn?.getTime() ?? 0) - (b.f.recibidaEn?.getTime() ?? 0));
    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_ACTA_MS);
    for (const { f } of candidatos) {
      if (await this.validaciones.reservar(f.validacionId, actor.id, ahora, hasta)) {
        await this.auditar(AccionAuditada.ACTA_ASIGNADA, f.validacionId, { reservaHasta: hasta.toISOString(), origen: 'siguiente' }, actor, ahora);
        return { estado: 'tomado', validacionId: f.validacionId };
      }
    }
    return { estado: 'sin_casos', validacionId: null };
  }

  private reservaVigenteAjena(f: FilaMesaActa, actorId: string, ahora: Date): boolean {
    return f.asignadoA !== null && f.asignadoA !== actorId && f.reservaHasta !== null && f.reservaHasta.getTime() > ahora.getTime();
  }

  // ── Bandeja ──────────────────────────────────────────────────────────────

  private prioridadDe(f: FilaMesaActa, ahora: Date): PrioridadActaDto {
    return calcularPrioridadActa({
      tipoActaDetectada: f.tipoActaDetectada, hayDiscrepanciaCritica: f.hayDiscrepanciaCritica, firmaEmpresa: f.firmaEmpresa,
      firmaPracticante: f.firmaPracticante, version: f.version, recibidaEn: f.recibidaEn ?? f.cargadoEn, fechaInicio: f.fechaInicio,
    }, ahora);
  }

  async listar(actor: Actor, q: Record<string, string | undefined> = {}, ahora: Date = new Date()): Promise<ListadoBandejaActaDto> {
    this.exigirOperador(actor);
    // La bandeja operativa lista lo que se puede revisar. Los demás estados los pide solo supervisión.
    const pedidos = q.estado && esSupervisorMesaActas(actor.rol)
      ? q.estado.split(',').filter((e): e is EstadoValidacionActa => (Object.values(EstadoValidacionActa) as string[]).includes(e))
      : [EstadoValidacionActa.REVISION];
    const filas = await this.validaciones.listarMesa({
      estados: pedidos.length > 0 ? pedidos : [EstadoValidacionActa.REVISION], escuelas: this.alcance(actor),
    });
    const items = filas
      .filter((f) => this.pasaFiltros(f, q, actor, ahora))
      .map((f) => this.aItem(f, actor, ahora))
      .sort((a, b) => b.prioridad.puntaje - a.prioridad.puntaje || (a.recibidaEn ?? '').localeCompare(b.recibidaEn ?? ''));
    const abiertas = filas.filter((f) => f.estado === EstadoValidacionActa.REVISION);
    return {
      kpis: {
        abiertas: abiertas.length,
        libres: abiertas.filter((f) => !f.asignadoA || (f.reservaHasta?.getTime() ?? 0) <= ahora.getTime()).length,
        mias: abiertas.filter((f) => f.asignadoA === actor.id && (f.reservaHasta?.getTime() ?? 0) > ahora.getTime()).length,
        conDiscrepanciaCritica: abiertas.filter((f) => f.hayDiscrepanciaCritica).length,
        documentoIncorrecto: abiertas.filter((f) => f.tipoActaDetectada === 'documento_incorrecto').length,
      },
      total: items.length,
      items,
    };
  }

  private pasaFiltros(f: FilaMesaActa, q: Record<string, string | undefined>, actor: Actor, ahora: Date): boolean {
    if (q.remuneracion && f.remuneracionDetectada !== q.remuneracion) return false;
    if (q.responsableArl && f.responsableArlDetectado !== q.responsableArl) return false;
    if (q.conDiscrepancias === 'si' && !f.hayDiscrepanciaCritica) return false;
    if (q.conDiscrepancias === 'no' && f.hayDiscrepanciaCritica) return false;
    if (q.documentoIncorrecto === 'si' && f.tipoActaDetectada !== 'documento_incorrecto') return false;
    if (q.firmas === 'faltantes' && !(f.firmaEmpresa === 'no' || f.firmaPracticante === 'no')) return false;
    if (q.firmas === 'no_determinables' && !(f.firmaEmpresa === 'no_determinable' || f.firmaPracticante === 'no_determinable')) return false;
    if (q.firmas === 'completas' && !(f.firmaEmpresa === 'si' && f.firmaPracticante === 'si')) return false;
    if (q.reenvio === 'si' && f.version <= 1) return false;
    if (q.antiguedadMinDias) {
      const dias = Math.floor((ahora.getTime() - (f.recibidaEn ?? f.cargadoEn).getTime()) / DIA_MS);
      if (dias < Number(q.antiguedadMinDias)) return false;
    }
    if (q.prioridadMinima && this.prioridadDe(f, ahora).puntaje < Number(q.prioridadMinima)) return false;
    if (q.reserva) {
      const r = this.reservaDe(f.asignadoA, f.reservaHasta, f.asignadoNombre, actor.id, ahora).estado;
      if (q.reserva === 'libres' && !(r === 'libre' || r === 'vencida')) return false;
      if (q.reserva === 'mias' && r !== 'mia') return false;
      if (q.reserva === 'otros' && r !== 'otro') return false;
      if (q.reserva === 'vencidas' && r !== 'vencida') return false;
    }
    if (q.buscar && !f.estudianteNombre.toLowerCase().includes(q.buscar.trim().toLowerCase())) return false;
    return true;
  }

  private aItem(f: FilaMesaActa, actor: Actor, ahora: Date): ItemBandejaActaDto {
    const recibida = f.recibidaEn ?? f.cargadoEn;
    return {
      validacionId: f.validacionId, practicaId: f.practicaId, estudiante: { nombre: f.estudianteNombre },
      empresa: f.empresaRazonSocial, modalidad: definicionModalidad(f.modalidad as never)?.etiqueta ?? f.modalidad,
      fechaInicio: f.fechaInicio ? f.fechaInicio.toISOString().slice(0, 10) : null, version: f.version, esReenvio: f.version > 1,
      estado: f.estado, tipoActa: f.tipoActaDetectada, remuneracionActa: f.remuneracionDetectada, responsableArlActa: f.responsableArlDetectado,
      firmaEmpresa: f.firmaEmpresa, firmaPracticante: f.firmaPracticante, hayDiscrepanciaCritica: f.hayDiscrepanciaCritica,
      recomendacion: recomendacionActa({
        tipoActaDetectada: f.tipoActaDetectada, hayDiscrepanciaCritica: f.hayDiscrepanciaCritica, firmaEmpresa: f.firmaEmpresa,
        firmaPracticante: f.firmaPracticante, comparacion: f.veredicto ? ({ veredicto: f.veredicto } as never) : null,
      }),
      prioridad: this.prioridadDe(f, ahora), reserva: this.reservaDe(f.asignadoA, f.reservaHasta, f.asignadoNombre, actor.id, ahora),
      recibidaEn: recibida.toISOString(), diasEnBandeja: Math.max(0, Math.floor((ahora.getTime() - recibida.getTime()) / DIA_MS)),
      datosPracticaCambiaronDespuesDeDecision: f.datosPracticaCambiaronEn !== null,
    };
  }

  // ── Detalle ──────────────────────────────────────────────────────────────

  async detalle(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<DetalleActaDto> {
    const { v, practica, documento } = await this.cargarCaso(validacionId, actor);
    const d = v.instantanea();
    const p = practica.instantanea();
    const doc = documento.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    const documentoEstudiante = estudiante?.instantanea().documento ?? null;
    const valores = this.puedeVerValores(d, actor, ahora);
    const empresa = p.empresaId ? await this.empresas.buscarPorId(p.empresaId) : null;
    const programa = await this.nombreDelPrograma(documentoEstudiante);
    const asignado = d.asignadoA ? (await this.usuarios.buscarPorId(d.asignadoA))?.nombre ?? null : null;
    const vigente = doc.version >= (await this.versionVigente(d.practicaId));
    const reserva = this.reservaDe(d.asignadoA, d.reservaHasta, asignado, actor.id, ahora);

    const sipra = datosSipraDePractica({
      practica: p, estudiante: { nombre: estudiante?.nombre ?? '', documento: documentoEstudiante },
      empresa: empresa ? { razonSocial: empresa.razonSocial, nit: empresa.nit.formateado } : null, programa,
    });
    // La comparación se vuelve a calcular con lo que SIPRA dice HOY (valores a la vista); si el caso ya tiene decisión, el
    // resultado que vale es el de entonces, y se dice si los datos cambiaron después.
    const viva = recalcularComparacion(d, sipra, ahora);
    const guardada = d.comparacion;
    const campos: CampoComparadoDto[] = (viva?.completa.campos ?? []).map((c) => {
      const historico = d.decididoEn && guardada ? guardada.campos.find((g) => g.campo === c.campo) : undefined;
      const oculto = !valores && c.campo === 'documento';
      return {
        campo: c.campo, etiqueta: c.etiqueta,
        sipra: oculto ? enmascarar(c.sipra) : c.sipra, acta: oculto ? enmascarar(c.acta) : c.acta,
        resultado: historico?.resultado ?? c.resultado, criticidad: historico?.criticidad ?? c.criticidad, nota: c.nota,
      };
    });
    const vigenteLaComparacion = !viva || !guardada || JSON.stringify(viva.comparacion.campos.map((c) => [c.campo, c.resultado]))
      === JSON.stringify(guardada.campos.map((c) => [c.campo, c.resultado]));

    const actas = (await this.documentos.listarPorPractica(d.practicaId)).filter((x) => x.tipo === TipoDocumento.ACTA_INICIO);
    const maxVersion = Math.max(0, ...actas.map((x) => x.instantanea().version));
    const validacionesDeLaPractica = await this.validaciones.listarPorPractica(d.practicaId);
    const versiones = actas
      .map((a) => a.instantanea())
      .sort((x, y) => y.version - x.version)
      .map((a) => {
        const vv = validacionesDeLaPractica.find((x) => x.documentoId === a.id)?.instantanea();
        return {
          validacionId: vv?.id ?? '', documentoId: a.id, version: a.version, vigente: a.version === maxVersion,
          estado: vv?.estado ?? 'sin_validacion', tipoActa: vv?.tipoActaDetectada ?? null,
          cargadaEn: a.cargadoEn.toISOString(), decididaEn: vv?.decididoEn ? vv.decididoEn.toISOString() : null,
        };
      });

    const evidencias = await this.validaciones.listarEvidencias(d.id);
    const nombres = new Map<string, string>();
    for (const e of evidencias) {
      const actorId = e.instantanea().actorId;
      if (actorId && !nombres.has(actorId)) nombres.set(actorId, (await this.usuarios.buscarPorId(actorId))?.nombre ?? 'Funcionario');
    }
    const historial = evidencias.map((e) => e.instantanea()).map((e) => ({
      fecha: e.fecha.toISOString(), tipo: e.tipo, etiqueta: ETIQUETA_EVENTO[e.tipo], resultado: e.resultado, ronda: e.intento,
      actor: e.actorId ? nombres.get(e.actorId) ?? null : null,
    }));

    const recomendacion = recomendacionActa(d);
    const prioridad = calcularPrioridadActa({
      tipoActaDetectada: d.tipoActaDetectada, hayDiscrepanciaCritica: d.hayDiscrepanciaCritica, firmaEmpresa: d.firmaEmpresa,
      firmaPracticante: d.firmaPracticante, version: doc.version, recibidaEn: d.recibidaEn ?? doc.cargadoEn, fechaInicio: p.fechaInicio,
    }, ahora);
    const decididoPor = d.decididoPor ? (await this.usuarios.buscarPorId(d.decididoPor))?.nombre ?? null : null;
    const esActa = d.tipoActaDetectada === 'iniciacion_practicas';

    return {
      validacionId: d.id, practicaId: d.practicaId, documentoId: d.documentoId, version: doc.version, vigente, estado: d.estado,
      recomendacion, prioridad, reserva,
      puedeDecidir: d.estado === EstadoValidacionActa.REVISION && vigente && reserva.estado === 'mia',
      estudiante: {
        nombre: estudiante?.nombre ?? '', documento: valores ? documentoEstudiante : null,
        documentoEnmascarado: enmascarar(documentoEstudiante), programa,
      },
      practica: {
        empresa: empresa?.razonSocial ?? p.empresaRazonSocial, nit: empresa?.nit.formateado ?? p.empresaNit,
        modalidad: definicionModalidad(p.modalidad).etiqueta, fechaInicio: p.fechaInicio ? p.fechaInicio.toISOString().slice(0, 10) : null,
        fechaFin: p.fechaFin ? p.fechaFin.toISOString().slice(0, 10) : null,
      },
      responsableArlSugeridoPorModalidad: responsableArlSugerido(p.modalidad),
      resumen: {
        clasificacion: d.tipoActaDetectada,
        remuneracionSipra: p.tipoRemuneracion ? TEXTO_REMUNERACION[p.tipoRemuneracion] : null,
        remuneracionActa: esActa && d.remuneracionDetectada ? TEXTO_REMUNERACION[d.remuneracionDetectada] : null,
        responsableArlSipra: p.responsableArlPractica ? TEXTO_ARL[p.responsableArlPractica] : null,
        responsableArlActa: esActa && d.responsableArlDetectado ? TEXTO_ARL[d.responsableArlDetectado] : null,
        firmaEmpresa: d.firmaEmpresa, firmaPracticante: d.firmaPracticante,
      },
      comparacion: guardada || viva ? {
        veredicto: guardada?.veredicto ?? null, comparadaEn: guardada?.comparadaEn ?? null, vigente: vigenteLaComparacion, campos,
        discrepancias: (viva?.completa.discrepancias ?? []).map((x) => ({ campo: x.campo, codigo: x.codigo, severidad: x.severidad, mensaje: x.mensaje })),
      } : null,
      datosPracticaCambiaronDespuesDeDecision: d.datosPracticaCambiaronEn ? d.datosPracticaCambiaronEn.toISOString() : null,
      decision: d.decididoEn ? { estado: d.estado, por: decididoPor, en: d.decididoEn.toISOString(), motivo: d.motivoDecision } : null,
      versiones, historial,
    };
  }

  // ── Archivo ──────────────────────────────────────────────────────────────

  /** El archivo se sirve por la sesión autenticada (sin URL permanente) y solo a quien tiene el caso tomado o supervisa. */
  async archivo(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<{ contenido: Buffer; mime: string; nombre: string }> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (!this.puedeVerValores(v.instantanea(), actor, ahora)) throw new ConflictException('Tome el caso antes de abrir el acta');
    const doc = documento.instantanea();
    const contenido = await this.almacen.leer(doc.rutaAlmacenamiento);
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.DOCUMENTO_VISUALIZADO, entidad: 'documento',
      entidadId: doc.id, justificacion: null, metadatos: { tamanoBytes: contenido.length, origen: 'mesa_actas' }, ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    return { contenido, mime: doc.mimeReal, nombre: doc.nombreOriginal };
  }

  // ── Decisión ─────────────────────────────────────────────────────────────

  async decidir(validacionId: string, actor: Actor, dto: DecisionActaDto, ahora: Date = new Date()): Promise<DocumentoRespuestaDto> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    const d = v.instantanea();
    if (ESTADOS_DECIDIDOS_ACTA.includes(d.estado)) throw new ConflictException('El caso ya fue decidido');
    // Solo un acta lista para revisión se decide: antes de eso no hay resultado que revisar (409, nunca 500).
    if (!v.estaRevisable) {
      throw new ConflictException(d.estado === EstadoValidacionActa.ERROR
        ? 'El procesamiento del acta falló: debe reintentarse antes de decidir'
        : 'El acta todavía se está procesando: espere a que esté lista para revisión');
    }
    if (documento.instantanea().version < (await this.versionVigente(d.practicaId))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del acta: revise esa versión');
    }
    // La reserva se vuelve a validar aquí, en el servidor, aunque la pantalla creyera tenerla.
    if (d.asignadoA === null || d.reservaHasta === null || d.reservaHasta.getTime() <= ahora.getTime()) {
      throw new ConflictException('Su reserva del caso venció: tómelo de nuevo antes de decidir');
    }
    if (d.asignadoA !== actor.id) throw new ConflictException('El caso está reservado por otro funcionario');

    const recomendacion = recomendacionActa(d);
    const { apartaDeRecomendacion, minimoJustificacion, motivo: motivoApartamiento } = evaluarApartamientoActa(dto.decision, recomendacion);
    let justificacion = (dto.justificacion ?? '').trim();
    if (dto.decision === 'devolver') {
      if (!dto.motivo) throw new BadRequestException('Elija el motivo de la devolución');
      if (dto.motivo === MotivoDevolucionActa.OTRO && justificacion.length < JUSTIFICACION_MINIMA) {
        throw new BadRequestException(`Explique al estudiante qué debe corregir (al menos ${JUSTIFICACION_MINIMA} caracteres)`);
      }
      justificacion = mensajeDevolucionActa(dto.motivo, justificacion || null);
    } else if (dto.decision === 'rechazar') {
      if (justificacion.length < minimoJustificacion) {
        throw new BadRequestException(apartaDeRecomendacion
          ? `Esta decisión se aparta de la recomendación del sistema: la justificación debe tener al menos ${minimoJustificacion} caracteres`
          : `El rechazo exige una justificación (al menos ${JUSTIFICACION_MINIMA} caracteres). Si el problema se puede corregir, devuélvalo al estudiante.`);
      }
    } else if (apartaDeRecomendacion) {
      if (justificacion.length < minimoJustificacion) {
        throw new BadRequestException(`${motivoApartamiento}: la justificación debe tener al menos ${minimoJustificacion} caracteres`);
      }
    } else if (justificacion.length < JUSTIFICACION_MINIMA) {
      justificacion = 'Acta de iniciación revisada y aprobada en la Mesa de Actas.';
    }

    // Una sola decisión aplica: el compare-and-set del documento deja pasar a una y las demás reciben 409.
    const respuesta = await this.gestionar.decidir(d.documentoId, { decision: dto.decision, justificacion }, actor, {
      mesaActa: { motivo: dto.decision === 'devolver' ? dto.motivo ?? null : null },
    });
    await this.auditar(AccionAuditada.DECISION_ACTA, validacionId, {
      decision: dto.decision, recomendacion, apartaDeRecomendacion, motivoDevolucion: dto.decision === 'devolver' ? dto.motivo ?? null : null,
      hayDiscrepanciaCritica: d.hayDiscrepanciaCritica,
    }, actor, ahora);
    return respuesta;
  }

  // ── Supervisión ──────────────────────────────────────────────────────────

  async supervision(actor: Actor, ahora: Date = new Date()): Promise<SupervisionActaDto> {
    if (!esSupervisorMesaActas(actor.rol)) throw new ForbiddenException('Solo coordinación y administración supervisan la Mesa de Actas');
    return this.validaciones.supervisionMesa(ahora, this.alcance(actor));
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async nombreDelPrograma(documentoEstudiante: string | null): Promise<string | null> {
    if (!documentoEstudiante || !this.sinu) return null;
    try {
      return (await this.sinu.buscarPorDocumento(documentoEstudiante))?.programaNombre ?? null;
    } catch {
      return null;
    }
  }

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor: Actor, ahora: Date): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'validacion_acta_iniciacion', entidadId,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
  }
}

