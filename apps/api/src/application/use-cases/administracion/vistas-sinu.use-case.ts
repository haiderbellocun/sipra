import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { EQUIVALENCIA_SGP, EstadoPractica, Practica } from '../../../domain/entities/practica.entity';
import { DatosUsuario, Usuario } from '../../../domain/entities/usuario.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, PERIODO_REPOSITORY, PeriodoRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { MatriculaSinu, SINU, SinuPort } from '../../../domain/ports/out/servicios-externos.port';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

export interface CorrespondenciaCampo {
  campo: string;
  sinu: string | null;
  sgp: string | null;
  coincide: boolean;
}

export interface VistaEstudianteSinu {
  documento: string;
  matricula: MatriculaSinu | null;
  usuarioSgp: { id: string; nombre: string; correo: string; programaId: string | null; activo: boolean } | null;
  practica: {
    id: string; numeroFur: number | null; periodoAcademico: string; modalidad: string; estado: EstadoPractica;
    estadoSgp: string; tutorId: string | null; tutorNombre: string | null;
  } | null;
  correspondencia: CorrespondenciaCampo[];
}

export interface FilaMatriculaSinu {
  matricula: MatriculaSinu;
  registradaEnSgp: boolean;
  practicaId: string | null;
  estadoSgp: string | null;
  tutorNombre: string | null;
}

export interface ResumenSincronizacion {
  periodoAcademico: string;
  practicasRevisadas: number;
  asignadas: number;
  sinCambios: number;
  docentesCreados: number;
  sinDocenteEnSinu: { practicaId: string; estudianteDocumento: string | null }[];
}

const ROLES_VISTAS: readonly Rol[] = [Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR, Rol.TUTOR];

/**
 * Apartado «Vistas» del SGP: consulta de correspondencia con SINU y
 * sincronizador prácticas–docente. SINU es la fuente única de verdad
 * académica: aquí solo se lee y se refleja.
 */
@Injectable()
export class VistasSinuUseCase {
  private readonly log = new Logger(VistasSinuUseCase.name);

  constructor(
    @Inject(SINU) private readonly sinu: SinuPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  /** Vistas / Consulta: el estudiante en SINU y en SGP, haya registrado o no. */
  async consultarEstudiante(documento: string, actor: Actor): Promise<VistaEstudianteSinu> {
    this.exigirVistas(actor);
    const doc = documento.trim();
    if (!doc) throw new BadRequestException('Indique el número de documento');
    const [matricula, usuario] = await Promise.all([this.sinu.buscarPorDocumento(doc), this.usuarios.buscarPorDocumento(doc)]);

    let practica: Practica | null = null;
    if (usuario) {
      const propias = await this.practicas.listar({ estudianteId: usuario.id, limite: 20 });
      practica = propias
        .filter((p) => p.estado !== EstadoPractica.ANULADA)
        .sort((a, b) => b.instantanea().creadaEn.getTime() - a.instantanea().creadaEn.getTime())[0] ?? null;
    }
    const tutor = practica?.tutorId ? await this.usuarios.buscarPorId(practica.tutorId) : null;
    const u = usuario?.instantanea() ?? null;
    const p = practica?.instantanea() ?? null;

    const comparar = (campo: string, sinu: string | null, sgp: string | null): CorrespondenciaCampo => ({
      campo, sinu, sgp, coincide: normalizar(sinu) === normalizar(sgp),
    });
    const correspondencia: CorrespondenciaCampo[] = [
      comparar('Nombre', matricula?.nombreEstudiante ?? null, u?.nombre ?? null),
      comparar('Correo institucional', matricula?.correoInstitucional ?? null, u?.correo ?? null),
      comparar('Programa', matricula?.programaId ?? null, p?.programaId ?? u?.programaId ?? null),
      comparar('Periodo', matricula?.periodoAcademico ?? null, p?.periodoAcademico ?? null),
      comparar('Asignatura', matricula?.asignaturaPractica ?? null, p?.asignatura ?? null),
    ];

    return {
      documento: doc,
      matricula,
      usuarioSgp: u ? { id: u.id, nombre: u.nombre, correo: u.correo, programaId: u.programaId, activo: u.activo } : null,
      practica: p ? {
        id: p.id, numeroFur: p.numeroFur, periodoAcademico: p.periodoAcademico, modalidad: p.modalidad, estado: p.estado,
        estadoSgp: EQUIVALENCIA_SGP[p.estado], tutorId: p.tutorId, tutorNombre: tutor?.nombre ?? null,
      } : null,
      correspondencia,
    };
  }

  /** Matrículas de práctica del periodo en SINU y si ya registraron en SGP. */
  async listarMatriculas(periodoAcademico: string, actor: Actor): Promise<FilaMatriculaSinu[]> {
    this.exigirVistas(actor);
    const matriculas = await this.sinu.listarMatriculasPractica(periodoAcademico);
    const filas: FilaMatriculaSinu[] = [];
    for (const m of matriculas) {
      const usuario = await this.usuarios.buscarPorDocumento(m.documentoEstudiante);
      const practica = usuario ? await this.practicas.buscarRegistroVigente(usuario.id, periodoAcademico) : null;
      const tutor = practica?.tutorId ? await this.usuarios.buscarPorId(practica.tutorId) : null;
      filas.push({
        matricula: m,
        registradaEnSgp: practica !== null,
        practicaId: practica?.id ?? null,
        estadoSgp: practica ? EQUIVALENCIA_SGP[practica.estado] : null,
        tutorNombre: tutor?.nombre ?? null,
      });
    }
    return filas;
  }

  /**
   * Sincronizador prácticas–docente: toma la asignación docente de SINU y la
   * refleja en las prácticas del periodo. Crea el docente si aún no existe en
   * SGP. Solo mientras el periodo tenga la sincronización habilitada.
   */
  async sincronizarDocentes(periodoAcademico: string, actor: Actor | null, ahora: Date = new Date()): Promise<ResumenSincronizacion> {
    if (actor && ![Rol.COORDINADOR, Rol.ADMINISTRADOR].includes(actor.rol)) {
      throw new ForbiddenException('La sincronización la ejecuta coordinación o administración');
    }
    const periodo = await this.periodos.buscarPorCodigo(periodoAcademico);
    if (!periodo) throw new BadRequestException(`El periodo ${periodoAcademico} no existe`);
    if (!periodo.instantanea().sincronizacionDocentes) {
      throw new BadRequestException(`La sincronización de docentes está deshabilitada para ${periodoAcademico}`);
    }

    const asignaciones = await this.sinu.listarAsignacionesDocentes(periodoAcademico);
    const porEstudiante = new Map(asignaciones.map((a) => [a.documentoEstudiante, a]));
    const practicas = await this.practicas.listar({ periodoAcademico, limite: 10_000 });

    const resumen: ResumenSincronizacion = {
      periodoAcademico, practicasRevisadas: 0, asignadas: 0, sinCambios: 0, docentesCreados: 0, sinDocenteEnSinu: [],
    };
    const docentesPorCorreo = new Map<string, Usuario>();

    for (const practica of practicas) {
      if (practica.esTerminal) continue;
      resumen.practicasRevisadas += 1;
      const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
      const documento = estudiante?.instantanea().documento ?? null;
      const asignacion = documento ? porEstudiante.get(documento) : undefined;
      if (!asignacion) {
        resumen.sinDocenteEnSinu.push({ practicaId: practica.id, estudianteDocumento: documento });
        continue;
      }
      const correo = asignacion.correoDocente.toLowerCase();
      let docente = docentesPorCorreo.get(correo) ?? await this.usuarios.buscarPorCorreo(correo);
      if (!docente) {
        const datos: DatosUsuario = {
          id: randomUUID(), correo, nombre: asignacion.nombreDocente, documento: asignacion.documentoDocente,
          rol: Rol.TUTOR, permiso: 'escritura', escuelas: [practica.escuelaId], empresaId: null, programaId: null,
          activo: true, creadoEn: ahora, ultimoAccesoEn: null,
        };
        docente = await this.usuarios.guardar(datos);
        resumen.docentesCreados += 1;
      } else if (!docente.escuelas.includes(practica.escuelaId)) {
        // El docente ve las prácticas de la escuela que SINU le asigna.
        docente.actualizar({ escuelas: [...docente.escuelas, practica.escuelaId] });
        docente = await this.usuarios.guardar(docente.instantanea());
      }
      docentesPorCorreo.set(correo, docente);

      if (practica.tutorId === docente.id) {
        resumen.sinCambios += 1;
        continue;
      }
      practica.asignarTutor(docente.id, ahora);
      await this.practicas.guardar(practica.instantanea());
      resumen.asignadas += 1;
    }

    await this.auditoria.registrar({
      actorId: actor?.id ?? null, actorCorreo: actor?.correo ?? null, actorRol: actor?.rol ?? 'sistema',
      accion: AccionAuditada.SINCRONIZACION_DOCENTES, entidad: 'periodo', entidadId: null,
      justificacion: null, metadatos: { ...resumen, sinDocenteEnSinu: resumen.sinDocenteEnSinu.length },
      ip: actor?.ip ?? null, agenteUsuario: actor?.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    this.log.log(`Sincronización ${periodoAcademico}: ${resumen.asignadas} asignada(s), ${resumen.docentesCreados} docente(s) nuevo(s)`);
    return resumen;
  }

  /** Para la tarea programada: todos los periodos activos con sincronización habilitada. */
  async sincronizarPeriodosActivos(ahora: Date = new Date()): Promise<ResumenSincronizacion[]> {
    const periodos = (await this.periodos.listar({ activo: true }))
      .filter((p) => p.instantanea().sincronizacionDocentes && p.esVigenteOFuturo(ahora));
    const resultados: ResumenSincronizacion[] = [];
    for (const p of periodos) resultados.push(await this.sincronizarDocentes(p.codigo, null, ahora));
    return resultados;
  }

  private exigirVistas(actor: Actor): void {
    if (!ROLES_VISTAS.includes(actor.rol)) throw new ForbiddenException('Su perfil no accede a las vistas de SINU');
  }
}

function normalizar(valor: string | null): string | null {
  return valor === null ? null : valor.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
