import { FirmasActa, Presencia } from '../entities/acta-iniciacion';
import { frase, plegarColapsado } from './normalizacion-acta';

/**
 * Presencia PROBABLE de las firmas del acta (empresa y practicante).
 *
 * Alcance deliberadamente corto: este servicio NO dice que una firma sea auténtica, de quién es
 * ni que sea válida; no usa biometría ni reconocimiento del firmante. Solo responde si en la zona
 * de cada firma hay trazo que no sea la línea del formulario.
 *
 * El dominio no mide píxeles: un adaptador (bloque posterior) rasteriza la zona situada sobre
 * cada rótulo («FIRMA DE LA EMPRESA», «FIRMA DEL PRÁCTICANTE») y entrega la `MedicionZonaFirma`.
 * Aquí solo se interpreta, y falla cerrado: ante la duda, `no_determinable`.
 */

export interface MedicionZonaFirma {
  /** Se pudo rasterizar y la zona es legible (no está recortada ni borrosa). */
  legible: boolean;
  /** Proporción de píxeles de tinta en la zona, SIN contar la línea de firma del formulario. 0–1. */
  densidadTinta: number;
  /** Alto del trazo respecto del alto de la zona. Una línea recta mide cerca de 0. 0–1. */
  alturaRelativaTrazo: number;
}

export interface MedicionesFirmas {
  empresa: MedicionZonaFirma | null;
  practicante: MedicionZonaFirma | null;
}

/**
 * Umbrales PROVISIONALES: se calibran con actas firmadas reales (bloque de lectura). Quedan aquí,
 * a la vista, y no en configuración: mover la sensibilidad es una decisión de revisión, no de operación.
 */
export const UMBRALES_FIRMA = {
  /** Por debajo no hay trazo: la zona está en blanco. */
  densidadSinTinta: 0.002,
  /** Por encima, y con altura de trazo, hay una marca que parece firma. */
  densidadConTinta: 0.01,
  alturaMinimaTrazo: 0.15,
} as const;

const ROTULO_EMPRESA = new RegExp(frase('FIRMA DE LA EMPRESA'));
const ROTULO_PRACTICANTE = new RegExp(frase('FIRMA DEL PRACTICANTE'));

function interpretar(
  rotuloVisible: boolean, medicion: MedicionZonaFirma | null, parte: string, motivos: string[],
): Presencia {
  if (!rotuloVisible) { motivos.push(`${parte}_rotulo_no_localizado`); return 'no_determinable'; }
  if (medicion === null) { motivos.push(`${parte}_zona_sin_medir`); return 'no_determinable'; }
  if (!medicion.legible) { motivos.push(`${parte}_zona_ilegible`); return 'no_determinable'; }
  const { densidadTinta: d, alturaRelativaTrazo: h } = medicion;
  if (d < UMBRALES_FIRMA.densidadSinTinta) { motivos.push(`${parte}_zona_en_blanco`); return 'no'; }
  if (d >= UMBRALES_FIRMA.densidadConTinta && h >= UMBRALES_FIRMA.alturaMinimaTrazo) {
    motivos.push(`${parte}_trazo_probable`);
    return 'si';
  }
  motivos.push(`${parte}_marca_ambigua`);
  return 'no_determinable';
}

/** `texto`: texto del documento (para comprobar que los rótulos de firma están en lo que se leyó). */
export function evaluarFirmasActa(texto: string, mediciones: MedicionesFirmas | null): FirmasActa {
  const plegado = plegarColapsado(texto);
  const motivos: string[] = [];
  return {
    firmaEmpresaPresente: interpretar(ROTULO_EMPRESA.test(plegado), mediciones?.empresa ?? null, 'empresa', motivos),
    firmaPracticantePresente: interpretar(ROTULO_PRACTICANTE.test(plegado), mediciones?.practicante ?? null, 'practicante', motivos),
    motivos,
  };
}
