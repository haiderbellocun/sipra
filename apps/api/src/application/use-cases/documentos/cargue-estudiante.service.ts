import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DetalleSubsanacion, TipoEntradaBitacora } from '../../../domain/entities/bitacora.entity';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import { EstadoCargueEstudiante, PeriodoAcademico } from '../../../domain/entities/periodo.entity';
import { Practica } from '../../../domain/entities/practica.entity';
import {
  BITACORA_REPOSITORY, BitacoraRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PERIODO_REPOSITORY,
  PeriodoRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  EvaluacionCargue, PlazoBitacora, Subsanacion, decidirCargueDeTipo, evaluarCargueEstudiante, hayAlgunCarguePosible,
  mensajeCargue, subsanacionesVigentes,
} from '../../../domain/services/cargue-estudiante.domain-service';
import { CargueEstudianteDto } from '../../dtos/cargue-estudiante.dto';
import { ParametrosUseCase } from '../administracion/parametros.use-case';

const iso = (f: Date | null): string | null => (f ? f.toISOString().slice(0, 10) : null);

export interface ContextoCargue {
  evaluacion: EvaluacionCargue;
  subsanaciones: Subsanacion[];
}

/**
 * Único punto que reúne periodo, versiones documentales, plazos de la bitácora y el parámetro de
 * subsanación para el cargue del ESTUDIANTE (G2). Lo usan el cargue (para exigir) y el detalle de
 * la práctica (para proyectar). Si no puede leer el periodo, falla cerrada; si no puede leer la
 * bitácora, simplemente no hay excepciones de bitácora (nunca abre más).
 */
@Injectable()
export class CargueEstudianteService {
  private readonly log = new Logger(CargueEstudianteService.name);

  constructor(
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    private readonly parametros: ParametrosUseCase,
    @Optional() @Inject(BITACORA_REPOSITORY) private readonly bitacora?: BitacoraRepositoryPort | null,
  ) {}

  async contexto(practica: Practica, ahora: Date = new Date()): Promise<ContextoCargue> {
    const codigo = practica.instantanea().periodoAcademico;
    let periodo: PeriodoAcademico | null = null;
    try {
      periodo = codigo ? await this.periodos.buscarPorCodigo(codigo) : null;
    } catch (error) {
      this.log.error(`No se pudo leer el periodo ${codigo} de la práctica ${practica.id}: ${(error as Error).message}`);
    }
    if (!periodo) this.log.warn(`Cargue bloqueado: la práctica ${practica.id} referencia el periodo inexistente «${codigo}»`);
    const evaluacion = evaluarCargueEstudiante(periodo, ahora);
    if (evaluacion.permitido || evaluacion.estado !== EstadoCargueEstudiante.CERRADO_POR_FECHA) {
      return { evaluacion, subsanaciones: [] };
    }
    const versiones = (await this.documentos.listarPorPractica(practica.id)).map((d) => d.instantanea());
    const dias = await this.parametros.numero('documentos.dias_subsanacion');
    const subsanaciones = subsanacionesVigentes(versiones, await this.plazosBitacora(practica.id), dias, ahora);
    return { evaluacion, subsanaciones };
  }

  /** Antes de recibir el archivo: ¿hay ALGO que el estudiante pueda cargar? */
  hayAlgoQueCargar(c: ContextoCargue): boolean {
    return hayAlgunCarguePosible(c.evaluacion, c.subsanaciones);
  }

  /** Con el tipo ya conocido: ¿puede cargar ESTE documento? */
  puedeCargarTipo(c: ContextoCargue, tipo: TipoDocumento): boolean {
    return decidirCargueDeTipo(c.evaluacion, tipo, c.subsanaciones).permitido;
  }

  mensaje(c: ContextoCargue): string {
    return mensajeCargue(c.evaluacion);
  }

  proyectar(c: ContextoCargue): CargueEstudianteDto {
    return {
      permitido: c.evaluacion.permitido,
      estado: c.evaluacion.estado,
      desde: iso(c.evaluacion.desde),
      hasta: iso(c.evaluacion.hasta),
      mensaje: mensajeCargue(c.evaluacion),
      subsanaciones: c.subsanaciones.map((s) => ({ tipo: s.tipo, vence: iso(s.vence) as string, origen: s.origen })),
    };
  }

  private async plazosBitacora(practicaId: string): Promise<PlazoBitacora[]> {
    if (!this.bitacora) return [];
    try {
      return (await this.bitacora.listarPorPractica(practicaId))
        .filter((e) => e.tipo === TipoEntradaBitacora.PLAZO_SUBSANACION)
        .map((e) => e.instantanea().detalle as DetalleSubsanacion | null)
        .filter((d): d is DetalleSubsanacion => !!d?.venceEl && Array.isArray(d.documentos))
        .map((d) => ({ documentos: d.documentos, venceEl: new Date(d.venceEl) }));
    } catch (error) {
      this.log.warn(`No se pudieron leer los plazos de la bitácora de ${practicaId}: ${(error as Error).message}`);
      return [];
    }
  }
}
