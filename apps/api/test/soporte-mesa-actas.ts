import { ActaEstudianteUseCase } from '../src/application/use-cases/documentos/acta-estudiante.use-case';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { MesaActasUseCase } from '../src/application/use-cases/documentos/mesa-actas.use-case';
import { ValidacionActaUseCase } from '../src/application/use-cases/documentos/validacion-acta.use-case';
import { GestionarPracticaUseCase } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import {
  DatosEvidenciaActa, DatosValidacionActa, EstadoValidacionActa, EvidenciaActa, ValidacionActa,
} from '../src/domain/entities/validacion-acta.entity';
import {
  FilaMesaActa, FiltroMesaActa, MINUTOS_RESERVA_POR_VENCER, ResumenSupervisionActa, ValidacionActaRepositoryPort,
} from '../src/domain/ports/out/validacion-acta.port';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ESC_A, actorDe, documentoDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { OpcionesActa, OpcionesLecturaSintetica, VALORES_BASE, actaSintetica, lecturaPersistibleSintetica } from './soporte-acta';

export const AHORA_MESA = new Date('2026-08-10T15:00:00.000Z');
export const MIN = 60_000;
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Documentos en memoria con compare-and-set por estado (la misma semántica que la base). */
export class DocumentosMemoria {
  filas = new Map<string, DatosDocumento>();
  buscarPorId = (id: string) => Promise.resolve(this.filas.has(id) ? Documento.desde(this.filas.get(id) as DatosDocumento) : null);
  listarPorPractica = (practicaId: string) => Promise.resolve([...this.filas.values()].filter((d) => d.practicaId === practicaId).map((d) => Documento.desde(d)));
  guardarSiEstado = (datos: DatosDocumento, esperado: EstadoDocumento) => {
    if (this.filas.get(datos.id)?.estado !== esperado) return Promise.resolve(false);
    this.filas.set(datos.id, datos);
    return Promise.resolve(true);
  };
  guardar = (d: DatosDocumento) => { this.filas.set(d.id, d); return Promise.resolve(Documento.desde(d)); };
}

export class AuditoriaMemoria {
  registros: RegistroAuditoria[] = [];
  registrar = (r: RegistroAuditoria) => { this.registros.push(r); return Promise.resolve(); };
  acciones = (accion: string) => this.registros.filter((r) => String(r.accion) === accion);
}

/** Repositorio de validaciones con la semántica atómica de las sentencias SQL del adaptador real. */
export class ValidacionesActaMemoria implements ValidacionActaRepositoryPort {
  filas = new Map<string, DatosValidacionActa>();
  evid: DatosEvidenciaActa[] = [];
  /** Hace fallar el N-ésimo compare-and-set que deja la validación en «revision» (simula una interrupción). */
  fallarCasDeResultado = 0;
  constructor(private readonly ctx: { documentos: DocumentosMemoria; practicas: Map<string, Practica>; usuarios: Map<string, ReturnType<typeof usuarioDe>> }) {}

  buscarPorId(id: string) { const d = this.filas.get(id); return Promise.resolve(d ? ValidacionActa.desde(d) : null); }
  buscarPorDocumento(documentoId: string) {
    const d = [...this.filas.values()].find((f) => f.documentoId === documentoId);
    return Promise.resolve(d ? ValidacionActa.desde(d) : null);
  }
  listarPorPractica(practicaId: string) {
    return Promise.resolve([...this.filas.values()].filter((f) => f.practicaId === practicaId).map((d) => ValidacionActa.desde(d)));
  }
  crearSiNoExiste(datos: DatosValidacionActa) {
    const previa = [...this.filas.values()].find((f) => f.documentoId === datos.documentoId);
    if (previa) return Promise.resolve({ validacion: ValidacionActa.desde(previa), creada: false });
    this.filas.set(datos.id, { ...datos });
    return Promise.resolve({ validacion: ValidacionActa.desde(datos), creada: true });
  }
  guardarSiVersion(datos: DatosValidacionActa, versionEsperada: number) {
    const actual = this.filas.get(datos.id);
    if (!actual || actual.version !== versionEsperada) return Promise.resolve(false);
    if (datos.estado === EstadoValidacionActa.REVISION && this.fallarCasDeResultado > 0) {
      this.fallarCasDeResultado -= 1;
      return Promise.reject(new Error('interrupción simulada'));
    }
    this.filas.set(datos.id, { ...datos, version: versionEsperada + 1 });
    return Promise.resolve(true);
  }
  agregarEvidencia(datos: DatosEvidenciaActa) {
    if (this.evid.some((e) => e.validacionActaId === datos.validacionActaId && e.intento === datos.intento && e.tipo === datos.tipo)) return Promise.resolve(false);
    this.evid.push({ ...datos });
    return Promise.resolve(true);
  }
  listarEvidencias(id: string) { return Promise.resolve(this.evid.filter((e) => e.validacionActaId === id).map((e) => EvidenciaActa.desde(e))); }

  reservar(id: string, actorId: string, ahora: Date, hasta: Date) {
    const f = this.filas.get(id);
    if (!f || f.estado !== EstadoValidacionActa.REVISION) return Promise.resolve(false);
    const libre = f.asignadoA === null || (f.reservaHasta !== null && f.reservaHasta.getTime() <= ahora.getTime()) || f.asignadoA === actorId;
    if (!libre) return Promise.resolve(false);
    this.filas.set(id, { ...f, asignadoA: actorId, reservadoEn: ahora, reservaHasta: hasta, actualizadaEn: ahora, version: f.version + 1 });
    return Promise.resolve(true);
  }
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean) {
    const f = this.filas.get(id);
    if (!f || f.asignadoA === null) return Promise.resolve(false);
    if (!(f.asignadoA === actorId || esSupervisor || (f.reservaHasta !== null && f.reservaHasta.getTime() <= ahora.getTime()))) return Promise.resolve(false);
    this.filas.set(id, { ...f, asignadoA: null, reservadoEn: null, reservaHasta: null, actualizadaEn: ahora, version: f.version + 1 });
    return Promise.resolve(true);
  }

  private vigentes() {
    return [...this.filas.values()].filter((v) => {
      const doc = this.ctx.documentos.filas.get(v.documentoId);
      if (!doc) return false;
      const maxima = Math.max(...[...this.ctx.documentos.filas.values()].filter((d) => d.practicaId === doc.practicaId && String(d.tipo) === String(TipoDocumento.ACTA_INICIO)).map((d) => d.version));
      return doc.version === maxima;
    });
  }

  listarMesa(filtro: FiltroMesaActa): Promise<FilaMesaActa[]> {
    return Promise.resolve(this.vigentes()
      .filter((v) => filtro.estados.includes(v.estado))
      .filter((v) => !filtro.escuelas || filtro.escuelas.includes(this.ctx.practicas.get(v.practicaId)?.escuelaId ?? ''))
      .sort((a, b) => (a.recibidaEn?.getTime() ?? 0) - (b.recibidaEn?.getTime() ?? 0))
      .map((v) => {
        const doc = this.ctx.documentos.filas.get(v.documentoId) as DatosDocumento;
        const p = (this.ctx.practicas.get(v.practicaId) as Practica).instantanea();
        return {
          validacionId: v.id, documentoId: v.documentoId, practicaId: v.practicaId, estudianteId: v.estudianteId,
          estudianteNombre: this.ctx.usuarios.get(v.estudianteId)?.nombre ?? '', escuelaId: p.escuelaId,
          empresaRazonSocial: p.empresaRazonSocial, modalidad: p.modalidad, fechaInicio: p.fechaInicio, version: doc.version,
          cargadoEn: doc.cargadoEn, estado: v.estado, tipoActaDetectada: v.tipoActaDetectada, remuneracionDetectada: v.remuneracionDetectada,
          responsableArlDetectado: v.responsableArlDetectado, firmaEmpresa: v.firmaEmpresa, firmaPracticante: v.firmaPracticante,
          hayDiscrepanciaCritica: v.hayDiscrepanciaCritica, veredicto: v.comparacion?.veredicto ?? null, asignadoA: v.asignadoA,
          asignadoNombre: v.asignadoA ? this.ctx.usuarios.get(v.asignadoA)?.nombre ?? null : null, reservaHasta: v.reservaHasta,
          recibidaEn: v.recibidaEn, procesadaEn: v.procesadaEn, datosPracticaCambiaronEn: v.datosPracticaCambiaronEn,
        };
      }));
  }

  supervisionMesa(ahora: Date): Promise<ResumenSupervisionActa> {
    const v = this.vigentes();
    const rev = v.filter((x) => x.estado === EstadoValidacionActa.REVISION);
    const vigente = (x: DatosValidacionActa) => x.asignadoA !== null && (x.reservaHasta?.getTime() ?? 0) > ahora.getTime();
    const porEstado: Record<string, number> = {};
    for (const x of v) porEstado[x.estado] = (porEstado[x.estado] ?? 0) + 1;
    return Promise.resolve({
      abiertas: rev.length, libres: rev.filter((x) => !vigente(x)).length, tomadas: rev.filter(vigente).length,
      porVencer: rev.filter((x) => vigente(x) && (x.reservaHasta as Date).getTime() <= ahora.getTime() + MINUTOS_RESERVA_POR_VENCER * MIN).length,
      vencidas: rev.filter((x) => x.asignadoA !== null && !vigente(x)).length, porEstado,
      conDiscrepanciaCritica: rev.filter((x) => x.hayDiscrepanciaCritica).length,
      documentoIncorrecto: rev.filter((x) => x.tipoActaDetectada === 'documento_incorrecto').length, funcionarios: [],
    });
  }
}

export interface OpcionesCasoActa {
  /** Id del caso (documento `doc-<id>`). */
  id: string;
  version?: number;
  practicaId?: string;
  /** Texto del acta (por omisión, una consistente con SIPRA). */
  acta?: OpcionesActa;
  lectura?: OpcionesLecturaSintetica;
  textoPlano?: string;
  /** Datos de la práctica que difieren de lo que dice el acta. */
  practica?: Partial<Parameters<typeof practicaDe>[0]>;
  /** No procesarlo: la validación queda como estaba (pendiente/procesando). */
  sinProcesar?: boolean;
  recibidaHace?: number;
  estadoDocumento?: EstadoDocumento;
}

/**
 * Entorno de la Mesa de Actas con repositorios en memoria y los casos de uso REALES (validación, decisión de documentos,
 * Mesa, estado del estudiante, corrección de datos de la práctica). La prueba contra PostgreSQL está en
 * `herramientas/verificar-concurrencia-pg.ts`.
 */
export function montarMesaActas() {
  const documentos = new DocumentosMemoria();
  const auditoria = new AuditoriaMemoria();
  const practicas = new Map<string, Practica>();
  const usuarios = new Map<string, ReturnType<typeof usuarioDe>>();
  const validaciones = new ValidacionesActaMemoria({ documentos, practicas, usuarios });
  const almacen = { leer: jest.fn((ruta: string) => Promise.resolve(Buffer.from(`contenido:${ruta}`))), guardar: jest.fn(), eliminar: jest.fn() };
  const repoPracticas = {
    buscarPorId: (id: string) => Promise.resolve(practicas.get(id) ?? null),
    guardar: (d: ReturnType<Practica['instantanea']>) => { const p = Practica.desde(d); practicas.set(d.id, p); return Promise.resolve(p); },
  };
  const repoUsuarios = { buscarPorId: (id: string) => Promise.resolve(usuarios.get(id) ?? null) };
  const sinu = { buscarPorDocumento: () => Promise.resolve({ programaNombre: VALORES_BASE.programa.replace('Administracion', 'Administración') }) };

  const acta = new ValidacionActaUseCase(validaciones, documentos as never, repoPracticas as never, repoUsuarios as never, { buscarPorId: () => Promise.resolve(null) } as never, auditoria as never, sinu as never);
  const gestionar = new GestionarDocumentoUseCase(
    documentos as never, repoPracticas as never, repoUsuarios as never, auditoria as never, almacen as never, { notificar: jest.fn() } as never,
    {} as never, {} as never, {} as never, { anotarDevolucion: jest.fn() } as never, {} as never, {} as never, {} as never,
    { registrarDecisionHumana: () => Promise.resolve(), exigirSinReservaAjena: () => Promise.resolve() } as never, acta,
  );
  const mesa = new MesaActasUseCase(validaciones, documentos as never, repoPracticas as never, repoUsuarios as never, { buscarPorId: () => Promise.resolve(null) } as never, auditoria as never, almacen as never, gestionar, sinu as never);
  const estudiante = new ActaEstudianteUseCase(repoPracticas as never, documentos as never, validaciones);
  const gestionarPractica = new GestionarPracticaUseCase(
    repoPracticas as never, { listarPorPractica: () => Promise.resolve([]) } as never, documentos as never, { buscarPorId: () => Promise.resolve(null) } as never,
    repoUsuarios as never, auditoria as never, { numero: () => Promise.resolve(15) } as never, acta,
  );

  const crear = async (o: OpcionesCasoActa): Promise<{ documentoId: string; validacionId: string | null }> => {
    const practicaId = o.practicaId ?? `pra-${o.id}`;
    const estudianteId = `est-${practicaId}`;
    usuarios.set(estudianteId, usuarioDe(Rol.ESTUDIANTE, { id: estudianteId, nombre: VALORES_BASE.nombre, documento: '1000000001', correo: `${estudianteId}@estudiante.cun.edu.co` }));
    if (!practicas.has(practicaId)) {
      practicas.set(practicaId, practicaDe({
        id: practicaId, estudianteId, escuelaId: ESC_A, empresaId: null, estado: EstadoPractica.DOCUMENTACION,
        modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE, empresaRazonSocial: 'Empresa Sintética SAS', empresaNit: '900123456-8',
        tipoRemuneracion: 'no_remunerada', responsableArlPractica: 'empresa', fechaInicio: dia('2026-09-01'), fechaFin: dia('2027-03-01'),
        jefeInmediatoNombre: 'Laura Jefe Ficticia', funcionesRelevantes: 'Apoyo en gestión documental y atención de solicitudes internas',
        ...(o.practica ?? {}),
      }));
    }
    const recibida = new Date(AHORA_MESA.getTime() - (o.recibidaHace ?? 0) * 86_400_000);
    const documentoId = `doc-${o.id}`;
    const texto = o.textoPlano ?? actaSintetica({ encabezadoArl: 'empresa', obligacionArl: 'empresa', valores: { inicio: '01/09/2026', fin: '01/03/2027' }, ...(o.acta ?? {}) });
    const lectura = lecturaPersistibleSintetica(texto, { firmas: { firmaEmpresaPresente: 'si', firmaPracticantePresente: 'si' }, ...(o.lectura ?? {}) });
    documentos.filas.set(documentoId, documentoDe(TipoDocumento.ACTA_INICIO, {
      id: documentoId, practicaId, version: o.version ?? 1, estado: o.estadoDocumento ?? EstadoDocumento.EN_REVISION, cargadoEn: recibida,
      rutaAlmacenamiento: `ruta/${o.id}`, nombreOriginal: `acta-${o.id}.pdf`, extraccion: o.sinProcesar ? null : ({ lecturaActa: lectura }),
    }).instantanea());
    if (o.sinProcesar) {
      await acta.marcarProcesando(documentoId, recibida);
      return { documentoId, validacionId: (await validaciones.buscarPorDocumento(documentoId))?.id ?? null };
    }
    const v = await acta.registrarProcesamiento((await documentos.buscarPorId(documentoId)) as Documento, recibida);
    return { documentoId, validacionId: v?.id ?? null };
  };

  const persona = (id: string, nombre: string, rol: Rol): void => { usuarios.set(id, usuarioDe(rol, { id, nombre, correo: `${id}@cun.edu.co` })); };
  return { mesa, acta, estudiante, gestionar, gestionarPractica, validaciones, documentos, auditoria, almacen, practicas, usuarios, crear, persona };
}

export const aux = (id = 'aux-1') => actorDe(Rol.AUXILIAR, { id, correo: `${id}@cun.edu.co` });
export const coord = (id = 'coord-1') => actorDe(Rol.COORDINADOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
export const admin = (id = 'admin-1') => actorDe(Rol.ADMINISTRADOR, { id, correo: `${id}@cun.edu.co` });
export const TEXTO_40 = 'Se verificó el documento original contra la información registrada de la práctica.'.slice(0, 40).padEnd(40, '.');
