import { ESTADO_OPERATIVO, EQUIVALENCIA_SGP, EstadoOperativo, EstadoPractica, CicloAcademico } from '../entities/practica.entity';
import { ModalidadPractica } from '../entities/modalidad.entity';
import { Nit } from '../value-objects/nit.vo';
import { Celda } from './fechas-sgp.parser';

/**
 * Normalizadores del registro SGP (§25 y §26). Reglas:
 *  - nunca destruyen el original: cada normalizador devuelve el valor normalizado o `null` y una observación;
 *  - nunca lanzan por un dato extraño: el dato extraño es una marca de calidad, no una excepción;
 *  - los identificadores jamás pasan por `float` cuando vienen como texto.
 */

/** Texto de una celda sin artefactos de tipo; `null` si está vacía. */
export function textoCelda(celda: Celda): string | null {
  if (celda === null || celda === undefined) return null;
  if (celda instanceof Date) return Number.isNaN(celda.getTime()) ? null : celda.toISOString();
  if (typeof celda === 'number') return Number.isFinite(celda) ? numeroComoTexto(celda) : null;
  if (typeof celda === 'boolean') return celda ? 'true' : 'false';
  const t = celda.replace(/\s+/g, ' ').trim();
  return t || null;
}

/** Entero sin notación científica ni `.0`; los no enteros se escriben tal cual. */
function numeroComoTexto(n: number): string {
  return Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? BigInt(n).toString() : String(n);
}

/** Mayúsculas, sin tildes, sin signos, espacios simples: para agrupar variantes, nunca para mostrar. */
export function claveTexto(valor: string | null): string | null {
  if (!valor) return null;
  const t = valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9Ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

// ── Documento de persona (estudiante o docente) ─────────────────────────────

export type ObservacionDocumento = 'ausente' | 'atipico' | null;

export interface DocumentoSgp {
  /** Forma canónica que entra al HMAC; nunca se persiste. */
  normalizado: string | null;
  observacion: ObservacionDocumento;
}

/**
 * Normalización aprobada en §25.7, idéntica para el histórico y (en la fase de correspondencia) para
 * `usuarios.documento`:
 *  - celda numérica: solo si es un entero exacto; se escribe sin `.0` ni notación científica (el `.0` es un artefacto
 *    PROBADO de la representación numérica de Excel). Un número no entero no es un documento confiable;
 *  - texto de solo dígitos con separadores de miles o espacios: se quitan los separadores;
 *  - texto `1234.0`: NO se recorta (no está probado que sea un artefacto): queda atípico y sin clave;
 *  - texto alfanumérico (pasaporte, CE): mayúsculas y solo letras y dígitos;
 *  - los ceros a la izquierda se quitan en los numéricos (el origen ya los perdió al pasar por `float`; la misma regla
 *    en ambos lados mantiene comparables las claves).
 */
export function normalizarDocumentoSgp(celda: Celda): DocumentoSgp {
  if (celda === null || celda === undefined) return { normalizado: null, observacion: 'ausente' };
  if (typeof celda === 'number') {
    if (!Number.isFinite(celda) || !Number.isInteger(celda) || celda <= 0 || celda > Number.MAX_SAFE_INTEGER) {
      return { normalizado: null, observacion: 'atipico' };
    }
    return conLongitud(BigInt(celda).toString());
  }
  if (celda instanceof Date || typeof celda === 'boolean') return { normalizado: null, observacion: 'atipico' };
  const t = celda.trim().toUpperCase();
  if (!t) return { normalizado: null, observacion: 'ausente' };
  if (/^\d+\.0+$/.test(t)) return { normalizado: null, observacion: 'atipico' };
  if (/^[\d.\s-]+$/.test(t)) return conLongitud(t.replace(/[^\d]/g, ''));
  const alfanumerico = t.replace(/[^A-Z0-9]/g, '');
  if (!alfanumerico) return { normalizado: null, observacion: 'atipico' };
  return { normalizado: alfanumerico, observacion: /^\d+$/.test(alfanumerico) ? null : 'atipico' };
}

function conLongitud(digitos: string): DocumentoSgp {
  const sinCeros = digitos.replace(/^0+/, '');
  if (!sinCeros) return { normalizado: null, observacion: 'atipico' };
  const atipico = sinCeros.length < 6 || sinCeros.length > 11;
  return { normalizado: sinCeros, observacion: atipico ? 'atipico' : null };
}

// ── Identificador de la organización (NIT) ──────────────────────────────────

export type TipoIdentificadorOrganizacion = 'juridica' | 'persona_natural' | 'indeterminado' | 'no_estandar' | 'invalido' | 'ausente';

export interface IdentificadorOrganizacion {
  tipo: TipoIdentificadorOrganizacion;
  /** Forma canónica que entra al HMAC (sin DV cuando se identificó); nunca se persiste en claro. */
  normalizado: string | null;
  /** ¿El DV presente coincide con el algoritmo DIAN? `null` si no hay DV identificable. */
  dvValido: boolean | null;
  /** Solo para personas jurídicas con DV verificado: el NIT base en claro (no es dato personal). */
  nitJuridica: string | null;
}

const TRIVIALES = new Set(['123456789', '1234567890', '987654321', '0123456789']);

/**
 * Clasifica el «Nit Empresa» sin normalizar destructivamente (§7 y §25.6). Solo se considera persona jurídica un
 * NIT base de 9 dígitos que empieza por 8 o 9 (rango de la DIAN para personas jurídicas); una cédula usada como NIT
 * (persona natural) nunca se guarda en claro.
 */
export function analizarIdentificadorOrganizacion(celda: Celda): IdentificadorOrganizacion {
  const ausente: IdentificadorOrganizacion = { tipo: 'ausente', normalizado: null, dvValido: null, nitJuridica: null };
  if (celda === null || celda === undefined || celda instanceof Date || typeof celda === 'boolean') return ausente;
  let t = typeof celda === 'number' ? (Number.isInteger(celda) && celda > 0 ? BigInt(celda).toString() : '') : celda.toUpperCase();
  t = t.replace(/^[\s:.]*(NIT|RUT|TIN)?[\s:.]*/, '').trim();
  if (!t) return ausente;
  if (/[A-Z]/.test(t)) {
    const alfa = t.replace(/[^A-Z0-9]/g, '');
    return alfa.length >= 5 ? { tipo: 'no_estandar', normalizado: `X${alfa}`, dvValido: null, nitJuridica: null } : { ...ausente, tipo: 'invalido' };
  }
  const explicito = /^([\d.\s]+?)\s*-\s*(\d)$/.exec(t);
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 6 || /^(\d)\1+$/.test(digitos) || TRIVIALES.has(digitos)) return { ...ausente, tipo: 'invalido' };

  if (explicito) {
    const base = explicito[1].replace(/\D/g, '');
    const dv = Number(explicito[2]);
    const valido = base.length >= 6 && Nit.esValido(base, dv);
    return clasificarBase(base, valido);
  }
  if (digitos.length === 10 && /^[89]/.test(digitos)) {
    const base = digitos.slice(0, 9);
    if (Nit.esValido(base, Number(digitos[9]))) return clasificarBase(base, true);
    return { tipo: 'indeterminado', normalizado: digitos, dvValido: false, nitJuridica: null };
  }
  if (digitos.length === 9 && /^[89]/.test(digitos)) return { tipo: 'juridica', normalizado: digitos, dvValido: null, nitJuridica: null };
  if (digitos.length === 11) {
    const base = digitos.slice(0, 10);
    if (Nit.esValido(base, Number(digitos[10]))) return { tipo: 'persona_natural', normalizado: base, dvValido: true, nitJuridica: null };
    return { tipo: 'indeterminado', normalizado: digitos, dvValido: false, nitJuridica: null };
  }
  if (digitos.length === 10 && digitos.startsWith('1')) return { tipo: 'persona_natural', normalizado: digitos, dvValido: null, nitJuridica: null };
  if (digitos.length > 11) return { tipo: 'no_estandar', normalizado: digitos, dvValido: null, nitJuridica: null };
  // 6–8 dígitos: cédula antigua o NIT incompleto. Puede ser persona natural: no se guarda en claro.
  return { tipo: 'indeterminado', normalizado: digitos, dvValido: null, nitJuridica: null };
}

function clasificarBase(base: string, dvValido: boolean): IdentificadorOrganizacion {
  if (base.length === 9 && /^[89]/.test(base)) {
    return { tipo: 'juridica', normalizado: base, dvValido, nitJuridica: dvValido ? base : null };
  }
  if (dvValido && (base.length === 10 || base.length <= 8)) return { tipo: 'persona_natural', normalizado: base, dvValido, nitJuridica: null };
  return { tipo: 'indeterminado', normalizado: base, dvValido, nitJuridica: null };
}

/** Versión de la normalización de nombres de empresa: cambia si cambia la regla (y con ella los alias). */
export const VERSION_NORMALIZACION_ALIAS = 'n1';

const SUFIJOS_SOCIETARIOS = /\b(S ?A ?S|S ?A|LTDA|LIMITADA|E ?S ?P|S EN C|E ?U|S ?C ?A|COOP)\b/g;

/** Nombre de empresa canónico para el alias seudónimo (nunca se persiste en claro). */
export function nombreEmpresaCanonico(celda: Celda): string | null {
  const t = claveTexto(textoCelda(celda));
  if (!t) return null;
  const sinSufijo = t.replace(SUFIJOS_SOCIETARIOS, ' ').replace(/\s+/g, ' ').trim();
  return sinSufijo || t;
}

// ── Salario ─────────────────────────────────────────────────────────────────

export type CalidadSalario = 'exacto' | 'no_remunerado' | 'referencia_smmlv' | 'atipico' | 'no_interpretable' | 'ausente';

export interface SalarioSgp {
  /** Texto original solo si no parece contener datos personales. */
  original: string | null;
  normalizado: number | null;
  calidad: CalidadSalario;
}

const SALARIO_MAXIMO_PLAUSIBLE = 20_000_000;
const SALARIO_MINIMO_PLAUSIBLE = 10_000;

function porMonto(valor: number, original: string | null): SalarioSgp {
  if (valor === 0) return { original, normalizado: 0, calidad: 'no_remunerado' };
  const atipico = valor < 0 || valor < SALARIO_MINIMO_PLAUSIBLE || valor > SALARIO_MAXIMO_PLAUSIBLE;
  return { original, normalizado: valor, calidad: atipico ? 'atipico' : 'exacto' };
}

/** §25.11: solo se normaliza lo inequívoco; lo demás se conserva y se marca. */
export function parsearSalarioSgp(celda: Celda): SalarioSgp {
  if (celda === null || celda === undefined) return { original: null, normalizado: null, calidad: 'ausente' };
  if (typeof celda === 'number') {
    if (!Number.isFinite(celda) || !Number.isInteger(celda)) return { original: String(celda), normalizado: null, calidad: 'no_interpretable' };
    return porMonto(celda, BigInt(celda).toString());
  }
  if (celda instanceof Date || typeof celda === 'boolean') return { original: null, normalizado: null, calidad: 'no_interpretable' };
  const crudo = celda.trim();
  if (!crudo) return { original: null, normalizado: null, calidad: 'ausente' };
  // Un salario no lleva arroba ni textos largos: si los trae, no se guarda el texto (podría ser un dato personal).
  const original = crudo.length <= 40 && !crudo.includes('@') ? crudo : null;
  const t = claveTexto(crudo) ?? '';
  if (/^(NO REMUNERAD[OA]|NO APLICA|NINGUNO|N A|NA|SIN REMUNERACION)$/.test(t)) return { original, normalizado: 0, calidad: 'no_remunerado' };
  if (/\b(SMM?LV|SALARIO MINIMO|MINIMO)\b/.test(t)) return { original, normalizado: null, calidad: 'referencia_smmlv' };
  if (/^\d+$/.test(crudo)) return porMonto(Number(crudo), original);
  if (/^\d{1,3}(\.\d{3})+$/.test(crudo)) return porMonto(Number(crudo.replace(/\./g, '')), original);
  return { original, normalizado: null, calidad: 'no_interpretable' };
}

// ── Nivel (ciclo) ───────────────────────────────────────────────────────────

export type FuenteNivel = 'nivel_formacion' | 'nombre_asignatura' | 'unknown';

export interface NivelSgp {
  inferido: CicloAcademico | null;
  fuente: FuenteNivel;
  faltante: boolean;
  conflicto: boolean;
}

function cicloDeTexto(texto: string | null): CicloAcademico | null {
  const t = claveTexto(texto);
  if (!t) return null;
  if (/\bTECNOLOG/.test(t)) return CicloAcademico.TECNOLOGO;
  if (/\bTECNIC/.test(t)) return CicloAcademico.TECNICO;
  if (/\bPROFESIONAL\b/.test(t)) return CicloAcademico.PROFESIONAL;
  return null;
}

/**
 * §25.8: `Nivel Formación` está vacío en el 58 % de las filas; `Nombre Asignatura` (la asignatura de práctica de
 * cada nivel) nunca lo está. El original no se sobrescribe: solo se infiere el ciclo y se dice de dónde salió.
 */
export function inferirNivelSgp(nivelFormacion: string | null, nombreAsignatura: string | null): NivelSgp {
  const porNivel = cicloDeTexto(nivelFormacion);
  const porAsignatura = cicloDeTexto(nombreAsignatura);
  const faltante = !nivelFormacion;
  if (porNivel && porAsignatura && porNivel !== porAsignatura) {
    return { inferido: porAsignatura, fuente: 'nombre_asignatura', faltante, conflicto: true };
  }
  if (porNivel) return { inferido: porNivel, fuente: 'nivel_formacion', faltante, conflicto: false };
  if (porAsignatura) return { inferido: porAsignatura, fuente: 'nombre_asignatura', faltante, conflicto: false };
  return { inferido: null, fuente: 'unknown', faltante: true, conflicto: false };
}

// ── Modalidad de estudio (NO es la modalidad de práctica) ───────────────────

export type ModalidadEstudio = 'virtual' | 'presencial' | 'a_distancia';

export function normalizarModalidadEstudio(texto: string | null): ModalidadEstudio | null {
  const t = claveTexto(texto);
  if (t === 'VIRTUAL') return 'virtual';
  if (t === 'PRESENCIAL') return 'presencial';
  if (t === 'A DISTANCIA' || t === 'DISTANCIA') return 'a_distancia';
  return null;
}

// ── Modalidad de práctica (15 del SGP → 14 de SIPRA) ────────────────────────

export type EstadoMapeo = 'MAPPED' | 'PENDING_INSTITUTIONAL_MAPPING' | 'UNMAPPED' | 'MISSING';

/**
 * Equivalencia del selector del SGP con `ModalidadPractica` (§25.11). Tipada contra el enum: si una modalidad de SIPRA
 * cambia de nombre, esto no compila. `EMPRESA PROPIA` (424 filas, 2019–2023) NO tiene equivalente: asignarla a
 * CUNbre es una decisión institucional pendiente, no del importador.
 */
export const EQUIVALENCIA_MODALIDAD_SGP: Readonly<Record<string, ModalidadPractica | null>> = {
  'VALIDACION DE LA EXPERIENCIA LABORAL': ModalidadPractica.VALIDACION_EXPERIENCIA,
  'PASANTIA': ModalidadPractica.PASANTIA,
  'CONTRATO DE APRENDIZAJE': ModalidadPractica.CONTRATO_APRENDIZAJE,
  'COMBINACION DE FUNCIONES': ModalidadPractica.COMBINACION_FUNCIONES,
  'PRACTICA TECNICA EN INVESTIGACION': ModalidadPractica.PRACTICA_TECNICA_INVESTIGACION,
  'PRACTICA INVESTIGATIVA': ModalidadPractica.INVESTIGACION,
  'EMPRENDIMIENTO CUNBRE NACIENTE': ModalidadPractica.CUNBRE_NACIENTE,
  'PROYECCION SOCIAL': ModalidadPractica.SOCIAL,
  'MONITORIA': ModalidadPractica.MONITORIA,
  'ASESORIA Y ASISTENCIA TECNICA': ModalidadPractica.ASESORIA_ASISTENCIA_TECNICA,
  'EMPRENDIMIENTO CUNBRE CONSOLIDADO': ModalidadPractica.CUNBRE_CONSOLIDADO,
  'ESTADO JOVEN PASANTIAS': ModalidadPractica.ESTADO_JOVEN,
  'PASANTIA INTERNACIONAL': ModalidadPractica.PASANTIA_INTERNACIONAL,
  'PASANTIA INVESTIGATIVA': ModalidadPractica.PASANTIA_INVESTIGATIVA,
  'EMPRESA PROPIA': null,
};

export interface ModalidadPracticaSgp {
  normalizada: ModalidadPractica | null;
  estadoMapeo: EstadoMapeo;
}

export function mapearModalidadPracticaSgp(texto: string | null): ModalidadPracticaSgp {
  const t = claveTexto(texto);
  if (!t) return { normalizada: null, estadoMapeo: 'MISSING' };
  if (!(t in EQUIVALENCIA_MODALIDAD_SGP)) return { normalizada: null, estadoMapeo: 'UNMAPPED' };
  const m = EQUIVALENCIA_MODALIDAD_SGP[t];
  return m ? { normalizada: m, estadoMapeo: 'MAPPED' } : { normalizada: null, estadoMapeo: 'PENDING_INSTITUTIONAL_MAPPING' };
}

// ── Estado (inversa exacta de la equivalencia SGP del dominio) ──────────────

/** Etiqueta SGP canónica → estado operativo, derivada de `EQUIVALENCIA_SGP` y `ESTADO_OPERATIVO` (una sola fuente). */
const ESTADO_POR_ETIQUETA_SGP: ReadonlyMap<string, EstadoOperativo> = (() => {
  const mapa = new Map<string, EstadoOperativo>();
  for (const estado of Object.values(EstadoPractica)) {
    const etiqueta = claveTexto(EQUIVALENCIA_SGP[estado]);
    if (etiqueta) mapa.set(etiqueta, ESTADO_OPERATIVO[estado]);
  }
  return mapa;
})();

/** Estados que en el SGP describen un proceso abierto: en el histórico son el estado AL CORTE, no el actual. */
const ESTADOS_ABIERTOS: readonly EstadoOperativo[] = ['inscrito', 'en_practica'];

export interface EstadoSgp {
  analitico: EstadoOperativo | null;
  estadoMapeo: EstadoMapeo;
  esEstadoDeCorte: boolean;
}

export function mapearEstadoSgp(texto: string | null): EstadoSgp {
  const t = claveTexto(texto);
  if (!t) return { analitico: null, estadoMapeo: 'MISSING', esEstadoDeCorte: false };
  const analitico = ESTADO_POR_ETIQUETA_SGP.get(t) ?? null;
  if (!analitico) return { analitico: null, estadoMapeo: 'UNMAPPED', esEstadoDeCorte: false };
  return { analitico, estadoMapeo: 'MAPPED', esEstadoDeCorte: ESTADOS_ABIERTOS.includes(analitico) };
}

// ── Números de seguimiento ──────────────────────────────────────────────────

/** Proporción 0–1 del SGP (no es un conteo). Fuera de rango → `null` y marca. */
export function proporcion(celda: Celda): { valor: number | null; invalida: boolean } {
  if (celda === null || celda === undefined || celda === '') return { valor: null, invalida: false };
  const n = typeof celda === 'number' ? celda : typeof celda === 'string' ? Number(celda.trim().replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return { valor: null, invalida: true };
  return { valor: Math.round(n * 1000) / 1000, invalida: false };
}

export function conteoNoNegativo(celda: Celda): { valor: number | null; invalido: boolean } {
  if (celda === null || celda === undefined || celda === '') return { valor: null, invalido: false };
  const n = typeof celda === 'number' ? celda : typeof celda === 'string' ? Number(celda.trim()) : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return { valor: null, invalido: true };
  return { valor: n, invalido: false };
}
