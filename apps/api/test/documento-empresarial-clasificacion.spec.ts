import { TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, FamiliaDocumentoEmpresarial, TipoPersona, expectativaDeTipoDocumento,
} from '../src/domain/entities/documento-empresarial';
import { clasificarDocumentoEmpresarial, evaluarExpectativa } from '../src/domain/services/clasificacion-documento-empresarial.domain-service';
import {
  textoCamaraExistencia, textoCamaraMatriculaPn, textoCamaraMatriculaSociedad, textoFactura, textoRut,
} from './soporte-documento-empresarial';

describe('Clasificación de documentos empresariales (por contenido)', () => {
  it.each([
    ['RUT persona natural', textoRut('natural'), C.RUT_PERSONA_NATURAL, FamiliaDocumentoEmpresarial.RUT, TipoPersona.NATURAL],
    ['RUT persona jurídica', textoRut('juridica'), C.RUT_PERSONA_JURIDICA, FamiliaDocumentoEmpresarial.RUT, TipoPersona.JURIDICA],
    ['Cámara · matrícula de persona natural', textoCamaraMatriculaPn(), C.CAMARA_MATRICULA_PERSONA_NATURAL, FamiliaDocumentoEmpresarial.CAMARA, TipoPersona.NATURAL],
    ['Cámara · matrícula de sociedad', textoCamaraMatriculaSociedad(), C.CAMARA_MATRICULA_SOCIEDAD, FamiliaDocumentoEmpresarial.CAMARA, TipoPersona.JURIDICA],
    ['Cámara · existencia y representación', textoCamaraExistencia(), C.CAMARA_EXISTENCIA_REPRESENTACION, FamiliaDocumentoEmpresarial.CAMARA, TipoPersona.JURIDICA],
  ])('%s', (_n, texto, clasificacion, familia, persona) => {
    const r = clasificarDocumentoEmpresarial(texto);
    expect(r.clasificacion).toBe(clasificacion);
    expect(r.familia).toBe(familia);
    expect(r.tipoPersona).toBe(persona);
    expect(r.motivos.length).toBeGreaterThan(0);
  });

  it('una factura de una cámara de comercio es DOCUMENTO_INCORRECTO, no un certificado', () => {
    const r = clasificarDocumentoEmpresarial(textoFactura());
    expect(r.clasificacion).toBe(C.DOCUMENTO_INCORRECTO);
    expect(r.familia).toBeNull();
    expect(r.tipoPersona).toBeNull();
  });

  it('sin texto suficiente NO se afirma que sea incorrecto: es NO_DETERMINABLE', () => {
    expect(clasificarDocumentoEmpresarial('').clasificacion).toBe(C.NO_DETERMINABLE);
    expect(clasificarDocumentoEmpresarial(null).clasificacion).toBe(C.NO_DETERMINABLE);
    expect(clasificarDocumentoEmpresarial('Persona natural').motivos).toEqual(['texto_insuficiente']);
  });

  it('un RUT sin el valor del tipo de contribuyente, o con los dos, no se adivina', () => {
    expect(clasificarDocumentoEmpresarial(textoRut('sin_tipo'))).toMatchObject({ clasificacion: C.NO_DETERMINABLE });
    expect(clasificarDocumentoEmpresarial(textoRut('ambigua'))).toMatchObject({ clasificacion: C.NO_DETERMINABLE });
  });

  it('títulos contradictorios, o un RUT con un certificado de cámara, quedan no determinables', () => {
    const dos = `${textoCamaraExistencia()}\n${textoCamaraMatriculaPn()}`;
    expect(clasificarDocumentoEmpresarial(dos).clasificacion).toBe(C.NO_DETERMINABLE);
    expect(clasificarDocumentoEmpresarial(`${textoRut('natural')}\n${textoCamaraExistencia()}`).clasificacion).toBe(C.NO_DETERMINABLE);
  });

  it('una matrícula cuyo título no dice la persona y sin etiquetas de identificación no se adivina', () => {
    const t = `CERTIFICADO DE MATRÍCULA MERCANTIL\nFecha expedición: 10/09/2026\n${'relleno '.repeat(30)}`;
    expect(clasificarDocumentoEmpresarial(t)).toMatchObject({ clasificacion: C.NO_DETERMINABLE, motivos: ['camara_titulo_matricula', 'camara_persona_no_distinguible'] });
  });

  it('los motivos son códigos: nunca citan el texto del documento', () => {
    const r = clasificarDocumentoEmpresarial(textoCamaraExistencia());
    expect(r.motivos.every((m) => /^[a-z_]+$/.test(m))).toBe(true);
  });
});

describe('Expectativa del estudiante frente a lo detectado (nunca reclasifica en silencio)', () => {
  const esperaRutNatural = expectativaDeTipoDocumento(TipoDocumento.RUT_NATURAL)!;

  it('RUT persona jurídica subido como «RUT persona natural»: válido como RUT, pero la persona no coincide', () => {
    const detectado = clasificarDocumentoEmpresarial(textoRut('juridica'));
    const e = evaluarExpectativa(esperaRutNatural, detectado);
    expect(e.resultado).toBe('persona_distinta');
    expect(e.validoComoFamilia).toBe(true);
    // Lo detectado se conserva tal cual; lo esperado se informa aparte.
    expect(e.detectada.clasificacion).toBe(C.RUT_PERSONA_JURIDICA);
    expect(e.esperada).toEqual({ familia: FamiliaDocumentoEmpresarial.RUT, persona: TipoPersona.NATURAL });
  });

  it('coincide cuando lo esperado y lo detectado son lo mismo', () => {
    expect(evaluarExpectativa(esperaRutNatural, clasificarDocumentoEmpresarial(textoRut('natural'))).resultado).toBe('coincide');
  });

  it('un certificado de cámara donde se esperaba un RUT es de otra familia', () => {
    const e = evaluarExpectativa(esperaRutNatural, clasificarDocumentoEmpresarial(textoCamaraExistencia()));
    expect(e).toMatchObject({ resultado: 'familia_distinta', validoComoFamilia: false });
  });

  it('el tipo «camara_comercio» no fija la persona: cualquier variante de cámara coincide, salvo que quien llama la aporte', () => {
    const libre = expectativaDeTipoDocumento(TipoDocumento.CAMARA_COMERCIO)!;
    expect(libre.persona).toBeNull();
    expect(evaluarExpectativa(libre, clasificarDocumentoEmpresarial(textoCamaraMatriculaPn())).resultado).toBe('coincide');
    const juridica = expectativaDeTipoDocumento(TipoDocumento.CAMARA_COMERCIO, TipoPersona.JURIDICA)!;
    expect(evaluarExpectativa(juridica, clasificarDocumentoEmpresarial(textoCamaraMatriculaPn())).resultado).toBe('persona_distinta');
    expect(evaluarExpectativa(juridica, clasificarDocumentoEmpresarial(textoCamaraMatriculaSociedad())).resultado).toBe('coincide');
  });

  it('incorrecto y no determinable se informan como tales y no sirven como documento de la familia', () => {
    expect(evaluarExpectativa(esperaRutNatural, clasificarDocumentoEmpresarial(textoFactura()))).toMatchObject({ resultado: 'documento_incorrecto', validoComoFamilia: false });
    expect(evaluarExpectativa(esperaRutNatural, clasificarDocumentoEmpresarial(''))).toMatchObject({ resultado: 'no_determinable', validoComoFamilia: false });
  });

  it('los tipos documentales que no son RUT ni Cámara no tienen expectativa empresarial', () => {
    expect(expectativaDeTipoDocumento(TipoDocumento.CERTIFICADO_EPS)).toBeNull();
    expect(expectativaDeTipoDocumento(TipoDocumento.ACTA_INICIO)).toBeNull();
  });
});
