import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Documento, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  EstadoValidacionDocumentoEmpresarial, expectativaDeTipoDocumento, familiaDe, personaDe,
} from '../../../domain/entities/documento-empresarial';
import {
  ValidacionDocumentoEmpresarial, evidenciaDeClasificacion, evidenciaDeLectura,
} from '../../../domain/entities/validacion-documento-empresarial.entity';
import { LECTURA_CAMARA, LecturaCamaraPort } from '../../../domain/ports/out/lectura-camara.port';
import { DocumentoLocalIlegibleError, LimiteLecturaLocalError } from '../../../domain/ports/out/lector-documento-local.port';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { evaluarExpectativa } from '../../../domain/services/clasificacion-documento-empresarial.domain-service';
import { LecturaCamaraPersistible, minimizarLecturaCamara } from '../../../domain/services/lectura-local-camara.domain-service';

/**
 * Procesamiento del certificado de Cámara de Comercio de una práctica: lectura local → clasificación por contenido →
 * persistencia (validación + evidencias de lectura y de clasificación).
 *
 * NO decide y NO compara con SIPRA todavía (viene en un bloque posterior): la validación queda en `revision` (o en `error` con un
 * código controlado). No autoaprueba, no consulta el RUES, no abre URLs de verificación y no usa servicios externos. Un documento
 * incorrecto o no determinable también queda en `revision`, con su clasificación.
 *
 * Idempotente: repetir el procesamiento no duplica la validación ni las evidencias (se identifican por validación, ronda y tipo) y
 * no pisa un resultado. Un duplicado exacto (mismo archivo, práctica y tipo) se reporta y no impide la lectura.
 */
@Injectable()
export class ValidacionCamaraUseCase {
  private readonly log = new Logger(ValidacionCamaraUseCase.name);

  constructor(
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(LECTURA_CAMARA) private readonly lector: LecturaCamaraPort,
  ) {}

  // ── Flujo de carga (lo invoca el worker) ─────────────────────────────────

  /** Refleja «procesando» al empezar el trabajo (no pisa una validación ya procesada). */
  async marcarProcesando(documentoId: string, ahora: Date = new Date()): Promise<void> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || documento.tipo !== TipoDocumento.CAMARA_COMERCIO) return;
    const validacion = await this.obtenerOCrear(documento.instantanea(), ahora);
    if (!validacion || validacion.estaProcesada) return;
    const versionLeida = validacion.version;
    validacion.iniciarProcesamiento(ahora);
    await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida);
  }

  /** Deja constancia de que el procesamiento falló (solo un código); un reintento lo reanuda. */
  async marcarErrorProcesamiento(documentoId: string, codigo: string, ahora: Date = new Date()): Promise<void> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (!validacion || validacion.estaProcesada) return;
    const versionLeida = validacion.version;
    validacion.marcarError(codigo, ahora);
    await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida);
  }

  /**
   * Registra el resultado del procesamiento de una Cámara ya pasada por el pipeline. Usa la lectura que el pipeline dejó en la
   * extracción del documento; si no existe (pipeline anterior o lectura no disponible) la hace aquí, en local.
   */
  async registrarProcesamiento(documento: Documento, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    if (documento.tipo !== TipoDocumento.CAMARA_COMERCIO) return null;
    const d = documento.instantanea();
    if ([EstadoDocumento.RECIBIDO, EstadoDocumento.ANALIZANDO].includes(d.estado)) return null;
    const previa = await this.validaciones.buscarPorDocumento(d.id);
    if (previa?.estaProcesada) return previa;
    const lectura = (d.extraccion as { lecturaCamara?: LecturaCamaraPersistible } | null)?.lecturaCamara ?? null;
    if (lectura) return this.completar(d, lectura, ahora);
    // Sin lectura del pipeline: si el documento ya volvió al estudiante (ilegible, devuelto, rechazado) no hay nada que registrar;
    // en los demás casos se lee aquí, en local.
    if ([EstadoDocumento.ILEGIBLE, EstadoDocumento.DEVUELTO, EstadoDocumento.RECHAZADO].includes(d.estado)) return null;
    return this.procesar(d.id, ahora);
  }

  /** Lee el archivo en local y registra el resultado (camino directo, sin pasar por el pipeline). */
  async procesar(documentoId: string, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || documento.tipo !== TipoDocumento.CAMARA_COMERCIO) return null;
    const d = documento.instantanea();
    const previa = await this.validaciones.buscarPorDocumento(d.id);
    if (previa?.estaProcesada) return previa;

    let validacion = await this.abrirRonda(d, ahora);
    if (!validacion || validacion.estaProcesada) return validacion;

    let lectura: LecturaCamaraPersistible;
    try {
      lectura = minimizarLecturaCamara(await this.lector.leer(await this.almacen.leer(d.rutaAlmacenamiento), d.mimeReal));
    } catch (error) {
      // Solo el código: el mensaje podría citar contenido del documento.
      const codigo = error instanceof LimiteLecturaLocalError ? 'limite_lectura'
        : error instanceof DocumentoLocalIlegibleError ? 'documento_ilegible' : 'error_procesamiento';
      this.log.warn(`Cámara ${d.id}: la lectura falló (${codigo})`);
      const v = validacion.version;
      validacion.marcarError(codigo, ahora);
      await this.validaciones.guardarSiVersion(validacion.instantanea(), v);
      validacion = (await this.validaciones.buscarPorDocumento(d.id)) ?? validacion;
      return validacion;
    }
    return this.completar(d, lectura, ahora);
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private async obtenerOCrear(d: ReturnType<Documento['instantanea']>, ahora: Date): Promise<ValidacionDocumentoEmpresarial | null> {
    const existente = await this.validaciones.buscarPorDocumento(d.id);
    if (existente) return existente;
    const practica = await this.practicas.buscarPorId(d.practicaId);
    if (!practica) return null;
    const { validacion } = await this.validaciones.crearSiNoExiste(ValidacionDocumentoEmpresarial.pendiente({
      id: randomUUID(), documentoId: d.id, practicaId: d.practicaId, estudianteId: practica.estudianteId,
      tipoEsperado: d.tipo, recibidaEn: d.cargadoEn, ahora,
    }).instantanea());
    return validacion;
  }

  /** Abre la ronda (pendiente/error) o reanuda la interrumpida («procesando»): la ronda no cambia al reanudar. */
  private async abrirRonda(d: ReturnType<Documento['instantanea']>, ahora: Date): Promise<ValidacionDocumentoEmpresarial | null> {
    let validacion = await this.obtenerOCrear(d, ahora);
    if (!validacion || validacion.estaProcesada) return validacion;
    if (validacion.estado !== EstadoValidacionDocumentoEmpresarial.PROCESANDO) {
      const v = validacion.version;
      validacion.iniciarProcesamiento(ahora);
      if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), v))) {
        return (await this.validaciones.buscarPorDocumento(d.id)) ?? validacion;
      }
      validacion = (await this.validaciones.buscarPorDocumento(d.id)) ?? validacion;
    }
    return validacion;
  }

  private async completar(d: ReturnType<Documento['instantanea']>, lectura: LecturaCamaraPersistible, ahora: Date): Promise<ValidacionDocumentoEmpresarial | null> {
    const validacion = await this.abrirRonda(d, ahora);
    if (!validacion || validacion.estaProcesada) return validacion;

    const expectativa = evaluarExpectativa(expectativaDeTipoDocumento(d.tipo)!, {
      clasificacion: lectura.tipoDetectado, familia: familiaDe(lectura.tipoDetectado), tipoPersona: personaDe(lectura.tipoDetectado), motivos: lectura.motivosClasificacion,
    }).resultado;
    const duplicados = await this.validaciones.buscarDuplicados(d.practicaId, d.tipo, lectura.hashSha256, d.id);

    const versionLeida = validacion.version;
    validacion.registrarResultado({
      tipoDetectado: lectura.tipoDetectado,
      expectativa,
      metodoLectura: lectura.metodo,
      confianza: lectura.confianzaDocumento,
      lecturaDudosa: lectura.lecturaDudosa,
      hashDocumento: lectura.hashSha256,
      duplicadoDeDocumentoId: duplicados[0]?.documentoId ?? null,
      datosExtraidos: lectura.datos,
      // La comparación con SIPRA es de un bloque posterior.
      comparacion: null,
      autenticidad: lectura.autenticidad,
    }, ahora);
    const resultado = validacion.instantanea();

    // Las evidencias van ANTES del cambio de estado: son idempotentes por (validación, ronda, tipo); si el proceso se interrumpe
    // aquí el reintento las completa sin duplicar.
    await this.validaciones.agregarEvidencia(evidenciaDeLectura(resultado, lectura.resumen, ahora).instantanea());
    await this.validaciones.agregarEvidencia(evidenciaDeClasificacion(resultado, [...lectura.motivosClasificacion, ...lectura.motivos], ahora).instantanea());

    if (!(await this.validaciones.guardarSiVersion(resultado, versionLeida))) {
      this.log.warn(`Validación de Cámara ${resultado.id}: la modificó otro proceso; se conserva su resultado`);
    }
    return (await this.validaciones.buscarPorId(resultado.id)) ?? validacion;
  }
}
