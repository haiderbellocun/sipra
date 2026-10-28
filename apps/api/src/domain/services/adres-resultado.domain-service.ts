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
| 'fechaAfiliacion' | 'fechaFinalizacion' | 'fechaConsulta' | 'fuenteActualizadaEn'> | 'nombres' | 'apellidos' | 'nombre' | 'tipoAfiliado';

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
  tipoAfiliado: ['TIPO DE AFILIADO', 'TIPO AFILIADO', 'TIPO DE AFILIACION', 'CALIDAD DE AFILIADO'],
};

/** Etiquetas que existen en el resultado pero no se leen: igual delimitan el valor de la anterior. */
const ETIQUETAS_AJENAS: readonly string[] = [
  'DEPARTAMENTO', 'MUNICIPIO', 'FECHA DE NACIMIENTO', 'DATOS BASICOS DEL AFILIADO', 'INFORMACION DE AFILIACION',
  'ENTIDAD PROMOTORA', 'REGIMEN DE SALUD', 'SEXO', 'GENERO', 'ZONA', 'ESTACION DE ORIGEN',
];
/** Encabezados de la tabla («COLUMNAS | DATOS»): no son ni etiqueta ni valor. */
const ENCABEZADOS_TABLA: ReadonlySet<string> = new Set(['COLUMNAS', 'DATOS', 'COLUMNA']);

const CAMPO_DE_ETIQUETA: ReadonlyMap<string, CampoAdres | null> = new Map<string, CampoAdres | null>([
  ...(Object.entries(ETIQUETAS) as Array<[CampoAdres, readonly string[]]>).flatMap(([campo, ls]) => ls.map((l) => [l, campo] as const)),
  ...ETIQUETAS_AJENAS.map((l) => [l, null] as const),
]);
const MAX_PALABRAS_ETIQUETA = 6;

/** Todas las etiquetas conocidas: una línea que sea una etiqueta NO es el valor de otra. */
const TODAS_LAS_ETIQUETAS: ReadonlySet<string> = new Set([...CAMPO_DE_ETIQUETA.keys(), ...ENCABEZADOS_TABLA, 'ADRES', 'BDUA']);

const claveDe = (s: string): string => normalizarTexto(s).replace(/\s*:$/, '');

/** DD/MM/AAAA, AAAA-MM-DD o «5 de febrero de 2024»: las formas de fecha que sabe leer `fechaIsoDe`. */
const FECHA_ADRES = /^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} DE [A-Z]+ DE \d{4})$/;

/** Forma que debe tener el valor de cada campo (un valor que no la tiene NO se toma). Los campos de texto libre no tienen. */
const FORMA: Partial<Record<CampoAdres, RegExp>> = {
  tipoDocumento: /^(?:CC|TI|CE|RC|PA|PE|PT|NIT|CD|SC|AS|MS)$/,
  numeroDocumento: /^(?=(?:\D*\d){4})[A-Z0-9][A-Z0-9.\- ]{3,19}$/,
  estadoAfiliacion: /^(?:NO VIGENTE|VIGENTE|ACTIV[OA]|INACTIV[OA]|SUSPENDID[OA]|RETIRAD[OA]|FALLECID[OA]|CANCELAD[OA]|TERMINAD[OA]|LIQUIDAD[OA]|AFILIAD[OA]|PROTECCION LABORAL)$/,
  regimen: /^(?:CONTRIBUTIVO|SUBSIDIADO|ESPECIAL|EXCEPCION|REGIMEN [A-Z ]+)$/,
  fechaAfiliacion: FECHA_ADRES,
  fechaFinalizacion: FECHA_ADRES,
  fechaConsulta: FECHA_ADRES,
  fuenteActualizadaEn: FECHA_ADRES,
  tipoAfiliado: /^(?:COTIZANTE|BENEFICIARI[OA]|ADICIONAL|PENSIONAD[OA]|AFILIAD[OA] (?:COTIZANTE|BENEFICIARI[OA]))$/,
};
const esLibre = (c: CampoAdres): boolean => !FORMA[c];
const cumpleForma = (c: CampoAdres, valor: string): boolean => FORMA[c]?.test(normalizarTexto(valor)) ?? true;

type Elemento =
  | { tipo: 'etiqueta'; campo: CampoAdres | null; texto: string }
  | { tipo: 'texto'; texto: string };

function lineas(texto: string): string[] {
  return texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
}

/**
 * Reconstruye las etiquetas PARTIDAS en varias líneas. Los PDF de tablas entregan «TIPO DE» / «IDENTIFICACIÓN» como
 * fragmentos separados: se prueba, desde cada línea, la concatenación de hasta 4 líneas seguidas y gana la etiqueta
 * conocida más larga. Lo que no es etiqueta queda como texto. Sin reglas de un documento ni de una persona.
 */
function elementos(ls: readonly string[]): Elemento[] {
  const salida: Elemento[] = [];
  for (let i = 0; i < ls.length;) {
    const solo = claveDe(ls[i]);
    if (ENCABEZADOS_TABLA.has(solo)) { i += 1; continue; }
    let hallada = 0;
    let acumulado = '';
    for (let k = 0; k < 4 && i + k < ls.length; k += 1) {
      acumulado = `${acumulado} ${ls[i + k]}`.trim();
      if (acumulado.split(' ').length > MAX_PALABRAS_ETIQUETA) break;
      if (CAMPO_DE_ETIQUETA.has(claveDe(acumulado))) hallada = k + 1;
    }
    if (hallada > 0) {
      const texto = ls.slice(i, i + hallada).join(' ');
      salida.push({ tipo: 'etiqueta', campo: CAMPO_DE_ETIQUETA.get(claveDe(texto)) ?? null, texto });
      i += hallada;
    } else {
      salida.push({ tipo: 'texto', texto: ls[i] });
      i += 1;
    }
  }
  return salida;
}

const MAX_LINEAS_TEXTO_LIBRE = 6;
/** «Etiqueta: valor» en una sola línea, o un encabezado que termina en «:»: delimitan un texto libre. */
const cortaTextoLibre = (texto: string): boolean => /:\s*$/.test(texto) || /^[^:]{2,60}:\s*\S/.test(texto);

/**
 * Lee la tabla en sus dos orientaciones, validando cada valor por su forma:
 * - VERTICAL (etiqueta y, enseguida, su valor): «TIPO DE IDENTIFICACIÓN» / «CC».
 * - HORIZONTAL (fila de encabezados y, después, la fila de datos en el mismo orden): «ESTADO … TIPO DE AFILIADO» / «ACTIVO … COTIZANTE».
 * Un valor ausente o con otra forma queda en `null`: no se inventa ni se corre al valor del campo siguiente.
 */
function leerTabla(els: readonly Elemento[]): Partial<Record<CampoAdres, string>> {
  const salida: Partial<Record<CampoAdres, string>> = {};
  const poner = (campo: CampoAdres | null, valor: string | null): void => {
    if (campo && valor && !(campo in salida)) salida[campo] = valor;
  };
  const textoDesde = (desde: number, limiteLineas: number, parar?: (t: string) => boolean): { valor: string; siguiente: number } => {
    const partes: string[] = [];
    let j = desde;
    while (j < els.length && partes.length < limiteLineas) {
      const e = els[j];
      if (e.tipo !== 'texto' || cortaTextoLibre(e.texto) || parar?.(e.texto)) break;
      partes.push(e.texto);
      j += 1;
    }
    return { valor: partes.join(' '), siguiente: j };
  };

  let i = 0;
  while (i < els.length) {
    const e = els[i];
    if (e.tipo !== 'etiqueta') { i += 1; continue; }
    let n = 0;
    while (i + n < els.length && els[i + n].tipo === 'etiqueta') n += 1;
    const fila = els.slice(i, i + n) as Array<Extract<Elemento, { tipo: 'etiqueta' }>>;

    if (n >= 3) {
      // Encabezados de columna seguidos de sus datos, en el mismo orden.
      let j = i + n;
      fila.forEach((et, idx) => {
        const campo = et.campo;
        const actual = els[j];
        if (!actual || actual.tipo !== 'texto') return;
        if (campo && !esLibre(campo)) {
          if (cumpleForma(campo, actual.texto)) { poner(campo, actual.texto); j += 1; }
          return;
        }
        // Texto libre (la entidad ocupa varias líneas): hasta que aparezca el valor de la primera columna de forma conocida que sigue.
        const siguienteConForma = fila.slice(idx + 1).find((x) => x.campo && !esLibre(x.campo))?.campo ?? null;
        const { valor, siguiente } = textoDesde(j, MAX_LINEAS_TEXTO_LIBRE, siguienteConForma ? (t) => cumpleForma(siguienteConForma, t) : undefined);
        poner(campo, valor);
        j = siguiente;
      });
      i = i + n;
      continue;
    }

    // Vertical: cada etiqueta con las líneas que le siguen hasta la próxima etiqueta.
    fila.forEach((et, idx) => {
      if (idx < n - 1) return; // una etiqueta sin valor seguida de otra: queda ausente
      const campo = et.campo;
      const desde = i + n;
      if (!campo) return;
      if (!esLibre(campo)) {
        const sig = els[desde];
        if (sig?.tipo === 'texto' && cumpleForma(campo, sig.texto)) poner(campo, sig.texto);
      } else {
        poner(campo, textoDesde(desde, MAX_LINEAS_TEXTO_LIBRE).valor);
      }
    });
    i += n;
  }
  return salida;
}

/** Respaldo para «ETIQUETA: valor» en una línea (resultados que no son tabla). Las etiquetas ya vienen unidas. */
function valorDe(ls: readonly string[], campo: CampoAdres): string | null {
  const etiquetas = ETIQUETAS[campo];
  for (let i = 0; i < ls.length; i += 1) {
    const linea = ls[i];
    const separado = /^([^:]{2,60}?)\s*(?::|\s-\s)\s*(.+)$/.exec(linea);
    if (separado && etiquetas.includes(claveDe(separado[1]))) {
      const valor = separado[2].trim();
      if (valor && !TODAS_LAS_ETIQUETAS.has(claveDe(valor)) && cumpleForma(campo, valor)) return valor;
    }
    if (etiquetas.includes(claveDe(linea))) {
      const sig = ls[i + 1];
      if (sig && !TODAS_LAS_ETIQUETAS.has(claveDe(sig)) && cumpleForma(campo, sig)) return sig;
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

/** ADRES imprime la fecha de la consulta como MM/DD/AAAA y las demás como DD/MM/AAAA: si el día no cabe, se prueba el otro orden. */
function fechaAdres(valor: string | null): string | null {
  const dmy = fechaIsoDe(valor);
  if (dmy) return dmy;
  const m = valor ? /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(valor.trim()) : null;
  return m && +m[1] <= 12 && +m[2] > 12 ? fechaIsoDe(`${m[2]}/${m[1]}/${m[3]}`) : null;
}

/** ADRES escribe 31/12/2999 en «fecha de finalización» para decir que la afiliación continúa: no es una terminación real. */
export function esFechaDeContinuidadAdres(iso: string | null): boolean {
  return !!iso && /^2999-12-31$/.test(iso);
}

export function extraerDatosAdres(texto: string): LecturaAdres {
  const ls = lineas(texto);
  const completo = normalizarTexto(texto);
  const parece = /\bADRES\b|ADMINISTRADORA DE LOS RECURSOS|\bBDUA\b|BASE DE DATOS UNICA DE AFILIADOS/.test(completo);

  const tabla = leerTabla(elementos(ls));
  const lineasUnidas = elementos(ls).map((e) => e.texto);
  const leer = (c: CampoAdres): string | null => tabla[c] ?? valorDe(lineasUnidas, c);

  const nombres = leer('nombres');
  const apellidos = leer('apellidos');
  const nombre = nombres || apellidos ? [nombres, apellidos].filter(Boolean).join(' ') : leer('nombre');
  const tipo = leer('tipoDocumento');
  const doc = normalizarDocumento(leer('numeroDocumento'));
  const fechaFin = fechaAdres(leer('fechaFinalizacion'));
  const datos: DatosAdres = {
    tipoDocumento: tipo ? (normalizarDocumento(`${tipo} 00000`).tipo ?? normalizarTexto(tipo)) : doc.tipo,
    numeroDocumento: doc.numero,
    nombre: nombre ? nombre.replace(/\s+/g, ' ').trim() : null,
    nombres: nombres ? nombres.replace(/\s+/g, ' ').trim() : null,
    apellidos: apellidos ? apellidos.replace(/\s+/g, ' ').trim() : null,
    eps: leer('eps'),
    regimen: leer('regimen'),
    estadoAfiliacion: leer('estadoAfiliacion'),
    tipoAfiliado: leer('tipoAfiliado'),
    fechaAfiliacion: fechaAdres(leer('fechaAfiliacion')),
    fechaFinalizacion: fechaFin,
    // Solo si el resultado trae una fecha de finalización: sin ella no hay nada que decir (ni «continúa» ni «terminó»).
    ...(fechaFin ? { afiliacionContinua: esFechaDeContinuidadAdres(fechaFin) } : {}),
    fechaConsulta: fechaAdres(leer('fechaConsulta')),
    fuenteActualizadaEn: fechaAdres(leer('fuenteActualizadaEn')),
  };
  const camposLeidos = Object.entries(datos).filter(([k, v]) => v !== null && k !== 'afiliacionContinua').map(([k]) => k);
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
