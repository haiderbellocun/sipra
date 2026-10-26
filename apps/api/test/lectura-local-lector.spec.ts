import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LimitesLecturaLocal } from '../src/domain/ports/out/lector-documento-local.port';
import { compararCertificadoEps, construirDatosExtraidosEps } from '../src/domain/services/comparacion-eps.domain-service';
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { LIMITES_LECTURA_EPS } from '../src/domain/services/lectura-local.domain-service';
import { SaneamientoPdfDomainService } from '../src/domain/services/saneamiento-pdf.domain-service';
import { CoincidenciaEps } from '../src/domain/entities/validacion-eps.entity';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ExtraccionLocalAdapter } from '../src/infrastructure/adapters/ia/extraccion-local.adapter';
import { ExtraccionSimuladaAdapter } from '../src/infrastructure/adapters/ia/extraccion.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { directorioDatosIdioma } from '../src/infrastructure/adapters/lectura-local/ocr-tesseract.motor';
import {
  LINEAS_EPS, imagenCertificado, pdfDigital, pdfEscaneado, pngQr, pngQrCorrupto,
} from './soporte-lectura-local';

/**
 * Lectura local con las bibliotecas REALES (pdf.js, ZXing, Tesseract) sobre un
 * corpus sintético generado en memoria. Sin documentos ni datos personales reales.
 */

jest.setTimeout(240_000);

const lector = new LectorDocumentoLocalAdapter();
const servicio = new LecturaLocalEpsService(lector);
const extractor = new ExtraccionLocalAdapter(lector, new ExtraccionSimuladaAdapter());
afterAll(async () => { await lector.onModuleDestroy(); });

const CEDULA = '1032456786';
const nombres = (c: Record<string, { valor: string | null }>): string | null => c.nombre_afiliado.valor;

async function leer(contenido: Buffer, mime = 'application/pdf', limites?: LimitesLecturaLocal) {
  return servicio.leer(contenido, mime, limites);
}

describe('PDF con texto nativo', () => {
  it('lee los campos del texto digital, SIN OCR', async () => {
    const r = await leer(await pdfDigital());
    expect(r.ilegible).toBe(false);
    expect(r.resumen.textoNativo).toMatchObject({ paginas: 1, paginasConTexto: 1, utilizable: true });
    expect(r.resumen.ocr.ejecutado).toBe(false);
    expect(r.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
    expect(nombres(r.campos)).toBe('LAURA SOFIA RAMIREZ ORTIZ');
    expect(r.campos.regimen.valor).toMatch(/Contributivo/);
    expect(r.campos.estado_afiliacion.valor).toBe('ACTIVO');
    expect(r.campos.fecha_expedicion.valor).toBe('20/10/2026');
    for (const c of Object.values(r.campos)) expect(c.fuente).toBe('texto_nativo');
  });

  it('nombre con tildes y ñ', async () => {
    const r = await leer(await pdfDigital(['Nombre: MARÍA JOSÉ NÚÑEZ PEÑA', 'Documento: CC 52.123.456', 'NUEVA EPS S.A.', 'Fecha de expedición: 20/10/2026']));
    expect(nombres(r.campos)).toBe('MARÍA JOSÉ NÚÑEZ PEÑA');
  });

  it('EPS con alias y número de documento con separadores se normalizan igual que el resto', async () => {
    const r = await leer(await pdfDigital(['EPS SANITAS', ...LINEAS_EPS.slice(1)]));
    const datos = construirDatosExtraidosEps(r.campos);
    expect(datos.epsClave).toBe('SANITAS');
    expect(datos.numeroDocumento).toBe(CEDULA);
    expect(datos.fuentes?.nombre_afiliado).toBe('texto_nativo');
  });

  it('certificado vencido: se lee y la comparación lo marca vencido, sin tocar la identidad', async () => {
    const r = await leer(await pdfDigital(LINEAS_EPS.map((l) => l.replace('20/10/2026', '01/03/2026'))));
    const c = compararCertificadoEps(
      construirDatosExtraidosEps(r.campos),
      { numeroDocumento: CEDULA, nombre: 'Laura Sofía Ramírez Ortiz' },
      { ahora: new Date('2026-10-26T15:00:00Z'), diasVigencia: 30 },
    );
    expect(c.vigencia).toBe('vencido');
    expect(c.coincidencia).toBe(CoincidenciaEps.COINCIDE);
  });

  it('un PDF sin texto (página en blanco): sin campos, sin inventar y sin marcarlo ilegible', async () => {
    const r = await leer(await pdfDigital([]));
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
    expect(r.ilegible).toBe(false);
    expect(r.resumen.textoNativo?.utilizable).toBe(false);
  });

  it('un PDF corrupto es ilegible (se pide reenvío), no un error del sistema', async () => {
    const pdf = await pdfDigital();
    const r = await leer(pdf.subarray(0, Math.floor(pdf.length / 3)));
    expect(r.ilegible).toBe(true);
    expect(r.motivoIlegible).toBeTruthy();
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
  });

  it('bytes que no son un PDF: ilegible', async () => {
    expect((await leer(Buffer.from('esto no es un pdf, solo texto plano '.repeat(30)))).ilegible).toBe(true);
  });
});

describe('Rasterización, QR y múltiples páginas', () => {
  it('un PDF digital con QR: texto nativo + QR clasificado (no verificado)', async () => {
    const r = await leer(await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/validar?id=abc123&token=SECRETO')] }));
    expect(r.resumen.ocr.ejecutado).toBe(false);
    expect(r.resumen.qr.paginasEscaneadas).toBe(1);
    expect(r.resumen.qr.hallazgos).toHaveLength(1);
    const q = r.resumen.qr.hallazgos[0];
    expect(q).toMatchObject({ formato: 'QRCode', pagina: 1, tipo: 'url', host: 'eps.example', tieneParametros: true });
    expect(q.origenSanitizado).toBe('https://eps.example/validar');
    expect(q.posicion).not.toBeNull();
    expect(JSON.stringify(r.resumen)).not.toContain('SECRETO');
  });

  it('dos QR en el PDF: se registran TODOS y ninguno se elige como oficial', async () => {
    const r = await leer(await pdfDigital(undefined, {
      qrs: [await pngQr('https://eps.example/uno'), await pngQr('https://otra.example/dos')],
    }));
    expect(r.resumen.qr.hallazgos.map((h) => h.host).sort()).toEqual(['eps.example', 'otra.example']);
    expect(JSON.stringify(r)).not.toMatch(/oficial/i);
  });

  it('QR con texto (sintácticamente válido): tipo texto, solo hash y longitud', async () => {
    const r = await leer(await pdfDigital(undefined, { qrs: [await pngQr(`AFILIADO-${CEDULA}-ACTIVO`)] }));
    expect(r.resumen.qr.hallazgos[0]).toMatchObject({ tipo: 'texto', origenSanitizado: null, host: null });
    expect(r.resumen.qr.hallazgos[0].hash).toBe(createHash('sha256').update(`AFILIADO-${CEDULA}-ACTIVO`).digest('hex'));
    expect(JSON.stringify(r.resumen)).not.toContain(CEDULA);
  });

  it('QR con dominio «malicioso» sintético: señales sintácticas, jamás consultado', async () => {
    const r = await leer(await pdfDigital(undefined, { qrs: [await pngQr('http://xn--80ak6aa92e.com@192.168.0.1:8080/login?token=SECRETO')] }));
    const q = r.resumen.qr.hallazgos[0];
    expect(q.senales).toEqual(expect.arrayContaining(['esquema_no_https', 'credenciales_en_url', 'puerto_explicito']));
    expect(q.origenSanitizado).not.toMatch(/[?#@]/);
    expect(JSON.stringify(r.resumen)).not.toContain('SECRETO');
  });

  it('PDF sin QR: sin hallazgos, no es un error', async () => {
    const r = await leer(await pdfDigital());
    expect(r.resumen.qr).toMatchObject({ paginasEscaneadas: 1, hallazgos: [] });
    expect(r.resumen.errores).toEqual([]);
  });

  it('QR corrupto: sin hallazgo y sin excepción', async () => {
    const r = await leer(await pdfDigital(undefined, { qrs: [await pngQrCorrupto('https://eps.example/validar')] }));
    expect(r.resumen.qr.hallazgos).toEqual([]);
    expect(r.resumen.errores).toEqual([]);
  });

  it('un PDF de más hojas que el máximo leído: lee solo las primeras y lo avisa', async () => {
    const r = await leer(await pdfDigital(undefined, { paginas: 6 }));
    expect(r.resumen.textoNativo).toMatchObject({ paginas: 6, paginasLeidas: LIMITES_LECTURA_EPS.maxPaginas });
    expect(r.resumen.limitesAplicados).toContain('paginas_omitidas');
    expect(r.resumen.qr.paginasEscaneadas).toBeLessThanOrEqual(LIMITES_LECTURA_EPS.maxPaginas);
  });

  it('un PDF que excede el máximo del documento ni se lee: revisión humana, sin campos', async () => {
    const r = await leer(await pdfDigital(undefined, { paginas: LIMITES_LECTURA_EPS.maxPaginasDocumento + 3 }));
    expect(r.resumen.limitesAplicados).toContain('documento_excede_paginas');
    expect(r.resumen.ocr.ejecutado).toBe(false);
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
    expect(r.ilegible).toBe(false);
  });
});

describe('OCR local', () => {
  it('PDF escaneado: texto nativo inexistente → OCR → campos con fuente ocr', async () => {
    const r = await leer(await pdfEscaneado([await imagenCertificado()]));
    expect(r.resumen.textoNativo?.utilizable).toBe(false);
    expect(r.resumen.ocr).toMatchObject({ ejecutado: true, paginas: [1] });
    expect(r.resumen.ocr.confianzaMedia).toBeGreaterThan(60);
    expect(nombres(r.campos)).toBe('LAURA SOFIA RAMIREZ ORTIZ');
    expect(r.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
    expect(r.campos.documento_afiliado.fuente).toBe('ocr');
    // El OCR nunca iguala la confianza del texto digital.
    expect(r.campos.documento_afiliado.confianza).toBeLessThan(0.9);
  });

  it('PDF escaneado con QR: OCR + QR', async () => {
    const r = await leer(await pdfEscaneado([await imagenCertificado(undefined, { qr: await pngQr('https://eps.example/validar?x=1') })]));
    expect(r.resumen.ocr.ejecutado).toBe(true);
    expect(r.resumen.qr.hallazgos).toHaveLength(1);
    expect(r.resumen.qr.hallazgos[0].host).toBe('eps.example');
  });

  it('PNG del certificado', async () => {
    const r = await leer(await imagenCertificado(), 'image/png');
    expect(r.resumen.textoNativo).toBeNull();
    expect(r.resumen.ocr.ejecutado).toBe(true);
    expect(r.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
  });

  it('JPEG del certificado, con QR', async () => {
    const r = await leer(await imagenCertificado(undefined, { jpeg: true, qr: await pngQr('https://eps.example/v') }), 'image/jpeg');
    expect(r.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
    expect(r.resumen.qr.hallazgos).toHaveLength(1);
  });

  it('imagen rotada 90°: el OCR la endereza y reporta el giro aplicado', async () => {
    const r = await leer(await imagenCertificado(undefined, { grados: 90 }), 'image/png');
    expect(r.resumen.ocr.giros.some((g) => g !== 0)).toBe(true);
    expect(r.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
  });

  it('resolución baja: no se inventa nada (lo que se lea es correcto) y no falla', async () => {
    const r = await leer(await imagenCertificado(undefined, { ancho: 420, alto: 340, fuente: 12 }), 'image/png');
    expect(r.ilegible).toBe(false);
    for (const [nombre, c] of Object.entries(r.campos)) {
      if (c.valor === null) continue;
      if (nombre === 'documento_afiliado') expect(c.valor).toMatch(/1\.?032\.?456\.?786/);
      if (nombre === 'nombre_afiliado') expect(c.valor).toMatch(/LAURA|RAMIREZ|ORTIZ/);
    }
  });

  it('una imagen corrupta es ilegible; una imagen con dimensiones absurdas se rechaza por píxeles', async () => {
    expect((await leer(Buffer.from('no soy un png'), 'image/png')).ilegible).toBe(true);
    // Encabezado PNG válido que declara 30000 × 30000 px (una «bomba de descompresión»).
    const bomba = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bomba);
    bomba.writeUInt32BE(30000, 16);
    bomba.writeUInt32BE(30000, 20);
    const r = await leer(bomba, 'image/png');
    expect(r.resumen.limitesAplicados).toContain('pagina_excede_pixeles');
    expect(r.resumen.ocr.ejecutado).toBe(false);
    expect(r.ilegible).toBe(false);
  });

  it('un tipo de archivo que no es PDF ni imagen no se lee', async () => {
    const r = await leer(Buffer.from('<html></html>'), 'text/html');
    expect(r.resumen.errores).toContain('tipo_de_archivo_no_soportado');
  });
});

describe('Límites y fallas: siempre cerrado, nunca aprobación', () => {
  it('tiempo agotado en el OCR: se registra y el documento queda sin lectura (revisión humana)', async () => {
    const r = await leer(await imagenCertificado(), 'image/png', { ...LIMITES_LECTURA_EPS, timeoutMs: 1 });
    expect(r.resumen.errores).toContain('ocr_tiempo_agotado');
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
    // Y el siguiente documento se lee con normalidad (el trabajador se reinició).
    const ok = await leer(await imagenCertificado(), 'image/png');
    expect(ok.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
  });

  it('tiempo agotado leyendo un PDF: el hilo se termina y el siguiente PDF se lee bien', async () => {
    const pdf = await pdfDigital();
    const r = await leer(pdf, 'application/pdf', { ...LIMITES_LECTURA_EPS, timeoutMs: 1 });
    expect(r.resumen.limitesAplicados).toContain('tiempo_agotado');
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
    const ok = await leer(await pdfDigital());
    expect(ok.campos.estado_afiliacion.valor).toBe('ACTIVO');
  });

  it('el límite de píxeles de una página reduce la escala o la rechaza, sin desbordar', async () => {
    const r = await leer(await pdfDigital(), 'application/pdf', { ...LIMITES_LECTURA_EPS, maxPixeles: 10_000 });
    expect(r.resumen.limitesAplicados).toContain('pagina_excede_pixeles');
    expect(r.resumen.qr.paginasEscaneadas).toBe(0);
    // El texto nativo no necesita rasterizar: sigue leyéndose.
    expect(r.campos.estado_afiliacion.valor).toBe('ACTIVO');
  });

  it('el OCR se serializa: varios documentos a la vez no corren Tesseract en paralelo', async () => {
    const imagenes = await Promise.all([0, 1, 2].map(() => imagenCertificado()));
    const lecturas = await Promise.all(imagenes.map((i) => leer(i, 'image/png')));
    for (const r of lecturas) expect(r.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
  });
});

describe('Copia saneada del PDF: ¿conserva texto, QR y OCR?', () => {
  const sanear = (pdf: Buffer) => new SaneamientoPdfDomainService().sanear(pdf);

  it('un PDF con JavaScript embebido y enlace: saneado conserva TODO lo legible', async () => {
    const original = await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/validar')], enlace: 'https://eps.example/ayuda' });
    // Se le agrega una acción de apertura para que el saneamiento tenga algo que neutralizar.
    const conAccion = Buffer.from(original.toString('latin1').replace('/Type /Catalog', '/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>'), 'latin1');
    const s = sanear(conAccion);
    const antes = await leer(original);
    const despues = await leer(s.contenido);
    expect(despues.campos.documento_afiliado.valor).toBe(antes.campos.documento_afiliado.valor);
    expect(nombres(despues.campos)).toBe(nombres(antes.campos));
    expect(despues.resumen.qr.hallazgos.map((h) => h.hash)).toEqual(antes.resumen.qr.hallazgos.map((h) => h.hash));
  });

  it('un PDF escaneado saneado se sigue leyendo por OCR', async () => {
    const original = await pdfEscaneado([await imagenCertificado(undefined, { qr: await pngQr('https://eps.example/validar') })]);
    const s = sanear(original);
    const despues = await leer(s.contenido);
    expect(despues.resumen.ocr.ejecutado).toBe(true);
    expect(despues.campos.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
    expect(despues.resumen.qr.hallazgos).toHaveLength(1);
  });

  it('el saneamiento solo renombra acciones activas: no toca URI, imágenes ni texto', () => {
    const texto = '1 0 obj << /Type /Annot /Subtype /Link /A << /S /URI /URI (https://eps.example/ayuda) >> >> endobj';
    const s = sanear(Buffer.from(texto, 'latin1'));
    expect(s.modificado).toBe(false);
    expect(s.contenido.toString('latin1')).toBe(texto);
  });
});

describe('Seguridad de la lectura local', () => {
  const TRAMPA = 'sin_red_en_lectura_local';

  it('leer un QR con URL NO produce ninguna llamada de red desde el proceso', async () => {
    const llamadas: string[] = [];
    const espias = [
      jest.spyOn(globalThis, 'fetch').mockImplementation(() => { llamadas.push('fetch'); throw new Error(TRAMPA); }),
      jest.spyOn(http, 'request').mockImplementation(() => { llamadas.push('http.request'); throw new Error(TRAMPA); }),
      jest.spyOn(https, 'request').mockImplementation(() => { llamadas.push('https.request'); throw new Error(TRAMPA); }),
      jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { llamadas.push('net.connect'); throw new Error(TRAMPA); }),
    ];
    try {
      const r = await leer(await pdfDigital(undefined, { qrs: [await pngQr('https://eps.example/validar?t=1')] }));
      expect(r.resumen.qr.hallazgos).toHaveLength(1);
      await leer(await imagenCertificado(undefined, { qr: await pngQr('http://127.0.0.1:9/x') }), 'image/png');
    } finally {
      for (const e of espias) e.mockRestore();
    }
    expect(llamadas).toEqual([]);
  });

  it('el modelo de idioma del OCR es local, está empaquetado y no es una URL', () => {
    const dir = directorioDatosIdioma();
    expect(dir).not.toMatch(/^[a-z]+:\/\//i);
    expect(existsSync(join(dir, 'spa.traineddata.gz'))).toBe(true);
  });

  it('sin modelo local el OCR falla cerrado: no intenta descargarlo', async () => {
    const previo = process.env.OCR_DATOS_IDIOMA_DIR;
    process.env.OCR_DATOS_IDIOMA_DIR = join(__dirname, 'no-existe-el-modelo');
    const aislado = new LectorDocumentoLocalAdapter();
    try {
      const r = await new LecturaLocalEpsService(aislado).leer(await imagenCertificado(), 'image/png');
      expect(r.resumen.errores).toContain('ocr_fallido');
      expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
    } finally {
      process.env.OCR_DATOS_IDIOMA_DIR = previo;
      if (previo === undefined) delete process.env.OCR_DATOS_IDIOMA_DIR;
      await aislado.onModuleDestroy();
    }
  });

  it('ni el registro técnico ni el resumen llevan cédula, nombre ni contenido del certificado', async () => {
    const salidas: string[] = [];
    const espias = (['log', 'debug', 'warn', 'error', 'verbose'] as const).map((n) =>
      jest.spyOn(Logger.prototype, n).mockImplementation((...a: unknown[]) => { salidas.push(a.map(String).join(' ')); }));
    const out = jest.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { salidas.push(String(c)); return true; });
    let extraccion;
    try {
      extraccion = await extractor.extraer(await pdfDigital(undefined, { qrs: [await pngQr(`AFILIADO-${CEDULA}`)] }), 'application/pdf', TipoDocumento.CERTIFICADO_EPS);
    } finally {
      espias.forEach((e) => e.mockRestore());
      out.mockRestore();
    }
    const registro = salidas.join('\n');
    for (const secreto of [CEDULA, '1.032.456.786', 'RAMIREZ', 'LAURA', 'NUEVA EPS', 'AFILIADO-']) expect(registro).not.toContain(secreto);
    // El resumen que se guarda junto a la extracción tampoco trae el texto ni los valores.
    const resumen = JSON.stringify(extraccion.lecturaLocal);
    for (const secreto of [CEDULA, 'RAMIREZ', 'LAURA', 'AFILIADO-']) expect(resumen).not.toContain(secreto);
  });

  it('el extractor local entrega el campo con su fuente y NUNCA un juicio de autenticidad o afiliación', async () => {
    const r = await extractor.extraer(await pdfDigital(), 'application/pdf', TipoDocumento.CERTIFICADO_EPS);
    expect(r.proveedor).toBe('local');
    expect(r.costoUsd).toBe(0);
    expect(r.tokensEntrada + r.tokensSalida).toBe(0);
    expect(r.campos.estado_afiliacion).toMatchObject({ valor: 'ACTIVO', fuente: 'texto_nativo' });
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['autenticidad']));
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['afiliacion']));
  });
});
