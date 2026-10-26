import {
  PreprocesamientoDomainService,
} from '../src/domain/services/preprocesamiento.domain-service';
import { ImagenGris } from '../src/domain/services/hash-perceptual.domain-service';

const pre = new PreprocesamientoDomainService();

/** Documento sintético: líneas de texto horizontales sobre fondo claro. */
function documento(
  ancho: number,
  alto: number,
  opciones: { inclinacion?: number; margen?: number; sombra?: boolean } = {},
): ImagenGris {
  const { inclinacion = 0, margen = 0, sombra = false } = opciones;
  const pixeles = new Uint8Array(ancho * alto).fill(245);
  const tangente = Math.tan((inclinacion * Math.PI) / 180);

  // Doce renglones de "texto": bandas oscuras separadas por espacio en blanco.
  const util = { x0: margen, y0: margen, x1: ancho - margen, y1: alto - margen };
  const alturaUtil = util.y1 - util.y0;
  for (let renglon = 0; renglon < 12; renglon += 1) {
    const yBase = util.y0 + Math.round(((renglon + 0.5) * alturaUtil) / 12);
    for (let x = util.x0; x < util.x1; x += 1) {
      // Los renglones no llegan al borde derecho: simula final de párrafo.
      if (renglon % 4 === 3 && x > util.x0 + (util.x1 - util.x0) * 0.6) continue;
      const y = Math.round(yBase + (x - ancho / 2) * tangente);
      for (let grosor = 0; grosor < 4; grosor += 1) {
        const yy = y + grosor;
        if (yy >= 0 && yy < alto) pixeles[yy * ancho + x] = 35;
      }
    }
  }

  if (sombra) {
    // Gradiente de iluminación: una esquina queda notablemente más oscura.
    for (let y = 0; y < alto; y += 1) {
      for (let x = 0; x < ancho; x += 1) {
        const caida = 1 - 0.55 * ((x / ancho) * 0.6 + (y / alto) * 0.4);
        const i = y * ancho + x;
        pixeles[i] = Math.max(0, Math.min(255, Math.round(pixeles[i] * caida)));
      }
    }
  }
  return { ancho, alto, pixeles };
}

const proporcionOscura = (imagen: ImagenGris, umbral = 128): number =>
  imagen.pixeles.reduce((n, v) => n + (v < umbral ? 1 : 0), 0) / imagen.pixeles.length;

describe('Enderezamiento', () => {
  it.each([-6, -3, 3, 6])('detecta una inclinación de %i grados', (grados) => {
    const detectado = pre.detectarInclinacion(documento(320, 240, { inclinacion: grados }));
    expect(Math.abs(detectado - grados)).toBeLessThanOrEqual(1.5);
  });

  it('no inventa inclinación en un documento derecho', () => {
    expect(Math.abs(pre.detectarInclinacion(documento(320, 240)))).toBeLessThanOrEqual(1);
  });

  it('rotar conserva las dimensiones', () => {
    const original = documento(200, 160, { inclinacion: 5 });
    const rotada = pre.rotar(original, -5);
    expect(rotada.ancho).toBe(original.ancho);
    expect(rotada.alto).toBe(original.alto);
  });

  it('enderezar aumenta la nitidez del perfil de renglones', () => {
    // Es la propiedad que el algoritmo maximiza: si no sube, no enderezó.
    const inclinada = documento(320, 240, { inclinacion: 6 });
    const derecha = pre.rotar(inclinada, -pre.detectarInclinacion(inclinada));
    const perfil = (img: ImagenGris): number => {
      const filas = new Float64Array(img.alto);
      for (let y = 0; y < img.alto; y += 1) {
        let s = 0;
        for (let x = 0; x < img.ancho; x += 1) s += 255 - img.pixeles[y * img.ancho + x];
        filas[y] = s;
      }
      const media = filas.reduce((a, b) => a + b, 0) / img.alto;
      return filas.reduce((a, v) => a + (v - media) ** 2, 0) / img.alto;
    };
    expect(perfil(derecha)).toBeGreaterThan(perfil(inclinada));
  });
});

describe('Recorte de márgenes', () => {
  it('detecta el margen sin contenido', () => {
    const region = pre.detectarMargenes(documento(300, 300, { margen: 45 }));
    expect(region).not.toBeNull();
    expect(region!.ancho).toBeLessThan(300);
    expect(region!.alto).toBeLessThan(300);
  });

  it('es idempotente: recortar dos veces no sigue recortando', () => {
    // Propiedad que importa de verdad: si el segundo pase volviera a recortar,
    // el preprocesamiento iría comiéndose el documento en cada pasada.
    const original = documento(300, 300, { margen: 45 });
    const region = pre.detectarMargenes(original)!;
    const recortada = pre.recortar(original, region);
    expect(pre.detectarMargenes(recortada)).toBeNull();
  });

  it('no recorta una imagen sin tinta', () => {
    const blanco: ImagenGris = {
      ancho: 100, alto: 100, pixeles: new Uint8Array(10000).fill(250),
    };
    expect(pre.detectarMargenes(blanco)).toBeNull();
  });

  it('recortar devuelve exactamente la región pedida', () => {
    const recortada = pre.recortar(documento(200, 200), { x: 10, y: 20, ancho: 80, alto: 60 });
    expect(recortada.ancho).toBe(80);
    expect(recortada.alto).toBe(60);
    expect(recortada.pixeles).toHaveLength(80 * 60);
  });
});

describe('Umbral de Otsu', () => {
  it('separa las dos poblaciones de una imagen bimodal', () => {
    // El umbral marca el último valor de la clase oscura: para tinta en 35 y
    // fondo en 245, el corte correcto es exactamente 35.
    const umbral = pre.umbralDeOtsu(documento(200, 160));
    expect(umbral).toBeGreaterThanOrEqual(35);
    expect(umbral).toBeLessThan(245);
  });

  it('encuentra la tinta cuando su valor coincide con el umbral', () => {
    // Caso límite que rompía el recorte: con la comparación `<` la tinta
    // quedaba fuera de su propia clase y la imagen parecía vacía.
    const region = pre.detectarMargenes(documento(300, 300, { margen: 45 }));
    expect(region).not.toBeNull();
  });
});

describe('Ecualización adaptativa', () => {
  it('conserva las dimensiones', () => {
    const original = documento(200, 160, { sombra: true });
    const { imagen } = pre.ecualizacionAdaptativa(original);
    expect(imagen.ancho).toBe(200);
    expect(imagen.alto).toBe(160);
  });

  it('reduce la diferencia de brillo entre la zona clara y la oscura', () => {
    // Es el problema real: la foto con sombra en una esquina.
    const conSombra = documento(240, 200, { sombra: true });
    const brilloDe = (img: ImagenGris, desdeX: number, hastaX: number): number => {
      let suma = 0;
      let n = 0;
      for (let y = 0; y < img.alto; y += 1) {
        for (let x = desdeX; x < hastaX; x += 1) {
          suma += img.pixeles[y * img.ancho + x];
          n += 1;
        }
      }
      return suma / n;
    };
    const desbalance = (img: ImagenGris): number =>
      Math.abs(brilloDe(img, 0, 60) - brilloDe(img, img.ancho - 60, img.ancho));

    const { imagen } = pre.ecualizacionAdaptativa(conSombra);
    expect(desbalance(imagen)).toBeLessThan(desbalance(conSombra));
  });

  it('registra los parámetros con los que se aplicó', () => {
    const { parametros } = pre.ecualizacionAdaptativa(documento(120, 100));
    expect(parametros.regionesPorLado).toBe(8);
    expect(parametros.limiteAmplificacion).toBe(3);
  });
});

describe('Binarización', () => {
  it('produce únicamente valores 0 y 255', () => {
    const { imagen } = pre.binarizar(documento(200, 160));
    expect([...new Set(imagen.pixeles)].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it('el umbral local salva la foto con iluminación despareja', () => {
    // Con umbral global, la zona sombreada se vuelve toda negra. Se comprueba
    // que la proporción de tinta se mantenga razonable, no que se dispare.
    const { imagen } = pre.binarizar(documento(240, 200, { sombra: true }));
    const tinta = proporcionOscura(imagen);
    expect(tinta).toBeGreaterThan(0.05);
    expect(tinta).toBeLessThan(0.55);
  });
});

describe('Secuencia completa', () => {
  it('aplica los pasos y deja constancia de cada uno', () => {
    const resultado = pre.procesar(documento(320, 260, { inclinacion: 5, margen: 40, sombra: true }));
    const operaciones = resultado.pasos.map((p) => p.operacion);

    expect(operaciones).toContain('enderezamiento');
    expect(operaciones).toContain('recorte_de_bordes');
    expect(operaciones).toContain('ecualizacion_adaptativa');
    expect(operaciones).toContain('binarizacion');
  });

  it('el orden importa: primero endereza, al final binariza', () => {
    const { pasos } = pre.procesar(documento(320, 260, { inclinacion: 5, margen: 40 }));
    const operaciones = pasos.map((p) => p.operacion);
    expect(operaciones.indexOf('enderezamiento')).toBeLessThan(
      operaciones.indexOf('ecualizacion_adaptativa'),
    );
    expect(operaciones[operaciones.length - 1]).toBe('binarizacion');
  });

  it('cada paso registra parámetros reproducibles', () => {
    for (const paso of pre.procesar(documento(320, 260, { inclinacion: 4 })).pasos) {
      expect(Object.keys(paso.parametros).length).toBeGreaterThan(0);
      expect(paso.descripcion.length).toBeGreaterThan(10);
    }
  });

  it('no registra pasos que no aplicó', () => {
    // Un documento derecho y ya encuadrado no debe declarar enderezamiento ni
    // recorte: la bitácora tiene que reflejar lo que se hizo, ni más ni menos.
    const original = documento(300, 300, { margen: 45 });
    const encuadrado = pre.recortar(original, pre.detectarMargenes(original)!);

    const operaciones = pre.procesar(encuadrado).pasos.map((p) => p.operacion);
    expect(operaciones).not.toContain('enderezamiento');
    expect(operaciones).not.toContain('recorte_de_bordes');
    expect(operaciones).toEqual(['ecualizacion_adaptativa', 'binarizacion']);
  });

  it('afirma explícitamente que ninguna operación crea información', () => {
    expect(pre.procesar(documento(200, 160)).reversibleEnPrincipio).toBe(true);
  });
});
