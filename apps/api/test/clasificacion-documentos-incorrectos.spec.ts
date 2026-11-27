import { clasificarDocumentoArl } from '../src/domain/services/clasificacion-documental-arl.domain-service';
import { clasificarDocumentoEps } from '../src/domain/services/clasificacion-documental-eps.domain-service';

/**
 * Clasificadores LOCALES de documento incorrecto (subfase 1.6A). Señales combinadas, nunca una palabra aislada. Textos
 * 100 % sintéticos.
 */

const CERT_EPS = `ENTIDAD PROMOTORA DE SALUD EPS SINTETICA S.A.
  CERTIFICADO DE AFILIACION
  La EPS certifica que el señor identificado con C.C. 1000000001 se encuentra afiliado activo a nuestra EPS.
  Estado de afiliacion: ACTIVO. Regimen: CONTRIBUTIVO. Tipo de afiliado: COTIZANTE. Fecha de afiliacion: 2020-01-01.
  Plan de beneficios en salud.`;
const NOMINA = `EMPRESA SINTETICA S.A.S. COMPROBANTE DE NOMINA - DESPRENDIBLE DE PAGO
  Periodo de pago: primera quincena. Devengados: salario basico, auxilio de transporte.
  Deducciones: aporte salud EPS 4 por ciento, pension 4 por ciento. Neto a pagar. Empleado identificado 1000000001.`;
const PILA = `PLANILLA INTEGRADA DE LIQUIDACION DE APORTES - PILA. Numero de planilla 9988776655. Operador de informacion: MI PLANILLA.
  Aportante: empresa sintetica. Cotizante 1000000001. Ingreso base de cotizacion IBC. Salud EPS, fondo de pensiones,
  riesgos laborales, caja de compensacion familiar. Periodo de cotizacion salud 2026-02.`;
const CERT_ARL = `ADMINISTRADORA DE RIESGOS LABORALES SINTETICA - ARL
  CERTIFICADO DE AFILIACION AL SISTEMA GENERAL DE RIESGOS LABORALES. Clase de riesgo I. Inicio de cobertura 01/02/2026.
  El trabajador identificado con C.C. 1000000001 se encuentra afiliado. Empleador: empresa sintetica. Estado de la afiliacion: ACTIVA.`;
const LABORAL = `CERTIFICACION LABORAL. La empresa sintetica certifica que el señor identificado con C.C. 1000000001 labora en la empresa
  desde el 2024 con contrato a termino indefinido, desempeñando el cargo de analista, con un salario mensual. Se expide a solicitud.`;

describe('Clasificador EPS · documentos que no sustituyen el certificado', () => {
  it('un certificado de afiliación real sigue siendo probable (sin subtipo)', () => {
    const c = clasificarDocumentoEps(CERT_EPS);
    expect(c.tipo).toBe('certificado_eps_probable');
    expect(c.subtipoIncorrecto).toBeUndefined();
  });

  it.each([
    ['8. desprendible de nómina', NOMINA, 'desprendible_nomina'],
    ['9. planilla PILA', PILA, 'planilla_aportes_pila'],
    ['10. certificado ARL', CERT_ARL, 'certificado_arl'],
    ['11. certificado laboral', LABORAL, 'certificacion_laboral'],
  ])('%s → documento_incorrecto con subtipo', (_n, texto, subtipo) => {
    const c = clasificarDocumentoEps(texto);
    expect(c.tipo).toBe('documento_incorrecto');
    expect(c.subtipoIncorrecto).toBe(subtipo);
    expect(c.motivos).toContain(`subtipo_${subtipo}`);
    expect(JSON.stringify(c)).not.toContain('1000000001');
  });

  it('12. texto insuficiente → no_determinable, nunca documento incorrecto', () => {
    expect(clasificarDocumentoEps('Planilla.')).toMatchObject({ tipo: 'no_determinable', motivos: ['texto_insuficiente'] });
  });

  it('una palabra aislada no decide: «IBC» o «ARL» sueltos en un texto genérico no lo vuelven PILA/ARL', () => {
    const generico = `Documento informativo de la empresa sintetica para el colaborador. Se menciona ARL e IBC de forma general,
      sin ningun otro elemento de planilla ni de certificado. Este texto no corresponde a ningun formato especifico conocido aqui.`;
    expect(clasificarDocumentoEps(generico).tipo).toBe('no_determinable');
  });
});

describe('Clasificador ARL', () => {
  it('certificado ARL → certificado_arl_probable', () => {
    expect(clasificarDocumentoArl(CERT_ARL).tipo).toBe('certificado_arl_probable');
  });

  it.each([
    ['certificado EPS', CERT_EPS, 'certificado_eps'], ['desprendible de nómina', NOMINA, 'desprendible_nomina'],
    ['planilla PILA (aunque mencione riesgos laborales)', PILA, 'planilla_aportes_pila'], ['certificado laboral', LABORAL, 'certificacion_laboral'],
  ])('%s → documento_incorrecto', (_n, texto, subtipo) => {
    const c = clasificarDocumentoArl(texto);
    expect(c).toMatchObject({ tipo: 'documento_incorrecto', subtipoIncorrecto: subtipo });
  });

  it('texto insuficiente → no_determinable', () => {
    expect(clasificarDocumentoArl('ARL').tipo).toBe('no_determinable');
  });
});
