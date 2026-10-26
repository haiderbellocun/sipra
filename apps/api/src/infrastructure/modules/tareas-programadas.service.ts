import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  TableroCumplimientoUseCase,
} from '../../application/use-cases/obligaciones/tablero-cumplimiento.use-case';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, VACANTE_REPOSITORY, VacanteRepositoryPort,
} from '../../domain/ports/out/repositorios.port';
import {
  ALMACENAMIENTO, AlmacenamientoPort, COLA, ColaPort,
} from '../../domain/ports/out/servicios-externos.port';
import {
  VIGENCIA_RECLAMO_PIPELINE_MS,
} from '../../application/use-cases/documentos/pipeline-validacion.use-case';
import { SolicitudArlUseCase } from '../../application/use-cases/practicas/solicitud-arl.use-case';
import { VistasSinuUseCase } from '../../application/use-cases/administracion/vistas-sinu.use-case';

/**
 * Procesos por lote. En Google Cloud estos mismos métodos se exponen como
 * Cloud Run Jobs disparados por Cloud Scheduler (ver infra/gcp/README.md);
 * el planificador interno cubre el ambiente local y de pruebas.
 */
@Injectable()
export class TareasProgramadasService {
  private readonly log = new Logger(TareasProgramadasService.name);

  constructor(
    private readonly tablero: TableroCumplimientoUseCase,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(VACANTE_REPOSITORY) private readonly vacantes: VacanteRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly solicitudesArl: SolicitudArlUseCase,
    private readonly vistasSinu: VistasSinuUseCase,
    @Inject(COLA) private readonly cola: ColaPort,
  ) {}

  /**
   * Recuperación controlada: un documento `analizando` más tiempo del que dura una
   * ejecución legítima quedó interrumpido (se cayó una instancia). Se vuelve a
   * encolar; el reclamo atómico del pipeline garantiza que, aunque varias
   * instancias lo hagan a la vez, el documento se procese una sola vez.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'recuperar-procesamientos' })
  async recuperarProcesamientosInterrumpidos(): Promise<void> {
    const caducados = await this.documentos.listarProcesamientoCaducado(
      new Date(Date.now() - VIGENCIA_RECLAMO_PIPELINE_MS), 100,
    );
    for (const documento of caducados) {
      await this.cola.encolar({ tipo: 'validar_documento', referencia: documento.id, prioridad: 'lote' });
    }
    if (caducados.length > 0) this.log.warn(`Procesamientos interrumpidos re-encolados: ${caducados.length}`);
  }

  /**
   * Sincronizador prácticas–docente: mantiene la correspondencia SINU → SGP
   * mientras el periodo tenga la sincronización habilitada.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'sincronizacion-docentes' })
  async sincronizarDocentes(): Promise<void> {
    const resultados = await this.vistasSinu.sincronizarPeriodosActivos();
    for (const r of resultados) {
      this.log.log(`Docentes ${r.periodoAcademico}: ${r.asignadas} asignada(s), ${r.sinDocenteEnSinu.length} sin docente en SINU`);
    }
  }

  /**
   * Consolidado diario de solicitudes de ARL (§9.7.1 del manual del portal):
   * las aprobadas del día anterior van a coordinación para Capital Social.
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { name: 'consolidado-arl' })
  async consolidadoArl(): Promise<void> {
    const ayer = new Date(Date.now() - 86_400_000);
    const enviados = await this.solicitudesArl.enviarConsolidadoDiario(ayer);
    this.log.log(`Consolidado ARL de ${ayer.toISOString().slice(0, 10)} enviado a ${enviados} destinatario(s)`);
  }

  /** Motor de obligaciones: marca vencidas las que pasaron su fecha límite. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'obligaciones-vencidas' })
  async evaluarObligaciones(): Promise<void> {
    const vencidas = await this.tablero.evaluarVencimientos();
    this.log.log(`Barrido de obligaciones: ${vencidas} vencida(s)`);
  }

  /**
   * Minimización de datos: la medida de protección más eficaz es no conservar
   * el dato. Las imágenes de documentos de identidad se purgan a los 30 días
   * de validadas, conservando el hash y el resultado de la validación.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'purga-retencion' })
  async purgarPorRetencion(): Promise<void> {
    const pendientes = await this.documentos.listarParaPurga(new Date());
    let purgados = 0;
    for (const documento of pendientes) {
      const datos = documento.instantanea();
      try {
        await this.almacen.eliminar(datos.rutaAlmacenamiento);
        // El registro permanece: se conserva el hash y el resultado, no el archivo.
        await this.documentos.guardar({
          ...datos,
          rutaAlmacenamiento: '(purgado por política de retención)',
          purgarDespuesDe: null,
        });
        purgados += 1;
      } catch (error) {
        this.log.error(`No fue posible purgar ${datos.id}: ${(error as Error).message}`);
      }
    }
    if (purgados > 0) this.log.log(`Purga por retención: ${purgados} archivo(s) eliminados`);
  }

  /** Vigencia máxima de seis meses para las vacantes publicadas. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'vencimiento-vacantes' })
  async vencerVacantes(): Promise<void> {
    const publicadas = await this.vacantes.listarPendientesReporteSpe();
    let vencidas = 0;
    for (const vacante of publicadas) {
      if (vacante.evaluarVencimiento()) {
        await this.vacantes.guardar(vacante.instantanea());
        vencidas += 1;
      }
    }
    if (vencidas > 0) this.log.log(`${vencidas} vacante(s) marcadas como vencidas`);
  }
}
