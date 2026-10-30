import {
  CampoComparableActa, CampoComparadoActa, CamposActaLeidos, ClasificacionActa, ComparacionActa,
  CriticidadActa, DatosSipraActa, DiscrepanciaActa, ResultadoCampoActa,
} from '../entities/acta-iniciacion';
import { MATRIZ_MODALIDADES } from '../entities/modalidad.entity';
import { Nit } from '../value-objects/nit.vo';
import { CONFIANZA_MINIMA_ACTA } from './extraccion-acta.domain-service';
import {
  compararDocumentos, compararNombres, fechaIsoDe, normalizarTexto,
} from './normalizacion-identidad';

/**
 * Comparación del acta contra lo que SIPRA ya sabe de la práctica.
 *
 * El acta es una fuente DOCUMENTAL INDEPENDIENTE: confirma o contradice a SIPRA, nunca lo
 * actualiza. Un campo que no pudo leerse o que SIPRA no tiene es `informacion_insuficiente`,
 * jamás `coincide`. Esta comparación no aprueba nada: entrega al funcionario qué mirar.
 *
 * Críticos: estudiante, documento, empresa, NIT, remuneración y responsable de la ARL. Las fechas
 * y la modalidad dan discrepancia visible (alta); lo demás es de apoyo.
 */

interface Definicion { etiqueta: string; criticidad: CriticidadActa; orden: number }

const DEFINICIONES: Readonly<Record<CampoComparableActa, Definicion>> = {
  estudiante: { etiqueta: 'Estudiante', criticidad: 'critica', orden: 1 },
  documento: { etiqueta: 'Documento de identidad', criticidad: 'critica', orden: 2 },
  empresa: { etiqueta: 'Empresa', criticidad: 'critica', orden: 3 },
  nit: { etiqueta: 'NIT', criticidad: 'critica', orden: 4 },
  fecha_inicio: { etiqueta: 'Fecha de inicio', criticidad: 'alta', orden: 5 },
  fecha_fin: { etiqueta: 'Fecha de terminación', criticidad: 'alta', orden: 6 },
  modalidad: { etiqueta: 'Modalidad de práctica', criticidad: 'alta', orden: 7 },
  remuneracion: { etiqueta: 'Remuneración', criticidad: 'critica', orden: 8 },
  responsable_arl: { etiqueta: 'Responsable de la ARL', criticidad: 'critica', orden: 9 },
  programa: { etiqueta: 'Programa', criticidad: 'media', orden: 10 },
  jefe_inmediato: { etiqueta: 'Jefe inmediato o tutor', criticidad: 'media', orden: 11 },
  funciones: { etiqueta: 'Funciones o actividades', criticidad: 'baja', orden: 12 },
};

/** Campos sin los cuales el acta no puede llamarse consistente. */
const PRINCIPALES: readonly CampoComparableActa[] = [
  'estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'modalidad',
  'remuneracion', 'responsable_arl',
];

const VISTA_REMUNERACION = { remunerada: 'Remunerada', no_remunerada: 'No remunerada' } as const;
const VISTA_ARL = { empresa: 'Empresa', cun: 'CUN' } as const;

// ── Normalizaciones de comparación ──────────────────────────────────────────

/** Formas jurídicas y ruido que no distinguen a una empresa de otra. */
const RUIDO_EMPRESA: ReadonlySet<string> = new Set([
  'S', 'A', 'SA', 'SAS', 'LTDA', 'LIMITADA', 'E', 'U', 'EU', 'CIA', 'Y', 'DE', 'LA', 'EL', 'LOS', 'LAS', 'EN',
  'SCA', 'ESP', 'SC', 'ESAL', 'EPS', 'IPS',
]);

function tokensEmpresa(valor: string | null): string[] {
  return normalizarTexto(valor).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((t) => t.length > 0 && !RUIDO_EMPRESA.has(t));
}

type Veredicto = ResultadoCampoActa;

function compararEmpresas(sipra: string | null, acta: string | null): Veredicto {
  const a = tokensEmpresa(sipra);
  const b = tokensEmpresa(acta);
  if (a.length === 0 || b.length === 0) return 'informacion_insuficiente';
  const [menor, mayor] = a.length <= b.length ? [a, b] : [b, a];
  const conjunto = new Set(mayor);
  // Mismos tokens significativos, o uno contenido en el otro (con al menos dos tokens o idénticos).
  if (menor.every((t) => conjunto.has(t)) && (menor.length >= 2 || menor.length === mayor.length)) return 'coincide';
  return 'diferente';
}

/** Dígitos del NIT con su DV si lo trae («900.123.456-7»). */
function partesNit(valor: string | null): { base: string; dv: string | null } | { alfanumerico: string } | null {
  const texto = normalizarTexto(valor).replace(/\s+/g, '');
  if (!texto) return null;
  const guion = texto.match(/^(\d[\d.,]*)-(\d)$/);
  if (guion) return { base: guion[1].replace(/\D/g, ''), dv: guion[2] };
  if (/^[\d.,]+$/.test(texto)) return { base: texto.replace(/\D/g, ''), dv: null };
  if (/^[A-Z0-9-]{4,20}$/.test(texto)) return { alfanumerico: texto };
  return null;
}

function compararNits(sipra: string | null, acta: string | null): Veredicto {
  const a = partesNit(sipra);
  const b = partesNit(acta);
  if (!a || !b) return 'informacion_insuficiente';
  if ('alfanumerico' in a || 'alfanumerico' in b) {
    return 'alfanumerico' in a && 'alfanumerico' in b && a.alfanumerico === b.alfanumerico ? 'coincide' : 'diferente';
  }
  if (a.base.length < 5 || b.base.length < 5) return 'informacion_insuficiente';
  if (a.base === b.base) {
    return a.dv && b.dv && a.dv !== b.dv ? 'diferente' : 'coincide';
  }
  // Uno trae el DV pegado al número («9001234567») y el otro no: se acepta solo si el DV es el calculado.
  const [corto, largo] = a.base.length <= b.base.length ? [a, b] : [b, a];
  if (largo.base.length === corto.base.length + 1 && largo.base.startsWith(corto.base)) {
    try {
      if (Nit.calcularDigitoVerificacion(corto.base) === Number(largo.base.slice(-1))) return 'coincide';
    } catch { /* longitud no admitida: se trata como diferente */ }
  }
  return 'diferente';
}

function compararProgramas(sipra: string | null, acta: string | null): Veredicto {
  const ruido = new Set(['PROGRAMA', 'EN', 'DE', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'TECNICA', 'TECNICO', 'TECNOLOGIA', 'TECNOLOGO', 'PROFESIONAL', 'ESCUELA']);
  const toks = (v: string | null): string[] => normalizarTexto(v).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((t) => t && !ruido.has(t));
  const a = toks(sipra);
  const b = toks(acta);
  if (a.length === 0 || b.length === 0) return 'informacion_insuficiente';
  const [menor, mayor] = a.length <= b.length ? [a, b] : [b, a];
  return menor.every((t) => mayor.includes(t)) ? 'coincide' : 'diferente';
}

function isoDeSipra(valor: Date | string | null): string | null {
  if (valor === null) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  return fechaIsoDe(valor);
}

/** Fecha en el texto del acta: acepta «17/03/2026», «2026-03-17» y «17 de marzo de 2026» dentro de un valor más largo. */
export function fechaDeActa(valor: string | null): string | null {
  if (!valor) return null;
  const directa = fechaIsoDe(valor);
  if (directa) return directa;
  const numerica = valor.match(/\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/);
  if (numerica) return fechaIsoDe(numerica[0].replace(/\s+/g, '').replace(/\./g, '/'));
  const larga = normalizarTexto(valor).match(/\d{1,2} (?:DE )?[A-Z]+ (?:DE )?\d{4}/);
  return larga ? fechaIsoDe(larga[0]) : null;
}

/** Texto del acta («Contrato de aprendizaje», «Tipo: Pasantía») → valor de `ModalidadPractica`, o `null`. */
export function modalidadDeTexto(valor: string | null): string | null {
  const texto = ` ${normalizarTexto(valor).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `;
  if (texto.trim().length === 0) return null;
  const candidatos = MATRIZ_MODALIDADES.flatMap((d) =>
    [d.etiqueta, d.etiquetaSgp, d.modalidad.replace(/_/g, ' ')].map((nombre) => ({
      modalidad: d.modalidad,
      nombre: ` ${normalizarTexto(nombre).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `,
    })));
  candidatos.sort((x, y) => y.nombre.length - x.nombre.length);
  return candidatos.find((c) => texto.includes(c.nombre))?.modalidad ?? null;
}

function etiquetaModalidad(valor: string | null): string | null {
  if (!valor) return null;
  return MATRIZ_MODALIDADES.find((d) => String(d.modalidad) === valor)?.etiqueta ?? valor;
}

function solapamiento(a: string | null, b: string | null): Veredicto {
  const pesos = new Set(['DE', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'EN', 'A', 'PARA', 'CON', 'POR', 'UN', 'UNA', 'DEL', 'AL', 'SE', 'QUE']);
  const toks = (v: string | null): Set<string> =>
    new Set(normalizarTexto(v).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter((t) => t.length > 2 && !pesos.has(t)));
  const x = toks(a);
  const y = toks(b);
  if (x.size === 0 || y.size === 0) return 'informacion_insuficiente';
  const comunes = [...x].filter((t) => y.has(t)).length;
  return comunes / Math.min(x.size, y.size) >= 0.4 ? 'coincide' : 'diferente';
}

// ── Comparación ─────────────────────────────────────────────────────────────

export interface ActaParaComparar {
  clasificacion: ClasificacionActa;
  campos: CamposActaLeidos;
  /**
   * Letra a mano o foto/escaneo dudoso leído por OCR: lo leído se conserva y se muestra para revisión, pero NO produce
   * coincidencia ni diferencia automática en los campos críticos.
   */
  lecturaDudosa?: boolean;
}

/** Campos cuya coincidencia o diferencia no se decide con una lectura OCR dudosa. */
const CAMPOS_CRITICOS_COMPARACION: ReadonlySet<CampoComparableActa> = new Set<CampoComparableActa>([
  'estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'remuneracion', 'responsable_arl',
]);
export const NOTA_LECTURA_DUDOSA = 'Lectura por OCR dudosa: revise este dato contra el documento.';

function leido(campos: CamposActaLeidos, nombre: keyof CamposActaLeidos): string | null {
  const c = campos[nombre];
  if (!c || c.valor === null || c.confianza < CONFIANZA_MINIMA_ACTA) return null;
  return c.valor;
}

const vacioONulo = (v: string | null | undefined): string | null => (v && v.trim().length > 0 ? v.trim() : null);

export function compararActaConSipra(acta: ActaParaComparar, sipra: DatosSipraActa): ComparacionActa {
  const { clasificacion, campos } = acta;
  const dudosa = acta.lecturaDudosa === true;
  const esActa = clasificacion.tipoActaDetectada === 'iniciacion_practicas';
  // Si no se confirmó que sea un acta, lo extraído no es del acta: nada se compara.
  const dato = (n: keyof CamposActaLeidos): string | null => (esActa ? leido(campos, n) : null);

  const filas: CampoComparadoActa[] = [];
  const agregar = (
    campo: CampoComparableActa, siprav: string | null, actav: string | null, resultado: Veredicto, nota: string | null = null,
  ): void => {
    const d = DEFINICIONES[campo];
    // Un campo sin lectura o sin dato en SIPRA no puede coincidir.
    const sinDecidir = dudosa && CAMPOS_CRITICOS_COMPARACION.has(campo);
    const efectivo: Veredicto = siprav === null || actav === null || sinDecidir ? 'informacion_insuficiente' : resultado;
    filas.push({
      campo, etiqueta: d.etiqueta, sipra: siprav, acta: actav, resultado: efectivo, criticidad: d.criticidad, orden: d.orden,
      nota: sinDecidir && actav !== null ? NOTA_LECTURA_DUDOSA : nota,
    });
  };

  const nombreSipra = vacioONulo(sipra.estudianteNombre);
  const nombreActa = dato('nombre_estudiante');
  const nombre = compararNombres(nombreSipra, nombreActa);
  agregar('estudiante', nombreSipra, nombreActa,
    nombre === 'igual' || nombre === 'compatible' ? 'coincide' : nombre === 'diferente' ? 'diferente' : 'informacion_insuficiente',
    nombre === 'compatible' ? 'El nombre del acta está incompleto o con otro orden; los datos disponibles son compatibles.' : null);

  const docSipra = vacioONulo(sipra.estudianteDocumento);
  const docActa = dato('documento_estudiante');
  const doc = compararDocumentos(docSipra, docActa);
  agregar('documento', docSipra, docActa, doc === 'igual' ? 'coincide' : doc === 'diferente' ? 'diferente' : 'informacion_insuficiente');

  const empSipra = vacioONulo(sipra.empresaRazonSocial);
  const empActa = dato('empresa');
  agregar('empresa', empSipra, empActa, compararEmpresas(empSipra, empActa));

  const nitSipra = vacioONulo(sipra.empresaNit);
  const nitActa = dato('nit');
  agregar('nit', nitSipra, nitActa, compararNits(nitSipra, nitActa));

  for (const [campo, deSipra, nombreCampo] of [
    ['fecha_inicio', sipra.fechaInicio, 'fecha_inicio'], ['fecha_fin', sipra.fechaFin, 'fecha_fin'],
  ] as const) {
    const s = isoDeSipra(deSipra);
    const crudo = dato(nombreCampo);
    const a = fechaDeActa(crudo);
    agregar(campo, s, a, s === null || a === null ? 'informacion_insuficiente' : s === a ? 'coincide' : 'diferente',
      crudo !== null && a === null ? 'La fecha del acta no se pudo interpretar.' : null);
  }

  const modActaTexto = dato('modalidad_practica');
  const modActa = modalidadDeTexto(modActaTexto);
  const modSipra = vacioONulo(sipra.modalidad);
  agregar('modalidad', etiquetaModalidad(modSipra), modActaTexto, modSipra === null || modActa === null ? 'informacion_insuficiente' : modSipra === modActa ? 'coincide' : 'diferente',
    modActaTexto !== null && modActa === null ? 'La modalidad escrita en el acta no corresponde a una modalidad conocida.' : null);

  const remActa = esActa && clasificacion.remuneracion !== 'no_determinable' ? clasificacion.remuneracion : null;
  agregar('remuneracion',
    sipra.remuneracionEsperada ? VISTA_REMUNERACION[sipra.remuneracionEsperada] : null,
    remActa ? VISTA_REMUNERACION[remActa] : null,
    remActa !== null && sipra.remuneracionEsperada !== null && remActa === sipra.remuneracionEsperada ? 'coincide' : 'diferente');

  const arlActa = esActa && clasificacion.responsableArl !== 'no_determinable' ? clasificacion.responsableArl : null;
  agregar('responsable_arl',
    sipra.responsableArlEsperado ? VISTA_ARL[sipra.responsableArlEsperado] : null,
    arlActa ? VISTA_ARL[arlActa] : null,
    arlActa !== null && sipra.responsableArlEsperado !== null && arlActa === sipra.responsableArlEsperado ? 'coincide' : 'diferente');

  const progSipra = vacioONulo(sipra.programa);
  const progActa = dato('programa');
  agregar('programa', progSipra, progActa, compararProgramas(progSipra, progActa));

  const jefeSipra = vacioONulo(sipra.jefeInmediatoNombre);
  const jefeActa = dato('jefe_inmediato');
  const jefe = compararNombres(jefeSipra, jefeActa);
  agregar('jefe_inmediato', jefeSipra, jefeActa,
    jefe === 'igual' || jefe === 'compatible' ? 'coincide' : jefe === 'diferente' ? 'diferente' : 'informacion_insuficiente');

  const funSipra = vacioONulo(sipra.funciones);
  const funActa = dato('funciones');
  agregar('funciones', funSipra, funActa, solapamiento(funSipra, funActa));

  filas.sort((x, y) => x.orden - y.orden);

  // ── Discrepancias ────────────────────────────────────────────────────────
  const discrepancias: DiscrepanciaActa[] = clasificacion.discrepanciasDocumento.map((d) => ({
    campo: 'documento_acta', codigo: d.codigo, severidad: d.severidad, mensaje: d.mensaje,
  }));
  if (!esActa && !discrepancias.some((d) => d.codigo === 'TIPO_ACTA_NO_CONFIRMADO')) {
    discrepancias.push({
      campo: 'documento_acta', codigo: 'TIPO_ACTA_NO_CONFIRMADO', severidad: 'critica',
      mensaje: clasificacion.tipoActaDetectada === 'documento_incorrecto'
        ? 'El documento cargado no es un acta de iniciación de prácticas.'
        : 'No se pudo confirmar que el documento sea un acta de iniciación de prácticas.',
    });
  }
  for (const f of filas) {
    if (f.resultado === 'diferente') {
      discrepancias.push({
        campo: f.campo, codigo: `${f.campo.toUpperCase()}_DIFERENTE`, severidad: f.criticidad,
        mensaje: `${f.etiqueta}: SIPRA dice «${f.sipra}» y el acta dice «${f.acta}». La información no coincide.`,
      });
    } else if (f.resultado === 'informacion_insuficiente' && esActa && PRINCIPALES.includes(f.campo)) {
      discrepancias.push({
        campo: f.campo, codigo: `${f.campo.toUpperCase()}_NO_VERIFICABLE`, severidad: 'media',
        mensaje: f.sipra === null
          ? `${f.etiqueta}: SIPRA no tiene el dato para compararlo.`
          : `${f.etiqueta}: no se pudo leer en el acta; debe revisarse a mano.`,
      });
    }
  }

  const resumen = {
    coinciden: filas.filter((f) => f.resultado === 'coincide').length,
    diferentes: filas.filter((f) => f.resultado === 'diferente').length,
    insuficientes: filas.filter((f) => f.resultado === 'informacion_insuficiente').length,
    criticas: discrepancias.filter((d) => d.severidad === 'critica').length,
  };
  const principalesCoinciden = PRINCIPALES.every((p) => filas.find((f) => f.campo === p)?.resultado === 'coincide');
  const veredicto = esActa && principalesCoinciden && resumen.diferentes === 0 && discrepancias.length === 0
    ? 'consistente' as const
    : 'revision_necesaria' as const;
  return { campos: filas, discrepancias, resumen, veredicto };
}
