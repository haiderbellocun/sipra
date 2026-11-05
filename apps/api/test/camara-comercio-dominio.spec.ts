import {
  ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad, EstadoRegistral, TipoPersona, autenticidadPorDefecto,
} from '../src/domain/entities/documento-empresarial';
import {
  ResultadoDocumentoEmpresarialInvalidoError,
} from '../src/domain/entities/validacion-documento-empresarial.entity';
import { clasificarDocumentoEmpresarial } from '../src/domain/services/clasificacion-documento-empresarial.domain-service';
import {
  compararCamara, compararCamaraPersonaNatural,
} from '../src/domain/services/comparacion-documento-empresarial.domain-service';
import { registrarSenalesAutenticidad } from '../src/domain/services/autenticidad-documento-empresarial.domain-service';
import { calcularSha256, detectarDuplicados } from '../src/domain/services/duplicados-documento-empresarial.domain-service';
import { minimizarDatosCamara } from '../src/domain/services/minimizacion-documento-empresarial.domain-service';
import {
  estadoRegistralDesdeEtiqueta, evaluarCamara, normalizarPoliticaCamara,
} from '../src/domain/services/vigencia-documento-empresarial.domain-service';
import {
  AHORA, CEDULA_NATURAL, DV_JURIDICA, DV_NATURAL, NIT_JURIDICA, NOMBRE_PERSONA, RAZON_SOCIAL, REPRESENTANTE,
  datosCamara, datosCamaraMatriculaSociedad, datosCamaraPn, textoCamaraExistencia, textoCamaraMatriculaPn, textoCamaraMatriculaSociedad,
  textoFactura, textoFacturaConConceptoDeCertificado, textoRut, validacionPendiente,
} from './soporte-documento-empresarial';

/**
 * CÁMARA DE COMERCIO · Bloque 1 (dominio). Solo fixtures sintéticos: ninguna muestra real vive en el repositorio.
 */

const empresa = { nitNumero: NIT_JURIDICA, nitDv: Number(DV_JURIDICA), razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE };
const titular = { identificacion: CEDULA_NATURAL, dv: Number(DV_NATURAL), nombre: NOMBRE_PERSONA };
const campoDe = (c: { campos: { campo: string; resultado: string; nota?: string }[] }, nombre: string) => c.campos.find((x) => x.campo === nombre);
const resultadoDe = (c: { campos: { campo: string; resultado: string }[] }, nombre: string) => campoDe(c, nombre)?.resultado;
const dvOtro = (dv: string) => String((Number(dv) + 1) % 10);

describe('Cámara · las tres variantes se distinguen por el CONTENIDO', () => {
  it.each([
    ['A · matrícula de persona natural', textoCamaraMatriculaPn(), C.CAMARA_MATRICULA_PERSONA_NATURAL, TipoPersona.NATURAL],
    ['B · matrícula de sociedad', textoCamaraMatriculaSociedad(), C.CAMARA_MATRICULA_SOCIEDAD, TipoPersona.JURIDICA],
    ['C · existencia y representación', textoCamaraExistencia(), C.CAMARA_EXISTENCIA_REPRESENTACION, TipoPersona.JURIDICA],
  ])('%s', (_n, texto, esperado, persona) => {
    const r = clasificarDocumentoEmpresarial(texto);
    expect(r).toMatchObject({ clasificacion: esperado, familia: 'camara', tipoPersona: persona });
  });

  it('G · una factura emitida por una Cámara NO es un certificado, y el motivo lo dice', () => {
    const r = clasificarDocumentoEmpresarial(textoFactura());
    expect(r.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(r.motivos).toContain('emitido_por_camara_no_es_certificado');
    expect(r.familia).toBeNull();
  });

  it('palabras sueltas (Cámara de Comercio, NIT, Bogotá, RUES) no clasifican: sin rasgos de certificado es otro documento', () => {
    const t = `Cámara de Comercio de Bogotá · NIT 899.999.000-1 · consulte el RUES · ${'texto de oficio sin rasgos de certificado '.repeat(6)}`;
    const r = clasificarDocumentoEmpresarial(t);
    expect(r.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(r.motivos).toContain('emitido_por_camara_no_es_certificado');
  });

  it('H · señales fuertes incompatibles → NO_DETERMINABLE (no se elige a la fuerza)', () => {
    expect(clasificarDocumentoEmpresarial(`${textoCamaraExistencia()}\n${textoCamaraMatriculaPn()}`).clasificacion).toBe(C.NO_DETERMINABLE);
    expect(clasificarDocumentoEmpresarial(`${textoRut('juridica')}\n${textoCamaraExistencia()}`).clasificacion).toBe(C.NO_DETERMINABLE);
    // Una factura que además cobra «certificado de matrícula» como concepto: contradicción, la decide una persona.
    const factura = clasificarDocumentoEmpresarial(textoFacturaConConceptoDeCertificado());
    expect(factura.clasificacion).toBe(C.NO_DETERMINABLE);
    expect(factura.motivos).toContain('factura_y_certificado_a_la_vez');
  });
});

describe('Cámara · persona natural: nunca tiene representante legal', () => {
  it('la entidad rechaza una matrícula de persona natural con representante, y la acepta sin él', () => {
    const rechazo = () => {
      const v = validacionPendiente({ tipoEsperado: 'camara_comercio' });
      v.iniciarProcesamiento(AHORA);
      v.registrarResultado({
        tipoDetectado: C.CAMARA_MATRICULA_PERSONA_NATURAL, expectativa: 'coincide', metodoLectura: 'texto', confianza: 1, lecturaDudosa: false,
        hashDocumento: calcularSha256(Buffer.from('a')), datosExtraidos: datosCamaraPn({ representanteLegal: 'ALGUIEN' }), comparacion: null,
      }, AHORA);
    };
    expect(rechazo).toThrow(ResultadoDocumentoEmpresarialInvalidoError);

    const v = validacionPendiente({ tipoEsperado: 'camara_comercio' });
    v.iniciarProcesamiento(AHORA);
    v.registrarResultado({
      tipoDetectado: C.CAMARA_MATRICULA_PERSONA_NATURAL, expectativa: 'coincide', metodoLectura: 'texto', confianza: 1, lecturaDudosa: false,
      hashDocumento: calcularSha256(Buffer.from('a')), datosExtraidos: datosCamaraPn(), comparacion: null,
    }, AHORA);
    expect(v.instantanea().tipoPersona).toBe(TipoPersona.NATURAL);
  });

  it('el tipo de certificado de los datos debe corresponder a la clasificación', () => {
    const intentar = (tipoDetectado: C, datos: ReturnType<typeof datosCamara>) => {
      const v = validacionPendiente({ tipoEsperado: 'camara_comercio' });
      v.iniciarProcesamiento(AHORA);
      v.registrarResultado({
        tipoDetectado, expectativa: null, metodoLectura: 'texto', confianza: 1, lecturaDudosa: false,
        hashDocumento: calcularSha256(Buffer.from('b')), datosExtraidos: datos, comparacion: null,
      }, AHORA);
    };
    expect(() => intentar(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamaraMatriculaSociedad())).toThrow(ResultadoDocumentoEmpresarialInvalidoError);
    expect(() => intentar(C.CAMARA_MATRICULA_SOCIEDAD, datosCamara())).toThrow(ResultadoDocumentoEmpresarialInvalidoError);
    expect(() => intentar(C.CAMARA_MATRICULA_SOCIEDAD, datosCamaraMatriculaSociedad())).not.toThrow();
    expect(() => intentar(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara())).not.toThrow();
  });

  it('la minimización descarta un representante legal que llegue en una persona natural', () => {
    const d = minimizarDatosCamara({ nombreORazonSocial: NOMBRE_PERSONA, representanteLegal: 'ALGUIEN' }, 'matricula_mercantil', TipoPersona.NATURAL);
    expect(d.representanteLegal).toBeNull();
  });

  it('la comparación contra el titular usa identificación y nombre; el representante no aplica', () => {
    const c = compararCamaraPersonaNatural(datosCamaraPn(), titular);
    expect(resultadoDe(c, 'nit')).toBe('coincide');
    expect(resultadoDe(c, 'dv')).toBe('coincide');
    expect(resultadoDe(c, 'nombre')).toBe('igual');
    expect(resultadoDe(c, 'representante_legal')).toBe('no_aplica');
    expect(c.hayDiscrepancia).toBe(false);
  });

  it('otra identificación o un nombre distinto son discrepancia; sin DV en el certificado se compara el número', () => {
    expect(resultadoDe(compararCamaraPersonaNatural(datosCamaraPn(), { ...titular, identificacion: '1000000099' }), 'nit')).toBe('diferente');
    expect(resultadoDe(compararCamaraPersonaNatural(datosCamaraPn({ nombreORazonSocial: 'JUAN PEREZ RUIZ' }), titular), 'nombre')).toBe('diferente');
    const sinDv = compararCamaraPersonaNatural(datosCamaraPn({ dv: null }), titular);
    expect(resultadoDe(sinDv, 'nit')).toBe('coincide');
    expect(campoDe(sinDv, 'dv')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'dv_ausente' });
    expect(() => compararCamaraPersonaNatural(datosCamara(), titular)).toThrow();
  });
});

describe('Cámara · persona jurídica y representante legal', () => {
  it('B · matrícula de sociedad: el representante es opcional (no figura y no pasa nada)', () => {
    const c = compararCamara(datosCamaraMatriculaSociedad(), empresa);
    expect(campoDe(c, 'representante_legal')).toMatchObject({ resultado: 'no_aplica', nota: 'opcional_en_matricula' });
    expect(c.hayDiscrepancia).toBe(false);
  });

  it('B · si la matrícula de sociedad SÍ lo trae y SIPRA también, se compara por tokens de nombre', () => {
    expect(resultadoDe(compararCamara(datosCamaraMatriculaSociedad({ representanteLegal: 'PEREZ GOMEZ CARLOS ANDRES' }), empresa), 'representante_legal')).toBe('igual');
    expect(resultadoDe(compararCamara(datosCamaraMatriculaSociedad({ representanteLegal: 'OTRA PERSONA DISTINTA' }), empresa), 'representante_legal')).toBe('diferente');
  });

  it('C · existencia y representación: el representante se compara; su ausencia es información insuficiente, no discrepancia', () => {
    expect(resultadoDe(compararCamara(datosCamara(), empresa), 'representante_legal')).toBe('igual');
    const ausente = compararCamara(datosCamara({ representanteLegal: null }), empresa);
    expect(campoDe(ausente, 'representante_legal')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'representante_no_legible_en_certificado' });
    expect(ausente.hayDiscrepancia).toBe(false);
    const sinSipra = compararCamara(datosCamara(), { ...empresa, representanteLegal: null });
    expect(campoDe(sinSipra, 'representante_legal')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'sipra_sin_representante' });
  });

  it('NIT, DV y razón social: SAS / S.A.S., tildes, mayúsculas y puntuación no distinguen; una razón distinta sí', () => {
    const c = compararCamara(datosCamara({ nombreORazonSocial: 'Acme Demostración SAS' }), empresa);
    expect(resultadoDe(c, 'nit')).toBe('coincide');
    expect(resultadoDe(c, 'dv')).toBe('coincide');
    expect(resultadoDe(c, 'razon_social')).toBe('igual');
    expect(resultadoDe(compararCamara(datosCamara({ nombreORazonSocial: 'OTRA COMERCIALIZADORA S.A.S.' }), empresa), 'razon_social')).toBe('diferente');
  });

  it('no hay coincidencia difusa agresiva: una razón social parecida pero distinta no coincide', () => {
    expect(resultadoDe(compararCamara(datosCamara({ nombreORazonSocial: 'ACME DEMOSTRACIONES DEL SUR S.A.S.' }), empresa), 'razon_social')).not.toBe('igual');
  });
});

describe('Cámara · NIT + DV: el DV valida el NIT leído', () => {
  it('un DV que no corresponde deja el NIT sin lectura confiable: no se compara ni se corrige', () => {
    const c = compararCamara(datosCamara({ dv: dvOtro(DV_JURIDICA) }), empresa);
    expect(campoDe(c, 'nit')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'lectura_no_confiable_dv_no_coincide' });
    expect(campoDe(c, 'dv')).toMatchObject({ resultado: 'informacion_insuficiente' });
    expect(c.hayDiscrepancia).toBe(false);
  });

  it('un NIT de persona natural con DV incorrecto tampoco es confiable', () => {
    const c = compararCamaraPersonaNatural(datosCamaraPn({ dv: dvOtro(DV_NATURAL) }), titular);
    expect(campoDe(c, 'nit')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'lectura_no_confiable_dv_no_coincide' });
  });
});

describe('Cámara · vigencia: cinco ejes, ninguna bandera única', () => {
  it('estado registral: sin etiqueta explícita es no_determinable, y nada lo vuelve «activo»', () => {
    expect(estadoRegistralDesdeEtiqueta(null)).toBe(EstadoRegistral.NO_DETERMINABLE);
    expect(estadoRegistralDesdeEtiqueta('')).toBe(EstadoRegistral.NO_DETERMINABLE);
    expect(estadoRegistralDesdeEtiqueta('Activa')).toBe(EstadoRegistral.ACTIVO);
    expect(estadoRegistralDesdeEtiqueta('CANCELADA')).toBe(EstadoRegistral.CANCELADO);
    expect(estadoRegistralDesdeEtiqueta('En liquidación')).toBe(EstadoRegistral.OTRO);

    // Con matrícula, renovación, firma y código presentes, sigue sin determinarse.
    const e = evaluarCamara(datosCamara(), AHORA);
    expect(e.estadoRegistral).toBe(EstadoRegistral.NO_DETERMINABLE);
    expect(minimizarDatosCamara({ matricula: '1', ultimoAnioRenovado: 2026, firmaPdfPresente: true, codigoVerificacion: 'ABC' }, 'matricula_mercantil', TipoPersona.JURIDICA).estadoRegistral)
      .toBe(EstadoRegistral.NO_DETERMINABLE);
  });

  it('renovación: el último año y la fecha son independientes; la fecha puede faltar', () => {
    const e = evaluarCamara(datosCamara({ ultimoAnioRenovado: 2026, fechaRenovacion: null }), AHORA);
    expect(e.ultimoAnioRenovado).toBe(2026);
    expect(e.fechaRenovacion).toBeNull();
    expect(e.estadoRegistral).toBe(EstadoRegistral.NO_DETERMINABLE);
    const solaFecha = evaluarCamara(datosCamara({ ultimoAnioRenovado: null, fechaRenovacion: '2026-03-31' }), AHORA);
    expect(solaFecha).toMatchObject({ ultimoAnioRenovado: null, fechaRenovacion: '2026-03-31' });
  });

  it('D · antigüedad: un certificado antiguo NO falla mientras la política sea null (por defecto)', () => {
    const e = evaluarCamara(datosCamara({ fechaExpedicion: '2020-01-15' }), AHORA);
    expect(e.antiguedad.diasDesdeExpedicion).toBeGreaterThan(2000);
    expect(e.antiguedad.politicaDias).toBeNull();
    expect(e.antiguedad.cumplePolitica).toBeNull();
    expect(normalizarPoliticaCamara(undefined).camaraMaxDiasExpedicion).toBeNull();
    expect(normalizarPoliticaCamara('').camaraMaxDiasExpedicion).toBeNull();
    expect(normalizarPoliticaCamara(0).camaraMaxDiasExpedicion).toBeNull();
    // Cuando CUN defina el plazo, se mide; no antes.
    expect(evaluarCamara(datosCamara({ fechaExpedicion: '2020-01-15' }), AHORA, { camaraMaxDiasExpedicion: 30 }).antiguedad.cumplePolitica).toBe(false);
    expect(evaluarCamara(datosCamara({ fechaExpedicion: '2026-10-20' }), AHORA, { camaraMaxDiasExpedicion: 30 }).antiguedad.cumplePolitica).toBe(true);
  });

  it('E · ventana de verificación de 60 días: es otro eje que la vigencia, la renovación y la antigüedad', () => {
    const e = evaluarCamara(datosCamara({ fechaExpedicion: '2026-09-10', diasVerificacionDocumento: 60 }), AHORA);
    expect(e.verificacionDisponibleHasta).toBe('2026-11-09');
    // Con el certificado ya fuera de su ventana, la antigüedad, el estado y la renovación no cambian.
    const despues = evaluarCamara(datosCamara({ fechaExpedicion: '2026-09-10', diasVerificacionDocumento: 60 }), new Date('2027-03-01T15:00:00Z'));
    expect(despues.verificacionDisponibleHasta).toBe('2026-11-09');
    expect(despues.estadoRegistral).toBe(e.estadoRegistral);
    expect(despues.antiguedad.cumplePolitica).toBeNull();
    expect(evaluarCamara(datosCamara({ diasVerificacionDocumento: null }), AHORA).verificacionDisponibleHasta).toBeNull();
  });

  it('no existe una bandera «vigente» en ninguna evaluación ni en los datos', () => {
    const texto = JSON.stringify({ e: evaluarCamara(datosCamara(), AHORA), d: datosCamara() });
    expect(texto).not.toMatch(/"vigen|"vencid/i);
  });
});

describe('Cámara · autenticidad', () => {
  it('F · firma PDF, código y URL presentes NO la elevan: sigue no_verificable', () => {
    const a = registrarSenalesAutenticidad({ firmaPdfPresente: true, codigoVerificacion: 'ZZ99YY88XX', urlVerificacion: 'https://verifica.ejemplo.test' });
    expect(a.estado).toBe(EstadoAutenticidad.NO_VERIFICABLE);
    expect(a.firmaPdfPresente).toBe(true);
    expect(a.firmaPdfValida).toBeNull();
    expect(a.codigoVerificacionPresente).toBe(true);
    expect(a.urlVerificacionPresente).toBe(true);
    expect(autenticidadPorDefecto().estado).toBe(EstadoAutenticidad.NO_VERIFICABLE);
  });

  it('una validación de Cámara queda no_verificable aunque traiga firma, código y URL', () => {
    const v = validacionPendiente({ tipoEsperado: 'camara_comercio' });
    v.iniciarProcesamiento(AHORA);
    v.registrarResultado({
      tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION, expectativa: 'coincide', metodoLectura: 'texto', confianza: 1, lecturaDudosa: false,
      hashDocumento: calcularSha256(Buffer.from('c')), datosExtraidos: datosCamara(), comparacion: null,
      autenticidad: registrarSenalesAutenticidad({ firmaPdfPresente: true, codigoVerificacion: 'X', urlVerificacion: 'https://verifica.ejemplo.test' }),
    }, AHORA);
    expect(v.instantanea().autenticidad).toMatchObject({ estado: 'no_verificable', fuente: null, firmaPdfValida: null });
  });
});

describe('Cámara · campos informativos, minimización y duplicados', () => {
  it('CIIU, domicilio y fechas no producen discrepancia crítica', () => {
    const c = compararCamara(datosCamara({ ciiu: '9999', domicilioMunicipio: 'OTRA CIUDAD', fechaMatricula: '1999-01-01', fechaExpedicion: '2010-01-01' }), empresa);
    expect(c.hayDiscrepancia).toBe(false);
    expect(campoDe(c, 'ciiu')).toMatchObject({ resultado: 'informativo', nota: 'catalogo_incompleto' });
    expect(c.campos.map((x) => x.campo)).not.toEqual(expect.arrayContaining(['domicilio', 'direccion', 'fecha_matricula', 'fecha_expedicion']));
  });

  it('minimización: dirección, correo, teléfono, texto, OCR e imágenes no se conservan; el documento del representante tampoco', () => {
    const d = minimizarDatosCamara({
      nombreORazonSocial: RAZON_SOCIAL, nit: NIT_JURIDICA, dv: DV_JURIDICA, representanteLegal: REPRESENTANTE,
      direccion: 'CALLE 1 # 2-3', correo: 'a@b.c', telefono: '3000000000', texto: 'todo el certificado', textoOcr: '…', imagenes: ['x'],
      documentoRepresentante: '123456789', urlVerificacion: 'https://usuario:clave@verifica.ejemplo.test/ruta?token=1#f',
    }, 'existencia_representacion', TipoPersona.JURIDICA) as unknown as Record<string, unknown>;
    for (const prohibida of ['direccion', 'correo', 'telefono', 'texto', 'textoOcr', 'imagenes', 'documentoRepresentante']) expect(d).not.toHaveProperty(prohibida);
    expect(JSON.stringify(d)).not.toMatch(/CALLE|a@b\.c|3000000000|123456789|clave|token/);
    expect(d['urlVerificacion']).toBeNull();
  });

  it('I · duplicado exacto: mismo SHA-256, misma práctica y mismo tipo se reporta, sin borrar nada', () => {
    const hash = calcularSha256(Buffer.from('certificado sintético'));
    const existente = { documentoId: 'd1', practicaId: 'p1', tipo: 'camara_comercio', hash };
    const r = detectarDuplicados({ documentoId: 'd2', practicaId: 'p1', tipo: 'camara_comercio', hash }, [existente]);
    expect(r.esDuplicado).toBe(true);
    expect(r.coincidencias).toEqual([existente]);
    expect(detectarDuplicados({ documentoId: 'd2', practicaId: 'p1', tipo: 'rut_juridico', hash }, [existente]).esDuplicado).toBe(false);
  });

  it('la validación registra el duplicado apuntando al primer documento', () => {
    const v = validacionPendiente({ tipoEsperado: 'camara_comercio' });
    v.iniciarProcesamiento(AHORA);
    v.registrarResultado({
      tipoDetectado: C.CAMARA_MATRICULA_SOCIEDAD, expectativa: 'coincide', metodoLectura: 'texto', confianza: 1, lecturaDudosa: false,
      hashDocumento: calcularSha256(Buffer.from('c')), duplicadoDeDocumentoId: 'documento-anterior', datosExtraidos: datosCamaraMatriculaSociedad(), comparacion: null,
    }, AHORA);
    expect(v.instantanea().duplicadoDeDocumentoId).toBe('documento-anterior');
  });
});
