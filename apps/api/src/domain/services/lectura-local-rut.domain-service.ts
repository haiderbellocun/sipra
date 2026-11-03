import { AutenticidadDocumento, MetodoLecturaEmpresarial } from '../entities/documento-empresarial';
import type { ResumenLecturaEmpresarial } from '../entities/validacion-documento-empresarial.entity';
import { CajaTexto, GeometriaDocumentoPort } from '../ports/out/geometria-documento.port';
import { LectorDocumentoLocalPort, LimitesLecturaLocal, PaginaRenderizada } from '../ports/out/lector-documento-local.port';
import { registrarSenalesAutenticidad } from './autenticidad-documento-empresarial.domain-service';
import { calcularSha256 } from './duplicados-documento-empresarial.domain-service';
import { FuenteCajas } from './geometria-rut.domain-service';
import { InterpretacionRut, PaginaCajas, interpretarRut } from './interpretacion-rut.domain-service';
import { clasificarContenidoQr, evaluarTextoNativo } from './lectura-local.domain-service';

/**
 * Lectura LOCAL del RUT (PDF o imagen): texto nativo con posiciones (pdf.js), OCR de las páginas sin texto
 * (Tesseract), QR (ZXing) y SHA-256. Todo dentro del proceso: el documento no sale a ningún servicio, y tampoco
 * OpenAI ni Anthropic. Orquesta los puertos y deja la interpretación a `interpretarRut`.
 *
 * Un QR se CLASIFICA, no se abre: no hay peticiones de red ni verificación de autenticidad aquí.
 */

/** Cotas de un RUT (1 a 4 páginas): el formulario ocupa la primera. Una página A4 a 2× tiene ~2 Mpx. */
export const LIMITES_LECTURA_RUT: LimitesLecturaLocal = {
  maxPaginas: 4,
  maxPaginasDocumento: 12,
  maxPixeles: 6_000_000,
  escalaRender: 2,
  timeoutMs: 60_000,
};

/** Las páginas que van a OCR se rasterizan a 3× (216 dpi): a 2× el OCR del formulario perdía etiquetas y dígitos. */
export const ESCALA_RENDER_OCR_RUT = 3;

/** El OCR solo se aplica a estas primeras páginas: el formulario y su pie están en la primera. */
const MAX_PAGINAS_OCR = 2;

export interface LecturaLocalRut {
  hashSha256: string;
  interpretacion: InterpretacionRut;
  metodo: MetodoLecturaEmpresarial;
  autenticidad: AutenticidadDocumento;
  resumen: ResumenLecturaEmpresarial;
}

export class LecturaLocalRutService {
  constructor(
    private readonly lector: LectorDocumentoLocalPort,
    private readonly geometria: GeometriaDocumentoPort,
  ) {}

  async leer(contenido: Buffer, mime: string, limites: LimitesLecturaLocal = LIMITES_LECTURA_RUT): Promise<LecturaLocalRut> {
    const hashSha256 = calcularSha256(contenido);
    const paginas: { cajas: CajaTexto[]; fuente: FuenteCajas }[] = [];
    const qr: { tipo: 'url' | 'texto' | 'otro'; host: string | null }[] = [];
    const limitesAplicados: string[] = [];
    const confsOcr: number[] = [];
    let paginasOcr = 0;
    let totalPaginas = 1;

    const leerQr = async (render: PaginaRenderizada, pagina: number | null): Promise<void> => {
      for (const h of await this.lector.detectarQr(render.imagen, pagina)) {
        const c = clasificarContenidoQr(h.contenido);
        qr.push({ tipo: c.tipo, host: c.host });
      }
    };
    const ocrDePagina = async (render: PaginaRenderizada, lim: LimitesLecturaLocal = limites): Promise<CajaTexto[]> => {
      const cajas = await this.geometria.cajasOcr(render.imagen, lim);
      paginasOcr += 1;
      confsOcr.push(...cajas.map((c) => c.confianza));
      return cajas;
    };

    if (mime === 'application/pdf') {
      const nativo = await this.lector.extraerTextoNativo(contenido, limites);
      totalPaginas = nativo.paginas;
      if (nativo.paginas > limites.maxPaginas) limitesAplicados.push('paginas_omitidas');
      const metricas = evaluarTextoNativo(nativo.paginas, nativo.porPagina);
      const conTexto = new Set(nativo.porPagina.map((p) => p.pagina).filter((p) => !metricas.paginasSinTexto.includes(p)));
      for (let p = 1; p <= Math.min(nativo.paginas, limites.maxPaginas); p += 1) {
        let cajas: CajaTexto[] = [];
        let fuente: FuenteCajas = 'texto';
        if (conTexto.has(p)) cajas = await this.geometria.cajasTextoNativo(contenido, p, limites);
        const iraAOcr = cajas.length === 0 && p <= MAX_PAGINAS_OCR;
        const limitesPagina = iraAOcr ? { ...limites, escalaRender: ESCALA_RENDER_OCR_RUT } : limites;
        const render = await this.lector.renderizarPagina(contenido, p, limitesPagina);
        await leerQr(render, p);
        if (iraAOcr) { cajas = await ocrDePagina(render, limitesPagina); fuente = 'ocr'; }
        paginas.push({ cajas, fuente });
      }
    } else {
      const render = await this.lector.prepararImagen(contenido, mime, limites);
      await leerQr(render, null);
      paginas.push({ cajas: await ocrDePagina(render), fuente: 'ocr' });
    }

    const fuentePrincipal: FuenteCajas = paginas[0]?.fuente ?? 'ocr';
    const todasNativas = paginas.every((p) => p.fuente === 'texto');
    const todasOcr = paginas.every((p) => p.fuente === 'ocr');
    const metodo: MetodoLecturaEmpresarial = todasNativas ? 'texto' : todasOcr ? 'ocr' : 'hibrido';
    const interpretacion = interpretarRut(paginas.map((p): PaginaCajas => ({ cajas: p.cajas })), fuentePrincipal);

    // Con OCR, «sin QR decodificado» no es «sin QR»: no se afirma ausencia (qrPresente queda sin determinar).
    const autenticidad = registrarSenalesAutenticidad({ qr: qr.length === 0 && fuentePrincipal === 'ocr' ? null : qr });

    return {
      hashSha256, interpretacion, metodo, autenticidad,
      resumen: {
        metodo, paginas: totalPaginas, paginasOcr,
        confianzaOcrMedia: confsOcr.length ? Math.round(confsOcr.reduce((a, b) => a + b, 0) / confsOcr.length) / 100 : null,
        lecturaDudosa: interpretacion.lecturaDudosa, limitesAplicados,
      },
    };
  }
}
