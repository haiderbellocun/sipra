import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { DatosRutExtraidos, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona } from '../../../domain/entities/documento-empresarial';
import { Documento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { Practica } from '../../../domain/entities/practica.entity';
import {
  DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial,
  TipoEvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
} from '../../../domain/entities/validacion-documento-empresarial.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, EMPRESA_REPOSITORY,
  EmpresaRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import { ESTADOS_DOCUMENTO_TERMINALES, MINUTOS_RESERVA_POR_VENCER } from '../../../domain/ports/out/validacion-acta.port';
import {
  FilaMesaRut, VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import {
  ComparacionRut, CampoComparacionRut, SipraParaRut, datosSipraParaRut, sipraCambioDespues,
} from '../../../domain/services/comparacion-rut.domain-service';
import { JUSTIFICACION_MINIMA } from '../../../domain/services/justificacion-decision';
import {
  DURACION_RESERVA_RUT_MS, MotivoDevolucionRut, MotivoDevolucionRutCatalogo, RecomendacionRut, calcularPrioridadRut,
  catalogoMotivosDevolucionRut, esMotivoDevolucionRut, evaluarApartamientoRut, mensajeDevolucionRut, motivoAplicaA, recomendacionRut,
} from '../../../domain/services/mesa-rut.domain-service';
import { esSupervisorRevisionRut, puedeOperarRevisionRut } from '../../../domain/value-objects/acceso-rut.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { DocumentoRespuestaDto } from '../../dtos/documento.dto';
import {
  CampoComparadoRutDto, DecisionRutDto, DetalleRutDto, ItemBandejaRutDto, ListadoBandejaRutDto, ReservaRutDto,
  ResultadoTomarSiguienteRutDto, SupervisionRutDto, TomarSiguienteRutDto,
} from '../../dtos/rut-mesa.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { GestionarDocumentoUseCase } from './gestionar-documento.use-case';
import { ValidacionRutUseCase } from './validacion-rut.use-case';

const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;
const ENTIDAD = 'validacion_documento_empresarial';
const MENSAJE_INCONSISTENCIA_RUT = 'Inconsistencia operativa: el documento ya tiene decisión pero la validación sigue en revisión. Requiere reconciliación controlada por coordinación.';
export const AVISO_DATOS_SIPRA_CAMBIARON = 'Los datos de SIPRA cambiaron después de esta validación.';
export const AVISO_LECTURA_OCR = 'Leído por OCR · revisar contra el documento';
/** Lectura dudosa de un PDF digital (p. ej. un NIT cuyo dígito de verificación no cuadra): no es OCR, y no se dice que lo sea. */
export const AVISO_LECTURA_DUDOSA = 'Lectura poco segura · revisar contra el documento';
const AVISO_AUTENTICIDAD = 'SIPRA no verifica la autenticidad del documento: la presencia de un QR no la acredita.';

const ETIQUETA_EVENTO: Record<TipoEvidenciaDocumentoEmpresarial, string> = {
  [TipoEvidenciaDocumentoEmpresarial.LECTURA_DOCUMENTO]: 'Lectura del documento',
  [TipoEvidenciaDocumentoEmpresarial.CLASIFICACION]: 'Clasificación del documento',
  [TipoEvidenciaDocumentoEmpresarial.COMPARACION]: 'Comparación con SIPRA',
  [TipoEvidenciaDocumentoEmpresarial.VERIFICACION]: 'Verificación',
  [TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA]: 'Decisión de una persona',
  [TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA]: 'Cambio de datos de SIPRA',
};

const ETIQUETA_CAMPO: Record<string, string> = {
  documento: 'Documento de identidad', nombre: 'Nombre', nit: 'NIT', dv: 'Dígito de verificación', razon_social: 'Razón social',
  ciiu: 'Actividad económica (CIIU)', divipola: 'Municipio (DIVIPOLA)', fecha_generacion: 'Fecha de generación',
};

const TEXTO_RESULTADO: Record<string, string> = {
  coincide: 'Coincide', diferente: 'Diferente', informacion_insuficiente: 'No se pudo comparar', no_aplica: 'No aplica', informativo: 'Informativo',
};

/** Solo los últimos 4 caracteres alfanuméricos (nunca la forma en que se escribió). */
function enmascarar(documento: string | null): string {
  const limpio = (documento ?? '').replace(/[^A-Za-z0-9]/g, '');
  return limpio.length > 4 ? `••••${limpio.slice(-4)}` : '••••';
}

const esTipoRut = (tipo: TipoDocumento): boolean => tipo === TipoDocumento.RUT_NATURAL || tipo === TipoDocumento.RUT_JURIDICO;

/**
 * Mesa de RUT: bandeja, detalle, reserva, decisión, supervisión y visor del archivo.
 *
 * El sistema RECOMIENDA y compara; decide siempre una persona, con el caso reservado por ella. No hay decisión automática.
 * Operan docente (tutor), coordinación y administración —quienes ya deciden el RUT—; auxiliar, empresa y extensión no.
 * Independiente de las Mesas de EPS y de Actas.
 */
@Injectable()
export class MesaRutUseCase {
  constructor(
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly gestionar: GestionarDocumentoUseCase,
    private readonly rut: ValidacionRutUseCase,
  ) {}

  // ── Autorización y alcance ───────────────────────────────────────────────

  private exigirOperador(actor: Actor): void {
    if (!puedeOperarRevisionRut(actor.rol)) throw new ForbiddenException('Su perfil no opera la Mesa de RUT');
  }

  /**
   * Escuelas que la persona alcanza. El docente solo ve las suyas (sin escuelas, ningún caso: una lista vacía no coincide con
   * nada); coordinación con escuelas asignadas, las suyas; coordinación del Área y administración, todas (`null`).
   */
  private alcance(actor: Actor): string[] | null {
    if (actor.rol === Rol.TUTOR) return [...actor.escuelas];
    return actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0 ? [...actor.escuelas] : null;
  }

  /** Datos personales completos: solo a quien tiene el caso tomado (reserva vigente), a supervisión o a quien lo decidió. */
  private puedeVerValores(d: DatosValidacionDocumentoEmpresarial, actor: Actor, ahora: Date): boolean {
    const mia = d.asignadoA === actor.id && d.reservaHasta !== null && d.reservaHasta.getTime() > ahora.getTime();
    return mia || esSupervisorRevisionRut(actor.rol) || d.decididoPor === actor.id;
  }

  private async cargarCaso(validacionId: string, actor: Actor): Promise<{ v: ValidacionDocumentoEmpresarial; practica: Practica; documento: Documento }> {
    this.exigirOperador(actor);
    const v = await this.validaciones.buscarPorId(validacionId);
    if (!v) throw new NotFoundException('Caso no encontrado');
    const d = v.instantanea();
    const practica = await this.practicas.buscarPorId(d.practicaId);
    if (!practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      throw new NotFoundException('Caso no encontrado');
    }
    const documento = await this.documentos.buscarPorId(d.documentoId);
    if (!documento || !esTipoRut(documento.tipo)) throw new NotFoundException('Caso no encontrado');
    return { v, practica, documento };
  }

  private inconsistente(estadoDocumento: string): boolean {
    return (ESTADOS_DOCUMENTO_TERMINALES as readonly string[]).includes(estadoDocumento);
  }

  // ── Reserva ──────────────────────────────────────────────────────────────

  private reservaDe(asignadoA: string | null, hasta: Date | null, nombre: string | null, actorId: string, ahora: Date): ReservaRutDto {
    if (!asignadoA || !hasta) return { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
    if (hasta.getTime() <= ahora.getTime()) return { estado: 'vencida', por: nombre, hasta: hasta.toISOString(), minutosRestantes: 0 };
    return {
      estado: asignadoA === actorId ? 'mia' : 'otro', por: nombre, hasta: hasta.toISOString(),
      minutosRestantes: Math.ceil((hasta.getTime() - ahora.getTime()) / MINUTO_MS),
    };
  }

  private reservaVigente(f: FilaMesaRut, ahora: Date): boolean {
    return f.asignadoA !== null && f.reservaHasta !== null && f.reservaHasta.getTime() > ahora.getTime();
  }

  private reservaVigenteAjena(f: FilaMesaRut, actorId: string, ahora: Date): boolean {
    return this.reservaVigente(f, ahora) && f.asignadoA !== actorId;
  }

  async tomar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ReservaRutDto> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (v.estaDecidida) throw new ConflictException('El caso ya fue decidido');
    if (!v.estaRevisable) throw new ConflictException('El RUT todavía no está listo para revisión');
    if (this.inconsistente(documento.instantanea().estado)) throw new ConflictException(MENSAJE_INCONSISTENCIA_RUT);
    if (documento.instantanea().version < (await this.validaciones.versionMaximaDocumento(v.instantanea().practicaId, documento.tipo))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del RUT: revise esa versión');
    }
    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_RUT_MS);
    // Sentencia atómica en la base: bajo concurrencia hay UN ganador; los demás reciben 409.
    if (!(await this.validaciones.reservar(validacionId, actor.id, ahora, hasta))) {
      throw new ConflictException('El caso ya está reservado por otro funcionario');
    }
    await this.auditar(AccionAuditada.RUT_ASIGNADO, validacionId, { reservaHasta: hasta.toISOString() }, actor, ahora);
    return this.reservaDe(actor.id, hasta, actor.correo, actor.id, ahora);
  }

  /** Libera la reserva propia; coordinación y administración pueden liberar la de otra persona. */
  async liberar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ReservaRutDto> {
    await this.cargarCaso(validacionId, actor);
    if (!(await this.validaciones.liberarReserva(validacionId, actor.id, ahora, esSupervisorRevisionRut(actor.rol)))) {
      throw new ConflictException('El caso no tiene una reserva que usted pueda liberar');
    }
    await this.auditar(AccionAuditada.RUT_LIBERADO, validacionId, { administrativa: esSupervisorRevisionRut(actor.rol) }, actor, ahora);
    return { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
  }

  /** Elige y reserva el caso libre de mayor prioridad; cada reserva es atómica: si otra persona se adelanta, se prueba el siguiente. */
  async tomarSiguiente(actor: Actor, dto: TomarSiguienteRutDto = {}, ahora: Date = new Date()): Promise<ResultadoTomarSiguienteRutDto> {
    this.exigirOperador(actor);
    const filas = await this.validaciones.listarMesaRut({ estados: [Estado.REVISION], escuelas: this.alcance(actor) });
    const candidatos = filas
      .filter((f) => !this.reservaVigenteAjena(f, actor.id, ahora))
      .filter((f) => !this.inconsistente(f.estadoDocumento))
      .filter((f) => (dto.conDiscrepancias ? f.hayDiscrepancia === (dto.conDiscrepancias === 'si') : true))
      .filter((f) => (dto.documentoIncorrecto === 'si' ? this.recomendacionDe(f) === RecomendacionRut.DOCUMENTO_INCORRECTO : true))
      .map((f) => ({ f, p: this.prioridadDe(f, ahora) }))
      .sort((a, b) => b.p.puntaje - a.p.puntaje || (a.f.recibidaEn?.getTime() ?? 0) - (b.f.recibidaEn?.getTime() ?? 0));
    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_RUT_MS);
    for (const { f } of candidatos) {
      if (await this.validaciones.reservar(f.validacionId, actor.id, ahora, hasta)) {
        await this.auditar(AccionAuditada.RUT_ASIGNADO, f.validacionId, { reservaHasta: hasta.toISOString(), origen: 'siguiente' }, actor, ahora);
        return { estado: 'tomado', validacionId: f.validacionId };
      }
    }
    return { estado: 'sin_casos', validacionId: null };
  }

  // ── Bandeja ──────────────────────────────────────────────────────────────

  private recomendacionDe(f: FilaMesaRut): RecomendacionRut {
    return recomendacionRut({
      tipoDetectado: f.tipoDetectado as never, expectativa: f.expectativa, lecturaDudosa: f.lecturaDudosa,
      comparacion: f.veredicto ? { veredicto: f.veredicto, hayDiscrepancia: f.hayDiscrepancia } : null,
    });
  }

  private prioridadDe(f: FilaMesaRut, ahora: Date) {
    return calcularPrioridadRut({ recomendacion: this.recomendacionDe(f), version: f.version, recibidaEn: f.recibidaEn ?? f.cargadoEn, fechaInicio: f.fechaInicio }, ahora);
  }

  async listar(actor: Actor, q: Record<string, string | undefined> = {}, ahora: Date = new Date()): Promise<ListadoBandejaRutDto> {
    this.exigirOperador(actor);
    // La bandeja operativa lista lo que se puede revisar. Los demás estados los pide solo supervisión.
    const validos = Object.values(Estado) as string[];
    const pedidos = q.estado && esSupervisorRevisionRut(actor.rol) ? q.estado.split(',').filter((e) => validos.includes(e)) : [Estado.REVISION as string];
    const filas = await this.validaciones.listarMesaRut({ estados: pedidos.length > 0 ? pedidos : [Estado.REVISION], escuelas: this.alcance(actor) });
    const items = filas
      .filter((f) => this.pasaFiltros(f, q, actor, ahora))
      .map((f) => this.aItem(f, actor, ahora))
      .sort((a, b) => b.prioridad.puntaje - a.prioridad.puntaje || a.recibidaEn.localeCompare(b.recibidaEn));
    const abiertas = filas.filter((f) => f.estado === (Estado.REVISION as string));
    return {
      kpis: {
        abiertas: abiertas.length,
        libres: abiertas.filter((f) => !this.reservaVigente(f, ahora)).length,
        mias: abiertas.filter((f) => f.asignadoA === actor.id && this.reservaVigente(f, ahora)).length,
        tomadas: abiertas.filter((f) => this.reservaVigente(f, ahora)).length,
        porVencer: abiertas.filter((f) => this.reservaVigente(f, ahora) && (f.reservaHasta as Date).getTime() <= ahora.getTime() + MINUTOS_RESERVA_POR_VENCER * MINUTO_MS).length,
        conDiscrepancia: abiertas.filter((f) => f.hayDiscrepancia).length,
        documentoIncorrecto: abiertas.filter((f) => this.recomendacionDe(f) === RecomendacionRut.DOCUMENTO_INCORRECTO).length,
        lecturaDudosa: abiertas.filter((f) => f.lecturaDudosa).length,
        personaDistinta: abiertas.filter((f) => this.recomendacionDe(f) === RecomendacionRut.PERSONA_DISTINTA).length,
      },
      total: items.length,
      items,
    };
  }

  private pasaFiltros(f: FilaMesaRut, q: Record<string, string | undefined>, actor: Actor, ahora: Date): boolean {
    if (q.tipoPersona && f.tipoPersona !== q.tipoPersona) return false;
    if (q.conDiscrepancias === 'si' && !f.hayDiscrepancia) return false;
    if (q.conDiscrepancias === 'no' && f.hayDiscrepancia) return false;
    if (q.documentoIncorrecto === 'si' && this.recomendacionDe(f) !== RecomendacionRut.DOCUMENTO_INCORRECTO) return false;
    if (q.lecturaDudosa === 'si' && !f.lecturaDudosa) return false;
    if (q.personaDistinta === 'si' && this.recomendacionDe(f) !== RecomendacionRut.PERSONA_DISTINTA) return false;
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

  private aItem(f: FilaMesaRut, actor: Actor, ahora: Date): ItemBandejaRutDto {
    const recibida = f.recibidaEn ?? f.cargadoEn;
    return {
      validacionId: f.validacionId, practicaId: f.practicaId, estudiante: { nombre: f.estudianteNombre }, empresa: f.empresaRazonSocial,
      tipoRut: f.tipoPersona === TipoPersona.NATURAL ? 'persona_natural' : f.tipoPersona === TipoPersona.JURIDICA ? 'persona_juridica' : null,
      tipoEsperado: f.tipoDocumento, tipoDetectado: f.tipoDetectado, personaDistinta: this.recomendacionDe(f) === RecomendacionRut.PERSONA_DISTINTA,
      version: f.version, esReenvio: f.version > 1, estado: f.estado, hayDiscrepancia: f.hayDiscrepancia, lecturaDudosa: f.lecturaDudosa,
      recomendacion: this.recomendacionDe(f), prioridad: this.prioridadDe(f, ahora),
      reserva: this.reservaDe(f.asignadoA, f.reservaHasta, f.asignadoNombre, actor.id, ahora),
      recibidaEn: recibida.toISOString(), diasEnBandeja: Math.max(0, Math.floor((ahora.getTime() - recibida.getTime()) / DIA_MS)),
      datosSipraCambiaronDespuesDeDecision: f.datosSipraCambiaronEn !== null,
      inconsistenciaOperativa: f.estado === (Estado.REVISION as string) && this.inconsistente(f.estadoDocumento),
    };
  }

  // ── Lo que SIPRA dice hoy ────────────────────────────────────────────────

  private async datosSipra(practica: Practica): Promise<{ sipra: SipraParaRut; empresaNit: string | null; empresaRazon: string | null }> {
    const dp = practica.instantanea();
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    const empresa = dp.empresaId ? await this.empresas.buscarPorId(dp.empresaId) : null;
    const e = empresa?.instantanea() ?? null;
    const sipra = datosSipraParaRut({
      estudiante: { nombre: estudiante?.nombre ?? null, documento: estudiante?.instantanea().documento ?? null },
      empresa: e ? { nitNumero: e.nitNumero, nitDv: e.nitDv, razonSocial: e.razonSocial } : null,
      formulario: { razonSocial: dp.empresaRazonSocial ?? null, nit: dp.empresaNit ?? null },
    });
    return { sipra, empresaNit: empresa?.nit.formateado ?? dp.empresaNit ?? null, empresaRazon: empresa?.razonSocial ?? dp.empresaRazonSocial ?? null };
  }

  /**
   * Antes de revisar un caso abierto se recalcula la comparación con la lectura ya guardada (sin releer el PDF). Devuelve la
   * validación al día y si el recálculo cambió algo (SIPRA cambió desde la última comparación).
   */
  private async actualizarComparacion(v: ValidacionDocumentoEmpresarial, actor: Actor, ahora: Date): Promise<{ v: ValidacionDocumentoEmpresarial; recalculada: boolean }> {
    if (!v.estaRevisable) return { v, recalculada: false };
    const antes = (v.instantanea().comparacion as ComparacionRut | null)?.huellaSipra ?? null;
    const actualizada = (await this.rut.recalcularComparacion(v.instantanea().documentoId, ahora)) ?? v;
    const despues = (actualizada.instantanea().comparacion as ComparacionRut | null)?.huellaSipra ?? null;
    const recalculada = antes !== despues;
    if (recalculada) await this.auditar(AccionAuditada.RUT_RECALCULADO, v.id, { origen: 'revision' }, actor, ahora);
    return { v: actualizada, recalculada };
  }

  /**
   * Si SIPRA cambió DESPUÉS de una decisión, la decisión no se toca: se deja constancia UNA vez (evidencia + auditoría) y la
   * Mesa lo avisa. Los cambios posteriores solo se muestran en vivo.
   */
  private async registrarCambioPosteriorADecision(v: ValidacionDocumentoEmpresarial, actor: Actor, ahora: Date): Promise<ValidacionDocumentoEmpresarial> {
    const d = v.instantanea();
    if (!v.estaDecidida || d.datosSipraCambiaronEn !== null) return v;
    const nuevo = ValidacionDocumentoEmpresarial.desde(d);
    nuevo.marcarCambioDeDatosPosterior(ahora);
    const n = nuevo.instantanea();
    const guardada = await this.validaciones.agregarEvidencia(EvidenciaDocumentoEmpresarial.crear({
      id: randomUUID(), validacionId: d.id, intento: n.intentos, tipo: TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA,
      resultado: 'datos_sipra_cambiaron', metodo: 'comparacion_huella_sipra', fecha: ahora, actorId: null, hashDocumento: d.hashDocumento,
      datos: { estadoDecision: d.estado }, errorCodigo: null, creadoEn: ahora,
    }).instantanea());
    if (guardada && (await this.validaciones.guardarSiVersion(n, d.version))) {
      await this.auditar(AccionAuditada.RUT_DATOS_CAMBIARON_TRAS_DECISION, d.id, { estadoDecision: d.estado }, actor, ahora);
    }
    return (await this.validaciones.buscarPorId(d.id)) ?? v;
  }

  // ── Detalle ──────────────────────────────────────────────────────────────

  async detalle(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<DetalleRutDto> {
    const caso = await this.cargarCaso(validacionId, actor);
    const { practica, documento } = caso;
    let { v } = caso;
    const actualizado = await this.actualizarComparacion(v, actor, ahora);
    v = actualizado.v;

    const { sipra, empresaNit, empresaRazon } = await this.datosSipra(practica);
    const guardada = v.instantanea().comparacion as ComparacionRut | null;
    const sipraCambio = guardada?.huellaSipra ? sipraCambioDespues(guardada, sipra) : false;
    if (v.estaDecidida && sipraCambio) v = await this.registrarCambioPosteriorADecision(v, actor, ahora);

    const d = v.instantanea();
    const doc = documento.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    const documentoEstudiante = estudiante?.instantanea().documento ?? null;
    const valores = this.puedeVerValores(d, actor, ahora);
    const asignado = d.asignadoA ? (await this.usuarios.buscarPorId(d.asignadoA))?.nombre ?? null : null;
    const maxVersion = await this.validaciones.versionMaximaDocumento(d.practicaId, doc.tipo);
    const vigente = doc.version >= maxVersion;
    const reserva = this.reservaDe(d.asignadoA, d.reservaHasta, asignado, actor.id, ahora);

    const recomendacion = recomendacionRut({
      tipoDetectado: d.tipoDetectado, expectativa: d.expectativa, lecturaDudosa: d.lecturaDudosa,
      comparacion: guardada ? { veredicto: guardada.veredicto, hayDiscrepancia: guardada.hayDiscrepancia } : null,
    });
    const prioridad = calcularPrioridadRut({ recomendacion, version: doc.version, recibidaEn: d.recibidaEn ?? doc.cargadoEn, fechaInicio: practica.instantanea().fechaInicio ?? null }, ahora);
    const inconsistencia = d.estado === Estado.REVISION && this.inconsistente(doc.estado);
    const datos = d.datosExtraidos as DatosRutExtraidos | null;

    const campos = (guardada?.campos ?? []).map((c) => this.aCampo(c, datos, sipra, d.lecturaDudosa, d.metodoLectura === 'ocr', valores));
    const aviso = sipraCambio || actualizado.recalculada || d.datosSipraCambiaronEn !== null ? AVISO_DATOS_SIPRA_CAMBIARON : null;

    const decididoPor = d.decididoPor ? (await this.usuarios.buscarPorId(d.decididoPor))?.nombre ?? null : null;
    const delaPractica = (await this.documentos.listarPorPractica(d.practicaId)).filter((x) => x.tipo === doc.tipo);
    const validacionesPractica = await this.validaciones.listarPorPractica(d.practicaId);
    const versiones = delaPractica.map((x) => x.instantanea()).sort((a, b) => b.version - a.version).map((a) => {
      const vv = validacionesPractica.find((x) => x.documentoId === a.id)?.instantanea();
      return {
        validacionId: vv?.id ?? '', documentoId: a.id, version: a.version, vigente: a.version === maxVersion, estado: vv?.estado ?? 'sin_validacion', motivo: vv?.motivoDecision ?? null,
        cargadaEn: a.cargadoEn.toISOString(), decididaEn: vv?.decididoEn ? vv.decididoEn.toISOString() : null,
      };
    });
    const evidencias = (await this.validaciones.listarEvidencias(d.id)).map((e) => e.instantanea());
    const nombres = new Map<string, string>();
    for (const e of evidencias) {
      if (e.actorId && !nombres.has(e.actorId)) nombres.set(e.actorId, (await this.usuarios.buscarPorId(e.actorId))?.nombre ?? 'Funcionario');
    }
    const aut = d.autenticidad;

    return {
      validacionId: d.id, practicaId: d.practicaId, documentoId: d.documentoId, version: doc.version, vigente, estado: d.estado,
      recomendacion, prioridad, reserva,
      puedeDecidir: d.estado === Estado.REVISION && vigente && reserva.estado === 'mia' && !inconsistencia,
      tipoEsperado: d.tipoEsperado, tipoDetectado: d.tipoDetectado, tipoPersona: d.tipoPersona,
      lectura: {
        metodo: d.metodoLectura === 'ocr' ? 'ocr' : d.metodoLectura === 'texto' ? 'texto' : null, dudosa: d.lecturaDudosa,
        aviso: d.lecturaDudosa ? (d.metodoLectura === 'ocr' ? AVISO_LECTURA_OCR : AVISO_LECTURA_DUDOSA) : null,
      },
      // Nunca «RUT auténtico»: la autenticidad sigue sin verificarse; el QR es solo una señal de presencia.
      autenticidad: {
        estado: aut.estado, qr: aut.qrPresente === true || aut.qrDecodificado === true ? 'detectado' : 'no_determinado',
        destinoOficialDian: aut.qrDestinoOficial === true, aviso: AVISO_AUTENTICIDAD,
      },
      estudiante: { nombre: estudiante?.nombre ?? '', documento: valores ? documentoEstudiante : null, documentoEnmascarado: enmascarar(documentoEstudiante) },
      practica: { empresa: empresaRazon, nit: empresaNit },
      comparacion: guardada ? { veredicto: guardada.veredicto, calculadaEn: guardada.calculadaEn, campos } : null,
      avisoDatosSipra: aviso,
      datosSipraCambiaronEn: d.datosSipraCambiaronEn ? d.datosSipraCambiaronEn.toISOString() : null,
      decision: d.decididoEn ? { estado: d.estado, por: decididoPor, en: d.decididoEn.toISOString(), motivo: d.motivoDecision } : null,
      versiones,
      historial: evidencias.map((e) => ({
        fecha: e.fecha.toISOString(), tipo: e.tipo, etiqueta: ETIQUETA_EVENTO[e.tipo], resultado: e.resultado, ronda: e.intento,
        actor: e.actorId ? nombres.get(e.actorId) ?? null : null,
      })),
      inconsistenciaOperativa: inconsistencia ? { estadoDocumento: doc.estado, mensaje: MENSAJE_INCONSISTENCIA_RUT } : null,
    };
  }

  /** Una fila SIPRA | RUT | RESULTADO. Un campo crítico sin poder compararse NUNCA se muestra como «diferente». */
  private aCampo(c: CampoComparacionRut, datos: DatosRutExtraidos | null, sipra: SipraParaRut, dudosa: boolean, ocr: boolean, valores: boolean): CampoComparadoRutDto {
    const nombreRut = [datos?.nombres, datos?.apellidos].filter(Boolean).join(' ') || null;
    const nitSipra = sipra.empresa?.nitNumero ?? null;
    const por: Record<string, [string | null, string | null]> = {
      documento: [sipra.usuario.documento, datos?.numeroDocumento ?? null],
      nombre: [sipra.usuario.nombre, nombreRut],
      nit: [nitSipra, datos?.nit ?? null],
      dv: [sipra.empresa?.nitDv !== null && sipra.empresa?.nitDv !== undefined ? String(sipra.empresa.nitDv) : null, datos?.dv ?? null],
      razon_social: [sipra.empresa?.razonSocial ?? null, datos?.razonSocial ?? null],
      ciiu: [null, datos?.ciiuPrincipal ?? null],
      divipola: [null, datos?.divipolaMunicipio ?? null],
      fecha_generacion: [null, datos?.fechaGeneracion ?? null],
    };
    const [sipraValor, rutValor] = por[c.campo] ?? [null, null];
    const oculto = !valores && (c.campo === 'documento' || c.campo === 'nit');
    const resultado = c.criticidad === 'informativo' ? 'informativo' : c.resultado;
    return {
      campo: c.campo, etiqueta: ETIQUETA_CAMPO[c.campo] ?? c.campo,
      sipra: oculto && sipraValor ? enmascarar(sipraValor) : sipraValor, rut: oculto && rutValor ? enmascarar(rutValor) : rutValor,
      resultado, resultadoTexto: TEXTO_RESULTADO[resultado], criticidad: c.criticidad,
      advertencia: dudosa && c.criticidad === 'critico' ? (ocr ? AVISO_LECTURA_OCR : AVISO_LECTURA_DUDOSA) : null,
    };
  }

  // ── Archivo ──────────────────────────────────────────────────────────────

  /** El archivo se sirve por la sesión autenticada (sin URL permanente) y solo a quien tiene el caso tomado o supervisa. */
  async archivo(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<{ contenido: Buffer; mime: string; nombre: string }> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (!this.puedeVerValores(v.instantanea(), actor, ahora)) throw new ConflictException('Tome el caso antes de abrir el RUT');
    const doc = documento.instantanea();
    const contenido = await this.almacen.leer(doc.rutaAlmacenamiento);
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.DOCUMENTO_VISUALIZADO, entidad: 'documento',
      entidadId: doc.id, justificacion: null, metadatos: { tamanoBytes: contenido.length, origen: 'mesa_rut' }, ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    return { contenido, mime: doc.mimeReal, nombre: doc.nombreOriginal };
  }

  // ── Decisión ─────────────────────────────────────────────────────────────

  async decidir(validacionId: string, actor: Actor, dto: DecisionRutDto, ahora: Date = new Date()): Promise<DocumentoRespuestaDto> {
    const caso = await this.cargarCaso(validacionId, actor);
    const { documento } = caso;
    let { v } = caso;
    let d = v.instantanea();
    if (v.estaDecidida) throw new ConflictException('El caso ya fue decidido');
    if (!v.estaRevisable) {
      throw new ConflictException(d.estado === Estado.ERROR
        ? 'El procesamiento del RUT falló: debe reintentarse antes de decidir'
        : 'El RUT todavía se está procesando: espere a que esté lista para revisión');
    }
    if (documento.instantanea().version < (await this.validaciones.versionMaximaDocumento(d.practicaId, documento.tipo))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del RUT: revise esa versión');
    }
    // La reserva se vuelve a validar aquí, en el servidor, aunque la pantalla creyera tenerla.
    if (d.asignadoA === null || d.reservaHasta === null || d.reservaHasta.getTime() <= ahora.getTime()) {
      throw new ConflictException('Su reserva del caso venció: tómelo de nuevo antes de decidir');
    }
    if (d.asignadoA !== actor.id) throw new ConflictException('El caso está reservado por otro funcionario');

    // Antes de decidir un caso abierto, la comparación se recalcula con lo que SIPRA dice HOY (sin releer el PDF).
    v = (await this.actualizarComparacion(v, actor, ahora)).v;
    d = v.instantanea();
    const comparacion = d.comparacion as ComparacionRut | null;
    const recomendacion = recomendacionRut({
      tipoDetectado: d.tipoDetectado, expectativa: d.expectativa, lecturaDudosa: d.lecturaDudosa,
      comparacion: comparacion ? { veredicto: comparacion.veredicto, hayDiscrepancia: comparacion.hayDiscrepancia } : null,
    });

    // La recomendación NUNCA bloquea una decisión humana válida: solo sube el listón de la justificación.
    const { apartaDeRecomendacion, minimoJustificacion, motivo: motivoApartamiento } = evaluarApartamientoRut(dto.decision, recomendacion);
    let justificacion = (dto.justificacion ?? '').trim();
    let motivoDevolucion: MotivoDevolucionRut | null = null;
    if (dto.decision === 'devolver') {
      if (!dto.motivo || !esMotivoDevolucionRut(dto.motivo)) throw new BadRequestException('Elija el motivo de la devolución');
      if (!motivoAplicaA(dto.motivo, d.tipoPersona ?? null)) {
        throw new BadRequestException('Ese motivo no aplica a este tipo de RUT');
      }
      if (dto.motivo === MotivoDevolucionRut.OTRO && justificacion.length < JUSTIFICACION_MINIMA) {
        throw new BadRequestException(`Explique al estudiante qué debe corregir (al menos ${JUSTIFICACION_MINIMA} caracteres)`);
      }
      motivoDevolucion = dto.motivo;
      justificacion = mensajeDevolucionRut(dto.motivo, justificacion || null);
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
      justificacion = 'RUT revisado y aprobado en la Mesa de RUT.';
    }

    // UNA operación atómica (documento + validación + evidencia + auditoría, o nada). Con decisiones simultáneas solo una confirma.
    return this.gestionar.decidir(d.documentoId, { decision: dto.decision, justificacion }, actor, {
      mesaRut: {
        validacionId: d.id, motivo: motivoDevolucion, ahora,
        contexto: { decision: dto.decision, recomendacion, apartaDeRecomendacion, motivoDevolucion, hayDiscrepancia: comparacion?.hayDiscrepancia ?? false },
      },
    });
  }

  /** Los motivos de devolución permitidos, con lo que leerá el estudiante: la pantalla no mantiene una copia. */
  motivosDevolucion(actor: Actor): MotivoDevolucionRutCatalogo[] {
    this.exigirOperador(actor);
    return catalogoMotivosDevolucionRut();
  }

  // ── Supervisión ──────────────────────────────────────────────────────────

  async supervision(actor: Actor, ahora: Date = new Date()): Promise<SupervisionRutDto> {
    if (!esSupervisorRevisionRut(actor.rol)) throw new ForbiddenException('Solo coordinación y administración supervisan la Mesa de RUT');
    return this.validaciones.supervisionRut(ahora, this.alcance(actor));
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor: Actor, ahora: Date): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: ENTIDAD, entidadId,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
  }
}
