import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { CamaraEstudianteUseCase } from '../src/application/use-cases/documentos/camara-estudiante.use-case';
import { MesaCamaraUseCase } from '../src/application/use-cases/documentos/mesa-camara.use-case';
import { ValidacionCamaraUseCase } from '../src/application/use-cases/documentos/validacion-camara.use-case';
import { Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, DatosCamaraExtraidos, EstadoAutenticidad, EstadoValidacionDocumentoEmpresarial as Estado,
} from '../src/domain/entities/documento-empresarial';
import { EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { Empresa } from '../src/domain/entities/empresa.entity';
import { ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { DecisionRutPort } from '../src/domain/ports/out/decision-rut.port';
import { FilaMesaRut, FiltroMesaRut, ResumenSupervisionRut } from '../src/domain/ports/out/validacion-documento-empresarial.port';
import { ConflictoDecisionRutError, EntradaDecisionRut, planificarDecisionRut } from '../src/domain/services/decision-rut.domain-service';
import { LecturaCamaraPersistible } from '../src/domain/services/lectura-local-camara.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import type { PuntoDecisionRut } from '../src/infrastructure/adapters/persistence/postgres/decision-rut.adapter';
import { ESC_A, actorDe, documentoDe, empresaDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { AuditoriaMemoria, DocumentosMemoria } from './soporte-mesa-actas';
import {
  CEDULA_NATURAL, DV_JURIDICA, NIT_JURIDICA, RAZON_SOCIAL, REPRESENTANTE, datosCamara, datosCamaraPn,
} from './soporte-documento-empresarial';
import { RepoMemoria } from './soporte-repo-documento-empresarial';

export const AHORA_CAMARA = new Date('2026-11-06T15:00:00.000Z');
export const MIN = 60_000;
export const HASH_CAMARA = 'a'.repeat(64);
export const TEXTO_40_CAMARA = 'Se revisó el certificado original contra los datos de la práctica.'.slice(0, 40).padEnd(40, '.');

const AUTENTICIDAD = {
  estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, qrPresente: null, qrDecodificado: null, qrDestinoOficial: null,
  firmaPdfPresente: true, firmaPdfValida: null, codigoVerificacionPresente: true, urlVerificacionPresente: true,
};

/** Lectura persistible de un certificado de Cámara (sintética). */
export const lecturaCamara = (tipo: C, datos: DatosCamaraExtraidos | null, sobre: Partial<LecturaCamaraPersistible> = {}): LecturaCamaraPersistible => ({
  hashSha256: HASH_CAMARA, tipoDetectado: tipo, motivosClasificacion: [], metodo: 'texto', confianzaDocumento: 1, lecturaDudosa: false, datos,
  autenticidad: AUTENTICIDAD, resumen: { metodo: 'texto', paginas: 1, paginasOcr: 0, confianzaOcrMedia: null, lecturaDudosa: false, limitesAplicados: [] }, motivos: [], ...sobre,
});
export const lecturaExistencia = (sobre: Partial<DatosCamaraExtraidos> = {}, otras: Partial<LecturaCamaraPersistible> = {}) =>
  lecturaCamara(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara(sobre), otras);
export const lecturaPn = (sobre: Partial<DatosCamaraExtraidos> = {}, otras: Partial<LecturaCamaraPersistible> = {}) =>
  lecturaCamara(C.CAMARA_MATRICULA_PERSONA_NATURAL, datosCamaraPn(sobre), otras);
export const lecturaDudosaOcr = (): LecturaCamaraPersistible => lecturaExistencia({}, {
  metodo: 'ocr', lecturaDudosa: true, confianzaDocumento: 0.77, resumen: { metodo: 'ocr', paginas: 1, paginasOcr: 1, confianzaOcrMedia: 77, lecturaDudosa: true, limitesAplicados: [] },
});

/** Repositorio de validaciones en memoria con la semántica de las sentencias SQL del adaptador real, para la Cámara. */
export class ValidacionesCamaraMemoria extends RepoMemoria {
  constructor(private readonly ctx: { documentos: DocumentosMemoria; practicas: Map<string, Practica>; usuarios: Map<string, ReturnType<typeof usuarioDe>> }) { super(); }

  override async versionMaximaDocumento(practicaId: string, tipo: string): Promise<number> {
    return Math.max(0, ...[...this.ctx.documentos.filas.values()].filter((d) => d.practicaId === practicaId && String(d.tipo) === tipo).map((d) => d.version));
  }

  private vigentes() {
    return [...this.filas.values()].filter((v) => {
      const doc = this.ctx.documentos.filas.get(v.documentoId);
      if (!doc || doc.tipo !== TipoDocumento.CAMARA_COMERCIO) return false;
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
        const comp = v.comparacion as { veredicto?: string; hayDiscrepancia?: boolean; discrepanciaImportante?: boolean; senales?: string[] } | null;
        return {
          validacionId: v.id, documentoId: v.documentoId, practicaId: v.practicaId, estudianteId: v.estudianteId,
          estudianteNombre: this.ctx.usuarios.get(v.estudianteId)?.nombre ?? '', escuelaId: p.escuelaId, empresaRazonSocial: p.empresaRazonSocial,
          tipoDocumento: doc.tipo, fechaInicio: p.fechaInicio, version: doc.version, cargadoEn: doc.cargadoEn, estado: v.estado,
          tipoDetectado: v.tipoDetectado, tipoPersona: v.tipoPersona, expectativa: v.expectativa, lecturaDudosa: v.lecturaDudosa,
          veredicto: comp?.veredicto ?? null, hayDiscrepancia: comp?.hayDiscrepancia === true, asignadoA: v.asignadoA,
          asignadoNombre: v.asignadoA ? this.ctx.usuarios.get(v.asignadoA)?.nombre ?? null : null, reservaHasta: v.reservaHasta,
          recibidaEn: v.recibidaEn, procesadaEn: v.procesadaEn, datosSipraCambiaronEn: v.datosSipraCambiaronEn, estadoDocumento: doc.estado,
          modalidad: p.modalidad, metodoLectura: v.metodoLectura, discrepanciaImportante: comp?.discrepanciaImportante === true,
          estadoCancelado: comp?.senales?.includes('estado_registral_cancelado') === true,
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
      porVencer: rev.filter((x) => vigente(x) && (x.reservaHasta as Date).getTime() <= ahora.getTime() + 3 * MIN).length,
      vencidas: rev.filter((x) => x.asignadoA !== null && !vigente(x)).length,
      conDiscrepancia: rev.filter((x) => (x.comparacion as { hayDiscrepancia?: boolean } | null)?.hayDiscrepancia === true).length,
      documentoIncorrecto: rev.filter((x) => x.tipoDetectado === C.DOCUMENTO_INCORRECTO).length,
      lecturaDudosa: rev.filter((x) => x.lecturaDudosa).length, personaDistinta: rev.filter((x) => x.expectativa === 'persona_distinta').length, porEstado, funcionarios: [],
    };
  }
}

/**
 * Doble en memoria de la decisión transaccional: misma lógica pura (`planificarDecisionRut`, ahora genérica para documentos
 * empresariales), con un mutex que emula el bloqueo de filas, la comprobación de tipos permitidos del adaptador y ROLLBACK real.
 */
export class DecisionCamaraMemoria implements DecisionRutPort {
  alPunto?: (punto: PuntoDecisionRut) => void;
  private cola: Promise<unknown> = Promise.resolve();
  constructor(private readonly s: { documentos: DocumentosMemoria; validaciones: ValidacionesCamaraMemoria; auditoria: AuditoriaMemoria }) {}

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
      if (!dDatos || !(entrada.tiposPermitidos ?? []).includes(dDatos.tipo)) throw new ConflictoDecisionRutError('no_encontrada');
      const maxima = await validaciones.versionMaximaDocumento(dDatos.practicaId, dDatos.tipo);
      const plan = planificarDecisionRut({ validacion: ValidacionDocumentoEmpresarial.desde(v), documento: Documento.desde(dDatos), versionMaximaRut: maxima }, entrada);
      await Promise.resolve();
      if (documentos.filas.get(dDatos.id)?.estado !== plan.estadoDocumentoLeido) throw new ConflictoDecisionRutError('documento_cambio');
      documentos.filas.set(dDatos.id, plan.documento.instantanea());
      this.alPunto?.('tras_documento');
      if (validaciones.filas.get(validacionId)?.version !== plan.versionValidacionLeida) throw new ConflictoDecisionRutError('no_revisable', entrada.nombreDocumento);
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

export interface OpcionesCasoCamara {
  /** Id del caso (documento `doc-<id>`). */
  id: string;
  version?: number;
  practicaId?: string;
  /** Lectura persistible (por omisión, una existencia y representación consistente con SIPRA). */
  lectura?: LecturaCamaraPersistible;
  /** Lo que SIPRA dice de la empresa de la práctica. */
  sipra?: { nitNumero?: string; nitDv?: number; razonSocial?: string; representanteLegal?: string | null };
  recibidaHace?: number;
  /** No procesarlo: la validación queda «procesando». */
  sinProcesar?: boolean;
  estadoDocumento?: EstadoDocumento;
  escuelaId?: string;
}

/**
 * Entorno de la Mesa de Cámara con repositorios en memoria y los casos de uso REALES (validación, decisión de documentos, Mesa, estado
 * del estudiante). La prueba contra PostgreSQL está en `herramientas/verificar-decision-camara-pg.ts`.
 */
export function montarMesaCamara() {
  const documentos = new DocumentosMemoria();
  const auditoria = new AuditoriaMemoria();
  const practicas = new Map<string, Practica>();
  const usuarios = new Map<string, ReturnType<typeof usuarioDe>>();
  const empresas = new Map<string, Empresa>();
  const validaciones = new ValidacionesCamaraMemoria({ documentos, practicas, usuarios });
  const almacen = { leer: jest.fn((ruta: string) => Promise.resolve(Buffer.from(`contenido:${ruta}`))), guardar: jest.fn(), eliminar: jest.fn() };
  const notificar = jest.fn();
  const anotarDevolucion = jest.fn();
  const repoPracticas = { buscarPorId: (id: string) => Promise.resolve(practicas.get(id) ?? null) };
  const repoUsuarios = { buscarPorId: (id: string) => Promise.resolve(usuarios.get(id) ?? null) };
  const repoEmpresas = { buscarPorId: (id: string) => Promise.resolve(empresas.get(id) ?? null) };
  const lectorSinRelectura = { leer: jest.fn(() => Promise.reject(new Error('no debería releer el archivo'))) };

  const camara = new ValidacionCamaraUseCase(validaciones, documentos as never, repoPracticas as never, almacen as never, lectorSinRelectura, repoEmpresas as never);
  const decision = new DecisionCamaraMemoria({ documentos, validaciones, auditoria });
  const gestionar = new GestionarDocumentoUseCase(
    documentos as never, repoPracticas as never, repoUsuarios as never, auditoria as never, almacen as never, { notificar } as never,
    {} as never, {} as never, {} as never, { anotarDevolucion } as never, {} as never, {} as never, {} as never,
    { registrarDecisionHumana: () => Promise.resolve(), exigirSinReservaAjena: () => Promise.resolve() } as never, undefined, undefined, decision,
  );
  const mesa = new MesaCamaraUseCase(validaciones, documentos as never, repoPracticas as never, repoUsuarios as never, repoEmpresas as never, auditoria as never, almacen as never, gestionar, camara);
  const estudiante = new CamaraEstudianteUseCase(repoPracticas as never, documentos as never, validaciones);

  const crear = async (o: OpcionesCasoCamara): Promise<{ documentoId: string; validacionId: string | null; practicaId: string; estudianteId: string }> => {
    const practicaId = o.practicaId ?? `pra-${o.id}`;
    const estudianteId = `est-${practicaId}`;
    usuarios.set(estudianteId, usuarioDe(Rol.ESTUDIANTE, { id: estudianteId, nombre: 'MARIA CAMILA PEREZ GOMEZ', documento: CEDULA_NATURAL, correo: `${estudianteId}@estudiante.cun.edu.co` }));
    const empresaId = `emp-${practicaId}`;
    empresas.set(empresaId, empresaDe(empresaId, {
      nitNumero: o.sipra?.nitNumero ?? NIT_JURIDICA, nitDv: o.sipra?.nitDv ?? Number(DV_JURIDICA), razonSocial: o.sipra?.razonSocial ?? RAZON_SOCIAL,
      representanteLegal: o.sipra && 'representanteLegal' in o.sipra ? o.sipra.representanteLegal ?? null : REPRESENTANTE,
    }));
    if (!practicas.has(practicaId)) {
      practicas.set(practicaId, practicaDe({
        id: practicaId, estudianteId, escuelaId: o.escuelaId ?? ESC_A, empresaId, estado: EstadoPractica.DOCUMENTACION, tutorId: 'tutor-1',
        empresaRazonSocial: null, empresaNit: null,
      }));
    }
    const recibida = new Date(AHORA_CAMARA.getTime() - (o.recibidaHace ?? 0) * 86_400_000);
    const documentoId = `doc-${o.id}`;
    const lectura = o.lectura ?? lecturaExistencia();
    documentos.filas.set(documentoId, documentoDe(TipoDocumento.CAMARA_COMERCIO, {
      id: documentoId, practicaId, version: o.version ?? 1, estado: o.estadoDocumento ?? EstadoDocumento.EN_REVISION, cargadoEn: recibida,
      hashSha256: HASH_CAMARA, rutaAlmacenamiento: `ruta/${o.id}`, nombreOriginal: `camara-${o.id}.pdf`, extraccion: o.sinProcesar ? null : { lecturaCamara: lectura },
    }).instantanea());
    if (o.sinProcesar) {
      await camara.marcarProcesando(documentoId, recibida);
      return { documentoId, validacionId: (await validaciones.buscarPorDocumento(documentoId))?.id ?? null, practicaId, estudianteId };
    }
    const v = await camara.registrarProcesamiento((await documentos.buscarPorId(documentoId)) as Documento, recibida);
    return { documentoId, validacionId: v?.id ?? null, practicaId, estudianteId };
  };

  const persona = (id: string, nombre: string, rol: Rol): void => { usuarios.set(id, usuarioDe(rol, { id, nombre, correo: `${id}@cun.edu.co` })); };
  /** Cambia lo que SIPRA dice de la empresa de la práctica (lo que luego detecta el recálculo / el aviso). */
  const cambiarSipra = (practicaId: string, cambios: { razonSocial?: string; representanteLegal?: string | null; nitNumero?: string }): void => {
    const p = practicas.get(practicaId)!;
    const id = p.instantanea().empresaId as string;
    empresas.set(id, empresaDe(id, { ...empresas.get(id)!.instantanea(), ...cambios }));
  };
  return { mesa, camara, decision, estudiante, gestionar, validaciones, documentos, auditoria, almacen, practicas, usuarios, empresas, crear, persona, cambiarSipra, notificar, anotarDevolucion };
}

export const tutorCamara = (id = 'tutor-1') => actorDe(Rol.TUTOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
export const coordCamara = (id = 'coord-1') => actorDe(Rol.COORDINADOR, { id, correo: `${id}@cun.edu.co`, escuelas: [ESC_A] });
export const adminCamara = (id = 'admin-1') => actorDe(Rol.ADMINISTRADOR, { id, correo: `${id}@cun.edu.co` });
