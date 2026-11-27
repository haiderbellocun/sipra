import { normalizarParaClasificar } from './clasificacion-documental-eps.domain-service';
import { fechaIsoDe } from './normalizacion-identidad';

/**
 * Clasificación DOCUMENTAL local y determinística del certificado de afiliación a la ARL (subfase 1.6A).
 *
 * Mismo criterio que el clasificador de EPS: por el CONJUNTO de señales del texto (nativo), nunca por una palabra aislada,
 * sin modelos y sin conservar texto. Resultados:
 *  · `certificado_arl_probable`: señales de afiliación a riesgos laborales suficientes y dominantes;
 *  · `documento_incorrecto`: se LEYÓ y es inequívocamente otro documento (EPS, nómina, PILA, RUT, Cámara, laboral, contrato):
 *    exige el «ancla» propia de esa familia y que sus señales superen a las de ARL;
 *  · `no_determinable`: no hay texto suficiente o las señales no alcanzan o se contradicen. «No pude leerlo» NO es «no es un
 *    certificado de ARL».
 *
 * La PILA incluye el subsistema de riesgos laborales: por eso una planilla con «ARL» no pasa como certificado si sus propias
 * señales (planilla, número de planilla, operador, IBC) dominan.
 */

export type TipoDocumentalArl = 'certificado_arl_probable' | 'documento_incorrecto' | 'no_determinable';
export type SubtipoIncorrectoArl =
  | 'certificado_eps' | 'desprendible_nomina' | 'planilla_aportes_pila' | 'rut' | 'camara_comercio' | 'certificacion_laboral'
  | 'contrato';

export interface ClasificacionDocumentalArl {
  tipo: TipoDocumentalArl;
  subtipoIncorrecto?: SubtipoIncorrectoArl;
  /** Solo códigos, nunca texto. */
  motivos: string[];
  puntajeArl: number;
}

interface Senal { codigo: string; patron: RegExp; peso: number; ancla?: boolean }

const SENALES_ARL: readonly Senal[] = [
  { codigo: 'arl_administradora', patron: /\bADMINISTRADORA DE RIESGOS (?:LABORALES|PROFESIONALES)\b/, peso: 3, ancla: true },
  { codigo: 'arl_riesgos_laborales', patron: /\bRIESGOS LABORALES\b|\bSISTEMA GENERAL DE RIESGOS\b/, peso: 2, ancla: true },
  { codigo: 'arl_clase_riesgo', patron: /\b(?:CLASE|NIVEL) DE RIESGO\b/, peso: 2 },
  { codigo: 'arl_fecha_afiliacion', patron: /\bFECHA DE (?:AFILIACION|INGRESO)\b|\bINICIO DE (?:LA )?COBERTURA\b|\bCOBERTURA DESDE\b/, peso: 2 },
  { codigo: 'arl_afiliacion', patron: /\bSE ENCUENTRA AFILIAD[OA]\b|\bESTADO DE (?:LA )?AFILIACION\b|\bAFILIACION (?:ACTIVA|VIGENTE)\b/, peso: 1.5 },
  { codigo: 'arl_sigla', patron: /\bARL\b/, peso: 1 },
  { codigo: 'arl_empleador', patron: /\bEMPLEADOR\b|\bEMPRESA\b|\bCONTRATANTE\b|\bAPORTANTE\b/, peso: 0.5 },
];

interface FamiliaIncorrecta { subtipo: SubtipoIncorrectoArl; umbral: number; senales: readonly Senal[] }

const FAMILIAS: readonly FamiliaIncorrecta[] = [
  {
    subtipo: 'planilla_aportes_pila', umbral: 5, senales: [
      { codigo: 'pila_planilla', patron: /\bPLANILLA (?:INTEGRADA DE LIQUIDACION DE APORTES|DE APORTES|DE AUTOLIQUIDACION)\b|\bPILA\b/, peso: 3, ancla: true },
      { codigo: 'pila_numero_planilla', patron: /\bNUMERO DE PLANILLA\b|\bPLANILLA (?:NO|NUMERO)\b/, peso: 2 },
      { codigo: 'pila_ibc', patron: /\bINGRESO BASE DE COTIZACION\b|\bIBC\b/, peso: 1.5 },
      { codigo: 'pila_operador', patron: /\bOPERADOR DE INFORMACION\b|\bAPORTES EN LINEA\b|\bMI PLANILLA\b|\bASOPAGOS\b/, peso: 1.5 },
      { codigo: 'pila_subsistemas', patron: /\bCAJA DE COMPENSACION\b|\bFONDO DE PENSIONES\b/, peso: 1.5 },
    ],
  },
  {
    subtipo: 'desprendible_nomina', umbral: 5, senales: [
      { codigo: 'nomina_desprendible', patron: /\bDESPRENDIBLE(?: DE)? (?:PAGO|NOMINA)\b|\bCOMPROBANTE DE (?:PAGO|NOMINA)\b|\bVOLANTE DE PAGO\b|\bCOLILLA DE PAGO\b/, peso: 3, ancla: true },
      { codigo: 'nomina_devengados', patron: /\bDEVENGAD[OA]S?\b/, peso: 2 },
      { codigo: 'nomina_deducciones', patron: /\bDEDUCCIONES\b/, peso: 1.5 },
      { codigo: 'nomina_neto', patron: /\bNETO A PAGAR\b|\bNETO PAGADO\b|\bTOTAL A PAGAR\b/, peso: 2 },
      { codigo: 'nomina_salario', patron: /\bSALARIO BASICO\b|\bSUELDO BASICO\b|\bAUXILIO DE TRANSPORTE\b/, peso: 1.5 },
    ],
  },
  {
    subtipo: 'certificado_eps', umbral: 5, senales: [
      { codigo: 'eps_entidad_promotora', patron: /\bENTIDAD PROMOTORA DE SALUD\b|\bEMPRESA PROMOTORA DE SALUD\b/, peso: 3, ancla: true },
      { codigo: 'eps_regimen', patron: /\bREGIMEN(?: DE SALUD)?\s*:?\s*(?:CONTRIBUTIVO|SUBSIDIADO)\b/, peso: 2, ancla: true },
      { codigo: 'eps_plan_beneficios', patron: /\bPLAN (?:DE|OBLIGATORIO DE) (?:BENEFICIOS|SALUD)\b/, peso: 1.5 },
      { codigo: 'eps_tipo_afiliado', patron: /\bTIPO DE AFILIAD[OA]\b|\b(?:COTIZANTE|BENEFICIARI[OA])\b/, peso: 1 },
      { codigo: 'eps_sigla', patron: /\bEPS\b/, peso: 1 },
    ],
  },
  {
    subtipo: 'rut', umbral: 5, senales: [
      { codigo: 'rut_formulario', patron: /\bREGISTRO UNICO TRIBUTARIO\b|\bFORMULARIO DEL RUT\b/, peso: 3, ancla: true },
      { codigo: 'rut_dian', patron: /\bDIRECCION DE IMPUESTOS Y ADUANAS\b|\bDIAN\b/, peso: 2 },
      { codigo: 'rut_nit', patron: /\bNUMERO DE IDENTIFICACION TRIBUTARIA\b/, peso: 1.5 },
      { codigo: 'rut_responsabilidades', patron: /\bRESPONSABILIDADES\b|\bACTIVIDAD ECONOMICA\b/, peso: 1 },
    ],
  },
  {
    subtipo: 'camara_comercio', umbral: 5, senales: [
      { codigo: 'camara_nombre', patron: /\bCAMARA DE COMERCIO\b/, peso: 2, ancla: true },
      { codigo: 'camara_matricula', patron: /\bMATRICULA MERCANTIL\b/, peso: 2, ancla: true },
      { codigo: 'camara_existencia', patron: /\bEXISTENCIA Y REPRESENTACION LEGAL\b/, peso: 3, ancla: true },
      { codigo: 'camara_renovacion', patron: /\bULTIMO ANO RENOVADO\b|\bFECHA DE RENOVACION\b/, peso: 1 },
    ],
  },
  {
    subtipo: 'certificacion_laboral', umbral: 5, senales: [
      { codigo: 'laboral_certificacion', patron: /\bCERTIFICA(?:DO|CION) LABORAL\b|\bCONSTANCIA LABORAL\b|\bCARTA LABORAL\b/, peso: 3, ancla: true },
      { codigo: 'laboral_labora', patron: /\bLABORA\b|\bLABORO\b|\bSE DESEMPENA\b|\bDESEMPENO EL CARGO\b/, peso: 2 },
      { codigo: 'laboral_cargo', patron: /\bCARGO\b/, peso: 1 },
      { codigo: 'laboral_salario', patron: /\bSALARIO\b|\bSUELDO\b|\bASIGNACION BASICA\b/, peso: 1.5 },
    ],
  },
  {
    subtipo: 'contrato', umbral: 5, senales: [
      { codigo: 'contrato_trabajo', patron: /\bCONTRATO (?:INDIVIDUAL )?DE TRABAJO\b|\bCONTRATO DE APRENDIZAJE\b|\bCONTRATO DE PRESTACION DE SERVICIOS\b/, peso: 3, ancla: true },
      { codigo: 'contrato_clausula', patron: /\bCLAUSULA\b/, peso: 2 },
      { codigo: 'contrato_partes', patron: /\bEL EMPLEADOR Y EL TRABAJADOR\b|\bLAS PARTES\b/, peso: 1.5 },
    ],
  },
];

const MIN_LETRAS = 80;
const UMBRAL_ARL = 5;

function evaluar(texto: string, senales: readonly Senal[]): { puntaje: number; codigos: string[]; ancla: boolean } {
  let puntaje = 0;
  let ancla = false;
  const codigos: string[] = [];
  for (const s of senales) {
    if (s.patron.test(texto)) { puntaje += s.peso; codigos.push(s.codigo); if (s.ancla) ancla = true; }
  }
  return { puntaje, codigos, ancla };
}

export function clasificarDocumentoArl(textoCrudo: string): ClasificacionDocumentalArl {
  const texto = normalizarParaClasificar(textoCrudo);
  if ((texto.match(/[A-Z]/g) ?? []).length < MIN_LETRAS) return { tipo: 'no_determinable', motivos: ['texto_insuficiente'], puntajeArl: 0 };

  const arl = evaluar(texto, SENALES_ARL);
  const otras = FAMILIAS.map((f) => ({ ...f, ...evaluar(texto, f.senales) }))
    .filter((f) => f.ancla && f.puntaje >= f.umbral)
    .sort((a, b) => b.puntaje - a.puntaje);
  const otra = otras[0];

  if (arl.ancla && arl.puntaje >= UMBRAL_ARL && (!otra || arl.puntaje >= 2 * otra.puntaje)) {
    return { tipo: 'certificado_arl_probable', motivos: arl.codigos, puntajeArl: arl.puntaje };
  }
  if (otra && otra.puntaje > arl.puntaje) {
    return {
      tipo: 'documento_incorrecto', subtipoIncorrecto: otra.subtipo, puntajeArl: arl.puntaje,
      motivos: [`contiene_indicadores_${otra.subtipo}`, ...otra.codigos, 'faltan_indicadores_arl', `subtipo_${otra.subtipo}`],
    };
  }
  return {
    tipo: 'no_determinable', puntajeArl: arl.puntaje,
    motivos: [otra ? 'senales_contradictorias' : 'senales_insuficientes', ...arl.codigos, ...(otra?.codigos ?? [])],
  };
}

// ── Corroboración local (para la autoaprobación) ───────────────────────────

/** Administradoras de riesgos laborales reconocidas (nombre comercial, normalizado). */
const ARL_RECONOCIDAS = /\b(?:SURA|SURAMERICANA|POSITIVA|COLMENA|BOLIVAR|AXA COLPATRIA|COLPATRIA|LIBERTY|LA EQUIDAD|EQUIDAD SEGUROS|SEGUROS ALFA|ALFA|MAPFRE)\b/;

const ETIQUETA_FECHA_AFILIACION =
  /\b(?:FECHA DE (?:AFILIACION|INGRESO)|INICIO DE (?:LA )?COBERTURA|COBERTURA DESDE|FECHA INICIO (?:DE )?COBERTURA)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})/;

/** Solo dígitos, con los separadores de miles retirados (`1.032.456.786` → `1032456786`). */
function secuenciasNumericas(texto: string): Set<string> {
  const unido = texto.replace(/(\d)[.\s](?=\d)/g, '$1');
  return new Set(unido.match(/\d+/g) ?? []);
}

export interface SipraParaArl {
  documentoEstudiante: string | null;
  nitEmpresa: string | null;
}

export interface AnalisisCertificadoArl {
  clasificacion: ClasificacionDocumentalArl;
  /** null = SIPRA no tiene el dato para contrastar. */
  documentoEncontrado: boolean | null;
  nitEncontrado: boolean | null;
  arlReconocida: boolean;
  /** AAAA-MM-DD leída del texto local junto a su etiqueta; null si no aparece. Nunca se persiste ni se audita. */
  fechaAfiliacion: string | null;
}

/**
 * Corroboración determinística contra el TEXTO LOCAL: el documento del estudiante y el NIT de la empresa de SIPRA deben
 * APARECER en el certificado (no se leen del modelo). Devuelve solo booleanos y la fecha; ningún otro dato del documento.
 */
export function analizarCertificadoArl(textoCrudo: string, sipra: SipraParaArl): AnalisisCertificadoArl {
  const clasificacion = clasificarDocumentoArl(textoCrudo);
  const texto = normalizarParaClasificar(textoCrudo);
  const numeros = secuenciasNumericas(texto);
  const digitos = (v: string | null): string | null => (v ? v.replace(/\D/g, '') || null : null);
  const doc = digitos(sipra.documentoEstudiante);
  const nit = digitos(sipra.nitEmpresa);
  const fecha = texto.match(ETIQUETA_FECHA_AFILIACION)?.[1] ?? null;
  return {
    clasificacion,
    documentoEncontrado: doc ? numeros.has(doc) : null,
    nitEncontrado: nit ? [...numeros].some((n) => n === nit || (n.length === nit.length + 1 && n.startsWith(nit))) : null,
    arlReconocida: ARL_RECONOCIDAS.test(texto),
    fechaAfiliacion: fecha ? fechaIsoDe(fecha) : null,
  };
}
