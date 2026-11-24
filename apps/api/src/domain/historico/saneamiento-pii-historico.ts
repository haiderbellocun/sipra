/**
 * Saneamiento de datos personales en los campos de TEXTO LIBRE del histórico del SGP (§31 de
 * `docs/HISTORICO-PRACTICAS-AUDITORIA.md`).
 *
 * El SGP trae, por corrimientos de columnas y digitación libre, correos, celulares y números de documento dentro de
 * campos que no deberían contenerlos (ciudad, cargo, horario, área y, en el caso del celular, salario). La regla es
 * única y vive aquí; el importador la aplica ANTES de persistir:
 *
 *   - si el campo contiene un patrón de dato personal, se persiste `NULL` (no se intenta rescatar la parte limpia ni
 *     se conserva el valor, ni siquiera transformado o resumido en un hash);
 *   - solo queda el HECHO, como marca de calidad por campo (`PII_SUSPECT_*`), nunca el valor ni el tipo concreto.
 *
 * Patrones (cada uno se evalúa sobre el texto tal cual, sin concatenar dígitos separados, para que un horario legítimo
 * como «Lunes a viernes 7:00 a 17:00» nunca parezca un documento):
 *   A. CORREO: usuario `@` dominio con TLD (admite un espacio a cada lado de la arroba).
 *   B. CELULAR (Colombia): `3XXXXXXXXX` continuo, o con la agrupación habitual `3XX XXX XXXX` (espacio, punto o guion).
 *   C. DÍGITOS: siete o más dígitos CONTINUOS (cédula, NIT de persona, teléfono fijo).
 *
 * Dominio puro: sin dependencias externas.
 */

export type PatronPii = 'CORREO' | 'CELULAR' | 'DIGITOS_CONTINUOS';

// Exige dominio con TLD: en el SGP la arroba también se usa como «a» en horarios («8:00 @ 17:00») o como sufijo
// inclusivo en cargos («Auxiliar@ comercial»), y eso no es un correo.
const CORREO = /[A-Za-z0-9._%+-] ?@ ?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const CELULAR = /(?<!\d)3\d{9}(?!\d)|(?<!\d)3\d{2}[ .-]\d{3}[ .-]\d{4}(?!\d)/;
const DIGITOS_CONTINUOS = /\d{7,}/;

/** Patrones de dato personal presentes en el texto (vacío si no hay ninguno). Nunca devuelve el fragmento. */
export function patronesPii(texto: string | null | undefined, opciones: { digitosContinuos?: boolean } = {}): PatronPii[] {
  if (!texto) return [];
  const patrones: PatronPii[] = [];
  if (CORREO.test(texto)) patrones.push('CORREO');
  if (CELULAR.test(texto)) patrones.push('CELULAR');
  if ((opciones.digitosContinuos ?? true) && DIGITOS_CONTINUOS.test(texto)) patrones.push('DIGITOS_CONTINUOS');
  return patrones;
}

export interface TextoSaneado {
  /** El texto original si es limpio; `null` si contenía cualquier patrón de dato personal. */
  valor: string | null;
  /** Hubo que anularlo. */
  saneado: boolean;
}

/** Texto libre (ciudad, cargo, horario, área): cualquiera de los tres patrones lo anula. */
export function sanearTextoLibre(texto: string | null): TextoSaneado {
  if (texto === null) return { valor: null, saneado: false };
  return patronesPii(texto).length > 0 ? { valor: null, saneado: true } : { valor: texto, saneado: false };
}

/**
 * Salario: un monto legítimo tiene siete o más dígitos (1.300.000), así que aquí NO aplica la regla de dígitos
 * continuos; solo correo y celular. Un salario de exactamente `3XXXXXXXXX` (≈ 3.000 millones) es un celular digitado
 * en la columna equivocada, no un monto.
 */
export function esSalarioConPii(texto: string | null): boolean {
  return patronesPii(texto, { digitosContinuos: false }).length > 0;
}
