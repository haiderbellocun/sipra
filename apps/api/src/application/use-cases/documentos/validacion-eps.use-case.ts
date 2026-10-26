import {
  ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { Documento, EstadoDocumento, SeveridadBandera, TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps,
} from '../../../domain/entities/evidencia-validacion-eps.entity';
import {
  DecisionEps, EstadoProcesamientoEps, ValidacionEps, ValidacionEpsYaDecididaError,
} from '../../../domain/entities/validacion-eps.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  VALIDACION_EPS_REPOSITORY, ValidacionEpsRepositoryPort,
} from '../../../domain/ports/out/validacion-eps.port';
import {
  CampoLeido, compararCertificadoEps, construirDatosExtraidosEps,
} from '../../../domain/services/comparacion-eps.domain-service';
import {
  esSupervisorEps, puedeOperarValidacionEps, puedeVerResultadoEps,
} from '../../../domain/value-objects/acceso-eps.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  EvidenciaEpsDto, ValidacionEpsEstudianteDto, ValidacionEpsOperacionDto,
} from '../../dtos/validacion-eps.dto';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { Actor } from '../practicas/gestionar-practica.use-case';

/** Cuánto dura la reserva de un caso. Si el funcionario la abandona, vence sola. */
export const DURACION_RESERVA_EPS_MS = 15 * 60_000;

const DECISION_POR_ACCION: Record<'aprobar' | 'devolver' | 'rechazar', DecisionEps> = {
  aprobar: DecisionEps.APROBADO_MANUAL,
  devolver: DecisionEps.DEVUELTO,
  rechazar: DecisionEps.RECHAZADO,
};

/**
 * Validación del certificado de EPS.
 *
 * En esta fase el flujo es LOCAL y determinístico: lee lo que el procesamiento
 * local ya extrajo, lo normaliza y lo compara con el estudiante. No consulta
 * ninguna fuente externa ni envía el certificado a un proveedor de IA. La
 * autenticidad y la afiliación quedan «no evaluada» y «no contrastada» hasta que
 * existan verificadores reales; nada se autoaprueba.
 *
 * Los registros técnicos no llevan cédula, nombre ni contenido del certificado:
 * la auditoría referencia por identificadores.
 */
@Injectable()
export class ValidacionEpsUseCase {
  private readonly log = new Logger(ValidacionEpsUseCase.name);

  constructor(
    @Inject(VALIDACION_EPS_REPOSITORY) private readonly validaciones: ValidacionEpsRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    private readonly parametros: ParametrosUseCase,
  ) {}

  // ── Procesamiento (lo invoca el worker) ──────────────────────────────────

  /**
   * Registra el resultado del procesamiento local de un certificado de EPS.
   * Idempotente: una validación ya procesada, decidida o procesada a la vez por
   * otro proceso no se repite ni duplica evidencia ni auditoría.
   */
  async registrarProcesamiento(documento: Documento, ahora: Date = new Date()): Promise<ValidacionEps | null> {
    if (documento.tipo !== TipoDocumento.CERTIFICADO_EPS) return null;
    const datos = documento.instantanea();
    // Mientras el pipeline no haya terminado no hay resultado que registrar.
    if ([EstadoDocumento.RECIBIDO, EstadoDocumento.ANALIZANDO].includes(datos.estado)) return null;

    let validacion = await this.validaciones.buscarPorDocumento(datos.id);
    if (validacion?.estadoProcesamiento === EstadoProcesamientoEps.PROCESADO) return validacion;

    const practica = await this.practicas.buscarPorId(datos.practicaId);
    if (!practica) return null;
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);

    if (!validacion) {
      const nueva = ValidacionEps.pendiente({
        id: randomUUID(), documentoId: datos.id, practicaId: datos.practicaId,
        estudianteId: practica.estudianteId, ahora,
      });
      const { validacion: existente, creada } = await this.validaciones.crearSiNoExiste(nueva.instantanea());
      validacion = existente;
      if (creada) await this.auditar(AccionAuditada.VALIDACION_EPS_INICIADA, validacion.id, { documentoId: datos.id });
    }
    // Otro proceso ya la procesó, o una persona ya la decidió: nada que hacer.
    if (validacion.estadoProcesamiento === EstadoProcesamientoEps.PROCESADO || validacion.estaDecidida) return validacion;

    const campos = ((datos.extraccion as { campos?: Record<string, CampoLeido> } | null)?.campos ?? {});
    const extraidos = construirDatosExtraidosEps(campos);
    const comparacion = compararCertificadoEps(
      extraidos,
      { numeroDocumento: estudiante?.instantanea().documento ?? null, nombre: estudiante?.nombre ?? null },
      { ahora, diasVigencia: await this.parametros.numero('arl.dias_vigencia_eps') },
    );
    const hayBanderaCritica = datos.banderas.some((b) => b.severidad === SeveridadBandera.CRITICA);

    const versionLeida = validacion.version;
    validacion.registrarProcesamiento(
      {
        datosExtraidos: extraidos,
        coincidencia: comparacion.coincidencia,
        discrepancias: comparacion.discrepancias,
        vigencia: comparacion.vigencia,
        hayBanderaCritica,
      },
      ahora,
    );
    // Compare-and-set por versión: si otro proceso la tocó, no se pisa ni se duplica.
    if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) {
      this.log.warn(`Validación ${validacion.id}: la modificó otro proceso; se conserva su resultado`);
      return (await this.validaciones.buscarPorId(validacion.id)) ?? validacion;
    }

    const leidos = Object.entries(campos).filter(([, c]) => c.valor !== null).map(([nombre]) => nombre);
    await this.validaciones.agregarEvidencia(EvidenciaEps.crear({
      id: randomUUID(),
      validacionEpsId: validacion.id,
      tipo: TipoEvidenciaEps.TEXTO_PDF,
      fuente: FuenteEvidenciaEps.CERTIFICADO,
      metodo: 'extraccion_local_texto_pdf',
      resultado: leidos.length > 0 ? 'leido' : 'sin_lectura',
      fechaVerificacion: ahora,
      hashEvidencia: datos.hashSha256,
      origen: null,
      // Solo QUÉ campos se leyeron, no sus valores: el contenido del certificado no se duplica aquí.
      datosObtenidos: { camposLeidos: leidos, camposEsperados: Object.keys(campos).length, procesamiento: 'local' },
      errorCodigo: null,
      verificadoPor: null,
      creadoEn: ahora,
    }).instantanea());

    await this.auditar(AccionAuditada.VALIDACION_EPS_PROCESADA, validacion.id, {
      documentoId: datos.id,
      coincidencia: comparacion.coincidencia,
      vigencia: comparacion.vigencia,
      discrepancias: comparacion.discrepancias.length,
      ruta: validacion.ruta,
    });
    await this.auditar(AccionAuditada.EVIDENCIA_EPS_REGISTRADA, validacion.id, {
      tipo: TipoEvidenciaEps.TEXTO_PDF, fuente: FuenteEvidenciaEps.CERTIFICADO,
    });
    return (await this.validaciones.buscarPorId(validacion.id)) ?? validacion;
  }

  // ── Consulta ─────────────────────────────────────────────────────────────

  /** El estudiante recibe un resultado reducido; quien opera, el detalle. */
  async consultarPorDocumento(
    documentoId: string, actor: Actor,
  ): Promise<ValidacionEpsEstudianteDto | ValidacionEpsOperacionDto> {
    if (!puedeVerResultadoEps(actor.rol)) {
      throw new ForbiddenException('Su perfil no consulta la validación de EPS');
    }
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || documento.tipo !== TipoDocumento.CERTIFICADO_EPS) {
      throw new NotFoundException('Documento no encontrado');
    }
    await this.exigirPracticaVisible(documento.practicaId, actor);

    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (!validacion) throw new NotFoundException('Aún no hay validación para este documento');
    return actor.rol === Rol.ESTUDIANTE ? this.aDtoEstudiante(validacion) : this.aDtoOperacion(validacion);
  }

  async evidencias(validacionId: string, actor: Actor): Promise<EvidenciaEpsDto[]> {
    this.exigirOperador(actor);
    const validacion = await this.cargar(validacionId);
    await this.exigirPracticaVisible(validacion.practicaId, actor);
    return (await this.validaciones.listarEvidencias(validacionId)).map((e) => {
      const d = e.instantanea();
      return {
        id: d.id, tipo: d.tipo, fuente: d.fuente, metodo: d.metodo, resultado: d.resultado,
        fechaVerificacion: d.fechaVerificacion.toISOString(), origen: d.origen,
        datosObtenidos: d.datosObtenidos, errorCodigo: d.errorCodigo, verificadoPor: d.verificadoPor,
      };
    });
  }

  // ── Reserva ──────────────────────────────────────────────────────────────

  /** Toma el caso: una sola reserva vigente por validación, atómica en la base. */
  async reservar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ValidacionEpsOperacionDto> {
    this.exigirOperador(actor);
    const validacion = await this.cargar(validacionId);
    await this.exigirPracticaVisible(validacion.practicaId, actor);
    if (validacion.estaDecidida) throw new ConflictException('El caso ya fue decidido');

    const hasta = new Date(ahora.getTime() + DURACION_RESERVA_EPS_MS);
    if (!(await this.validaciones.reservar(validacionId, actor.id, ahora, hasta))) {
      throw new ConflictException('El caso ya está reservado por otro funcionario');
    }
    await this.auditar(AccionAuditada.VALIDACION_EPS_ASIGNADA, validacionId, { reservaHasta: hasta.toISOString() }, actor);
    return this.aDtoOperacion(await this.cargar(validacionId));
  }

  /** Libera la reserva propia; coordinación y administración pueden liberar la de otro. */
  async liberar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ValidacionEpsOperacionDto> {
    this.exigirOperador(actor);
    const validacion = await this.cargar(validacionId);
    await this.exigirPracticaVisible(validacion.practicaId, actor);
    if (!(await this.validaciones.liberarReserva(validacionId, actor.id, ahora, esSupervisorEps(actor.rol)))) {
      throw new ConflictException('El caso no tiene una reserva que usted pueda liberar');
    }
    await this.auditar(AccionAuditada.VALIDACION_EPS_LIBERADA, validacionId, {}, actor);
    return this.aDtoOperacion(await this.cargar(validacionId));
  }

  /** Si otro funcionario tiene el caso reservado y su reserva sigue vigente, no se decide por encima. */
  async exigirSinReservaAjena(documentoId: string, actor: Actor, ahora: Date = new Date()): Promise<void> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (validacion?.reservadaPorOtro(actor.id, ahora)) {
      throw new ConflictException('El caso está reservado por otro funcionario');
    }
  }

  // ── Decisión (la dispara la decisión del documento) ──────────────────────

  /**
   * Refleja en la validación la decisión HUMANA ya tomada sobre el documento y
   * deja su evidencia. La decisión del documento es la fuente de verdad (se
   * guardó con compare-and-set); aquí solo se sincroniza.
   */
  async registrarDecisionHumana(
    documento: Documento, accion: 'aprobar' | 'devolver' | 'rechazar', actor: Actor, ahora: Date = new Date(),
  ): Promise<void> {
    if (documento.tipo !== TipoDocumento.CERTIFICADO_EPS) return;
    const datos = documento.instantanea();
    try {
      for (let intento = 0; intento < 3; intento += 1) {
        const validacion = await this.obtenerOCrear(documento, ahora);
        if (!validacion || validacion.estaDecidida) return;
        const versionLeida = validacion.version;
        validacion.registrarDecisionHumana(DECISION_POR_ACCION[accion], actor.id, ahora);
        if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) continue;

        await this.validaciones.agregarEvidencia(EvidenciaEps.crear({
          id: randomUUID(),
          validacionEpsId: validacion.id,
          tipo: TipoEvidenciaEps.REVISION_HUMANA,
          fuente: FuenteEvidenciaEps.REVISION_HUMANA,
          metodo: 'decision_funcionario',
          resultado: DECISION_POR_ACCION[accion],
          fechaVerificacion: ahora,
          hashEvidencia: datos.hashSha256,
          origen: null,
          datosObtenidos: { rol: actor.rol },
          errorCodigo: null,
          verificadoPor: actor.id,
          creadoEn: ahora,
        }).instantanea());
        await this.auditar(AccionAuditada.DECISION_EPS, validacion.id, {
          documentoId: datos.id, decision: DECISION_POR_ACCION[accion],
        }, actor);
        return;
      }
      this.log.warn(`Validación EPS del documento ${datos.id}: no se pudo sincronizar la decisión tras varios intentos`);
    } catch (error) {
      if (error instanceof ValidacionEpsYaDecididaError) return;
      // La decisión del documento ya quedó firme; la sincronización no debe tumbarla.
      this.log.error(`Validación EPS del documento ${datos.id}: falló la sincronización (${(error as Error).name})`);
    }
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private async obtenerOCrear(documento: Documento, ahora: Date): Promise<ValidacionEps | null> {
    const existente = await this.validaciones.buscarPorDocumento(documento.id);
    if (existente) return existente;
    const practica = await this.practicas.buscarPorId(documento.practicaId);
    if (!practica) return null;
    const { validacion } = await this.validaciones.crearSiNoExiste(ValidacionEps.pendiente({
      id: randomUUID(), documentoId: documento.id, practicaId: documento.practicaId,
      estudianteId: practica.estudianteId, ahora,
    }).instantanea());
    return validacion;
  }

  private exigirOperador(actor: Actor): void {
    if (!puedeOperarValidacionEps(actor.rol)) {
      throw new ForbiddenException('Su perfil no opera la validación de EPS');
    }
  }

  private async cargar(validacionId: string): Promise<ValidacionEps> {
    const validacion = await this.validaciones.buscarPorId(validacionId);
    if (!validacion) throw new NotFoundException('Validación no encontrada');
    return validacion;
  }

  /** Misma visibilidad que el expediente: el estudiante la suya, el docente y coordinación su alcance. */
  private async exigirPracticaVisible(practicaId: string, actor: Actor): Promise<void> {
    const practica = await this.practicas.buscarPorId(practicaId);
    const visible = practica?.visiblePara({
      id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId,
    });
    if (!practica || !visible) throw new NotFoundException('Documento no encontrado');
  }

  private aDtoEstudiante(v: ValidacionEps): ValidacionEpsEstudianteDto {
    const resultado =
      v.decision === DecisionEps.APROBADO_MANUAL || v.decision === DecisionEps.APROBADO_AUTOMATICO ? 'aprobado'
        : v.decision === DecisionEps.DEVUELTO ? 'devuelto'
          : v.decision === DecisionEps.RECHAZADO ? 'rechazado' : 'pendiente';
    return { documentoId: v.documentoId, estadoProcesamiento: v.estadoProcesamiento, resultado };
  }

  private aDtoOperacion(v: ValidacionEps): ValidacionEpsOperacionDto {
    const d = v.instantanea();
    return {
      id: d.id,
      documentoId: d.documentoId,
      practicaId: d.practicaId,
      estadoProcesamiento: d.estadoProcesamiento,
      autenticidad: d.autenticidad,
      coincidencia: d.coincidencia,
      afiliacion: d.afiliacion,
      ruta: d.ruta,
      decision: d.decision,
      vigenciaCertificado: d.vigenciaCertificado,
      datosExtraidos: d.datosExtraidos as unknown as Record<string, unknown> | null,
      datosVerificados: d.datosVerificados as unknown as Record<string, unknown> | null,
      discrepancias: d.discrepancias,
      asignadoA: d.asignadoA,
      reservaHasta: d.reservaHasta?.toISOString() ?? null,
      version: d.version,
      actualizadaEn: d.actualizadaEn.toISOString(),
    };
  }

  private async auditar(
    accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor?: Actor,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor?.id ?? null,
      actorCorreo: actor?.correo ?? 'sistema',
      actorRol: actor?.rol ?? 'sistema',
      accion,
      entidad: 'validacion_eps',
      entidadId,
      justificacion: null,
      metadatos,
      ip: actor?.ip ?? null,
      agenteUsuario: actor?.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
  }
}
