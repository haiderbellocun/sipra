import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  AutorBitacora, DatosEntradaBitacora, DetalleCalificacion, DetalleEntrada, DetalleEvaluaTuProceso,
  ETIQUETA_ENTRADA, EntradaBitacora, EntradaBitacoraInvalidaError, PREGUNTAS_EVALUA_TU_PROCESO,
  TipoEntradaBitacora,
} from '../../../domain/entities/bitacora.entity';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  CalificacionInvalidaError, CierreNoPermitidoError, EQUIVALENCIA_SGP, EstadoPractica,
  NOTA_MINIMA_APROBACION, Practica, TransicionInvalidaError,
} from '../../../domain/entities/practica.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, BITACORA_REPOSITORY, BitacoraRepositoryPort,
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
  USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { AvanceDocumentalDomainService } from '../../../domain/services/avance-documental.domain-service';
import { CierreDomainService } from '../../../domain/services/cierre.domain-service';
import { EventoNotificable } from '../../../domain/services/plantillas-notificacion.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { NotificacionesService } from '../../../infrastructure/modules/notificaciones.service';
import {
  EntradaBitacoraRespuestaDto, EscribirBitacoraDto, EstadoCierreDto, RespuestaCierre,
} from '../../dtos/bitacora.dto';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { Actor } from './gestionar-practica.use-case';

const FECHA_LARGA = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota',
});

/**
 * Bitácora, «Evalúa tu proceso», calificación docente y cierre (SGP, 4.3 y 5).
 *
 * El cierre no es un botón: ocurre solo cuando concurren las tres condiciones
 * del manual. Cada vez que una de ellas cambia —el docente califica, el
 * estudiante evalúa— se vuelve a comprobar; si se cumplen, la práctica pasa a
 * «Cerrado» o a «Reprueba» y queda anotado en la bitácora y en auditoría.
 */
@Injectable()
export class BitacoraUseCase {
  private readonly avance = new AvanceDocumentalDomainService();
  private readonly cierre = new CierreDomainService();

  constructor(
    @Inject(BITACORA_REPOSITORY) private readonly bitacora: BitacoraRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    private readonly notificaciones: NotificacionesService,
    private readonly parametros: ParametrosUseCase,
  ) {}

  async listar(practicaId: string, actor: Actor): Promise<EntradaBitacoraRespuestaDto[]> {
    const practica = await this.exigirVisible(practicaId, actor);
    const entradas = await this.bitacora.listarPorPractica(practica.id);
    return this.presentarTodas(entradas, actor);
  }

  async escribir(
    practicaId: string, dto: EscribirBitacoraDto, actor: Actor, ahora: Date = new Date(),
  ): Promise<EntradaBitacoraRespuestaDto> {
    const practica = await this.exigirVisible(practicaId, actor);
    const autor = this.autorDe(actor, practica);

    if (dto.tipo === TipoEntradaBitacora.CALIFICACION_DOCENTE) {
      if (!dto.calificacion) throw new BadRequestException('La calificación exige la nota');
      return this.calificar(practica, dto.calificacion.nota, dto.mensaje ?? '', actor, autor, ahora);
    }
    if (practica.esTerminal && dto.tipo !== TipoEntradaBitacora.MENSAJE_LIBRE) {
      throw new BadRequestException('La práctica ya cerró: solo admite mensajes libres');
    }

    let detalle: DetalleEntrada | null = null;
    let venceEl: Date | null = null;
    let mensaje = dto.mensaje ?? '';

    switch (dto.tipo) {
      case TipoEntradaBitacora.SEGUIMIENTO:
        if (!dto.seguimiento) throw new BadRequestException('El seguimiento exige los datos de la visita');
        detalle = {
          fechaVisita: dto.seguimiento.fechaVisita,
          modalidadVisita: dto.seguimiento.modalidadVisita,
          contactoNombre: dto.seguimiento.contactoNombre,
          contactoCargo: dto.seguimiento.contactoCargo ?? null,
          contactoArea: dto.seguimiento.contactoArea ?? null,
          sugerenciasPlanMejoramiento: dto.seguimiento.sugerenciasPlanMejoramiento ?? null,
          evaluacionJefeInmediato: dto.seguimiento.evaluacionJefeInmediato ?? null,
        };
        break;
      case TipoEntradaBitacora.EVALUACION_FINAL:
        if (!dto.evaluacionFinal) throw new BadRequestException('La evaluación final exige sus campos');
        detalle = {
          desempeno: dto.evaluacionFinal.desempeno,
          satisfaccionEmpresa: dto.evaluacionFinal.satisfaccionEmpresa,
          retroalimentacionPlanMejoramiento: dto.evaluacionFinal.retroalimentacionPlanMejoramiento ?? null,
        };
        break;
      case TipoEntradaBitacora.EVALUA_TU_PROCESO: {
        if (!dto.evaluaTuProceso) throw new BadRequestException('«Evalúa tu proceso» exige las respuestas');
        const previa = await this.bitacora.ultimaPorTipo(practica.id, TipoEntradaBitacora.EVALUA_TU_PROCESO);
        if (previa) throw new ConflictException('«Evalúa tu proceso» ya fue respondido para esta práctica');
        const respuestas = [...dto.evaluaTuProceso.respuestas].sort((a, b) => a.pregunta - b.pregunta);
        if (new Set(respuestas.map((r) => r.pregunta)).size !== PREGUNTAS_EVALUA_TU_PROCESO.length) {
          throw new BadRequestException('Cada pregunta se responde una vez');
        }
        detalle = {
          respuestas: respuestas.map((r) => ({ pregunta: PREGUNTAS_EVALUA_TU_PROCESO[r.pregunta], valor: r.valor })),
          comentario: dto.evaluaTuProceso.comentario ?? null,
        } satisfies DetalleEvaluaTuProceso;
        mensaje = mensaje || 'Evaluación del docente y del proceso de práctica respondida.';
        break;
      }
      case TipoEntradaBitacora.PLAZO_SUBSANACION: {
        const documentos = dto.subsanacion?.documentos ?? [];
        if (documentos.length === 0) throw new BadRequestException('Indique los documentos pendientes');
        venceEl = await this.fechaLimiteSubsanacion(ahora);
        detalle = { documentos, venceEl: venceEl.toISOString() };
        break;
      }
      case TipoEntradaBitacora.SISTEMA:
        throw new ForbiddenException('Las anotaciones de la plataforma no se escriben a mano');
      default:
        break;
    }

    const entrada = this.construir({
      practicaId: practica.id, tipo: dto.tipo, autor, autorId: actor.id, mensaje, detalle, venceEl, creadaEn: ahora,
    });
    const guardada = await this.bitacora.agregar(entrada.instantanea());
    practica.tocar(ahora);
    await this.practicas.guardar(practica.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.BITACORA_REGISTRADA, practica.id, { tipo: dto.tipo });

    await this.notificarContraparte(practica, guardada, actor);

    if (dto.tipo === TipoEntradaBitacora.EVALUA_TU_PROCESO) {
      await this.intentarCierre(practica, actor, ahora);
    }
    return this.presentar(guardada, actor, new Map([[actor.id, this.nombreActor(actor)]]));
  }

  /** Estado de las tres condiciones de cierre, para la vista del expediente. */
  async estadoCierre(practicaId: string, actor: Actor): Promise<EstadoCierreDto> {
    const practica = await this.exigirVisible(practicaId, actor);
    const [estado, datos] = await Promise.all([this.evaluarCierre(practica), Promise.resolve(practica.instantanea())]);
    return {
      estado: datos.estado,
      estadoSgp: EQUIVALENCIA_SGP[datos.estado],
      porcentajeAprobado: estado.porcentajeAprobado,
      documentosAprobados: estado.cierre.documentosAprobados,
      evaluaTuProceso: estado.cierre.evaluaTuProceso,
      calificacion: estado.cierre.calificacion,
      nota: datos.nota,
      aprobada: practica.aprobada,
      puedeCerrar: estado.cierre.puedeCerrar,
      faltantes: estado.cierre.faltantes,
      cerradaEn: datos.cerradaEn?.toISOString() ?? null,
      preguntasEvaluaTuProceso: PREGUNTAS_EVALUA_TU_PROCESO,
    };
  }

  /** Cierre explícito desde coordinación cuando las condiciones ya se cumplen. */
  async cerrar(practicaId: string, actor: Actor, ahora: Date = new Date()): Promise<RespuestaCierre> {
    if (![Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR].includes(actor.rol)) {
      throw new ForbiddenException('Solo el docente facilitador o coordinación cierran el proceso');
    }
    const practica = await this.exigirVisible(practicaId, actor);
    const { cierre } = await this.evaluarCierre(practica);
    if (!cierre.puedeCerrar) {
      throw new BadRequestException(`No es posible cerrar: ${cierre.faltantes.join('; ')}`);
    }
    const cerrada = await this.intentarCierre(practica, actor, ahora);
    return { practicaId: practica.id, cerrada, estado: practica.estado, nota: practica.nota };
  }

  /**
   * Anotación automática cuando un documento se devuelve: el manual pide dejar
   * en la bitácora el plazo de ocho días para subsanar. La llama el caso de uso
   * de documentos; no es una entrada que alguien escriba.
   */
  async anotarDevolucion(
    practicaId: string, tipoDocumento: TipoDocumento, motivo: string | null, actor: Actor, ahora: Date = new Date(),
  ): Promise<void> {
    const practica = await this.practicas.buscarPorId(practicaId);
    if (!practica || practica.esTerminal) return;
    const venceEl = await this.fechaLimiteSubsanacion(ahora);
    const entrada = this.construir({
      practicaId, tipo: TipoEntradaBitacora.SISTEMA, autor: 'sistema', autorId: null,
      mensaje: `Documento devuelto por ${this.nombreActor(actor)}: ${tipoDocumento}. ` +
        `Plazo para subsanar: hasta el ${FECHA_LARGA.format(venceEl)}.` + (motivo ? ` Motivo: ${motivo}` : ''),
      detalle: { documentos: [tipoDocumento], venceEl: venceEl.toISOString() },
      venceEl, creadaEn: ahora,
    });
    await this.bitacora.agregar(entrada.instantanea());
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    if (estudiante) {
      await this.notificaciones.notificar(
        EventoNotificable.PLAZO_SUBSANACION,
        { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
        { documentos: [tipoDocumento], fechaLimite: FECHA_LARGA.format(venceEl), mensaje: motivo ?? undefined },
      );
    }
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async calificar(
    practica: Practica, nota: number, observacion: string, actor: Actor, autor: AutorBitacora, ahora: Date,
  ): Promise<EntradaBitacoraRespuestaDto> {
    if (autor === 'estudiante') throw new ForbiddenException('El estudiante no registra la calificación');
    if (actor.rol === Rol.TUTOR && practica.tutorId !== actor.id) {
      throw new ForbiddenException('Solo el docente facilitador asignado califica esta práctica');
    }
    const { porcentajeAprobado } = await this.evaluarCierre(practica);
    if (porcentajeAprobado < 100) {
      throw new BadRequestException(
        `La calificación se registra con el 100 % de los documentos aprobados (hoy ${porcentajeAprobado} %)`,
      );
    }
    try {
      practica.calificar(nota, ahora);
    } catch (error) {
      if (error instanceof CalificacionInvalidaError) throw new BadRequestException(error.message);
      throw error;
    }
    await this.practicas.guardar(practica.instantanea());

    const detalle: DetalleCalificacion = { nota, aprobada: nota >= NOTA_MINIMA_APROBACION };
    const entrada = this.construir({
      practicaId: practica.id, tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, autor, autorId: actor.id,
      mensaje: observacion || `Calificación final del proceso: ${nota.toFixed(1).replace('.', ',')}.`,
      detalle, venceEl: null, creadaEn: ahora,
    });
    const guardada = await this.bitacora.agregar(entrada.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.CALIFICACION_REGISTRADA, practica.id, { nota });
    await this.notificarContraparte(practica, guardada, actor);
    await this.intentarCierre(practica, actor, ahora);
    return this.presentar(guardada, actor, new Map([[actor.id, this.nombreActor(actor)]]));
  }

  private async evaluarCierre(practica: Practica) {
    const [documentos, evalua] = await Promise.all([
      this.documentos.listarPorPractica(practica.id),
      this.bitacora.ultimaPorTipo(practica.id, TipoEntradaBitacora.EVALUA_TU_PROCESO),
    ]);
    const avance = this.avance.calcular(
      practica.modalidad,
      documentos.map((d) => { const i = d.instantanea(); return { tipo: i.tipo, version: i.version, estado: i.estado }; }),
    );
    const cierre = this.cierre.evaluar(practica, {
      porcentajeAprobado: avance.porcentajeAprobado,
      evaluaTuProcesoRespondido: evalua !== null,
      nota: practica.nota,
    });
    return { porcentajeAprobado: avance.porcentajeAprobado, cierre };
  }

  /** Cierra si las tres condiciones concurren. Devuelve si cerró. */
  private async intentarCierre(practica: Practica, actor: Actor, ahora: Date): Promise<boolean> {
    const { cierre } = await this.evaluarCierre(practica);
    if (!cierre.puedeCerrar) return false;
    let destino: EstadoPractica;
    try {
      destino = practica.cerrar(ahora);
    } catch (error) {
      if (error instanceof CierreNoPermitidoError || error instanceof TransicionInvalidaError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    await this.practicas.guardar(practica.instantanea());
    const nota = practica.nota as number;
    const entrada = this.construir({
      practicaId: practica.id, tipo: TipoEntradaBitacora.SISTEMA, autor: 'sistema', autorId: null,
      mensaje: destino === EstadoPractica.CERTIFICADA
        ? `Proceso cerrado. Calificación final ${nota.toFixed(1).replace('.', ',')}: aprobado.`
        : `Proceso cerrado con calificación ${nota.toFixed(1).replace('.', ',')}, inferior a 3,0: reprueba.`,
      detalle: null, venceEl: null, creadaEn: ahora,
    });
    await this.bitacora.agregar(entrada.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.PRACTICA_CERRADA, practica.id, {
      destino, nota, estadoSgp: EQUIVALENCIA_SGP[destino],
    });
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    if (estudiante) {
      await this.notificaciones.notificar(
        EventoNotificable.PROCESO_CERRADO,
        { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
        { nota, aprobada: destino === EstadoPractica.CERTIFICADA, periodo: practica.periodoAcademico },
      );
    }
    return true;
  }

  /** Avisa a la otra parte de la conversación: al docente si escribe el estudiante y viceversa. */
  private async notificarContraparte(practica: Practica, entrada: EntradaBitacora, actor: Actor): Promise<void> {
    const destinatarioId = entrada.autor === 'estudiante' ? practica.tutorId : practica.estudianteId;
    if (!destinatarioId || destinatarioId === actor.id) return;
    const destinatario = await this.usuarios.buscarPorId(destinatarioId);
    if (!destinatario) return;
    const datos = entrada.instantanea();
    const resumen = datos.mensaje.length > 600 ? `${datos.mensaje.slice(0, 600)}…` : datos.mensaje;
    await this.notificaciones.notificar(
      EventoNotificable.MENSAJE_BITACORA,
      { correo: destinatario.correo, nombre: destinatario.nombre, id: destinatario.id },
      { autor: `${this.nombreActor(actor)} (${ETIQUETA_ENTRADA[datos.tipo]})`, mensaje: resumen },
    );
  }

  private async fechaLimiteSubsanacion(ahora: Date): Promise<Date> {
    const dias = await this.parametros.numero('documentos.dias_subsanacion');
    return new Date(ahora.getTime() + dias * 86_400_000);
  }

  private construir(datos: Omit<DatosEntradaBitacora, 'id'>): EntradaBitacora {
    try {
      return EntradaBitacora.nueva({ id: randomUUID(), ...datos });
    } catch (error) {
      if (error instanceof EntradaBitacoraInvalidaError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private autorDe(actor: Actor, practica: Practica): AutorBitacora {
    switch (actor.rol) {
      case Rol.ESTUDIANTE:
        return 'estudiante';
      case Rol.TUTOR:
        if (practica.tutorId !== actor.id && !actor.escuelas.includes(practica.escuelaId)) {
          throw new ForbiddenException('Solo el docente facilitador asignado escribe en esta bitácora');
        }
        return 'docente';
      case Rol.COORDINADOR:
      case Rol.ADMINISTRADOR:
        return 'coordinacion';
      default:
        throw new ForbiddenException('Su perfil consulta la bitácora, no escribe en ella');
    }
  }

  private nombreActor(actor: Actor): string {
    return actor.correo.split('@')[0].replace(/[._-]+/g, ' ');
  }

  private async exigirVisible(id: string, actor: Actor): Promise<Practica> {
    // La bitácora es entre el estudiante y su docente (y coordinación/administración): ni la
    // empresa, ni el auxiliar, ni extensión la leen.
    if ([Rol.EMPRESA, Rol.AUXILIAR, Rol.EXTENSION].includes(actor.rol)) {
      throw new ForbiddenException('La bitácora es entre el estudiante y su docente');
    }
    const practica = await this.practicas.buscarPorId(id);
    if (!practica) throw new NotFoundException('Expediente no encontrado');
    if (!practica.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      await this.registrarAuditoria(actor, AccionAuditada.ACCESO_FUERA_DE_ALCANCE, id, null);
      throw new NotFoundException('Expediente no encontrado');
    }
    return practica;
  }

  private async presentarTodas(entradas: EntradaBitacora[], actor: Actor): Promise<EntradaBitacoraRespuestaDto[]> {
    const ids = [...new Set(entradas.map((e) => e.autorId).filter((x): x is string => x !== null))];
    const usuarios = await Promise.all(ids.map((id) => this.usuarios.buscarPorId(id)));
    const nombres = new Map<string, string>();
    usuarios.forEach((u, i) => nombres.set(ids[i], u?.nombre ?? '—'));
    return entradas.map((e) => this.presentar(e, actor, nombres));
  }

  private presentar(entrada: EntradaBitacora, actor: Actor, nombres: Map<string, string>): EntradaBitacoraRespuestaDto {
    const d = entrada.instantanea();
    return {
      id: d.id,
      practicaId: d.practicaId,
      tipo: d.tipo,
      etiqueta: ETIQUETA_ENTRADA[d.tipo],
      autor: d.autor,
      autorId: d.autorId,
      autorNombre: d.autor === 'sistema' ? 'SIPRA' : (d.autorId ? nombres.get(d.autorId) ?? '—' : '—'),
      mensaje: d.mensaje,
      detalle: d.detalle as Record<string, unknown> | null,
      venceEl: d.venceEl?.toISOString() ?? null,
      creadaEn: d.creadaEn.toISOString(),
      propia: d.autorId === actor.id,
    };
  }

  private async registrarAuditoria(
    actor: Actor, accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown> | null,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'practica', entidadId,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
  }
}
