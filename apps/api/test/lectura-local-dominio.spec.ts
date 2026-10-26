import {
  CAMPOS_CLAVE_EPS, combinarLecturas, extraerCamposEps, faltanCamposClave,
} from '../src/domain/services/extraccion-eps-local.domain-service';
import {
  LIMITES_LECTURA_EPS, MAX_LONGITUD_CONTENIDO_QR, clasificarContenidoQr, evaluarTextoNativo, paginasParaOcr,
} from '../src/domain/services/lectura-local.domain-service';
import { construirDatosExtraidosEps } from '../src/domain/services/comparacion-eps.domain-service';

/**
 * Reglas determinísticas de la lectura local: cuándo basta el texto nativo, cómo
 * se clasifica el contenido de un QR (sin seguirlo) y cómo se extraen y combinan
 * los campos del certificado de EPS. Dominio puro: sin librerías ni red.
 */

const TEXTO_EPS = [
  'Entidad Promotora de Salud NUEVA EPS S.A.',
  'CERTIFICADO DE AFILIACION',
  'Nombre: LAURA SOFIA RAMIREZ ORTIZ',
  'Documento: CC 1.032.456.786',
  'Régimen: Contributivo - Beneficiario',
  'Estado: ACTIVO',
  'Fecha de expedición: 20/10/2026',
].join('\n');

const pagina = (n: number, texto: string) => ({ pagina: n, texto });

describe('Texto nativo · ¿alcanza o hace falta OCR?', () => {
  it('un PDF con texto real es utilizable y NO pide OCR', () => {
    const m = evaluarTextoNativo(1, [pagina(1, TEXTO_EPS)]);
    expect(m).toMatchObject({ paginas: 1, paginasLeidas: 1, paginasConTexto: 1, utilizable: true, paginasSinTexto: [] });
    expect(m.caracteres).toBeGreaterThan(100);
    expect(paginasParaOcr(m, false)).toEqual([]);
  });

  it.each([
    ['sin texto (escaneado)', ''],
    ['solo espacios', '   \n  \n '],
    ['texto insuficiente', 'Hoja 1'],
    ['basura de codificación', '����\u0001\u0002\u0003 '],
  ])('%s: no es utilizable y pide OCR de esa página', (_c, texto) => {
    const m = evaluarTextoNativo(1, [pagina(1, texto)]);
    expect(m.utilizable).toBe(false);
    expect(m.paginasConTexto).toBe(0);
    expect(paginasParaOcr(m, true)).toEqual([1]);
    expect(paginasParaOcr(m, false)).toEqual([1]);
  });

  it('con texto utilizable, el OCR solo se intenta si faltan campos clave Y hay páginas sin texto', () => {
    const m = evaluarTextoNativo(2, [pagina(1, TEXTO_EPS), pagina(2, '')]);
    expect(m).toMatchObject({ utilizable: true, paginasConTexto: 1, paginasSinTexto: [2] });
    expect(paginasParaOcr(m, false)).toEqual([]); // todo está: no se paga OCR por una hoja en blanco
    expect(paginasParaOcr(m, true)).toEqual([2]); // falta algo y esa hoja podría tenerlo
  });

  it('cuenta las páginas del documento aunque solo se lean algunas', () => {
    const m = evaluarTextoNativo(40, [pagina(1, TEXTO_EPS)]);
    expect(m.paginas).toBe(40);
    expect(m.paginasLeidas).toBe(1);
  });

  it('los límites del certificado de EPS son conservadores', () => {
    expect(LIMITES_LECTURA_EPS.maxPaginas).toBeLessThanOrEqual(5);
    expect(LIMITES_LECTURA_EPS.maxPaginasDocumento).toBeLessThanOrEqual(20);
    expect(LIMITES_LECTURA_EPS.maxPixeles).toBeLessThanOrEqual(8_000_000);
    expect(LIMITES_LECTURA_EPS.timeoutMs).toBeLessThanOrEqual(60_000);
  });
});

describe('Contenido de QR · se clasifica, no se sigue', () => {
  it('una URL conserva protocolo, host y ruta; pierde parámetros, fragmento y usuario', () => {
    const k = clasificarContenidoQr('https://eps.example/validar/abc?token=SECRETO&id=1#frag');
    expect(k.tipo).toBe('url');
    expect(k.host).toBe('eps.example');
    expect(k.origenSanitizado).toBe('https://eps.example/validar/abc');
    expect(k.tieneParametros).toBe(true);
    expect(JSON.stringify(k)).not.toContain('SECRETO');
    expect(k.origenSanitizado).not.toMatch(/[?#]/);
  });

  it('una URL sin parámetros se marca sin parámetros y sin señales', () => {
    const k = clasificarContenidoQr('https://eps.example/validar');
    expect(k).toMatchObject({ tipo: 'url', tieneParametros: false, senales: [] });
  });

  it('un dominio «malicioso» sintético: solo señales sintácticas, sin consultar nada', () => {
    const k = clasificarContenidoQr('http://usuario:clave@xn--80ak6aa92e.com:8080/login?next=//otro');
    expect(k.tipo).toBe('url');
    expect(k.senales).toEqual(expect.arrayContaining(['esquema_no_https', 'credenciales_en_url', 'punycode', 'puerto_explicito']));
    expect(k.origenSanitizado).not.toContain('usuario');
    expect(k.origenSanitizado).not.toContain('clave');
    expect(k.origenSanitizado).not.toMatch(/[?#@]/);
  });

  it('un host por IP se señala', () => {
    expect(clasificarContenidoQr('https://192.168.0.10/validar').senales).toContain('host_ip');
  });

  it.each(['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///etc/passwd', 'intent://x#Intent;end'])(
    'esquema no web «%s»: tipo otro y sin contenido conservado', (contenido) => {
      const k = clasificarContenidoQr(contenido);
      expect(k.tipo).toBe('otro');
      expect(k.senales).toContain('esquema_no_web');
      expect(k.origenSanitizado).toBeNull();
      expect(k.host).toBeNull();
    },
  );

  it('texto imprimible: tipo texto, sin conservarlo; solo su hash y longitud', () => {
    const k = clasificarContenidoQr('AFILIADO-1032456786-ACTIVO');
    expect(k.tipo).toBe('texto');
    expect(k.origenSanitizado).toBeNull();
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.longitud).toBe(26);
    expect(JSON.stringify(k)).not.toContain('1032456786');
  });

  it('caracteres de control o contenido excesivo: tipo otro', () => {
    expect(clasificarContenidoQr('abc\u0001\u0002').tipo).toBe('otro');
    const largo = clasificarContenidoQr(`https://eps.example/${'a'.repeat(MAX_LONGITUD_CONTENIDO_QR)}`);
    expect(largo.tipo).toBe('otro');
    expect(largo.senales).toContain('longitud_excesiva');
    expect(largo.origenSanitizado).toBeNull();
  });

  it('el mismo contenido da el mismo hash; contenidos distintos, hashes distintos', () => {
    expect(clasificarContenidoQr('a').hash).toBe(clasificarContenidoQr('a').hash);
    expect(clasificarContenidoQr('a').hash).not.toBe(clasificarContenidoQr('b').hash);
  });

  it('vacío: sin tipo útil', () => {
    expect(clasificarContenidoQr('').tipo).toBe('otro');
  });
});

describe('Extracción estructurada del certificado de EPS (texto → campos)', () => {
  it('lee los seis campos de un certificado típico, con su fuente', () => {
    const c = extraerCamposEps(TEXTO_EPS, 'texto_nativo', 0.92);
    expect(c.entidad_emisora.valor).toMatch(/NUEVA EPS/);
    expect(c.nombre_afiliado.valor).toBe('LAURA SOFIA RAMIREZ ORTIZ');
    expect(c.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
    expect(c.fecha_expedicion.valor).toBe('20/10/2026');
    expect(c.estado_afiliacion.valor).toBe('ACTIVO');
    expect(c.regimen.valor).toMatch(/Contributivo/);
    for (const campo of Object.values(c)) {
      expect(campo.fuente).toBe('texto_nativo');
      expect(campo.confianza).toBeCloseTo(0.92);
    }
  });

  it('el campo que no aparece es null: no se inventa', () => {
    const c = extraerCamposEps('CERTIFICADO DE AFILIACION\nTexto sin los datos del afiliado en ninguna parte visible.', 'texto_nativo', 0.92);
    expect(c.documento_afiliado).toEqual({ valor: null, confianza: 0, evidencia: null, fuente: null });
    expect(c.nombre_afiliado.valor).toBeNull();
    expect(c.fecha_expedicion.valor).toBeNull();
  });

  it('nombre con tildes y ñ', () => {
    const c = extraerCamposEps('Nombre: MARÍA JOSÉ NÚÑEZ PEÑA\nDocumento: 52.123.456', 'texto_nativo', 0.9);
    expect(c.nombre_afiliado.valor).toBe('MARÍA JOSÉ NÚÑEZ PEÑA');
  });

  it.each([
    ['Documento: CC 1.032.456.786', /1\.032\.456\.786/],
    ['Número de documento: 1032456786', /1032456786/],
    ['Identificación: C.C. 1 032 456 786', /1 032 456 786/],
    ['Cédula de ciudadanía No. 1032456786', /1032456786/],
    ['identificado con cédula de ciudadanía número 1.032.456.786', /1\.032\.456\.786/],
  ])('número de documento con separadores y etiquetas: «%s»', (linea, esperado) => {
    expect(extraerCamposEps(linea, 'texto_nativo', 0.9).documento_afiliado.valor).toMatch(esperado);
  });

  it('el certificado en prosa: nombre y documento de «que el señor X, identificado con…»', () => {
    const t = 'Se certifica que la señora LAURA SOFIA RAMIREZ ORTIZ, identificada con cédula de ciudadanía No. 1.032.456.786, se encuentra activa.';
    const c = extraerCamposEps(t, 'texto_nativo', 0.9);
    expect(c.nombre_afiliado.valor).toBe('LAURA SOFIA RAMIREZ ORTIZ');
    expect(c.documento_afiliado.valor).toMatch(/1\.032\.456\.786/);
  });

  it.each([
    ['Fecha de expedición: 20/10/2026', '20/10/2026'],
    ['Fecha de expedición: 2026-10-20', '2026-10-20'],
    ['Fecha de expedición: 20 de octubre de 2026', '20 de octubre de 2026'],
    ['Expedido en Bogotá, a los 20 días del mes de octubre de 2026', '20 de octubre de 2026'],
  ])('fecha de expedición: «%s»', (linea, esperada) => {
    expect(extraerCamposEps(linea, 'texto_nativo', 0.9).fecha_expedicion.valor).toBe(esperada);
  });

  it('NO confunde la fecha de afiliación con la de expedición', () => {
    const c = extraerCamposEps('Fecha de afiliación: 01/02/2024\nNombre: ANA PEREZ GOMEZ', 'texto_nativo', 0.9);
    expect(c.fecha_expedicion.valor).toBeNull();
  });

  it.each([
    ['NUEVA EPS S.A.', 'NUEVA'],
    ['EPS SANITAS', 'SANITAS'],
    ['Salud Total EPS S.A.', 'SALUD TOTAL'],
  ])('entidad emisora desde el encabezado: «%s»', (encabezado, clave) => {
    const c = extraerCamposEps(`${encabezado}\nCERTIFICADO DE AFILIACION\nNombre: ANA PEREZ GOMEZ`, 'texto_nativo', 0.9);
    expect(construirDatosExtraidosEps({ ...c, entidad_emisora: { ...c.entidad_emisora } }).epsClave).toBe(clave);
  });

  it('EPS con alias: otra denominación de la misma entidad normaliza igual', () => {
    const a = construirDatosExtraidosEps({ entidad_emisora: { valor: 'NUEVA EPS', confianza: 0.9 } });
    const b = construirDatosExtraidosEps({ entidad_emisora: { valor: 'Nueva E.P.S. S.A.S.', confianza: 0.9 } });
    expect(a.epsClave).toBe(b.epsClave);
  });

  it('el estado que DICE el certificado se lee tal cual: no es la afiliación', () => {
    const c = extraerCamposEps('Estado de afiliación: SUSPENDIDO', 'texto_nativo', 0.9);
    expect(c.estado_afiliacion.valor).toBe('SUSPENDIDO');
    const d = construirDatosExtraidosEps({ estado_afiliacion: { valor: 'ACTIVO', confianza: 0.9 } });
    expect(d.estadoReportadoCertificado).toBe('ACTIVO');
  });

  it('régimen y tipo de afiliado, también cuando vienen en etiquetas separadas', () => {
    const c = extraerCamposEps('Régimen: Subsidiado\nTipo de afiliado: Cotizante', 'texto_nativo', 0.9);
    expect(c.regimen.valor).toMatch(/Subsidiado.*Cotizante/);
  });

  it('la confianza de un campo OCR se respeta y puede quedar bajo el umbral de comparación', () => {
    const c = extraerCamposEps(TEXTO_EPS, 'ocr', 0.5);
    expect(c.nombre_afiliado.fuente).toBe('ocr');
    expect(construirDatosExtraidosEps(c).nombre).toBeNull(); // 0,5 < 0,7: cuenta como no leído
  });

  it('los datos extraídos registran la fuente de cada campo (sin mezclar)', () => {
    const nativo = extraerCamposEps(TEXTO_EPS, 'texto_nativo', 0.92);
    const datos = construirDatosExtraidosEps(nativo);
    expect(datos.fuentes).toMatchObject({ nombre_afiliado: 'texto_nativo', documento_afiliado: 'texto_nativo' });
  });
});

describe('Combinación de fuentes (texto nativo vs OCR)', () => {
  const nativo = () => extraerCamposEps(TEXTO_EPS, 'texto_nativo', 0.92);

  it('una sola fuente: se usa tal cual', () => {
    const { campos, discrepancias } = combinarLecturas([nativo()]);
    expect(discrepancias).toEqual([]);
    expect(campos.nombre_afiliado.fuente).toBe('texto_nativo');
  });

  it('dos fuentes que coinciden (aunque con otro formato): gana la de mayor prioridad, sin discrepancia', () => {
    const ocr = extraerCamposEps(TEXTO_EPS.replace('1.032.456.786', '1032456786').replace('LAURA SOFIA', 'Laura Sofía'), 'ocr', 0.8);
    const { campos, discrepancias } = combinarLecturas([nativo(), ocr]);
    expect(discrepancias).toEqual([]);
    expect(campos.documento_afiliado.fuente).toBe('texto_nativo');
  });

  it('dos fuentes que DIFIEREN: no se escoge ninguna, el campo queda sin valor y se registra la discrepancia', () => {
    const ocr = extraerCamposEps(TEXTO_EPS.replace('1.032.456.786', '1.032.456.787'), 'ocr', 0.8);
    const { campos, discrepancias } = combinarLecturas([nativo(), ocr]);
    expect(discrepancias).toEqual([{ campo: 'documento_afiliado', fuentes: ['texto_nativo', 'ocr'] }]);
    expect(campos.documento_afiliado.valor).toBeNull();
    expect(campos.documento_afiliado.confianza).toBe(0);
    expect(campos.nombre_afiliado.valor).not.toBeNull(); // lo que no difiere se conserva
  });

  it('un campo que solo una fuente leyó se conserva con SU fuente', () => {
    const ocr = extraerCamposEps('Fecha de expedición: 20/10/2026', 'ocr', 0.8);
    const parcial = extraerCamposEps('Nombre: ANA PEREZ GOMEZ', 'texto_nativo', 0.92);
    const { campos } = combinarLecturas([parcial, ocr]);
    expect(campos.nombre_afiliado.fuente).toBe('texto_nativo');
    expect(campos.fecha_expedicion.fuente).toBe('ocr');
  });

  it('«faltan campos clave» se detecta sobre los cuatro de identidad y vigencia', () => {
    expect(CAMPOS_CLAVE_EPS).toEqual(['nombre_afiliado', 'documento_afiliado', 'entidad_emisora', 'fecha_expedicion']);
    expect(faltanCamposClave(nativo())).toBe(false);
    expect(faltanCamposClave(extraerCamposEps('Nombre: ANA PEREZ GOMEZ', 'texto_nativo', 0.9))).toBe(true);
  });
});
