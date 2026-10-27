import { DatosEvidenciaEps, EvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import { DecisionEps, DatosValidacionEps, EstadoProcesamientoEps, ValidacionEps } from '../src/domain/entities/validacion-eps.entity';
import {
  CriteriosSiguiente, FilaMesaRepo, ResumenSupervisionRepo, ValidacionEpsRepositoryPort,
} from '../src/domain/ports/out/validacion-eps.port';
import { ESTADOS_ADRES_ABIERTOS, calcularPrioridad, tieneDiscrepanciaCriticaPersistida } from '../src/domain/services/mesa-eps.domain-service';

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
  /** Datos de unión (estudiante, práctica, documento) de cada validación, para la lectura de la Mesa. */
  contexto = new Map<string, Omit<FilaMesaRepo, 'validacion' | 'responsableNombre'>>();
  nombresDeUsuarios = new Map<string, string>();

  private abierta(f: DatosValidacionEps): boolean {
    return ['pendiente', 'candidato_autoaprobacion'].includes(f.decision) && this.contexto.has(f.id);
  }

  listarAbiertasMesa(ahora: Date, escuelasAlcance: string[] | null): Promise<FilaMesaRepo[]> {
    return Promise.resolve([...this.filas.values()]
      .filter((f) => this.abierta(f) && (!escuelasAlcance?.length || escuelasAlcance.includes((this.contexto.get(f.id) as { practica: { escuelaId: string } }).practica.escuelaId)))
      .map((f) => {
        const c = this.contexto.get(f.id) as Omit<FilaMesaRepo, 'validacion' | 'responsableNombre'>;
        const vigente = f.asignadoA !== null && f.reservaHasta !== null && f.reservaHasta.getTime() > ahora.getTime();
        return { ...c, validacion: ValidacionEps.desde({ ...f }), responsableNombre: vigente ? (this.nombresDeUsuarios.get(f.asignadoA as string) ?? f.asignadoA) : null };
      }));
  }

  /** Emula la sentencia atómica: elegir y reservar sin ceder el control entre una cosa y la otra. */
  tomarSiguiente(actorId: string, ahora: Date, hasta: Date, escuelasAlcance: string[] | null, criterios: CriteriosSiguiente = {}): Promise<string | null> {
    const candidatos = [...this.filas.values()].filter((f) => {
      const c = this.contexto.get(f.id);
      if (!c || f.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO || !this.abierta(f)) return false;
      if (f.asignadoA !== null && f.reservaHasta !== null && f.reservaHasta.getTime() > ahora.getTime()) return false;
      if (escuelasAlcance?.length && !escuelasAlcance.includes(c.practica.escuelaId)) return false;
      if (criterios.periodo && c.practica.periodoAcademico !== criterios.periodo) return false;
      if (criterios.programa && c.practica.programaId !== criterios.programa) return false;
      if (criterios.modalidad && c.practica.modalidad !== criterios.modalidad) return false;
      if (criterios.estadosAdres?.length && !criterios.estadosAdres.includes(f.adres.estado)) return false;
      return true;
    });
    const puntaje = (f: DatosValidacionEps): number => {
      const c = this.contexto.get(f.id) as Omit<FilaMesaRepo, 'validacion' | 'responsableNombre'>;
      return calcularPrioridad({
        recibidaEn: f.recibidaEn ?? f.creadaEn, fechaInicioPractica: c.practica.fechaInicio, version: c.documento.version,
        discrepanciaCritica: tieneDiscrepanciaCriticaPersistida(f), adresPendiente: ESTADOS_ADRES_ABIERTOS.includes(f.adres.estado),
      }, ahora).puntaje;
    };
    candidatos.sort((a, b) => puntaje(b) - puntaje(a)
      || (a.recibidaEn ?? a.creadaEn).getTime() - (b.recibidaEn ?? b.creadaEn).getTime() || a.id.localeCompare(b.id));
    const elegido = candidatos[0];
    if (!elegido) return Promise.resolve(null);
    this.filas.set(elegido.id, {
      ...elegido, asignadoA: actorId, reservadoEn: ahora, reservaHasta: hasta, primeraRevisionEn: elegido.primeraRevisionEn ?? ahora,
      actualizadaEn: ahora, version: elegido.version + 1,
    });
    return Promise.resolve(elegido.id);
  }

  supervisionMesa(ahora: Date, escuelasAlcance: string[] | null): Promise<ResumenSupervisionRepo> {
    return this.listarAbiertasMesa(ahora, escuelasAlcance).then((filas) => {
      const porPersona = new Map<string, number>();
      for (const f of filas) if (f.responsableNombre) porPersona.set(f.validacion.asignadoA as string, (porPersona.get(f.validacion.asignadoA as string) ?? 0) + 1);
      return {
        abiertas: filas.length, sinAsignar: filas.filter((f) => !f.responsableNombre).length, horasMediasHastaPrimeraRevision: null,
        funcionarios: [...porPersona].map(([id, n]) => ({
          funcionarioId: id, nombre: this.nombresDeUsuarios.get(id) ?? id, correo: `${id}@cun.edu.co`, rol: 'auxiliar',
          reservasVigentes: n, reservasPorVencer: 0, decididas7Dias: 0, horasMediasHastaDecision: null,
        })),
      };
    });
  }

  listarEvidencias(id: string) {
    return Promise.resolve(this.evidencias.filter((e) => e.validacionEpsId === id).map((e) => EvidenciaEps.desde(e)));
  }
}
