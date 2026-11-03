import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import { EstadoValidacionDocumentoEmpresarial, expectativaDeTipoDocumento } from '../../../domain/entities/documento-empresarial';
import {
  ValidacionDocumentoEmpresarial, evidenciaDeClasificacion, evidenciaDeLectura,
} from '../../../domain/entities/validacion-documento-empresarial.entity';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { DocumentoLocalIlegibleError, LimiteLecturaLocalError } from '../../../domain/ports/out/lector-documento-local.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { LECTURA_RUT, LecturaRutPort } from '../../../domain/ports/out/lectura-rut.port';
import { evaluarExpectativa } from '../../../domain/services/clasificacion-documento-empresarial.domain-service';
import { minimizarDatosRut } from '../../../domain/services/minimizacion-documento-empresarial.domain-service';

const TIPOS_RUT: readonly TipoDocumento[] = [TipoDocumento.RUT_NATURAL, TipoDocumento.RUT_JURIDICO];

/**
 * Procesa un RUT cargado a una práctica: lo lee en LOCAL, lo clasifica por su contenido, guarda la validación
 * (datos minimizados, hash, duplicado, autenticidad) y sus evidencias de lectura y de clasificación.
 *
 * No decide nada: la validación queda en `revision`. No compara con SIPRA (Bloque siguiente), no consulta RUES, no abre
 * ninguna URL y no usa servicios externos. El tipo que eligió el estudiante es solo la expectativa: si el documento es
 * de otra persona se informa (`persona_distinta`), nunca se reclasifica en silencio.
 *
 * Idempotente: repetir el procesamiento no duplica la validación ni las evidencias (se identifican por validación,
 * ronda y tipo) y no pisa un resultado ya registrado. Un duplicado exacto (mismo archivo, práctica y tipo) se reporta
 * y no impide la lectura.
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
  ) {}

  async procesar(documentoId: string, ahora: Date = new Date()): Promise<ValidacionDocumentoEmpresarial | null> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || !TIPOS_RUT.includes(documento.tipo)) return null;
    const d = documento.instantanea();

    let validacion = await this.validaciones.buscarPorDocumento(d.id);
    if (validacion?.estaProcesada) return validacion;

    if (!validacion) {
      const practica = await this.practicas.buscarPorId(d.practicaId);
      if (!practica) return null;
      const creada = await this.validaciones.crearSiNoExiste(ValidacionDocumentoEmpresarial.pendiente({
        id: randomUUID(), documentoId: d.id, practicaId: d.practicaId, estudianteId: practica.estudianteId,
        tipoEsperado: d.tipo, recibidaEn: d.cargadoEn, ahora,
      }).instantanea());
      validacion = creada.validacion;
      if (validacion.estaProcesada) return validacion;
    }

    // Abre la ronda (pendiente/error) o reanuda la interrumpida («procesando»): la ronda no cambia al reanudar.
    if (validacion.estado !== EstadoValidacionDocumentoEmpresarial.PROCESANDO) {
      const v = validacion.version;
      validacion.iniciarProcesamiento(ahora);
      if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), v))) {
        return (await this.validaciones.buscarPorDocumento(d.id)) ?? validacion;
      }
      validacion = (await this.validaciones.buscarPorDocumento(d.id)) ?? validacion;
    }

    let lectura;
    try {
      lectura = await this.lector.leer(await this.almacen.leer(d.rutaAlmacenamiento), d.mimeReal);
    } catch (error) {
      // Solo el código: el mensaje podría citar contenido del documento.
      const codigo = error instanceof LimiteLecturaLocalError ? 'limite_lectura'
        : error instanceof DocumentoLocalIlegibleError ? 'documento_ilegible' : 'error_procesamiento';
      this.log.warn(`RUT ${d.id}: la lectura falló (${codigo})`);
      const v = validacion.version;
      validacion.marcarError(codigo, ahora);
      await this.validaciones.guardarSiVersion(validacion.instantanea(), v);
      return (await this.validaciones.buscarPorDocumento(d.id)) ?? validacion;
    }

    const i = lectura.interpretacion;
    const expectativa = evaluarExpectativa(expectativaDeTipoDocumento(d.tipo)!, i.clasificacion);
    const duplicados = await this.validaciones.buscarDuplicados(d.practicaId, d.tipo, lectura.hashSha256, d.id);
    const persona = i.clasificacion.tipoPersona;

    const versionLeida = validacion.version;
    validacion.registrarResultado({
      tipoDetectado: i.clasificacion.clasificacion,
      expectativa: expectativa.resultado,
      metodoLectura: lectura.metodo,
      confianza: i.confianzaDocumento,
      lecturaDudosa: i.lecturaDudosa,
      hashDocumento: lectura.hashSha256,
      duplicadoDeDocumentoId: duplicados[0]?.documentoId ?? null,
      datosExtraidos: i.datos && persona ? minimizarDatosRut(i.datos as unknown as Record<string, unknown>, persona) : null,
      comparacion: null,
      autenticidad: lectura.autenticidad,
    }, ahora);
    const resultado = validacion.instantanea();

    // Las evidencias van ANTES del cambio de estado: son idempotentes por (validación, ronda, tipo); si el proceso se
    // interrumpe aquí el reintento las completa sin duplicar.
    await this.validaciones.agregarEvidencia(evidenciaDeLectura(resultado, lectura.resumen, ahora).instantanea());
    await this.validaciones.agregarEvidencia(evidenciaDeClasificacion(resultado, [...i.clasificacion.motivos, ...i.motivos], ahora).instantanea());

    if (!(await this.validaciones.guardarSiVersion(resultado, versionLeida))) {
      this.log.warn(`Validación de RUT ${resultado.id}: la modificó otro proceso; se conserva su resultado`);
    }
    return (await this.validaciones.buscarPorId(resultado.id)) ?? validacion;
  }
}
