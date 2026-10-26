import { Injectable } from '@angular/core';
import { MetricasCaptura } from '../models/modelos';

export interface EvaluacionCaptura {
  metricas: MetricasCaptura;
  aceptable: boolean;
  motivos: string[];
}

/** Umbrales de la captura guiada (M3). */
const UMBRAL_NITIDEZ = 100;
const UMBRAL_SATURACION = 12;
const UMBRAL_LADO_MINIMO = 1000;
const UMBRAL_LUMINANCIA_BAJA = 45;
const UMBRAL_LUMINANCIA_ALTA = 225;

/**
 * Captura guiada: valida la imagen EN EL DISPOSITIVO antes de enviarla.
 *
 * Una imagen fuera de foco se rechaza aquí, sin consumir ancho de banda ni
 * tiempo de revisión. El servidor vuelve a evaluar las métricas: esta capa es
 * una comodidad para el estudiante, no un control de seguridad.
 */
@Injectable({ providedIn: 'root' })
export class CapturaGuiadaService {
  async evaluar(archivo: File): Promise<EvaluacionCaptura | null> {
    if (!archivo.type.startsWith('image/')) return null;

    const mapa = await this.aImageBitmap(archivo);
    if (!mapa) return null;

    const metricas = this.medir(mapa);
    mapa.close?.();

    const motivos: string[] = [];
    if (metricas.varianzaLaplaciano < UMBRAL_NITIDEZ) {
      motivos.push(
        'La foto está fuera de foco. Apoye el documento en una superficie plana y espere a ' +
          'que la cámara enfoque antes de disparar.',
      );
    }
    if (metricas.porcentajeSaturados > UMBRAL_SATURACION) {
      motivos.push(
        'Hay reflejos o exceso de luz sobre el papel. Evite el flash directo y busque luz pareja.',
      );
    }
    if (metricas.anchoPx < UMBRAL_LADO_MINIMO || metricas.altoPx < UMBRAL_LADO_MINIMO) {
      motivos.push(
        `La imagen es de ${metricas.anchoPx}×${metricas.altoPx} píxeles. Acérquese al documento ` +
          'para que ocupe todo el encuadre.',
      );
    }
    if (metricas.luminanciaMedia < UMBRAL_LUMINANCIA_BAJA) {
      motivos.push('La foto está muy oscura. Busque un lugar mejor iluminado.');
    } else if (metricas.luminanciaMedia > UMBRAL_LUMINANCIA_ALTA) {
      motivos.push('La foto está sobreexpuesta y el texto se pierde.');
    }

    return { metricas, aceptable: motivos.length === 0, motivos };
  }

  private async aImageBitmap(archivo: File): Promise<ImageBitmap | null> {
    try {
      return await createImageBitmap(archivo);
    } catch {
      return null;
    }
  }

  /**
   * Calcula la varianza del Laplaciano —medida estándar de nitidez—, la
   * luminancia media, el porcentaje de píxeles saturados y la resolución.
   * El análisis se hace sobre una versión reducida para no bloquear la interfaz.
   */
  private medir(mapa: ImageBitmap): MetricasCaptura {
    const ladoAnalisis = 512;
    const escala = Math.min(1, ladoAnalisis / Math.max(mapa.width, mapa.height));
    const ancho = Math.max(3, Math.round(mapa.width * escala));
    const alto = Math.max(3, Math.round(mapa.height * escala));

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return {
        varianzaLaplaciano: 0, luminanciaMedia: 0, porcentajeSaturados: 0,
        anchoPx: mapa.width, altoPx: mapa.height,
      };
    }
    ctx.drawImage(mapa, 0, 0, ancho, alto);
    const { data } = ctx.getImageData(0, 0, ancho, alto);

    // Escala de grises por luminancia perceptual (Rec. 601).
    const gris = new Float64Array(ancho * alto);
    let sumaLuminancia = 0;
    let saturados = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gris[p] = y;
      sumaLuminancia += y;
      if (y >= 250 || y <= 5) saturados += 1;
    }

    // Núcleo Laplaciano 3×3: [0 1 0; 1 -4 1; 0 1 0].
    let suma = 0;
    let sumaCuadrados = 0;
    let n = 0;
    for (let f = 1; f < alto - 1; f += 1) {
      for (let c = 1; c < ancho - 1; c += 1) {
        const i = f * ancho + c;
        const lap =
          gris[i - ancho] + gris[i + ancho] + gris[i - 1] + gris[i + 1] - 4 * gris[i];
        suma += lap;
        sumaCuadrados += lap * lap;
        n += 1;
      }
    }
    const media = n > 0 ? suma / n : 0;
    const varianza = n > 0 ? sumaCuadrados / n - media * media : 0;

    return {
      varianzaLaplaciano: Math.round(varianza * 100) / 100,
      luminanciaMedia: Math.round((sumaLuminancia / (ancho * alto)) * 100) / 100,
      porcentajeSaturados: Math.round((saturados / (ancho * alto)) * 10000) / 100,
      anchoPx: mapa.width,
      altoPx: mapa.height,
    };
  }
}
