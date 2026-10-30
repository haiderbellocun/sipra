import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Trabajo } from '../../../domain/ports/out/servicios-externos.port';
import {
  ALMACENAMIENTO, AlmacenamientoPort,
} from '../../../domain/ports/out/servicios-externos.port';
import {
  EventoNotificable,
} from '../../../domain/services/plantillas-notificacion.domain-service';
import {
  NotificacionesService,
} from '../../../infrastructure/modules/notificaciones.service';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { Documento, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import { MetricasService } from '../../../infrastructure/observability/metricas.service';
import { PipelineValidacionUseCase, ProcesamientoEnCursoError } from './pipeline-validacion.use-case';
import { ValidacionActaUseCase } from './validacion-acta.use-case';
import { ValidacionEpsUseCase } from './validacion-eps.use-case';
import { ConfigService } from '@nestjs/config';
import { INTERRUPTORES_EPS, interruptorEps } from '../../services/interruptores-eps';
import { VerificacionEpsUseCase } from './verificacion-eps.use-case';

/**
 * Punto único de ejecución de los trabajos encolados.
 *
 * Lo invocan tanto la cola en proceso (desarrollo) como el endpoint worker que
 * dispara Cloud Tasks. Que ambos caminos entren por aquí es lo que hace que el
 * comportamiento en local y en Google Cloud sea el mismo.
 */
@Injectable()
export class ProcesarTrabajoUseCase {
  private readonly log = new Logger(ProcesarTrabajoUseCase.name);

  constructor(
    private readonly pipeline: PipelineValidacionUseCase,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    private readonly notificaciones: NotificacionesService,
    private readonly metricas: MetricasService,
    private readonly validacionesEps: ValidacionEpsUseCase,
    @Optional() private readonly verificacionesEps?: VerificacionEpsUseCase,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly validacionesActa?: ValidacionActaUseCase,
  ) {}

  async ejecutar(trabajo: Trabajo): Promise<void> {
    const inicio = process.hrtime.bigint();
    switch (trabajo.tipo) {
      case 'validar_documento':
        await this.validarDocumento(trabajo.referencia, inicio);
        return;
      case 'purga_documento':
        await this.purgarDocumento(trabajo.referencia);
        return;
      case 'reporte_spe':
        // El generador de reportes se invoca desde su propio caso de uso; aquí
        // solo se registra para que la cola no descarte el trabajo en silencio.
        this.log.log(`Trabajo de reporte SPE recibido: ${trabajo.referencia}`);
        return;
    }
  }

  /**
   * Idempotente: repetir el trabajo (reintento de Cloud Tasks, doble entrega) no
   * vuelve a leer, no duplica métricas ni avisos y no pisa una decisión humana.
   */
  private async validarDocumento(documentoId: string, inicio: bigint): Promise<void> {
    const { documento, ejecutado } = await this.procesarMarcandoValidacion(documentoId);
    if (ejecutado) await this.registrarResultado(documento, inicio);
    // La validación del acta se asegura SIEMPRE (como la de EPS): si un intento anterior falló después de procesar el
    // documento, el reintento (que ya no ejecuta capas) la completa. Es idempotente: no duplica validación ni evidencias.
    if (documento.tipo === TipoDocumento.ACTA_INICIO) await this.validacionesActa?.registrarProcesamiento(documento);
    // La validación de EPS se asegura SIEMPRE: si un intento anterior falló después de
    // procesar el documento, el reintento (que ya no ejecuta capas) la completa.
    if (documento.tipo === TipoDocumento.CERTIFICADO_EPS) {
      // Interruptor de incidente: el documento queda cargado y a salvo; la lectura se reanuda al reencender (el reintento es idempotente).
      if (!interruptorEps(this.config, INTERRUPTORES_EPS.validacion)) {
        this.log.warn(`Validación EPS suspendida: el documento ${documento.id} queda en espera`);
        return;
      }
      await this.validacionesEps.registrarProcesamiento(documento);
      // Verificación oficial: es un complemento. Si falla, el trabajo NO falla (la validación ya quedó
      // procesada y en revisión humana) y un reintento no vuelve a consultar el portal si ya hay resultado.
      try {
        await this.verificacionesEps?.verificar(documento.id);
      } catch (error) {
        this.log.warn(`Verificación EPS del documento ${documento.id}: sin resultado (${(error as Error).name})`);
      }
    }
  }

  /**
   * Para el certificado de EPS y para el acta de iniciación, refleja «procesando» y, si el pipeline falla, «error»
   * (el reintento lo reanuda).
   */
  private async procesarMarcandoValidacion(documentoId: string): ReturnType<PipelineValidacionUseCase['procesar']> {
    const previo = await this.documentos.buscarPorId(documentoId);
    const esEps = previo?.tipo === TipoDocumento.CERTIFICADO_EPS;
    const esActa = previo?.tipo === TipoDocumento.ACTA_INICIO;
    if (esEps) await this.validacionesEps.marcarProcesando(documentoId);
    if (esActa) await this.validacionesActa?.marcarProcesando(documentoId);
    try {
      return await this.pipeline.procesar(documentoId);
    } catch (error) {
      // Un procesamiento ya en curso en otra instancia no es un fallo de este trabajo.
      if (!(error instanceof ProcesamientoEnCursoError)) {
        if (esEps) await this.validacionesEps.marcarErrorProcesamiento(documentoId, 'PROCESAMIENTO_FALLIDO').catch(() => undefined);
        if (esActa) await this.validacionesActa?.marcarErrorProcesamiento(documentoId, 'PROCESAMIENTO_FALLIDO').catch(() => undefined);
      }
      throw error;
    }
  }

  private async registrarResultado(documento: Documento, inicio: bigint): Promise<void> {
    const datos = documento.instantanea();

    const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
    const cortocircuito = String(datos.extraccion === null && datos.banderas.length > 0);
    this.metricas.duracionPipeline.observe({ tipo: datos.tipo, cortocircuito }, segundos);
    this.metricas.documentosProcesados.inc({
      tipo: datos.tipo,
      banda: datos.banda ?? 'sin_banda',
      estado: datos.estado,
    });
    if (datos.estado === EstadoDocumento.AUTO_APROBADO) {
      this.metricas.documentosAutoAprobados.inc({ tipo: datos.tipo });
    }

    const extraccion = datos.extraccion as { modelo?: string; costoUsd?: number } | null;
    if (extraccion?.costoUsd) {
      this.metricas.costoIa.inc({ modelo: extraccion.modelo ?? 'desconocido' }, extraccion.costoUsd);
    }

    await this.avisarSiRequiereAccion(documento);
  }

  /**
   * Aviso al estudiante. Vive aquí y no en el cargue porque hasta que el
   * pipeline no termina no se sabe si el documento quedó devuelto o ilegible:
   * avisar al encolar sería avisar sin resultado.
   *
   * Toda devolución explica en lenguaje comprensible qué corregir. Un mensaje
   * que solo dice "documento rechazado" genera una llamada al conmutador.
   */
  private async avisarSiRequiereAccion(documento: Documento): Promise<void> {
    const datos = documento.instantanea();
    if (![EstadoDocumento.DEVUELTO, EstadoDocumento.ILEGIBLE].includes(datos.estado)) return;

    const practica = await this.practicas.buscarPorId(datos.practicaId);
    if (!practica) return;
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    if (!estudiante) return;

    const guias = datos.banderas
      .map((b) => b.mensajeUsuario)
      .filter((m): m is string => Boolean(m));

    await this.notificaciones.notificar(
      datos.estado === EstadoDocumento.ILEGIBLE
        ? EventoNotificable.DOCUMENTO_ILEGIBLE
        : EventoNotificable.DOCUMENTO_DEVUELTO,
      { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
      { tipoDocumento: datos.tipo, motivo: datos.motivoDevolucion ?? undefined, guias },
    );
  }

  /** Minimización de datos: se elimina el archivo y se conserva el hash. */
  private async purgarDocumento(documentoId: string): Promise<void> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento) return;
    const datos = documento.instantanea();
    if (!datos.purgarDespuesDe || datos.purgarDespuesDe > new Date()) return;

    await this.almacen.eliminar(datos.rutaAlmacenamiento);
    await this.documentos.guardar({
      ...datos,
      rutaAlmacenamiento: '(purgado por política de retención)',
      // La lectura asistida se reduce a lo que sostiene los costos: los
      // textos literales del documento se van con el archivo.
      extraccion: minimizarLectura(datos.extraccion),
      purgarDespuesDe: null,
    });
    this.log.log(`Documento ${documentoId} purgado por retención`);
  }
}

/**
 * Lo que queda de una lectura cuando el archivo se purga: modelo, proveedor,
 * tokens, costo y fecha. Campos, evidencias, resumen, motivo y detalles se
 * eliminan: son el contenido del documento, y el documento ya no existe.
 */
export function minimizarLectura(extraccion: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!extraccion) return null;
  const conservar = [
    'modelo', 'proveedor', 'tokensEntrada', 'tokensSalida', 'tokensCache', 'tokensRazonamiento',
    'costoUsd', 'gastoPrevioUsd', 'leidoEn', 'intentos', 'ilegible', 'tipoDetectado', 'fallida', 'tarifaDesconocida',
  ];
  const reducida: Record<string, unknown> = { purgada: true };
  for (const clave of conservar) if (clave in extraccion) reducida[clave] = extraccion[clave];
  return reducida;
}
