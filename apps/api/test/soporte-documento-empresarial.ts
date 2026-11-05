import { Nit } from '../src/domain/value-objects/nit.vo';
import {
  DatosCamaraExtraidos, DatosRutExtraidos, EstadoRegistral, TipoPersona,
} from '../src/domain/entities/documento-empresarial';
import { DatosValidacionDocumentoEmpresarial, ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';

/**
 * Fixtures SINTÉTICOS de documentos empresariales: texto inventado con la ESTRUCTURA de cada documento (etiquetas y
 * títulos), nunca fragmentos ni datos de documentos reales. Personas, NIT y razones sociales son ficticios.
 */

export const NIT_JURIDICA = '900123456';
export const DV_JURIDICA = String(Nit.calcularDigitoVerificacion(NIT_JURIDICA));
export const CEDULA_NATURAL = '1000000001';
export const DV_NATURAL = String(Nit.calcularDigitoVerificacion(CEDULA_NATURAL));
export const RAZON_SOCIAL = 'ACME DEMOSTRACION S.A.S.';
export const NOMBRE_PERSONA = 'MARIA FERNANDA LOPEZ RIVERA';
export const REPRESENTANTE = 'CARLOS ANDRES PEREZ GOMEZ';
export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
export const AHORA = new Date('2026-11-03T15:00:00Z');

const RELLENO = 'Texto de relleno sintético para superar el mínimo de caracteres clasificables en las pruebas. ';

/** Formulario RUT: etiquetas y valores sueltos, sin el orden de lectura de un documento real. */
export function textoRut(persona: 'natural' | 'juridica' | 'ambigua' | 'sin_tipo'): string {
  const valor = persona === 'natural' ? 'Persona natural o sucesión ilíquida'
    : persona === 'juridica' ? 'Persona jurídica'
      : persona === 'ambigua' ? 'Persona natural o sucesión ilíquida Persona jurídica' : '';
  return [
    'Formulario del Registro Único Tributario', '4. Número de formulario', '12. Dirección seccional', '24. Tipo de contribuyente',
    valor, 'Responsabilidades, Calidades y Atributos', 'Fecha generación documento PDF: 15-03-2024 10:00:00AM', RELLENO,
  ].join('\n');
}

export function textoCamaraMatriculaPn(): string {
  return [
    'CÁMARA DE COMERCIO DE CIUDAD DEMO', 'CERTIFICADO DE MATRÍCULA MERCANTIL DE PERSONA NATURAL', 'Fecha expedición: 10/09/2026',
    'CÓDIGO DE VERIFICACIÓN ABC123DEF4', `Nombres y apellidos : ${NOMBRE_PERSONA}`, `Identificación : CC - ${CEDULA_NATURAL}`,
    'Matrícula No: 123456', RELLENO,
  ].join('\n');
}

/** Matrícula de una sociedad: el título NO dice la persona; la dice la etiqueta «Razón social». */
export function textoCamaraMatriculaSociedad(): string {
  return [
    'CÁMARA DE COMERCIO DE CIUDAD DEMO', 'CERTIFICADO DE MATRÍCULA MERCANTIL', 'Fecha expedición: 10/09/2026',
    'CÓDIGO DE VERIFICACIÓN ABC123DEF4', `Razón Social : ${RAZON_SOCIAL}`, `Nit : ${NIT_JURIDICA}-${DV_JURIDICA}`,
    'Matrícula No: 654321', RELLENO,
  ].join('\n');
}

export function textoCamaraExistencia(): string {
  return [
    'Cámara de Comercio de Ciudad Demo', 'CERTIFICADO DE EXISTENCIA Y REPRESENTACIÓN LEGAL', 'Fecha de expedición: 10/09/2026',
    'CÓDIGO DE VERIFICACIÓN: ZZ99YY88XX', `Razón social: ${RAZON_SOCIAL}`, `Nit: ${NIT_JURIDICA}-${DV_JURIDICA}`,
    `Representante legal: ${REPRESENTANTE}`, RELLENO,
  ].join('\n');
}

/** Una factura emitida por una cámara de comercio: menciona la cámara, pero no es un certificado. */
export function textoFactura(): string {
  return [
    'FACTURA ELECTRÓNICA DE VENTA', 'Emisor: CÁMARA DE COMERCIO DE CIUDAD DEMO', 'Forma de pago: contado', 'Medio de pago: efectivo',
    'Cliente: PERSONA DE PRUEBA', RELLENO,
  ].join('\n');
}

export function datosRutPn(sobre: Partial<DatosRutExtraidos> = {}): DatosRutExtraidos {
  return {
    tipoPersona: TipoPersona.NATURAL, nit: CEDULA_NATURAL, dv: DV_NATURAL, fechaGeneracion: '2024-03-15',
    tipoDocumento: 'CC', numeroDocumento: CEDULA_NATURAL, nombres: 'MARIA FERNANDA', apellidos: 'LOPEZ RIVERA',
    ciiuPrincipal: '4711', divipolaMunicipio: '11001', ...sobre,
  };
}

export function datosRutPj(sobre: Partial<DatosRutExtraidos> = {}): DatosRutExtraidos {
  return {
    tipoPersona: TipoPersona.JURIDICA, nit: NIT_JURIDICA, dv: DV_JURIDICA, fechaGeneracion: '2024-03-15',
    razonSocial: RAZON_SOCIAL, ciiuPrincipal: '6201', divipolaMunicipio: '11001', ...sobre,
  };
}

export function datosCamara(sobre: Partial<DatosCamaraExtraidos> = {}): DatosCamaraExtraidos {
  return {
    tipoCertificado: 'existencia_representacion', tipoPersona: TipoPersona.JURIDICA, nombreORazonSocial: RAZON_SOCIAL,
    nit: NIT_JURIDICA, dv: DV_JURIDICA, matricula: '654321', camara: 'CIUDAD DEMO', fechaMatricula: '2018-01-17',
    ultimoAnioRenovado: 2026, fechaRenovacion: '2026-03-31', estadoRegistral: EstadoRegistral.NO_DETERMINABLE,
    domicilioMunicipio: 'Ciudad Demo', ciiu: '6201', representanteLegal: REPRESENTANTE, fechaExpedicion: '2026-09-10',
    codigoVerificacion: 'ZZ99YY88XX', urlVerificacion: 'https://verifica.ejemplo.test/certificados', diasVerificacionDocumento: 60,
    firmaPdfPresente: true, ...sobre,
  };
}

/** A. Matrícula de persona natural: sin representante legal, identificación = cédula + DV. */
export function datosCamaraPn(sobre: Partial<DatosCamaraExtraidos> = {}): DatosCamaraExtraidos {
  return datosCamara({
    tipoCertificado: 'matricula_mercantil', tipoPersona: TipoPersona.NATURAL, nombreORazonSocial: NOMBRE_PERSONA,
    nit: CEDULA_NATURAL, dv: DV_NATURAL, matricula: '123456', representanteLegal: null, ciiu: '4711', ...sobre,
  });
}

/** B. Matrícula de sociedad: el representante legal es opcional (aquí no figura). */
export function datosCamaraMatriculaSociedad(sobre: Partial<DatosCamaraExtraidos> = {}): DatosCamaraExtraidos {
  return datosCamara({ tipoCertificado: 'matricula_mercantil', representanteLegal: null, ...sobre });
}

/** Una factura que COBRA un certificado: lleva el título del certificado como concepto, pero sigue siendo una factura. */
export function textoFacturaConConceptoDeCertificado(): string {
  return [
    'FACTURA ELECTRÓNICA DE VENTA', 'Emisor: CÁMARA DE COMERCIO DE CIUDAD DEMO', 'Forma de pago: contado', 'Medio de pago: efectivo',
    'Concepto: CERTIFICADO DE MATRÍCULA MERCANTIL DE PERSONA NATURAL', 'Cliente: PERSONA DE PRUEBA', RELLENO,
  ].join('\n');
}

export function validacionPendiente(sobre: Partial<{ tipoEsperado: string | null }> = {}): ValidacionDocumentoEmpresarial {
  return ValidacionDocumentoEmpresarial.pendiente({
    id: '00000000-0000-4000-8000-0000000000e1', documentoId: '00000000-0000-4000-8000-0000000000d1',
    practicaId: '00000000-0000-4000-8000-0000000000a1', estudianteId: '00000000-0000-4000-8000-0000000000b1',
    tipoEsperado: sobre.tipoEsperado === undefined ? 'rut_natural' : sobre.tipoEsperado, recibidaEn: AHORA, ahora: AHORA,
  });
}

export type DatosValidacion = DatosValidacionDocumentoEmpresarial;
