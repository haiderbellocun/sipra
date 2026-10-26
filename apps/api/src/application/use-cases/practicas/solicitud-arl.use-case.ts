import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { Practica } from '../../../domain/entities/practica.entity';
import { TipoVentana } from '../../../domain/entities/periodo.entity';
import {
  DatosSolicitudArl, ETIQUETA_MOTIVO_RECHAZO, EstadoSolicitudArl, MotivoRechazoArl, SolicitudArl,
  SolicitudArlError, aplicaSolicitudArl, documentosExigidosArl,
} from '../../../domain/entities/solicitud-arl.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort,
  FiltroSolicitudesArl, PERIODO_REPOSITORY, PeriodoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, SOLICITUD_ARL_REPOSITORY, SolicitudArlRepositoryPort, USUARIO_REPOSITORY,
  UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import { EventoNotificable } from '../../../domain/services/plantillas-notificacion.domain-service';
import { ValidacionArlDomainService } from '../../../domain/services/validacion-arl.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { NotificacionesService } from '../../../infrastructure/modules/notificaciones.service';
import {
  ConsolidadoArl, DecidirSolicitudArlDto, FilaConsolidadoArl, RadicarSolicitudArlDto, SolicitudArlRespuestaDto,
} from '../../dtos/solicitud-arl.dto';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { Actor, GestionarPracticaUseCase } from './gestionar-practica.use-case';

const ROLES_VALIDAN: readonly Rol[] = [Rol.AUXILIAR, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR];
const ROLES_ENVIAN_CERTIFICADO: readonly Rol[] = [Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR];
const FECHA_LARGA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Portal de gestión de ARL dentro de SIPRA (§5, §6, §8 y §9 del manual).
 *
 * El estudiante radica la solicitud sobre su práctica registrada; los
 * soportes son los documentos que ya cargó en el expediente, así el pipeline
 * documental hace la primera lectura y el auxiliar decide con una
 * recomendación delante. Al aprobar y remitir el certificado, este queda en
 * el expediente aprobado y la afiliación registrada: el estudiante no vuelve
 * a cargarlo.
 */
@Injectable()
export class SolicitudArlUseCase {
  private readonly validacion = new ValidacionArlDomainService();

  constructor(
    @Inject(SOLICITUD_ARL_REPOSITORY) private readonly solicitudes: SolicitudArlRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly notificaciones: NotificacionesService,
    private readonly parametros: ParametrosUseCase,
    private readonly gestionar: GestionarPracticaUseCase,
  ) {}

  /** §5: el estudiante radica sobre su práctica; coordinación puede hacerlo por él. */
  async radicar(dto: RadicarSolicitudArlDto, actor: Actor, ahora: Date = new Date()): Promise<SolicitudArlRespuestaDto> {
    if (actor.rol === Rol.EMPRESA || actor.rol === Rol.EXTENSION) {
      throw new ForbiddenException('Su perfil no radica solicitudes de ARL');
    }
    const practica = await this.practicaParaRadicar(dto.practicaId, actor);
    const datos = practica.instantanea();

    if (aplicaSolicitudArl(datos.modalidad) === 'no') {
      throw new BadRequestException(
        `En la modalidad ${definicionModalidad(datos.modalidad).etiqueta} la ARL la asume la organización receptora; ` +
        'el certificado se carga directamente en el expediente.',
      );
    }
    if (practica.esTerminal) throw new BadRequestException('La práctica ya cerró');
    if (!datos.fechaInicio || !datos.fechaFin) {
      throw new BadRequestException('La práctica no tiene fechas de inicio y fin registradas');
    }
    if (datos.arlVerificada) throw new ConflictException('Esta práctica ya tiene afiliación a ARL registrada');
    // Cronograma del proceso: dos meses desde el inicio del periodo para
    // registrar y solicitar la ARL. Coordinación atiende las excepciones.
    if (actor.rol === Rol.ESTUDIANTE) {
      const periodo = await this.periodos.buscarPorCodigo(datos.periodoAcademico);
      const ventana = periodo?.ventana(TipoVentana.SOLICITUD_ARL) ?? periodo?.ventana(TipoVentana.REGISTRO_FUR) ?? null;
      if (periodo && ventana && !periodo.ventanaAbierta(TipoVentana.SOLICITUD_ARL, ahora)
        && !periodo.ventanaAbierta(TipoVentana.REGISTRO_FUR, ahora)) {
        throw new BadRequestException(
          `El plazo para solicitar la ARL del periodo ${periodo.codigo} cerró el ${ventana.hasta.toISOString().slice(0, 10)}. ` +
          'Comuníquese con coordinación de prácticas.',
        );
      }
    }
    const vigente = await this.solicitudes.buscarVigente(practica.id);
    if (vigente) throw new ConflictException(`Ya existe la solicitud n.º ${vigente.instantanea().consecutivo ?? '—'} en trámite`);

    const estudiante = await this.usuarios.buscarPorId(datos.estudianteId);
    if (!estudiante) throw new NotFoundException('No se encontró el estudiante');
    const documentoEstudiante = estudiante.instantanea().documento;
    if (documentoEstudiante && documentoEstudiante !== dto.numeroIdentificacion.trim()) {
      throw new BadRequestException('El número de identificación no coincide con el del estudiante registrado');
    }

    // Soportes: la última versión de cada tipo exigido, tal como está en el expediente.
    const expediente = await this.documentos.listarPorPractica(practica.id);
    const ultimaPorTipo = new Map<TipoDocumento, Documento>();
    for (const d of expediente) {
      const previa = ultimaPorTipo.get(d.tipo);
      if (!previa || d.instantanea().version > previa.instantanea().version) ultimaPorTipo.set(d.tipo, d);
    }
    const aportados = documentosExigidosArl(datos.modalidad)
      .map((tipo) => ultimaPorTipo.get(tipo))
      .filter((d): d is Documento => d !== undefined)
      .map((d) => ({ tipo: d.tipo, documentoId: d.id, estado: d.estado }));
    if (aportados.length === 0) {
      throw new BadRequestException(
        'Antes de solicitar la ARL cargue en su expediente los soportes: ' +
        documentosExigidosArl(datos.modalidad).join(', '),
      );
    }

    const solicitud: DatosSolicitudArl = {
      id: randomUUID(),
      consecutivo: null,
      practicaId: practica.id,
      estudianteId: datos.estudianteId,
      periodoAcademico: datos.periodoAcademico,
      modalidad: datos.modalidad,
      tipoIdentificacion: dto.tipoIdentificacion,
      numeroIdentificacion: dto.numeroIdentificacion.trim(),
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      epsNombre: dto.epsNombre.trim(),
      epsRegimen: dto.epsRegimen,
      fechaExpedicionEps: dto.fechaExpedicionEps ? new Date(dto.fechaExpedicionEps) : null,
      fechaExpedicionRut: dto.fechaExpedicionRut ? new Date(dto.fechaExpedicionRut) : null,
      fechaExpedicionCamara: dto.fechaExpedicionCamara ? new Date(dto.fechaExpedicionCamara) : null,
      documentos: aportados,
      validacion: null,
      estado: EstadoSolicitudArl.RADICADA,
      motivosRechazo: [],
      observacion: null,
      decididaPor: null,
      decididaEn: null,
      certificadoDocumentoId: null,
      certificadoEnviadoEn: null,
      radicadaEn: ahora,
      actualizadaEn: ahora,
    };
    const entidad = SolicitudArl.desde(solicitud);
    entidad.registrarValidacion(await this.evaluar(solicitud, ahora), ahora);
    const guardada = await this.solicitudes.guardar(entidad.instantanea());

    await this.registrarAuditoria(actor, AccionAuditada.SOLICITUD_ARL_RADICADA, guardada.id, {
      practicaId: practica.id, recomendacion: guardada.instantanea().validacion?.recomendacion,
    });
    await this.notificaciones.notificar(
      EventoNotificable.SOLICITUD_ARL_RADICADA,
      { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
      {
        consecutivo: guardada.instantanea().consecutivo, periodo: datos.periodoAcademico,
        modalidad: definicionModalidad(datos.modalidad).etiqueta,
      },
    );
    return this.presentar(guardada);
  }

  async listar(filtro: FiltroSolicitudesArl, actor: Actor): Promise<SolicitudArlRespuestaDto[]> {
    let seguro = filtro;
    if (actor.rol === Rol.ESTUDIANTE) seguro = { ...filtro, estudianteId: actor.id };
    else if (!ROLES_VALIDAN.includes(actor.rol)) throw new ForbiddenException('Su perfil no consulta solicitudes de ARL');
    const lista = await this.solicitudes.listar(seguro);
    const visibles = actor.rol === Rol.TUTOR || (actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0)
      ? await this.filtrarPorAlcance(lista, actor)
      : lista;
    return Promise.all(visibles.map((s) => this.presentar(s)));
  }

  async obtener(id: string, actor: Actor): Promise<SolicitudArlRespuestaDto> {
    return this.presentar(await this.exigirVisible(id, actor));
  }

  /** §9.7: el auxiliar aprueba o rechaza; puede corregir una decisión previa. */
  async decidir(id: string, dto: DecidirSolicitudArlDto, actor: Actor, ahora: Date = new Date()): Promise<SolicitudArlRespuestaDto> {
    if (!ROLES_VALIDAN.includes(actor.rol)) {
      throw new ForbiddenException('Solo el auxiliar de prácticas, el docente o coordinación deciden la solicitud');
    }
    const solicitud = await this.exigirVisible(id, actor);
    try {
      if (dto.decision === 'aprobar') solicitud.aprobar(actor.id, dto.observacion?.trim() || null, ahora);
      else solicitud.rechazar(actor.id, dto.motivos ?? [], dto.observacion?.trim() || null, ahora);
    } catch (error) {
      if (error instanceof SolicitudArlError) throw new BadRequestException(error.message);
      throw error;
    }
    const guardada = await this.solicitudes.guardar(solicitud.instantanea());
    const datos = guardada.instantanea();
    await this.registrarAuditoria(actor, AccionAuditada.DECISION_SOLICITUD_ARL, id, {
      decision: dto.decision, motivos: datos.motivosRechazo,
    }, dto.observacion ?? null);

    if (dto.decision === 'rechazar') {
      const estudiante = await this.usuarios.buscarPorId(datos.estudianteId);
      if (estudiante) {
        await this.notificaciones.notificar(
          EventoNotificable.SOLICITUD_ARL_RECHAZADA,
          { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
          {
            consecutivo: datos.consecutivo, motivo: datos.observacion ?? undefined,
            motivos: datos.motivosRechazo.map((m) => ETIQUETA_MOTIVO_RECHAZO[m]),
          },
        );
      }
    }
    return this.presentar(guardada);
  }

  /**
   * §9.8: con la solicitud aprobada, el auxiliar remite el certificado que
   * expide Capital Social. Queda en el expediente como documento aprobado, la
   * práctica registra la afiliación y el estudiante recibe el aviso.
   */
  async enviarCertificado(
    id: string,
    archivo: { nombreOriginal: string; contenido: Buffer },
    fechaAfiliacion: Date,
    actor: Actor,
    ahora: Date = new Date(),
  ): Promise<SolicitudArlRespuestaDto> {
    if (!ROLES_ENVIAN_CERTIFICADO.includes(actor.rol)) {
      throw new ForbiddenException('Solo el auxiliar de prácticas o coordinación remiten el certificado');
    }
    const solicitud = await this.exigirVisible(id, actor);
    if (solicitud.estado !== EstadoSolicitudArl.APROBADA) {
      throw new BadRequestException('El certificado se remite para una solicitud aprobada');
    }
    if (archivo.contenido.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('El certificado de ARL debe ser un PDF');
    }
    const practica = await this.practicas.buscarPorId(solicitud.practicaId);
    if (!practica) throw new NotFoundException('Expediente no encontrado');

    // La compuerta se comprueba antes de guardar nada: una afiliación que no
    // precede al inicio no sirve y no debe quedar registrada a medias.
    const ensayo = Practica.desde(practica.instantanea());
    ensayo.registrarAfiliacionArl(fechaAfiliacion, ahora);
    try {
      ensayo.verificarCompuertaArl();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const ruta = `practicas/${practica.id}/${TipoDocumento.CERTIFICADO_ARL}/${randomBytes(16).toString('hex')}`;
    await this.almacen.guardar(ruta, archivo.contenido, 'application/pdf');
    const version = (await this.documentos.ultimaVersion(practica.id, TipoDocumento.CERTIFICADO_ARL)) + 1;
    const documento: DatosDocumento = {
      id: randomUUID(),
      practicaId: practica.id,
      tipo: TipoDocumento.CERTIFICADO_ARL,
      version,
      estado: EstadoDocumento.APROBADO,
      nombreOriginal: archivo.nombreOriginal.slice(0, 200),
      mimeReal: 'application/pdf',
      tamanoBytes: archivo.contenido.length,
      hashSha256: createHash('sha256').update(archivo.contenido).digest('hex'),
      hashPerceptual: null,
      rutaAlmacenamiento: ruta,
      calidadCaptura: null,
      banderas: [],
      puntaje: 100,
      banda: null,
      extraccion: { origen: 'portal_arl', solicitudId: solicitud.id, fechaAfiliacion: fechaAfiliacion.toISOString() },
      decididoPor: actor.id,
      justificacionDecision: `Afiliación gestionada por la CUN (solicitud de ARL n.º ${solicitud.instantanea().consecutivo ?? '—'})`,
      motivoDevolucion: null,
      cargadoEn: ahora,
      actualizadoEn: ahora,
      purgarDespuesDe: null,
    };
    const guardadoDoc = await this.documentos.guardar(documento);
    await this.gestionar.registrarArl(practica.id, fechaAfiliacion, guardadoDoc.id, actor);

    solicitud.registrarCertificado(guardadoDoc.id, ahora);
    const guardada = await this.solicitudes.guardar(solicitud.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.CERTIFICADO_ARL_ENVIADO, id, {
      documentoId: guardadoDoc.id, fechaAfiliacion: fechaAfiliacion.toISOString(),
    });

    const estudiante = await this.usuarios.buscarPorId(solicitud.estudianteId);
    if (estudiante) {
      await this.notificaciones.notificar(
        EventoNotificable.CERTIFICADO_ARL_DISPONIBLE,
        { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
        { consecutivo: guardada.instantanea().consecutivo, fechaLimite: FECHA_LARGA.format(fechaAfiliacion) },
      );
    }
    return this.presentar(guardada);
  }

  async anular(id: string, actor: Actor, ahora: Date = new Date()): Promise<SolicitudArlRespuestaDto> {
    const solicitud = await this.exigirVisible(id, actor);
    if (actor.rol === Rol.ESTUDIANTE && solicitud.estudianteId !== actor.id) {
      throw new NotFoundException('Solicitud no encontrada');
    }
    try {
      solicitud.anular(ahora);
    } catch (error) {
      if (error instanceof SolicitudArlError) throw new BadRequestException(error.message);
      throw error;
    }
    return this.presentar(await this.solicitudes.guardar(solicitud.instantanea()));
  }

  /** §9.7.1: consolidado del día (aprobadas para Capital Social, rechazadas, certificados). */
  async consolidado(fecha: Date, actor: Actor): Promise<ConsolidadoArl> {
    if (!ROLES_VALIDAN.includes(actor.rol)) throw new ForbiddenException('Su perfil no consulta el consolidado');
    return this.armarConsolidado(fecha);
  }

  /** La tarea diaria envía el consolidado a coordinación y a los auxiliares. */
  async enviarConsolidadoDiario(fecha: Date): Promise<number> {
    const consolidado = await this.armarConsolidado(fecha);
    const filas = [
      ...consolidado.aprobadas.map((f) => `APROBADA n.º ${f.consecutivo ?? '—'} · ${f.estudianteNombre} (${f.numeroIdentificacion}) · ${f.modalidad} · ${f.fechaInicio} a ${f.fechaFin}`),
      ...consolidado.rechazadas.map((f) => `RECHAZADA n.º ${f.consecutivo ?? '—'} · ${f.estudianteNombre} · ${f.motivos.join('; ')}`),
      ...consolidado.certificadosEnviados.map((f) => `CERTIFICADO n.º ${f.consecutivo ?? '—'} · ${f.estudianteNombre}`),
    ];
    const destinatarios = (await this.usuarios.listar({ roles: [Rol.COORDINADOR, Rol.AUXILIAR], activo: true }))
      .filter((u) => u.rol === Rol.AUXILIAR || u.escuelas.length === 0);
    for (const u of destinatarios) {
      await this.notificaciones.notificar(
        EventoNotificable.CONSOLIDADO_ARL,
        { correo: u.correo, nombre: u.nombre, id: u.id },
        { fecha: consolidado.fecha, filas },
      );
    }
    return destinatarios.length;
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async armarConsolidado(fecha: Date): Promise<ConsolidadoArl> {
    const desde = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
    const hasta = new Date(desde.getTime() + 86_400_000 - 1);
    const decididas = await this.solicitudes.listar({ decididaDesde: desde, decididaHasta: hasta, limite: 5000 });
    const filas = await Promise.all(decididas.map((s) => this.fila(s)));
    const enviados = filas.filter((f) => f.estado === EstadoSolicitudArl.CERTIFICADO_ENVIADO);
    return {
      fecha: desde.toISOString().slice(0, 10),
      aprobadas: filas.filter((f) => f.estado === EstadoSolicitudArl.APROBADA),
      rechazadas: filas.filter((f) => f.estado === EstadoSolicitudArl.RECHAZADA),
      certificadosEnviados: enviados,
    };
  }

  private async fila(s: SolicitudArl): Promise<FilaConsolidadoArl> {
    const d = s.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    return {
      consecutivo: d.consecutivo,
      estado: d.estado,
      estudianteNombre: estudiante?.nombre ?? '—',
      numeroIdentificacion: d.numeroIdentificacion,
      estudianteCorreo: estudiante?.correo ?? '—',
      programaId: estudiante?.instantanea().programaId ?? null,
      periodoAcademico: d.periodoAcademico,
      modalidad: definicionModalidad(d.modalidad).etiqueta,
      fechaInicio: d.fechaInicio.toISOString().slice(0, 10),
      fechaFin: d.fechaFin.toISOString().slice(0, 10),
      epsNombre: d.epsNombre,
      motivos: d.motivosRechazo.map((m) => ETIQUETA_MOTIVO_RECHAZO[m]),
      decididaEn: d.decididaEn?.toISOString() ?? null,
    };
  }

  private async evaluar(solicitud: DatosSolicitudArl, ahora: Date) {
    const [periodo, diasHabilesAnticipacion, diasVigenciaEps] = await Promise.all([
      this.periodos.buscarPorCodigo(solicitud.periodoAcademico),
      this.parametros.numero('arl.dias_habiles_anticipacion'),
      this.parametros.numero('arl.dias_vigencia_eps'),
    ]);
    return this.validacion.validar(solicitud, { periodo, ahora, diasHabilesAnticipacion, diasVigenciaEps });
  }

  private async practicaParaRadicar(practicaId: string | undefined, actor: Actor): Promise<Practica> {
    if (actor.rol === Rol.ESTUDIANTE) {
      const propias = await this.practicas.listar({ estudianteId: actor.id });
      const activa = propias.filter((p) => !p.esTerminal).sort((a, b) =>
        b.instantanea().creadaEn.getTime() - a.instantanea().creadaEn.getTime())[0];
      if (!activa) throw new BadRequestException('Primero registre su práctica en «Registrar mi práctica»');
      if (practicaId && practicaId !== activa.id) throw new NotFoundException('Expediente no encontrado');
      return activa;
    }
    if (!practicaId) throw new BadRequestException('Indique la práctica sobre la que se radica la solicitud');
    const practica = await this.practicas.buscarPorId(practicaId);
    if (!practica || !practica.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      throw new NotFoundException('Expediente no encontrado');
    }
    return practica;
  }

  private async exigirVisible(id: string, actor: Actor): Promise<SolicitudArl> {
    const solicitud = await this.solicitudes.buscarPorId(id);
    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    if (actor.rol === Rol.ESTUDIANTE) {
      if (solicitud.estudianteId !== actor.id) throw new NotFoundException('Solicitud no encontrada');
      return solicitud;
    }
    if (!ROLES_VALIDAN.includes(actor.rol)) throw new ForbiddenException('Su perfil no accede a solicitudes de ARL');
    const practica = await this.practicas.buscarPorId(solicitud.practicaId);
    if (!practica || !practica.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      await this.registrarAuditoria(actor, AccionAuditada.ACCESO_FUERA_DE_ALCANCE, id, null);
      throw new NotFoundException('Solicitud no encontrada');
    }
    return solicitud;
  }

  private async filtrarPorAlcance(lista: SolicitudArl[], actor: Actor): Promise<SolicitudArl[]> {
    const visibles: SolicitudArl[] = [];
    for (const s of lista) {
      const practica = await this.practicas.buscarPorId(s.practicaId);
      if (practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
        visibles.push(s);
      }
    }
    return visibles;
  }

  private async presentar(s: SolicitudArl): Promise<SolicitudArlRespuestaDto> {
    const d = s.instantanea();
    const estudiante = await this.usuarios.buscarPorId(d.estudianteId);
    return {
      id: d.id,
      consecutivo: d.consecutivo,
      practicaId: d.practicaId,
      estudianteId: d.estudianteId,
      estudianteNombre: estudiante?.nombre ?? '—',
      estudianteCorreo: estudiante?.correo ?? '—',
      programaId: estudiante?.instantanea().programaId ?? null,
      periodoAcademico: d.periodoAcademico,
      modalidad: d.modalidad,
      modalidadEtiqueta: definicionModalidad(d.modalidad).etiqueta,
      tipoIdentificacion: d.tipoIdentificacion,
      numeroIdentificacion: d.numeroIdentificacion,
      fechaInicio: d.fechaInicio.toISOString().slice(0, 10),
      fechaFin: d.fechaFin.toISOString().slice(0, 10),
      epsNombre: d.epsNombre,
      epsRegimen: d.epsRegimen,
      fechaExpedicionEps: d.fechaExpedicionEps?.toISOString().slice(0, 10) ?? null,
      fechaExpedicionRut: d.fechaExpedicionRut?.toISOString().slice(0, 10) ?? null,
      fechaExpedicionCamara: d.fechaExpedicionCamara?.toISOString().slice(0, 10) ?? null,
      documentosExigidos: documentosExigidosArl(d.modalidad),
      documentos: d.documentos,
      recomendacion: d.validacion?.recomendacion ?? null,
      criterios: d.validacion?.criterios ?? [],
      estado: d.estado,
      motivosRechazo: d.motivosRechazo,
      motivosRechazoEtiquetas: d.motivosRechazo.map((m: MotivoRechazoArl) => ETIQUETA_MOTIVO_RECHAZO[m]),
      observacion: d.observacion,
      decididaPor: d.decididaPor,
      decididaEn: d.decididaEn?.toISOString() ?? null,
      certificadoDocumentoId: d.certificadoDocumentoId,
      certificadoEnviadoEn: d.certificadoEnviadoEn?.toISOString() ?? null,
      radicadaEn: d.radicadaEn.toISOString(),
    };
  }

  private async registrarAuditoria(
    actor: Actor, accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown> | null,
    justificacion: string | null = null,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'solicitud_arl', entidadId,
      justificacion, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}
