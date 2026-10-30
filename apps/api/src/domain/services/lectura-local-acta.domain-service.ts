import { DatosSipraActa } from '../entities/acta-iniciacion';
import { CajaTexto, GeometriaDocumentoPort, RectRelativo } from '../ports/out/geometria-documento.port';
import {
  DocumentoLocalIlegibleError, LectorDocumentoLocalPort, LimiteLecturaLocalError, LimitesLecturaLocal,
  ResultadoOcrPagina, VARIANTES_OCR,
} from '../ports/out/lector-documento-local.port';
import { AnalisisActa, analizarActa } from './analisis-acta.domain-service';
import { clasificarActa } from './clasificacion-acta.domain-service';
import { extraerCamposActa } from './extraccion-acta.domain-service';
import { MedicionesFirmas } from './firmas-acta.domain-service';
import { evaluarTextoNativo } from './lectura-local.domain-service';
import { localizarZonasFirma, paginaTieneRotulosFirma } from './localizacion-firmas.domain-service';
import { SuficienciaActa, evaluarSuficienciaActa } from './suficiencia-acta.domain-service';

/**
 * Lectura LOCAL del acta de iniciación: archivo → texto nativo → (OCR si hace falta) → `analizarActa`.
 *
 * Todo ocurre dentro del proceso (pdf.js, Tesseract, canvas): el documento no sale a ningún tercero.
 * Este servicio solo ORQUESTA: la clasificación, la extracción, la comparación y las reglas de la ARL
 * viven en el dominio (`analizarActa`) y aquí no se repiten. Falla cerrado: ante cualquier problema
 * entrega menos información, nunca más.
 *
 * No hay un orquestador genérico compartido con EPS a propósito: lo que varía (suficiencia, criterio
 * de parada del OCR, qué se hace tras leer) es justo lo que la abstracción tendría que recibir, y
 * queda más complejo que las ~40 líneas que se repiten.
 */

/** Cotas para un acta (3 páginas en los formatos conocidos). Mismos topes de seguridad que el resto de la lectura local. */
export const LIMITES_LECTURA_ACTA: LimitesLecturaLocal = {
  maxPaginas: 4,
  maxPaginasDocumento: 10,
  // ~4 Mpx: una página A4 a 2× (144 dpi) tiene ~2 Mpx.
  maxPixeles: 4_000_000,
  escalaRender: 2,
  timeoutMs: 30_000,
};

export type MetodoLecturaActa = 'texto' | 'ocr';

/** Qué hizo la lectura, sin el contenido del documento. */
export interface ResumenLecturaActa {
  /** `ocr` si alguna página tuvo que leerse por OCR (la lectura es entonces menos confiable). */
  metodoLectura: MetodoLecturaActa;
  paginas: number;
  paginasLeidas: number;
  paginasOcr: number[];
  /** Pasadas de OCR dadas en total. */
  intentosOcr: number;
  /** Confianza media del motor de OCR, 0–100; `null` si no hubo OCR. */
  confianzaOcrMedia: number | null;
  textoNativo: { caracteres: number; paginasConTexto: number; utilizable: boolean } | null;
  suficiencia: SuficienciaActa;
  /** Dónde se buscaron las firmas. */
  firmas: { pagina: number | null; empresaLocalizada: boolean; practicanteLocalizada: boolean };
  /** `paginas_omitidas`, `documento_excede_paginas`, `pagina_excede_pixeles`, `tiempo_agotado`… */
  limitesAplicados: string[];
  /** Fallos parciales (códigos, sin mensajes del documento). */
  errores: string[];
  duracionMs: number;
}

export interface LecturaActaLocal {
  resumen: ResumenLecturaActa;
  /** Clasificación, campos, firmas y —si se pasaron datos de SIPRA— la comparación. Sin el texto del documento. */
  analisis: AnalisisActa;
  /** El archivo no se pudo abrir (PDF truncado, imagen corrupta): se pide un reenvío. */
  ilegible: boolean;
  motivoIlegible: string | null;
}

const MIMES_IMAGEN = ['image/png', 'image/jpeg'];

type OrigenTexto = 'texto' | 'ocr';
interface PaginaLeida { texto: string; origen: OrigenTexto }

function unir(paginas: ReadonlyMap<number, PaginaLeida>): string {
  return [...paginas.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p.texto).join('\n\n');
}

export class LecturaLocalActaService {
  constructor(
    private readonly lector: LectorDocumentoLocalPort,
    /** Sin geometría no se miden las firmas: quedan `no_determinable`. */
    private readonly geometria: GeometriaDocumentoPort | null = null,
  ) {}

  async leer(
    contenido: Buffer, mime: string, sipra: DatosSipraActa | null = null, limites: LimitesLecturaLocal = LIMITES_LECTURA_ACTA,
  ): Promise<LecturaActaLocal> {
    const inicio = Date.now();
    const paginas = new Map<number, PaginaLeida>();
    const estado: Estado = {
      paginas, confianzas: [], intentosOcr: 0, paginasOcr: [], limitesAplicados: [], errores: [],
      total: 0, textoNativo: null, imagenUnica: null,
    };
    let ilegible = false;
    let motivoIlegible: string | null = null;

    try {
      if (mime === 'application/pdf') await this.leerPdf(contenido, limites, estado);
      else if (MIMES_IMAGEN.includes(mime)) await this.leerImagen(contenido, mime, limites, estado);
      else estado.errores.push('tipo_de_archivo_no_soportado');
    } catch (error) {
      if (error instanceof DocumentoLocalIlegibleError) {
        ilegible = true;
        motivoIlegible = 'El archivo está dañado o no es un documento válido';
      } else if (error instanceof LimiteLecturaLocalError) {
        estado.limitesAplicados.push(this.codigoDeLimite(error));
      } else {
        estado.errores.push('lectura_fallida');
      }
    }

    const texto = unir(paginas);
    const usoOcr = estado.paginasOcr.length > 0;
    const confianzaMedia = estado.confianzas.length > 0
      ? estado.confianzas.reduce((a, b) => a + b, 0) / estado.confianzas.length : null;
    const fuente = usoOcr ? 'ocr' as const : 'texto_nativo' as const;
    const confianzaOcr = confianzaMedia === null ? undefined : confianzaMedia / 100;

    // Las firmas solo se miden si el documento es un acta: en cualquier otro caso no hay nada que medir.
    let mediciones: MedicionesFirmas | null = null;
    let ubicacion: ResumenLecturaActa['firmas'] = { pagina: null, empresaLocalizada: false, practicanteLocalizada: false };
    if (!ilegible && clasificarActa(texto).tipoActaDetectada === 'iniciacion_practicas') {
      const m = await this.medirFirmas(contenido, mime, limites, estado);
      mediciones = m.mediciones;
      ubicacion = m.ubicacion;
    }

    const analisis = analizarActa(texto, fuente, sipra, mediciones, confianzaOcr);
    const resumen: ResumenLecturaActa = {
      metodoLectura: usoOcr ? 'ocr' : 'texto',
      paginas: estado.total,
      paginasLeidas: paginas.size,
      paginasOcr: [...estado.paginasOcr].sort((a, b) => a - b),
      intentosOcr: estado.intentosOcr,
      confianzaOcrMedia: confianzaMedia === null ? null : Math.round(confianzaMedia * 10) / 10,
      textoNativo: estado.textoNativo,
      suficiencia: evaluarSuficienciaActa(analisis.clasificacion, analisis.campos),
      firmas: ubicacion,
      limitesAplicados: [...new Set(estado.limitesAplicados)],
      errores: [...new Set(estado.errores)],
      duracionMs: Date.now() - inicio,
    };
    return { resumen, analisis, ilegible, motivoIlegible };
  }

  private codigoDeLimite(error: LimiteLecturaLocalError): string {
    return error.limite === 'paginas' ? 'documento_excede_paginas'
      : error.limite === 'pixeles' ? 'pagina_excede_pixeles' : 'tiempo_agotado';
  }

  /** Clasificación y campos de lo leído hasta ahora, con la suficiencia propia del acta. */
  private evaluar(paginas: ReadonlyMap<number, PaginaLeida>, usaOcr: boolean, confianzaOcr?: number): SuficienciaActa {
    const texto = unir(paginas);
    const clasificacion = clasificarActa(texto);
    return evaluarSuficienciaActa(clasificacion, extraerCamposActa(texto, usaOcr ? 'ocr' : 'texto_nativo', confianzaOcr));
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  private async leerPdf(contenido: Buffer, limites: LimitesLecturaLocal, estado: Estado): Promise<void> {
    const nativo = await this.lector.extraerTextoNativo(contenido, limites);
    estado.total = nativo.paginas;
    if (nativo.paginas > limites.maxPaginas) estado.limitesAplicados.push('paginas_omitidas');
    const metricas = evaluarTextoNativo(nativo.paginas, nativo.porPagina);
    estado.textoNativo = { caracteres: metricas.caracteres, paginasConTexto: metricas.paginasConTexto, utilizable: metricas.utilizable };
    for (const p of nativo.porPagina) {
      if (!metricas.paginasSinTexto.includes(p.pagina)) estado.paginas.set(p.pagina, { texto: p.texto, origen: 'texto' });
    }

    // El texto nativo va primero: si ya alcanza para decir qué es el documento, no se paga OCR.
    if (metricas.utilizable && this.evaluar(estado.paginas, false).paraClasificar) {
      // La capa de texto dice QUÉ documento es, pero puede traer solo la plantilla: lo diligenciado puede estar dibujado
      // (imagen, anotaciones, curvas) y no estar en el texto. Si no se leyó ningún dato, se verifica con OCR.
      // Solo si es un acta: un documento que se reconoce como OTRA cosa no se lee más.
      const esActa = clasificarActa(unir(estado.paginas)).tipoActaDetectada === 'iniciacion_practicas';
      if (esActa && !this.evaluar(estado.paginas, false).paraComparar) await this.complementarConOcr(contenido, limites, estado);
      return;
    }

    // Solo se leen por OCR las páginas SIN texto utilizable. Otra pasada sobre texto digital no le suma nada.
    for (const pagina of metricas.paginasSinTexto) {
      let imagen: Buffer;
      try {
        imagen = (await this.lector.renderizarPagina(contenido, pagina, limites)).imagen;
      } catch (error) {
        if (error instanceof LimiteLecturaLocalError) estado.limitesAplicados.push(this.codigoDeLimite(error));
        else estado.errores.push('rasterizacion_fallida');
        continue;
      }
      await this.ocrDePagina(imagen, pagina, limites, estado);
    }
  }

  /**
   * El texto digital clasifica el documento pero no trae datos suficientes para compararlo. Se lee por OCR la imagen de las
   * páginas (que sí incluye lo dibujado) y se ADOPTA solo si trae más campos clave que el texto; si no, se conserva el texto
   * (una plantilla en blanco sigue siendo una plantilla en blanco). El intento de OCR queda contado.
   */
  private async complementarConOcr(contenido: Buffer, limites: LimitesLecturaLocal, estado: Estado): Promise<void> {
    const antes = {
      paginas: new Map(estado.paginas), paginasOcr: [...estado.paginasOcr], confianzas: [...estado.confianzas],
    };
    const clavesAntes = this.evaluar(estado.paginas, false).camposClaveLeidos;
    const ultima = Math.min(estado.total, limites.maxPaginas);
    for (let pagina = 1; pagina <= ultima; pagina += 1) {
      try {
        const imagen = (await this.lector.renderizarPagina(contenido, pagina, limites)).imagen;
        await this.ocrDePagina(imagen, pagina, limites, estado);
      } catch (error) {
        if (error instanceof LimiteLecturaLocalError) estado.limitesAplicados.push(this.codigoDeLimite(error));
        else estado.errores.push('rasterizacion_fallida');
        break;
      }
    }
    const confianzaMedia = estado.confianzas.length > 0 ? estado.confianzas.reduce((a, b) => a + b, 0) / estado.confianzas.length : 0;
    const despues = this.evaluar(estado.paginas, true, confianzaMedia / 100).camposClaveLeidos;
    if (despues <= clavesAntes) {
      estado.paginas.clear();
      for (const [p, v] of antes.paginas) estado.paginas.set(p, v);
      estado.paginasOcr.splice(0, estado.paginasOcr.length, ...antes.paginasOcr);
      estado.confianzas.splice(0, estado.confianzas.length, ...antes.confianzas);
    }
  }

  // ── Imagen (foto o escaneo suelto) ─────────────────────────────────────────

  private async leerImagen(contenido: Buffer, mime: string, limites: LimitesLecturaLocal, estado: Estado): Promise<void> {
    const pagina = await this.lector.prepararImagen(contenido, mime, limites);
    estado.total = 1;
    estado.imagenUnica = pagina.imagen;
    await this.ocrDePagina(pagina.imagen, 1, limites, estado);
  }

  // ── OCR ────────────────────────────────────────────────────────────────────

  /**
   * OCR de una página con estrategia DETERMINÍSTICA, de la pasada más barata a la más costosa. Se queda con la pasada
   * que mejor deja al acta (más clara la clasificación, más señales y campos clave, más confianza) y se detiene en cuanto
   * el documento ya es comparable, ya se sabe que es OTRO documento, una pasada no mejora a la anterior o el motor falla.
   */
  private async ocrDePagina(imagen: Buffer, pagina: number, limites: LimitesLecturaLocal, estado: Estado): Promise<void> {
    let mejor: { r: ResultadoOcrPagina; puntaje: number } | null = null;
    for (const variante of VARIANTES_OCR) {
      let r: ResultadoOcrPagina;
      try {
        r = await this.lector.ejecutarOcr(imagen, pagina, limites, variante);
      } catch (error) {
        estado.errores.push(error instanceof LimiteLecturaLocalError ? 'ocr_tiempo_agotado' : 'ocr_fallido');
        break;
      }
      estado.intentosOcr += 1;
      if (mejor && r.texto === mejor.r.texto) break; // la pasada no aportó nada distinto
      const candidato = new Map(estado.paginas).set(pagina, { texto: r.texto, origen: 'ocr' });
      const s = this.evaluar(candidato, true, r.confianza / 100);
      const puntaje = (s.paraClasificar ? 1000 : 0) + s.senalesLeidas * 10 + s.camposClaveLeidos + r.confianza / 100;
      const mejoro = !mejor || puntaje > mejor.puntaje;
      if (mejoro) mejor = { r, puntaje };
      const esOtroDocumento = s.paraClasificar && clasificarActa(unir(candidato)).tipoActaDetectada === 'documento_incorrecto';
      if (s.paraComparar || esOtroDocumento) break;
      if (!mejoro) break;
      // Un acta clara y bien leída que no trae más datos (p. ej. en blanco) no mejora con más pasadas.
      if (s.paraClasificar && r.confianza >= CONFIANZA_OCR_SUFICIENTE) break;
    }
    if (mejor && mejor.r.texto.trim().length > 0) {
      estado.paginas.set(pagina, { texto: mejor.r.texto, origen: 'ocr' });
      estado.paginasOcr.push(pagina);
      estado.confianzas.push(mejor.r.confianza);
    }
  }

  // ── Firmas ─────────────────────────────────────────────────────────────────

  /**
   * Localiza los rótulos de firma (con las cajas de texto digital u OCR de su página) y mide la tinta de la zona
   * situada sobre cada uno, sobre la página rasterizada. Si algo no se puede ubicar o medir, esa firma queda sin medición
   * (`no_determinable`): nunca se afirma por defecto.
   */
  private async medirFirmas(
    contenido: Buffer, mime: string, limites: LimitesLecturaLocal, estado: Estado,
  ): Promise<{ mediciones: MedicionesFirmas | null; ubicacion: ResumenLecturaActa['firmas'] }> {
    const sin = { mediciones: null, ubicacion: { pagina: null, empresaLocalizada: false, practicanteLocalizada: false } };
    if (!this.geometria) return sin;
    const candidatas = [...estado.paginas.entries()]
      .map(([pagina, p]) => ({ pagina, origen: p.origen, r: paginaTieneRotulosFirma(p.texto) }))
      .filter((c) => c.r.empresa || c.r.practicante)
      .sort((a, b) => Number(b.r.empresa && b.r.practicante) - Number(a.r.empresa && a.r.practicante) || a.pagina - b.pagina);
    const elegida = candidatas[0];
    if (!elegida) return sin;

    try {
      const imagen = mime === 'application/pdf'
        ? (await this.lector.renderizarPagina(contenido, elegida.pagina, limites)).imagen
        : estado.imagenUnica;
      if (!imagen) return sin;
      // Los rótulos de firma suelen estar en la capa de texto digital aunque lo diligenciado se haya leído por OCR (acta híbrida):
      // se prefieren esas cajas, que son exactas, y solo si no localizan nada se recurre al OCR.
      let cajas: CajaTexto[] = mime === 'application/pdf' ? await this.geometria.cajasTextoNativo(contenido, elegida.pagina, limites) : [];
      let zonas = localizarZonasFirma(cajas);
      if (!zonas.empresa && !zonas.practicante) {
        cajas = await this.geometria.cajasOcr(imagen, limites);
        zonas = localizarZonasFirma(cajas);
      }
      const medir = (zona: RectRelativo | null) =>
        zona ? this.geometria!.medirZonaFirma(imagen, zona, zonas.exclusiones, limites) : Promise.resolve(null);
      const [empresa, practicante] = [await medir(zonas.empresa), await medir(zonas.practicante)];
      return {
        mediciones: { empresa, practicante },
        ubicacion: { pagina: elegida.pagina, empresaLocalizada: zonas.empresa !== null, practicanteLocalizada: zonas.practicante !== null },
      };
    } catch (error) {
      estado.errores.push(error instanceof LimiteLecturaLocalError ? 'firmas_limite_excedido' : 'firmas_medicion_fallida');
      return sin;
    }
  }
}

/** Con esta confianza media del OCR una pasada más no cambia el resultado: no se insiste. */
const CONFIANZA_OCR_SUFICIENTE = 85;

interface Estado {
  paginas: Map<number, PaginaLeida>;
  confianzas: number[];
  intentosOcr: number;
  paginasOcr: number[];
  limitesAplicados: string[];
  errores: string[];
  total: number;
  textoNativo: ResumenLecturaActa['textoNativo'];
  imagenUnica: Buffer | null;
}
