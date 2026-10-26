import {
  DocumentoLocalIlegibleError, HallazgoQrCrudo, HallazgoQrRegistrado, LectorDocumentoLocalPort,
  LimiteLecturaLocalError, LimitesLecturaLocal, ResumenLecturaLocal,
} from '../ports/out/lector-documento-local.port';
import {
  CAMPOS_EPS, CONFIANZA_MAXIMA_OCR, CONFIANZA_TEXTO_NATIVO, CamposEpsLeidos, combinarLecturas,
  extraerCamposEps, faltanCamposClave,
} from './extraccion-eps-local.domain-service';
import {
  LIMITES_LECTURA_EPS, clasificarContenidoQr, evaluarTextoNativo, paginasParaOcr,
} from './lectura-local.domain-service';

/**
 * Orquesta la lectura LOCAL de un certificado de EPS:
 *
 *   texto nativo → (QR) → OCR solo si hace falta → campos → combinación de fuentes
 *
 * Depende únicamente del puerto `LectorDocumentoLocalPort`; no conoce pdf.js,
 * ZXing ni Tesseract. No consulta ninguna fuente externa ni sigue el contenido
 * de los QR. Falla cerrado: ante cualquier problema devuelve menos información,
 * nunca más.
 */

export interface LecturaLocalEps {
  campos: CamposEpsLeidos;
  resumen: ResumenLecturaLocal;
  /** El archivo no se pudo abrir (PDF truncado, imagen corrupta): se pide un reenvío. */
  ilegible: boolean;
  motivoIlegible: string | null;
}

const MIMES_IMAGEN = ['image/png', 'image/jpeg'];

function resumenVacio(): ResumenLecturaLocal {
  return {
    textoNativo: null,
    ocr: { ejecutado: false, paginas: [], confianzaMedia: null, giros: [] },
    qr: { paginasEscaneadas: 0, hallazgos: [] },
    discrepanciasFuentes: [],
    limitesAplicados: [],
    errores: [],
    duracionMs: 0,
  };
}

function registrarQr(crudos: readonly HallazgoQrCrudo[]): HallazgoQrRegistrado[] {
  const vistos = new Set<string>();
  const salida: HallazgoQrRegistrado[] = [];
  for (const c of crudos) {
    const k = clasificarContenidoQr(c.contenido);
    const clave = `${c.pagina ?? 0}:${k.hash}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({
      formato: c.formato, pagina: c.pagina, posicion: c.posicion, tipo: k.tipo, longitud: k.longitud, hash: k.hash,
      origenSanitizado: k.origenSanitizado, host: k.host, tieneParametros: k.tieneParametros, senales: k.senales,
    });
  }
  return salida;
}

export class LecturaLocalEpsService {
  constructor(private readonly lector: LectorDocumentoLocalPort) {}

  async leer(contenido: Buffer, mime: string, limites: LimitesLecturaLocal = LIMITES_LECTURA_EPS): Promise<LecturaLocalEps> {
    const inicio = Date.now();
    const resumen = resumenVacio();
    const qr: HallazgoQrCrudo[] = [];
    const lecturas: CamposEpsLeidos[] = [];
    let ilegible = false;
    let motivoIlegible: string | null = null;

    try {
      if (mime === 'application/pdf') await this.leerPdf(contenido, limites, resumen, qr, lecturas);
      else if (MIMES_IMAGEN.includes(mime)) await this.leerImagen(contenido, mime, limites, resumen, qr, lecturas);
      else resumen.errores.push('tipo_de_archivo_no_soportado');
    } catch (error) {
      if (error instanceof DocumentoLocalIlegibleError) {
        ilegible = true;
        motivoIlegible = 'El archivo está dañado o no es un documento válido';
      } else if (error instanceof LimiteLecturaLocalError) {
        resumen.limitesAplicados.push(this.codigoDeLimite(error));
      } else {
        resumen.errores.push('lectura_fallida');
      }
    }

    const { campos, discrepancias } = combinarLecturas(lecturas);
    resumen.discrepanciasFuentes = discrepancias;
    resumen.limitesAplicados = [...new Set(resumen.limitesAplicados)];
    resumen.errores = [...new Set(resumen.errores)];
    resumen.qr.hallazgos = registrarQr(qr);
    resumen.duracionMs = Date.now() - inicio;
    return { campos, resumen, ilegible, motivoIlegible };
  }

  private codigoDeLimite(error: LimiteLecturaLocalError): string {
    return error.limite === 'paginas' ? 'documento_excede_paginas'
      : error.limite === 'pixeles' ? 'pagina_excede_pixeles' : 'tiempo_agotado';
  }

  private async leerPdf(
    contenido: Buffer, limites: LimitesLecturaLocal, resumen: ResumenLecturaLocal,
    qr: HallazgoQrCrudo[], lecturas: CamposEpsLeidos[],
  ): Promise<void> {
    const nativo = await this.lector.extraerTextoNativo(contenido, limites);
    const metricas = evaluarTextoNativo(nativo.paginas, nativo.porPagina);
    resumen.textoNativo = {
      paginas: metricas.paginas, paginasLeidas: metricas.paginasLeidas, paginasConTexto: metricas.paginasConTexto,
      caracteres: metricas.caracteres, utilizable: metricas.utilizable,
    };
    if (nativo.paginas > limites.maxPaginas) resumen.limitesAplicados.push('paginas_omitidas');

    const camposNativos = metricas.utilizable
      ? extraerCamposEps(
        nativo.porPagina.filter((p) => !metricas.paginasSinTexto.includes(p.pagina)).map((p) => p.texto).join('\n'),
        'texto_nativo', CONFIANZA_TEXTO_NATIVO)
      : null;
    if (camposNativos) lecturas.push(camposNativos);

    const paginasOcr = new Set(paginasParaOcr(metricas, camposNativos ? faltanCamposClave(camposNativos) : true));
    const textosOcr: string[] = [];
    const confianzas: number[] = [];

    // Página por página: se rasteriza una vez, se busca QR, se hace OCR si toca y se suelta la imagen.
    for (const { pagina } of nativo.porPagina) {
      let imagen: Buffer | null = null;
      try {
        imagen = (await this.lector.renderizarPagina(contenido, pagina, limites)).imagen;
      } catch (error) {
        if (error instanceof LimiteLecturaLocalError) resumen.limitesAplicados.push(this.codigoDeLimite(error));
        else resumen.errores.push('rasterizacion_fallida');
        continue;
      }
      resumen.qr.paginasEscaneadas += 1;
      qr.push(...await this.lector.detectarQr(imagen, pagina));

      if (paginasOcr.has(pagina)) {
        try {
          const r = await this.lector.ejecutarOcr(imagen, pagina, limites);
          resumen.ocr.ejecutado = true;
          resumen.ocr.paginas.push(pagina);
          resumen.ocr.giros.push(r.giro);
          textosOcr.push(r.texto);
          confianzas.push(r.confianza);
        } catch (error) {
          resumen.errores.push(error instanceof LimiteLecturaLocalError ? 'ocr_tiempo_agotado' : 'ocr_fallido');
        }
      }
      imagen = null; // se suelta antes de la siguiente página
    }
    this.cerrarOcr(resumen, textosOcr, confianzas, lecturas);
  }

  private async leerImagen(
    contenido: Buffer, mime: string, limites: LimitesLecturaLocal, resumen: ResumenLecturaLocal,
    qr: HallazgoQrCrudo[], lecturas: CamposEpsLeidos[],
  ): Promise<void> {
    const pagina = await this.lector.prepararImagen(contenido, mime, limites);
    resumen.qr.paginasEscaneadas = 1;
    qr.push(...await this.lector.detectarQr(pagina.imagen, null));
    const textosOcr: string[] = [];
    const confianzas: number[] = [];
    try {
      const r = await this.lector.ejecutarOcr(pagina.imagen, null, limites);
      resumen.ocr.ejecutado = true;
      resumen.ocr.giros.push(r.giro);
      textosOcr.push(r.texto);
      confianzas.push(r.confianza);
    } catch (error) {
      resumen.errores.push(error instanceof LimiteLecturaLocalError ? 'ocr_tiempo_agotado' : 'ocr_fallido');
    }
    this.cerrarOcr(resumen, textosOcr, confianzas, lecturas);
  }

  private cerrarOcr(
    resumen: ResumenLecturaLocal, textos: string[], confianzas: number[], lecturas: CamposEpsLeidos[],
  ): void {
    if (confianzas.length === 0) return;
    const media = confianzas.reduce((a, b) => a + b, 0) / confianzas.length;
    resumen.ocr.confianzaMedia = Math.round(media * 10) / 10;
    // La confianza del campo nunca iguala a la del texto digital: el OCR se equivoca de otra manera.
    const confianzaCampo = Math.max(0, Math.min(CONFIANZA_MAXIMA_OCR, (media / 100) * 0.9));
    lecturas.push(extraerCamposEps(textos.join('\n'), 'ocr', confianzaCampo));
  }
}

export { CAMPOS_EPS };
