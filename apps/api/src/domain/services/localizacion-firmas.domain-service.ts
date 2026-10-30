import { CajaTexto, RectRelativo } from '../ports/out/geometria-documento.port';
import { frase, plegar } from './normalizacion-acta';

/**
 * Dónde mirar para saber si hay firma: se ancla en los RÓTULOS impresos («FIRMA DE LA EMPRESA»,
 * «FIRMA DEL PRÁCTICANTE») y la zona se define RELATIVA a su tamaño, no en coordenadas fijas de
 * página. Así tolera escala, resolución, pequeños desplazamientos y escaneos.
 *
 * Si no se halla el rótulo con confianza, no hay zona: la firma queda `no_determinable`.
 */

const ROTULO_EMPRESA = new RegExp(frase('FIRMA DE LA EMPRESA'));
const ROTULO_PRACTICANTE = new RegExp(frase('FIRMA DEL PRACTICANTE'));

/** La zona de firma se extiende hacia ARRIBA del rótulo (la línea de firma va sobre él) esta cantidad de veces su alto. */
const ALTO_ZONA_EN_ROTULOS = 4.5;
/** Hueco que se deja justo encima del rótulo (lo ocupa la línea del formulario). */
const HUECO_SOBRE_ROTULO_EN_ROTULOS = 0.35;
/** Ancho de la zona respecto del ancho del rótulo (la línea de firma es más larga que su rótulo). */
const ANCHO_ZONA_EN_ROTULOS = 2.1;
/** Un rótulo plausible ocupa entre estos alturas de página; fuera de eso el ancla no es confiable. */
const ALTO_ROTULO_MIN = 0.004;
const ALTO_ROTULO_MAX = 0.06;
/** Las cajas de una línea difieren en `y` menos que esta fracción de su alto. */
const TOLERANCIA_LINEA = 0.6;
/** Solo el texto leído con al menos esta confianza se descuenta como «impreso»; el garabato que el OCR lee mal NO. */
const CONFIANZA_TEXTO_EXCLUIBLE = 70;

export interface ZonasFirma {
  empresa: RectRelativo | null;
  practicante: RectRelativo | null;
  /** Texto impreso fiable de la página: no es tinta de firma. */
  exclusiones: RectRelativo[];
  motivos: string[];
}

interface Linea { cajas: CajaTexto[]; y: number; alto: number }

function agruparEnLineas(cajas: readonly CajaTexto[]): Linea[] {
  const ordenadas = [...cajas].sort((a, b) => a.y - b.y || a.x - b.x);
  const lineas: Linea[] = [];
  for (const c of ordenadas) {
    const centro = c.y + c.alto / 2;
    const linea = lineas.find((l) => Math.abs(l.y + l.alto / 2 - centro) <= Math.max(l.alto, c.alto) * TOLERANCIA_LINEA);
    if (linea) { linea.cajas.push(c); linea.y = Math.min(linea.y, c.y); linea.alto = Math.max(linea.alto, c.alto); }
    else lineas.push({ cajas: [c], y: c.y, alto: c.alto });
  }
  for (const l of lineas) l.cajas.sort((a, b) => a.x - b.x);
  return lineas;
}

/** Rectángulo de un rótulo dentro de una línea: reparte cada caja por caracteres, por si una sola trae varios rótulos. */
function rectDeRotulo(linea: Linea, patron: RegExp): RectRelativo | null {
  let texto = '';
  const tramos: { caja: CajaTexto; desde: number; hasta: number }[] = [];
  for (const caja of linea.cajas) {
    const t = plegar(caja.texto);
    tramos.push({ caja, desde: texto.length, hasta: texto.length + t.length });
    texto += `${t} `;
  }
  const m = patron.exec(texto);
  if (!m) return null;
  const inicio = m.index;
  const fin = m.index + m[0].length;
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const { caja, desde, hasta } of tramos) {
    if (hasta <= inicio || desde >= fin || hasta === desde) continue;
    const a = Math.max(inicio, desde) - desde;
    const b = Math.min(fin, hasta) - desde;
    const largo = hasta - desde;
    x0 = Math.min(x0, caja.x + caja.ancho * (a / largo));
    x1 = Math.max(x1, caja.x + caja.ancho * (b / largo));
    y0 = Math.min(y0, caja.y);
    y1 = Math.max(y1, caja.y + caja.alto);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, ancho: x1 - x0, alto: y1 - y0 };
}

function zonaSobre(rotulo: RectRelativo, otro: RectRelativo | null): RectRelativo | null {
  if (rotulo.alto < ALTO_ROTULO_MIN || rotulo.alto > ALTO_ROTULO_MAX || rotulo.ancho <= 0) return null;
  const centro = rotulo.x + rotulo.ancho / 2;
  let x0 = centro - (rotulo.ancho * ANCHO_ZONA_EN_ROTULOS) / 2;
  let x1 = centro + (rotulo.ancho * ANCHO_ZONA_EN_ROTULOS) / 2;
  // Las dos zonas comparten renglón: cada una llega, a lo sumo, hasta la mitad del hueco entre rótulos.
  if (otro) {
    const hueco = otro.x > rotulo.x ? (rotulo.x + rotulo.ancho + otro.x) / 2 : (otro.x + otro.ancho + rotulo.x) / 2;
    if (otro.x > rotulo.x) x1 = Math.min(x1, hueco); else x0 = Math.max(x0, hueco);
  }
  const y1 = rotulo.y - rotulo.alto * HUECO_SOBRE_ROTULO_EN_ROTULOS;
  const y0 = rotulo.y - rotulo.alto * ALTO_ZONA_EN_ROTULOS;
  const zona = { x: Math.max(0, x0), y: Math.max(0, y0), ancho: Math.min(1, x1) - Math.max(0, x0), alto: y1 - Math.max(0, y0) };
  return zona.ancho > 0 && zona.alto > 0 ? zona : null;
}

export function localizarZonasFirma(cajas: readonly CajaTexto[]): ZonasFirma {
  const motivos: string[] = [];
  const lineas = agruparEnLineas(cajas);
  const buscar = (patron: RegExp): RectRelativo | null => {
    // Si el rótulo aparece más de una vez, vale el de más abajo (el de la zona de firmas).
    const hallados = lineas.map((l) => rectDeRotulo(l, patron)).filter((r): r is RectRelativo => r !== null);
    return hallados.length > 0 ? hallados.reduce((a, b) => (b.y > a.y ? b : a)) : null;
  };
  const empresa = buscar(ROTULO_EMPRESA);
  const practicante = buscar(ROTULO_PRACTICANTE);
  if (!empresa) motivos.push('empresa_rotulo_no_localizado');
  if (!practicante) motivos.push('practicante_rotulo_no_localizado');
  const zonaEmpresa = empresa ? zonaSobre(empresa, practicante) : null;
  const zonaPracticante = practicante ? zonaSobre(practicante, empresa) : null;
  if (empresa && !zonaEmpresa) motivos.push('empresa_ancla_no_confiable');
  if (practicante && !zonaPracticante) motivos.push('practicante_ancla_no_confiable');

  // Texto impreso que NO debe contar como tinta: solo el que se leyó con confianza y es una palabra.
  const exclusiones = cajas
    .filter((c) => c.confianza >= CONFIANZA_TEXTO_EXCLUIBLE && /[A-Za-zÁ-ÿ0-9]{3,}/.test(c.texto))
    .map(({ x, y, ancho, alto }) => ({ x, y, ancho, alto }));
  return { empresa: zonaEmpresa, practicante: zonaPracticante, exclusiones, motivos };
}

/** ¿El texto de una página contiene los rótulos de firma? (para elegir qué página medir sin pedir cajas de todas) */
export function paginaTieneRotulosFirma(texto: string): { empresa: boolean; practicante: boolean } {
  const t = plegar(texto);
  return { empresa: ROTULO_EMPRESA.test(t), practicante: ROTULO_PRACTICANTE.test(t) };
}
