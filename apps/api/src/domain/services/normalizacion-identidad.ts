/**
 * Normalización determinística de identidad para comparar el certificado de EPS
 * con lo que SIPRA sabe del estudiante.
 *
 * Reglas de diseño:
 *  · Solo se eliminan diferencias de FORMATO (separadores, tildes, mayúsculas,
 *    espacios, orden de los nombres). Nunca se «corrige» ni se interpreta un
 *    número: los ceros a la izquierda se conservan y un valor ambiguo devuelve
 *    `null` («no comparable»), no un valor inventado.
 *  · La coincidencia de nombres NO es prueba de identidad por sí sola; la prueba
 *    principal es el número de documento (ver `comparacion-eps.domain-service`).
 *  · Sin dependencias: funciones puras, probables sin infraestructura.
 *
 * `parecido` (coherencia cruzada) no se reutiliza a propósito: es permisivo —
 * devuelve «coincide» si alguno de los textos queda vacío o por simple inclusión
 * de subcadenas—, lo cual es inaceptable para decidir una identidad.
 */

/** Quita tildes, pasa a mayúsculas y colapsa espacios. «Ñ» se reduce a «N» (los certificados la pierden a menudo). */
export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return '';
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// ── Documento ───────────────────────────────────────────────────────────────

export type TipoDocumentoIdentidad = 'CC' | 'TI' | 'CE' | 'PA' | 'RC';

export interface DocumentoNormalizado {
  /** Tipo si el texto lo declara («C.C. 123», «Cédula de ciudadanía 123»); si no, `null`. */
  tipo: TipoDocumentoIdentidad | null;
  /** Número sin separadores, tal cual (sin convertirlo a número); `null` si no es comparable. */
  numero: string | null;
}

/** El prefijo debe terminar ahí: seguido de espacio, signo, «N°» o dígitos (no de más letras). */
const FIN_PREFIJO = '(?=[\\s.:#°ºN\\d-]|$)';
const PREFIJOS_DOCUMENTO: readonly [RegExp, TipoDocumentoIdentidad][] = [
  [new RegExp(`^(?:C\\.?\\s?E\\.?|CEDULA DE EXTRANJERIA)${FIN_PREFIJO}`), 'CE'],
  [new RegExp(`^(?:C\\.?\\s?C\\.?|CEDULA(?: DE)? CIUDADANIA|CEDULA)${FIN_PREFIJO}`), 'CC'],
  [new RegExp(`^(?:T\\.?\\s?I\\.?|TARJETA DE IDENTIDAD)${FIN_PREFIJO}`), 'TI'],
  [new RegExp(`^(?:R\\.?\\s?C\\.?|REGISTRO CIVIL(?: DE NACIMIENTO)?|NUIP)${FIN_PREFIJO}`), 'RC'],
  [new RegExp(`^(?:P\\.?\\s?A\\.?|PASAPORTE)${FIN_PREFIJO}`), 'PA'],
];

/**
 * «1.032.456.786», «1 032 456 786», «C.C. 1032456786» → { CC, '1032456786' }.
 * Separadores admitidos: espacio, punto y coma. Cualquier otro carácter junto
 * a los dígitos (letras, guiones, signos) deja el número como no comparable.
 */
export function normalizarDocumento(valor: string | null | undefined): DocumentoNormalizado {
  const texto = normalizarTexto(valor);
  if (!texto) return { tipo: null, numero: null };

  let tipo: TipoDocumentoIdentidad | null = null;
  let resto = texto;
  for (const [patron, codigo] of PREFIJOS_DOCUMENTO) {
    const coincidencia = texto.match(patron);
    if (coincidencia) {
      tipo = codigo;
      // «CEDULA DE CIUDADANIA NUMERO 123»: la palabra «número» no es parte del número.
      resto = texto.slice(coincidencia[0].length).replace(/^(?:[\s:.\-#°º]|NUMERO\b|NRO\b|NO\b|N(?=[\s.:°º\d]))+/, '');
      break;
    }
  }

  const sinSeparadores = resto.replace(/[\s.,]/g, '');
  if (/^\d{4,15}$/.test(sinSeparadores)) return { tipo, numero: sinSeparadores };
  // Pasaporte y cédula de extranjería pueden ser alfanuméricos.
  if ((tipo === 'PA' || tipo === 'CE') && /^[A-Z0-9]{5,20}$/.test(sinSeparadores)) {
    return { tipo, numero: sinSeparadores };
  }
  return { tipo, numero: null };
}

export type ComparacionDocumento = 'igual' | 'diferente' | 'insuficiente';

/** Igualdad EXACTA del número normalizado. Si el tipo está en ambos y difiere, también son distintos. */
export function compararDocumentos(
  esperado: string | null | undefined,
  observado: string | null | undefined,
): ComparacionDocumento {
  const a = normalizarDocumento(esperado);
  const b = normalizarDocumento(observado);
  if (!a.numero || !b.numero) return 'insuficiente';
  if (a.tipo && b.tipo && a.tipo !== b.tipo) return 'diferente';
  return a.numero === b.numero ? 'igual' : 'diferente';
}

// ── Nombre ──────────────────────────────────────────────────────────────────

/** Partículas que no distinguen a una persona de otra. */
const PARTICULAS_NOMBRE: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E']);

/** Tokens del nombre en mayúsculas, sin tildes ni signos ni partículas; el orden no importa. */
export function tokensDeNombre(valor: string | null | undefined): string[] {
  return normalizarTexto(valor)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !PARTICULAS_NOMBRE.has(t));
}

export type ComparacionNombre = 'igual' | 'compatible' | 'diferente' | 'insuficiente';

/**
 *  · `igual`: mismos tokens (sin importar orden, tildes ni mayúsculas).
 *  · `compatible`: todos los tokens del nombre más corto están en el más largo
 *    y son al menos dos (p. ej. falta un apellido en el certificado).
 *  · `diferente`: cualquier otro caso.
 *  · `insuficiente`: algún nombre vacío.
 */
export function compararNombres(
  esperado: string | null | undefined,
  observado: string | null | undefined,
): ComparacionNombre {
  const a = new Set(tokensDeNombre(esperado));
  const b = new Set(tokensDeNombre(observado));
  if (a.size === 0 || b.size === 0) return 'insuficiente';
  if (a.size === b.size && [...a].every((t) => b.has(t))) return 'igual';
  const [menor, mayor] = a.size <= b.size ? [a, b] : [b, a];
  if (menor.size >= 2 && [...menor].every((t) => mayor.has(t))) return 'compatible';
  return 'diferente';
}

// ── EPS ─────────────────────────────────────────────────────────────────────

/** Formas jurídicas y genéricos que no identifican a la EPS. */
const RUIDO_EPS: ReadonlySet<string> = new Set([
  'S', 'A', 'SA', 'SAS', 'E', 'P', 'EPS', 'LTDA', 'EPSS', 'CM',
]);

/**
 * Clave canónica del nombre de una EPS: «NUEVA EPS», «Nueva EPS S.A.» y
 * «nueva eps s.a.s.» dan la misma clave («NUEVA»). Los alias futuros (nombres
 * comerciales, fusiones) se pasan como mapa `clave → clave canónica`; no hay
 * ninguna lista de EPS escrita aquí.
 */
export function claveEps(
  nombre: string | null | undefined,
  alias: Readonly<Record<string, string>> = {},
): string | null {
  const texto = normalizarTexto(nombre)
    .replace(/ENTIDAD PROMOTORA DE SALUD/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ');
  const clave = texto.split(' ').filter((t) => t.length > 0 && !RUIDO_EPS.has(t)).join(' ');
  if (!clave) return null;
  return alias[clave] ?? clave;
}

export function mismaEps(
  a: string | null | undefined,
  b: string | null | undefined,
  alias: Readonly<Record<string, string>> = {},
): boolean | null {
  const x = claveEps(a, alias);
  const y = claveEps(b, alias);
  if (!x || !y) return null;
  return x === y;
}

// ── Régimen y estado reportado ──────────────────────────────────────────────

export type RegimenCanonico = 'contributivo' | 'subsidiado' | 'especial';
export type TipoAfiliado = 'cotizante' | 'beneficiario';

export interface RegimenNormalizado {
  regimen: RegimenCanonico | null;
  tipoAfiliado: TipoAfiliado | null;
}

/**
 * Vocabulario canónico del régimen. Un texto que mencione dos regímenes
 * distintos es ambiguo y devuelve `null`: no se elige uno.
 */
export function normalizarRegimen(valor: string | null | undefined): RegimenNormalizado {
  const texto = normalizarTexto(valor);
  const encontrados = new Set<RegimenCanonico>();
  if (/CONTRIBUTIV/.test(texto)) encontrados.add('contributivo');
  if (/SUBSIDIAD/.test(texto)) encontrados.add('subsidiado');
  if (/ESPECIAL|EXCEPCION|FOMAG|MAGISTERIO|FUERZAS MILITARES|POLICIA/.test(texto)) encontrados.add('especial');
  return {
    regimen: encontrados.size === 1 ? [...encontrados][0] : null,
    tipoAfiliado: /COTIZANTE/.test(texto) ? 'cotizante' : /BENEFICIARI/.test(texto) ? 'beneficiario' : null,
  };
}

export type EstadoReportado = 'ACTIVO' | 'INACTIVO' | 'SUSPENDIDO' | 'RETIRADO';

/**
 * Lo que el CERTIFICADO dice del estado de la afiliación. No es el estado real
 * de la afiliación: eso solo lo establece una verificación externa.
 */
export function normalizarEstadoReportado(valor: string | null | undefined): EstadoReportado | null {
  const texto = normalizarTexto(valor);
  if (!texto) return null;
  if (/INACTIV|CANCELAD|TERMINAD|NO VIGENTE/.test(texto)) return 'INACTIVO';
  if (/SUSPEND/.test(texto)) return 'SUSPENDIDO';
  if (/RETIRAD/.test(texto)) return 'RETIRADO';
  if (/ACTIV|VIGENTE/.test(texto)) return 'ACTIVO';
  return null;
}

// ── Fecha ───────────────────────────────────────────────────────────────────

const MESES: Readonly<Record<string, number>> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

function fechaValida(anio: number, mes: number, dia: number): string | null {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const coincide =
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
  return coincide ? fecha.toISOString().slice(0, 10) : null;
}

/** «2026-03-05», «05/03/2026», «5-3-26» y «5 de marzo de 2026» → «2026-03-05»; si no se entiende, `null`. */
export function fechaIsoDe(valor: string | null | undefined): string | null {
  const texto = normalizarTexto(valor);
  if (!texto) return null;
  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return fechaValida(+iso[1], +iso[2], +iso[3]);
  const latino = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (latino) {
    const anio = latino[3].length === 2 ? 2000 + +latino[3] : +latino[3];
    return fechaValida(anio, +latino[2], +latino[1]);
  }
  const larga = texto.match(/^(\d{1,2}) DE ([A-Z]+) DE (\d{4})$/);
  if (larga && MESES[larga[2]]) return fechaValida(+larga[3], MESES[larga[2]], +larga[1]);
  return null;
}
