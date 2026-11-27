import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParametrosUseCase } from '../administracion/parametros.use-case';
import {
  Bandera, Documento, EstadoDocumento, SeveridadBandera, TipoDocumento,
} from '../../../domain/entities/documento.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  ALMACENAMIENTO, AlmacenamientoPort, COHERENCIA_CRUZADA, CoherenciaCruzadaPort,
  EXTRACCION_IA, EXTRACCION_LOCAL, ExtraccionIaPort, LECTOR_CODIGO_BARRAS, LECTURA_RESCATE_IA, LectorCodigoBarrasPort,
  LecturaRescateIaPort, ResultadoExtraccion, ResultadoRescateIa,
} from '../../../domain/ports/out/servicios-externos.port';
import { ForenseDomainService } from '../../../domain/services/forense.domain-service';
import {
  BITS_HASH_PERCEPTUAL, HashPerceptualDomainService,
} from '../../../domain/services/hash-perceptual.domain-service';
import {
  PasoAplicado, PreprocesamientoDomainService,
} from '../../../domain/services/preprocesamiento.domain-service';
import { Pdf417DomainService } from '../../../domain/services/pdf417.domain-service';
import {
  ModoProcesamiento, TIPOS_CON_DECISION_ESPECIALIZADA, modoProcesamientoDe, permiteAutoAprobacionDelPipeline,
} from '../../../domain/services/politica-procesamiento';
import { camposDe } from '../../../domain/entities/campos-extraccion';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { fusionarLecturas } from '../../../domain/services/fusion-lecturas';
import {
  RescateIaNoAutorizadoError, autorizarRescateIa, decidirRescateIa,
} from '../../../domain/services/politica-rescate-ia';
import {
  MetadatosRescateIa, ResultadoRescate, UsoRescate, banderasDeRescate, clasificarResultadoRescate, incorporarRescate,
} from '../../../domain/services/resultado-rescate-ia';
import { evaluarSuficienciaLectura } from '../../../domain/services/suficiencia-lectura';
import { interruptoresRescateIa } from '../../services/interruptores-rescate-ia';

import { MetricasService } from '../../../infrastructure/observability/metricas.service';
import { ClasificacionDocumentoEmpresarial } from '../../../domain/entities/documento-empresarial';
import { inicioDelDiaEnColombia } from '../../../domain/services/fechas-colombia';
import {
  DecodificadorImagenAdapter,
} from '../../../infrastructure/adapters/imagen/decodificador.adapter';

/** Tipos que un sistema institucional emite: se les exige productor coherente. */
const TIPOS_EMITIDOS_POR_SISTEMA: readonly TipoDocumento[] = [
  TipoDocumento.CERTIFICADO_ARL,
  TipoDocumento.CERTIFICADO_EXISTENCIA,
  TipoDocumento.PLANILLA_APORTES,
];

/**
 * Cuánto vale un reclamo de procesamiento. Una ejecución legítima termina antes
 * (la IA tiene un tope de 120 s); pasado este tiempo se considera interrumpida
 * y otro trabajo puede tomar el documento.
 */
export const VIGENCIA_RECLAMO_PIPELINE_MS = 15 * 60_000;

/** Otro procesamiento tiene el documento: el trabajo debe reintentarse, no darse por hecho. */
export class ProcesamientoEnCursoError extends Error {
  constructor(documentoId: string) {
    super(`El documento ${documentoId} está siendo procesado por otra ejecución`);
    this.name = 'ProcesamientoEnCursoError';
  }
}

export interface ResultadoProcesamiento {
  documento: Documento;
  /** false = nada se ejecutó (ya procesado, decidido o resultado descartado): sin efectos. */
  ejecutado: boolean;
}

/**
 * Orquesta las capas 0 a 5 (sección 4 del documento técnico).
 *
 * Reglas que el diseño impone y este código respeta:
 *  · La IA NO decide autenticidad. Solo extrae y razona coherencia.
 *  · Hay TRES resultados, no dos: aprobado, en revisión e ilegible.
 *  · Nunca hay rechazo automático.
 *  · Una bandera crítica cortocircuita antes de consumir tokens.
 */
@Injectable()
export class PipelineValidacionUseCase {
  private readonly log = new Logger(PipelineValidacionUseCase.name);
  private readonly forense = new ForenseDomainService();
  private readonly perceptual = new HashPerceptualDomainService();
  private readonly preproceso = new PreprocesamientoDomainService();
  private readonly pdf417 = new Pdf417DomainService();

  constructor(
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(EXTRACCION_IA) private readonly extraccion: ExtraccionIaPort,
    @Inject(COHERENCIA_CRUZADA) private readonly coherencia: CoherenciaCruzadaPort,
    private readonly decodificador: DecodificadorImagenAdapter,
    @Inject(LECTOR_CODIGO_BARRAS) private readonly lectorCodigos: LectorCodigoBarrasPort,
    private readonly parametros: ParametrosUseCase,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(EXTRACCION_LOCAL) private readonly extraccionLocal?: ExtraccionIaPort,
    // IA de rescate (§7.35). Opcionales: sin proveedor, sin auditoría o sin métricas el flujo es el de siempre.
    // El proveedor registrado en AppModule es el PROTEGIDO (segunda compuerta), nunca el adaptador de OpenAI.
    @Optional() @Inject(LECTURA_RESCATE_IA) private readonly rescate?: LecturaRescateIaPort,
    @Optional() @Inject(AUDITORIA_REPOSITORY) private readonly auditoria?: AuditoriaRepositoryPort,
    @Optional() private readonly metricas?: MetricasService,
  ) {}

  /** Compatibilidad: devuelve el documento resultante, haya o no ejecutado capas. */
  async ejecutar(documentoId: string): Promise<Documento> {
    return (await this.procesar(documentoId)).documento;
  }

  /**
   * Procesa el documento UNA sola vez.
   *
   * Idempotente por documento (cada versión es otro documento) y correcto con
   * varias instancias y reintentos de Cloud Tasks:
   *  1. Solo se procesa `recibido`. Lo `decidido`, `auto_aprobado`, `en_revision`
   *     o `ilegible` no se toca: un reproceso exige una acción explícita.
   *  2. El reclamo es un compare-and-set en la base (`recibido` → `analizando`):
   *     de N ejecuciones simultáneas, una sola corre las capas.
   *  3. El resultado se guarda solo si el documento sigue `analizando`: una
   *     decisión humana que llegue en medio gana y el resultado se descarta.
   *  4. Si una ejecución se interrumpe, su reclamo caduca y otro trabajo la retoma.
   */
  async procesar(documentoId: string): Promise<ResultadoProcesamiento> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento) throw new Error(`Documento ${documentoId} no encontrado`);

    const ahora = new Date();
    if (!documento.puedeIniciarProcesamiento(ahora, VIGENCIA_RECLAMO_PIPELINE_MS)) {
      if (documento.estado === EstadoDocumento.ANALIZANDO) throw new ProcesamientoEnCursoError(documentoId);
      this.log.log(`Documento ${documentoId}: ya procesado (estado ${documento.estado}); se ignora la repetición`);
      return { documento, ejecutado: false };
    }

    const reclamado = await this.documentos.reclamarProcesamiento(documentoId, ahora, VIGENCIA_RECLAMO_PIPELINE_MS);
    if (!reclamado) {
      // Otra ejecución se adelantó entre la lectura y el reclamo.
      const actual = (await this.documentos.buscarPorId(documentoId)) ?? documento;
      if (actual.estado === EstadoDocumento.ANALIZANDO) throw new ProcesamientoEnCursoError(documentoId);
      this.log.log(`Documento ${documentoId}: lo procesó otra ejecución (estado ${actual.estado})`);
      return { documento: actual, ejecutado: false };
    }

    documento.iniciarProcesamiento(ahora);
    try {
      return await this.ejecutarCapas(documento);
    } catch (error) {
      // Fallo inesperado: se devuelve el reclamo para que el reintento no espere a que caduque.
      await this.documentos.liberarReclamo(documentoId, new Date());
      throw error;
    }
  }

  /** Guarda el resultado solo si el documento sigue `analizando`; si no, su estado actual manda. */
  private async finalizar(documento: Documento): Promise<ResultadoProcesamiento> {
    const aplicado = await this.documentos.guardarSiEstado(documento.instantanea(), EstadoDocumento.ANALIZANDO);
    if (aplicado) return { documento, ejecutado: true };
    this.log.warn(`Documento ${documento.id}: cambió durante el procesamiento; el resultado automático se descarta`);
    return { documento: (await this.documentos.buscarPorId(documento.id)) ?? documento, ejecutado: false };
  }

  private async ejecutarCapas(documento: Documento): Promise<ResultadoProcesamiento> {
    const documentoId = documento.id;
    const datos = documento.instantanea();
    const contenido = await this.almacen.leer(datos.rutaAlmacenamiento);

    // ── Capas 0 y 1 — determinísticas ─────────────────────────────────────
    const coincidencias = await this.documentos.contarPorHash(datos.hashSha256, documento.id);
    const banderas: Bandera[] = this.forense.analizar({
      buffer: contenido,
      nombreDeclarado: datos.nombreOriginal,
      mimeDeclarado: datos.mimeReal,
      coincidenciasHash: coincidencias,
      esperaProductorInstitucional: TIPOS_EMITIDOS_POR_SISTEMA.includes(datos.tipo),
    });

    banderas.push(...this.evaluarCalidadCaptura(documento));
    banderas.push(...(await this.buscarImagenReutilizada(documento)));

    // ── Capa 0 — código PDF417 del documento de identidad ─────────────────
    // Si la cédula trae su código legible, sus datos son matemáticamente
    // verificados y no hace falta que la IA los adivine.
    const cedula = await this.leerCedula(documento, contenido);
    if (cedula) {
      banderas.push(...cedula.banderas);
      if (cedula.extraccion) {
        documento.aplicarResultadoPipeline(
          this.forense.calcularPuntaje(banderas),
          banderas,
          cedula.extraccion as unknown as Record<string, unknown>,
        );
        this.log.log(
          `Documento ${documentoId}: datos tomados del código PDF417, sin OCR ni IA`,
        );
        return this.finalizar(documento);
      }
    }

    if (this.forense.debeCortocircuitar(banderas)) {
      this.log.warn(
        `Documento ${documentoId}: bandera crítica en capa 0/1. Se omite la extracción con IA.`,
      );
      documento.aplicarResultadoPipeline(this.forense.calcularPuntaje(banderas), banderas, null);
      return this.finalizar(documento);
    }

    // ── Capa 2 — extracción asistida por IA ───────────────────────────────
    // Sin lectura automática no hay base para aprobar: cualquier camino que
    // deje `extraido` en null termina en revisión humana (bandera ALTA), nunca
    // en aprobación por ausencia de hallazgos.
    let extraido: ResultadoExtraccion | null = null;
    // Una respuesta inservible del proveedor también se facturó: se guarda
    // como lectura fallida (sin campos) para que el gasto cuente.
    let lecturaFallida: ResultadoExtraccion | null = null;
    // Un tipo con procesamiento local nunca sale a un proveedor externo y no cuesta IA:
    // ni tope diario ni límite por práctica. Sin extractor local no hay lectura.
    const procesamientoLocal = modoProcesamientoDe(datos.tipo) === ModoProcesamiento.LOCAL;
    const extractor: ExtraccionIaPort | null = procesamientoLocal ? (this.extraccionLocal ?? null) : this.extraccion;
    const tope = procesamientoLocal ? null : await this.topeDiarioAlcanzado();
    const limitePractica = procesamientoLocal || tope ? null : await this.limitePorPracticaAlcanzado(datos.practicaId);
    if (limitePractica) {
      this.log.warn(
        `Documento ${documentoId}: la práctica ${datos.practicaId} ya tuvo ${limitePractica.lecturas} lecturas ` +
          `hoy (límite ${limitePractica.limite}); pasa a revisión humana sin lectura automática.`,
      );
      banderas.push({
        codigo: 'C2_LIMITE_LECTURAS_PRACTICA',
        capa: 2,
        severidad: SeveridadBandera.ALTA,
        mensaje:
          `Esta práctica alcanzó el límite diario de lecturas automáticas (${limitePractica.limite}); ` +
          'el documento requiere revisión humana',
        mensajeUsuario: 'Su documento quedó en revisión del docente.',
      });
    } else if (tope) {
      this.log.warn(
        `Documento ${documentoId}: gasto de IA de hoy (${tope.gastado} USD) alcanzó el tope ` +
          `(${tope.tope} USD); pasa a revisión humana sin lectura automática.`,
      );
      banderas.push({
        codigo: 'C2_TOPE_DIARIO_ALCANZADO',
        capa: 2,
        severidad: SeveridadBandera.ALTA,
        mensaje:
          `El gasto diario en lectura asistida (${tope.gastado.toFixed(2)} USD) alcanzó el tope ` +
          `configurado (${tope.tope} USD); el documento requiere revisión humana`,
        mensajeUsuario: 'Su documento quedó en revisión del docente.',
      });
    } else if (!extractor) {
      banderas.push({
        codigo: 'C2_PROCESAMIENTO_LOCAL_NO_DISPONIBLE',
        capa: 2,
        severidad: SeveridadBandera.ALTA,
        mensaje: 'Este tipo se procesa solo en local y no hay extractor local disponible; requiere revisión humana',
        mensajeUsuario: 'Su documento quedó en revisión.',
      });
    } else {
      try {
        extraido = await extractor.extraer(contenido, datos.mimeReal, datos.tipo);
      } catch (error) {
        this.log.error(`Extracción fallida en ${documentoId}: ${(error as Error).message}`);
        lecturaFallida = this.lecturaFallida(error as Error);
        banderas.push({
          codigo: 'C2_EXTRACCION_NO_DISPONIBLE',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje:
            'La lectura automática no pudo ejecutarse ' +
            `(${(error as Error).message.slice(0, 160)}); el documento requiere revisión humana`,
          mensajeUsuario: 'Su documento quedó en revisión del docente.',
        });
      }
    }

    // ── Segundo intento sobre una copia preprocesada ──────────────────────
    // Antes de devolver el documento al estudiante se agota el recurso
    // determinístico: enderezar, recortar, ecualizar y binarizar. Reorganiza
    // píxeles existentes; no genera ninguno. El original queda intacto.
    let pasosPreproceso: PasoAplicado[] = [];
    if (extraido?.ilegible) {
      const primerIntento = extraido;
      const segundoIntento = await this.reintentarConPreproceso(
        contenido, datos.mimeReal, datos.tipo, extractor as ExtraccionIaPort,
      );
      if (segundoIntento) {
        // Las dos lecturas costaron: el gasto se acumula en la que se guarda.
        extraido = this.acumularGasto(
          segundoIntento.extraccion.ilegible ? primerIntento : segundoIntento.extraccion,
          segundoIntento.extraccion.ilegible ? segundoIntento.extraccion : primerIntento,
        );
      }
      if (segundoIntento && !segundoIntento.extraccion.ilegible) {
        pasosPreproceso = segundoIntento.pasos;
        this.log.log(
          `Documento ${documentoId}: ilegible en el primer intento, legible tras ` +
            `${pasosPreproceso.map((p) => p.operacion).join(', ')}`,
        );
        banderas.push({
          codigo: 'C2_LEGIBLE_TRAS_PREPROCESO',
          capa: 2,
          severidad: SeveridadBandera.INFORMATIVA,
          mensaje:
            'El documento solo se pudo leer tras preprocesamiento determinístico: ' +
            pasosPreproceso.map((p) => p.descripcion).join('; '),
        });
      }
    }

    // ── IA de rescate (solo tipos de procesamiento LOCAL; §7.35) ───────────
    // Un único intento por ejecución, DESPUÉS del preproceso y ANTES de decidir «ilegible». Nunca lanza: un fallo
    // del proveedor degrada a revisión humana o ilegible según lo leído en local.
    if (extraido && procesamientoLocal) {
      extraido = await this.intentarRescate(documento, contenido, extraido, banderas);
    }

    if (extraido?.ilegible) {
      // Resultado ilegible: solicitud de reenvío, NO decisión negativa.
      // No se emplea IA generativa para reconstruir el documento: los modelos
      // de super-resolución no recuperan información, la inventan.
      // La lectura (tokens, costo, motivo) se conserva aunque el documento
      // vuelva al estudiante: el gasto existió y el revisor puede verla.
      documento.aplicarResultadoPipeline(
        this.forense.calcularPuntaje(banderas),
        banderas,
        this.conFechaDeLectura(extraido, datos.extraccion),
        new Date(),
        await this.parametros.umbralesPipeline(),
      );
      const motivo = extraido.motivoIlegible?.trim();
      documento.marcarIlegible(
        'No fue posible leer el documento con certeza. Vuelva a capturarlo con buena luz, ' +
          'sobre una superficie plana y sin sombras, procurando que todo el texto quede enfocado.' +
          (motivo ? ` Lo que se detectó: ${motivo}` : ''),
      );
      return this.finalizar(documento);
    }

    if (extraido) {
      banderas.push(...this.banderasPorConfianza(extraido));
      // Nada leído y tipo sin detectar: el pipeline no tiene base para aprobar.
      // Un documento así nunca pasa solo; lo decide una persona. Solo aplica a
      // tipos con campos: los demás ya van a revisión por regla propia.
      const nadaLeido =
        camposDe(datos.tipo).length > 0 && Object.values(extraido.campos).every((c) => c.valor === null);
      if (nadaLeido && !extraido.tipoDetectado) {
        banderas.push({
          codigo: 'C2_SIN_LECTURA_AUTOMATICA',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: 'El documento no pudo leerse automáticamente (sin capa de texto o sin modelo de extracción); requiere revisión humana',
          mensajeUsuario: 'Su documento quedó en revisión del docente: el sistema no pudo leerlo automáticamente.',
        });
      }
      banderas.push(...this.banderasPorCriterios(extraido));
      // Los tipos sin campos de extracción (informes, entregables, formatos de
      // cierre) los decide siempre una persona: la lectura asistida solo le
      // adelanta el trabajo con el resumen y los criterios respondidos.
      if (camposDe(datos.tipo).length === 0) {
        banderas.push({
          codigo: 'C2_REVISION_HUMANA_OBLIGATORIA',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: 'Este tipo documental se revisa siempre por una persona; la lectura automática solo orienta',
          mensajeUsuario: 'Su documento quedó en revisión del docente.',
        });
      }
      // Clasificación documental local: se LEYÓ y trae señales de otro tipo de documento (no es lo mismo que no poder leerlo).
      if (datos.tipo === TipoDocumento.CERTIFICADO_EPS && extraido.lecturaLocal?.clasificacion?.tipo === 'documento_incorrecto') {
        banderas.push({
          codigo: 'C2_TIPO_INCORRECTO',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: 'El archivo no parece un certificado de afiliación a EPS: se detectaron indicadores de otro tipo de certificación',
          mensajeUsuario:
            'El archivo cargado no corresponde al documento solicitado. ' +
            `Revise que esté enviando el ${etiqueta(datos.tipo)}.`,
        });
      } else if (datos.tipo === TipoDocumento.ACTA_INICIO && extraido.lecturaActa?.clasificacion.tipoActaDetectada === 'documento_incorrecto') {
        // El acta tiene su propio clasificador local: se LEYÓ y es otro documento (distinto de no poder leerlo).
        banderas.push({
          codigo: 'C2_TIPO_INCORRECTO',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: 'El archivo no parece un acta de iniciación de prácticas: se detectaron rasgos de otro tipo de documento',
          mensajeUsuario:
            'El archivo cargado no corresponde al documento solicitado. ' +
            `Revise que esté enviando el ${etiqueta(datos.tipo)}.`,
        });
      } else if (
        (datos.tipo === TipoDocumento.RUT_NATURAL || datos.tipo === TipoDocumento.RUT_JURIDICO)
        && extraido.lecturaRut
        && ['documento_incorrecto', 'camara_matricula_persona_natural', 'camara_matricula_sociedad', 'camara_existencia_representacion'].includes(extraido.lecturaRut.tipoDetectado)
      ) {
        // El RUT tiene su propio clasificador local: se LEYÓ y es otro documento (una factura, un certificado de cámara…).
        banderas.push({
          codigo: 'C2_TIPO_INCORRECTO',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: 'El archivo no parece un RUT: se detectaron rasgos de otro tipo de documento',
          mensajeUsuario:
            'El archivo cargado no corresponde al documento solicitado. ' +
            `Revise que esté enviando el ${etiqueta(datos.tipo)}.`,
        });
      } else if (datos.tipo === TipoDocumento.CAMARA_COMERCIO && extraido.lecturaCamara?.tipoDetectado === ClasificacionDocumentoEmpresarial.DOCUMENTO_INCORRECTO) {
        // La Cámara tiene su propio clasificador local: se LEYÓ y es otro documento (p. ej. una factura emitida por una Cámara).
        banderas.push({
          codigo: 'C2_TIPO_INCORRECTO',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: 'El archivo no parece un certificado de Cámara de Comercio: se detectaron rasgos de otro tipo de documento',
          mensajeUsuario:
            'El archivo cargado no corresponde al documento solicitado. ' +
            `Revise que esté enviando el ${etiqueta(datos.tipo)}.`,
        });
      } else if (extraido.tipoDetectado && extraido.tipoDetectado !== datos.tipo) {
        banderas.push({
          codigo: 'C2_TIPO_INCORRECTO',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: `Se esperaba ${datos.tipo} y el documento parece ser ${extraido.tipoDetectado}`,
          mensajeUsuario:
            `El archivo cargado no corresponde al documento solicitado. ` +
            `Revise que esté enviando el ${etiqueta(datos.tipo)}.`,
        });
      }
    }

    // ── Capa 3 — coherencia cruzada ───────────────────────────────────────
    const practica = await this.practicas.buscarPorId(datos.practicaId);
    if (practica && extraido) {
      const hermanos = await this.documentos.listarPorPractica(datos.practicaId);
      const extracciones: Record<string, ResultadoExtraccion> = { [datos.tipo]: extraido };
      for (const h of hermanos) {
        const hd = h.instantanea();
        if (h.id !== documento.id && hd.extraccion) {
          extracciones[hd.tipo] = hd.extraccion as unknown as ResultadoExtraccion;
        }
      }
      const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
      banderas.push(
        ...(await this.coherencia.evaluar(extracciones, {
          nitEmpresa: null,
          fechaInicio: practica.fechaInicio,
          nombreEstudiante: estudiante?.nombre ?? '',
          documentoEstudiante: estudiante?.instantanea().documento ?? null,
          diasVigenciaEps: datos.tipo === TipoDocumento.CERTIFICADO_EPS
            ? await this.parametros.numero('arl.dias_vigencia_eps')
            : undefined,
        })),
      );
    }

    // ── Capa 5 — puntaje y decisión ───────────────────────────────────────
    // Los umbrales se leen ahora, no al compilar: la Dirección los calibra
    // durante el piloto y el cambio surte efecto sin desplegar.
    // Los tipos con decisión especializada (§7.36) NUNCA se aprueban por la banda verde, con o sin motor encendido: solo su
    // política especializada puede aprobarlos. Sin condicionales por interruptor aquí.
    const permiteAutoAprobacion = permiteAutoAprobacionDelPipeline(datos.tipo);
    if (TIPOS_CON_DECISION_ESPECIALIZADA.includes(datos.tipo) && modoProcesamientoDe(datos.tipo) !== ModoProcesamiento.LOCAL) {
      banderas.push({
        codigo: 'C3_DECISION_POR_MOTOR_ESPECIALIZADO',
        capa: 3,
        severidad: SeveridadBandera.INFORMATIVA,
        mensaje: 'Este tipo lo decide su motor especializado, no el puntaje del pipeline',
      });
    } else if (!permiteAutoAprobacion) {
      banderas.push({
        codigo: 'C3_AUTOAPROBACION_NO_HABILITADA',
        capa: 3,
        severidad: SeveridadBandera.INFORMATIVA,
        mensaje:
          'Este tipo no se autoaprueba por el pipeline: su autenticidad no se verifica aquí; ' +
          'lo decide una persona',
      });
    }
    const puntaje = this.forense.calcularPuntaje(banderas);
    const lecturaGuardada = extraido ?? lecturaFallida;
    documento.aplicarResultadoPipeline(
      puntaje,
      banderas,
      lecturaGuardada ? this.conFechaDeLectura(lecturaGuardada, datos.extraccion) : null,
      new Date(),
      await this.parametros.umbralesPipeline(),
      { permiteAutoAprobacion },
    );

    this.log.log(
      `Documento ${documentoId}: puntaje ${puntaje}, banda ${documento.banda}, ` +
        `${banderas.length} bandera(s), estado ${documento.estado}`,
    );
    return this.finalizar(documento);
  }

  /**
   * La lectura se guarda con su fecha: el tope diario y la página de costos la
   * necesitan. Si el documento ya tenía una lectura (re-ejecución del
   * pipeline), su gasto no desaparece: se arrastra en `gastoPrevioUsd`.
   */
  private conFechaDeLectura(
    extraido: ResultadoExtraccion,
    anterior: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const previo = anterior as { costoUsd?: unknown; gastoPrevioUsd?: unknown } | null;
    const gastoPrevioUsd = redondearUsd(numero(previo?.costoUsd) + numero(previo?.gastoPrevioUsd));
    return {
      ...(extraido as unknown as Record<string, unknown>),
      leidoEn: new Date().toISOString(),
      ...(gastoPrevioUsd > 0 ? { gastoPrevioUsd } : {}),
    };
  }

  /**
   * Lectura que el proveedor facturó pero no sirvió (respuesta incompleta,
   * rehusada o inválida). Sin campos ni hallazgos; con tokens, costo y motivo.
   */
  private lecturaFallida(error: Error): ResultadoExtraccion | null {
    const uso = (error as { uso?: {
      modelo: string; tokensEntrada: number; tokensSalida: number; tokensCache: number;
      tokensRazonamiento: number; costoUsd: number;
    } | null }).uso;
    if (!uso) return null;
    return {
      tipoDetectado: null,
      campos: {},
      ilegible: false,
      modelo: uso.modelo,
      tokensEntrada: uso.tokensEntrada,
      tokensSalida: uso.tokensSalida,
      costoUsd: uso.costoUsd,
      hallazgos: [],
      resumen: null,
      proveedor: 'openai',
      tokensCache: uso.tokensCache,
      tokensRazonamiento: uso.tokensRazonamiento,
      ...{ fallida: true, error: error.message.slice(0, 300) },
    };
  }

  /** Suma tokens y costo de una lectura descartada a la que se conserva. */
  private acumularGasto(conservada: ResultadoExtraccion, descartada: ResultadoExtraccion): ResultadoExtraccion {
    return {
      ...conservada,
      tokensEntrada: conservada.tokensEntrada + descartada.tokensEntrada,
      tokensSalida: conservada.tokensSalida + descartada.tokensSalida,
      costoUsd: redondearUsd(conservada.costoUsd + descartada.costoUsd),
      tokensCache: (conservada.tokensCache ?? 0) + (descartada.tokensCache ?? 0),
      tokensRazonamiento: (conservada.tokensRazonamiento ?? 0) + (descartada.tokensRazonamiento ?? 0),
      duracionMs: (conservada.duracionMs ?? 0) + (descartada.duracionMs ?? 0),
      intentos: 2,
    } as ResultadoExtraccion & { intentos: number };
  }

  /**
   * Tope de gasto diario (parámetro operativo `ia.tope_diario_usd`, hora de
   * Colombia). Alcanzado, la capa 2 se omite y el documento va a revisión.
   */
  private async topeDiarioAlcanzado(): Promise<{ tope: number; gastado: number } | null> {
    const tope = await this.topeDiarioVigente();
    if (!(tope > 0)) return null;
    const gastado = await this.documentos.gastoIaDesde(inicioDelDiaEnColombia(new Date()));
    return gastado >= tope ? { tope, gastado } : null;
  }

  /**
   * En el ambiente abierto (ingreso sin contraseña) cualquiera puede tomar el
   * perfil administrador y subir el parámetro: por eso allí el tope nunca
   * supera el techo fijado por despliegue (`IA_TOPE_DIARIO_USD`), que solo
   * cambia quien despliega. En OIDC manda el parámetro.
   */
  private async topeDiarioVigente(): Promise<number> {
    const parametro = await this.parametros.numero('ia.tope_diario_usd');
    if (this.config?.get<string>('AUTH_MODO') !== 'abierto') return parametro;
    const techo = Number(this.config.get<string | number>('IA_TOPE_DIARIO_USD') ?? 50);
    if (!Number.isFinite(techo) || techo <= 0) return parametro;
    return parametro > 0 ? Math.min(parametro, techo) : techo;
  }

  /**
   * Límite de lecturas automáticas por práctica y día (parámetro
   * `ia.lecturas_por_practica_dia`). Frena a quien cargue en bucle; el
   * documento igual entra y lo revisa una persona.
   */
  private async limitePorPracticaAlcanzado(
    practicaId: string,
  ): Promise<{ limite: number; lecturas: number } | null> {
    const limite = await this.parametros.numero('ia.lecturas_por_practica_dia');
    if (!(limite > 0)) return null;
    const lecturas = await this.documentos.contarLecturasDesde(practicaId, inicioDelDiaEnColombia(new Date()));
    return lecturas >= limite ? { limite, lecturas } : null;
  }

  /**
   * Criterios del manual que el modelo respondió «no». No es un juicio de
   * autenticidad: es «lo que se ve no cumple lo que el manual pide», y por eso
   * manda a revisión humana, nunca a rechazo. Lo no determinable se anota
   * para el revisor sin pesar en el puntaje.
   */
  private banderasPorCriterios(extraido: ResultadoExtraccion): Bandera[] {
    const banderas: Bandera[] = [];
    const hallazgos = extraido.hallazgos ?? [];
    for (const h of hallazgos) {
      if (h.cumple !== 'no') continue;
      banderas.push({
        codigo: `C2_CRITERIO_${h.codigo}`,
        capa: 2,
        severidad: SeveridadBandera.ALTA,
        mensaje:
          `Criterio del manual no cumplido según la lectura (${h.codigo}): ${h.enunciado}` +
          (h.detalle ? ` — ${h.detalle}` : ''),
        // Al estudiante solo le sirve el detalle concreto del modelo; el
        // enunciado del criterio está redactado para el revisor.
        mensajeUsuario: h.causalDevolucion && h.detalle
          ? `Revise su documento: ${h.detalle}`
          : 'Su documento quedó en revisión del docente.',
      });
    }
    const noDeterminables = hallazgos.filter((h) => h.cumple === 'no_determinable');
    if (noDeterminables.length > 0) {
      banderas.push({
        codigo: 'C2_CRITERIOS_NO_DETERMINABLES',
        capa: 2,
        severidad: SeveridadBandera.INFORMATIVA,
        mensaje:
          `${noDeterminables.length} criterio(s) del manual no se pudieron determinar con el documento: ` +
          noDeterminables.map((h) => h.codigo).join(', '),
      });
    }
    return banderas;
  }

  /**
   * Lee el PDF417 del reverso de la cédula, cuando el documento es de ese tipo.
   *
   * Devuelve una extracción ya resuelta cuando el código se leyó: en ese caso
   * el pipeline termina ahí, sin llamar a la IA. Los datos del código llevan
   * corrección de errores; los del OCR, no.
   */
  private async leerCedula(
    documento: Documento,
    contenido: Buffer,
  ): Promise<{ banderas: Bandera[]; extraccion: ResultadoExtraccion | null } | null> {
    const datos = documento.instantanea();
    if (datos.tipo !== TipoDocumento.CEDULA) return null;
    if (!datos.mimeReal.startsWith('image/')) return null;

    const codigo = await this.lectorCodigos.leerPdf417(contenido, datos.mimeReal);
    if (!codigo.encontrado) {
      // No es una falla: muchas capturas son del anverso, o el código no entra
      // en el encuadre. El pipeline continúa con la extracción normal.
      return {
        banderas: [
          {
            codigo: 'C0_SIN_PDF417',
            capa: 0,
            severidad: SeveridadBandera.INFORMATIVA,
            mensaje: 'No se encontró el código PDF417; se continuará con la extracción asistida',
            mensajeUsuario:
              'Si fotografía el reverso del documento, el sistema lee los datos directamente ' +
              'del código de barras y no necesita interpretarlos.',
          },
        ],
        extraccion: null,
      };
    }

    const lectura = this.pdf417.interpretar(codigo.contenido);
    if (!lectura.leida || !lectura.cedula) {
      return {
        banderas: [
          {
            codigo: 'C0_PDF417_NO_INTERPRETABLE',
            capa: 0,
            severidad: SeveridadBandera.MEDIA,
            mensaje: lectura.motivo ?? 'El código leído no corresponde a una cédula colombiana',
            mensajeUsuario: lectura.motivo,
          },
        ],
        extraccion: null,
      };
    }

    const cedula = lectura.cedula;
    const banderas: Bandera[] = [];

    if (cedula.verificacionAritmetica === false) {
      banderas.push({
        codigo: 'C0_NUIP_DIGITO_INVALIDO',
        capa: 0,
        severidad: SeveridadBandera.ALTA,
        mensaje:
          `El dígito de verificación del número ${cedula.numeroDocumento} no cuadra ` +
          'con el resto del NUIP',
      });
    }

    // El titular del documento debe ser el estudiante matriculado. La
    // comparación devuelve null mientras la disposición de la trama no esté
    // conciliada: acusar a un estudiante con nombres leídos de posiciones
    // supuestas sería peor que no comprobar nada.
    const practica = await this.practicas.buscarPorId(datos.practicaId);
    const estudiante = practica ? await this.usuarios.buscarPorId(practica.estudianteId) : null;
    if (estudiante) {
      const corresponde = this.pdf417.correspondeA(cedula, estudiante.nombre);
      if (corresponde === false) {
        banderas.push({
          codigo: 'C0_CEDULA_OTRO_TITULAR',
          capa: 0,
          severidad: SeveridadBandera.CRITICA,
          mensaje:
            `El documento está a nombre de "${cedula.nombres} ${cedula.primerApellido}" ` +
            `y el expediente es de "${estudiante.nombre}"`,
        });
      } else if (corresponde === null) {
        banderas.push({
          codigo: 'C0_TITULAR_NO_COMPROBABLE',
          capa: 0,
          severidad: SeveridadBandera.INFORMATIVA,
          mensaje:
            'No se comprobó la correspondencia del titular: la disposición de la trama del ' +
            'PDF417 está pendiente de conciliar con la Registraduría',
        });
      }
    }

    const extraccion: ResultadoExtraccion = {
      tipoDetectado: TipoDocumento.CEDULA,
      campos: {
        numero_documento: {
          valor: cedula.numeroDocumento,
          // Certeza plena: el dato no se interpretó, se leyó de un código con
          // corrección de errores.
          confianza: 1,
          evidencia: 'Código PDF417 del reverso del documento',
        },
        // El número se localiza por patrón y se comprueba aritméticamente: es
        // certeza plena. Los nombres dependen de posiciones aún no conciliadas,
        // así que se entregan con confianza 0 para que ninguna regla los dé por
        // buenos hasta que la disposición se confirme.
        nombres: {
          valor: cedula.nombres || null,
          confianza: cedula.disposicionConfirmada ? 1 : 0,
          evidencia: cedula.disposicionConfirmada ? 'Código PDF417' : null,
        },
        apellidos: {
          valor: `${cedula.primerApellido} ${cedula.segundoApellido}`.trim() || null,
          confianza: cedula.disposicionConfirmada ? 1 : 0,
          evidencia: cedula.disposicionConfirmada ? 'Código PDF417' : null,
        },
        fecha_nacimiento: {
          valor: cedula.fechaNacimiento,
          confianza: cedula.fechaNacimiento ? 1 : 0,
          evidencia: cedula.fechaNacimiento ? 'Código PDF417' : null,
        },
      },
      ilegible: false,
      modelo: 'pdf417-sin-ia',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
    };

    return { banderas, extraccion };
  }

  /**
   * Reintenta la extracción sobre una copia preprocesada.
   *
   * Devuelve null si la imagen no se puede decodificar, si el preprocesamiento
   * no cambió nada o si la segunda lectura falló. Si sigue ilegible lo dice la
   * propia extracción devuelta: el documento se devuelve al estudiante, que es
   * el resultado honesto, sin perder el costo de ese segundo intento.
   */
  private async reintentarConPreproceso(
    contenido: Buffer,
    mime: string,
    tipo: TipoDocumento,
    extractor: ExtraccionIaPort,
  ): Promise<{ extraccion: ResultadoExtraccion; pasos: PasoAplicado[] } | null> {
    if (mime === 'application/pdf') return null;

    const imagen = this.decodificador.decodificar(contenido, mime);
    if (!imagen) return null;

    const resultado = this.preproceso.procesar(imagen);
    if (resultado.pasos.length === 0) return null;

    try {
      const png = this.decodificador.codificarPng(resultado.imagen);
      const extraccion = await extractor.extraer(png, 'image/png', tipo);
      // Se devuelve aunque siga ilegible: esa lectura también costó.
      return { extraccion, pasos: resultado.pasos };
    } catch (error) {
      this.log.debug(`El reintento con preproceso falló: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * IA de rescate: pide a la IA SOLO los campos que la lectura local dejó vacíos o débiles. Defensa en profundidad:
   * aquí decide la política (compuerta 1) y el proveedor protegido vuelve a comprobar (compuerta 2).
   *
   * Garantías:
   *  · una sola llamada a `rescatar()` por ejecución (no hay bucle ni segundo intento);
   *  · nunca lanza: cualquier fallo devuelve la lectura base (con el gasto, si lo hubo);
   *  · «invocación» = la compuerta del proveedor pasó y se delegó al adaptador. Solo una invocación se audita,
   *    se cuenta en métricas y cuenta para el límite por práctica. Un rechazo de la compuerta no lo es;
   *  · no registra valores: solo nombres de campo, códigos y conteos.
   */
  private async intentarRescate(
    documento: Documento,
    contenido: Buffer,
    lectura: ResultadoExtraccion,
    banderas: Bandera[],
  ): Promise<ResultadoExtraccion> {
    const datos = documento.instantanea();
    const rescate = this.rescate;
    if (!rescate || (lectura as { fallida?: boolean }).fallida) return lectura;
    // Un documento de otro tipo no se manda a un proveedor externo «para recuperar campos».
    if (lecturaEsDeOtroTipo(datos.tipo, lectura)) return lectura;

    let camposSolicitados: string[];
    try {
      const suficiencia = evaluarSuficienciaLectura(datos.tipo, lectura);
      if (suficiencia.estado !== 'insuficiente') return lectura;
      const interruptores = interruptoresRescateIa(this.config);
      const ambiente = this.config?.get<string>('SIPRA_AMBIENTE');
      if (!autorizarRescateIa(datos.tipo, interruptores, ambiente).autorizado) return lectura;
      const decision = decidirRescateIa(datos.tipo, interruptores, suficiencia);
      if (!decision.permitido) return lectura;
      camposSolicitados = decision.camposSolicitados;

      const bloqueo = await this.presupuestoRescateAgotado(datos.practicaId);
      if (bloqueo) {
        this.log.warn(`Documento ${documento.id}: rescate con IA omitido por ${bloqueo}; pasa a revisión humana`);
        return this.registrarRescateNoInvocado(lectura, camposSolicitados, 'presupuesto', banderas);
      }
    } catch (error) {
      this.log.warn(`Documento ${documento.id}: no se pudo evaluar el rescate con IA (${(error as Error).name}); se omite`);
      return lectura;
    }

    // ── La única invocación ──────────────────────────────────────────────
    const inicio = Date.now();
    let respuesta: ResultadoRescateIa | null = null;
    let fallo: Error | null = null;
    try {
      respuesta = await rescate.rescatar({ contenido, mime: datos.mimeReal, tipo: datos.tipo, camposSolicitados });
    } catch (error) {
      fallo = error as Error;
    }

    if (fallo instanceof RescateIaNoAutorizadoError) {
      // La segunda compuerta no dejó pasar la llamada: no es una invocación (sin auditoría, métricas ni conteo).
      this.log.warn(`Documento ${documento.id}: el proveedor de rescate no autorizó la llamada (${fallo.motivo})`);
      return this.registrarRescateNoInvocado(lectura, camposSolicitados, 'error', banderas, false);
    }
    if (respuesta && !respuesta.invocado) return lectura; // nada válido que pedir: sin llamada, sin costo, sin rastro

    try {
      const entrada = fallo
        ? this.entradaDeFallo(camposSolicitados, fallo, Date.now() - inicio)
        : this.entradaDeRespuesta(datos.tipo, lectura, camposSolicitados, respuesta as ResultadoRescateIa);
      const { lectura: fusionada, metadatos } = incorporarRescate(lectura, entrada);
      banderas.push(...banderasDeRescate(metadatos));
      await this.registrarInvocacion(documento.id, datos.tipo, metadatos);
      this.log.log(
        `Documento ${documento.id}: rescate con IA ${metadatos.resultado} ` +
          `(${metadatos.camposRecuperados.length}/${metadatos.camposSolicitados.length} campos, ${metadatos.costoUsd} USD)`,
      );
      return fusionada;
    } catch (error) {
      // Un fallo interno tras la llamada no puede tumbar el documento ni perder el gasto.
      this.log.error(`Documento ${documento.id}: fallo al integrar el rescate con IA (${(error as Error).name})`);
      const { lectura: conGasto, metadatos } = incorporarRescate(lectura, {
        camposSolicitados, resultado: 'error', invocado: true, fusion: null,
        uso: respuesta ? usoDeRespuesta(respuesta) : this.usoFacturado(fallo, Date.now() - inicio),
      });
      banderas.push(...banderasDeRescate(metadatos));
      await this.registrarInvocacion(documento.id, datos.tipo, metadatos);
      return conGasto;
    }
  }

  private entradaDeRespuesta(
    tipo: TipoDocumento, lectura: ResultadoExtraccion, camposSolicitados: string[], respuesta: ResultadoRescateIa,
  ) {
    const fusion = fusionarLecturas(tipo, lectura, respuesta.campos);
    return {
      camposSolicitados,
      resultado: clasificarResultadoRescate(camposSolicitados.length, fusion) as ResultadoRescate,
      invocado: true,
      uso: usoDeRespuesta(respuesta),
      fusion,
    };
  }

  /** Fallo del proveedor (tiempo agotado, 429/5xx agotados, error definitivo, respuesta inválida), con lo facturado. */
  private entradaDeFallo(camposSolicitados: string[], fallo: Error, duracionMs: number) {
    const timeout = /timeout|timed out|aborted|abort/i.test(`${fallo.name} ${fallo.message}`);
    return {
      camposSolicitados,
      resultado: (timeout ? 'timeout' : 'error') as ResultadoRescate,
      invocado: true,
      uso: this.usoFacturado(fallo, duracionMs),
      fusion: null,
    };
  }

  /** Lo que el proveedor facturó aunque la respuesta no sirviera (mismo mecanismo que la lectura principal). */
  private usoFacturado(fallo: Error | null, duracionMs: number): UsoRescate | null {
    const uso = (fallo as { uso?: Omit<UsoRescate, 'proveedor' | 'duracionMs'> | null } | null)?.uso;
    if (!uso) return null;
    return {
      modelo: uso.modelo, proveedor: 'openai', tokensEntrada: uso.tokensEntrada, tokensSalida: uso.tokensSalida,
      tokensCache: uso.tokensCache, tokensRazonamiento: uso.tokensRazonamiento, costoUsd: uso.costoUsd, duracionMs,
    };
  }

  /**
   * Resultado sin llamada real (presupuesto agotado o compuerta del proveedor): deja la lectura como estaba, con
   * metadata `invocado: false` (salvo que `conMetadatos` sea false) y la bandera de «no disponible». No se audita ni
   * se cuenta como invocación.
   */
  private registrarRescateNoInvocado(
    lectura: ResultadoExtraccion,
    camposSolicitados: string[],
    resultado: ResultadoRescate,
    banderas: Bandera[],
    conMetadatos = true,
  ): ResultadoExtraccion {
    const { lectura: marcada, metadatos } = incorporarRescate(lectura, {
      camposSolicitados, resultado, invocado: false, uso: null, fusion: null,
    });
    banderas.push(...banderasDeRescate(metadatos));
    return conMetadatos ? marcada : lectura;
  }

  /** Auditoría (una vez) y métricas de UNA invocación real. Nunca lanza ni lleva valores. */
  private async registrarInvocacion(documentoId: string, tipo: TipoDocumento, m: MetadatosRescateIa): Promise<void> {
    try {
      this.metricas?.iaRescateInvocaciones.inc({ tipo, resultado: m.resultado });
      if (m.camposRecuperados.length > 0) this.metricas?.iaRescateCamposRecuperados.inc({ tipo }, m.camposRecuperados.length);
      if (m.costoUsd > 0) this.metricas?.iaRescateCosto.inc({ modelo: m.modelo ?? 'desconocido' }, m.costoUsd);
      if (m.duracionMs > 0) this.metricas?.iaRescateDuracion.observe({ tipo }, m.duracionMs / 1000);
    } catch (error) {
      this.log.warn(`Métricas del rescate con IA: no se registraron (${(error as Error).name})`);
    }
    try {
      await this.auditoria?.registrar({
        actorId: null,
        actorCorreo: 'sistema',
        actorRol: 'sistema',
        accion: AccionAuditada.LECTURA_RESCATE_IA,
        entidad: 'documento',
        entidadId: documentoId,
        justificacion: null,
        metadatos: {
          documentoId,
          tipo,
          resultado: m.resultado,
          modelo: m.modelo,
          duracionMs: m.duracionMs,
          tokensEntrada: m.tokensEntrada,
          tokensSalida: m.tokensSalida,
          costoUsd: m.costoUsd,
          camposSolicitados: m.camposSolicitados.length,
          camposRecuperados: m.camposRecuperados.length,
          discrepancias: m.discrepancias.length,
          requiereRevisionHumana: m.requiereRevisionHumana,
        },
        ip: null,
        agenteUsuario: null,
        ocurridoEn: new Date(),
      });
    } catch (error) {
      this.log.warn(`Auditoría del rescate con IA: no se registró (${(error as Error).name})`);
    }
  }

  /**
   * Presupuesto del rescate: tope diario de gasto y límite de lecturas de IA REALES por práctica. La lectura local
   * no cuenta (por eso no se usa `contarLecturasDesde`, que cuenta cualquier lectura). Si no se puede verificar, se
   * omite el rescate (la excepción la captura el llamador).
   */
  private async presupuestoRescateAgotado(practicaId: string): Promise<'tope_diario' | 'limite_por_practica' | null> {
    if (await this.topeDiarioAlcanzado()) return 'tope_diario';
    const limite = await this.parametros.numero('ia.lecturas_por_practica_dia');
    if (limite > 0) {
      const lecturas = await this.documentos.contarLecturasIaRealesDesde(practicaId, inicioDelDiaEnColombia(new Date()));
      if (lecturas >= limite) return 'limite_por_practica';
    }
    return null;
  }

  /**
   * Capa 0 — reutilización de la misma imagen entre expedientes.
   *
   * El hash criptográfico solo detecta el archivo idéntico. Basta recomprimir
   * la foto o recortarle un borde para burlarlo. El hash perceptual sobrevive a
   * esas ediciones, y es el control de mayor efectividad esperada sobre la
   * planilla de horas: un mismo documento presentado por varios estudiantes de
   * la misma empresa.
   */
  private async buscarImagenReutilizada(documento: Documento): Promise<Bandera[]> {
    const datos = documento.instantanea();
    if (!datos.hashPerceptual) return [];

    const candidatos = await this.documentos.listarHashesPerceptuales(
      datos.tipo,
      datos.practicaId,
    );

    const parecidos = candidatos
      .map((c) => ({ ...c, distancia: this.perceptual.distancia(datos.hashPerceptual!, c.hashPerceptual) }))
      .filter((c) => this.perceptual.esMismaImagen(datos.hashPerceptual!, c.hashPerceptual))
      .sort((a, b) => a.distancia - b.distancia);

    if (parecidos.length === 0) return [];

    return [
      {
        codigo: 'C0_IMAGEN_REUTILIZADA',
        capa: 0,
        severidad: SeveridadBandera.CRITICA,
        mensaje:
          `La misma imagen aparece en ${parecidos.length} expediente(s) distinto(s) ` +
          `(distancia perceptual mínima ${parecidos[0].distancia} de ${BITS_HASH_PERCEPTUAL}). ` +
          `Documentos: ${parecidos.slice(0, 5).map((p) => p.id).join(', ')}`,
      },
    ];
  }

  /** Refuerzo servidor de la captura guiada: el cliente puede mentir. */
  private evaluarCalidadCaptura(documento: Documento): Bandera[] {
    const calidad = documento.instantanea().calidadCaptura;
    if (!calidad) return [];
    const banderas: Bandera[] = [];

    if (calidad.varianzaLaplaciano < 100) {
      banderas.push({
        codigo: 'C0_NITIDEZ_INSUFICIENTE',
        capa: 0,
        severidad: SeveridadBandera.ALTA,
        mensaje: `Varianza del Laplaciano ${calidad.varianzaLaplaciano.toFixed(1)} (umbral 100)`,
        mensajeUsuario: 'La imagen está fuera de foco. Vuelva a tomarla sin mover el dispositivo.',
      });
    }
    if (calidad.porcentajeSaturados > 12) {
      banderas.push({
        codigo: 'C0_SOBREEXPUESTA',
        capa: 0,
        severidad: SeveridadBandera.MEDIA,
        mensaje: `${calidad.porcentajeSaturados.toFixed(1)}% de píxeles saturados`,
        mensajeUsuario: 'Hay reflejos o exceso de luz. Evite el flash directo sobre el papel.',
      });
    }
    if (calidad.anchoPx < 1000 || calidad.altoPx < 1000) {
      banderas.push({
        codigo: 'C0_RESOLUCION_BAJA',
        capa: 0,
        severidad: SeveridadBandera.MEDIA,
        mensaje: `Resolución ${calidad.anchoPx}×${calidad.altoPx}`,
        mensajeUsuario: 'La foto es demasiado pequeña. Acerque el documento y vuelva a capturarlo.',
      });
    }
    return banderas;
  }

  private banderasPorConfianza(extraido: ResultadoExtraccion): Bandera[] {
    const banderas: Bandera[] = [];
    for (const [campo, valor] of Object.entries(extraido.campos)) {
      if (valor.valor === null) {
        banderas.push({
          codigo: 'C2_CAMPO_AUSENTE',
          capa: 2,
          severidad: SeveridadBandera.ALTA,
          mensaje: `El campo "${campo}" no aparece en el documento`,
          mensajeUsuario: `Falta el dato: ${campo.replace(/_/g, ' ')}.`,
        });
      } else if (valor.confianza < 0.7) {
        banderas.push({
          codigo: 'C2_CONFIANZA_BAJA',
          capa: 2,
          severidad: SeveridadBandera.MEDIA,
          mensaje: `Confianza ${valor.confianza.toFixed(2)} en el campo "${campo}"`,
        });
      }
    }
    return banderas;
  }
}

function usoDeRespuesta(r: ResultadoRescateIa): UsoRescate {
  return {
    modelo: r.modelo, proveedor: r.proveedor, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida,
    tokensCache: r.tokensCache, tokensRazonamiento: r.tokensRazonamiento, costoUsd: r.costoUsd, duracionMs: r.duracionMs,
  };
}

/**
 * La lectura LEYÓ el documento y es de otro tipo (mismas señales que producen `C2_TIPO_INCORRECTO` más abajo):
 * no tiene sentido —ni es admisible— enviar a un proveedor externo un documento ajeno para «recuperar campos».
 */
function lecturaEsDeOtroTipo(tipo: TipoDocumento, lectura: ResultadoExtraccion): boolean {
  if (tipo === TipoDocumento.CERTIFICADO_EPS && lectura.lecturaLocal?.clasificacion?.tipo === 'documento_incorrecto') return true;
  if (tipo === TipoDocumento.ACTA_INICIO && lectura.lecturaActa?.clasificacion.tipoActaDetectada === 'documento_incorrecto') return true;
  if (
    (tipo === TipoDocumento.RUT_NATURAL || tipo === TipoDocumento.RUT_JURIDICO) && lectura.lecturaRut &&
    ['documento_incorrecto', 'camara_matricula_persona_natural', 'camara_matricula_sociedad', 'camara_existencia_representacion']
      .includes(lectura.lecturaRut.tipoDetectado)
  ) return true;
  if (tipo === TipoDocumento.CAMARA_COMERCIO && lectura.lecturaCamara?.tipoDetectado === ClasificacionDocumentoEmpresarial.DOCUMENTO_INCORRECTO) return true;
  return lectura.tipoDetectado !== null && lectura.tipoDetectado !== tipo;
}

function etiqueta(tipo: TipoDocumento): string {
  return tipo.replace(/_/g, ' ');
}

function numero(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function redondearUsd(valor: number): number {
  return Math.round(valor * 1e6) / 1e6;
}

export { inicioDelDiaEnColombia };

export { EstadoDocumento };
