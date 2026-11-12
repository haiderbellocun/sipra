import { TonoV3 } from '@shared/components/senal-estado.component';

/**
 * Capa de gráficas de Reportes (V3.1): utilidades puras de escala, formato y tono. Sin lógica de dominio: los componentes
 * de gráfica reciben series, rótulos, formateadores y selección; las cifras las arma cada pestaña.
 */

/** Tonos del SIPRA Charts Theme (ver `ESTILOS_REPORTES`): cada clase `gt-<tono>` fija `--c`, que la marca gráfica consume. */
export type TonoGrafico = 'principal' | 'comparacion' | 'ok' | 'info' | 'aviso' | 'riesgo' | 'muted' | 'interna' | 'externa'
  | 'principal-suave' | 'comparacion-suave' | 'info-suave' | `c${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

/** Paleta categórica (sectores, modalidades, escuelas): orden fijo, para que una categoría conserve su color. */
export const CATEGORICOS: readonly TonoGrafico[] = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'];
export const categorico = (i: number): TonoGrafico => CATEGORICOS[((i % CATEGORICOS.length) + CATEGORICOS.length) % CATEGORICOS.length];

/** Orden de series cuando hay varias (líneas, cruces): dato principal, comparación y, solo si hacen falta, sus variantes. */
export const TONOS_SERIE: readonly TonoGrafico[] = ['c0', 'c6', 'c1', 'c3', 'c4'];

/** Tono de gráfica a partir del tono de estado V3 (las categorías de dominio ya traen el suyo). */
export function tonoDe(t: TonoV3, clase?: string): TonoGrafico {
  if (clase === 'info-suave') return 'info-suave';
  switch (t) {
    case 'ok': return 'ok';
    case 'info': return 'info';
    case 'aviso': return 'aviso';
    case 'peligro': return 'riesgo';
    default: return 'muted';
  }
}

/** Parte de una composición (100 %, dona): `pct` ya formateado (p. ej. «12,1 %»). */
export interface ParteGrafico { clave: string; texto: string; n: number; pct: string; tono: TonoGrafico }

/** Datos del tooltip compartido (Signal Inspector mini). `x`, `y` relativos al marco de la gráfica. */
export interface TipGrafico { x: number; y: number; titulo: string; lineas: string[]; pie?: string; izquierda: boolean; tono?: TonoGrafico }

export interface Escala { max: number; marcas: number[] }

/**
 * Escala lineal «redonda» desde 0 (estilo d3 `nice`): paso 1, 2, 5 × 10ⁿ con unas `objetivo` marcas. Con `entero`, el paso
 * mínimo es 1 (conteos). El máximo nunca es menor que el dato: la barra más larga cabe con su rótulo al final.
 */
export function escala(maximo: number, objetivo = 4, entero = true): Escala {
  if (!(maximo > 0)) return { max: 1, marcas: [0, 1] };
  const crudo = maximo / objetivo;
  const p = 10 ** Math.floor(Math.log10(crudo));
  const e = crudo / p;
  let paso = (e >= 7.07 ? 10 : e >= 3.16 ? 5 : e >= 1.41 ? 2 : 1) * p;
  if (entero) paso = Math.max(1, Math.round(paso));
  const max = Math.ceil(maximo / paso - 1e-9) * paso;
  const marcas: number[] = [];
  for (let v = 0; v <= max + paso / 2; v += paso) marcas.push(Math.round(v * 1e6) / 1e6);
  return { max, marcas };
}

/** Número en es-CO (separador de miles con punto). */
export function num(n: number, decimales = 0): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: decimales, minimumFractionDigits: decimales });
}

/**
 * Posición del tooltip relativa al marco: con mouse, junto al puntero; con teclado (foco), a la derecha del elemento
 * enfocado. Cerca del borde derecho se abre hacia la izquierda.
 */
export function tipEn(marco: HTMLElement, ev: Event, titulo: string, lineas: string[], pie?: string, tono?: TonoGrafico): TipGrafico {
  const m = marco.getBoundingClientRect();
  let x: number, y: number;
  if (ev.type.startsWith('mouse') && 'clientX' in ev) {
    x = (ev as MouseEvent).clientX - m.left;
    y = (ev as MouseEvent).clientY - m.top;
  } else {
    const b = (ev.target as HTMLElement).getBoundingClientRect();
    x = Math.min(b.right, b.left + 260) - m.left;
    y = b.top + b.height / 2 - m.top;
  }
  return { x, y, titulo, lineas, pie, izquierda: x > m.width * 0.6, tono };
}

/** «Clic para filtrar» o «Clic para quitar el filtro», según el estado de la categoría. */
export function pieFiltro(seleccionada: boolean): string {
  return seleccionada ? 'Clic para quitar el filtro' : 'Clic para filtrar';
}

/** Ancho móvil: coincide con `@media (width < 700px)`. En móvil los rankings muestran Top 5 con «Ver todos». */
export const CONSULTA_MOVIL = '(width < 700px)';
export const TOP_MOVIL = 5;

/** Mantiene `movil` sincronizado con la consulta de ancho; devuelve la función que deja de escuchar. */
export function escucharMovil(movil: { set(v: boolean): void }): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(CONSULTA_MOVIL);
  movil.set(mq.matches);
  const f = (e: MediaQueryListEvent) => movil.set(e.matches);
  mq.addEventListener('change', f);
  return () => mq.removeEventListener('change', f);
}

/** Resultado de envolver una etiqueta: líneas con palabras completas y si el texto cupo entero. */
export interface EtiquetaEnvuelta { lineas: string[]; completa: boolean }

/**
 * Envuelve una etiqueta SVG en `maxLineas` líneas de hasta `ancho` px, SOLO por palabras completas (nunca corta una
 * palabra). Si el texto completo cabe, no hay «…». Si no cabe, la última línea termina en «…» en un límite de palabra
 * y `completa` es false (el nombre completo debe ofrecerse en el tooltip, la leyenda o la miga). `medir` devuelve el
 * ancho en px de un texto (en el navegador, canvas `measureText`; en pruebas, una aproximación).
 */
export function envolverEtiqueta(texto: string, ancho: number, medir: (t: string) => number, maxLineas = 2): EtiquetaEnvuelta {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let i = 0;
  while (i < palabras.length && lineas.length < maxLineas) {
    let linea = palabras[i++];
    while (i < palabras.length && medir(`${linea} ${palabras[i]}`) <= ancho) linea += ` ${palabras[i++]}`;
    lineas.push(linea);
  }
  if (i >= palabras.length && lineas.every((l) => medir(l) <= ancho)) return { lineas, completa: true };
  // No cupo: recortar la última línea por palabras hasta que quepa con «…».
  let ultima = lineas[lineas.length - 1].split(' ');
  while (ultima.length > 1 && medir(`${ultima.join(' ')}…`) > ancho) ultima = ultima.slice(0, -1);
  lineas[lineas.length - 1] = `${ultima.join(' ').replace(/[,;:]$/, '')}…`;
  return { lineas, completa: false };
}

/** Medidor de texto con canvas (navegador); sin canvas, aproximación por promedio de ancho de carácter. */
export function medidorTexto(fuente: string, px: number): (t: string) => number {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (canvas) { canvas.font = `600 ${px}px ${fuente}`; return (t) => canvas.measureText(t).width; }
  return (t) => t.length * px * 0.56;
}
