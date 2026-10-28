import { EstadoAdres } from '../src/domain/entities/adres';
import {
  AfiliacionEps, DatosExtraidosEps, EstadoProcesamientoEps, ValidacionEps,
} from '../src/domain/entities/validacion-eps.entity';
import { CoincidenciaEps } from '../src/domain/entities/validacion-eps.entity';
import { clasificarDocumentoEps } from '../src/domain/services/clasificacion-documental-eps.domain-service';
import { construirDiscrepancias, esDocumentoIncorrecto, recomendacionActual } from '../src/domain/services/mesa-eps.domain-service';
import { RecomendacionEps } from '../src/domain/entities/adres';

/**
 * La clasificación es por CONTENIDO (conjunto de señales con peso), no por una frase ni por el nombre del archivo. Los textos son
 * SINTÉTICOS. «No pude leerlo» (no_determinable) no se confunde con «lo leí y es de otro tipo» (documento_incorrecto).
 */

const CERTIFICADO_EPS = [
  'Entidad Promotora de Salud EPS PRUEBA S.A.', 'CERTIFICADO DE AFILIACION', 'CERTIFICA QUE:',
  'El señor PERSONA PRUEBA EJEMPLO identificado con CC 123456789 se encuentra afiliado(a) a nuestra EPS',
  'Estado de afiliación: ACTIVO', 'Régimen: Contributivo - Cotizante', 'Tipo de afiliado: COTIZANTE',
  'Fecha de afiliación: 01/02/2024', 'Plan de Beneficios en Salud', 'Fecha de generación: 20/10/2026',
].join('\n');

const CERTIFICACION_LABORAL = [
  'EMPRESA EJEMPLO S.A.S. NIT 900.000.000-1', 'CERTIFICA QUE:',
  'PERSONA PRUEBA EJEMPLO identificado con CC 123456789 laboró en la empresa desde el 01/02/2020.',
  'Cargo: Analista de Operaciones', 'Salario: $ 3.500.000 mensuales', 'Tipo de contrato: Término Indefinido',
  'Fecha de inicio del contrato: 01/02/2020', 'La presente certificación laboral se expide a solicitud del interesado.',
  'Representante Legal',
].join('\n');

/** Emisor que ES una EPS: su razón social lo dice, pero el contenido es laboral y tributario. */
const CARTA_LABORAL_DE_UNA_EPS = [
  'Fundación Ejemplo EPS', 'Representante Legal de FUNDACION EJEMPLO EPS NIT 900.000.000-1', 'CERTIFICA:',
  'Que las personas relacionadas a continuación tienen o tuvieron vinculación laboral para el año gravable 2022 con FUNDACION EJEMPLO EPS,',
  'haciendo parte del personal directivo, así:', 'Documento | Nombre | Valor Causado año 2022 | Fecha | Tipo de contrato',
  '123456789 | PERSONA PRUEBA EJEMPLO | 88.933.333 | 01/10/2021 | Término Indefinido',
  'La presente certificación se expide con destino a la Dirección de Impuestos y Aduanas Nacionales.', 'Representante Legal', 'Fundación Ejemplo EPS',
].join('\n');

const AMBIGUO = 'Oficina de atención al ciudadano. Se certifica que la persona mencionada es conocida de esta oficina y que la presente constancia se expide a solicitud del interesado para los fines que estime convenientes.';

describe('Clasificación documental local (por contenido)', () => {
  it.each([
    ['certificado de afiliación EPS claro', CERTIFICADO_EPS, 'certificado_eps_probable'],
    ['certificación laboral clara', CERTIFICACION_LABORAL, 'documento_incorrecto'],
    ['carta laboral de una entidad cuya razón social contiene «EPS»', CARTA_LABORAL_DE_UNA_EPS, 'documento_incorrecto'],
    ['documento ambiguo', AMBIGUO, 'no_determinable'],
    ['texto vacío', '', 'no_determinable'],
    ['ruido de OCR ilegible', 'a0 xq ;; ~~ lk 9z |||| 1 2 3 \\ / ... ,,, ñ', 'no_determinable'],
  ])('%s → %s', (_n, texto, esperado) => {
    expect(clasificarDocumentoEps(texto).tipo).toBe(esperado);
  });

  it('una palabra suelta «EPS» NO prueba que sea un certificado de EPS', () => {
    const c = clasificarDocumentoEps('Comunicado interno de la oficina de comunicaciones de la EPS sobre la jornada de capacitación del equipo y los horarios de atención al público durante el mes.');
    expect(c.tipo).not.toBe('certificado_eps_probable');
  });

  it('la carta laboral de una «… EPS» da motivos laborales y la falta de indicadores de afiliación; la EPS en la razón social casi no pesa', () => {
    const c = clasificarDocumentoEps(CARTA_LABORAL_DE_UNA_EPS);
    expect(c.motivos).toEqual(expect.arrayContaining(['contiene_indicadores_laborales', 'contiene_vinculacion_laboral', 'faltan_indicadores_afiliacion']));
    expect(c.puntajeEps).toBeLessThanOrEqual(1.5);
    expect(c.puntajeOtro).toBeGreaterThanOrEqual(4);
  });

  it('el certificado de EPS da motivos de afiliación (estado, tipo de afiliado, fecha de afiliación)', () => {
    const c = clasificarDocumentoEps(CERTIFICADO_EPS);
    expect(c.motivos).toEqual(expect.arrayContaining(['contiene_estado_afiliacion', 'contiene_tipo_afiliado', 'contiene_fecha_afiliacion', 'contiene_certifica_afiliado']));
  });

  it('un certificado de EPS que menciona «empleador» o «salario base» sigue siendo probable (las señales de otro tipo no mandan solas)', () => {
    const c = clasificarDocumentoEps(`${CERTIFICADO_EPS}\nEmpleador: EMPRESA EJEMPLO\nSalario base de cotización: 3.500.000\nRepresentante Legal`);
    expect(c.tipo).toBe('certificado_eps_probable');
  });

  it('señales fuertes de los DOS lados: no se decide (no_determinable), una persona lo revisa', () => {
    const c = clasificarDocumentoEps(`${CERTIFICADO_EPS}\n${CERTIFICACION_LABORAL}\nVinculación laboral. Personal directivo. Valor causado.`);
    expect(c.tipo).toBe('no_determinable');
    expect(c.motivos[0]).toBe('senales_contradictorias');
  });

  it('solo devuelve veredicto, códigos y puntajes: nunca fragmentos del texto', () => {
    const c = clasificarDocumentoEps(CARTA_LABORAL_DE_UNA_EPS);
    const serializado = JSON.stringify(c);
    for (const dato of ['PERSONA PRUEBA', '123456789', 'Fundación Ejemplo', 'FUNDACION EJEMPLO']) expect(serializado).not.toContain(dato);
    expect(c.motivos.every((m) => /^[a-z_]+$/.test(m))).toBe(true);
  });

  it('es determinística y no depende de mayúsculas ni tildes', () => {
    const a = clasificarDocumentoEps(CERTIFICADO_EPS);
    const b = clasificarDocumentoEps(CERTIFICADO_EPS.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    expect(b).toEqual(a);
  });
});

describe('Documento incorrecto · ADRES y Mesa', () => {
  const datos = (tipo?: DatosExtraidosEps['tipoDocumentoDetectado']): DatosExtraidosEps => ({
    tipoDocumento: null, numeroDocumento: null, nombre: null, eps: 'EPS PRUEBA', epsClave: 'PRUEBA', regimen: null, tipoAfiliado: null,
    estadoReportadoCertificado: null, fechaExpedicion: null, ...(tipo ? { tipoDocumentoDetectado: tipo, motivosClasificacion: [] } : {}),
  });
  const procesar = (tipo?: DatosExtraidosEps['tipoDocumentoDetectado']) => {
    const ahora = new Date('2026-10-28T12:00:00Z');
    const v = ValidacionEps.pendiente({ id: 'v1', documentoId: 'd1', practicaId: 'p1', estudianteId: 'e1', ahora, recibidaEn: ahora });
    v.registrarProcesamiento({ datosExtraidos: datos(tipo), coincidencia: CoincidenciaEps.INSUFICIENTE, discrepancias: [], vigencia: 'no_determinada', hayBanderaCritica: false }, ahora);
    return v.instantanea();
  };

  it.each([
    ['documento_incorrecto', EstadoAdres.NO_REQUERIDO],
    ['no_determinable', EstadoAdres.NO_REQUERIDO],
    ['certificado_eps_probable', EstadoAdres.PENDIENTE],
    [undefined, EstadoAdres.PENDIENTE], // validación anterior a la clasificación: se conserva el comportamiento de antes
  ] as const)('tipo detectado %s → ADRES %s (solo un certificado EPS probable queda pendiente de ADRES)', (tipo, esperado) => {
    const d = procesar(tipo);
    expect(d.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESADO);
    expect(d.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(d.adres.estado).toBe(esperado);
  });

  it('documento incorrecto: la recomendación principal es «documento incorrecto» y es la única; nada de pendiente de ADRES', () => {
    const d = procesar('documento_incorrecto');
    expect(esDocumentoIncorrecto(d)).toBe(true);
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.DOCUMENTO_INCORRECTO);
    expect(recomendacionActual(d, true)).toBe(RecomendacionEps.DOCUMENTO_INCORRECTO);
  });

  it('documento incorrecto: una sola discrepancia documental, sin «información insuficiente» por campos que no tiene', () => {
    const lista = construirDiscrepancias(procesar('documento_incorrecto'), []);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ severidad: 'critica', titulo: 'Documento incorrecto', codigo: 'tipo_documental_incorrecto' });
  });

  it('no determinable NO es documento incorrecto: sigue siendo información insuficiente', () => {
    const d = procesar('no_determinable');
    expect(esDocumentoIncorrecto(d)).toBe(false);
    expect(recomendacionActual(d, false)).toBe(RecomendacionEps.INFORMACION_INSUFICIENTE);
  });
});
