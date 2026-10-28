import {
  DocumentoLocalIlegibleError, HallazgoQrCrudo, HallazgoQrRegistrado, LectorDocumentoLocalPort,
  LimiteLecturaLocalError, LimitesLecturaLocal, ResultadoOcrPagina, ResumenLecturaLocal, VARIANTES_OCR,
} from '../ports/out/lector-documento-local.port';
import {
  CAMPOS_CLAVE_EPS, CAMPOS_EPS, CONFIANZA_MAXIMA_OCR, CONFIANZA_TEXTO_NATIVO, CamposEpsLeidos, combinarLecturas,
  evaluarSuficienciaEps, extraerCamposEps, faltanCamposClave,
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

  /**
   * Solo los QR del documento, CRUDOS (con su contenido completo), para una
   * verificación posterior. El contenido no se persiste: quien lo recibe lo usa
   * en memoria y lo descarta. Falla cerrado: ante cualquier problema, lista vacía.
   */
  async detectarQrCrudos(
    contenido: Buffer, mime: string, limites: LimitesLecturaLocal = LIMITES_LECTURA_EPS,
  ): Promise<HallazgoQrCrudo[]> {
    const qr: HallazgoQrCrudo[] = [];
    try {
      if (mime === 'application/pdf') {
        const nativo = await this.lector.extraerTextoNativo(contenido, limites);
        for (const { pagina } of nativo.porPagina) {
          try {
            const img = await this.lector.renderizarPagina(contenido, pagina, limites);
            qr.push(...await this.lector.detectarQr(img.imagen, pagina));
          } catch { /* una página que no se rasteriza no impide revisar las demás */ }
        }
      } else if (MIMES_IMAGEN.includes(mime)) {
        const img = await this.lector.prepararImagen(contenido, mime, limites);
        qr.push(...await this.lector.detectarQr(img.imagen, null));
      }
    } catch {
      return [];
    }
    return qr;
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

    const paginasOcr = new Set(paginasParaOcr(
      metricas, camposNativos ? faltanCamposClave(camposNativos) : true, nativo.porPagina.map((p) => p.pagina),
    ));
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
        const r = await this.ocrEscalonado(imagen, pagina, limites, resumen, textosOcr);
        if (r) {
          resumen.ocr.ejecutado = true;
          resumen.ocr.paginas.push(pagina);
          resumen.ocr.giros.push(r.giro);
          textosOcr.push(r.texto);
          confianzas.push(r.confianza);
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
    const r = await this.ocrEscalonado(pagina.imagen, null, limites, resumen, textosOcr);
    if (r) {
      resumen.ocr.ejecutado = true;
      resumen.ocr.giros.push(r.giro);
      textosOcr.push(r.texto);
      confianzas.push(r.confianza);
    }
    this.cerrarOcr(resumen, textosOcr, confianzas, lecturas);
  }

  /**
   * OCR de una página con estrategia DETERMINÍSTICA: la pasada automática primero y, solo si lo leído no basta, la de bloque y la
   * reforzada, en ese orden. «Basta» = los campos clave que el parser logra extraer del texto (no que haya salido texto). Se queda con
   * la pasada que más campos clave dio (a igualdad, la de mayor confianza) y se detiene en cuanto estén todos, si una pasada no cambia
   * nada o si una falla. Un certificado legible se resuelve en la primera pasada: no se repite OCR costoso sin necesidad.
   */
  private async ocrEscalonado(
    imagen: Buffer, pagina: number | null, limites: LimitesLecturaLocal, resumen: ResumenLecturaLocal, textosPrevios: readonly string[],
  ): Promise<ResultadoOcrPagina | null> {
    const leerCampos = (texto: string, confianza: number): CamposEpsLeidos =>
      extraerCamposEps([...textosPrevios, texto].join('\n'), 'ocr', confianza / 100);
    let mejor: { r: ResultadoOcrPagina; campos: number } | null = null;
    let intentos = 0;
    for (const variante of VARIANTES_OCR) {
      let r: ResultadoOcrPagina;
      try {
        r = await this.lector.ejecutarOcr(imagen, pagina, limites, variante);
      } catch (error) {
        resumen.errores.push(error instanceof LimiteLecturaLocalError ? 'ocr_tiempo_agotado' : 'ocr_fallido');
        break;
      }
      intentos += 1;
      if (mejor && r.texto === mejor.r.texto) break; // la pasada no aportó nada distinto: no se sigue
      const encontrados = evaluarSuficienciaEps(leerCampos(r.texto, r.confianza)).campos;
      if (!mejor || encontrados > mejor.campos || (encontrados === mejor.campos && r.confianza > mejor.r.confianza)) mejor = { r, campos: encontrados };
      const completos = leerCampos(mejor.r.texto, mejor.r.confianza);
      if (CAMPOS_CLAVE_EPS.every((c) => completos[c]?.valor != null)) break;
    }
    resumen.ocr.intentos = Math.max(resumen.ocr.intentos ?? 0, intentos);
    return mejor?.r ?? null;
  }

  private cerrarOcr(
    resumen: ResumenLecturaLocal, textos: string[], confianzas: number[], lecturas: CamposEpsLeidos[],
  ): void {
    if (confianzas.length === 0) return;
    const media = confianzas.reduce((a, b) => a + b, 0) / confianzas.length;
    resumen.ocr.confianzaMedia = Math.round(media * 10) / 10;
    // La confianza del campo nunca iguala a la del texto digital (techo CONFIANZA_MAXIMA_OCR: el OCR se equivoca de otra manera),
    // pero SÍ cuenta: con la media del motor en 70 (su propio umbral de «lectura suficiente») el campo llega a 0,70, que es el mínimo
    // para compararlo. Con el descuento anterior (×0,9) una lectura de 77/100 daba 0,69 y descartaba TODOS los campos del OCR.
    const confianzaCampo = Math.max(0, Math.min(CONFIANZA_MAXIMA_OCR, media / 100));
    const camposOcr = extraerCamposEps(textos.join('\n'), 'ocr', confianzaCampo);
    resumen.ocr.suficiencia = evaluarSuficienciaEps(camposOcr).suficiencia;
    lecturas.push(camposOcr);
  }
}

export { CAMPOS_EPS };
