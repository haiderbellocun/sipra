import { ClasificacionDocumentoEmpresarial as C, DatosRutExtraidos, TipoPersona } from '../src/domain/entities/documento-empresarial';
import {
  CampoRut, LecturaRutParaComparar, SipraParaRut, compararRut, datosSipraParaRut, huellaSipraRut, sipraCambioDespues,
} from '../src/domain/services/comparacion-rut.domain-service';
import { Nit } from '../src/domain/value-objects/nit.vo';

const AHORA = new Date('2026-11-03T15:00:00Z');
const dv = (n: string): string => String(Nit.calcularDigitoVerificacion(n));
const CEDULA = '1000000001';
const NIT = '900123456';

const sipra = (sobre: { documento?: string | null; nombre?: string | null; nitNumero?: string | null; nitDv?: number | null; razonSocial?: string | null; sinEmpresa?: boolean } = {}): SipraParaRut => ({
  usuario: { documento: sobre.documento === undefined ? CEDULA : sobre.documento, nombre: sobre.nombre === undefined ? 'MARÍA CAMILA PÉREZ GÓMEZ' : sobre.nombre },
  empresa: sobre.sinEmpresa ? null : {
    nitNumero: sobre.nitNumero === undefined ? NIT : sobre.nitNumero,
    nitDv: sobre.nitDv === undefined ? Number(dv(NIT)) : sobre.nitDv,
    razonSocial: sobre.razonSocial === undefined ? 'EMPRESA LOGÍSTICA S.A.S.' : sobre.razonSocial,
  },
});

const datosPn = (s: Partial<DatosRutExtraidos> = {}): DatosRutExtraidos => ({
  tipoPersona: TipoPersona.NATURAL, nit: CEDULA, dv: dv(CEDULA), fechaGeneracion: '2024-03-15', tipoDocumento: 'CC', numeroDocumento: CEDULA,
  nombres: 'MARIA CAMILA', apellidos: 'PEREZ GOMEZ', ciiuPrincipal: '4711', divipolaMunicipio: '11001', controlNit: 'confiable', ...s,
});
const datosPj = (s: Partial<DatosRutExtraidos> = {}): DatosRutExtraidos => ({
  tipoPersona: TipoPersona.JURIDICA, nit: NIT, dv: dv(NIT), fechaGeneracion: '2024-03-15', razonSocial: 'EMPRESA LOGISTICA SAS',
  ciiuPrincipal: '4923', divipolaMunicipio: '11001', controlNit: 'confiable', ...s,
});
const pn = (s: Partial<LecturaRutParaComparar> = {}): LecturaRutParaComparar => ({ tipoDetectado: C.RUT_PERSONA_NATURAL, datos: datosPn(), lecturaDudosa: false, expectativa: 'coincide', ...s });
const pj = (s: Partial<LecturaRutParaComparar> = {}): LecturaRutParaComparar => ({ tipoDetectado: C.RUT_PERSONA_JURIDICA, datos: datosPj(), lecturaDudosa: false, expectativa: 'coincide', ...s });

const res = (c: ReturnType<typeof compararRut>, campo: CampoRut): string | undefined => c?.campos.find((x) => x.campo === campo)?.resultado;
const diferentes = (c: ReturnType<typeof compararRut>): string[] => (c?.campos ?? []).filter((x) => x.resultado === 'diferente').map((x) => x.campo);

describe('Comparación RUT persona natural ↔ SIPRA', () => {
  it('documento e identidad coinciden: consistente, y los CRÍTICOS son documento y nombre', () => {
    const c = compararRut(pn(), sipra(), AHORA)!;
    expect(c.campos.filter((x) => x.criticidad === 'critico').map((x) => [x.campo, x.resultado])).toEqual([['documento', 'coincide'], ['nombre', 'coincide']]);
    expect(c).toMatchObject({ veredicto: 'consistente', hayDiscrepancia: false, version: 1 });
  });

  it('un documento distinto es una discrepancia crítica', () => {
    const c = compararRut(pn({ datos: datosPn({ numeroDocumento: '1000000099' }) }), sipra(), AHORA)!;
    expect(res(c, 'documento')).toBe('diferente');
    expect(c).toMatchObject({ veredicto: 'discrepancia', hayDiscrepancia: true });
  });

  it('el nombre coincide aunque cambie el orden, las tildes, las mayúsculas y la puntuación', () => {
    for (const [nombres, apellidos] of [['MARIA CAMILA', 'PEREZ GOMEZ'], ['camila maría', 'gómez, pérez']]) {
      expect(res(compararRut(pn({ datos: datosPn({ nombres, apellidos }) }), sipra(), AHORA), 'nombre')).toBe('coincide');
    }
    // SIPRA con el orden del RUT («apellidos nombres»).
    expect(res(compararRut(pn(), sipra({ nombre: 'PEREZ GOMEZ MARIA CAMILA' }), AHORA), 'nombre')).toBe('coincide');
  });

  it('un nombre con una parte menos (≥ 2 palabras) coincide con la nota «nombre_parcial»; uno distinto, no', () => {
    const parcial = compararRut(pn({ datos: datosPn({ nombres: 'MARIA', apellidos: 'PEREZ' }) }), sipra(), AHORA)!;
    expect(parcial.campos.find((x) => x.campo === 'nombre')).toMatchObject({ resultado: 'coincide', nota: 'nombre_parcial' });
    expect(res(compararRut(pn({ datos: datosPn({ nombres: 'JUAN', apellidos: 'RUIZ' }) }), sipra(), AHORA), 'nombre')).toBe('diferente');
    // Un solo apellido en común NO basta (no hay coincidencia laxa).
    expect(res(compararRut(pn({ datos: datosPn({ nombres: 'ANA', apellidos: 'PEREZ' }) }), sipra(), AHORA), 'nombre')).toBe('diferente');
  });

  it('lectura dudosa: los críticos quedan informacion_insuficiente aunque los valores leídos difieran; jamás «diferente»', () => {
    const c = compararRut(pn({ lecturaDudosa: true, datos: datosPn({ numeroDocumento: '9999999999', nombres: 'OTRA', apellidos: 'PERSONA' }) }), sipra(), AHORA)!;
    expect(c.campos.filter((x) => x.criticidad === 'critico').map((x) => [x.resultado, x.nota])).toEqual([['informacion_insuficiente', 'lectura_dudosa'], ['informacion_insuficiente', 'lectura_dudosa']]);
    expect(c).toMatchObject({ veredicto: 'revision_necesaria', hayDiscrepancia: false });
  });

  it('datos ausentes en el RUT o en SIPRA: informacion_insuficiente, no discrepancia', () => {
    expect(res(compararRut(pn({ datos: datosPn({ numeroDocumento: null, nit: null, dv: null, controlNit: 'nit_ausente' }) }), sipra(), AHORA), 'documento')).toBe('informacion_insuficiente');
    expect(res(compararRut(pn(), sipra({ documento: null }), AHORA), 'documento')).toBe('informacion_insuficiente');
    expect(res(compararRut(pn(), sipra({ nombre: null }), AHORA), 'nombre')).toBe('informacion_insuficiente');
  });

  it('sin número de documento pero con NIT cuyo DV valida (la cédula), el documento se compara con ese NIT', () => {
    const c = compararRut(pn({ datos: datosPn({ numeroDocumento: null }) }), sipra(), AHORA);
    expect(res(c, 'documento')).toBe('coincide');
    // Con un NIT cuyo DV NO valida no se usa.
    const sinValidar = compararRut(pn({ datos: datosPn({ numeroDocumento: null, dv: String((Number(dv(CEDULA)) + 1) % 10) }) }), sipra(), AHORA);
    expect(res(sinValidar, 'documento')).toBe('informacion_insuficiente');
  });
});

describe('Comparación RUT persona jurídica ↔ SIPRA', () => {
  it('NIT, DV y razón social coinciden: consistente, y los CRÍTICOS son esos tres', () => {
    const c = compararRut(pj(), sipra(), AHORA)!;
    expect(c.campos.filter((x) => x.criticidad === 'critico').map((x) => [x.campo, x.resultado])).toEqual([['nit', 'coincide'], ['dv', 'coincide'], ['razon_social', 'coincide']]);
    expect(c.veredicto).toBe('consistente');
  });

  it('razón social normalizada: mayúsculas, tildes, puntuación, S.A.S./SAS y espacios no distinguen', () => {
    for (const razon of ['EMPRESA LOGISTICA SAS', 'Empresa Logística S.A.S.', 'empresa  logistica   s.a.s', 'EMPRESA LOGÍSTICA']) {
      expect(res(compararRut(pj({ datos: datosPj({ razonSocial: razon }) }), sipra({ razonSocial: 'EMPRESA LOGÍSTICA S.A.S.' }), AHORA), 'razon_social')).toBe('coincide');
    }
  });

  it('empresas distintas, o un nombre más corto o más largo, NO coinciden (sin coincidencias laxas)', () => {
    for (const razon of ['TRANSPORTES DEL SUR SAS', 'EMPRESA SAS', 'EMPRESA LOGISTICA DEL NORTE SAS', 'LOGISTICA SAS']) {
      expect(res(compararRut(pj({ datos: datosPj({ razonSocial: razon }) }), sipra(), AHORA), 'razon_social')).toBe('diferente');
    }
  });

  it('un NIT leído cuyo DV NO valida jamás es «diferente»: queda informacion_insuficiente y la razón social sí se compara', () => {
    const malo = String((Number(dv(NIT)) + 1) % 10);
    const c = compararRut(pj({ datos: datosPj({ dv: malo, controlNit: 'dv_no_coincide' }) }), sipra({ nitNumero: '901458772', nitDv: 2 }), AHORA)!;
    expect(c.campos.find((x) => x.campo === 'nit')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'nit_no_confiable_dv_no_coincide' });
    expect(res(c, 'dv')).toBe('informacion_insuficiente');
    expect(res(c, 'razon_social')).toBe('coincide');
    expect(c.hayDiscrepancia).toBe(false);
  });

  it('lectura dudosa o sin datos: críticos informacion_insuficiente', () => {
    expect(compararRut(pj({ lecturaDudosa: true }), sipra({ nitNumero: '901458772' }), AHORA)!.campos.filter((x) => x.criticidad === 'critico').every((x) => x.resultado === 'informacion_insuficiente')).toBe(true);
    expect(compararRut(pj({ datos: null }), sipra(), AHORA)!.campos[0]).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'sin_datos_leidos' });
  });

  it('sin empresa en SIPRA (ni FUR) no se inventa nada: informacion_insuficiente', () => {
    const c = compararRut(pj(), sipra({ sinEmpresa: true }), AHORA)!;
    expect(c.campos.filter((x) => x.criticidad === 'critico').map((x) => x.nota)).toEqual(['sipra_sin_empresa', 'sipra_sin_empresa', 'sipra_sin_empresa']);
    expect(c.veredicto).toBe('revision_necesaria');
  });
});

describe('Persona distinta, documento incorrecto y no determinable', () => {
  it('RUT jurídico cuando se esperaba natural (y al revés): no se compara como si fuera la otra persona', () => {
    const a = compararRut(pj({ expectativa: 'persona_distinta' }), sipra(), AHORA)!;
    expect(a.campos.filter((x) => x.criticidad === 'critico').every((x) => x.resultado === 'no_aplica' && x.nota === 'persona_distinta')).toBe(true);
    expect(a).toMatchObject({ veredicto: 'no_aplica', hayDiscrepancia: false });
    const b = compararRut(pn({ expectativa: 'persona_distinta' }), sipra(), AHORA)!;
    expect(b.campos.filter((x) => x.criticidad === 'critico').map((x) => x.campo)).toEqual(['documento', 'nombre']);
    expect(b.veredicto).toBe('no_aplica');
  });

  it('documento incorrecto, certificado de cámara, no determinable o sin clasificar: NO hay comparación (nunca falsos «diferente»)', () => {
    for (const tipoDetectado of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE, C.CAMARA_EXISTENCIA_REPRESENTACION, C.CAMARA_MATRICULA_SOCIEDAD, null]) {
      expect(compararRut({ tipoDetectado, datos: null, lecturaDudosa: false, expectativa: 'documento_incorrecto' }, sipra(), AHORA)).toBeNull();
    }
  });
});

describe('Campos informativos', () => {
  it('CIIU, DIVIPOLA y fecha de generación no se comparan ni causan discrepancias', () => {
    const c = compararRut(pj({ datos: datosPj({ ciiuPrincipal: '9999', divipolaMunicipio: '99999', fechaGeneracion: '2010-01-01' }) }), sipra(), AHORA)!;
    expect(c.campos.filter((x) => x.criticidad === 'informativo').map((x) => [x.campo, x.resultado])).toEqual([['ciiu', 'no_aplica'], ['divipola', 'no_aplica'], ['fecha_generacion', 'no_aplica']]);
    expect(c.veredicto).toBe('consistente');
    // La antigüedad de la fecha no produce ningún resultado de vigencia.
    expect(JSON.stringify(c)).not.toMatch(/vigen|vencid|a[nñ]o_en_curso/i);
  });
});

describe('Mutaciones controladas: cada una difiere SOLO en su campo, sin falsos positivos', () => {
  it('persona natural: documento, nombre', () => {
    expect(diferentes(compararRut(pn(), sipra({ documento: '1000000099' }), AHORA))).toEqual(['documento']);
    expect(diferentes(compararRut(pn(), sipra({ nombre: 'JUAN PABLO RUIZ TORRES' }), AHORA))).toEqual(['nombre']);
    expect(diferentes(compararRut(pn(), sipra(), AHORA))).toEqual([]);
  });

  it('persona jurídica: NIT, DV, razón social', () => {
    expect(diferentes(compararRut(pj(), sipra({ nitNumero: '901458772' }), AHORA))).toEqual(['nit']);
    expect(diferentes(compararRut(pj(), sipra({ nitDv: (Number(dv(NIT)) + 1) % 10 }), AHORA))).toEqual(['dv']);
    expect(diferentes(compararRut(pj(), sipra({ razonSocial: 'COMERCIALIZADORA ANDINA LTDA' }), AHORA))).toEqual(['razon_social']);
    expect(diferentes(compararRut(pj(), sipra(), AHORA))).toEqual([]);
    // Y los campos NO mutados siguen coincidiendo.
    const soloNit = compararRut(pj(), sipra({ nitNumero: '901458772' }), AHORA)!;
    expect(soloNit.campos.filter((x) => x.criticidad === 'critico' && x.campo !== 'nit').every((x) => x.resultado === 'coincide')).toBe(true);
  });
});

describe('Lo que se guarda y el recálculo', () => {
  it('guarda campo, resultado y criticidad: nunca los valores de SIPRA ni del documento', () => {
    const texto = JSON.stringify(compararRut(pj(), sipra(), AHORA));
    for (const valor of [NIT, 'EMPRESA LOG', 'LOGISTICA', CEDULA, 'MARÍA', 'PEREZ']) expect(texto).not.toContain(valor);
    const t2 = JSON.stringify(compararRut(pn(), sipra(), AHORA));
    for (const valor of [CEDULA, 'MARIA', 'PEREZ', 'GOMEZ']) expect(t2).not.toContain(valor);
  });

  it('la huella de SIPRA ignora el formato (orden, tildes, forma jurídica) pero detecta un cambio real', () => {
    const base = huellaSipraRut(sipra());
    expect(huellaSipraRut(sipra({ nombre: 'perez gomez maria camila', razonSocial: 'Empresa Logistica SAS' }))).toBe(base);
    expect(huellaSipraRut(sipra({ documento: '1000000099' }))).not.toBe(base);
    expect(huellaSipraRut(sipra({ razonSocial: 'OTRA EMPRESA SAS' }))).not.toBe(base);
    expect(huellaSipraRut(sipra({ nitNumero: '901458772' }))).not.toBe(base);
  });

  it('«los datos de SIPRA cambiaron después de la lectura» se detecta por la huella, sin tocar lo guardado', () => {
    const guardada = compararRut(pn(), sipra(), AHORA)!;
    const copia = JSON.stringify(guardada);
    expect(sipraCambioDespues(guardada, sipra())).toBe(false);
    expect(sipraCambioDespues(guardada, sipra({ documento: '1000000099' }))).toBe(true);
    expect(JSON.stringify(guardada)).toBe(copia);
  });

  it('recalcular con la MISMA lectura y datos nuevos de SIPRA cambia solo lo que corresponde', () => {
    const lectura = pn();
    const antes = compararRut(lectura, sipra(), AHORA)!;
    const despues = compararRut(lectura, sipra({ documento: '1000000099' }), new Date('2026-11-04T10:00:00Z'))!;
    expect(antes.veredicto).toBe('consistente');
    expect(despues.veredicto).toBe('discrepancia');
    expect(diferentes(despues)).toEqual(['documento']);
    expect(despues.huellaSipra).not.toBe(antes.huellaSipra);
  });

  it('datosSipraParaRut: la empresa registrada manda; sin ella, el FUR (con o sin DV) y nunca se inventa el DV', () => {
    const base = { estudiante: { nombre: 'A B', documento: '1' } };
    expect(datosSipraParaRut({ ...base, empresa: { nitNumero: NIT, nitDv: 7, razonSocial: 'X SAS' }, formulario: { razonSocial: 'Y', nit: '1-9' } }).empresa).toEqual({ nitNumero: NIT, nitDv: 7, razonSocial: 'X SAS' });
    expect(datosSipraParaRut({ ...base, empresa: null, formulario: { razonSocial: 'Y SAS', nit: '901.458.772-2' } }).empresa).toEqual({ nitNumero: '901458772', nitDv: 2, razonSocial: 'Y SAS' });
    expect(datosSipraParaRut({ ...base, empresa: null, formulario: { razonSocial: 'Y SAS', nit: '901458772' } }).empresa).toEqual({ nitNumero: '901458772', nitDv: null, razonSocial: 'Y SAS' });
    expect(datosSipraParaRut({ ...base, empresa: null, formulario: { razonSocial: null, nit: null } }).empresa).toBeNull();
  });
});
