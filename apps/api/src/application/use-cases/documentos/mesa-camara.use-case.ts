import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  DatosCamaraExtraidos, EstadoRegistral, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona,
} from '../../../domain/entities/documento-empresarial';
import { Documento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { Practica } from '../../../domain/entities/practica.entity';
import {
  DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial, TipoEvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
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
  CampoComparacionCamara, ComparacionCamara, SipraParaCamara, datosSipraParaCamara, sipraCambioDespuesCamara,
} from '../../../domain/services/comparacion-camara.domain-service';
import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from '../../../domain/services/justificacion-decision';
import {
  DURACION_RESERVA_CAMARA_MS, MotivoDevolucionCamara, MotivoDevolucionCamaraCatalogo, RecomendacionCamara, calcularPrioridadCamara,
  catalogoMotivosDevolucionCamara, esMotivoDevolucionCamara, evaluarApartamientoCamara, mensajeDevolucionCamara, motivoCamaraAplicaA,
  recomendacionCamara, resumenHumanoCamara,
} from '../../../domain/services/mesa-camara.domain-service';
import { POLITICA_CAMARA_POR_DEFECTO, evaluarCamara } from '../../../domain/services/vigencia-documento-empresarial.domain-service';
import { esSupervisorRevisionCamara, puedeOperarRevisionCamara } from '../../../domain/value-objects/acceso-camara.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  CampoComparadoCamaraDto, CampoInformativoCamaraDto, DecisionCamaraDto, DetalleCamaraDto, ItemBandejaCamaraDto, ListadoBandejaCamaraDto,
  ReservaCamaraDto, ResultadoTomarSiguienteCamaraDto, SupervisionCamaraDto, TomarSiguienteCamaraDto,
} from '../../dtos/camara-mesa.dto';
import { DocumentoRespuestaDto } from '../../dtos/documento.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { GestionarDocumentoUseCase } from './gestionar-documento.use-case';
import { ValidacionCamaraUseCase } from './validacion-camara.use-case';

const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;
const ENTIDAD = 'validacion_documento_empresarial';
const TIPOS_CAMARA: readonly string[] = [TipoDocumento.CAMARA_COMERCIO];
const MENSAJE_INCONSISTENCIA = 'Inconsistencia operativa: el documento ya tiene decisión pero la validación sigue en revisión. Requiere reconciliación controlada por coordinación.';
export const AVISO_CAMARA_DATOS_SIPRA_CAMBIARON = 'Los datos de SIPRA cambiaron después de esta validación.';
export const AVISO_CAMARA_LECTURA_OCR = 'Leído por OCR · revisar contra el documento';
/** Lectura dudosa de un PDF digital (p. ej. un NIT cuyo dígito de verificación no cuadra): no es OCR, y no se dice que lo sea. */
export const AVISO_CAMARA_LECTURA_DUDOSA = 'Lectura poco segura · revisar contra el documento';
const AVISO_AUTENTICIDAD = 'SIPRA no verifica la autenticidad del documento: el código, la URL o la firma PDF detectados no la acreditan.';
const ALERTA_CANCELADA = 'El certificado declara que la matrícula está cancelada.';

const ETIQUETA_EVENTO: Record<TipoEvidenciaDocumentoEmpresarial, string> = {
  [TipoEvidenciaDocumentoEmpresarial.LECTURA_DOCUMENTO]: 'Lectura del documento',
  [TipoEvidenciaDocumentoEmpresarial.CLASIFICACION]: 'Clasificación del documento',
  [TipoEvidenciaDocumentoEmpresarial.COMPARACION]: 'Comparación con SIPRA',
  [TipoEvidenciaDocumentoEmpresarial.VERIFICACION]: 'Verificación',
  [TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA]: 'Decisión de una persona',
  [TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA]: 'Cambio de datos de SIPRA',
};

const TEXTO_RESULTADO: Record<string, string> = {
  coincide: 'Coincide', diferente: 'No coincide', informacion_insuficiente: 'Información insuficiente', no_aplica: 'No aplica', informativo: 'Informativo',
};

/** Causas de cada resultado, en lenguaje de quien revisa (nunca el código interno). */
const CAUSA_HUMANA: Record<string, string> = {
  lectura_dudosa: 'La lectura es poco segura: revise contra el documento',
  sin_datos_leidos: 'No se pudo leer este dato',
  sipra_sin_empresa: 'SIPRA no tiene registrada la empresa o el titular',
  sipra_sin_nit: 'SIPRA no tiene este dato registrado',
  sipra_sin_dv: 'SIPRA no tiene el dígito de verificación registrado',
  sipra_sin_razon_social: 'SIPRA no tiene este dato registrado',
  sipra_sin_nombre: 'SIPRA no tiene este dato registrado',
  dv_ausente_en_certificado: 'El certificado no trae dígito de verificación',
  dato_ausente_en_certificado: 'No se leyó este dato en el certificado',
  persona_distinta: 'El certificado es de una persona natural/jurídica distinta de la esperada: no se compara',
  nombre_parcial: 'El nombre del certificado está incompleto (falta una parte)',
  representante_no_leido_en_certificado: 'No se pudo leer el representante en el certificado',
  sipra_sin_representante: 'SIPRA no tiene representante legal registrado',
  representante_ausente_en_ambos: 'Ni SIPRA ni el certificado traen representante legal',
  opcional_en_matricula: 'La matrícula de sociedad no exige representante legal',
  persona_natural: 'La persona natural no tiene representante legal',
  nit_no_confiable_dv_no_coincide: 'El dígito de verificación leído no corresponde al NIT',
  nit_no_confiable_nit_ausente: 'No se leyó el NIT',
  nit_no_confiable_nit_invalido: 'El NIT leído no es válido',
};
const causaHumana = (nota: string | undefined): string | null => (nota ? CAUSA_HUMANA[nota] ?? (nota.startsWith('nit_no_confiable') ? 'La lectura del NIT no es confiable' : null) : null);

const CERTIFICADO: Record<string, string> = {
  matricula_mercantil: 'Certificado de matrícula mercantil', existencia_representacion: 'Certificado de existencia y representación legal',
};

const ETIQUETA_ESTADO_REGISTRAL: Record<string, string> = {
  [EstadoRegistral.ACTIVO]: 'Activo', [EstadoRegistral.CANCELADO]: 'Cancelado', [EstadoRegistral.OTRO]: 'Otro', [EstadoRegistral.NO_DETERMINABLE]: 'No determinable',
};

/** Solo los últimos 4 caracteres alfanuméricos (nunca la forma en que se escribió). */
function enmascarar(valor: string | null): string {
  const limpio = (valor ?? '').replace(/[^A-Za-z0-9]/g, '');
  return limpio.length > 4 ? `••••${limpio.slice(-4)}` : '••••';
}

const esCamara = (tipo: TipoDocumento): boolean => tipo === TipoDocumento.CAMARA_COMERCIO;
const tipoCertificadoDe = (persona: string | null): 'persona_natural' | 'persona_juridica' | null => (persona === TipoPersona.NATURAL ? 'persona_natural' : persona === TipoPersona.JURIDICA ? 'persona_juridica' : null);

/**
 * Mesa de Cámara de Comercio: bandeja, detalle, reserva, decisión, supervisión y visor del archivo.
 *
 * El sistema RECOMIENDA y compara; decide siempre una persona, con el caso reservado por ella. No hay decisión automática. Operan
 * docente (tutor), coordinación y administración —quienes ya decidían la Cámara—; auxiliar, empresa y extensión no. Independiente de las
 * Mesas de EPS, Actas y RUT; comparte con ellas la infraestructura genérica de validación empresarial (reserva, decisión atómica).
 */
@Injectable()
export class MesaCamaraUseCase {
  constructor(
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly gestionar: GestionarDocumentoUseCase,
    private readonly camara: ValidacionCamaraUseCase,
  ) {}

  // ── Autorización y alcance ───────────────────────────────────────────────

  private exigirOperador(actor: Actor): void {
    if (!puedeOperarRevisionCamara(actor.rol)) throw new ForbiddenException('Su perfil no opera la Mesa de Cámara de Comercio');
  }

  /**
   * Escuelas que la persona alcanza. El docente solo ve las suyas (sin escuelas, ningún caso); coordinación con escuelas asignadas,
   * las suyas; coordinación del Área y administración, todas (`null`).
   */
  private alcance(actor: Actor): string[] | null {
    if (actor.rol === Rol.TUTOR) return [...actor.escuelas];
    return actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0 ? [...actor.escuelas] : null;
  }

  /** Datos personales completos: solo a quien tiene el caso tomado (reserva vigente), a supervisión o a quien lo decidió. */
  private puedeVerValores(d: DatosValidacionDocumentoEmpresarial, actor: Actor, ahora: Date): boolean {
    const mia = d.asignadoA === actor.id && d.reservaHasta !== null && d.reservaHasta.getTime() > ahora.getTime();
    return mia || esSupervisorRevisionCamara(actor.rol) || d.decididoPor === actor.id;
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
    if (!documento || !esCamara(documento.tipo)) throw new NotFoundException('Caso no encontrado');
    return { v, practica, documento };
  }

  private inconsistente(estadoDocumento: string): boolean {
    return (ESTADOS_DOCUMENTO_TERMINALES as readonly string[]).includes(estadoDocumento);
  }

  // ── Reserva ──────────────────────────────────────────────────────────────

  private reservaDe(asignadoA: string | null, hasta: Date | null, nombre: string | null, actorId: string, ahora: Date): ReservaCamaraDto {
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

  async tomar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ReservaCamaraDto> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (v.estaDecidida) throw new ConflictException('El caso ya fue decidido');
    if (!v.estaRevisable) throw new ConflictException('El certificado todavía no está listo para revisión');
    if (this.inconsistente(documento.instantanea().estado)) throw new ConflictException(MENSAJE_INCONSISTENCIA);
    if (documento.instantanea().version < (await this.validaciones.versionMaximaDocumento(v.instantanea().practicaId, documento.tipo))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del certificado: revise esa versión');
    }
    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_CAMARA_MS);
    // Sentencia atómica en la base: bajo concurrencia hay UN ganador; los demás reciben 409.
    if (!(await this.validaciones.reservar(validacionId, actor.id, ahora, hasta))) {
      throw new ConflictException('El caso ya está reservado por otro funcionario');
    }
    await this.auditar(AccionAuditada.CAMARA_ASIGNADA, validacionId, { reservaHasta: hasta.toISOString() }, actor, ahora);
    return this.reservaDe(actor.id, hasta, actor.correo, actor.id, ahora);
  }

  /** Libera la reserva propia; coordinación y administración pueden liberar la de otra persona (queda auditado). */
  async liberar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ReservaCamaraDto> {
    await this.cargarCaso(validacionId, actor);
    const administrativa = esSupervisorRevisionCamara(actor.rol);
    if (!(await this.validaciones.liberarReserva(validacionId, actor.id, ahora, administrativa))) {
      throw new ConflictException('El caso no tiene una reserva que usted pueda liberar');
    }
    await this.auditar(AccionAuditada.CAMARA_LIBERADA, validacionId, { administrativa }, actor, ahora);
    return { estado: 'libre', por: null, hasta: null, minutosRestantes: null };
  }

  /** Elige y reserva el caso libre de mayor prioridad; cada reserva es atómica: si otra persona se adelanta, se prueba el siguiente. */
  async tomarSiguiente(actor: Actor, dto: TomarSiguienteCamaraDto = {}, ahora: Date = new Date()): Promise<ResultadoTomarSiguienteCamaraDto> {
    this.exigirOperador(actor);
    const filas = await this.validaciones.listarMesaRut({ tipos: TIPOS_CAMARA, estados: [Estado.REVISION], escuelas: this.alcance(actor) });
    const candidatos = filas
      .filter((f) => !this.reservaVigenteAjena(f, actor.id, ahora))
      .filter((f) => !this.inconsistente(f.estadoDocumento))
      .filter((f) => (dto.conDiscrepancias ? f.hayDiscrepancia === (dto.conDiscrepancias === 'si') : true))
      .filter((f) => (dto.documentoIncorrecto === 'si' ? this.recomendacionDe(f) === RecomendacionCamara.DOCUMENTO_INCORRECTO : true))
      .map((f) => ({ f, p: this.prioridadDe(f, ahora) }))
      .sort((a, b) => b.p.puntaje - a.p.puntaje || (a.f.recibidaEn?.getTime() ?? 0) - (b.f.recibidaEn?.getTime() ?? 0));
    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_CAMARA_MS);
    for (const { f } of candidatos) {
      if (await this.validaciones.reservar(f.validacionId, actor.id, ahora, hasta)) {
        await this.auditar(AccionAuditada.CAMARA_ASIGNADA, f.validacionId, { reservaHasta: hasta.toISOString(), origen: 'siguiente' }, actor, ahora);
        return { estado: 'tomado', validacionId: f.validacionId };
      }
    }
    return { estado: 'sin_casos', validacionId: null };
  }

  // ── Bandeja ──────────────────────────────────────────────────────────────

  private recomendacionDe(f: FilaMesaRut): RecomendacionCamara {
    return recomendacionCamara({
      tipoDetectado: f.tipoDetectado as never, expectativa: f.expectativa, lecturaDudosa: f.lecturaDudosa,
      comparacion: f.veredicto
        ? {
          veredicto: f.veredicto, hayDiscrepancia: f.hayDiscrepancia, discrepanciaImportante: f.discrepanciaImportante ?? false,
          senales: f.estadoCancelado ? ['estado_registral_cancelado'] : [],
        }
        : null,
    });
  }

  private prioridadDe(f: FilaMesaRut, ahora: Date) {
    return calcularPrioridadCamara({ recomendacion: this.recomendacionDe(f), version: f.version, recibidaEn: f.recibidaEn ?? f.cargadoEn, fechaInicio: f.fechaInicio }, ahora);
  }

  async listar(actor: Actor, q: Record<string, string | undefined> = {}, ahora: Date = new Date()): Promise<ListadoBandejaCamaraDto> {
    this.exigirOperador(actor);
    // La bandeja operativa lista lo que se puede revisar. Los demás estados los pide solo supervisión.
    const validos = Object.values(Estado) as string[];
    const pedidos = q.estado && esSupervisorRevisionCamara(actor.rol) ? q.estado.split(',').filter((e) => validos.includes(e)) : [Estado.REVISION as string];
    const filas = await this.validaciones.listarMesaRut({ tipos: TIPOS_CAMARA, estados: pedidos.length > 0 ? pedidos : [Estado.REVISION], escuelas: this.alcance(actor) });
    const items = filas
      .filter((f) => this.pasaFiltros(f, q, actor, ahora))
      .map((f) => this.aItem(f, actor, ahora))
      .sort((a, b) => b.prioridad.puntaje - a.prioridad.puntaje || a.fechaCarga.localeCompare(b.fechaCarga));
    const abiertas = filas.filter((f) => f.estado === (Estado.REVISION as string));
    const esPersonaOTipoDistinto = (f: FilaMesaRut): boolean => [RecomendacionCamara.PERSONA_DISTINTA, RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE].includes(this.recomendacionDe(f));
    return {
      kpis: {
        abiertas: abiertas.length,
        libres: abiertas.filter((f) => !this.reservaVigente(f, ahora)).length,
        mias: abiertas.filter((f) => f.asignadoA === actor.id && this.reservaVigente(f, ahora)).length,
        tomadas: abiertas.filter((f) => this.reservaVigente(f, ahora)).length,
        porVencer: abiertas.filter((f) => this.reservaVigente(f, ahora) && (f.reservaHasta as Date).getTime() <= ahora.getTime() + MINUTOS_RESERVA_POR_VENCER * MINUTO_MS).length,
        conDiscrepancia: abiertas.filter((f) => f.hayDiscrepancia || f.discrepanciaImportante).length,
        documentoIncorrecto: abiertas.filter((f) => this.recomendacionDe(f) === RecomendacionCamara.DOCUMENTO_INCORRECTO).length,
        lecturaDudosa: abiertas.filter((f) => f.lecturaDudosa).length,
        personaDistinta: abiertas.filter(esPersonaOTipoDistinto).length,
      },
      total: items.length,
      items,
    };
  }

  private pasaFiltros(f: FilaMesaRut, q: Record<string, string | undefined>, actor: Actor, ahora: Date): boolean {
    const hayDif = f.hayDiscrepancia || (f.discrepanciaImportante ?? false);
    if (q.tipoPersona && f.tipoPersona !== q.tipoPersona) return false;
    if (q.conDiscrepancias === 'si' && !hayDif) return false;
    if (q.conDiscrepancias === 'no' && hayDif) return false;
    if (q.documentoIncorrecto === 'si' && this.recomendacionDe(f) !== RecomendacionCamara.DOCUMENTO_INCORRECTO) return false;
    if (q.lecturaDudosa === 'si' && !f.lecturaDudosa) return false;
    if (q.personaDistinta === 'si' && ![RecomendacionCamara.PERSONA_DISTINTA, RecomendacionCamara.TIPO_CERTIFICADO_DIFERENTE].includes(this.recomendacionDe(f))) return false;
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

  private aItem(f: FilaMesaRut, actor: Actor, ahora: Date): ItemBandejaCamaraDto {
    const recibida = f.recibidaEn ?? f.cargadoEn;
    const recomendacion = this.recomendacionDe(f);
    const resumen = resumenHumanoCamara(recomendacion);
    return {
      validacionId: f.validacionId, practicaId: f.practicaId, estudianteId: f.estudianteId, documentoId: f.documentoId, tipo: 'camara_comercio',
      estado: f.estado, estadoHumano: { etiqueta: resumen.etiqueta, nivel: resumen.nivel },
      reserva: this.reservaDe(f.asignadoA, f.reservaHasta, f.asignadoNombre, actor.id, ahora), problemaPrincipal: resumen.problemaPrincipal,
      fechaCarga: recibida.toISOString(),
      estudiante: { nombre: f.estudianteNombre }, modalidad: f.modalidad ?? null, empresa: f.empresaRazonSocial,
      tipoEsperado: f.tipoDocumento, tipoDetectado: f.tipoDetectado, tipoCertificado: tipoCertificadoDe(f.tipoPersona),
      personaDistinta: recomendacion === RecomendacionCamara.PERSONA_DISTINTA,
      version: f.version, esReenvio: f.version > 1, hayDiscrepancia: f.hayDiscrepancia, representanteDiferente: f.discrepanciaImportante ?? false,
      matriculaCancelada: f.estadoCancelado ?? false, lecturaDudosa: f.lecturaDudosa, lecturaOcr: f.metodoLectura === 'ocr' || f.metodoLectura === 'hibrido',
      recomendacion, prioridad: this.prioridadDe(f, ahora),
      diasEnBandeja: Math.max(0, Math.floor((ahora.getTime() - recibida.getTime()) / DIA_MS)),
      datosSipraCambiaronDespuesDeDecision: f.datosSipraCambiaronEn !== null,
      inconsistenciaOperativa: f.estado === (Estado.REVISION as string) && this.inconsistente(f.estadoDocumento),
    };
  }

  // ── Lo que SIPRA dice hoy ────────────────────────────────────────────────

  private async datosSipra(practica: Practica): Promise<{ sipra: SipraParaCamara; empresaNit: string | null; empresaRazon: string | null }> {
    const dp = practica.instantanea();
    const empresa = dp.empresaId ? await this.empresas.buscarPorId(dp.empresaId) : null;
    const e = empresa?.instantanea() ?? null;
    const sipra = datosSipraParaCamara({
      empresa: e ? { nitNumero: e.nitNumero, nitDv: e.nitDv, razonSocial: e.razonSocial, representanteLegal: e.representanteLegal } : null,
      formulario: { razonSocial: dp.empresaRazonSocial ?? null, nit: dp.empresaNit ?? null },
    });
    // Un NIT con DV inconsistente en la empresa (dato histórico) no tumba la pantalla: se muestra tal cual está guardado.
    const nitVisible = e ? (() => { try { return empresa!.nit.formateado; } catch { return `${e.nitNumero}-${e.nitDv}`; } })() : (dp.empresaNit ?? null);
    return { sipra, empresaNit: nitVisible, empresaRazon: empresa?.razonSocial ?? dp.empresaRazonSocial ?? null };
  }

  /**
   * Antes de revisar un caso abierto se recalcula la comparación con la lectura ya guardada (sin releer el PDF). Devuelve la
   * validación al día y si el recálculo cambió algo (SIPRA cambió desde la última comparación).
   */
  private async actualizarComparacion(v: ValidacionDocumentoEmpresarial, actor: Actor, ahora: Date): Promise<{ v: ValidacionDocumentoEmpresarial; recalculada: boolean }> {
    if (!v.estaRevisable) return { v, recalculada: false };
    const antes = (v.instantanea().comparacion as ComparacionCamara | null)?.huellaSipra ?? null;
    const actualizada = (await this.camara.recalcularComparacionCamara(v.instantanea().documentoId, ahora)) ?? v;
    const despues = (actualizada.instantanea().comparacion as ComparacionCamara | null)?.huellaSipra ?? null;
    const recalculada = antes !== despues;
    if (recalculada) await this.auditar(AccionAuditada.CAMARA_RECALCULADA, v.id, { origen: 'revision' }, actor, ahora);
    return { v: actualizada, recalculada };
  }

  /**
   * Si SIPRA cambió DESPUÉS de una decisión, la decisión no se toca: se deja constancia UNA vez (evidencia + auditoría) y la Mesa lo
   * avisa. Los cambios posteriores solo se muestran en vivo.
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
      await this.auditar(AccionAuditada.CAMARA_DATOS_CAMBIARON_TRAS_DECISION, d.id, { estadoDecision: d.estado }, actor, ahora);
    }
    return (await this.validaciones.buscarPorId(d.id)) ?? v;
  }

  // ── Detalle ──────────────────────────────────────────────────────────────

  async detalle(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<DetalleCamaraDto> {
    const caso = await this.cargarCaso(validacionId, actor);
    const { practica, documento } = caso;
    let { v } = caso;
    const actualizado = await this.actualizarComparacion(v, actor, ahora);
    v = actualizado.v;

    const { sipra, empresaNit, empresaRazon } = await this.datosSipra(practica);
    const guardada = v.instantanea().comparacion as ComparacionCamara | null;
    const sipraCambio = guardada?.huellaSipra ? sipraCambioDespuesCamara(guardada, sipra) : false;
    if (v.estaDecidida && sipraCambio) v = await this.registrarCambioPosteriorADecision(v, actor, ahora);

    const d = v.instantanea();
    const doc = documento.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    const valores = this.puedeVerValores(d, actor, ahora);
    const asignado = d.asignadoA ? (await this.usuarios.buscarPorId(d.asignadoA))?.nombre ?? null : null;
    const maxVersion = await this.validaciones.versionMaximaDocumento(d.practicaId, doc.tipo);
    const vigente = doc.version >= maxVersion;
    const reserva = this.reservaDe(d.asignadoA, d.reservaHasta, asignado, actor.id, ahora);

    const recomendacion = recomendacionCamara({
      tipoDetectado: d.tipoDetectado, expectativa: d.expectativa, lecturaDudosa: d.lecturaDudosa,
      comparacion: guardada
        ? { veredicto: guardada.veredicto, hayDiscrepancia: guardada.hayDiscrepancia, discrepanciaImportante: guardada.discrepanciaImportante ?? false, senales: guardada.senales ?? [] }
        : null,
    });
    const resumen = resumenHumanoCamara(recomendacion);
    const prioridad = calcularPrioridadCamara({ recomendacion, version: doc.version, recibidaEn: d.recibidaEn ?? doc.cargadoEn, fechaInicio: practica.instantanea().fechaInicio ?? null }, ahora);
    const inconsistencia = d.estado === Estado.REVISION && this.inconsistente(doc.estado);
    const datos = d.datosExtraidos as DatosCamaraExtraidos | null;
    const esNatural = d.tipoPersona === TipoPersona.NATURAL;
    const ocr = d.metodoLectura === 'ocr' || d.metodoLectura === 'hibrido';
    const aviso = d.lecturaDudosa ? (ocr ? AVISO_CAMARA_LECTURA_OCR : AVISO_CAMARA_LECTURA_DUDOSA) : null;

    const campos = guardada?.campos ?? [];
    const fila = (c: CampoComparacionCamara): CampoComparadoCamaraDto => this.aCampo(c, datos, sipra, esNatural, d.lecturaDudosa, aviso, valores);
    const criticos = campos.filter((c) => c.criticidad === 'critico' && ['nit', 'dv', 'nombre', 'razon_social'].includes(c.campo)).map(fila);
    const repCampo = campos.find((c) => c.campo === 'representante_legal');
    const representante = repCampo && !esNatural ? this.aRepresentante(fila(repCampo)) : null;

    const aut = d.autenticidad;
    const antiguedad = datos ? evaluarCamara(datos, ahora, POLITICA_CAMARA_POR_DEFECTO).antiguedad : null;
    const estadoRegistral = datos?.estadoRegistral ?? EstadoRegistral.NO_DETERMINABLE;
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
    const avisoSipra = sipraCambio || actualizado.recalculada || d.datosSipraCambiaronEn !== null ? AVISO_CAMARA_DATOS_SIPRA_CAMBIARON : null;
    const aprobarExigeJustificacion = recomendacion !== RecomendacionCamara.CONSISTENTE;

    return {
      validacionId: d.id, practicaId: d.practicaId, estudianteId: d.estudianteId, documentoId: d.documentoId, tipo: 'camara_comercio', estado: d.estado,
      estadoHumano: { etiqueta: resumen.etiqueta, nivel: resumen.nivel }, reserva, problemaPrincipal: resumen.problemaPrincipal,
      fechaCarga: (d.recibidaEn ?? doc.cargadoEn).toISOString(),
      version: doc.version, vigente, recomendacion, resumen, prioridad,
      puedeDecidir: d.estado === Estado.REVISION && vigente && reserva.estado === 'mia' && !inconsistencia,
      aprobarExigeJustificacion, minimoJustificacionAprobar: aprobarExigeJustificacion ? JUSTIFICACION_REFORZADA : 0, minimoJustificacionRechazar: JUSTIFICACION_MINIMA,
      tipoEsperado: d.tipoEsperado, tipoDetectado: d.tipoDetectado, tipoCertificado: tipoCertificadoDe(d.tipoPersona),
      certificado: datos ? CERTIFICADO[datos.tipoCertificado] ?? null : null,
      lectura: { metodo: d.metodoLectura === 'ocr' || d.metodoLectura === 'hibrido' ? 'ocr' : d.metodoLectura === 'texto' ? 'texto' : null, dudosa: d.lecturaDudosa, aviso },
      estudiante: { nombre: estudiante?.nombre ?? '' },
      practica: { empresa: empresaRazon, nit: valores ? empresaNit : empresaNit ? enmascarar(empresaNit) : null, modalidad: practica.instantanea().modalidad ?? null },
      criticos, representante,
      informativos: this.informativos(datos),
      estadoRegistral: {
        estado: estadoRegistral, etiqueta: ETIQUETA_ESTADO_REGISTRAL[estadoRegistral] ?? 'No determinable',
        alerta: estadoRegistral === EstadoRegistral.CANCELADO && !d.lecturaDudosa ? ALERTA_CANCELADA : null,
      },
      renovacion: { ultimoAnioRenovado: datos?.ultimoAnioRenovado ?? null, fechaRenovacion: datos?.fechaRenovacion ?? null },
      expedicion: {
        fecha: datos?.fechaExpedicion ?? null, diasDesdeExpedicion: antiguedad?.diasDesdeExpedicion ?? null,
        politicaDias: antiguedad?.politicaDias ?? null, cumplePolitica: antiguedad?.cumplePolitica ?? null,
      },
      verificacion: {
        codigoDetectado: !!datos?.codigoVerificacion || aut.codigoVerificacionPresente === true,
        urlDetectada: !!datos?.urlVerificacion || aut.urlVerificacionPresente === true,
        firmaPdfPresente: datos?.firmaPdfPresente ?? aut.firmaPdfPresente ?? null,
        disponibleHasta: datos?.verificacionDisponibleHasta ?? null,
        // Nunca «auténtico»: la autenticidad sigue sin verificarse.
        autenticidad: { estado: aut.estado, etiqueta: 'No verificada', aviso: AVISO_AUTENTICIDAD },
      },
      comparacion: guardada ? { veredicto: guardada.veredicto, calculadaEn: guardada.calculadaEn } : null,
      avisoDatosSipra: avisoSipra,
      datosSipraCambiaronEn: d.datosSipraCambiaronEn ? d.datosSipraCambiaronEn.toISOString() : null,
      decision: d.decididoEn ? { estado: d.estado, por: decididoPor, en: d.decididoEn.toISOString(), motivo: d.motivoDecision } : null,
      versiones,
      historial: evidencias.map((e) => ({
        fecha: e.fecha.toISOString(), tipo: e.tipo, etiqueta: ETIQUETA_EVENTO[e.tipo], resultado: e.resultado, ronda: e.intento, actor: e.actorId ? nombres.get(e.actorId) ?? null : null,
      })),
      inconsistenciaOperativa: inconsistencia ? { estadoDocumento: doc.estado, mensaje: MENSAJE_INCONSISTENCIA } : null,
    };
  }

  /** Una fila CAMPO | SIPRA | CÁMARA | RESULTADO. Un campo crítico sin poder compararse NUNCA se muestra como «No coincide». */
  private aCampo(c: CampoComparacionCamara, datos: DatosCamaraExtraidos | null, sipra: SipraParaCamara, esNatural: boolean, dudosa: boolean, aviso: string | null, valores: boolean): CampoComparadoCamaraDto {
    const e = sipra.empresa;
    const por: Record<string, [string | null, string | null, string]> = {
      nit: [e?.nitNumero ?? null, datos?.nit ?? null, esNatural ? 'Identificación / NIT' : 'NIT'],
      dv: [e?.nitDv !== null && e?.nitDv !== undefined ? String(e.nitDv) : null, datos?.dv ?? null, 'Dígito de verificación'],
      nombre: [e?.razonSocial ?? null, datos?.nombreORazonSocial ?? null, 'Nombre del comerciante'],
      razon_social: [e?.razonSocial ?? null, datos?.nombreORazonSocial ?? null, 'Razón social'],
      representante_legal: [e?.representanteLegal ?? null, datos?.representanteLegal ?? null, 'Representante legal'],
    };
    const [sipraValor, camaraValor, etiqueta] = por[c.campo] ?? [null, null, c.campo];
    const oculto = !valores && c.campo === 'nit';
    return {
      campo: c.campo, etiqueta,
      sipra: oculto && sipraValor ? enmascarar(sipraValor) : sipraValor, camara: oculto && camaraValor ? enmascarar(camaraValor) : camaraValor,
      resultado: c.resultado, resultadoTexto: TEXTO_RESULTADO[c.resultado], criticidad: c.criticidad, causa: causaHumana(c.nota),
      advertencia: dudosa && c.criticidad === 'critico' ? aviso : null,
    };
  }

  /** El representante es importante, no crítico: avisa cuando difiere y señala el dato pendiente de contraste humano. */
  private aRepresentante(campo: CampoComparadoCamaraDto): CampoComparadoCamaraDto & { aviso: string | null } {
    const aviso = campo.resultado === 'diferente'
      ? 'El representante legal del certificado es distinto del registrado en SIPRA: revíselo antes de decidir.'
      : campo.resultado === 'informacion_insuficiente' ? 'Dato importante pendiente de contraste humano.' : null;
    return { ...campo, aviso };
  }

  private informativos(datos: DatosCamaraExtraidos | null): CampoInformativoCamaraDto[] {
    return [
      { campo: 'matricula', etiqueta: 'Matrícula mercantil', valor: datos?.matricula ?? null },
      { campo: 'camara', etiqueta: 'Cámara de Comercio', valor: datos?.camara ?? null },
      { campo: 'fecha_matricula', etiqueta: 'Fecha de matrícula', valor: datos?.fechaMatricula ?? null },
      { campo: 'domicilio', etiqueta: 'Domicilio', valor: datos?.domicilioMunicipio ?? null },
      { campo: 'ciiu', etiqueta: 'Actividad económica (CIIU)', valor: datos?.ciiu ?? null },
    ];
  }

  // ── Archivo ──────────────────────────────────────────────────────────────

  /** El archivo se sirve por la sesión autenticada (sin URL permanente) y solo a quien tiene el caso tomado o supervisa. */
  async archivo(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<{ contenido: Buffer; mime: string; nombre: string }> {
    const { v, documento } = await this.cargarCaso(validacionId, actor);
    if (!this.puedeVerValores(v.instantanea(), actor, ahora)) throw new ConflictException('Tome el caso antes de abrir el certificado');
    const doc = documento.instantanea();
    const contenido = await this.almacen.leer(doc.rutaAlmacenamiento);
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.DOCUMENTO_VISUALIZADO, entidad: 'documento',
      entidadId: doc.id, justificacion: null, metadatos: { tamanoBytes: contenido.length, origen: 'mesa_camara' }, ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    return { contenido, mime: doc.mimeReal, nombre: doc.nombreOriginal };
  }

  // ── Decisión ─────────────────────────────────────────────────────────────

  async decidir(validacionId: string, actor: Actor, dto: DecisionCamaraDto, ahora: Date = new Date()): Promise<DocumentoRespuestaDto> {
    const caso = await this.cargarCaso(validacionId, actor);
    const { documento } = caso;
    let { v } = caso;
    let d = v.instantanea();
    if (v.estaDecidida) throw new ConflictException('El caso ya fue decidido');
    if (!v.estaRevisable) {
      throw new ConflictException(d.estado === Estado.ERROR
        ? 'El procesamiento del certificado falló: debe reintentarse antes de decidir'
        : 'El certificado todavía se está procesando: espere a que esté listo para revisión');
    }
    if (documento.instantanea().version < (await this.validaciones.versionMaximaDocumento(d.practicaId, documento.tipo))) {
      throw new ConflictException('El estudiante cargó una versión más reciente del certificado: revise esa versión');
    }
    // La reserva se vuelve a validar aquí, en el servidor, aunque la pantalla creyera tenerla.
    if (d.asignadoA === null || d.reservaHasta === null || d.reservaHasta.getTime() <= ahora.getTime()) {
      throw new ConflictException('Su reserva del caso venció: tómelo de nuevo antes de decidir');
    }
    if (d.asignadoA !== actor.id) throw new ConflictException('El caso está reservado por otro funcionario');

    // Antes de decidir un caso abierto, la comparación se recalcula con lo que SIPRA dice HOY (sin releer el PDF).
    v = (await this.actualizarComparacion(v, actor, ahora)).v;
    d = v.instantanea();
    const comparacion = d.comparacion as ComparacionCamara | null;
    const recomendacion = recomendacionCamara({
      tipoDetectado: d.tipoDetectado, expectativa: d.expectativa, lecturaDudosa: d.lecturaDudosa,
      comparacion: comparacion
        ? { veredicto: comparacion.veredicto, hayDiscrepancia: comparacion.hayDiscrepancia, discrepanciaImportante: comparacion.discrepanciaImportante ?? false, senales: comparacion.senales ?? [] }
        : null,
    });

    // La recomendación NUNCA bloquea una decisión humana válida: solo sube el listón de la justificación.
    const { apartaDeRecomendacion, minimoJustificacion, motivo: motivoApartamiento } = evaluarApartamientoCamara(dto.decision, recomendacion);
    let justificacion = (dto.justificacion ?? '').trim();
    let motivoDevolucion: MotivoDevolucionCamara | null = null;
    if (dto.decision === 'devolver') {
      if (!dto.motivo || !esMotivoDevolucionCamara(dto.motivo)) throw new BadRequestException('Elija el motivo de la devolución');
      if (!motivoCamaraAplicaA(dto.motivo, d.tipoPersona ?? null)) throw new BadRequestException('Ese motivo no aplica a este tipo de certificado');
      if (dto.motivo === MotivoDevolucionCamara.OTRO && justificacion.length < JUSTIFICACION_MINIMA) {
        throw new BadRequestException(`Explique al estudiante qué debe corregir (al menos ${JUSTIFICACION_MINIMA} caracteres)`);
      }
      motivoDevolucion = dto.motivo;
      justificacion = mensajeDevolucionCamara(dto.motivo, justificacion || null);
    } else if (dto.decision === 'rechazar') {
      // Rechazar cierra la versión: exige confirmación explícita y justificación.
      if (dto.confirmar !== true) throw new BadRequestException('Rechazar cierra esta versión del certificado: confirme el rechazo de forma explícita');
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
      justificacion = 'Certificado de Cámara de Comercio revisado y aprobado en la Mesa de Cámara.';
    }

    // UNA operación atómica (documento + validación + evidencia + auditoría, o nada). Con decisiones simultáneas solo una confirma.
    return this.gestionar.decidir(d.documentoId, { decision: dto.decision, justificacion }, actor, {
      mesaCamara: {
        validacionId: d.id, motivo: motivoDevolucion, ahora,
        contexto: {
          decision: dto.decision, recomendacion, apartaDeRecomendacion, motivoDevolucion, hayDiscrepancia: comparacion?.hayDiscrepancia ?? false,
          discrepanciaImportante: comparacion?.discrepanciaImportante ?? false,
        },
      },
    });
  }

  /** Los motivos de devolución permitidos, con lo que leerá el estudiante: la pantalla no mantiene una copia. */
  motivosDevolucion(actor: Actor): MotivoDevolucionCamaraCatalogo[] {
    this.exigirOperador(actor);
    return catalogoMotivosDevolucionCamara();
  }

  // ── Supervisión ──────────────────────────────────────────────────────────

  async supervision(actor: Actor, ahora: Date = new Date()): Promise<SupervisionCamaraDto> {
    if (!esSupervisorRevisionCamara(actor.rol)) throw new ForbiddenException('Solo coordinación y administración supervisan la Mesa de Cámara de Comercio');
    return this.validaciones.supervisionRut(ahora, this.alcance(actor), TIPOS_CAMARA);
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor: Actor, ahora: Date): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: ENTIDAD, entidadId,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
  }
}
