import { randomUUID } from 'node:crypto';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { MesaRutUseCase } from '../src/application/use-cases/documentos/mesa-rut.use-case';
import { RutEstudianteUseCase } from '../src/application/use-cases/documentos/rut-estudiante.use-case';
import { ValidacionRutUseCase } from '../src/application/use-cases/documentos/validacion-rut.use-case';
import { Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona, autenticidadPorDefecto,
} from '../src/domain/entities/documento-empresarial';
import { Empresa } from '../src/domain/entities/empresa.entity';
import { EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { DecisionRutPort } from '../src/domain/ports/out/decision-rut.port';
import { FilaMesaRut, FiltroMesaRut, ResumenSupervisionRut } from '../src/domain/ports/out/validacion-documento-empresarial.port';
import { ConflictoDecisionRutError, EntradaDecisionRut, planificarDecisionRut } from '../src/domain/services/decision-rut.domain-service';
import { LecturaRutPersistible } from '../src/domain/services/lectura-local-rut.domain-service';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { Rol } from '../src/domain/value-objects/rol.vo';
import type { PuntoDecisionRut } from '../src/infrastructure/adapters/persistence/postgres/decision-rut.adapter';
import { ESC_A, actorDe, documentoDe, empresaDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { RepoMemoria } from './soporte-repo-documento-empresarial';
import { AuditoriaMemoria, DocumentosMemoria } from './soporte-mesa-actas';

export const AHORA_RUT = new Date('2026-11-04T15:00:00.000Z');
export const MIN_RUT = 60_000;
export const HASH_RUT = 'a'.repeat(64);
export const CEDULA = '1000000001';
export const NIT_EMPRESA = '900123456';
export const dvDe = (n: string): number => Nit.calcularDigitoVerificacion(n);

/** Lectura persistible de un RUT de persona natural (sintética). */
export const lecturaPn = (sobre: Partial<LecturaRutPersistible> = {}): LecturaRutPersistible => ({
  hashSha256: HASH_RUT, tipoDetectado: C.RUT_PERSONA_NATURAL, motivosClasificacion: ['rut_tipo_contribuyente'], metodo: 'texto', confianzaDocumento: 1, lecturaDudosa: false,
  datos: {
    tipoPersona: TipoPersona.NATURAL, nit: CEDULA, dv: String(dvDe(CEDULA)), fechaGeneracion: '2024-03-15', tipoDocumento: 'CC', numeroDocumento: CEDULA,
    nombres: 'MARIA CAMILA', apellidos: 'PEREZ GOMEZ', ciiuPrincipal: '4711', divipolaMunicipio: '11001', controlNit: 'confiable',
    confianzaCampos: { nit: 1, dv: 1, nombre: 1, fechaGeneracion: 1, divipola: 1, tipoPersona: 1 },
  },
  autenticidad: autenticidadPorDefecto(), resumen: { metodo: 'texto', paginas: 1, paginasOcr: 0, confianzaOcrMedia: null, lecturaDudosa: false }, motivos: [], ...sobre,
});

/** Lectura persistible de un RUT de persona jurídica (sintética). */
export const lecturaPj = (sobre: Partial<LecturaRutPersistible> = {}, razonSocial = 'EMPRESA SINTETICA SAS'): LecturaRutPersistible => lecturaPn({
  tipoDetectado: C.RUT_PERSONA_JURIDICA,
  datos: { tipoPersona: TipoPersona.JURIDICA, nit: NIT_EMPRESA, dv: String(dvDe(NIT_EMPRESA)), fechaGeneracion: '2024-03-15', razonSocial, controlNit: 'confiable' },
  ...sobre,
});

/** Repositorio de validaciones en memoria con la semántica de las sentencias SQL del adaptador real (bandeja, supervisión, versión). */
export class ValidacionesRutMemoria extends RepoMemoria {
  constructor(private readonly ctx: { documentos: DocumentosMemoria; practicas: Map<string, Practica>; usuarios: Map<string, ReturnType<typeof usuarioDe>> }) { super(); }

  override async versionMaximaDocumento(practicaId: string, tipo: string): Promise<number> {
    return Math.max(0, ...[...this.ctx.documentos.filas.values()].filter((d) => d.practicaId === practicaId && String(d.tipo) === tipo).map((d) => d.version));
  }

  private vigentes() {
    return [...this.filas.values()].filter((v) => {
      const doc = this.ctx.documentos.filas.get(v.documentoId);
      if (!doc || ![TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO].includes(doc.tipo)) return false;
      const maxima = Math.max(...[...this.ctx.documentos.filas.values()].filter((d) => d.practicaId === doc.practicaId && d.tipo === doc.tipo).map((d) => d.version));
      return doc.version === maxima;
    });
  }

  override async listarMesaRut(filtro: FiltroMesaRut): Promise<FilaMesaRut[]> {
    return this.vigentes()
      .filter((v) => filtro.estados.includes(v.estado))
      .filter((v) => !filtro.escuelas || filtro.escuelas.includes(this.ctx.practicas.get(v.practicaId)?.escuelaId ?? ''))
      .sort((a, b) => (a.recibidaEn?.getTime() ?? 0) - (b.recibidaEn?.getTime() ?? 0))
      .map((v) => {
        const doc = this.ctx.documentos.filas.get(v.documentoId)!;
        const p = this.ctx.practicas.get(v.practicaId)!.instantanea();
        const comp = v.comparacion as { veredicto?: string; hayDiscrepancia?: boolean } | null;
        return {
          validacionId: v.id, documentoId: v.documentoId, practicaId: v.practicaId, estudianteId: v.estudianteId,
          estudianteNombre: this.ctx.usuarios.get(v.estudianteId)?.nombre ?? '', escuelaId: p.escuelaId, empresaRazonSocial: p.empresaRazonSocial,
          tipoDocumento: doc.tipo, fechaInicio: p.fechaInicio, version: doc.version, cargadoEn: doc.cargadoEn, estado: v.estado,
          tipoDetectado: v.tipoDetectado, tipoPersona: v.tipoPersona, expectativa: v.expectativa, lecturaDudosa: v.lecturaDudosa,
          veredicto: comp?.veredicto ?? null, hayDiscrepancia: comp?.hayDiscrepancia === true, asignadoA: v.asignadoA,
          asignadoNombre: v.asignadoA ? this.ctx.usuarios.get(v.asignadoA)?.nombre ?? null : null, reservaHasta: v.reservaHasta,
          recibidaEn: v.recibidaEn, procesadaEn: v.procesadaEn, datosSipraCambiaronEn: v.datosSipraCambiaronEn, estadoDocumento: doc.estado,
        };
      });
  }

  override async supervisionRut(ahora: Date): Promise<ResumenSupervisionRut> {
    const v = this.vigentes();
    const rev = v.filter((x) => x.estado === Estado.REVISION);
    const vigente = (x: { asignadoA: string | null; reservaHasta: Date | null }) => x.asignadoA !== null && (x.reservaHasta?.getTime() ?? 0) > ahora.getTime();
    const porEstado: Record<string, number> = {};
    for (const x of v) porEstado[x.estado] = (porEstado[x.estado] ?? 0) + 1;
    return {
      abiertas: rev.length, libres: rev.filter((x) => !vigente(x)).length, tomadas: rev.filter(vigente).length,
      porVencer: rev.filter((x) => vigente(x) && (x.reservaHasta as Date).getTime() <= ahora.getTime() + 3 * MIN_RUT).length,
      vencidas: rev.filter((x) => x.asignadoA !== null && !vigente(x)).length,
      conDiscrepancia: rev.filter((x) => (x.comparacion as { hayDiscrepancia?: boolean } | null)?.hayDiscrepancia === true).length,
      documentoIncorrecto: rev.filter((x) => x.tipoDetectado === C.DOCUMENTO_INCORRECTO).length, porEstado, funcionarios: [],
    };
  }
}

/**
 * Doble en memoria de la decisión transaccional: misma lógica pura (`planificarDecisionRut`), con un mutex que emula el bloqueo de
 * filas y con ROLLBACK real. `alPunto` fuerza fallos intermedios, igual que el adaptador de PostgreSQL.
 */
export class DecisionRutMemoria implements DecisionRutPort {
  alPunto?: (punto: PuntoDecisionRut) => void;
  private cola: Promise<unknown> = Promise.resolve();
  constructor(private readonly s: { documentos: DocumentosMemoria; validaciones: ValidacionesRutMemoria; auditoria: AuditoriaMemoria }) {}

  aplicar(validacionId: string, entrada: EntradaDecisionRut): Promise<Documento> {
    const turno = this.cola.then(() => this.transaccion(validacionId, entrada));
    this.cola = turno.catch(() => undefined);
    return turno;
  }

  private async transaccion(validacionId: string, entrada: EntradaDecisionRut): Promise<Documento> {
    const { documentos, validaciones, auditoria } = this.s;
    const foto = { d: new Map(documentos.filas), v: new Map(validaciones.filas), e: [...validaciones.evidencias], a: [...auditoria.registros] };
    try {
      const v = validaciones.filas.get(validacionId);
      if (!v) throw new ConflictoDecisionRutError('no_encontrada');
      const dDatos = documentos.filas.get(v.documentoId);
      if (!dDatos) throw new ConflictoDecisionRutError('no_encontrada');
      const maxima = await validaciones.versionMaximaDocumento(dDatos.practicaId, dDatos.tipo);
      const plan = planificarDecisionRut({ validacion: ValidacionDocumentoEmpresarial.desde(v), documento: Documento.desde(dDatos), versionMaximaRut: maxima }, entrada);
      await Promise.resolve();
      if (documentos.filas.get(dDatos.id)?.estado !== plan.estadoDocumentoLeido) throw new ConflictoDecisionRutError('documento_cambio');
      documentos.filas.set(dDatos.id, plan.documento.instantanea());
      this.alPunto?.('tras_documento');
      if (validaciones.filas.get(validacionId)?.version !== plan.versionValidacionLeida) throw new ConflictoDecisionRutError('no_revisable');
      validaciones.filas.set(validacionId, { ...plan.validacion.instantanea(), version: plan.versionValidacionLeida + 1 });
      this.alPunto?.('tras_validacion');
      validaciones.evidencias.push({ ...plan.evidencia });
      this.alPunto?.('tras_evidencia');
      auditoria.registros.push(plan.auditorias[0]);
      this.alPunto?.('tras_auditoria_documento');
      auditoria.registros.push(plan.auditorias[1]);
      return plan.documento;
    } catch (error) {
      documentos.filas = foto.d; validaciones.filas = foto.v; validaciones.evidencias = foto.e; auditoria.registros = foto.a;
      throw error;
    }
  }
}

export interface OpcionesCasoRut {
  /** Id del caso (documento `doc-<id>`). */
  id: string;
  persona?: 'natural' | 'juridica';
  version?: number;
  practicaId?: string;
  /** Lectura persistible (por omisión, una consistente con SIPRA). */
  lectura?: LecturaRutPersistible;
  /** Lo que SIPRA dice del estudiante y de la empresa de la práctica. */
  sipra?: { documento?: string; nombre?: string; empresa?: { nitNumero: string; nitDv: number; razonSocial: string } | null };
  /** Un RUT que se cargó con el tipo documental contrario al que contiene (p. ej. PJ cargado como natural). */
  tipoDocumento?: TipoDocumento;
  recibidaHace?: number;
  /** No procesarlo: la validación queda «procesando». */
  sinProcesar?: boolean;
  estadoDocumento?: EstadoDocumento;
}

/**
 * Entorno de la Mesa de RUT con repositorios en memoria y los casos de uso REALES (validación, decisión de documentos, Mesa,
 * estado del estudiante). La prueba contra PostgreSQL está en `herramientas/verificar-decision-rut-pg.ts`.
 */
export function montarMesaRut() {
  const documentos = new DocumentosMemoria();
  const auditoria = new AuditoriaMemoria();
  const practicas = new Map<string, Practica>();
  const usuarios = new Map<string, ReturnType<typeof usuarioDe>>();
  const empresas = new Map<string, Empresa>();
  const validaciones = new ValidacionesRutMemoria({ documentos, practicas, usuarios });
  const almacen = { leer: jest.fn((ruta: string) => Promise.resolve(Buffer.from(`contenido:${ruta}`))), guardar: jest.fn(), eliminar: jest.fn() };
  const notificar = jest.fn();
  const anotarDevolucion = jest.fn();
  const repoPracticas = { buscarPorId: (id: string) => Promise.resolve(practicas.get(id) ?? null) };
  const repoUsuarios = { buscarPorId: (id: string) => Promise.resolve(usuarios.get(id) ?? null) };
  const repoEmpresas = { buscarPorId: (id: string) => Promise.resolve(empresas.get(id) ?? null) };
  const lectorSinRelectura = { leer: jest.fn(() => Promise.reject(new Error('no debería releer el archivo'))) };

  const rut = new ValidacionRutUseCase(validaciones, documentos as never, repoPracticas as never, almacen as never, lectorSinRelectura, repoUsuarios as never, repoEmpresas as never);
  const decision = new DecisionRutMemoria({ documentos, validaciones, auditoria });
  const gestionar = new GestionarDocumentoUseCase(
    documentos as never, repoPracticas as never, repoUsuarios as never, auditoria as never, almacen as never, { notificar } as never,
    {} as never, {} as never, {} as never, { anotarDevolucion } as never, {} as never, {} as never, {} as never,
    { registrarDecisionHumana: () => Promise.resolve(), exigirSinReservaAjena: () => Promise.resolve() } as never, undefined, undefined, decision,
  );
  const mesa = new MesaRutUseCase(validaciones, documentos as never, repoPracticas as never, repoUsuarios as never, repoEmpresas as never, auditoria as never, almacen as never, gestionar, rut);
  const estudiante = new RutEstudianteUseCase(repoPracticas as never, documentos as never, validaciones);

  const crear = async (o: OpcionesCasoRut): Promise<{ documentoId: string; validacionId: string | null; practicaId: string; estudianteId: string }> => {
    const persona = o.persona ?? 'natural';
    const practicaId = o.practicaId ?? `pra-${o.id}`;
    const estudianteId = `est-${practicaId}`;
    const sipraEmpresa = o.sipra?.empresa === undefined
      ? (persona === 'juridica' ? { nitNumero: NIT_EMPRESA, nitDv: dvDe(NIT_EMPRESA), razonSocial: 'EMPRESA SINTETICA SAS' } : null)
      : o.sipra.empresa;
    usuarios.set(estudianteId, usuarioDe(Rol.ESTUDIANTE, {
      id: estudianteId, nombre: o.sipra?.nombre ?? 'MARIA CAMILA PEREZ GOMEZ', documento: o.sipra?.documento ?? CEDULA, correo: `${estudianteId}@estudiante.cun.edu.co`,
    }));
    const empresaId = sipraEmpresa ? `emp-${practicaId}` : null;
    if (empresaId && sipraEmpresa) empresas.set(empresaId, empresaDe(empresaId, { nitNumero: sipraEmpresa.nitNumero, nitDv: sipraEmpresa.nitDv, razonSocial: sipraEmpresa.razonSocial }));
    if (!practicas.has(practicaId)) {
      practicas.set(practicaId, practicaDe({
        id: practicaId, estudianteId, escuelaId: ESC_A, empresaId, estado: EstadoPractica.DOCUMENTACION, tutorId: 'tutor-1',
        empresaRazonSocial: null, empresaNit: null,
      }));
    }
    const recibida = new Date(AHORA_RUT.getTime() - (o.recibidaHace ?? 0) * 86_400_000);
    const documentoId = `doc-${o.id}`;
    const tipo = o.tipoDocumento ?? (persona === 'natural' ? TipoDocumento.RUT_NATURAL : TipoDocumento.RUT_JURIDICO);
    const lectura = o.lectura ?? (persona === 'natural' ? lecturaPn() : lecturaPj());
    documentos.filas.set(documentoId, documentoDe(tipo, {
      id: documentoId, practicaId, version: o.version ?? 1, estado: o.estadoDocumento ?? EstadoDocumento.EN_REVISION, cargadoEn: recibida,
      hashSha256: HASH_RUT, rutaAlmacenamiento: `ruta/${o.id}`, nombreOriginal: `rut-${o.id}.pdf`, extraccion: o.sinProcesar ? null : { lecturaRut: lectura },
    }).instantanea());
    if (o.sinProcesar) {
      await rut.marcarProcesando(documentoId, recibida);
      return { documentoId, validacionId: (await validaciones.buscarPorDocumento(documentoId))?.id ?? null, practicaId, estudianteId };
    }
    const v = await rut.registrarProcesamiento((await documentos.buscarPorId(documentoId)) as Documento, recibida);
    return { documentoId, validacionId: v?.id ?? null, practicaId, estudianteId };
  };

  const persona = (id: string, nombre: string, rol: Rol): void => { usuarios.set(id, usuarioDe(rol, { id, nombre, correo: `${id}@cun.edu.co` })); };
  /** Cambia lo que SIPRA dice del estudiante (lo que luego detecta el recálculo / el aviso). */
  const cambiarSipra = (practicaId: string, cambios: { documento?: string; nombre?: string }): void => {
    const p = practicas.get(practicaId)!;
    const u = usuarios.get(p.estudianteId)!;
    usuarios.set(p.estudianteId, usuarioDe(Rol.ESTUDIANTE, { ...u.instantanea(), ...cambios }));
  };
  return { mesa, rut, decision, estudiante, gestionar, validaciones, documentos, auditoria, almacen, practicas, usuarios, empresas, crear, persona, cambiarSipra, notificar, anotarDevolucion, nuevoId: randomUUID };
}

export const tutor = (id = 'tutor-1') => actorDe(Rol.TUTOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
export const coordRut = (id = 'coord-1') => actorDe(Rol.COORDINADOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
export const adminRut = (id = 'admin-1') => actorDe(Rol.ADMINISTRADOR, { id, correo: `${id}@cun.edu.co` });
export const TEXTO_40_RUT = 'Se verificó el RUT original contra los datos registrados de la práctica.'.slice(0, 40).padEnd(40, '.');
