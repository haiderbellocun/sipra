/**
 * Clasificación DOCUMENTAL local, determinística y por CONTENIDO: ¿lo que se cargó como certificado de EPS tiene evidencia de serlo?
 * Se ejecuta ANTES de cualquier trámite con ADRES. No usa el nombre del archivo ni ningún modelo; solo señales del texto
 * (nativo u OCR), cada una con su peso, y decide por el CONJUNTO:
 *
 *  · `certificado_eps_probable`: señales fuertes de afiliación por encima del umbral y que superan a las de otro tipo.
 *  · `documento_incorrecto`: SE LEYÓ y trae señales fuertes de otro tipo (laboral, tributario) con pocas de afiliación.
 *  · `no_determinable`: no se pudo leer (vacío, ilegible) o las señales no alcanzan o se contradicen. «No pude leerlo» NO es
 *    «no es un certificado de EPS».
 *
 * Una palabra suelta como «EPS» no prueba nada: una entidad que es EPS también emite certificaciones laborales con «EPS» en su
 * razón social. Por eso nombrar una EPS pesa muy poco, y lo que manda son los términos de afiliación (estado, régimen, tipo de
 * afiliado, fecha de afiliación, «se encuentra afiliado»). Solo se devuelven CÓDIGOS de motivo; el texto no se conserva.
 */

export type TipoDocumentalEps = 'certificado_eps_probable' | 'documento_incorrecto' | 'no_determinable';

export interface ClasificacionDocumentalEps {
  tipo: TipoDocumentalEps;
  /**
   * Solo con `documento_incorrecto`: qué parece ser (clasificación INTERNA, no un tipo del sistema). Sirve para explicar y
   * auditar la devolución; nunca lleva texto del documento.
   */
  subtipoIncorrecto?: SubtipoIncorrectoEps;
  /** Códigos no sensibles (p. ej. `contiene_indicadores_laborales`). Nunca fragmentos del documento. */
  motivos: string[];
  puntajeEps: number;
  puntajeOtro: number;
}

interface Senal { codigo: string; patron: RegExp; peso: number }

/** Señales de que ES un certificado de afiliación a EPS. El texto llega en mayúsculas y sin tildes. */
const SENALES_EPS: readonly Senal[] = [
  { codigo: 'contiene_certificado_afiliacion', patron: /\bCERTIFICA(?:DO|CION) DE AFILIACION\b/, peso: 3 },
  { codigo: 'contiene_certifica_afiliado', patron: /\bSE ENCUENTRA(?: ACTIV[OA])? AFILIAD[OA]\b|\bAFILIAD[OA](?: ACTIV[OA])? (?:A|EN) (?:NUESTRA|LA|ESTA) (?:EPS|ENTIDAD)\b|\bESTA AFILIAD[OA]\b/, peso: 3 },
  { codigo: 'contiene_estado_afiliacion', patron: /\bESTADO(?: DE(?: LA)?)? AFILIACION\b|\bESTADO AFILIAD[OA]\b|\bESTADO\s*:?\s*(?:ACTIV[OA]|VIGENTE|INACTIV[OA])\b/, peso: 2 },
  { codigo: 'contiene_tipo_afiliado', patron: /\bTIPO DE AFILIAD[OA]\b|\bTIPO AFILIAD[OA]\b|\bCALIDAD DE AFILIAD[OA]\b|\bTIPO DE AFILIACION\b/, peso: 2 },
  { codigo: 'contiene_regimen', patron: /\bREGIMEN(?: DE (?:SALUD|AFILIACION))?\s*:?\s*(?:CONTRIBUTIVO|SUBSIDIADO|ESPECIAL)\b|\b(?:CONTRIBUTIVO|SUBSIDIADO) - (?:COTIZANTE|BENEFICIARI[OA])\b/, peso: 2 },
  { codigo: 'contiene_fecha_afiliacion', patron: /\bFECHA(?: DE)? (?:AFILIACION|INGRESO A (?:LA )?(?:EPS|ENTIDAD)|ACTIVACION DE SERVICIOS)\b/, peso: 2 },
  { codigo: 'contiene_plan_beneficios', patron: /\bPLAN (?:DE|OBLIGATORIO DE) (?:BENEFICIOS|SALUD)\b|\bPBS\b/, peso: 1 },
  { codigo: 'contiene_afiliado_cotizante_beneficiario', patron: /\b(?:COTIZANTE|BENEFICIARI[OA])\b/, peso: 1 },
  { codigo: 'contiene_entidad_promotora', patron: /\bENTIDAD PROMOTORA DE SALUD\b|\bEMPRESA PROMOTORA DE SALUD\b/, peso: 1 },
  // Nombrar una EPS casi no pesa: aparece también en la razón social de quien emite certificaciones de otro tipo.
  { codigo: 'menciona_eps_en_razon_social', patron: /\bEPS\b/, peso: 0.5 },
  { codigo: 'identifica_afiliado', patron: /\bIDENTIFICAD[OA](?: \(A\))? CON\b/, peso: 0.5 },
];

/** Señales de OTRO tipo de documento (laboral, tributario…). */
const SENALES_OTRO: readonly Senal[] = [
  { codigo: 'contiene_certificacion_laboral', patron: /\bCERTIFICA(?:DO|CION) LABORAL\b|\bCONSTANCIA LABORAL\b|\bCARTA LABORAL\b/, peso: 3 },
  { codigo: 'contiene_vinculacion_laboral', patron: /\bVINCULACION LABORAL\b|\bRELACION LABORAL\b|\bCONTRATO LABORAL\b|\bCONTRATO DE TRABAJO\b|\bVINCULAD[OA] LABORALMENTE\b/, peso: 3 },
  { codigo: 'contiene_labor_en_empresa', patron: /\bLABORO\b|\bLABORA\b|\bTRABAJO EN LA EMPRESA\b|\bPRESTA(?:DO)? SUS SERVICIOS\b|\bSE DESEMPENA\b|\bDESEMPENO EL CARGO\b/, peso: 2 },
  { codigo: 'contiene_cargo', patron: /\bCARGO\b/, peso: 1.5 },
  { codigo: 'contiene_salario', patron: /\bSALARIO\b|\bSUELDO\b|\bASIGNACION BASICA\b|\bREMUNERACION\b|\bVALOR CAUSADO\b|\bNOMINA\b|\bHONORARIOS\b/, peso: 2 },
  { codigo: 'contiene_tipo_contrato', patron: /\bTIPO DE CONTRATO\b|\bTERMINO INDEFINIDO\b|\bTERMINO FIJO\b|\bCONTRATO A TERMINO\b|\bOBRA O LABOR\b|\bPRESTACION DE SERVICIOS\b/, peso: 2 },
  { codigo: 'contiene_fecha_inicio_contrato', patron: /\bFECHA (?:DE )?(?:INICIO|INGRESO) (?:DEL? )?(?:CONTRATO|LABORES|VINCULACION)\b|\bFECHA DE VINCULACION\b|\bFECHA DE INICIO\b/, peso: 1.5 },
  { codigo: 'contiene_personal_directivo', patron: /\bPERSONAL DIRECTIVO\b|\bCUERPO DIRECTIVO\b|\bDIRECTIVOS\b/, peso: 2 },
  { codigo: 'contiene_indicadores_tributarios', patron: /\bANO GRAVABLE\b|\bDIRECCION DE IMPUESTOS\b|\bCERTIFICADO DE INGRESOS\b|\bRETENCION EN LA FUENTE\b/, peso: 2 },
  // Débiles: también aparecen en certificados de EPS reales (firma del representante, «por la empresa …», «empleador»).
  { codigo: 'menciona_representante_legal', patron: /\bREPRESENTANTE LEGAL\b/, peso: 0.5 },
  { codigo: 'menciona_empleador', patron: /\bEMPLEADOR\b/, peso: 0.5 },
];

/**
 * Documentos que NO sustituyen el certificado de afiliación y que se reconocen por SEÑALES COMBINADAS (nunca por una palabra
 * aislada). Solo se evalúan cuando el documento NO es un certificado de EPS probable: no pueden cambiar ese resultado.
 */
export type SubtipoIncorrectoEps =
  | 'desprendible_nomina' | 'planilla_aportes_pila' | 'certificado_arl' | 'certificacion_laboral' | 'documento_tributario'
  | 'otro_documento';

interface FamiliaIncorrecta { subtipo: SubtipoIncorrectoEps; senales: readonly Senal[]; umbral: number }

const FAMILIAS_INCORRECTAS: readonly FamiliaIncorrecta[] = [
  {
    subtipo: 'desprendible_nomina', umbral: 5,
    senales: [
      { codigo: 'nomina_desprendible', patron: /\bDESPRENDIBLE(?: DE)? (?:PAGO|NOMINA)\b|\bCOMPROBANTE DE (?:PAGO|NOMINA)\b|\bVOLANTE DE PAGO\b|\bCOLILLA DE PAGO\b/, peso: 3 },
      { codigo: 'nomina_devengados', patron: /\bDEVENGAD[OA]S?\b/, peso: 2 },
      { codigo: 'nomina_deducciones', patron: /\bDEDUCCIONES\b/, peso: 1.5 },
      { codigo: 'nomina_neto', patron: /\bNETO A PAGAR\b|\bNETO PAGADO\b|\bTOTAL A PAGAR\b/, peso: 2 },
      { codigo: 'nomina_periodo', patron: /\bPERIODO (?:DE PAGO|LIQUIDADO|DE NOMINA)\b|\bQUINCENA\b/, peso: 1 },
      { codigo: 'nomina_salario', patron: /\bSALARIO BASICO\b|\bSUELDO BASICO\b|\bAUXILIO DE TRANSPORTE\b/, peso: 1.5 },
    ],
  },
  {
    subtipo: 'planilla_aportes_pila', umbral: 5,
    senales: [
      { codigo: 'pila_planilla', patron: /\bPLANILLA (?:INTEGRADA DE LIQUIDACION DE APORTES|DE APORTES|DE AUTOLIQUIDACION)\b|\bPILA\b/, peso: 3 },
      { codigo: 'pila_ibc', patron: /\bINGRESO BASE DE COTIZACION\b|\bIBC\b/, peso: 1.5 },
      { codigo: 'pila_numero_planilla', patron: /\bNUMERO DE PLANILLA\b|\bPLANILLA (?:NO|NUMERO)\b/, peso: 2 },
      { codigo: 'pila_operador', patron: /\bOPERADOR DE INFORMACION\b|\bAPORTES EN LINEA\b|\bMI PLANILLA\b|\bASOPAGOS\b|\bSIMPLE S\.?A\b/, peso: 1.5 },
      { codigo: 'pila_subsistemas', patron: /\bCAJA DE COMPENSACION\b|\bFONDO DE PENSIONES\b/, peso: 1.5 },
      { codigo: 'pila_periodo_cotizacion', patron: /\bPERIODO (?:DE )?(?:COTIZACION|SALUD|PENSION)\b/, peso: 1 },
    ],
  },
  {
    subtipo: 'certificado_arl', umbral: 5,
    senales: [
      { codigo: 'arl_administradora', patron: /\bADMINISTRADORA DE RIESGOS (?:LABORALES|PROFESIONALES)\b/, peso: 3 },
      { codigo: 'arl_sigla', patron: /\bARL\b/, peso: 1 },
      { codigo: 'arl_clase_riesgo', patron: /\b(?:CLASE|NIVEL) DE RIESGO\b/, peso: 2 },
      { codigo: 'arl_riesgos_laborales', patron: /\bRIESGOS LABORALES\b|\bSISTEMA GENERAL DE RIESGOS\b/, peso: 2 },
      { codigo: 'arl_cobertura', patron: /\bINICIO DE (?:LA )?COBERTURA\b|\bCOBERTURA DESDE\b/, peso: 1.5 },
    ],
  },
];

/** Señales que solo trae un certificado de SALUD (no uno de riesgos laborales). */
const SENALES_PROPIAS_DE_SALUD: readonly string[] = [
  'contiene_regimen', 'contiene_tipo_afiliado', 'contiene_plan_beneficios', 'contiene_entidad_promotora', 'contiene_afiliado_cotizante_beneficiario',
];
const UMBRAL_PROPIAS_DE_SALUD = 2;

/** Por debajo de esto no hay texto suficiente para opinar: la lectura falló o el documento está vacío. */
const MIN_CARACTERES_UTILES = 80;
const UMBRAL_EPS = 3;
const UMBRAL_OTRO = 4;
/** «Pocas señales de EPS»: a lo sumo esto (nombrar la EPS más una señal débil no alcanza para sostener que es un certificado de afiliación). */
const MAX_EPS_PARA_INCORRECTO = 2;
/** Las señales débiles (≤ 0,5) no cuentan para el umbral de «fuertes». */
const PESO_FUERTE = 1;

export function normalizarParaClasificar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9()\-:.,/ \n]/g, ' ').replace(/[ \t]+/g, ' ');
}

function evaluar(texto: string, senales: readonly Senal[]): { puntaje: number; codigos: string[] } {
  let puntaje = 0;
  const codigos: string[] = [];
  for (const s of senales) {
    if (s.patron.test(texto)) { puntaje += s.peso; codigos.push(s.codigo); }
  }
  return { puntaje, codigos };
}

export function clasificarDocumentoEps(textoCrudo: string): ClasificacionDocumentalEps {
  const texto = normalizarParaClasificar(textoCrudo);
  const letras = (texto.match(/[A-Z]/g) ?? []).length;
  if (letras < MIN_CARACTERES_UTILES) {
    return { tipo: 'no_determinable', motivos: ['texto_insuficiente'], puntajeEps: 0, puntajeOtro: 0 };
  }
  const eps = evaluar(texto, SENALES_EPS);
  const otro = evaluar(texto, SENALES_OTRO);
  // La parte FUERTE de las señales de EPS (sin nombrar la EPS ni «identificado con»), que es la que sostiene un certificado de afiliación.
  const fuertesEps = SENALES_EPS.filter((s) => s.peso >= PESO_FUERTE && eps.codigos.includes(s.codigo)).reduce((a, s) => a + s.peso, 0);
  const base = { puntajeEps: eps.puntaje, puntajeOtro: otro.puntaje };
  const motivosEps = eps.codigos.filter((c) => c !== 'menciona_eps_en_razon_social' && c !== 'identifica_afiliado');
  const motivosOtro = otro.codigos;

  const familias = FAMILIAS_INCORRECTAS
    .map((f) => ({ ...f, ...evaluar(texto, f.senales) }))
    .filter((f) => f.puntaje >= f.umbral)
    .sort((a, b) => b.puntaje - a.puntaje);
  const familia = familias[0];

  // Un certificado de ARL comparte el lenguaje de afiliación («certificado de afiliación», «se encuentra afiliado», «estado de la
  // afiliación»): sin las señales PROPIAS de salud (régimen, tipo de afiliado, plan de beneficios, entidad promotora) no es EPS.
  const arl = familias.find((f) => f.subtipo === 'certificado_arl');
  const propiasDeSalud = SENALES_EPS.filter((s) => SENALES_PROPIAS_DE_SALUD.includes(s.codigo) && eps.codigos.includes(s.codigo)).reduce((a, s) => a + s.peso, 0);
  if (arl && propiasDeSalud < UMBRAL_PROPIAS_DE_SALUD) {
    return {
      ...base, tipo: 'documento_incorrecto', subtipoIncorrecto: 'certificado_arl',
      motivos: ['contiene_indicadores_certificado_arl', ...arl.codigos, 'faltan_indicadores_salud', ...motivosEps, 'subtipo_certificado_arl'],
    };
  }

  // Probable: señales de afiliación suficientes y por encima de las de otro tipo. Si las de otro tipo también son fuertes, las de
  // afiliación deben dominar con holgura (el doble); si no, es ambiguo y lo decide una persona.
  if (fuertesEps >= UMBRAL_EPS && eps.puntaje > otro.puntaje && (otro.puntaje < UMBRAL_OTRO || eps.puntaje >= 2 * otro.puntaje)) {
    return { ...base, tipo: 'certificado_eps_probable', motivos: motivosEps };
  }

  if (otro.puntaje >= UMBRAL_OTRO && fuertesEps <= MAX_EPS_PARA_INCORRECTO) {
    // Un desprendible de nómina también trae «salario»: si una familia específica se reconoce, ese es el subtipo.
    const subtipo: SubtipoIncorrectoEps = familia?.subtipo
      ?? (otro.codigos.some((c) => c === 'contiene_certificacion_laboral' || c === 'contiene_vinculacion_laboral' || c === 'contiene_labor_en_empresa')
        ? 'certificacion_laboral'
        : otro.codigos.includes('contiene_indicadores_tributarios') ? 'documento_tributario' : 'otro_documento');
    return {
      ...base, tipo: 'documento_incorrecto', subtipoIncorrecto: subtipo,
      motivos: ['contiene_indicadores_laborales', ...motivosOtro, ...(familia?.codigos ?? []), 'faltan_indicadores_afiliacion', ...motivosEps, `subtipo_${subtipo}`],
    };
  }
  // Documentos de otra familia inequívoca (nómina, PILA, ARL): señales combinadas propias y pocas de afiliación.
  if (familia && fuertesEps <= MAX_EPS_PARA_INCORRECTO) {
    return {
      ...base, tipo: 'documento_incorrecto', subtipoIncorrecto: familia.subtipo,
      motivos: [`contiene_indicadores_${familia.subtipo}`, ...familia.codigos, 'faltan_indicadores_afiliacion', ...motivosEps, `subtipo_${familia.subtipo}`],
    };
  }
  // Señales de los dos lados o de ninguno: no se decide. Una persona lo revisa.
  const motivos = fuertesEps >= UMBRAL_EPS && otro.puntaje >= UMBRAL_OTRO ? ['senales_contradictorias', ...motivosEps, ...motivosOtro] : ['senales_insuficientes', ...motivosEps, ...motivosOtro];
  return { ...base, tipo: 'no_determinable', motivos };
}
