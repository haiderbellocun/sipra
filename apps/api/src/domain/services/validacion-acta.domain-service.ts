import {
  CAMPOS_ACTA, CAMPOS_ACTA_PERSISTIBLES, CampoActa, CampoLeidoActa, CamposActaLeidos, ClasificacionActa, ComparacionActa,
  ComparacionActaPersistida, DatosSipraActa, FirmasActa, LecturaActaPersistible,
  MAX_CARACTERES_FUNCIONES_PERSISTIDAS,
} from '../entities/acta-iniciacion';
import { DatosPractica } from '../entities/practica.entity';
import { DatosValidacionActa, ResultadoProcesamientoActa, TipoEvidenciaActa } from '../entities/validacion-acta.entity';
import { compararActaConSipra } from './comparacion-acta.domain-service';
import { CONFIANZA_TEXTO_NATIVO_ACTA } from './extraccion-acta.domain-service';
import { LecturaActaLocal } from './lectura-local-acta.domain-service';

/**
 * Del resultado de leer un acta a lo que se conserva de ella: minimización, comparación contra SIPRA y evidencias.
 * Dominio puro, sin base ni lectura: recibe el resultado ya minimizado y los datos que SIPRA ya tiene.
 *
 * Principios:
 *  · el acta CONFIRMA o CONTRADICE lo que SIPRA dice; jamás lo modifica ni lo completa;
 *  · lo que ya es canónico en Usuario, Práctica o Empresa no se copia a la validación (la comparación conserva el
 *    veredicto de cada campo, no el valor de SIPRA);
 *  · nada del texto del documento, ni imágenes de firma, sale de aquí.
 */

// ── Minimización ────────────────────────────────────────────────────────────

/** Reduce una lectura completa a lo conservable. Un documento que no es un acta no conserva datos extraídos. */
export function minimizarLecturaActa(lectura: LecturaActaLocal): LecturaActaPersistible {
  const { clasificacion, campos, firmas } = lectura.analisis;
  const esActa = clasificacion.tipoActaDetectada === 'iniciacion_practicas';
  const conservados: Partial<Record<CampoActa, CampoLeidoActa>> = {};
  if (esActa) {
    for (const nombre of CAMPOS_ACTA_PERSISTIBLES) {
      const c = campos[nombre];
      if (c.valor === null) continue;
      const valor = nombre === 'funciones' ? c.valor.slice(0, MAX_CARACTERES_FUNCIONES_PERSISTIDAS) : c.valor;
      conservados[nombre] = { valor, confianza: c.confianza, fuente: c.fuente };
    }
  }
  const r = lectura.resumen;
  return {
    clasificacion,
    lecturaDudosa: lectura.analisis.lecturaDudosa,
    campos: conservados,
    firmas: esActa ? firmas : { ...firmas, firmaEmpresaPresente: 'no_determinable', firmaPracticantePresente: 'no_determinable' },
    lectura: {
      metodoLectura: r.metodoLectura,
      paginas: r.paginas,
      paginasLeidas: r.paginasLeidas,
      paginasOcr: [...r.paginasOcr],
      intentosOcr: r.intentosOcr,
      confianzaOcrMedia: r.confianzaOcrMedia,
      suficiencia: {
        paraClasificar: r.suficiencia.paraClasificar, paraComparar: r.suficiencia.paraComparar,
        senalesLeidas: r.suficiencia.senalesLeidas, camposClaveLeidos: r.suficiencia.camposClaveLeidos,
      },
      firmasUbicadas: { ...r.firmas },
      limitesAplicados: [...r.limitesAplicados],
      errores: [...r.errores],
    },
  };
}

/** Vuelve a la forma completa que espera el dominio: lo no conservado es «no leído». */
export function hidratarCampos(conservados: Partial<Record<CampoActa, CampoLeidoActa>>): CamposActaLeidos {
  const salida = {} as Record<CampoActa, CampoLeidoActa>;
  for (const nombre of CAMPOS_ACTA) salida[nombre] = conservados[nombre] ?? { valor: null, confianza: 0, fuente: null };
  return salida;
}

export function comparacionAPersistida(c: ComparacionActa, ahora: Date): ComparacionActaPersistida {
  return {
    veredicto: c.veredicto,
    comparadaEn: ahora.toISOString(),
    resumen: { ...c.resumen },
    campos: c.campos.map((f) => ({ campo: f.campo, resultado: f.resultado, criticidad: f.criticidad, nota: f.nota })),
    discrepancias: c.discrepancias.map((d) => ({ campo: d.campo, codigo: d.codigo, severidad: d.severidad })),
  };
}

// ── Datos de SIPRA contra los que se compara ────────────────────────────────

export interface FuentesSipraActa {
  practica: DatosPractica;
  /** Usuario / matrícula del estudiante. */
  estudiante: { nombre: string; documento: string | null };
  /** La empresa habilitada vinculada a la práctica, si la hay. */
  empresa: { razonSocial: string; nit: string } | null;
  /** Nombre del programa (SINU), si se pudo leer. */
  programa: string | null;
}

/**
 * Lo que SIPRA sabe, tomado de sus fuentes canónicas. La remuneración esperada es el campo YA existente de la
 * práctica (`tipoRemuneracion`) y el responsable de la ARL el acuerdo explícito de la práctica: si es `null`
 * (registro histórico) queda `null` y la comparación dirá «información insuficiente». NUNCA se deriva de la
 * modalidad para fabricar una comparación.
 */
export function datosSipraDePractica(f: FuentesSipraActa): DatosSipraActa {
  const p = f.practica;
  return {
    estudianteNombre: f.estudiante.nombre,
    estudianteDocumento: f.estudiante.documento,
    programa: f.programa,
    empresaRazonSocial: f.empresa?.razonSocial ?? p.empresaRazonSocial,
    empresaNit: f.empresa?.nit ?? p.empresaNit,
    modalidad: p.modalidad,
    remuneracionEsperada: p.tipoRemuneracion,
    responsableArlEsperado: p.responsableArlPractica,
    fechaInicio: p.fechaInicio,
    fechaFin: p.fechaFin,
    jefeInmediatoNombre: p.jefeInmediatoNombre,
    funciones: p.funcionesRelevantes,
  };
}

// ── Resolución ──────────────────────────────────────────────────────────────

export interface BorradorEvidenciaActa {
  tipo: TipoEvidenciaActa;
  resultado: string;
  metodo: string;
  datos: Record<string, unknown>;
}

export interface ResolucionValidacionActa {
  resultado: ResultadoProcesamientoActa;
  evidencias: BorradorEvidenciaActa[];
}

const FIRMA_SIN_DETERMINAR: Pick<FirmasActa, 'firmaEmpresaPresente' | 'firmaPracticantePresente'> = {
  firmaEmpresaPresente: 'no_determinable', firmaPracticantePresente: 'no_determinable',
};

/**
 * Construye lo que se persiste de un procesamiento. `lectura = null` = no hubo lectura automática (límite, interruptor,
 * fallo): queda `no_determinable`, nunca «incorrecto» ni rechazado.
 */
export function resolverValidacionActa(
  lectura: LecturaActaPersistible | null, sipra: DatosSipraActa, ahora: Date,
): ResolucionValidacionActa {
  if (!lectura) {
    return {
      resultado: {
        tipoActaDetectada: 'no_determinable', remuneracionDetectada: 'no_determinable', responsableArlDetectado: 'no_determinable',
        firmaEmpresa: 'no_determinable', firmaPracticante: 'no_determinable', metodoLectura: null, confianza: null,
        motivosClasificacion: ['sin_lectura_automatica'], datosExtraidos: null, comparacion: null, hayDiscrepanciaCritica: false,
      },
      evidencias: [{ tipo: TipoEvidenciaActa.LECTURA_DOCUMENTO, resultado: 'sin_lectura', metodo: 'lectura_local_acta', datos: { procesamiento: 'local' } }],
    };
  }

  const { clasificacion: c, firmas, lectura: l } = lectura;
  const esActa = c.tipoActaDetectada === 'iniciacion_practicas';

  // Un documento que no es un acta (o no se pudo determinar) NO trae remuneración, ARL ni firmas «válidas».
  const remuneracion = esActa ? c.remuneracion : 'no_determinable';
  const arl = esActa ? c.responsableArl : 'no_determinable';
  const firmaEmpresa = esActa ? firmas.firmaEmpresaPresente : FIRMA_SIN_DETERMINAR.firmaEmpresaPresente;
  const firmaPracticante = esActa ? firmas.firmaPracticantePresente : FIRMA_SIN_DETERMINAR.firmaPracticantePresente;

  const comparacion = esActa
    ? comparacionAPersistida(compararActaConSipra({ clasificacion: c, campos: hidratarCampos(lectura.campos), lecturaDudosa: lectura.lecturaDudosa === true }, sipra), ahora)
    : null;
  const hayCritica = comparacion !== null && comparacion.discrepancias.some((d) => d.severidad === 'critica');

  const confianza = l.metodoLectura === 'ocr'
    ? (l.confianzaOcrMedia === null ? null : Math.max(0, Math.min(1, l.confianzaOcrMedia / 100)))
    : CONFIANZA_TEXTO_NATIVO_ACTA;

  const metodo = l.metodoLectura === 'ocr' ? 'ocr_local_tesseract_spa' : 'texto_nativo_pdfjs';
  const evidencias: BorradorEvidenciaActa[] = [
    {
      tipo: TipoEvidenciaActa.LECTURA_DOCUMENTO,
      resultado: l.suficiencia.paraClasificar ? 'leido' : 'lectura_insuficiente',
      metodo,
      datos: {
        procesamiento: 'local', metodoLectura: l.metodoLectura, paginas: l.paginas, paginasLeidas: l.paginasLeidas,
        paginasOcr: l.paginasOcr, intentosOcr: l.intentosOcr, confianzaOcrMedia: l.confianzaOcrMedia,
        suficiencia: l.suficiencia, limitesAplicados: l.limitesAplicados, errores: l.errores,
        lecturaDudosa: lectura.lecturaDudosa === true,
      },
    },
    {
      tipo: TipoEvidenciaActa.CLASIFICACION_DOCUMENTAL,
      resultado: c.tipoActaDetectada,
      metodo: 'clasificacion_local_acta',
      datos: {
        motivos: c.motivos, puntajeActa: c.puntajeActa, puntajeAjeno: c.puntajeAjeno, documentoAjeno: c.documentoAjeno,
        remuneracion, responsableArl: arl, confianzaRemuneracion: c.confianzaRemuneracion,
        confianzaResponsableArl: c.confianzaResponsableArl, senales: c.senales,
        discrepanciasDocumento: c.discrepanciasDocumento.map((d) => d.codigo),
      },
    },
    {
      tipo: TipoEvidenciaActa.COMPARACION,
      resultado: comparacion ? comparacion.veredicto : 'no_aplicable',
      metodo: 'comparacion_acta_vs_sipra',
      datos: comparacion
        ? {
          resumen: comparacion.resumen,
          camposDiferentes: comparacion.campos.filter((f) => f.resultado === 'diferente').map((f) => f.campo),
          camposInsuficientes: comparacion.campos.filter((f) => f.resultado === 'informacion_insuficiente').map((f) => f.campo),
          discrepancias: comparacion.discrepancias.map((d) => d.codigo),
        }
        : { motivo: 'el documento no es un acta de iniciación' },
    },
    {
      tipo: TipoEvidenciaActa.MEDICION_FIRMAS,
      resultado: !esActa ? 'no_aplicable' : (l.firmasUbicadas.empresaLocalizada || l.firmasUbicadas.practicanteLocalizada) ? 'medida' : 'no_localizada',
      metodo: 'medicion_zona_firma_local',
      // Solo presencia probable y dónde se buscó: ninguna imagen, ningún juicio de autenticidad.
      datos: esActa
        ? {
          pagina: l.firmasUbicadas.pagina, empresaLocalizada: l.firmasUbicadas.empresaLocalizada,
          practicanteLocalizada: l.firmasUbicadas.practicanteLocalizada, firmaEmpresa, firmaPracticante, motivos: firmas.motivos,
        }
        : { motivo: 'el documento no es un acta de iniciación' },
    },
    {
      tipo: TipoEvidenciaActa.PROCESAMIENTO,
      resultado: 'revision',
      metodo: 'validacion_acta_local',
      datos: { tipoActaDetectada: c.tipoActaDetectada, hayDiscrepanciaCritica: hayCritica, camposConservados: Object.keys(lectura.campos).length },
    },
  ];

  return {
    resultado: {
      tipoActaDetectada: c.tipoActaDetectada, remuneracionDetectada: remuneracion, responsableArlDetectado: arl,
      firmaEmpresa, firmaPracticante, metodoLectura: l.metodoLectura, confianza,
      motivosClasificacion: [...c.motivos],
      datosExtraidos: esActa ? { campos: { ...lectura.campos }, ...(lectura.lecturaDudosa ? { lecturaDudosa: true } : {}) } : null,
      comparacion, hayDiscrepanciaCritica: hayCritica,
    },
    evidencias,
  };
}

// ── Recalcular la comparación cuando cambian los datos de la práctica ───────

const MENSAJE_DISCREPANCIA_DOCUMENTO: Readonly<Record<string, string>> = {
  ARL_ENCABEZADO_VS_OBLIGACIONES: 'El encabezado y las obligaciones del acta no coinciden sobre quién asume la ARL.',
  ARL_ENCABEZADO_AMBIGUO: 'El encabezado menciona a la CUN y a la empresa como responsables de la ARL.',
  ARL_OBLIGACIONES_AMBIGUAS: 'La obligación de afiliar a la ARL figura en las obligaciones de la empresa y de la institución.',
  REMUNERACION_AMBIGUA: 'El documento se presenta a la vez como remunerado y no remunerado.',
  TIPO_ACTA_NO_CONFIRMADO: 'No se pudo confirmar que el documento sea un acta de iniciación de prácticas.',
};

/**
 * Lo que la validación conserva basta para comparar de nuevo contra datos de SIPRA que cambiaron (la comparación es una
 * función pura de la lectura y de SIPRA): clasificación (columnas y discrepancias del documento) y campos conservados.
 * No relee el archivo ni lo toca.
 */
export function recalcularComparacion(
  v: Pick<DatosValidacionActa, 'tipoActaDetectada' | 'remuneracionDetectada' | 'responsableArlDetectado' | 'motivosClasificacion' | 'datosExtraidos' | 'comparacion'>,
  sipra: DatosSipraActa, ahora: Date,
): { comparacion: ComparacionActaPersistida; hayDiscrepanciaCritica: boolean; completa: ComparacionActa } | null {
  if (v.tipoActaDetectada !== 'iniciacion_practicas') return null;
  const discrepanciasDocumento = (v.comparacion?.discrepancias ?? [])
    .filter((d) => d.campo === 'documento_acta')
    .map((d) => ({ codigo: d.codigo as never, severidad: 'critica' as const, mensaje: MENSAJE_DISCREPANCIA_DOCUMENTO[d.codigo] ?? 'Discrepancia del documento.' }));
  const clasificacion: ClasificacionActa = {
    tipoActaDetectada: 'iniciacion_practicas', documentoAjeno: null,
    remuneracion: v.remuneracionDetectada ?? 'no_determinable', responsableArl: v.responsableArlDetectado ?? 'no_determinable',
    confianzaRemuneracion: null, confianzaResponsableArl: null,
    senales: { remuneracionEncabezado: 'no_determinable', arlEncabezado: 'ninguna', arlObligaciones: 'ninguna' },
    puntajeActa: 0, puntajeAjeno: 0, motivos: [...v.motivosClasificacion], discrepanciasDocumento,
  };
  const completa = compararActaConSipra({ clasificacion, campos: hidratarCampos(v.datosExtraidos?.campos ?? {}), lecturaDudosa: v.datosExtraidos?.lecturaDudosa === true }, sipra);
  const comparacion = comparacionAPersistida(completa, ahora);
  return { comparacion, hayDiscrepanciaCritica: comparacion.discrepancias.some((d) => d.severidad === 'critica'), completa };
}
