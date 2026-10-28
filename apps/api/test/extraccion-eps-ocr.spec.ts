import { construirDatosExtraidosEps } from '../src/domain/services/comparacion-eps.domain-service';
import { evaluarSuficienciaEps, extraerCamposEps } from '../src/domain/services/extraccion-eps-local.domain-service';
import { LecturaLocalEps, LecturaLocalEpsService } from '../src/domain/services/lectura-local-eps.domain-service';
import { LectorDocumentoLocalPort, ResultadoOcrPagina, VarianteOcr } from '../src/domain/ports/out/lector-documento-local.port';

/**
 * Texto de OCR de certificados «de carta» (CERTIFICA QUE … identificado con …), con los defectos típicos del OCR sobre un escaneo:
 * tratamiento con paréntesis dañados, logotipo partido en dos líneas, etiquetas con letras cambiadas y la fecha escrita en prosa.
 * Todo SINTÉTICO: ningún dato de una persona real.
 */
const CARTA_OCR = [
  'Alian Salud',
  'eps',
  'CERTIFICA QUE:',
  'ElLa) Señora) PERSONA PRUEBA EJEMPLO identificado con CC 123456789 cabeza de familia',
  'se encuentra afiliado(a) a nuestra EPS',
  'Los siguientes son los datos básicos de dicha afiliación:',
  'Fecha de Afiliación: 01/02/2024',
  'Estado: ACTIVO',
  'Tipc de Aniado: COTIZANTE',
  'La presente certificación se expide a solicitud del interesado en Bogotá a los',
  '20 días del mes de octubre del año 2026',
  'La certificación tiene validez de un mes con respecto a la fecha de generación.',
  'Cordialmente,',
  'ALIAN SALUD EPS.',
].join('\n');

const texto = (...lineas: string[]): string => lineas.join('\n');
const leerOcr = (t: string, confianza = 0.8) => extraerCamposEps(t, 'ocr', confianza);
const valor = (t: string, campo: string): string | null => leerOcr(t)[campo].valor;

describe('Parser de certificados EPS · variantes de carta y de OCR', () => {
  it('carta con OCR defectuoso: reconoce entidad, nombre, documento, fecha, estado y tipo de afiliado', () => {
    const c = leerOcr(CARTA_OCR);
    expect(c.entidad_emisora.valor).toBe('Alian Salud EPS');
    expect(c.nombre_afiliado.valor).toBe('PERSONA PRUEBA EJEMPLO'); // sin «ElLa) Señora)»
    expect(c.documento_afiliado.valor).toBe('CC 123456789');
    expect(c.fecha_expedicion.valor).toBe('20 de octubre de 2026');
    expect(c.estado_afiliacion.valor).toBe('ACTIVO');
    expect(c.tipo_afiliado.valor).toBe('COTIZANTE');
    expect(c.regimen.valor).toBeNull(); // no figura en el documento: no se inventa
    expect(evaluarSuficienciaEps(c)).toEqual({ campos: 5, suficiencia: 'procesable' });
  });

  it('normalizado: la fecha queda en ISO y el tipo de afiliado en minúsculas', () => {
    const d = construirDatosExtraidosEps(leerOcr(CARTA_OCR));
    expect(d).toMatchObject({ tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'PERSONA PRUEBA EJEMPLO', estadoReportadoCertificado: 'ACTIVO', tipoAfiliado: 'cotizante', fechaExpedicion: '2026-10-20' });
  });

  it('la fecha de AFILIACIÓN nunca se toma como fecha de expedición', () => {
    const soloAfiliacion = texto('Alian Salud EPS', 'Fecha de afiliación: 01/02/2024', 'Estado: ACTIVO');
    expect(valor(soloAfiliacion, 'fecha_expedicion')).toBeNull();
    const conGeneracion = texto('Alian Salud EPS', 'Fecha de afiliación: 01/02/2024', 'Fecha de generación: 20/10/2026', 'Estado: ACTIVO');
    expect(valor(conGeneracion, 'fecha_expedicion')).toBe('20/10/2026');
    // «Fecha de activación de servicios» tampoco.
    expect(valor(texto('Fecha de Activación de Servicios: 12/03/2019', 'Estado: ACTIVO'), 'fecha_expedicion')).toBeNull();
  });

  it.each([
    ['Fecha de expedición: 20/10/2026', '20/10/2026'],
    ['Fecha de generación: 20/10/2026', '20/10/2026'],
    ['Fecha de impresión: 20-10-2026', '20-10-2026'],
    ['Expedido el 20 de octubre de 2026', '20 de octubre de 2026'],
    ['a los 20 días del mes de octubre de 2.026', '20 de octubre de 2026'],
    ['a los 20 días del mes de octubre del año 2026', '20 de octubre de 2026'],
  ])('fecha de expedición: «%s»', (linea, esperado) => {
    expect(valor(texto('Alian Salud EPS', linea), 'fecha_expedicion')).toBe(esperado);
  });

  it.each([
    'identificado(a) con C.C. 123.456.789',
    'identificado con CC 123456789',
    'identificada con cédula de ciudadanía No. 123456789',
    'identificado con CÉDULA N° 123456789',
    'identificado con documento número 123456789',
  ])('documento: «%s»', (frase) => {
    const t = texto('CERTIFICA QUE:', `El señor PERSONA PRUEBA EJEMPLO ${frase}`, 'se encuentra afiliado');
    expect((valor(t, 'documento_afiliado') ?? '').replace(/\D/g, '')).toBe('123456789');
  });

  it.each([['VIGENTE', 'VIGENTE'], ['ACTIVO', 'ACTIVO'], ['ACTIVA', 'ACTIVA']])('estado «%s»', (v, esperado) => {
    expect(valor(texto('Estado: ' + v), 'estado_afiliacion')).toBe(esperado);
  });

  it.each([['Tipo de Afiliado: COTIZANTE', 'COTIZANTE'], ['Tipo de afiliado: Beneficiario', 'Beneficiario'], ['Tipc de Aniado: COTIZANTE', 'COTIZANTE'], ['Calidad: BENEFICIARIO', 'BENEFICIARIO']])(
    'tipo de afiliado «%s»', (linea, esperado) => {
      expect(valor(texto(linea), 'tipo_afiliado')).toBe(esperado);
    },
  );

  it('logotipo «Alian Salud» / «EPS» partido en dos líneas: la entidad no es solo «eps»', () => {
    expect(valor(texto('Alian Salud', 'eps', 'CERTIFICA QUE:'), 'entidad_emisora')).toBe('Alian Salud EPS');
  });

  it('sin la firma ni el logotipo: la entidad sale de la frase «afiliado(a) a nuestra EPS» solo si trae nombre; si no, queda ausente', () => {
    const c = leerOcr(texto('CERTIFICA QUE:', 'se encuentra afiliado(a) a nuestra EPS'));
    expect(c.entidad_emisora.valor).toBeNull();
  });

  it('un tratamiento no se confunde con un nombre de pila («Elena» se conserva)', () => {
    const t = texto('CERTIFICA QUE:', 'El(La) Señor(a) Elena Ortiz Pérez identificado con CC 123456789');
    expect(valor(t, 'nombre_afiliado')).toBe('Elena Ortiz Pérez');
  });
});

describe('Suficiencia de la lectura (campos clave, no cantidad de texto)', () => {
  const con = (n: number) => {
    const campos = extraerCamposEps('', 'ocr', 0.8);
    ['nombre_afiliado', 'documento_afiliado', 'entidad_emisora', 'estado_afiliacion', 'fecha_expedicion'].slice(0, n)
      .forEach((c) => { campos[c] = { valor: 'x', confianza: 0.8, evidencia: null, fuente: 'ocr' }; });
    return campos;
  };
  it.each([[0, 'insuficiente'], [1, 'insuficiente'], [2, 'debil'], [3, 'procesable'], [5, 'procesable']])('%i campos clave → %s', (n, esperado) => {
    expect(evaluarSuficienciaEps(con(n)).suficiencia).toBe(esperado);
  });
  it('mucho texto sin campos es insuficiente: producir texto no es éxito', () => {
    const c = leerOcr('lorem ipsum dolor sit amet '.repeat(200));
    expect(evaluarSuficienciaEps(c)).toEqual({ campos: 0, suficiencia: 'insuficiente' });
  });
});

// ── Estrategia de OCR determinística: original → bloque → reforzada ─────────

function lectorConOcr(respuestas: Partial<Record<VarianteOcr, ResultadoOcrPagina | Error>>) {
  const llamadas: VarianteOcr[] = [];
  const lector: LectorDocumentoLocalPort = {
    extraerTextoNativo: () => Promise.resolve({ paginas: 1, porPagina: [{ pagina: 1, texto: '' }] }),
    renderizarPagina: () => Promise.resolve({ pagina: 1, ancho: 10, alto: 10, imagen: Buffer.from('png') }),
    prepararImagen: () => Promise.resolve({ pagina: 1, ancho: 10, alto: 10, imagen: Buffer.from('png') }),
    detectarQr: () => Promise.resolve([]),
    ejecutarOcr: (_i, _p, _l, variante = 'automatica') => {
      llamadas.push(variante);
      const r = respuestas[variante];
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r ?? { pagina: null, texto: '', confianza: 0, giro: 0 });
    },
  };
  return { servicio: new LecturaLocalEpsService(lector), llamadas };
}
const ocr = (t: string, confianza = 80): ResultadoOcrPagina => ({ pagina: 1, texto: t, confianza, giro: 0 });
const leer = (s: LecturaLocalEpsService): Promise<LecturaLocalEps> => s.leer(Buffer.from('%PDF'), 'application/pdf');

describe('OCR escalonado y determinístico', () => {
  it('si la primera pasada ya dio todos los campos clave, NO se repite el OCR', async () => {
    const { servicio, llamadas } = lectorConOcr({ automatica: ocr(CARTA_OCR) });
    const r = await leer(servicio);
    expect(llamadas).toEqual(['automatica']);
    expect(r.resumen.ocr).toMatchObject({ ejecutado: true, intentos: 1, suficiencia: 'procesable' });
  });

  it('si la primera no basta, prueba «bloque» y luego «reforzada», en ese orden, y se queda con la que más campos dio', async () => {
    const pobre = ocr('Alian Salud\neps\nCERTIFICA QUE:', 70);
    const { servicio, llamadas } = lectorConOcr({ automatica: pobre, bloque: ocr(CARTA_OCR.split('\n').slice(0, 9).join('\n'), 75), reforzada: ocr(CARTA_OCR, 78) });
    const r = await leer(servicio);
    expect(llamadas).toEqual(['automatica', 'bloque', 'reforzada']);
    expect(r.resumen.ocr.intentos).toBe(3);
    expect(r.campos.fecha_expedicion.valor).toBe('20 de octubre de 2026'); // solo la tercera lo traía
  });

  it('se detiene en cuanto una pasada completa los campos clave', async () => {
    const { servicio, llamadas } = lectorConOcr({ automatica: ocr('Alian Salud\neps', 70), bloque: ocr(CARTA_OCR, 75) });
    await leer(servicio);
    expect(llamadas).toEqual(['automatica', 'bloque']);
  });

  it('una pasada que devuelve lo mismo no justifica seguir gastando CPU', async () => {
    const igual = ocr('texto sin campos reconocibles', 60);
    const { servicio, llamadas } = lectorConOcr({ automatica: igual, bloque: igual, reforzada: igual });
    const r = await leer(servicio);
    expect(llamadas).toEqual(['automatica', 'bloque']);
    expect(r.resumen.ocr.suficiencia).toBe('insuficiente');
  });

  it('si una pasada falla (tiempo, motor) no se insiste: queda lo ya leído y se anota el error', async () => {
    const { servicio, llamadas } = lectorConOcr({ automatica: ocr('Alian Salud\neps', 70), bloque: new Error('motor caído') });
    const r = await leer(servicio);
    expect(llamadas).toEqual(['automatica', 'bloque']);
    expect(r.resumen.errores).toContain('ocr_fallido');
    expect(r.campos.entidad_emisora.valor).toBe('Alian Salud EPS');
  });

  it('nunca inventa: sin campos en ninguna pasada, todo queda ausente', async () => {
    const { servicio } = lectorConOcr({ automatica: ocr('ruido'), bloque: ocr('mas ruido'), reforzada: ocr('aun mas ruido') });
    const r = await leer(servicio);
    expect(Object.values(r.campos).every((c) => c.valor === null)).toBe(true);
  });
});

describe('Confianza del OCR → datos comparables (regresión de «Datos extraídos» vacíos con OCR)', () => {
  it('una lectura de OCR con confianza media 77/100 NO se descarta: sus campos llegan a datosExtraidos', async () => {
    const { servicio } = lectorConOcr({ automatica: ocr(CARTA_OCR, 77) });
    const r = await leer(servicio);
    const d = construirDatosExtraidosEps(r.campos);
    expect(d).toMatchObject({ nombre: 'PERSONA PRUEBA EJEMPLO', numeroDocumento: '123456789', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20' });
    expect(Object.values(d.fuentes ?? {}).every((f) => f === 'ocr')).toBe(true);
  });

  it('una lectura de OCR mala (confianza media 50) SÍ se descarta de los datos comparables: no se compara contra ruido', async () => {
    const { servicio } = lectorConOcr({ automatica: ocr(CARTA_OCR, 50), bloque: ocr(CARTA_OCR + ' ', 50), reforzada: ocr(CARTA_OCR + '  ', 50) });
    const r = await leer(servicio);
    expect(construirDatosExtraidosEps(r.campos).numeroDocumento).toBeNull();
  });
});
