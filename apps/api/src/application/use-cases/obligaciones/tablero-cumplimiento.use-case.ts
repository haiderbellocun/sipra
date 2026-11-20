import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CATALOGO_OBLIGACIONES, EfectoObligacion, EstadoObligacion, SemaforoObligacion, TipoObligacion,
} from '../../../domain/entities/obligacion.entity';
import { EstadoPractica } from '../../../domain/entities/practica.entity';
import {
  AlcanceCumplimiento, CUMPLIMIENTO_LECTURA, CumplimientoLecturaPort, FilaObligacionAlcance, OpcionesCumplimiento,
} from '../../../domain/ports/out/cumplimiento-lectura.port';
import {
  OBLIGACION_REPOSITORY, ObligacionRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  CategoriaCumplimiento, ObligacionClasificada, ResumenCumplimiento, clasificar, ordenOperativo, porTipo, requiereAtencion, resumir,
} from '../../../domain/services/cumplimiento.domain-service';
import { ObligacionesDomainService } from '../../../domain/services/obligaciones.domain-service';
import { Rol, escuelasDeCoordinacion } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

export interface FiltrosTablero {
  periodo?: string;
  escuela?: string;
  programa?: string;
  tipo?: string;
  estado?: string;
  busqueda?: string;
  pagina?: number;
}

export interface FilaCumplimiento {
  obligacionId: string;
  tipo: string;
  norma: string;
  responsable: string;
  efecto: string;
  estado: EstadoObligacion;
  categoria: CategoriaCumplimiento;
  semaforo: SemaforoObligacion;
  fechaLimite: string;
  diasRestantes: number;
  practicaId: string;
  practicaEstado: string;
  periodo: string;
  estudianteNombre: string;
  programaId: string;
  escuelaId: string;
  escuelaNombre: string | null;
}

export interface TableroCumplimiento {
  /** Momento real del cálculo (el servidor calcula al responder; no hay corte programado). */
  generadoEn: string;
  alcance: { tipo: 'institucional' | 'escuelas' | 'asignados'; escuelas: string[] };
  filtros: { periodo: string | null; escuela: string | null; programa: string | null; tipo: string | null; estado: CategoriaCumplimiento | null; busqueda: string | null };
  opciones: OpcionesCumplimiento & { tipos: { tipo: string; norma: string; descripcion: string }[] };
  /** Universo filtrado (sin el filtro de estado): obligaciones APLICABLES y su reparto por categoría. */
  indicadores: ResumenCumplimiento;
  porTipo: (Omit<ResumenCumplimiento, 'noAplica'> & { tipo: string; norma: string })[];
  /** Vencidas y próximas a vencer (≤ 10 días), en orden operativo. Se devuelven hasta 50; `total` es el conteo real. */
  atencion: { total: number; filas: FilaCumplimiento[] };
  /** Listado completo del filtro (con estado), paginado en el servidor. */
  listado: { total: number; pagina: number; tamano: number; paginas: number; filas: FilaCumplimiento[] };
  /** Compatibilidad (Inicio): semáforo de las obligaciones aplicables del universo. */
  resumen: Record<SemaforoObligacion, number>;
  /** Prácticas en validación con una obligación que bloquea la activación sin cumplir (compuerta ARL). */
  practicasBloqueadas: number;
}

export const TAMANO_PAGINA_CUMPLIMIENTO = 25;
export const MAXIMO_ATENCION = 50;
const CATEGORIAS: readonly CategoriaCumplimiento[] = ['cumplida', 'vencida', 'proxima', 'en_plazo'];
const PATRON_CODIGO = /^[0-9A-Za-z_-]{1,60}$/;

/**
 * M5 — Tablero de cumplimiento (V3). Las reglas son las del dominio: semáforo de la obligación y sus estados.
 * El alcance (G1) se aplica en la base; los filtros también. Agregación y paginación en el servidor.
 */
@Injectable()
export class TableroCumplimientoUseCase {
  private readonly log = new Logger(TableroCumplimientoUseCase.name);
  private readonly dominio = new ObligacionesDomainService();

  constructor(
    @Inject(OBLIGACION_REPOSITORY) private readonly obligaciones: ObligacionRepositoryPort,
    @Inject(CUMPLIMIENTO_LECTURA) private readonly lectura: CumplimientoLecturaPort,
    @Optional() @Inject(USUARIO_REPOSITORY) private readonly usuarios?: UsuarioRepositoryPort,
  ) {}

  async construir(actor: Actor, filtrosBrutos: FiltrosTablero = {}, ahora: Date = new Date()): Promise<TableroCumplimiento> {
    const alcance = this.alcanceDe(actor);
    const f = this.validar(filtrosBrutos);

    let estudianteIds: string[] | undefined;
    if (f.busqueda) {
      const encontrados = this.usuarios ? await this.usuarios.buscarTexto(f.busqueda, 50) : [];
      estudianteIds = encontrados.filter((u) => u.rol === Rol.ESTUDIANTE).map((u) => u.id);
    }
    const [filas, opciones] = await Promise.all([
      this.lectura.obligaciones(alcance, { periodo: f.periodo ?? undefined, escuela: f.escuela ?? undefined, programa: f.programa ?? undefined, tipo: f.tipo ?? undefined, estudianteIds }),
      this.lectura.opciones(alcance),
    ]);

    const { aplicables, noAplica } = clasificar(filas, ahora);
    const ordenadas = [...aplicables].sort(ordenOperativo);
    const atencion = ordenadas.filter((o) => requiereAtencion(o.categoria));
    const filtradas = f.estado ? ordenadas.filter((o) => o.categoria === f.estado) : ordenadas;
    const paginas = Math.max(1, Math.ceil(filtradas.length / TAMANO_PAGINA_CUMPLIMIENTO));
    const pagina = Math.min(f.pagina, paginas);
    const resumen: Record<SemaforoObligacion, number> = { cumplida: 0, vencida: 0, critica: 0, alerta: 0, vigente: 0 };
    for (const o of aplicables) resumen[o.semaforo] += 1;

    const bloqueadas = new Set(aplicables
      .filter((o) => CATALOGO_OBLIGACIONES[o.fila.tipo as TipoObligacion]?.efecto === EfectoObligacion.BLOQUEA_ACTIVA
        && o.categoria !== 'cumplida' && o.fila.practicaEstado === (EstadoPractica.EN_VALIDACION as string))
      .map((o) => o.fila.practicaId));

    return {
      generadoEn: ahora.toISOString(),
      alcance: alcance.todas ? { tipo: 'institucional', escuelas: [] }
        : alcance.tutorId ? { tipo: 'asignados', escuelas: [...alcance.escuelas] } : { tipo: 'escuelas', escuelas: [...alcance.escuelas] },
      filtros: f.publico,
      opciones: {
        ...opciones,
        tipos: Object.values(CATALOGO_OBLIGACIONES).map((c) => ({ tipo: c.tipo, norma: c.norma, descripcion: c.descripcion })),
      },
      indicadores: resumir(aplicables, noAplica),
      porTipo: porTipo(aplicables).map((t) => ({ ...t, norma: CATALOGO_OBLIGACIONES[t.tipo as TipoObligacion]?.norma ?? '' })),
      atencion: { total: atencion.length, filas: atencion.slice(0, MAXIMO_ATENCION).map((o) => this.aFila(o)) },
      listado: {
        total: filtradas.length, pagina, tamano: TAMANO_PAGINA_CUMPLIMIENTO, paginas,
        filas: filtradas.slice((pagina - 1) * TAMANO_PAGINA_CUMPLIMIENTO, pagina * TAMANO_PAGINA_CUMPLIMIENTO).map((o) => this.aFila(o)),
      },
      resumen,
      practicasBloqueadas: bloqueadas.size,
    };
  }

  /** Alcance G1 del tablero (mismos roles que la ruta). Igual semántica que `Practica.visiblePara`. */
  alcanceDe(actor: Actor): AlcanceCumplimiento {
    switch (actor.rol) {
      case Rol.ADMINISTRADOR: case Rol.DIRECTOR: case Rol.EXTENSION:
        return { todas: true, escuelas: [], tutorId: null };
      case Rol.COORDINADOR: case Rol.ANALISTA: {
        const propias = escuelasDeCoordinacion(actor);
        return propias === null ? { todas: true, escuelas: [], tutorId: null } : { todas: false, escuelas: propias, tutorId: null };
      }
      case Rol.TUTOR:
        // Sus prácticas asignadas y, si tiene, las de sus escuelas. Sin escuelas NO es institucional.
        return { todas: false, escuelas: [...actor.escuelas], tutorId: actor.id };
      default:
        throw new ForbiddenException('El tablero de cumplimiento no está disponible para este perfil.');
    }
  }

  private validar(b: FiltrosTablero) {
    const texto = (v: unknown, patron: RegExp, campo: string): string | null => {
      if (v === undefined || v === null || v === '') return null;
      if (typeof v !== 'string' || !patron.test(v)) throw new BadRequestException(`Filtro «${campo}» no válido.`);
      return v;
    };
    const periodo = texto(b.periodo, /^[0-9A-Za-z-]{2,12}$/, 'periodo');
    const escuela = texto(b.escuela, PATRON_CODIGO, 'escuela');
    const programa = texto(b.programa, PATRON_CODIGO, 'programa');
    const tipo = texto(b.tipo, PATRON_CODIGO, 'tipo');
    if (tipo && !Object.values(TipoObligacion).includes(tipo as TipoObligacion)) throw new BadRequestException('Filtro «tipo» no válido.');
    const estado = texto(b.estado, PATRON_CODIGO, 'estado') as CategoriaCumplimiento | null;
    if (estado && !CATEGORIAS.includes(estado)) throw new BadRequestException('Filtro «estado» no válido.');
    const busqueda = typeof b.busqueda === 'string' && b.busqueda.trim() ? b.busqueda.trim().slice(0, 80) : null;
    const pagina = Number.isInteger(Number(b.pagina)) && Number(b.pagina) >= 1 ? Number(b.pagina) : 1;
    return { periodo, escuela, programa, tipo, estado, busqueda, pagina, publico: { periodo, escuela, programa, tipo, estado, busqueda } };
  }

  private aFila(o: ObligacionClasificada<FilaObligacionAlcance>): FilaCumplimiento {
    const c = CATALOGO_OBLIGACIONES[o.fila.tipo as TipoObligacion];
    return {
      obligacionId: o.fila.obligacionId, tipo: o.fila.tipo, norma: c?.norma ?? '', responsable: c?.responsable ?? '', efecto: c?.efecto ?? '',
      estado: o.fila.estado, categoria: o.categoria, semaforo: o.semaforo, fechaLimite: o.fila.fechaLimite.toISOString(),
      diasRestantes: o.diasRestantes, practicaId: o.fila.practicaId, practicaEstado: o.fila.practicaEstado, periodo: o.fila.periodo,
      estudianteNombre: o.fila.estudianteNombre, programaId: o.fila.programaId, escuelaId: o.fila.escuelaId, escuelaNombre: o.fila.escuelaNombre,
    };
  }

  /** Barrido programado (Cloud Scheduler → Cloud Run Job). Sin cambios. */
  async evaluarVencimientos(): Promise<number> {
    const ahora = new Date();
    const pendientes = await this.obligaciones.listarPendientes(ahora);
    const vencidas = this.dominio.evaluarVencimientos(pendientes, ahora);
    for (const obligacion of vencidas) {
      await this.obligaciones.guardar(obligacion.instantanea());
    }
    if (vencidas.length > 0) {
      this.log.warn(`${vencidas.length} obligación(es) marcadas como vencidas`);
    }
    return vencidas.length;
  }
}
