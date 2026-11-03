import { ClasificacionDocumentoEmpresarial as C, TipoPersona } from '../src/domain/entities/documento-empresarial';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { leerCamposRutPorGeometria, leerFechaGeneracionRut } from '../src/domain/services/geometria-rut.domain-service';
import { interpretarRut } from '../src/domain/services/interpretacion-rut.domain-service';
import { minimizarDatosRut } from '../src/domain/services/minimizacion-documento-empresarial.domain-service';
import { caja, rutSintetico, textoDe } from './soporte-rut-sintetico';

const leer = (o: Parameters<typeof rutSintetico>[0]) => interpretarRut([{ cajas: rutSintetico(o) }], o.fuente ?? 'texto');

describe('RUT digital: lectura por geometría', () => {
  it('persona natural: lee cada campo de su región, dígito por dígito, sin depender del orden del texto', () => {
    const cajas = rutSintetico({ persona: 'natural' });
    // El orden de las cajas NO importa (el texto nativo real viene desordenado): se baraja.
    const barajadas = [...cajas].reverse();
    const r = interpretarRut([{ cajas: barajadas }], 'texto');
    expect(r.clasificacion.clasificacion).toBe(C.RUT_PERSONA_NATURAL);
    expect(r.datos).toMatchObject({
      tipoPersona: TipoPersona.NATURAL, nit: '1000000001', dv: String(Nit.calcularDigitoVerificacion('1000000001')), tipoDocumento: 'CC',
      numeroDocumento: '1000000001', nombres: 'MARIA FERNANDA', apellidos: 'PEREZ GOMEZ', ciiuPrincipal: '4711',
      divipolaMunicipio: '25290', fechaGeneracion: '2024-03-15', controlNit: 'confiable',
    });
    expect(r.lecturaDudosa).toBe(false);
    expect(r.confianzaDocumento).toBe(1);
    expect(r.motivos).toEqual([]);
  });

  it('persona jurídica: razón social, NIT y DV; sin datos de persona natural', () => {
    const r = leer({ persona: 'juridica' });
    expect(r.clasificacion.clasificacion).toBe(C.RUT_PERSONA_JURIDICA);
    expect(r.datos).toMatchObject({ tipoPersona: TipoPersona.JURIDICA, nit: '900123456', razonSocial: 'ACME DEMOSTRACION S.A.S.', ciiuPrincipal: '4711', divipolaMunicipio: '25290' });
    for (const k of ['nombres', 'apellidos', 'numeroDocumento', 'tipoDocumento']) expect(r.datos).not.toHaveProperty(k);
  });

  it('el CIIU son los cuatro dígitos de su caja: no absorbe la fecha de inicio de actividad que comparte la fila', () => {
    expect(leer({ persona: 'juridica', ciiu: '6201' }).datos?.ciiuPrincipal).toBe('6201');
  });

  it('DIVIPOLA = departamento (2) + municipio (3), solo por estructura: 11 + 001 = 11001, sin consultar catálogos', () => {
    expect(leer({ persona: 'juridica', dep: '11', mun: '001' }).datos?.divipolaMunicipio).toBe('11001');
    // Un código que no existe en el catálogo parcial igual se conserva si la estructura es válida.
    expect(leer({ persona: 'juridica', dep: '99', mun: '999' }).datos?.divipolaMunicipio).toBe('99999');
    // Estructura inválida ⇒ nulo, nunca un valor armado a medias.
    expect(leer({ persona: 'juridica', dep: '1', mun: '001' }).datos?.divipolaMunicipio).toBeNull();
    expect(leer({ persona: 'juridica', dep: '11', mun: '01' }).datos?.divipolaMunicipio).toBeNull();
  });

  it('dirección, correo, teléfono y responsabilidades se pueden leer pero NO llegan a los datos', () => {
    const r = leer({ persona: 'natural', conContacto: true });
    const texto = JSON.stringify(r);
    for (const prohibido of ['CALLE FALSA', 'persona.demo@ejemplo.test', '3000000000', 'TIENDA DE PRUEBA']) expect(texto).not.toContain(prohibido);
    for (const k of ['direccion', 'correo', 'telefono', 'responsabilidades']) expect(r.datos).not.toHaveProperty(k);
    expect(Object.keys(minimizarDatosRut(r.datos as never, TipoPersona.NATURAL)).sort()).toEqual(
      expect.arrayContaining(['apellidos', 'nit', 'nombres', 'tipoPersona']),
    );
  });

  it('un formulario con pocas etiquetas localizadas no se da por leído: lectura dudosa y sin valores inventados', () => {
    const r = interpretarRut([{ cajas: rutSintetico({ persona: 'natural' }).filter((c) => !/^\d{1,2}\. /.test(c.texto) || /^(5|12|24|25). /.test(c.texto)) }], 'texto');
    expect(r.motivos).toContain('formulario_no_localizado');
    expect(r.lecturaDudosa).toBe(true);
    expect(r.datos?.ciiuPrincipal).toBeNull();
  });
});

describe('NIT + DV: el DV valida y el NIT nunca se corrige', () => {
  const malo = (nit: string) => String((Number(Nit.calcularDigitoVerificacion(nit)) + 1) % 10);

  it('digital con DV que no cuadra: se conserva lo leído (nada se corrige), no es confiable y la lectura es dudosa', () => {
    const r = leer({ persona: 'juridica', dv: malo('900123456') });
    expect(r.datos).toMatchObject({ nit: '900123456', dv: malo('900123456'), controlNit: 'dv_no_coincide' });
    expect(r.lecturaDudosa).toBe(true);
    expect(r.confianzaDocumento).toBe(0.8);
    expect(r.motivos).toContain('nit_no_confiable_dv_no_coincide');
  });

  it('OCR con DV que no cuadra: el NIT se DESCARTA, no se presenta como dato', () => {
    const r = leer({ persona: 'juridica', fuente: 'ocr', confTexto: 95, confDigitos: 95, dv: malo('900123456') });
    expect(r.datos).toMatchObject({ nit: null, dv: null, controlNit: 'descartado_ocr' });
    expect(r.motivos).toContain('nit_descartado_dv_no_cuadra');
    expect(r.lecturaDudosa).toBe(true);
  });

  it('OCR con DV correcto: el NIT se conserva, con la confianza de SUS dígitos', () => {
    const r = leer({ persona: 'juridica', fuente: 'ocr', confTexto: 92, confDigitos: 88 });
    expect(r.datos).toMatchObject({ nit: '900123456', controlNit: 'confiable' });
    expect(r.datos?.confianzaCampos?.nit).toBe(0.88);
  });

  it('persona natural OCR: la cédula impresa en el campo 26 rescata un NIT mal leído, sin tocar ninguna cifra', () => {
    const cajas = rutSintetico({ persona: 'natural', fuente: 'ocr', confTexto: 95, confDigitos: 95 });
    // La primera cifra del NIT (campo 5) se lee mal; la cédula del campo 26 está bien.
    const i = cajas.findIndex((c) => c.texto === '1' && c.y > 0.22 && c.y < 0.24 && c.x < 0.2);
    expect(i).toBeGreaterThan(-1);
    cajas[i] = { ...cajas[i], texto: '7' };
    const r = interpretarRut([{ cajas }], 'ocr');
    expect(r.datos).toMatchObject({ nit: '1000000001', controlNit: 'confiable' });
    expect(r.motivos).toContain('nit_recuperado_del_campo_documento');
  });

  it('OCR: el número de documento solo se conserva si respalda un NIT que el DV ya validó', () => {
    const buena = leer({ persona: 'natural', fuente: 'ocr', confTexto: 95, confDigitos: 95 });
    expect(buena.datos?.numeroDocumento).toBe('1000000001');
    const sinValidar = leer({ persona: 'natural', fuente: 'ocr', confTexto: 95, confDigitos: 95, dv: malo('1000000001'), numeroDocumento: '1000000001' });
    expect(sinValidar.datos?.numeroDocumento).toBeNull();
    expect(sinValidar.motivos).toContain('documento_ocr_sin_nit_validado');
  });
});

describe('Clasificación PN/PJ por contenido y contradicciones', () => {
  it('un RUT natural con razón social, o uno jurídico con nombres, es NO_DETERMINABLE (no se adivina)', () => {
    for (const persona of ['natural', 'juridica'] as const) {
      const r = leer({ persona, contradiccion: true });
      expect(r.clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
      expect(r.clasificacion.motivos).toContain('rut_senales_contradictorias');
      expect(r.datos).toBeNull();
    }
  });

  it('el campo 24 que dice «jurídica» sobre un formulario con nombres de persona natural es una contradicción', () => {
    expect(leer({ persona: 'natural', valor24: 'Persona jurídica' }).clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
  });

  it('persona natural sin nombres ni tipo de documento escrito: se conserva la clasificación del texto, pero sin corroborar y dudosa', () => {
    const r = leer({ persona: 'natural', sinEtiquetas: [25, 31, 32, 33, 34] });
    expect(r.clasificacion.clasificacion).toBe(C.RUT_PERSONA_NATURAL);
    expect(r.motivos).toContain('persona_sin_corroborar');
    expect(r.lecturaDudosa).toBe(true);
  });

  it('el campo 24 ilegible o ambiguo es NO_DETERMINABLE', () => {
    expect(leer({ persona: 'natural', valor24: null }).clasificacion.clasificacion).toBe(C.NO_DETERMINABLE);
  });
});

describe('Fecha de generación: informativa, sin vigencia', () => {
  it('se lee tal cual y no genera ninguna bandera de vencimiento, sin importar su antigüedad', () => {
    for (const fecha of ['15-03-2014', '01-01-2026', '31-12-2099']) {
      const r = leer({ persona: 'juridica', fecha });
      const [d, m, a] = fecha.split('-');
      expect(r.datos?.fechaGeneracion).toBe(`${a}-${m}-${d}`);
      expect(JSON.stringify(r)).not.toMatch(/vigen|vencid|no_vigente|a[nñ]o_en_curso/i);
    }
  });

  it('una fecha imposible (31 de febrero) o fuera de rango no se acepta', () => {
    expect(leer({ persona: 'juridica', fecha: '31-02-2024' }).datos?.fechaGeneracion).toBeNull();
    expect(leer({ persona: 'juridica', fecha: '10-10-1999' }).datos?.fechaGeneracion).toBeNull();
    expect(leerFechaGeneracionRut([caja('Fecha generación documento PDF: sin fecha', 320, 18)])).toBeNull();
  });

  it('la confianza de la fecha es la de sus dígitos, no la de la línea', () => {
    const cajas = rutSintetico({ persona: 'juridica', fuente: 'ocr', confTexto: 95, confDigitos: 91 });
    expect(leerFechaGeneracionRut(cajas)?.confianza).toBe(0.91);
  });
});

describe('RUT escaneado (OCR): estrategia conservadora', () => {
  const ocr = (o: Partial<Parameters<typeof rutSintetico>[0]> & { persona: 'natural' | 'juridica' }) => leer({ fuente: 'ocr', ...o });

  it('con buena confianza se leen nombres y razón social; la confianza del DOCUMENTO no se presenta como la de cada campo', () => {
    const r = ocr({ persona: 'natural', confTexto: 96, confDigitos: 94 });
    expect(r.datos).toMatchObject({ nombres: 'MARIA FERNANDA', apellidos: 'PEREZ GOMEZ', nit: '1000000001', fechaGeneracion: '2024-03-15', divipolaMunicipio: '25290' });
    expect(r.datos?.confianzaCampos).toMatchObject({ nit: 0.94, nombre: 0.96, fechaGeneracion: 0.94, divipola: 0.94 });
    expect(r.confianzaDocumento).not.toBe(r.datos?.confianzaCampos?.nit);
  });

  it('palabras de nombre con confianza media (74 %) NO se aceptan: mejor no determinable que un nombre dudoso', () => {
    const r = ocr({ persona: 'natural', confTexto: 74, confDigitos: 94 });
    expect(r.datos?.nombres).toBeNull();
    expect(r.datos?.apellidos).toBeNull();
    expect(r.motivos).toContain('nombre_ruido_ocr');
    expect(r.lecturaDudosa).toBe(true);
  });

  it('razón social con ruido evidente (símbolos, mucha basura) se descarta', () => {
    const cajas = rutSintetico({ persona: 'juridica', fuente: 'ocr', confTexto: 96, confDigitos: 96, razonSocial: 'AC|ME 0~ ## ;;' });
    const r = interpretarRut([{ cajas }], 'ocr');
    expect(r.datos?.razonSocial).toBeNull();
    expect(r.motivos).toContain('razon_social_ruido_ocr');
  });

  it('con una de las cuatro etiquetas de nombre sin localizar, el nombre se descarta (no se sabe si falta una parte)', () => {
    const r = ocr({ persona: 'natural', confTexto: 96, confDigitos: 96, sinEtiquetas: [32] });
    expect(r.datos?.apellidos).toBeNull();
    expect(r.datos?.nombres).toBeNull();
    expect(r.motivos).toContain('nombre_etiquetas_incompletas');
  });

  it('DIVIPOLA y fecha por OCR con confianza baja se descartan; con alta, se conservan', () => {
    const baja = ocr({ persona: 'juridica', confTexto: 96, confDigitos: 60 });
    expect(baja.datos).toMatchObject({ divipolaMunicipio: null, fechaGeneracion: null, ciiuPrincipal: null });
    const alta = ocr({ persona: 'juridica', confTexto: 96, confDigitos: 90 });
    expect(alta.datos).toMatchObject({ divipolaMunicipio: '25290', fechaGeneracion: '2024-03-15', ciiuPrincipal: '4711' });
  });

  it('un OCR pobre marca la lectura como dudosa aunque no se haya descartado nada', () => {
    expect(ocr({ persona: 'juridica', confEtiquetas: 92, confTexto: 92, confDigitos: 90 }).lecturaDudosa).toBe(false);
    const pobre = ocr({ persona: 'juridica', confEtiquetas: 60, confTexto: 80, confDigitos: 80 });
    expect(pobre.confianzaDocumento).toBeLessThan(0.88);
    expect(pobre.lecturaDudosa).toBe(true);
  });

  it('una lectura digital limpia no es dudosa; el texto de cajas conserva todo el contenido para clasificar', () => {
    expect(textoDe(rutSintetico({ persona: 'natural' }))).toContain('Persona natural');
    expect(leer({ persona: 'natural' }).lecturaDudosa).toBe(false);
  });
});

describe('Geometría de bajo nivel', () => {
  it('localiza las etiquetas por número y primera palabra, no por posición absoluta', () => {
    const g = leerCamposRutPorGeometria(rutSintetico({ persona: 'natural' }), 'texto');
    expect(g.etiquetas).toEqual(expect.arrayContaining([5, 6, 24, 25, 26, 31, 32, 33, 34, 35, 39, 40, 46]));
    // Los campos de contacto delimitan filas pero su valor no se arma.
    expect(g.campos[41]).toBeUndefined();
    expect(g.campos[42]).toBeUndefined();
    expect(g.campos[44]).toBeUndefined();
  });

  it('un número suelto que no es etiqueta (primera palabra distinta) no cuenta como etiqueta', () => {
    const cajas = [caja('24. Algo distinto', 27, 581), caja('1', 40, 569)];
    expect(leerCamposRutPorGeometria(cajas, 'texto').etiquetas).toEqual([]);
  });
});
