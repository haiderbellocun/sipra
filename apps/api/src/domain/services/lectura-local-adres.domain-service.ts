import { CodigoErrorAdres } from '../entities/adres';
import {
  DocumentoLocalIlegibleError, LectorDocumentoLocalPort, LimiteLecturaLocalError, LimitesLecturaLocal,
} from '../ports/out/lector-documento-local.port';
import { LecturaAdres, extraerDatosAdres } from './adres-resultado.domain-service';
import { LIMITES_LECTURA_EPS, evaluarTextoNativo } from './lectura-local.domain-service';

/**
 * Lectura LOCAL del resultado de ADRES que una persona guardó como PDF: texto
 * nativo primero y OCR solo como respaldo, con la misma infraestructura de la
 * lectura del certificado. Sin IA externa y sin red. Falla cerrado: ante
 * cualquier problema devuelve un código de error, nunca datos inventados.
 */

export interface ResultadoLecturaAdres {
  lectura: LecturaAdres | null;
  ocrEjecutado: boolean;
  paginas: number;
  error: CodigoErrorAdres | null;
}

export class LecturaLocalAdresService {
  constructor(private readonly lector: LectorDocumentoLocalPort) {}

  async leer(pdf: Buffer, limites: LimitesLecturaLocal = LIMITES_LECTURA_EPS): Promise<ResultadoLecturaAdres> {
    let ocrEjecutado = false;
    let paginas = 0;
    try {
      const nativo = await this.lector.extraerTextoNativo(pdf, limites);
      paginas = nativo.paginas;
      const metricas = evaluarTextoNativo(nativo.paginas, nativo.porPagina);
      const textos = nativo.porPagina.filter((p) => !metricas.paginasSinTexto.includes(p.pagina)).map((p) => p.texto);
      let lectura = metricas.utilizable ? extraerDatosAdres(textos.join('\n')) : null;

      // OCR solo si no hay texto utilizable, o si falta el estado y hay páginas sin texto (pueden ser imágenes).
      const hacerOcr = !metricas.utilizable || (lectura?.datos.estadoAfiliacion === null && metricas.paginasSinTexto.length > 0);
      if (hacerOcr) {
        for (const pagina of metricas.paginasSinTexto) {
          try {
            const img = await this.lector.renderizarPagina(pdf, pagina, limites);
            const ocr = await this.lector.ejecutarOcr(img.imagen, pagina, limites);
            ocrEjecutado = true;
            textos.push(ocr.texto);
          } catch (error) {
            if (error instanceof DocumentoLocalIlegibleError) throw error;
            // Una página que no se puede leer no impide aprovechar las demás.
          }
        }
        if (textos.length > 0) lectura = extraerDatosAdres(textos.join('\n'));
      }
      if (!lectura || textos.every((t) => t.replace(/\s+/g, '').length === 0)) {
        return { lectura: null, ocrEjecutado, paginas, error: 'sin_texto' };
      }
      if (!lectura.pareceResultadoAdres) return { lectura, ocrEjecutado, paginas, error: 'no_es_resultado_adres' };
      return { lectura, ocrEjecutado, paginas, error: null };
    } catch (error) {
      if (error instanceof DocumentoLocalIlegibleError) return { lectura: null, ocrEjecutado, paginas, error: 'pdf_ilegible' };
      if (error instanceof LimiteLecturaLocalError) return { lectura: null, ocrEjecutado, paginas, error: 'lectura_fallida' };
      return { lectura: null, ocrEjecutado, paginas, error: 'lectura_fallida' };
    }
  }
}
