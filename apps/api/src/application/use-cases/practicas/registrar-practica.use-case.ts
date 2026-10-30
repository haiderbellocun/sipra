import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  ETAPAS_POR_MOMENTO, ETIQUETA_MOMENTO, MomentoExpediente, definicionModalidad,
  ModalidadPractica,
} from '../../../domain/entities/modalidad.entity';
import {
  FechasFueraDelPeriodoError, FinDeSemanaError, ModalidadNoOfertadaError, PeriodoCerradoError,
  TipoVentana, VentanaCerradaError,
} from '../../../domain/entities/periodo.entity';
import {
  CicloAcademico, DatosPractica, EstadoPractica, responsableArlSugerido,
} from '../../../domain/entities/practica.entity';
import { criteriosDe } from '../../../domain/entities/criterios-documentales';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, EMPRESA_REPOSITORY, EmpresaRepositoryPort,
  OBLIGACION_REPOSITORY, ObligacionRepositoryPort, PERIODO_REPOSITORY, PeriodoRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { SINU, SinuPort } from '../../../domain/ports/out/servicios-externos.port';
import { ObligacionesDomainService } from '../../../domain/services/obligaciones.domain-service';
import { EventoNotificable } from '../../../domain/services/plantillas-notificacion.domain-service';
import {
  DuracionFueraDeRangoError, RequisitosDomainService,
} from '../../../domain/services/requisitos.domain-service';
import { Nit } from '../../../domain/value-objects/nit.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { NotificacionesService } from '../../../infrastructure/modules/notificaciones.service';
import { PracticaRespuestaDto, RegistrarPracticaDto } from '../../dtos/practica.dto';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import { Actor, GestionarPracticaUseCase } from './gestionar-practica.use-case';

/**
 * Formulario Único de Registro (SGP, Paso 2).
 *
 * Lo que el manual del estudiante y el de coordinación fijan, y aquí se hace
 * cumplir en el servidor:
 *  - un solo registro por estudiante y periodo; si tiene un error, coordinación
 *    lo anula y se habilita uno nuevo;
 *  - solo dentro de la ventana de registro del periodo; coordinación puede
 *    registrar excepciones en periodos cerrados si el parámetro lo permite;
 *  - los datos básicos vienen de SINU y no se editan;
 *  - la modalidad y las fechas no se modifican después;
 *  - las fechas caen dentro del periodo (salvo contrato de aprendizaje) y no
 *    pueden ser sábado ni domingo;
 *  - la modalidad debe estar ofertada en el periodo;
 *  - al terminar, el estudiante recibe la confirmación con la lista documental.
 */
/** Cadena de formación: técnico → tecnólogo → profesional. */
const ORDEN_CICLO: readonly CicloAcademico[] = [
  CicloAcademico.TECNICO, CicloAcademico.TECNOLOGO, CicloAcademico.PROFESIONAL,
];

@Injectable()
export class RegistrarPracticaUseCase {
  private readonly requisitos = new RequisitosDomainService();
  private readonly obligacionesDominio = new ObligacionesDomainService();

  constructor(
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(OBLIGACION_REPOSITORY) private readonly obligaciones: ObligacionRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(SINU) private readonly sinu: SinuPort,
    private readonly notificaciones: NotificacionesService,
    private readonly parametros: ParametrosUseCase,
    private readonly gestionar: GestionarPracticaUseCase,
  ) {}

  async registrar(dto: RegistrarPracticaDto, actor: Actor, ahora: Date = new Date()): Promise<PracticaRespuestaDto> {
    // ── Quién registra y para quién ──────────────────────────────────────
    const administrativo = [Rol.ADMINISTRADOR, Rol.COORDINADOR].includes(actor.rol);
    if (actor.rol !== Rol.ESTUDIANTE && !administrativo) {
      throw new ForbiddenException('Solo el estudiante o coordinación registran una práctica');
    }
    const estudiante = actor.rol === Rol.ESTUDIANTE
      ? await this.usuarios.buscarPorId(actor.id)
      : await this.estudiantePorDocumento(dto.estudianteDocumento);
    if (!estudiante || estudiante.rol !== Rol.ESTUDIANTE) {
      throw new NotFoundException('No se encontró el estudiante');
    }

    // ── Periodo, ventana y modalidad ofertada ────────────────────────────
    const periodo = await this.periodos.buscarPorCodigo(dto.periodoAcademico);
    if (!periodo || !periodo.activo) {
      throw new BadRequestException(`El periodo ${dto.periodoAcademico} no existe o no está activo`);
    }
    try {
      if (actor.rol === Rol.ESTUDIANTE) {
        periodo.exigirVentana(TipoVentana.REGISTRO_FUR, ahora);
      } else if (!(await this.parametros.booleano('registro.coordinacion_periodos_cerrados'))) {
        periodo.exigirVigenteOFuturo(ahora);
      }
      periodo.exigirModalidad(dto.modalidad);
    } catch (error) {
      if (
        error instanceof VentanaCerradaError || error instanceof PeriodoCerradoError ||
        error instanceof ModalidadNoOfertadaError
      ) throw new BadRequestException(error.message);
      throw error;
    }

    // ── Un registro por periodo ──────────────────────────────────────────
    const vigente = await this.practicas.buscarRegistroVigente(estudiante.id, periodo.codigo);
    if (vigente) {
      throw new ConflictException(
        `Ya existe un registro de práctica para el periodo ${periodo.codigo}. Si tiene un error, ` +
          'coordinación puede anularlo para habilitar uno nuevo.',
      );
    }

    // ── Datos básicos: SINU es la fuente; el perfil local es el respaldo ──
    const matricula = estudiante.instantanea().documento
      ? await this.sinu.buscarPorDocumento(estudiante.instantanea().documento as string)
      : null;
    const perfil = estudiante.instantanea();
    const programaId = matricula?.programaId ?? perfil.programaId;
    const escuelaId = matricula?.escuelaId ?? perfil.escuelas[0];
    const ciclo = (matricula?.ciclo as CicloAcademico | undefined) ?? dto.cicloDeclarado;
    if (!programaId || !escuelaId || !ciclo) {
      throw new BadRequestException(
        'No aparece matriculado(a) en la asignatura de práctica. Verifique su matrícula en SINU ' +
          'o comuníquese con coordinación.',
      );
    }

    // ── Contrato de aprendizaje: máximo dos y cadena de formación ────────
    // (PQRS, «Contrato de aprendizaje y cadena de formación»). El desbloqueo
    // del segundo lo gestiona coordinación con el acta de grado y la carta de
    // terminación: por eso el registro administrativo no lo bloquea.
    let extensionAutorizada = false;
    if (dto.modalidad === ModalidadPractica.CONTRATO_APRENDIZAJE && !administrativo) {
      const previos = (await this.practicas.listar({
        estudianteId: estudiante.id, modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, limite: 50,
      })).filter((p) => p.estado !== EstadoPractica.ANULADA);
      if (previos.length >= 2) {
        throw new BadRequestException(
          'Durante su proceso con la CUN solo se permiten máximo dos contratos de aprendizaje.',
        );
      }
      if (previos.length === 1 && ORDEN_CICLO.indexOf(ciclo) <= ORDEN_CICLO.indexOf(previos[0].ciclo)) {
        throw new BadRequestException(
          'Un segundo contrato de aprendizaje exige un nivel de formación superior al del primero ' +
            '(cadena de formación). Solicite el desbloqueo a coordinación con el acta o diploma de grado ' +
            'y la carta de terminación del contrato anterior.',
        );
      }
    }

    // ── Fechas y duración ────────────────────────────────────────────────
    const inicio = new Date(dto.fechaInicio);
    const fin = new Date(dto.fechaFin);
    const definicion = definicionModalidad(dto.modalidad);
    try {
      periodo.validarFechasDePractica(inicio, fin, {
        exigirDentroDelPeriodo: definicion.fechasDentroDelPeriodo,
      });
      try {
        this.requisitos.verificarDuracion(dto.modalidad, inicio, fin);
      } catch (error) {
        // La extensión de la pasantía la autoriza coordinación previa solicitud
        // de la empresa (PQRS n.º 8): el registro administrativo la admite y
        // queda en la auditoría; el estudiante no puede excederla por su cuenta.
        if (error instanceof DuracionFueraDeRangoError && administrativo
          && dto.modalidad === ModalidadPractica.PASANTIA && definicion.duracionMesesMaxima !== null) {
          extensionAutorizada = true;
        } else throw error;
      }
    } catch (error) {
      if (
        error instanceof FechasFueraDelPeriodoError || error instanceof FinDeSemanaError ||
        error instanceof DuracionFueraDeRangoError
      ) throw new BadRequestException(error.message);
      throw error;
    }

    // ── Empresa: se vincula si el NIT corresponde a una habilitada ───────
    let empresaId: string | null = null;
    try {
      const nit = Nit.crear(dto.empresaNit);
      const empresa = await this.empresas.buscarPorNit(nit.numero);
      if (empresa?.habilitada) empresaId = empresa.id;
    } catch {
      // Identificador alfanumérico (empresa extranjera): se conserva como texto.
    }

    // ── Registro ─────────────────────────────────────────────────────────
    const datos: DatosPractica = {
      id: randomUUID(),
      numeroFur: null,
      estudianteId: estudiante.id,
      programaId,
      escuelaId,
      regional: null,
      asignatura: matricula?.asignaturaPractica ?? null,
      ciclo,
      periodoAcademico: periodo.codigo,
      modalidad: dto.modalidad,
      estado: EstadoPractica.INSCRITA,
      tutorId: null,
      empresaId,
      empresaRazonSocial: dto.empresaRazonSocial.trim(),
      empresaNit: dto.empresaNit.trim(),
      area: dto.area,
      cargo: dto.cargo,
      tipoRemuneracion: dto.tipoRemuneracion,
      salario: dto.tipoRemuneracion === 'remunerada' ? (dto.salario ?? null) : null,
      horario: dto.horario,
      jefeInmediatoNombre: dto.jefeInmediatoNombre,
      jefeInmediatoCargo: dto.jefeInmediatoCargo,
      jefeInmediatoCorreo: dto.jefeInmediatoCorreo.toLowerCase(),
      jefeInmediatoTelefono: dto.jefeInmediatoTelefono,
      ciudad: dto.ciudad,
      funcionesRelevantes: dto.funcionesRelevantes,
      fechaInicio: inicio,
      fechaFin: fin,
      horasRegistradas: null,
      arlVerificada: false,
      arlFechaAfiliacion: null,
      // Lo confirma quien registra en el formulario (la modalidad solo sugiere). No se deriva de la modalidad.
      responsableArlPractica: dto.responsableArl,
      terminosAceptadosEn: ahora,
      registradaPor: actor.rol === Rol.ESTUDIANTE ? 'estudiante' : 'coordinacion',
      nota: null,
      cerradaEn: null,
      ultimaActividad: ahora,
      creadaEn: ahora,
      actualizadaEn: ahora,
    };
    const practica = await this.practicas.guardar(datos);

    const plantillas = this.obligacionesDominio.plantillasPara(practica, ahora);
    await this.obligaciones.guardarLote(
      plantillas.map((p) =>
        ObligacionesDomainService.nuevaObligacion(randomUUID(), practica.id, p, ahora),
      ),
    );

    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol,
      accion: AccionAuditada.REGISTRO_FUR, entidad: 'practica', entidadId: practica.id,
      justificacion: null,
      metadatos: {
        periodo: periodo.codigo, modalidad: dto.modalidad, empresaNit: datos.empresaNit,
        registradaPor: datos.registradaPor, empresaVinculada: empresaId !== null,
        responsableArl: dto.responsableArl,
        // Trazabilidad de la sugerencia: se registra si quien registró aceptó la de la modalidad o la cambió.
        responsableArlSugerido: responsableArlSugerido(dto.modalidad),
        responsableArlDifiereDeSugerido: responsableArlSugerido(dto.modalidad) !== null && responsableArlSugerido(dto.modalidad) !== dto.responsableArl,
        ...(extensionAutorizada ? { extensionAutorizada: true } : {}),
      },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });

    await this.notificaciones.notificar(
      EventoNotificable.REGISTRO_CONFIRMADO,
      { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
      {
        modalidad: definicion.etiqueta,
        periodo: periodo.codigo,
        empresa: datos.empresaRazonSocial ?? undefined,
        documentosPorMomento: this.listaDocumental(dto.modalidad),
      },
    );

    return this.gestionar.presentar(practica, actor);
  }

  private async estudiantePorDocumento(documento: string | undefined) {
    if (!documento?.trim()) {
      throw new BadRequestException('Indique el número de documento del estudiante a registrar');
    }
    return this.usuarios.buscarPorDocumento(documento.trim());
  }

  /** Lista documental de la modalidad, por momento y en lenguaje del estudiante. */
  private listaDocumental(modalidad: RegistrarPracticaDto['modalidad']) {
    const definicion = definicionModalidad(modalidad);
    return ([MomentoExpediente.INICIALES, MomentoExpediente.AVANCE, MomentoExpediente.CIERRE])
      .map((momento) => ({
        momento: ETIQUETA_MOMENTO[momento],
        documentos: ETAPAS_POR_MOMENTO[momento]
          .flatMap((etapa) => definicion.documentos[etapa] ?? [])
          .map((tipo) => criteriosDe(tipo)?.nombre ?? tipo),
      }))
      .filter((b) => b.documentos.length > 0);
  }
}
