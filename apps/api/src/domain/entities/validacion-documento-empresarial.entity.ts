import { randomUUID } from 'node:crypto';
import {
  AutenticidadDocumento, CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL, ClasificacionDocumentoEmpresarial as C,
  DatosCamaraExtraidos, DatosExtraidosEmpresariales, ESTADOS_DECIDIDOS_EMPRESARIAL, EstadoValidacionDocumentoEmpresarial as Estado, FamiliaDocumentoEmpresarial,
  MetodoLecturaEmpresarial, TipoPersona, autenticidadPorDefecto, familiaDe, personaDe,
} from './documento-empresarial';
import type { ComparacionDocumentoEmpresarial } from '../services/comparacion-documento-empresarial.domain-service';
import { validarAutenticidad } from '../services/autenticidad-documento-empresarial.domain-service';
import { clavesProhibidasEn } from '../services/minimizacion-documento-empresarial.domain-service';
import { esSha256 } from '../services/duplicados-documento-empresarial.domain-service';

/**
 * Validación de un documento empresarial (RUT o Cámara): lo que se INTERPRETÓ de UN documento (una versión). Una por
 * documento. Procesamiento y clasificación solamente: no hay decisión humana todavía (Bloque posterior).
 *
 * `revision` = «leído y clasificado; espera a una persona». Nunca aprueba nada.
 */

export class ValidacionDocumentoEmpresarialYaProcesadaError extends Error {
  constructor() {
    super('La validación del documento empresarial ya tiene un resultado y no se reprocesa');
    this.name = 'ValidacionDocumentoEmpresarialYaProcesadaError';
  }
}

export class ResultadoDocumentoEmpresarialInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Resultado de documento empresarial no válido: ${motivo}`);
    this.name = 'ResultadoDocumentoEmpresarialInvalidoError';
  }
}

export interface DatosValidacionDocumentoEmpresarial {
  id: string;
  documentoId: string;
  practicaId: string;
  estudianteId: string;
  /** Qué eligió el estudiante (`rut_natural`, `rut_juridico`, `camara_comercio`): una EXPECTATIVA, no la verdad. */
  tipoEsperado: string | null;
  /** Derivada de `tipoDetectado`. */
  familiaDocumento: FamiliaDocumentoEmpresarial | null;
  /** Lo que el documento ES, por su contenido. `null` = aún no procesado (también los documentos históricos). */
  tipoDetectado: C | null;
  tipoPersona: TipoPersona | null;
  /** Resultado de contrastar expectativa y detección (`coincide`, `persona_distinta`…). Nunca reclasifica. */
  expectativa: string | null;
  estado: Estado;
  /** Rondas de procesamiento (identifican las evidencias). */
  intentos: number;
  errorCodigo: string | null;
  metodoLectura: MetodoLecturaEmpresarial | null;
  /** 0–1. */
  confianza: number | null;
  lecturaDudosa: boolean;
  hashDocumento: string | null;
  /** Si el mismo archivo ya estaba en la práctica con el mismo tipo: el documento anterior. Se reporta; no se borra. */
  duplicadoDeDocumentoId: string | null;
  datosExtraidos: DatosExtraidosEmpresariales | null;
  comparacion: ComparacionDocumentoEmpresarial | null;
  autenticidad: AutenticidadDocumento;
  recibidaEn: Date | null;
  procesadaEn: Date | null;
  // ── Decisión humana ──
  decididoPor: string | null;
  decididoEn: Date | null;
  /** Código del catálogo de devolución; solo si se devolvió. */
  motivoDecision: string | null;
  // ── Reserva operativa (una persona a la vez) ──
  asignadoA: string | null;
  reservadoEn: Date | null;
  reservaHasta: Date | null;
  /**
   * Los datos de SIPRA cambiaron DESPUÉS de una decisión humana. La decisión (y la comparación con que se tomó) no se tocan:
   * solo queda constancia.
   */
  datosSipraCambiaronEn: Date | null;
  version: number;
  creadaEn: Date;
  actualizadaEn: Date;
}

export interface ResultadoProcesamientoEmpresarial {
  tipoDetectado: C;
  expectativa: string | null;
  metodoLectura: MetodoLecturaEmpresarial | null;
  confianza: number | null;
  lecturaDudosa: boolean;
  hashDocumento: string | null;
  duplicadoDeDocumentoId?: string | null;
  datosExtraidos: DatosExtraidosEmpresariales | null;
  comparacion: ComparacionDocumentoEmpresarial | null;
  autenticidad?: AutenticidadDocumento;
}

export class ValidacionDocumentoEmpresarial {
  private constructor(private datos: DatosValidacionDocumentoEmpresarial) {}

  static desde(datos: DatosValidacionDocumentoEmpresarial): ValidacionDocumentoEmpresarial {
    return new ValidacionDocumentoEmpresarial({ ...datos, autenticidad: { ...datos.autenticidad } });
  }

  static pendiente(base: {
    id: string; documentoId: string; practicaId: string; estudianteId: string; tipoEsperado: string | null;
    recibidaEn: Date | null; ahora: Date;
  }): ValidacionDocumentoEmpresarial {
    return new ValidacionDocumentoEmpresarial({
      id: base.id, documentoId: base.documentoId, practicaId: base.practicaId, estudianteId: base.estudianteId,
      tipoEsperado: base.tipoEsperado, familiaDocumento: null, tipoDetectado: null, tipoPersona: null, expectativa: null,
      estado: Estado.PENDIENTE, intentos: 0, errorCodigo: null, metodoLectura: null, confianza: null, lecturaDudosa: false,
      hashDocumento: null, duplicadoDeDocumentoId: null, datosExtraidos: null, comparacion: null,
      autenticidad: autenticidadPorDefecto(), recibidaEn: base.recibidaEn, procesadaEn: null,
      decididoPor: null, decididoEn: null, motivoDecision: null, asignadoA: null, reservadoEn: null, reservaHasta: null, datosSipraCambiaronEn: null,
      version: 1, creadaEn: base.ahora, actualizadaEn: base.ahora,
    });
  }

  get id(): string { return this.datos.id; }
  get documentoId(): string { return this.datos.documentoId; }
  get estado(): Estado { return this.datos.estado; }
  get version(): number { return this.datos.version; }
  get intentos(): number { return this.datos.intentos; }
  /** Ya tiene un resultado de lectura (en revisión o decidida): reprocesarla no hace falta ni se hace. */
  get estaProcesada(): boolean { return this.datos.estado === Estado.REVISION || this.estaDecidida; }
  get estaDecidida(): boolean { return ESTADOS_DECIDIDOS_EMPRESARIAL.includes(this.datos.estado); }
  /** Lista para que una persona la decida. */
  get estaRevisable(): boolean { return this.datos.estado === Estado.REVISION; }

  /** ¿La tiene reservada ESTA persona y sigue vigente? */
  reservadaPor(actorId: string, ahora: Date): boolean {
    return this.datos.asignadoA === actorId && this.datos.reservaHasta !== null && this.datos.reservaHasta.getTime() > ahora.getTime();
  }

  /** ¿Otra persona la tiene reservada y su reserva sigue vigente? */
  reservadaPorOtro(actorId: string, ahora: Date): boolean {
    return this.datos.asignadoA !== null && this.datos.asignadoA !== actorId
      && this.datos.reservaHasta !== null && this.datos.reservaHasta.getTime() > ahora.getTime();
  }

  instantanea(): DatosValidacionDocumentoEmpresarial { return { ...this.datos, autenticidad: { ...this.datos.autenticidad } }; }

  iniciarProcesamiento(ahora: Date): void {
    if (this.estaProcesada) throw new ValidacionDocumentoEmpresarialYaProcesadaError();
    if (this.datos.estado !== Estado.PROCESANDO) this.datos.intentos += 1;
    this.datos.estado = Estado.PROCESANDO;
    this.datos.errorCodigo = null;
    this.datos.actualizadaEn = ahora;
  }

  registrarResultado(r: ResultadoProcesamientoEmpresarial, ahora: Date): void {
    if (this.estaProcesada) throw new ValidacionDocumentoEmpresarialYaProcesadaError();
    const familia = familiaDe(r.tipoDetectado);
    const persona = personaDe(r.tipoDetectado);
    const sinContenido = r.tipoDetectado === C.DOCUMENTO_INCORRECTO || r.tipoDetectado === C.NO_DETERMINABLE;

    if (sinContenido && (r.datosExtraidos !== null || r.comparacion !== null)) {
      throw new ResultadoDocumentoEmpresarialInvalidoError('un documento incorrecto o no determinable no trae datos extraídos ni comparación');
    }
    if (r.datosExtraidos !== null) {
      if (r.datosExtraidos.tipoPersona !== persona) throw new ResultadoDocumentoEmpresarialInvalidoError('la persona de los datos no corresponde a la clasificación');
      const prohibidas = clavesProhibidasEn(r.datosExtraidos);
      if (prohibidas.length > 0) throw new ResultadoDocumentoEmpresarialInvalidoError(`claves no admitidas: ${prohibidas.join(', ')}`);
      if (r.tipoDetectado === C.CAMARA_MATRICULA_PERSONA_NATURAL && (r.datosExtraidos as DatosCamaraExtraidos).representanteLegal) {
        throw new ResultadoDocumentoEmpresarialInvalidoError('una matrícula de persona natural no tiene representante legal');
      }
      if (familia === FamiliaDocumentoEmpresarial.CAMARA) {
        const esperado = r.tipoDetectado === C.CAMARA_EXISTENCIA_REPRESENTACION ? 'existencia_representacion' : 'matricula_mercantil';
        if ((r.datosExtraidos as DatosCamaraExtraidos).tipoCertificado !== esperado) {
          throw new ResultadoDocumentoEmpresarialInvalidoError('el tipo de certificado de los datos no corresponde a la clasificación');
        }
      }
    }
    if (r.hashDocumento !== null && !esSha256(r.hashDocumento)) throw new ResultadoDocumentoEmpresarialInvalidoError('el hash no es un SHA-256');
    if (r.confianza !== null && (r.confianza < 0 || r.confianza > 1)) throw new ResultadoDocumentoEmpresarialInvalidoError('la confianza va de 0 a 1');
    const autenticidad = validarAutenticidad(r.autenticidad ?? autenticidadPorDefecto());

    this.datos = {
      ...this.datos,
      tipoDetectado: r.tipoDetectado, familiaDocumento: familia, tipoPersona: persona, expectativa: r.expectativa,
      metodoLectura: r.metodoLectura, confianza: r.confianza, lecturaDudosa: r.lecturaDudosa, hashDocumento: r.hashDocumento,
      duplicadoDeDocumentoId: r.duplicadoDeDocumentoId ?? null, datosExtraidos: r.datosExtraidos, comparacion: r.comparacion,
      autenticidad, estado: Estado.REVISION, errorCodigo: null, procesadaEn: ahora, actualizadaEn: ahora,
    };
  }

  /**
   * Cambiaron los datos de SIPRA y la validación sigue en revisión: se recalcula la comparación SIN releer el archivo y en
   * una ronda NUEVA (`intentos + 1`): las evidencias de las rondas anteriores se conservan intactas.
   */
  aplicarRecalculoComparacion(comparacion: ComparacionDocumentoEmpresarial, ahora: Date, expectativa?: string | null): void {
    if (this.datos.estado !== Estado.REVISION || this.datos.datosExtraidos === null) {
      throw new ResultadoDocumentoEmpresarialInvalidoError('solo una validación leída y en revisión admite recalcular la comparación');
    }
    this.datos.comparacion = comparacion;
    // La Cámara no distingue persona al elegir el tipo: la persona esperada sale de SIPRA y puede cambiar con él.
    if (expectativa !== undefined) this.datos.expectativa = expectativa;
    this.datos.intentos += 1;
    this.datos.actualizadaEn = ahora;
  }

  /** Refleja una decisión humana. No cambia ningún resultado de lectura ni de comparación; libera la reserva. */
  registrarDecision(decision: 'aprobar' | 'devolver' | 'rechazar', actorId: string, ahora: Date, motivo: string | null = null): void {
    if (this.estaDecidida) throw new ValidacionDocumentoEmpresarialYaProcesadaError();
    if (!this.estaRevisable) throw new ResultadoDocumentoEmpresarialInvalidoError('solo una validación en revisión admite una decisión');
    if (decision === 'devolver' && !motivo) throw new ResultadoDocumentoEmpresarialInvalidoError('devolver exige el motivo del catálogo');
    this.datos.estado = decision === 'aprobar' ? Estado.APROBADO_MANUAL : decision === 'devolver' ? Estado.DEVUELTO : Estado.RECHAZADO;
    this.datos.errorCodigo = null;
    this.datos.decididoPor = actorId;
    this.datos.decididoEn = ahora;
    this.datos.motivoDecision = decision === 'devolver' ? motivo : null;
    this.datos.asignadoA = null;
    this.datos.reservadoEn = null;
    this.datos.reservaHasta = null;
    this.datos.actualizadaEn = ahora;
  }

  /**
   * Cambiaron los datos de SIPRA DESPUÉS de una decisión: la decisión y la comparación con que se decidió son historia y no
   * se tocan; solo queda constancia, en una ronda nueva de evidencias.
   */
  marcarCambioDeDatosPosterior(ahora: Date): void {
    if (!this.estaDecidida) throw new ResultadoDocumentoEmpresarialInvalidoError('solo una validación decidida registra un cambio posterior de datos');
    this.datos.datosSipraCambiaronEn = ahora;
    this.datos.intentos += 1;
    this.datos.actualizadaEn = ahora;
  }

  marcarError(codigo: string, ahora: Date): void {
    if (this.estaProcesada) throw new ValidacionDocumentoEmpresarialYaProcesadaError();
    this.datos.estado = Estado.ERROR;
    this.datos.errorCodigo = codigo;
    this.datos.actualizadaEn = ahora;
  }
}

// ── Evidencias (solo inserción) ─────────────────────────────────────────────

export enum TipoEvidenciaDocumentoEmpresarial {
  LECTURA_DOCUMENTO = 'lectura_documento',
  CLASIFICACION = 'clasificacion',
  COMPARACION = 'comparacion',
  VERIFICACION = 'verificacion',
  DECISION_HUMANA = 'decision_humana',
  /** Los datos de SIPRA cambiaron después de una decisión humana (constancia; la decisión no se toca). */
  CAMBIO_DATOS_SIPRA = 'cambio_datos_sipra',
}

export class EvidenciaDocumentoEmpresarialInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Evidencia de documento empresarial no válida: ${motivo}`);
    this.name = 'EvidenciaDocumentoEmpresarialInvalidaError';
  }
}

export interface DatosEvidenciaDocumentoEmpresarial {
  id: string;
  validacionId: string;
  intento: number;
  tipo: TipoEvidenciaDocumentoEmpresarial;
  resultado: string;
  metodo: string;
  fecha: Date;
  actorId: string | null;
  hashDocumento: string | null;
  datos: Record<string, unknown>;
  errorCodigo: string | null;
  creadoEn: Date;
}

/** Además de las claves prohibidas de los datos extraídos, nunca van tokens, URLs con credenciales ni cookies. */
const CLAVES_PROHIBIDAS_EVIDENCIA: readonly string[] = [...CLAVES_PROHIBIDAS_DOCUMENTO_EMPRESARIAL, 'url_con_credenciales', 'credenciales'];

export class EvidenciaDocumentoEmpresarial {
  private constructor(private readonly datos: DatosEvidenciaDocumentoEmpresarial) {}

  static crear(d: DatosEvidenciaDocumentoEmpresarial): EvidenciaDocumentoEmpresarial {
    if (d.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA && !d.actorId) {
      throw new EvidenciaDocumentoEmpresarialInvalidaError('una decisión humana dice quién la tomó');
    }
    const prohibidas = [...Object.keys(d.datos), ...clavesProhibidasEn(d.datos)].filter((k) => CLAVES_PROHIBIDAS_EVIDENCIA.includes(k.split('.').pop() ?? k));
    if (prohibidas.length > 0) throw new EvidenciaDocumentoEmpresarialInvalidaError(`claves no admitidas: ${[...new Set(prohibidas)].join(', ')}`);
    if (d.hashDocumento !== null && !esSha256(d.hashDocumento)) throw new EvidenciaDocumentoEmpresarialInvalidaError('el hash no es un SHA-256');
    return new EvidenciaDocumentoEmpresarial({ ...d, datos: { ...d.datos } });
  }

  static desde(d: DatosEvidenciaDocumentoEmpresarial): EvidenciaDocumentoEmpresarial {
    return new EvidenciaDocumentoEmpresarial({ ...d, datos: { ...d.datos } });
  }

  instantanea(): DatosEvidenciaDocumentoEmpresarial { return { ...this.datos, datos: { ...this.datos.datos } }; }
}

/** Resumen de la lectura (métricas, nunca contenido). */
export interface ResumenLecturaEmpresarial {
  metodo: MetodoLecturaEmpresarial;
  paginas: number;
  paginasOcr: number;
  confianzaOcrMedia: number | null;
  lecturaDudosa: boolean;
  limitesAplicados?: string[];
}

export function evidenciaDeLectura(
  v: Pick<DatosValidacionDocumentoEmpresarial, 'id' | 'intentos' | 'hashDocumento'>, resumen: ResumenLecturaEmpresarial, ahora: Date,
): EvidenciaDocumentoEmpresarial {
  return EvidenciaDocumentoEmpresarial.crear({
    id: randomUUID(), validacionId: v.id, intento: v.intentos, tipo: TipoEvidenciaDocumentoEmpresarial.LECTURA_DOCUMENTO,
    resultado: resumen.lecturaDudosa ? 'dudosa' : 'legible', metodo: `lectura_local_${resumen.metodo}`, fecha: ahora, actorId: null,
    hashDocumento: v.hashDocumento,
    datos: {
      metodo: resumen.metodo, paginas: resumen.paginas, paginasOcr: resumen.paginasOcr, confianzaOcrMedia: resumen.confianzaOcrMedia,
      lecturaDudosa: resumen.lecturaDudosa, limitesAplicados: resumen.limitesAplicados ?? [],
    },
    errorCodigo: null, creadoEn: ahora,
  });
}

export function evidenciaDeClasificacion(
  v: Pick<DatosValidacionDocumentoEmpresarial, 'id' | 'intentos' | 'hashDocumento' | 'tipoEsperado' | 'tipoDetectado' | 'expectativa'>,
  motivos: readonly string[], ahora: Date,
): EvidenciaDocumentoEmpresarial {
  if (!v.tipoDetectado) throw new EvidenciaDocumentoEmpresarialInvalidaError('no hay clasificación que registrar');
  return EvidenciaDocumentoEmpresarial.crear({
    id: randomUUID(), validacionId: v.id, intento: v.intentos, tipo: TipoEvidenciaDocumentoEmpresarial.CLASIFICACION,
    resultado: v.tipoDetectado, metodo: 'clasificacion_por_contenido', fecha: ahora, actorId: null, hashDocumento: v.hashDocumento,
    datos: { tipoEsperado: v.tipoEsperado, tipoDetectado: v.tipoDetectado, expectativa: v.expectativa, motivos: [...motivos] },
    errorCodigo: null, creadoEn: ahora,
  });
}

/** Evidencia de comparación: campo, resultado y criticidad (nunca los valores), el veredicto y la huella de lo que SIPRA decía. */
export function evidenciaDeComparacion(
  v: Pick<DatosValidacionDocumentoEmpresarial, 'id' | 'intentos' | 'hashDocumento'>,
  comparacion: ComparacionDocumentoEmpresarial & { veredicto?: string; huellaSipra?: string }, ahora: Date, metodo = 'comparacion_rut_sipra',
): EvidenciaDocumentoEmpresarial {
  return EvidenciaDocumentoEmpresarial.crear({
    id: randomUUID(), validacionId: v.id, intento: v.intentos, tipo: TipoEvidenciaDocumentoEmpresarial.COMPARACION,
    resultado: comparacion.veredicto ?? (comparacion.hayDiscrepancia ? 'discrepancia' : 'consistente'), metodo,
    fecha: ahora, actorId: null, hashDocumento: v.hashDocumento,
    datos: {
      veredicto: comparacion.veredicto ?? null, hayDiscrepancia: comparacion.hayDiscrepancia, huellaSipra: comparacion.huellaSipra ?? null,
      campos: comparacion.campos.map((c) => ({ ...c })),
    },
    errorCodigo: null, creadoEn: ahora,
  });
}
