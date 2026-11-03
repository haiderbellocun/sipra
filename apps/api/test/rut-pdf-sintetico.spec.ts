import { ClasificacionDocumentoEmpresarial as C } from '../src/domain/entities/documento-empresarial';
import { LIMITES_LECTURA_RUT, LecturaLocalRutService } from '../src/domain/services/lectura-local-rut.domain-service';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { pdfEscaneado } from './soporte-lectura-local';
import { pdfRutSintetico } from './soporte-rut-pdf';

/**
 * El lector REAL (pdf.js, ZXing y Tesseract en el proceso) sobre PDF sintéticos: la geometría se mide sobre texto
 * digital de verdad, no sobre cajas armadas a mano. Los valores son inventados.
 */
jest.setTimeout(180_000);

describe('RUT sintético · lector local real', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalRutService(lector, lector);
  afterAll(async () => { await lector.onModuleDestroy(); });

  const URL_DIAN = 'https://muisca.dian.gov.co/WebRutMuisca/DefConsultaEstadoRUT.faces?codigo=ABC';

  it('PDF digital de persona natural: lee todos los campos y decodifica el QR hacia la DIAN (sin abrirlo)', async () => {
    const l = await servicio.leer(await pdfRutSintetico({ persona: 'natural', qr: URL_DIAN, dep: '11', mun: '001' }), 'application/pdf');
    expect(l.metodo).toBe('texto');
    expect(l.interpretacion.clasificacion.clasificacion).toBe(C.RUT_PERSONA_NATURAL);
    expect(l.interpretacion.datos).toMatchObject({
      nit: '1000000001', dv: String(Nit.calcularDigitoVerificacion('1000000001')), numeroDocumento: '1000000001', tipoDocumento: 'CC',
      nombres: 'MARIA FERNANDA', apellidos: 'PEREZ GOMEZ', ciiuPrincipal: '4711', divipolaMunicipio: '11001', fechaGeneracion: '2024-03-15', controlNit: 'confiable',
    });
    expect(l.interpretacion.lecturaDudosa).toBe(false);
    expect(l.autenticidad).toMatchObject({ estado: 'no_verificable', qrPresente: true, qrDecodificado: true, qrDestinoOficial: true });
    expect(JSON.stringify(l)).not.toContain('codigo=ABC');
  });

  it('PDF digital de persona jurídica: razón social, NIT validado y sin datos de persona natural', async () => {
    const l = await servicio.leer(await pdfRutSintetico({ persona: 'juridica', ciiu: '6201', razonSocial: 'DEMO TECNOLOGIA S.A.S.' }), 'application/pdf');
    expect(l.interpretacion.clasificacion.clasificacion).toBe(C.RUT_PERSONA_JURIDICA);
    expect(l.interpretacion.datos).toMatchObject({ nit: '900123456', razonSocial: 'DEMO TECNOLOGIA S.A.S.', ciiuPrincipal: '6201', controlNit: 'confiable' });
    expect(l.interpretacion.datos).not.toHaveProperty('nombres');
    expect(l.autenticidad.qrDecodificado).toBe(false);
  });

  it('DV incorrecto en un PDF digital: no es confiable, la lectura es dudosa y el NIT no se corrige', async () => {
    const malo = String((Nit.calcularDigitoVerificacion('900123456') + 1) % 10);
    const l = await servicio.leer(await pdfRutSintetico({ persona: 'juridica', dv: malo }), 'application/pdf');
    expect(l.interpretacion.datos).toMatchObject({ nit: '900123456', dv: malo, controlNit: 'dv_no_coincide' });
    expect(l.interpretacion.lecturaDudosa).toBe(true);
  });

  it('un RUT escaneado (imagen dentro de un PDF) pasa por OCR: nunca produce un NIT incorrecto ni valores falsos; si no alcanza, queda no determinable', async () => {
    const digital = await pdfRutSintetico({ persona: 'natural', qr: URL_DIAN });
    const png = await lector.renderizarPagina(digital, 1, { ...LIMITES_LECTURA_RUT, escalaRender: 2 });
    const escaneado = await pdfEscaneado([png.imagen]);
    const l = await servicio.leer(escaneado, 'application/pdf');
    expect(l.metodo).toBe('ocr');
    expect(l.resumen.paginasOcr).toBeGreaterThan(0);
    const d = l.interpretacion.datos;
    // La lectura puede ser parcial, pero lo que SÍ entrega tiene que ser verdad.
    if (l.interpretacion.clasificacion.clasificacion === C.RUT_PERSONA_NATURAL) {
      expect([null, '1000000001']).toContain(d?.nit ?? null);
      expect([null, '1000000001']).toContain(d?.numeroDocumento ?? null);
      expect([null, 'MARIA FERNANDA']).toContain(d?.nombres ?? null);
      expect([null, 'PEREZ GOMEZ']).toContain(d?.apellidos ?? null);
      expect([null, '4711']).toContain(d?.ciiuPrincipal ?? null);
      expect([null, '25290']).toContain(d?.divipolaMunicipio ?? null);
      expect([null, '2024-03-15']).toContain(d?.fechaGeneracion ?? null);
      if (d?.nit) expect(d.controlNit).toBe('confiable');
    } else {
      expect(l.interpretacion.clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
      expect(d).toBeNull();
    }
    // En un escaneado, no ver el QR no es probar que no existe.
    if (!l.autenticidad.qrDecodificado) expect(l.autenticidad.qrPresente).toBeNull();
  });

  it('OCR de baja calidad (imagen reducida y ruidosa): sin un NIT validado por el DV no hay NIT, y la lectura se marca dudosa', async () => {
    const digital = await pdfRutSintetico({ persona: 'juridica' });
    // Resolución mínima: el OCR lee peor; lo importante es que no invente.
    const png = await lector.renderizarPagina(digital, 1, { ...LIMITES_LECTURA_RUT, escalaRender: 0.9 });
    const l = await servicio.leer(await pdfEscaneado([png.imagen]), 'application/pdf');
    const d = l.interpretacion.datos;
    if (d?.nit) expect(d.nit).toBe('900123456');
    if (d?.razonSocial) expect(d.razonSocial).toBe('ACME DEMOSTRACION S.A.S.');
    if (d && d.nit === null) expect(d.controlNit).toBe('descartado_ocr');
    expect(l.interpretacion.lecturaDudosa || l.interpretacion.datos === null).toBe(true);
  });
});
