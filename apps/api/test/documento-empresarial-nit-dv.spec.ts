import { controlarNitLeido } from '../src/domain/services/control-nit.domain-service';
import { compararCamara, compararRutPersonaJuridica } from '../src/domain/services/comparacion-documento-empresarial.domain-service';
import { DV_JURIDICA, NIT_JURIDICA, RAZON_SOCIAL, REPRESENTANTE, datosCamara, datosRutPj } from './soporte-documento-empresarial';

const empresa = { nitNumero: NIT_JURIDICA, nitDv: Number(DV_JURIDICA), razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE };

describe('El DV como control determinístico del NIT leído', () => {
  it('un NIT con su DV correcto es confiable', () => {
    expect(controlarNitLeido(NIT_JURIDICA, DV_JURIDICA)).toEqual({ estado: 'confiable', dvEsperado: Number(DV_JURIDICA), confiable: true });
    expect(controlarNitLeido('901.458.772', 2).confiable).toBe(true);
  });

  it('un DV que no corresponde (típico del OCR) NO es lectura confiable, y el NIT no se corrige', () => {
    const malo = String((Number(DV_JURIDICA) + 1) % 10);
    const r = controlarNitLeido(NIT_JURIDICA, malo);
    expect(r).toMatchObject({ estado: 'dv_no_coincide', confiable: false, dvEsperado: Number(DV_JURIDICA) });
    // Un dígito del NIT mal leído tampoco se «arregla» para que el DV cuadre.
    expect(controlarNitLeido('900123457', DV_JURIDICA).confiable).toBe(false);
  });

  it('sin DV, sin NIT o con un NIT imposible no hay base para confiar', () => {
    expect(controlarNitLeido(NIT_JURIDICA, null).estado).toBe('dv_ausente');
    expect(controlarNitLeido(NIT_JURIDICA, '').estado).toBe('dv_ausente');
    expect(controlarNitLeido(null, '1').estado).toBe('nit_ausente');
    expect(controlarNitLeido('abc', '1').estado).toBe('nit_ausente');
    expect(controlarNitLeido('1'.repeat(16), '1').estado).toBe('nit_invalido');
    expect(controlarNitLeido(NIT_JURIDICA, 'x').estado).toBe('dv_no_coincide');
  });

  it('en una comparación, un NIT sin DV confiable NO decide: ni coincide ni es diferente', () => {
    const malo = String((Number(DV_JURIDICA) + 1) % 10);
    const rut = compararRutPersonaJuridica(datosRutPj({ dv: malo }), empresa);
    expect(rut.campos.find((c) => c.campo === 'nit')).toMatchObject({ resultado: 'informacion_insuficiente', nota: 'lectura_no_confiable_dv_no_coincide' });
    expect(rut.campos.find((c) => c.campo === 'dv')?.resultado).toBe('informacion_insuficiente');
    expect(rut.hayDiscrepancia).toBe(false);
    const camara = compararCamara(datosCamara({ dv: malo }), empresa);
    expect(camara.campos.find((c) => c.campo === 'nit')?.resultado).toBe('informacion_insuficiente');
  });

  it('con DV confiable, el NIT y el DV se comparan contra SIPRA', () => {
    expect(compararRutPersonaJuridica(datosRutPj(), empresa).campos.filter((c) => c.campo === 'nit' || c.campo === 'dv').map((c) => c.resultado)).toEqual(['coincide', 'coincide']);
    expect(compararRutPersonaJuridica(datosRutPj(), { ...empresa, nitNumero: '901458772', nitDv: 2 }).campos.find((c) => c.campo === 'nit')?.resultado).toBe('diferente');
  });
});
