import {
  AutenticidadDocumento, ClasificacionDocumentoEmpresarial as C, DatosCamaraExtraidos, MetodoLecturaEmpresarial,
} from '../entities/documento-empresarial';
import type { ResumenLecturaEmpresarial } from '../entities/validacion-documento-empresarial.entity';
import { CajaTexto, GeometriaDocumentoPort } from '../ports/out/geometria-documento.port';
import { LectorDocumentoLocalPort, LimitesLecturaLocal } from '../ports/out/lector-documento-local.port';
import { detectarFirmaPdfEstructural, registrarSenalesAutenticidad } from './autenticidad-documento-empresarial.domain-service';
import { calcularSha256 } from './duplicados-documento-empresarial.domain-service';
import { InterpretacionCamara, PaginaTextoCamara, interpretarCamara } from './interpretacion-camara.domain-service';
import { evaluarTextoNativo } from './lectura-local.domain-service';

/**
 * Lectura LOCAL de un certificado de Cámara de Comercio (PDF o imagen): texto nativo (pdf.js) primero; OCR (Tesseract) solo de las
 * páginas que hacen falta; presencia de firma PDF por estructura; SHA-256. Todo dentro del proceso: el documento no sale a ningún
 * servicio, no hay OpenAI ni Anthropic, no se abre ninguna URL de verificación y no se consulta el RUES.
 */

/**
 * Cotas de un certificado de Cámara: los hay de 3 a ~10 páginas y los datos de identificación están en la primera, pero la
 * tabla de representantes puede estar páginas más adelante. NO son los límites del EPS (1–2 páginas) ni los del RUT (formulario
 * en la primera): se lee el texto nativo de hasta 12 páginas (barato), y un PDF de más de 30 ni se abre.
 */
export const LIMITES_LECTURA_CAMARA: LimitesLecturaLocal = {
  maxPaginas: 12,
  maxPaginasDocumento: 30,
  maxPixeles: 6_000_000,
  escalaRender: 2,
  timeoutMs: 60_000,
};

/** Las páginas que van a OCR se rasterizan a 3× (216 dpi): a 2× el OCR perdía dígitos. */
export const ESCALA_RENDER_OCR_CAMARA = 3;

/**
 * Páginas que como máximo se someten a OCR (cada una cuesta segundos). Se leen en orden y se PARA en cuanto alcanza: los datos de
 * identificación están en la primera; solo la existencia y representación sigue buscando al representante.
 */
export const MAX_PAGINAS_OCR_CAMARA = 6;

export interface OpcionesLecturaCamara {
  /** Solo para evaluar el OCR sobre documentos digitales (regresión): ignora la capa de texto. Nunca lo activa el flujo de carga. */
  forzarOcr?: boolean;
}

export interface LecturaLocalCamara {
  hashSha256: string;
  interpretacion: InterpretacionCamara;
  metodo: MetodoLecturaEmpresarial;
  autenticidad: AutenticidadDocumento;
  /** Presencia estructural de una firma digital en el PDF (no su validez). `null` si el archivo no es PDF. */
  firmaPdfPresente: boolean | null;
  resumen: ResumenLecturaEmpresarial;
}

/** Palabras del OCR en orden de lectura: por líneas (de arriba abajo) y, dentro de la línea, de izquierda a derecha. */
export function palabrasEnOrdenDeLectura(cajas: readonly CajaTexto[]): { texto: string; confianza: number }[] {
  const validas = cajas.filter((c) => c.texto.trim() !== '');
  if (validas.length === 0) return [];
  const altos = validas.map((c) => c.alto).sort((a, b) => a - b);
  const tolerancia = Math.max(0.004, altos[Math.floor(altos.length / 2)] * 0.6);
  const porY = [...validas].sort((a, b) => a.y + a.alto / 2 - (b.y + b.alto / 2));
  const lineas: CajaTexto[][] = [];
  let centro = Number.NEGATIVE_INFINITY;
  for (const c of porY) {
    const cy = c.y + c.alto / 2;
    if (lineas.length === 0 || cy - centro > tolerancia) { lineas.push([c]); centro = cy; } else { lineas[lineas.length - 1].push(c); }
  }
  return lineas.flatMap((l) => l.sort((a, b) => a.x - b.x)).map((c) => ({ texto: c.texto.trim(), confianza: c.confianza }));
}

/** ¿Ya se tiene lo necesario para dejar de leer (y de pagar OCR)? */
function suficiente(i: InterpretacionCamara): boolean {
  const k = i.clasificacion.clasificacion;
  if (k === C.DOCUMENTO_INCORRECTO) return true; // ya se sabe que no es un certificado
  const d = i.datos;
  if (!d) return false;
  const identificacion = d.nombreORazonSocial !== null && d.nit !== null && d.dv !== null && d.matricula !== null && d.fechaExpedicion !== null;
  // La existencia y representación sigue buscando al representante; los demás certificados no lo necesitan.
  return identificacion && (k !== C.CAMARA_EXISTENCIA_REPRESENTACION || d.representanteLegal !== null);
}

export class LecturaLocalCamaraService {
  constructor(
    private readonly lector: LectorDocumentoLocalPort,
    private readonly geometria: GeometriaDocumentoPort,
  ) {}

  async leer(
    contenido: Buffer, mime: string, limites: LimitesLecturaLocal = LIMITES_LECTURA_CAMARA, opciones: OpcionesLecturaCamara = {},
  ): Promise<LecturaLocalCamara> {
    const hashSha256 = calcularSha256(contenido);
    const firmaPdfPresente = detectarFirmaPdfEstructural(contenido, mime);
    const paginas = new Map<number, PaginaTextoCamara>();
    const limitesAplicados: string[] = [];
    const confsOcr: number[] = [];
    let paginasOcr = 0;
    let totalPaginas = 1;
    const interpretar = (): InterpretacionCamara => interpretarCamara([...paginas.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p));

    const ocrDePagina = async (imagen: Buffer, lim: LimitesLecturaLocal): Promise<PaginaTextoCamara> => {
      const cajas = await this.geometria.cajasOcr(imagen, lim);
      paginasOcr += 1;
      confsOcr.push(...cajas.map((c) => c.confianza));
      const palabras = palabrasEnOrdenDeLectura(cajas);
      const media = cajas.length ? cajas.reduce((s, c) => s + c.confianza, 0) / cajas.length : null;
      return { texto: palabras.map((w) => w.texto).join(' '), fuente: 'ocr', confianzaOcr: media, palabras };
    };

    if (mime === 'application/pdf') {
      const nativo = await this.lector.extraerTextoNativo(contenido, limites);
      totalPaginas = nativo.paginas;
      if (nativo.paginas > limites.maxPaginas) limitesAplicados.push('paginas_omitidas');
      const sinTexto = new Set(evaluarTextoNativo(nativo.paginas, nativo.porPagina).paginasSinTexto);
      const leidas = Math.min(nativo.paginas, limites.maxPaginas);
      if (!opciones.forzarOcr) {
        for (const p of nativo.porPagina) if (!sinTexto.has(p.pagina)) paginas.set(p.pagina, { texto: p.texto, fuente: 'texto', confianzaOcr: null });
      }
      // OCR selectivo: primero el texto nativo; solo las páginas sin texto (o, en evaluación, todas), y solo mientras haga falta.
      const candidatas = opciones.forzarOcr
        ? Array.from({ length: leidas }, (_, i) => i + 1)
        : [...sinTexto].filter((p) => p <= leidas).sort((a, b) => a - b);
      let interpretacion = interpretar();
      for (const p of candidatas) {
        if (paginas.size > 0 && suficiente(interpretacion)) break;
        if (paginasOcr >= MAX_PAGINAS_OCR_CAMARA) { limitesAplicados.push('ocr_paginas_omitidas'); break; }
        const lim = { ...limites, escalaRender: ESCALA_RENDER_OCR_CAMARA };
        const render = await this.lector.renderizarPagina(contenido, p, lim);
        paginas.set(p, await ocrDePagina(render.imagen, lim));
        interpretacion = interpretar();
      }
    } else {
      const render = await this.lector.prepararImagen(contenido, mime, limites);
      paginas.set(1, await ocrDePagina(render.imagen, limites));
    }

    const interpretacion = interpretar();
    const usadas = [...paginas.values()];
    const hayOcr = usadas.some((p) => p.fuente === 'ocr');
    const hayTexto = usadas.some((p) => p.fuente === 'texto');
    const metodo: MetodoLecturaEmpresarial = hayOcr && hayTexto ? 'hibrido' : hayOcr ? 'ocr' : 'texto';

    const d = interpretacion.datos;
    // Presencia de las señales de verificación. Con OCR, «no se leyó» no es «no hay»: queda sin determinar.
    const sinOcr = !hayOcr;
    const autenticidad = registrarSenalesAutenticidad({
      firmaPdfPresente,
      codigoVerificacion: d === null ? undefined : interpretacion.senales.codigoVerificacion ? 'presente' : (sinOcr ? '' : undefined),
      urlVerificacion: d === null ? undefined : interpretacion.senales.urlVerificacion ? 'presente' : (sinOcr ? '' : undefined),
    });
    const datos = d === null ? null : { ...d, firmaPdfPresente };
    return {
      hashSha256, metodo, autenticidad, firmaPdfPresente,
      interpretacion: { ...interpretacion, datos },
      resumen: {
        metodo, paginas: totalPaginas, paginasOcr,
        confianzaOcrMedia: confsOcr.length ? Math.round(confsOcr.reduce((a, b) => a + b, 0) / confsOcr.length) / 100 : null,
        lecturaDudosa: interpretacion.lecturaDudosa, limitesAplicados,
      },
    };
  }
}

// ── Lo que se conserva de la lectura (en la extracción del documento) ───────────────────────

/**
 * Lectura minimizada de un certificado de Cámara, lista para guardarse en la extracción del documento y para que la validación la
 * registre SIN volver a leer el archivo. Solo datos minimizados, códigos y métricas: ni texto, ni OCR, ni imágenes, ni dirección,
 * correo, teléfono o documento del representante.
 */
export interface LecturaCamaraPersistible {
  hashSha256: string;
  tipoDetectado: C;
  motivosClasificacion: string[];
  metodo: MetodoLecturaEmpresarial;
  confianzaDocumento: number | null;
  lecturaDudosa: boolean;
  datos: DatosCamaraExtraidos | null;
  autenticidad: AutenticidadDocumento;
  resumen: ResumenLecturaEmpresarial;
  motivos: string[];
}

export function minimizarLecturaCamara(l: LecturaLocalCamara): LecturaCamaraPersistible {
  const i = l.interpretacion;
  return {
    hashSha256: l.hashSha256,
    tipoDetectado: i.clasificacion.clasificacion,
    motivosClasificacion: [...i.clasificacion.motivos],
    metodo: l.metodo,
    confianzaDocumento: i.confianzaDocumento,
    lecturaDudosa: i.lecturaDudosa,
    datos: i.datos ? { ...i.datos } : null,
    autenticidad: { ...l.autenticidad },
    resumen: { ...l.resumen, limitesAplicados: [...(l.resumen.limitesAplicados ?? [])] },
    motivos: [...i.motivos],
  };
}
