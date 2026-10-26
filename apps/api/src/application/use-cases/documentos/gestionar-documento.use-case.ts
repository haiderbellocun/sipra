import {
  BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  DatosDocumento, Documento, EstadoDocumento, MetricasCalidadCaptura, TipoDocumento,
} from '../../../domain/entities/documento.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
  PERIODO_REPOSITORY, PeriodoRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  ALMACENAMIENTO, AlmacenamientoPort, COLA, ColaPort,
} from '../../../domain/ports/out/servicios-externos.port';
import {
  EventoNotificable,
} from '../../../domain/services/plantillas-notificacion.domain-service';
import {
  NotificacionesService,
} from '../../../infrastructure/modules/notificaciones.service';
import { ForenseDomainService } from '../../../domain/services/forense.domain-service';
import {
  HashPerceptualDomainService,
} from '../../../domain/services/hash-perceptual.domain-service';
import {
  SaneamientoPdfDomainService,
} from '../../../domain/services/saneamiento-pdf.domain-service';
import {
  DecodificadorImagenAdapter,
} from '../../../infrastructure/adapters/imagen/decodificador.adapter';
import {
  puedeCargarDocumentos, puedeConsultarDocumentos, puedeVerDocumento,
} from '../../../domain/value-objects/acceso-documental.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import {
  DecisionDocumentoDto, DocumentoRespuestaDto, LecturaAsistidaDto,
} from '../../dtos/documento.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { Practica } from '../../../domain/entities/practica.entity';
import { PipelineValidacionUseCase } from './pipeline-validacion.use-case';
import { BitacoraUseCase } from '../practicas/bitacora.use-case';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { ConsentimientoUseCase } from '../consentimientos/consentimiento.use-case';
import { TipoVentana } from '../../../domain/entities/periodo.entity';

/** Minimización: la imagen del documento de identidad se purga a los 30 días. */
const DIAS_PURGA: Partial<Record<TipoDocumento, number>> = {
  [TipoDocumento.CEDULA]: 30,
};

export interface ArchivoCargado {
  nombreOriginal: string;
  mimeDeclarado: string;
  contenido: Buffer;
}

@Injectable()
export class GestionarDocumentoUseCase {
  private readonly log = new Logger(GestionarDocumentoUseCase.name);
  private readonly forense = new ForenseDomainService();
  private readonly perceptual = new HashPerceptualDomainService();
  private readonly saneamiento = new SaneamientoPdfDomainService();

  constructor(
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly notificaciones: NotificacionesService,
    @Inject(COLA) private readonly cola: ColaPort,
    private readonly pipeline: PipelineValidacionUseCase,
    private readonly decodificador: DecodificadorImagenAdapter,
    private readonly bitacora: BitacoraUseCase,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    private readonly parametros: ParametrosUseCase,
    private readonly consentimientos: ConsentimientoUseCase,
  ) {}

  async cargar(
    practicaId: string,
    tipo: TipoDocumento,
    archivo: ArchivoCargado,
    calidad: MetricasCalidadCaptura | null,
    tamanoMaximoBytes: number,
    actor: Actor,
  ): Promise<DocumentoRespuestaDto> {
    if (!puedeCargarDocumentos(actor.rol)) {
      throw new ForbiddenException('Su perfil no carga documentos en la práctica');
    }
    const practica = await this.practicas.buscarPorId(practicaId);
    if (!practica) throw new NotFoundException('Expediente no encontrado');
    if (
      !practica.visiblePara({
        id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId,
      })
    ) {
      throw new NotFoundException('Expediente no encontrado');
    }

    // Sin efecto mientras CONSENTIMIENTO_BLOQUEA_CARGUE sea false (valor de fábrica).
    await this.consentimientos.exigirParaCargar(practica.estudianteId, practica.id);

    if (archivo.contenido.length > tamanoMaximoBytes) {
      throw new BadRequestException(
        `El archivo supera el máximo de ${Math.round(tamanoMaximoBytes / 1_048_576)} MB`,
      );
    }
    if (actor.rol === Rol.ESTUDIANTE) await this.exigirPlazoDeCargue(practica);

    // Verificación del tipo REAL por firma binaria: renombrar la extensión no sirve.
    const mimeReal = this.forense.detectarMimeReal(archivo.contenido);
    if (!mimeReal) {
      throw new BadRequestException(
        'El archivo no es un PDF, JPG ni PNG válido. Verifique el documento y vuelva a cargarlo.',
      );
    }

    const ahora = new Date();
    // El hash criptográfico se calcula SIEMPRE sobre el original: es lo que
    // sostiene el valor probatorio, y el saneamiento posterior no lo altera.
    const hash = createHash('sha256').update(archivo.contenido).digest('hex');
    const version = (await this.documentos.ultimaVersion(practicaId, tipo)) + 1;

    // Saneamiento: un PDF puede llevar JavaScript, acciones de apertura y
    // archivos embebidos. Se almacena la copia neutralizada; el hash del
    // original queda registrado para poder demostrar qué se recibió.
    let aAlmacenar = archivo.contenido;
    let hallazgosSaneamiento: { tipo: string; ocurrencias: number; descripcion: string }[] = [];
    if (mimeReal === 'application/pdf') {
      const saneado = this.saneamiento.sanear(archivo.contenido);
      aAlmacenar = saneado.contenido;
      hallazgosSaneamiento = saneado.hallazgos;
    }

    // Hash perceptual: detecta la misma imagen con ediciones mínimas, que es
    // como reaparece una planilla reutilizada entre estudiantes.
    const hashPerceptual = this.calcularHashPerceptual(archivo.contenido, mimeReal);

    // Ruta no adivinable: nadie llega al archivo por enumeración.
    const ruta = `practicas/${practicaId}/${tipo}/${randomBytes(16).toString('hex')}`;
    try {
      await this.almacen.guardar(ruta, aAlmacenar, mimeReal);
    } catch (error) {
      // Un bucket inexistente o sin permisos no es culpa del estudiante: el
      // mensaje lo dice y el detalle queda en el registro para quien opera.
      this.log.error(`No se pudo guardar ${ruta} en el almacenamiento: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'El almacenamiento de documentos no está disponible en este momento. El archivo no se guardó; ' +
          'inténtelo de nuevo en unos minutos o avise al administrador de la plataforma.',
      );
    }

    const datos: DatosDocumento = {
      id: randomUUID(),
      practicaId,
      tipo,
      version,
      estado: EstadoDocumento.RECIBIDO,
      nombreOriginal: archivo.nombreOriginal.slice(0, 200),
      mimeReal,
      tamanoBytes: archivo.contenido.length,
      hashSha256: hash,
      hashPerceptual,
      rutaAlmacenamiento: ruta,
      calidadCaptura: calidad,
      banderas: [],
      puntaje: null,
      banda: null,
      extraccion: null,
      decididoPor: null,
      justificacionDecision: null,
      motivoDevolucion: null,
      cargadoEn: ahora,
      actualizadoEn: ahora,
      purgarDespuesDe: null,
    };

    const documento = Documento.desde(datos);
    const dias = DIAS_PURGA[tipo];
    if (dias) documento.programarPurga(dias, ahora);

    await this.documentos.guardar(documento.instantanea());
    practica.tocar(ahora);
    await this.practicas.guardar(practica.instantanea());

    await this.registrar(actor, AccionAuditada.DOCUMENTO_CARGADO, documento.id, {
      tipo, version, hash, tamanoBytes: archivo.contenido.length,
      hashPerceptual,
      // Queda constancia de qué se neutralizó y por qué: es parte de la
      // cadena de custodia del documento.
      saneamiento: hallazgosSaneamiento.length > 0 ? hallazgosSaneamiento : undefined,
    });

    // El documento se encola con prioridad interactiva: es un cargue en curso,
    // con una persona esperando al otro lado. El procesamiento nocturno usa la
    // cola de lote y nunca se adelanta a este.
    await this.cola.encolar({
      tipo: 'validar_documento',
      referencia: documento.id,
      prioridad: 'interactiva',
    });

    // Se responde con el estado real en este instante, no con una promesa: el
    // documento queda `recibido` y el cliente consulta hasta ver el resultado.
    // El aviso al estudiante lo emite el procesador cuando el pipeline termina.
    const actualizado = (await this.documentos.buscarPorId(documento.id)) ?? documento;
    return this.aRespuesta(actualizado, actor);
  }

  /** Devuelve null cuando la imagen no se puede decodificar sin adivinar. */
  private calcularHashPerceptual(contenido: Buffer, mime: string): string | null {
    if (mime === 'application/pdf') return null;
    const imagen = this.decodificador.decodificar(contenido, mime);
    return imagen ? this.perceptual.calcular(imagen) : null;
  }

  async listarPorPractica(practicaId: string, actor: Actor): Promise<DocumentoRespuestaDto[]> {
    this.exigirAccesoDocumental(actor);
    const practica = await this.practicas.buscarPorId(practicaId);
    if (
      !practica ||
      !practica.visiblePara({
        id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId,
      })
    ) {
      throw new NotFoundException('Expediente no encontrado');
    }
    const documentos = await this.documentos.listarPorPractica(practicaId);
    return documentos
      .filter((d) => puedeVerDocumento(actor.rol, d.tipo))
      .map((d) => this.aRespuesta(d, actor));
  }

  /**
   * Enlace firmado de vigencia corta. Emitirlo se audita como visualización
   * solicitada; la descarga real la audita «descargar», que es otra acción.
   */
  async enlace(documentoId: string, minutos: number, actor: Actor): Promise<{ url: string; expiraEn: string }> {
    this.exigirAccesoDocumental(actor);
    const documento = await this.exigirVisible(documentoId, actor);
    await this.exigirTipoPermitido(documento, actor);
    const url = await this.almacen.enlaceFirmado({ documentoId, solicitanteId: actor.id }, minutos);
    await this.registrar(actor, AccionAuditada.DOCUMENTO_VISUALIZADO, documentoId, {
      minutos, etapa: 'enlace_generado',
    });
    const expira = new Date(Date.now() + minutos * 60_000);
    return { url, expiraEn: expira.toISOString() };
  }

  /**
   * Entrega el archivo a quien presenta un enlace ya verificado. Vuelve a
   * comprobar, con el estado ACTUAL del usuario, que sigue activo y que puede ver
   * ese documento: el enlace no es un salvoconducto. Solo cuando el contenido se
   * entrega queda registrada la descarga.
   */
  async descargar(
    documentoId: string,
    solicitanteId: string,
    origen: { ip: string | null; agenteUsuario: string | null },
  ): Promise<Buffer> {
    const usuario = await this.usuarios.buscarPorId(solicitanteId);
    if (!usuario || !usuario.activo || !puedeConsultarDocumentos(usuario.rol)) {
      throw new NotFoundException('Documento no encontrado');
    }
    const actor: Actor = {
      id: usuario.id,
      correo: usuario.correo,
      rol: usuario.rol,
      permiso: usuario.permiso,
      escuelas: usuario.escuelas,
      empresaId: usuario.empresaId,
      ip: origen.ip,
      agenteUsuario: origen.agenteUsuario,
    };
    const documento = await this.exigirVisible(documentoId, actor);
    await this.exigirTipoPermitido(documento, actor);

    const contenido = await this.almacen.leer(documento.instantanea().rutaAlmacenamiento);
    await this.registrar(actor, AccionAuditada.DOCUMENTO_DESCARGADO, documentoId, {
      tamanoBytes: contenido.length,
    });
    return contenido;
  }

  /** Decisión humana. Sin justificación no hay decisión. */
  async decidir(
    documentoId: string,
    dto: DecisionDocumentoDto,
    actor: Actor,
  ): Promise<DocumentoRespuestaDto> {
    if (![Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR].includes(actor.rol)) {
      throw new ForbiddenException('Su perfil no puede decidir sobre documentos');
    }
    const documento = await this.exigirVisible(documentoId, actor);

    // Límite explícito de la automatización: el plan de mejoramiento es una
    // valoración académica y solo lo aprueba el tutor.
    if (
      documento.tipo === TipoDocumento.PLAN_MEJORAMIENTO &&
      ![Rol.TUTOR, Rol.COORDINADOR].includes(actor.rol)
    ) {
      throw new ForbiddenException(
        'El plan de mejoramiento solo lo aprueba el tutor académico o el coordinador',
      );
    }

    try {
      switch (dto.decision) {
        case 'aprobar': documento.aprobar(actor.id, dto.justificacion); break;
        case 'rechazar': documento.rechazar(actor.id, dto.justificacion); break;
        case 'devolver': documento.devolver(dto.justificacion, actor.id); break;
      }
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const guardado = await this.documentos.guardar(documento.instantanea());
    await this.registrar(actor, AccionAuditada.DECISION_DOCUMENTO, documentoId, {
      decision: dto.decision, puntaje: documento.puntaje, banda: documento.banda,
    }, dto.justificacion);
    await this.notificarSiRequiereAccion(guardado, actor);
    if (dto.decision === 'devolver') {
      // El manual pide dejar en la bitácora el plazo de ocho días para subsanar.
      await this.bitacora.anotarDevolucion(
        guardado.practicaId, guardado.tipo, guardado.instantanea().motivoDevolucion, actor,
      );
    }
    return this.aRespuesta(guardado, actor);
  }

  // ── internos ─────────────────────────────────────────────────────────────

  /**
   * Plazo de cargue del estudiante (PQRS n.º 20 y cronograma): hasta la fecha
   * de cargue de documentos del periodo o hasta ocho días calendario después
   * de terminada la práctica, lo que ocurra más tarde; un documento devuelto
   * reabre ocho días desde la devolución. El docente carga en casos
   * especiales por la ventana de cargue docente y no tiene este límite.
   */
  private async exigirPlazoDeCargue(practica: Practica): Promise<void> {
    const datos = practica.instantanea();
    const dias = await this.parametros.numero('documentos.dias_subsanacion');
    const ahora = Date.now();
    const limites: number[] = [];
    if (datos.fechaFin) limites.push(datos.fechaFin.getTime() + dias * 86_400_000);
    const periodo = await this.periodos.buscarPorCodigo(datos.periodoAcademico).catch(() => null);
    const ventana = periodo?.ventana(TipoVentana.CARGUE_ESTUDIANTE) ?? null;
    if (ventana) limites.push(ventana.hasta.getTime() + 86_400_000 - 1);
    const devueltos = (await this.documentos.listarPorPractica(practica.id))
      .map((d) => d.instantanea())
      .filter((d) => d.estado === EstadoDocumento.DEVUELTO || d.estado === EstadoDocumento.ILEGIBLE);
    for (const d of devueltos) limites.push(d.actualizadoEn.getTime() + dias * 86_400_000);
    if (limites.length === 0 || ahora <= Math.max(...limites)) return;
    throw new BadRequestException(
      'El plazo de cargue venció: la fecha de cargue del periodo y los ocho días calendario posteriores ' +
        'al fin de la práctica ya pasaron. Solicite a su docente la habilitación por la bitácora.',
    );
  }

  /** El rol debe participar en la gestión documental (empresa y extensión no). */
  private exigirAccesoDocumental(actor: Actor): void {
    if (!puedeConsultarDocumentos(actor.rol)) {
      throw new ForbiddenException('Su perfil no consulta los documentos de la práctica');
    }
  }

  /** El auxiliar solo alcanza los tipos de su proceso; el resto responde como inexistente. */
  private async exigirTipoPermitido(documento: Documento, actor: Actor): Promise<void> {
    if (puedeVerDocumento(actor.rol, documento.tipo)) return;
    await this.registrar(actor, AccionAuditada.ACCESO_FUERA_DE_ALCANCE, documento.id, {
      motivo: 'tipo_no_habilitado_para_el_rol',
    });
    throw new NotFoundException('Documento no encontrado');
  }

  private async exigirVisible(documentoId: string, actor: Actor): Promise<Documento> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento) throw new NotFoundException('Documento no encontrado');
    const practica = await this.practicas.buscarPorId(documento.practicaId);
    if (
      !practica ||
      !practica.visiblePara({
        id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId,
      })
    ) {
      await this.registrar(actor, AccionAuditada.ACCESO_FUERA_DE_ALCANCE, documentoId, null);
      throw new NotFoundException('Documento no encontrado');
    }
    return documento;
  }

  /**
   * Aviso tras una decisión humana. La devolución explica en lenguaje
   * comprensible qué corregir: un mensaje que solo dice "documento rechazado"
   * genera una llamada al conmutador.
   *
   * El destinatario es el ESTUDIANTE del expediente, no quien decidió: es él
   * quien tiene que corregir.
   */
  private async notificarSiRequiereAccion(documento: Documento, _actor: Actor): Promise<void> {
    const datos = documento.instantanea();
    if (![EstadoDocumento.DEVUELTO, EstadoDocumento.ILEGIBLE].includes(datos.estado)) return;

    const practica = await this.practicas.buscarPorId(datos.practicaId);
    if (!practica) return;
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    if (!estudiante) return;

    const guias = datos.banderas
      .map((b) => b.mensajeUsuario)
      .filter((m): m is string => Boolean(m));

    await this.notificaciones.notificar(
      datos.estado === EstadoDocumento.ILEGIBLE
        ? EventoNotificable.DOCUMENTO_ILEGIBLE
        : EventoNotificable.DOCUMENTO_DEVUELTO,
      { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
      { tipoDocumento: datos.tipo, motivo: datos.motivoDevolucion ?? undefined, guias },
    );
  }

  /**
   * Filtrado de columnas EN EL SERVIDOR. El estudiante no recibe el puntaje de
   * riesgo ni las banderas internas: no se le envían, no se le ocultan en la UI.
   */
  private aRespuesta(documento: Documento, actor: Actor): DocumentoRespuestaDto {
    const datos = documento.instantanea();
    const esInterno = [Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR].includes(actor.rol);
    return {
      id: datos.id,
      practicaId: datos.practicaId,
      tipo: datos.tipo,
      version: datos.version,
      estado: datos.estado,
      nombreOriginal: datos.nombreOriginal,
      tamanoBytes: datos.tamanoBytes,
      puntaje: esInterno ? datos.puntaje : null,
      banda: esInterno ? datos.banda : null,
      motivoDevolucion: datos.motivoDevolucion,
      cargadoEn: datos.cargadoEn.toISOString(),
      ...(esInterno ? { banderas: datos.banderas, lectura: lecturaAsistida(datos.extraccion) } : {}),
    };
  }

  private async registrar(
    actor: Actor,
    accion: AccionAuditada,
    entidadId: string,
    metadatos: Record<string, unknown> | null,
    justificacion: string | null = null,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id,
      actorCorreo: actor.correo,
      actorRol: actor.rol,
      accion,
      entidad: 'documento',
      entidadId,
      justificacion,
      metadatos,
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
  }
}

/** Proyección de `documento.extraccion` para el revisor; nunca llega al estudiante. */
function lecturaAsistida(extraccion: Record<string, unknown> | null): LecturaAsistidaDto | null {
  if (!extraccion) return null;
  const e = extraccion as {
    proveedor?: string; modelo?: string; tipoDetectado?: string | null; ilegible?: boolean;
    motivoIlegible?: string | null; resumen?: string | null; hallazgos?: LecturaAsistidaDto['hallazgos'];
    tokensEntrada?: number; tokensSalida?: number; costoUsd?: number; leidoEn?: string;
    campos?: LecturaAsistidaDto['campos'];
  };
  return {
    proveedor: e.proveedor ?? (e.modelo === 'pdf417-sin-ia' ? 'pdf417' : 'desconocido'),
    modelo: e.modelo ?? 'desconocido',
    tipoDetectado: e.tipoDetectado ?? null,
    ilegible: e.ilegible === true,
    motivoIlegible: e.motivoIlegible ?? null,
    resumen: e.resumen ?? null,
    hallazgos: Array.isArray(e.hallazgos) ? e.hallazgos : [],
    tokensEntrada: Number(e.tokensEntrada ?? 0),
    tokensSalida: Number(e.tokensSalida ?? 0),
    costoUsd: Number(e.costoUsd ?? 0),
    leidoEn: e.leidoEn ?? null,
    campos: e.campos ?? {},
  };
}
