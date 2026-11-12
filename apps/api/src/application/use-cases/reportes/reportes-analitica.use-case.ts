import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { ModalidadPractica, definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { AUDITORIA_REPOSITORY, AuditoriaRepositoryPort } from '../../../domain/ports/out/repositorios.port';
import {
  FiltroAnalitica, PeriodoAnalitica, PracticaAnalitica, REPORTES_ANALITICA, ReportesAnaliticaPort, VersionAnalitica,
} from '../../../domain/ports/out/reportes-analitica.port';
import { AvanceDocumental, AvanceDocumentalDomainService } from '../../../domain/services/avance-documental.domain-service';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { escuelasDeReportes, exigirReportes } from './alcance-reportes';

/** Estado de una obligación documental según su última versión (las seis categorías suman los exigidos). */
export type EstadoObligacion = 'sin_cargar' | 'en_proceso' | 'en_revision' | 'correccion' | 'rechazado' | 'aprobado';
/** Situación del expediente, excluyente y en este orden de prioridad. */
export type SituacionExpediente = 'completo' | 'requiere_correccion' | 'sin_iniciar' | 'en_curso' | 'sin_matriz';

export const ESTADOS_OBLIGACION: readonly EstadoObligacion[] = ['sin_cargar', 'en_proceso', 'en_revision', 'correccion', 'rechazado', 'aprobado'];
export const SITUACIONES: readonly SituacionExpediente[] = ['completo', 'requiere_correccion', 'en_curso', 'sin_iniciar', 'sin_matriz'];
/** Orden académico del nivel de formación (`practicas.ciclo`); otros valores, si aparecieran, van al final por texto. */
export const ORDEN_CICLOS: readonly string[] = ['tecnico', 'tecnologo', 'profesional'];
/** Valor de filtro para las prácticas sin empresa registrada (en la base es NULL; no se inventa un nombre). */
export const SIN_EMPRESA = '__sin_empresa__';
/** Valor de filtro para «sin dato» en sector o ciudad (NULL en la base). */
export const SIN_DATO = '__sin_dato__';
/**
 * Clave de ciudad para receptoras en el exterior. SIPRA no guarda país: solo existe con la ubicación sintética de dev
 * (`dimensiones.ubicacionInternacional === 'sintetica'`). En producción esas receptoras quedan en «sin dato».
 */
export const INTERNACIONAL = '__internacional__';
export const NOMBRE_INTERNACIONAL = 'Internacional · sin DIVIPOLA';
/**
 * Tipo de organización receptora, derivado del DOMINIO: las modalidades articuladas tienen «escenario dentro de la
 * institución» (práctica interna CUN); las demás, en el sector productivo (externa). No hay un campo aparte.
 */
export type TipoReceptor = 'interna_cun' | 'externa';
export const TIPOS_RECEPTOR: readonly TipoReceptor[] = ['interna_cun', 'externa'];
export const MODALIDADES_ARTICULADAS: readonly string[] = Object.values(ModalidadPractica).filter((m) => definicionModalidad(m).articulada);
export function tipoReceptor(modalidad: string): TipoReceptor | null {
  try { return definicionModalidad(modalidad as ModalidadPractica).articulada ? 'interna_cun' : 'externa'; } catch { return null; }
}

/** Filtros de la petición (sin alcance: el alcance lo impone el actor). */
export interface FiltroReporteAnalitica {
  periodos?: readonly string[];
  escuela?: string;
  programa?: string;
  modalidad?: string;
  estado?: string;
  /** Nivel de formación: `practicas.ciclo` (técnico, tecnólogo, profesional). */
  ciclo?: string;
  /** Razón social registrada, o `SIN_EMPRESA`. */
  empresa?: string;
  /** Situación del expediente: se aplica después de calcular el avance (mismo cálculo que el Expediente). */
  situacion?: SituacionExpediente;
  /** Semestre: solo existe con el overlay sintético de pruebas (`dimensiones.semestre === 'sintetica'`). */
  semestre?: number;
  /** Sección CIIU de la empresa receptora, o `SIN_DATO`. */
  sector?: string;
  /** Municipio DIVIPOLA de la empresa receptora, o `SIN_DATO`. */
  ciudad?: string;
  /** Interna CUN (modalidad articulada) o externa. */
  tipoReceptor?: TipoReceptor;
}

/** Recorte del detalle (drilldown): una situación de expediente, o un tipo de documento en un estado. */
export interface SegmentoDetalle {
  situacion?: SituacionExpediente;
  tipo?: string;
  estadoDocumental?: EstadoObligacion;
}

export interface Cobertura {
  estudiantes: number;
  practicas: number;
  exigidos: number;
  cargados: number;
  aprobados: number;
  correccion: number;
  completos: number;
  /** Obligaciones por estado de su última versión (suman `exigidos`). */
  obligaciones: Record<EstadoObligacion, number>;
  /** Historial: versiones cargadas, documentos (práctica·tipo) con al menos una versión, con reenvío y decisiones auditadas. */
  versiones: number;
  documentos: number;
  conReenvio: number;
  devoluciones: number;
  rechazos: number;
}

/**
 * Dimensiones con FILTRADO POR FACETAS: la distribución de cada una se calcula ignorando SU PROPIO filtro y respetando todos
 * los demás (así la vista muestra lo elegido resaltado y el resto atenuado). Periodo, escuela y estado de la práctica son
 * contexto: no son facetas. Los totales (`resumen`), el detalle y el CSV usan siempre todos los filtros.
 */
export type Faceta = 'programa' | 'ciclo' | 'semestre' | 'modalidad' | 'tipoReceptor' | 'sector' | 'ciudad' | 'empresa' | 'situacion';
export const FACETAS: readonly Faceta[] = ['programa', 'ciclo', 'semestre', 'modalidad', 'tipoReceptor', 'sector', 'ciudad', 'empresa', 'situacion'];
/** Puntos del enjambre de tiempos (uno por decisión): muestra determinista; las estadísticas usan todas las decisiones. */
export const MAX_MUESTRAS_TIEMPO = 1500;

/** Celda de un cruce de dos dimensiones: estudiantes únicos y prácticas. */
export interface Celda { fila: string; columna: string; estudiantes: number; practicas: number }

export interface ReporteAnalitica {
  generadoEn: string;
  periodosDisponibles: string[];
  /** Denominador «en alcance»: todo lo que el actor puede ver, sin los filtros de la petición. */
  universo: { estudiantes: number; practicas: number };
  /** Orden cronológico (ascendente) por `periodos_academicos.fecha_inicio`; los códigos sin fecha van al final. */
  ordenPeriodos: string[];
  /** Periodos de las prácticas que no están en `periodos_academicos`: su lugar en el orden no es cronológico. */
  periodosSinFecha: string[];
  /** Solo en dev sintético: periodos del dataset de pruebas (contexto inicial de la vista). En producción, null. */
  dataset: { periodos: string[] } | null;
  /** Universo de cada faceta (estudiantes y prácticas sin el filtro propio): denominador de su distribución. */
  facetas: Record<Faceta, { estudiantes: number; practicas: number }>;
  /** Escuela → programa → nivel → semestre (estudiantes únicos), para la vista jerárquica. Semestre null sin el dato. */
  jerarquia: { escuela: string; programa: string; ciclo: string; semestre: number | null; estudiantes: number }[];
  /** Origen de cada dimensión que SIPRA no persiste. Semestre: `no_disponible` en producción. */
  dimensiones: { semestre: 'sintetica' | 'no_disponible'; nombrePrograma: 'sintetico' | 'no_disponible'; ubicacionInternacional: 'sintetica' | 'no_disponible' };
  /** Por semestre (vacío si no hay fuente). `semestre: null` = práctica sin el dato. */
  semestres: ({ semestre: number | null } & Cobertura)[];
  resumen: Cobertura;
  expedientes: Record<SituacionExpediente, number>;
  estadosPractica: { estado: string; practicas: number }[];
  documental: Record<EstadoObligacion, number>;
  porTipo: ({ tipo: string; exigidos: number } & Record<EstadoObligacion, number>)[];
  friccion: { tipo: string; documentos: number; versiones: number; conReenvio: number; devoluciones: number; rechazos: number; promedioVersiones: number }[];
  tiempos: {
    decisiones: number; medianaHoras: number | null; p90Horas: number | null; porTipo: { tipo: string; decisiones: number; medianaHoras: number | null }[];
    /** Una decisión por punto (tipo, programa y horas de carga a decisión), hasta MAX_MUESTRAS_TIEMPO por muestreo determinista. */
    muestras: { tipo: string; programa: string; horas: number }[];
  };
  semanas: { semana: string; cargas: number; aprobaciones: number; devoluciones: number; rechazos: number }[];
  periodos: ({ periodo: string } & Cobertura)[];
  modalidades: ({ modalidad: string } & Cobertura)[];
  escuelas: ({ escuela: string; nombre: string; programas: ({ programa: string } & Cobertura)[] } & Cobertura)[];
  /** Todas las empresas del filtro (la vista limita lo que pinta, no el universo). `null` = sin empresa registrada. */
  empresas: { empresa: string | null; practicas: number; estudiantes: number; sector: string | null; ciudad: string | null; tipo: TipoReceptor | null }[];
  /** Por sección CIIU (`sector: null` = sin empresa o sin CIIU). */
  sectores: ({ sector: string | null; nombre: string | null } & Cobertura)[];
  /** Por municipio DIVIPOLA (`ciudad: null` = sin empresa o sin municipio, p. ej. receptoras en el exterior). */
  ciudades: ({ ciudad: string | null; nombre: string | null } & Cobertura)[];
  /** Interna CUN frente a externa, con la misma cobertura documental (descriptivo, no causal). */
  receptores: ({ tipo: TipoReceptor | null } & Cobertura)[];
  /** Nombres para mostrar las claves de sector y ciudad que aparecen en los cruces. */
  etiquetas: { sectores: Record<string, string>; ciudades: Record<string, string> };
  niveles: ({ ciclo: string } & Cobertura)[];
  /** `nombre`: solo con el mapping sintético de pruebas; en producción es null y se muestra el código. */
  programas: ({ programa: string; nombre: string | null; escuela: string; nombreEscuela: string; ciclos: string[] } & Cobertura)[];
  /** Celdas con semestre: la clave de fila/columna es el número como texto, o '' si la práctica no tiene semestre. */
  cruces: Record<'programaModalidad' | 'programaNivel' | 'nivelModalidad' | 'periodoPrograma' | 'periodoModalidad' | 'periodoNivel'
    | 'semestreModalidad' | 'programaSemestre' | 'programaSector' | 'programaCiudad' | 'nivelSector' | 'modalidadSector'
    | 'receptorPrograma' | 'receptorNivel' | 'modalidadSituacion', Celda[]>;
}

export interface FilaDetalle {
  practicaId: string;
  estudiante: string;
  programa: string;
  programaNombre: string | null;
  escuela: string;
  ciclo: string;
  semestre: number | null;
  modalidad: string;
  empresa: string | null;
  tipoReceptor: TipoReceptor | null;
  sector: string | null;
  ciudad: string | null;
  periodo: string;
  estado: string;
  exigidos: number;
  cargados: number;
  aprobados: number;
  correccion: number;
  /** Exigidos aún no aprobados. */
  pendientes: number;
  /** Devoluciones auditadas en todo el historial de la práctica. */
  devoluciones: number;
  situacion: SituacionExpediente;
  ultimoMovimiento: string | null;
}

export interface DetalleAnalitica {
  /** Totales del recorte completo (aunque `filas` venga limitada). */
  total: number;
  estudiantesUnicos: number;
  filas: FilaDetalle[];
}

/** Filas que devuelve el detalle en JSON (la vista pinta estas; el CSV lleva todas). */
export const LIMITE_FILAS_JSON = 200;

const ESTADO_OBLIGACION: Readonly<Record<EstadoDocumento, EstadoObligacion>> = {
  [EstadoDocumento.RECIBIDO]: 'en_proceso',
  [EstadoDocumento.ANALIZANDO]: 'en_proceso',
  [EstadoDocumento.EN_REVISION]: 'en_revision',
  [EstadoDocumento.DEVUELTO]: 'correccion',
  [EstadoDocumento.ILEGIBLE]: 'correccion',
  [EstadoDocumento.RECHAZADO]: 'rechazado',
  [EstadoDocumento.APROBADO]: 'aprobado',
  [EstadoDocumento.AUTO_APROBADO]: 'aprobado',
};

const SEMANAS = 12;
const DIA_MS = 86_400_000;
/** Colombia no tiene horario de verano: UTC−5 todo el año. Las semanas empiezan el lunes en hora de Bogotá. */
const BOGOTA_MS = -5 * 3_600_000;

interface Expediente {
  practica: PracticaAnalitica;
  avance: AvanceDocumental | null;
  obligaciones: { tipo: string; estado: EstadoObligacion }[];
  situacion: SituacionExpediente;
  ultimoMovimiento: number;
  historial: { versiones: number; documentos: number; conReenvio: number; devoluciones: number; rechazos: number };
}

/**
 * Inteligencia operativa de Reportes (solo lectura). Cuenta estudiantes (DISTINCT), prácticas (filas), obligaciones
 * documentales (la matriz de la modalidad, una por tipo exigido: las versiones nuevas NO suman obligaciones) y eventos reales
 * (cargas en `documentos.cargado_en`, decisiones en la auditoría inmutable `decision_documento`). El avance de cada expediente
 * se calcula con el mismo servicio de dominio del Expediente; no hay reglas paralelas. La Mesa Única es transversal: el tipo de
 * documento es una dimensión, no un reporte aparte.
 */
@Injectable()
export class ReportesAnaliticaUseCase {
  private readonly avance = new AvanceDocumentalDomainService();

  constructor(
    @Inject(REPORTES_ANALITICA) private readonly datos: ReportesAnaliticaPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
  ) {}

  async analitica(filtro: FiltroReporteAnalitica, actor: Actor, ahora = new Date()): Promise<ReporteAnalitica> {
    exigirReportes(actor);
    const alcance = escuelasDeReportes(actor);
    // Facetas activas: UNA consulta extra (sin las facetas) y predicados en memoria; nunca una consulta por dimensión.
    const activas = FACETAS.filter((k) => filtro[k] !== undefined && filtro[k] !== '');
    const sinFacetas: FiltroReporteAnalitica = { ...filtro };
    for (const k of FACETAS) delete sinFacetas[k];
    const [periodosDisponibles, universo, sinteticos, { expedientes, versiones }, base] = await Promise.all([
      this.datos.periodos(alcance), this.datos.universo(alcance), this.datos.periodosSinteticos(alcance), this.filtrados(filtro, actor),
      activas.length ? this.filtrados(sinFacetas, actor).then((r) => r.expedientes) : Promise.resolve(null),
    ]);
    const faceta = (k: Faceta): Expediente[] => (!base || !activas.includes(k) ? expedientes
      : base.filter((e) => activas.every((o) => o === k || cumpleFaceta(e, filtro, o))));
    const practicas = expedientes.map((e) => e.practica);
    const orden = ordenCronologico(periodosDisponibles);
    const sinFecha = new Set(periodosDisponibles.filter((p) => !p.inicio).map((p) => p.codigo));
    const posicion = new Map(orden.map((p, i) => [p, i]));
    const conSemestre = this.datos.semestreSintetico();
    const sem = (e: Expediente) => (e.practica.semestre === null ? '' : String(e.practica.semestre));
    const sec = (e: Expediente) => e.practica.sector ?? '';
    const ciu = (e: Expediente) => e.practica.ciudad ?? (e.practica.internacional ? INTERNACIONAL : '');
    const rec = (e: Expediente) => tipoReceptor(e.practica.modalidad) ?? '';
    const etiquetas = { sectores: {} as Record<string, string>, ciudades: {} as Record<string, string> };
    // Etiquetas de todo lo que la vista puede pintar (incluidas las categorías de las facetas).
    for (const p of (base ?? expedientes).map((e) => e.practica)) {
      if (p.sector && p.sectorNombre) etiquetas.sectores[p.sector] = p.sectorNombre;
      if (p.ciudad && p.ciudadNombre) etiquetas.ciudades[p.ciudad] = p.ciudadNombre;
      if (!p.ciudad && p.internacional) etiquetas.ciudades[INTERNACIONAL] = NOMBRE_INTERNACIONAL;
    }

    const documental = this.contadorObligaciones();
    const tipos = new Map<string, Record<EstadoObligacion, number>>();
    for (const e of expedientes) {
      for (const o of e.obligaciones) {
        documental[o.estado] += 1;
        const fila = tipos.get(o.tipo) ?? this.contadorObligaciones();
        fila[o.estado] += 1;
        tipos.set(o.tipo, fila);
      }
    }
    const porTipo = [...tipos.entries()]
      .map(([tipo, c]) => ({ tipo, exigidos: ESTADOS_OBLIGACION.reduce((n, k) => n + c[k], 0), ...c }))
      .sort((a, b) => (b.exigidos - b.aprobado) - (a.exigidos - a.aprobado) || a.tipo.localeCompare(b.tipo));

    const situaciones = Object.fromEntries(SITUACIONES.map((s) => [s, 0])) as Record<SituacionExpediente, number>;
    for (const e of faceta('situacion')) situaciones[e.situacion] += 1;

    const estados = new Map<string, number>();
    for (const p of practicas) estados.set(p.estado, (estados.get(p.estado) ?? 0) + 1);

    return {
      generadoEn: ahora.toISOString(),
      // Chips: con fecha del más reciente al más antiguo; los códigos sin fecha (cronología desconocida) al final.
      periodosDisponibles: [...orden.filter((p) => !sinFecha.has(p))].reverse().concat(orden.filter((p) => sinFecha.has(p))),
      universo,
      ordenPeriodos: orden,
      periodosSinFecha: periodosDisponibles.filter((p) => !p.inicio).map((p) => p.codigo).sort(compararPeriodos),
      dataset: sinteticos.length ? { periodos: [...new Set(sinteticos)].sort((a, b) => (posicion.get(a) ?? 1e9) - (posicion.get(b) ?? 1e9) || compararPeriodos(a, b)) } : null,
      facetas: Object.fromEntries(FACETAS.map((k) => {
        const g = faceta(k);
        return [k, { estudiantes: new Set(g.map((e) => e.practica.estudianteId)).size, practicas: g.length }];
      })) as Record<Faceta, { estudiantes: number; practicas: number }>,
      jerarquia: agrupar(expedientes, (e) => JSON.stringify([e.practica.escuelaId, e.practica.programaId, e.practica.ciclo, conSemestre ? e.practica.semestre : null]))
        .map(([k, g]) => {
          const [escuela, programa, ciclo, semestre] = JSON.parse(k) as [string, string, string, number | null];
          return { escuela, programa, ciclo, semestre, estudiantes: new Set(g.map((e) => e.practica.estudianteId)).size };
        })
        .sort((a, b) => a.escuela.localeCompare(b.escuela) || a.programa.localeCompare(b.programa) || compararCiclos(a.ciclo, b.ciclo) || (a.semestre ?? 99) - (b.semestre ?? 99)),
      dimensiones: {
        semestre: conSemestre ? 'sintetica' : 'no_disponible', nombrePrograma: this.datos.programasSinteticos() ? 'sintetico' : 'no_disponible',
        ubicacionInternacional: this.datos.ubicacionSintetica() ? 'sintetica' : 'no_disponible',
      },
      sectores: agrupar(faceta('sector'), sec).map(([s, g]) => ({ sector: s || null, nombre: s ? etiquetas.sectores[s] ?? s : null, ...cobertura(g) }))
        .sort((a, b) => b.estudiantes - a.estudiantes || (a.sector ?? '~').localeCompare(b.sector ?? '~')),
      ciudades: agrupar(faceta('ciudad'), ciu).map(([c, g]) => ({ ciudad: c || null, nombre: c ? etiquetas.ciudades[c] ?? c : null, ...cobertura(g) }))
        .sort((a, b) => b.estudiantes - a.estudiantes || (a.ciudad ?? '~').localeCompare(b.ciudad ?? '~')),
      receptores: agrupar(faceta('tipoReceptor'), rec).map(([t, g]) => ({ tipo: (t || null) as TipoReceptor | null, ...cobertura(g) }))
        .sort((a, b) => TIPOS_RECEPTOR.indexOf(a.tipo as TipoReceptor) - TIPOS_RECEPTOR.indexOf(b.tipo as TipoReceptor)),
      etiquetas,
      semestres: conSemestre
        ? agrupar(faceta('semestre'), sem).map(([s, grupo]) => ({ semestre: s === '' ? null : Number(s), ...cobertura(grupo) }))
          .sort((a, b) => (a.semestre ?? 999) - (b.semestre ?? 999))
        : [],
      resumen: cobertura(expedientes),
      expedientes: situaciones,
      estadosPractica: [...estados.entries()].map(([estado, n]) => ({ estado, practicas: n })).sort((a, b) => b.practicas - a.practicas),
      documental,
      porTipo,
      friccion: this.friccion(versiones),
      tiempos: this.tiempos(versiones, expedientes),
      semanas: this.semanas(versiones, ahora),
      periodos: agrupar(expedientes, (e) => e.practica.periodoAcademico)
        .map(([periodo, grupo]) => ({ periodo, ...cobertura(grupo) }))
        .sort((a, b) => (posicion.get(a.periodo) ?? 1e9) - (posicion.get(b.periodo) ?? 1e9) || compararPeriodos(a.periodo, b.periodo)),
      modalidades: agrupar(faceta('modalidad'), (e) => e.practica.modalidad).map(([modalidad, grupo]) => ({ modalidad, ...cobertura(grupo) }))
        .sort((a, b) => b.practicas - a.practicas),
      escuelas: agrupar(expedientes, (e) => e.practica.escuelaId).map(([escuela, grupo]) => ({
        escuela, nombre: grupo[0].practica.escuela, ...cobertura(grupo),
        programas: agrupar(grupo, (e) => e.practica.programaId).map(([programa, g]) => ({ programa, ...cobertura(g) })).sort((a, b) => b.practicas - a.practicas),
      })).sort((a, b) => b.practicas - a.practicas),
      empresas: agrupar(faceta('empresa'), (e) => e.practica.empresa ?? SIN_EMPRESA)
        .map(([empresa, grupo]) => ({
          empresa: empresa === SIN_EMPRESA ? null : empresa, practicas: grupo.length, estudiantes: new Set(grupo.map((e) => e.practica.estudianteId)).size,
          sector: grupo[0].practica.sector, ciudad: grupo[0].practica.ciudad ?? (grupo[0].practica.internacional ? INTERNACIONAL : null),
          tipo: tipoReceptor(grupo[0].practica.modalidad),
        }))
        .sort((a, b) => b.estudiantes - a.estudiantes || b.practicas - a.practicas || (a.empresa ?? '~').localeCompare(b.empresa ?? '~')),
      niveles: agrupar(faceta('ciclo'), (e) => e.practica.ciclo).map(([ciclo, grupo]) => ({ ciclo, ...cobertura(grupo) }))
        .sort((a, b) => compararCiclos(a.ciclo, b.ciclo)),
      programas: agrupar(faceta('programa'), (e) => e.practica.programaId).map(([programa, grupo]) => {
        const [escuela, enEscuela] = agrupar(grupo, (e) => e.practica.escuelaId).sort((a, b) => b[1].length - a[1].length)[0];
        return {
          programa, nombre: grupo.find((e) => e.practica.programaNombre)?.practica.programaNombre ?? null, escuela, nombreEscuela: enEscuela[0].practica.escuela,
          ciclos: [...new Set(grupo.map((e) => e.practica.ciclo))].sort(compararCiclos), ...cobertura(grupo),
        };
      }).sort((a, b) => b.estudiantes - a.estudiantes || b.practicas - a.practicas || a.programa.localeCompare(b.programa)),
      cruces: {
        programaModalidad: cruce(expedientes, (e) => e.practica.programaId, (e) => e.practica.modalidad),
        programaNivel: cruce(expedientes, (e) => e.practica.programaId, (e) => e.practica.ciclo),
        nivelModalidad: cruce(expedientes, (e) => e.practica.ciclo, (e) => e.practica.modalidad),
        periodoPrograma: cruce(expedientes, (e) => e.practica.periodoAcademico, (e) => e.practica.programaId),
        periodoModalidad: cruce(expedientes, (e) => e.practica.periodoAcademico, (e) => e.practica.modalidad),
        periodoNivel: cruce(expedientes, (e) => e.practica.periodoAcademico, (e) => e.practica.ciclo),
        programaSector: cruce(expedientes, (e) => e.practica.programaId, sec),
        programaCiudad: cruce(expedientes, (e) => e.practica.programaId, ciu),
        nivelSector: cruce(expedientes, (e) => e.practica.ciclo, sec),
        modalidadSector: cruce(expedientes, (e) => e.practica.modalidad, sec),
        receptorPrograma: cruce(expedientes, rec, (e) => e.practica.programaId),
        receptorNivel: cruce(expedientes, rec, (e) => e.practica.ciclo),
        semestreModalidad: conSemestre ? cruce(expedientes, sem, (e) => e.practica.modalidad) : [],
        programaSemestre: conSemestre ? cruce(expedientes, (e) => e.practica.programaId, sem) : [],
        // Composición de la operación: misma faceta que la situación (con su filtro activo, se ve el resto atenuado).
        modalidadSituacion: cruce(faceta('situacion'), (e) => e.practica.modalidad, (e) => e.situacion),
      },
    };
  }

  /** Detalle por práctica con los mismos filtros y definiciones que la analítica (los totales coinciden). */
  async detalle(filtro: FiltroReporteAnalitica, segmento: SegmentoDetalle, actor: Actor, buscar = '', limite = Infinity): Promise<DetalleAnalitica> {
    exigirReportes(actor);
    if (segmento.situacion && !SITUACIONES.includes(segmento.situacion)) throw new BadRequestException('Situación de expediente no reconocida');
    if (segmento.estadoDocumental && !ESTADOS_OBLIGACION.includes(segmento.estadoDocumental)) throw new BadRequestException('Estado documental no reconocido');
    const termino = normalizar(buscar.trim().slice(0, 80));
    const { expedientes } = await this.filtrados(filtro, actor);
    const elegidos = expedientes
      .filter((e) => !termino || [e.practica.estudiante, e.practica.programaId, e.practica.programaNombre ?? '', e.practica.empresa ?? '', e.practica.ciudadNombre ?? ''].some((t) => normalizar(t).includes(termino)))
      .filter((e) => !segmento.situacion || e.situacion === segmento.situacion)
      .filter((e) => !segmento.tipo && !segmento.estadoDocumental ? true
        : e.obligaciones.some((o) => (!segmento.tipo || o.tipo === segmento.tipo) && (!segmento.estadoDocumental || o.estado === segmento.estadoDocumental)));
    const filas = elegidos
      .map((e): FilaDetalle => ({
        practicaId: e.practica.id, estudiante: e.practica.estudiante, programa: e.practica.programaId, programaNombre: e.practica.programaNombre, escuela: e.practica.escuela,
        ciclo: e.practica.ciclo, semestre: e.practica.semestre, modalidad: e.practica.modalidad, empresa: e.practica.empresa,
        tipoReceptor: tipoReceptor(e.practica.modalidad), sector: e.practica.sectorNombre,
        ciudad: e.practica.ciudadNombre ?? (e.practica.internacional ? NOMBRE_INTERNACIONAL : null), periodo: e.practica.periodoAcademico, estado: e.practica.estado,
        exigidos: e.avance?.exigidos ?? 0, cargados: e.avance?.cargados ?? 0, aprobados: e.avance?.aprobados ?? 0,
        correccion: e.obligaciones.filter((o) => o.estado === 'correccion').length,
        pendientes: (e.avance?.exigidos ?? 0) - (e.avance?.aprobados ?? 0), devoluciones: e.historial.devoluciones, situacion: e.situacion,
        ultimoMovimiento: e.ultimoMovimiento > 0 ? new Date(e.ultimoMovimiento).toISOString() : null,
      }))
      .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.estudiante.localeCompare(b.estudiante));
    return { total: filas.length, estudiantesUnicos: new Set(elegidos.map((e) => e.practica.estudianteId)).size, filas: filas.slice(0, limite) };
  }

  /** CSV del detalle (filtrado y auditado). Sin documento de identidad ni correo; celdas protegidas contra fórmulas. */
  async csv(filtro: FiltroReporteAnalitica, segmento: SegmentoDetalle, actor: Actor, buscar = ''): Promise<{ nombreArchivo: string; contenido: Buffer; filas: number }> {
    const detalle = await this.detalle(filtro, segmento, actor, buscar);
    const columnas: [keyof FilaDetalle, string][] = [
      ['estudiante', 'Estudiante'], ['programa', 'Programa'],
      ...(this.datos.programasSinteticos() ? [['programaNombre', 'Nombre del programa (dato sintético de prueba)'] as [keyof FilaDetalle, string]] : []),
      ['escuela', 'Escuela'], ['ciclo', 'Nivel de formación'],
      ...(this.datos.semestreSintetico() ? [['semestre', 'Semestre (dato sintético de prueba)'] as [keyof FilaDetalle, string]] : []),
      ['modalidad', 'Modalidad'],
      ['empresa', 'Organización receptora'], ['tipoReceptor', 'Tipo de receptor'], ['sector', 'Sector económico (sección CIIU)'], ['ciudad', 'Ciudad'],
      ['periodo', 'Periodo'], ['estado', 'Estado de la práctica'], ['exigidos', 'Documentos exigidos'], ['cargados', 'Cargados'],
      ['aprobados', 'Aprobados'], ['pendientes', 'Pendientes'], ['correccion', 'En corrección'], ['devoluciones', 'Devoluciones (historial)'],
      ['situacion', 'Expediente'], ['ultimoMovimiento', 'Último movimiento'],
    ];
    const lineas = [columnas.map(([, t]) => celdaCsv(t)).join(';'), ...detalle.filas.map((f) => columnas.map(([k]) => celdaCsv(f[k])).join(';'))];
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.REPORTE_GENERADO,
      entidad: 'reporte_analitica', entidadId: null, justificacion: null,
      metadatos: { reporte: 'Detalle analítico', ...filtro, ...segmento, ...(buscar.trim() ? { buscar: buscar.trim().slice(0, 80) } : {}), filas: detalle.total },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
    const sello = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // BOM: Excel en es-CO abre el CSV con tildes; «;» es el separador de lista regional.
    return { nombreArchivo: `reporte-analitico-${sello}.csv`, contenido: Buffer.from(`\uFEFF${lineas.join('\r\n')}\r\n`, 'utf8'), filas: detalle.total };
  }

  private consulta(filtro: FiltroReporteAnalitica, actor: Actor): FiltroAnalitica {
    const alcance = escuelasDeReportes(actor);
    let escuelaIds = alcance;
    if (filtro.escuela) escuelaIds = alcance && !alcance.includes(filtro.escuela) ? [] : [filtro.escuela];
    return {
      periodos: filtro.periodos?.length ? filtro.periodos : undefined, escuelaIds,
      programaId: filtro.programa || undefined, modalidad: filtro.modalidad || undefined, estado: filtro.estado || undefined,
      ciclo: filtro.ciclo || undefined, empresa: filtro.empresa || undefined, semestre: filtro.semestre,
      sector: filtro.sector || undefined, ciudad: filtro.ciudad || undefined,
      modalidades: filtro.tipoReceptor === 'interna_cun' ? MODALIDADES_ARTICULADAS
        : filtro.tipoReceptor === 'externa' ? Object.values(ModalidadPractica).filter((m) => !MODALIDADES_ARTICULADAS.includes(m)) : undefined,
    };
  }

  /**
   * Universo filtrado, el MISMO para agregados, detalle y CSV: filtros en SQL (con el alcance) y la situación del expediente
   * sobre el avance calculado. Las versiones devueltas son solo las de las prácticas que quedan.
   */
  private async filtrados(filtro: FiltroReporteAnalitica, actor: Actor): Promise<{ expedientes: Expediente[]; versiones: VersionAnalitica[] }> {
    if (filtro.situacion && !SITUACIONES.includes(filtro.situacion)) throw new BadRequestException('Situación de expediente no reconocida');
    if (filtro.tipoReceptor && !TIPOS_RECEPTOR.includes(filtro.tipoReceptor)) throw new BadRequestException('Tipo de receptor no reconocido');
    if (filtro.semestre !== undefined && (!this.datos.semestreSintetico() || !Number.isInteger(filtro.semestre) || filtro.semestre < 1 || filtro.semestre > 12)) {
      throw new BadRequestException('El semestre no está disponible en SIPRA (solo existe en SINU)');
    }
    const consulta = this.consulta(filtro, actor);
    const [practicas, todas] = await Promise.all([this.datos.practicas(consulta), this.datos.versiones(consulta)]);
    const expedientes = this.expedientes(practicas, todas).filter((e) => !filtro.situacion || e.situacion === filtro.situacion);
    if (!filtro.situacion) return { expedientes, versiones: todas };
    const ids = new Set(expedientes.map((e) => e.practica.id));
    return { expedientes, versiones: todas.filter((v) => ids.has(v.practicaId)) };
  }

  private expedientes(practicas: readonly PracticaAnalitica[], versiones: readonly VersionAnalitica[]): Expediente[] {
    const porPractica = new Map(agrupar(versiones, (v) => v.practicaId));
    return practicas.map((practica) => {
      const docs = porPractica.get(practica.id) ?? [];
      const ultimoMovimiento = Math.max(0, ...docs.map((d) => Math.max(d.cargadoEn.getTime(), d.decididoEn?.getTime() ?? 0)));
      const porTipo = agrupar(docs, (d) => d.tipo);
      const historial = {
        versiones: docs.length, documentos: porTipo.length, conReenvio: porTipo.filter(([, g]) => g.length > 1).length,
        devoluciones: docs.filter((d) => d.decision === 'devolver').length, rechazos: docs.filter((d) => d.decision === 'rechazar').length,
      };
      let avance: AvanceDocumental | null = null;
      try {
        avance = this.avance.calcular(practica.modalidad as ModalidadPractica, docs.map((d) => ({ tipo: d.tipo as TipoDocumento, version: d.version, estado: d.estado as EstadoDocumento })));
      } catch {
        return { practica, avance: null, obligaciones: [], situacion: 'sin_matriz' as const, ultimoMovimiento, historial };
      }
      const obligaciones = avance.momentos.flatMap((m) => m.documentos.map((d) => ({ tipo: String(d.tipo), estado: d.estado === null ? 'sin_cargar' as const : ESTADO_OBLIGACION[d.estado] })));
      const situacion: SituacionExpediente = avance.exigidos > 0 && avance.aprobados === avance.exigidos ? 'completo'
        : obligaciones.some((o) => o.estado === 'correccion' || o.estado === 'rechazado') ? 'requiere_correccion'
          : obligaciones.every((o) => o.estado === 'sin_cargar') ? 'sin_iniciar' : 'en_curso';
      return { practica, avance, obligaciones, situacion, ultimoMovimiento, historial };
    });
  }

  private contadorObligaciones(): Record<EstadoObligacion, number> {
    return Object.fromEntries(ESTADOS_OBLIGACION.map((k) => [k, 0])) as Record<EstadoObligacion, number>;
  }

  /** Por tipo: documentos (pares práctica·tipo), versiones, reenvíos y decisiones auditadas de devolver/rechazar. */
  private friccion(versiones: readonly VersionAnalitica[]): ReporteAnalitica['friccion'] {
    const tipos = new Map<string, { pares: Map<string, number>; versiones: number; devoluciones: number; rechazos: number }>();
    for (const v of versiones) {
      const t = tipos.get(v.tipo) ?? { pares: new Map(), versiones: 0, devoluciones: 0, rechazos: 0 };
      t.versiones += 1;
      t.pares.set(v.practicaId, (t.pares.get(v.practicaId) ?? 0) + 1);
      if (v.decision === 'devolver') t.devoluciones += 1;
      if (v.decision === 'rechazar') t.rechazos += 1;
      tipos.set(v.tipo, t);
    }
    return [...tipos.entries()].map(([tipo, t]) => ({
      tipo, documentos: t.pares.size, versiones: t.versiones, conReenvio: [...t.pares.values()].filter((n) => n > 1).length,
      devoluciones: t.devoluciones, rechazos: t.rechazos, promedioVersiones: Math.round((t.versiones / t.pares.size) * 100) / 100,
    })).sort((a, b) => (b.devoluciones + b.rechazos) - (a.devoluciones + a.rechazos) || b.promedioVersiones - a.promedioVersiones || a.tipo.localeCompare(b.tipo));
  }

  /** Carga → decisión humana, solo con los dos eventos fiables (nunca `actualizado_en`). */
  private tiempos(versiones: readonly VersionAnalitica[], expedientes: readonly Expediente[]): ReporteAnalitica['tiempos'] {
    const ids = new Map(expedientes.map((e) => [e.practica.id, e.practica.programaId]));
    const decididas = versiones.filter((v) => v.decididoEn && v.decididoEn >= v.cargadoEn && ids.has(v.practicaId));
    const horas = (v: VersionAnalitica) => ((v.decididoEn as Date).getTime() - v.cargadoEn.getTime()) / 3_600_000;
    const todas = decididas.map(horas);
    // Muestreo determinista (orden por id, paso fijo): el mismo filtro produce los mismos puntos.
    const ordenadas = [...decididas].sort((a, b) => a.id.localeCompare(b.id));
    const paso = Math.max(1, ordenadas.length / MAX_MUESTRAS_TIEMPO);
    const muestras: ReporteAnalitica['tiempos']['muestras'] = [];
    for (let i = 0; i < ordenadas.length && muestras.length < MAX_MUESTRAS_TIEMPO; i += paso) {
      const v = ordenadas[Math.floor(i)];
      muestras.push({ tipo: v.tipo, programa: ids.get(v.practicaId) as string, horas: Math.round(horas(v) * 10) / 10 });
    }
    return {
      muestras,
      decisiones: decididas.length, medianaHoras: percentil(todas, 0.5), p90Horas: percentil(todas, 0.9),
      porTipo: agrupar(decididas, (v) => v.tipo).map(([tipo, g]) => ({ tipo, decisiones: g.length, medianaHoras: percentil(g.map(horas), 0.5) }))
        .sort((a, b) => (b.medianaHoras ?? 0) - (a.medianaHoras ?? 0)),
    };
  }

  /** Últimas 12 semanas (lunes, hora de Bogotá): cargas por `cargado_en`, decisiones por su evento auditado. */
  private semanas(versiones: readonly VersionAnalitica[], ahora: Date): ReporteAnalitica['semanas'] {
    const lunes = (t: number) => { const local = t + BOGOTA_MS; const dia = Math.floor(local / DIA_MS); const dow = (dia + 3) % 7; return (dia - dow) * DIA_MS; };
    const actual = lunes(ahora.getTime());
    const semanas = Array.from({ length: SEMANAS }, (_, i) => actual - (SEMANAS - 1 - i) * 7 * DIA_MS);
    const filas = new Map(semanas.map((s) => [s, { semana: new Date(s).toISOString().slice(0, 10), cargas: 0, aprobaciones: 0, devoluciones: 0, rechazos: 0 }]));
    for (const v of versiones) {
      const c = filas.get(lunes(v.cargadoEn.getTime()));
      if (c) c.cargas += 1;
      if (v.decididoEn && v.decision) {
        const d = filas.get(lunes(v.decididoEn.getTime()));
        if (d) d[v.decision === 'aprobar' ? 'aprobaciones' : v.decision === 'devolver' ? 'devoluciones' : 'rechazos'] += 1;
      }
    }
    return [...filas.values()];
  }
}

/** ¿Cumple el expediente el filtro de UNA faceta? Mismo criterio que el SQL del adaptador (y que la situación calculada). */
function cumpleFaceta(e: Expediente, f: FiltroReporteAnalitica, k: Faceta): boolean {
  const p = e.practica;
  switch (k) {
    case 'programa': return p.programaId === f.programa;
    case 'ciclo': return p.ciclo === f.ciclo;
    case 'semestre': return p.semestre === f.semestre;
    case 'modalidad': return p.modalidad === f.modalidad;
    case 'tipoReceptor': return tipoReceptor(p.modalidad) === f.tipoReceptor;
    case 'sector': return f.sector === SIN_DATO ? p.sector === null : p.sector === f.sector;
    case 'ciudad': {
      const clave = p.ciudad ?? (p.internacional ? INTERNACIONAL : null);
      return f.ciudad === SIN_DATO ? clave === null : clave === f.ciudad;
    }
    case 'empresa': return (p.empresa ?? SIN_EMPRESA) === f.empresa;
    case 'situacion': return e.situacion === f.situacion;
  }
}

function cobertura(grupo: readonly Expediente[]): Cobertura {
  let exigidos = 0, cargados = 0, aprobados = 0, completos = 0;
  const obligaciones = Object.fromEntries(ESTADOS_OBLIGACION.map((k) => [k, 0])) as Record<EstadoObligacion, number>;
  const h = { versiones: 0, documentos: 0, conReenvio: 0, devoluciones: 0, rechazos: 0 };
  for (const e of grupo) {
    exigidos += e.avance?.exigidos ?? 0; cargados += e.avance?.cargados ?? 0; aprobados += e.avance?.aprobados ?? 0;
    for (const o of e.obligaciones) obligaciones[o.estado] += 1;
    for (const k of Object.keys(h) as (keyof typeof h)[]) h[k] += e.historial[k];
    if (e.situacion === 'completo') completos += 1;
  }
  return {
    estudiantes: new Set(grupo.map((e) => e.practica.estudianteId)).size, practicas: grupo.length, exigidos, cargados, aprobados,
    correccion: obligaciones.correccion, completos, obligaciones, ...h,
  };
}

/** Cruce de dos dimensiones sobre prácticas: estudiantes únicos por celda (una persona cuenta una vez en cada celda). */
function cruce(grupo: readonly Expediente[], fila: (e: Expediente) => string, columna: (e: Expediente) => string): Celda[] {
  const celdas = new Map<string, Celda & { ids: Set<string> }>();
  for (const e of grupo) {
    const f = fila(e), c = columna(e), k = JSON.stringify([f, c]);
    const celda = celdas.get(k) ?? { fila: f, columna: c, estudiantes: 0, practicas: 0, ids: new Set<string>() };
    celda.practicas += 1;
    celda.ids.add(e.practica.estudianteId);
    celdas.set(k, celda);
  }
  return [...celdas.values()].map(({ ids, ...c }) => ({ ...c, estudiantes: ids.size }))
    .sort((a, b) => a.fila.localeCompare(b.fila) || b.estudiantes - a.estudiantes);
}

export function compararCiclos(a: string, b: string): number {
  const ia = ORDEN_CICLOS.indexOf(a), ib = ORDEN_CICLOS.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

/** Minúsculas sin tildes, para buscar «Ingenieria» o «ingeniería» por igual. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function agrupar<T>(lista: readonly T[], clave: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of lista) {
    const k = clave(x);
    const grupo = m.get(k);
    if (grupo) grupo.push(x); else m.set(k, [x]);
  }
  return [...m.entries()];
}

/** Percentil por rango más cercano, en horas con un decimal; null sin datos. */
function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return Math.round(ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)] * 10) / 10;
}

/**
 * `practicas.periodo_academico` es texto sin catálogo («2026-2», «2026A»…): se ordena por año y luego por el sufijo
 * (numérico si lo es). Lo que no empieza por un año va al final, por texto.
 */
export function compararPeriodos(a: string, b: string): number {
  const ma = /^(\d{4})-?(\w*)$/.exec(a), mb = /^(\d{4})-?(\w*)$/.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]) || ma[2].localeCompare(mb[2], 'es', { numeric: true });
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b);
}

/**
 * Orden cronológico ascendente con la fuente real: `periodos_academicos.fecha_inicio`. Los códigos que no están en esa
 * entidad no tienen cronología conocida y van al final, por el orden de texto de `compararPeriodos` (no se inventa).
 */
export function ordenCronologico(periodos: readonly PeriodoAnalitica[]): string[] {
  const unicos = [...new Map(periodos.map((p) => [p.codigo, p])).values()];
  const conFecha = unicos.filter((p) => p.inicio).sort((a, b) => (a.inicio as string).localeCompare(b.inicio as string) || compararPeriodos(a.codigo, b.codigo));
  const sinFecha = unicos.filter((p) => !p.inicio).sort((a, b) => compararPeriodos(a.codigo, b.codigo));
  return [...conFecha, ...sinFecha].map((p) => p.codigo);
}

/** Celda CSV con «;»: comillas dobles y protección contra inyección de fórmulas (=, +, -, @). */
export function celdaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}
