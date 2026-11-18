import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { randomUUID } from 'node:crypto';
import {
  CambioModalidadError, CompuertaArlError, DatosPractica, ESTADOS_OPERATIVOS, ETIQUETA_ESTADO_OPERATIVO, EstadoOperativo, EstadoPractica,
  ModalidadPractica, Practica, ResponsableArlNoDefinidoError, SenalAcompanamiento, TransicionInvalidaError, responsableArlSugerido,
} from '../../../domain/entities/practica.entity';
import { definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { ModalidadNoOfertadaError } from '../../../domain/entities/periodo.entity';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { EstadoObligacion, TipoObligacion } from '../../../domain/entities/obligacion.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort,
  EMPRESA_REPOSITORY, EmpresaRepositoryPort, FiltroPracticas, OBLIGACION_REPOSITORY,
  ObligacionRepositoryPort, PERIODO_REPOSITORY, PRACTICA_REPOSITORY, PeriodoRepositoryPort, PracticaRepositoryPort, USUARIO_REPOSITORY,
  UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  AcompanamientoDomainService,
} from '../../../domain/services/acompanamiento.domain-service';
import {
  ObligacionesDomainService,
} from '../../../domain/services/obligaciones.domain-service';
import { Rol, escuelasDeCoordinacion, Permiso, puedeModificarPractica } from '../../../domain/value-objects/rol.vo';
import {
  ActualizarVacanteDto, CambiarEstadoOperativoDto, CrearPracticaDto, DestinoOperativoDto, GobiernoPracticaDto, ModificarPracticaDto,
  PracticaRespuestaDto,
} from '../../dtos/practica.dto';
import { ConflictException } from '@nestjs/common';
import { BitacoraUseCase } from './bitacora.use-case';
import { CorregirDatosPracticaDto, CorreccionDatosPracticaRespuestaDto } from '../../dtos/acta-iniciacion.dto';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import { JUSTIFICACION_MINIMA } from '../../../domain/services/justificacion-decision';
import { ValidacionActaUseCase } from '../documentos/validacion-acta.use-case';
import { proyectarPracticaPara } from './proyeccion-practica';
import { AvanceDocumentalDomainService } from '../../../domain/services/avance-documental.domain-service';
import { EQUIVALENCIA_SGP } from '../../../domain/entities/practica.entity';
import { CargueEstudianteService } from '../documentos/cargue-estudiante.service';

export interface Actor {
  id: string;
  correo: string;
  rol: Rol;
  /** consulta | escritura. Lo decide el token; la guardia global cierra las escrituras. */
  permiso: Permiso;
  escuelas: readonly string[];
  empresaId: string | null;
  ip?: string | null;
  agenteUsuario?: string | null;
}

const ETIQUETA_CAMPO: Readonly<Record<string, string>> = {
  area: 'área', cargo: 'cargo', tipoRemuneracion: 'remuneración', salario: 'salario', horario: 'horario',
  jefeInmediatoNombre: 'jefe inmediato', jefeInmediatoCargo: 'cargo del jefe', jefeInmediatoCorreo: 'correo del jefe',
  jefeInmediatoTelefono: 'teléfono del jefe', ciudad: 'ciudad', funcionesRelevantes: 'funciones', responsableArl: 'responsable de la ARL',
  modalidad: 'modalidad',
};

@Injectable()
export class GestionarPracticaUseCase {
  private readonly acompanamiento = new AcompanamientoDomainService();
  private readonly obligacionesDominio = new ObligacionesDomainService();
  private readonly avance = new AvanceDocumentalDomainService();

  constructor(
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(OBLIGACION_REPOSITORY) private readonly obligaciones: ObligacionRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    private readonly parametros: ParametrosUseCase,
    @Optional() private readonly validacionesActa?: ValidacionActaUseCase,
    @Optional() private readonly cargueEstudiante?: CargueEstudianteService,
    @Optional() @Inject(PERIODO_REPOSITORY) private readonly periodos?: PeriodoRepositoryPort,
    @Optional() private readonly bitacoraUc?: BitacoraUseCase,
  ) {}

  /** Crea la práctica y, con ella, sus obligaciones normativas (M5). */
  async crear(dto: CrearPracticaDto, actor: Actor): Promise<PracticaRespuestaDto> {
    const ahora = new Date();
    const datos: DatosPractica = {
      id: randomUUID(),
      numeroFur: null,
      estudianteId: dto.estudianteId,
      programaId: dto.programaId,
      escuelaId: dto.escuelaId,
      regional: null,
      asignatura: null,
      ciclo: dto.ciclo,
      periodoAcademico: dto.periodoAcademico,
      modalidad: dto.modalidad,
      estado: EstadoPractica.INSCRITA,
      tutorId: null,
      empresaId: dto.empresaId ?? null,
      empresaRazonSocial: null,
      empresaNit: null,
      area: null,
      cargo: dto.cargo ?? null,
      tipoRemuneracion: null,
      salario: null,
      horario: null,
      jefeInmediatoNombre: dto.jefeInmediatoNombre ?? null,
      jefeInmediatoCargo: null,
      jefeInmediatoCorreo: dto.jefeInmediatoCorreo ?? null,
      jefeInmediatoTelefono: null,
      ciudad: null,
      funcionesRelevantes: null,
      fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : null,
      fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
      horasRegistradas: null,
      arlVerificada: false,
      arlFechaAfiliacion: null,
      responsableArlPractica: null,
      terminosAceptadosEn: null,
      registradaPor: 'coordinacion',
      nota: null,
      cerradaEn: null,
      ultimaActividad: ahora,
      creadaEn: ahora,
      actualizadaEn: ahora,
    };

    if (dto.empresaId) {
      const empresa = await this.empresas.buscarPorId(dto.empresaId);
      if (!empresa?.habilitada) {
        throw new BadRequestException(
          'La empresa no está habilitada. Una práctica solo puede registrarse con empresa verificada.',
        );
      }
    }

    const practica = await this.practicas.guardar(datos);

    const plantillas = this.obligacionesDominio.plantillasPara(practica, ahora);
    await this.obligaciones.guardarLote(
      plantillas.map((p) =>
        ObligacionesDomainService.nuevaObligacion(randomUUID(), practica.id, p, ahora),
      ),
    );

    await this.registrarAuditoria(actor, AccionAuditada.TRANSICION_PRACTICA, practica.id, {
      destino: EstadoPractica.INSCRITA,
      obligacionesCreadas: plantillas.map((p) => p.tipo),
    });

    return this.presentar(practica, actor);
  }

  async listar(
    filtro: FiltroPracticas & {
      busqueda?: string;
      porcentajeCargadoMinimo?: number;
      porcentajeAprobadoMinimo?: number;
    },
    actor: Actor,
  ): Promise<PracticaRespuestaDto[]> {
    const { busqueda, porcentajeCargadoMinimo, porcentajeAprobadoMinimo, ...resto } = filtro;
    let filtroSeguro = this.aplicarAlcance(resto, actor);

    // Búsqueda del SGP: documento, correo o nombre. Se resuelve a identidades
    // antes de consultar, así el alcance sigue aplicándose en la consulta.
    if (busqueda?.trim()) {
      const coincidencias = await this.usuarios.buscarTexto(busqueda.trim(), 50);
      const ids = coincidencias.filter((u) => u.rol === Rol.ESTUDIANTE).map((u) => u.id);
      if (ids.length === 0) return [];
      filtroSeguro = { ...filtroSeguro, estudianteIds: ids };
    }

    const practicas = await this.practicas.listar(filtroSeguro);
    const respuestas = await Promise.all(practicas.map((p) => this.presentar(p, actor)));
    return respuestas.filter((r) =>
      (porcentajeCargadoMinimo === undefined || r.avance.porcentajeCargado >= porcentajeCargadoMinimo) &&
      (porcentajeAprobadoMinimo === undefined || r.avance.porcentajeAprobado >= porcentajeAprobadoMinimo),
    );
  }

  /**
   * Edición posterior al registro (SGP, botón de lápiz): solo los datos de la
   * vacante. La modalidad y las fechas quedaron fijas al registrar.
   */
  /**
   * Motor interno de la edición de la vacante (ya sin ruta propia: la modificación posterior va por
   * `modificarPractica`, con justificación). G5: solo coordinación y analista.
   */
  async actualizarVacante(id: string, dto: ActualizarVacanteDto, actor: Actor): Promise<PracticaRespuestaDto> {
    if (!puedeModificarPractica(actor)) {
      throw new ForbiddenException('Solo coordinación o analista de prácticas modifican la práctica registrada');
    }
    // Quién asume la ARL es un acuerdo que el acta de iniciación luego confirma o contradice: tras el registro solo
    // coordinación y administración lo cambian (el estudiante lo fija al registrar; cambiarlo después silenciaría una
    // discrepancia). Se comprueba antes de aplicar nada para no dejar una edición a medias.
    if (dto.responsableArl !== undefined && ![Rol.COORDINADOR, Rol.ANALISTA, Rol.ADMINISTRADOR].includes(actor.rol)) {
      throw new ForbiddenException('Solo coordinación o administración cambian quién asume la ARL de la práctica');
    }
    const practica = await this.exigirVisible(id, actor);
    // Con un acta de iniciación cargada, remuneración y responsable de la ARL gobiernan la comparación documental: ya no se
    // editan por aquí (ni siquiera coordinación). Se corrigen con la corrección controlada, con justificación y auditoría.
    if ((dto.tipoRemuneracion !== undefined || dto.responsableArl !== undefined) && await this.tieneActaCargada(id)) {
      if (![Rol.COORDINADOR, Rol.ANALISTA, Rol.ADMINISTRADOR].includes(actor.rol)) {
        throw new ForbiddenException('Con el acta de iniciación cargada, la remuneración y quién asume la ARL solo las corrige coordinación o administración, con justificación.');
      }
      throw new BadRequestException('Con el acta de iniciación cargada, la remuneración y quién asume la ARL se corrigen con la corrección controlada, que exige justificación.');
    }
    const arlAnterior = practica.responsableArlPractica;
    try {
      practica.actualizarVacante(dto);
      if (dto.responsableArl !== undefined && dto.responsableArl !== arlAnterior) practica.definirResponsableArl(dto.responsableArl);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const guardada = await this.practicas.guardar(practica.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.VACANTE_PRACTICA_ACTUALIZADA, id, {
      campos: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
    });
    if (dto.responsableArl !== undefined && dto.responsableArl !== arlAnterior) {
      await this.registrarAuditoria(actor, AccionAuditada.RESPONSABLE_ARL_PRACTICA_ACTUALIZADO, id, {
        de: arlAnterior, a: dto.responsableArl,
      });
    }
    return this.presentar(guardada, actor);
  }

  private async tieneActaCargada(practicaId: string): Promise<boolean> {
    return (await this.documentos.listarPorPractica(practicaId)).some((d) => d.tipo === TipoDocumento.ACTA_INICIO);
  }

  /**
   * Corrección CONTROLADA de la remuneración y de quién asume la ARL: son los datos con los que se compara el acta de
   * iniciación. Solo coordinación y administración, con justificación y auditoría (valor anterior, nuevo, actor, motivo). No
   * modifica el acta ni una decisión ya tomada; si hay una validación sin decidir, su comparación se recalcula en una ronda
   * nueva; si ya estaba decidida, solo queda constancia de que los datos cambiaron después.
   */
  async corregirDatosGobernantes(id: string, dto: CorregirDatosPracticaDto, actor: Actor): Promise<CorreccionDatosPracticaRespuestaDto> {
    if (!puedeModificarPractica(actor)) {
      throw new ForbiddenException('Solo coordinación o analista de prácticas corrigen estos datos de la práctica');
    }
    const justificacion = (dto.justificacion ?? '').trim();
    if (justificacion.length < JUSTIFICACION_MINIMA) {
      throw new BadRequestException(`La corrección exige una justificación (al menos ${JUSTIFICACION_MINIMA} caracteres)`);
    }
    const practica = await this.exigirVisible(id, actor);
    const antes = practica.instantanea();
    const cambios: { remuneracion?: { de: string | null; a: string }; responsableArl?: { de: string | null; a: string } } = {};
    try {
      if (dto.tipoRemuneracion !== undefined && dto.tipoRemuneracion !== antes.tipoRemuneracion) {
        practica.actualizarVacante({
          tipoRemuneracion: dto.tipoRemuneracion, ...(dto.tipoRemuneracion === 'no_remunerada' ? { salario: null } : {}),
        });
        cambios.remuneracion = { de: antes.tipoRemuneracion, a: dto.tipoRemuneracion };
      }
      if (dto.responsableArl !== undefined && dto.responsableArl !== antes.responsableArlPractica) {
        practica.definirResponsableArl(dto.responsableArl);
        cambios.responsableArl = { de: antes.responsableArlPractica, a: dto.responsableArl };
      }
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    if (!cambios.remuneracion && !cambios.responsableArl) {
      const actual = practica.instantanea();
      return { practicaId: id, tipoRemuneracion: actual.tipoRemuneracion, responsableArl: actual.responsableArlPractica, actaIniciacion: 'sin_cambios' };
    }
    const guardada = await this.practicas.guardar(practica.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.DATOS_PRACTICA_CORREGIDOS_ACTA, id, { ...cambios }, justificacion);
    const acta = this.validacionesActa
      ? await this.validacionesActa.alCambiarDatosDeLaPractica(id, cambios, actor, justificacion)
      : 'sin_acta' as const;
    const d = guardada.instantanea();
    return { practicaId: id, tipoRemuneracion: d.tipoRemuneracion, responsableArl: d.responsableArlPractica, actaIniciacion: acta };
  }

  // ── G5 · Gobierno de la práctica ────────────────────────────────────────

  /**
   * Modificación controlada de una práctica registrada: SOLO coordinación y analista (`puedeModificarPractica`;
   * ni administración ni dirección). Lista cerrada de campos, justificación obligatoria, control optimista y UN
   * evento de auditoría con `cambios: { campo: { de, a } }`. Sin cambios reales no guarda ni audita.
   *  · Modalidad: debe estar ofertada en el periodo y, si la nueva lo exige, las fechas deben caer dentro de él.
   *    Las obligaciones se reconcilian (cumplidas intactas; las que ya no aplican pasan a «no aplica»; las nuevas
   *    se crean). Documentos y decisiones no se tocan. El responsable de la ARL NO se infiere: si no coincide con
   *    la sugerencia de la nueva modalidad, queda como pendiente para revisar.
   *  · Remuneración, responsable de la ARL o modalidad con un acta cargada: misma integración que la corrección
   *    controlada (recalcula la comparación o deja constancia si ya estaba decidida).
   * Fechas, periodo, empresa, estado, nota, horas y ARL verificada no se editan aquí.
   */
  async modificarPractica(id: string, dto: ModificarPracticaDto, actor: Actor, ahora: Date = new Date()): Promise<PracticaRespuestaDto> {
    if (!puedeModificarPractica(actor)) {
      throw new ForbiddenException('Solo coordinación o analista de prácticas modifican la práctica registrada');
    }
    const justificacion = (dto.justificacion ?? '').trim();
    if (justificacion.length < JUSTIFICACION_MINIMA) {
      throw new BadRequestException(`La modificación exige una justificación (al menos ${JUSTIFICACION_MINIMA} caracteres)`);
    }
    const practica = await this.exigirVisible(id, actor);
    this.exigirVersion(practica, dto.actualizadaEn);
    if (practica.esTerminal) throw new BadRequestException('La práctica ya cerró: sus datos no se modifican');
    const antes = practica.instantanea();

    const CAMPOS = [
      'area', 'cargo', 'tipoRemuneracion', 'salario', 'horario', 'jefeInmediatoNombre', 'jefeInmediatoCargo',
      'jefeInmediatoCorreo', 'jefeInmediatoTelefono', 'ciudad', 'funcionesRelevantes',
    ] as const;
    const vacante: Record<string, unknown> = {};
    const cambios: Record<string, { de: unknown; a: unknown }> = {};
    for (const campo of CAMPOS) {
      const nuevo = (dto as unknown as Record<string, unknown>)[campo];
      if (nuevo === undefined) continue;
      const valor = typeof nuevo === 'string' ? nuevo.trim() : nuevo;
      if (valor !== (antes as unknown as Record<string, unknown>)[campo]) { vacante[campo] = valor; cambios[campo] = { de: (antes as unknown as Record<string, unknown>)[campo], a: valor }; }
    }
    if (vacante.tipoRemuneracion === 'no_remunerada' && antes.salario !== null) { vacante.salario = null; cambios.salario = { de: antes.salario, a: null }; }
    if (dto.responsableArl !== undefined && dto.responsableArl !== antes.responsableArlPractica) cambios.responsableArl = { de: antes.responsableArlPractica, a: dto.responsableArl };
    const cambiaModalidad = dto.modalidad !== undefined && dto.modalidad !== antes.modalidad;
    if (cambiaModalidad) cambios.modalidad = { de: antes.modalidad, a: dto.modalidad };
    if (Object.keys(cambios).length === 0) return this.presentarDetalle(practica, actor);

    if (cambiaModalidad) await this.exigirModalidadValida(practica, dto.modalidad as ModalidadPractica);
    try {
      if (Object.keys(vacante).length > 0) practica.actualizarVacante(vacante, ahora);
      if (cambios.responsableArl) practica.definirResponsableArl(dto.responsableArl as NonNullable<typeof dto.responsableArl>, ahora);
      if (cambiaModalidad) practica.cambiarModalidad(dto.modalidad as ModalidadPractica, ahora);
    } catch (error) {
      if (error instanceof CambioModalidadError || error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
    const guardada = await this.practicas.guardar(practica.instantanea());

    let obligaciones: { noAplica: string[]; creadas: string[] } | undefined;
    if (cambiaModalidad) obligaciones = await this.reconciliarObligaciones(guardada, ahora);
    const pendientes = this.pendientesDe(guardada);

    let actaIniciacion: string | undefined;
    if (this.validacionesActa && (cambios.tipoRemuneracion || cambios.responsableArl || cambios.modalidad)) {
      actaIniciacion = await this.validacionesActa.alCambiarDatosDeLaPractica(id, {
        ...(cambios.tipoRemuneracion ? { remuneracion: { de: antes.tipoRemuneracion, a: String(cambios.tipoRemuneracion.a) } } : {}),
        ...(cambios.responsableArl ? { responsableArl: { de: antes.responsableArlPractica, a: String(cambios.responsableArl.a) } } : {}),
        ...(cambios.modalidad ? { modalidad: { de: antes.modalidad, a: String(cambios.modalidad.a) } } : {}),
      }, actor, justificacion);
    }

    await this.registrarAuditoria(actor, AccionAuditada.PRACTICA_MODIFICADA, id, {
      cambios, ...(obligaciones ? { obligaciones } : {}), ...(pendientes.length ? { pendientes } : {}), ...(actaIniciacion ? { actaIniciacion } : {}),
    }, justificacion);
    await this.anotar(guardada.id, actor, cambiaModalidad
      ? `${await this.nombreDe(actor)} cambió Modalidad: ${this.etiquetaModalidad(antes.modalidad)} → ${this.etiquetaModalidad(dto.modalidad as ModalidadPractica)}${Object.keys(cambios).length > 1 ? ` y ${Object.keys(cambios).length - 1} dato(s) más` : ''}. Motivo: ${justificacion}`
      : `${await this.nombreDe(actor)} modificó datos de la práctica (${Object.keys(cambios).map((c) => ETIQUETA_CAMPO[c] ?? c).join(', ')}). Motivo: ${justificacion}`, ahora);
    return this.presentarDetalle(guardada, actor);
  }

  /**
   * Cambio manual de estado OPERATIVO. Solo coordinación y analista. Nunca fuerza: usa la máquina de estados del
   * dominio paso a paso (responsable de la ARL, compuerta ARL, obligaciones) y, para «Cerrado», el flujo de cierre
   * (nota aprobatoria y condiciones). «Inscrito» no admite retroceso.
   */
  async cambiarEstadoOperativo(id: string, dto: CambiarEstadoOperativoDto, actor: Actor, ahora: Date = new Date()): Promise<PracticaRespuestaDto> {
    if (!puedeModificarPractica(actor)) {
      throw new ForbiddenException('Solo coordinación o analista de prácticas cambian el estado de una práctica');
    }
    const justificacion = (dto.justificacion ?? '').trim();
    if (justificacion.length < JUSTIFICACION_MINIMA) {
      throw new BadRequestException(`El cambio de estado exige una justificación (al menos ${JUSTIFICACION_MINIMA} caracteres)`);
    }
    if (!ESTADOS_OPERATIVOS.includes(dto.destino)) throw new BadRequestException('Estado operativo desconocido');
    const practica = await this.exigirVisible(id, actor);
    this.exigirVersion(practica, dto.actualizadaEn);
    const deOperativo = practica.estadoOperativo;
    const deTecnico = practica.estado;
    if (deOperativo === dto.destino) throw new BadRequestException(`La práctica ya está en «${ETIQUETA_ESTADO_OPERATIVO[dto.destino]}»`);

    if (dto.destino === 'cerrado') {
      const motivo = await this.motivoNoCierre(practica, actor);
      if (motivo) throw new BadRequestException(motivo);
      if (!this.bitacoraUc) throw new BadRequestException('El cierre no está disponible en este momento');
      await this.bitacoraUc.cerrar(id, actor, ahora);
    } else {
      const motivo = await this.motivoBloqueo(practica, dto.destino);
      if (motivo) throw new BadRequestException(motivo);
      try {
        practica.aplicarRuta(practica.rutaHaciaEstadoOperativo(dto.destino) as EstadoPractica[], ahora);
      } catch (error) {
        throw new BadRequestException(this.mensajeDominio(error, dto.destino));
      }
      await this.practicas.guardar(practica.instantanea());
    }
    const actual = (await this.practicas.buscarPorId(id)) as Practica;
    await this.registrarAuditoria(actor, AccionAuditada.ESTADO_OPERATIVO_CAMBIADO, id, {
      de: deOperativo, a: dto.destino, tecnico: { de: deTecnico, a: actual.estado },
    }, justificacion);
    await this.anotar(id, actor, `${await this.nombreDe(actor)} cambió el estado operativo: ${ETIQUETA_ESTADO_OPERATIVO[deOperativo]} → ${ETIQUETA_ESTADO_OPERATIVO[actual.estadoOperativo]}. Motivo: ${justificacion}`, ahora);
    return this.presentarDetalle(actual, actor);
  }

  async obtener(id: string, actor: Actor): Promise<PracticaRespuestaDto> {
    const practica = await this.exigirVisible(id, actor);
    await this.registrarAuditoria(actor, AccionAuditada.EXPEDIENTE_CONSULTADO, id, null);
    const respuesta = await this.presentar(practica, actor);
    // G2: estado del cargue del estudiante calculado en el servidor (solo en el detalle, no en el listado).
    if (this.cargueEstudiante) {
      respuesta.cargueEstudiante = this.cargueEstudiante.proyectar(await this.cargueEstudiante.contexto(practica));
    }
    respuesta.gobierno = await this.gobiernoDe(practica, actor);
    return respuesta;
  }

  /**
   * Transición de estado. `en_validacion → activa` pasa obligatoriamente por
   * la compuerta de ARL, que vive en el dominio.
   */
  async transicionar(
    id: string,
    destino: EstadoPractica,
    justificacion: string,
    actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    if (!puedeModificarPractica(actor)) {
      throw new ForbiddenException('Solo coordinación o analista de prácticas cambian el estado de una práctica');
    }
    const practica = await this.exigirVisible(id, actor);

    if (destino === EstadoPractica.ACTIVA) {
      const obligaciones = await this.obligaciones.listarPorPractica(id);
      const bloqueos = this.obligacionesDominio.bloqueosParaActivar(obligaciones);
      if (bloqueos.length > 0) {
        throw new BadRequestException(
          'No se puede activar: la obligación de afiliación a ARL (Decreto 055 de 2015) no está cumplida.',
        );
      }
    }

    try {
      practica.transicionarA(destino);
    } catch (error) {
      if (error instanceof CompuertaArlError || error instanceof TransicionInvalidaError || error instanceof ResponsableArlNoDefinidoError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const guardada = await this.practicas.guardar(practica.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.TRANSICION_PRACTICA, id, { destino }, justificacion);
    return this.presentar(guardada, actor);
  }

  // ── G5 · internos ──────────────────────────────────────────────────────

  /** Detalle con el mismo armado de `obtener` (cargue del estudiante y gobierno), sin volver a auditar la consulta. */
  private async presentarDetalle(practica: Practica, actor: Actor): Promise<PracticaRespuestaDto> {
    const respuesta = await this.presentar(practica, actor);
    if (this.cargueEstudiante) respuesta.cargueEstudiante = this.cargueEstudiante.proyectar(await this.cargueEstudiante.contexto(practica));
    respuesta.gobierno = await this.gobiernoDe(practica, actor);
    return respuesta;
  }

  /** Estado operativo para todos; destinos y pendientes solo para quien modifica (coordinación y analista). */
  private async gobiernoDe(practica: Practica, actor: Actor): Promise<GobiernoPracticaDto> {
    const puede = puedeModificarPractica(actor);
    const destinos: DestinoOperativoDto[] = [];
    if (puede) {
      for (const estado of ESTADOS_OPERATIVOS) {
        if (estado === practica.estadoOperativo) continue;
        const motivo = estado === 'cerrado' ? await this.motivoNoCierre(practica, actor) : await this.motivoBloqueo(practica, estado);
        destinos.push({ estado, etiqueta: ETIQUETA_ESTADO_OPERATIVO[estado], disponible: motivo === null, motivo });
      }
    }
    return {
      estadoOperativo: practica.estadoOperativo, etiquetaEstadoOperativo: ETIQUETA_ESTADO_OPERATIVO[practica.estadoOperativo],
      actualizadaEn: practica.instantanea().actualizadaEn.toISOString(), puedeModificar: puede, destinos,
      pendientes: puede ? this.pendientesDe(practica) : [],
    };
  }

  /** ¿Por qué no se puede pasar a ese estado operativo? `null` = se puede. Ensaya la ruta sobre una copia. */
  private async motivoBloqueo(practica: Practica, destino: EstadoOperativo): Promise<string | null> {
    if (destino === 'inscrito') return 'No se retrocede a «Inscrito»: el avance del proceso se conserva. Si el registro tiene errores, anúlelo para habilitar uno nuevo.';
    if (practica.esTerminal) return 'La práctica ya terminó: su estado no cambia.';
    const ruta = practica.rutaHaciaEstadoOperativo(destino);
    if (!ruta) return `No hay un paso permitido de «${ETIQUETA_ESTADO_OPERATIVO[practica.estadoOperativo]}» a «${ETIQUETA_ESTADO_OPERATIVO[destino]}».`;
    if (ruta.includes(EstadoPractica.ACTIVA)) {
      const bloqueos = this.obligacionesDominio.bloqueosParaActivar(await this.obligaciones.listarPorPractica(practica.id));
      if (bloqueos.length > 0) return 'No se puede pasar a «En práctica»: la obligación de afiliación a ARL (Decreto 055 de 2015) no está cumplida.';
    }
    try {
      Practica.desde(practica.instantanea()).aplicarRuta(ruta);
      return null;
    } catch (error) {
      return this.mensajeDominio(error, destino);
    }
  }

  /** «Cerrado» usa el flujo de cierre: condiciones (documentos, «Evalúa tu proceso», nota) y nota aprobatoria. */
  private async motivoNoCierre(practica: Practica, actor: Actor): Promise<string | null> {
    if (practica.esTerminal) return 'La práctica ya terminó: su estado no cambia.';
    if (![EstadoPractica.ACTIVA, EstadoPractica.FINALIZADA].includes(practica.estado)) return 'Solo una práctica «En práctica» se cierra.';
    if (!this.bitacoraUc) return 'El cierre no está disponible en este momento.';
    const estado = await this.bitacoraUc.estadoCierre(practica.id, actor);
    if (!estado.puedeCerrar) return `No se puede cerrar todavía: ${estado.faltantes.join('; ')}.`;
    if (estado.aprobada !== true) return 'La calificación no es aprobatoria: el cierre la dejaría en «Reprobado».';
    return null;
  }

  private mensajeDominio(error: unknown, destino: EstadoOperativo): string {
    if (error instanceof CompuertaArlError) return `No se puede pasar a «${ETIQUETA_ESTADO_OPERATIVO[destino]}»: ${error.message.replace(/^[^:]*:\s*/, '')}.`;
    if (error instanceof ResponsableArlNoDefinidoError) return `No se puede pasar a «${ETIQUETA_ESTADO_OPERATIVO[destino]}»: falta definir quién asume la ARL.`;
    if (error instanceof TransicionInvalidaError) return `No hay un paso permitido hacia «${ETIQUETA_ESTADO_OPERATIVO[destino]}» desde el estado actual.`;
    return (error as Error).message;
  }

  /** Control optimista: si la práctica cambió después de abrir el editor, no se sobrescribe en silencio. */
  private exigirVersion(practica: Practica, version: string | undefined): void {
    if (version && version !== practica.instantanea().actualizadaEn.toISOString()) {
      throw new ConflictException('La práctica cambió mientras la editabas. Recarga el expediente y vuelve a intentarlo.');
    }
  }

  private async exigirModalidadValida(practica: Practica, nueva: ModalidadPractica): Promise<void> {
    const definicion = definicionModalidad(nueva);
    const periodo = this.periodos ? await this.periodos.buscarPorCodigo(practica.periodoAcademico) : null;
    if (!periodo) return; // sin periodo legible no se puede comprobar la oferta: el cambio no se bloquea por eso
    try {
      periodo.exigirModalidad(nueva);
    } catch (error) {
      if (error instanceof ModalidadNoOfertadaError) throw new BadRequestException(`La modalidad «${definicion.etiqueta}» no está ofertada en el periodo ${periodo.codigo}`);
      throw error;
    }
    const d = practica.instantanea();
    if (definicion.fechasDentroDelPeriodo && d.fechaInicio && d.fechaFin && !periodo.contieneFechas(d.fechaInicio, d.fechaFin)) {
      throw new BadRequestException(`Con la modalidad «${definicion.etiqueta}» las fechas de la práctica deben estar dentro del periodo ${periodo.codigo}`);
    }
  }

  /** Reconciliación de obligaciones tras un cambio de modalidad (nada se borra). */
  private async reconciliarObligaciones(practica: Practica, ahora: Date): Promise<{ noAplica: string[]; creadas: string[] }> {
    const existentes = await this.obligaciones.listarPorPractica(practica.id);
    const { dejanDeAplicar, nuevas } = this.obligacionesDominio.reconciliar(practica, existentes, ahora);
    for (const o of dejanDeAplicar) {
      o.marcarNoAplica(`No aplica tras el cambio de modalidad a ${this.etiquetaModalidad(practica.modalidad)}`, ahora);
      await this.obligaciones.guardar(o.instantanea());
    }
    if (nuevas.length > 0) {
      await this.obligaciones.guardarLote(nuevas.map((p) => ObligacionesDomainService.nuevaObligacion(randomUUID(), practica.id, p, ahora)));
    }
    return { noAplica: dejanDeAplicar.map((o) => o.tipo), creadas: nuevas.map((p) => p.tipo) };
  }

  /** Asuntos para revisar a mano (nunca se corrigen solos). */
  private pendientesDe(practica: Practica): string[] {
    const sugerido = responsableArlSugerido(practica.modalidad);
    const actual = practica.responsableArlPractica;
    if (sugerido !== null && actual !== null && actual !== sugerido) {
      return [`Revisar quién asume la ARL: la modalidad sugiere ${sugerido === 'cun' ? 'CUN' : 'Empresa'} y la práctica dice ${actual === 'cun' ? 'CUN' : 'Empresa'}.`];
    }
    if (actual === null) return ['Definir quién asume la ARL de esta práctica.'];
    return [];
  }

  private etiquetaModalidad(m: ModalidadPractica): string {
    try { return definicionModalidad(m).etiqueta; } catch { return m; }
  }

  private async nombreDe(actor: Actor): Promise<string> {
    return (await this.usuarios.buscarPorId(actor.id))?.nombre ?? actor.correo.split('@')[0];
  }

  private async anotar(practicaId: string, actor: Actor, mensaje: string, ahora: Date): Promise<void> {
    if (!this.bitacoraUc) return;
    try { await this.bitacoraUc.anotarCambioDeGobierno(practicaId, mensaje, ahora); } catch { /* la auditoría ya quedó; la nota es de lectura */ }
  }

  /** La CUN afilia y paga: el riesgo aquí es la omisión, no el fraude. */
  async registrarArl(
    id: string,
    fechaAfiliacion: Date,
    documentoId: string | null,
    actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    if (![Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR].includes(actor.rol)) {
      throw new ForbiddenException('Solo administración o el auxiliar de prácticas registran la afiliación a ARL');
    }
    const practica = await this.exigirVisible(id, actor);
    practica.registrarAfiliacionArl(fechaAfiliacion);

    // Se valida ya, para no dejar una afiliación inservible registrada en silencio.
    try {
      practica.verificarCompuertaArl();
    } catch (error) {
      if (error instanceof CompuertaArlError) throw new BadRequestException(error.message);
      throw error;
    }

    const guardada = await this.practicas.guardar(practica.instantanea());

    const obligaciones = await this.obligaciones.listarPorPractica(id);
    const arl = obligaciones.find((o) => o.tipo === TipoObligacion.AFILIACION_ARL);
    if (arl && arl.estado !== EstadoObligacion.CUMPLIDA) {
      arl.cumplir(documentoId);
      await this.obligaciones.guardar(arl.instantanea());
    }

    await this.registrarAuditoria(actor, AccionAuditada.OBLIGACION_CUMPLIDA, id, {
      tipo: TipoObligacion.AFILIACION_ARL,
      fechaAfiliacion: fechaAfiliacion.toISOString(),
    });
    return this.presentar(guardada, actor);
  }

  async registrarHoras(id: string, horas: number, actor: Actor): Promise<PracticaRespuestaDto> {
    const practica = await this.exigirVisible(id, actor);
    practica.registrarHoras(horas);
    const guardada = await this.practicas.guardar(practica.instantanea());
    return this.presentar(guardada, actor);
  }

  /**
   * G6 · Asignación MANUAL de docente facilitador. Solo coordinación y analista. El docente debe existir, ser
   * docente facilitador, estar activo, tener permiso de escritura y la escuela de la práctica en su alcance (alcance
   * vacío NO es institucional para el docente). Reemplazar un docente ya asignado exige justificación. Auditado.
   */
  async asignarTutor(id: string, tutorId: string, actor: Actor, justificacion?: string, ahora: Date = new Date()): Promise<PracticaRespuestaDto> {
    if (!puedeModificarPractica(actor)) {
      throw new ForbiddenException('La asignación de docente facilitador la hacen coordinación y analista.');
    }
    const practica = await this.exigirVisible(id, actor);
    if (practica.esTerminal) throw new BadRequestException('La práctica está en un estado final: no se le asigna docente.');
    const docente = await this.usuarios.buscarPorId(tutorId);
    const d = docente?.instantanea();
    if (!d || d.rol !== Rol.TUTOR) throw new BadRequestException('El usuario indicado no es un docente facilitador.');
    if (!d.activo) throw new BadRequestException('El docente facilitador está inhabilitado: no recibe asignaciones.');
    if (d.permiso !== 'escritura') throw new BadRequestException('El docente facilitador tiene permiso de solo consulta.');
    if (!d.escuelas.includes(practica.escuelaId)) {
      throw new BadRequestException('La escuela de la práctica no está en el alcance de ese docente facilitador.');
    }
    const anterior = practica.tutorId;
    if (anterior === tutorId) return this.obtener(id, actor);
    const motivo = (justificacion ?? '').trim();
    if (anterior && motivo.length < JUSTIFICACION_MINIMA) {
      throw new BadRequestException(`Reemplazar el docente asignado exige justificación (mínimo ${JUSTIFICACION_MINIMA} caracteres).`);
    }
    practica.asignarTutor(tutorId, ahora);
    const guardada = await this.practicas.guardar(practica.instantanea());
    const anteriorNombre = anterior ? (await this.usuarios.buscarPorId(anterior))?.nombre ?? null : null;
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.TUTOR_ASIGNADO,
      entidad: 'practica', entidadId: id, justificacion: motivo || null,
      metadatos: { tutorId, tutorNombre: d.nombre, anteriorTutorId: anterior, metodo: 'manual', periodoAcademico: practica.periodoAcademico },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    const quien = await this.nombreDe(actor);
    await this.anotar(id, actor, anterior
      ? `Docente facilitador cambiado: ${anteriorNombre ?? 'anterior'} → ${d.nombre}, por ${quien}. Motivo: ${motivo}`
      : `Docente facilitador asignado: ${d.nombre}. Asignación manual, por ${quien}.`, ahora);
    return this.presentar(guardada, actor);
  }

  // ── internos ─────────────────────────────────────────────────────────────

  /**
   * Restringe el filtro al alcance del actor ANTES de consultar. El alcance no
   * se aplica filtrando resultados: se aplica acotando la consulta.
   */
  private aplicarAlcance(filtro: FiltroPracticas, actor: Actor): FiltroPracticas {
    switch (actor.rol) {
      case Rol.ESTUDIANTE:
        return { ...filtro, estudianteId: actor.id, tutorId: undefined, empresaId: undefined };
      case Rol.EMPRESA:
        return { ...filtro, empresaId: actor.empresaId ?? '__sin_empresa__', estudianteId: undefined };
      case Rol.TUTOR:
        return { ...filtro, escuelaIds: actor.escuelas, estudianteId: undefined };
      case Rol.COORDINADOR:
      case Rol.ANALISTA:
      case Rol.DIRECTOR: {
        // Coordinador y analista sin escuelas (Área de Prácticas) y director: institucional.
        const escuelas = escuelasDeCoordinacion(actor);
        return escuelas === null ? filtro : { ...filtro, escuelaIds: escuelas };
      }
      case Rol.ADMINISTRADOR:
      case Rol.EXTENSION:
      case Rol.AUXILIAR:
        return filtro;
    }
  }

  private async exigirVisible(id: string, actor: Actor): Promise<Practica> {
    const practica = await this.practicas.buscarPorId(id);
    // Error genérico: no confirma la existencia del registro.
    if (!practica) throw new NotFoundException('Expediente no encontrado');

    const visible = practica.visiblePara({
      id: actor.id,
      rol: actor.rol,
      escuelas: actor.escuelas,
      empresaId: actor.empresaId,
    });
    if (!visible) {
      await this.registrarAuditoria(actor, AccionAuditada.ACCESO_FUERA_DE_ALCANCE, id, null);
      throw new NotFoundException('Expediente no encontrado');
    }
    return practica;
  }

  /** Proyección del expediente para el actor: columnas filtradas en el servidor. */
  async presentar(practica: Practica, actor: Actor): Promise<PracticaRespuestaDto> {
    const datos = practica.instantanea();
    const [documentos, obligaciones, estudiante, empresa, tutor] = await Promise.all([
      this.documentos.listarPorPractica(practica.id),
      this.obligaciones.listarPorPractica(practica.id),
      this.usuarios.buscarPorId(datos.estudianteId),
      datos.empresaId ? this.empresas.buscarPorId(datos.empresaId) : Promise.resolve(null),
      datos.tutorId ? this.usuarios.buscarPorId(datos.tutorId) : Promise.resolve(null),
    ]);
    const avance = this.avance.calcular(
      datos.modalidad,
      documentos.map((d) => {
        const i = d.instantanea();
        return { tipo: i.tipo, version: i.version, estado: i.estado };
      }),
    );

    const reenviosPorTipo: Record<string, number> = {};
    for (const doc of documentos) {
      const version = doc.instantanea().version;
      reenviosPorTipo[doc.tipo] = Math.max(reenviosPorTipo[doc.tipo] ?? 0, version);
    }

    // La ventana de silencio y la anticipación ante un vencimiento las decide
    // la Dirección desde administración, no un despliegue.
    const evaluacion = this.acompanamiento.evaluar(
      practica,
      {
        reenviosPorTipo,
        estadosDocumentos: documentos.map((d) => d.estado),
        obligaciones,
        empresaRespondio: documentos.length > 0,
        cierrePeriodo: datos.fechaFin,
      },
      new Date(),
      {
        diasSinActividad: await this.parametros.numero('acompanamiento.dias_sin_actividad'),
        diasVencimientoRiesgo: await this.parametros.numero(
          'acompanamiento.dias_vencimiento_riesgo',
        ),
      },
    );

    // Filtrado de columnas EN EL SERVIDOR: el estudiante no recibe la señal
    // interna de riesgo ni las observaciones de acompañamiento.
    const esInterno = [Rol.TUTOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.DIRECTOR, Rol.ADMINISTRADOR, Rol.EXTENSION].includes(actor.rol);

    const completa: PracticaRespuestaDto = {
      id: datos.id,
      estudianteId: datos.estudianteId,
      estudianteNombre: estudiante?.nombre ?? '—',
      programaId: datos.programaId,
      escuelaId: datos.escuelaId,
      ciclo: datos.ciclo,
      periodoAcademico: datos.periodoAcademico,
      modalidad: datos.modalidad,
      estado: datos.estado,
      tutorId: datos.tutorId,
      tutorNombre: tutor?.nombre ?? null,
      empresaId: datos.empresaId,
      empresaRazonSocial: empresa?.razonSocial ?? datos.empresaRazonSocial,
      empresaNit: datos.empresaNit ?? (empresa ? empresa.nit.formateado : null),
      numeroFur: datos.numeroFur,
      regional: datos.regional,
      asignatura: datos.asignatura,
      area: datos.area,
      cargo: datos.cargo,
      tipoRemuneracion: datos.tipoRemuneracion,
      responsableArl: datos.responsableArlPractica,
      salario: datos.salario,
      horario: datos.horario,
      jefeInmediatoNombre: datos.jefeInmediatoNombre,
      jefeInmediatoCargo: datos.jefeInmediatoCargo,
      jefeInmediatoCorreo: datos.jefeInmediatoCorreo,
      jefeInmediatoTelefono: datos.jefeInmediatoTelefono,
      ciudad: datos.ciudad,
      funcionesRelevantes: datos.funcionesRelevantes,
      nota: datos.nota,
      registradaPor: datos.registradaPor,
      estadoSgp: EQUIVALENCIA_SGP[datos.estado],
      avance,
      fechaInicio: datos.fechaInicio?.toISOString() ?? null,
      fechaFin: datos.fechaFin?.toISOString() ?? null,
      horasRegistradas: datos.horasRegistradas,
      arlVerificada: datos.arlVerificada,
      senal: esInterno ? evaluacion.senal : SenalAcompanamiento.AL_DIA,
      disparadoresSenal: esInterno ? evaluacion.disparadores : [],
      transicionesPosibles: Object.values(EstadoPractica).filter((e) =>
        practica.puedeTransicionarA(e),
      ),
      ultimaActividad: datos.ultimaActividad.toISOString(),
    };
    // Minimización por rol: cada perfil recibe solo lo que su función requiere.
    return proyectarPracticaPara(actor.rol, completa);
  }

  private async registrarAuditoria(
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
      entidad: 'practica',
      entidadId,
      justificacion,
      metadatos,
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
  }
}

export { ModalidadPractica };
