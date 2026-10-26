import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { randomUUID } from 'node:crypto';
import {
  CompuertaArlError, DatosPractica, EstadoPractica, ModalidadPractica, Practica,
  SenalAcompanamiento, TransicionInvalidaError,
} from '../../../domain/entities/practica.entity';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { EstadoObligacion, TipoObligacion } from '../../../domain/entities/obligacion.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort,
  EMPRESA_REPOSITORY, EmpresaRepositoryPort, FiltroPracticas, OBLIGACION_REPOSITORY,
  ObligacionRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY,
  UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  AcompanamientoDomainService,
} from '../../../domain/services/acompanamiento.domain-service';
import {
  ObligacionesDomainService,
} from '../../../domain/services/obligaciones.domain-service';
import { Permiso, Rol } from '../../../domain/value-objects/rol.vo';
import { ActualizarVacanteDto, CrearPracticaDto, PracticaRespuestaDto } from '../../dtos/practica.dto';
import { proyectarPracticaPara } from './proyeccion-practica';
import { AvanceDocumentalDomainService } from '../../../domain/services/avance-documental.domain-service';
import { EQUIVALENCIA_SGP } from '../../../domain/entities/practica.entity';

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
  async actualizarVacante(id: string, dto: ActualizarVacanteDto, actor: Actor): Promise<PracticaRespuestaDto> {
    if (actor.rol === Rol.EMPRESA || actor.rol === Rol.EXTENSION) {
      throw new ForbiddenException('Su perfil no edita los datos de la práctica');
    }
    const practica = await this.exigirVisible(id, actor);
    try {
      practica.actualizarVacante(dto);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const guardada = await this.practicas.guardar(practica.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.VACANTE_PRACTICA_ACTUALIZADA, id, {
      campos: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
    });
    return this.presentar(guardada, actor);
  }

  async obtener(id: string, actor: Actor): Promise<PracticaRespuestaDto> {
    const practica = await this.exigirVisible(id, actor);
    await this.registrarAuditoria(actor, AccionAuditada.EXPEDIENTE_CONSULTADO, id, null);
    return this.presentar(practica, actor);
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
    if (actor.rol === Rol.ESTUDIANTE || actor.rol === Rol.EMPRESA) {
      throw new ForbiddenException('Su perfil no puede cambiar el estado de una práctica');
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
      if (error instanceof CompuertaArlError || error instanceof TransicionInvalidaError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const guardada = await this.practicas.guardar(practica.instantanea());
    await this.registrarAuditoria(actor, AccionAuditada.TRANSICION_PRACTICA, id, { destino }, justificacion);
    return this.presentar(guardada, actor);
  }

  /** La CUN afilia y paga: el riesgo aquí es la omisión, no el fraude. */
  async registrarArl(
    id: string,
    fechaAfiliacion: Date,
    documentoId: string | null,
    actor: Actor,
  ): Promise<PracticaRespuestaDto> {
    if (![Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.AUXILIAR].includes(actor.rol)) {
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

  async asignarTutor(id: string, tutorId: string, actor: Actor): Promise<PracticaRespuestaDto> {
    if (![Rol.ADMINISTRADOR, Rol.COORDINADOR].includes(actor.rol)) {
      throw new ForbiddenException('Solo coordinación o administración asignan tutor');
    }
    const practica = await this.exigirVisible(id, actor);
    practica.asignarTutor(tutorId);
    const guardada = await this.practicas.guardar(practica.instantanea());
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
        // Sin escuelas es la coordinación del Área de Prácticas: alcance institucional.
        return actor.escuelas.length === 0 ? filtro : { ...filtro, escuelaIds: actor.escuelas };
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
    const esInterno = [Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.EXTENSION].includes(actor.rol);

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
