/**
 * Normalización de TEXTO para leer el acta de iniciación (texto nativo u OCR).
 *
 * Funciones puras. Tolera tildes, mayúsculas, espacios y saltos de línea, etiquetas
 * partidas entre líneas y las confusiones típicas del OCR (O/0, I/1/l, S/5, B/8).
 */

const CONFUNDIBLES: Readonly<Record<string, string>> = {
  O: 'O0Q', I: 'I1L|', L: 'L1I|', S: 'S5', B: 'B8',
};

/**
 * Mayúsculas y sin tildes, CONSERVANDO el largo y los saltos de línea: un índice del
 * texto plegado es el mismo índice del original, así se recorta el valor con su forma
 * original. «Ñ» pasa a «N».
 */
export function plegar(texto: string): string {
  let salida = '';
  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    const base = caracter.normalize('NFD')[0] ?? caracter;
    const mayuscula = base.toUpperCase();
    salida += mayuscula.length === 1 ? mayuscula : base;
  }
  return salida;
}

/** Plegado y con los espacios colapsados (para clasificar, donde el índice no importa). */
export function plegarColapsado(texto: string): string {
  // `\s` ya cubre el espacio duro; se conservan los saltos de línea.
  return plegar(texto).replace(/[^\S\r\n]+/g, ' ');
}

function escaparCaracter(c: string): string {
  return /[.*+?^${}()|[\]\\\-/]/.test(c) ? `\\${c}` : c;
}

/**
 * Patrón tolerante a OCR para una frase en mayúsculas sin tildes: cada letra admite sus
 * confusiones y entre palabras caben espacios, saltos de línea o nada (palabras pegadas
 * o partidas). Solo se usa con frases largas; una palabra suelta no se vuelve tolerante.
 */
export function frase(texto: string): string {
  return texto
    .split(/\s+/)
    .map((palabra) =>
      [...palabra]
        .map((c) => (CONFUNDIBLES[c] ? `[${CONFUNDIBLES[c].replace(/[|\\\]\-^]/g, '\\$&')}]` : escaparCaracter(c)))
        .join(''),
    )
    .join('\\s*');
}

export function sinSeparadoresDeValor(valor: string): string {
  return valor
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.,_|\-–—]+/, '')
    .replace(/[\s:;,_|\-–—]+$/, '')
    .trim();
}

/** Texto de relleno de formulario («_____», «.....», «- - -»): no es un valor. */
export function esRelleno(valor: string): boolean {
  return !/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/.test(valor);
}
