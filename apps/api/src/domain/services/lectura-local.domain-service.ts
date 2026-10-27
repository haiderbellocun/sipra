import { createHash } from 'node:crypto';
import { LimitesLecturaLocal, TextoNativoPagina } from '../ports/out/lector-documento-local.port';

/**
 * Reglas determinísticas de la lectura local: cuándo el texto nativo basta, qué
 * es un contenido de QR y cómo se guarda sin riesgo. Sin librerías, sin red.
 */

/** Cotas conservadoras para un certificado de EPS (suele ser de una o dos páginas). */
export const LIMITES_LECTURA_EPS: LimitesLecturaLocal = {
  maxPaginas: 3,
  maxPaginasDocumento: 10,
  // ~4 Mpx: una página A4 a 2× (144 dpi) tiene ~2 Mpx.
  maxPixeles: 4_000_000,
  escalaRender: 2,
  timeoutMs: 30_000,
};

// ── Texto nativo ────────────────────────────────────────────────────────────

/** Caracteres con contenido (sin espacios) para considerar utilizable una página. */
export const MIN_CARACTERES_PAGINA_UTILIZABLE = 40;
/** Proporción mínima de letras, dígitos y puntuación común: por debajo, el texto es basura de codificación. */
export const MIN_PROPORCION_LEGIBLE = 0.6;

export interface MetricasTextoNativo {
  paginas: number;
  paginasLeidas: number;
  paginasConTexto: number;
  caracteres: number;
  /** El documento tiene texto suficiente y legible para extraer campos sin OCR. */
  utilizable: boolean;
  /** Páginas leídas sin texto utilizable (candidatas a OCR si hace falta). */
  paginasSinTexto: number[];
}

function proporcionLegible(texto: string): number {
  const visibles = texto.replace(/\s+/g, '');
  if (visibles.length === 0) return 0;
  const buenos = visibles.match(/[\p{L}\p{N}.,:;/()\-–_@#%&+°ªº$'"¿?¡!]/gu)?.length ?? 0;
  return buenos / visibles.length;
}

export function evaluarTextoNativo(paginas: number, porPagina: readonly TextoNativoPagina[]): MetricasTextoNativo {
  const utilizablePorPagina = porPagina.map((p) => {
    const visibles = p.texto.replace(/\s+/g, '').length;
    return { pagina: p.pagina, visibles, ok: visibles >= MIN_CARACTERES_PAGINA_UTILIZABLE && proporcionLegible(p.texto) >= MIN_PROPORCION_LEGIBLE };
  });
  const caracteres = utilizablePorPagina.reduce((s, p) => s + (p.ok ? p.visibles : 0), 0);
  const paginasConTexto = utilizablePorPagina.filter((p) => p.ok).length;
  return {
    paginas,
    paginasLeidas: porPagina.length,
    paginasConTexto,
    caracteres,
    utilizable: paginasConTexto > 0,
    paginasSinTexto: utilizablePorPagina.filter((p) => !p.ok).map((p) => p.pagina),
  };
}

/**
 * ¿Hace falta OCR? Solo como recurso: el texto nativo va primero.
 *  · sin texto utilizable en el documento → OCR de las páginas leídas;
 *  · con texto utilizable → OCR únicamente si faltan campos clave. Entonces se leen las páginas sin
 *    texto (podrían ser imágenes con el dato faltante) y también las páginas CON texto: una capa de
 *    texto dañada, desordenada o superpuesta puede no dar los datos que la persona sí ve en la página.
 *    Es lectura local (Tesseract); si el texto digital alcanza, no se paga OCR.
 */
export function paginasParaOcr(
  metricas: MetricasTextoNativo, faltanCamposClave: boolean, paginasLeidas: readonly number[] = [],
): number[] {
  if (!metricas.utilizable) return metricas.paginasSinTexto;
  if (!faltanCamposClave) return [];
  return [...new Set([...metricas.paginasSinTexto, ...paginasLeidas])].sort((a, b) => a - b);
}

// ── Contenido de QR ─────────────────────────────────────────────────────────

/** Un QR más largo que esto no se conserva (ni siquiera sanitizado). */
export const MAX_LONGITUD_CONTENIDO_QR = 2048;

export type TipoContenidoQr = 'url' | 'texto' | 'otro';

export interface ContenidoQrClasificado {
  tipo: TipoContenidoQr;
  longitud: number;
  /** SHA-256 del contenido completo: permite comparar sin guardarlo. */
  hash: string;
  /** Solo para `url`: protocolo, host y ruta, SIN usuario, parámetros ni fragmento. */
  origenSanitizado: string | null;
  host: string | null;
  tieneParametros: boolean;
  /** Señales sintácticas (no un juicio de confianza): el dominio no se consulta en ningún sitio. */
  senales: string[];
}

const ESQUEMAS_URL = ['http:', 'https:'];

/**
 * Clasifica el contenido de un QR SIN seguirlo: no abre la dirección, no
 * resuelve redirecciones, no consulta el dominio. Es dato no confiable.
 */
export function clasificarContenidoQr(contenido: string): ContenidoQrClasificado {
  const hash = createHash('sha256').update(contenido, 'utf8').digest('hex');
  const base: ContenidoQrClasificado = {
    tipo: 'otro', longitud: contenido.length, hash, origenSanitizado: null, host: null, tieneParametros: false, senales: [],
  };
  if (contenido.length === 0) return base;
  if (contenido.length > MAX_LONGITUD_CONTENIDO_QR) return { ...base, senales: ['longitud_excesiva'] };

  const recortado = contenido.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(recortado)) {
    let url: URL | null = null;
    try { url = new URL(recortado); } catch { url = null; }
    if (url && ESQUEMAS_URL.includes(url.protocol)) {
      const senales: string[] = [];
      if (url.protocol === 'http:') senales.push('esquema_no_https');
      if (url.username || url.password) senales.push('credenciales_en_url');
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith('[')) senales.push('host_ip');
      if (url.hostname.split('.').some((p) => p.startsWith('xn--'))) senales.push('punycode');
      if (url.port) senales.push('puerto_explicito');
      const ruta = url.pathname.length > 120 ? `${url.pathname.slice(0, 120)}…` : url.pathname;
      return {
        ...base,
        tipo: 'url',
        host: url.hostname.toLowerCase(),
        tieneParametros: url.search.length > 0 || url.hash.length > 0,
        // Sin usuario, parámetros ni fragmento: pueden llevar tokens o identificadores.
        origenSanitizado: `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${ruta === '/' ? '' : ruta}`.replace(/[?#]/g, ''),
        senales,
      };
    }
    // `javascript:`, `data:`, `file:`, `intent:`…: no se conserva nada.
    return { ...base, senales: ['esquema_no_web'] };
  }
  // Texto imprimible: se clasifica pero no se conserva (puede traer datos personales).
  const imprimible = ![...recortado].some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n <= 0x08 || (n >= 0x0e && n <= 0x1f) || n === 0x7f;
  });
  return { ...base, tipo: imprimible ? 'texto' : 'otro', senales: imprimible ? [] : ['caracteres_de_control'] };
}
