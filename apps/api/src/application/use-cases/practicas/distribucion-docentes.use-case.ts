import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccionAuditada, RegistroAuditoria } from '../../../domain/entities/auditoria.entity';
import { DatosEntradaBitacora, TipoEntradaBitacora } from '../../../domain/entities/bitacora.entity';
import { DISTRIBUCION_DOCENTES, DistribucionDocentesPort } from '../../../domain/ports/out/distribucion-docentes.port';
import {
  PERIODO_REPOSITORY, PeriodoRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  DocenteCandidato, ETIQUETA_EXCLUSION, ResultadoDistribucion, distribuirDocentes, firmaCanonica,
} from '../../../domain/services/distribucion-docentes.domain-service';
import { Rol, esCoordinacionOperativa, escuelasDeCoordinacion } from '../../../domain/value-objects/rol.vo';
import { ETIQUETA_ROL } from '../../dtos/usuario.dto';
import {
  AplicarDistribucionDto, ResultadoDistribucionDto, VistaPreviaDistribucionDto,
} from '../../dtos/distribucion-docentes.dto';
import { Actor } from './gestionar-practica.use-case';

export const MENSAJE_PREVIA_OBSOLETA = 'Las asignaciones cambiaron desde la vista previa. Genera una nueva distribución.';

interface Calculo {
  periodoAcademico: string;
  periodoActivo: boolean;
  alcance: string[] | null;
  resultado: ResultadoDistribucion;
  docentes: DocenteCandidato[];
  pendientes: number;
  huella: string;
}

/**
 * G6 · Distribución homogénea de estudiantes por docente facilitador.
 *
 * Solo coordinación y analista (administración y dirección NO: 403). Siempre sobre UN periodo. Vista previa sin
 * escrituras; la aplicación recalcula con datos frescos, exige la misma huella (si no, 409) y escribe el lote de forma
 * atómica (ver `DistribucionDocentesPgAdapter`). Las asignaciones existentes nunca se mueven.
 */
@Injectable()
export class DistribucionDocentesUseCase {
  constructor(
    @Inject(DISTRIBUCION_DOCENTES) private readonly repo: DistribucionDocentesPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
  ) {}

  async previsualizar(periodoAcademico: string, escuelaId: string | undefined, actor: Actor): Promise<VistaPreviaDistribucionDto> {
    const c = await this.calcular(periodoAcademico, escuelaId, actor);
    const motivo = this.motivoNoAplicable(c);
    return {
      periodoAcademico: c.periodoAcademico,
      periodoActivo: c.periodoActivo,
      escuelas: c.alcance,
      pendientes: c.pendientes,
      asignables: c.resultado.asignaciones.length,
      sinDocenteCompatible: c.resultado.noAsignables.reduce((s, g) => s + g.cantidad, 0),
      docentes: c.resultado.docentes.map((d) => ({ ...d, escuelas: [...d.escuelas] })),
      noAsignables: c.resultado.noAsignables.map(({ escuelaId: e, cantidad, motivo: m }) => ({ escuelaId: e, cantidad, motivo: m })),
      docentesExcluidos: c.resultado.excluidos.map((x) => ({ id: x.id, nombre: x.nombre, motivo: ETIQUETA_EXCLUSION[x.motivo] })),
      huella: c.huella,
      puedeAplicar: motivo === null,
      motivoNoAplicable: motivo,
    };
  }

  async aplicar(dto: AplicarDistribucionDto, actor: Actor, ahora: Date = new Date()): Promise<ResultadoDistribucionDto> {
    const c = await this.calcular(dto.periodoAcademico, dto.escuelaId, actor);
    if (!c.periodoActivo) throw new BadRequestException(this.motivoNoAplicable(c) ?? 'Periodo inactivo');
    if (c.huella !== dto.huella) throw new ConflictException(MENSAJE_PREVIA_OBSOLETA);
    const motivo = this.motivoNoAplicable(c);
    if (motivo) throw new BadRequestException(motivo);

    const nombres = new Map(c.docentes.map((d) => [d.id, d.nombre]));
    const nombreActor = (await this.usuarios.buscarPorId(actor.id))?.nombre ?? actor.correo.split('@')[0];
    const rotulo = ETIQUETA_ROL[actor.rol] ?? actor.rol;
    const loteId = randomUUID();
    const sinDocente = c.resultado.noAsignables.reduce((s, g) => s + g.cantidad, 0);
    const docentesConNuevos = c.resultado.docentes.filter((d) => d.nuevos > 0).length;
    const base = {
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, justificacion: null,
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    };
    const auditoria: RegistroAuditoria[] = [
      {
        ...base, accion: AccionAuditada.DISTRIBUCION_DOCENTES_APLICADA, entidad: 'periodo', entidadId: null,
        metadatos: {
          loteId, periodoAcademico: c.periodoAcademico, escuelas: c.alcance ?? 'todas', asignados: c.resultado.asignaciones.length,
          docentes: docentesConNuevos, noAsignables: sinDocente, huella: c.huella, metodo: 'automatico',
          cargaFinal: c.resultado.docentes.map((d) => ({ tutorId: d.id, actual: d.actual, nuevos: d.nuevos, final: d.final })),
        },
      },
      ...c.resultado.asignaciones.map((a) => ({
        ...base, accion: AccionAuditada.TUTOR_ASIGNADO, entidad: 'practica', entidadId: a.practicaId,
        metadatos: { loteId, tutorId: a.tutorId, tutorNombre: nombres.get(a.tutorId) ?? null, metodo: 'automatico', periodoAcademico: c.periodoAcademico },
      })),
    ];
    const bitacora: DatosEntradaBitacora[] = c.resultado.asignaciones.map((a) => ({
      id: randomUUID(), practicaId: a.practicaId, tipo: TipoEntradaBitacora.SISTEMA, autor: 'sistema', autorId: null,
      mensaje: `Docente facilitador asignado: ${nombres.get(a.tutorId) ?? 'docente'}. Distribución automática del periodo ` +
        `${c.periodoAcademico}, por ${rotulo} (${nombreActor}).`,
      detalle: null, venceEl: null, creadaEn: ahora,
    }));

    const aplicada = await this.repo.aplicar({ asignaciones: c.resultado.asignaciones, ahora, auditoria, bitacora });
    if (!aplicada) throw new ConflictException(MENSAJE_PREVIA_OBSOLETA);
    return {
      periodoAcademico: c.periodoAcademico, asignados: c.resultado.asignaciones.length, docentes: docentesConNuevos,
      sinDocenteCompatible: sinDocente,
    };
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async calcular(periodoAcademico: string, escuelaId: string | undefined, actor: Actor): Promise<Calculo> {
    if (!esCoordinacionOperativa(actor)) {
      throw new ForbiddenException('La distribución de docentes la hacen coordinación y analista.');
    }
    if (!periodoAcademico) throw new BadRequestException('Elige el periodo académico que se va a distribuir.');
    const periodo = await this.periodos.buscarPorCodigo(periodoAcademico);
    if (!periodo) throw new NotFoundException(`El periodo ${periodoAcademico} no existe.`);

    // Universo: alcance del actor (coordinación con escuelas) y, si se pide, UNA escuela explícita dentro de él.
    const propias = escuelasDeCoordinacion(actor);
    let alcance: string[] | null = propias;
    if (escuelaId) {
      if (propias && !propias.includes(escuelaId)) throw new ForbiddenException('Esa escuela no está en tu alcance.');
      alcance = [escuelaId];
    }

    const [practicas, cargas, usuarios] = await Promise.all([
      this.repo.practicasSinDocente(periodoAcademico, alcance),
      this.repo.cargas(periodoAcademico),
      this.usuarios.listar({ roles: [Rol.TUTOR] }),
    ]);
    const docentes: DocenteCandidato[] = usuarios.map((u) => {
      const d = u.instantanea();
      return { id: d.id, nombre: d.nombre, rol: d.rol, activo: d.activo, permiso: d.permiso, escuelas: [...d.escuelas] };
    });
    const resultado = distribuirDocentes({ practicas, docentes, cargas, alcance });
    const huella = createHash('sha256')
      .update(firmaCanonica({ periodoAcademico, alcance, practicas, docentes, cargas })).digest('hex').slice(0, 32);
    return {
      periodoAcademico, periodoActivo: periodo.instantanea().activo, alcance, resultado, docentes,
      pendientes: practicas.length, huella,
    };
  }

  private motivoNoAplicable(c: Calculo): string | null {
    if (!c.periodoActivo) return `El periodo ${c.periodoAcademico} no está activo: la distribución solo se consulta.`;
    if (c.pendientes === 0) return 'No hay estudiantes sin docente facilitador en este periodo.';
    if (c.resultado.asignaciones.length === 0) return 'Ningún estudiante pendiente tiene un docente activo con alcance compatible.';
    return null;
  }
}
