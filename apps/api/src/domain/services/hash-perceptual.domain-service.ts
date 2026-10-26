/**
 * Hash perceptual (capa 0).
 *
 * El hash criptográfico detecta el MISMO archivo. El perceptual detecta la
 * MISMA IMAGEN con ediciones mínimas: recomprimida, recortada al borde,
 * reescalada, con un número retocado. Es el control que descubre la planilla
 * de un estudiante reutilizada por otro tras cambiarle el nombre.
 *
 * Se implementa dHash (gradiente horizontal) porque es estable frente a
 * cambios de brillo y escala, que es exactamente lo que ocurre cuando alguien
 * vuelve a fotografiar o reexporta un documento.
 */

/** Longitud del hash: 64 bits del gradiente horizontal más 64 del vertical. */
export const BITS_HASH_PERCEPTUAL = 128;

/**
 * Distancia de Hamming máxima, sobre 128 bits, para considerar dos imágenes
 * la misma. Calibrado para tolerar recompresión y reescalado sin igualar
 * documentos distintos.
 */
export const UMBRAL_SIMILITUD = 16;

/**
 * Mínimo de bits en 1 para que un hash sirva como huella.
 *
 * Una hoja casi en blanco, o un escaneo totalmente uniforme, produce un hash
 * de casi puros ceros que se parecería a cualquier otro igual de vacío. Ese
 * hash no identifica nada: descartarlo evita señalar como reutilizadas dos
 * páginas que solo comparten estar vacías.
 */
export const MINIMO_BITS_INFORMATIVOS = 12;

export interface ImagenGris {
  ancho: number;
  alto: number;
  /** Luminancia por píxel, 0–255, en orden de filas. */
  pixeles: Uint8Array;
}

export class HashPerceptualDomainService {
  /**
   * dHash de 128 bits: 64 del gradiente horizontal y 64 del vertical.
   *
   * Solo el horizontal sería frágil con documentos de líneas horizontales
   * —una planilla, un formulario rayado—, donde casi todos los vecinos
   * laterales son iguales y el hash degenera en ceros. El eje vertical aporta
   * la variación que ese contenido sí tiene.
   */
  calcular(imagen: ImagenGris): string {
    const horizontal = this.reducir(imagen, 9, 8);
    let bits = '';
    for (let f = 0; f < 8; f += 1) {
      for (let c = 0; c < 8; c += 1) {
        bits += horizontal.pixeles[f * 9 + c] > horizontal.pixeles[f * 9 + c + 1] ? '1' : '0';
      }
    }

    const vertical = this.reducir(imagen, 8, 9);
    for (let f = 0; f < 8; f += 1) {
      for (let c = 0; c < 8; c += 1) {
        bits += vertical.pixeles[f * 8 + c] > vertical.pixeles[(f + 1) * 8 + c] ? '1' : '0';
      }
    }
    return this.aHex(bits);
  }

  /** Cuántos bits en 1 tiene el hash: mide cuánta información carga. */
  bitsInformativos(hash: string): number {
    let total = 0;
    for (const caracter of hash) {
      let x = parseInt(caracter, 16);
      while (x) {
        total += x & 1;
        x >>= 1;
      }
    }
    return total;
  }

  /**
   * ¿Sirve este hash para identificar? Un hash casi vacío corresponde a una
   * imagen sin estructura y no debe usarse para acusar de reutilización.
   */
  esInformativo(hash: string): boolean {
    const bits = this.bitsInformativos(hash);
    return (
      bits >= MINIMO_BITS_INFORMATIVOS &&
      bits <= BITS_HASH_PERCEPTUAL - MINIMO_BITS_INFORMATIVOS
    );
  }

  /** Número de bits distintos entre dos hashes. */
  distancia(a: string, b: string): number {
    if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
    let total = 0;
    for (let i = 0; i < a.length; i += 1) {
      let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (x) {
        total += x & 1;
        x >>= 1;
      }
    }
    return total;
  }

  /**
   * Dos imágenes son la misma cuando ambos hashes cargan información y su
   * distancia está por debajo del umbral. Sin la primera condición, dos hojas
   * en blanco se señalarían mutuamente.
   */
  esMismaImagen(a: string, b: string, umbral = UMBRAL_SIMILITUD): boolean {
    if (!this.esInformativo(a) || !this.esInformativo(b)) return false;
    return this.distancia(a, b) <= umbral;
  }

  /** Remuestreo por promedio de área: estable frente a ruido de compresión. */
  private reducir(imagen: ImagenGris, ancho: number, alto: number): ImagenGris {
    const salida = new Uint8Array(ancho * alto);
    const escalaX = imagen.ancho / ancho;
    const escalaY = imagen.alto / alto;

    for (let f = 0; f < alto; f += 1) {
      const y0 = Math.floor(f * escalaY);
      const y1 = Math.max(y0 + 1, Math.floor((f + 1) * escalaY));
      for (let c = 0; c < ancho; c += 1) {
        const x0 = Math.floor(c * escalaX);
        const x1 = Math.max(x0 + 1, Math.floor((c + 1) * escalaX));

        let suma = 0;
        let n = 0;
        for (let y = y0; y < Math.min(y1, imagen.alto); y += 1) {
          for (let x = x0; x < Math.min(x1, imagen.ancho); x += 1) {
            suma += imagen.pixeles[y * imagen.ancho + x];
            n += 1;
          }
        }
        salida[f * ancho + c] = n > 0 ? Math.round(suma / n) : 0;
      }
    }
    return { ancho, alto, pixeles: salida };
  }

  private aHex(bits: string): string {
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  }
}
