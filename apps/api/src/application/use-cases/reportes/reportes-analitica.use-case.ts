import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { ModalidadPractica } from '../../../domain/entities/modalidad.entity';
import { AUDITORIA_REPOSITORY, AuditoriaRepositoryPort } from '../../../domain/ports/out/repositorios.port';
import {
  FiltroAnalitica, PracticaAnalitica, REPORTES_ANALITICA, ReportesAnaliticaPort, VersionAnalitica,
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

/** Filtros de la petición (sin alcance: el alcance lo impone el actor). */
export interface FiltroReporteAnalitica {
  periodos?: readonly string[];
  escuela?: string;
  programa?: string;
  modalidad?: string;
  estado?: string;
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
}

export interface ReporteAnalitica {
  generadoEn: string;
  periodosDisponibles: string[];
  resumen: Cobertura;
  expedientes: Record<SituacionExpediente, number>;
  estadosPractica: { estado: string; practicas: number }[];
  documental: Record<EstadoObligacion, number>;
  porTipo: ({ tipo: string; exigidos: number } & Record<EstadoObligacion, number>)[];
  friccion: { tipo: string; documentos: number; versiones: number; conReenvio: number; devoluciones: number; rechazos: number; promedioVersiones: number }[];
  tiempos: { decisiones: number; medianaHoras: number | null; p90Horas: number | null; porTipo: { tipo: string; decisiones: number; medianaHoras: number | null }[] };
  semanas: { semana: string; cargas: number; aprobaciones: number; devoluciones: number; rechazos: number }[];
  periodos: ({ periodo: string } & Cobertura)[];
  modalidades: ({ modalidad: string } & Cobertura)[];
  escuelas: ({ escuela: string; nombre: string; programas: ({ programa: string } & Cobertura)[] } & Cobertura)[];
  empresas: { empresa: string; practicas: number; estudiantes: number }[];
}

export interface FilaDetalle {
  practicaId: string;
  estudiante: string;
  programa: string;
  escuela: string;
  modalidad: string;
  empresa: string | null;
  periodo: string;
  estado: string;
  exigidos: number;
  cargados: number;
  aprobados: number;
  correccion: number;
  situacion: SituacionExpediente;
  ultimoMovimiento: string | null;
}

export interface DetalleAnalitica {
  total: number;
  estudiantesUnicos: number;
  filas: FilaDetalle[];
}

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
    const consulta = this.consulta(filtro, actor);
    const [periodosDisponibles, practicas, versiones] = await Promise.all([
      this.datos.periodos(escuelasDeReportes(actor)), this.datos.practicas(consulta), this.datos.versiones(consulta),
    ]);
    const expedientes = this.expedientes(practicas, versiones);

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
    for (const e of expedientes) situaciones[e.situacion] += 1;

    const estados = new Map<string, number>();
    for (const p of practicas) estados.set(p.estado, (estados.get(p.estado) ?? 0) + 1);

    return {
      generadoEn: ahora.toISOString(),
      periodosDisponibles: ordenarPeriodos(periodosDisponibles),
      resumen: cobertura(expedientes),
      expedientes: situaciones,
      estadosPractica: [...estados.entries()].map(([estado, n]) => ({ estado, practicas: n })).sort((a, b) => b.practicas - a.practicas),
      documental,
      porTipo,
      friccion: this.friccion(versiones),
      tiempos: this.tiempos(versiones),
      semanas: this.semanas(versiones, ahora),
      periodos: agrupar(expedientes, (e) => e.practica.periodoAcademico)
        .map(([periodo, grupo]) => ({ periodo, ...cobertura(grupo) }))
        .sort((a, b) => compararPeriodos(a.periodo, b.periodo)),
      modalidades: agrupar(expedientes, (e) => e.practica.modalidad).map(([modalidad, grupo]) => ({ modalidad, ...cobertura(grupo) }))
        .sort((a, b) => b.practicas - a.practicas),
      escuelas: agrupar(expedientes, (e) => e.practica.escuelaId).map(([escuela, grupo]) => ({
        escuela, nombre: grupo[0].practica.escuela, ...cobertura(grupo),
        programas: agrupar(grupo, (e) => e.practica.programaId).map(([programa, g]) => ({ programa, ...cobertura(g) })).sort((a, b) => b.practicas - a.practicas),
      })).sort((a, b) => b.practicas - a.practicas),
      empresas: agrupar(expedientes.filter((e) => e.practica.empresa), (e) => e.practica.empresa as string)
        .map(([empresa, grupo]) => ({ empresa, practicas: grupo.length, estudiantes: new Set(grupo.map((e) => e.practica.estudianteId)).size }))
        .sort((a, b) => b.practicas - a.practicas || a.empresa.localeCompare(b.empresa)).slice(0, 10),
    };
  }

  /** Detalle por práctica con los mismos filtros y definiciones que la analítica (los totales coinciden). */
  async detalle(filtro: FiltroReporteAnalitica, segmento: SegmentoDetalle, actor: Actor): Promise<DetalleAnalitica> {
    exigirReportes(actor);
    if (segmento.situacion && !SITUACIONES.includes(segmento.situacion)) throw new BadRequestException('Situación de expediente no reconocida');
    if (segmento.estadoDocumental && !ESTADOS_OBLIGACION.includes(segmento.estadoDocumental)) throw new BadRequestException('Estado documental no reconocido');
    const consulta = this.consulta(filtro, actor);
    const [practicas, versiones] = await Promise.all([this.datos.practicas(consulta), this.datos.versiones(consulta)]);
    const elegidos = this.expedientes(practicas, versiones)
      .filter((e) => !segmento.situacion || e.situacion === segmento.situacion)
      .filter((e) => !segmento.tipo && !segmento.estadoDocumental ? true
        : e.obligaciones.some((o) => (!segmento.tipo || o.tipo === segmento.tipo) && (!segmento.estadoDocumental || o.estado === segmento.estadoDocumental)));
    const filas = elegidos
      .map((e): FilaDetalle => ({
        practicaId: e.practica.id, estudiante: e.practica.estudiante, programa: e.practica.programaId, escuela: e.practica.escuela,
        modalidad: e.practica.modalidad, empresa: e.practica.empresa, periodo: e.practica.periodoAcademico, estado: e.practica.estado,
        exigidos: e.avance?.exigidos ?? 0, cargados: e.avance?.cargados ?? 0, aprobados: e.avance?.aprobados ?? 0,
        correccion: e.obligaciones.filter((o) => o.estado === 'correccion').length, situacion: e.situacion,
        ultimoMovimiento: e.ultimoMovimiento > 0 ? new Date(e.ultimoMovimiento).toISOString() : null,
      }))
      .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.estudiante.localeCompare(b.estudiante));
    return { total: filas.length, estudiantesUnicos: new Set(elegidos.map((e) => e.practica.estudianteId)).size, filas };
  }

  /** CSV del detalle (filtrado y auditado). Sin documento de identidad ni correo; celdas protegidas contra fórmulas. */
  async csv(filtro: FiltroReporteAnalitica, segmento: SegmentoDetalle, actor: Actor): Promise<{ nombreArchivo: string; contenido: Buffer; filas: number }> {
    const detalle = await this.detalle(filtro, segmento, actor);
    const columnas: [keyof FilaDetalle, string][] = [
      ['estudiante', 'Estudiante'], ['programa', 'Programa'], ['escuela', 'Escuela'], ['modalidad', 'Modalidad'], ['empresa', 'Empresa'],
      ['periodo', 'Periodo'], ['estado', 'Estado de la práctica'], ['exigidos', 'Documentos exigidos'], ['cargados', 'Cargados'],
      ['aprobados', 'Aprobados'], ['correccion', 'En corrección'], ['situacion', 'Expediente'], ['ultimoMovimiento', 'Último movimiento'],
    ];
    const lineas = [columnas.map(([, t]) => celdaCsv(t)).join(';'), ...detalle.filas.map((f) => columnas.map(([k]) => celdaCsv(f[k])).join(';'))];
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.REPORTE_GENERADO,
      entidad: 'reporte_analitica', entidadId: null, justificacion: null,
      metadatos: { reporte: 'Detalle analítico', ...filtro, ...segmento, filas: detalle.total },
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
    };
  }

  private expedientes(practicas: readonly PracticaAnalitica[], versiones: readonly VersionAnalitica[]): Expediente[] {
    const porPractica = new Map(agrupar(versiones, (v) => v.practicaId));
    return practicas.map((practica) => {
      const docs = porPractica.get(practica.id) ?? [];
      const ultimoMovimiento = Math.max(0, ...docs.map((d) => Math.max(d.cargadoEn.getTime(), d.decididoEn?.getTime() ?? 0)));
      let avance: AvanceDocumental | null = null;
      try {
        avance = this.avance.calcular(practica.modalidad as ModalidadPractica, docs.map((d) => ({ tipo: d.tipo as TipoDocumento, version: d.version, estado: d.estado as EstadoDocumento })));
      } catch {
        return { practica, avance: null, obligaciones: [], situacion: 'sin_matriz' as const, ultimoMovimiento };
      }
      const obligaciones = avance.momentos.flatMap((m) => m.documentos.map((d) => ({ tipo: String(d.tipo), estado: d.estado === null ? 'sin_cargar' as const : ESTADO_OBLIGACION[d.estado] })));
      const situacion: SituacionExpediente = avance.exigidos > 0 && avance.aprobados === avance.exigidos ? 'completo'
        : obligaciones.some((o) => o.estado === 'correccion' || o.estado === 'rechazado') ? 'requiere_correccion'
          : obligaciones.every((o) => o.estado === 'sin_cargar') ? 'sin_iniciar' : 'en_curso';
      return { practica, avance, obligaciones, situacion, ultimoMovimiento };
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
  private tiempos(versiones: readonly VersionAnalitica[]): ReporteAnalitica['tiempos'] {
    const decididas = versiones.filter((v) => v.decididoEn && v.decididoEn >= v.cargadoEn);
    const horas = (v: VersionAnalitica) => ((v.decididoEn as Date).getTime() - v.cargadoEn.getTime()) / 3_600_000;
    const todas = decididas.map(horas);
    return {
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

function cobertura(grupo: readonly Expediente[]): Cobertura {
  let exigidos = 0, cargados = 0, aprobados = 0, correccion = 0, completos = 0;
  for (const e of grupo) {
    exigidos += e.avance?.exigidos ?? 0; cargados += e.avance?.cargados ?? 0; aprobados += e.avance?.aprobados ?? 0;
    correccion += e.obligaciones.filter((o) => o.estado === 'correccion').length;
    if (e.situacion === 'completo') completos += 1;
  }
  return { estudiantes: new Set(grupo.map((e) => e.practica.estudianteId)).size, practicas: grupo.length, exigidos, cargados, aprobados, correccion, completos };
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

function ordenarPeriodos(periodos: readonly string[]): string[] {
  return [...new Set(periodos)].sort((a, b) => compararPeriodos(b, a));
}

/** Celda CSV con «;»: comillas dobles y protección contra inyección de fórmulas (=, +, -, @). */
export function celdaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}
