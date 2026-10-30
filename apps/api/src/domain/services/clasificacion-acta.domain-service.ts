import {
  ClasificacionActa, ConfianzaActa, DiscrepanciaDocumentoActa, Remuneracion, ResponsableArlActa,
  SenalFuente, TipoDocumentoAjeno,
} from '../entities/acta-iniciacion';
import { frase, plegarColapsado } from './normalizacion-acta';

/**
 * Clasificación del Acta de Iniciación por CONTENIDO, determinística y local.
 *
 * Responde tres preguntas separadas:
 *  1. ¿Es un acta de iniciación? (`iniciacion_practicas` / `documento_incorrecto` /
 *     `no_determinable`). «No pude leerlo» NO es «no es un acta».
 *  2. ¿Es remunerada o no? Del título; el cuerpo de los formatos no lo repite.
 *  3. ¿Quién asume la ARL? De DOS señales independientes: el encabezado («CUN/EMPRESA
 *     ASUME ARL») y la sección de obligaciones donde figura afiliar al estudiante al
 *     Sistema de Riesgos Laborales. Si coinciden, confianza alta; si se contradicen no se
 *     escoge ninguna: `no_determinable` y discrepancia crítica del documento.
 *
 * El código del formato (DPE-FO0x) NO identifica el tipo: formatos distintos lo comparten.
 * Ninguna frase suelta basta: el título solo suma junto con la estructura del documento.
 */

interface Senal { codigo: string; patron: RegExp; peso: number }

/** Título del acta. Aportan como UNA sola señal (tope 2): son variantes del mismo rótulo. */
const TITULOS: readonly Senal[] = [
  { codigo: 'titulo_acta_de_inicio', patron: new RegExp(frase('ACTA DE INICIACION') + '|' + frase('ACTA DE INICIO')), peso: 2 },
  { codigo: 'titulo_iniciacion_practicas', patron: new RegExp(frase('INICIACION') + '\\s*(?:DE\\s*)?' + frase('PRACTICAS')), peso: 2 },
];
const TOPE_TITULO = 2;

/** Estructura propia del formato: lo que de verdad lo distingue de otros documentos. */
const ESTRUCTURA: readonly Senal[] = [
  { codigo: 'obligaciones_del_estudiante', patron: new RegExp(frase('OBLIGACIONES DEL ESTUDIANTE')), peso: 2 },
  { codigo: 'obligaciones_de_la_empresa', patron: new RegExp(frase('OBLIGACIONES DE LA EMPRESA')), peso: 2 },
  { codigo: 'obligaciones_de_la_institucion', patron: new RegExp(frase('OBLIGACIONES DE LA INSTITUCION')), peso: 2 },
  { codigo: 'causas_de_terminacion', patron: new RegExp(frase('CAUSAS DE TERMINACION')), peso: 1 },
  { codigo: 'estudiante_manifiesta', patron: new RegExp(frase('EL ESTUDIANTE MANIFIESTA')), peso: 2 },
  { codigo: 'rotulo_firma_empresa', patron: new RegExp(frase('FIRMA DE LA EMPRESA')), peso: 1 },
  { codigo: 'rotulo_firma_practicante', patron: new RegExp(frase('FIRMA DEL PRACTICANTE')), peso: 1 },
  { codigo: 'campo_nombre_estudiante', patron: new RegExp(frase('NOMBRE DEL ESTUDIANTE')), peso: 1 },
  { codigo: 'campo_representante_legal', patron: new RegExp(frase('NOMBRE DEL REPRESENTANTE LEGAL')), peso: 1 },
  { codigo: 'campo_jefe_inmediato', patron: new RegExp(frase('NOMBRE JEFE INMEDIATO')), peso: 1 },
  { codigo: 'campo_docente_monitor', patron: new RegExp(frase('DOCENTE MONITOR')), peso: 1 },
  { codigo: 'campo_direccion_practica', patron: new RegExp(frase('DIRECCION DONDE REALIZARA')), peso: 1 },
  { codigo: 'campos_fechas_practica', patron: new RegExp(frase('FECHA DE INICIO') + '[\\s\\S]{0,80}' + frase('FECHA TERMINACION')), peso: 1 },
];

/** El código del formato suma un poco y nada más. */
const CODIGO_FORMATO: Senal = { codigo: 'codigo_formato_dpe', patron: /DPE\s*-?\s*F[O0]\s*\d{2}/, peso: 0.5 };

/** Por debajo de esto no hay texto suficiente para opinar: vacío o lectura fallida. */
const MIN_LETRAS = 80;
const UMBRAL_ACTA = 6;
const UMBRAL_ESTRUCTURA = 4;
const UMBRAL_AJENO = 4;
const MAX_ESTRUCTURA_PARA_AJENO = 2;
/** Un acta con rasgos FUERTES de otro tipo de documento (el acta real da 0 en todos) no se decide. */
const AJENO_CONTRADICTORIO = 6;
const MIN_LETRAS_ARCHIVO_CUALQUIERA = 200;
const MIN_PROPORCION_ESPANOL = 0.15;

const PALABRAS_FUNCIONALES: ReadonlySet<string> = new Set([
  'DE', 'LA', 'EL', 'EN', 'Y', 'QUE', 'LOS', 'DEL', 'SE', 'LAS', 'POR', 'UN', 'CON', 'PARA', 'UNA', 'SU', 'AL', 'ES',
]);

/** Rasgos de documentos ajenos. Frases propias de cada tipo: no aparecen en el acta. */
const AJENOS: Readonly<Record<Exclude<TipoDocumentoAjeno, 'otro'>, readonly Senal[]>> = {
  certificado_eps: [
    { codigo: 'eps_certificado_afiliacion', patron: new RegExp(frase('CERTIFICADO DE AFILIACION') + '|' + frase('CERTIFICACION DE AFILIACION')), peso: 3 },
    { codigo: 'eps_se_encuentra_afiliado', patron: new RegExp(frase('SE ENCUENTRA') + '\\s*(?:ACTIV[OA]\\s*)?' + 'AFILIAD[OA]'), peso: 3 },
    { codigo: 'eps_estado_afiliacion', patron: new RegExp(frase('ESTADO') + '\\s*(?:DE\\s*)?' + 'AFILIACION'), peso: 2 },
    { codigo: 'eps_tipo_afiliado', patron: /TIPO\s*(?:DE\s*)?AFILIAD[OA]/, peso: 2 },
    { codigo: 'eps_regimen', patron: /REGIMEN\s*(?:DE\s*SALUD\s*)?:?\s*(?:CONTRIBUTIVO|SUBSIDIADO)/, peso: 2 },
    { codigo: 'eps_plan_beneficios', patron: /PLAN\s*(?:OBLIGATORIO\s*)?DE\s*(?:BENEFICIOS|SALUD)/, peso: 1 },
  ],
  cedula: [
    { codigo: 'cedula_registraduria', patron: /REGISTRADURIA/, peso: 3 },
    { codigo: 'cedula_republica', patron: /REPUBLICA\s*DE\s*COLOMBIA/, peso: 1.5 },
    { codigo: 'cedula_fecha_nacimiento', patron: /FECHA\s*DE\s*NACIMIENTO|LUGAR\s*DE\s*NACIMIENTO/, peso: 2 },
    { codigo: 'cedula_estatura', patron: /ESTATURA|GRUPO\s*SANGUINEO|\bG\.?\s?S\.?\s*RH\b/, peso: 2 },
    { codigo: 'cedula_titulo', patron: /CEDULA\s*DE\s*CIUDADANIA/, peso: 1 },
  ],
  carta_laboral: [
    { codigo: 'laboral_certificacion', patron: /CERTIFICA(?:DO|CION)?\s*LABORAL|CARTA\s*LABORAL|CONSTANCIA\s*LABORAL/, peso: 3 },
    { codigo: 'laboral_hace_constar', patron: /HACE\s*CONSTAR|CERTIFICA\s*QUE/, peso: 1.5 },
    { codigo: 'laboral_labora', patron: /\bLABORA\b|\bLABORO\b|SE\s*DESEMPENA|VINCULAD[OA]\s*(?:A|CON)/, peso: 2 },
    { codigo: 'laboral_salario', patron: /SALARIO|SUELDO|ASIGNACION\s*BASICA/, peso: 2 },
    { codigo: 'laboral_tipo_contrato', patron: /TERMINO\s*INDEFINIDO|TERMINO\s*FIJO|OBRA\s*O\s*LABOR/, peso: 2 },
  ],
  certificado_arl: [
    { codigo: 'arl_administradora', patron: new RegExp(frase('ADMINISTRADORA DE RIESGOS LABORALES')), peso: 3 },
    { codigo: 'arl_certificado_afiliacion', patron: /AFILIACION\s*(?:A\s*)?(?:LA\s*)?ARL\b|CERTIFICA(?:DO|CION)?\s*(?:DE\s*)?(?:ARL|COBERTURA)/, peso: 3 },
    { codigo: 'arl_clase_riesgo', patron: /CLASE\s*DE\s*RIESGO|NIVEL\s*DE\s*RIESGO/, peso: 3 },
    { codigo: 'arl_cotizante', patron: /TIPO\s*DE\s*COTIZANTE|IBC\b/, peso: 1 },
    { codigo: 'arl_nombre_aseguradora', patron: /\b(?:SURA|POSITIVA|COLMENA|AXA\s*COLPATRIA|MAPFRE|LA\s*EQUIDAD)\b/, peso: 1 },
  ],
  contrato: [
    { codigo: 'contrato_clausula', patron: /CLAUSULA\s*(?:PRIMERA|SEGUNDA|TERCERA|\d)/, peso: 3 },
    { codigo: 'contrato_objeto', patron: /OBJETO\s*DEL\s*CONTRATO/, peso: 3 },
    { codigo: 'contrato_partes', patron: /LAS\s*PARTES|EL\s*CONTRATANTE|EL\s*CONTRATISTA/, peso: 2 },
    { codigo: 'contrato_titulo', patron: /CONTRATO\s*DE\s*(?:PRESTACION\s*DE\s*SERVICIOS|TRABAJO)/, peso: 2 },
  ],
};

// ── Remuneración ────────────────────────────────────────────────────────────

const NO_REMUNERADA = new RegExp(`\\b${frase('NO')}\\s*REMUNERAD[AO]S?|\\b${frase('SIN')}\\s*REMUNERACION`);
const REMUNERADA = /REMUNERAD[AO]S?/g;
const NEGACION_PREVIA = /(?:\bN[O0]|\bSIN)\s*$/;

/** «REMUNERADAS» que NO viene precedida de «NO»/«SIN». */
function cuentaRemunerada(texto: string): number {
  let cuenta = 0;
  for (const m of texto.matchAll(REMUNERADA)) {
    const previo = texto.slice(Math.max(0, (m.index ?? 0) - 6), m.index ?? 0);
    if (!NEGACION_PREVIA.test(previo)) cuenta += 1;
  }
  return cuenta;
}

function remuneracionDelEncabezado(texto: string): Remuneracion | 'contradictoria' {
  const no = new RegExp(NO_REMUNERADA.source, 'g');
  const noRemunerada = (texto.match(no) ?? []).length > 0;
  const remunerada = cuentaRemunerada(texto) > 0;
  if (noRemunerada && remunerada) return 'contradictoria';
  if (noRemunerada) return 'no_remunerada';
  if (remunerada) return 'remunerada';
  return 'no_determinable';
}

// ── ARL ─────────────────────────────────────────────────────────────────────

const ARL_CUN = new RegExp(`\\b(?:LA\\s*)?(?:CUN|INSTITUCION)\\s*[-–]?\\s*ASUME\\s*(?:LA\\s*)?ARL|\\bCUN\\s*ASUME\\s*(?:LA\\s*)?ARL|${frase('CUN ASUME')}\\s*(?:LA\\s*)?ARL`);
const ARL_EMPRESA = new RegExp(`${frase('EMPRESA ASUME')}\\s*(?:LA\\s*)?ARL`);

function arlDelEncabezado(texto: string): SenalFuente {
  const cun = ARL_CUN.test(texto);
  const empresa = ARL_EMPRESA.test(texto);
  if (cun && empresa) return 'contradictoria';
  if (cun) return 'cun';
  if (empresa) return 'empresa';
  return 'ninguna';
}

const ENCABEZADOS_SECCION: readonly { seccion: 'empresa' | 'institucion' | 'otra'; patron: RegExp }[] = [
  { seccion: 'empresa', patron: new RegExp(frase('OBLIGACIONES DE LA EMPRESA'), 'g') },
  { seccion: 'institucion', patron: new RegExp(frase('OBLIGACIONES DE LA INSTITUCION'), 'g') },
  { seccion: 'otra', patron: new RegExp(`${frase('OBLIGACIONES DEL ESTUDIANTE')}|${frase('CAUSAS DE TERMINACION')}|${frase('EN CONSTANCIA DE LO ANTERIOR')}|${frase('TRAZABILIDAD')}`, 'g') },
];

/** «Afiliar el estudiante al Sistema de Seguridad Social en Riesgos Laborales (ARL)». */
const OBLIGACION_ARL = new RegExp(
  `${frase('AFILIAR')}\\s*(?:A[LR]?\\s*)?(?:EL\\s*|LA\\s*)?(?:${frase('ESTUDIANTE')}|${frase('PRACTICANTE')}|${frase('EDUCANDO')})` +
    `[^.]{0,120}?(?:${frase('RIESGOS LABORALES')}|\\bARL\\b)`,
  'g',
);

function arlDeObligaciones(texto: string): { senal: SenalFuente; sinSeccion: boolean } {
  const encabezados: { indice: number; seccion: 'empresa' | 'institucion' | 'otra' }[] = [];
  for (const { seccion, patron } of ENCABEZADOS_SECCION) {
    for (const m of texto.matchAll(patron)) encabezados.push({ indice: m.index ?? 0, seccion });
  }
  encabezados.sort((a, b) => a.indice - b.indice);

  let enEmpresa = false;
  let enInstitucion = false;
  let sinSeccion = false;
  for (const m of texto.matchAll(OBLIGACION_ARL)) {
    const indice = m.index ?? 0;
    const previos = encabezados.filter((e) => e.indice <= indice);
    const seccion = previos.length > 0 ? previos[previos.length - 1].seccion : null;
    if (seccion === 'empresa') enEmpresa = true;
    else if (seccion === 'institucion') enInstitucion = true;
    else sinSeccion = true;
  }
  if (enEmpresa && enInstitucion) return { senal: 'contradictoria', sinSeccion };
  if (enEmpresa) return { senal: 'empresa', sinSeccion };
  if (enInstitucion) return { senal: 'cun', sinSeccion };
  return { senal: 'ninguna', sinSeccion };
}

// ── Orquestación ────────────────────────────────────────────────────────────

function sumar(texto: string, senales: readonly Senal[]): { puntaje: number; codigos: string[] } {
  let puntaje = 0;
  const codigos: string[] = [];
  for (const s of senales) {
    if (s.patron.test(texto)) { puntaje += s.peso; codigos.push(s.codigo); }
  }
  return { puntaje, codigos };
}

function proporcionEspanol(texto: string): number {
  const palabras = texto.match(/[A-Z]+/g) ?? [];
  if (palabras.length === 0) return 0;
  return palabras.filter((p) => PALABRAS_FUNCIONALES.has(p)).length / palabras.length;
}

function resolverArl(
  encabezado: SenalFuente, obligaciones: SenalFuente,
): { responsable: ResponsableArlActa; confianza: ConfianzaActa | null; discrepancias: DiscrepanciaDocumentoActa[]; motivos: string[] } {
  const discrepancias: DiscrepanciaDocumentoActa[] = [];
  const motivos: string[] = [];
  if (encabezado === 'contradictoria') {
    discrepancias.push({ codigo: 'ARL_ENCABEZADO_AMBIGUO', severidad: 'critica', mensaje: 'El encabezado menciona a la CUN y a la empresa como responsables de la ARL.' });
    motivos.push('arl_encabezado_ambiguo');
  }
  if (obligaciones === 'contradictoria') {
    discrepancias.push({ codigo: 'ARL_OBLIGACIONES_AMBIGUAS', severidad: 'critica', mensaje: 'La obligación de afiliar a la ARL figura tanto en las obligaciones de la empresa como en las de la institución.' });
    motivos.push('arl_obligaciones_ambiguas');
  }
  if (discrepancias.length > 0) return { responsable: 'no_determinable', confianza: null, discrepancias, motivos };

  // Las ramas «contradictoria» ya salieron arriba: aquí solo quedan empresa, cun o ninguna.
  const e = encabezado === 'empresa' || encabezado === 'cun' ? encabezado : null;
  const o = obligaciones === 'empresa' || obligaciones === 'cun' ? obligaciones : null;
  if (e && o && e !== o) {
    discrepancias.push({
      codigo: 'ARL_ENCABEZADO_VS_OBLIGACIONES', severidad: 'critica',
      mensaje: `El encabezado dice que ${e === 'cun' ? 'la CUN' : 'la empresa'} asume la ARL, pero la obligación de afiliar figura bajo ${o === 'cun' ? 'las obligaciones de la institución' : 'las obligaciones de la empresa'}.`,
    });
    return { responsable: 'no_determinable', confianza: null, discrepancias, motivos: ['arl_encabezado_contradice_obligaciones'] };
  }
  if (e && o) return { responsable: e, confianza: 'alta', discrepancias, motivos: ['arl_encabezado_y_obligaciones_coinciden'] };
  if (e) return { responsable: e, confianza: 'media', discrepancias, motivos: ['arl_solo_encabezado'] };
  if (o) return { responsable: o, confianza: 'media', discrepancias, motivos: ['arl_solo_obligaciones'] };
  return { responsable: 'no_determinable', confianza: null, discrepancias, motivos: ['arl_sin_senales'] };
}

export function clasificarActa(textoCrudo: string): ClasificacionActa {
  const texto = plegarColapsado(textoCrudo);
  const letras = (texto.match(/[A-Z]/g) ?? []).length;
  const vacia: ClasificacionActa = {
    tipoActaDetectada: 'no_determinable', documentoAjeno: null,
    remuneracion: 'no_determinable', responsableArl: 'no_determinable',
    confianzaRemuneracion: null, confianzaResponsableArl: null,
    senales: { remuneracionEncabezado: 'no_determinable', arlEncabezado: 'ninguna', arlObligaciones: 'ninguna' },
    puntajeActa: 0, puntajeAjeno: 0, motivos: [], discrepanciasDocumento: [],
  };
  if (letras < MIN_LETRAS) return { ...vacia, motivos: ['texto_insuficiente'] };

  const titulo = Math.min(TOPE_TITULO, Math.max(0, ...TITULOS.filter((s) => s.patron.test(texto)).map((s) => s.peso)));
  const estructura = sumar(texto, ESTRUCTURA);
  const codigo = sumar(texto, [CODIGO_FORMATO]);
  const puntajeActa = titulo + estructura.puntaje + codigo.puntaje;

  const ajenos = (Object.keys(AJENOS) as (keyof typeof AJENOS)[]).map((tipo) => ({ tipo, ...sumar(texto, AJENOS[tipo]) }));
  const mejorAjeno = ajenos.reduce((a, b) => (b.puntaje > a.puntaje ? b : a), ajenos[0]);

  const encabezadoRem = remuneracionDelEncabezado(texto);
  const arlEncabezado = arlDelEncabezado(texto);
  const obligaciones = arlDeObligaciones(texto);
  const senales = { remuneracionEncabezado: encabezadoRem, arlEncabezado, arlObligaciones: obligaciones.senal };
  const base = { ...vacia, senales, puntajeActa, puntajeAjeno: mejorAjeno.puntaje };

  const esActa = puntajeActa >= UMBRAL_ACTA && estructura.puntaje >= UMBRAL_ESTRUCTURA;
  if (esActa) {
    if (mejorAjeno.puntaje >= AJENO_CONTRADICTORIO) {
      return {
        ...base, motivos: ['senales_contradictorias', ...estructura.codigos, ...mejorAjeno.codigos],
        discrepanciasDocumento: [{ codigo: 'TIPO_ACTA_NO_CONFIRMADO', severidad: 'critica', mensaje: 'El documento reúne rasgos del acta y de otro tipo de documento.' }],
      };
    }
    const discrepancias: DiscrepanciaDocumentoActa[] = [];
    const motivos = ['acta_iniciacion_probable', ...estructura.codigos];
    if (titulo > 0) motivos.push('titulo_reconocido');

    let remuneracion: Remuneracion = 'no_determinable';
    let confianzaRem: ConfianzaActa | null = null;
    if (encabezadoRem === 'contradictoria') {
      discrepancias.push({ codigo: 'REMUNERACION_AMBIGUA', severidad: 'critica', mensaje: 'El documento se presenta a la vez como remunerado y no remunerado.' });
      motivos.push('remuneracion_ambigua');
    } else if (encabezadoRem !== 'no_determinable') {
      remuneracion = encabezadoRem;
      confianzaRem = 'alta';
      motivos.push('remuneracion_por_titulo');
    } else {
      motivos.push('remuneracion_sin_senales');
    }

    const arl = resolverArl(arlEncabezado, obligaciones.senal);
    discrepancias.push(...arl.discrepancias);
    motivos.push(...arl.motivos);
    if (obligaciones.sinSeccion) motivos.push('obligacion_arl_sin_seccion');

    return {
      ...base, tipoActaDetectada: 'iniciacion_practicas', remuneracion, responsableArl: arl.responsable,
      confianzaRemuneracion: confianzaRem, confianzaResponsableArl: arl.confianza, motivos,
      discrepanciasDocumento: discrepancias,
    };
  }

  if (mejorAjeno.puntaje >= UMBRAL_AJENO && estructura.puntaje <= MAX_ESTRUCTURA_PARA_AJENO) {
    return {
      ...base, tipoActaDetectada: 'documento_incorrecto', documentoAjeno: mejorAjeno.tipo,
      motivos: ['contiene_rasgos_de_otro_documento', mejorAjeno.tipo, ...mejorAjeno.codigos, 'faltan_rasgos_de_acta'],
    };
  }

  // Texto español legible, extenso y sin ningún rasgo del acta: un archivo cualquiera.
  if (
    letras >= MIN_LETRAS_ARCHIVO_CUALQUIERA && proporcionEspanol(texto) >= MIN_PROPORCION_ESPANOL &&
    estructura.puntaje <= 1 && puntajeActa < 3
  ) {
    return { ...base, tipoActaDetectada: 'documento_incorrecto', documentoAjeno: 'otro', motivos: ['texto_legible_sin_rasgos_de_acta'] };
  }

  return { ...base, motivos: ['senales_insuficientes', ...estructura.codigos] };
}
