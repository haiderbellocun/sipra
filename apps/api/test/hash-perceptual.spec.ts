import {
  HashPerceptualDomainService, ImagenGris, MINIMO_BITS_INFORMATIVOS,
} from '../src/domain/services/hash-perceptual.domain-service';

const perceptual = new HashPerceptualDomainService();

/**
 * Genera una imagen a partir de un patrón en coordenadas NORMALIZADAS.
 *
 * Es la única forma de que dos resoluciones distintas representen la misma
 * imagen: con coordenadas en píxeles, cambiar el tamaño cambia el contenido y
 * la prueba de reescalado no probaría nada.
 */
function imagen(
  ancho: number,
  alto: number,
  patron: (u: number, v: number) => number,
): ImagenGris {
  const pixeles = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const valor = patron(x / ancho, y / alto);
      pixeles[y * ancho + x] = Math.max(0, Math.min(255, Math.round(valor)));
    }
  }
  return { ancho, alto, pixeles };
}

/** Se parece a una planilla: cabecera oscura, cuerpo claro y un bloque firmado. */
const planilla = (u: number, v: number): number => {
  if (v < 0.14) return 55;                                  // cabecera
  if (v > 0.78 && u > 0.55) return 70;                      // recuadro de firma
  if (u < 0.32 && v > 0.2 && v < 0.72) return 120;          // columna de fechas
  return 238;
};

/** Otro documento distinto, con la mancha en otro sitio. */
const carta = (u: number, v: number): number => {
  if (u < 0.1) return 60;
  if (v > 0.3 && v < 0.45) return 100;
  if (u > 0.7 && v > 0.55) return 140;
  return 230;
};

describe('Hash perceptual (dHash de 128 bits)', () => {
  it('produce 32 caracteres hexadecimales, es decir 128 bits', () => {
    expect(perceptual.calcular(imagen(200, 150, planilla))).toMatch(/^[0-9a-f]{32}$/);
  });

  it('es estable: la misma imagen da el mismo hash', () => {
    expect(perceptual.calcular(imagen(200, 150, planilla)))
      .toBe(perceptual.calcular(imagen(200, 150, planilla)));
  });

  it('sobrevive al reescalado, que es como reaparece una foto reenviada', () => {
    const grande = perceptual.calcular(imagen(600, 450, planilla));
    const pequena = perceptual.calcular(imagen(200, 150, planilla));
    expect(perceptual.esMismaImagen(grande, pequena)).toBe(true);
  });

  it('sobrevive a un cambio de brillo', () => {
    const original = perceptual.calcular(imagen(300, 220, planilla));
    const aclarada = perceptual.calcular(imagen(300, 220, (u, v) => planilla(u, v) + 25));
    expect(perceptual.esMismaImagen(original, aclarada)).toBe(true);
  });

  it('sobrevive a un recorte leve del borde, como al reencuadrar', () => {
    const original = perceptual.calcular(imagen(400, 300, planilla));
    const recortada = perceptual.calcular(
      imagen(380, 285, (u, v) => planilla(0.025 + u * 0.95, 0.025 + v * 0.95)),
    );
    expect(perceptual.esMismaImagen(original, recortada)).toBe(true);
  });

  it('distingue dos documentos realmente distintos', () => {
    const a = perceptual.calcular(imagen(300, 220, planilla));
    const b = perceptual.calcular(imagen(300, 220, carta));
    expect(perceptual.esMismaImagen(a, b)).toBe(false);
  });

  it('la distancia entre un hash y sí mismo es cero', () => {
    const hash = perceptual.calcular(imagen(200, 150, planilla));
    expect(perceptual.distancia(hash, hash)).toBe(0);
  });

  it('hashes de distinta longitud no se comparan como parecidos', () => {
    expect(perceptual.esMismaImagen('abc', 'a'.repeat(32))).toBe(false);
  });
});

describe('Guarda de entropía', () => {
  it('una hoja en blanco no produce un hash informativo', () => {
    const blanco = perceptual.calcular(imagen(200, 150, () => 250));
    expect(perceptual.bitsInformativos(blanco)).toBeLessThan(MINIMO_BITS_INFORMATIVOS);
    expect(perceptual.esInformativo(blanco)).toBe(false);
  });

  it('dos hojas en blanco NO se señalan como el mismo documento', () => {
    // Sin esta guarda, cualquier par de escaneos vacíos se acusaría de
    // reutilización: su distancia es cero porque no hay nada que comparar.
    const a = perceptual.calcular(imagen(200, 150, () => 250));
    const b = perceptual.calcular(imagen(320, 240, () => 245));
    expect(perceptual.distancia(a, b)).toBe(0);
    expect(perceptual.esMismaImagen(a, b)).toBe(false);
  });

  it('un documento con estructura sí produce un hash informativo', () => {
    expect(perceptual.esInformativo(perceptual.calcular(imagen(300, 220, planilla)))).toBe(true);
  });
});
