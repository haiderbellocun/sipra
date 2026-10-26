import { Inject, Injectable, Logger } from '@nestjs/common';
import { EstadoObligacion, Obligacion } from '../../../domain/entities/obligacion.entity';
import { EstadoPractica } from '../../../domain/entities/practica.entity';
import {
  OBLIGACION_REPOSITORY, ObligacionRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ObligacionesDomainService } from '../../../domain/services/obligaciones.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

export interface FilaTablero {
  practicaId: string;
  estudianteId: string;
  escuelaId: string;
  obligacionId: string;
  tipo: string;
  norma: string;
  responsable: string;
  efecto: string;
  estado: EstadoObligacion;
  fechaLimite: string;
  diasRestantes: number;
  semaforo: 'cumplida' | 'vencida' | 'critica' | 'alerta' | 'vigente';
}

export interface TableroCumplimiento {
  resumen: Record<'cumplida' | 'vencida' | 'critica' | 'alerta' | 'vigente', number>;
  filas: FilaTablero[];
  practicasBloqueadas: number;
}

/** M5 — Tablero de obligaciones próximas a vencer y evidencia de cumplimiento. */
@Injectable()
export class TableroCumplimientoUseCase {
  private readonly log = new Logger(TableroCumplimientoUseCase.name);
  private readonly dominio = new ObligacionesDomainService();

  constructor(
    @Inject(OBLIGACION_REPOSITORY) private readonly obligaciones: ObligacionRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
  ) {}

  async construir(actor: Actor, diasHorizonte = 60): Promise<TableroCumplimiento> {
    const ahora = new Date();
    const escuelas =
      [Rol.ADMINISTRADOR, Rol.EXTENSION].includes(actor.rol) ? undefined : actor.escuelas;

    const practicas = await this.practicas.listar({
      escuelaIds: escuelas,
      ...(actor.rol === Rol.TUTOR ? { escuelaIds: actor.escuelas } : {}),
    });
    const indice = new Map(practicas.map((p) => [p.id, p]));

    const horizonte = new Date(ahora);
    horizonte.setUTCDate(horizonte.getUTCDate() + diasHorizonte);
    const pendientes = await this.obligaciones.listarPendientes(horizonte);

    const filas: FilaTablero[] = [];
    const propias: Obligacion[] = [];

    for (const obligacion of pendientes) {
      const datos = obligacion.instantanea();
      const practica = indice.get(datos.practicaId);
      if (!practica) continue; // fuera del alcance del actor
      propias.push(obligacion);
      filas.push({
        practicaId: datos.practicaId,
        estudianteId: practica.estudianteId,
        escuelaId: practica.escuelaId,
        obligacionId: datos.id,
        tipo: datos.tipo,
        norma: obligacion.catalogo.norma,
        responsable: obligacion.catalogo.responsable,
        efecto: obligacion.catalogo.efecto,
        estado: datos.estado,
        fechaLimite: datos.fechaLimite.toISOString(),
        diasRestantes: obligacion.diasRestantes(ahora),
        semaforo: obligacion.semaforo(ahora),
      });
    }

    filas.sort((a, b) => a.diasRestantes - b.diasRestantes);

    const bloqueadas = new Set(
      filas
        .filter((f) => f.efecto === 'bloquea_activa' && f.estado !== EstadoObligacion.CUMPLIDA)
        .map((f) => f.practicaId),
    );

    return {
      resumen: this.dominio.resumenTablero(propias, ahora),
      filas,
      practicasBloqueadas: [...bloqueadas].filter((id) => {
        const practica = indice.get(id);
        return practica?.estado === EstadoPractica.EN_VALIDACION;
      }).length,
    };
  }

  /** Barrido programado (Cloud Scheduler → Cloud Run Job). */
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
