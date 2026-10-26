import { ImagenGris } from './hash-perceptual.domain-service';

/**
 * Preprocesamiento determinístico de documentos ilegibles (sección 4.5).
 *
 * PRINCIPIO QUE GOBIERNA ESTE ARCHIVO
 * ───────────────────────────────────
 * Aquí se REORGANIZAN píxeles existentes. No se genera ninguno.
 *
 * Los modelos de super-resolución no recuperan información: la inventan. Un
 * dígito borroso se convierte en otro dígito con plena confianza visual. Sobre
 * un documento con valor probatorio eso es fabricación de evidencia, y destruye
 * el valor del original.
 *
 * Cada operación de este servicio es auditable —queda registrado qué se aplicó
 * y con qué parámetros— y el original se conserva intacto: lo que se preprocesa
 * es una copia destinada a la extracción, nunca el archivo almacenado.
 */

export type OperacionPreproceso =
  | 'enderezamiento'
  | 'recorte_de_bordes'
  | 'ecualizacion_adaptativa'
  | 'binarizacion';

export interface PasoAplicado {
  operacion: OperacionPreproceso;
  /** Parámetros exactos con los que se aplicó: hace la operación reproducible. */
  parametros: Record<string, number>;
  descripcion: string;
}

export interface ResultadoPreproceso {
  imagen: ImagenGris;
  pasos: PasoAplicado[];
  /** Ninguna operación crea información: siempre true. Se afirma explícitamente. */
  reversibleEnPrincipio: true;
}

/** Ángulo máximo que se corrige. Más allá, el problema no es la inclinación. */
const INCLINACION_MAXIMA_GRADOS = 12;

/** Proporción de área que debe ganarse para que valga la pena recortar. */
const GANANCIA_MINIMA_RECORTE = 0.05;
const PASO_BUSQUEDA_GRADOS = 0.5;

export class PreprocesamientoDomainService {
  /**
   * Ejecuta la secuencia completa en el orden que importa: primero se endereza
   * —porque medir contraste sobre texto inclinado da resultados peores—, luego
   * se recortan los bordes muertos, después se ecualiza y por último se
   * binariza.
   */
  procesar(imagen: ImagenGris): ResultadoPreproceso {
    const pasos: PasoAplicado[] = [];

    const angulo = this.detectarInclinacion(imagen);
    let trabajo = imagen;
    if (Math.abs(angulo) >= PASO_BUSQUEDA_GRADOS) {
      trabajo = this.rotar(trabajo, -angulo);
      pasos.push({
        operacion: 'enderezamiento',
        parametros: { grados: Math.round(angulo * 100) / 100 },
        descripcion: `Se enderezó la imagen ${Math.abs(angulo).toFixed(2)}° por proyección de filas`,
      });
    }

    const recorte = this.detectarMargenes(trabajo);
    if (recorte) {
      trabajo = this.recortar(trabajo, recorte);
      pasos.push({
        operacion: 'recorte_de_bordes',
        parametros: recorte,
        descripcion: 'Se recortó el margen sin contenido alrededor del documento',
      });
    }

    const ecualizada = this.ecualizacionAdaptativa(trabajo);
    trabajo = ecualizada.imagen;
    pasos.push({
      operacion: 'ecualizacion_adaptativa',
      parametros: ecualizada.parametros,
      descripcion: 'Se ecualizó el contraste por regiones, con límite de amplificación',
    });

    const binaria = this.binarizar(trabajo);
    pasos.push({
      operacion: 'binarizacion',
      parametros: binaria.parametros,
      descripcion: 'Se binarizó con umbral local, que tolera iluminación despareja',
    });

    return { imagen: binaria.imagen, pasos, reversibleEnPrincipio: true };
  }

  // ── Enderezamiento ───────────────────────────────────────────────────────

  /**
   * Detecta la inclinación buscando el ángulo que MAXIMIZA la varianza del
   * perfil de proyección horizontal.
   *
   * En un documento derecho, las líneas de texto y los espacios entre ellas
   * producen un perfil con picos y valles marcados. Al inclinarse, esos picos
   * se difuminan. El ángulo de máxima varianza es el que endereza el texto.
   */
  detectarInclinacion(imagen: ImagenGris): number {
    let mejorAngulo = 0;
    let mejorVarianza = -1;

    for (
      let angulo = -INCLINACION_MAXIMA_GRADOS;
      angulo <= INCLINACION_MAXIMA_GRADOS;
      angulo += PASO_BUSQUEDA_GRADOS
    ) {
      const varianza = this.varianzaDeProyeccion(imagen, angulo);
      if (varianza > mejorVarianza) {
        mejorVarianza = varianza;
        mejorAngulo = angulo;
      }
    }
    return mejorAngulo;
  }

  /** Proyecta la tinta sobre el eje vertical con la imagen inclinada `grados`. */
  private varianzaDeProyeccion(imagen: ImagenGris, grados: number): number {
    const radianes = (grados * Math.PI) / 180;
    const tangente = Math.tan(radianes);
    const { ancho, alto, pixeles } = imagen;
    const perfil = new Float64Array(alto);

    // Se muestrea: recorrer cada píxel por cada ángulo sería innecesariamente
    // caro y el perfil no cambia con un muestreo de uno de cada tres.
    const paso = 3;
    for (let y = 0; y < alto; y += 1) {
      let suma = 0;
      for (let x = 0; x < ancho; x += paso) {
        const yInclinado = Math.round(y + (x - ancho / 2) * tangente);
        if (yInclinado < 0 || yInclinado >= alto) continue;
        // La tinta es lo oscuro: se invierte para que el perfil mida contenido.
        suma += 255 - pixeles[yInclinado * ancho + x];
      }
      perfil[y] = suma;
    }

    let media = 0;
    for (const v of perfil) media += v;
    media /= alto;

    let varianza = 0;
    for (const v of perfil) varianza += (v - media) ** 2;
    return varianza / alto;
  }

  /** Rotación con interpolación bilineal, fondo blanco donde no hay origen. */
  rotar(imagen: ImagenGris, grados: number): ImagenGris {
    const radianes = (grados * Math.PI) / 180;
    const cos = Math.cos(radianes);
    const sen = Math.sin(radianes);
    const { ancho, alto, pixeles } = imagen;
    const salida = new Uint8Array(ancho * alto).fill(255);
    const cx = ancho / 2;
    const cy = alto / 2;

    for (let y = 0; y < alto; y += 1) {
      for (let x = 0; x < ancho; x += 1) {
        // Se recorre el destino y se busca el origen: evita huecos.
        const dx = x - cx;
        const dy = y - cy;
        const xo = cos * dx + sen * dy + cx;
        const yo = -sen * dx + cos * dy + cy;
        if (xo < 0 || yo < 0 || xo >= ancho - 1 || yo >= alto - 1) continue;

        const x0 = Math.floor(xo);
        const y0 = Math.floor(yo);
        const fx = xo - x0;
        const fy = yo - y0;
        const p00 = pixeles[y0 * ancho + x0];
        const p10 = pixeles[y0 * ancho + x0 + 1];
        const p01 = pixeles[(y0 + 1) * ancho + x0];
        const p11 = pixeles[(y0 + 1) * ancho + x0 + 1];

        salida[y * ancho + x] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy,
        );
      }
    }
    return { ancho, alto, pixeles: salida };
  }

  // ── Recorte de márgenes ──────────────────────────────────────────────────

  /**
   * Encuentra el rectángulo que contiene tinta, con un margen de holgura.
   *
   * El umbral de Otsu marca el ÚLTIMO valor de la clase oscura, no el primero
   * de la clara: la comparación debe ser `<=`. Con `<`, una imagen cuya tinta
   * coincide exactamente con el umbral se lee como si no tuviera contenido.
   */
  detectarMargenes(
    imagen: ImagenGris,
  ): { x: number; y: number; ancho: number; alto: number } | null {
    const { ancho, alto, pixeles } = imagen;
    const umbral = this.umbralDeOtsu(imagen);

    let minX = ancho;
    let minY = alto;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < alto; y += 1) {
      for (let x = 0; x < ancho; x += 1) {
        if (pixeles[y * ancho + x] <= umbral) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // no hay tinta: no se recorta nada

    const holgura = Math.round(Math.min(ancho, alto) * 0.01);
    const x = Math.max(0, minX - holgura);
    const y = Math.max(0, minY - holgura);
    const anchoRecorte = Math.min(ancho - x, maxX - minX + 1 + holgura * 2);
    const altoRecorte = Math.min(alto - y, maxY - minY + 1 + holgura * 2);

    // Si el recorte no gana nada apreciable, no se aplica: cada operación
    // registrada debe justificarse, y recortar un 2 % solo añade ruido a la
    // bitácora. Este piso también hace la operación idempotente.
    const ganancia = 1 - (anchoRecorte * altoRecorte) / (ancho * alto);
    if (ganancia < GANANCIA_MINIMA_RECORTE) return null;

    return { x, y, ancho: anchoRecorte, alto: altoRecorte };
  }

  recortar(
    imagen: ImagenGris,
    region: { x: number; y: number; ancho: number; alto: number },
  ): ImagenGris {
    const salida = new Uint8Array(region.ancho * region.alto);
    for (let y = 0; y < region.alto; y += 1) {
      for (let x = 0; x < region.ancho; x += 1) {
        salida[y * region.ancho + x] =
          imagen.pixeles[(region.y + y) * imagen.ancho + (region.x + x)];
      }
    }
    return { ancho: region.ancho, alto: region.alto, pixeles: salida };
  }

  // ── Contraste ────────────────────────────────────────────────────────────

  /**
   * Ecualización adaptativa con límite de amplificación (CLAHE simplificado).
   *
   * La ecualización global arruina un documento fotografiado con sombra en una
   * esquina: sube el ruido de la zona clara para compensar la oscura. Por
   * regiones, cada zona se corrige con su propio histograma, y el límite de
   * amplificación evita que una región casi uniforme convierta su ruido en
   * manchas negras.
   */
  ecualizacionAdaptativa(
    imagen: ImagenGris,
    regionesPorLado = 8,
    limiteAmplificacion = 3,
  ): { imagen: ImagenGris; parametros: Record<string, number> } {
    const { ancho, alto, pixeles } = imagen;
    const anchoRegion = Math.max(1, Math.ceil(ancho / regionesPorLado));
    const altoRegion = Math.max(1, Math.ceil(alto / regionesPorLado));

    // Se calcula una tabla de mapeo por región y luego se interpola entre las
    // cuatro vecinas, para que no aparezcan costuras entre bloques.
    const tablas: Uint8Array[][] = [];
    for (let rf = 0; rf < regionesPorLado; rf += 1) {
      tablas[rf] = [];
      for (let rc = 0; rc < regionesPorLado; rc += 1) {
        tablas[rf][rc] = this.tablaEcualizacion(
          imagen,
          rc * anchoRegion,
          rf * altoRegion,
          anchoRegion,
          altoRegion,
          limiteAmplificacion,
        );
      }
    }

    const salida = new Uint8Array(ancho * alto);
    for (let y = 0; y < alto; y += 1) {
      const fy = y / altoRegion - 0.5;
      const rf0 = Math.max(0, Math.min(regionesPorLado - 1, Math.floor(fy)));
      const rf1 = Math.max(0, Math.min(regionesPorLado - 1, rf0 + 1));
      const py = Math.max(0, Math.min(1, fy - rf0));

      for (let x = 0; x < ancho; x += 1) {
        const fx = x / anchoRegion - 0.5;
        const rc0 = Math.max(0, Math.min(regionesPorLado - 1, Math.floor(fx)));
        const rc1 = Math.max(0, Math.min(regionesPorLado - 1, rc0 + 1));
        const px = Math.max(0, Math.min(1, fx - rc0));

        const valor = pixeles[y * ancho + x];
        const v00 = tablas[rf0][rc0][valor];
        const v10 = tablas[rf0][rc1][valor];
        const v01 = tablas[rf1][rc0][valor];
        const v11 = tablas[rf1][rc1][valor];

        salida[y * ancho + x] = Math.round(
          v00 * (1 - px) * (1 - py) + v10 * px * (1 - py) + v01 * (1 - px) * py + v11 * px * py,
        );
      }
    }

    return {
      imagen: { ancho, alto, pixeles: salida },
      parametros: { regionesPorLado, limiteAmplificacion },
    };
  }

  /** Histograma acumulado recortado de una región, como tabla de 256 entradas. */
  private tablaEcualizacion(
    imagen: ImagenGris,
    x0: number,
    y0: number,
    ancho: number,
    alto: number,
    limite: number,
  ): Uint8Array {
    const histograma = new Uint32Array(256);
    let total = 0;
    for (let y = y0; y < Math.min(y0 + alto, imagen.alto); y += 1) {
      for (let x = x0; x < Math.min(x0 + ancho, imagen.ancho); x += 1) {
        histograma[imagen.pixeles[y * imagen.ancho + x]] += 1;
        total += 1;
      }
    }

    const tabla = new Uint8Array(256);
    if (total === 0) {
      for (let i = 0; i < 256; i += 1) tabla[i] = i;
      return tabla;
    }

    // Recorte: lo que excede el límite se redistribuye uniformemente, en vez
    // de amplificar sin control el ruido de una región plana.
    const techo = Math.max(1, Math.floor((limite * total) / 256));
    let excedente = 0;
    for (let i = 0; i < 256; i += 1) {
      if (histograma[i] > techo) {
        excedente += histograma[i] - techo;
        histograma[i] = techo;
      }
    }
    const reparto = Math.floor(excedente / 256);
    for (let i = 0; i < 256; i += 1) histograma[i] += reparto;

    let acumulado = 0;
    for (let i = 0; i < 256; i += 1) {
      acumulado += histograma[i];
      tabla[i] = Math.round((acumulado / total) * 255);
    }
    return tabla;
  }

  // ── Binarización ─────────────────────────────────────────────────────────

  /**
   * Umbral local por media de vecindad con desplazamiento.
   *
   * El umbral global falla en una foto con iluminación despareja: la mitad del
   * documento sale negra. El umbral local compara cada píxel con la media de su
   * entorno, que es lo que hace legible una hoja fotografiada con sombra.
   */
  binarizar(
    imagen: ImagenGris,
    ventana = 31,
    desplazamiento = 12,
  ): { imagen: ImagenGris; parametros: Record<string, number> } {
    const { ancho, alto, pixeles } = imagen;
    const integral = this.imagenIntegral(imagen);
    const radio = Math.max(1, Math.floor(ventana / 2));
    const salida = new Uint8Array(ancho * alto);

    for (let y = 0; y < alto; y += 1) {
      const y0 = Math.max(0, y - radio);
      const y1 = Math.min(alto - 1, y + radio);
      for (let x = 0; x < ancho; x += 1) {
        const x0 = Math.max(0, x - radio);
        const x1 = Math.min(ancho - 1, x + radio);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const suma = this.sumaRegion(integral, ancho, x0, y0, x1, y1);
        const media = suma / area;
        salida[y * ancho + x] = pixeles[y * ancho + x] < media - desplazamiento ? 0 : 255;
      }
    }

    return {
      imagen: { ancho, alto, pixeles: salida },
      parametros: { ventana, desplazamiento },
    };
  }

  /** Suma acumulada: permite promediar cualquier ventana en tiempo constante. */
  private imagenIntegral(imagen: ImagenGris): Float64Array {
    const { ancho, alto, pixeles } = imagen;
    const integral = new Float64Array(ancho * alto);
    for (let y = 0; y < alto; y += 1) {
      let acumuladoFila = 0;
      for (let x = 0; x < ancho; x += 1) {
        acumuladoFila += pixeles[y * ancho + x];
        integral[y * ancho + x] = acumuladoFila + (y > 0 ? integral[(y - 1) * ancho + x] : 0);
      }
    }
    return integral;
  }

  private sumaRegion(
    integral: Float64Array,
    ancho: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): number {
    const d = integral[y1 * ancho + x1];
    const b = x0 > 0 ? integral[y1 * ancho + x0 - 1] : 0;
    const c = y0 > 0 ? integral[(y0 - 1) * ancho + x1] : 0;
    const a = x0 > 0 && y0 > 0 ? integral[(y0 - 1) * ancho + x0 - 1] : 0;
    return d - b - c + a;
  }

  /** Umbral global de Otsu: separa la imagen en dos clases maximizando su varianza. */
  umbralDeOtsu(imagen: ImagenGris): number {
    const histograma = new Uint32Array(256);
    for (const valor of imagen.pixeles) histograma[valor] += 1;
    const total = imagen.pixeles.length;

    let sumaTotal = 0;
    for (let i = 0; i < 256; i += 1) sumaTotal += i * histograma[i];

    let sumaFondo = 0;
    let pesoFondo = 0;
    let mejorVarianza = 0;
    let mejorUmbral = 128;

    for (let umbral = 0; umbral < 256; umbral += 1) {
      pesoFondo += histograma[umbral];
      if (pesoFondo === 0) continue;
      const pesoFrente = total - pesoFondo;
      if (pesoFrente === 0) break;

      sumaFondo += umbral * histograma[umbral];
      const mediaFondo = sumaFondo / pesoFondo;
      const mediaFrente = (sumaTotal - sumaFondo) / pesoFrente;
      const varianza = pesoFondo * pesoFrente * (mediaFondo - mediaFrente) ** 2;

      if (varianza > mejorVarianza) {
        mejorVarianza = varianza;
        mejorUmbral = umbral;
      }
    }
    return mejorUmbral;
  }
}
