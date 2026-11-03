import {
  ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona,
  autenticidadPorDefecto,
} from '../src/domain/entities/documento-empresarial';
import {
  ResultadoDocumentoEmpresarialInvalidoError, ResultadoProcesamientoEmpresarial, ValidacionDocumentoEmpresarialYaProcesadaError,
} from '../src/domain/entities/validacion-documento-empresarial.entity';
import {
  AutenticidadInvalidaError, esDestinoOficialDian, registrarSenalesAutenticidad, validarAutenticidad,
} from '../src/domain/services/autenticidad-documento-empresarial.domain-service';
import { calcularSha256, detectarDuplicados, esSha256 } from '../src/domain/services/duplicados-documento-empresarial.domain-service';
import {
  AHORA, HASH_A, HASH_B, datosCamara, datosRutPj, datosRutPn, validacionPendiente,
} from './soporte-documento-empresarial';

const resultadoRut = (sobre: Partial<ResultadoProcesamientoEmpresarial> = {}): ResultadoProcesamientoEmpresarial => ({
  tipoDetectado: C.RUT_PERSONA_NATURAL, expectativa: 'coincide', metodoLectura: 'texto', confianza: 0.97, lecturaDudosa: false,
  hashDocumento: HASH_A, datosExtraidos: datosRutPn(), comparacion: null, ...sobre,
});

describe('ValidacionDocumentoEmpresarial · ciclo de procesamiento', () => {
  it('nace pendiente, sin clasificación (los documentos históricos tampoco la tienen) y con autenticidad no_verificable', () => {
    const d = validacionPendiente().instantanea();
    expect(d).toMatchObject({ estado: Estado.PENDIENTE, tipoDetectado: null, familiaDocumento: null, tipoPersona: null, intentos: 0, version: 1 });
    expect(d.autenticidad).toEqual(autenticidadPorDefecto());
    expect(d.autenticidad.estado).toBe(EstadoAutenticidad.NO_VERIFICABLE);
  });

  it('pendiente → procesando → revision; la familia y la persona salen de la clasificación', () => {
    const v = validacionPendiente();
    v.iniciarProcesamiento(AHORA);
    expect(v.estado).toBe(Estado.PROCESANDO);
    expect(v.intentos).toBe(1);
    v.registrarResultado(resultadoRut({ tipoDetectado: C.RUT_PERSONA_JURIDICA, expectativa: 'persona_distinta', datosExtraidos: datosRutPj() }), AHORA);
    expect(v.instantanea()).toMatchObject({ estado: Estado.REVISION, tipoDetectado: C.RUT_PERSONA_JURIDICA, familiaDocumento: 'rut', tipoPersona: TipoPersona.JURIDICA, expectativa: 'persona_distinta', tipoEsperado: 'rut_natural' });
  });

  it('reintentar tras un error abre una ronda nueva; repetir «procesando» no la duplica', () => {
    const v = validacionPendiente();
    v.iniciarProcesamiento(AHORA);
    v.iniciarProcesamiento(AHORA);
    expect(v.intentos).toBe(1);
    v.marcarError('lectura_fallida', AHORA);
    expect(v.instantanea()).toMatchObject({ estado: Estado.ERROR, errorCodigo: 'lectura_fallida' });
    v.iniciarProcesamiento(AHORA);
    expect(v.instantanea()).toMatchObject({ estado: Estado.PROCESANDO, errorCodigo: null, intentos: 2 });
  });

  it('una validación procesada no se reprocesa ni cae en error', () => {
    const v = validacionPendiente();
    v.iniciarProcesamiento(AHORA);
    v.registrarResultado(resultadoRut(), AHORA);
    expect(() => v.iniciarProcesamiento(AHORA)).toThrow(ValidacionDocumentoEmpresarialYaProcesadaError);
    expect(() => v.registrarResultado(resultadoRut(), AHORA)).toThrow(ValidacionDocumentoEmpresarialYaProcesadaError);
    expect(() => v.marcarError('x', AHORA)).toThrow(ValidacionDocumentoEmpresarialYaProcesadaError);
  });

  it('un documento incorrecto o no determinable no trae datos extraídos ni comparación', () => {
    for (const tipo of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE]) {
      const ok = validacionPendiente();
      ok.iniciarProcesamiento(AHORA);
      ok.registrarResultado(resultadoRut({ tipoDetectado: tipo, expectativa: 'documento_incorrecto', datosExtraidos: null }), AHORA);
      expect(ok.instantanea()).toMatchObject({ tipoDetectado: tipo, familiaDocumento: null, tipoPersona: null });
      const mal = validacionPendiente();
      expect(() => mal.registrarResultado(resultadoRut({ tipoDetectado: tipo }), AHORA)).toThrow(ResultadoDocumentoEmpresarialInvalidoError);
    }
  });

  it('los datos deben corresponder a la persona de la clasificación', () => {
    expect(() => validacionPendiente().registrarResultado(resultadoRut({ datosExtraidos: datosRutPj() }), AHORA)).toThrow(/persona/);
  });

  it('una matrícula de persona natural con representante legal se rechaza; sin él, se acepta', () => {
    const pn = { tipoCertificado: 'matricula_mercantil' as const, tipoPersona: TipoPersona.NATURAL };
    const mal = resultadoRut({ tipoDetectado: C.CAMARA_MATRICULA_PERSONA_NATURAL, datosExtraidos: datosCamara({ ...pn, representanteLegal: 'ALGUIEN' }) });
    expect(() => validacionPendiente({ tipoEsperado: 'camara_comercio' }).registrarResultado(mal, AHORA)).toThrow(/representante/);
    const bien = resultadoRut({ tipoDetectado: C.CAMARA_MATRICULA_PERSONA_NATURAL, datosExtraidos: datosCamara({ ...pn, representanteLegal: null }) });
    expect(() => validacionPendiente({ tipoEsperado: 'camara_comercio' }).registrarResultado(bien, AHORA)).not.toThrow();
  });

  it('rechaza datos con claves prohibidas, un hash que no es SHA-256 y una confianza fuera de rango', () => {
    expect(() => validacionPendiente().registrarResultado(resultadoRut({ datosExtraidos: { ...datosRutPn(), correo: 'x@y.z' } as never }), AHORA)).toThrow(/correo/);
    expect(() => validacionPendiente().registrarResultado(resultadoRut({ hashDocumento: 'no-es-un-hash' }), AHORA)).toThrow(/SHA-256/);
    expect(() => validacionPendiente().registrarResultado(resultadoRut({ confianza: 1.5 }), AHORA)).toThrow(/confianza/);
  });

  it('el resultado por defecto deja la autenticidad en no_verificable', () => {
    const v = validacionPendiente();
    v.registrarResultado(resultadoRut(), AHORA);
    expect(v.instantanea().autenticidad.estado).toBe(EstadoAutenticidad.NO_VERIFICABLE);
  });
});

describe('Autenticidad: ninguna señal pasiva la eleva', () => {
  it('QR, código, URL y firma de PDF presentes se registran, pero el estado sigue siendo no_verificable', () => {
    const a = registrarSenalesAutenticidad({
      qr: [{ tipo: 'url', host: 'muisca.dian.gov.co' }], firmaPdfPresente: true, codigoVerificacion: 'ABC123', urlVerificacion: 'https://verifica.ejemplo.test/',
    });
    expect(a).toMatchObject({ estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, qrPresente: true, qrDecodificado: true, qrDestinoOficial: true, firmaPdfPresente: true, codigoVerificacionPresente: true, urlVerificacionPresente: true });
    // «presente» no es «válida».
    expect(a.firmaPdfValida).toBeNull();
  });

  it('un QR visible pero no decodificado (escaneado) se anota sin afirmar destino', () => {
    expect(registrarSenalesAutenticidad({ qr: [], qrVisibleSinDecodificar: true })).toMatchObject({ qrPresente: true, qrDecodificado: false, qrDestinoOficial: false });
    expect(registrarSenalesAutenticidad({ qr: null })).toMatchObject({ qrPresente: null, qrDecodificado: null, qrDestinoOficial: null });
  });

  it('el destino oficial es el dominio de la DIAN o un subdominio suyo; un host parecido no cuenta', () => {
    expect(esDestinoOficialDian('muisca.dian.gov.co')).toBe(true);
    expect(esDestinoOficialDian('DIAN.gov.co')).toBe(true);
    for (const h of ['dian.gov.co.evil.example', 'evildian.gov.co', 'dian-gov.co', 'gov.co', '', null, undefined]) expect(esDestinoOficialDian(h)).toBe(false);
    expect(registrarSenalesAutenticidad({ qr: [{ tipo: 'url', host: 'dian.gov.co.evil.example' }] }).qrDestinoOficial).toBe(false);
    expect(registrarSenalesAutenticidad({ qr: [{ tipo: 'texto', host: null }] }).qrDestinoOficial).toBe(false);
  });

  it('«verificada» exige una fuente, y una firma de PDF «válida» también', () => {
    expect(() => validarAutenticidad({ ...autenticidadPorDefecto(), estado: EstadoAutenticidad.VERIFICADA })).toThrow(AutenticidadInvalidaError);
    expect(() => validarAutenticidad({ ...autenticidadPorDefecto(), firmaPdfValida: true })).toThrow(AutenticidadInvalidaError);
    expect(validarAutenticidad({ ...autenticidadPorDefecto(), estado: EstadoAutenticidad.VERIFICADA, fuente: 'consulta_oficial' }).estado).toBe('verificada');
    expect(() => validacionPendiente().registrarResultado(resultadoRut({ autenticidad: { ...autenticidadPorDefecto(), estado: EstadoAutenticidad.VERIFICADA } }), AHORA)).toThrow(AutenticidadInvalidaError);
  });
});

describe('Hash y duplicados', () => {
  it('SHA-256 conocido', () => {
    expect(calcularSha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(esSha256(HASH_A)).toBe(true);
    expect(esSha256('xyz')).toBe(false);
  });

  const existente = { documentoId: 'd0', practicaId: 'p1', tipo: 'rut_natural', hash: HASH_A, version: 1 };
  const nuevo = { documentoId: 'd1', practicaId: 'p1', tipo: 'rut_natural', hash: HASH_A, version: 2 };

  it('mismo archivo, misma práctica y mismo tipo: duplicado (se reporta; no se borra ni se descarta)', () => {
    const existentes = [existente];
    const r = detectarDuplicados(nuevo, existentes);
    expect(r).toEqual({ esDuplicado: true, coincidencias: [existente] });
    expect(existentes).toEqual([existente]);
  });

  it('otra práctica, otro tipo u otro contenido no son duplicados; el propio documento no cuenta', () => {
    expect(detectarDuplicados({ ...nuevo, practicaId: 'p2' }, [existente]).esDuplicado).toBe(false);
    expect(detectarDuplicados({ ...nuevo, tipo: 'rut_juridico' }, [existente]).esDuplicado).toBe(false);
    expect(detectarDuplicados({ ...nuevo, hash: HASH_B }, [existente]).esDuplicado).toBe(false);
    expect(detectarDuplicados(existente, [existente]).esDuplicado).toBe(false);
  });
});
