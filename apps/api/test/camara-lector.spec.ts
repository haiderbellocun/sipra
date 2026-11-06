import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { PipelineValidacionUseCase } from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { ProcesarTrabajoUseCase } from '../src/application/use-cases/documentos/procesar-trabajo.use-case';
import { ValidacionCamaraUseCase } from '../src/application/use-cases/documentos/validacion-camara.use-case';
import {
  BandaPuntaje, DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad, EstadoRegistral, EstadoValidacionDocumentoEmpresarial as Estado,
} from '../src/domain/entities/documento-empresarial';
import { CajaTexto, GeometriaDocumentoPort } from '../src/domain/ports/out/geometria-documento.port';
import { DocumentoLocalIlegibleError, LectorDocumentoLocalPort, LimitesLecturaLocal } from '../src/domain/ports/out/lector-documento-local.port';
import { ResultadoExtraccion } from '../src/domain/ports/out/servicios-externos.port';
import { calcularSha256 } from '../src/domain/services/duplicados-documento-empresarial.domain-service';
import { PaginaTextoCamara, interpretarCamara } from '../src/domain/services/interpretacion-camara.domain-service';
import {
  LIMITES_LECTURA_CAMARA, LecturaCamaraPersistible, LecturaLocalCamaraService, MAX_PAGINAS_OCR_CAMARA, minimizarLecturaCamara, palabrasEnOrdenDeLectura,
} from '../src/domain/services/lectura-local-camara.domain-service';
import { ModoProcesamiento, modoProcesamientoDe, permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';
import { ExtraccionLocalAdapter } from '../src/infrastructure/adapters/ia/extraccion-local.adapter';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import {
  CEDULA_NATURAL, DV_JURIDICA, DV_NATURAL, NIT_JURIDICA, NOMBRE_PERSONA, RAZON_SOCIAL, REPRESENTANTE, textoFactura,
} from './soporte-documento-empresarial';
import {
  paginasCamaraExistencia, paginasCamaraFormatoAntiguo, paginasCamaraPn, paginasCamaraSociedad,
} from './soporte-camara-sintetico';
import { RepoMemoria } from './soporte-repo-documento-empresarial';

const AHORA = new Date('2026-11-03T15:00:00Z');
const PRACTICA = '00000000-0000-4000-8000-0000000000a1';
const ESTUDIANTE = '00000000-0000-4000-8000-0000000000b1';

const digitales = (paginas: string[]): PaginaTextoCamara[] => paginas.map((texto) => ({ texto, fuente: 'texto', confianzaOcr: null }));
const dvOtro = (dv: string): string => String((Number(dv) + 1) % 10);

// ── Interpretación (texto → datos) ────────────────────────────────────────────

describe('Cámara · interpretación del texto de los tres tipos', () => {
  it('A · matrícula de persona natural: todos sus campos, sin representante legal', () => {
    const r = interpretarCamara(digitales(paginasCamaraPn()));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_MATRICULA_PERSONA_NATURAL);
    expect(r.datos).toMatchObject({
      tipoCertificado: 'matricula_mercantil', tipoPersona: 'natural', nombreORazonSocial: NOMBRE_PERSONA, nit: CEDULA_NATURAL, dv: DV_NATURAL, matricula: '123456',
      camara: 'CIUDAD DEMO', fechaMatricula: '2018-01-17', ultimoAnioRenovado: 2026, fechaRenovacion: '2026-03-31', domicilioMunicipio: 'Ciudad Demo, Departamento Demo',
      ciiu: '4711', fechaExpedicion: '2026-09-10', codigoVerificacion: 'xY7kQ2mP9z', representanteLegal: null,
    });
    expect(r.lecturaDudosa).toBe(false);
    expect(r.confianzaDocumento).toBe(1);
  });

  it('B · matrícula de sociedad: razón social, NIT y DV por separado; el representante, cuando figura', () => {
    const r = interpretarCamara(digitales(paginasCamaraSociedad()));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_MATRICULA_SOCIEDAD);
    expect(r.datos).toMatchObject({
      tipoCertificado: 'matricula_mercantil', tipoPersona: 'juridica', nombreORazonSocial: RAZON_SOCIAL, nit: NIT_JURIDICA, dv: DV_JURIDICA, matricula: '654321',
      representanteLegal: REPRESENTANTE, ciiu: '4321',
    });
  });

  it('B · la matrícula de sociedad sin tabla de representantes sigue siendo válida (el representante es opcional)', () => {
    const r = interpretarCamara(digitales(paginasCamaraSociedad({ sinRepresentante: true })));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_MATRICULA_SOCIEDAD);
    expect(r.datos?.representanteLegal).toBeNull();
    expect(r.datos?.nombreORazonSocial).toBe(RAZON_SOCIAL);
  });

  it('C · existencia y representación con el cargo partido alrededor del nombre; los ceros de la matrícula se conservan', () => {
    const r = interpretarCamara(digitales(paginasCamaraExistencia()));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
    expect(r.datos).toMatchObject({ tipoCertificado: 'existencia_representacion', representanteLegal: REPRESENTANTE, matricula: '00654321', nit: NIT_JURIDICA, dv: DV_JURIDICA, fechaRenovacion: '2026-06-15' });
  });

  it('C · representante ilegible o ausente: el dato queda nulo y el documento NO se reclasifica', () => {
    const r = interpretarCamara(digitales(paginasCamaraExistencia({ sinRepresentante: true })));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
    expect(r.datos?.representanteLegal).toBeNull();
    expect(r.motivos).toContain('representante_no_legible');
  });

  it('un certificado de 10 páginas: el representante está en una página lejana y se localiza en el texto nativo', () => {
    const r = interpretarCamara(digitales(paginasCamaraExistencia({ paginasDeRelleno: 8 })));
    expect(r.datos?.representanteLegal).toBe(REPRESENTANTE);
  });

  it('formato antiguo (mayúsculas, «N.I.T.», fecha sin etiqueta antes de «HORA») también se lee', () => {
    const r = interpretarCamara(digitales(paginasCamaraFormatoAntiguo()));
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_MATRICULA_PERSONA_NATURAL);
    expect(r.datos).toMatchObject({
      nit: CEDULA_NATURAL, dv: DV_NATURAL, matricula: '12345678', fechaMatricula: '2019-07-04', fechaExpedicion: '2026-08-19', ultimoAnioRenovado: 2026,
      fechaRenovacion: null, codigoVerificacion: 'B123456789CB12', diasVerificacionDocumento: 60, ciiu: '1690',
    });
  });

  it('un valor que falta es nulo, no inventado (sin código de verificación, sin días, sin renovación)', () => {
    const r = interpretarCamara(digitales(paginasCamaraPn({ codigo: null, dias: null })));
    expect(r.datos).toMatchObject({ codigoVerificacion: null, diasVerificacionDocumento: null, verificacionDisponibleHasta: null });
    // Y la palabra que sigue a la etiqueta nunca se toma por el código.
    expect(r.senales.codigoVerificacion).toBe(false);
  });
});

describe('Cámara · NIT + DV', () => {
  it('digital: un DV que no cuadra no se corrige; los valores se conservan como se leyeron, con motivo y lectura dudosa', () => {
    const r = interpretarCamara(digitales(paginasCamaraSociedad({ dv: dvOtro(DV_JURIDICA) })));
    expect(r.datos).toMatchObject({ nit: NIT_JURIDICA, dv: dvOtro(DV_JURIDICA) });
    expect(r.motivos).toContain('nit_dv_no_coincide');
    expect(r.lecturaDudosa).toBe(true);
  });

  it('OCR: un NIT cuyo DV no cuadra se DESCARTA (nulo antes que un valor falso)', () => {
    const paginas: PaginaTextoCamara[] = paginasCamaraSociedad({ dv: dvOtro(DV_JURIDICA) }).map((texto) => ({ texto, fuente: 'ocr', confianzaOcr: 92 }));
    const r = interpretarCamara(paginas);
    expect(r.datos).toMatchObject({ nit: null, dv: null });
    expect(r.motivos).toContain('nit_descartado_ocr');
    expect(r.lecturaDudosa).toBe(true);
  });

  it('OCR con el DV correcto sí se acepta (el DV es el control determinístico)', () => {
    const paginas: PaginaTextoCamara[] = paginasCamaraSociedad().map((texto) => ({ texto, fuente: 'ocr', confianzaOcr: 92 }));
    expect(interpretarCamara(paginas).datos).toMatchObject({ nit: NIT_JURIDICA, dv: DV_JURIDICA });
  });
});

describe('Cámara · estado registral, renovación, expedición y ventana', () => {
  it('el estado registral sale solo de una etiqueta explícita; sin ella es no_determinable', () => {
    expect(interpretarCamara(digitales(paginasCamaraPn())).datos?.estadoRegistral).toBe(EstadoRegistral.NO_DETERMINABLE);
    expect(interpretarCamara(digitales(paginasCamaraPn({ estado: 'ACTIVA' }))).datos?.estadoRegistral).toBe(EstadoRegistral.ACTIVO);
    expect(interpretarCamara(digitales(paginasCamaraPn({ estado: 'CANCELADA' }))).datos?.estadoRegistral).toBe(EstadoRegistral.CANCELADO);
    expect(interpretarCamara(digitales(paginasCamaraPn({ estado: 'En liquidación' }))).datos?.estadoRegistral).toBe(EstadoRegistral.OTRO);
  });

  it('renovación: el año y la fecha son independientes; solo año ⇒ fecha nula (no se inventa)', () => {
    const textos = paginasCamaraPn().map((t) => t.replace('Fecha de renovación: 31 de marzo de 2026', ''));
    expect(interpretarCamara(digitales(textos)).datos).toMatchObject({ ultimoAnioRenovado: 2026, fechaRenovacion: null, estadoRegistral: EstadoRegistral.NO_DETERMINABLE });
  });

  it('la ventana de verificación se calcula con los días QUE EL CERTIFICADO DECLARA; no se supone 60 para todos', () => {
    expect(interpretarCamara(digitales(paginasCamaraPn({ fechaExpedicion: '10/09/2026', dias: 60 }))).datos?.verificacionDisponibleHasta).toBe('2026-11-09');
    expect(interpretarCamara(digitales(paginasCamaraPn({ fechaExpedicion: '10/09/2026', dias: 30 }))).datos?.verificacionDisponibleHasta).toBe('2026-10-10');
    expect(interpretarCamara(digitales(paginasCamaraPn({ dias: null }))).datos?.verificacionDisponibleHasta).toBeNull();
  });

  it('una fecha imposible no se acepta (31 de febrero)', () => {
    const textos = paginasCamaraPn().map((t) => t.replace('17 de enero de 2018', '31 de febrero de 2018'));
    expect(interpretarCamara(digitales(textos)).datos?.fechaMatricula).toBeNull();
  });
});

describe('Cámara · URL, código y minimización', () => {
  it('la URL se sanea (sin parámetros ni credenciales) y solo se registra: no se abre', () => {
    const espia = jest.spyOn(globalThis, 'fetch');
    const r = interpretarCamara(digitales(paginasCamaraPn({ url: 'https://verifica.ejemplo.test/cv/12?token=SECRETO&otro=1' })));
    expect(r.datos?.urlVerificacion).toBe('https://verifica.ejemplo.test/cv/12');
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    expect(r.senales).toEqual({ codigoVerificacion: true, urlVerificacion: true });
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('no sale de la lectura ninguna dirección, correo, teléfono ni texto del certificado', () => {
    const texto = JSON.stringify(interpretarCamara(digitales(paginasCamaraPn())));
    for (const prohibido of ['CALLE FICTICIA', 'persona@ejemplo.test', '3000000000', 'Texto sintético de relleno', '79.123.456']) expect(texto).not.toContain(prohibido);
    const juridica = JSON.stringify(interpretarCamara(digitales(paginasCamaraSociedad())));
    expect(juridica).not.toContain('79.123.456');
    expect(juridica).not.toContain('79123456');
  });
});

describe('Cámara · clasificación por contenido', () => {
  it('una factura electrónica emitida por una Cámara es documento incorrecto, sin datos de certificado', () => {
    const r = interpretarCamara(digitales([textoFactura()]));
    expect(r.clasificacion.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(r.datos).toBeNull();
    expect(r.lecturaDudosa).toBe(false);
  });

  it('señales incompatibles (dos títulos; título PN con contenido de sociedad) → no determinable, sin datos', () => {
    const dos = interpretarCamara(digitales([...paginasCamaraExistencia(), ...paginasCamaraPn()]));
    expect(dos.clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
    expect(dos.datos).toBeNull();
    const pnConSociedad = paginasCamaraSociedad().map((t) => t.replace('CERTIFICADO DE MATRÍCULA MERCANTIL', 'CERTIFICADO DE MATRÍCULA MERCANTIL DE PERSONA NATURAL'));
    expect(interpretarCamara(digitales(pnConSociedad)).clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
  });

  it('«Cámara de Comercio», un NIT o «RUES» sueltos no bastan para clasificar', () => {
    const r = interpretarCamara(digitales([`Cámara de Comercio de Bogotá. NIT 899999000-1. Consulte el RUES. ${'oficio sin rasgos de certificado '.repeat(8)}`]));
    expect(r.clasificacion.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(r.datos).toBeNull();
  });
});

describe('Cámara · OCR: confianza por palabra y orden de lectura', () => {
  const ocr = (paginas: string[], confianza: number, bajas: string[] = []): PaginaTextoCamara[] => paginas.map((texto) => ({
    texto, fuente: 'ocr', confianzaOcr: confianza,
    palabras: texto.replace(/\s+/g, ' ').trim().split(' ').map((w) => ({ texto: w, confianza: bajas.includes(w) ? 40 : confianza })),
  }));

  it('un campo cuyas palabras se leyeron con poca seguridad se descarta (nulo, no falso) y se deja el motivo', () => {
    const r = interpretarCamara(ocr(paginasCamaraPn(), 95, ['MARIA']));
    expect(r.datos?.nombreORazonSocial).toBeNull();
    expect(r.motivos).toContain('nombre_descartado_ocr_baja_confianza');
    expect(r.datos?.matricula).toBe('123456');
    expect(r.lecturaDudosa).toBe(true);
  });

  it('un representante con una palabra ruidosa no se acepta: no se genera un representante falso', () => {
    const r = interpretarCamara(ocr(paginasCamaraExistencia(), 95, ['PEREZ']));
    expect(r.datos?.representanteLegal).toBeNull();
    expect(r.clasificacion.clasificacion).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
  });

  it('OCR siempre declara lectura dudosa cuando un campo crítico salió de él', () => {
    expect(interpretarCamara(ocr(paginasCamaraPn(), 99)).lecturaDudosa).toBe(true);
    expect(interpretarCamara(ocr(paginasCamaraPn(), 99)).fuentes.matricula).toBe('ocr');
  });

  it('con OCR la URL de verificación se registra como presente pero NO se conserva (una letra mal leída da una URL falsa)', () => {
    const r = interpretarCamara(ocr(paginasCamaraPn(), 97));
    expect(r.datos?.urlVerificacion).toBeNull();
    expect(r.senales.urlVerificacion).toBe(true);
    expect(r.motivos).toContain('url_no_conservada_ocr');
    // En texto digital sí se conserva.
    expect(interpretarCamara(digitales(paginasCamaraPn())).datos?.urlVerificacion).toBe('https://verifica.ejemplo.test/cv/12');
  });

  it('con OCR, un texto SIN rasgos de certificado no se afirma «documento incorrecto»: queda no determinable (salvo señales positivas de factura)', () => {
    const ruido = ocr([`oficio de texto ruidoso sin rasgos de certificado ${'xq zl mm '.repeat(30)}`], 70);
    const r = interpretarCamara(ruido);
    expect(r.clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
    expect(r.clasificacion.motivos).toContain('ocr_sin_rasgos_de_certificado');
    expect(r.lecturaDudosa).toBe(true);
    // Una factura escaneada, con sus señales propias, SÍ es documento incorrecto.
    expect(interpretarCamara(ocr([textoFactura()], 90)).clasificacion.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
  });

  it('la Cámara expedidora no se duplica cuando el OCR repite el encabezado', () => {
    const t = paginasCamaraPn().map((p) => p.replace('CÁMARA DE COMERCIO DE CIUDAD DEMO', 'Cámara de Comercio Cámara de Comercio de Bogotá de Bogotá Sede Virtual'));
    expect(interpretarCamara(digitales(t)).datos?.camara).toBe('Bogotá');
  });

  it('las palabras del OCR se ordenan por líneas y de izquierda a derecha, aunque lleguen desordenadas', () => {
    const c = (texto: string, x: number, y: number): CajaTexto => ({ texto, x, y, ancho: 0.05, alto: 0.02, confianza: 90 });
    const cajas = [c('mundo', 0.3, 0.101), c('Hola', 0.1, 0.1), c('línea', 0.1, 0.2), c('', 0.5, 0.5), c('dos', 0.3, 0.199)];
    expect(palabrasEnOrdenDeLectura(cajas).map((p) => p.texto)).toEqual(['Hola', 'mundo', 'línea', 'dos']);
  });
});

// ── Servicio de lectura (puertos falsos: sin red ni archivos) ─────────────────────────────

/** Páginas: `nativo` = texto digital (null = página de imagen); `ocr` = texto que el OCR «vería» en esa página. */
function puertos(paginas: { nativo: string | null; ocr?: string }[]) {
  const llamadas = { render: [] as number[], ocr: 0, escalas: [] as number[] };
  const lector: LectorDocumentoLocalPort = {
    extraerTextoNativo: async () => ({ paginas: paginas.length, porPagina: paginas.map((p, i) => ({ pagina: i + 1, texto: p.nativo ?? '' })) }),
    renderizarPagina: async (_c, pagina, limites: LimitesLecturaLocal) => { llamadas.render.push(pagina); llamadas.escalas.push(limites.escalaRender); return { pagina, ancho: 10, alto: 10, imagen: Buffer.from([pagina]) }; },
    prepararImagen: async (_c, _m, limites) => { llamadas.escalas.push(limites.escalaRender); return { pagina: 1, ancho: 10, alto: 10, imagen: Buffer.from([1]) }; },
    detectarQr: async () => { throw new Error('la Cámara no lee QR'); },
    ejecutarOcr: async () => { throw new Error('se usa cajasOcr'); },
  };
  const geometria: GeometriaDocumentoPort = {
    cajasTextoNativo: async () => [],
    cajasOcr: async (imagen) => {
      llamadas.ocr += 1;
      const texto = paginas[imagen[0] - 1]?.ocr ?? '';
      return texto.split(/\s+/).filter(Boolean).map((w, i): CajaTexto => ({ texto: w, x: (i % 20) * 0.04, y: Math.floor(i / 20) * 0.03 + 0.01, ancho: 0.03, alto: 0.02, confianza: 95 }));
    },
    medirZonaFirma: async () => ({ legible: false, densidadTinta: 0, alturaRelativaTrazo: 0 }),
  };
  return { lector, geometria, llamadas };
}
const PDF = Buffer.from('%PDF-1.4 sintetico');
const PDF_FIRMADO = Buffer.from('%PDF-1.7 sintetico /Type /Sig /ByteRange [0 840 960 1200] /Contents <00>');

describe('LecturaLocalCamaraService', () => {
  it('PDF digital: método texto, sin OCR, SHA-256 del archivo, sin leer QR ni abrir URLs', async () => {
    const espia = jest.spyOn(globalThis, 'fetch');
    const { lector, geometria, llamadas } = puertos(paginasCamaraSociedad().map((nativo) => ({ nativo })));
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.metodo).toBe('texto');
    expect(l.hashSha256).toBe(calcularSha256(PDF));
    expect(llamadas.ocr).toBe(0);
    expect(l.interpretacion.datos).toMatchObject({ nit: NIT_JURIDICA, representanteLegal: REPRESENTANTE });
    expect(l.resumen).toMatchObject({ metodo: 'texto', paginas: 2, paginasOcr: 0, lecturaDudosa: false });
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('firma PDF presente ≠ firma válida: se registra la presencia y la autenticidad sigue no_verificable', async () => {
    const { lector, geometria } = puertos(paginasCamaraPn().map((nativo) => ({ nativo })));
    const servicio = new LecturaLocalCamaraService(lector, geometria);
    const firmado = await servicio.leer(PDF_FIRMADO, 'application/pdf');
    expect(firmado.firmaPdfPresente).toBe(true);
    expect(firmado.interpretacion.datos?.firmaPdfPresente).toBe(true);
    expect(firmado.autenticidad).toMatchObject({ estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, firmaPdfPresente: true, firmaPdfValida: null, codigoVerificacionPresente: true, urlVerificacionPresente: true });
    const sinFirma = await servicio.leer(PDF, 'application/pdf');
    expect(sinFirma.firmaPdfPresente).toBe(false);
    expect(sinFirma.autenticidad.firmaPdfPresente).toBe(false);
    expect(sinFirma.autenticidad.estado).toBe(EstadoAutenticidad.NO_VERIFICABLE);
  });

  it('un certificado de 10 páginas: se lee el texto nativo de todas y NO se hace OCR', async () => {
    const { lector, geometria, llamadas } = puertos(paginasCamaraExistencia({ paginasDeRelleno: 8 }).map((nativo) => ({ nativo })));
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.resumen.paginas).toBe(10);
    expect(l.interpretacion.datos?.representanteLegal).toBe(REPRESENTANTE);
    expect(llamadas.ocr).toBe(0);
    expect(LIMITES_LECTURA_CAMARA.maxPaginas).toBeGreaterThanOrEqual(10);
  });

  it('escaneado: OCR página a página y se detiene en cuanto alcanza (un persona natural: la primera basta)', async () => {
    const textos = paginasCamaraPn();
    const { lector, geometria, llamadas } = puertos([{ nativo: null, ocr: textos[0] }, { nativo: null, ocr: textos[1] }, { nativo: null, ocr: textos[2] }]);
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.metodo).toBe('ocr');
    expect(llamadas.ocr).toBe(1);
    expect(llamadas.escalas.every((e) => e === 3)).toBe(true);
    expect(l.interpretacion.datos).toMatchObject({ nit: CEDULA_NATURAL, dv: DV_NATURAL, matricula: '123456' });
    expect(l.interpretacion.lecturaDudosa).toBe(true);
    expect(l.resumen).toMatchObject({ metodo: 'ocr', paginasOcr: 1 });
  });

  it('escaneado de existencia y representación: sigue con las páginas siguientes hasta hallar al representante', async () => {
    const t = paginasCamaraExistencia({ paginasDeRelleno: 2 });
    const { lector, geometria, llamadas } = puertos(t.map((_, i) => ({ nativo: null, ocr: t[i] })));
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(llamadas.ocr).toBe(4);
    expect(l.interpretacion.datos?.representanteLegal).toBe(REPRESENTANTE);
  });

  it(`el OCR tiene un tope (${MAX_PAGINAS_OCR_CAMARA} páginas): lo que sigue se omite y se avisa; el representante queda nulo`, async () => {
    const t = paginasCamaraExistencia({ paginasDeRelleno: 10 });
    const { lector, geometria, llamadas } = puertos(t.map((_, i) => ({ nativo: null, ocr: t[i] })));
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(llamadas.ocr).toBe(MAX_PAGINAS_OCR_CAMARA);
    expect(l.resumen.limitesAplicados).toContain('ocr_paginas_omitidas');
    expect(l.interpretacion.datos?.representanteLegal).toBeNull();
    expect(l.interpretacion.clasificacion.clasificacion).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
  });

  it('híbrido: con los datos críticos en el texto digital, la página de imagen NO se somete a OCR', async () => {
    const t = paginasCamaraPn();
    const { lector, geometria, llamadas } = puertos([{ nativo: t[0] }, { nativo: t[1] }, { nativo: null, ocr: 'sello' }]);
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(llamadas.ocr).toBe(0);
    expect(l.metodo).toBe('texto');
  });

  it('híbrido: si faltan datos críticos en el texto digital, se lee con OCR solo la página de imagen y el método es híbrido', async () => {
    const t = paginasCamaraPn();
    const sinIdentificacion = t[0].replace(/Matrícula No: 123456/, '');
    const { lector, geometria, llamadas } = puertos([{ nativo: sinIdentificacion }, { nativo: null, ocr: 'Matrícula No: 123456' }]);
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(llamadas.ocr).toBe(1);
    expect(l.metodo).toBe('hibrido');
    expect(l.interpretacion.datos?.matricula).toBe('123456');
    expect(l.interpretacion.fuentes.matricula).toBe('ocr');
    // Con OCR de por medio, «no se leyó el código» no es «no hay código»: queda sin determinar.
  });

  it('imagen (JPG/PNG): una sola página por OCR, firma PDF sin determinar', async () => {
    const t = paginasCamaraPn();
    const { lector, geometria } = puertos([{ nativo: null, ocr: t[0] }]);
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(Buffer.from('png'), 'image/png');
    expect(l.metodo).toBe('ocr');
    expect(l.firmaPdfPresente).toBeNull();
    expect(l.interpretacion.datos?.firmaPdfPresente).toBeNull();
  });

  it('una factura en texto digital: documento incorrecto, sin OCR y sin datos', async () => {
    const { lector, geometria, llamadas } = puertos([{ nativo: textoFactura() }, { nativo: null, ocr: 'pagina de imagen' }]);
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf');
    expect(l.interpretacion.clasificacion.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(l.interpretacion.datos).toBeNull();
    expect(llamadas.ocr).toBe(0);
  });

  it('la lectura persistible no lleva texto, OCR, imágenes, dirección, correo ni teléfono', async () => {
    const { lector, geometria } = puertos(paginasCamaraPn().map((nativo) => ({ nativo })));
    const persistible = minimizarLecturaCamara(await new LecturaLocalCamaraService(lector, geometria).leer(PDF_FIRMADO, 'application/pdf'));
    const texto = JSON.stringify(persistible);
    for (const prohibido of ['CALLE FICTICIA', 'persona@ejemplo.test', '3000000000', 'Texto sintético de relleno']) expect(texto).not.toContain(prohibido);
    // Ninguna clave de contenido: ni texto, ni OCR, ni imágenes, ni dirección, correo o teléfono.
    expect(texto).not.toMatch(/"(texto|textoOcr|ocr|imagen|imagenes|direccion|correo|telefono)"\s*:/i);
  });

  it('la evaluación con «forzarOcr» ignora la capa de texto (solo para regresión, nunca en el flujo de carga)', async () => {
    const t = paginasCamaraPn();
    const { lector, geometria, llamadas } = puertos(t.map((nativo) => ({ nativo, ocr: nativo })));
    const l = await new LecturaLocalCamaraService(lector, geometria).leer(PDF, 'application/pdf', undefined, { forzarOcr: true });
    expect(l.metodo).toBe('ocr');
    expect(llamadas.ocr).toBeGreaterThan(0);
  });
});

// ── Validación (persistencia) ─────────────────────────────────────────────────────────────

const HASH = 'a'.repeat(64);
function datosDocumento(tipo: TipoDocumento, extraccion: Record<string, unknown> | null, estado = EstadoDocumento.EN_REVISION, id: string = randomUUID()): DatosDocumento {
  return {
    id, practicaId: PRACTICA, tipo, version: 1, estado, nombreOriginal: 'camara.pdf', mimeReal: 'application/pdf', tamanoBytes: 10, hashSha256: HASH, hashPerceptual: null,
    rutaAlmacenamiento: `ruta/${id}.pdf`, calidadCaptura: null, banderas: [], puntaje: 90, banda: BandaPuntaje.VERDE, extraccion, decididoPor: null,
    justificacionDecision: null, motivoDevolucion: null, cargadoEn: AHORA, actualizadoEn: AHORA, purgarDespuesDe: null,
  };
}

const AUTENTICIDAD_FIRMADA = {
  estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, qrPresente: null, qrDecodificado: null, qrDestinoOficial: null,
  firmaPdfPresente: true, firmaPdfValida: null, codigoVerificacionPresente: true, urlVerificacionPresente: true,
};

const lecturaCamara = (texto: string[] = paginasCamaraExistencia(), sobre: Partial<LecturaCamaraPersistible> = {}): LecturaCamaraPersistible => {
  const i = interpretarCamara(digitales(texto));
  return {
    ...minimizarLecturaCamara({
      hashSha256: HASH, interpretacion: { ...i, datos: i.datos ? { ...i.datos, firmaPdfPresente: true } : null }, metodo: 'texto', firmaPdfPresente: true,
      autenticidad: AUTENTICIDAD_FIRMADA,
      resumen: { metodo: 'texto', paginas: texto.length, paginasOcr: 0, confianzaOcrMedia: null, lecturaDudosa: i.lecturaDudosa, limitesAplicados: [] },
    }),
    ...sobre,
  };
};

describe('ValidacionCamaraUseCase · flujo de carga', () => {
  function entorno(lector: { leer: jest.Mock } = { leer: jest.fn() }) {
    const repo = new RepoMemoria();
    const docs = new Map<string, Documento>();
    const agregar = (extraccion: Record<string, unknown> | null, estado = EstadoDocumento.EN_REVISION, tipo = TipoDocumento.CAMARA_COMERCIO, hash = HASH): string => {
      const d = { ...datosDocumento(tipo, extraccion, estado), hashSha256: hash };
      docs.set(d.id, Documento.desde(d));
      repo.documentos.push({ documentoId: d.id, practicaId: PRACTICA, tipo, hash });
      return d.id;
    };
    const caso = new ValidacionCamaraUseCase(
      repo, { buscarPorId: async (id: string) => docs.get(id) ?? null } as never,
      { buscarPorId: async () => ({ estudianteId: ESTUDIANTE }) } as never, { leer: async () => Buffer.from('pdf') } as never, lector,
    );
    return { caso, repo, docs, agregar, lector };
  }

  it('registra la lectura que dejó el pipeline SIN releer el archivo: revisión, dos evidencias y SIN comparación ni decisión', async () => {
    const { caso, repo, docs, agregar, lector } = entorno();
    const id = agregar({ lecturaCamara: lecturaCamara() });
    const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
    expect(v).toMatchObject({
      estado: Estado.REVISION, familiaDocumento: 'camara', tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION, tipoPersona: 'juridica', metodoLectura: 'texto',
      expectativa: 'coincide', hashDocumento: HASH, comparacion: null, decididoPor: null, motivoDecision: null, procesadaEn: AHORA,
    });
    expect(v.autenticidad).toMatchObject({ estado: 'no_verificable', fuente: null, firmaPdfPresente: true, firmaPdfValida: null });
    expect(v.datosExtraidos).toMatchObject({ nit: NIT_JURIDICA, representanteLegal: REPRESENTANTE, firmaPdfPresente: true, verificacionDisponibleHasta: '2026-11-09' });
    expect(repo.evidencias.map((e) => e.tipo).sort()).toEqual(['clasificacion', 'lectura_documento']);
    expect(lector.leer).not.toHaveBeenCalled();
    // Idempotente: repetirlo no duplica nada.
    await caso.registrarProcesamiento(docs.get(id)!, new Date('2026-11-04T00:00:00Z'));
    expect(repo.filas.size).toBe(1);
    expect(repo.evidencias).toHaveLength(2);
  });

  it('documento incorrecto o no determinable: queda en revisión con su clasificación, sin datos', async () => {
    for (const tipoDetectado of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE]) {
      const { caso, docs, agregar } = entorno();
      const id = agregar({ lecturaCamara: lecturaCamara(undefined, { tipoDetectado, datos: null }) });
      const v = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
      expect(v).toMatchObject({ estado: Estado.REVISION, tipoDetectado, datosExtraidos: null, expectativa: tipoDetectado === C.DOCUMENTO_INCORRECTO ? 'documento_incorrecto' : 'no_determinable' });
    }
  });

  it('duplicado exacto (mismo archivo, práctica y tipo): se registra el anterior y no se borra nada', async () => {
    const { caso, repo, docs, agregar } = entorno();
    const primero = agregar({ lecturaCamara: lecturaCamara() });
    const segundo = agregar({ lecturaCamara: lecturaCamara() });
    await caso.registrarProcesamiento(docs.get(primero)!, AHORA);
    const v = (await caso.registrarProcesamiento(docs.get(segundo)!, AHORA))!.instantanea();
    expect(v.duplicadoDeDocumentoId).toBe(primero);
    expect(repo.filas.size).toBe(2);
  });

  it('un error técnico queda en «error» con un código controlado, y un reintento lo completa', async () => {
    const lector = { leer: jest.fn(async () => { throw new DocumentoLocalIlegibleError('PDF dañado con datos del documento'); }) };
    const { caso, docs, agregar } = entorno(lector);
    const id = agregar(null);
    const roto = (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea();
    expect(roto).toMatchObject({ estado: Estado.ERROR, errorCodigo: 'documento_ilegible' });
    expect(JSON.stringify(roto)).not.toContain('datos del documento');
    const conLectura = agregar({ lecturaCamara: lecturaCamara() });
    await caso.marcarProcesando(conLectura, AHORA);
    await caso.marcarErrorProcesamiento(conLectura, 'PROCESAMIENTO_FALLIDO', AHORA);
    expect((await caso.registrarProcesamiento(docs.get(conLectura)!, AHORA))!.instantanea()).toMatchObject({ estado: Estado.REVISION, errorCodigo: null });
  });

  it('otros tipos no se procesan aquí; un documento que ya volvió al estudiante, o aún sin pipeline, no registra nada', async () => {
    const { caso, docs, agregar } = entorno();
    expect(await caso.registrarProcesamiento(docs.get(agregar(null, EstadoDocumento.EN_REVISION, TipoDocumento.RUT_JURIDICO))!, AHORA)).toBeNull();
    expect(await caso.registrarProcesamiento(docs.get(agregar(null, EstadoDocumento.ILEGIBLE))!, AHORA)).toBeNull();
    expect(await caso.registrarProcesamiento(docs.get(agregar(null, EstadoDocumento.ANALIZANDO))!, AHORA)).toBeNull();
  });
});

// ── Worker, política y pipeline ───────────────────────────────────────────────────────────

describe('ProcesarTrabajoUseCase · la Cámara entra al flujo de carga', () => {
  function montar(tipo: TipoDocumento, pipelineFalla = false) {
    const d = datosDocumento(tipo, null);
    const documento = Documento.desde(d);
    const llamadas: string[] = [];
    const camara = {
      marcarProcesando: jest.fn(async () => { llamadas.push('camara:procesando'); }),
      registrarProcesamiento: jest.fn(async () => { llamadas.push('camara:registrar'); return null; }),
      marcarErrorProcesamiento: jest.fn(async () => { llamadas.push('camara:error'); }),
    };
    const pipeline = { procesar: jest.fn(async () => { llamadas.push('pipeline'); if (pipelineFalla) throw new Error('falló'); return { documento, ejecutado: true }; }) };
    const contador = { observe: jest.fn(), inc: jest.fn() };
    const caso = new ProcesarTrabajoUseCase(
      pipeline as never, { buscarPorId: async () => documento } as never, {} as never, {} as never, {} as never, { notificar: jest.fn() } as never,
      { duracionPipeline: contador, documentosProcesados: contador, documentosAutoAprobados: contador, costoIa: contador } as never,
      { marcarProcesando: jest.fn(), registrarProcesamiento: jest.fn(), marcarErrorProcesamiento: jest.fn() } as never,
      undefined, undefined, undefined, undefined, camara as never,
    );
    return { caso, camara, llamadas, id: d.id };
  }

  it('«procesando» → pipeline → validación de la Cámara (lectura, clasificación, persistencia)', async () => {
    const { caso, camara, llamadas, id } = montar(TipoDocumento.CAMARA_COMERCIO);
    await caso.ejecutar({ tipo: 'validar_documento', referencia: id } as never);
    expect(llamadas).toEqual(['camara:procesando', 'pipeline', 'camara:registrar']);
    expect(camara.registrarProcesamiento).toHaveBeenCalledTimes(1);
  });

  it('un error del pipeline deja la validación en «error» con un código controlado y relanza para el reintento', async () => {
    const { caso, camara, id } = montar(TipoDocumento.CAMARA_COMERCIO, true);
    await expect(caso.ejecutar({ tipo: 'validar_documento', referencia: id } as never)).rejects.toThrow('falló');
    expect(camara.marcarErrorProcesamiento).toHaveBeenCalledWith(id, 'PROCESAMIENTO_FALLIDO');
    expect(camara.registrarProcesamiento).not.toHaveBeenCalled();
  });

  it('los demás tipos documentales no pasan por la validación de la Cámara', async () => {
    const { caso, camara, id } = montar(TipoDocumento.RUT_JURIDICO);
    await caso.ejecutar({ tipo: 'validar_documento', referencia: id } as never);
    expect(camara.marcarProcesando).not.toHaveBeenCalled();
    expect(camara.registrarProcesamiento).not.toHaveBeenCalled();
  });
});

const PNG = new DecodificadorImagenAdapter().codificarPng({ ancho: 64, alto: 64, pixeles: new Uint8Array(64 * 64).fill(200) });

function montarPipeline(tipo: TipoDocumento, externo: { extraer: () => Promise<ResultadoExtraccion> }, local: { extraer: () => Promise<ResultadoExtraccion> }) {
  let almacenado: DatosDocumento = { ...datosDocumento(tipo, null, EstadoDocumento.RECIBIDO, 'doc-camara'), mimeReal: 'image/png', tamanoBytes: PNG.length };
  const documentos = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)), listarPorPractica: () => Promise.resolve([]), contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]), ultimaVersion: () => Promise.resolve(1),
    guardar: (d: DatosDocumento) => { almacenado = d; return Promise.resolve(Documento.desde(d)); },
    listarParaPurga: () => Promise.resolve([]), gastoIaDesde: () => Promise.resolve(0), contarLecturasDesde: () => Promise.resolve(0),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
  };
  const parametros = new ParametrosUseCase({ listarSobrescrituras: () => Promise.resolve([]), guardar: () => Promise.resolve(), restaurar: () => Promise.resolve() });
  const pipeline = new PipelineValidacionUseCase(
    documentos, { buscarPorId: () => Promise.resolve(null) } as never, { buscarPorId: () => Promise.resolve(null) } as never,
    { leer: () => Promise.resolve(PNG) } as never, externo, { evaluar: () => Promise.resolve([]) }, new DecodificadorImagenAdapter(),
    { leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }) }, parametros, { get: () => undefined } as unknown as ConfigService, local,
  );
  return { pipeline, actual: () => almacenado };
}

const extraccionCamara = (lectura: LecturaCamaraPersistible, tipoDetectado: TipoDocumento | null): ResultadoExtraccion => ({
  tipoDetectado, campos: { nit: { valor: lectura.datos?.nit ?? null, confianza: 1, evidencia: null } }, ilegible: false, modelo: 'local-pdfjs-tesseract-camara',
  tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, proveedor: 'local', lecturaCamara: lectura,
});

describe('Política y pipeline de la Cámara: solo local, jamás autoaprobada', () => {
  it('la Cámara se procesa solo en local y nunca se autoaprueba; los demás tipos conservan su política', () => {
    expect(modoProcesamientoDe(TipoDocumento.CAMARA_COMERCIO)).toBe(ModoProcesamiento.LOCAL);
    expect(permiteAutoAprobacionDelPipeline(TipoDocumento.CAMARA_COMERCIO)).toBe(false);
    expect(permiteAutoAprobacionDelPipeline(TipoDocumento.CEDULA)).toBe(true);
    expect(modoProcesamientoDe(TipoDocumento.CERTIFICADO_EPS)).toBe(ModoProcesamiento.LOCAL);
  });

  it('una Cámara de banda verde queda EN REVISIÓN (no auto_aprobada), no sale a un proveedor externo y guarda su lectura', async () => {
    const externo = { extraer: jest.fn(async () => { throw new Error('la Cámara nunca sale a un proveedor externo'); }) };
    const local = { extraer: jest.fn(async () => extraccionCamara(lecturaCamara(), TipoDocumento.CAMARA_COMERCIO)) };
    const { pipeline, actual } = montarPipeline(TipoDocumento.CAMARA_COMERCIO, externo, local);
    await pipeline.procesar('doc-camara');
    expect(externo.extraer).not.toHaveBeenCalled();
    expect(local.extraer).toHaveBeenCalledTimes(1);
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(actual().banderas.map((b) => b.codigo)).toContain('C3_AUTOAPROBACION_NO_HABILITADA');
    expect((actual().extraccion as { lecturaCamara?: LecturaCamaraPersistible }).lecturaCamara?.tipoDetectado).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
  });

  it('el flujo nuevo NO produce la causal «año en curso» ni CAMARA_NO_VIGENTE, aunque el certificado sea de 2020', async () => {
    const antiguo = lecturaCamara();
    antiguo.datos = { ...antiguo.datos!, fechaExpedicion: '2020-01-15' };
    const local = { extraer: jest.fn(async () => extraccionCamara(antiguo, TipoDocumento.CAMARA_COMERCIO)) };
    const { pipeline, actual } = montarPipeline(TipoDocumento.CAMARA_COMERCIO, { extraer: jest.fn() }, local);
    await pipeline.procesar('doc-camara');
    expect(JSON.stringify(actual().banderas)).not.toMatch(/VIGENTE|ANO_EN_CURSO|a[nñ]o en curso|vencid/i);
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('una factura se marca C2_TIPO_INCORRECTO y queda en revisión; un RUT subido como Cámara también', async () => {
    for (const [lectura, detectado] of [
      [lecturaCamara(undefined, { tipoDetectado: C.DOCUMENTO_INCORRECTO, datos: null }), null],
      [lecturaCamara(undefined, { tipoDetectado: C.RUT_PERSONA_JURIDICA, datos: null }), TipoDocumento.RUT_JURIDICO],
    ] as const) {
      const local = { extraer: jest.fn(async () => extraccionCamara(lectura, detectado)) };
      const { pipeline, actual } = montarPipeline(TipoDocumento.CAMARA_COMERCIO, { extraer: jest.fn() }, local);
      await pipeline.procesar('doc-camara');
      expect(actual().banderas.map((b) => b.codigo)).toContain('C2_TIPO_INCORRECTO');
      expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    }
  });
});

describe('ExtraccionLocalAdapter · Cámara', () => {
  it('traduce la lectura al formato del pipeline: tipo detectado, campos sin estado inventado, lectura minimizada, 100 % local', async () => {
    const lectura = lecturaCamara();
    const respaldo = { extraer: jest.fn(() => { throw new Error('no debe usarse el extractor de respaldo'); }) };
    const adapter = new ExtraccionLocalAdapter(
      {} as never, respaldo as never, undefined, undefined, undefined,
      { leer: async () => ({ hashSha256: HASH, interpretacion: { ...interpretarCamara(digitales(paginasCamaraExistencia())), datos: lectura.datos }, metodo: 'texto', autenticidad: lectura.autenticidad, firmaPdfPresente: true, resumen: lectura.resumen }) } as never,
    );
    const r = await adapter.extraer(Buffer.from('x'), 'application/pdf', TipoDocumento.CAMARA_COMERCIO);
    expect(respaldo.extraer).not.toHaveBeenCalled();
    expect(r.tipoDetectado).toBe(TipoDocumento.CAMARA_COMERCIO);
    expect(r.proveedor).toBe('local');
    expect(r.costoUsd).toBe(0);
    expect(r.ilegible).toBe(false);
    expect(r.campos['nit'].valor).toBe(`${NIT_JURIDICA}-${DV_JURIDICA}`);
    // El estado registral no se declara activo por defecto: sin etiqueta, no hay valor.
    expect(r.campos['estado'].valor).toBeNull();
    expect(r.lecturaCamara?.tipoDetectado).toBe(C.CAMARA_EXISTENCIA_REPRESENTACION);
  });
});
