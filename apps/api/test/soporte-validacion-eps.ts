import { DatosEvidenciaEps, EvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import { DecisionEps, DatosValidacionEps, ValidacionEps } from '../src/domain/entities/validacion-eps.entity';
import { ValidacionEpsRepositoryPort } from '../src/domain/ports/out/validacion-eps.port';

/**
 * Repositorio EN MEMORIA de validaciones de EPS. Las operaciones atómicas
 * (crear si no existe, versión, reserva) emulan la semántica de la sentencia SQL;
 * la prueba contra PostgreSQL vive en `herramientas/verificar-concurrencia-pg.ts`.
 */
export class ValidacionesEnMemoria implements ValidacionEpsRepositoryPort {
  filas = new Map<string, DatosValidacionEps>();
  evidencias: DatosEvidenciaEps[] = [];
  buscarPorId(id: string) {
    const d = this.filas.get(id);
    return Promise.resolve(d ? ValidacionEps.desde({ ...d }) : null);
  }
  buscarPorDocumento(documentoId: string) {
    const d = [...this.filas.values()].find((f) => f.documentoId === documentoId);
    return Promise.resolve(d ? ValidacionEps.desde({ ...d }) : null);
  }
  crearSiNoExiste(datos: DatosValidacionEps) {
    const existente = [...this.filas.values()].find((f) => f.documentoId === datos.documentoId);
    if (existente) return Promise.resolve({ validacion: ValidacionEps.desde({ ...existente }), creada: false });
    this.filas.set(datos.id, { ...datos });
    return Promise.resolve({ validacion: ValidacionEps.desde({ ...datos }), creada: true });
  }
  guardarSiVersion(datos: DatosValidacionEps, versionEsperada: number) {
    const actual = this.filas.get(datos.id);
    if (!actual || actual.version !== versionEsperada) return Promise.resolve(false);
    this.filas.set(datos.id, { ...datos, version: versionEsperada + 1 });
    return Promise.resolve(true);
  }
  reservar(id: string, actorId: string, ahora: Date, hasta: Date) {
    const f = this.filas.get(id);
    if (!f || [DecisionEps.APROBADO_MANUAL, DecisionEps.DEVUELTO, DecisionEps.RECHAZADO].includes(f.decision)) {
      return Promise.resolve(false);
    }
    const ajena = f.asignadoA && f.asignadoA !== actorId && f.reservaHasta && f.reservaHasta > ahora;
    if (ajena) return Promise.resolve(false);
    this.filas.set(id, { ...f, asignadoA: actorId, reservadoEn: ahora, reservaHasta: hasta, version: f.version + 1 });
    return Promise.resolve(true);
  }
  liberarReserva(id: string, actorId: string, ahora: Date, esSupervisor: boolean) {
    const f = this.filas.get(id);
    if (!f || !f.asignadoA) return Promise.resolve(false);
    const vencida = !f.reservaHasta || f.reservaHasta <= ahora;
    if (!(f.asignadoA === actorId || esSupervisor || vencida)) return Promise.resolve(false);
    this.filas.set(id, { ...f, asignadoA: null, reservadoEn: null, reservaHasta: null, version: f.version + 1 });
    return Promise.resolve(true);
  }
  agregarEvidencia(datos: DatosEvidenciaEps) {
    this.evidencias.push(datos);
    return Promise.resolve(EvidenciaEps.desde(datos));
  }
  buscarEvidenciaAdresPorHash(hash: string) {
    const e = this.evidencias.find((x) => String(x.tipo) === 'adres' && x.hashEvidencia === hash);
    return Promise.resolve(e ? { validacionEpsId: e.validacionEpsId } : null);
  }
  listarParaAdres(limite: number) {
    const abiertos = ['pendiente', 'en_consulta', 'evidencia_recibida', 'error', 'no_determinable'];
    return Promise.resolve([...this.filas.values()]
      .filter((f) => abiertos.includes(f.adres.estado) && ['pendiente', 'candidato_autoaprobacion'].includes(f.decision))
      .slice(0, limite).map((f) => ValidacionEps.desde({ ...f })));
  }
  listarEvidencias(id: string) {
    return Promise.resolve(this.evidencias.filter((e) => e.validacionEpsId === id).map((e) => EvidenciaEps.desde(e)));
  }
}
