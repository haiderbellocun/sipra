import { Bandera, SeveridadBandera } from '../entities/documento.entity';

/**
 * Capas 0 y 1 del pipeline: determinísticas, sin IA, y la que mayor proporción
 * de irregularidades detecta. La IA no decide autenticidad — nunca.
 */

/** Firmas binarias (magic numbers) admitidas. */
const FIRMAS: readonly { mime: string; firma: readonly number[]; desplazamiento: number }[] = [
  { mime: 'application/pdf', firma: [0x25, 0x50, 0x44, 0x46], desplazamiento: 0 },
  { mime: 'image/jpeg', firma: [0xff, 0xd8, 0xff], desplazamiento: 0 },
  { mime: 'image/png', firma: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], desplazamiento: 0 },
];

/** Productores esperados de un documento emitido por un sistema institucional. */
const PRODUCTORES_INSTITUCIONALES = [
  'itext', 'jasperreports', 'crystal', 'reportlab', 'fpdf', 'tcpdf', 'wkhtmltopdf', 'pdfsharp',
];

/** Productores de escritorio: bandera crítica en un certificado emitido por sistema. */
const PRODUCTORES_ESCRITORIO = [
  'microsoft word', 'word', 'libreoffice', 'openoffice', 'pages', 'canva',
  'photoshop', 'gimp', 'illustrator', 'inkscape', 'foxit phantom', 'nitro',
];

export interface MetadatosPdf {
  productor: string | null;
  creador: string | null;
  fechaCreacion: Date | null;
  fechaModificacion: Date | null;
  /** Conteo de marcas %%EOF: >1 indica revisiones incrementales. */
  marcasFinArchivo: number;
  tipografiasEmbebidas: string[];
  tieneCapaTexto: boolean;
}

export interface EntradaForense {
  buffer: Buffer;
  nombreDeclarado: string;
  mimeDeclarado: string;
  /** Documentos del mismo hash ya presentes en el sistema. */
  coincidenciasHash: number;
  /** Tipos de documento donde este documento debería venir de un sistema. */
  esperaProductorInstitucional: boolean;
}

export class ForenseDomainService {
  /** Capa 0 — tipo real de archivo por firma binaria. */
  detectarMimeReal(buffer: Buffer): string | null {
    for (const { mime, firma, desplazamiento } of FIRMAS) {
      if (buffer.length < desplazamiento + firma.length) continue;
      const coincide = firma.every((byte, i) => buffer[desplazamiento + i] === byte);
      if (coincide) return mime;
    }
    return null;
  }

  /** Extrae metadatos del PDF sin dependencias externas. */
  leerMetadatosPdf(buffer: Buffer): MetadatosPdf {
    const texto = buffer.toString('latin1');
    const capturar = (clave: string): string | null => {
      const m = texto.match(new RegExp(`/${clave}\\s*\\(([^)]*)\\)`));
      return m ? m[1].trim() : null;
    };
    const fecha = (valor: string | null): Date | null => {
      if (!valor) return null;
      const m = valor.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
      if (!m) return null;
      return new Date(
        Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)),
      );
    };

    const tipografias = [...texto.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+#,\-_]+)/g)].map(
      (m) => m[1].replace(/^[A-Z]{6}\+/, ''),
    );

    return {
      productor: capturar('Producer'),
      creador: capturar('Creator'),
      fechaCreacion: fecha(capturar('CreationDate')),
      fechaModificacion: fecha(capturar('ModDate')),
      marcasFinArchivo: (texto.match(/%%EOF/g) ?? []).length,
      tipografiasEmbebidas: [...new Set(tipografias)],
      tieneCapaTexto: /\/Type\s*\/Font/.test(texto) || /BT\s/.test(texto),
    };
  }

  /**
   * Ejecuta las capas 0 y 1 y devuelve banderas. Una bandera crítica
   * cortocircuita el pipeline: no se consumen tokens de IA.
   */
  analizar(entrada: EntradaForense): Bandera[] {
    const banderas: Bandera[] = [];

    const mimeReal = this.detectarMimeReal(entrada.buffer);
    if (!mimeReal) {
      banderas.push({
        codigo: 'C0_TIPO_NO_RECONOCIDO',
        capa: 0,
        severidad: SeveridadBandera.CRITICA,
        mensaje: 'La firma binaria no corresponde a PDF, JPG ni PNG',
        mensajeUsuario: 'El archivo no es un PDF ni una imagen válida. Vuelva a cargarlo.',
      });
      return banderas;
    }
    if (mimeReal !== entrada.mimeDeclarado) {
      banderas.push({
        codigo: 'C0_TIPO_DISCREPANTE',
        capa: 0,
        severidad: SeveridadBandera.ALTA,
        mensaje: `Tipo declarado ${entrada.mimeDeclarado} pero la firma binaria es ${mimeReal}`,
        mensajeUsuario: 'El archivo no corresponde a la extensión indicada.',
      });
    }

    if (entrada.coincidenciasHash > 0) {
      banderas.push({
        codigo: 'C0_HASH_DUPLICADO',
        capa: 0,
        severidad: SeveridadBandera.CRITICA,
        mensaje: `El mismo archivo fue presentado en ${entrada.coincidenciasHash} expediente(s)`,
      });
    }

    if (mimeReal !== 'application/pdf') return banderas;

    const meta = this.leerMetadatosPdf(entrada.buffer);

    if (meta.marcasFinArchivo > 1) {
      banderas.push({
        codigo: 'C1_REVISIONES_INCREMENTALES',
        capa: 1,
        severidad: SeveridadBandera.ALTA,
        mensaje: `${meta.marcasFinArchivo} marcas de fin de archivo: el PDF fue editado tras su creación`,
      });
    }

    const productor = (meta.productor ?? meta.creador ?? '').toLowerCase();
    if (entrada.esperaProductorInstitucional && productor) {
      const esEscritorio = PRODUCTORES_ESCRITORIO.some((p) => productor.includes(p));
      const esInstitucional = PRODUCTORES_INSTITUCIONALES.some((p) => productor.includes(p));
      if (esEscritorio) {
        banderas.push({
          codigo: 'C1_PRODUCTOR_ESCRITORIO',
          capa: 1,
          severidad: SeveridadBandera.CRITICA,
          mensaje: `Productor declarado "${meta.productor ?? meta.creador}": un editor de escritorio en un documento que debe emitir un sistema`,
        });
      } else if (!esInstitucional) {
        banderas.push({
          codigo: 'C1_PRODUCTOR_DESCONOCIDO',
          capa: 1,
          severidad: SeveridadBandera.MEDIA,
          mensaje: `Productor declarado "${meta.productor ?? meta.creador}" no reconocido como sistema emisor`,
        });
      }
    }

    if (meta.tipografiasEmbebidas.length > 4) {
      banderas.push({
        codigo: 'C1_TIPOGRAFIAS_MULTIPLES',
        capa: 1,
        severidad: SeveridadBandera.MEDIA,
        mensaje: `${meta.tipografiasEmbebidas.length} tipografías embebidas: revisar cambios de fuente dentro de un mismo campo`,
      });
    }

    if (
      meta.fechaCreacion &&
      meta.fechaModificacion &&
      meta.fechaModificacion.getTime() - meta.fechaCreacion.getTime() > 86_400_000
    ) {
      banderas.push({
        codigo: 'C1_MODIFICADO_POSTERIORMENTE',
        capa: 1,
        severidad: SeveridadBandera.MEDIA,
        mensaje: 'El documento se modificó más de 24 horas después de su creación',
      });
    }

    if (!meta.tieneCapaTexto) {
      banderas.push({
        codigo: 'C1_SIN_CAPA_TEXTO',
        capa: 1,
        severidad: SeveridadBandera.INFORMATIVA,
        mensaje: 'PDF sin capa de texto: es una imagen incrustada, requiere OCR',
      });
    }

    return banderas;
  }

  /** Puntaje 0–100 de la capa 5 a partir de las banderas acumuladas. */
  calcularPuntaje(banderas: readonly Bandera[]): number {
    const penalizacion: Record<SeveridadBandera, number> = {
      [SeveridadBandera.INFORMATIVA]: 2,
      [SeveridadBandera.MEDIA]: 12,
      [SeveridadBandera.ALTA]: 30,
      [SeveridadBandera.CRITICA]: 70,
    };
    const total = banderas.reduce((acc, b) => acc + penalizacion[b.severidad], 0);
    return Math.max(0, 100 - total);
  }

  /** ¿Hay bandera crítica que justifique cortocircuitar antes de la IA? */
  debeCortocircuitar(banderas: readonly Bandera[]): boolean {
    return banderas.some((b) => b.severidad === SeveridadBandera.CRITICA);
  }
}
