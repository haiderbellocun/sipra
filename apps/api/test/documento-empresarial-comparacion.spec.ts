import { TipoPersona } from '../src/domain/entities/documento-empresarial';
import {
  compararCamara, compararRutPersonaJuridica, compararRutPersonaNatural, sinFormaJuridica,
} from '../src/domain/services/comparacion-documento-empresarial.domain-service';
import {
  CEDULA_NATURAL, DV_JURIDICA, NIT_JURIDICA, NOMBRE_PERSONA, RAZON_SOCIAL, REPRESENTANTE, datosCamara, datosRutPj, datosRutPn,
} from './soporte-documento-empresarial';

const empresa = { nitNumero: NIT_JURIDICA, nitDv: Number(DV_JURIDICA), razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE };
const resultadoDe = (c: { campos: { campo: string; resultado: string }[] }, campo: string) => c.campos.find((x) => x.campo === campo)?.resultado;

describe('Comparación RUT persona natural ↔ usuario SIPRA', () => {
  const usuario = { documento: CEDULA_NATURAL, nombre: NOMBRE_PERSONA };

  it('documento y nombre coinciden, aunque el RUT separe apellidos y nombres y el orden sea otro', () => {
    const c = compararRutPersonaNatural(datosRutPn(), usuario);
    expect(resultadoDe(c, 'documento')).toBe('coincide');
    expect(resultadoDe(c, 'nombre')).toBe('igual');
    expect(c.hayDiscrepancia).toBe(false);
  });

  it('un documento distinto es una discrepancia', () => {
    const c = compararRutPersonaNatural(datosRutPn({ numeroDocumento: '1000000099' }), usuario);
    expect(resultadoDe(c, 'documento')).toBe('diferente');
    expect(c.hayDiscrepancia).toBe(true);
  });

  it('un nombre con un apellido menos es compatible; uno distinto, diferente; sin dato, insuficiente', () => {
    expect(resultadoDe(compararRutPersonaNatural(datosRutPn({ apellidos: 'LOPEZ' }), usuario), 'nombre')).toBe('compatible');
    expect(resultadoDe(compararRutPersonaNatural(datosRutPn({ nombres: 'JUAN', apellidos: 'RUIZ' }), usuario), 'nombre')).toBe('diferente');
    expect(resultadoDe(compararRutPersonaNatural(datosRutPn({ nombres: null, apellidos: null }), usuario), 'nombre')).toBe('informacion_insuficiente');
    expect(resultadoDe(compararRutPersonaNatural(datosRutPn({ numeroDocumento: null }), usuario), 'documento')).toBe('informacion_insuficiente');
  });

  it('exige un RUT de persona natural', () => {
    expect(() => compararRutPersonaNatural(datosRutPj(), usuario)).toThrow();
    expect(() => compararRutPersonaJuridica(datosRutPn(), empresa)).toThrow();
  });
});

describe('Comparación RUT persona jurídica y Cámara ↔ empresa SIPRA', () => {
  it('NIT, DV y razón social coinciden; la forma jurídica no distingue', () => {
    const c = compararRutPersonaJuridica(datosRutPj({ razonSocial: 'ACME DEMOSTRACION SAS' }), empresa);
    expect(resultadoDe(c, 'nit')).toBe('coincide');
    expect(resultadoDe(c, 'dv')).toBe('coincide');
    expect(['igual']).toContain(resultadoDe(c, 'razon_social'));
    expect(sinFormaJuridica('ACME Demostración S.A.S.')).toBe(sinFormaJuridica('acme demostracion sas'));
  });

  it('una razón social distinta es una discrepancia', () => {
    expect(resultadoDe(compararRutPersonaJuridica(datosRutPj({ razonSocial: 'OTRA EMPRESA LTDA' }), empresa), 'razon_social')).toBe('diferente');
  });

  it('Cámara de existencia: compara el representante legal con el de SIPRA', () => {
    expect(resultadoDe(compararCamara(datosCamara(), empresa), 'representante_legal')).toBe('igual');
    expect(resultadoDe(compararCamara(datosCamara({ representanteLegal: 'OTRA PERSONA DISTINTA' }), empresa), 'representante_legal')).toBe('diferente');
    expect(resultadoDe(compararCamara(datosCamara({ representanteLegal: null }), empresa), 'representante_legal')).toBe('informacion_insuficiente');
    expect(resultadoDe(compararCamara(datosCamara(), { ...empresa, representanteLegal: null }), 'representante_legal')).toBe('informacion_insuficiente');
  });

  it('la matrícula de persona natural NO exige representante legal', () => {
    const pn = datosCamara({ tipoCertificado: 'matricula_mercantil', tipoPersona: TipoPersona.NATURAL, nombreORazonSocial: NOMBRE_PERSONA, representanteLegal: null });
    const c = compararCamara(pn, { ...empresa, razonSocial: NOMBRE_PERSONA, representanteLegal: null });
    expect(resultadoDe(c, 'representante_legal')).toBe('no_aplica');
    expect(resultadoDe(c, 'nombre')).toBe('igual');
    expect(c.hayDiscrepancia).toBe(false);
  });

  it('CIIU y DIVIPOLA se informan pero NO deciden (catálogos incompletos), ni siquiera cuando difieren', () => {
    const c = compararRutPersonaJuridica(datosRutPj({ ciiuPrincipal: '9999', divipolaMunicipio: '99999' }), empresa);
    expect(c.campos.filter((x) => x.resultado === 'informativo').map((x) => x.campo)).toEqual(['ciiu', 'divipola_municipio']);
    expect(c.hayDiscrepancia).toBe(false);
    expect(c.campos.some((x) => x.campo === 'direccion')).toBe(false);
  });

  it('SIPRA sin NIT no produce una discrepancia inventada', () => {
    const c = compararRutPersonaJuridica(datosRutPj(), { ...empresa, nitNumero: null, nitDv: null });
    expect(resultadoDe(c, 'nit')).toBe('informacion_insuficiente');
  });

  it('la comparación no guarda valores: solo campos, resultados y códigos', () => {
    const texto = JSON.stringify(compararCamara(datosCamara(), empresa));
    for (const valor of [NIT_JURIDICA, RAZON_SOCIAL, REPRESENTANTE, 'CIUDAD DEMO']) expect(texto).not.toContain(valor);
  });
});
