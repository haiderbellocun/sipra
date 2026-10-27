import PDFDocument from 'pdfkit';
import { CoincidenciaEps } from '../src/domain/entities/validacion-eps.entity';
import {
  compararCertificadoEps, construirDatosExtraidosEps, diasDesdeExpedicion, evaluarVigenciaCertificado,
} from '../src/domain/services/comparacion-eps.domain-service';
import { extraerCamposEps } from '../src/domain/services/extraccion-eps-local.domain-service';
import { LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { normalizarDocumento, normalizarEstadoReportado } from '../src/domain/services/normalizacion-identidad';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';

/**
 * Regresión del extractor local con la ESTRUCTURA de certificados reales de EPS (tabla con las etiquetas en un
 * bloque y los valores en otro, texto desordenado, palabras sueltas, tildes dañadas por la fuente del PDF).
 * Identidades 100 % ficticias: no hay ningún documento ni dato personal real en este archivo.
 */

jest.setTimeout(120_000);

const AHORA = new Date('2026-10-26T15:00:00Z');
const ESTUDIANTE = { numeroDocumento: '1032456786', nombre: 'Laura Sofía Ramírez Ortiz' };

/** Texto tal como lo arma el lector local: cada fragmento + «\n» si cierra línea, unidos por «\n». */
const comoPdfjs = (items: ReadonlyArray<string | { s: string; eol?: boolean }>): string =>
  items.map((i) => (typeof i === 'string' ? `${i}\n` : `${i.s}${i.eol === false ? '' : '\n'}`)).join('\n');

/** Palabra por palabra con un fragmento de espacio entre cada una y fin de línea solo al final. */
const palabrasSueltas = (frase: string): Array<{ s: string; eol?: boolean }> => {
  const out: Array<{ s: string; eol?: boolean }> = [];
  const palabras = frase.split(' ');
  palabras.forEach((p, i) => {
    out.push({ s: p, eol: i === palabras.length - 1 });
    if (i < palabras.length - 1) out.push({ s: ' ', eol: false });
  });
  return out;
};

const leer = (texto: string, fuente: 'texto_nativo' | 'ocr' = 'texto_nativo') => extraerCamposEps(texto, fuente, 0.92);
const valores = (texto: string) => construirDatosExtraidosEps(leer(texto));

interface Tabla { nombre: string; tipo: string; numero: string; ingreso: string; generacion: string; estado?: string; afiliado?: string }

/** Imita el certificado tipo tabla: etiquetas juntas, valores juntos, la fecha de generación lejos de su etiqueta. */
function tablaSintetica(t: Tabla, danar = false): string {
  const items = [
    'CERTIFICA',
    'en desarrollo de su programa especial para la garantía del Plan de Beneficios denominado',
    t.nombre, t.numero, 'REGISTRO CIVIL',
    'EPS SINTETICA SALUD S.A.', 'EPS SINTETICA',
    'CERTIFICADO DE AFILIACIÓN AL PBS DE EPS',
    'TIPO Y NÚMERO DE IDENTIFICACIÓN', 'SEMANAS COTIZADAS EN OTRA EPS', 'FECHA RETIRO LABORAL EPS SINTETICA',
    'FECHA DE INGRESO A EPS SINTETICA', 'NOMBRES Y APELLIDOS', 'TIPO DE AFILIADO', 'PARENTESCO',
    'ESTADO DE LA AFILIACIÓN', 'CAUSA ESTADO DE LA AFILIACIÓN', 'EMPLEADOR(ES)*',
    `${t.tipo} ${t.numero}`, t.nombre, t.afiliado ?? 'BENEFICIARIO', 'HIJO(A)', 'TIENE DERECHO A COBERTURA INTEGRAL',
    t.ingreso, t.estado ?? 'VIGENTE', '64', '0',
    '*Se reportan, a partir de la fecha de este certificado, los empleadores', 'DIRECCIÓN DE AFILIACIONES',
    'Fecha de generación:', 'ESTE DOCUMENTO SOLO ES VÁLIDO PARA CERTIFICAR', 'SEMANAS COTIZADAS AL SGSSS', t.generacion,
  ];
  const texto = comoPdfjs(items);
  // Fuentes con el mapa de caracteres dañado: la tilde sale como otro carácter.
  return danar ? texto.replace(/Ó/g, 'Y').replace(/Ú/g, 'Z').replace(/ó/g, ':').replace(/í/g, '8').replace(/ñ/g, 'd') : texto;
}

const FICTICIO: Tabla = {
  nombre: 'SAMUEL ANDRES FICTICIO PRUEBA', tipo: 'RC', numero: '1099887766', ingreso: '04-10-2012', generacion: '13/01/2014',
};

describe('Formatos reales: etiqueta y valor en la misma línea', () => {
  const TEXTO = [
    'Entidad Promotora de Salud EPS SINTETICA S.A.',
    'CERTIFICADO DE AFILIACION',
    'Nombres y apellidos: MARIA DEL CARMEN RODRIGUEZ DE LA TORRE',
    'Tipo y número de identificación: CC 52.123.456',
    'Tipo de afiliado: Cotizante',
    'Estado de la afiliación: Activo',
    'Fecha de ingreso: 01/02/2020',
    'Fecha de generación: 15/10/2026',
  ].join('\n');

  it('lee los ocho datos mínimos y deja el régimen en null', () => {
    const c = leer(TEXTO);
    expect(c.entidad_emisora.valor).toMatch(/EPS SINTETICA/);
    expect(c.nombre_afiliado.valor).toBe('MARIA DEL CARMEN RODRIGUEZ DE LA TORRE'); // varios apellidos
    expect(c.documento_afiliado.valor).toMatch(/CC\s+52\.123\.456/);
    expect(c.tipo_afiliado.valor).toBe('Cotizante');
    expect(c.estado_afiliacion.valor).toBe('Activo');
    expect(c.fecha_expedicion.valor).toBe('15/10/2026');
    expect(c.regimen).toEqual({ valor: null, confianza: 0, evidencia: null, fuente: null }); // no se inventa
  });

  it('normaliza: CC, cotizante, ACTIVO y fecha ISO', () => {
    expect(valores(TEXTO)).toMatchObject({
      tipoDocumento: 'CC', numeroDocumento: '52123456', tipoAfiliado: 'cotizante', estadoReportadoCertificado: 'ACTIVO',
      fechaExpedicion: '2026-10-15', regimen: null,
    });
  });
});

describe('Formatos reales: etiqueta y valor en líneas distintas (pdf.js)', () => {
  const TEXTO = comoPdfjs([
    'Entidad Promotora de Salud EPS SINTETICA S.A.',
    'NOMBRES Y APELLIDOS', 'JUAN CAMILO ANDRADE PEREZ',
    'TIPO Y NÚMERO DE IDENTIFICACIÓN', 'CC 80.111.222',
    'TIPO DE AFILIADO', 'COTIZANTE',
    'ESTADO DE LA AFILIACIÓN', 'ACTIVO',
    'Fecha de generación:', '15-10-2026',
  ]);

  it('toma el valor de la línea siguiente', () => {
    const c = leer(TEXTO);
    expect(c.nombre_afiliado.valor).toBe('JUAN CAMILO ANDRADE PEREZ');
    expect(c.documento_afiliado.valor).toMatch(/CC\s+80\.111\.222/);
    expect(c.tipo_afiliado.valor).toBe('COTIZANTE');
    expect(c.estado_afiliacion.valor).toBe('ACTIVO');
    expect(c.fecha_expedicion.valor).toBe('15-10-2026'); // DD-MM-YYYY
    expect(valores(TEXTO).fechaExpedicion).toBe('2026-10-15');
  });
});

describe('Formatos reales: tabla con etiquetas y valores separados (estructura de los certificados de EPS)', () => {
  it('lee identidad, tipo de afiliado, estado y fecha de generación aunque cada valor esté lejos de su etiqueta', () => {
    const c = leer(tablaSintetica(FICTICIO));
    expect(c.entidad_emisora.valor).toMatch(/EPS SINTETICA/);
    expect(c.nombre_afiliado.valor).toBe('SAMUEL ANDRES FICTICIO PRUEBA');
    expect(c.documento_afiliado.valor).toBe('RC 1099887766');
    expect(c.tipo_afiliado.valor).toBe('BENEFICIARIO');
    expect(c.estado_afiliacion.valor).toBe('VIGENTE');
    expect(c.fecha_expedicion.valor).toBe('13/01/2014');
    expect(c.regimen.valor).toBeNull();
    expect(valores(tablaSintetica(FICTICIO))).toMatchObject({
      tipoDocumento: 'RC', numeroDocumento: '1099887766', tipoAfiliado: 'beneficiario', estadoReportadoCertificado: 'ACTIVO',
      fechaExpedicion: '2014-01-13',
    });
  });

  it('con las tildes dañadas por la fuente del PDF («AFILIACIYN», «generaci:n», «NZMERO») también lo lee', () => {
    const texto = tablaSintetica(FICTICIO, true);
    expect(texto).toContain('generaci:n');
    expect(texto).toContain('NZMERO');
    const c = leer(texto);
    expect(c.documento_afiliado.valor).toBe('RC 1099887766');
    expect(c.nombre_afiliado.valor).toBe('SAMUEL ANDRES FICTICIO PRUEBA');
    expect(c.fecha_expedicion.valor).toBe('13/01/2014');
    expect(c.estado_afiliacion.valor).toBe('VIGENTE');
  });

  it.each([
    ['RC', '1099887766', 'RC'], ['TI', '1099887766', 'TI'], ['CE', '4455667', 'CE'], ['CC', '52123456', 'CC'],
  ])('documento %s se reconoce con su tipo', (tipo, numero, esperado) => {
    const d = valores(tablaSintetica({ ...FICTICIO, tipo, numero }));
    expect(d.tipoDocumento).toBe(esperado);
    expect(d.numeroDocumento).toBe(numero);
  });

  it('el tipo del documento escrito con palabras («REGISTRO CIVIL») junto al número también sirve', () => {
    const texto = comoPdfjs(['OTRA PERSONA FICTICIA SINTETICA', '1055443322', 'REGISTRO CIVIL', 'Fecha de generación: 15/10/2026']);
    expect(valores(texto)).toMatchObject({ tipoDocumento: 'RC', numeroDocumento: '1055443322', nombre: 'OTRA PERSONA FICTICIA SINTETICA' });
  });

  it('un ESTADO que no es de la persona (p. ej. «CAUSA ESTADO…») no se toma por el estado', () => {
    const c = leer(comoPdfjs(['ESTADO DE LA AFILIACIÓN', 'CAUSA ESTADO DE LA AFILIACIÓN', 'EMPLEADOR(ES)*']));
    expect(c.estado_afiliacion.valor).toBeNull();
  });
});

describe('Texto fragmentado por pdf.js (palabra por palabra)', () => {
  it('reconstruye la línea: nombre, documento, estado y fecha de una carta', () => {
    const texto = comoPdfjs([
      ...palabrasSueltas('EL PROGRAMA DE EPS DE LA CAJA FICTICIA'),
      ...palabrasSueltas('Que el(la) señor(a) CARLOS ANDRES SINTETICO MUESTRA identificado(a) con Cedula Ciudadania 79.555.444,'),
      ...palabrasSueltas('se encuentra Activo en el Plan de Beneficios de Salud PBS, en calidad de Cotizante'),
      ...palabrasSueltas('El presente certificado se expide a los 26 días del mes de Octubre de 2.026'),
    ]);
    const d = valores(texto);
    expect(d).toMatchObject({ tipoDocumento: 'CC', numeroDocumento: '79555444', nombre: 'CARLOS ANDRES SINTETICO MUESTRA', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-26' });
  });
});

describe('Fecha de generación frente a fecha de ingreso', () => {
  it('la vigencia usa la GENERACIÓN, no el ingreso a la EPS (ingreso reciente + certificado viejo = vencido)', () => {
    const d = valores(tablaSintetica({ ...FICTICIO, ingreso: '01/10/2026', generacion: '13/01/2014' }));
    expect(d.fechaExpedicion).toBe('2014-01-13');
    expect(evaluarVigenciaCertificado(d.fechaExpedicion, AHORA, 30)).toBe('vencido');
    expect(diasDesdeExpedicion(d.fechaExpedicion, AHORA)).toBe(4669);
  });

  it('ingreso muy antiguo + certificado de hoy = vigente', () => {
    const d = valores(tablaSintetica({ ...FICTICIO, ingreso: '04-10-2012', generacion: '26/10/2026' }));
    expect(d.fechaExpedicion).toBe('2026-10-26');
    expect(evaluarVigenciaCertificado(d.fechaExpedicion, AHORA, 30)).toBe('vigente');
  });

  it('sin etiqueta de generación/expedición NO se usa la fecha de ingreso: queda sin fecha', () => {
    const texto = comoPdfjs(['Entidad: EPS SINTETICA', 'Nombre: ANA MARIA FICTICIA PRUEBA', 'Documento: CC 52.000.111', 'Fecha de ingreso: 01/10/2026']);
    const d = valores(texto);
    expect(d.fechaExpedicion).toBeNull();
    expect(evaluarVigenciaCertificado(d.fechaExpedicion, AHORA, 30)).toBe('no_determinada');
  });

  it('fecha en palabras («15 de octubre de 2026») y en DD/MM/YYYY', () => {
    expect(valores('Fecha de expedición: 15 de octubre de 2026').fechaExpedicion).toBe('2026-10-15');
    expect(valores('Fecha de expedición: 15/10/2026').fechaExpedicion).toBe('2026-10-15');
  });
});

describe('Comparación con el estudiante: coincide, discrepancia o información insuficiente', () => {
  const contexto = { ahora: AHORA, diasVigencia: 30 };

  it('identidad distinta (documento y nombre) → DISCREPANCIA, con ambos campos señalados', () => {
    const r = compararCertificadoEps(valores(tablaSintetica(FICTICIO)), ESTUDIANTE, contexto);
    expect(r.coincidencia).toBe(CoincidenciaEps.DISCREPANCIA);
    expect(r.vigencia).toBe('vencido');
    const campos = r.discrepancias.filter((x) => x.resultado === 'diferente').map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['numero_documento', 'nombre']));
  });

  it('misma persona, datos completos y vigente → COINCIDE', () => {
    const texto = comoPdfjs([
      'Entidad Promotora de Salud EPS SINTETICA S.A.', 'Nombre: LAURA SOFIA RAMIREZ ORTIZ', 'Documento: CC 1.032.456.786',
      'Estado: ACTIVO', 'Fecha de generación: 20/10/2026',
    ]);
    const r = compararCertificadoEps(valores(texto), ESTUDIANTE, contexto);
    expect(r.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(r.vigencia).toBe('vigente');
  });

  it.each([
    ['sin documento ni nombre', 'Entidad: EPS SINTETICA\nFecha de generación: 20/10/2026'],
    ['sin documento', 'Entidad: EPS SINTETICA\nNombre: LAURA SOFIA RAMIREZ ORTIZ\nFecha de generación: 20/10/2026'],
    ['sin nombre', 'Entidad: EPS SINTETICA\nDocumento: CC 1.032.456.786\nFecha de generación: 20/10/2026'],
    ['texto sin ningún dato', 'CERTIFICADO DE AFILIACION\nTexto sin los datos del afiliado.'],
  ])('%s → INFORMACIÓN INSUFICIENTE, nunca «coincide»', (_caso, texto) => {
    const r = compararCertificadoEps(valores(texto), ESTUDIANTE, contexto);
    expect(r.coincidencia).toBe(CoincidenciaEps.INSUFICIENTE);
    expect(r.coincidencia).not.toBe(CoincidenciaEps.COINCIDE);
  });
});

describe('Normalización que usa el extractor', () => {
  it('RC y variantes de cédula con palabras se entienden', () => {
    expect(normalizarDocumento('RC 1099887766')).toEqual({ tipo: 'RC', numero: '1099887766' });
    expect(normalizarDocumento('Registro Civil 1099887766')).toEqual({ tipo: 'RC', numero: '1099887766' });
    expect(normalizarDocumento('Cedula Ciudadania 79.555.444')).toEqual({ tipo: 'CC', numero: '79555444' });
    expect(normalizarDocumento('TI 1099887766').tipo).toBe('TI');
    expect(normalizarDocumento('CE 4455667').tipo).toBe('CE');
  });

  it('VIGENTE es activo y NO VIGENTE es inactivo', () => {
    expect(normalizarEstadoReportado('VIGENTE')).toBe('ACTIVO');
    expect(normalizarEstadoReportado('No vigente')).toBe('INACTIVO');
    expect(normalizarEstadoReportado('ACTIVO')).toBe('ACTIVO');
  });
});

// ── PDF real (pdf.js) con el diseño de tabla desordenada ────────────────────

/** Dibuja cada fragmento en su posición, en el orden dado (no el de lectura), como hacen los generadores reales. */
function pdfTabla(t: Tabla): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    const texto = (s: string, x: number, y: number): void => { doc.fontSize(9).text(s, x, y, { lineBreak: false }); };
    // Valores primero…
    texto(`${t.tipo} ${t.numero}`, 40, 300);
    texto(t.nombre, 40, 320);
    texto('BENEFICIARIO', 40, 340);
    texto(t.ingreso, 40, 360);
    texto('VIGENTE', 40, 380);
    // …etiquetas después, en una cabecera aparte.
    ['TIPO Y NÚMERO DE IDENTIFICACIÓN', 'FECHA DE INGRESO A EPS SINTETICA', 'NOMBRES Y APELLIDOS', 'TIPO DE AFILIADO', 'ESTADO DE LA AFILIACIÓN']
      .forEach((e, i) => texto(e, 40, 140 + i * 18));
    texto('EPS SINTETICA SALUD S.A.', 40, 60);
    texto('Fecha de generación:', 40, 700);
    texto(t.generacion, 40, 740);
    doc.end();
  });
}

describe('PDF sintético real: pdf.js → extractor → comparación', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalEpsService(lector);
  afterAll(async () => { await lector.onModuleDestroy(); });

  it('lee el certificado tipo tabla desde el PDF, lo da por vencido y detecta que es de otra persona', async () => {
    const r = await servicio.leer(await pdfTabla(FICTICIO), 'application/pdf');
    expect(r.ilegible).toBe(false);
    expect(r.resumen.ocr.ejecutado).toBe(false);
    expect(r.campos.documento_afiliado.valor).toBe('RC 1099887766');
    expect(r.campos.nombre_afiliado.valor).toBe('SAMUEL ANDRES FICTICIO PRUEBA');
    expect(r.campos.estado_afiliacion.valor).toBe('VIGENTE');
    expect(r.campos.fecha_expedicion.valor).toBe('13/01/2014');
    expect(r.campos.tipo_afiliado.valor).toBe('BENEFICIARIO');
    const datos = construirDatosExtraidosEps(r.campos);
    const cmp = compararCertificadoEps(datos, ESTUDIANTE, { ahora: AHORA, diasVigencia: 30 });
    expect(cmp.vigencia).toBe('vencido');
    expect(cmp.coincidencia).toBe(CoincidenciaEps.DISCREPANCIA);
  });
});
