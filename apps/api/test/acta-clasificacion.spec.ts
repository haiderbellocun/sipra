import { clasificarActa } from '../src/domain/services/clasificacion-acta.domain-service';
import {
  TEXTO_ARCHIVO_CUALQUIERA, TEXTO_CARTA_LABORAL, TEXTO_CEDULA, TEXTO_CERTIFICADO_ARL, TEXTO_CERTIFICADO_EPS,
  TEXTO_CONTRATO, actaEnBlanco, actaSintetica,
} from './soporte-acta';

/** Lo que haría un OCR mediocre: 0 por O y 1 por I en las palabras en mayúsculas. */
function degradarOcr(texto: string): string {
  return texto.replace(/\b[A-ZÁÉÍÓÚ]{4,}\b/g, (p) => p.replace(/O/g, '0').replace(/I(?=[A-Z])/g, '1'));
}

describe('Acta de iniciación · clasificación por contenido', () => {
  describe('los tres formatos conocidos (remuneración y ARL son conceptos independientes)', () => {
    it('1 · remunerada + la empresa asume la ARL', () => {
      const c = clasificarActa(actaSintetica({ remuneracion: 'remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa' }));
      expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(c.remuneracion).toBe('remunerada');
      expect(c.responsableArl).toBe('empresa');
      expect(c.confianzaResponsableArl).toBe('alta');
      expect(c.discrepanciasDocumento).toEqual([]);
    });

    it('2 · no remunerada + la CUN asume la ARL', () => {
      const c = clasificarActa(actaSintetica({ remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion', codigo: 'DPE-FO02' }));
      expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(c.remuneracion).toBe('no_remunerada');
      expect(c.responsableArl).toBe('cun');
      expect(c.confianzaResponsableArl).toBe('alta');
    });

    it('3 · no remunerada + la empresa asume la ARL', () => {
      const c = clasificarActa(actaSintetica({ remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa' }));
      expect(c.remuneracion).toBe('no_remunerada');
      expect(c.responsableArl).toBe('empresa');
    });

    it('«no remunerada» no se confunde con «remunerada» aunque la contenga', () => {
      expect(clasificarActa(actaSintetica({ remuneracion: 'no_remunerada' })).remuneracion).toBe('no_remunerada');
      expect(clasificarActa(actaSintetica({ remuneracion: 'remunerada' })).remuneracion).toBe('remunerada');
    });

    it('un título sin la palabra remunerada deja la remuneración sin determinar (no se inventa)', () => {
      const c = clasificarActa(actaSintetica({ remuneracion: 'sin_titulo' }));
      expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(c.remuneracion).toBe('no_determinable');
      expect(c.confianzaRemuneracion).toBeNull();
    });
  });

  it('4 · el código DPE-FO03 compartido no decide nada: el mismo código con otro contenido da otro resultado', () => {
    const a = clasificarActa(actaSintetica({ remuneracion: 'remunerada', encabezadoArl: 'empresa', codigo: 'DPE-FO03' }));
    const b = clasificarActa(actaSintetica({ remuneracion: 'no_remunerada', encabezadoArl: 'empresa', codigo: 'DPE-FO03' }));
    expect([a.remuneracion, b.remuneracion]).toEqual(['remunerada', 'no_remunerada']);
    // Y un documento con ese código pero sin la estructura del acta no es un acta.
    const suelto = clasificarActa(`CODIGO: DPE-FO03\nVERSION: 00\n${TEXTO_CARTA_LABORAL}`);
    expect(suelto.tipoActaDetectada).not.toBe('iniciacion_practicas');
  });

  it('el título por sí solo no basta, ni una sola frase', () => {
    const solo = 'ACTA DE INICIACIÓN DE PRÁCTICAS. Documento de la institución para registrar el comienzo de actividades académicas de los estudiantes en distintos escenarios.';
    expect(clasificarActa(solo).tipoActaDetectada).toBe('no_determinable');
  });

  it.each([
    ['acta de inicio', 'ACTA DE INICIO'],
    ['acta de iniciación', 'Acta de Iniciación'],
    ['iniciación prácticas', 'INICIACIÓN PRÁCTICAS'],
    ['iniciación de prácticas', 'Iniciación de Prácticas'],
  ])('reconoce la variante de título «%s» cuando la estructura acompaña', (_n, titulo) => {
    const cuerpo = actaSintetica().split('\n').slice(1).join('\n');
    expect(clasificarActa(`${titulo}\n${cuerpo}`).tipoActaDetectada).toBe('iniciacion_practicas');
  });

  describe('responsable de la ARL: dos señales independientes', () => {
    it('5 · encabezado y obligaciones coinciden → confianza alta', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'cun', obligacionArl: 'institucion' }));
      expect(c.senales).toMatchObject({ arlEncabezado: 'cun', arlObligaciones: 'cun' });
      expect(c.responsableArl).toBe('cun');
      expect(c.confianzaResponsableArl).toBe('alta');
    });

    it('6 · encabezado y obligaciones se contradicen → no_determinable + discrepancia crítica, sin escoger', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'cun', obligacionArl: 'empresa' }));
      expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(c.responsableArl).toBe('no_determinable');
      expect(c.confianzaResponsableArl).toBeNull();
      expect(c.discrepanciasDocumento).toEqual([
        expect.objectContaining({ codigo: 'ARL_ENCABEZADO_VS_OBLIGACIONES', severidad: 'critica' }),
      ]);
    });

    it('6b · la contradicción inversa (empresa en el encabezado, institución en las obligaciones) tampoco se resuelve', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'empresa', obligacionArl: 'institucion' }));
      expect(c.responsableArl).toBe('no_determinable');
      expect(c.discrepanciasDocumento[0].codigo).toBe('ARL_ENCABEZADO_VS_OBLIGACIONES');
    });

    it('7 · encabezado incompleto pero obligaciones claras → se decide por las obligaciones con confianza media', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'ninguna', obligacionArl: 'empresa' }));
      expect(c.senales.arlEncabezado).toBe('ninguna');
      expect(c.responsableArl).toBe('empresa');
      expect(c.confianzaResponsableArl).toBe('media');
      expect(c.discrepanciasDocumento).toEqual([]);
    });

    it('solo el encabezado, sin la obligación (p. ej. solo se cargó la primera página) → confianza media', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'cun', obligacionArl: 'ninguna' }));
      expect(c.responsableArl).toBe('cun');
      expect(c.confianzaResponsableArl).toBe('media');
    });

    it('sin ninguna de las dos señales → no_determinable, sin discrepancia inventada', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'ninguna', obligacionArl: 'ninguna' }));
      expect(c.responsableArl).toBe('no_determinable');
      expect(c.discrepanciasDocumento).toEqual([]);
    });

    it('la obligación en ambas secciones o el encabezado con las dos partes es ambiguo y crítico', () => {
      const ambasObligaciones = clasificarActa(actaSintetica({ encabezadoArl: 'empresa', obligacionArl: 'ambas' }));
      expect(ambasObligaciones.responsableArl).toBe('no_determinable');
      expect(ambasObligaciones.discrepanciasDocumento[0].codigo).toBe('ARL_OBLIGACIONES_AMBIGUAS');
      const encabezadoDoble = clasificarActa(actaSintetica({ encabezadoArl: 'ambas', obligacionArl: 'empresa' }));
      expect(encabezadoDoble.responsableArl).toBe('no_determinable');
      expect(encabezadoDoble.discrepanciasDocumento[0].codigo).toBe('ARL_ENCABEZADO_AMBIGUO');
    });

    it('la obligación de afiliar a EPS (del estudiante) no cuenta como la de la ARL', () => {
      const c = clasificarActa(actaSintetica({ encabezadoArl: 'cun', obligacionArl: 'ninguna' }));
      expect(c.senales.arlObligaciones).toBe('ninguna');
    });
  });

  describe('documentos que no son un acta', () => {
    it.each([
      ['8a · certificado de EPS', TEXTO_CERTIFICADO_EPS, 'certificado_eps'],
      ['8b · cédula', TEXTO_CEDULA, 'cedula'],
      ['8c · carta laboral', TEXTO_CARTA_LABORAL, 'carta_laboral'],
      ['8d · certificado de ARL', TEXTO_CERTIFICADO_ARL, 'certificado_arl'],
      ['8e · contrato', TEXTO_CONTRATO, 'contrato'],
    ])('%s → documento incorrecto, no «información insuficiente»', (_n, texto, ajeno) => {
      const c = clasificarActa(texto);
      expect(c.tipoActaDetectada).toBe('documento_incorrecto');
      expect(c.documentoAjeno).toBe(ajeno);
      expect(c.remuneracion).toBe('no_determinable');
      expect(c.responsableArl).toBe('no_determinable');
    });

    it('8f · un archivo cualquiera con texto legible y sin rasgos del acta → documento incorrecto', () => {
      const c = clasificarActa(TEXTO_ARCHIVO_CUALQUIERA);
      expect(c.tipoActaDetectada).toBe('documento_incorrecto');
      expect(c.documentoAjeno).toBe('otro');
    });

    it('los motivos son códigos, nunca fragmentos del documento', () => {
      const c = clasificarActa(TEXTO_CEDULA);
      for (const motivo of c.motivos) expect(motivo).toMatch(/^[a-z0-9_]+$/);
    });
  });

  describe('«no pude leer» no es «no es un acta»', () => {
    it('9 · vacío, espacios o ruido → no_determinable por texto insuficiente', () => {
      for (const texto of ['', '   \n  ', '@@ ## 1 2 3 ~~ ||', 'ab']) {
        const c = clasificarActa(texto);
        expect(c.tipoActaDetectada).toBe('no_determinable');
        expect(c.motivos).toEqual(['texto_insuficiente']);
      }
    });

    it('9b · texto largo pero ininteligible → no_determinable (no se acusa de documento incorrecto)', () => {
      const basura = 'xqzv kjhw plmn bvcx '.repeat(40);
      expect(clasificarActa(basura).tipoActaDetectada).toBe('no_determinable');
    });

    it('10 · OCR degradado (0 por O, 1 por I) sigue reconociendo el acta, la remuneración y la ARL', () => {
      const c = clasificarActa(degradarOcr(actaSintetica({ remuneracion: 'no_remunerada', encabezadoArl: 'cun', obligacionArl: 'institucion' })));
      expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(c.remuneracion).toBe('no_remunerada');
      expect(c.senales.arlEncabezado).toBe('cun');
    });

    it('10b · OCR degradado también en la frase de la obligación de la ARL', () => {
      const texto = degradarOcr(actaSintetica({ encabezadoArl: 'ninguna', obligacionArl: 'empresa' }))
        .replace('Afiliar el estudiante al Sistema de Seguridad Social en Riesgos Laborales', 'Af1liar el estud1ante al S1stema de Seguridad Soc1al en R1esgos Laborales');
      const c = clasificarActa(texto);
      expect(c.senales.arlObligaciones).toBe('empresa');
    });

    it('10c · si el OCR no leyó el encabezado de una sección, la obligación NO se atribuye a la sección equivocada', () => {
      // Acta de la CUN (obligación bajo «DE LA INSTITUCIÓN») cuyo encabezado de institución salió ilegible: sin esa sección
      // reconocida, la obligación caería bajo «DE LA EMPRESA» y se afirmaría una ARL que el documento no dice.
      const texto = actaSintetica({ encabezadoArl: 'ninguna', obligacionArl: 'institucion' })
        .replace('OBLIGACIONES DE LA INSTITUCIÓN', 'OBUGACIONES DE LA INSTTUCION');
      const c = clasificarActa(texto);
      expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(c.senales.arlObligaciones).toBe('ninguna');
      expect(c.responsableArl).toBe('no_determinable');
      expect(c.motivos).toContain('obligacion_arl_sin_seccion');
    });

    it('una página aislada de trazabilidad (sin la estructura) queda no_determinable', () => {
      const c = clasificarActa('INICIACIÓN PRÁCTICAS NO REMUNERADAS\nINSTITUCIÓN - CUN ASUME ARL\nCÓDIGO: DPE-FO02\nVERSIÓN: 00\nTRAZABILIDAD\nVERSIÓN FECHA DE APROBACIÓN CONTROL DE CAMBIOS 00 17/07/2019 Creación del documento institucional de prácticas');
      expect(c.tipoActaDetectada).toBe('no_determinable');
    });
  });

  it('rasgos del acta y de otro documento a la vez → no_determinable con discrepancia crítica', () => {
    const mezcla = `${actaSintetica()}\n\n${TEXTO_CERTIFICADO_EPS}\n${TEXTO_CERTIFICADO_ARL}`;
    const c = clasificarActa(mezcla);
    expect(c.tipoActaDetectada).toBe('no_determinable');
    expect(c.discrepanciasDocumento[0]).toMatchObject({ codigo: 'TIPO_ACTA_NO_CONFIRMADO', severidad: 'critica' });
  });

  it('un acta en blanco se reconoce como acta aunque no tenga datos', () => {
    const c = clasificarActa(actaEnBlanco());
    expect(c.tipoActaDetectada).toBe('iniciacion_practicas');
  });
});
