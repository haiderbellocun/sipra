import { LectorDocumentoLocalPort } from '../src/domain/ports/out/lector-documento-local.port';
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { evaluarTextoNativo, paginasParaOcr } from '../src/domain/services/lectura-local.domain-service';
import { normalizarDocumento } from '../src/domain/services/normalizacion-identidad';

/**
 * OCR de respaldo: si el PDF trae capa de texto pero de ella no salen los datos clave (texto superpuesto, desordenado o con la
 * codificación dañada), se lee también lo que la persona VE en la página. Es lectura local; si el texto digital alcanza, no hay OCR.
 */

const BASURA = 'EST ESTE DOC DOCUMENTO NO ES VALIDO PARA LA PRESTACION DEL SERVICIO ACION OCUM UMENTO ES VAL VALIDO '.repeat(3);
const OCR_BUENO = [
  'EPS SURA', 'CERTIFICADO DE AFILIACION AL PBS DE EPS SURA', 'Que MARIA FERNANDA PRUEBA SINTETICA identificado(a) con',
  'CEDULA DE CIUDADANIA número 52123456', 'Fecha de generación: 15/10/2026', 'ESTADO DE LA AFILIACION', 'ACTIVO',
].join('\n');

function lectorFalso(nativo: string, ocr: string) {
  const llamadas = { ocr: 0 };
  const lector: LectorDocumentoLocalPort = {
    extraerTextoNativo: async () => ({ paginas: 1, porPagina: [{ pagina: 1, texto: nativo }] }),
    renderizarPagina: async () => ({ pagina: 1, ancho: 10, alto: 10, imagen: Buffer.from('x') }),
    prepararImagen: async () => ({ pagina: null, ancho: 10, alto: 10, imagen: Buffer.from('x') }) as never,
    detectarQr: async () => [],
    ejecutarOcr: async () => { llamadas.ocr += 1; return { texto: ocr, confianza: 90, giro: 0 } as never; },
  };
  return { lector, llamadas };
}

describe('Política de OCR de respaldo', () => {
  const m = evaluarTextoNativo(1, [{ pagina: 1, texto: BASURA }]);

  it('con texto utilizable y campos clave completos: sin OCR', () => {
    expect(m.utilizable).toBe(true);
    expect(paginasParaOcr(m, false, [1])).toEqual([]);
  });

  it('con texto utilizable pero sin campos clave: OCR también de las páginas CON texto', () => {
    expect(paginasParaOcr(m, true, [1])).toEqual([1]);
  });

  it('sin indicar las páginas leídas, sigue siendo el comportamiento anterior (solo páginas sin texto)', () => {
    expect(paginasParaOcr(m, true)).toEqual([]);
  });
});

describe('Lectura con capa de texto inservible', () => {
  it('si el texto digital no da los datos clave, usa el OCR de la página y lo marca como OCR', async () => {
    const { lector, llamadas } = lectorFalso(BASURA, OCR_BUENO);
    const r = await new LecturaLocalEpsService(lector).leer(Buffer.from('%PDF'), 'application/pdf');
    expect(llamadas.ocr).toBe(1);
    expect(r.resumen.ocr.ejecutado).toBe(true);
    expect(r.campos.nombre_afiliado).toMatchObject({ valor: 'MARIA FERNANDA PRUEBA SINTETICA', fuente: 'ocr' });
    expect(r.campos.documento_afiliado.valor).toMatch(/52123456/);
    expect(r.campos.fecha_expedicion).toMatchObject({ valor: '15/10/2026', fuente: 'ocr' });
    // El OCR nunca iguala a la confianza del texto digital.
    expect(r.campos.nombre_afiliado.confianza).toBeLessThanOrEqual(0.85);
  });

  it('si el texto digital ya trae los datos clave, NO se hace OCR', async () => {
    const completo = [
      'Entidad Promotora de Salud EPS SINTETICA S.A.', 'Nombre: MARIA FERNANDA PRUEBA SINTETICA', 'Documento: CC 52.123.456',
      'Fecha de expedición: 15/10/2026', 'Estado: ACTIVO',
    ].join('\n');
    const { lector, llamadas } = lectorFalso(completo, OCR_BUENO);
    const r = await new LecturaLocalEpsService(lector).leer(Buffer.from('%PDF'), 'application/pdf');
    expect(llamadas.ocr).toBe(0);
    expect(r.resumen.ocr.ejecutado).toBe(false);
  });
});

describe('Documento escrito con «número» (lectura por OCR)', () => {
  it('«CÉDULA DE CIUDADANÍA número 52123456» se normaliza a CC + el número', () => {
    expect(normalizarDocumento('CÉDULA DE CIUDADANÍA número 52123456')).toEqual({ tipo: 'CC', numero: '52123456' });
    expect(normalizarDocumento('REGISTRO CIVIL número 1099887766')).toEqual({ tipo: 'RC', numero: '1099887766' });
    expect(normalizarDocumento('CC No. 52.123.456')).toEqual({ tipo: 'CC', numero: '52123456' });
    expect(normalizarDocumento('C.C. N° 52123456')).toEqual({ tipo: 'CC', numero: '52123456' });
  });
});
