import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  DetalleCalificacion, DetalleEvaluaTuProceso, DetalleSeguimiento, ETIQUETA_ENTRADA, EntradaBitacora,
  TipoEntradaBitacora,
} from '../../../domain/entities/bitacora.entity';
import { EstadoDocumento } from '../../../domain/entities/documento.entity';
import { definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { EQUIVALENCIA_SGP, EstadoPractica, Practica } from '../../../domain/entities/practica.entity';
import { Usuario } from '../../../domain/entities/usuario.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, BITACORA_REPOSITORY, BitacoraRepositoryPort, CARTA_REPOSITORY,
  CartaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, FiltroPracticas, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  CeldaHoja, ColumnaHoja, GENERADOR_HOJA_CALCULO, GeneradorHojaCalculoPort, HojaCalculo, MatriculaSinu, SINU,
  SinuPort,
} from '../../../domain/ports/out/servicios-externos.port';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

export type TipoReporteBitacora = 'seguimiento' | 'evalua_tu_proceso' | 'mensaje_libre' | 'calificacion_docente';

export interface FiltroReportePracticas {
  periodos: readonly string[];
  modalidad?: string;
  estado?: EstadoPractica;
}

export interface FiltroReporteBitacoras {
  periodo?: string;
  tipo: TipoReporteBitacora;
  estado?: EstadoPractica;
}

export interface FiltroReporteCartas {
  periodo?: string;
  desde?: Date;
  hasta?: Date;
}

export interface ReporteGenerado {
  nombreArchivo: string;
  contenido: Buffer;
  filas: number;
}

export interface ReporteTabla {
  columnas: readonly ColumnaHoja[];
  filas: readonly Record<string, CeldaHoja>[];
}

const ROLES_REPORTES: readonly Rol[] = [Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.AUXILIAR, Rol.TUTOR];
const APROBADOS: readonly EstadoDocumento[] = [EstadoDocumento.APROBADO, EstadoDocumento.AUTO_APROBADO];
const TIPO_BITACORA: Readonly<Record<TipoReporteBitacora, TipoEntradaBitacora>> = {
  seguimiento: TipoEntradaBitacora.SEGUIMIENTO,
  evalua_tu_proceso: TipoEntradaBitacora.EVALUA_TU_PROCESO,
  mensaje_libre: TipoEntradaBitacora.MENSAJE_LIBRE,
  calificacion_docente: TipoEntradaBitacora.CALIFICACION_DOCENTE,
};

const col = (clave: string, encabezado: string, ancho?: number): ColumnaHoja => ({ clave, encabezado, ancho });

/** Bloques 1, 2, 5, 6 y 7 del reporte de prácticas; los comparten los de bitácoras. */
const COLUMNAS_ESTUDIANTE = [
  col('documento', 'Documento', 14), col('estudiante', 'Nombre del estudiante', 32),
  col('correo', 'Email del estudiante', 34), col('telefono', 'Teléfono del estudiante', 16),
];
const COLUMNAS_ACADEMICAS = [
  col('programa', 'Programa', 18), col('regional', 'Regional', 14), col('nivel', 'Nivel de formación', 14),
  col('semestre', 'Semestre según créditos', 12), col('modalidadAcademica', 'Modalidad', 12),
  col('codigoAsignatura', 'Código de asignatura', 14), col('asignatura', 'Nombre de la asignatura', 26),
  col('periodo', 'Periodo de inscripción de la asignatura', 14), col('pensum', 'Pensum', 12),
];
const COLUMNAS_PRACTICA = [
  col('estado', 'Estado de la práctica', 14), col('modalidadPractica', 'Modalidad de práctica', 28),
  col('fechaInicio', 'Fecha de inicio de la práctica', 14), col('fechaFin', 'Fecha de finalización de la práctica', 14),
];
const COLUMNAS_DOCENTE = [col('docente', 'Nombre del docente', 30), col('docenteDocumento', 'Documento del docente', 14)];
const COLUMNAS_EMPRESA = [
  col('nit', 'NIT de la empresa', 16), col('empresa', 'Nombre de la empresa', 32), col('cargo', 'Cargo del estudiante', 22),
  col('horario', 'Horario', 22), col('salario', 'Salario', 12), col('funciones', 'Funciones relevantes', 40),
  col('area', 'Área', 18), col('ciudad', 'Ciudad', 14),
];
const COLUMNAS_JEFE = [
  col('jefeCargo', 'Cargo del jefe inmediato', 20), col('jefeNombre', 'Nombre del jefe inmediato', 28),
  col('jefeCorreo', 'Email del jefe inmediato', 30), col('jefeTelefono', 'Teléfono del jefe inmediato', 16),
];
const COLUMNAS_SEGUIMIENTO = [
  col('documentosSubidos', 'Documentos subidos', 12), col('documentosAprobados', 'Documentos aprobados', 12),
  col('registrosBitacora', 'Registros de bitácora', 12), col('fechaCreacion', 'Fecha de creación', 18),
  col('ultimoMovimientoEstudiante', 'Último movimiento del estudiante', 18),
  col('ultimoMovimientoDocente', 'Último movimiento del docente', 18),
];

/**
 * Reportes del SGP (manual de coordinación, apartado Reportes; manual del
 * docente, «Reportes»): prácticas, bitácoras (cuatro tipos) y cartas. Salen en
 * Excel con las columnas del manual, en su orden. El alcance del actor se
 * aplica acotando la consulta, igual que en la bandeja.
 */
@Injectable()
export class ReportesSgpUseCase {
  constructor(
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(BITACORA_REPOSITORY) private readonly bitacora: BitacoraRepositoryPort,
    @Inject(CARTA_REPOSITORY) private readonly cartas: CartaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(SINU) private readonly sinu: SinuPort,
    @Inject(GENERADOR_HOJA_CALCULO) private readonly hojas: GeneradorHojaCalculoPort,
  ) {}

  async reportePracticas(filtro: FiltroReportePracticas, actor: Actor): Promise<ReporteTabla> {
    this.exigirReportes(actor);
    if (filtro.periodos.length === 0) throw new BadRequestException('Seleccione al menos un periodo académico');
    const filas: Record<string, CeldaHoja>[] = [];
    const cache = new Cache(this.usuarios, this.sinu);
    for (const periodo of filtro.periodos) {
      const lista = await this.practicas.listar(this.alcance({
        periodoAcademico: periodo, modalidad: filtro.modalidad, estados: filtro.estado ? [filtro.estado] : undefined, limite: 10_000,
      }, actor));
      for (const practica of lista) {
        const [documentos, entradas] = await Promise.all([
          this.documentos.listarPorPractica(practica.id), this.bitacora.listarPorPractica(practica.id),
        ]);
        const base = await this.bloquesComunes(practica, cache);
        const cargadosEstudiante = documentos.map((d) => d.instantanea().cargadoEn.getTime());
        const movEstudiante = Math.max(0, ...cargadosEstudiante, ...entradas.filter((e) => e.autor === 'estudiante').map((e) => e.creadaEn.getTime()));
        const movDocente = Math.max(0, ...entradas.filter((e) => e.autor === 'docente').map((e) => e.creadaEn.getTime()),
          ...documentos.map((d) => d.instantanea()).filter((d) => d.decididoPor !== null).map((d) => d.actualizadoEn.getTime()));
        filas.push({
          ...base,
          documentosSubidos: new Set(documentos.map((d) => d.tipo)).size,
          documentosAprobados: new Set(documentos.filter((d) => APROBADOS.includes(d.estado)).map((d) => d.tipo)).size,
          registrosBitacora: entradas.length,
          fechaCreacion: practica.instantanea().creadaEn,
          ultimoMovimientoEstudiante: movEstudiante > 0 ? new Date(movEstudiante) : null,
          ultimoMovimientoDocente: movDocente > 0 ? new Date(movDocente) : null,
        });
      }
    }
    return {
      columnas: [
        ...COLUMNAS_ESTUDIANTE, ...COLUMNAS_ACADEMICAS, ...COLUMNAS_PRACTICA, ...COLUMNAS_DOCENTE,
        ...COLUMNAS_EMPRESA, ...COLUMNAS_JEFE, ...COLUMNAS_SEGUIMIENTO,
      ],
      filas,
    };
  }

  async reporteBitacoras(filtro: FiltroReporteBitacoras, actor: Actor): Promise<ReporteTabla> {
    this.exigirReportes(actor);
    const tipo = TIPO_BITACORA[filtro.tipo];
    if (!tipo) throw new BadRequestException('Tipo de reporte de bitácora no reconocido');
    const entradas = await this.bitacora.listar({ periodoAcademico: filtro.periodo, tipo, limite: 20_000 });
    const cache = new Cache(this.usuarios, this.sinu);
    const practicasVistas = new Map<string, Practica | null>();
    const filas: Record<string, CeldaHoja>[] = [];

    for (const entrada of entradas) {
      let practica = practicasVistas.get(entrada.practicaId);
      if (practica === undefined) {
        practica = await this.practicas.buscarPorId(entrada.practicaId);
        if (practica && !this.visible(practica, actor)) practica = null;
        practicasVistas.set(entrada.practicaId, practica);
      }
      if (!practica) continue;
      if (filtro.estado && practica.estado !== filtro.estado) continue;
      const base = await this.bloquesComunes(practica, cache);
      const autor = entrada.autorId ? await cache.usuario(entrada.autorId) : null;
      const comunes = {
        ...base,
        codigoPractica: practica.numeroFur,
        fechaBitacora: entrada.creadaEn,
        tipo: ETIQUETA_ENTRADA[entrada.tipo],
        autor: entrada.autor === 'sistema' ? 'SIPRA' : autor?.nombre ?? '—',
        perfil: entrada.autor,
      };
      for (const par of this.preguntasRespuestas(entrada)) filas.push({ ...comunes, ...par });
    }
    return {
      columnas: [
        col('codigoPractica', 'Código de práctica', 12), ...COLUMNAS_ESTUDIANTE,
        ...COLUMNAS_ACADEMICAS.filter((c) => !['semestre', 'pensum'].includes(c.clave)),
        col('estado', 'Estado de la práctica', 14), col('modalidadPractica', 'Modalidad de práctica', 28),
        col('docente', 'Nombre del docente', 30),
        col('fechaBitacora', 'Fecha de bitácora', 18), col('tipo', 'Tipo de registro', 22), col('titulo', 'Título', 26),
        col('pregunta', 'Pregunta', 40), col('respuesta', filtro.tipo === 'calificacion_docente' ? 'Respuesta / Calificación' : 'Respuesta', 50),
        col('autor', 'Autor del registro', 28), col('perfil', 'Perfil del registro', 14),
        ...COLUMNAS_EMPRESA, ...COLUMNAS_JEFE,
        col('fechaInicio', 'Fecha de inicio de la práctica', 14), col('fechaFin', 'Fecha de finalización de la práctica', 14),
      ],
      filas,
    };
  }

  async reporteCartas(filtro: FiltroReporteCartas, actor: Actor): Promise<ReporteTabla> {
    this.exigirReportes(actor);
    const lista = await this.cartas.listar({ periodoAcademico: filtro.periodo, desde: filtro.desde, hasta: filtro.hasta, limite: 20_000 });
    const cache = new Cache(this.usuarios, this.sinu);
    const filas: Record<string, CeldaHoja>[] = [];
    for (const carta of lista) {
      const d = carta.instantanea();
      if (d.practicaId && (actor.rol === Rol.TUTOR || actor.escuelas.length > 0)) {
        const practica = await this.practicas.buscarPorId(d.practicaId);
        if (practica && !this.visible(practica, actor)) continue;
      }
      const estudiante = await cache.usuario(d.estudianteId);
      const hora = d.generadaEn.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
      filas.push({
        numeroFur: d.numeroFur, fecha: d.generadaEn, hora,
        modalidadCarta: d.modalidadCarta === 'abierta' ? 'A quien corresponda' : 'Con empresa',
        documento: estudiante?.instantanea().documento ?? null, estudiante: estudiante?.nombre ?? '—',
        empresa: d.empresaRazonSocial,
      });
    }
    return {
      columnas: [
        col('numeroFur', 'Número de FUR', 12), col('fecha', 'Fecha', 18), col('hora', 'Hora', 10),
        col('modalidadCarta', 'Modalidad de carta', 20), col('documento', 'Documento del estudiante', 16),
        col('estudiante', 'Nombre del estudiante', 32), col('empresa', 'Nombre de la empresa', 34),
      ],
      filas,
    };
  }

  /** Empaqueta una tabla como libro .xlsx y deja rastro en auditoría. */
  async excel(nombre: string, tabla: ReporteTabla, actor: Actor, metadatos: Record<string, unknown>): Promise<ReporteGenerado> {
    const hoja: HojaCalculo = { nombre: nombre.slice(0, 31), columnas: tabla.columnas, filas: tabla.filas };
    const contenido = await this.hojas.generar({ titulo: `SIPRA · ${nombre}`, hojas: [hoja] });
    const sello = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.REPORTE_GENERADO,
      entidad: 'reporte_sgp', entidadId: null, justificacion: null, metadatos: { reporte: nombre, ...metadatos, filas: tabla.filas.length },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
    return {
      nombreArchivo: `${nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${sello}.xlsx`,
      contenido,
      filas: tabla.filas.length,
    };
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async bloquesComunes(practica: Practica, cache: Cache): Promise<Record<string, CeldaHoja>> {
    const p = practica.instantanea();
    const estudiante = await cache.usuario(p.estudianteId);
    const documento = estudiante?.instantanea().documento ?? null;
    const matricula = documento ? await cache.matricula(documento) : null;
    const docente = p.tutorId ? await cache.usuario(p.tutorId) : null;
    const definicion = definicionModalidad(p.modalidad);
    return {
      documento, estudiante: estudiante?.nombre ?? '—', correo: estudiante?.correo ?? null, telefono: matricula?.telefono ?? null,
      programa: matricula?.programaNombre ?? p.programaId, regional: p.regional ?? matricula?.regional ?? null,
      nivel: p.ciclo, semestre: matricula?.semestre ?? null, modalidadAcademica: /^\d{2}V/.test(p.periodoAcademico) ? 'Virtual' : 'Presencial',
      codigoAsignatura: matricula?.codigoAsignatura ?? null, asignatura: p.asignatura ?? matricula?.asignaturaPractica ?? null,
      periodo: p.periodoAcademico, pensum: matricula?.pensum ?? null,
      estado: EQUIVALENCIA_SGP[p.estado], modalidadPractica: definicion.etiquetaSgp,
      fechaInicio: p.fechaInicio, fechaFin: p.fechaFin,
      docente: docente?.nombre ?? null, docenteDocumento: docente?.instantanea().documento ?? null,
      nit: p.empresaNit, empresa: p.empresaRazonSocial, cargo: p.cargo, horario: p.horario, salario: p.salario,
      funciones: p.funcionesRelevantes, area: p.area, ciudad: p.ciudad,
      jefeCargo: p.jefeInmediatoCargo, jefeNombre: p.jefeInmediatoNombre, jefeCorreo: p.jefeInmediatoCorreo,
      jefeTelefono: p.jefeInmediatoTelefono,
    };
  }

  /** Una fila por pregunta/respuesta, como en el reporte del SGP. */
  private preguntasRespuestas(entrada: EntradaBitacora): { titulo: string; pregunta: string; respuesta: CeldaHoja }[] {
    const d = entrada.instantanea();
    const titulo = ETIQUETA_ENTRADA[d.tipo];
    switch (d.tipo) {
      case TipoEntradaBitacora.EVALUA_TU_PROCESO: {
        const det = d.detalle as DetalleEvaluaTuProceso | null;
        const pares: { titulo: string; pregunta: string; respuesta: CeldaHoja }[] =
          (det?.respuestas ?? []).map((r) => ({ titulo, pregunta: r.pregunta, respuesta: r.valor }));
        if (det?.comentario) pares.push({ titulo, pregunta: 'Comentario', respuesta: det.comentario });
        return pares.length > 0 ? pares : [{ titulo, pregunta: 'Evaluación', respuesta: d.mensaje }];
      }
      case TipoEntradaBitacora.SEGUIMIENTO: {
        const det = d.detalle as DetalleSeguimiento | null;
        if (!det) return [{ titulo, pregunta: 'Seguimiento', respuesta: d.mensaje }];
        return [
          { titulo, pregunta: 'Fecha y hora de la visita', respuesta: new Date(det.fechaVisita) },
          { titulo, pregunta: 'Modalidad de la visita', respuesta: det.modalidadVisita },
          { titulo, pregunta: 'Persona con la que se desarrolló', respuesta: [det.contactoNombre, det.contactoCargo, det.contactoArea].filter(Boolean).join(' · ') },
          { titulo, pregunta: 'Sugerencias para el plan de mejoramiento', respuesta: det.sugerenciasPlanMejoramiento },
          { titulo, pregunta: 'Evaluación con el jefe inmediato', respuesta: det.evaluacionJefeInmediato },
          { titulo, pregunta: 'Observaciones', respuesta: d.mensaje },
        ];
      }
      case TipoEntradaBitacora.CALIFICACION_DOCENTE: {
        const det = d.detalle as DetalleCalificacion | null;
        return [
          { titulo, pregunta: 'Calificación final (0,0 a 5,0)', respuesta: det?.nota ?? null },
          ...(d.mensaje ? [{ titulo, pregunta: 'Observación', respuesta: d.mensaje as CeldaHoja }] : []),
        ];
      }
      default:
        return [{ titulo, pregunta: 'Mensaje', respuesta: d.mensaje }];
    }
  }

  private alcance(filtro: FiltroPracticas, actor: Actor): FiltroPracticas {
    switch (actor.rol) {
      case Rol.TUTOR:
        return { ...filtro, escuelaIds: actor.escuelas };
      case Rol.COORDINADOR:
        return actor.escuelas.length === 0 ? filtro : { ...filtro, escuelaIds: actor.escuelas };
      default:
        return filtro;
    }
  }

  private visible(practica: Practica, actor: Actor): boolean {
    return practica.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId });
  }

  private exigirReportes(actor: Actor): void {
    if (!ROLES_REPORTES.includes(actor.rol)) throw new ForbiddenException('Su perfil no genera reportes del SGP');
  }
}

/** Evita repetir consultas de usuario y de SINU dentro de un mismo reporte. */
class Cache {
  private readonly usuarios = new Map<string, Usuario | null>();
  private readonly matriculas = new Map<string, MatriculaSinu | null>();
  constructor(private readonly repo: UsuarioRepositoryPort, private readonly sinu: SinuPort) {}

  async usuario(id: string): Promise<Usuario | null> {
    if (!this.usuarios.has(id)) this.usuarios.set(id, await this.repo.buscarPorId(id));
    return this.usuarios.get(id) ?? null;
  }

  async matricula(documento: string): Promise<MatriculaSinu | null> {
    if (!this.matriculas.has(documento)) {
      try {
        this.matriculas.set(documento, await this.sinu.buscarPorDocumento(documento));
      } catch {
        this.matriculas.set(documento, null);
      }
    }
    return this.matriculas.get(documento) ?? null;
  }
}
