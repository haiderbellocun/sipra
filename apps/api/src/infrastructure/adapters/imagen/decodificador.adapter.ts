import { Injectable, Logger } from '@nestjs/common';
import { crc32 } from 'node:zlib';
import { deflateSync, inflateSync } from 'node:zlib';
import { ImagenGris } from '../../../domain/services/hash-perceptual.domain-service';

/**
 * Decodificador de imágenes a escala de grises, sin dependencias nativas.
 *
 * Solo necesita luminancia a baja resolución para el hash perceptual, de modo
 * que basta con leer PNG completo y, en JPEG, la miniatura de la que se extrae
 * una aproximación por bloques DC. No se busca fidelidad visual: se busca una
 * huella estable.
 */
@Injectable()
export class DecodificadorImagenAdapter {
  private readonly log = new Logger(DecodificadorImagenAdapter.name);

  decodificar(contenido: Buffer, mime: string): ImagenGris | null {
    try {
      if (mime === 'image/png') return this.desdePng(contenido);
      if (mime === 'image/jpeg') return this.desdeJpeg(contenido);
    } catch (error) {
      this.log.debug(`No se pudo decodificar la imagen: ${(error as Error).message}`);
    }
    return null;
  }

  /**
   * Codifica una imagen en escala de grises como PNG de 8 bits.
   *
   * Se necesita para entregar al extractor la versión preprocesada: el puerto
   * de extracción recibe bytes de imagen, no una estructura interna.
   */
  codificarPng(imagen: ImagenGris): Buffer {
    const { ancho, alto, pixeles } = imagen;
    // Filtro 0 (sin filtrar) por fila: el contenido ya es de un solo canal y
    // filtrar no compensa la complejidad.
    const crudo = Buffer.alloc(alto * (ancho + 1));
    for (let y = 0; y < alto; y += 1) {
      crudo[y * (ancho + 1)] = 0;
      for (let x = 0; x < ancho; x += 1) {
        crudo[y * (ancho + 1) + 1 + x] = pixeles[y * ancho + x];
      }
    }

    const trozo = (tipo: string, datos: Buffer): Buffer => {
      const cabecera = Buffer.alloc(4);
      cabecera.writeUInt32BE(datos.length, 0);
      const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
      const suma = Buffer.alloc(4);
      suma.writeUInt32BE(crc32(cuerpo) >>> 0, 0);
      return Buffer.concat([cabecera, cuerpo, suma]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0);
    ihdr.writeUInt32BE(alto, 4);
    ihdr.writeUInt8(8, 8);   // profundidad de bits
    ihdr.writeUInt8(0, 9);   // tipo de color: escala de grises
    ihdr.writeUInt8(0, 10);  // compresión
    ihdr.writeUInt8(0, 11);  // filtrado
    ihdr.writeUInt8(0, 12);  // sin entrelazado

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      trozo('IHDR', ihdr),
      trozo('IDAT', deflateSync(crudo)),
      trozo('IEND', Buffer.alloc(0)),
    ]);
  }

  // ── PNG ──────────────────────────────────────────────────────────────────

  private desdePng(contenido: Buffer): ImagenGris | null {
    if (contenido.readUInt32BE(0) !== 0x89504e47) return null;

    let posicion = 8;
    let ancho = 0;
    let alto = 0;
    let profundidad = 0;
    let tipoColor = 0;
    let entrelazado = 0;
    const trozos: Buffer[] = [];

    while (posicion + 8 <= contenido.length) {
      const largo = contenido.readUInt32BE(posicion);
      const tipo = contenido.toString('latin1', posicion + 4, posicion + 8);
      const datos = contenido.subarray(posicion + 8, posicion + 8 + largo);

      if (tipo === 'IHDR') {
        ancho = datos.readUInt32BE(0);
        alto = datos.readUInt32BE(4);
        profundidad = datos.readUInt8(8);
        tipoColor = datos.readUInt8(9);
        entrelazado = datos.readUInt8(12);
      } else if (tipo === 'IDAT') {
        trozos.push(datos);
      } else if (tipo === 'IEND') {
        break;
      }
      posicion += 12 + largo;
    }

    // El entrelazado Adam7 y las profundidades por debajo de 8 bits son raros
    // en documentos escaneados; se descartan en vez de decodificarlos mal.
    if (!ancho || !alto || profundidad !== 8 || entrelazado !== 0) return null;

    const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipoColor];
    if (!canales) return null;

    const crudo = inflateSync(Buffer.concat(trozos));
    const bytesPorFila = ancho * canales;
    const pixeles = new Uint8Array(ancho * alto);
    const anterior = new Uint8Array(bytesPorFila);
    const actual = new Uint8Array(bytesPorFila);

    for (let f = 0; f < alto; f += 1) {
      const inicio = f * (bytesPorFila + 1);
      if (inicio + bytesPorFila >= crudo.length + 1) break;
      const filtro = crudo[inicio];
      actual.set(crudo.subarray(inicio + 1, inicio + 1 + bytesPorFila));
      this.deshacerFiltro(filtro, actual, anterior, canales);

      for (let c = 0; c < ancho; c += 1) {
        const base = c * canales;
        // Paleta y escala de grises se tratan igual: el primer canal basta.
        const gris =
          canales >= 3
            ? 0.299 * actual[base] + 0.587 * actual[base + 1] + 0.114 * actual[base + 2]
            : actual[base];
        pixeles[f * ancho + c] = Math.round(gris);
      }
      anterior.set(actual);
    }

    return { ancho, alto, pixeles };
  }

  /** Filtros por fila del PNG (RFC 2083, sección 6). */
  private deshacerFiltro(
    filtro: number,
    fila: Uint8Array,
    anterior: Uint8Array,
    canales: number,
  ): void {
    const n = fila.length;
    switch (filtro) {
      case 0:
        return;
      case 1:
        for (let i = canales; i < n; i += 1) fila[i] = (fila[i] + fila[i - canales]) & 0xff;
        return;
      case 2:
        for (let i = 0; i < n; i += 1) fila[i] = (fila[i] + anterior[i]) & 0xff;
        return;
      case 3:
        for (let i = 0; i < n; i += 1) {
          const izquierda = i >= canales ? fila[i - canales] : 0;
          fila[i] = (fila[i] + ((izquierda + anterior[i]) >> 1)) & 0xff;
        }
        return;
      case 4:
        for (let i = 0; i < n; i += 1) {
          const a = i >= canales ? fila[i - canales] : 0;
          const b = anterior[i];
          const c = i >= canales ? anterior[i - canales] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predicho = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          fila[i] = (fila[i] + predicho) & 0xff;
        }
        return;
      default:
        return;
    }
  }

  // ── JPEG ─────────────────────────────────────────────────────────────────

  /**
   * Decodificador JPEG de solo coeficientes DC.
   *
   * Un JPEG guarda cada bloque de 8×8 píxeles como un coeficiente DC —su brillo
   * medio— más 63 coeficientes AC de detalle. Para una huella perceptual el
   * detalle sobra: basta el DC de la componente de luminancia, que da una
   * imagen de ancho/8 × alto/8 exacta para lo que necesita dHash.
   *
   * Esto evita la transformada inversa del coseno y hace innecesaria cualquier
   * dependencia nativa. Solo cubre JPEG secuencial de línea base (SOF0), que es
   * lo que producen las cámaras de teléfono; el progresivo se descarta.
   */
  private desdeJpeg(contenido: Buffer): ImagenGris | null {
    const tablas = new Map<number, TablaHuffman>();
    let ancho = 0;
    let alto = 0;
    let componentes: ComponenteJpeg[] = [];
    let intervaloReinicio = 0;
    let posicion = 2;

    while (posicion < contenido.length - 1) {
      if (contenido[posicion] !== 0xff) {
        posicion += 1;
        continue;
      }
      const marcador = contenido[posicion + 1];
      posicion += 2;
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
        continue;
      }
      if (marcador === 0xd9) break;

      const largo = contenido.readUInt16BE(posicion);
      const segmento = contenida(contenido, posicion + 2, posicion + largo);

      if (marcador === 0xc0 || marcador === 0xc1) {
        alto = segmento.readUInt16BE(1);
        ancho = segmento.readUInt16BE(3);
        const total = segmento.readUInt8(5);
        componentes = [];
        for (let i = 0; i < total; i += 1) {
          const base = 6 + i * 3;
          componentes.push({
            id: segmento.readUInt8(base),
            muestreoH: segmento.readUInt8(base + 1) >> 4,
            muestreoV: segmento.readUInt8(base + 1) & 0x0f,
            tablaDc: 0,
            tablaAc: 0,
            prediccion: 0,
          });
        }
      } else if (marcador === 0xc2) {
        return null; // JPEG progresivo: fuera de alcance.
      } else if (marcador === 0xc4) {
        let desplazamiento = 0;
        while (desplazamiento < segmento.length) {
          const identificador = segmento.readUInt8(desplazamiento);
          const conteos = segmento.subarray(desplazamiento + 1, desplazamiento + 17);
          let simbolos = 0;
          for (const c of conteos) simbolos += c;
          const valores = segmento.subarray(desplazamiento + 17, desplazamiento + 17 + simbolos);
          tablas.set(identificador, construirHuffman(conteos, valores));
          desplazamiento += 17 + simbolos;
        }
      } else if (marcador === 0xdd) {
        intervaloReinicio = segmento.readUInt16BE(0);
      } else if (marcador === 0xda) {
        const total = segmento.readUInt8(0);
        for (let i = 0; i < total; i += 1) {
          const id = segmento.readUInt8(1 + i * 2);
          const tablasComponente = segmento.readUInt8(2 + i * 2);
          const componente = componentes.find((c) => c.id === id);
          if (componente) {
            componente.tablaDc = tablasComponente >> 4;
            componente.tablaAc = tablasComponente & 0x0f;
          }
        }
        return this.leerDcDelBarrido(
          contenido, posicion + largo, ancho, alto, componentes, tablas, intervaloReinicio,
        );
      }
      posicion += largo;
    }
    return null;
  }

  /**
   * Recorre el barrido entrelazado leyendo el DC de cada bloque y descartando
   * los AC —que igual hay que decodificar para avanzar el flujo de bits—.
   */
  private leerDcDelBarrido(
    contenido: Buffer,
    inicio: number,
    ancho: number,
    alto: number,
    componentes: ComponenteJpeg[],
    tablas: Map<number, TablaHuffman>,
    intervaloReinicio: number,
  ): ImagenGris | null {
    if (!ancho || !alto || componentes.length === 0) return null;

    const maxH = Math.max(...componentes.map((c) => c.muestreoH));
    const maxV = Math.max(...componentes.map((c) => c.muestreoV));
    if (!maxH || !maxV) return null;

    const luminancia = componentes[0];
    const mcusPorFila = Math.ceil(ancho / (8 * maxH));
    const mcusPorColumna = Math.ceil(alto / (8 * maxV));
    const anchoSalida = mcusPorFila * luminancia.muestreoH;
    const altoSalida = mcusPorColumna * luminancia.muestreoV;
    const salida = new Uint8Array(anchoSalida * altoSalida).fill(128);

    const flujo = new FlujoDeBits(contenido, inicio);
    let desdeReinicio = 0;

    try {
      for (let my = 0; my < mcusPorColumna; my += 1) {
        for (let mx = 0; mx < mcusPorFila; mx += 1) {
          if (intervaloReinicio > 0 && desdeReinicio === intervaloReinicio) {
            flujo.alinearTrasReinicio();
            for (const c of componentes) c.prediccion = 0;
            desdeReinicio = 0;
          }

          for (const componente of componentes) {
            for (let v = 0; v < componente.muestreoV; v += 1) {
              for (let h = 0; h < componente.muestreoH; h += 1) {
                const dc = this.leerBloque(flujo, componente, tablas);
                if (dc === null) return this.empaquetar(salida, anchoSalida, altoSalida);
                if (componente === luminancia) {
                  const x = mx * componente.muestreoH + h;
                  const y = my * componente.muestreoV + v;
                  if (x < anchoSalida && y < altoSalida) {
                    // El DC va escalado por 8 y centrado en cero.
                    salida[y * anchoSalida + x] = recortar(Math.round(dc / 8) + 128);
                  }
                }
              }
            }
          }
          desdeReinicio += 1;
        }
      }
    } catch {
      // Un barrido truncado da una huella parcial, que sigue siendo utilizable.
    }
    return this.empaquetar(salida, anchoSalida, altoSalida);
  }

  /** Decodifica un bloque y devuelve su DC acumulado; null si el flujo terminó. */
  private leerBloque(
    flujo: FlujoDeBits,
    componente: ComponenteJpeg,
    tablas: Map<number, TablaHuffman>,
  ): number | null {
    const tablaDc = tablas.get(componente.tablaDc);
    const tablaAc = tablas.get(0x10 | componente.tablaAc);
    if (!tablaDc || !tablaAc) return null;

    const magnitud = flujo.decodificarHuffman(tablaDc);
    if (magnitud === null) return null;
    const diferencia = magnitud === 0 ? 0 : extender(flujo.leerBits(magnitud), magnitud);
    componente.prediccion += diferencia;

    // Los AC se decodifican y se descartan: sin recorrerlos, el flujo de bits
    // queda desalineado para el bloque siguiente.
    let k = 1;
    while (k < 64) {
      const simbolo = flujo.decodificarHuffman(tablaAc);
      if (simbolo === null) return componente.prediccion;
      const ceros = simbolo >> 4;
      const bits = simbolo & 0x0f;
      if (bits === 0) {
        if (ceros !== 15) break; // fin de bloque
        k += 16;
        continue;
      }
      k += ceros + 1;
      flujo.leerBits(bits);
    }
    return componente.prediccion;
  }

  private empaquetar(pixeles: Uint8Array, ancho: number, alto: number): ImagenGris | null {
    return ancho >= 9 && alto >= 8 ? { ancho, alto, pixeles } : null;
  }
}

// ── Apoyo de la decodificación JPEG ────────────────────────────────────────

interface ComponenteJpeg {
  id: number;
  muestreoH: number;
  muestreoV: number;
  tablaDc: number;
  tablaAc: number;
  prediccion: number;
}

interface TablaHuffman {
  /** Código Huffman → símbolo, indexado por longitud. */
  porLongitud: Map<number, number>[];
}

function contenida(buffer: Buffer, desde: number, hasta: number): Buffer {
  return buffer.subarray(desde, Math.min(hasta, buffer.length));
}

function construirHuffman(conteos: Buffer, valores: Buffer): TablaHuffman {
  const porLongitud: Map<number, number>[] = Array.from(
    { length: 17 },
    () => new Map<number, number>(),
  );
  let codigo = 0;
  let indice = 0;
  for (let longitud = 1; longitud <= 16; longitud += 1) {
    for (let i = 0; i < conteos[longitud - 1]; i += 1) {
      porLongitud[longitud].set(codigo, valores[indice]);
      codigo += 1;
      indice += 1;
    }
    codigo <<= 1;
  }
  return { porLongitud };
}

/** Convierte la representación de magnitud del JPEG a entero con signo. */
function extender(valor: number, magnitud: number): number {
  return valor < 1 << (magnitud - 1) ? valor - (1 << magnitud) + 1 : valor;
}

function recortar(valor: number): number {
  return valor < 0 ? 0 : valor > 255 ? 255 : valor;
}

/** Lector de bits que salta el relleno 0xFF00 y los marcadores de reinicio. */
class FlujoDeBits {
  private posicion: number;
  private acumulador = 0;
  private disponibles = 0;

  constructor(private readonly datos: Buffer, inicio: number) {
    this.posicion = inicio;
  }

  private siguienteByte(): number | null {
    if (this.posicion >= this.datos.length) return null;
    const byte = this.datos[this.posicion];
    this.posicion += 1;
    if (byte === 0xff) {
      const siguiente = this.datos[this.posicion];
      if (siguiente === 0x00) {
        this.posicion += 1; // relleno
      } else if (siguiente !== undefined && siguiente >= 0xd0 && siguiente <= 0xd7) {
        this.posicion += 1; // marcador de reinicio
        return this.siguienteByte();
      } else {
        return null; // fin del barrido
      }
    }
    return byte;
  }

  leerBit(): number | null {
    if (this.disponibles === 0) {
      const byte = this.siguienteByte();
      if (byte === null) return null;
      this.acumulador = byte;
      this.disponibles = 8;
    }
    this.disponibles -= 1;
    return (this.acumulador >> this.disponibles) & 1;
  }

  leerBits(cantidad: number): number {
    let valor = 0;
    for (let i = 0; i < cantidad; i += 1) {
      const bit = this.leerBit();
      if (bit === null) return valor;
      valor = (valor << 1) | bit;
    }
    return valor;
  }

  decodificarHuffman(tabla: TablaHuffman): number | null {
    let codigo = 0;
    for (let longitud = 1; longitud <= 16; longitud += 1) {
      const bit = this.leerBit();
      if (bit === null) return null;
      codigo = (codigo << 1) | bit;
      const simbolo = tabla.porLongitud[longitud].get(codigo);
      if (simbolo !== undefined) return simbolo;
    }
    return null;
  }

  /** Tras un marcador de reinicio el flujo vuelve a alinearse a byte. */
  alinearTrasReinicio(): void {
    this.disponibles = 0;
    while (this.posicion < this.datos.length - 1) {
      if (this.datos[this.posicion] === 0xff) {
        const siguiente = this.datos[this.posicion + 1];
        if (siguiente >= 0xd0 && siguiente <= 0xd7) {
          this.posicion += 2;
          return;
        }
      }
      this.posicion += 1;
    }
  }
}
