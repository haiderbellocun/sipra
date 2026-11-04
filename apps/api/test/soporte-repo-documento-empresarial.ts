import {
  DatosEvidenciaDocumentoEmpresarial, DatosValidacionDocumentoEmpresarial, EvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
} from '../src/domain/entities/validacion-documento-empresarial.entity';
import { ValidacionDocumentoEmpresarialRepositoryPort } from '../src/domain/ports/out/validacion-documento-empresarial.port';

/** Repositorio de validaciones de documentos empresariales EN MEMORIA, con la misma semántica que el adaptador de PostgreSQL. */
export class RepoMemoria implements ValidacionDocumentoEmpresarialRepositoryPort {
  filas = new Map<string, DatosValidacionDocumentoEmpresarial>();
  evidencias: DatosEvidenciaDocumentoEmpresarial[] = [];
  documentos: { documentoId: string; practicaId: string; tipo: string; hash: string }[] = [];
  async buscarPorId(id: string) { const f = this.filas.get(id); return f ? ValidacionDocumentoEmpresarial.desde(f) : null; }
  async buscarPorDocumento(d: string) { const f = [...this.filas.values()].find((x) => x.documentoId === d); return f ? ValidacionDocumentoEmpresarial.desde(f) : null; }
  async listarPorPractica(p: string) { return [...this.filas.values()].filter((x) => x.practicaId === p).map((f) => ValidacionDocumentoEmpresarial.desde(f)); }
  async crearSiNoExiste(datos: DatosValidacionDocumentoEmpresarial) {
    const existente = await this.buscarPorDocumento(datos.documentoId);
    if (existente) return { validacion: existente, creada: false };
    this.filas.set(datos.id, datos);
    return { validacion: ValidacionDocumentoEmpresarial.desde(datos), creada: true };
  }
  async guardarSiVersion(datos: DatosValidacionDocumentoEmpresarial, v: number) {
    const actual = this.filas.get(datos.id);
    if (!actual || actual.version !== v) return false;
    this.filas.set(datos.id, { ...datos, version: v + 1 });
    return true;
  }
  async agregarEvidencia(d: DatosEvidenciaDocumentoEmpresarial) {
    if (this.evidencias.some((e) => e.validacionId === d.validacionId && e.intento === d.intento && e.tipo === d.tipo)) return false;
    this.evidencias.push(EvidenciaDocumentoEmpresarial.crear(d).instantanea());
    return true;
  }
  async listarEvidencias(v: string) { return this.evidencias.filter((e) => e.validacionId === v).map((e) => EvidenciaDocumentoEmpresarial.desde(e)); }
  async buscarDuplicados(practicaId: string, tipo: string, hash: string, excluir: string) {
    return this.documentos.filter((d) => d.practicaId === practicaId && d.tipo === tipo && d.hash === hash && d.documentoId !== excluir)
      .map((d) => ({ documentoId: d.documentoId, validacionId: '', version: 1, hashDocumento: d.hash }));
  }
}
