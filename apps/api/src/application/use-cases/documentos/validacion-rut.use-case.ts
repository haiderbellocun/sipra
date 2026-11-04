import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Documento, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  DatosRutExtraidos, EstadoValidacionDocumentoEmpresarial, expectativaDeTipoDocumento, familiaDe, personaDe,
} from '../../../domain/entities/documento-empresarial';
import {
  ValidacionDocumentoEmpresarial, evidenciaDeClasificacion, evidenciaDeComparacion, evidenciaDeLectura,
} from '../../../domain/entities/validacion-documento-empresarial.entity';
import { DocumentoLocalIlegibleError, LimiteLecturaLocalError } from '../../../domain/ports/out/lector-documento-local.port';
import { LECTURA_RUT, LecturaRutPort } from '../../../domain/ports/out/lectura-rut.port';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, EMPRESA_REPOSITORY, EmpresaRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { evaluarExpectativa } from '../../../domain/services/clasificacion-documento-empresarial.domain-service';
import {
  ComparacionRut, SipraParaRut, compararRut, datosSipraParaRut, sipraCambioDespues,
} from '../../../domain/services/comparacion-rut.domain-service';
import { LecturaRutPersistible, minimizarLecturaRut } from '../../../domain/services/lectura-local-rut.domain-service';

const TIPOS_RUT: readonly TipoDocumento[] = [TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO];

/**
 * Procesamiento del RUT de una práctica: lectura local → clasificación → persistencia → comparación con SIPRA.
 *
 * NO decide: la validación queda en `revision` (o en `error` con un código controlado). Un RUT consistente NO está
 * aprobado: la decisión es siempre humana y viene después. Tampoco consulta RUES, abre URLs ni usa servicios externos.
 *
 * Lectura y comparación están separadas: la lectura minimizada vive en la validación (y en la extracción del documento),
 * así que si cambian los datos de SIPRA la comparación se RECALCULA sin releer el archivo y sin tocar las evidencias
 * pasadas (ronda nueva). La comparación guarda campo, resultado y criticidad —nunca valores— y una huella de lo que SIPRA
 * decía, con la que una futura Mesa puede avisar «los datos de SIPRA cambiaron después de la lectura».
 *
 * Idempotente: repetir el procesamiento no duplica la validación ni las evidencias (se identifican por validación, ronda y
 * tipo) y no pisa un resultado. Un duplicado exacto (mismo archivo, práctica y tipo) se reporta y no impide la lectura.
 */
@Injectable()
export class ValidacionRutUseCase {
  private readonly log = new Logger(ValidacionRutUseCase.name);

  constructor(
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(LECTURA_RUT) private readonly lector: LecturaRutPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
  ) {}

  // ── Flujo de carga (lo invoca el worker) ─────────────────────────────────

  /** Refleja «procesando» al empezar el trabajo (no pisa una validación ya procesada). */
  async marcarProcesando(documentoId: string, ahora: Date = new Date()): Promise<void> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || !TIPOS_RUT.includes(documento.tipo)) return;
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
   * Registra el resultado del procesamiento de un RUT ya pasado por el pipeline. Usa la lectura que el pipeline dejó en
   * la extracción del documento; si no existe (pipeline anterior o lectura no disponible) la hace aquí, en local.
   */
  async registrarProcesamiento(documento: Documento, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    if (!TIPOS_RUT.includes(documento.tipo)) return null;
    const d = documento.instantanea();
    if ([EstadoDocumento.RECIBIDO, EstadoDocumento.ANALIZANDO].includes(d.estado)) return null;
    const previa = await this.validaciones.buscarPorDocumento(d.id);
    if (previa?.estaProcesada) return previa;
    const lectura = (d.extraccion as { lecturaRut?: LecturaRutPersistible } | null)?.lecturaRut ?? null;
    if (lectura) return this.completar(d, lectura, ahora);
    // Sin lectura del pipeline: si el documento ya volvió al estudiante (ilegible, devuelto, rechazado) no hay nada que
    // registrar; en los demás casos (p. ej. un pipeline anterior a este flujo) se lee aquí, en local.
    if ([EstadoDocumento.ILEGIBLE, EstadoDocumento.DEVUELTO, EstadoDocumento.RECHAZADO].includes(d.estado)) return null;
    return this.procesar(d.id, ahora);
  }

  /** Lee el archivo en local y registra el resultado (camino directo, sin pasar por el pipeline). */
  async procesar(documentoId: string, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || !TIPOS_RUT.includes(documento.tipo)) return null;
    const d = documento.instantanea();
    const previa = await this.validaciones.buscarPorDocumento(d.id);
    if (previa?.estaProcesada) return previa;

    let validacion = await this.abrirRonda(d, ahora);
    if (!validacion || validacion.estaProcesada) return validacion;

    let lectura: LecturaRutPersistible;
    try {
      lectura = minimizarLecturaRut(await this.lector.leer(await this.almacen.leer(d.rutaAlmacenamiento), d.mimeReal));
    } catch (error) {
      // Solo el código: el mensaje podría citar contenido del documento.
      const codigo = error instanceof LimiteLecturaLocalError ? 'limite_lectura'
        : error instanceof DocumentoLocalIlegibleError ? 'documento_ilegible' : 'error_procesamiento';
      this.log.warn(`RUT ${d.id}: la lectura falló (${codigo})`);
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
   * Los datos de SIPRA pudieron cambiar: recalcula la comparación con la lectura ya guardada. Si lo que SIPRA dice no
   * cambió, no hace nada. Si cambió, abre una ronda nueva y agrega su evidencia; las anteriores quedan intactas.
   */
  async recalcularComparacion(documentoId: string, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    // Solo un caso abierto (en revisión) se recalcula: una decisión humana no se altera; si SIPRA cambió después, lo dice la Mesa.
    if (!validacion || !validacion.estaRevisable) return validacion;
    const v = validacion.instantanea();
    const sipra = await this.datosSipra(v.practicaId);
    if (!sipra) return validacion;
    const nueva = compararRut({
      tipoDetectado: v.tipoDetectado, datos: v.datosExtraidos as DatosRutExtraidos | null, lecturaDudosa: v.lecturaDudosa, expectativa: v.expectativa,
    }, sipra, ahora);
    if (!nueva) return validacion;
    if ((v.comparacion as ComparacionRut | null)?.huellaSipra === nueva.huellaSipra) return validacion;

    validacion.aplicarRecalculoComparacion(nueva, ahora);
    const resultado = validacion.instantanea();
    await this.validaciones.agregarEvidencia(evidenciaDeComparacion(resultado, nueva, ahora).instantanea());
    if (!(await this.validaciones.guardarSiVersion(resultado, v.version))) {
      this.log.warn(`Comparación del RUT ${v.id}: la modificó otro proceso; se conserva su resultado`);
    }
    return (await this.validaciones.buscarPorId(v.id)) ?? validacion;
  }

  /** Para una futura Mesa: ¿los datos de SIPRA cambiaron después de la comparación guardada? No modifica nada. */
  async datosSipraCambiaron(documentoId: string): Promise<boolean> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    const comparacion = validacion?.instantanea().comparacion as ComparacionRut | null | undefined;
    if (!validacion || !comparacion?.huellaSipra) return false;
    const sipra = await this.datosSipra(validacion.instantanea().practicaId);
    return sipra ? sipraCambioDespues(comparacion, sipra) : false;
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

  /** Lo que SIPRA sabe: el estudiante, la empresa de la práctica (o, sin empresa registrada, lo que dice el FUR). */
  private async datosSipra(practicaId: string): Promise<SipraParaRut | null> {
    const practica = await this.practicas.buscarPorId(practicaId);
    if (!practica) return null;
    const dp = practica.instantanea();
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    const empresa = dp.empresaId ? await this.empresas.buscarPorId(dp.empresaId) : null;
    const e = empresa?.instantanea() ?? null;
    return datosSipraParaRut({
      estudiante: { nombre: estudiante?.nombre ?? null, documento: estudiante?.instantanea().documento ?? null },
      empresa: e ? { nitNumero: e.nitNumero, nitDv: e.nitDv, razonSocial: e.razonSocial } : null,
      formulario: { razonSocial: dp.empresaRazonSocial, nit: dp.empresaNit },
    });
  }

  private async completar(d: ReturnType<Documento['instantanea']>, lectura: LecturaRutPersistible, ahora: Date): Promise<ValidacionDocumentoEmpresarial | null> {
    const validacion = await this.abrirRonda(d, ahora);
    if (!validacion || validacion.estaProcesada) return validacion;

    const expectativa = evaluarExpectativa(expectativaDeTipoDocumento(d.tipo)!, {
      clasificacion: lectura.tipoDetectado, familia: familiaDe(lectura.tipoDetectado), tipoPersona: personaDe(lectura.tipoDetectado), motivos: lectura.motivosClasificacion,
    }).resultado;
    const duplicados = await this.validaciones.buscarDuplicados(d.practicaId, d.tipo, lectura.hashSha256, d.id);
    const sipra = await this.datosSipra(d.practicaId);
    const comparacion = sipra
      ? compararRut({ tipoDetectado: lectura.tipoDetectado, datos: lectura.datos, lecturaDudosa: lectura.lecturaDudosa, expectativa }, sipra, ahora)
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

    // Las evidencias van ANTES del cambio de estado: son idempotentes por (validación, ronda, tipo); si el proceso se
    // interrumpe aquí el reintento las completa sin duplicar.
    await this.validaciones.agregarEvidencia(evidenciaDeLectura(resultado, lectura.resumen, ahora).instantanea());
    await this.validaciones.agregarEvidencia(evidenciaDeClasificacion(resultado, [...lectura.motivosClasificacion, ...lectura.motivos], ahora).instantanea());
    if (comparacion) await this.validaciones.agregarEvidencia(evidenciaDeComparacion(resultado, comparacion, ahora).instantanea());

    if (!(await this.validaciones.guardarSiVersion(resultado, versionLeida))) {
      this.log.warn(`Validación de RUT ${resultado.id}: la modificó otro proceso; se conserva su resultado`);
    }
    return (await this.validaciones.buscarPorId(resultado.id)) ?? validacion;
  }
}
