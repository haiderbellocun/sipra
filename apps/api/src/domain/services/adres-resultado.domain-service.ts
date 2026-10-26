import {
  ComparacionTripleCampo, DatosAdres, EstadoAdres, RecomendacionEps, ResultadoCampoTriple,
} from '../entities/adres';
import { CodigoErrorAdres } from '../entities/adres';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosExtraidosEps, VigenciaCertificado,
} from '../entities/validacion-eps.entity';
import {
  compararDocumentos, compararNombres, fechaIsoDe, mismaEps, normalizarDocumento, normalizarEstadoReportado, normalizarRegimen,
  normalizarTexto,
} from './normalizacion-identidad';

/**
 * Lectura y contraste del resultado de ADRES/BDUA (PDF que una persona guarda
 * del portal). Reglas determinísticas, sin red y sin IA: lo que no se entiende
 * con seguridad queda `null` o «no determinable»; nunca se infiere por ausencia.
 */

// ── Lectura del texto ───────────────────────────────────────────────────────

type CampoAdres = keyof Pick<DatosAdres, 'tipoDocumento' | 'numeroDocumento' | 'eps' | 'regimen' | 'estadoAfiliacion'
| 'fechaAfiliacion' | 'fechaFinalizacion' | 'fechaConsulta' | 'fuenteActualizadaEn'> | 'nombres' | 'apellidos' | 'nombre';

const ETIQUETAS: Readonly<Record<CampoAdres, readonly string[]>> = {
  tipoDocumento: ['TIPO DE DOCUMENTO', 'TIPO DE IDENTIFICACION', 'TIPO IDENTIFICACION', 'TIPO DOCUMENTO'],
  numeroDocumento: ['NUMERO DE DOCUMENTO', 'NUMERO DE IDENTIFICACION', 'NUMERO IDENTIFICACION', 'NUMERO DOCUMENTO', 'IDENTIFICACION', 'DOCUMENTO'],
  nombres: ['NOMBRES'],
  apellidos: ['APELLIDOS'],
  nombre: ['NOMBRE', 'NOMBRE COMPLETO', 'NOMBRE DEL AFILIADO'],
  eps: ['ENTIDAD', 'EPS', 'ENTIDAD PROMOTORA DE SALUD', 'ADMINISTRADORA', 'ENTIDAD ACTUAL'],
  regimen: ['REGIMEN', 'REGIMEN DE AFILIACION'],
  estadoAfiliacion: ['ESTADO', 'ESTADO DE AFILIACION', 'ESTADO DEL AFILIADO', 'ESTADO AFILIACION', 'ESTADO DE LA AFILIACION'],
  fechaAfiliacion: ['FECHA DE AFILIACION', 'FECHA DE AFILIACION EFECTIVA', 'FECHA AFILIACION', 'FECHA INICIO DE AFILIACION'],
  fechaFinalizacion: ['FECHA DE FINALIZACION DE AFILIACION', 'FECHA DE FINALIZACION', 'FECHA FIN DE AFILIACION', 'FECHA DE RETIRO'],
  fechaConsulta: ['FECHA DE CONSULTA', 'FECHA Y HORA DE CONSULTA', 'FECHA DE IMPRESION', 'FECHA DE GENERACION'],
  fuenteActualizadaEn: ['FECHA DE CORTE', 'FECHA DE ACTUALIZACION', 'ACTUALIZADO A', 'FECHA DE ACTUALIZACION DE LA BDUA', 'CORTE'],
};

/** Todas las etiquetas conocidas: una línea que sea una etiqueta NO es el valor de otra. */
const TODAS_LAS_ETIQUETAS: ReadonlySet<string> = new Set([
  ...Object.values(ETIQUETAS).flat(),
  'TIPO DE AFILIADO', 'DEPARTAMENTO', 'MUNICIPIO', 'FECHA DE NACIMIENTO', 'DATOS BASICOS DEL AFILIADO', 'INFORMACION DE AFILIACION',
  'ADRES', 'BDUA', 'COLUMNA', 'DATOS', 'ENTIDAD PROMOTORA', 'REGIMEN DE SALUD', 'FECHA DE AFILIACION EFECTIVA',
]);

function lineas(texto: string): string[] {
  return texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
}

function valorDe(ls: readonly string[], campo: CampoAdres): string | null {
  const etiquetas = ETIQUETAS[campo];
  for (let i = 0; i < ls.length; i += 1) {
    const linea = ls[i];
    // «ETIQUETA: valor» o «ETIQUETA - valor» en la misma línea.
    const separado = /^([^:]{2,60}?)\s*(?::|\s-\s)\s*(.+)$/.exec(linea);
    if (separado && etiquetas.includes(normalizarTexto(separado[1]))) {
      const valor = separado[2].trim();
      if (valor && !TODAS_LAS_ETIQUETAS.has(normalizarTexto(valor))) return valor;
    }
    // «ETIQUETA» sola y el valor en la línea siguiente (así salen los PDF de tablas).
    if (etiquetas.includes(normalizarTexto(linea).replace(/:$/, ''))) {
      const sig = ls[i + 1];
      if (sig && !TODAS_LAS_ETIQUETAS.has(normalizarTexto(sig).replace(/:$/, ''))) return sig;
    }
  }
  return null;
}

export interface LecturaAdres {
  datos: DatosAdres;
  /** Nombres de los campos que se pudieron leer (sin valores). */
  camposLeidos: string[];
  /** El texto se presenta como un resultado de ADRES/BDUA. Sin esto, nada del archivo se toma por afiliación. */
  pareceResultadoAdres: boolean;
}

export function extraerDatosAdres(texto: string): LecturaAdres {
  const ls = lineas(texto);
  const completo = normalizarTexto(texto);
  const parece = /\bADRES\b|ADMINISTRADORA DE LOS RECURSOS|\bBDUA\b|BASE DE DATOS UNICA DE AFILIADOS/.test(completo);

  const nombres = valorDe(ls, 'nombres');
  const apellidos = valorDe(ls, 'apellidos');
  const nombre = nombres || apellidos ? [nombres, apellidos].filter(Boolean).join(' ') : valorDe(ls, 'nombre');
  const tipo = valorDe(ls, 'tipoDocumento');
  const numeroTexto = valorDe(ls, 'numeroDocumento');
  const doc = normalizarDocumento(numeroTexto);
  const fecha = (c: CampoAdres): string | null => fechaIsoDe(valorDe(ls, c));
  const datos: DatosAdres = {
    tipoDocumento: tipo ? (normalizarDocumento(`${tipo} 00000`).tipo ?? normalizarTexto(tipo)) : doc.tipo,
    numeroDocumento: doc.numero,
    nombre: nombre ? nombre.replace(/\s+/g, ' ').trim() : null,
    eps: valorDe(ls, 'eps'),
    regimen: valorDe(ls, 'regimen'),
    estadoAfiliacion: valorDe(ls, 'estadoAfiliacion'),
    fechaAfiliacion: fecha('fechaAfiliacion'),
    fechaFinalizacion: fecha('fechaFinalizacion'),
    fechaConsulta: fecha('fechaConsulta'),
    fuenteActualizadaEn: fecha('fuenteActualizadaEn'),
  };
  const camposLeidos = Object.entries(datos).filter(([, v]) => v !== null).map(([k]) => k);
  return { datos, camposLeidos, pareceResultadoAdres: parece };
}

// ── Estado de afiliación según ADRES ────────────────────────────────────────

/**
 * Del estado que MUESTRA la fuente al eje de afiliación. Solo estados
 * inequívocos: «vigente/activo» → activa; «no vigente», retirado, suspendido,
 * inactivo, fallecido, cancelado → inactiva; todo lo demás, no determinable.
 */
export function afiliacionDeEstadoAdres(estado: string | null | undefined): AfiliacionEps {
  const t = normalizarTexto(estado);
  if (!t) return AfiliacionEps.NO_DETERMINABLE;
  const negativo = /\bNO VIGENTE\b|INACTIV|RETIRAD|SUSPEND|FALLECID|CANCELAD|TERMINAD|LIQUIDAD|NO AFILIAD|SIN AFILIACION/.test(t);
  const positivo = /\bVIGENTE\b|\bACTIV[OA]\b|\bAFILIAD[OA] ACTIV/.test(t);
  if (negativo && positivo && !/\bNO VIGENTE\b/.test(t)) return AfiliacionEps.NO_DETERMINABLE; // se contradice
  if (negativo) return AfiliacionEps.INACTIVA;
  if (positivo) return normalizarEstadoReportado(estado) === 'ACTIVO' || /\bVIGENTE\b/.test(t) ? AfiliacionEps.ACTIVA : AfiliacionEps.NO_DETERMINABLE;
  return AfiliacionEps.NO_DETERMINABLE;
}

// ── Contraste triple ────────────────────────────────────────────────────────

export interface IdentidadSipra {
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  nombre: string | null;
}

export interface EntradaEvaluacionAdres {
  datos: DatosAdres;
  sipra: IdentidadSipra;
  certificado: DatosExtraidosEps | null;
  autenticidad: AutenticidadEps;
  coincidenciaCertificado: CoincidenciaEps;
  vigencia: VigenciaCertificado;
  hayBanderaCritica: boolean;
  aliasEps?: Readonly<Record<string, string>>;
}

export interface EvaluacionAdres {
  estado: EstadoAdres.PROCESADO | EstadoAdres.NO_DETERMINABLE;
  error: CodigoErrorAdres | null;
  /** Se actualiza el eje solo si el resultado quedó atado al estudiante. */
  afiliacion: AfiliacionEps | null;
  comparacion: ComparacionTripleCampo[];
  recomendacion: RecomendacionEps;
}

type Par = ComparacionTripleCampo['conflictos'][number];

function fila(
  campo: ComparacionTripleCampo['campo'], sipra: string | null, certificado: string | null, adres: string | null,
  iguales: (a: string, b: string) => boolean, critico: boolean,
): ComparacionTripleCampo {
  const conflictos: Par[] = [];
  if (adres !== null && sipra !== null && !iguales(adres, sipra)) conflictos.push('sipra_vs_adres');
  if (adres !== null && certificado !== null && !iguales(adres, certificado)) conflictos.push('certificado_vs_adres');
  if (sipra !== null && certificado !== null && !iguales(sipra, certificado)) conflictos.push('sipra_vs_certificado');
  const resultado: ResultadoCampoTriple = adres === null ? 'no_disponible' : conflictos.some((c) => c !== 'sipra_vs_certificado') ? 'diferente' : 'coincide';
  return { campo, sipra, certificado, adres, resultado, conflictos, critico: critico && conflictos.length > 0 };
}

export function compararTriple(
  d: DatosAdres, sipra: IdentidadSipra, cert: DatosExtraidosEps | null, aliasEps: Readonly<Record<string, string>> = {},
): ComparacionTripleCampo[] {
  const num = (v: string | null): string | null => normalizarDocumento(v).numero;
  const adresRegimen = normalizarRegimen(d.regimen).regimen;
  const adresEstado = afiliacionDeEstadoAdres(d.estadoAfiliacion);
  const certEstado = cert?.estadoReportadoCertificado ?? null;
  return [
    fila('numero_documento', num(sipra.numeroDocumento), cert?.numeroDocumento ?? null, num(d.numeroDocumento),
      (a, b) => compararDocumentos(a, b) === 'igual', true),
    fila('tipo_documento', sipra.tipoDocumento, cert?.tipoDocumento ?? null, d.tipoDocumento, (a, b) => normalizarTexto(a) === normalizarTexto(b), true),
    fila('nombre', sipra.nombre, cert?.nombre ?? null, d.nombre, (a, b) => ['igual', 'compatible'].includes(compararNombres(a, b)), true),
    fila('eps', null, cert?.eps ?? null, d.eps, (a, b) => mismaEps(a, b, aliasEps) !== false, true),
    fila('regimen', null, cert?.regimen ?? null, adresRegimen, (a, b) => a === b, false),
    fila('estado', null, certEstado,
      adresEstado === AfiliacionEps.NO_DETERMINABLE ? null : (adresEstado === AfiliacionEps.ACTIVA ? 'ACTIVO' : 'INACTIVO'),
      (a, b) => (a === 'ACTIVO') === (b === 'ACTIVO'), false),
  ];
}

export function recomendarEps(e: {
  afiliacion: AfiliacionEps; autenticidad: AutenticidadEps; coincidenciaCertificado: CoincidenciaEps;
  vigencia: VigenciaCertificado; hayBanderaCritica: boolean; hayDiscrepanciaCritica: boolean;
}): RecomendacionEps {
  if (e.hayDiscrepanciaCritica) return RecomendacionEps.DISCREPANCIA_CRITICA;
  if (e.autenticidad === AutenticidadEps.INVALIDA || e.afiliacion === AfiliacionEps.INACTIVA) return RecomendacionEps.REVISION_RECHAZO;
  if (e.afiliacion === AfiliacionEps.NO_DETERMINABLE || e.afiliacion === AfiliacionEps.NO_CONTRASTADA) {
    return RecomendacionEps.INFORMACION_INSUFICIENTE;
  }
  // Afiliación activa.
  if (e.autenticidad === AutenticidadEps.VERIFICADA && e.coincidenciaCertificado === CoincidenciaEps.COINCIDE
    && e.vigencia === 'vigente' && !e.hayBanderaCritica) {
    return RecomendacionEps.CANDIDATO_AUTOAPROBACION;
  }
  return RecomendacionEps.REVISION_DOCUMENTAL;
}

/**
 * Evalúa un resultado ADRES ya leído. Primero lo ATA al estudiante (documento
 * igual; tipo y nombre no contradictorios); solo entonces puede actualizar el
 * eje de afiliación. No toca la autenticidad del certificado.
 */
export function evaluarResultadoAdres(e: EntradaEvaluacionAdres): EvaluacionAdres {
  const comparacion = compararTriple(e.datos, e.sipra, e.certificado, e.aliasEps);
  const hayCritica = comparacion.some((c) => c.critico);
  const sinAtar = (error: CodigoErrorAdres): EvaluacionAdres => ({
    estado: EstadoAdres.NO_DETERMINABLE, error, afiliacion: null, comparacion,
    recomendacion: hayCritica ? RecomendacionEps.DISCREPANCIA_CRITICA : RecomendacionEps.INFORMACION_INSUFICIENTE,
  });

  if (e.datos.numeroDocumento === null) return sinAtar('sin_documento_en_resultado');
  if (e.sipra.numeroDocumento === null || compararDocumentos(e.datos.numeroDocumento, e.sipra.numeroDocumento) !== 'igual') {
    return sinAtar('documento_no_corresponde');
  }
  if (e.datos.tipoDocumento && e.sipra.tipoDocumento && normalizarTexto(e.datos.tipoDocumento) !== normalizarTexto(e.sipra.tipoDocumento)) {
    return sinAtar('tipo_documento_no_corresponde');
  }
  if (e.datos.nombre && e.sipra.nombre && compararNombres(e.datos.nombre, e.sipra.nombre) === 'diferente') {
    return sinAtar('nombre_no_corresponde');
  }

  const afiliacion = afiliacionDeEstadoAdres(e.datos.estadoAfiliacion);
  return {
    estado: afiliacion === AfiliacionEps.NO_DETERMINABLE ? EstadoAdres.NO_DETERMINABLE : EstadoAdres.PROCESADO,
    error: null,
    afiliacion,
    comparacion,
    recomendacion: recomendarEps({
      afiliacion, autenticidad: e.autenticidad, coincidenciaCertificado: e.coincidenciaCertificado,
      vigencia: e.vigencia, hayBanderaCritica: e.hayBanderaCritica, hayDiscrepanciaCritica: hayCritica,
    }),
  };
}
