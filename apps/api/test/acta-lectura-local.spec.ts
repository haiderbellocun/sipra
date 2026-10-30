import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { LecturaLocalActaService, LecturaActaLocal } from '../src/domain/services/lectura-local-acta.domain-service';
import { OpcionesPdfActa, imagenesActaEscaneada, pdfActaDigital, pdfActaEscaneada, pdfDeLineas, pdfVacio } from './soporte-acta-pdf';
import { TEXTO_CEDULA, TEXTO_CERTIFICADO_EPS, sipraSintetico } from './soporte-acta';

/**
 * Integración de la lectura LOCAL del acta: archivo real (PDF/imagen generados en memoria) → lector local
 * (pdf.js, Tesseract, canvas) → `analizarActa`. Todo sintético: ningún documento ni dato personal real.
 */
describe('Acta de iniciación · lectura local de punta a punta', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalActaService(lector, lector);
  const leer = (pdf: Buffer, mime = 'application/pdf', sipra = null as ReturnType<typeof sipraSintetico> | null): Promise<LecturaActaLocal> =>
    servicio.leer(pdf, mime, sipra);

  afterAll(async () => { await lector.onModuleDestroy(); });

  describe('PDF con texto digital: no se usa OCR', () => {
    it.each<[string, OpcionesPdfActa, string, string]>([
      ['A · remunerada + empresa asume la ARL', { remuneracion: 'remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa', codigo: 'DPE-FO03' }, 'remunerada', 'empresa'],
      ['B · no remunerada + CUN asume la ARL', { remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion', codigo: 'DPE-FO02' }, 'no_remunerada', 'cun'],
      ['C · no remunerada + empresa asume la ARL', { remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa', codigo: 'DPE-FO03' }, 'no_remunerada', 'empresa'],
    ])('%s', async (_n, opciones, remuneracion, arl) => {
      const r = await leer(await pdfActaDigital(opciones));
      expect(r.ilegible).toBe(false);
      expect(r.resumen.metodoLectura).toBe('texto');
      expect(r.resumen.intentosOcr).toBe(0);
      expect(r.resumen.paginasOcr).toEqual([]);
      expect(r.analisis.clasificacion).toMatchObject({
        tipoActaDetectada: 'iniciacion_practicas', remuneracion, responsableArl: arl, confianzaResponsableArl: 'alta',
      });
      expect(r.analisis.campos.codigo_formato.valor).toBe(opciones.codigo);
      expect(r.resumen.suficiencia).toMatchObject({ paraClasificar: true, paraComparar: true });
    }, 60_000);

    it('extrae los datos escritos y, con los de SIPRA, los compara', async () => {
      const r = await leer(await pdfActaDigital({}), 'application/pdf', sipraSintetico());
      const c = r.analisis.campos;
      expect(c.nombre_estudiante.valor).toBe('Ana Maria Prueba Sintetica');
      expect(c.nit.valor).toBe('900.123.456-8');
      expect(c.fecha_inicio.valor).toBe('17/03/2026');
      expect(c.fecha_inicio.fuente).toBe('texto_nativo');
      expect(r.analisis.comparacion?.campos.filter((f) => f.criticidad === 'critica').every((f) => f.resultado === 'coincide')).toBe(true);
    }, 60_000);

    it('no devuelve el texto del documento en el resultado', async () => {
      const r = await leer(await pdfActaDigital({}));
      expect(JSON.stringify(r)).not.toContain('OBLIGACIONES DE LA EMPRESA');
      expect(JSON.stringify(r)).not.toContain('Afiliar el estudiante');
    }, 60_000);
  });

  describe('PDF escaneado (sin capa de texto): OCR local', () => {
    it('D · acta escaneada → OCR, mismo resultado de dominio', async () => {
      const r = await leer(await pdfActaEscaneada({ remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion' }));
      expect(r.resumen.metodoLectura).toBe('ocr');
      expect(r.resumen.paginasOcr.length).toBeGreaterThan(0);
      expect(r.resumen.confianzaOcrMedia).not.toBeNull();
      expect(r.analisis.clasificacion).toMatchObject({ tipoActaDetectada: 'iniciacion_practicas', remuneracion: 'no_remunerada', responsableArl: 'cun' });
      expect(r.analisis.campos.nombre_estudiante.fuente).toBe('ocr');
      expect(r.analisis.campos.nombre_estudiante.confianza).toBeLessThanOrEqual(0.85);
    }, 180_000);

    it('E · acta escaneada con OCR degradado: baja la confianza y NUNCA afirma lo contrario de lo que dice el documento', async () => {
      const limpia = await leer(await pdfActaEscaneada({ remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion' }));
      const r = await leer(await pdfActaEscaneada({ remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion', degradar: true }));
      expect(r.resumen.metodoLectura).toBe('ocr');
      expect(r.analisis.clasificacion.tipoActaDetectada).not.toBe('documento_incorrecto');
      // Lo que diga debe ser cierto (o «no determinable»): jamás la ARL contraria.
      expect(['cun', 'no_determinable']).toContain(r.analisis.clasificacion.responsableArl);
      expect(['no_remunerada', 'no_determinable']).toContain(r.analisis.clasificacion.remuneracion);
      expect(r.resumen.confianzaOcrMedia).not.toBeNull();
      expect(r.resumen.confianzaOcrMedia as number).toBeLessThan(limpia.resumen.confianzaOcrMedia as number);
      expect(r.analisis.campos.nombre_estudiante.confianza).toBeLessThanOrEqual(limpia.analisis.campos.nombre_estudiante.confianza);
    }, 240_000);

    it('una imagen suelta (foto del acta) también se lee por OCR', async () => {
      const [pagina] = imagenesActaEscaneada({ paginas: 'segunda', remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa' });
      const r = await leer(pagina, 'image/png');
      expect(r.resumen.metodoLectura).toBe('ocr');
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(r.analisis.clasificacion.responsableArl).toBe('empresa');
    }, 120_000);
  });

  describe('lo que no es un acta o no se puede leer', () => {
    it('F · PDF vacío → no_determinable por texto insuficiente (no «documento incorrecto»)', async () => {
      const r = await leer(await pdfVacio(1));
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('no_determinable');
      expect(r.analisis.clasificacion.motivos).toEqual(['texto_insuficiente']);
      expect(r.resumen.suficiencia).toMatchObject({ paraClasificar: false, paraComparar: false });
      expect(r.analisis.firmas.firmaEmpresaPresente).toBe('no_determinable');
    }, 120_000);

    it('G · documento diferente (cédula, certificado de EPS) → documento incorrecto, sin OCR', async () => {
      for (const [texto, ajeno] of [[TEXTO_CEDULA, 'cedula'], [TEXTO_CERTIFICADO_EPS, 'certificado_eps']] as const) {
        const r = await leer(await pdfDeLineas(texto.split('\n')));
        expect(r.analisis.clasificacion.tipoActaDetectada).toBe('documento_incorrecto');
        expect(r.analisis.clasificacion.documentoAjeno).toBe(ajeno);
        expect(r.resumen.intentosOcr).toBe(0);
      }
    }, 60_000);

    it('H · encabezado y obligaciones contradictorios → ARL no determinable + discrepancia crítica', async () => {
      const r = await leer(await pdfActaDigital({ encabezadoArl: 'cun', obligacionArl: 'empresa' }));
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(r.analisis.clasificacion.responsableArl).toBe('no_determinable');
      expect(r.analisis.clasificacion.discrepanciasDocumento[0]).toMatchObject({ codigo: 'ARL_ENCABEZADO_VS_OBLIGACIONES', severidad: 'critica' });
    }, 60_000);

    it('I · solo la página 1 (encabezado válido, sin obligaciones) → ARL por el encabezado, confianza media', async () => {
      const r = await leer(await pdfActaDigital({ paginas: 'primera', encabezadoArl: 'cun', obligacionArl: 'institucion' }));
      expect(r.analisis.clasificacion.responsableArl).toBe('cun');
      expect(r.analisis.clasificacion.confianzaResponsableArl).toBe('media');
      expect(r.analisis.clasificacion.senales.arlObligaciones).toBe('ninguna');
      expect(r.analisis.firmas.firmaEmpresaPresente).toBe('no_determinable');
    }, 60_000);

    it('J · solo la página 2 (obligaciones legibles, sin encabezado completo) → ARL por las obligaciones, confianza media', async () => {
      const r = await leer(await pdfActaDigital({ paginas: 'segunda', encabezadoArl: 'ninguna', obligacionArl: 'empresa' }));
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(r.analisis.clasificacion.responsableArl).toBe('empresa');
      expect(r.analisis.clasificacion.confianzaResponsableArl).toBe('media');
    }, 60_000);

    it('un archivo dañado → ilegible (se pide reenviar), no una clasificación', async () => {
      const r = await leer(Buffer.from('%PDF-1.4 esto no es un pdf valido'));
      expect(r.ilegible).toBe(true);
      expect(r.motivoIlegible).toBeTruthy();
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('no_determinable');
    }, 60_000);

    it('un tipo de archivo no soportado no se lee', async () => {
      const r = await leer(Buffer.from('hola'), 'text/plain');
      expect(r.resumen.errores).toContain('tipo_de_archivo_no_soportado');
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('no_determinable');
    });
  });

  describe('límites de seguridad', () => {
    it('un PDF con más páginas de las admitidas para su lectura se lee hasta el tope y lo avisa', async () => {
      const r = await servicio.leer(await pdfActaDigital({}), 'application/pdf', null, {
        maxPaginas: 1, maxPaginasDocumento: 10, maxPixeles: 4_000_000, escalaRender: 2, timeoutMs: 30_000,
      });
      expect(r.resumen.limitesAplicados).toContain('paginas_omitidas');
      expect(r.resumen.paginasLeidas).toBe(1);
    }, 60_000);

    it('un PDF que excede el máximo de páginas del documento no se abre: se informa el límite', async () => {
      const r = await servicio.leer(await pdfVacio(4), 'application/pdf', null, {
        maxPaginas: 1, maxPaginasDocumento: 2, maxPixeles: 4_000_000, escalaRender: 2, timeoutMs: 30_000,
      });
      expect(r.resumen.limitesAplicados).toContain('documento_excede_paginas');
      expect(r.analisis.clasificacion.tipoActaDetectada).toBe('no_determinable');
    }, 60_000);
  });
});
