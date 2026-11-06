import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Documento, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial, DatosCamaraExtraidos, EstadoValidacionDocumentoEmpresarial, expectativaDeTipoDocumento, familiaDe, personaDe,
} from '../../../domain/entities/documento-empresarial';
import {
  ValidacionDocumentoEmpresarial, evidenciaDeClasificacion, evidenciaDeComparacion, evidenciaDeLectura,
} from '../../../domain/entities/validacion-documento-empresarial.entity';
import { LECTURA_CAMARA, LecturaCamaraPort } from '../../../domain/ports/out/lectura-camara.port';
import { DocumentoLocalIlegibleError, LimiteLecturaLocalError } from '../../../domain/ports/out/lector-documento-local.port';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, EMPRESA_REPOSITORY, EmpresaRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { evaluarExpectativa } from '../../../domain/services/clasificacion-documento-empresarial.domain-service';
import {
  ComparacionCamara, SipraParaCamara, compararCamaraConSipra, datosSipraParaCamara, sipraCambioDespuesCamara,
} from '../../../domain/services/comparacion-camara.domain-service';
import { LecturaCamaraPersistible, minimizarLecturaCamara } from '../../../domain/services/lectura-local-camara.domain-service';

/**
 * Procesamiento del certificado de Cámara de Comercio de una práctica: lectura local → clasificación por contenido →
 * persistencia (validación + evidencias de lectura y de clasificación) → comparación con SIPRA (evidencia de comparación).
 *
 * NO decide: la validación queda en `revision` (o en `error` con un código controlado). Una Cámara consistente NO está aprobada: la
 * decisión es siempre humana y viene después. No autoaprueba, no consulta el RUES, no abre URLs de verificación y no usa servicios
 * externos. Un documento incorrecto o no determinable también queda en `revision`, con su clasificación y SIN comparación.
 *
 * Lectura y comparación están separadas: la lectura minimizada vive en la validación, así que si cambian los datos de SIPRA la
 * comparación se RECALCULA sin releer el archivo y sin tocar las evidencias pasadas (ronda nueva). La comparación guarda campo,
 * resultado, criticidad y causa —nunca valores— y una huella de lo que SIPRA decía.
 *
 * Idempotente: repetir el procesamiento no duplica la validación ni las evidencias (se identifican por validación, ronda y tipo) y
 * no pisa un resultado. Un duplicado exacto (mismo archivo, práctica y tipo) se reporta y no impide la lectura.
 */
const METODO_COMPARACION = 'comparacion_camara_sipra';

@Injectable()
export class ValidacionCamaraUseCase {
  private readonly log = new Logger(ValidacionCamaraUseCase.name);

  constructor(
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(LECTURA_CAMARA) private readonly lector: LecturaCamaraPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
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

  // ── Recálculo de la comparación (sin releer el archivo) ──────────────────

  /**
   * Los datos de SIPRA pudieron cambiar: recalcula la comparación con la lectura ya guardada. Si lo que SIPRA dice no cambió, no
   * hace nada. Si cambió, abre una ronda nueva y agrega su evidencia; las anteriores quedan intactas. Un caso ya decidido NO se
   * toca (la decisión es historia): para ese caso `datosSipraCambiaronCamara` solo informa.
   */
  async recalcularComparacionCamara(documentoId: string, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (!validacion || !validacion.estaRevisable) return validacion;
    const v = validacion.instantanea();
    const sipra = await this.datosSipra(v.practicaId);
    if (!sipra) return validacion;
    const nueva = compararCamaraConSipra({
      tipoDetectado: v.tipoDetectado, datos: v.datosExtraidos as DatosCamaraExtraidos | null, lecturaDudosa: v.lecturaDudosa,
    }, sipra, ahora);
    if (!nueva) return validacion;
    if ((v.comparacion as ComparacionCamara | null)?.huellaSipra === nueva.huellaSipra) return validacion;

    validacion.aplicarRecalculoComparacion(nueva, ahora, this.expectativaDe(v.tipoDetectado, sipra));
    const resultado = validacion.instantanea();
    await this.validaciones.agregarEvidencia(evidenciaDeComparacion(resultado, nueva, ahora, METODO_COMPARACION).instantanea());
    if (!(await this.validaciones.guardarSiVersion(resultado, v.version))) {
      this.log.warn(`Comparación de la Cámara ${v.id}: la modificó otro proceso; se conserva su resultado`);
    }
    return (await this.validaciones.buscarPorId(v.id)) ?? validacion;
  }

  /** Para una futura Mesa: ¿los datos de SIPRA cambiaron después de la comparación guardada? No modifica nada. */
  async datosSipraCambiaronCamara(documentoId: string): Promise<boolean> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    const comparacion = validacion?.instantanea().comparacion as ComparacionCamara | null | undefined;
    if (!validacion || !comparacion?.huellaSipra) return false;
    const sipra = await this.datosSipra(validacion.instantanea().practicaId);
    return sipra ? sipraCambioDespuesCamara(comparacion, sipra) : false;
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  /** Lo que SIPRA sabe: la empresa de la práctica (o, sin empresa registrada, lo que dice el FUR). En persona natural es el titular. */
  private async datosSipra(practicaId: string): Promise<SipraParaCamara | null> {
    const practica = await this.practicas.buscarPorId(practicaId);
    if (!practica) return null;
    const dp = practica.instantanea();
    const empresa = dp.empresaId ? await this.empresas.buscarPorId(dp.empresaId) : null;
    const e = empresa?.instantanea() ?? null;
    return datosSipraParaCamara({
      empresa: e ? { nitNumero: e.nitNumero, nitDv: e.nitDv, razonSocial: e.razonSocial, representanteLegal: e.representanteLegal } : null,
      formulario: { razonSocial: dp.empresaRazonSocial, nit: dp.empresaNit },
    });
  }

  /** La Cámara no distingue persona al elegir el tipo: la persona esperada sale de lo que SIPRA sabe de la empresa. */
  private expectativaDe(tipoDetectado: ClasificacionDocumentoEmpresarial | null, sipra: SipraParaCamara | null): string | null {
    if (!tipoDetectado) return null;
    return evaluarExpectativa(expectativaDeTipoDocumento(TipoDocumento.CAMARA_COMERCIO, sipra?.personaEsperada ?? null)!, {
      clasificacion: tipoDetectado, familia: familiaDe(tipoDetectado), tipoPersona: personaDe(tipoDetectado), motivos: [],
    }).resultado;
  }

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

    const sipra = await this.datosSipra(d.practicaId);
    const expectativa = this.expectativaDe(lectura.tipoDetectado, sipra);
    const duplicados = await this.validaciones.buscarDuplicados(d.practicaId, d.tipo, lectura.hashSha256, d.id);
    const comparacion = sipra
      ? compararCamaraConSipra({ tipoDetectado: lectura.tipoDetectado, datos: lectura.datos, lecturaDudosa: lectura.lecturaDudosa }, sipra, ahora)
      : null;

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
      comparacion,
      autenticidad: lectura.autenticidad,
    }, ahora);
    const resultado = validacion.instantanea();

    // Las evidencias van ANTES del cambio de estado: son idempotentes por (validación, ronda, tipo); si el proceso se interrumpe
    // aquí el reintento las completa sin duplicar.
    await this.validaciones.agregarEvidencia(evidenciaDeLectura(resultado, lectura.resumen, ahora).instantanea());
    await this.validaciones.agregarEvidencia(evidenciaDeClasificacion(resultado, [...lectura.motivosClasificacion, ...lectura.motivos], ahora).instantanea());
    if (comparacion) await this.validaciones.agregarEvidencia(evidenciaDeComparacion(resultado, comparacion, ahora, METODO_COMPARACION).instantanea());

    if (!(await this.validaciones.guardarSiVersion(resultado, versionLeida))) {
      this.log.warn(`Validación de Cámara ${resultado.id}: la modificó otro proceso; se conserva su resultado`);
    }
    return (await this.validaciones.buscarPorId(resultado.id)) ?? validacion;
  }
}
